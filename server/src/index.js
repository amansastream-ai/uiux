/**
 * SunuÉcole — Point d'entrée du serveur.
 *
 * Un seul processus Node sert l'API JSON et l'application web statique :
 * déploiement trivial (un port, aucune configuration), ce qui compte pour un
 * établissement qui installe la solution sur une machine locale.
 *
 * Performance : compression gzip/brotli, cache fort sur les assets versionnés,
 * ETag sur les réponses JSON volumineuses, requêtes préparées en base.
 */
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';

import { config, PLANS } from './config.js';
import db from './db/index.js';
import { HttpError } from './lib/utils.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import studentsRoutes from './routes/students.js';
import academicsRoutes from './routes/academics.js';
import financeRoutes from './routes/finance.js';
import peopleRoutes from './routes/people.js';
import commsRoutes from './routes/comms.js';
import settingsRoutes from './routes/settings.js';

const app = express();
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ */
/* Sécurité & performance                                              */
/* ------------------------------------------------------------------ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-inline' est nécessaire pour les styles CSS-in-JS et les SVG
      // générés côté client ; les scripts restent strictement same-origin.
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: config.security.frameAncestors,
      formAction: ["'self'"],
    },
  },
  // La CSP frame-ancestors ci-dessus fait foi ; X-Frame-Options n'a pas
  // d'équivalent « liste d'origines » et bloquerait les aperçus légitimes.
  frameguard: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(compression({ level: 6, threshold: 512, filter: (req, res) => !req.path.startsWith('/api/health') }));
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(cookieParser());

// Limitation de débit globale (protège une petite machine locale)
app.use('/api', rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
  message: { error: 'Trop de requêtes, merci de réessayer dans quelques minutes.' },
}));
// Durcissement spécifique sur l'authentification
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.security.loginRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' },
}));

/* ------------------------------------------------------------------ */
/* Routes API                                                          */
/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) => {
  const t0 = Date.now();
  let dbOk = false;
  try { dbOk = db.get('SELECT 1 AS ok').ok === 1; } catch { dbOk = false; }
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    version: config.platform.version,
    uptime: Math.round(process.uptime()),
    db: dbOk ? 'ok' : 'error',
    latency_ms: Date.now() - t0,
    memory_mb: Math.round(process.memoryUsage().rss / 1048576),
    timestamp: new Date().toISOString(),
  });
});

/** Métadonnées publiques : utilisées par la page de connexion et l'onboarding. */
app.get('/api/meta', (_req, res) => {
  res.json({
    name: config.platform.name,
    version: config.platform.version,
    country: config.platform.defaultCountry,
    currency: config.platform.defaultCurrency,
    timezone: config.platform.defaultTimezone,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
    schools: db.all("SELECT id, name, slug, city, plan FROM schools WHERE is_active=1 ORDER BY name"),
    demo: db.get('SELECT COUNT(*) AS c FROM schools WHERE demo=1')?.c > 0,
    integrations: {
      mobileMoney: Object.keys(config.integrations.mobileMoney).filter((k) => k !== 'mode'),
      smsMode: config.integrations.sms.mode,
      momoMode: config.integrations.mobileMoney.mode,
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/people', peopleRoutes);
app.use('/api/comms', commsRoutes);
app.use('/api/settings', settingsRoutes);

// 404 API (avant le fallback SPA)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route API introuvable.' });
});

/* ------------------------------------------------------------------ */
/* Application web (statique + fallback SPA)                           */
/* ------------------------------------------------------------------ */
const webDir = config.paths.web;
const ONE_YEAR = 31536000;

if (fs.existsSync(webDir)) {
  // Assets versionnés : cache immutable pour un rechargement quasi instantané
  app.use('/assets', express.static(path.join(webDir, 'assets'), {
    maxAge: ONE_YEAR,
    immutable: true,
    etag: true,
    setHeaders: (res) => res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`),
  }));
  app.use('/icons', express.static(path.join(webDir, 'icons'), { maxAge: ONE_YEAR }));
  // Le service worker doit toujours être revalidé (sinon les mises à jour bloquent)
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(webDir, 'sw.js'));
  });
  app.get('/manifest.webmanifest', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(webDir, 'manifest.webmanifest'));
  });
  app.use(express.static(webDir, { etag: true, maxAge: 300, index: false }));
  // Fallback SPA
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, 'index.html'));
  });
} else {
  app.get('*', (_req, res) => {
    res.status(503).type('html').send(
      '<h1>Interface introuvable</h1><p>Le dossier <code>web/</code> est absent. Lancez <code>npm run seed</code> puis rechargez.</p>'
    );
  });
}

/* ------------------------------------------------------------------ */
/* Gestion centralisée des erreurs                                     */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[erreur] ${req.method} ${req.originalUrl}`, err);
  const body = { error: err.message || 'Erreur interne du serveur.', status };
  if (err.fields) body.fields = err.fields;
  if (err.conflicts) body.conflicts = err.conflicts;
  if (config.env === 'development' && status >= 500) body.stack = err.stack;
  res.status(status).json(body);
});

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
// Amorce automatique : si la base est vide, on charge le jeu de démonstration
// pour qu'une école (ou un testeur) voie immédiatement un produit rempli.
function bootstrap() {
  const schools = db.pluck('SELECT COUNT(*) FROM schools');
  if (!schools) {
    console.log('Base vide → chargement du jeu de démonstration…');
    import('./db/seed.js').then((m) => m.seed());
  }
}

const server = app.listen(config.port, config.host, () => {
  bootstrap();
  const lines = [
    '',
    '  ╔══════════════════════════════════════════════════════════════╗',
    `  ║  ${config.platform.name} v${config.platform.version} — plateforme scolaire tout-en-un`,
    '  ╠══════════════════════════════════════════════════════════════╣',
    `  ║  Serveur   http://${config.host}:${config.port}`,
    `  ║  API       http://${config.host}:${config.port}/api`,
    `  ║  Base      ${config.db.file.replace(config.paths.root + '/', '')}`,
    `  ║  Mode      ${config.env} · SMS ${config.integrations.sms.mode} · Mobile Money ${config.integrations.mobileMoney.mode}`,
    '  ╚══════════════════════════════════════════════════════════════╝',
    '',
  ];
  console.log(lines.join('\n'));
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const shutdown = (signal) => {
  console.log(`\n${signal} reçu → arrêt propre…`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

export default app;

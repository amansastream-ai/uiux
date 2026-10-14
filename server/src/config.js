/**
 * SunuÉcole — Configuration centrale.
 * Toutes les valeurs sensibles passent par l'environnement, avec des défauts
 * sûrs pour le développement local et la démonstration hors-ligne.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { moduleDir } from './lib/paths.js';

/* Répertoire du module : `null` lorsque le serveur est empaqueté en un seul
 * fichier (fonction Netlify), `import.meta.url` étant alors vidé par esbuild. */
const MODULE_DIR = moduleDir(import.meta.url);

// server/src/config.js → deux niveaux remontent à la racine du projet.
// Cas du bundle serverless : SUE_ROOT_DIR si fourni, sinon le répertoire de
// travail — c'est la racine de la fonction (/var/task sur Netlify), où les
// fichiers inclus (web/**, schema.sql) sont déployés.
export const ROOT = process.env.SUE_ROOT_DIR
  ? path.resolve(process.env.SUE_ROOT_DIR)
  : (MODULE_DIR ? path.resolve(MODULE_DIR, '..', '..') : process.cwd());

/** Répertoire de données (base SQLite, envois, sauvegardes, journal).
 *  SUE_DATA_DIR le déplace vers un disque inscriptible : indispensable en
 *  serverless, où tout le code est en lecture seule (/tmp/sunuecole). */
const DATA_DIR = process.env.SUE_DATA_DIR
  ? path.resolve(process.env.SUE_DATA_DIR)
  : path.join(ROOT, 'server', 'data');

/** Génère (et persiste) un secret JWT stable si l'environnement n'en fournit pas.
 *  Le fichier vit dans le répertoire de données — jamais dans l'arborescence du
 *  code, en lecture seule une fois déployée en serverless — et un secret
 *  éphémère est utilisé si même ce répertoire n'est pas inscriptible : mieux
 *  vaut des sessions à redémarrer que cinq minutes d'indisponibilité. */
function ensureSecret(file, envValue) {
  if (envValue) return envValue;
  const p = path.join(DATA_DIR, file);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(p, secret, { mode: 0o600 });
    return secret;
  } catch {
    console.warn(`[config] ${file} non inscriptible (disque en lecture seule) : `
      + 'secret JWT éphémère — définissez JWT_SECRET pour des sessions durables.');
    return crypto.randomBytes(48).toString('hex');
  }
}

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|oui)$/i.test(String(v)));
const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',

  paths: {
    root: ROOT,
    // Surchargeables par variables d'environnement : indispensable sur les
    // hébergements sans disque persistant (Netlify/Lambda : /tmp) ou quand le
    // code est empaqueté ailleurs que dans l'arborescence du dépôt.
    data: DATA_DIR,
    uploads: path.join(DATA_DIR, 'uploads'),
    backups: path.join(DATA_DIR, 'backups'),
    web: process.env.SUE_WEB_DIR ? path.resolve(process.env.SUE_WEB_DIR) : path.join(ROOT, 'web'),
  },

  db: {
    file: process.env.DB_FILE
      ? path.resolve(ROOT, process.env.DB_FILE)
      : path.join(ROOT, 'server', 'data', 'sunuecole.sqlite'),
  },

  auth: {
    jwtSecret: ensureSecret('.jwt_secret', process.env.JWT_SECRET),
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '2h',
    refreshTokenTtlDays: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
    bcryptRounds: int(process.env.BCRYPT_ROUNDS, 10),
    maxFailedAttempts: int(process.env.MAX_FAILED_ATTEMPTS, 8),
    lockMinutes: int(process.env.LOCK_MINUTES, 15),
    cookieName: 'sue_rt',
    secureCookies: bool(process.env.SECURE_COOKIES, false),
  },

  security: {
    rateLimitWindowMs: int(process.env.RL_WINDOW_MS, 15 * 60 * 1000),
    rateLimitMax: int(process.env.RL_MAX, 1200),
    loginRateLimitMax: int(process.env.LOGIN_RL_MAX, 20),
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    // Origines autorisées à afficher l'application dans un <iframe> (aperçu, portail partenaire).
    // 'self' reste toujours inclus. Séparateur : espace.
    frameAncestors: ["'self'", ...(process.env.FRAME_ANCESTORS || 'https://*.e2b.app')
      .split(/\s+/).map((x) => x.trim()).filter(Boolean)],
  },

  platform: {
    name: 'SunuÉcole',
    version: '1.0.0',
    defaultCountry: process.env.DEFAULT_COUNTRY || 'Sénégal',
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'XOF',
    defaultTimezone: 'Africa/Dakar',
    trialDays: int(process.env.TRIAL_DAYS, 30),
    superAdminEmail: process.env.SUPER_ADMIN_EMAIL || 'admin@sunuecole.app',
    superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || 'SunuAdmin2026!',
  },

  integrations: {
    // En production : clés réelles des agrégateurs. En démo : mode simulé,
    // ce qui permet de tester tout le parcours sans débit réel.
    mobileMoney: {
      mode: process.env.MOMO_MODE || 'simulated', // simulated | live
      orange: { apiKey: process.env.ORANGE_API_KEY || '', merchant: process.env.ORANGE_MERCHANT || '' },
      wave: { apiKey: process.env.WAVE_API_KEY || '' },
      mtn: { apiKey: process.env.MTN_API_KEY || '' },
      moov: { apiKey: process.env.MOOV_API_KEY || '' },
      free: { apiKey: process.env.FREE_MONEY_API_KEY || '' },
    },
    sms: {
      mode: process.env.SMS_MODE || 'simulated', // simulated | live
      provider: process.env.SMS_PROVIDER || 'simule',
      apiKey: process.env.SMS_API_KEY || '',
      senderId: process.env.SMS_SENDER_ID || 'SUNUECOLE',
      segmentLength: 160,
      pricePerSegment: int(process.env.SMS_PRICE, 25), // XOF
    },
    email: {
      mode: process.env.EMAIL_MODE || 'simulated',
      smtpUrl: process.env.SMTP_URL || '',
      from: process.env.EMAIL_FROM || 'noreply@sunuecole.app',
    },
  },

  schoolDefaults: {
    // Barème de conversion moyenne → mention (paramétrable par école)
    gradingScale: [
      { min: 18, mention: 'Excellent', color: '#0f766e' },
      { min: 16, mention: 'Très Bien', color: '#15803d' },
      { min: 14, mention: 'Bien', color: '#4d7c0f' },
      { min: 12, mention: 'Assez Bien', color: '#a16207' },
      { min: 10, mention: 'Passable', color: '#c2410c' },
      { min: 0, mention: 'Insuffisant', color: '#b91c1c' },
    ],
    dayStart: '07:30',
    dayEnd: '17:30',
    slotMinutes: 55,
    breakMinutes: 15,
    lunchMinutes: 120,
    schoolDays: [1, 2, 3, 4, 5], // lun → ven (samedi optionnel)
    attendanceGraceMinutes: 15,
    invoiceLateFeeAfterDays: 15,
    reminderScheduleDays: [3, 0, -7], // J+3 après échéance, jour J, J-7
  },
};

/** Plans d'abonnement proposés aux établissements. */
export const PLANS = {
  essentiel: {
    name: 'Essentiel',
    price: 15000,
    period: 'mois',
    maxStudents: 150,
    tagline: 'Pour démarrer la digitalisation sans risque',
    features: [
      'Dossiers élèves & inscriptions',
      'Appel des présences (hors-ligne inclus)',
      'Notes & bulletins automatiques',
      'Emploi du temps',
      'Facturation + Mobile Money',
      'Portail parents',
      'Notifications SMS (100/mois)',
      'Support par e-mail',
    ],
    modules: ['students', 'attendance', 'grades', 'timetable', 'finance', 'parents'],
  },
  pro: {
    name: 'Pro',
    price: 35000,
    period: 'mois',
    maxStudents: 600,
    tagline: 'Le choix des établissements qui veulent tout piloter',
    popular: true,
    features: [
      'Tout le plan Essentiel',
      'Jusqu\'à 600 élèves',
      'Cahier de textes & devoirs en ligne',
      'Discipline & vie scolaire',
      'Paie du personnel & congés',
      'Bibliothèque, cantine, transport',
      'Rapports & exports illimités (PDF/CSV)',
      'Notifications SMS (1 000/mois)',
      'Support prioritaire WhatsApp',
    ],
    modules: ['students', 'attendance', 'grades', 'timetable', 'finance', 'parents', 'homework', 'discipline', 'payroll', 'library', 'canteen', 'transport'],
  },
  elite: {
    name: 'Élite',
    price: 75000,
    period: 'mois',
    maxStudents: 3000,
    tagline: 'Multi-sites, groupes scolaires et exigences élevées',
    features: [
      'Tout le plan Pro',
      'Élèves illimités & multi-sites',
      'Tableaux de bord analytiques avancés',
      'API & intégrations sur mesure',
      'Journal d\'audit complet',
      'Sauvegardes automatiques dédiées',
      'SMS illimités + campagne de masse',
      'Formation sur site incluse',
      'Account manager dédié',
    ],
    modules: ['students', 'attendance', 'grades', 'timetable', 'finance', 'parents', 'homework', 'discipline', 'payroll', 'library', 'canteen', 'transport', 'health', 'analytics', 'api'],
  },
};

export const ROLES = {
  super_admin: { label: 'Super administrateur', level: 100 },
  direction: { label: 'Direction', level: 90 },
  censeur: { label: 'Censeur / Surveillant général', level: 75 },
  comptable: { label: 'Comptable', level: 70 },
  secretaire: { label: 'Secrétariat', level: 65 },
  bibliothecaire: { label: 'Bibliothécaire', level: 45 },
  infirmier: { label: 'Infirmerie', level: 45 },
  enseignant: { label: 'Enseignant', level: 50 },
  surveillant: { label: 'Surveillant', level: 40 },
  parent: { label: 'Parent / Tuteur', level: 20 },
  eleve: { label: 'Élève', level: 10 },
};

export const roleLevel = (role) => ROLES[role]?.level ?? 0;

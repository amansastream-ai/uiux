'use strict';
/** ChronoRH — serveur principal (Express local + compatible fonction serverless Vercel). */
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const { open, schema, seed, resolveDbPath } = require('./db');
const { apiRouter } = require('./api');

const PORT = process.env.PORT || 3000;

function createApp(customDb) {
  const db = customDb || open();
  schema(db);
  const seeded = seed(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // API
  app.use('/api', apiRouter(db));

  // Fichiers statiques (SPA)
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
    }
  }));

  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  });

  app.db = db;
  app.seeded = seeded;
  return app;
}

const app = createApp();
app.createApp = createApp;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ChronoRH — SaaS de pointage & paie`);
    console.log(`  ✚  http://localhost:${PORT}`);
    console.log(`  ✚  Base de données : ${resolveDbPath()}`);
    console.log(`  ✚  Données de démo : ${app.seeded ? 'initialisées' : 'déjà présentes'}\n`);
  });
}

module.exports = app;

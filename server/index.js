'use strict';
/** ChronoRH — serveur principal. */
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('node:path');
const { open, schema, seed } = require('./db');
const { apiRouter } = require('./api');

const PORT = process.env.PORT || 3000;

const db = open();
schema(db);
const seeded = seed(db);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// API
app.use('/api', apiRouter(db));

// Fichiers statiques (SPA)
app.use(express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    }
  }
}));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ChronoRH — SaaS de pointage & paie`);
  console.log(`  ✚  http://localhost:${PORT}`);
  console.log(`  ✚  Base de données : ${path.join(__dirname, '..', 'data', 'chronorh.db')}`);
  console.log(`  ✚  Données de démo : ${seeded ? 'initialisées' : 'déjà présentes'}\n`);
});

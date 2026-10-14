/**
 * SunuÉcole sur Netlify — fonction serverless enveloppant l'application Express.
 *
 * FICHIER COMMONJS VOLONTAIRE : le runtime Lambda/Netlify chargeait un fichier
 * ESM (.js avec imports statiques et top-level await) comme du CommonJS
 * (« Cannot use import statement outside a module »). On écrit donc du CJS
 * pur et on charge l'application ESM par import() dynamique à l'intérieur.
 * Le package.json voisin fixe "type": "commonjs" pour lever toute ambiguïté.
 *
 * Particularités Lambda/Netlify :
 *  - système de fichiers en lecture seule sauf /tmp (éphémère) : la base
 *    SQLite y est créée et semée au premier démarrage froid ;
 *  - code empaqueté (bundle) : chemins surchargés par variables
 *    (SUE_DATA_DIR, SUE_WEB_DIR, DB_FILE) ;
 *  - /tmp réinitialisé à chaque déploiement : Netlify = démonstration
 *    publique ; production = Render/Railway/VPS (DEPLOIEMENT-NETLIFY.md).
 */
'use strict';

const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

let _handler = null;

async function loadHandler() {
  if (_handler) return _handler;

  /* Les variables d'environnement doivent être posées AVANT l'import de config. */
  const DATA = process.env.SUE_DATA_DIR || '/tmp/sunuecole';
  mkdirSync(DATA, { recursive: true });
  process.env.SUE_DATA_DIR = DATA;
  if (!process.env.DB_FILE) process.env.DB_FILE = path.join(DATA, 'sunuecole.sqlite');
  if (!process.env.SUE_WEB_DIR) process.env.SUE_WEB_DIR = path.join(process.cwd(), 'web');

  const { config } = await import('../../server/src/config.js');

  /* Premier démarrage froid : base absente → semer les données de démonstration. */
  if (!existsSync(config.db.file)) {
    const { seed } = await import('../../server/src/db/seed.js');
    seed();
  }

  const { default: app } = await import('../../server/src/index.js');
  const serverless = (await import('serverless-http')).default;

  _handler = serverless(app, {
    binary: ['application/octet-stream', 'image/png', 'image/svg+xml'],
  });
  return _handler;
}

/** Point d'entrée API Gateway (Netlify Functions). */
exports.handler = async (event, context) => {
  const handler = await loadHandler();
  return handler(event, context);
};

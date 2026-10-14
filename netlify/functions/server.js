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
 *  - chaque instance (conteneur) a SON /tmp : deux requêtes simultanées
 *    peuvent donc s'exécuter sur deux bases différentes. D'où les deux
 *    précautions ci-dessous — un secret de session partagé par tout le
 *    déploiement, et une base de démonstration auto-réparée ;
 *  - code empaqueté (bundle) : chemins surchargés par variables
 *    (SUE_DATA_DIR, SUE_WEB_DIR, DB_FILE) ;
 *  - /tmp réinitialisé à chaque déploiement : Netlify = démonstration
 *    publique ; production = Render/Railway/VPS (DEPLOIEMENT-NETLIFY.md).
 */
'use strict';

const { existsSync, mkdirSync, copyFileSync, rmSync } = require('node:fs');
const path = require('node:path');

let _handler = null;

/** Répertoire de travail de la fonction (/var/task sur Netlify) : c'est là que
 *  sont déployés les fichiers inclus (web/**, schema.sql, secret de build). */
const TASK_ROOT = process.cwd();

/**
 * Secret de session partagé par toutes les instances du déploiement.
 *
 * Sans JWT_SECRET, chaque conteneur générait SON secret au démarrage : un jeton
 * émis par l'instance A était rejeté par l'instance B (« Session expirée » dès
 * la requête suivante, y compris après une simple rotation de conteneur).
 * Le build écrit `server/data/.jwt_secret` (scripts/build-secret.mjs) et le
 * déploie avec la fonction : toutes les instances du même déploiement signent
 * et vérifient donc avec le même secret. JWT_SECRET reste prioritaire.
 */
function useSharedSecret(DATA) {
  if (process.env.JWT_SECRET) return;
  const bundled = path.join(TASK_ROOT, 'server', 'data', '.jwt_secret');
  const target = path.join(DATA, '.jwt_secret');
  try {
    if (!existsSync(bundled) || existsSync(target)) return;
    copyFileSync(bundled, target);
  } catch (err) {
    console.warn(`[netlify] secret partagé indisponible : ${err.message}`);
  }
}

/** Vrai si la base contient bien le jeu de démonstration complet.
 *  Un semis interrompu (délai dépassé) laisse un fichier tronqué que
 *  `existsSync` considérait comme valide : plus aucune réparation possible,
 *  et les comptes de démonstration répondaient « Identifiants incorrects ».
 *  On vérifie donc le contenu, pas la seule présence du fichier. */
function demoDataReady(file) {
  const sqlite = process.getBuiltinModule('node:sqlite');
  if (!sqlite || !existsSync(file)) return false;
  let db = null;
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true });
    const schools = db.prepare('SELECT COUNT(*) AS c FROM schools').get();
    const demoUser = db.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?')
      .get('direction@lesbaobabs.sn');
    return schools.c >= 3 && demoUser.c >= 1;
  } catch {
    return false; /* fichier incomplet, corrompu ou tables absentes */
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

async function loadHandler() {
  if (_handler) return _handler;

  /* Les variables d'environnement doivent être posées AVANT l'import de config. */
  const DATA = process.env.SUE_DATA_DIR || '/tmp/sunuecole';
  mkdirSync(DATA, { recursive: true });
  process.env.SUE_DATA_DIR = DATA;
  if (!process.env.DB_FILE) process.env.DB_FILE = path.join(DATA, 'sunuecole.sqlite');
  if (!process.env.SUE_WEB_DIR) process.env.SUE_WEB_DIR = path.join(TASK_ROOT, 'web');
  useSharedSecret(DATA);

  const { config } = await import('../../server/src/config.js');

  /* Base absente OU incomplète (semis interrompu) : on repart d'une base saine
   * plutôt que de servir une démonstration à moitié remplie. Le fichier est
   * éphémère (/tmp) : aucune donnée réelle n'est concernée. */
  if (!demoDataReady(config.db.file)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(config.db.file + suffix, { force: true }); } catch { /* ignore */ }
    }
    const { seed } = await import('../../server/src/db/seed.js');
    const { default: db } = await import('../../server/src/db/index.js');
    // Un seul commit pour tout le jeu de démonstration : nettement plus rapide
    // (le premier accès après un déploiement est un démarrage à froid) et
    // atomique — un semis interrompu est annulé par SQLite au lieu de laisser
    // une base à moitié remplie.
    db.tx(() => seed());
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

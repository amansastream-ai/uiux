/**
 * SunuÉcole sur Netlify — fonction serverless enveloppant l'application Express.
 *
 * Particularités de l'environnement Lambda/Netlify :
 *  - système de fichiers en lecture seule, sauf /tmp (éphémère) : la base
 *    SQLite y est créée et semée au premier démarrage froid ;
 *  - le code est empaqueté (bundle) : les chemins sont donc surchargés par
 *    variables d'environnement (SUE_DATA_DIR, SUE_WEB_DIR, DB_FILE) ;
 *  - chaque déploiement réinitialise /tmp : Netlify convient pour une
 *    démonstration publique, pas pour des données de production
 *    (voir DEPLOIEMENT-NETLIFY.md pour Render/Railway/VPS).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

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

/** Adaptateur Express → API Gateway (Netlify Functions). */
export const handler = serverless(app, {
  // Les réponses binaires (exports, icônes) passent en base64 automatiquement.
  binary: ['application/octet-stream', 'image/png', 'image/svg+xml'],
});

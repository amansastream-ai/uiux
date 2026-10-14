/**
 * SunuÉcole — secret de session du déploiement (Netlify).
 *
 * Sans JWT_SECRET, chaque conteneur de fonction générait son propre secret :
 * un jeton émis par une instance était rejeté par la suivante, ce qui donnait
 * des « Session expirée » aléatoires (l'utilisateur se reconnecte, la requête
 * d'après retombe sur une autre instance et le rejette).
 *
 * Ce script, exécuté au build (voir netlify.toml), écrit un secret aléatoire
 * dans `server/data/.jwt_secret` ; le fichier est ensuite déployé avec la
 * fonction (included_files) et copié dans le répertoire de données au premier
 * démarrage. Toutes les instances du même déploiement partagent ainsi le même
 * secret, sans qu'aucun secret n'apparaisse dans le dépôt.
 *
 * Le script ne doit JAMAIS faire échouer un build : en cas d'échec (disque
 * plein, permissions), on se contente d'un avertissement et le serveur
 * retombe sur le comportement précédent (secret local au conteneur).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'server', 'data', '.jwt_secret');

try {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  // JWT_SECRET défini côté Netlify : il prime, le fichier est inutile.
  console.log(process.env.JWT_SECRET
    ? '[build] JWT_SECRET fourni par l’environnement : secret de build ignoré'
    : `[build] secret de session du déploiement prêt (${path.relative(root, target)})`);
} catch (err) {
  console.warn(`[build] secret de session non généré : ${err.message}`);
}

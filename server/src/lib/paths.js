/**
 * SunuÉcole — Résolution des chemins compatible avec l'exécution empaquetée.
 *
 * Pourquoi ce module existe : sur Netlify (et plus généralement dans une
 * fonction serverless), le bundler esbuild concatène tout le serveur dans un
 * unique fichier CommonJS. Dans ce bundle, `import.meta` est remplacé par un
 * objet vide (`import_meta = {}`) : `import.meta.url` vaut donc `undefined` et
 * `fileURLToPath(import.meta.url)` lève
 *
 *   TypeError: The "path" argument must be of type string or an instance of
 *   URL. Received undefined
 *
 * au chargement de `config.js` — soit une erreur 502 sur *toutes* les routes,
 * page d'accueil comprise.
 *
 * `moduleDir()` attend l'`import.meta.url` de l'appelant (chaque module connaît
 * ainsi *son* répertoire, y compris sans bundle) et renvoie la valeur de repli
 * fournie quand ce chemin n'est pas exploitable. Les appelants décident alors
 * de la racine à utiliser (variable d'environnement ou cwd).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Répertoire du module dont l'URL est fournie, ou `fallback` si indéterminable
 * (bundle serverless : `import.meta.url` est vide).
 * @param {string|undefined} metaUrl `import.meta.url` de l'appelant.
 * @param {string|null} fallback Valeur renvoyée quand le chemin est introuvable.
 * @returns {string|null}
 */
export function moduleDir(metaUrl, fallback = null) {
  if (typeof metaUrl === 'string' && metaUrl) {
    try {
      return path.dirname(fileURLToPath(metaUrl));
    } catch {
      /* URL inattendue : on préfère le repli à un plantage au démarrage. */
    }
  }
  return fallback;
}

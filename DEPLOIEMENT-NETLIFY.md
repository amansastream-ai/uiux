# Publier SunuÉcole — Netlify (démo) & hébergement persistant (production)

SunuÉcole est une application **full-stack** : API Express + base SQLite + front
ES modules. Deux façons de la publier, selon l'objectif.

| Objectif | Hébergement recommandé | Pourquoi |
|---|---|---|
| Démo publique, vitrine, tests clients | **Netlify** | Gratuit, HTTPS immédiat, déploiement à chaque `git push` |
| Vraie école, données réelles | **Render / Railway / VPS** | Disque persistant (SQLite), processus long vivant |

Sur Netlify, l'application tourne dans une **fonction serverless**
(`netlify/functions/server.js`) : le système de fichiers y est éphémère
(`/tmp`), donc la base de démonstration est **re-semée à chaque déploiement**
et après une longue inactivité. C'est parfait pour une vitrine, insuffisant
pour des données de production.

---

## A. Créer la branche `sunu-ecole` sur GitHub

Le code complet est déjà poussé sur votre dépôt GitHub
`amansastream-ai/uiux`, branche `arena/cbc6159a-uiux` (dernier commit = tout le
travail : plateforme, correctifs, adaptateur Netlify).

1. Ouvrez https://github.com/amansastream-ai/uiux
2. Cliquez sur le sélecteur de branche (bouton portant le nom d'une branche,
   en haut de la liste des fichiers) ;
3. Tapez `sunu-ecole` puis **« Create branch: sunu-ecole from
   arena/cbc6159a-uiux »**.

(Alternative sans branche dédiée : fusionner `arena/cbc6159a-uiux` dans
`main` via une Pull Request, puis publier `main`.)

## B. Déployer sur Netlify (5 minutes)

1. https://app.netlify.com → **Add new site → Import an existing project** ;
2. Choisissez **GitHub** → sélectionnez le dépôt `uiux` ;
3. Réglez :
   - **Branch to deploy** : `sunu-ecole` ;
   - **Build command** : laissé vide (Netlify lit `netlify.toml` :
     `npm install`) ;
   - **Publish directory** : laissé vide (`netlify.toml` : `public`) ;
4. Dans **Environment variables**, ajoutez (facultatif, déjà prérempli par
   `netlify.toml` pour NODE_VERSION) :
   - `NODE_VERSION` = `22`
   - `JWT_SECRET` = une longue chaîne aléatoire. **Facultatif mais recommandé** :
     sans lui, le secret de session est généré au build (voir
     `scripts/build-secret.mjs`), partagé par toutes les instances du
     déploiement — avec lui, les sessions survivent même aux redéploiements ;
5. **Deploy site**. Premier déploiement ≈ 1 à 2 min ; le premier accès
   comprend un « démarrage à froid » (semis de la base de démo, ≈ 1 à 2 s
   depuis le passage du semis en une seule transaction).
6. URL obtenue : `https://<nom>.netlify.app`. Identifiants de démonstration
   affichés sur la page de connexion (mot de passe commun `Sunu2026!`).

Chaque `git push` sur `sunu-ecole` redéploie automatiquement.

### Ce que fait la configuration fournie
- `netlify.toml` : Node 22, bundler esbuild, inclusion des assets `web/**` et
  du `schema.sql` dans la fonction, timeout 30 s, et redirection de **toutes**
  les routes (`/*`) vers la fonction Express — l'application sert elle-même
  son HTML, ses assets versionnés et son API ;
- `scripts/build-secret.mjs` : au build, écrit `server/data/.jwt_secret`,
  déployé avec la fonction. Toutes les instances du déploiement partagent donc
  le **même secret de session** : sans cela, chaque conteneur en générait un au
  hasard et un jeton émis par l'un était rejeté par l'autre (« Session
  expirée » dès la requête suivante, sans que l'utilisateur ait rien fait) ;
- `netlify/functions/server.js` : crée `/tmp/sunuecole`, y seme la base
  **en une transaction** (atomique, ≈ 1 s) si elle est absente *ou incomplète*,
  puis enveloppe Express avec `serverless-http` ;
- le jeton de session voyage sur trois canaux (Authorization, X-Session,
  cookie `sue_at`) : compatible avec les proxies agressifs.

### Dépannage — pannes connues et correctifs en place
En cas de page « Invocation Failed », de « Session expirée » inexpliquée ou de
comptes de démonstration refusés, comparez le symptôme à ce tableau.

| Message dans la fonction | Cause | Correctif en place |
|---|---|---|
| `The "path" argument must be of type string… Received undefined`, au chargement de `server/src/config.js` | dans un bundle CJS, `import.meta` est vidé : `import.meta.url` vaut `undefined` et `fileURLToPath(undefined)` échoue | `server/src/lib/paths.js` (`moduleDir()`), repli `SUE_ROOT_DIR` puis répertoire de travail |
| `Cannot find module 'sqlite'` | `node:sqlite` est un module **à préfixe obligatoire**, or le bundler réécrit `node:sqlite` en `require('sqlite')` | résolution à l'exécution : `process.getBuiltinModule('node:sqlite')` |
| `EROFS: read-only file system` | écriture du secret JWT dans l'arborescence du code | le secret vit dans le répertoire de données (`/tmp/sunuecole`), sinon secret éphémère |
| « Session expirée » sur la première action après une période d'inactivité | chaque instance de fonction avait son propre secret de session : le conteneur recyclé rejetait les jetons émis par le précédent | secret unique par déploiement (`scripts/build-secret.mjs` + `server/data/.jwt_secret` dans la fonction) ; `JWT_SECRET` pour survivre aussi aux redéploiements |
| Comptes de démonstration refusés (« Identifiants incorrects ») alors que la base semblait présente | semis interrompu par le délai de la fonction : le fichier existait, tronqué, et n'était donc plus jamais resemé | contrôle de complétude (`demoDataReady`) puis resemis — atomique, car en une seule transaction |
| « Session expirée » en saisissant un mot de passe erroné | le client interprétait **tout** 401 (même sur la connexion) comme une fin de session | seules les routes protégées terminent la session ; les routes publiques affichent `Identifiants incorrects.` |

Trois points de contrôle après chaque déploiement :
`GET /api/health` → `{"status":"ok",…}` ; `GET /` → page de connexion ;
les identifiants de démonstration du tableau ci-dessus fonctionnent.

### Limites assumées sur Netlify
- données de démo **réinitialisées** à chaque déploiement / démarrage froid ;
- **un établissement créé pendant la démo ne survit pas à une longue période
  d'inactivité** : le conteneur est recyclé, `/tmp` remis à zéro et le compte
  recréé n'existe plus. La reconnexion le signale explicitement. Pour une
  école réelle (données conservées), utilisez la section C ;
- plusieurs instances parallèles = bases séparées (le secret de session, lui,
  est partagé : la session survit au changement d'instance) ;
- exports/sauvegardes écrits dans `/tmp` (non durables).

## C. Production avec données persistantes (recommandé pour une école)

### Render.com (le plus simple)
1. https://render.com → **New → Web Service** → dépôt `uiux`, branche
   `sunu-ecole` ;
2. Runtime **Node**, build `npm install`, démarrage `node server/src/index.js` ;
3. Ajoutez un **Disk** (persistant) monté sur `/home/user/uiux/server/data`
   (ou définissez `SUE_DATA_DIR` vers le point de montage) ;
4. Variables : `JWT_SECRET`, `NODE_ENV=production`.

### Railway / Fly.io / VPS
Même principe : processus long + volume persistant pour `server/data`.
Sur VPS Ubuntu : `npm install`, `npm run seed`, puis `pm2 start
server/src/index.js --name sunuecole` + nginx en reverse proxy HTTPS.

## D. Vérifications après déploiement
- `GET /api/health` → `{"status":"ok",…}` ;
- page de connexion → comptes de démonstration → tableau de bord ;
- `npm test` en local : 31 tests (unitaires + smoke HTTP) doivent rester verts —
  sur un clone neuf, les tests sèment eux-mêmes la base de démonstration.

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
   - `JWT_SECRET` = une longue chaîne aléatoire (sinon un secret est généré
     au démarrage : les sessions survivent mal aux redémarrages) ;
5. **Deploy site**. Premier déploiement ≈ 1 à 2 min ; le premier accès
   comprend un « démarrage à froid » (semis de la base de démo, ≈ 10 s).
6. URL obtenue : `https://<nom>.netlify.app`. Identifiants de démonstration
   affichés sur la page de connexion (mot de passe commun `Sunu2026!`).

Chaque `git push` sur `sunu-ecole` redéploie automatiquement.

### Ce que fait la configuration fournie
- `netlify.toml` : Node 22, bundler esbuild, inclusion des assets `web/**` et
  du `schema.sql` dans la fonction, timeout 30 s, et redirection de **toutes**
  les routes (`/*`) vers la fonction Express — l'application sert elle-même
  son HTML, ses assets versionnés et son API ;
- `netlify/functions/server.js` : crée `/tmp/sunuecole`, y seme la base si
  absente, puis enveloppe Express avec `serverless-http` ;
- le jeton de session voyage sur trois canaux (Authorization, X-Session,
  cookie `sue_at`) : compatible avec les proxies agressifs.

### Limites assumées sur Netlify
- données de démo **réinitialisées** à chaque déploiement / démarrage froid ;
- plusieurs instances parallèles = bases séparées (cohérent pour une démo) ;
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
- `npm test` en local : 31 tests (unitaires + smoke HTTP) doivent rester verts.

# Lamex TV — site vitrine Web TV

Refonte responsive en français de la page Lamex TV : lecteur de direct, actualités éditoriales, replays YouTube et aperçu de l’offre membre Lamex +.

## Lancer le site

Le site est statique, sans étape de compilation. À la racine du projet :

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

Ouvrir ensuite `http://localhost:4173`. En mode serveur statique, le site affiche un aperçu local de la grille vidéo. Pour tester aussi la fonction Netlify `/api/rss` :

```bash
npx netlify-cli dev
```

## Déploiement Netlify

Le projet est configuré avec `netlify.toml` : publication du dossier racine et fonctions serverless dans `netlify/functions/`. La route `/api/rss?channelId=...` récupère le flux Atom public de YouTube ; `/api/live?channelId=...` vérifie périodiquement le direct via oEmbed. Aucune clé YouTube n’est nécessaire. Quand un direct est détecté, le lecteur bascule depuis la playlist vers le live ; quand il s’arrête, le lecteur revient aux replays. Le navigateur ne lance pas la vidéo automatiquement au chargement de la page.

Pour publier **avec les fonctions activées**, utilise une connexion Git entre le dépôt et Netlify, ou déploie le dossier extrait avec Netlify CLI :

```bash
npx netlify-cli login
npx netlify-cli link
npx netlify-cli deploy --prod
```

Le simple glisser-déposer d’un dossier/ZIP sur un hébergement statique peut publier la page, mais ne construit pas nécessairement les fonctions. Dans ce cas, les routes `/api/rss` et `/api/live` ne fonctionneront pas : le site affichera les cartes d’aperçu et n’effectuera pas la bascule automatique.

Les actualités présentes dans `app.js` sont des exemples éditoriaux pour la maquette. Remplacez les titres, résumés et textes par les articles de la rédaction, ou branchez un CMS avant d’ouvrir le site au public. Les trois images de démonstration dans `assets/` sont des visuels illustratifs, pas des reportages réels.

## Configuration YouTube et vMix

Les réglages publics sont dans `config.js` :

- `channelId` : identifiant de chaîne YouTube, ici celui transmis dans le HTML d’origine ;
- `channelUrl` : adresse de la chaîne officielle ;
- `playlistId` : playlist utilisée pour les replays ;
- `streamMode: "youtube"` : le bouton du lecteur ouvre le direct de la chaîne YouTube ;
- `streamMode: "hls"` et `hlsPlaybackUrl` : lecture d’un flux HLS HTTPS fourni par une plateforme de diffusion.

**À vérifier avant publication :** le code fourni indiquait `PLAt3BZ1JJEzo` comme playlist. Vérifiez que cette valeur est bien l’identifiant complet de la playlist en copiant le paramètre `list=` depuis son URL YouTube. Sinon, le bouton « Replays » ne pourra pas ouvrir la playlist.

### Le chemin le plus simple avec vMix

1. Dans YouTube Studio, préparez une diffusion en direct et récupérez l’adresse du serveur RTMP et la clé de stream depuis l’interface officielle.
2. Dans vMix, sélectionnez la destination RTMP / YouTube et collez ces informations **dans vMix uniquement**. Ne mettez jamais la clé de stream dans `config.js`, dans le HTML ou dans un dépôt public.
3. Une fois la diffusion lancée sur la chaîne `@lamextvlive`, le bouton « Regarder la chaîne » intégrera le direct YouTube dans le lecteur du site. Le bouton « Replays » sert de solution de repli quand aucun direct n’est actif.

Le navigateur ne sait pas lire un flux RTMP directement. Pour envoyer vMix directement vers le site sans passer par l’embed YouTube, il faut un service d’ingest RTMP (plateforme de streaming ou serveur géré) qui transforme le signal en **HLS HTTPS** — ou en WebRTC — pour la lecture web. Après configuration de ce service, renseignez son URL de lecture `.m3u8` dans `hlsPlaybackUrl` et passez `streamMode` à `"hls"`. Le compte de diffusion/serveur doit également autoriser la lecture depuis le domaine du site (CORS), chiffrer le trafic HTTPS, et gérer la conversion/les profils de qualité. Héberger soi-même l’ingest implique un serveur, de la bande passante et de la supervision.

## Articles et publication

Les trois contenus de démarrage sont définis dans le tableau `articles` au début de `app.js`. Ils servent à montrer les rubriques Politique, Société et Culture ainsi que les filtres, la recherche et la lecture en fenêtre modale. Pour publier régulièrement avec une interface rédactionnelle, la prochaine étape recommandée est un CMS (par exemple WordPress, éventuellement utilisé en mode headless). Il faudra alors récupérer les articles depuis son API plutôt que modifier `app.js` à chaque publication.

## Lamex +, Wave et Orange Money

L’interface Lamex + est un aperçu ; **aucun paiement n’est activé** et les boutons ne prélèvent rien. Pour commercialiser des vidéos au Sénégal, il faudra notamment :

1. ouvrir/valider les comptes marchands et les accès de paiement auprès des opérateurs ou d’un prestataire agréé ;
2. créer la transaction depuis un backend sécurisé (pas depuis le navigateur), puis rediriger vers le parcours de paiement officiel ;
3. vérifier la notification serveur-à-serveur / callback avant de marquer un abonnement comme payé ;
4. stocker le droit d’accès côté serveur et servir les vidéos depuis un stockage ou un fournisseur vidéo protégé. Cacher un lien dans le JavaScript n’est pas une protection : un utilisateur pourrait le récupérer.

Les accès marchand, secrets d’API, clés RTMP, numéros de téléphone et identifiants de paiement ne doivent jamais être inclus dans le dépôt ou le code public. Les prix de l’offre sont à définir avec Lamex avant toute intégration.

# Sutura AI — prototype d’assistant de vie

Interface responsive en français, pensée pour Dakar, avec salutations et réponses de démonstration en wolof. Le hologramme, le parcours de première visite, la préférence de voix féminine et les écrans de gestion forment un prototype interactif.

## Lancer en local

```bash
npm install
npm run dev
```

Pour vérifier le build de production :

```bash
npm run build
npm run preview
```

## Tester sur Netlify

Le fichier `netlify.toml` configure déjà le build Vite, le dossier `dist` et le fallback nécessaire aux routes de l’application. Sur Netlify, reliez le dépôt et utilisez :

- **Build command** : `npm run build`
- **Publish directory** : `dist`
- **Node** : 22

Cette configuration ne déploie que l’interface. Les clés secrètes et les appels aux services d’IA ou aux boutiques ne doivent pas être placés dans le navigateur ; il faudra une API serveur ou des fonctions sécurisées.

## Parcours disponible

- **Première visite** : créer un nom d’utilisateur et un mot de passe, ou ouvrir la démo sans compte.
- **Assistant vocal** : écrire une demande ou utiliser la dictée et la synthèse vocales natives du navigateur, si elles sont prises en charge. La préférence féminine et douce est utilisée lorsqu’une voix correspondante est disponible.
- **Agenda** : consulter, ajouter et confirmer des rendez-vous ; partager le récapitulatif d’un rendez-vous client avec le responsable via la fonction de partage du navigateur.
- **Boutique** : enregistrer une demande d’intégration pour Shopify, WooCommerce, PrestaShop, Wix, Ecwid ou une autre plateforme, puis filtrer et suivre des commandes fictives.
- **Facturation** : préparer une facture de démonstration, la télécharger en texte et simuler sa transmission au transporteur choisi.
- **Espace élèves** : lire ou écouter des explications et suivre les leçons terminées.
- **Ma mémoire** : enregistrer et supprimer manuellement des repères locaux.
- **Paramètres** : choisir la langue, la préférence vocale et le nom du transporteur utilisé par défaut.

## Limites et prochaines étapes

C’est un **prototype front-end**, pas une IA connectée : les réponses sont des exemples locaux ; les demandes d’intégration de boutique et les opérations d’envoi/livraison sont simulées. Une boutique « universelle » nécessite un connecteur autorisé pour chaque plateforme (API/OAuth, plugin ou import de commandes) ; renseigner son nom et son URL ne la connecte pas tout seul. La voix wolof dépend des voix disponibles sur l’appareil ou, en production, d’un fournisseur vocal qui la prend en charge.

Les données de démonstration sont stockées dans ce navigateur. Le mot de passe est vérifié localement pour illustrer le parcours, mais ce mécanisme ne remplace pas un système d’authentification serveur sécurisé. Avant de passer sur O2Switch, il faudra confirmer les possibilités du forfait choisi et déployer l’API ainsi que la base de données séparément ou sur un service compatible. Pour le mobile, cette interface peut d’abord devenir une PWA, puis être emballée avec Capacitor ou reconstruite en application native selon le besoin.

Sutura n’a ni conscience ni accès autonome à la vie de l’utilisateur. Avant toute mise en production, connecter un backend sécurisé, définir les règles de consentement et de conservation, et intégrer les fournisseurs réels d’IA, de voix, de calendrier, de paiement et de livraison.

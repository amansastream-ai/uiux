# Sutura AI — prototype d’assistant de vie

Interface responsive en français, wolof et anglais, pensée pour Dakar. Le prototype réunit un assistant, un agenda, des écrans de boutique et de facturation fictifs, un espace élèves et des préférences vocales.

## Lancer l’interface en local

```bash
npm install
npm run dev
```

Vite lance seulement l’interface; les fonctions Netlify ne sont pas disponibles avec cette commande. Pour lancer l’application et ses fonctions dans l’environnement Netlify local, utilisez le CLI Netlify (`npx netlify-cli dev`) après avoir relié le site de test et configuré ses variables d’environnement.

Pour vérifier le build de production :

```bash
npm run build
npm run preview
```

## IA et voix sur Netlify

`netlify.toml` configure le build Vite, `dist` et les fonctions serveur sous `netlify/functions`. Les routes `/api/assistant`, `/api/speech` et `/api/transcribe` sont réécrites vers Netlify Functions. Les clés ne sont jamais intégrées au bundle React.

Dans les **variables d’environnement du site Netlify**, ajoutez au besoin :

| Variable | Requise | Rôle |
| --- | --- | --- |
| `OPENAI_API_KEY` | Oui, pour les réponses IA | Clé OpenAI utilisée uniquement dans la fonction serveur. |
| `OPENAI_MODEL` | Non | Modèle Responses API; valeur par défaut : `gpt-4o-mini`. |
| `ELEVENLABS_API_KEY` | Oui, pour la voix et la transcription | Clé ElevenLabs utilisée uniquement dans les fonctions serveur. |
| `ELEVENLABS_VOICE_ID` | Oui, pour la synthèse vocale | Identifiant de la voix choisie dans le compte ElevenLabs — choisissez une voix féminine douce compatible avec le français et le wolof. |
| `ELEVENLABS_MODEL_ID` | Non | Modèle de synthèse; valeur par défaut : `eleven_v4_turbo`. |
| `ELEVENLABS_STT_MODEL_ID` | Non | Modèle de transcription; valeur par défaut : `scribe_v2`. |

Ajoutez ces valeurs dans l’interface Netlify, puis redéployez. **Ne mettez jamais ces clés dans `VITE_*`, dans un fichier de configuration public, dans Git ou dans le navigateur.** Aucune clé ni aucun identifiant de voix n’a été fourni ou configuré dans ce dépôt; les fonctions cloud ne sont donc pas encore actives.

Dans **Paramètres → Langue & voix**, l’option « Services IA cloud » est désactivée par défaut. Si elle est activée, le message et jusqu’à huit messages précédents, ainsi qu’un résumé limité des rendez-vous, commandes et factures, sont envoyés à OpenAI. Les champs client, téléphone et adresse ne sont pas inclus dans le résumé, mais les titres/descriptions libres et les messages saisis peuvent tout de même contenir ces informations. La voix et la dictée cloud transmettent du texte ou de l’audio à ElevenLabs. Si les fonctions ou leurs clés manquent, l’assistant retombe sur sa réponse locale de démonstration et la synthèse vocale du navigateur.

La reconnaissance vocale native du navigateur est utilisée pour le français et l’anglais lorsqu’elle est disponible; son traitement peut dépendre du fournisseur du navigateur. La dictée en wolof passe par ElevenLabs Scribe après activation de l’option cloud. La qualité de la voix et de la transcription wolof doit être vérifiée avec des locuteurs de Dakar avant tout déploiement réel.

### Sécurité avant tout test avec de vraies clés

Les comptes de ce prototype sont stockés et vérifiés localement; **ils ne protègent pas les fonctions serveur**. Les routes API actuelles n’ont pas encore d’authentification serveur ni de limitation de débit persistante. Avant de configurer des clés sur un site accessible au public, gardez le site de test protégé (par exemple par un accès privé) et ajoutez une authentification serveur, une limitation de débit, un suivi d’usage et des plafonds de dépense chez les fournisseurs. Les tailles de requête et les réponses sont limitées côté fonction, mais cela ne remplace pas ces protections.

## Parcours disponible

- **Première visite** : créer un nom d’utilisateur et un mot de passe locaux, ou ouvrir la démo sans compte.
- **Assistant Sutura** : réponses locales de démonstration par défaut; OpenAI facultatif après activation explicite des services cloud. Aucune action réelle de boutique ou de livraison n’est exécutée.
- **Voix** : voix du navigateur en solution de secours; synthèse ElevenLabs facultative côté serveur. Préférence féminine douce pour la voix locale; choix du `ELEVENLABS_VOICE_ID` côté serveur pour la voix cloud.
- **Agenda** : consulter, ajouter et confirmer des rendez-vous fictifs; partager un récapitulatif via le navigateur.
- **Boutique** : enregistrer une demande d’intégration pour Shopify, WooCommerce, PrestaShop, Wix, Ecwid ou une autre plateforme, puis filtrer des commandes fictives.
- **Facturation** : préparer une facture de démonstration et la télécharger; la transmission au transporteur est simulée.
- **Espace élèves** : lire ou écouter des explications et suivre les leçons terminées.
- **Ma mémoire** : enregistrer et supprimer manuellement des repères locaux.
- **Paramètres** : choisir la langue, le fournisseur vocal cloud et le nom du transporteur utilisé par défaut.

## Limites et prochaines étapes

C’est toujours un prototype : les réponses locales restent disponibles sans clé, mais la connexion réelle à une boutique, un transporteur, une messagerie, un calendrier, un paiement ou une base de données n’existe pas. Une boutique « universelle » nécessite un connecteur autorisé pour chaque plateforme (API/OAuth, plugin ou import de commandes); renseigner son nom et son URL ne la connecte pas. Avant le passage sur O2Switch, vérifier les possibilités du forfait et héberger les fonctions serveur ainsi qu’une base de données compatible. Pour le mobile, cette interface peut d’abord devenir une PWA, puis être emballée avec Capacitor ou reconstruite en application native selon le besoin.

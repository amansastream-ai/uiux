# SunuÉcole — la plateforme de gestion scolaire pensée pour l'Afrique francophone

Application tout-en-un (direction, scolarité, pédagogie, finances, RH, services,
communication, portails familles/élèves) construite pour les réalités du terrain :
**FCFA/XOF, Mobile Money, notifications SMS, faible débit, coupures de courant et
fonctionnement hors-ligne.**

Objectif produit : qu'une école soit **opérationnelle en moins d'une heure**, sans
formation et sans matériel coûteux.

---

## 1. Démarrage rapide

```bash
npm install          # 7 dépendances, aucune compilation native
npm run seed:fresh   # crée + peuple la base de démonstration
npm start            # http://localhost:3000
```

Aucune variable d'environnement n'est obligatoire : tout est paramétré par défaut
dans `server/src/config.js` (port, JWT, sécurité, intégrations simulées).

### Comptes de démonstration

Tous les mots de passe sont `Sunu2026!` (super-admin : `SunuAdmin2026!`).

| Rôle | E-mail | Établissement |
| --- | --- | --- |
| Super admin plateforme | `admin@sunuecole.app` | tous |
| Direction | `direction@lesbaobabs.sn` | Complexe Scolaire Les Baobabs (Pikine) |
| Secrétariat | `secretariat@lesbaobabs.sn` | Les Baobabs |
| Comptabilité | `compta@lesbaobabs.sn` | Les Baobabs |
| Enseignant | `prof@lesbaobabs.sn` | Les Baobabs |
| Parent | `parent@lesbaobabs.sn` | Les Baobabs (3 enfants) |
| Élève | `eleve@lesbaobabs.sn` | Les Baobabs |
| Direction | `direction@saintemarie.sn` | Sainte-Marie Hann (plan Élité) |
| Direction | `direction@ndiandiaye.sn` | École Ndiandiaye 1 (plan Essentiel, essai) |

La page de connexion propose aussi des **boutons de connexion rapide** par rôle.

### Données de démonstration

1 061 élèves, 32 classes, 45 enseignants, 2 539 factures, ~22 500 pointages
d'appel, ~16 000 notes, bulletins, dépenses, paie, bibliothèque, cantine,
transport, infirmerie, annonces, SMS, événements et journal d'audit.

---

## 2. Architecture

```
un seul processus Node/Express (0.0.0.0:3000)
├── API REST        /api/{auth,dashboard,students,academics,finance,people,comms,settings}
├── SPA statique    /            (vanilla ES modules, zéro build, zéro CDN)
└── Service worker  /sw.js       (cache shell + API réseau-d'abord, file d'attente hors-ligne)
```

- **Base de données** : SQLite via le module natif `node:sqlite` (WAL). Aucun binaire
  à compiler, sauvegarde = copie de fichier (`POST /api/settings/backups`).
- **Multi-établissement** : chaque table porte `school_id` ; le cloisonnement est
  appliqué côté serveur dans chaque requête.
- **Authentification** : JWT + refresh tokens rotatifs, bcrypt, verrouillage après
  échecs répétés, double authentification optionnelle, journal des appareils.
- **Sécurité HTTP** : helmet (CSP `script-src 'self'`, `frame-ancestors`),
  rate limiting, `frameguard` désactivé uniquement pour l'hôte de prévisualisation.
- **Intégrations** : Mobile Money (Orange Money, Wave, MTN MoMo, Moov, Free) et SMS
  sont **simulées** derrière une couche d'adaptateurs — brancher un vrai agrégateur
  (ex. CinetPay, Hub2, Orange API) consiste à remplacer `server/src/lib/integrations`.

### Cloisonnement des données famille/élève

`server/src/middleware/auth.js` distingue le personnel des rôles « famille »
(`parent`, `eleve`) :

- `familyScope(req)` → `null` pour le personnel, sinon la liste des identifiants
  d'élèves autorisés (élève : son propre dossier ; parent : tous ses enfants).
- `scopedStudentIds(req, idDemande)` → filtre de liste ; un `student_id` hors
  famille renvoie un résultat vide plutôt qu'une erreur (pas de fuite d'existence).
- `assertFamilyAccess(req, id)` → 403 sur les accès directs.
- `requireStaff` → bloque les écrans administratifs (synthèses, impayés, paie,
  résultats de classe, campagnes SMS, annuaire du personnel…).

Cette couche est appliquée dans **toutes** les routes `students`, `academics`,
`finance`, `people`, `comms`, `dashboard` et vérifiée par une matrice de tests
(3 rôles × 23 endpoints sensibles).

---

## 3. Modules livrés

| Domaine | Fonctionnalités |
| --- | --- |
| Pilotage | Tableaux de bord direction / enseignant / comptable / parent / élève, KPI, tendances, alertes, tâches |
| Scolarité | Dossiers élèves, inscriptions/candidatures, fratrie, tuteurs, documents administratifs, recherche globale, export CSV |
| Pédagogie | Appel des présences (saisie clavier, hors-ligne), notes & moyennes pondérées, bulletins A4 imprimables, conseils de classe, emploi du temps avec détection de conflits, cahier de textes, devoirs |
| Vie scolaire | Absences/retards + justification parentale, discipline (incidents, sanctions), activités |
| Finances | Types de frais, facturation en masse, échéancier, encaissements Mobile Money (initier → confirmer), reçu imprimable, relances SMS chiffrées en FCFA, dépenses, journal de caisse, trésorerie |
| RH | Personnel, contrats, congés, paie (IPRES 5,6 %, impôt 12 % au-delà de 300 000 F), bulletins de salaire |
| Services | Bibliothèque (prêts/retours), cantine, transport, infirmerie |
| Communication | Annonces, notifications, campagnes SMS avec estimation du coût, calendrier (mois/liste/année scolaire) |
| Portails | Espace parent (multi-enfants, paiement, justification d'absence) et espace élève (notes, bulletins, emploi du temps, devoirs) |
| Paramètres | Établissement, barème de mentions, horaires, modules activés, niveaux/classes/matières, comptes & droits, abonnement, journal d'audit, sauvegardes, export JSON complet |

### Abonnements

| Plan | Prix | Élèves | Positionnement |
| --- | --- | --- | --- |
| Essentiel | 15 000 F/mois | 150 | démarrer la digitalisation |
| Pro | 35 000 F/mois | 600 | piloter pédagogie + finances |
| Élite | 75 000 F/mois | illimité | réseaux d'établissements |

---

## 4. Performance & expérience utilisateur

**Performance** (mesurée sur une machine modeste, données de démo) :

- Zéro framework front, zéro build : l'application démarre avec ~40 Ko de JS par vue.
- Icônes SVG inline (162) : aucune requête de police d'icônes ni CDN.
- Cache HTTP + service worker : le shell est instantané, les listes sont servies
  depuis le cache en réseau-d'abord avec repli hors-ligne.
- Requêtes SQL indexées, pagination serveur, `facets`/`stats` renvoyés avec la liste
  (un seul aller-retour au lieu de trois).
- Rendus différés (`debounce`), squelettes de chargement, tableaux denses.

**UX** :

- Palette de commandes `Ctrl+K` (navigation, élèves, classes, actions).
- Thème clair/sombre/auto, densité compacte/confortable/spacieuse, sidebar repliable
  — appliqués **avant** le premier rendu (aucun clignotement).
- Navigation adaptée au rôle + barre de navigation basse sur mobile.
- Appel des présences au clavier (`1`–`4`, `Entrée`, `↑`/`↓`, `Home`/`End`, `P`,
  `Ctrl+S`) et saisie de notes au clavier.
- Bannière hors-ligne + file d'attente de synchronisation rejouée au retour du réseau.
- États vides explicites, toasts, confirmations dangereuses, erreurs de formulaire
  renvoyées champ par champ, piège à focus, `aria-live`, contrastes AA.
- Impression A4 soignée : bulletins, reçus, listes d'appel, emplois du temps.

---

## 5. API (extraits)

Toutes les réponses de liste suivent `{ data, meta:{page,size,total,pages} }`
(+ `facets`, `stats` selon la route). Les montants sont des **entiers en XOF**.
Ajoutez `?format=csv` sur les listes pour un export CSV (`;`, BOM UTF-8).

```
POST /api/auth/login                       { email, password } → { token, user }
GET  /api/dashboard/summary                KPI direction
GET  /api/students?classe_id=&q=&page=     liste paginée + facettes
GET  /api/students/:id                     dossier complet (famille, notes, finances…)
POST /api/academics/attendance/:sessionId/records   appel (utilisable hors-ligne)
GET  /api/academics/report-cards/student/:id        bulletin + statistiques de classe
POST /api/finance/payments/mobile-money/initiate    demande de paiement
POST /api/finance/payments/mobile-money/:id/confirm confirmation opérateur
GET  /api/finance/providers                opérateurs Mobile Money disponibles
POST /api/comms/sms                        campagne SMS → { queued, segments, cost_estimate }
GET  /api/settings/audit                   journal d'audit filtrable
GET  /api/settings/export                  export JSON complet (réversibilité)
```

---

## 6. Scripts

| Commande | Effet |
| --- | --- |
| `npm start` | serveur de production (API + SPA) |
| `npm run dev` | serveur avec rechargement (`--watch`) |
| `npm run seed` | peuple la base sans la recréer |
| `npm run seed:fresh` | recrée la base puis la peuple |
| `npm run reset` | supprime la base |
| `npm run backup` | copie de sauvegarde horodatée |
| `npm test` | tests unitaires (calculs de moyennes, paie, barèmes) |
| `npm run smoke` | batterie de requêtes HTTP de bout en bout |

---

## 7. Déploiement

Le projet tourne partout où Node 22+ est disponible :

```bash
NODE_ENV=production node server/src/index.js
```

Recommandations : process manager (systemd/pm2), sauvegarde quotidienne du fichier
`server/data/*.sqlite`, reverse proxy TLS (Caddy/nginx), `JWT_SECRET` et
`config.security.frameAncestors` renseignés via l'environnement.

---

## 8. Feuille de route

- [ ] Adaptateurs Mobile Money réels (CinetPay, Hub2, Orange Money API)
- [ ] Agrégateur SMS (Sonatel, Orange, Twilio) avec statuts de livraison
- [ ] Synchronisation multi-appareils hors-ligne (résolution de conflits)
- [ ] Application Android embarquée (WebView + base locale)
- [ ] Facturation électronique conforme aux exigences fiscales locales

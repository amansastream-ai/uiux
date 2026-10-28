# ChronoRH — SaaS de pointage & paie en FCFA

Plateforme complète de **gestion du temps et de la paie** pour tablette : pointage par
**empreinte digitale** ou **badge QR**, calcul automatique des **heures travaillées**,
des **majorations** (nuit, dimanche/jour férié, heures supplémentaires) et de la
**masse salariale en francs CFA**.

---

## ✨ Fonctionnalités

### 🖥️ Borne de pointage (tablette)
- Scan du **badge QR** (caméra, douchette USB, ou saisie manuelle)
- **Empreinte digitale** (capteur biométrique — simulation fournie)
- Mode kiosque plein écran : horloge géante, feedback visuel, journal en direct
- Anti double-scan (60 s), badges désactivés refusés

### 👥 Quatre comptes, quatre métiers

| Rôle | Accès |
|---|---|
| 👑 **Administrateur** | Tout : utilisateurs, règles de paie, paramètres, journal d'audit |
| 🧑‍💼 **DRH** | Employés, badges QR & empreintes, départements, pointages, rapports |
| 💰 **Comptable** | Paie, bulletins, validations, paiements (Wave, virement…), export CSV |
| ⏱️ **Pointeur** | Borne tablette, saisie/correction des pointages, registre du jour |

La page d’accès propose la connexion et la création d’un compte entreprise avec
choix parmi ces quatre rôles. Les boutons **Autre compte** et **Sortir** restent
accessibles dans l’application et sur la borne kiosque ; les quatre comptes de
démonstration sont conservés.

### ⚖️ Moteur de paie (convention appliquée)

| Règle | Majoration |
|---|---|
| Travail de nuit (**22h → 5h**) | **+60 %** |
| Travail le **dimanche** ou un **jour férié** | **+60 %** sur toutes les heures |
| **Dimanche/férié de nuit** (22h → 5h) | **+100 %** |
| Heures au-delà du seuil individuel (**40 ou 56 h/semaine**) : 8 premières heures, payables seulement si le total mensuel dépasse **160 ou 224 h** | **+15 %** |
| Le reste des heures supplémentaires payables | **+40 %** |
| **40 h.sup./mois** maximum à +15 %, le reste | **+40 %** |
| Journée ≥ **10 h** ou comportant des heures de nuit | **panier compté** (1, 2, 3…) — jamais converti en FCFA |
| Chaque **jour férié** non travaillé | payé **8 h** |

- Chaque employé a une référence configurable de **40 h/semaine (160 h/mois)** ou **56 h/semaine (224 h/mois)**; la base horaire des primes suit cette référence. Le dépassement hebdomadaire détermine les h.sup. candidates, mais les h.sup. payées sont limitées à l’excédent mensuel au-delà de **160/224 h** : aucune h.sup. n’est payée si le total mensuel est inférieur ou égal à la référence, même si une semaine isolée la dépasse.
- Les taux restent inchangés : h.sup. **+15 % / +40 %**, nuit **+60 %**, dimanche/férié **+60 %**, nuit fériée **+100 %**. Le quota mensuel des premières heures supplémentaires est de **40 h à +15 %**.
- Cotisations salariales par défaut : **IPRES 5,6 %** + **CSS 5 %** (configurables)
- Les taux restent **paramétrables** dans *Paramètres → Règles de paie* avec un **simulateur** ; la référence hebdomadaire se règle dans la fiche employé.

### 📊 Modules
- **Tableau de bord** temps réel (présents, absents, derniers pointages)
- **Employés** : fiche complète, **badge QR téléchargeable (PNG/SVG)** généré à la création,
  imprimable pour la carte de l'employé, enrôlement d'empreinte
- **Pointages** : registre par jour, ajouts/suppressions tracés
- **Paie** : aperçu ligne par ligne, détail des primes, **bulletin imprimable**,
  génération/validation des bordereaux, enregistrement des paiements
- **Rapports** : heures par employé, répartition nuit/férié/h.sup., export CSV
- **Audit** : toutes les actions sensibles sont journalisées

---

## 🚀 Démarrage

```bash
npm install
npm start          # → http://localhost:3000
npm test           # règles de paie, seeds/migrations, QR scannables et serverless Vercel
```

Node.js ≥ 22 requis (SQLite natif `node:sqlite`, aucune compilation).

### Comptes de démonstration

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@sahelservices.sn` | `demo2026` |
| DRH | `drh@sahelservices.sn` | `demo2026` |
| Comptable | `compta@sahelservices.sn` | `demo2026` |
| Pointeur | `pointage@sahelservices.sn` | `demo2026` |

Le jeu de démonstration contient **12 employés** (EMP-001 à EMP-008 : 40 h/semaine ; EMP-009 à EMP-012 : 56 h/semaine),
les pointages de **septembre & octobre 2026**, les **jours fériés du Sénégal**,
et un bordereau de paie de septembre validé avec paiements (Wave, virement).

---

## 📱 Installation sur tablette

1. Ouvrir l'application dans le navigateur de la tablette
2. Se connecter avec le compte *Pointeur*
3. Ouvrir **« Borne tablette »** (ou `#/borne`) et passer en plein écran (mode kiosque)
4. Pour le QR : autoriser la caméra, brancher une douchette USB (mode saisie),
   ou imprimer les badges depuis *Employés → Badge QR → Imprimer*
5. Pour l'empreinte : connecter un capteur biométrique USB et enrôler les employés
   depuis leur fiche (le mode simulation permet de tester le parcours complet)

## ☁️ Déploiement sur Vercel

Le dépôt est prêt pour un déploiement direct sur **Vercel** (aucune configuration manuelle requise) :

1. Importer le dépôt sur Vercel et sélectionner la branche `application-drh`
2. Laisser les paramètres par défaut (Node.js ≥ 22, `vercel.json` détecté automatiquement)
3. Cliquer sur **Deploy** :
   - Les fichiers statiques (`public/`) sont servis par le CDN Vercel
   - L'API Express (`/api/*`) est exécutée par la fonction serverless `api/index.js`
   - La base SQLite de démonstration est initialisée automatiquement dans `/tmp/chronorh/chronorh.db` (transaction atomique)
   - Les sessions HMAC embarquent l’identité (id, nom, e-mail, rôle, expiration) et survivent aux démarrages à froid ou bascules d'instance
   - Contrôle de santé : `GET /api/health`

## 🏗️ Architecture

```
api/
  index.js      Point d'entrée Serverless Function (Vercel)
server/
  index.js      Serveur Express (API + SPA)
  db.js         SQLite (node:sqlite) — schéma & données de démo (compatible /tmp)
  api.js        API REST (auth, employés, pointages, paie, rapports…)
  payroll.js    Moteur de calcul : majorations, h.sup., paniers, fériés
  auth.js       Sessions signées HMAC + SQLite, rôles, journal d'audit
public/
  css/          Design system (tokens + composants)
  js/views/     Vues SPA : dashboard, employés, pointages, borne, paie…
tests/
  payroll.test.js   19 tests des règles de paie (node:test)
  qr.test.js        3 tests de génération/décodage QR
  vercel.test.js    6 tests de compatibilité et migrations Vercel/API
vercel.json     Routage Vercel (/api/* → fonction serverless, SPA fallback)
```

La devise est le **FCFA (XOF)** partout : salaires, paniers, bulletins, exports.

📖 Voir `docs/regles-de-paie.md` pour le détail du calcul avec exemples chiffrés.

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
| ⏱️ **Gestion pointage** | Borne tablette, saisie/correction des pointages, registre du jour |

### ⚖️ Moteur de paie (convention appliquée)

| Règle | Majoration |
|---|---|
| Travail de nuit (**22h → 5h**) | **+60 %** |
| Travail le **dimanche** ou un **jour férié** | **+60 %** sur toutes les heures |
| **Dimanche/férié de nuit** (22h → 5h) | **+100 %** |
| Au-delà de **40 h/semaine** : 8 premières heures supplémentaires | **+15 %** |
| Le reste des heures supplémentaires | **+40 %** |
| **32 h.sup./mois** maximum à +15 % (4 semaines × 8 h), le reste | **+40 %** |
| Journée ≥ **10 h** ou comportant des heures de nuit | **panier compté** (1, 2, 3…) — jamais converti en FCFA |
| Chaque **jour férié** non travaillé | payé **8 h** |

- Taux horaire = salaire mensuel ÷ **173,33 h** (40 h × 52 ÷ 12)
- Cotisations salariales par défaut : **IPRES 5,6 %** + **CSS 5 %** (configurables)
- Toutes les valeurs sont **paramétrables** dans *Paramètres → Règles de paie*,
  avec un **simulateur** en temps réel.

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
npm test           # 19 tests : règles de paie + QR scannables
```

Node.js ≥ 22 requis (SQLite natif `node:sqlite`, aucune compilation).

### Comptes de démonstration

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Administrateur | `admin@sahelservices.sn` | `demo2026` |
| DRH | `drh@sahelservices.sn` | `demo2026` |
| Comptable | `compta@sahelservices.sn` | `demo2026` |
| Gestion pointage | `pointage@sahelservices.sn` | `demo2026` |

Le jeu de démonstration contient **12 employés** (jour, nuit, rotation 7j/7),
les pointages de **septembre & octobre 2026**, les **jours fériés du Sénégal**,
et un bordereau de paie de septembre validé avec paiements (Wave, virement).

---

## 📱 Installation sur tablette

1. Ouvrir l'application dans le navigateur de la tablette
2. Se connecter avec le compte *Gestion pointage*
3. Ouvrir **« Borne tablette »** (ou `#/borne`) et passer en plein écran (mode kiosque)
4. Pour le QR : autoriser la caméra, brancher une douchette USB (mode saisie),
   ou imprimer les badges depuis *Employés → Badge QR → Imprimer*
5. Pour l'empreinte : connecter un capteur biométrique USB et enrôler les employés
   depuis leur fiche (le mode simulation permet de tester le parcours complet)

## 🏗️ Architecture

```
server/
  index.js      Serveur Express (API + SPA)
  db.js         SQLite (node:sqlite) — schéma & données de démo
  api.js        API REST (auth, employés, pointages, paie, rapports…)
  payroll.js    Moteur de calcul : majorations, h.sup., paniers, fériés
  auth.js       Sessions, rôles, journal d'audit
public/
  css/          Design system (tokens + composants)
  js/views/     Vues SPA : dashboard, employés, pointages, borne, paie…
tests/
  payroll.test.js   16 tests des règles de paie (node:test)
```

La devise est le **FCFA (XOF)** partout : salaires, paniers, bulletins, exports.

📖 Voir `docs/regles-de-paie.md` pour le détail du calcul avec exemples chiffrés.

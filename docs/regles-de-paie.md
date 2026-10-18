# ChronoRH — Règles de paie détaillées

Toutes les valeurs ci-dessous sont **paramétrables** (admin → *Paramètres → Règles de paie*).

## 1. Base de calcul

- **Taux horaire** = salaire mensuel ÷ **173,33 h** (40 h × 52 semaines ÷ 12 mois)
- Les pointages (QR / empreinte / manuel) sont appariés en sessions `entrée → sortie`
- Chaque minute d'une session est classée dans un seau exclusif :
  - **jour ordinaire**
  - **nuit** (22h00 → 05h00)
  - **dimanche / jour férié**
  - **dimanche / jour férié de nuit** (22h00 → 05h00)
- Les heures supplémentaires s'ajoutent par-dessus (cumul des majorations).

## 2. Majorations (exemples avec un taux horaire de 1 500 FCFA)

| Cas | Majoration | Valeur de l'heure | Pour 8 h |
|---|---|---|---|
| Jour ordinaire | — | 1 500 | 12 000 |
| Nuit (22h→5h) | +60 % | 2 400 | 19 200 |
| Dimanche ou férié | +60 % | 2 400 | 19 200 |
| Nuit du dimanche / férié | +100 % | 3 000 | 24 000 |

> Une heure de nuit du dimanche remplace les deux primes (60 % + 60 %) par une
> prime unique de **100 %**, conformément à la convention.

## 3. Heures supplémentaires

1. **Seuil hebdomadaire** : au-delà de **40 h dans la semaine** (lundi → dimanche)
   - les **8 premières heures supplémentaires** → **+15 %**
   - **le reste** → **+40 %**
2. **Quota mensuel** : au plus **32 heures supplémentaires par mois** peuvent
   bénéficier du taux de 15 % (= 4 semaines × 8 h). Toute heure supplémentaire
   au-delà → **+40 %**.

**Cumul** : une heure supplémentaire de nuit, par exemple, touche
`+60 % (nuit) + 40 % (h.sup.) = +100 %` → payée **×2**.

## 4. Panier repas (compteur)

Un panier est dû pour une journée qui :
- atteint **10 heures de travail** ou plus, **OU**
- comporte la moindre **heure de nuit** (22h → 5h).

Maximum : **1 panier par jour**. Le panier est un **simple compteur**
(1, 2, 3…) affiché sur le bulletin et dans les rapports : il n'est **jamais
converti en francs CFA** et n'entre pas dans le brut.

## 5. Jours fériés

- Chaque jour férié **non travaillé** est payé **8 heures** au taux normal.
- Un jour férié **travaillé** : les heures effectives sont majorées
  **+60 %** (jour) ou **+100 %** (nuit 22h→5h), **sans** crédit supplémentaire
  de 8 h (pas de double paiement).
- La liste des fériés (Sénégal) est modifiable ; les dates religieuses sont
  fournies à titre indicatif (observation lunaire).

## 6. Cotisations salariales (par défaut)

| Cotisation | Taux salarié | Base |
|---|---|---|
| IPRES retraite | 5,6 % | brut |
| CSS couverture sociale | 5 % | brut |

**Net à payer = brut − cotisations.**

## 7. Exemple complet

*Employé de nuit, salaire 275 000 FCFA (taux horaire ≈ 1 586 FCFA),
semaine avec 45 h dont 30 h de nuit, sur un mois avec 3 dimanches travaillés :*

1. 5 h supplémentaires dans la semaine → 5 h à **+15 %** (dans les 8 premières)
2. Les 30 h de nuit → **+60 %**
3. Les 3 dimanches (24 h) → **+60 %**, dont les heures après 22h → **+100 %**
4. Paniers : chaque journée de nuit → 1 panier
5. Le férié non travaillé du mois → **+8 h payées**
6. Brut → moins IPRES 5,6 % et CSS 5 % → **net à payer**

Le détail ligne par ligne apparaît sur chaque **bulletin de paie** généré par
ChronoRH (module *Paie → Bulletin*).

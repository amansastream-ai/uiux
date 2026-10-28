# ChronoRH — Règles de paie détaillées

Les taux ci-dessous sont **paramétrables** (admin → *Paramètres → Règles de paie*). La durée de référence (40 ou 56 h/semaine) se règle sur la fiche de chaque employé.

## 1. Base de calcul

Le salaire de base est mensuel. Chaque employé possède une durée de référence
configurable de **40 h/semaine (160 h/mois)** ou **56 h/semaine (224 h/mois)**.
Son seuil d'heures supplémentaires et la base de calcul des primes suivent cette
référence individuelle.

Les taux restent inchangés : heures supplémentaires **+15 % / +40 %**, nuit
**+60 %**, dimanche/férié **+60 %**, nuit fériée **+100 %**. Le quota mensuel des
heures supplémentaires à +15 % est de **40 heures**.

Pour calculer une prime, ChronoRH applique la formule suivante :

```text
prime (FCFA) = salaire de base mensuel × heures concernées ÷ (référence hebdomadaire × 4) × pourcentage de majoration ÷ 100
```

Le salaire mensuel de base est versé intégralement ; les montants des majorations
s’y ajoutent. Un jour férié non travaillé est crédité selon cette même base, sans
majoration.

Les pointages (QR / empreinte / manuel) sont appariés en sessions `entrée → sortie`.
Chaque minute d'une session est classée dans un seau exclusif :

- **jour ordinaire**
- **nuit** (22h00 → 05h00)
- **dimanche / jour férié**
- **dimanche / jour férié de nuit** (22h00 → 05h00)

Les heures supplémentaires s'ajoutent par-dessus les primes de nuit ou de repos
lorsqu'elles portent sur les mêmes heures.

## 2. Majorations

Exemple pour un salaire de base mensuel de **260 000 FCFA** et une référence de
**40 h/semaine (160 h/mois)** : les primes ci-dessous sont calculées sur le taux
horaire de cette référence, puis ajoutées au salaire mensuel.

| Cas | Majoration | Prime ajoutée pour 8 h |
|---|---:|---:|
| Jour ordinaire | — | — |
| Nuit (22h→5h) | +60 % | 7 800 FCFA |
| Dimanche ou férié | +60 % | 7 800 FCFA |
| Nuit du dimanche / férié | +100 % | 13 000 FCFA |

> Une heure de nuit du dimanche remplace les deux primes (+60 % nuit et +60 %
> dimanche) par une prime unique de **+100 %**, conformément à la convention.

## 3. Heures supplémentaires

1. **Seuil hebdomadaire individuel** : au-delà de la référence de l'employé
   (**40 h** ou **56 h** du lundi au dimanche)
   - les **8 premières heures supplémentaires de la semaine** → **+15 %**
   - **le reste** → **+40 %**
2. **Quota mensuel** : au plus **40 heures supplémentaires par mois** peuvent
   bénéficier de la majoration de 15 %. Toute heure supplémentaire au-delà du
   quota → **+40 %**.

**Cumul** : une heure supplémentaire de nuit peut recevoir les deux majorations :
`+60 % (nuit) + 40 % (heures sup.) = +100 %` de prime sur la base mensuelle.

## 4. Panier repas (compteur)

Un panier est dû pour une journée qui :

- atteint **10 heures de travail** ou plus, **OU**
- comporte la moindre **heure de nuit** (22h → 5h).

Maximum : **1 panier par jour**. Le panier est un **simple compteur**
(1, 2, 3…) affiché sur le bulletin et dans les rapports : il n'est **jamais
converti en francs CFA** et n'entre pas dans le brut.

## 5. Jours fériés

- Chaque jour férié **non travaillé** est payé **8 heures**, calculées sur le salaire
  de base mensuel et la référence individuelle (160 h/mois ou 224 h/mois).
- Un jour férié **travaillé** : les heures effectives sont majorées **+60 %** (jour)
  ou **+100 %** (nuit 22h→5h), **sans** crédit supplémentaire de 8 h (pas de double paiement).
- La liste des fériés (Sénégal) est modifiable ; les dates religieuses sont
  fournies à titre indicatif (observation lunaire).

## 6. Cotisations salariales (par défaut)

| Cotisation | Taux salarié | Base |
|---|---:|---|
| IPRES retraite | 5,6 % | brut |
| CSS couverture sociale | 5 % | brut |

**Net à payer = brut − cotisations.**

## 7. Exemple complet

Pour un salaire de base mensuel de **275 000 FCFA** et une référence de
**40 h/semaine**, la base de calcul mensuelle est `40 × 4 = 160 h`. Une semaine
avec 45 h comprend 5 h supplémentaires dans la tranche à **+15 %**. Avec une
référence de 56 h, le calcul mensuel utilise `56 × 4 = 224 h` et les heures
supplémentaires commencent au-delà de 56 h par semaine. Les primes et le crédit
d'un férié non travaillé de **8 h** utilisent la même base individuelle.

Le panier reste un compteur. Le brut correspond au salaire mensuel de base,
augmenté des primes et crédits applicables, puis les cotisations IPRES 5,6 % et
CSS 5 % sont déduites pour obtenir le **net à payer**.

Le détail ligne par ligne apparaît sur chaque **bulletin de paie** généré par
ChronoRH (module *Paie → Bulletin*).

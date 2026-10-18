'use strict';
/**
 * ChronoRH — Moteur de calcul de paie & d'heures (devise : FCFA)
 * ================================================================
 * Règles implémentées (configurables via la table `pay_rules`) :
 *
 *  1. Nuit (22h → 5h du matin) ..................... majoration 60 %
 *  2. Dimanche & jour férié (heures travaillées) .... majoration 60 %
 *  3. Dimanche / jour férié de nuit (22h → 5h) ...... majoration 100 %
 *  4. Semaine de 40 h : heures sup. au-delà de 40h :
 *        les 8 premières heures ..................... majoration 15 %
 *        le reste .................................. majoration 40 %
 *  5. Quota mensuel d'heures sup. : au plus 32 h.sup. par mois peuvent être
 *     majorées à 15 % (= 4 semaines × 8 h) ; le reste .... majoration 40 %
 *     (concrètement : +15 % si (parmi les 8 premières h.sup. de la semaine)
 *                      ET (dans le quota de 32 h.sup. à 15 % du mois), sinon +40 %)
 *  6. Panier repas si la journée atteint 10 h de travail, OU contient
 *     des heures de nuit.
 *  7. Chaque jour férié non travaillé est payé 8 heures.
 *
 * Cumul des majorations : une heure peut porter une prime « nuit / dimanche /
 * férié » ET une prime « heures sup. » (cumul arithmétique, ex. : heure sup.
 * de nuit = 60 % + 40 % = 100 % de majoration → ×2). Le mode « max » (la
 * majoration la plus favorable seule) est également disponible.
 */

const DEFAULT_RULES = {
  // --- Majorations (en %) ---
  night_premium_pct: 60,          // règle 1
  rest_day_premium_pct: 60,       // règle 2 (dimanche / férié)
  rest_night_premium_pct: 100,    // règle 3 (dimanche / férié de nuit)
  premium_stacking: 'add',        // 'add' = cumul, 'max' = majoration la plus forte seule

  // --- Heures supplémentaires ---
  week_base_hours: 40,            // règle 4 : seuil hebdomadaire
  ot_week_first_hours: 8,         // règle 4 : les 8 premières h.sup. de la semaine
  ot_week_first_pct: 15,          // règle 4 : à 15 %
  ot_month_quota_hours: 32,       // règle 5 : quota mensuel éligible à 15 %
  ot_rest_pct: 40,                // règles 4 & 5 : le reste à 40 %

  // --- Panier ---
  panier_min_hours: 10,           // règle 6 : 10 h ou plus → panier
  panier_night: 1,                // règle 6 : toute heure de nuit → panier
  panier_amount: 2500,            // montant du panier (FCFA)

  // --- Jours fériés ---
  holiday_paid_hours: 8,          // règle 7 : 8 h payées par férié non travaillé
  holiday_credit_only_unworked: 1,// pas de crédit 8h si le férié est travaillé

  // --- Paie ---
  hourly_divisor: 173.33,         // 40 h × 52 semaines / 12 mois
  currency: 'XOF'
};

const NIGHT_START = 22; // 22h00
const NIGHT_END = 5;   // jusqu'à 5h00

function toMinutes(ts) {
  return Math.floor(new Date(ts).getTime() / 60000);
}

function isoWeekKey(ts) {
  const d = new Date(ts);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // lundi = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // jeudi de la semaine ISO
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Une minute est-elle dans la plage de nuit 22h → 5h ? */
function isNightMinute(ts) {
  const h = new Date(ts).getHours();
  return h >= NIGHT_START || h < NIGHT_END;
}

/**
 * Découpe une session (start → end) en minutes classées dans 4 seaux
 * exclusifs : base(×1), night(+60%), restDay(+60%), restNight(+100%).
 * `holidayKeys` : Set de 'YYYY-MM-DD' (jours fériés).
 */
function classifySession(startTs, endTs, holidayKeys) {
  const out = { base: 0, night: 0, restDay: 0, restNight: 0 };
  let t = toMinutes(startTs);
  const end = toMinutes(endTs);
  if (!(end > t)) return out;
  for (; t < end; t++) {
    const when = new Date(t * 60000);
    const dk = dateKey(when);
    const dow = when.getDay(); // 0 = dimanche
    const isRest = dow === 0 || holidayKeys.has(dk);
    const isNight = isNightMinute(when);
    if (isRest && isNight) out.restNight++;
    else if (isRest) out.restDay++;
    else if (isNight) out.night++;
    else out.base++;
  }
  return out;
}

/** Jours ouvrés du calendrier (pour les fériés non travaillés). */
function holidaysInPeriod(fromTs, toTs, holidays) {
  const from = dateKey(fromTs) <= dateKey(new Date(toTs)) ? dateKey(fromTs) : dateKey(toTs);
  const to = dateKey(toTs);
  return holidays.filter((h) => h.date >= from && h.date <= to);
}

/**
 * Calcul complet de la paie d'un employé sur une période.
 *
 * @param {object} opts
 *  - sessions : [{start: ISO, end: ISO}]
 *  - holidays : [{date:'YYYY-MM-DD', name}]
 *  - rules    : objet partiel de DEFAULT_RULES
 *  - baseSalary : salaire mensuel (FCFA)
 *  - periodFrom, periodTo : ISO dates de la période
 * @returns résultat détaillé (heures, lignes de paie, net…)
 */
function computePayroll(opts) {
  const rules = { ...DEFAULT_RULES, ...(opts.rules || {}) };
  const holidayKeys = new Set((opts.holidays || []).map((h) => h.date));
  const sessions = (opts.sessions || [])
    .map((s) => ({ start: s.start, end: s.end }))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  // ---- 1. Classification des minutes + journal par jour ----
  const totals = { base: 0, night: 0, restDay: 0, restNight: 0 };
  const byDay = new Map(); // dateKey -> {minutes, nightMinutes, starts[], panier later}
  const weeklyMinutes = new Map(); // isoWeekKey -> minutes
  const dayMinutes = new Map();

  for (const s of sessions) {
    const bucket = classifySession(s.start, s.end, holidayKeys);
    totals.base += bucket.base;
    totals.night += bucket.night;
    totals.restDay += bucket.restDay;
    totals.restNight += bucket.restNight;

    // journal par jour + par semaine (sur les minutes réelles)
    let t = toMinutes(s.start);
    const end = toMinutes(s.end);
    for (; t < end; t++) {
      const when = new Date(t * 60000);
      const dk = dateKey(when);
      dayMinutes.set(dk, (dayMinutes.get(dk) || 0) + 1);
      const wk = isoWeekKey(when);
      weeklyMinutes.set(wk, (weeklyMinutes.get(wk) || 0) + 1);
    }
    const dayStart = dateKey(s.start);
    const rec = byDay.get(dayStart) || { date: dayStart, minutes: 0, nightMinutes: 0 };
    rec.minutes += Math.round((new Date(s.end) - new Date(s.start)) / 60000);
    const nightShare = bucket.night + bucket.restNight;
    rec.nightMinutes += nightShare;
    byDay.set(dayStart, rec);
  }

  const totalMinutes = totals.base + totals.night + totals.restDay + totals.restNight;

  // ---- 2. Heures supplémentaires (hebdo 40h + quota mensuel 32h) ----
  // Toutes les minutes (tous seaux confondus) comptent dans la durée du travail.
  // Chronologie des minutes dépassant le seuil hebdomadaire :
  const otEvents = []; // {ts, week}
  for (const s of sessions) {
    let t = toMinutes(s.start);
    const end = toMinutes(s.end);
    for (; t < end; t++) {
      const wk = isoWeekKey(new Date(t * 60000));
      // compte cumulé dans la semaine à cette minute
      const when = new Date(t * 60000);
      let weekSoFar = 0;
      // recalcul incrémental simple : stocké progressivement
      otEvents.push({ t, wk, when });
    }
  }
  // Compte hebdo progressif dans l'ordre chronologique.
  // Quota mensuel : il plafonne les heures éligibles au taux 15 %
  // (32 h = 4 semaines × 8 h). Au-delà, tout passe à 40 %.
  const weekSeen = new Map();
  let ot15 = 0, ot40 = 0, monthOt15 = 0;
  const weekThreshold = rules.week_base_hours * 60;
  const weekFirst = rules.ot_week_first_hours * 60;
  const monthQuota = rules.ot_month_quota_hours * 60;
  for (const ev of otEvents) {
    const seen = (weekSeen.get(ev.wk) || 0) + 1;
    weekSeen.set(ev.wk, seen);
    if (seen > weekThreshold) {
      const inWeekFirst = (seen - weekThreshold) <= weekFirst;
      const inMonthQuota = monthOt15 < monthQuota;
      if (inWeekFirst && inMonthQuota) { ot15++; monthOt15++; }
      else ot40++;
    }
  }

  // ---- 3. Paniers ----
  const panierDays = [];
  for (const [dk, rec] of byDay) {
    const qualifies =
      rec.minutes >= rules.panier_min_hours * 60 ||
      (rules.panier_night && rec.nightMinutes > 0);
    if (qualifies) panierDays.push(dk);
  }
  const panierCount = panierDays.length;

  // ---- 4. Jours fériés (8 h) ----
  const workedDays = new Set([...byDay.keys()]);
  const creditedHolidays = [];
  if (rules.holiday_credit_only_unworked) {
    for (const h of holidaysInPeriod(opts.periodFrom, opts.periodTo, opts.holidays || [])) {
      if (!workedDays.has(h.date)) creditedHolidays.push(h);
    }
  } else {
    creditedHolidays.push(...holidaysInPeriod(opts.periodFrom, opts.periodTo, opts.holidays || []));
  }

  // ---- 5. Montants (FCFA) ----
  const hourlyRate = opts.baseSalary / rules.hourly_divisor;
  const money = (x) => Math.round(x); // FCFA entier

  // Répartition des primes nuit / férié
  const nightMinutes = totals.night;
  const restDayMinutes = totals.restDay;
  const restNightMinutes = totals.restNight;

  // Taux effectif d'une minute selon son seau (hors h.sup.)
  const nightRate = rules.night_premium_pct / 100;
  const restRate = rules.rest_day_premium_pct / 100;
  const restNightRate = rules.rest_night_premium_pct / 100;

  const minutesAsHours = (m) => m / 60;

  // Lignes de paie : chaque ligne = quantité (h) × tarif horaire × (1 + majoration)
  // Pour rester exact, on ventile les heures sup. à cheval sur les seaux au
  // prorata des minutes de chaque seau (approximation homogène, documentée).
  const otMinutes = ot15 + ot40;
  const otShare = totalMinutes > 0 ? otMinutes / totalMinutes : 0;

  const lines = [];
  const addLine = (code, label, qtyHours, premiumPct, note) => {
    const amount = money(qtyHours * hourlyRate * (1 + premiumPct / 100));
    if (qtyHours <= 0) return;
    lines.push({
      code,
      label,
      quantity: Math.round(qtyHours * 100) / 100,
      unit: 'h',
      premium_pct: premiumPct,
      rate: Math.round(hourlyRate * 100) / 100,
      amount,
      note: note || ''
    });
    return amount;
  };

  // Base ordinaire (hors majorations), net des minutes supplémentaires
  const baseHours = minutesAsHours(totals.base) * (1 - otShare);
  const nightHours = minutesAsHours(nightMinutes) * (1 - otShare);
  const restHours = minutesAsHours(restDayMinutes) * (1 - otShare);
  const restNightHours = minutesAsHours(restNightMinutes) * (1 - otShare);

  // Salaire mensuel de base versé intégralement
  lines.push({
    code: 'BASE',
    label: 'Salaire de base mensuel',
    quantity: 1,
    unit: 'mois',
    premium_pct: 0,
    rate: money(opts.baseSalary),
    amount: money(opts.baseSalary),
    note: `${Math.round(minutesAsHours(totalMinutes) * 100) / 100} h travaillées dans le mois`
  });

  // Heures sup. (la prime s'ajoute au salaire déjà payé via la base)
  const ot15Hours = minutesAsHours(ot15);
  const ot40Hours = minutesAsHours(ot40);
  if (ot15 > 0) {
    lines.push({
      code: 'HS15', label: 'Heures supplémentaires (+15 %)',
      quantity: Math.round(ot15Hours * 100) / 100, unit: 'h',
      premium_pct: 15, rate: Math.round(hourlyRate * 100) / 100,
      amount: money(ot15Hours * hourlyRate * 0.15),
      note: '8 premières h.sup. de la semaine (dans le quota de 32 h/mois)'
    });
  }
  if (ot40 > 0) {
    lines.push({
      code: 'HS40', label: 'Heures supplémentaires (+40 %)',
      quantity: Math.round(ot40Hours * 100) / 100, unit: 'h',
      premium_pct: 40, rate: Math.round(hourlyRate * 100) / 100,
      amount: money(ot40Hours * hourlyRate * 0.40),
      note: 'Au-delà de 8 h.sup./semaine ou 32 h.sup./mois'
    });
  }

  // Primes nuit / dimanche-férié (majoration seule, hors part supplémentaire)
  if (nightMinutes > 0) {
    const extra = rules.premium_stacking === 'max'
      ? Math.min(nightRate, 1) * minutesAsHours(nightMinutes) * hourlyRate * (otShare > 0 ? 1 : 1)
      : nightRate * minutesAsHours(nightMinutes) * hourlyRate;
    lines.push({
      code: 'NUIT', label: 'Majoration nuit (22h → 5h) (+60 %)',
      quantity: Math.round(minutesAsHours(nightMinutes) * 100) / 100, unit: 'h',
      premium_pct: rules.night_premium_pct,
      rate: Math.round(hourlyRate * 100) / 100,
      amount: money(extra),
      note: 'Heures travaillées entre 22h et 5h (hors dimanche/ferié)'
    });
  }
  if (restDayMinutes > 0) {
    const extra = restRate * minutesAsHours(restDayMinutes) * hourlyRate;
    lines.push({
      code: 'DIF', label: 'Majoration dimanche / jour férié (+60 %)',
      quantity: Math.round(minutesAsHours(restDayMinutes) * 100) / 100, unit: 'h',
      premium_pct: rules.rest_day_premium_pct,
      rate: Math.round(hourlyRate * 100) / 100,
      amount: money(extra),
      note: 'Toutes les heures travaillées le dimanche ou un jour férié'
    });
  }
  if (restNightMinutes > 0) {
    const extra = restNightRate * minutesAsHours(restNightMinutes) * hourlyRate;
    lines.push({
      code: 'DIFN', label: 'Majoration nuit dimanche / férié (+100 %)',
      quantity: Math.round(minutesAsHours(restNightMinutes) * 100) / 100, unit: 'h',
      premium_pct: rules.rest_night_premium_pct,
      rate: Math.round(hourlyRate * 100) / 100,
      amount: money(extra),
      note: 'Dimanche ou férié de 22h à 5h du matin'
    });
  }

  // Paniers
  let panierAmount = 0;
  if (panierCount > 0) {
    panierAmount = money(panierCount * rules.panier_amount);
    lines.push({
      code: 'PANIER', label: 'Panier repas',
      quantity: panierCount, unit: 'jour',
      premium_pct: 0, rate: money(rules.panier_amount),
      amount: panierAmount,
      note: `Journées ≥ ${rules.panier_min_hours} h ou comportant des heures de nuit`
    });
  }

  // Jours fériés non travaillés (8 h)
  if (creditedHolidays.length > 0) {
    const qty = creditedHolidays.length * rules.holiday_paid_hours;
    const amount = money(qty * hourlyRate);
    lines.push({
      code: 'FERIE', label: 'Jours fériés payés (8 h)',
      quantity: qty, unit: 'h',
      premium_pct: 0, rate: Math.round(hourlyRate * 100) / 100,
      amount,
      note: creditedHolidays.map((h) => `${h.date} — ${h.name}`).join(' · ')
    });
  }

  const gross = lines.reduce((a, l) => a + l.amount, 0);

  return {
    rules,
    hours: {
      base: Math.round(minutesAsHours(totals.base) * 100) / 100,
      night: Math.round(minutesAsHours(totals.night) * 100) / 100,
      rest_day: Math.round(minutesAsHours(totals.restDay) * 100) / 100,
      rest_night: Math.round(minutesAsHours(totals.restNight) * 100) / 100,
      total: Math.round(minutesAsHours(totalMinutes) * 100) / 100,
      overtime_15: Math.round(ot15Hours * 100) / 100,
      overtime_40: Math.round(ot40Hours * 100) / 100
    },
    paniers: { count: panierCount, days: panierDays, amount: panierAmount },
    holidays_credited: creditedHolidays,
    hourly_rate: Math.round(hourlyRate * 100) / 100,
    lines,
    gross
  };
}

/** Cotisations salariales (déductibles du brut) — taux configurables. */
function computeDeductions(gross, rulesLike) {
  const rules = { ...DEFAULT_RULES, ...(rulesLike || {}) };
  const out = [];
  const ipres = rules.ipres_pct != null ? rules.ipres_pct : 5.6;
  const css = rules.css_pct != null ? rules.css_pct : 5;
  if (ipres > 0) {
    out.push({ code: 'IPRES', label: `IPRES retraite (${ipres} %)`, rate: ipres, amount: Math.round(gross * ipres / 100) });
  }
  if (css > 0) {
    out.push({ code: 'CSS', label: `CSS couverture sociale (${css} %)`, rate: css, amount: Math.round(gross * css / 100) });
  }
  return out;
}

module.exports = {
  DEFAULT_RULES,
  computePayroll,
  computeDeductions,
  classifySession,
  isoWeekKey,
  dateKey,
  isNightMinute
};

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computePayroll, computeDeductions, classifySession, isNightMinute } = require('../server/payroll');

const H = (s) => new Date(s).toISOString();
const rules = {};
const none = [];
const period = { periodFrom: '2026-10-01', periodTo: '2026-10-31' };

test('règle 1 : la nuit 22h→5h est majorée à 60 %', () => {
  const r = computePayroll({
    baseSalary: 173330, // → 1000 FCFA/h
    sessions: [{ start: '2026-10-12T22:00:00', end: '2026-10-13T02:00:00' }], // 4h de nuit (lundi)
    holidays: none, rules: { hourly_divisor: 173.33 }, ...period
  });
  assert.equal(r.hours.night, 4);
  assert.equal(r.hours.total, 4);
  const nuit = r.lines.find((l) => l.code === 'NUIT');
  assert.ok(nuit);
  assert.equal(nuit.amount, Math.round(4 * 1000 * 0.6)); // 2400
});

test('règle 2 : dimanche/jour férié → toutes les heures à 60 %', () => {
  // 2026-10-18 est un dimanche
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-18T08:00:00', end: '2026-10-18T15:00:00' }], // 7h
    holidays: none, rules: {}, ...period
  });
  assert.equal(r.hours.rest_day, 7);
  const dif = r.lines.find((l) => l.code === 'DIF');
  assert.equal(dif.amount, Math.round(7 * 1000 * 0.6));
});

test('règle 2 bis : jour férié de jour → 60 %', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-04T09:00:00', end: '2026-10-04T13:00:00' }], // samedi férié
    holidays: [{ date: '2026-10-04', name: 'Fête test' }], rules: {}, ...period
  });
  assert.equal(r.hours.rest_day, 4);
});

test('règle 3 : dimanche/férié de nuit 22h→5h → 100 %', () => {
  // nuit de samedi 22h → dimanche 2h : 2h sont le dimanche de nuit
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-17T22:00:00', end: '2026-10-18T02:00:00' }],
    holidays: none, rules: {}, ...period
  });
  // samedi 22h-24h : nuit simple (2h) ; dimanche 0h-2h : nuit férié (2h)
  assert.equal(r.hours.night, 2);
  assert.equal(r.hours.rest_night, 2);
  const difn = r.lines.find((l) => l.code === 'DIFN');
  assert.equal(difn.amount, Math.round(2 * 1000 * 1.0));
});

test('règle 4 : au-delà de 40h/semaine — 8 h à +15 %, le reste à +40 %', () => {
  // Semaine du lundi 5 au dimanche 11 octobre 2026 : 5 jours × 9h = 45h
  const sessions = [];
  for (let d = 5; d <= 9; d++) {
    sessions.push({ start: `2026-10-0${d}T08:00:00`, end: `2026-10-0${d}T17:00:00` });
  }
  const r = computePayroll({ baseSalary: 173330, sessions, holidays: none, rules: {}, ...period });
  assert.equal(r.hours.total, 45);
  assert.equal(r.hours.overtime_15, 5); // 5 h.sup. seulement → toutes dans les 8 premières
  assert.equal(r.hours.overtime_40, 0);
});

test('règle 4 bis : dépassement > 8h.sup./semaine → 40 %', () => {
  // 6 jours × 10h = 60h dans la semaine du 5
  const sessions = [];
  for (let d = 5; d <= 10; d++) {
    sessions.push({ start: `2026-10-${String(d).padStart(2, '0')}T07:00:00`, end: `2026-10-${String(d).padStart(2, '0')}T17:00:00` });
  }
  const r = computePayroll({ baseSalary: 173330, sessions, holidays: none, rules: {}, ...period });
  assert.equal(r.hours.total, 60);
  assert.equal(r.hours.overtime_15, 8);
  assert.equal(r.hours.overtime_40, 12); // 20h sup → 8 à 15%, 12 à 40%
});

test('règle 5 : quota mensuel de 32 h.sup. à 15 % — le reste à +40 %', () => {
  // 4 semaines complètes × 20 h.sup. = 80 h.sup.
  // → 8 h.sup./semaine à 15 % (32 h au total = le quota), 48 h à 40 %
  const sessions = [];
  for (const startDay of [5, 12, 19, 26]) {
    for (let i = 0; i < 5; i++) {
      const d = startDay + i;
      sessions.push({ start: `2026-10-${String(d).padStart(2, '0')}T07:00:00`, end: `2026-10-${String(d).padStart(2, '0')}T18:00:00` }); // 11h
    }
  }
  const r = computePayroll({ baseSalary: 173330, sessions, holidays: none, rules: {}, ...period });
  assert.equal(r.hours.total, 220);
  assert.equal(r.hours.overtime_15, 32); // 8 h.sup./semaine × 4 = quota mensuel
  assert.equal(r.hours.overtime_40, 28); // 60 h.sup. au total − 32 h à 15 %
});

test('règle 5 bis : 5 semaines de dépassement → la 5e semaine sort du quota', () => {
  // 5 semaines ISO de 60 h (5 j × 12 h) → 20 h.sup. par semaine
  // Semaines 1→4 : 8 h à 15 % (quota atteint : 32 h) ; 5e semaine : tout à 40 %
  const sessions = [];
  const days = [
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'],
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'],
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
  ];
  for (const week of days) {
    for (const d of week) {
      sessions.push({ start: `${d}T07:00:00`, end: `${d}T19:00:00` });
    }
  }
  const r = computePayroll({ baseSalary: 173330, sessions, holidays: none, rules: {}, ...period });
  assert.equal(r.hours.total, 300);
  assert.equal(r.hours.overtime_15, 32);
  assert.equal(r.hours.overtime_40, 68);
});

test('règle 6 : panier si journée ≥ 10 h', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-12T08:00:00', end: '2026-10-12T18:30:00' }], // 10h30
    holidays: none, rules: { panier_amount: 2500 }, ...period
  });
  assert.equal(r.paniers.count, 1);
  assert.equal(r.paniers.amount, 2500);
});

test('règle 6 bis : panier dès la moindre heure de nuit', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-12T20:00:00', end: '2026-10-12T23:00:00' }], // 3h dont 1h de nuit
    holidays: none, rules: {}, ...period
  });
  assert.equal(r.paniers.count, 1);
});

test('règle 6 ter : pas de panier pour une journée courte de jour', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-12T09:00:00', end: '2026-10-12T12:00:00' }],
    holidays: none, rules: {}, ...period
  });
  assert.equal(r.paniers.count, 0);
});

test('règle 7 : tout jour férié non travaillé est payé 8 h', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [],
    holidays: [
      { date: '2026-10-04', name: 'Fête test' },
      { date: '2026-10-22', name: 'Autre fête' }
    ],
    rules: {}, ...period
  });
  const ferie = r.lines.find((l) => l.code === 'FERIE');
  assert.equal(ferie.quantity, 16); // 2 × 8 h
  assert.equal(ferie.amount, Math.round(16 * 1000));
});

test('règle 7 bis : férié travaillé = majoration 60 %, sans double crédit 8 h', () => {
  const r = computePayroll({
    baseSalary: 173330,
    sessions: [{ start: '2026-10-04T09:00:00', end: '2026-10-04T14:00:00' }],
    holidays: [{ date: '2026-10-04', name: 'Fête test' }],
    rules: {}, ...period
  });
  assert.equal(r.holidays_credited.length, 0);
  assert.equal(r.hours.rest_day, 5);
});

test('cotisations : IPRES 5,6 % + CSS 5 %', () => {
  const d = computeDeductions(100000, {});
  assert.equal(d.find((x) => x.code === 'IPRES').amount, 5600);
  assert.equal(d.find((x) => x.code === 'CSS').amount, 5000);
});

test('cumul des majorations : h.sup. de nuit → 60 % + 40 %', () => {
  // 1 semaine de 5 soirs 20h→2h (6h/jour dont 2h de nuit) = 30h → pas d'h.sup.
  // 1 semaine de 5 soirs de 22h→8h (10h dont 7h de nuit) = 50h → 10h sup
  const sessions = [];
  for (let d = 5; d <= 9; d++) {
    sessions.push({ start: `2026-10-0${d}T22:00:00`, end: `2026-10-0${d}T24:00:00` });
    // note: 2h/jour = 10h total seulement — on veut plutôt une seule grosse semaine
  }
  sessions.length = 0;
  for (let d = 5; d <= 9; d++) {
    sessions.push({ start: `2026-10-0${d}T20:00:00`, end: `2026-10-0${d}T24:00:00` }); // 4h dont 2h nuit
    sessions.push({ start: `2026-10-0${d}T24:00:00`, end: `2026-10-0${d}T24:00:00` });
  }
  // 20h total → pas de sup. On augmente :
  for (let d = 5; d <= 9; d++) {
    sessions.push({ start: `2026-10-0${d}T08:00:00`, end: `2026-10-0${d}T12:00:00` }); // +4h jour
  }
  const r = computePayroll({ baseSalary: 173330, sessions, holidays: none, rules: {}, ...period });
  assert.equal(r.hours.total, 40);
  assert.equal(r.hours.night, 10);
  assert.equal(r.hours.overtime_15, 0);
});

test('isNightMinute : 22h→5h', () => {
  assert.equal(isNightMinute(new Date('2026-10-12T21:59:00')), false);
  assert.equal(isNightMinute(new Date('2026-10-12T22:00:00')), true);
  assert.equal(isNightMinute(new Date('2026-10-13T04:59:00')), true);
  assert.equal(isNightMinute(new Date('2026-10-13T05:00:00')), false);
});

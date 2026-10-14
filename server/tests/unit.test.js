/**
 * SunuÉcole — Tests unitaires (node:test, aucune dépendance externe).
 * Exécution : npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  today, addDays, addMonths, daysBetween, slugify, normalizePhone, isValidPhone,
  isValidEmail, money, clamp, round, ref, maskPhone,
} from '../src/lib/utils.js';
import { config, PLANS } from '../src/config.js';
import { signAccessToken, hashRefresh } from '../src/middleware/auth.js';

/* ---------------- utilitaires de dates ---------------- */
test('addDays ajoute correctement à cheval sur un mois', () => {
  assert.equal(addDays('2026-01-30', 3), '2026-02-02');
  assert.equal(addDays('2026-12-30', 5), '2027-01-04');
});

test('addMonths traverse les années', () => {
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-01-15', 1), '2026-02-15');
});

test('daysBetween est signé et exact', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.equal(daysBetween('2026-01-11', '2026-01-01'), -10);
});

test('today() au format ISO court', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

/* ---------------- normalisation téléphonie / e-mails ---------------- */
test('normalizePhone produit un numéro international sénégalais', () => {
  assert.equal(normalizePhone('77 123 45 67'), '+221771234567');
  assert.equal(normalizePhone('+221 77 123 45 67'), '+221771234567');
  assert.equal(normalizePhone(''), '');
});

test('isValidPhone / isValidEmail rejettent l’invraisemblable', () => {
  assert.equal(isValidPhone('123'), false);
  assert.equal(isValidPhone('+221771234567'), true);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail('direction@ecole.sn'), true);
});

test('maskPhone masque les 4 derniers chiffres (exports publics)', () => {
  const m = maskPhone('+221771234567');
  assert.ok(m.endsWith('****') && !m.includes('4567'));
});

/* ---------------- monnaie & arrondis ---------------- */
test('money arrondit à l’entier (les centimes n’existent pas en XOF)', () => {
  assert.equal(money(1500.4), 1500);
  assert.equal(money(1500.6), 1501);
  assert.equal(money('abc'), 0);
});

test('clamp et round bornent correctement', () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(round(12.3456, 2), 12.35);
});

/* ---------------- divers ---------------- */
test('slugify est stable et sûr pour les URL', () => {
  assert.equal(slugify('École Élémentaire Ndiandiaye 1 !'), 'ecole-elementaire-ndiandiaye-1');
});

test('ref produit des références lisibles et padding fixe', () => {
  const r = ref('FAC', 42);
  assert.match(r, /^FAC-\d{4}-\d{5}$/);
});

test('slugify de deux noms différents → slugs différents', () => {
  assert.notEqual(slugify('Les Baobabs'), slugify('Les Baobabs Plus'));
});

/* ---------------- configuration ---------------- */
test('les trois plans d’abonnement sont définis et cohérents', () => {
  assert.deepEqual(Object.keys(PLANS).sort(), ['elite', 'essentiel', 'pro']);
  for (const [id, p] of Object.entries(PLANS)) {
    assert.ok(p.price > 0, `prix du plan ${id}`);
    assert.ok(Array.isArray(p.modules) && p.modules.length, `modules du plan ${id}`);
  }
  assert.ok(PLANS.essentiel.maxStudents < PLANS.pro.maxStudents);
});

test('config.platform.trialDays existe (bug revue n°4)', () => {
  assert.equal(typeof config.platform?.trialDays, 'number');
});

test('config.auth : TTL et cookie présents', () => {
  assert.ok(config.auth.accessTokenTtl);
  assert.ok(config.auth.cookieName);
  assert.ok(config.auth.jwtSecret && config.auth.jwtSecret.length >= 32);
});

/* ---------------- authentification ---------------- */
test('signAccessToken → jwt.verify round-trip', async () => {
  const jwt = await import('jsonwebtoken');
  const user = { id: 7, school_id: 3, role: 'direction', email: 't@e.sn' };
  const token = signAccessToken(user);
  const payload = jwt.default.verify(token, config.auth.jwtSecret);
  assert.equal(payload.sub, 7);
  assert.equal(payload.sid, 3);
  assert.equal(payload.role, 'direction');
});

test('hashRefresh : même entrée → même empreinte, entrée différente → empreinte différente', () => {
  assert.equal(hashRefresh('abc'), hashRefresh('abc'));
  assert.notEqual(hashRefresh('abc'), hashRefresh('abd'));
  assert.match(hashRefresh('abc'), /^[0-9a-f]{64}$/);
});

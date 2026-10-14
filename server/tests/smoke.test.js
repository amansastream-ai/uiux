/**
 * SunuÉcole — Tests de fumée de bout en bout (HTTP réel, base de démo).
 * Exécution : npm run smoke   (ou npm test, qui exécute tout server/tests/)
 *
 * Prérequis : base peuplée (npm run seed au premier démarrage est automatique).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const json = (r) => r.json();

async function login(email, password = 'Sunu2026!') {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(r.status, 200, `connexion de ${email}`);
  return json(r);
}

/* ------------------------------------------------------------------ */
test('GET /api/health → 200 ok', async () => {
  const r = await fetch(`${base}/api/health`);
  const j = await json(r);
  assert.equal(r.status, 200);
  assert.equal(j.status, 'ok');
  assert.equal(j.db, 'ok');
});

test('GET / → HTML avec assets versionnés (anti-cache périmé)', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /assets\/js\/app\.js\?v=[a-z0-9]+/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('GET /assets/js/app.js → imports relatifs versionnés', async () => {
  const r = await fetch(`${base}/assets/js/app.js`);
  assert.equal(r.status, 200);
  const src = await r.text();
  assert.match(src, /from '\.\/core\/api\.js\?v=[a-z0-9]+'/);
});

test('GET /sw.js → jamais mis en cache', async () => {
  const r = await fetch(`${base}/sw.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /no-store/);
});

/* ------------------------------------------------------------------ */
test('POST /api/auth/login (démo) → token + refreshToken + user', async () => {
  const j = await login('direction@lesbaobabs.sn');
  assert.ok(j.token && j.refreshToken && j.user);
  assert.equal(j.user.role, 'direction');
});

test('API sans jeton → 401', async () => {
  const r = await fetch(`${base}/api/dashboard/summary`);
  assert.equal(r.status, 401);
});

test('API avec jeton invalide → 401', async () => {
  const r = await fetch(`${base}/api/dashboard/summary`, { headers: { Authorization: 'Bearer abc.def.ghi' } });
  assert.equal(r.status, 401);
});

test('GET /api/auth/me puis /api/dashboard/summary avec jeton', async () => {
  const { token } = await login('direction@lesbaobabs.sn');
  const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const sum = await fetch(`${base}/api/dashboard/summary`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(sum.status, 200);
  const j = await json(sum);
  assert.ok(j.data && j.data.school, 'le résumé porte l’établissement');
});

test('Refresh par le corps (cookies tiers bloqués) → rotation', async () => {
  const { refreshToken } = await login('direction@lesbaobabs.sn');
  const r = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(r.status, 200);
  const j = await json(r);
  assert.ok(j.token && j.refreshToken);
  assert.notEqual(j.refreshToken, refreshToken, 'l’ancien jeton est révoqué (rotation)');
  // Rejouer l’ancien jeton doit échouer
  const r2 = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(r2.status, 401);
});

/* ------------------------------------------------------------------ */
test('Cloisonnement famille : parent limité à ses enfants et aux écrans non admin', async () => {
  const { token } = await login('parent@lesbaobabs.sn');
  const h = { Authorization: `Bearer ${token}` };

  const kids = await json(await fetch(`${base}/api/students?limit=50`, { headers: h }));
  assert.ok(kids.meta.total >= 1 && kids.meta.total <= 8, 'le parent ne voit que sa fratrie');

  const cross = await fetch(`${base}/api/students/1`, { headers: h });
  assert.ok([403, 404].includes(cross.status), 'accès direct hors famille refusé');

  assert.equal((await fetch(`${base}/api/finance/summary`, { headers: h })).status, 403);
  assert.equal((await fetch(`${base}/api/settings/users`, { headers: h })).status, 403);
  assert.equal((await fetch(`${base}/api/people/staff`, { headers: h })).status, 403);

  const prov = await fetch(`${base}/api/finance/providers`, { headers: h });
  assert.equal(prov.status, 200, 'le portail de paiement a besoin des opérateurs');
});

test('Cloisonnement élève : un seul dossier visible', async () => {
  const { token } = await login('eleve@lesbaobabs.sn');
  const kids = await json(await fetch(`${base}/api/students?limit=50`, { headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(kids.meta.total, 1);
});

/* ------------------------------------------------------------------ */
test('Listes paginées : shape {data, meta} + export CSV', async () => {
  const { token } = await login('secretariat@lesbaobabs.sn');
  const h = { Authorization: `Bearer ${token}` };
  const r = await fetch(`${base}/api/students?page=1&limit=10`, { headers: h });
  const j = await json(r);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(j.data) && j.data.length <= 10);
  assert.ok(j.meta && typeof j.meta.total === 'number' && j.meta.pages >= 1);

  // l'export CSV est une route dédiée : GET /api/students/export/csv
  const csv = await fetch(`${base}/api/students/export/csv`, { headers: h });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /csv/);
  // NB : Response.text() supprime le BOM (spec WHATWG) → vérifier les octets bruts
  const buf = new Uint8Array(await csv.arrayBuffer());
  assert.equal(buf[0], 0xef, 'BOM UTF-8 octet 1');
  assert.equal(buf[1], 0xbb, 'BOM octet 2');
  assert.equal(buf[2], 0xbf, 'BOM octet 3');
});

test('Paramètres : plans d’abonnement et journal d’audit', async () => {
  const { token } = await login('direction@lesbaobabs.sn');
  const h = { Authorization: `Bearer ${token}` };
  const plans = await json(await fetch(`${base}/api/settings/plans`, { headers: h }));
  assert.equal(plans.data.plans.length, 3);
  const audit = await json(await fetch(`${base}/api/settings/audit?limit=5`, { headers: h }));
  assert.ok(Array.isArray(audit.data));
});

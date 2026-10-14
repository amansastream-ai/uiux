/**
 * SunuÉcole — Tests du client HTTP (web/assets/js/core/api.js).
 *
 * Le navigateur n'est pas nécessaire : le module ne touche qu'à window,
 * localStorage, document, location, navigator et fetch, tous simulés ici.
 *
 * Objet du test : distinguer un 401 « métier » (mot de passe erroné sur une
 * route publique) d'une véritable fin de session. Les confondre affichait
 * « Session expirée » à la place de « Identifiants incorrects » et effaçait la
 * session en cours — le bug qui rendait la connexion aux comptes de
 * démonstration incompréhensible.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------------- Environnement navigateur simulé ---------------- */
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
globalThis.window = { addEventListener() {} };
globalThis.document = { cookie: '' };
globalThis.location = { protocol: 'http:', hostname: 'localhost', reload() {} };
// `navigator` est un global en lecture seule sur Node 22 : on le redéfinit.
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, userAgent: 'test' },
  configurable: true,
  writable: true,
});

/** Réponses programmées : chaque entrée est consommée une fois. */
let routes = [];
globalThis.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  const index = routes.findIndex((r) => r.method === method && url.endsWith(r.path));
  const route = index >= 0 ? routes.splice(index, 1)[0] : null;
  if (!route) throw new Error(`requête inattendue : ${method} ${url}`);
  route.seen = (route.seen || 0) + 1;
  return new Response(JSON.stringify(route.body ?? {}), {
    status: route.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
};

const { api, setToken, getToken, bus } = await import('../../web/assets/js/core/api.js');

let sessionEnds = 0;
bus.addEventListener('unauthorized', () => { sessionEnds += 1; });

beforeEach(() => {
  routes = [];
  sessionEnds = 0;
  storage.clear();
  setToken(null);
  api.clearCache();
});

/* ------------------------------------------------------------------ */
test('route publique : un 401 de /auth/login ne termine pas la session', async () => {
  setToken('jeton-encore-valide');
  routes = [{ method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'Identifiants incorrects.' } }];

  await assert.rejects(
    () => api.post('/auth/login', { email: 'direction@lesbaobabs.sn', password: 'mauvais' }),
    (err) => err.status === 401 && err.message === 'Identifiants incorrects.'
  );

  assert.equal(sessionEnds, 0, 'aucune fin de session déclenchée');
  assert.equal(getToken(), 'jeton-encore-valide', 'le jeton courant est conservé');
});

test('route publique : un 401 de /auth/register ne termine pas la session', async () => {
  setToken('jeton-encore-valide');
  routes = [{ method: 'POST', path: '/api/auth/register', status: 401, body: { error: 'Refusé.' } }];

  await assert.rejects(() => api.post('/auth/register', { schoolName: 'Test' }));
  assert.equal(sessionEnds, 0);
  assert.equal(getToken(), 'jeton-encore-valide');
});

test('route protégée : un 401 sans renouvellement possible termine la session', async () => {
  setToken('jeton-perime');
  routes = [
    { method: 'GET', path: '/api/dashboard/summary', status: 401, body: { error: 'Session expirée' } },
    { method: 'POST', path: '/api/auth/refresh', status: 401, body: { error: 'Session expirée' } },
  ];

  await assert.rejects(() => api.get('/dashboard/summary'));

  assert.equal(sessionEnds, 1, 'une seule notification de fin de session');
  assert.equal(getToken(), null, 'le jeton périmé est effacé');
});

test('route protégée : le jeton est renouvelé et la requête rejouée (session sauvée)', async () => {
  setToken('jeton-perime');
  routes = [
    { method: 'POST', path: '/api/auth/refresh', status: 200, body: { token: 'jeton-frais', refreshToken: 'r2' } },
    { method: 'GET', path: '/api/auth/me', status: 401, body: { error: 'Session expirée' } },
    { method: 'GET', path: '/api/auth/me', status: 200, body: { user: { id: 2, role: 'direction' } } },
  ];

  // /auth/me est une route PROTÉGÉE : elle doit pouvoir se renouveler
  // (auparavant tout préfixe « /auth/ » était exclu → déconnexion immédiate).
  const me = await api.get('/auth/me');
  assert.equal(me.user.id, 2);
  assert.equal(getToken(), 'jeton-frais');
  assert.equal(sessionEnds, 0, 'la session n’est jamais terminée');
});

test('routes publiques : ni renouvellement ni fin de session', async () => {
  setToken('jeton-encore-valide');
  routes = [{ method: 'GET', path: '/api/auth/demo-accounts', status: 401, body: { error: 'Indisponible.' } }];

  await assert.rejects(() => api.get('/auth/demo-accounts'));
  assert.equal(sessionEnds, 0);
  assert.equal(getToken(), 'jeton-encore-valide');
});

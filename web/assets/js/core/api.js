/**
 * SunuÉcole — Client HTTP.
 *
 * Particularités :
 *  - renouvellement automatique du jeton à l'expiration (1 seul refresh en vol) ;
 *  - cache mémoire court pour les données peu volatiles (moins d'allers-retours) ;
 *  - file d'attente hors-ligne : les écritures critiques (appel, notes) sont
 *    stockées localement puis rejouées dès le retour du réseau ;
 *  - deduplication des requêtes identiques simultanées.
 */

const API_BASE = '/api';
const LS_TOKEN = 'sue.token';
const LS_REFRESH = 'sue.refresh';
const LS_QUEUE = 'sue.syncQueue';
const LS_PREFS = 'sue.prefs';

/** Événement global : permet à l'UI de réagir à une déconnexion forcée. */
export const bus = new EventTarget();

/* Lectures protégées : si le stockage est indisponible (iframe tierce, navigation
   privée), une exception ici tuerait TOUT le graphe de modules → splash figé. */
let token = readStored(LS_TOKEN);
/**
 * Jeton de renouvellement. Le serveur le pose aussi dans un cookie httpOnly, mais
 * les cookies tiers sont bloqués dans certains contextes (iframe de prévisualisation,
 * Safari/ITP) : ce double canal garantit une session qui se renouvelle toute seule.
 */
let refreshToken = readStored(LS_REFRESH);
const inflight = new Map();
const memCache = new Map();
let refreshing = null;

export const isOnline = () => navigator.onLine !== false;

export function setToken(t) {
  token = t || null;
  try {
    if (t) localStorage.setItem(LS_TOKEN, t);
    else { localStorage.removeItem(LS_TOKEN); setRefreshToken(null); }
  } catch { /* stockage indisponible : la session reste valable en mémoire */ }
}
export const getToken = () => token;

export function setRefreshToken(t) {
  refreshToken = t || null;
  try {
    if (t) localStorage.setItem(LS_REFRESH, t);
    else localStorage.removeItem(LS_REFRESH);
  } catch { /* stockage indisponible */ }
}
export const getRefreshToken = () => refreshToken;

/**
 * Le jeton peut avoir été écrit par un autre onglet ou par une autre instance du
 * module (mise à jour de l'application en cours de session). On relit le stockage
 * à chaque requête et on écoute l'événement `storage` : plus aucun appel ne part
 * sans en-tête Authorization alors qu'une session valide existe.
 */
function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function currentToken() {
  if (token) return token;
  const stored = readStored(LS_TOKEN);
  if (stored) token = stored;
  return token;
}
window.addEventListener('storage', (e) => {
  if (e.key === LS_TOKEN) token = e.newValue || null;
  if (e.key === LS_REFRESH) refreshToken = e.newValue || null;
});

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */
export function clearCache(prefix = '') {
  for (const k of [...memCache.keys()]) if (!prefix || k.startsWith(prefix)) memCache.delete(k);
}

/** Met en cache une réponse GET pour `ttl` ms. */
function cacheGet(key, ttl) {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  if (hit) memCache.delete(key);
  return undefined;
}

/* ------------------------------------------------------------------ */
/* File hors-ligne                                                     */
/* ------------------------------------------------------------------ */
export function readQueue() {
  try { return JSON.parse(localStorage.getItem(LS_QUEUE) || '[]'); } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(LS_QUEUE, JSON.stringify(q)); } catch { /* quota */ }
  bus.dispatchEvent(new CustomEvent('queue', { detail: { count: q.length } }));
}
export function enqueue(op) {
  const q = readQueue();
  // Idempotence : on remplace une opération homonyme déjà en file.
  const idx = q.findIndex((x) => x.client_id === op.client_id);
  if (idx >= 0) q[idx] = { ...q[idx], ...op };
  else q.push({ ...op, client_id: op.client_id || crypto.randomUUID(), queued_at: new Date().toISOString() });
  writeQueue(q);
  return q.length;
}
export function clearQueue() { writeQueue([]); }

/** Rejoue la file locale. Appelée au retour du réseau et après connexion. */
export async function flushQueue() {
  const q = readQueue();
  if (!q.length || !token || !isOnline()) return { applied: 0, failed: 0 };
  try {
    const res = await raw('/comms/sync', {
      method: 'POST',
      body: { operations: q.map(({ client_id, entity, action, payload, captured_at }) => ({ client_id, entity, action, payload, captured_at })), device: navigator.userAgent.slice(0, 80) },
    });
    writeQueue([]);
    bus.dispatchEvent(new CustomEvent('synced', { detail: res.data }));
    return res.data || { applied: 0, failed: 0 };
  } catch (err) {
    console.warn('[sync] échec du rejeu de la file', err);
    return { applied: 0, failed: q.length };
  }
}

/* ------------------------------------------------------------------ */
/* Requête bas niveau                                                  */
/* ------------------------------------------------------------------ */
async function raw(path, { method = 'GET', body, headers = {}, signal, cacheTtl = 0, noAuth = false } = {}) {
  const key = `${method} ${path}`;
  if (method === 'GET' && cacheTtl) {
    const hit = cacheGet(key, cacheTtl);
    if (hit) return hit;
  }
  // Déduplication : deux composants qui chargent la même donnée → 1 requête.
  if (method === 'GET' && inflight.has(key)) return inflight.get(key);

  const doFetch = async (useToken) => {
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(useToken ? { Authorization: `Bearer ${useToken}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'include',
    });
    return res;
  };

  const promise = (async () => {
    // Jeton relu au moment de l'appel (voir currentToken) : aucune requête
    // authentifiée ne part sans en-tête alors qu'une session valide existe.
    const token = currentToken();
    let res;
    try {
      res = await doFetch(token);
    } catch (netErr) {
      if (!isOnline()) {
        const err = new Error('Hors connexion — les données affichées peuvent ne pas être à jour.');
        err.offline = true;
        err.status = 0;
        throw err;
      }
      throw netErr;
    }

    // Jeton expiré → tentative de renouvellement unique, puis rejeu.
    if (res.status === 401 && !noAuth && token && !path.startsWith('/auth/')) {
      if (!refreshing) {
        refreshing = fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('refresh'))))
          .then((j) => {
            if (j.refreshToken) setRefreshToken(j.refreshToken);
            setToken(j.token);
            bus.dispatchEvent(new CustomEvent('user', { detail: j.user }));
            return j.token;
          })
          .catch(() => { setToken(null); bus.dispatchEvent(new CustomEvent('unauthorized')); return null; })
          .finally(() => { refreshing = null; });
      }
      const newToken = await refreshing;
      if (newToken) {
        res = await doFetch(newToken);
      } else {
        throw unauthorized();
      }
    }

    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new Error((payload && payload.error) || `Erreur ${res.status}`);
      err.status = res.status;
      err.fields = payload?.fields;
      err.conflicts = payload?.conflicts;
      // Un 401 sur une route publique (connexion, inscription, mot de passe oublié)
      // est traité par le formulaire : il ne doit pas déclencher la fin de session globale.
      if (res.status === 401 && token) { setToken(null); bus.dispatchEvent(new CustomEvent('unauthorized')); }
      throw err;
    }
    if (method === 'GET' && cacheTtl) memCache.set(key, { data: payload, at: Date.now() });
    return payload;
  })();

  if (method === 'GET') {
    inflight.set(key, promise);
    promise.finally(() => inflight.delete(key));
  }
  return promise;
}

function unauthorized() {
  const err = new Error('Session expirée.');
  err.status = 401;
  return err;
}

/* ------------------------------------------------------------------ */
/* API publique                                                        */
/* ------------------------------------------------------------------ */
export const api = {
  get: (path, opts) => raw(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => raw(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => raw(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => raw(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => raw(path, { ...opts, method: 'DELETE' }),

  /** Téléchargement d'un fichier (export CSV, JSON) via blob. */
  async download(path, filename) {
    const res = await fetch(API_BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
    if (!res.ok) throw new Error(`Export impossible (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || path.split('/').pop() || 'export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  /**
   * Écriture tolérante au hors-ligne : tente l'appel réseau, sinon met
   * l'opération en file pour synchronisation ultérieure.
   */
  async offlinePost(path, body, { entity, action, payload, silent = false } = {}) {
    if (isOnline()) return { ...(await api.post(path, body)), syncedNow: true };
    if (!entity) throw new Error('Hors connexion : cette action nécessite une synchronisation.');
    enqueue({ entity, action, payload, captured_at: new Date().toISOString() });
    if (!silent) bus.dispatchEvent(new CustomEvent('queued', { detail: { entity, action } }));
    return { queued: true, syncedNow: false };
  },

  clearCache,
  readQueue,
  flushQueue,
};

/* ------------------------------------------------------------------ */
/* Préférences locales                                                 */
/* ------------------------------------------------------------------ */
export function getPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_PREFS) || '{}'); } catch { return {}; }
}
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  try { localStorage.setItem(LS_PREFS, JSON.stringify(next)); } catch { /* ignore */ }
  applyPrefs(next);
  return next;
}
export function applyPrefs(p = getPrefs()) {
  const root = document.documentElement;
  const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.dataset.theme = p.theme === 'auto' || !p.theme ? sys : p.theme;
  root.dataset.density = p.density || 'confort';
  if (p.sidebar) root.dataset.sidebar = p.sidebar;
}

/** Construit une querystring en ignorant les valeurs vides. */
/** Télécharge un Blob ou du texte, sans build ni dépendance. */
export function download(content, filename = 'export.csv', type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

export function qs(params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export default api;

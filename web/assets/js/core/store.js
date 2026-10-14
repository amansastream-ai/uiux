/**
 * SunuÉcole — État applicatif + routeur.
 *
 * Routeur à hash (#/chemin) : aucun rechargement, fonctionne en ouvrant le
 * fichier directement, et survit aux proxies/prévisualisations sans
 * configuration de réécriture d'URL.
 */
import { api, bus, getPrefs, setPrefs, applyPrefs } from './api.js';

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */
const state = {
  user: null,
  school: null,
  meta: null,
  alerts: [],
  notifications: [],
  unread: 0,
  queue: api.readQueue().length,
  online: navigator.onLine !== false,
  prefs: getPrefs(),
  facets: {},
  bootstrapped: false,
};

const listeners = new Set();
export const store = {
  state,
  get: (k) => state[k],
  set(patch) {
    Object.assign(state, patch);
    listeners.forEach((fn) => fn(state, patch));
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Raccourcis fréquents. */
  get role() { return state.user?.role; },
  get schoolId() { return state.user?.schoolId; },
  is: (...roles) => roles.includes(state.user?.role),
  can(...roles) { return state.user?.role === 'super_admin' || roles.includes(state.user?.role); },
  level() {
    const map = { super_admin: 100, direction: 90, censeur: 75, comptable: 70, secretaire: 65, enseignant: 50, bibliothecaire: 45, infirmier: 45, surveillant: 40, parent: 20, eleve: 10 };
    return map[state.user?.role] ?? 0;
  },
  atLeast(level) { return store.level() >= level; },
  settings() { return state.school?.settings || {}; },
};

bus.addEventListener('user', (e) => store.set({ user: e.detail, school: e.detail?.school || null }));
bus.addEventListener('unauthorized', () => store.set({ user: null, school: null }));
bus.addEventListener('queue', (e) => store.set({ queue: e.detail.count }));
window.addEventListener('online', () => { store.set({ online: true }); document.body.classList.remove('is-offline'); api.flushQueue(); });
window.addEventListener('offline', () => { store.set({ online: false }); document.body.classList.add('is-offline'); });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((store.state.prefs.theme || 'auto') === 'auto') applyPrefs(store.state.prefs);
});

/* ------------------------------------------------------------------ */
/* Préférences                                                         */
/* ------------------------------------------------------------------ */
export function updatePrefs(patch) {
  const next = setPrefs(patch);
  store.set({ prefs: next });
  if (store.state.user) {
    api.patch('/auth/profile', { preferences: patch }).catch(() => { /* non bloquant */ });
  }
  return next;
}

export function cycleTheme() {
  const order = ['light', 'dark', 'auto'];
  const cur = store.state.prefs.theme || 'auto';
  return updatePrefs({ theme: order[(order.indexOf(cur) + 1) % order.length] });
}

export function cycleDensity() {
  const order = ['compact', 'confort', 'spacieux'];
  const cur = store.state.prefs.density || 'confort';
  return updatePrefs({ density: order[(order.indexOf(cur) + 1) % order.length] });
}

export function toggleSidebar() {
  const cur = store.state.prefs.sidebar === 'closed' ? 'open' : 'closed';
  return updatePrefs({ sidebar: cur });
}

/* ------------------------------------------------------------------ */
/* Routeur                                                             */
/* ------------------------------------------------------------------ */
const routes = [];
let notFound = null;
let currentCleanup = null;
let renderCount = 0;

export function route(pattern, handler, meta = {}) {
  // '/finance/factures/:id' → regex + noms de paramètres
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }).replace(/\*$/, '(.*)')}$`);
  routes.push({ rx, keys, handler, meta, pattern });
  return route;
}
export function setNotFound(fn) { notFound = fn; }

export const currentPath = () => (location.hash.slice(1) || '/').split('?')[0];
export const currentQuery = () => {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
};

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path.startsWith('/') ? path : `/${path}`}`;
  if (location.hash === target) { render(); return; }
  if (replace) location.replace(target);
  else location.hash = target;
}
export const go = navigate;

export function back() {
  if (history.length > 1) history.back();
  else navigate('/');
}

/** Titre de page + fil d'Ariane mis à jour automatiquement. */
function applyMeta(meta, params) {
  let title = typeof meta.title === 'function' ? meta.title(params) : meta.title || '';
  const school = store.state.school?.name;
  document.title = title ? `${title} · ${school || 'SunuÉcole'}` : 'SunuÉcole';
  bus.dispatchEvent(new CustomEvent('route', { detail: { ...meta, title, params } }));
}

async function render() {
  const path = currentPath();
  const query = currentQuery();
  const match = routes.find((r) => r.rx.test(path));
  const container = document.getElementById('view-root');
  renderCount += 1;

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
  }

  if (!match) {
    applyMeta({ title: 'Page introuvable' });
    if (container && notFound) container.replaceChildren(notFound(path));
    return;
  }

  const params = {};
  const m = path.match(match.rx);
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1] || ''); });
  applyMeta(match.meta, params);

  // Indicateur de progression sans bloquer l'interface
  bus.dispatchEvent(new CustomEvent('loading', { detail: true }));
  try {
    const result = await match.handler({ params, query, path, container });
    if (container && result != null) {
      if (result instanceof Node) container.replaceChildren(result);
      else container.innerHTML = result;
    }
    currentCleanup = match.handler.cleanup || null;
  } catch (err) {
    if (container) {
      container.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'card';
      box.innerHTML = `<div class="empty">
        <div class="empty-icon" style="color:var(--danger)">${''}</div>
        <h3>Impossible de charger cette page</h3>
        <p>${String(err.message || err).slice(0, 220)}</p>
        <div class="actions"><button class="btn btn-primary" id="rt">Réessayer</button>
        <a class="btn btn-secondary" href="#/">Retour à l'accueil</a></div></div>`;
      container.appendChild(box);
      box.querySelector('#rt')?.addEventListener('click', () => render());
    }
  } finally {
    bus.dispatchEvent(new CustomEvent('loading', { detail: false }));
  }
  // Remonte en haut sauf si l'utilisateur a sciemment gardé sa position
  if (renderCount > 1) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/';
  render();
}
export const rerender = render;

/** Lien interne : évite le rechargement complet. */
export function linkTo(path, label, opts = {}) {
  return `<a href="#${path}" class="${opts.class || ''}" ${opts.attrs || ''}>${label}</a>`;
}

export { bus };

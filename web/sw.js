/* SunuÉcole — Service worker.
 *
 * Stratégie pensée pour les établissements à connexion intermittente :
 *  - coquille applicative (HTML/CSS/JS/icônes) : cache-first, mise à jour en
 *    arrière-plan (l'utilisateur ne voit jamais d'écran blanc au démarrage) ;
 *  - API GET : réseau d'abord avec repli sur le cache (données récentes) ;
 *  - navigation hors-ligne : renvoie la coquille (l'app affiche ses données
 *    locales et la file d'attente de synchronisation) ;
 *  - jamais de cache pour les mutations (POST/PATCH/DELETE).
 */
const VERSION = 'sue-v2.2';
// Caches nommés par version : toute mise à jour repart d'un cache propre et
// l'ancienne coquille est supprimée à l'activation (aucun code périmé ne survit).
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/css/tokens.css',
  '/assets/css/app.css',
  '/assets/css/print.css',
  '/assets/js/app.js',
  '/assets/js/boot-prefs.js',
  '/assets/js/pwa.js',
  '/assets/js/core/api.js',
  '/assets/js/core/format.js',
  '/assets/js/core/icons.js',
  '/assets/js/core/store.js',
  '/assets/js/core/charts.js',
  '/assets/js/ui/components.js',
  '/assets/js/views/login.js',
  '/assets/js/views/dashboard.js',
  '/assets/js/views/students.js',
  '/assets/js/views/academics.js',
  '/assets/js/views/vie-scolaire.js',
  '/assets/js/views/finance.js',
  '/assets/js/views/people.js',
  '/assets/js/views/comms.js',
  '/assets/js/views/portails.js',
  '/assets/js/views/settings.js',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // URL par URL : un fichier manquant ne bloque plus la mise à jour du reste
    // (cache.addAll() est atomique et échouait en silence au moindre 404).
    await Promise.allSettled(SHELL_URLS.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload' });
        if (res && res.ok) await cache.put(u, res.clone());
      } catch { /* hors ligne pendant l'installation : on réessaiera */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    ))
      .then(() => self.clients.claim())
      // Onglets « zombies » : un onglet resté ouvert depuis une ancienne version
      // garde l'ancien code en mémoire (requêtes sans jeton → « Session expirée »).
      // On force leur rechargement une seule fois, à l'activation de cette version :
      // ils repartent alors sur l'index frais et les modules versionnés.
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => Promise.allSettled(
        clients.map((c) => (c.navigate ? c.navigate(c.url) : Promise.resolve()))
      ))
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

const isApi = (url) => url.pathname.startsWith('/api/');
/** L'authentification ne se met jamais en cache : un jeton ou un profil périmé
 *  enfermerait l'utilisateur dans une session morte (« Session expirée »). */
const isAuthApi = (url) => url.pathname.startsWith('/api/auth/');
const isGet = (r) => r.method === 'GET';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Mutations : réseau uniquement (jamais de cache d'écriture)
  if (!isGet(req)) return;

  // Authentification : réseau uniquement, aucun repli sur le cache
  if (isAuthApi(url)) return;

  // API : réseau d'abord, repli cache
  if (isApi(url)) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(DATA).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((cached) => cached || new Response(
        JSON.stringify({ error: 'Hors connexion', offline: true }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )))
    );
    return;
  }

  // Navigation : réseau d'abord, coquille en cache seulement hors ligne.
  // Servir le HTML en cache d'abord figeait l'utilisateur sur une ancienne
  // version de l'application (le HTML pointe vers les URL d'assets versionnées).
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(SHELL).then((c) => c.put('/index.html', clone)).catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response(
          '<!doctype html><meta charset="utf-8"><title>SunuÉcole</title>' +
          '<body style="font:15px system-ui;padding:40px;text-align:center">' +
          '<h1>Hors connexion</h1><p>Reconnectez-vous au réseau puis rechargez la page.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
        const clone = res.clone();
        caches.open(SHELL).then((c) => c.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => cached || Response.error()))
  );
});

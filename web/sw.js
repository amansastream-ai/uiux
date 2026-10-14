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
const VERSION = 'sue-v1.4';
const SHELL = 'shell';
const DATA = 'data';
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
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_URLS.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {}) // une URL manquante ne doit pas faire échouer l'installation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL && k !== DATA && !k.startsWith(VERSION)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

const isApi = (url) => url.pathname.startsWith('/api/');
const isGet = (r) => r.method === 'GET';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Mutations : réseau uniquement (jamais de cache d'écriture)
  if (!isGet(req)) return;

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

  // Coquille : cache d'abord puis rafraîchissement silencieux
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('/index.html').then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(SHELL).then((c) => c.put('/index.html', clone)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
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

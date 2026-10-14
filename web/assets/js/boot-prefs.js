/* SunuÉcole — préférences appliquées avant le premier rendu + filet de sécurité.
   Script classique (non module) exécuté de façon synchrone dans le <head> :
   il fonctionne même si un module ES venait à ne pas se charger. */
(function () {
  /* ---------- thème / densité : aucun flash blanc ---------- */
  try {
    var s = JSON.parse(localStorage.getItem('sue.prefs') || '{}');
    var t = s.theme || 'auto';
    var sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t === 'auto' ? sys : t;
    document.documentElement.dataset.density = s.density || 'confort';
    if (s.sidebar === 'closed') document.documentElement.dataset.sidebar = 'closed';
  } catch (e) { /* stockage indisponible (navigation privée) */ }

  /* ---------- télémétrie de diagnostic (uniquement les incidents) ---------- */
  var REPORT = '/api/debug/client';
  function report(data) {
    try {
      var base = {
        at: new Date().toISOString(),
        href: String(location.href).slice(0, 140),
        ua: String(navigator.userAgent).slice(0, 90),
        sw: navigator.serviceWorker && navigator.serviceWorker.controller
          ? String(navigator.serviceWorker.controller.scriptURL).slice(-24) : 'aucun',
      };
      var body = JSON.stringify(Object.assign(base, data || {}));
      var blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon) navigator.sendBeacon(REPORT, blob);
      else fetch(REPORT, { method: 'POST', body: blob, keepalive: true });
    } catch (e) { /* jamais bloquant */ }
  }
  window.__sueReport = report;

  window.addEventListener('error', function (e) {
    if (e && e.target && e.target.tagName) {
      report({ kind: 'ressource-manquante', tag: e.target.tagName, src: String(e.target.src || e.target.href || '').slice(0, 180) });
    } else if (e && e.message) {
      report({ kind: 'erreur-js', message: String(e.message).slice(0, 220), fichier: String(e.filename || '').slice(0, 140), ligne: e.lineno });
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    report({ kind: 'promesse-rejetee', message: String((e.reason && e.reason.message) || e.reason).slice(0, 220) });
  });

  /* ---------- chien de garde : démarrage qui n'aboutit jamais ---------- */
  var ok = false;
  window.__sueBootOk = function () {
    ok = true;
    try { sessionStorage.removeItem('sue.watchdog'); sessionStorage.removeItem('sue.noSW'); } catch (e) { /* ignore */ }
    var p = document.getElementById('boot-panel');
    if (p) p.remove();
  };

  function showPanel(detail) {
    if (document.getElementById('boot-panel')) return;
    var d = document.createElement('div');
    d.id = 'boot-panel';
    d.setAttribute('role', 'alertdialog');
    d.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:999;margin:auto;max-width:430px;' +
      'background:#fff;color:#0d2a24;border:1px solid #d8e3df;border-radius:14px;padding:16px 18px;' +
      'box-shadow:0 18px 50px -18px rgba(13,42,36,.35);font:14px/1.5 system-ui,sans-serif';
    d.innerHTML =
      '<b style="font-size:15px">Le chargement prend trop de temps</b>' +
      '<p style="margin:6px 0 10px;color:#41564f">Une ancienne version mise en cache ou une connexion instable ' +
      'peut bloquer le démarrage. Le bouton ci-dessous vide le cache local et recharge.</p>' +
      (detail ? '<p style="margin:0 0 10px;font-size:12px;color:#7a8c85">' + detail + '</p>' : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button id="boot-fix" style="background:#0e7c66;color:#fff;border:0;border-radius:10px;padding:9px 14px;font-weight:600;cursor:pointer">Réparer et recharger</button>' +
      '<button id="boot-retry" style="background:#fff;color:#0d2a24;border:1px solid #cfdad6;border-radius:10px;padding:9px 14px;cursor:pointer">Réessayer simplement</button>' +
      '</div>';
    (document.body || document.documentElement).appendChild(d);
    d.querySelector('#boot-fix').addEventListener('click', function () { repair(true); });
    d.querySelector('#boot-retry').addEventListener('click', function () { location.reload(); });
  }

  function repair(manual) {
    report({ kind: manual ? 'reparation-manuelle' : 'reparation-auto' });
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sue.') === 0 && k !== 'sue.prefs') localStorage.removeItem(k);
      }
    } catch (e) { /* ignore */ }
    try { sessionStorage.setItem('sue.noSW', '1'); } catch (e2) { /* ignore */ }
    var done = 0;
    var finish = function () { if (++done >= 2) location.reload(); };
    if ('caches' in window) {
      caches.keys().then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x); })); }).then(finish, finish);
    } else finish();
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistrations().then(function (r) { return Promise.all(r.map(function (x) { return x.unregister(); })); }).then(finish, finish);
    } else finish();
    setTimeout(finish, 3500);
  }
  window.__sueRepair = repair;

  setTimeout(function () {
    if (ok || window.__sueBootOkDone) return;
    report({ kind: 'chien-de-garde', boot: 'inacheve' });
    try {
      if (sessionStorage.getItem('sue.watchdog') === '1') { showPanel('Deuxième tentative échouée : le détail a été journalisé côté serveur.'); return; }
      sessionStorage.setItem('sue.watchdog', '1');
      repair(false);
    } catch (e) { showPanel(''); }
  }, 12000);
})();

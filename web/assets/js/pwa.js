/* Enregistrement du service worker + proposition d'installation.
   Chargé après l'application pour ne pas retarder le premier rendu. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(function (reg) { reg.update(); return reg; })
      .catch(function () { /* non bloquant */ });
  });

  /* Une nouvelle version du service worker prend la main → on recharge une fois.
     Sans cela, la page continue d'exécuter l'ancien code et l'utilisateur a
     l'impression que les correctifs ne sont jamais appliqués. */
  var reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloaded) return;
    try { if (sessionStorage.getItem('sue.swReloaded') === '1') return; } catch (e) { /* stockage indisponible */ }
    reloaded = true;
    try { sessionStorage.setItem('sue.swReloaded', '1'); } catch (e2) { /* ignore */ }
    setTimeout(function () { window.location.reload(); }, 300);
  });
  /* Le verrou anti-boucle est levé quelques secondes après un chargement sain. */
  window.addEventListener('load', function () {
    setTimeout(function () { try { sessionStorage.removeItem('sue.swReloaded'); } catch (e) { /* ignore */ } }, 10000);
  });

  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new CustomEvent('sunuecole:installable'));
  });
  window.addEventListener('appinstalled', function () {
    if (window.__toast) window.__toast({ title: 'Application installée', message: 'SunuÉcole est sur votre écran d\'accueil, prête à fonctionner hors connexion.', tone: 'ok' });
  });
  /** Propose l'installation (bouton « Installer » du menu utilisateur). */
  window.sunuecoleInstall = async function () {
    if (!deferred) return false;
    deferred.prompt();
    var choice = await deferred.userChoice;
    deferred = null;
    return choice && choice.outcome === 'accepted';
  };
  window.sunuecoleInstallable = function () { return !!deferred; };

  /**
   * Remet l'application à zéro : stockage local, caches du service worker et
   * enregistrements. Échappatoire sûre quand une ancienne version est en cache
   * ou quand une session est corrompue.
   */
  window.sunuecoleReset = async function () {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sue.') === 0) localStorage.removeItem(k);
      }
    } catch (e) { /* stockage indisponible */ }
    try { sessionStorage.clear(); } catch (e2) { /* ignore */ }
    try {
      if ('caches' in window) {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
    } catch (e3) { /* ignore */ }
    try {
      if ('serviceWorker' in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
    } catch (e4) { /* ignore */ }
    window.location.href = '/';
    return true;
  };
})();

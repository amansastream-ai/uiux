/* Enregistrement du service worker + proposition d'installation.
   Chargé après l'application pour ne pas retarder le premier rendu. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* non bloquant */ });
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
})();

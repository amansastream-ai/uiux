/* Applique le thème/densité avant le premier rendu : aucun flash blanc.
   Script classique (non module) exécuté de façon synchrone dans le <head>. */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('sue.prefs') || '{}');
    var t = s.theme || 'auto';
    var sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t === 'auto' ? sys : t;
    document.documentElement.dataset.density = s.density || 'confort';
    if (s.sidebar === 'closed') document.documentElement.dataset.sidebar = 'closed';
  } catch (e) { /* stockage indisponible (navigation privée) */ }
})();

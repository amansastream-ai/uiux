/** ChronoRH — application SPA, routeur & shell. */
import { api } from './api.js';
import { esc, icons, initials, ROLE_LABELS, ROLE_COLORS, toast } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderDashboard } from './views/dashboard.js';
import { renderEmployes } from './views/employes.js';
import { renderPointages } from './views/pointages.js';
import { renderBorne } from './views/borne.js';
import { renderPaie } from './views/paie.js';
import { renderRapports } from './views/rapports.js';
import { renderParametres } from './views/parametres.js';
import { renderUtilisateurs } from './views/utilisateurs.js';

const app = document.getElementById('app');
const state = { user: null, settings: {}, route: 'dashboard' };

const NAV = [
  { id: 'dashboard', label: 'Tableau de bord', icon: 'dashboard', roles: ['admin', 'drh', 'comptable', 'pointage'] },
  { id: 'employes', label: 'Employés & badges', icon: 'users', roles: ['admin', 'drh'] },
  { id: 'pointages', label: 'Pointages', icon: 'clock', roles: ['admin', 'drh', 'pointage'] },
  { id: 'paie', label: 'Paie & salaires', icon: 'money', roles: ['admin', 'comptable'] },
  { id: 'rapports', label: 'Rapports', icon: 'chart', roles: ['admin', 'drh', 'comptable', 'pointage'] },
  { id: 'utilisateurs', label: 'Utilisateurs', icon: 'shield', roles: ['admin'] },
  { id: 'parametres', label: 'Paramètres & règles', icon: 'settings', roles: ['admin'] },
];

const TITLES = {
  dashboard: ['Tableau de bord', 'Vue d’ensemble de l’activité en temps réel'],
  employes: ['Employés & badges', 'Gestion des employés, badges QR et empreintes digitales'],
  pointages: ['Pointages', 'Contrôle et correction des pointages (QR / empreinte / manuel)'],
  borne: ['Borne de pointage', 'Mode tablette — scan QR ou empreinte digitale'],
  paie: ['Paie & salaires', 'Calcul des heures, primes et salaires en FCFA'],
  rapports: ['Rapports', 'Heures travaillées, supplémentaires et masse salariale'],
  utilisateurs: ['Utilisateurs', 'Comptes et rôles de la plateforme'],
  parametres: ['Paramètres & règles', 'Société, barème de paie et jours fériés'],
};

function go(hash) { location.hash = hash; }

async function boot() {
  try {
    const me = await api.get('/auth/me');
    state.user = me.user;
    state.settings = me.settings || {};
    render();
  } catch {
    renderLogin(app, async (user) => {
      state.user = user;
      const me = await api.get('/auth/me');
      state.settings = me.settings || {};
      go('#/dashboard');
      render();
    });
  }
}

function render() {
  const route = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
  state.route = route;

  if (route === 'login') { renderLogin(app, boot); return; }
  if (!state.user) { boot(); return; }

  // Borne en plein écran (sans sidebar)
  if (route === 'borne') {
    app.innerHTML = '';
    renderBorne(app, { state, route, go, refresh: render }).catch((e) => {
      app.innerHTML = `<div class="empty"><b>Erreur</b><div>${esc(e.message)}</div></div>`;
    });
    return;
  }

  const allowed = NAV.find((n) => n.id === route);
  if (allowed && !allowed.roles.includes(state.user.role)) {
    toast('error', 'Accès refusé', 'Cette section n’est pas disponible pour votre rôle.');
    go('#/dashboard');
    return;
  }

  const [title, sub] = TITLES[route] || ['ChronoRH', ''];
  const navItems = NAV.filter((n) => n.roles.includes(state.user.role)).map((n) => `
    <button class="nav-item ${route === n.id ? 'active' : ''}" data-nav="${n.id}">
      ${icons[n.icon]}<span>${n.label}</span>
      ${n.id === 'paie' ? '<span class="nav-pill">FCFA</span>' : ''}
    </button>`).join('');

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark">C</div>
          <div>
            <div class="brand-name">Chrono<span>RH</span></div>
            <div class="brand-sub">Pointage · Paie · FCFA</div>
          </div>
        </div>
        <div class="nav-section">
          <div class="nav-label">Navigation</div>
          ${navItems}
          <div class="nav-label" style="margin-top:8px">Outils</div>
          <button class="nav-item" data-nav="borne">
            ${icons.tablet}<span>Borne tablette</span><span class="nav-pill">Kiosque</span>
          </button>
        </div>
        <div class="sidebar-footer">
          <div class="user-card">
            <div class="avatar" style="background:${ROLE_COLORS[state.user.role]}">${esc(initials(state.user.name))}</div>
            <div style="min-width:0">
              <div class="user-name">${esc(state.user.name)}</div>
              <div class="user-role">${ROLE_LABELS[state.user.role]}</div>
            </div>
            <button class="logout-btn" id="btn-logout" title="Déconnexion">${icons.logout}</button>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="btn-icon menu-btn" id="btn-menu">${icons.menu}</button>
          <div>
            <h1>${esc(title)}</h1>
          </div>
          <div class="topbar-right">
            <div class="live-chip"><span class="dot"></span> Système actif</div>
            <div class="tiny muted nowrap" id="top-clock"></div>
          </div>
        </header>
        <div class="content" id="view"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  app.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('open');
      go('#/' + b.dataset.nav);
    }));
  app.querySelector('#btn-logout').addEventListener('click', async () => {
    await api.post('/auth/logout');
    state.user = null;
    go('#/login');
    render();
  });
  app.querySelector('#btn-menu')?.addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('open'));

  const clockEl = document.getElementById('top-clock');
  const tick = () => {
    if (clockEl) clockEl.textContent = new Date().toLocaleString('fr-FR', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };
  tick();
  const timer = setInterval(tick, 1000);
  setTimeout(() => clearInterval(timer), 120000);

  const view = document.getElementById('view');
  const ctx = { state, route, go, refresh: render };
  const map = {
    dashboard: renderDashboard,
    employes: renderEmployes,
    pointages: renderPointages,
    paie: renderPaie,
    rapports: renderRapports,
    utilisateurs: renderUtilisateurs,
    parametres: renderParametres,
  };
  (map[route] || renderDashboard)(view, ctx).catch((e) => {
    view.innerHTML = `<div class="empty"><b>Erreur de chargement</b><div>${esc(e.message)}</div></div>`;
  });
}

window.addEventListener('hashchange', render);
boot();

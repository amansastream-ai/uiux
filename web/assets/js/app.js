/**
 * SunuÉcole — Bootstrap, coquille applicative et navigation.
 *
 * La navigation est construite selon le rôle : chaque utilisateur ne voit que
 * ce qui le concerne, ce qui réduit la charge cognitive et accélère l'adoption.
 */
import { api, bus, getToken, setToken, setRefreshToken, getRefreshToken, clearCache, applyPrefs, getPrefs } from './core/api.js';
import { store, route, startRouter, navigate, go, updatePrefs, cycleTheme, cycleDensity, toggleSidebar, currentPath, rerender } from './core/store.js';
import { icon } from './core/icons.js';
import { h, esc, toast, toastOk, toastErr, openPalette, avatar, badge, emptyState, modal, drawer } from './ui/components.js';
import { ROLES, relatif, num } from './core/format.js';

import { loginView } from './views/login.js';
import { registerDashboard } from './views/dashboard.js';
import { registerStudents } from './views/students.js';
import { registerAcademics } from './views/academics.js';
import { registerVieScolaire } from './views/vie-scolaire.js';
import { registerFinance } from './views/finance.js';
import { registerPeople } from './views/people.js';
import { registerComms } from './views/comms.js';
import { registerPortails } from './views/portails.js';
import { registerSettings } from './views/settings.js';

/* ================================================================== */
/* NAVIGATION PAR RÔLE                                                 */
/* ================================================================== */
const NAV = [
  {
    group: 'Pilotage', roles: ['direction', 'censeur', 'comptable', 'secretaire', 'enseignant', 'super_admin', 'bibliothecaire', 'infirmier', 'surveillant'],
    items: [
      { to: '/', label: 'Tableau de bord', icon: 'dashboard' },
      { to: '/alertes', label: 'Alertes', icon: 'alert-triangle', badgeKey: 'alerts', roles: ['direction', 'censeur', 'comptable', 'secretaire'] },
    ],
  },
  {
    group: 'Scolarité', roles: ['direction', 'censeur', 'secretaire', 'super_admin', 'comptable'],
    items: [
      { to: '/scolaire/eleves', label: 'Élèves', icon: 'users', badgeKey: 'students' },
      { to: '/scolaire/classes', label: 'Classes & niveaux', icon: 'school' },
      { to: '/scolaire/familles', label: 'Familles', icon: 'contact-card' },
      { to: '/scolaire/admissions', label: 'Admissions', icon: 'user-plus', roles: ['direction', 'secretaire'] },
      { to: '/scolaire/emploi-du-temps', label: 'Emploi du temps', icon: 'calendar-days' },
    ],
  },
  {
    group: 'Vie scolaire', roles: ['direction', 'censeur', 'secretaire', 'enseignant', 'surveillant', 'super_admin'],
    items: [
      { to: '/vie-scolaire/presences', label: 'Appel & présences', icon: 'clipboard-check' },
      { to: '/vie-scolaire/absences', label: 'Absences', icon: 'clock-alert' },
      { to: '/vie-scolaire/discipline', label: 'Discipline', icon: 'shield', roles: ['direction', 'censeur', 'secretaire', 'surveillant'] },
    ],
  },
  {
    group: 'Pédagogie', roles: ['direction', 'censeur', 'enseignant', 'secretaire', 'super_admin'],
    items: [
      { to: '/pedagogie/notes', label: 'Notes & évaluations', icon: 'pen-tool' },
      { to: '/pedagogie/resultats', label: 'Résultats de classe', icon: 'chart-line', roles: ['direction', 'censeur', 'enseignant'] },
      { to: '/pedagogie/bulletins', label: 'Bulletins', icon: 'file-text' },
      { to: '/pedagogie/cahier', label: 'Cahier de textes', icon: 'notebook' },
      { to: '/pedagogie/devoirs', label: 'Devoirs', icon: 'book-marked' },
    ],
  },
  {
    group: 'Finances', roles: ['direction', 'comptable', 'secretaire', 'super_admin'],
    items: [
      { to: '/finance', label: 'Vue financière', icon: 'chart' },
      { to: '/finance/factures', label: 'Factures', icon: 'receipt' },
      { to: '/finance/paiements', label: 'Paiements', icon: 'banknote' },
      { to: '/finance/impayes', label: 'Impayés & relances', icon: 'alert-circle' },
      { to: '/finance/frais', label: 'Frais scolaires', icon: 'tag', roles: ['direction', 'comptable'] },
      { to: '/finance/depenses', label: 'Dépenses', icon: 'wallet' },
      { to: '/finance/paie', label: 'Paie du personnel', icon: 'briefcase', roles: ['direction', 'comptable'] },
    ],
  },
  {
    group: 'Personnel', roles: ['direction', 'comptable', 'secretaire', 'super_admin'],
    items: [
      { to: '/personnel', label: 'Équipe', icon: 'users' },
      { to: '/personnel/conges', label: 'Congés & pointage', icon: 'calendar-check' },
    ],
  },
  {
    group: 'Services', roles: ['direction', 'secretaire', 'bibliothecaire', 'infirmier', 'censeur', 'super_admin'],
    items: [
      { to: '/services/bibliotheque', label: 'Bibliothèque', icon: 'library' },
      { to: '/services/cantine', label: 'Cantine', icon: 'utensils' },
      { to: '/services/transport', label: 'Transport', icon: 'bus' },
      { to: '/services/infirmerie', label: 'Infirmerie', icon: 'heart-pulse', roles: ['direction', 'infirmier', 'secretaire'] },
      { to: '/administration/documents', label: 'Documents administratifs', icon: 'folder' },
    ],
  },
  {
    group: 'Communication', roles: ['direction', 'censeur', 'secretaire', 'enseignant', 'comptable', 'super_admin', 'bibliothecaire', 'infirmier', 'surveillant'],
    items: [
      { to: '/communication/messages', label: 'Annonces & messages', icon: 'megaphone' },
      { to: '/communication/sms', label: 'SMS', icon: 'sms', roles: ['direction', 'secretaire', 'comptable', 'censeur'] },
      { to: '/communication/evenements', label: 'Calendrier', icon: 'calendar' },
    ],
  },
  {
    group: 'Paramètres', roles: ['direction', 'secretaire', 'comptable', 'censeur', 'super_admin'],
    items: [
      { to: '/parametres', label: 'Établissement', icon: 'school', roles: ['direction', 'super_admin'] },
      { to: '/parametres/structure', label: 'Structure & matières', icon: 'layers', roles: ['direction', 'secretaire', 'censeur'] },
      { to: '/parametres/utilisateurs', label: 'Comptes & droits', icon: 'shield-check', roles: ['direction', 'secretaire', 'comptable', 'super_admin'] },
      { to: '/parametres/abonnement', label: 'Abonnement', icon: 'rocket' },
      { to: '/parametres/audit', label: 'Journal d\'audit', icon: 'history', roles: ['direction', 'censeur', 'super_admin'] },
      { to: '/parametres/preferences', label: 'Mes préférences', icon: 'sliders', roles: '*' },
    ],
  },
  {
    group: 'Mon espace', roles: ['parent'],
    items: [
      { to: '/parent', label: 'Accueil', icon: 'home' },
      { to: '/parent/enfants', label: 'Mes enfants', icon: 'users' },
      { to: '/parent/notes', label: 'Notes & bulletins', icon: 'file-text' },
      { to: '/parent/presences', label: 'Présences', icon: 'clipboard-check' },
      { to: '/parent/factures', label: 'Factures & paiement', icon: 'wallet' },
      { to: '/parent/devoirs', label: 'Devoirs', icon: 'book-marked' },
      { to: '/parent/messages', label: 'Messages', icon: 'megaphone' },
      { to: '/parent/calendrier', label: 'Calendrier', icon: 'calendar' },
      { to: '/parametres/preferences', label: 'Mes préférences', icon: 'sliders' },
    ],
  },
  {
    group: 'Mon espace', roles: ['eleve'],
    items: [
      { to: '/eleve', label: 'Accueil', icon: 'home' },
      { to: '/eleve/notes', label: 'Mes notes', icon: 'pen-tool' },
      { to: '/eleve/bulletins', label: 'Mes bulletins', icon: 'file-text' },
      { to: '/eleve/emploi-du-temps', label: 'Emploi du temps', icon: 'calendar-days' },
      { to: '/eleve/devoirs', label: 'Mes devoirs', icon: 'book-marked' },
      { to: '/eleve/presences', label: 'Mes présences', icon: 'clipboard-check' },
      { to: '/eleve/messages', label: 'Messages', icon: 'megaphone' },
      { to: '/parametres/preferences', label: 'Mes préférences', icon: 'sliders' },
    ],
  },
];

/** Navigation filtrée selon le rôle courant. */
export function navFor(role) {
  return NAV
    .filter((g) => g.roles.includes(role) || g.roles.includes('*'))
    .map((g) => ({
      group: g.group,
      items: g.items.filter((i) => !i.roles || i.roles.includes(role) || i.roles.includes('*')),
    }))
    .filter((g) => g.items.length);
}

/** Nav mobile (5 entrées max, les plus utiles selon le rôle). */
const MOBILE_NAV = {
  direction: [['/', 'Accueil', 'dashboard'], ['/scolaire/eleves', 'Élèves', 'users'], ['/vie-scolaire/presences', 'Appel', 'clipboard-check'], ['/finance', 'Finance', 'wallet'], ['/communication/messages', 'Messages', 'megaphone']],
  enseignant: [['/', 'Accueil', 'home'], ['/vie-scolaire/presences', 'Appel', 'clipboard-check'], ['/pedagogie/notes', 'Notes', 'pen-tool'], ['/pedagogie/cahier', 'Cahier', 'notebook'], ['/communication/messages', 'Messages', 'megaphone']],
  parent: [['/parent', 'Accueil', 'home'], ['/parent/enfants', 'Enfants', 'users'], ['/parent/notes', 'Notes', 'file-text'], ['/parent/factures', 'Payer', 'wallet'], ['/parent/messages', 'Messages', 'megaphone']],
  eleve: [['/eleve', 'Accueil', 'home'], ['/eleve/notes', 'Notes', 'pen-tool'], ['/eleve/emploi-du-temps', 'Emploi', 'calendar-days'], ['/eleve/devoirs', 'Devoirs', 'book-marked'], ['/eleve/messages', 'Messages', 'megaphone']],
};

/* ================================================================== */
/* TITRES DE PAGES (pour la barre supérieure et l'onglet navigateur)   */
/* ================================================================== */
const TITLES = {
  '/': 'Tableau de bord',
  '/alertes': 'Alertes',
  '/scolaire/eleves': 'Élèves',
  '/scolaire/classes': 'Classes & niveaux',
  '/scolaire/familles': 'Familles & tuteurs',
  '/scolaire/admissions': 'Admissions',
  '/scolaire/emploi-du-temps': 'Emploi du temps',
  '/vie-scolaire/presences': 'Appel & présences',
  '/vie-scolaire/absences': 'Absences & justificatifs',
  '/vie-scolaire/discipline': 'Discipline',
  '/pedagogie/notes': 'Notes & évaluations',
  '/pedagogie/resultats': 'Résultats de classe',
  '/pedagogie/bulletins': 'Bulletins',
  '/pedagogie/cahier': 'Cahier de textes',
  '/pedagogie/devoirs': 'Devoirs',
  '/finance': 'Vue financière',
  '/finance/factures': 'Factures',
  '/finance/paiements': 'Paiements',
  '/finance/impayes': 'Impayés & relances',
  '/finance/frais': 'Frais scolaires',
  '/finance/depenses': 'Dépenses',
  '/finance/paie': 'Paie du personnel',
  '/personnel': 'Équipe',
  '/personnel/conges': 'Congés & pointage',
  '/services/bibliotheque': 'Bibliothèque',
  '/services/cantine': 'Cantine',
  '/services/transport': 'Transport scolaire',
  '/services/infirmerie': 'Infirmerie',
  '/administration/documents': 'Documents administratifs',
  '/communication/messages': 'Annonces & messages',
  '/communication/sms': 'Campagnes SMS',
  '/communication/evenements': 'Calendrier scolaire',
  '/parametres': 'Établissement',
  '/parametres/structure': 'Structure & matières',
  '/parametres/utilisateurs': 'Comptes & droits',
  '/parametres/abonnement': 'Abonnement',
  '/parametres/audit': 'Journal d\'audit',
  '/parametres/preferences': 'Mes préférences',
  '/parent': 'Espace parents',
  '/parent/enfants': 'Mes enfants',
  '/parent/notes': 'Notes & bulletins',
  '/parent/presences': 'Présences',
  '/parent/factures': 'Factures & paiement',
  '/parent/devoirs': 'Devoirs',
  '/parent/messages': 'Messages',
  '/parent/calendrier': 'Calendrier',
  '/eleve': 'Espace élève',
  '/eleve/notes': 'Mes notes',
  '/eleve/bulletins': 'Mes bulletins',
  '/eleve/emploi-du-temps': 'Emploi du temps',
  '/eleve/devoirs': 'Mes devoirs',
  '/eleve/presences': 'Mes présences',
  '/eleve/messages': 'Messages',
  '/plateforme': 'Administration plateforme',
};

/* ================================================================== */
/* COQUILLE                                                            */
/* ================================================================== */
function shell() {
  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = `
    <div class="loading-bar" id="loading-bar" hidden><i></i></div>
    <div class="banner-offline">${icon('cloud-off', { size: 15 })}
      <span>Vous êtes hors connexion. L'appel et la saisie des notes restent possibles : ils seront synchronisés au retour du réseau.</span>
      <span class="grow"></span><button class="btn btn-sm btn-secondary" id="retry-online">Réessayer</button>
    </div>
    <div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Navigation principale">
        <div class="sidebar-head">
          <span class="brand-mark">${icon('graduation-cap', { size: 22, strokeWidth: 1.9 })}</span>
          <span class="brand-text">
            <span class="brand-name">SunuÉcole</span>
            <span class="brand-sub">Gestion scolaire</span>
          </span>
        </div>
        <div id="school-slot"></div>
        <nav class="nav" id="nav"></nav>
        <div class="sidebar-foot">
          <span class="sidebar-foot-text"><b id="foot-name">—</b><span id="foot-role">—</span></span>
          <button class="btn btn-ghost btn-icon" id="btn-logout" title="Se déconnecter" aria-label="Se déconnecter" style="color:var(--sidebar-text);margin-left:auto">${icon('log-out', { size: 17 })}</button>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon only-mobile" id="btn-menu" aria-label="Ouvrir la navigation">${icon('menu', { size: 20 })}</button>
          <div class="topbar-title">
            <h1 id="page-title">Tableau de bord</h1>
            <span class="crumb hide-sm" id="page-crumb"></span>
          </div>
          <button class="searchbar" id="btn-search" aria-label="Rechercher (Ctrl+K)">
            ${icon('search', { size: 15 })}<span>Rechercher un élève, une facture…</span>
            <span class="kbd-hint hide-sm"><kbd>Ctrl</kbd><kbd>K</kbd></span>
          </button>
          <div class="row gap-1">
            <button class="btn btn-ghost btn-icon hide-sm" id="btn-theme" aria-label="Changer de thème" title="Thème">${icon('sun', { size: 18 })}</button>
            <div style="position:relative">
              <button class="btn btn-ghost btn-icon" id="btn-notif" aria-label="Notifications" title="Notifications">${icon('bell', { size: 18 })}<span id="notif-dot"></span></button>
            </div>
            <button class="btn btn-ghost btn-icon" id="btn-user" aria-label="Mon compte" aria-haspopup="menu" style="padding:3px">
              <span id="user-avatar"></span>
            </button>
          </div>
        </header>
        <main class="content" id="main"><div id="view-root"></div></main>
      </div>
    </div>
    <nav class="mobile-nav" id="mobile-nav" aria-label="Navigation rapide"></nav>`;
  return app;
}

function renderNav() {
  const u = store.state.user;
  if (!u) return;
  const groups = navFor(u.role);
  const counts = store.state.badges || {};
  const nav = document.getElementById('nav');
  const path = currentPath();
  nav.innerHTML = groups.map((g) => `<div class="nav-group">
      <div class="nav-group-title">${esc(g.group)}</div>
      ${g.items.map((it) => {
        const active = it.to === '/' ? path === '/' : path.startsWith(it.to);
        const n = counts[it.badgeKey];
        return `<a class="nav-item" href="#${it.to}" ${active ? 'aria-current="page"' : ''} title="${esc(it.label)}">
          ${icon(it.icon, { size: 18 })}<span class="nav-label">${esc(it.label)}</span>
          ${n ? `<span class="nav-badge ${it.badgeKey === 'alerts' ? 'data-tone="danger"' : ''}">${n > 99 ? '99+' : n}</span>` : ''}</a>`;
      }).join('')}
    </div>`).join('');

  // Nav mobile
  const mn = document.getElementById('mobile-nav');
  const items = MOBILE_NAV[u.role] || MOBILE_NAV.direction;
  mn.innerHTML = items.map(([to, label, ic]) => {
    const active = to === '/' ? path === '/' : path.startsWith(to);
    return `<a href="#${to}" ${active ? 'aria-current="page"' : ''}>${icon(ic, { size: 19 })}<span>${esc(label)}</span></a>`;
  }).join('');

  // Pied de sidebar
  document.getElementById('foot-name').textContent = `${u.firstName} ${u.lastName}`;
  document.getElementById('foot-role').textContent = u.roleLabel || ROLES[u.role] || u.role;
  document.getElementById('user-avatar').innerHTML = avatar({ first: u.firstName, last: u.lastName, color: u.avatarColor, size: 'avatar-sm' });

  // Sélecteur d'établissement (visible pour la direction et le super admin)
  const slot = document.getElementById('school-slot');
  const s = u.school;
  if (s) {
    slot.innerHTML = `<button class="school-switcher" id="school-btn" aria-label="Établissement : ${esc(s.name)}">
      <span style="width:28px;height:28px;border-radius:9px;background:linear-gradient(140deg,var(--brand-500),var(--brand-700));display:grid;place-items:center;color:#fff;font-weight:700;font-size:11px;flex-shrink:0">${esc(s.name.split(' ').filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
      <span class="school-switcher-text">
        <span class="school-switcher-name">${esc(s.name)}</span>
        <span class="school-switcher-plan">${icon('sparkles', { size: 10 })} Plan ${esc(s.plan ? s.plan[0].toUpperCase() + s.plan.slice(1) : '')} · ${esc(s.academicYear || '')}</span>
      </span>
      ${icon('chevron-right', { size: 14 })}
    </button>`;
    document.getElementById('school-btn').addEventListener('click', () => go('/parametres/abonnement'));
  }
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
async function loadBadges() {
  const u = store.state.user;
  if (!u) return;
  try {
    const [notif, alerts] = await Promise.all([
      api.get('/comms/notifications?limit=1', { cacheTtl: 15000 }),
      store.atLeast(65) ? api.get('/dashboard/alerts', { cacheTtl: 30000 }).catch(() => ({ data: { total: 0 } })) : Promise.resolve({ data: { total: 0 } }),
    ]);
    store.set({
      unread: notif.data?.unread || 0,
      notifications: [],
      badges: { alerts: alerts.data?.total || 0 },
    });
    paintNotifDot();
    renderNav();
  } catch { /* silencieux */ }
}

function paintNotifDot() {
  const dot = document.getElementById('notif-dot');
  if (!dot) return;
  const n = store.state.unread;
  dot.innerHTML = n
    ? `<span style="position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;font-variant-numeric:tabular-nums">${n > 9 ? '9+' : n}</span>`
    : '';
}

async function showNotifications() {
  const panel = document.createElement('div');
  panel.innerHTML = `<div style="padding:26px;text-align:center">${icon('bell', { size: 24 })}<div class="subtle small mt-3">Chargement des notifications…</div></div>`;
  const d = drawer({
    title: 'Notifications',
    subtitle: `<button class="btn btn-link btn-sm" id="mark-all" style="padding:0">Tout marquer comme lu</button>`,
    body: panel,
  });
  try {
    const res = await api.get('/comms/notifications?limit=30');
    const list = res.data?.notifications || [];
    store.set({ unread: res.data?.unread || 0 });
    paintNotifDot();
    if (!list.length) {
      panel.innerHTML = emptyState({ icon: 'bell', title: 'Aucune notification', message: 'Vous serez prévenu ici des absences, paiements, notes et messages importants.' });
      return;
    }
    panel.innerHTML = list.map((n) => `<div class="list-item clickable ${n.read_at ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}">
        <span style="width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;
          background:${n.type === 'alerte' || n.priority === 'haute' ? 'var(--danger-bg)' : n.type === 'paiement' ? 'var(--ok-bg)' : 'var(--info-bg)'};
          color:${n.type === 'alerte' || n.priority === 'haute' ? 'var(--danger)' : n.type === 'paiement' ? 'var(--ok)' : 'var(--info)'}">
          ${icon(n.type === 'paiement' ? 'banknote' : n.type === 'absence' ? 'clock-alert' : n.type === 'note' ? 'pen-tool' : n.type === 'facture' ? 'receipt' : n.type === 'evenement' ? 'calendar' : n.type === 'alerte' ? 'alert-triangle' : 'bell', { size: 16 })}
        </span>
        <div class="li-body"><div class="li-title">${esc(n.title)}</div><div class="li-sub">${esc(n.body || '')}</div></div>
        <div class="li-aside"><div class="li-time">${relatif(n.created_at)}</div></div>
      </div>`).join('');
    panel.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const link = el.dataset.link;
        api.post('/comms/notifications/read', { ids: [Number(el.dataset.id)] }).then(() => { store.set({ unread: Math.max(0, store.state.unread - 1) }); paintNotifDot(); }).catch(() => {});
        el.classList.remove('unread');
        d.close();
        if (link) go(link);
      });
    });
    panel.parentElement.querySelector('#mark-all')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.post('/comms/notifications/read', { all: true });
      store.set({ unread: 0 });
      paintNotifDot();
      panel.querySelectorAll('.unread').forEach((el) => el.classList.remove('unread'));
      toastOk('Notifications', 'Toutes vos notifications ont été marquées comme lues.');
    });
  } catch (err) {
    panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
  }
}

/* ------------------------------------------------------------------ */
/* Menu utilisateur                                                    */
/* ------------------------------------------------------------------ */
function showUserMenu(anchor) {
  const u = store.state.user;
  const items = [
    { label: `${u.firstName} ${u.lastName}`, sub: u.email, disabled: true },
    { separator: true },
    { id: 'prefs', label: 'Mes préférences', icon: 'sliders', run: () => go('/parametres/preferences') },
    { id: 'theme', label: `Thème : ${themeLabel()}`, icon: store.state.prefs.theme === 'dark' ? 'moon' : 'sun', run: () => { cycleTheme(); refreshThemeBtn(); } },
    { id: 'density', label: `Densité : ${store.state.prefs.density || 'confort'}`, icon: 'table', run: () => { cycleDensity(); toastInfo('Densité modifiée', 'L\'affichage a été ajusté.'); } },
    { separator: true },
    ...(store.is('direction', 'super_admin') ? [{ id: 'school', label: 'Paramètres de l\'établissement', icon: 'school', run: () => go('/parametres') }] : []),
    { id: 'help', label: 'Aide & raccourcis', icon: 'life-buoy', run: showHelp },
    { id: 'logout', label: 'Se déconnecter', icon: 'log-out', danger: true, run: logout },
  ];
  const el = h(`<div role="menu" style="position:fixed;z-index:280;min-width:238px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-lg);padding:5px">
    ${items.map((it, i) => {
      if (it.separator) return '<div class="divider" style="margin:4px 0"></div>';
      if (it.disabled) return `<div style="padding:9px 10px"><div style="font-size:13.5px;font-weight:660">${esc(it.label)}</div><div class="tiny subtle">${esc(it.sub || '')}</div><div class="mt-2">${badge(ROLES[u.role] || u.role, 'brand')}</div></div>`;
      return `<button role="menuitem" data-i="${i}" style="display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:var(--r-sm);font-size:13px;font-weight:560;text-align:left;color:${it.danger ? 'var(--danger)' : 'var(--text-2)'}">
        ${icon(it.icon, { size: 16 })}${esc(it.label)}</button>`;
    }).join('')}
  </div>`);
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(r.left, window.innerWidth - el.offsetWidth - 8)}px`;
  el.style.top = `${r.bottom + 6}px`;
  const close = () => { el.remove(); document.removeEventListener('click', out); document.removeEventListener('keydown', key); };
  const out = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') { close(); anchor.focus(); } };
  setTimeout(() => { document.addEventListener('click', out); document.addEventListener('keydown', key); }, 0);
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { close(); items[Number(b.dataset.i)].run?.(); }));
  el.querySelector('[role=menuitem]')?.focus();
}
const themeLabel = () => ({ light: 'clair', dark: 'sombre', auto: 'automatique' }[store.state.prefs.theme || 'auto']);
function refreshThemeBtn() {
  const b = document.getElementById('btn-theme');
  if (!b) return;
  const t = document.documentElement.dataset.theme;
  b.innerHTML = icon(t === 'dark' ? 'moon' : 'sun', { size: 18 });
  b.title = `Thème ${themeLabel()} — cliquez pour changer`;
}

/* ------------------------------------------------------------------ */
/* Aide & raccourcis                                                   */
/* ------------------------------------------------------------------ */
function showHelp() {
  const shortcuts = [
    ['Ctrl + K', 'Recherche globale et actions'],
    ['G puis E', 'Aller aux élèves'],
    ['G puis P', 'Aller aux présences (appel)'],
    ['G puis F', 'Aller aux finances'],
    ['G puis D', 'Retour au tableau de bord'],
    ['N', 'Nouvelle action sur la page courante'],
    ['/', 'Focus sur la recherche de la page'],
    ['Échap', 'Fermer une fenêtre ou un panneau'],
    ['1 à 4', 'Pendant l\'appel : Présent, Absent, Retard, Excusé'],
    ['Entrée', 'Pendant l\'appel : élève suivant'],
  ];
  modal({
    title: 'Aide & raccourcis clavier',
    subtitle: 'SunuÉcole est pensé pour un usage intensif au clavier.',
    body: `<div class="col gap-4">
      <div>${shortcuts.map(([k, d]) => `<div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--border-subtle)">
        <span class="small">${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>
      <div class="alert alert-brand">${icon('info', { size: 17 })}<div class="alert-body">
        <div class="alert-title">Mode hors-ligne</div>
        <div class="alert-msg">L'application fonctionne sans connexion : l'appel et la saisie des notes sont conservés sur l'appareil puis synchronisés automatiquement dès que le réseau revient. Vous pouvez aussi « Installer l'application » depuis le menu de votre navigateur pour un accès en un clic.</div>
      </div></div>
    </div>`,
    footer: `<button class="btn btn-primary" data-dismiss>Compris</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* Palette de commandes                                                */
/* ================================================================== */
async function paletteItems(term) {
  const u = store.state.user;
  const groups = navFor(u.role);
  const navItems = groups.flatMap((g) => g.items.map((it) => ({
    group: 'Navigation', label: it.label, sub: g.group, icon: it.icon, run: () => go(it.to),
  })));
  const actions = [
    { group: 'Actions', label: 'Faire l\'appel', icon: 'clipboard-check', run: () => go('/vie-scolaire/presences'), hint: '' },
    { group: 'Actions', label: 'Encaisser un paiement', icon: 'banknote', run: () => go('/finance/paiements?new=1') },
    { group: 'Actions', label: 'Nouvel élève', icon: 'user-plus', run: () => go('/scolaire/eleves?new=1') },
    { group: 'Actions', label: 'Envoyer une annonce', icon: 'megaphone', run: () => go('/communication/messages?new=1') },
    { group: 'Actions', label: 'Générer des bulletins', icon: 'file-text', run: () => go('/pedagogie/bulletins') },
    { group: 'Actions', label: 'Relancer les impayés par SMS', icon: 'sms', run: () => go('/finance/impayes') },
    { group: 'Actions', label: 'Imprimer le journal de caisse', icon: 'printer', run: () => go('/finance/paiements?journal=1') },
    { group: 'Préférences', label: `Changer le thème (${themeLabel()})`, icon: 'contrast', run: () => { cycleTheme(); refreshThemeBtn(); } },
    { group: 'Préférences', label: 'Changer la densité d\'affichage', icon: 'table', run: () => cycleDensity() },
    { group: 'Préférences', label: 'Aide & raccourcis', icon: 'life-buoy', run: showHelp },
    { group: 'Compte', label: 'Se déconnecter', icon: 'log-out', run: logout },
  ].filter((a) => {
    const role = u.role;
    if (a.label.includes('appel') && !['direction', 'enseignant', 'censeur', 'secretaire', 'surveillant'].includes(role)) return false;
    if (a.label.includes('paiement') || a.label.includes('impayés') || a.label.includes('caisse')) return ['direction', 'comptable', 'secretaire'].includes(role);
    if (a.label.includes('bulletins') || a.label.includes('annonce')) return ['direction', 'censeur', 'secretaire', 'enseignant'].includes(role);
    if (a.label.includes('élève')) return ['direction', 'secretaire'].includes(role);
    return true;
  });

  const t = term.trim().toLowerCase();
  if (!t) return [...actions.slice(0, 6), ...navItems.slice(0, 10)];

  const local = [...actions, ...navItems].filter((i) => `${i.label} ${i.sub || ''}`.toLowerCase().includes(t));
  let remote = [];
  if (t.length >= 2) {
    try {
      const r = await api.get(`/students/search/global?q=${encodeURIComponent(term)}`);
      remote = (r.data?.results || []).map((x) => {
        const map = {
          eleve: { icon: 'user', group: 'Élèves', label: `${x.first_name} ${x.last_name}`, sub: `${x.matricule || ''} · ${x.classe || ''}`, run: () => go(`/scolaire/eleves/${x.id}`) },
          classe: { icon: 'school', group: 'Classes', label: x.name, sub: 'Ouvrir la classe', run: () => go(`/scolaire/classes/${x.id}`) },
          personnel: { icon: 'briefcase', group: 'Personnel', label: x.name, sub: x.job_title || '', run: () => go(`/personnel/${x.id}`) },
          facture: { icon: 'receipt', group: 'Factures', label: x.invoice_number, sub: `${x.first_name} ${x.last_name} · ${num(x.amount)} FCFA`, run: () => go(`/finance/factures/${x.id}`) },
          matiere: { icon: 'book-open', group: 'Matières', label: x.name, sub: x.code, run: () => go('/parametres/structure') },
        };
        return map[x.type];
      }).filter(Boolean);
    } catch { /* recherche distante indisponible */ }
  }
  return [...remote, ...local];
}

/* ================================================================== */
/* CYCLE DE VIE                                                        */
/* ================================================================== */
async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setToken(null);
  clearCache();
  store.set({ user: null, school: null });
  navigate('/', { replace: true });
  mountAuth();
  toastInfo('À bientôt', 'Vous êtes déconnecté.');
}

function mountAuth(notice = null) {
  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = '';
  document.body.classList.remove('is-offline-shell');
  app.appendChild(loginView({ onLoggedIn: mountApp, notice }));
}

/** Vrai si l'écran de connexion est déjà affiché (évite les remontages en boucle). */
const onAuthScreen = () => !!document.querySelector('#app .auth-page');

/**
 * Le serveur ne répond pas au démarrage (redémarrage, coupure, proxy).
 * On garde la session et on propose de réessayer : pas de déconnexion punitive.
 */
function mountBootError(err) {
  const app = document.getElementById('app');
  app.hidden = false;
  app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:22px">
    <div class="card" style="max-width:460px;width:100%">
      <div class="card-body" style="padding:34px 26px;text-align:center">
        <span class="empty-icon">${icon('wifi-off', { size: 30 })}</span>
        <h1 class="h-page" style="margin:12px 0 6px">Serveur injoignable</h1>
        <p class="subtle small" style="line-height:1.6">
          SunuÉcole n’arrive pas à contacter son serveur pour le moment.
          Votre session est conservée — réessayez dans quelques secondes.</p>
        <p class="tiny subtle mt-3" style="word-break:break-word">${esc(err?.message || '')}</p>
        <div class="row gap-2 mt-4" style="justify-content:center">
          <button class="btn btn-primary" id="boot-retry">${icon('refresh', { size: 15 })} Réessayer</button>
          <button class="btn btn-secondary" id="boot-relogin">${icon('log-in', { size: 15 })} Changer de compte</button>
          <button class="btn btn-link btn-sm" id="boot-reset">${icon('refresh', { size: 14 })} Vider le cache et redémarrer</button>
        </div>
      </div></div></div>`;
  app.querySelector('#boot-retry').addEventListener('click', () => location.reload());
  app.querySelector('#boot-relogin').addEventListener('click', () => { setToken(null); clearCache(); mountAuth(); });
  app.querySelector('#boot-reset')?.addEventListener('click', async () => {
    if (typeof window.sunuecoleReset === 'function') await window.sunuecoleReset();
    else location.reload();
  });
}

/**
 * Fin de session (jeton expiré, invalide, base réinitialisée, révocation).
 * Toujours ramener l'utilisateur sur l'écran de connexion avec un message clair :
 * aucun écran ne doit rester bloqué sur « indisponible ».
 */
function endSession(notice) {
  setToken(null);
  clearCache();
  store.set({ user: null, school: null });
  if (onAuthScreen()) return;
  toast({ title: notice?.title || 'Session expirée', message: notice?.message || 'Merci de vous reconnecter.', tone: 'warn' });
  navigate('/', { replace: true });
  mountAuth(notice);
}

let badgeTimer = null;

function mountApp() {
  shell();
  renderNav();
  refreshThemeBtn();
  wireShell();
  startRouter();
  loadBadges();
  if (!store.state.online) document.body.classList.add('is-offline');
  // Rafraîchissement périodique léger des compteurs (notifications, alertes)
  if (badgeTimer) clearInterval(badgeTimer);
  badgeTimer = setInterval(() => { if (document.visibilityState === 'visible' && store.state.user) loadBadges(); }, 90000);
}

function wireShell() {
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-search').addEventListener('click', () => openPalette(paletteItems));
  document.getElementById('btn-theme').addEventListener('click', () => { cycleTheme(); refreshThemeBtn(); });
  document.getElementById('btn-notif').addEventListener('click', showNotifications);
  document.getElementById('btn-user').addEventListener('click', (e) => showUserMenu(e.currentTarget));
  document.getElementById('btn-menu').addEventListener('click', () => {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    const scrim = h('<div class="scrim open" style="z-index:59"></div>');
    document.body.appendChild(scrim);
    const close = () => { sb.classList.remove('open'); scrim.remove(); };
    scrim.addEventListener('click', close);
  });
  document.getElementById('retry-online').addEventListener('click', async () => {
    const r = await api.flushQueue();
    if (r.applied) toastOk('Synchronisation', `${r.applied} opération(s) transmise(s).`);
    location.reload();
  });

  bus.addEventListener('route', (e) => {
    const t = e.detail.title || TITLES[currentPath()] || 'SunuÉcole';
    document.getElementById('page-title').textContent = t;
    document.getElementById('page-crumb').textContent = e.detail.group || '';
    document.getElementById('sidebar')?.classList.remove('open');
    document.querySelectorAll('.scrim').forEach((s) => { if (s.style.zIndex === '59') s.remove(); });
  });
  bus.addEventListener('loading', (e) => { document.getElementById('loading-bar').hidden = !e.detail; });
  bus.addEventListener('queued', () => {
    toast({ title: 'Enregistré hors-ligne', message: 'L\'opération sera synchronisée dès le retour du réseau.', tone: 'warn', duration: 3500 });
    renderNav();
  });
  bus.addEventListener('synced', (e) => {
    if (e.detail?.applied) toastOk('Synchronisation terminée', `${e.detail.applied} opération(s) hors-ligne appliquée(s).`);
    clearCache();
    rerender();
  });

  // Raccourcis clavier globaux
  let gPressed = false;
  let gTimer;
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette(paletteItems);
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'g') {
      gPressed = true;
      clearTimeout(gTimer);
      gTimer = setTimeout(() => { gPressed = false; }, 900);
      return;
    }
    if (gPressed) {
      const map = { e: '/scolaire/eleves', p: '/vie-scolaire/presences', f: '/finance', d: '/', n: '/pedagogie/notes', c: '/scolaire/classes', m: '/communication/messages', b: '/pedagogie/bulletins' };
      const to = map[e.key.toLowerCase()];
      if (to) { e.preventDefault(); gPressed = false; go(to); }
      return;
    }
    if (e.key === '/') {
      const s = document.querySelector('[data-search]');
      if (s) { e.preventDefault(); s.focus(); s.select(); }
      return;
    }
    if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      const btn = document.querySelector('[data-new]');
      if (btn) { e.preventDefault(); btn.click(); }
    }
    if (e.key === '?' ) showHelp();
  });
}

/* ================================================================== */
/* DÉMARRAGE                                                           */
/* ================================================================== */
async function boot() {
  applyPrefs(getPrefs());
  const bootEl = document.getElementById('boot');
  const finishBoot = () => { bootEl?.classList.add('done'); setTimeout(() => bootEl?.remove(), 320); };

  // Enregistrement de toutes les routes
  registerDashboard(route);
  registerStudents(route);
  registerAcademics(route);
  registerVieScolaire(route);
  registerFinance(route);
  registerPeople(route);
  registerComms(route);
  registerPortails(route);
  registerSettings(route);

  // 404
  route('*', () => h(`<div class="card">${emptyState({ icon: 'search', title: 'Page introuvable', message: `Aucune page ne correspond à « ${currentPath()} ».` })}<div class="row gap-2 mt-4" style="justify-content:center;padding-bottom:26px"><a class="btn btn-primary" href="#/">Retour au tableau de bord</a></div></div>`), { title: 'Page introuvable' });

  bus.addEventListener('unauthorized', (e) => {
    endSession(e.detail?.notice || {
      title: 'Session expirée',
      message: 'Votre session n’est plus valide. Reconnectez-vous : les comptes de démonstration ci-dessous fonctionnent toujours.',
    });
  });

  if (!getToken()) {
    // Tentative de restauration silencieuse via le cookie de renouvellement
    try {
      const rt = getRefreshToken();
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rt ? { refreshToken: rt } : {}),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.refreshToken) setRefreshToken(j.refreshToken);
        setToken(j.token);
        store.set({ user: j.user, school: j.user?.school || null, prefs: { ...getPrefs(), ...(j.user.preferences || {}) } });
      }
    } catch { /* ignore */ }
  }

  if (getToken()) {
    try {
      const me = await api.get('/auth/me');
      store.set({ user: me.user, school: me.user?.school || null, prefs: { ...getPrefs(), ...(me.user.preferences || {}) } });
      applyPrefs(store.state.prefs);
      mountApp();
    } catch (err) {
      if (err && err.status === 401) {
        // Jeton expiré ou invalide (ex. base de démonstration réinitialisée)
        setToken(null);
        clearCache();
        store.set({ user: null, school: null });
        mountAuth({
          title: 'Reconnexion requise',
          message: 'Votre session précédente n’est plus valide. Choisissez un compte de démonstration ci-dessous : tout est prêt.',
        });
      } else {
        // Serveur injoignable : on conserve le jeton et on propose de réessayer,
        // plutôt que de déconnecter un utilisateur en zone à connexion intermittente.
        mountBootError(err);
      }
    }
  } else {
    mountAuth();
  }
  finishBoot();
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('boot')?.remove();
  document.getElementById('app').hidden = false;
  document.getElementById('app').innerHTML = `<div style="padding:40px;text-align:center">
    <h1 style="font-size:20px">Démarrage impossible</h1>
    <p class="subtle mt-2">${esc(err.message)}</p>
    <button class="btn btn-primary mt-4" onclick="location.reload()">Recharger</button></div>`;
});

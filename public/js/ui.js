/** ChronoRH — helpers UI : formats, icônes, toasts, modales. */

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const fcfa = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n || 0)).replace(/\u202f|\u00a0/g, ' ') + ' FCFA';
export const num = (n, d = 1) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n || 0).replace(/\u202f|\u00a0/g, ' ');
export const hoursLbl = (n) => `${num(n, 2)} h`;

export const dateFR = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
};
export const dateTimeFR = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
export const timeFR = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
export const dayName = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export const ROLE_LABELS = {
  admin: 'Administrateur',
  drh: 'DRH',
  comptable: 'Comptable',
  pointage: 'Gestion pointage'
};
export const ROLE_COLORS = {
  admin: 'linear-gradient(135deg,#1662DD,#124FB0)',
  drh: 'linear-gradient(135deg,#0E9F6E,#0B7A56)',
  comptable: 'linear-gradient(135deg,#E8A317,#C98A0B)',
  pointage: 'linear-gradient(135deg,#6D4AE0,#4A2FBF)'
};

export const initials = (name) => String(name || '?')
  .split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

/* ---------------- Icônes (SVG inline) ---------------- */
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  dashboard: P('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'),
  users: P('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  clock: P('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  money: P('<circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M15 9.5c0-1.2-1.3-2-3-2s-3 .8-3 2 1.3 2 3 2 3 .8 3 2-1.3 2-3 2-3-.8-3-2"/>'),
  chart: P('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  tablet: P('<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/>'),
  logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  search: P('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  plus: P('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  edit: P('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  trash: P('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  qr: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="14.01"/><line x1="21" y1="14" x2="21" y2="14.01"/><line x1="14" y1="21" x2="14" y2="21.01"/><line x1="21" y1="21" x2="21" y2="21.01"/>'),
  fingerprint: P('<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>'),
  check: P('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
  sun: P('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon: P('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  calendar: P('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  download: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  print: P('<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  user: P('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  shield: P('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  bell: P('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  menu: P('<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>'),
  arrowRight: P('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  zap: P('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
};

/* ---------------- Toasts ---------------- */
export function toast(type, title, msg = '') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ico = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
  el.innerHTML = `<div class="t-ico">${ico}</div><div><div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${esc(msg)}</div>` : ''}</div>`;
  root.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------------- Modales ---------------- */
let modalStack = [];
export function modal({ title, body, footer = '', wide = false, onClose = null }) {
  const root = document.getElementById('modal-root');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-head"><h3>${title}</h3><button class="modal-close" data-close>✕</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  const close = () => {
    overlay.remove();
    modalStack = modalStack.filter((m) => m !== overlay);
    if (onClose) onClose();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) close();
  });
  root.appendChild(overlay);
  modalStack.push(overlay);
  return { close, el: overlay };
}

/* ---------------- Composants ---------------- */
export function personCell(first, last, sub = '', color = null) {
  const bg = color || 'linear-gradient(135deg,#1662DD,#124FB0)';
  return `<div class="cell-person">
    <div class="avatar sm" style="background:${bg}">${esc(initials(`${first} ${last}`))}</div>
    <div><div class="nm">${esc(first)} ${esc(last)}</div>${sub ? `<div class="sm">${esc(sub)}</div>` : ''}</div>
  </div>`;
}

export function badge(kind, label) {
  return `<span class="badge ${kind}">${label}</span>`;
}

export const methodBadge = (m) =>
  m === 'qr' ? badge('blue', 'QR') :
  m === 'fingerprint' ? badge('violet', 'Empreinte') :
  badge('gray', 'Manuel');

export function emptyState(icon, title, sub = '') {
  return `<div class="empty">
    <div class="e-ico">${icons[icon] || icons.clock}</div>
    <b>${esc(title)}</b>${sub ? `<div>${esc(sub)}</div>` : ''}
  </div>`;
}

export function confirmDialog(title, msg, onYes) {
  const m = modal({
    title,
    body: `<p class="muted">${esc(msg)}</p>`,
    footer: `<button class="btn outline" data-close>Annuler</button><button class="btn danger" id="cfm-yes">Confirmer</button>`
  });
  m.el.querySelector('#cfm-yes').addEventListener('click', () => { m.close(); onYes(); });
}

/** Barre SVG simple. values: [{label, value, gold}] */
export function barChart(values) {
  const max = Math.max(...values.map((v) => v.value), 1);
  const bars = values.map((v) =>
    `<div class="bar ${v.gold ? 'gold' : ''}" style="height:${Math.max(4, (v.value / max) * 100)}%" title="${esc(v.label)} : ${num(v.value)}">
      <div class="tip">${num(v.value)}</div>
    </div>`).join('');
  const labels = values.map((v) => `<span>${esc(v.label)}</span>`).join('');
  return `<div class="bar-chart">${bars}</div><div class="chart-labels">${labels}</div>`;
}

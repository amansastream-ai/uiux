/**
 * SunuÉcole — Bibliothèque de composants d'interface.
 *
 * Tout est en DOM natif (aucun framework) : démarrage instantané, empreinte
 * mémoire minimale, et compatibilité avec les téléphones d'entrée de gamme
 * très présents dans les établissements.
 */
import { icon } from '../core/icons.js';
import { couleurAvatar, initials } from '../core/format.js';

/** Crée un élément à partir d'une chaîne HTML. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function debounce(fn, wait = 280) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

export function throttle(fn, ms = 200) {
  let last = 0;
  let timer;
  return (...args) => {
    const now = Date.now();
    const rest = ms - (now - last);
    if (rest <= 0) { last = now; fn(...args); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...args); }, rest); }
  };
}

/* ================================================================== */
/* TOASTS                                                              */
/* ================================================================== */
const TONES = { ok: 'check-circle', danger: 'x-circle', warn: 'alert-triangle', info: 'info', brand: 'sparkles' };
export function toast({ title, message, tone = 'ok', duration = 4200, action } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h(`<div class="toast" data-tone="${tone}" role="status">
    <span class="toast-icon">${icon(TONES[tone] || 'info', { size: 20 })}</span>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${esc(title)}</div>` : ''}
      ${message ? `<div class="toast-msg">${esc(message)}</div>` : ''}
      ${action ? `<button class="btn btn-link btn-sm" data-act style="padding-left:0;margin-top:4px">${esc(action.label)}</button>` : ''}
    </div>
    <button class="toast-close" aria-label="Fermer">${icon('x', { size: 15 })}</button>
    <div class="toast-progress" style="animation-duration:${duration}ms"></div>
  </div>`);
  const close = () => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('.toast-close').addEventListener('click', close);
  el.querySelector('[data-act]')?.addEventListener('click', () => { action.onClick?.(); close(); });
  root.appendChild(el);
  // Annonce aux lecteurs d'écran
  const live = document.getElementById('a11y-live');
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = `${title || ''} ${message || ''}`; }, 60); }
  setTimeout(close, duration);
  // Limite : 4 toasts visibles max
  while (root.children.length > 4) root.firstElementChild.remove();
  return close;
}
export const toastOk = (title, message) => toast({ title, message, tone: 'ok' });
export const toastErr = (title, message) => toast({ title: title || 'Opération impossible', message, tone: 'danger', duration: 6500 });
export const toastInfo = (title, message) => toast({ title, message, tone: 'info' });

/* ================================================================== */
/* MODALE & TIROIR                                                     */
/* ================================================================== */
const focusables = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(container, prevFocus) {
  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(focusables)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);
  return () => {
    container.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
}

/**
 * Ouvre une modale. `body` peut être une chaîne HTML ou un nœud.
 * Retourne { close, el }.
 */
export function modal({ title, subtitle, body, footer, size = '', onMount, dismissable = true, icon: iconName } = {}) {
  const prev = document.activeElement;
  const root = document.getElementById('modal-root');
  const layer = h(`<div class="modal-layer"><div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Fenêtre')}">
      <div class="modal-head">
        <div style="display:flex;gap:11px;align-items:flex-start;min-width:0">
          ${iconName ? `<span style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--brand-50,rgba(14,124,102,.1));color:var(--brand-600);flex-shrink:0">${icon(iconName, { size: 18 })}</span>` : ''}
          <div style="min-width:0">
            <h2>${esc(title || '')}</h2>
            ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-icon" data-close aria-label="Fermer">${icon('x', { size: 18 })}</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? '<div class="modal-foot"></div>' : ''}
    </div></div>`);
  const scrim = h('<div class="scrim"></div>');
  const bodyEl = layer.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  if (footer) {
    const f = layer.querySelector('.modal-foot');
    if (typeof footer === 'string') f.innerHTML = footer;
    else f.appendChild(footer);
  }
  root.append(scrim, layer);
  requestAnimationFrame(() => { scrim.classList.add('open'); layer.querySelector('.modal').classList.add('open'); });

  const cleanup = trapFocus(layer, prev);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scrim.classList.remove('open');
    layer.querySelector('.modal').classList.remove('open');
    document.removeEventListener('keydown', onEsc);
    setTimeout(() => { scrim.remove(); layer.remove(); cleanup(); }, 220);
  }
  function onEsc(e) { if (e.key === 'Escape' && dismissable) close(); }
  document.addEventListener('keydown', onEsc);
  if (dismissable) {
    scrim.addEventListener('click', close);
    layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  }
  layer.querySelector('[data-close]').addEventListener('click', close);
  layer.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', close));

  const firstInput = layer.querySelector('input:not([type=hidden]),select,textarea');
  setTimeout(() => (firstInput || layer.querySelector('.modal-head button'))?.focus(), 90);
  onMount?.(layer, close);
  return { close, el: layer, body: bodyEl };
}

/** Tiroir latéral : idéal pour une fiche détaillée sans perdre le contexte. */
export function drawer({ title, subtitle, body, footer, wide = false, onMount, tabs } = {}) {
  const prev = document.activeElement;
  const root = document.getElementById('modal-root');
  const scrim = h('<div class="scrim"></div>');
  const layer = h(`<div class="drawer-layer"><aside class="drawer ${wide ? 'drawer-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title || 'Panneau')}">
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:16px">${esc(title || '')}</h2>
          ${subtitle ? `<div class="subtle small mt-2">${subtitle}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-icon" data-close aria-label="Fermer le panneau">${icon('x', { size: 18 })}</button>
      </div>
      ${tabs ? `<div class="tabs" role="tablist" style="padding:0 19px;flex-shrink:0">${tabs}</div>` : ''}
      <div class="drawer-body"></div>
      ${footer ? '<div class="drawer-foot"></div>' : ''}
    </aside></div>`);
  const bodyEl = layer.querySelector('.drawer-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  if (footer) {
    const f = layer.querySelector('.drawer-foot');
    if (typeof footer === 'string') f.innerHTML = footer;
    else f.appendChild(footer);
  }
  root.append(scrim, layer);
  requestAnimationFrame(() => { scrim.classList.add('open'); layer.querySelector('.drawer').classList.add('open'); });
  document.body.style.overflow = 'hidden';

  const cleanup = trapFocus(layer, prev);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scrim.classList.remove('open');
    layer.querySelector('.drawer').classList.remove('open');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onEsc);
    setTimeout(() => { scrim.remove(); layer.remove(); cleanup(); }, 340);
  }
  function onEsc(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onEsc);
  scrim.addEventListener('click', close);
  layer.querySelector('[data-close]').addEventListener('click', close);
  layer.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', close));
  onMount?.(layer, close);
  return { close, el: layer, body: bodyEl };
}

/** Confirmation bloquante (renvoie une promesse). */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, details } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title, size: 'modal-narrow', icon: danger ? 'alert-triangle' : 'help-circle',
      body: `<p style="font-size:13.5px;line-height:1.6;color:var(--text-2)">${esc(message)}</p>
             ${details ? `<div class="mt-4" style="font-size:12.5px;color:var(--text-3)">${details}</div>` : ''}`,
      footer: `<button class="btn btn-secondary" data-cancel>${esc(cancelLabel)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>`,
      onMount: (el, close) => {
        el.querySelector('[data-cancel]').addEventListener('click', () => { close(); finish(false); });
        el.querySelector('[data-ok]').addEventListener('click', () => { close(); finish(true); });
        setTimeout(() => el.querySelector('[data-ok]')?.focus(), 100);
      },
      dismissable: true,
    });
    // Fermer via Échap / clic extérieur = annuler
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { observer.disconnect(); finish(false); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/* ================================================================== */
/* PRIMITIFS                                                           */
/* ================================================================== */
export function badge(label, tone = 'neutral', { iconName, dot = true } = {}) {
  return `<span class="badge badge-${tone} ${dot ? '' : 'no-dot'}">${iconName ? icon(iconName, { size: 12 }) : ''}${esc(label)}</span>`;
}

export function avatar({ first = '', last = '', src, color, size = '', label } = {}) {
  const c = color || couleurAvatar(`${first}${last}`);
  const txt = initials(first, last);
  return `<span class="avatar ${size}" style="--av:${c}" ${label ? `aria-label="${esc(label)}"` : 'aria-hidden="true"'}>
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : esc(txt)}</span>`;
}

export function emptyState({ icon: ic = 'inbox', title, message, actions = [] } = {}) {
  return `<div class="empty">
    <div class="empty-icon">${icon(ic, { size: 26 })}</div>
    <h3>${esc(title)}</h3>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${actions.length ? `<div class="actions">${actions.map((a) => `<button class="btn ${a.variant || 'btn-secondary'}" data-empty-action="${esc(a.id || '')}">${a.icon ? icon(a.icon, { size: 16 }) : ''}${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}

export function skeletonRows(n = 6, cols = 5) {
  return Array.from({ length: n }, () => `<div class="sk-row">
    ${Array.from({ length: cols }, (_, i) => `<div class="skeleton sk-line" style="width:${[22, 16, 12, 20, 10][i % 5]}%;height:${i === 0 ? 22 : 10}px;${i === 0 ? 'border-radius:8px' : ''}"></div>`).join('')}
  </div>`).join('');
}
export const skeletonCards = (n = 4) => `<div class="grid grid-kpi">${Array.from({ length: n }, () => '<div class="skeleton sk-card"></div>').join('')}</div>`;

export function spinner(label = 'Chargement…') {
  return `<div class="row gap-3 subtle small" role="status"><span class="spinner"></span>${esc(label)}</div>`;
}

export function progress(pctv, tone = '') {
  const v = Math.max(0, Math.min(100, Number(pctv) || 0));
  return `<div class="progress" ${tone ? `data-tone="${tone}"` : ''} role="progressbar" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"><i style="width:${v}%"></i></div>`;
}

export function pageHeader({ title, subtitle, actions = '', breadcrumb = '' }) {
  return `<header class="row-between wrap mb-4" style="align-items:flex-end">
    <div style="min-width:0">
      ${breadcrumb ? `<div class="uppercase mb-2">${breadcrumb}</div>` : ''}
      <h1 class="h-page">${esc(title)}</h1>
      ${subtitle ? `<p class="subtle small mt-2" style="max-width:70ch">${subtitle}</p>` : ''}
    </div>
    ${actions ? `<div class="row gap-2 wrap">${actions}</div>` : ''}
  </header>`;
}

/* ================================================================== */
/* FORMULAIRES                                                         */
/* ================================================================== */
let fieldId = 0;
export function field({ label, name, type = 'text', value = '', placeholder = '', hint = '', required = false, options = {}, disabled = false, rows, min, max, step, prefix, suffix, className = '', accept, multiple = false }) {
  const id = `f${++fieldId}_${name}`;
  const req = required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const attrs = `${disabled ? 'disabled' : ''} ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${step !== undefined ? `step="${step}"` : ''} ${accept ? `accept="${accept}"` : ''} ${multiple ? 'multiple' : ''}`;
  let control;
  if (type === 'select') {
    const list = Array.isArray(options) ? options : Object.entries(options).map(([v, l]) => ({ value: v, label: l }));
    control = `<select class="select ${className}" id="${id}" name="${esc(name)}" ${attrs} ${required ? 'required' : ''}>
      ${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}
      ${list.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea ${className}" id="${id}" name="${esc(name)}" rows="${rows || 3}" placeholder="${esc(placeholder)}" ${attrs} ${required ? 'required' : ''}>${esc(value)}</textarea>`;
  } else if (type === 'switch') {
    return `<label class="switch" for="${id}">
      <input type="checkbox" id="${id}" name="${esc(name)}" ${value || value === true ? 'checked' : ''} ${attrs}>
      <span class="switch-track"></span><span class="switch-text">${esc(label)}</span></label>
      ${hint ? `<div class="hint" style="margin-left:47px">${esc(hint)}</div>` : ''}`;
  } else if (type === 'checkbox') {
    return `<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${esc(name)}" ${value ? 'checked' : ''} ${attrs}>
      <span class="check-box">${icon('check', { size: 11 })}</span><span>${esc(label)}${req}</span></label>`;
  } else if (prefix || suffix) {
    control = `<div class="input-group">
      ${prefix ? `<span class="input-prefix">${esc(prefix)}</span>` : ''}
      <input class="input ${className}" id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs} ${required ? 'required' : ''}>
      ${suffix ? `<span class="input-suffix">${esc(suffix)}</span>` : ''}</div>`;
  } else {
    control = `<input class="input ${className}" id="${id}" name="${esc(name)}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs} ${required ? 'required' : ''}>`;
  }
  return `<div class="field">
    <label for="${id}">${esc(label)}${req}</label>
    ${control}
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
    <div class="error-msg" data-error-for="${esc(name)}" hidden></div>
  </div>`;
}

/** Lit les valeurs d'un formulaire en typant les nombres et cases à cocher. */
export function readForm(form, numericFields = []) {
  const out = {};
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) {
    if (out[k] !== undefined) {
      out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
    } else out[k] = v;
  }
  form.querySelectorAll('input[type=checkbox]').forEach((c) => {
    if (c.name) out[c.name] = c.checked;
  });
  form.querySelectorAll('input[type=number]').forEach((c) => {
    if (c.name) out[c.name] = c.value === '' ? null : Number(c.value);
  });
  numericFields.forEach((f) => { if (out[f] !== undefined && out[f] !== '') out[f] = Number(out[f]); });
  // Retire les chaînes vides pour ne pas écraser des valeurs existantes
  Object.keys(out).forEach((k) => { if (out[k] === '') out[k] = null; });
  return out;
}

/** Affiche les erreurs de validation retournées par l'API sous les champs. */
export function showFieldErrors(form, fields = {}) {
  form.querySelectorAll('[data-error-for]').forEach((el) => {
    const key = el.getAttribute('data-error-for');
    const msg = fields[key];
    el.textContent = msg ? icon('alert-circle', { size: 12 }) + msg : '';
    el.hidden = !msg;
    const input = form.querySelector(`[name="${CSS.escape(key)}"]`);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  });
}

/* ================================================================== */
/* TABLEAU DE DONNÉES                                                  */
/* ================================================================== */
/**
 * columns: [{ key, label, render?(row), align?, width?, sortable?, hideBelow? }]
 * Renvoie un élément <table> prêt à insérer.
 */
export function dataTable({ columns, rows, rowKey = (r) => r.id, onRowClick, selectable = false, selected = new Set(), onSelect, empty: emptyCfg, dense = false, zebra = false, stickyFirst = false }) {
  if (!rows.length) {
    return h(`<div>${emptyState(emptyCfg || { icon: 'inbox', title: 'Aucun élément', message: 'Rien à afficher pour ces critères.' })}</div>`);
  }
  const thead = `<thead><tr>
    ${selectable ? `<th class="col-check"><label class="check" style="justify-content:center"><input type="checkbox" data-check-all ${selected.size === rows.length ? 'checked' : ''} aria-label="Tout sélectionner"><span class="check-box">${icon('check', { size: 11 })}</span></label></th>` : ''}
    ${columns.map((c) => `<th class="${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''} ${c.sortable ? 'sortable' : ''} ${c.hideBelow ? `hide-${c.hideBelow}` : ''}"
      ${c.sortable ? `data-sort="${esc(c.key)}" tabindex="0" role="button"` : ''} ${c.width ? `style="width:${c.width}"` : ''}>${esc(c.label || '')}${c.sortable ? '<span class="sort-ind">↕</span>' : ''}</th>`).join('')}
  </tr></thead>`;

  const tbody = `<tbody>${rows.map((row) => {
    const id = rowKey(row);
    const isSel = selected.has(id);
    return `<tr data-id="${esc(id)}" class="${onRowClick ? 'clickable' : ''} ${isSel ? 'selected' : ''}" ${onRowClick ? 'tabindex="0"' : ''}>
      ${selectable ? `<td class="col-check"><label class="check" style="justify-content:center"><input type="checkbox" data-check ${isSel ? 'checked' : ''} aria-label="Sélectionner"><span class="check-box">${icon('check', { size: 11 })}</span></label></td>` : ''}
      ${columns.map((c, i) => `<td class="${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''} ${c.hideBelow ? `hide-${c.hideBelow}` : ''} ${i === 0 && stickyFirst ? 'cell-strong' : ''}">${c.render ? c.render(row) : esc(row[c.key] ?? '')}</td>`).join('')}
    </tr>`;
  }).join('')}</tbody>`;

  const table = h(`<div class="table-wrap"><table class="data ${dense ? 'dense' : ''} ${zebra ? 'table-zebra' : ''}">${thead}${tbody}</table></div>`);

  if (onRowClick) {
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const handler = (e) => {
        if (e.target.closest('button,a,input,label')) return;
        onRowClick(rows.find((r) => String(rowKey(r)) === tr.dataset.id), tr, e);
      };
      tr.addEventListener('click', handler);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(e); } });
    });
  }
  if (selectable) {
    const all = table.querySelector('[data-check-all]');
    all?.addEventListener('change', (e) => {
      rows.forEach((r) => { if (e.target.checked) selected.add(rowKey(r)); else selected.delete(rowKey(r)); });
      table.querySelectorAll('tbody [data-check]').forEach((c) => { c.checked = e.target.checked; });
      table.querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('selected', e.target.checked));
      onSelect?.(selected);
    });
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cb = tr.querySelector('[data-check]');
      cb?.addEventListener('change', (e) => {
        const id = rows.find((r) => String(rowKey(r)) === tr.dataset.id);
        if (e.target.checked) selected.add(rowKey(id)); else selected.delete(rowKey(id));
        tr.classList.toggle('selected', e.target.checked);
        onSelect?.(selected);
      });
    });
  }
  return table;
}

export function pagination({ page = 1, pages = 1, total = 0, size = 25, onChange, label = 'éléments' }) {
  if (!total) return '';
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const nums = [];
  const push = (p) => nums.push(`<button data-page="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`);
  const dots = () => nums.push('<span class="dots">…</span>');
  if (pages <= 7) { for (let i = 1; i <= pages; i += 1) push(i); }
  else {
    push(1);
    if (page > 3) dots();
    for (let i = Math.max(2, page - 1); i <= Math.min(pages - 1, page + 1); i += 1) push(i);
    if (page < pages - 2) dots();
    push(pages);
  }
  return `<div class="pagination">
    <div><b class="num">${from}–${to}</b> sur <b class="num">${total.toLocaleString('fr-FR')}</b> ${esc(label)}</div>
    <div class="pager">
      <button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Page précédente">${icon('chevron-left', { size: 15 })}</button>
      ${nums.join('')}
      <button data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Page suivante">${icon('chevron-right', { size: 15 })}</button>
    </div>
  </div>`;
}

/** Branche un conteneur contenant .pagination sur un callback. */
export function wirePagination(container, onChange) {
  container.querySelectorAll('[data-page]').forEach((b) => {
    b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (p >= 1) onChange(p);
    });
  });
}

/** Barre d'outils : recherche + filtres + actions. */
export function toolbar({ search = '', searchPlaceholder = 'Rechercher…', filters = '', actions = '' } = {}) {
  return `<div class="toolbar">
    ${search !== null ? `<div class="search-input">${icon('search', { size: 15 })}
      <input class="input" type="search" data-search value="${esc(search)}" placeholder="${esc(searchPlaceholder)}" aria-label="${esc(searchPlaceholder)}" autocomplete="off">
      ${search ? `<button class="clear" data-clear-search aria-label="Effacer">${icon('x', { size: 14 })}</button>` : ''}</div>` : ''}
    ${filters ? `<div class="filters">${filters}</div>` : ''}
    <div class="toolbar-spacer"></div>
    ${actions ? `<div class="row gap-2 wrap">${actions}</div>` : ''}
  </div>`;
}

/* ================================================================== */
/* ONGLETS                                                             */
/* ================================================================== */
export function tabs(items, active, { onSelect, paramName = 'tab' } = {}) {
  const el = h(`<div class="tabs" role="tablist">${items.map((t) => `<button class="tab" role="tab" data-tab="${esc(t.id)}"
      aria-selected="${t.id === active}" ${t.id === active ? 'tabindex="0"' : 'tabindex="-1"'}>
      ${t.icon ? icon(t.icon, { size: 15 }) : ''}${esc(t.label)}${t.count != null ? `<span class="count num">${t.count}</span>` : ''}</button>`).join('')}</div>`);
  el.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => onSelect?.(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const list = [...el.querySelectorAll('[data-tab]')];
      const i = list.indexOf(b);
      if (e.key === 'ArrowRight') { e.preventDefault(); list[(i + 1) % list.length].focus(); list[(i + 1) % list.length].click(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); list[(i - 1 + list.length) % list.length].click(); }
    });
  });
  return el;
}

/* ================================================================== */
/* PALETTE DE COMMANDES (Ctrl+K)                                       */
/* ================================================================== */
let paletteOpen = false;
export function openPalette(getItems) {
  if (paletteOpen) return;
  paletteOpen = true;
  const root = document.getElementById('palette-root');
  const layer = h(`<div class="palette-layer"><div class="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
    <div class="palette-input">${icon('search', { size: 18 })}
      <input type="text" placeholder="Rechercher une page, un élève, une facture… (ou tapez > pour une action)" aria-label="Recherche globale" autocomplete="off">
      <kbd>Échap</kbd></div>
    <div class="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span><span><kbd>↵</kbd> ouvrir</span><span><kbd>&gt;</kbd> actions</span><span style="margin-left:auto">SunuÉcole</span></div>
  </div></div>`);
  const scrim = h('<div class="scrim" style="z-index:299"></div>');
  const input = layer.querySelector('input');
  const list = layer.querySelector('.palette-list');
  let items = [];
  let idx = 0;

  function close() {
    paletteOpen = false;
    scrim.remove();
    layer.remove();
    document.removeEventListener('keydown', onKey, true);
  }
  function render2() {
    if (!items.length) {
      list.innerHTML = `<div class="empty" style="padding:26px"><div class="empty-icon">${icon('search', { size: 22 })}</div>
        <h3>Aucun résultat</h3><p>Essayez un nom d'élève, un numéro de facture ou le nom d'une page.</p></div>`;
      return;
    }
    let lastGroup = null;
    list.innerHTML = items.map((it, i) => {
      const grp = it.group !== lastGroup ? `<div class="palette-group">${esc(it.group || 'Navigation')}</div>` : '';
      lastGroup = it.group;
      return `${grp}<button class="palette-item" role="option" data-i="${i}" aria-selected="${i === idx}">
        <span class="ico">${icon(it.icon || 'arrow-right', { size: 17 })}</span>
        <span class="pi-label">${esc(it.label)}${it.sub ? `<span class="pi-sub"> — ${esc(it.sub)}</span>` : ''}</span>
        ${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`;
    }).join('');
    list.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('click', () => run(Number(b.dataset.i)));
      b.addEventListener('mousemove', () => { idx = Number(b.dataset.i); markActive(); });
    });
    const active = list.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }
  function markActive() {
    list.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.i) === idx)));
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
  function run(i) {
    const it = items[i];
    if (!it) return;
    close();
    it.run?.();
  }
  async function search(term) {
    idx = 0;
    list.innerHTML = `<div style="padding:26px;text-align:center">${spinner('Recherche…')}</div>`;
    const all = await getItems(term);
    items = all.slice(0, 40);
    render2();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); markActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); markActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
  }
  root.append(scrim, layer);
  requestAnimationFrame(() => { layer.querySelector('.palette').classList.add('open'); scrim.classList.add('open'); input.focus(); });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  const debounced = debounce((v) => search(v), 170);
  input.addEventListener('input', () => debounced(input.value));
  search('');
}

/* ================================================================== */
/* Divers                                                              */
/* ================================================================== */
/** Verrouille un bouton pendant un appel asynchrone (évite les doubles clics). */
export async function withBusy(btn, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span>${btn.dataset.busyLabel || ''}`;
  try { return await fn(); }
  finally { btn.disabled = wasDisabled; btn.innerHTML = html; }
}

/** Copie dans le presse-papiers avec repli pour les navigateurs anciens. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toastOk('Copié', 'Le texte est dans le presse-papiers.');
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toastOk('Copié'); } catch { toastErr('Copie impossible'); }
    ta.remove();
    return false;
  }
}

/** Menu contextuel léger ancré sur un bouton. */
export function menu(anchor, items) {
  const existing = document.querySelector('.ctx-menu');
  existing?.remove();
  const rect = anchor.getBoundingClientRect();
  const el = h(`<div class="ctx-menu" role="menu" style="position:fixed;z-index:280;min-width:190px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);box-shadow:var(--shadow-lg);padding:5px;animation:toast-in .16s var(--ease-out)">
    ${items.map((it) => (it.separator ? '<div class="divider" style="margin:4px 0"></div>'
      : `<button class="palette-item" role="menuitem" data-k="${esc(it.id || it.label)}" style="width:100%">
          <span class="ico" style="color:${it.danger ? 'var(--danger)' : 'var(--text-3)'}">${icon(it.icon || 'chevron-right', { size: 15 })}</span>
          <span class="pi-label" style="${it.danger ? 'color:var(--danger)' : ''}">${esc(it.label)}</span>
          ${it.hint ? `<span class="pi-sub">${esc(it.hint)}</span>` : ''}</button>`)).join('')}
  </div>`);
  document.body.appendChild(el);
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  el.style.left = `${Math.min(rect.left, window.innerWidth - w - 8)}px`;
  el.style.top = `${rect.bottom + hgt > window.innerHeight ? rect.top - hgt - 4 : rect.bottom + 4}px`;
  const close = () => { el.remove(); document.removeEventListener('click', outside); document.removeEventListener('keydown', esc); };
  const outside = (e) => { if (!el.contains(e.target) && e.target !== anchor) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('click', outside); document.addEventListener('keydown', esc); }, 0);
  el.querySelectorAll('[data-k]').forEach((b, i) => {
    b.addEventListener('click', () => { close(); items.filter((x) => !x.separator)[i]?.onClick?.(); });
  });
  el.querySelector('[data-k]')?.focus();
  return close;
}

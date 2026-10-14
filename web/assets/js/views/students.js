/**
 * SunuÉcole — Module Élèves : liste filtrable, fiche complète (tiroir latéral),
 * création/édition, import Excel, changement de classe, promotion en masse.
 *
 * Choix d'ergonomie : la liste reste visible pendant la consultation d'une
 * fiche (tiroir latéral plutôt qu'une page entière). Le secrétariat enchaîne
 * ainsi 50 dossiers sans jamais perdre ses filtres — un gain de temps mesurable
 * pendant les inscriptions.
 */
import { api } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination,
  toolbar, field, readForm, showFieldErrors, modal, drawer, confirmDialog, toastOk, toastErr, debounce, withBusy, copyText,
} from '../ui/components.js';
import {
  xof, num, note, pct, dateFr, dateLong, ageFrom, relatif, STATUT_ELEVE, etatNote, telFr, joursEntre,
} from '../core/format.js';
import { gauge, barChart, donutChart } from '../core/charts.js';

/* ------------------------------------------------------------------ */
/* État local du module (survit aux allers-retours entre pages)        */
/* ------------------------------------------------------------------ */
const LS = 'sue.students.filters';
const defaults = { q: '', class_id: '', level_id: '', cycle: '', status: 'actif', gender: '', paiement: '', transport: '', canteen: '', sort: 'nom', page: 1, limit: 25 };
let filters = { ...defaults, ...(JSON.parse(localStorage.getItem(LS) || '{}')) };
const saveFilters = () => localStorage.setItem(LS, JSON.stringify(filters));
let lastMeta = null;
let lastFacets = null;

const SORTS = { nom: 'Nom (A→Z)', recent: 'Inscription récente', matricule: 'Matricule', classe: 'Classe', solde: 'Solde dû (décroissant)', moyenne: 'Moyenne (décroissant)' };

function statutPaiementBadge(s) {
  const map = {
    a_jour: ['À jour', 'ok'], payee: ['À jour', 'ok'], partielle: ['Partielle', 'warn'],
    partiellement_payee: ['Partielle', 'warn'], impayee: ['Impayée', 'danger'], en_retard: ['En retard', 'danger'], aucune: ['Aucune facture', 'neutral'],
  };
  const [l, t] = map[s] || [s || '—', 'neutral'];
  return badge(l, t);
}

/* ================================================================== */
/* LISTE DES ÉLÈVES                                                    */
/* ================================================================== */
async function listView(el) {
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div>
        <div class="uppercase mb-2">Scolarité</div>
        <h1 class="h-page">Élèves</h1>
        <p class="subtle small mt-2" id="st-sub">Chargement des dossiers…</p>
      </div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="btn-import">${icon('upload', { size: 15 })} Importer (Excel)</button>
        <button class="btn btn-secondary" id="btn-export">${icon('download', { size: 15 })} Exporter CSV</button>
        <button class="btn btn-primary" data-new id="btn-new">${icon('user-plus', { size: 15 })} Nouvel élève</button>
      </div>
    </header>
    <div class="grid grid-kpi" id="st-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="st-toolbar"></div>
      <div class="card-body" id="st-bulk" hidden></div>
      <div class="card-body" style="padding:0" id="st-table">${skeletonRows(10, 6)}</div>
      <div class="card-foot" id="st-pager"></div>
    </div>`;

  const tableSlot = el.querySelector('#st-table');
  const pagerSlot = el.querySelector('#st-pager');
  const selected = new Set();

  paintToolbar(el);
  wireHeaderActions(el);

  const load = debounce(async () => {
    saveFilters();
    tableSlot.innerHTML = skeletonRows(8, 6);
    try {
      const q = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v); });
      const res = await api.get(`/students?${q.toString()}`);
      const rows = res.data || [];
      lastMeta = res.meta;
      lastFacets = res.facets;
      paintKpis(el, rows.length);
      paintTable(rows, selected, refreshBulk);
    } catch (err) {
      tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Liste indisponible', message: err.message });
    }
  }, 220);

  el.__reload = load;
  await load.flush();

  function refreshBulk() {
    const slot = el.querySelector('#st-bulk');
    if (!selected.size) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = `<div class="row-between wrap gap-3" style="background:var(--brand-50);margin:-4px;padding:10px 14px;border-radius:var(--r-sm);border:1px solid var(--brand-100)">
      <div class="row gap-3"><b class="num">${selected.size}</b><span class="small">élève(s) sélectionné(s)</span>
        <button class="btn btn-link btn-sm" id="bulk-clear">Tout désélectionner</button></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary btn-sm" data-bulk="classe">${icon('repeat', { size: 14 })} Changer de classe</button>
        <button class="btn btn-secondary btn-sm" data-bulk="facturer">${icon('receipt', { size: 14 })} Facturer</button>
        <button class="btn btn-secondary btn-sm" data-bulk="sms">${icon('sms', { size: 14 })} SMS aux parents</button>
        <button class="btn btn-secondary btn-sm" data-bulk="export">${icon('download', { size: 14 })} Exporter</button>
        ${store.atLeast(90) ? `<button class="btn btn-danger btn-sm" data-bulk="radier">${icon('archive', { size: 14 })} Radier</button>` : ''}
      </div></div>`;
    slot.querySelector('#bulk-clear').addEventListener('click', () => { selected.clear(); refreshBulk(); load(); });
    slot.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulkAction(b.dataset.bulk, [...selected])));
  }

  function bulkAction(kind, ids) {
    if (kind === 'classe') return changeClassWizard(ids, () => { selected.clear(); load(); });
    if (kind === 'export') return exportSelection(ids);
    if (kind === 'facturer') return go(`/finance/factures?students=${ids.join(',')}`);
    if (kind === 'sms') return go(`/communication/sms?students=${ids.join(',')}`);
    if (kind === 'radier') return radierWizard(ids, () => { selected.clear(); load(); });
  }

  function paintTable(rows, sel, onSel) {
    if (!rows.length) {
      tableSlot.innerHTML = emptyState({
        icon: 'users', title: 'Aucun élève ne correspond',
        message: 'Modifiez vos filtres, ou créez/importez un dossier élève.',
        actions: [{ id: 'reset', label: 'Réinitialiser les filtres', icon: 'refresh' }, { id: 'new', label: 'Nouvel élève', icon: 'user-plus', variant: 'btn-primary' }],
      });
      tableSlot.querySelector('[data-empty-action="reset"]')?.addEventListener('click', () => { filters = { ...defaults }; saveFilters(); paintToolbar(el); load(); });
      tableSlot.querySelector('[data-empty-action="new"]')?.addEventListener('click', () => studentForm(null, load));
      pagerSlot.innerHTML = '';
      el.querySelector('#st-sub').textContent = '0 élève trouvé.';
      return;
    }
    const tbl = dataTable({
      columns: [
        {
          key: 'eleve', label: 'Élève', width: '250px', sortable: false,
          render: (r) => `<div class="cell-user">${avatar({ first: r.first_name, last: r.last_name, src: r.photo_url, size: 'avatar-sm' })}
            <div style="min-width:0"><div class="cell-user-name">${esc(r.first_name)} ${esc(r.last_name)}</div>
            <div class="cell-user-sub">${esc(r.matricule)} · ${esc(r.niveau || '')}${r.tags?.length ? ` · ${r.tags.map((t) => esc(t)).join(', ')}` : ''}</div></div></div>`,
        },
        { key: 'classe', label: 'Classe', width: '96px', sortable: true, render: (r) => `<a class="link-strong" href="#/scolaire/classes/${r.class_id}">${esc(r.classe || '—')}</a>` },
        { key: 'gender', label: 'Sexe', width: '62px', align: 'center', hideBelow: 'xl', render: (r) => `<span class="gender-${r.gender === 'F' ? 'f' : 'm'}">${r.gender === 'F' ? 'F' : 'M'}</span>` },
        { key: 'moyenne', label: 'Moyenne', width: '104px', align: 'right', sortable: true, render: (r) => (r.moyenne != null
          ? `<b class="num" style="color:${r.moyenne >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(r.moyenne)}</b><span class="subtle tiny">/20</span>`
          : '<span class="subtle tiny">—</span>') },
        { key: 'taux_presence', label: 'Présence', width: '130px', hideBelow: 'lg', render: (r) => (r.taux_presence != null
          ? `<div class="row gap-2">${progress(r.taux_presence, r.taux_presence < 80 ? 'danger' : r.taux_presence < 90 ? 'warn' : '')}<span class="num tiny" style="width:32px;text-align:right">${Math.round(r.taux_presence)}%</span></div>`
          : '<span class="subtle tiny">—</span>') },
        { key: 'solde', label: 'Solde dû', width: '116px', align: 'right', sortable: true, render: (r) => (r.solde
          ? `<b class="num" style="color:var(--danger)">${xof(r.solde)}</b>`
          : `<span class="num subtle">0</span>`) },
        { key: 'statut_paiement', label: 'Paiement', width: '112px', hideBelow: 'md', render: (r) => statutPaiementBadge(r.statut_paiement) },
        { key: 'status', label: 'Statut', width: '100px', hideBelow: 'lg', render: (r) => badge(STATUT_ELEVE[r.status]?.label || r.status, STATUT_ELEVE[r.status]?.tone || 'neutral') },
        {
          key: 'act', label: '', width: '124px', align: 'right',
          render: (r) => `<div class="row gap-1" style="justify-content:flex-end">
            <button class="btn btn-ghost btn-icon btn-sm" data-act="call" title="Appeler le parent" aria-label="Appeler ${esc(r.parent_nom || 'le parent')}">${icon('phone', { size: 15 })}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-act="pay" title="Encaisser" aria-label="Encaisser un paiement">${icon('banknote', { size: 15 })}</button>
            <button class="btn btn-secondary btn-sm" data-act="open">Fiche ${icon('chevron-right', { size: 13 })}</button></div>`,
        },
      ],
      rows, rowKey: (r) => r.id, selectable: true, selected: sel, onSelect: onSel,
      onRowClick: (r) => studentDrawer(r.id, load),
      dense: true, zebra: true,
    });
    tableSlot.innerHTML = '';
    tableSlot.appendChild(tbl);

    // Tri
    tbl.querySelectorAll('[data-sort]').forEach((th) => {
      const key = th.dataset.sort;
      if (filters.sort === key) th.classList.add('sorted', 'asc');
      const act = () => { filters.sort = key; filters.page = 1; load(); };
      th.addEventListener('click', act);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    });
    // Actions de ligne
    tbl.querySelectorAll('tbody tr').forEach((tr) => {
      const id = Number(tr.dataset.id);
      const row = rows.find((r) => r.id === id);
      tr.querySelector('[data-act="call"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (row.parent_tel) { copyText(row.parent_tel); toastOk('Numéro copié', `${row.parent_nom || 'Parent'} · ${telFr(row.parent_tel)}`); }
        else toastErr('Aucun numéro', 'Ce dossier ne comporte pas de téléphone de parent.');
      });
      tr.querySelector('[data-act="pay"]')?.addEventListener('click', (e) => { e.stopPropagation(); go(`/finance/paiements?new=1&student=${id}`); });
      tr.querySelector('[data-act="open"]')?.addEventListener('click', (e) => { e.stopPropagation(); studentDrawer(id, load); });
    });

    el.querySelector('#st-sub').innerHTML = `<b class="num">${lastMeta.total.toLocaleString('fr-FR')}</b> élève(s)${filters.q ? ` pour « ${esc(filters.q)} »` : ''}${filters.class_id ? ` · classe ${esc(rows[0]?.classe || '')}` : ''} — page ${lastMeta.page} sur ${Math.max(1, lastMeta.pages || 1)}.`;
    pagerSlot.innerHTML = pagination({ page: lastMeta.page, pages: lastMeta.pages || 1, total: lastMeta.total, size: lastMeta.size, label: 'élèves' });
    wirePagination(pagerSlot, (p) => { filters.page = p; load(); });
  }

  if (new URLSearchParams(location.hash.split('?')[1] || '').get('new')) studentForm(null, load);
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('import')) importWizard(load);
}

/* ------------------------------------------------------------------ */
/* Barre d'outils + filtres                                            */
/* ------------------------------------------------------------------ */
function paintToolbar(el) {
  const f = filters;
  const classes = (lastFacets?.classes || []);
  const niveaux = (lastFacets?.niveaux || []);
  el.querySelector('#st-toolbar').innerHTML = toolbar({
    search: f.q,
    searchPlaceholder: 'Nom, matricule, parent, téléphone…',
    filters: `
      <select class="select select-sm" data-f="class_id" aria-label="Classe">
        <option value="">Toutes les classes</option>
        ${classes.map((c) => `<option value="${c.id}" ${String(f.class_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('')}
      </select>
      <select class="select select-sm" data-f="level_id" aria-label="Niveau">
        <option value="">Tous les niveaux</option>
        ${niveaux.map((c) => `<option value="${c.id}" ${String(f.level_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="select select-sm" data-f="status" aria-label="Statut">
        ${Object.entries(STATUT_ELEVE).map(([v, o]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${o.label}</option>`).join('')}
        <option value="" ${!f.status ? 'selected' : ''}>Tous les statuts</option>
      </select>
      <select class="select select-sm" data-f="paiement" aria-label="Situation financière">
        <option value="">Situation financière</option>
        <option value="impaye" ${f.paiement === 'impaye' ? 'selected' : ''}>Impayés</option>
        <option value="retard" ${f.paiement === 'retard' ? 'selected' : ''}>En retard</option>
        <option value="a_jour" ${f.paiement === 'a_jour' ? 'selected' : ''}>À jour</option>
      </select>
      <select class="select select-sm" data-f="gender" aria-label="Sexe">
        <option value="">Filles & garçons</option>
        <option value="F" ${f.gender === 'F' ? 'selected' : ''}>Filles</option>
        <option value="M" ${f.gender === 'M' ? 'selected' : ''}>Garçons</option>
      </select>
      <select class="select select-sm" data-f="sort" aria-label="Trier par">
        ${Object.entries(SORTS).map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="select select-sm" data-f="limit" aria-label="Lignes par page">
        ${[25, 50, 100].map((n) => `<option value="${n}" ${Number(f.limit) === n ? 'selected' : ''}>${n} / page</option>`).join('')}
      </select>
      ${(f.q || f.class_id || f.level_id || f.paiement || f.gender || f.status !== 'actif') ? '<button class="btn btn-ghost btn-sm" data-f="reset">Réinitialiser</button>' : ''}`,
    actions: `<button class="btn btn-ghost btn-sm" id="btn-density" title="Basculer l'affichage compact">${icon('table', { size: 15 })}</button>`,
  });

  const slot = el.querySelector('#st-toolbar');
  const input = slot.querySelector('[data-search]');
  const onSearch = debounce(() => { filters.q = input.value.trim(); filters.page = 1; el.__reload(); }, 300);
  input.addEventListener('input', onSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch.flush(); } });
  slot.querySelector('[data-clear-search]')?.addEventListener('click', () => { input.value = ''; filters.q = ''; el.__reload(); input.focus(); });
  slot.querySelectorAll('[data-f]').forEach((s) => {
    if (s.tagName === 'BUTTON') {
      s.addEventListener('click', () => { filters = { ...defaults }; saveFilters(); paintToolbar(el); el.__reload(); });
      return;
    }
    s.addEventListener('change', () => {
      filters[s.dataset.f] = s.value;
      filters.page = 1;
      el.__reload();
    });
  });
  slot.querySelector('#btn-density')?.addEventListener('click', () => {
    const t = slot.querySelector('table.data');
    t?.classList.toggle('dense');
    toastOk(t?.classList.contains('dense') ? 'Affichage compact' : 'Affichage confortable');
  });
}

function paintKpis(el, shown) {
  api.get('/students/stats', { cacheTtl: 30000 }).then((r) => {
    const s = r.data;
    el.querySelector('#st-kpis').innerHTML = [
      `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="brand">${icon('users', { size: 18 })}</span><span class="kpi-label">Effectif actif</span></div>
        <div class="kpi-val">${num(s.total)}</div><div class="kpi-foot"><span class="kpi-hint">${num(s.filles)} filles · parité ${pct(s.total ? (s.filles / s.total) * 100 : 0)}</span></div></div>`,
      `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="ok">${icon('clipboard-check', { size: 18 })}</span><span class="kpi-label">Présence moyenne</span></div>
        <div class="kpi-val">${num(s.moyenne_presence, 1)}<span class="kpi-unit">%</span></div><div class="kpi-foot"><span class="kpi-hint">Sur les 30 derniers jours</span></div></div>`,
      `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="danger">${icon('alert-circle', { size: 18 })}</span><span class="kpi-label">Dossiers avec impayé</span></div>
        <div class="kpi-val">${num(s.impayes)}</div><div class="kpi-foot"><span class="kpi-hint"><a href="#/finance/impayes" class="link">Relancer par SMS →</a></span></div></div>`,
      `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="info">${icon('user-plus', { size: 18 })}</span><span class="kpi-label">Nouveaux (30 j)</span></div>
        <div class="kpi-val">${num(s.nouveaux_30j)}</div><div class="kpi-foot"><span class="kpi-hint">${shown} affiché(s) sur ${num(s.total)}</span></div></div>`,
    ].join('');
  }).catch(() => {});
}

function wireHeaderActions(el) {
  el.querySelector('#btn-new').addEventListener('click', () => studentForm(null, el.__reload));
  el.querySelector('#btn-export').addEventListener('click', () => exportSelection(null));
  el.querySelector('#btn-import').addEventListener('click', () => importWizard(el.__reload));
}

/* ================================================================== */
/* FICHE ÉLÈVE (tiroir latéral large)                                  */
/* ================================================================== */
async function studentDrawer(id, onChanged) {
  const panel = document.createElement('div');
  panel.innerHTML = `<div style="padding:40px;text-align:center"><span class="spinner"></span><div class="subtle small mt-3">Chargement du dossier…</div></div>`;
  const d = drawer({
    title: 'Dossier élève', wide: true, body: panel,
    footer: `<div class="row gap-2 wrap grow">
        <button class="btn btn-secondary" id="d-print">${icon('printer', { size: 15 })} Imprimer la fiche</button>
        <a class="btn btn-secondary" id="d-page" href="#/scolaire/eleves/${id}">${icon('external-link', { size: 15 })} Page complète</a>
        <span class="grow"></span>
        <button class="btn btn-secondary" id="d-edit">${icon('edit', { size: 15 })} Modifier</button>
        <button class="btn btn-primary" id="d-pay">${icon('banknote', { size: 15 })} Encaisser</button>
      </div>`,
    onMount: (layer, close) => {
      layer.querySelector('#d-edit').addEventListener('click', () => { close(); studentForm(id, onChanged); });
      layer.querySelector('#d-pay').addEventListener('click', () => { close(); go(`/finance/paiements?new=1&student=${id}`); });
      layer.querySelector('#d-print').addEventListener('click', () => window.print());
      load();
    },
  });

  const TABS = [
    ['resume', 'Synthèse', 'dashboard'],
    ['scolarite', 'Scolarité', 'clipboard-list'],
    ['notes', 'Notes', 'pen-tool'],
    ['finance', 'Finances', 'wallet'],
    ['famille', 'Famille', 'users'],
    ['discipline', 'Discipline', 'shield'],
    ['documents', 'Documents', 'folder'],
    ['sante', 'Santé', 'heart-pulse'],
  ];
  let tab = 'resume';
  let data = null;

  function paintTabs() {
    const host = d.el.querySelector('.drawer-head');
    let bar = d.el.querySelector('.drawer-tabs');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'tabs drawer-tabs';
      bar.setAttribute('role', 'tablist');
      host.after(bar);
    }
    bar.innerHTML = TABS.map(([k, l, ic]) => `<button class="tab" role="tab" data-t="${k}" aria-selected="${k === tab}">${icon(ic, { size: 14 })}${l}</button>`).join('');
    bar.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; paintTabs(); paintBody(); }));
  }

  async function load() {
    try {
      const r = await api.get(`/students/${id}`);
      data = r.data;
      d.el.querySelector('.drawer-head h2').textContent = `${data.student.first_name} ${data.student.last_name}`;
      d.el.querySelector('.drawer-head .subtle').innerHTML =
        `${esc(data.student.matricule)} · ${esc(data.student.classe || '')} ${data.student.niveau ? `· ${esc(data.student.niveau)}` : ''} · ${badge(STATUT_ELEVE[data.student.status]?.label || data.student.status, STATUT_ELEVE[data.student.status]?.tone || 'neutral')}`;
      paintTabs();
      paintBody();
    } catch (err) {
      panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Dossier indisponible', message: err.message });
    }
  }

  function paintBody() {
    if (!data) return;
    const s = data.student;
    panel.className = 'print-area';
    if (tab === 'resume') {
      panel.innerHTML = `
        <div class="rc-student" style="padding:0 0 14px;border-bottom:1px solid var(--border-subtle);margin-bottom:14px">
          ${avatar({ first: s.first_name, last: s.last_name, src: s.photo_url, size: 'avatar-xl' })}
          <div>
            <h2 style="font-size:19px">${esc(s.first_name)} ${esc(s.last_name)}</h2>
            <div class="subtle small">${esc(s.matricule)} · ${esc(s.classe || 'sans classe')} · ${s.gender === 'F' ? 'Fille' : 'Garçon'} · ${ageFrom(s.birth_date)} ans</div>
            <div class="row gap-2 mt-2 wrap">${(s.tags || []).map((t) => badge(t, 'info')).join('')}${s.scholarship ? badge(`Bourse ${s.scholarship}`, 'ok') : ''}${s.discount_pct ? badge(`Réduction ${s.discount_pct} %`, 'ok') : ''}</div>
          </div>
          <div style="margin-left:auto;text-align:right">
            ${gauge(s.taux_presence ?? 0, { size: 96, thickness: 9, label: 'Présence', suffix: '%' })}
          </div>
        </div>
        <div class="grid grid-kpi">
          ${mini('Moyenne générale', s.moyenne != null ? note(s.moyenne) : '—', '/20', s.moyenne >= 10 ? 'ok' : 'danger', s.rang ? `${s.rang}${s.total_students ? `/${s.total_students}` : ''} de la classe` : 'Pas encore de notes')}
          ${mini('Solde dû', s.solde ? xof(s.solde) : '0', 'FCFA', s.solde ? 'danger' : 'ok', s.statut_paiement ? `Statut : ${s.statut_paiement}` : '')}
          ${mini('Absences', num(data.absences?.total_absences ?? data.absences?.absences ?? 0), '', (data.absences?.total_absences ?? 0) > 5 ? 'danger' : 'brand', `${data.absences?.total_retards ?? 0} retard(s) · ${data.absences?.non_justifiees ?? 0} non justifiée(s)`)}
          ${mini('Incidents', num(data.incidents?.length || 0), '', data.incidents?.length ? 'warn' : 'ok', data.incidents?.length ? `Dernier : ${relatifShort(data.incidents[0].incident_date)}` : 'Aucun incident')}
        </div>
        ${s.solde ? `<div class="alert alert-danger mt-4">${icon('wallet', { size: 17 })}<div class="alert-body">
          <div class="alert-title">${xof(s.solde)} restant à payer</div>
          <div class="alert-msg">${num(s.invoices?.filter((i) => i.status !== 'payee').length || 0)} facture(s) en attente. Envoyez une relance SMS ou proposez un échelonnement.</div></div>
          <div class="row gap-2"><button class="btn btn-primary btn-sm" id="q-pay">${icon('banknote', { size: 14 })} Encaisser</button>
          <button class="btn btn-secondary btn-sm" id="q-relance">${icon('sms', { size: 14 })} Relancer le parent</button>
          <button class="btn btn-secondary btn-sm" id="q-echelon">${icon('calendar-days', { size: 14 })} Échelonner</button></div></div>` : ''}
        <div class="grid grid-2 mt-4">
          <div><h3 class="h-card">${icon('chart-pie', { size: 15 })} Moyennes par matière</h3><div id="q-matieres" class="mt-3"></div></div>
          <div><h3 class="h-card">${icon('history', { size: 15 })} Activité récente</h3><div class="timeline mt-3" id="q-timeline"></div></div>
        </div>`;
      const pm = data.par_matiere || [];
      const slotM = panel.querySelector('#q-matieres');
      if (pm.length) {
        slotM.appendChild(donutChart(pm.slice(0, 6).map((m, i) => ({ label: m.matiere || m.name, value: m.moyenne, color: ['#0e7c66', '#1d4ed8', '#b45309', '#7c3aed', '#db2777', '#0891b2'][i % 6] })),
          { height: 150, thickness: 20, format: (v) => note(v), centerLabel: note(s.moyenne), centerSub: 'moyenne' }));
        slotM.insertAdjacentHTML('beforeend', `<div class="list mt-3">${pm.map((m) => `<div class="list-item">
          <span class="li-body"><span class="li-title" style="font-weight:560">${esc(m.matiere || m.name)}</span>
            <span class="li-sub">coef. ${m.coefficient ?? 1} · ${m.nb_notes ?? 0} note(s)</span></span>
          <span class="li-aside"><b class="num" style="color:${(m.moyenne ?? 0) >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(m.moyenne)}</b></span></div>`).join('')}</div>`);
      } else slotM.innerHTML = `<p class="subtle small">Aucune note saisie pour le trimestre en cours.</p>`;

      const tl = data.timeline || [];
      panel.querySelector('#q-timeline').innerHTML = tl.length ? tl.slice(0, 8).map((t) => `<div class="tl-item">
          <span class="tl-dot" style="--c:${t.color || '#0e7c66'}"></span>
          <div class="tl-body"><div class="li-title" style="font-weight:560">${esc(t.title || t.label || t.action)}</div>
            <div class="li-sub">${esc(t.detail || t.summary || '')} · ${relatifShort(t.date || t.created_at)}</div></div></div>`).join('')
        : `<p class="subtle small">Aucune activité enregistrée.</p>`;

      panel.querySelector('#q-pay')?.addEventListener('click', () => go(`/finance/paiements?new=1&student=${id}`));
      panel.querySelector('#q-relance')?.addEventListener('click', () => go(`/communication/sms?student=${id}&template=relance`));
      panel.querySelector('#q-echelon')?.addEventListener('click', () => go(`/finance/factures?student=${id}&echelonner=1`));
    }

    if (tab === 'scolarite') {
      panel.innerHTML = `
        <div class="grid grid-2">
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('clipboard-list', { size: 15 })} Inscription</h3>
            <dl class="dl">${dl([
              ['Matricule', s.matricule], ['Date d\'inscription', dateLong(s.enrolled_at)],
              ['Classe', s.classe || '—'], ['Niveau / cycle', `${s.niveau || '—'} · ${s.cycle || '—'}`],
              ['Professeur principal', s.prof_principal || '—'], ['Établissement précédent', s.previous_school || '—'],
              ['Statut', STATUT_ELEVE[s.status]?.label || s.status], ['Date de sortie', s.exit_date ? dateLong(s.exit_date) : '—'],
            ])}</dl>
          </div></div>
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('clipboard-check', { size: 15 })} Présences</h3>
            <div class="row gap-3 wrap mb-3">
              ${gauge(s.taux_presence ?? 0, { size: 92, thickness: 9, label: 'Taux', suffix: '%' })}
              <div class="col gap-1 small">
                <div>Présences : <b class="num">${num(data.attendance?.presents ?? 0)}</b></div>
                <div>Absences : <b class="num">${num(data.attendance?.absents ?? 0)}</b></div>
                <div>Retards : <b class="num">${num(data.attendance?.retards ?? 0)}</b></div>
                <div>Excusées : <b class="num">${num(data.attendance?.excuses ?? 0)}</b></div>
              </div>
            </div>
            <div id="q-heatmap"></div>
            <a class="btn btn-secondary btn-sm mt-3" href="#/vie-scolaire/absences?student=${id}">${icon('clock-alert', { size: 14 })} Voir les absences</a>
          </div></div>
        </div>
        <div class="card card-flat mt-4"><div class="card-body" style="padding:0">
          <div class="row-between" style="padding:12px 14px"><h3 class="h-card" style="margin:0">${icon('calendar-check', { size: 15 })} Derniers pointages</h3>
            <span class="subtle tiny">30 derniers jours</span></div>
          <div id="q-att"></div>
        </div></div>
        <div class="card card-flat mt-4"><div class="card-body">
          <h3 class="h-card">${icon('repeat', { size: 15 })} Historique de classes</h3>
          <div class="list" id="q-hist"></div>
        </div></div>`;
      // Heatmap des présences
      api.get(`/academics/attendance/heatmap/${id}`).then((r) => {
        const cells = r.data?.days || r.data?.heatmap || [];
        const slot = panel.querySelector('#q-heatmap');
        if (!slot) return;
        if (!cells.length) { slot.innerHTML = '<p class="subtle tiny">Pas de pointage sur la période.</p>'; return; }
        slot.innerHTML = `<div class="heatmap">${cells.map((c) => {
          const tone = c.status === 'present' ? 'ok' : c.status === 'absent' ? 'danger' : c.status === 'retard' ? 'warn' : c.status === 'excuse' ? 'info' : 'none';
          return `<span data-tone="${tone}" title="${esc(c.date)} : ${esc(c.status || 'non pointé')}"></span>`;
        }).join('')}</div>`;
      }).catch(() => {});
      const att = data.attendance?.records || data.attendance?.last || [];
      panel.querySelector('#q-att').innerHTML = Array.isArray(att) && att.length ? dataTable({
        columns: [
          { key: 'date', label: 'Date', width: '120px', render: (r) => dateFr(r.date || r.session_date) },
          { key: 'slot', label: 'Créneau', width: '120px', render: (r) => `<span class="num small">${esc(r.start_time || r.slot || '')}</span>` },
          { key: 'matiere', label: 'Matière', render: (r) => esc(r.subject || r.matiere || '—') },
          { key: 'enseignant', label: 'Enseignant', hideBelow: 'md', render: (r) => esc(r.teacher || r.enseignant || '—') },
          { key: 'status', label: 'Statut', width: '120px', align: 'right', render: (r) => {
            const m = { present: ['Présent', 'ok'], absent: ['Absent', 'danger'], retard: ['Retard', 'warn'], excuse: ['Excusé', 'info'] };
            const [l, t] = m[r.status] || [r.status, 'neutral'];
            return badge(l, t);
          } },
        ], rows: att.slice(0, 12), dense: true, zebra: true,
      }).outerHTML : '<div style="padding:16px"><p class="subtle small">Aucun pointage enregistré.</p></div>';
      const hist = data.class_history || data.history || [];
      panel.querySelector('#q-hist').innerHTML = hist.length ? hist.map((x) => `<div class="list-item">
          <span class="li-ico" data-tone="brand">${icon('school', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(x.to_class || x.classe || '—')}</span>
            <span class="li-sub">Depuis le ${esc(dateFr(x.from_date || x.start_date || x.created_at))}${x.reason ? ` · ${esc(x.reason)}` : ''}</span></span>
          <span class="li-aside">${esc(x.from_class ? `← ${x.from_class}` : '')}</span></div>`).join('')
        : `<p class="subtle small">Aucun changement de classe enregistré cette année.</p>`;
    }

    if (tab === 'notes') {
      const notes = data.last_notes || [];
      const rc = data.report_cards || [];
      panel.innerHTML = `
        <div class="row-between wrap mb-3">
          <h3 class="h-card" style="margin:0">${icon('pen-tool', { size: 15 })} Dernières notes</h3>
          <a class="btn btn-secondary btn-sm" href="#/pedagogie/bulletins?student=${id}">${icon('file-text', { size: 14 })} Bulletins</a>
        </div>
        <div id="q-notes"></div>
        ${rc.length ? `<h3 class="h-card mt-4">${icon('file-text', { size: 15 })} Bulletins</h3><div class="list" id="q-rc"></div>` : ''}`;
      panel.querySelector('#q-notes').innerHTML = notes.length ? dataTable({
        columns: [
          { key: 'date', label: 'Date', width: '110px', render: (r) => dateFr(r.assess_date || r.date) },
          { key: 'matiere', label: 'Matière', render: (r) => `<span class="row gap-2"><i style="width:8px;height:8px;border-radius:99px;background:${esc(r.color || '#0e7c66')};display:inline-block"></i>${esc(r.subject || r.matiere || '—')}</span>` },
          { key: 'name', label: 'Évaluation', hideBelow: 'md', render: (r) => esc(r.assessment || r.name || '—') },
          { key: 'type', label: 'Type', width: '110px', hideBelow: 'lg', render: (r) => esc(r.type || '') },
          { key: 'score', label: 'Note', align: 'right', width: '110px', render: (r) => (r.is_absent ? badge('Absent', 'warn')
            : `<b class="num" style="font-size:15px;color:${etatNote(r.score, r.max_score).color}">${note(r.score)}</b><span class="subtle tiny">/${r.max_score || 20}</span>`) },
          { key: 'coef', label: 'Coef.', align: 'right', width: '66px', hideBelow: 'lg', render: (r) => `<span class="num">${r.coefficient ?? 1}</span>` },
        ], rows: notes.slice(0, 20), dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'pen-tool', title: 'Aucune note', message: 'Les notes apparaîtront dès leur publication par les enseignants.' });

      if (rc.length) {
        panel.querySelector('#q-rc').innerHTML = rc.map((b) => `<div class="list-item">
          <span class="li-ico" data-tone="${(b.general_avg ?? 0) >= 10 ? 'ok' : 'danger'}">${icon('file-text', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(b.trimestre || b.term_name || 'Bulletin')}</span>
            <span class="li-sub">Moyenne ${note(b.general_avg)}/20 · rang ${b.rank ?? '—'}${b.total_students ? `/${b.total_students}` : ''} · ${esc(b.mention || '')}</span></span>
          <span class="li-aside">${badge(b.status === 'publie' || b.status === 'published' ? 'Publié' : 'Brouillon', b.status === 'publie' || b.status === 'published' ? 'ok' : 'neutral')}
            <a class="btn btn-secondary btn-sm" href="#/pedagogie/bulletins/${b.id}">${icon('printer', { size: 13 })} Ouvrir</a></span></div>`).join('');
      }
    }

    if (tab === 'finance') {
      const inv = data.invoices || [];
      const pay = data.payments || [];
      const total = inv.reduce((a, i) => a + (i.amount || 0), 0);
      const paid = inv.reduce((a, i) => a + (i.paid_amount || 0), 0);
      panel.innerHTML = `
        <div class="grid grid-kpi">
          ${mini('Facturé', xof(total), 'FCFA', 'brand', `${inv.length} facture(s)`)}
          ${mini('Encaissé', xof(paid), 'FCFA', 'ok', total ? `${pct((paid / total) * 100)} recouvré` : '')}
          ${mini('Reste à payer', xof(total - paid), 'FCFA', total - paid ? 'danger' : 'ok', s.solde ? 'À relancer' : 'Dossier à jour')}
          ${mini('Réduction', s.discount_pct ? `${s.discount_pct} %` : '—', '', 'info', s.scholarship ? `Bourse ${s.scholarship}` : 'Aucune bourse')}
        </div>
        <div class="row-between wrap mt-4 mb-3"><h3 class="h-card" style="margin:0">${icon('receipt', { size: 15 })} Factures</h3>
          <div class="row gap-2"><button class="btn btn-secondary btn-sm" id="f-echelon">${icon('calendar-days', { size: 14 })} Échelonner</button>
          <button class="btn btn-primary btn-sm" id="f-pay">${icon('banknote', { size: 14 })} Encaisser</button></div></div>
        <div id="q-inv"></div>
        <h3 class="h-card mt-4">${icon('banknote', { size: 15 })} Paiements reçus</h3>
        <div id="q-pay"></div>`;
      panel.querySelector('#f-pay').addEventListener('click', () => go(`/finance/paiements?new=1&student=${id}`));
      panel.querySelector('#f-echelon').addEventListener('click', () => go(`/finance/factures?student=${id}&echelonner=1`));
      panel.querySelector('#q-inv').innerHTML = inv.length ? dataTable({
        columns: [
          { key: 'number', label: 'N°', width: '140px', render: (r) => `<a class="link-strong" href="#/finance/factures/${r.id}">${esc(r.invoice_number)}</a>` },
          { key: 'label', label: 'Libellé', render: (r) => esc(r.label || r.fee_type || '—') },
          { key: 'amount', label: 'Montant', align: 'right', width: '110px', render: (r) => `<b class="num">${xof(r.amount)}</b>` },
          { key: 'paid', label: 'Payé', align: 'right', width: '110px', hideBelow: 'md', render: (r) => `<span class="num">${xof(r.paid_amount || 0)}</span>` },
          { key: 'due', label: 'Échéance', width: '110px', hideBelow: 'lg', render: (r) => {
            const late = r.due_date && r.status !== 'payee' && joursEntre(new Date().toISOString().slice(0, 10), r.due_date) < 0;
            return `<span class="small" style="${late ? 'color:var(--danger);font-weight:640' : ''}">${dateFr(r.due_date)}</span>`;
          } },
          { key: 'status', label: 'Statut', align: 'right', width: '120px', render: (r) => statutPaiementBadge(r.status) },
        ], rows: inv, dense: true, zebra: true,
        onRowClick: (r) => go(`/finance/factures/${r.id}`),
      }).outerHTML : emptyState({ icon: 'receipt', title: 'Aucune facture', message: 'Générez une facture depuis le module Finances.' });
      panel.querySelector('#q-pay').innerHTML = pay.length ? dataTable({
        columns: [
          { key: 'receipt', label: 'Reçu', width: '150px', render: (r) => esc(r.receipt_number || `#${r.id}`) },
          { key: 'date', label: 'Date', width: '120px', render: (r) => dateFr(r.paid_at || r.created_at) },
          { key: 'amount', label: 'Montant', align: 'right', width: '110px', render: (r) => `<b class="num">${xof(r.amount)}</b>` },
          { key: 'method', label: 'Moyen', width: '140px', render: (r) => `<span class="row gap-2">${icon(methodeIcon(r.method), { size: 14 })}${esc(methodeLabel(r.method))}</span>` },
          { key: 'ref', label: 'Référence', hideBelow: 'md', render: (r) => `<span class="subtle tiny">${esc(r.provider_ref || '—')}</span>` },
          { key: 'act', label: '', align: 'right', width: '80px', render: (r) => `<a class="btn btn-ghost btn-sm" href="#/finance/paiements/${r.id}/recu" title="Reçu">${icon('printer', { size: 14 })}</a>` },
        ], rows: pay, dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'banknote', title: 'Aucun paiement', message: 'Les encaissements apparaîtront ici avec leur reçu.' });
    }

    if (tab === 'famille') {
      const g = data.guardians || [];
      panel.innerHTML = `
        <div class="row-between wrap mb-3"><h3 class="h-card" style="margin:0">${icon('users', { size: 15 })} Parents & tuteurs</h3>
          <button class="btn btn-secondary btn-sm" id="g-add">${icon('user-plus', { size: 14 })} Ajouter un tuteur</button></div>
        <div class="grid grid-2" id="q-guard"></div>
        ${data.fratrie?.length ? `<h3 class="h-card mt-4">${icon('users', { size: 15 })} Fratrie</h3><div class="list" id="q-frat"></div>` : ''}
        <h3 class="h-card mt-4">${icon('home', { size: 15 })} Coordonnées</h3>
        <dl class="dl">${dl([
          ['Adresse', s.address || '—'], ['Ville', s.city || '—'],
          ['Téléphone d\'urgence', s.emergency_phone ? telFr(s.emergency_phone) : '—'],
          ['Contact prioritaire', s.parent_nom ? `${s.parent_nom} · ${telFr(s.parent_tel || '')}` : '—'],
        ])}</dl>`;
      panel.querySelector('#q-guard').innerHTML = g.length ? g.map((x) => `<div class="card card-flat"><div class="card-body">
          <div class="row gap-3">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar' })}
            <div><b>${esc(x.first_name)} ${esc(x.last_name)}</b>
              <div class="subtle small">${esc(x.relation || 'Tuteur')}${x.is_primary ? ` · ${badge('Principal', 'brand')}` : ''}</div></div></div>
          <dl class="dl mt-3">${dl([
            ['Téléphone', x.phone ? `<a class="link" href="tel:${esc(x.phone)}">${esc(telFr(x.phone))}</a>` : '—'],
            ['E-mail', x.email ? `<a class="link" href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : '—'],
            ['Profession', x.occupation || '—'],
            ['Compte portail', x.has_account ? badge('Activé', 'ok') : badge('Non créé', 'neutral')],
          ])}</dl>
          <div class="row gap-2 mt-3">
            ${x.phone ? `<a class="btn btn-secondary btn-sm" href="sms:${esc(x.phone)}">${icon('sms', { size: 14 })} SMS</a>` : ''}
            ${x.phone ? `<a class="btn btn-secondary btn-sm" href="tel:${esc(x.phone)}">${icon('phone', { size: 14 })} Appeler</a>` : ''}
            <button class="btn btn-ghost btn-sm" data-guard="${x.id}">${icon('edit', { size: 14 })} Modifier</button>
          </div></div></div>`).join('')
        : `<div class="card card-flat"><div class="card-body">${emptyState({ icon: 'users', title: 'Aucun tuteur', message: 'Rattachez un parent pour activer les alertes SMS et le portail famille.' })}</div></div>`;
      panel.querySelector('#g-add').addEventListener('click', () => go(`/scolaire/familles?new=1&student=${id}`));
      panel.querySelectorAll('[data-guard]').forEach((b) => b.addEventListener('click', () => go(`/scolaire/familles?edit=${b.dataset.guard}`)));
      if (data.fratrie?.length) {
        panel.querySelector('#q-frat').innerHTML = data.fratrie.map((x) => `<a class="list-item clickable" href="#/scolaire/eleves/${x.id}">
          ${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
          <span class="li-body"><span class="li-title">${esc(x.first_name)} ${esc(x.last_name)}</span>
            <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</span></span>
          <span class="li-aside">${icon('chevron-right', { size: 15 })}</span></a>`).join('');
      }
    }

    if (tab === 'discipline') {
      const inc = data.incidents || [];
      panel.innerHTML = `<div class="row-between wrap mb-3"><h3 class="h-card" style="margin:0">${icon('shield', { size: 15 })} Incidents & sanctions</h3>
          <a class="btn btn-primary btn-sm" href="#/vie-scolaire/discipline?student=${id}&new=1">${icon('plus', { size: 14 })} Déclarer</a></div>
        <div id="q-inc"></div>
        <div class="card card-flat mt-4"><div class="card-body">
          <h3 class="h-card">${icon('heart-pulse', { size: 15 })} Observations des enseignants</h3>
          <div id="q-obs" class="mt-3"></div></div></div>`;
      panel.querySelector('#q-inc').innerHTML = inc.length ? `<div class="list">${inc.map((x) => `<div class="list-item">
          <span class="li-ico" data-tone="${x.severity === 'grave' ? 'danger' : x.severity === 'moyenne' ? 'warn' : 'info'}">${icon('alert-triangle', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(x.type || x.title || 'Incident')}</span>
            <span class="li-sub">${esc(x.description || '')}</span>
            <span class="li-sub tiny">${esc(dateFr(x.incident_date || x.date))}${x.reporter_name ? ` · signalé par ${esc(x.reporter_name)}` : ''}${x.sanction ? ` · sanction : ${esc(x.sanction)}` : ''}</span></span>
          <span class="li-aside">${badge(x.severity || '—', x.severity === 'grave' ? 'danger' : 'warn')}</span></div>`).join('')}</div>`
        : emptyState({ icon: 'check-circle', title: 'Aucun incident', message: 'Comportement exemplaire sur la période.' });
      const obs = data.observations || [];
      panel.querySelector('#q-obs').innerHTML = obs.length ? obs.map((o) => `<div class="list-item">
          <span class="li-body"><span class="li-title">${esc(o.subject || o.matiere || '')}</span><span class="li-sub">${esc(o.comment || o.text || '')}</span></span>
          <span class="li-aside">${esc(dateFr(o.date || o.created_at))}</span></div>`).join('')
        : '<p class="subtle small">Aucune observation enregistrée.</p>';
    }

    if (tab === 'documents') {
      const docs = data.documents || [];
      const reqs = data.document_requests || [];
      panel.innerHTML = `<div class="row-between wrap mb-3"><h3 class="h-card" style="margin:0">${icon('folder', { size: 15 })} Documents administratifs</h3>
          <button class="btn btn-primary btn-sm" id="doc-new">${icon('file-plus', { size: 14 })} Générer un document</button></div>
        <div id="q-docs"></div>
        <h3 class="h-card mt-4">${icon('clock', { size: 15 })} Demandes en cours</h3><div id="q-reqs"></div>`;
      panel.querySelector('#doc-new').addEventListener('click', () => go(`/administration/documents?new=1&student=${id}`));
      panel.querySelector('#q-docs').innerHTML = docs.length ? `<div class="list">${docs.map((x) => `<div class="list-item">
          <span class="li-ico" data-tone="brand">${icon('file-text', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(x.type || x.doc_type || 'Document')}</span>
            <span class="li-sub">${esc(x.reference || '')} · ${esc(dateFr(x.created_at || x.issued_at))}</span></span>
          <span class="li-aside">${badge(x.status === 'delivre' || x.status === 'ready' ? 'Délivré' : 'En attente', x.status === 'delivre' ? 'ok' : 'warn')}
            <button class="btn btn-secondary btn-sm" data-print-doc="${x.id}">${icon('printer', { size: 13 })} Imprimer</button></span></div>`).join('')}</div>`
        : emptyState({ icon: 'folder', title: 'Aucun document', message: 'Certificats de scolarité, attestations et relevés seront listés ici.' });
      panel.querySelector('#q-reqs').innerHTML = reqs.length ? `<div class="list">${reqs.map((x) => `<div class="list-item">
          <span class="li-body"><span class="li-title">${esc(x.document_type || x.type)}</span>
            <span class="li-sub">Demandé le ${esc(dateFr(x.created_at))}${x.requester_name ? ` par ${esc(x.requester_name)}` : ''}</span></span>
          <span class="li-aside">${badge(x.status === 'delivre' ? 'Délivré' : x.status === 'en_cours' ? 'En cours' : 'En attente', x.status === 'delivre' ? 'ok' : 'warn')}</span></div>`).join('')}</div>`
        : '<p class="subtle small">Aucune demande en cours.</p>';
      panel.querySelectorAll('[data-print-doc]').forEach((b) => b.addEventListener('click', () => go(`/administration/documents?id=${b.dataset.printDoc}`)));
    }

    if (tab === 'sante') {
      const hh = data.health || {};
      const loans = data.loans || [];
      panel.innerHTML = `
        <div class="grid grid-2">
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('heart-pulse', { size: 15 })} Dossier médical</h3>
            <dl class="dl">${dl([
              ['Groupe sanguin', hh.blood_type || s.blood_type || '—'],
              ['Allergies', s.allergies || hh.allergies || 'Aucune connue'],
              ['Notes médicales', s.medical_notes || hh.notes || '—'],
              ['Assurance', hh.insurance || s.insurance || '—'],
              ['Contact d\'urgence', s.emergency_phone ? telFr(s.emergency_phone) : '—'],
              ['Dernière visite', hh.last_visit ? dateLong(hh.last_visit) : 'Jamais'],
            ])}</dl>
            <a class="btn btn-secondary btn-sm mt-3" href="#/services/infirmerie?student=${id}">${icon('clipboard-plus', { size: 14 })} Ouvrir l'infirmerie</a>
          </div></div>
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('library', { size: 15 })} Bibliothèque</h3>
            ${loans.length ? `<div class="list">${loans.slice(0, 5).map((l) => `<div class="list-item">
                <span class="li-body"><span class="li-title">${esc(l.title || l.book_title || 'Ouvrage')}</span>
                  <span class="li-sub">Emprunté le ${esc(dateFr(l.loan_date || l.created_at))}${l.due_date ? ` · à rendre le ${esc(dateFr(l.due_date))}` : ''}</span></span>
                <span class="li-aside">${badge(l.status === 'rendu' || l.returned_at ? 'Rendu' : 'Emprunté', l.returned_at ? 'ok' : 'warn')}</span></div>`).join('')}</div>`
              : '<p class="subtle small">Aucun emprunt en cours.</p>'}
            <h3 class="h-card mt-4">${icon('utensils', { size: 15 })} Services</h3>
            <dl class="dl">${dl([
              ['Cantine', s.canteen ? badge('Inscrit', 'ok') : badge('Non inscrit', 'neutral')],
              ['Transport', data.transport ? `${esc(data.transport.route_name || 'Ligne')} · ${esc(data.transport.stop || '')}` : 'Non inscrit'],
            ])}</dl>
          </div></div>
        </div>`;
    }
  }
  return d;
}

function mini(label, value, unit, tone, hint) {
  return `<div class="kpi kpi-sm"><div class="kpi-top"><span class="kpi-ico" data-tone="${tone}">${icon(tone === 'danger' ? 'alert-circle' : tone === 'ok' ? 'check-circle' : tone === 'warn' ? 'alert-triangle' : 'info', { size: 15 })}</span>
    <span class="kpi-label">${esc(label)}</span></div>
    <div class="kpi-val" style="font-size:20px">${esc(value)}${unit ? `<span class="kpi-unit">${esc(unit)}</span>` : ''}</div>
    <div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
}
const dl = (rows) => rows.map(([k, v]) => `<div class="dl-row"><dt>${esc(k)}</dt><dd>${v ?? '—'}</dd></div>`).join('');
const relatifShort = (d) => (d ? relatif(d) : '');
const methodeIcon = (m) => ({ orange_money: 'smartphone', wave: 'smartphone', mtn_momo: 'smartphone', moov_money: 'smartphone', free_money: 'smartphone', especes: 'banknote', virement: 'credit-card', cheque: 'file-text', carte: 'credit-card' }[m] || 'banknote');
const methodeLabel = (m) => ({ orange_money: 'Orange Money', wave: 'Wave', mtn_momo: 'MTN MoMo', moov_money: 'Moov Money', free_money: 'Free Money', especes: 'Espèces', virement: 'Virement', cheque: 'Chèque', carte: 'Carte bancaire' }[m] || m || '—');

/* ================================================================== */
/* FORMULAIRE ÉLÈVE                                                    */
/* ================================================================== */
async function studentForm(id, onSaved) {
  let s = { status: 'actif', gender: 'M' };
  let classes = [];
  let niveaux = [];
  if (id) {
    const r = await api.get(`/students/${id}`);
    s = r.data.student;
  }
  try {
    const c = await api.get('/academics/classes?limit=200', { cacheTtl: 60000 });
    classes = c.data || [];
    const l = await api.get('/academics/levels', { cacheTtl: 120000 });
    niveaux = l.data?.levels || l.data || [];
  } catch { /* listes vides */ }

  const form = h(`<form id="stu-form" novalidate>
    <div class="fieldset"><legend>${icon('user', { size: 14 })} Identité</legend>
      <div class="grid-2">
        ${field({ label: 'Prénom', name: 'first_name', value: s.first_name || '', required: true })}
        ${field({ label: 'Nom', name: 'last_name', value: s.last_name || '', required: true })}
        ${field({ label: 'Sexe', name: 'gender', type: 'select', value: s.gender || 'M', options: [{ value: 'M', label: 'Garçon' }, { value: 'F', label: 'Fille' }], required: true })}
        ${field({ label: 'Date de naissance', name: 'birth_date', type: 'date', value: s.birth_date || '' })}
        ${field({ label: 'Lieu de naissance', name: 'birth_place', value: s.birth_place || '' })}
        ${field({ label: 'Nationalité', name: 'nationality', value: s.nationality || 'Sénégalaise' })}
      </div>
    </div>
    <div class="fieldset"><legend>${icon('school', { size: 14 })} Scolarité</legend>
      <div class="grid-2">
        ${field({ label: 'Matricule', name: 'matricule', value: s.matricule || '', placeholder: 'Généré automatiquement', hint: 'Laissez vide pour une génération automatique.' })}
        ${field({ label: 'Classe', name: 'class_id', type: 'select', value: s.class_id || '', placeholder: '— Choisir —',
          options: classes.map((c) => ({ value: c.id, label: `${c.name} (${c.effectif ?? 0}/${c.capacity})` })), required: true })}
        ${field({ label: 'Statut', name: 'status', type: 'select', value: s.status || 'actif',
          options: Object.entries(STATUT_ELEVE).map(([v, o]) => ({ value: v, label: o.label })) })}
        ${field({ label: 'Date d\'inscription', name: 'enrolled_at', type: 'date', value: s.enrolled_at || new Date().toISOString().slice(0, 10) })}
        ${field({ label: 'Établissement précédent', name: 'previous_school', value: s.previous_school || '' })}
        ${field({ label: 'Régime', name: 'regime', type: 'select', value: s.regime || 'externe',
          options: [{ value: 'externe', label: 'Externe' }, { value: 'demi_pensionnaire', label: 'Demi-pensionnaire' }, { value: 'interne', label: 'Interne' }] })}
      </div>
    </div>
    <div class="fieldset"><legend>${icon('contact-card', { size: 14 })} Contact & famille</legend>
      <div class="grid-2">
        ${field({ label: 'Adresse', name: 'address', value: s.address || '' })}
        ${field({ label: 'Ville / quartier', name: 'city', value: s.city || '' })}
        ${field({ label: 'Téléphone d\'urgence', name: 'emergency_phone', value: s.emergency_phone || '', placeholder: '+221 7X XXX XX XX', hint: 'Utilisé pour les alertes SMS.' })}
      </div>
    </div>
    <div class="fieldset"><legend>${icon('wallet', { size: 14 })} Situation financière</legend>
      <div class="grid-2">
        ${field({ label: 'Réduction', name: 'discount_pct', type: 'number', value: s.discount_pct || 0, min: 0, max: 100, suffix: '%', hint: 'Fratrie, personnel, mérite…' })}
        ${field({ label: 'Bourse', name: 'scholarship', value: s.scholarship || '', placeholder: 'Ex. Bourse d\'État' })}
      </div>
      <div class="grid-2">
        ${field({ label: 'Cantine', name: 'canteen', type: 'switch', value: !!s.canteen, hint: 'Génère une facture mensuelle.' })}
        ${field({ label: 'Transport scolaire', name: 'transport', type: 'switch', value: !!s.transport_route_id })}
      </div>
    </div>
    <div class="fieldset"><legend>${icon('heart-pulse', { size: 15 })} Santé</legend>
      <div class="grid-2">
        ${field({ label: 'Groupe sanguin', name: 'blood_type', type: 'select', value: s.blood_type || '', placeholder: '—', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((v) => ({ value: v, label: v })) })}
        ${field({ label: 'Allergies', name: 'allergies', value: s.allergies || '', placeholder: 'Arachide, asthme…' })}
      </div>
      ${field({ label: 'Notes médicales', name: 'medical_notes', type: 'textarea', value: s.medical_notes || '', rows: 2, placeholder: 'Informations visibles uniquement par la direction et l\'infirmerie.' })}
    </div>
    ${field({ label: 'Notes internes', name: 'notes', type: 'textarea', value: s.notes || '', rows: 2 })}
  </form>`);

  const m = modal({
    title: id ? 'Modifier le dossier élève' : 'Nouvel élève',
    subtitle: id ? `${s.matricule || ''} · ${s.classe || ''}` : 'Les champs marqués d\'un astérisque sont obligatoires.',
    icon: id ? 'edit' : 'user-plus',
    body: form,
    size: 'modal-wide',
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      ${id && store.atLeast(90) ? `<button class="btn btn-danger" id="sf-del" style="margin-right:auto">${icon('trash', { size: 15 })} Supprimer</button>` : ''}
      <button class="btn btn-primary" id="sf-save">${icon('save', { size: 15 })} ${id ? 'Enregistrer' : 'Créer le dossier'}</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#sf-save').addEventListener('click', () => withBusy(layer.querySelector('#sf-save'), async () => {
        const payload = readForm(form, ['discount_pct', 'class_id']);
        showFieldErrors(form, {});
        try {
          if (id) {
            await api.patch(`/students/${id}`, payload);
            toastOk('Dossier mis à jour', `${payload.first_name} ${payload.last_name}`);
          } else {
            const r = await api.post('/students', payload);
            toastOk('Élève inscrit', `Matricule ${r.data?.matricule || 'généré'}. Pensez à rattacher un parent.`);
          }
          close();
          onSaved?.();
        } catch (err) {
          if (err.fields) showFieldErrors(form, err.fields);
          toastErr(err.status === 409 ? 'Conflit' : 'Enregistrement impossible', err.message);
        }
      }));
      layer.querySelector('#sf-del')?.addEventListener('click', async () => {
        const okDel = await confirmDialog({
          title: 'Supprimer ce dossier ?', danger: true, confirmLabel: 'Supprimer définitivement',
          message: `Le dossier de ${s.first_name} ${s.last_name} sera supprimé avec ses données de scolarité. Cette action est irréversible.`,
          details: `<div class="alert alert-warn">${icon('alert-triangle', { size: 16 })}<div class="alert-body">Préférez la <b>radiation</b> pour conserver l'historique (notes, paiements, présences) : elle est requise pour les archives réglementaires.</div></div>`,
        });
        if (!okDel) return;
        try { await api.del(`/students/${id}`); close(); toastOk('Dossier supprimé'); onSaved?.(); }
        catch (err) { toastErr('Suppression impossible', err.message); }
      });
    },
  });
  return m;
}

/* ================================================================== */
/* Import Excel / CSV                                                  */
/* ================================================================== */
function importWizard(onDone) {
  const step = { n: 1 };
  const form = h(`<div>
    <div class="steps mb-4" id="imp-steps"></div>
    <div id="imp-body"></div>
  </div>`);
  const m = modal({
    title: 'Importer des élèves depuis Excel',
    subtitle: 'Copiez-collez vos lignes ou chargez un fichier CSV : matricules et comptes parents sont générés automatiquement.',
    icon: 'upload', size: 'modal-wide', body: form,
    footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
      <button class="btn btn-primary" id="imp-next">Suivant ${icon('chevron-right', { size: 14 })}</button>`,
    onMount: (layer, close) => {
      const steps = ['1. Coller les données', '2. Vérifier', '3. Importer'];
      const stepsEl = layer.querySelector('#imp-steps');
      const bodyEl = layer.querySelector('#imp-body');
      const nextBtn = layer.querySelector('#imp-next');
      let preview = null;

      const paintSteps = () => {
        stepsEl.innerHTML = steps.map((s2, i) => `<div class="step ${i + 1 === step.n ? 'is-active' : i + 1 < step.n ? 'is-done' : ''}">
          <span class="step-num">${i + 1 < step.n ? icon('check', { size: 12 }) : i + 1}</span>${esc(s2)}</div>`).join('');
      };
      const paintBody = () => {
        paintSteps();
        if (step.n === 1) {
          nextBtn.textContent = 'Analyser les données';
          bodyEl.innerHTML = `
            <div class="alert alert-brand mb-3">${icon('info', { size: 16 })}<div class="alert-body">
              <div class="alert-title">Format attendu</div>
              <div class="alert-msg">Une ligne par élève, séparée par des tabulations (copier depuis Excel) ou des points-virgules (CSV).
              Colonnes dans l'ordre : <b>nom, prénom, sexe (M/F), date de naissance (AAAA-MM-JJ), classe, nom du parent, téléphone du parent</b>.
              Les colonnes manquantes seront ignorées.</div></div></div>
            <div class="field"><label for="imp-file">…ou chargez un fichier CSV</label>
              <input class="input" type="file" id="imp-file" accept=".csv,.txt,text/csv"></div>
            <div class="field"><label for="imp-text">Coller les données</label>
              <textarea class="textarea" id="imp-text" rows="9" placeholder="Diop;Aminata;F;2013-04-12;6ème A;Mamadou Diop;+221770000000&#10;Sarr;Ousmane;M;2012-11-03;5ème B;Fatou Sarr;+221771111111" style="font-family:var(--font-mono);font-size:12px"></textarea>
              <div class="hint">Astuce : sélectionnez vos lignes dans Excel, copiez (Ctrl+C) et collez ici.</div></div>
            <button class="btn btn-link btn-sm" id="imp-sample" type="button">${icon('download', { size: 13 })} Télécharger un modèle CSV</button>`;
          bodyEl.querySelector('#imp-sample').addEventListener('click', () => downloadSample());
          bodyEl.querySelector('#imp-file').addEventListener('change', async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            bodyEl.querySelector('#imp-text').value = await f.text();
            toastOk('Fichier chargé', `${f.name} · ${Math.round(f.size / 1024)} Ko`);
          });
        }
        if (step.n === 2) {
          nextBtn.innerHTML = `${icon('upload', { size: 14 })} Importer ${preview?.valid?.length || 0} élève(s)`;
          bodyEl.innerHTML = `
            <div class="grid grid-kpi mb-3">
              ${mini('Lignes détectées', num(preview.total), '', 'brand', 'Depuis vos données')}
              ${mini('Valides', num(preview.valid.length), '', 'ok', 'Prêtes à importer')}
              ${mini('À corriger', num(preview.errors.length), '', preview.errors.length ? 'danger' : 'ok', preview.errors.length ? 'Voir ci-dessous' : 'Aucune erreur')}
              ${mini('Doublons', num(preview.duplicates || 0), '', preview.duplicates ? 'warn' : 'ok', 'Déjà inscrits')}
            </div>
            ${preview.errors.length ? `<div class="alert alert-danger mb-3">${icon('alert-triangle', { size: 16 })}<div class="alert-body">
              <div class="alert-title">${preview.errors.length} ligne(s) à corriger</div>
              <div class="alert-msg">${preview.errors.slice(0, 6).map((e) => `Ligne ${e.line} : ${esc(e.message)}`).join('<br>')}${preview.errors.length > 6 ? '<br>…' : ''}</div></div></div>` : ''}
            ${preview.valid.length ? `<div class="table-wrap" style="max-height:260px"><table class="data dense table-zebra">
              <thead><tr><th>Nom</th><th>Prénom</th><th>Sexe</th><th>Naissance</th><th>Classe</th><th>Parent</th><th>Téléphone</th></tr></thead>
              <tbody>${preview.valid.slice(0, 40).map((r) => `<tr><td>${esc(r.last_name)}</td><td>${esc(r.first_name)}</td><td>${esc(r.gender)}</td>
                <td class="num">${esc(r.birth_date || '')}</td><td>${esc(r.class_name || '')}</td><td>${esc(r.parent_name || '')}</td><td class="num">${esc(r.parent_phone || '')}</td></tr>`).join('')}</tbody>
            </table></div>${preview.valid.length > 40 ? `<p class="tiny subtle mt-2">… et ${preview.valid.length - 40} autre(s).</p>` : ''}` : ''}`;
        }
        if (step.n === 3) {
          nextBtn.hidden = true;
          bodyEl.innerHTML = `<div class="empty"><div class="empty-icon" style="color:var(--ok)">${icon('check-circle', { size: 26 })}</div>
            <h3>Import terminé</h3><p id="imp-result">Traitement en cours…</p>
            <div class="actions"><button class="btn btn-primary" id="imp-goto">${icon('users', { size: 15 })} Voir les élèves</button></div></div>`;
          bodyEl.querySelector('#imp-goto').addEventListener('click', () => { close(); onDone?.(); });
        }
      };

      const downloadSample = () => {
        const csv = '\ufeffnom;prenom;sexe;date_naissance;classe;parent_nom;parent_telephone\nDiop;Aminata;F;2013-04-12;6ème A;Mamadou Diop;+221770000000\nSarr;Ousmane;M;2012-11-03;5ème B;Fatou Sarr;+221771111111\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'modele-import-eleves.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      };

      nextBtn.addEventListener('click', async () => {
        if (step.n === 1) {
          const content = form.querySelector('#imp-text')?.value || '';
          if (!content.trim()) return toastErr('Aucune donnée', 'Collez vos lignes ou chargez un fichier CSV.');
          nextBtn.disabled = true;
          try {
            const r = await api.post('/students/import', { content, commit: false });
            preview = r.data;
            step.n = 2;
            paintBody();
          } catch (err) { toastErr('Analyse impossible', err.message); }
          nextBtn.disabled = false;
        } else if (step.n === 2) {
          if (!preview?.valid?.length) return toastErr('Rien à importer', 'Corrigez les lignes signalées puis revenez en arrière.');
          nextBtn.disabled = true;
          nextBtn.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> Import en cours…`;
          try {
            const content = form.querySelector('#imp-text')?.value || '';
            const r = await api.post('/students/import', { content, commit: true });
            step.n = 3;
            paintBody();
            form.querySelector('#imp-result').innerHTML = `<b class="num">${r.data?.created ?? preview.valid.length}</b> élève(s) créé(s)${r.data?.guardians_created ? `, <b class="num">${r.data.guardians_created}</b> tuteur(s) rattaché(s)` : ''}${r.data?.duplicates ? ` · ${r.data.duplicates} doublon(s) ignoré(s)` : ''}.`;
            toastOk('Import réussi', `${r.data?.created ?? preview.valid.length} élève(s) inscrit(s).`);
            onDone?.();
          } catch (err) {
            toastErr('Import impossible', err.message);
            nextBtn.disabled = false;
            nextBtn.innerHTML = `${icon('upload', { size: 14 })} Réessayer l'import`;
          }
        }
      });
      paintBody();
    },
  });
  return m;
}

/* ================================================================== */
/* Export CSV                                                          */
/* ================================================================== */
async function exportSelection(ids) {
  try {
    const url = ids?.length ? `/students/export/csv?ids=${ids.join(',')}` : `/students/export/csv?${new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')))}`;
    toastInfo('Export en cours', 'Le fichier CSV (compatible Excel) va être téléchargé.');
    await api.download(url, `eleves-${new Date().toISOString().slice(0, 10)}.csv`);
    toastOk('Export terminé', `${ids?.length || lastMeta?.total || 0} ligne(s) exportée(s).`);
  } catch (err) { toastErr('Export impossible', err.message); }
}

/* ================================================================== */
/* Actions en masse                                                    */
/* ================================================================== */
async function changeClassWizard(ids, onDone) {
  let classes = [];
  try {
    const c = await api.get('/academics/classes?limit=200', { cacheTtl: 60000 });
    classes = c.data || [];
  } catch { /* ignore */ }
  modal({
    title: `Changer de classe (${ids.length} élève${ids.length > 1 ? 's' : ''})`,
    subtitle: 'Le matricule est conservé et l\'historique de classe est tracé.',
    icon: 'repeat',
    body: `<form id="cc-form">
      ${field({ label: 'Nouvelle classe', name: 'class_id', type: 'select', required: true, placeholder: '— Choisir —',
        options: classes.map((c) => ({ value: c.id, label: `${c.name} (${c.effectif ?? 0}/${c.capacity})${c.effectif >= c.capacity ? ' — complète' : ''}` })) })}
      ${field({ label: 'Motif', name: 'reason', type: 'select', options: [
        { value: 'reorientation', label: 'Réorientation pédagogique' },
        { value: 'effectif', label: 'Équilibrage des effectifs' },
        { value: 'demande', label: 'Demande de la famille' },
        { value: 'redoublement', label: 'Redoublement' },
        { value: 'autre', label: 'Autre' }] })}
      ${field({ label: 'Date d\'effet', name: 'effective_date', type: 'date', value: new Date().toISOString().slice(0, 10) })}
      ${field({ label: 'Notifier les parents par SMS', name: 'notify', type: 'switch', value: true, hint: '25 FCFA par SMS et par parent.' })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="cc-go">${icon('repeat', { size: 15 })} Appliquer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#cc-go').addEventListener('click', () => withBusy(layer.querySelector('#cc-go'), async () => {
        const payload = readForm(layer.querySelector('#cc-form'), ['class_id']);
        if (!payload.class_id) return toastErr('Classe requise');
        try {
          const results = await Promise.all(ids.map((sid) => api.post(`/students/${sid}/change-class`, payload).then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, e }))));
          const okN = results.filter((r) => r.ok).length;
          close();
          toastOk('Changement effectué', `${okN}/${ids.length} élève(s) déplacé(s).`);
          if (okN < ids.length) toastErr('Échecs partiels', results.filter((r) => !r.ok).map((r) => r.e.message).slice(0, 3).join(' · '));
          onDone?.();
        } catch (err) { toastErr('Opération impossible', err.message); }
      }));
    },
  });
}

async function radierWizard(ids, onDone) {
  modal({
    title: `Radier ${ids.length} élève(s)`, icon: 'archive', size: 'modal-narrow',
    body: `<p class="subtle small mb-3">La radiation conserve tout l'historique (notes, paiements, présences) et ferme le portail parent.</p>
      <form id="rad-form">
        ${field({ label: 'Motif de radiation', name: 'reason', type: 'select', required: true, options: [
          { value: 'transfert', label: 'Transfert vers un autre établissement' },
          { value: 'demenagement', label: 'Déménagement de la famille' },
          { value: 'fin_cycle', label: 'Fin de cycle (diplômé)' },
          { value: 'abandon', label: 'Abandon scolaire' },
          { value: 'exclusion', label: 'Exclusion définitive' },
          { value: 'impaye', label: 'Impayés prolongés' }] })}
        ${field({ label: 'Date d\'effet', name: 'exit_date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${field({ label: 'Commentaire', name: 'notes', type: 'textarea', rows: 2 })}
        ${field({ label: 'Notifier la famille par SMS', name: 'notify', type: 'switch', value: true })}
      </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-danger" id="rad-go">${icon('archive', { size: 15 })} Confirmer la radiation</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#rad-go').addEventListener('click', async () => {
        const sure = await confirmDialog({ title: 'Confirmer la radiation ?', danger: true, confirmLabel: 'Radier', message: `${ids.length} dossier(s) seront radiés. L'opération est tracée dans le journal d'audit.` });
        if (!sure) return;
        const payload = readForm(layer.querySelector('#rad-form'));
        try {
          const results = await Promise.all(ids.map((sid) => api.patch(`/students/${sid}`, { status: 'radie', ...payload }).then(() => true).catch(() => false)));
          close();
          toastOk('Radiation enregistrée', `${results.filter(Boolean).length}/${ids.length} dossier(s).`);
          onDone?.();
        } catch (err) { toastErr('Opération impossible', err.message); }
      });
    },
  });
}

/* ================================================================== */
/* PAGE COMPLÈTE D'UN ÉLÈVE (lien partageable, impression)             */
/* ================================================================== */
async function studentPage(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerBlock()}</div></div>`;
  try {
    const r = await api.get(`/students/${id}`);
    const s = r.data.student;
    el.innerHTML = `
      <header class="row-between wrap mb-4">
        <div class="row gap-3">
          <a class="btn btn-ghost btn-icon" href="#/scolaire/eleves" aria-label="Retour">${icon('arrow-left', { size: 18 })}</a>
          ${avatar({ first: s.first_name, last: s.last_name, src: s.photo_url, size: 'avatar-lg' })}
          <div><div class="uppercase mb-2">Dossier élève</div>
            <h1 class="h-page" style="margin:0">${esc(s.first_name)} ${esc(s.last_name)}</h1>
            <p class="subtle small">${esc(s.matricule)} · ${esc(s.classe || '')} · ${ageFrom(s.birth_date)} ans · ${badge(STATUT_ELEVE[s.status]?.label || s.status, STATUT_ELEVE[s.status]?.tone || 'neutral')}</p></div>
        </div>
        <div class="row gap-2 wrap no-print">
          <button class="btn btn-secondary" id="p-print">${icon('printer', { size: 15 })} Imprimer</button>
          <button class="btn btn-secondary" id="p-edit">${icon('edit', { size: 15 })} Modifier</button>
          <button class="btn btn-primary" id="p-pay">${icon('banknote', { size: 15 })} Encaisser</button>
        </div>
      </header>
      <div id="p-body"></div>`;
    el.querySelector('#p-print').addEventListener('click', () => window.print());
    el.querySelector('#p-edit').addEventListener('click', () => studentForm(id, () => studentPage(el, id)));
    el.querySelector('#p-pay').addEventListener('click', () => go(`/finance/paiements?new=1&student=${id}`));
    const body = el.querySelector('#p-body');
    body.className = 'print-area';
    const inv = r.data.invoices || [];
    const recouvre = inv.length ? (inv.reduce((a, i) => a + (i.paid_amount || 0), 0) / Math.max(1, inv.reduce((a, i) => a + (i.amount || 0), 0))) * 100 : 100;
    body.innerHTML = `<div class="grid grid-2">
      <div class="card"><div class="card-body"><h3 class="h-card">${icon('clipboard-list', { size: 15 })} État civil & scolarité</h3>
        <dl class="dl">${dl([
          ['Matricule', s.matricule], ['Nom complet', `${s.first_name} ${s.last_name}`],
          ['Sexe', s.gender === 'F' ? 'Fille' : 'Garçon'], ['Date de naissance', s.birth_date ? dateLong(s.birth_date) : '—'],
          ['Lieu de naissance', s.birth_place || '—'], ['Nationalité', s.nationality || '—'],
          ['Classe', s.classe || '—'], ['Niveau / cycle', `${s.niveau || '—'} · ${s.cycle || '—'}`],
          ['Professeur principal', s.prof_principal || '—'], ['Inscription', dateLong(s.enrolled_at)],
          ['Établissement précédent', s.previous_school || '—'], ['Adresse', `${s.address || ''} ${s.city || ''}`.trim() || '—'],
          ['Téléphone d\'urgence', s.emergency_phone ? telFr(s.emergency_phone) : '—'],
        ])}</dl></div></div>
      <div class="col gap-4">
        <div class="card"><div class="card-body"><h3 class="h-card">${icon('gauge', { size: 15 })} Indicateurs</h3>
          <div class="row gap-4 wrap" style="justify-content:space-around">
            ${gauge(s.taux_presence ?? 0, { size: 104, thickness: 10, label: 'Présence', suffix: '%' })}
            ${gauge(s.moyenne ?? 0, { size: 104, thickness: 10, label: 'Moyenne /20', max: 20, suffix: '' })}
            ${gauge(Math.round(recouvre), { size: 104, thickness: 10, label: 'Recouvrement', suffix: '%' })}
          </div></div></div>
        <div class="card"><div class="card-body"><h3 class="h-card">${icon('users', { size: 15 })} Famille</h3>
          <div class="list">${(r.data.guardians || []).map((g2) => `<div class="list-item">
            ${avatar({ first: g2.first_name, last: g2.last_name, size: 'avatar-sm' })}
            <span class="li-body"><span class="li-title">${esc(g2.first_name)} ${esc(g2.last_name)}</span>
              <span class="li-sub">${esc(g2.relation || 'Tuteur')} · ${esc(telFr(g2.phone || ''))}</span></span></div>`).join('') || '<p class="subtle small">Aucun tuteur rattaché.</p>'}</div>
        </div></div>
      </div>
    </div>
    <div class="card mt-4"><div class="card-body" style="padding:0">
      <div style="padding:12px 14px"><h3 class="h-card" style="margin:0">${icon('receipt', { size: 15 })} Situation financière</h3></div>
      ${dataTable({
        columns: [
          { key: 'n', label: 'Facture', render: (x) => `<a class="link-strong" href="#/finance/factures/${x.id}">${esc(x.invoice_number)}</a>` },
          { key: 'l', label: 'Libellé', render: (x) => esc(x.label || x.fee_type || '') },
          { key: 'a', label: 'Montant', align: 'right', render: (x) => `<b class="num">${xof(x.amount)}</b>` },
          { key: 'p', label: 'Payé', align: 'right', render: (x) => `<span class="num">${xof(x.paid_amount || 0)}</span>` },
          { key: 'd', label: 'Échéance', render: (x) => dateFr(x.due_date) },
          { key: 's', label: 'Statut', align: 'right', render: (x) => statutPaiementBadge(x.status) },
        ], rows: r.data.invoices || [], dense: true, zebra: true,
        empty: { icon: 'receipt', title: 'Aucune facture', message: 'Générez des factures depuis le module Finances.' },
      }).outerHTML}
    </div></div>
    <div class="row gap-2 mt-4 no-print">
      <button class="btn btn-secondary" id="p-drawer">${icon('panel-left', { size: 15 })} Ouvrir le dossier complet</button>
      <a class="btn btn-secondary" href="#/pedagogie/bulletins?student=${id}">${icon('file-text', { size: 15 })} Bulletins</a>
      <a class="btn btn-secondary" href="#/vie-scolaire/absences?student=${id}">${icon('clock-alert', { size: 15 })} Absences</a>
      <a class="btn btn-secondary" href="#/finance/factures?student=${id}">${icon('wallet', { size: 15 })} Finances</a>
    </div>`;
    body.querySelector('#p-drawer')?.addEventListener('click', () => studentDrawer(id));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'user', title: 'Dossier introuvable', message: err.message })}
      <div class="actions"><a class="btn btn-primary" href="#/scolaire/eleves">Retour à la liste</a></div></div></div>`;
  }
}
const spinnerBlock = () => `<div class="row gap-3 subtle small" style="justify-content:center;padding:40px"><span class="spinner"></span>Chargement…</div>`;

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerStudents(route) {
  route('/scolaire/eleves', async () => {
    const el = h('<div class="view"></div>');
    await listView(el);
    return el;
  }, { title: 'Élèves', group: 'Scolarité' });

  route('/scolaire/eleves/:id', async ({ params }) => {
    const el = h('<div class="view"></div>');
    studentPage(el, Number(params.id));
    return el;
  }, { title: 'Dossier élève', group: 'Scolarité' });

  route('/scolaire/admissions', async () => {
    const el = h('<div class="view"></div>');
    el.innerHTML = `<div class="card"><div class="card-body">${spinnerBlock()}</div></div>`;
    (async () => {
      try {
        const r = await api.get('/people/applications?limit=50');
        const rows = r.data || [];
        el.innerHTML = `<header class="row-between wrap mb-4">
            <div><div class="uppercase mb-2">Scolarité</div><h1 class="h-page">Admissions & pré-inscriptions</h1>
              <p class="subtle small mt-2">Suivez les demandes reçues, planifiez les entretiens et convertissez les dossiers acceptés en élèves.</p></div>
            <button class="btn btn-primary" data-new id="ad-new">${icon('user-plus', { size: 15 })} Nouvelle demande</button></header>
          <div class="card"><div class="card-body" style="padding:0">${rows.length ? dataTable({
            columns: [
              { key: 'name', label: 'Candidat', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
                  <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.reference || '')}</div></div></div>` },
              { key: 'level', label: 'Niveau demandé', width: '140px', render: (x) => esc(x.level_name || x.class_name || '—') },
              { key: 'year', label: 'Année', width: '110px', hideBelow: 'md', render: (x) => esc(x.academic_year || '') },
              { key: 'parent', label: 'Parent', hideBelow: 'lg', render: (x) => `<span class="small">${esc(x.parent_name || '—')}</span><div class="tiny subtle">${esc(telFr(x.parent_phone || ''))}</div>` },
              { key: 'date', label: 'Reçue le', width: '110px', hideBelow: 'md', render: (x) => dateFr(x.created_at) },
              { key: 'status', label: 'Statut', width: '130px', align: 'right', render: (x) => badge(x.status === 'acceptee' ? 'Acceptée' : x.status === 'refusee' ? 'Refusée' : x.status === 'entretien' ? 'Entretien' : 'En attente',
                x.status === 'acceptee' ? 'ok' : x.status === 'refusee' ? 'danger' : x.status === 'entretien' ? 'info' : 'neutral') },
              { key: 'act', label: '', width: '150px', align: 'right', render: (x) => x.status === 'acceptee'
                ? `<button class="btn btn-primary btn-sm" data-conv="${x.id}">${icon('user-check', { size: 13 })} Inscrire</button>`
                : `<button class="btn btn-secondary btn-sm" data-decide="${x.id}">${icon('sliders', { size: 13 })} Traiter</button>` },
            ], rows, dense: true, zebra: true,
          }).outerHTML : emptyState({ icon: 'user-plus', title: 'Aucune demande', message: 'Les pré-inscriptions reçues en ligne ou saisies apparaîtront ici.', actions: [{ id: 'new', label: 'Saisir une demande', icon: 'plus', variant: 'btn-primary' }] })}</div></div>`;
        el.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Convertir en élève ?', message: 'Le dossier sera créé avec le statut « admis ». Vous pourrez compléter la fiche ensuite.', confirmLabel: 'Inscrire' }))) return;
          try { const r2 = await api.post(`/people/applications/${b.dataset.conv}/convert`); toastOk('Élève inscrit', `Matricule ${r2.data?.matricule || r2.data?.id || ''}`); listView(el); }
          catch (e) { toastErr('Conversion impossible', e.message); }
        }));
        el.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => decideApplication(b.dataset.decide, () => listView(el))));
        el.querySelector('#ad-new')?.addEventListener('click', () => newApplication(() => listView(el)));
        el.querySelector('[data-empty-action="new"]')?.addEventListener('click', () => newApplication(() => listView(el)));
      } catch (err) {
        el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message })}</div></div>`;
      }
    })();
    return el;
  }, { title: 'Admissions', group: 'Scolarité' });
}

function decideApplication(id, onDone) {
  modal({
    title: 'Traiter la demande d\'admission', icon: 'user-check', size: 'modal-narrow',
    body: `<form id="dec-form">
      ${field({ label: 'Décision', name: 'status', type: 'select', required: true, options: [
        { value: 'entretien', label: 'Convoquer à un entretien' }, { value: 'acceptee', label: 'Accepter la candidature' },
        { value: 'refusee', label: 'Refuser la candidature' }, { value: 'liste_attente', label: 'Mettre en liste d\'attente' }] })}
      ${field({ label: 'Date d\'entretien', name: 'interview_date', type: 'date' })}
      ${field({ label: 'Commentaire', name: 'decision_notes', type: 'textarea', rows: 3, placeholder: 'Motif de la décision, observations…' })}
      ${field({ label: 'Notifier la famille par SMS', name: 'notify', type: 'switch', value: true })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="dec-go">${icon('check', { size: 15 })} Enregistrer la décision</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#dec-go').addEventListener('click', () => withBusy(layer.querySelector('#dec-go'), async () => {
        const payload = readForm(layer.querySelector('#dec-form'));
        try { await api.patch(`/people/applications/${id}`, payload); close(); toastOk('Décision enregistrée'); onDone?.(); }
        catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

function newApplication(onDone) {
  modal({
    title: 'Nouvelle demande d\'admission', icon: 'user-plus', size: 'modal-wide',
    body: `<form id="na-form">
      <div class="fieldset"><legend>${icon('baby', { size: 14 })} Candidat</legend><div class="grid-2">
        ${field({ label: 'Prénom', name: 'first_name', required: true })}
        ${field({ label: 'Nom', name: 'last_name', required: true })}
        ${field({ label: 'Sexe', name: 'gender', type: 'select', options: [{ value: 'M', label: 'Garçon' }, { value: 'F', label: 'Fille' }] })}
        ${field({ label: 'Date de naissance', name: 'birth_date', type: 'date' })}
        ${field({ label: 'Niveau demandé', name: 'level_name', placeholder: 'Ex. 6ème' })}
        ${field({ label: 'Établissement précédent', name: 'previous_school' })}
      </div></div>
      <div class="fieldset"><legend>${icon('contact-card', { size: 14 })} Famille</legend><div class="grid-2">
        ${field({ label: 'Nom du parent', name: 'parent_name', required: true })}
        ${field({ label: 'Téléphone', name: 'parent_phone', required: true, placeholder: '+221 7X XXX XX XX' })}
        ${field({ label: 'E-mail', name: 'parent_email', type: 'email' })}
        ${field({ label: 'Ville', name: 'city' })}
      </div></div>
      ${field({ label: 'Observations', name: 'notes', type: 'textarea', rows: 2 })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="na-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#na-go').addEventListener('click', () => withBusy(layer.querySelector('#na-go'), async () => {
        try {
          await api.post('/people/applications', readForm(layer.querySelector('#na-form')));
          close();
          toastOk('Demande enregistrée', 'Elle apparaît dans la file des admissions.');
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

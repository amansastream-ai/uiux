/**
 * SunuÉcole — Pédagogie & organisation : classes, emploi du temps, saisie des
 * notes, résultats, bulletins imprimables, cahier de textes, devoirs.
 *
 * La saisie des notes est optimisée pour le clavier (comme l'appel) : flèches
 * pour naviguer, chiffres pour noter, Ctrl+S pour publier. Un enseignant note
 * une classe de 40 élèves en moins de deux minutes.
 */
import { api } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination,
  toolbar, field, readForm, modal, confirmDialog, toast, toastOk, toastErr, toastInfo, debounce, withBusy, tabs,
} from '../ui/components.js';
import { num, note, pct, dateFr, dateLong, dictLabel, dictEntries, TYPES_EVALUATION, JOURS_COURTS } from '../core/format.js';
import { barChart, donutChart } from '../core/charts.js';

/* ================================================================== */
/* CLASSES : liste                                                     */
/* ================================================================== */
async function classesView(el) {
  el.innerHTML = `<header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Scolarité</div><h1 class="h-page">Classes & niveaux</h1>
        <p class="subtle small mt-2">Structure pédagogique de l'établissement : niveaux, classes, capacités, professeurs principaux et matières enseignées.</p></div>
      <div class="row gap-2">${store.atLeast(65) ? `<button class="btn btn-primary" data-new id="cl-new">${icon('plus', { size: 15 })} Nouvelle classe</button>` : ''}</div>
    </header>
    <div id="cl-body">${skeletonRows(8, 5)}</div>`;
  const load = async () => {
    try {
      const r = await api.get('/academics/classes?limit=200', { cacheTtl: 20000 });
      const rows = r.data || [];
      const grouped = {};
      rows.forEach((c) => { (grouped[c.cycle || 'Autre'] ||= []).push(c); });
      el.querySelector('#cl-body').innerHTML = Object.entries(grouped).map(([cycle, list]) => `
        <section class="card mt-4">
          <div class="card-head"><div><h2>${icon('layers', { size: 16 })} Cycle ${esc(cycle)}</h2>
            <p class="subtle tiny mt-2">${list.length} classe(s) · ${num(list.reduce((a, c) => a + (c.effectif || 0), 0))} élèves · capacité ${num(list.reduce((a, c) => a + (c.capacity || 0), 0))}</p></div></div>
          <div class="card-body" style="padding:0">${dataTable({
            columns: [
              { key: 'name', label: 'Classe', width: '130px', render: (c) => `<a class="link-strong" href="#/scolaire/classes/${c.id}">${esc(c.name)}</a>` },
              { key: 'level', label: 'Niveau', width: '110px', hideBelow: 'md', render: (c) => esc(c.niveau || '') },
              { key: 'effectif', label: 'Effectif', width: '150px', render: (c) => `<div class="row gap-2">${progress((c.effectif / Math.max(1, c.capacity)) * 100, c.effectif > c.capacity ? 'danger' : c.effectif / c.capacity > .92 ? 'warn' : '')}<span class="num tiny" style="width:56px">${c.effectif}/${c.capacity}</span></div>` },
              { key: 'prof', label: 'Professeur principal', hideBelow: 'lg', render: (c) => (c.prof_principal ? `<span class="small">${esc(c.prof_principal)}</span>` : badge('Non attribué', 'warn')) },
              { key: 'room', label: 'Salle', width: '110px', hideBelow: 'xl', render: (c) => esc(c.room || '—') },
              { key: 'shift', label: 'Session', width: '100px', hideBelow: 'xl', render: (c) => badge(c.shift === 'jour' ? 'Jour' : c.shift === 'soir' ? 'Soir' : c.shift, 'neutral') },
              { key: 'act', label: '', width: '180px', align: 'right', render: (c) => `<div class="row gap-1" style="justify-content:flex-end">
                  <a class="btn btn-secondary btn-sm" href="#/vie-scolaire/presences?class_id=${c.id}">${icon('clipboard-check', { size: 13 })} Appel</a>
                  <a class="btn btn-secondary btn-sm" href="#/scolaire/classes/${c.id}">${icon('eye', { size: 13 })} Ouvrir</a></div>` },
            ],
            rows: list, dense: true, zebra: true, rowKey: (c) => c.id,
          }).outerHTML}</div>
        </section>`).join('') || `<div class="card"><div class="card-body">${emptyState({ icon: 'school', title: 'Aucune classe', message: 'Créez vos niveaux puis vos classes pour commencer.', actions: [{ id: 'new', label: 'Créer une classe', icon: 'plus', variant: 'btn-primary' }] })}</div></div>`;
      el.querySelectorAll('[data-empty-action="new"]').forEach((b) => b.addEventListener('click', () => classForm(null, load)));
    } catch (err) {
      el.querySelector('#cl-body').innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message })}</div></div>`;
    }
  };
  el.querySelector('#cl-new')?.addEventListener('click', () => classForm(null, load));
  load();
}

function classForm(id, onDone) {
  modal({
    title: id ? 'Modifier la classe' : 'Nouvelle classe', icon: id ? 'edit' : 'school', size: 'modal-narrow',
    body: `<form id="cf-form">${spinnerNote('Chargement…')}</form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="cf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: async (layer, close) => {
      let niveaux = [];
      let teachers = [];
      let current = null;
      try {
        const [l, t, c] = await Promise.all([
          api.get('/academics/levels', { cacheTtl: 120000 }),
          api.get('/people/staff?limit=200&job=enseignant', { cacheTtl: 60000 }).catch(() => ({ data: [] })),
          id ? api.get(`/academics/classes/${id}`) : Promise.resolve(null),
        ]);
        niveaux = l.data?.levels || l.data || [];
        teachers = (c?.data ? [] : []) || (t.data || []);
        current = c?.data?.class || null;
      } catch { /* listes vides */ }
      layer.querySelector('#cf-form').innerHTML = `<div class="grid-2">
          ${field({ label: 'Nom de la classe', name: 'name', value: current?.name || '', required: true, placeholder: '6ème A' })}
          ${field({ label: 'Niveau', name: 'level_id', type: 'select', value: current?.level_id || '', required: true, placeholder: '—', options: niveaux.map((n) => ({ value: n.id, label: `${n.name} (${n.cycle})` })) })}
          ${field({ label: 'Capacité', name: 'capacity', type: 'number', value: current?.capacity || 40, min: 1, max: 200 })}
          ${field({ label: 'Salle', name: 'room', value: current?.room || '', placeholder: 'Salle 3' })}
          ${field({ label: 'Professeur principal', name: 'main_teacher_id', type: 'select', value: current?.main_teacher_id || '', placeholder: '— Aucun —', options: teachers.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` })) })}
          ${field({ label: 'Session', name: 'shift', type: 'select', value: current?.shift || 'jour', options: [{ value: 'jour', label: 'Jour' }, { value: 'soir', label: 'Soir' }] })}
        </div>
        ${field({ label: 'Couleur', name: 'color', type: 'select', value: current?.color || '#0e7c66', options: ['#0e7c66', '#1d4ed8', '#b45309', '#7c3aed', '#db2777', '#0891b2', '#c2410c'].map((c2) => ({ value: c2, label: c2 })) })}`;
      layer.querySelector('#cf-go').addEventListener('click', () => withBusy(layer.querySelector('#cf-go'), async () => {
        const payload = readForm(layer.querySelector('#cf-form'), ['level_id', 'capacity', 'main_teacher_id']);
        if (id) payload.id = id;
        try {
          const r = id ? await api.post('/settings/classes', payload) : await api.post('/settings/classes', payload);
          close();
          toastOk(id ? 'Classe mise à jour' : 'Classe créée', payload.name);
          onDone?.(r.data?.id);
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}
const spinnerNote = (t) => `<div class="row gap-3 subtle small"><span class="spinner"></span>${esc(t)}</div>`;

/* ================================================================== */
/* FICHE CLASSE                                                        */
/* ================================================================== */
async function classView(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement de la classe…')}</div></div>`;
  try {
    const r = await api.get(`/academics/classes/${id}`);
    const d = r.data;
    const c = d.class;
    el.innerHTML = `
      <header class="row-between wrap mb-4">
        <div class="row gap-3">
          <a class="btn btn-ghost btn-icon" href="#/scolaire/classes" aria-label="Retour">${icon('arrow-left', { size: 18 })}</a>
          <div><div class="uppercase mb-2">Classe · ${esc(c.niveau || '')} · cycle ${esc(c.cycle || '')}</div>
            <h1 class="h-page" style="margin:0">${esc(c.name)}</h1>
            <p class="subtle small">${esc(c.room || 'Salle non attribuée')} · capacité ${c.capacity} · ${c.prof_principal ? `prof principal : ${esc(c.prof_principal)}` : 'pas de prof principal'}</p></div>
        </div>
        <div class="row gap-2 wrap">
          <button class="btn btn-secondary" id="cv-tt">${icon('calendar-days', { size: 15 })} Emploi du temps</button>
          <button class="btn btn-secondary" id="cv-notes">${icon('pen-tool', { size: 15 })} Saisir des notes</button>
          <button class="btn btn-primary" id="cv-appel">${icon('clipboard-check', { size: 15 })} Faire l'appel</button>
        </div>
      </header>
      <div class="grid grid-kpi">
        ${kpiCard('Effectif', `${d.students.length}`, 'users', 'brand', `sur ${c.capacity} places (${pct((d.students.length / Math.max(1, c.capacity)) * 100)})`)}
        ${kpiCard('Moyenne de classe', note(d.stats?.moyenne), 'graduation-cap', (d.stats?.moyenne || 0) >= 10 ? 'ok' : 'danger', `min ${note(d.stats?.min)} · max ${note(d.stats?.max)}`)}
        ${kpiCard('Taux de présence', `${d.attendance?.taux ?? '—'}`, 'clipboard-check', (d.attendance?.taux || 0) >= 90 ? 'ok' : 'warn', 'Sur les 30 derniers jours')}
        ${kpiCard('Matières enseignées', `${d.subjects.length}`, 'book-open', 'info', `${d.subjects.reduce((a, s) => a + (s.hours_per_week || 0), 0)} h/semaine`)}
      </div>
      <div class="grid grid-2-1 mt-4">
        <div class="card">
          <div class="card-head"><div><h2>${icon('users', { size: 16 })} Élèves (${d.students.length})</h2>
            <p class="subtle tiny mt-2">Cliquez sur un élève pour ouvrir sa fiche complète.</p></div>
            <a class="btn btn-secondary btn-sm" href="#/scolaire/eleves?class_id=${id}">${icon('external-link', { size: 14 })} Dans la liste</a></div>
          <div class="card-body" style="padding:0" id="cv-eleves"></div>
        </div>
        <div class="col gap-4">
          <div class="card"><div class="card-head"><div><h2>${icon('book-open', { size: 16 })} Matières & coefficients</h2></div></div>
            <div class="card-body" style="padding:0" id="cv-matieres"></div></div>
          <div class="card"><div class="card-head"><div><h2>${icon('chart-pie', { size: 16 })} Répartition des moyennes</h2></div></div>
            <div class="card-body" id="cv-chart"></div></div>
        </div>
      </div>`;
    el.querySelector('#cv-appel').addEventListener('click', () => go(`/vie-scolaire/presences?class_id=${id}`));
    el.querySelector('#cv-notes').addEventListener('click', () => go(`/pedagogie/notes?new=1&class_id=${id}`));
    el.querySelector('#cv-tt').addEventListener('click', () => go(`/scolaire/emploi-du-temps?class_id=${id}`));
    el.querySelector('#cv-eleves').innerHTML = dataTable({
      columns: [
        { key: 'nom', label: 'Élève', render: (s) => `<div class="cell-user">${avatar({ first: s.first_name, last: s.last_name, size: 'avatar-sm' })}
            <div><div class="cell-user-name">${esc(s.first_name)} ${esc(s.last_name)}</div><div class="cell-user-sub">${esc(s.matricule)}</div></div></div>` },
        { key: 'moyenne', label: 'Moyenne', align: 'right', width: '90px', render: (s) => (s.moyenne != null ? `<b class="num" style="color:${s.moyenne >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(s.moyenne)}</b>` : '—') },
        { key: 'solde', label: 'Solde', align: 'right', width: '110px', hideBelow: 'md', render: (s) => (s.solde ? `<span class="num" style="color:var(--danger)">${num(s.solde)}</span>` : '<span class="num subtle">0</span>') },
        { key: 'status', label: 'Statut', width: '96px', align: 'right', render: (s) => badge(s.status === 'actif' ? 'Actif' : s.status, s.status === 'actif' ? 'ok' : 'neutral') },
      ],
      rows: d.students, dense: true, zebra: true, onRowClick: (s) => go(`/scolaire/eleves/${s.id}`),
    }).outerHTML;
    el.querySelector('#cv-matieres').innerHTML = d.subjects.length ? `<div class="list">${d.subjects.map((s) => `<div class="list-item">
        <span class="li-ico" style="background:${esc(s.color)}22;color:${esc(s.color)}">${icon('book-open', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">${esc(s.name)}</span>
          <span class="li-sub">${esc(s.teacher || 'Enseignant non attribué')} · ${s.hours_per_week} h/sem</span></span>
        <span class="li-aside">${badge(`coef. ${s.coefficient}`, 'neutral')}</span></div>`).join('')}</div>`
      : emptyState({ icon: 'book-open', title: 'Aucune matière', message: 'Affectez des matières à cette classe dans Paramètres → Structure.' });
    const buckets = {};
    d.students.forEach((s) => {
      if (s.moyenne == null) return;
      const k = s.moyenne < 8 ? '0-8' : s.moyenne < 10 ? '8-10' : s.moyenne < 12 ? '10-12' : s.moyenne < 14 ? '12-14' : s.moyenne < 16 ? '14-16' : '16-20';
      buckets[k] = (buckets[k] || 0) + 1;
    });
    const order = ['0-8', '8-10', '10-12', '12-14', '14-16', '16-20'];
    const seriesData = order.map((k) => ({ tranche: k, n: buckets[k] || 0 }));
    el.querySelector('#cv-chart').appendChild(barChart(seriesData, {
      labels: seriesData.map((x) => x.tranche),
      series: [{ name: 'Élèves', data: seriesData.map((x) => x.n), color: '#0e7c66' }],
      height: 170,
    }));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Classe indisponible', message: err.message })}</div></div>`;
  }
}
function kpiCard(label, value, ic, tone, hint) {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="${tone}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
    <div class="kpi-val">${esc(String(value))}</div><div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
}

/* ================================================================== */
/* EMPLOI DU TEMPS                                                     */
/* ================================================================== */
async function timetableView(el, query) {
  let classId = Number(query.class_id) || 0;
  let classes = [];
  let mode = query.mode || 'classe';
  try {
    const r = await api.get('/academics/classes?limit=200', { cacheTtl: 120000 });
    classes = r.data || [];
    if (!classId && classes.length) classId = classes[0].id;
  } catch { /* ignore */ }

  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Scolarité</div><h1 class="h-page">Emploi du temps</h1>
        <p class="subtle small mt-2">Grille hebdomadaire avec détection automatique des conflits (enseignant ou salle déjà occupés). Cliquez sur une case vide pour ajouter un cours.</p></div>
      <div class="row gap-2 wrap">
        <select class="select" id="tt-class" style="min-width:180px">${classes.map((c) => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <button class="btn btn-secondary" id="tt-conflicts">${icon('alert-triangle', { size: 15 })} Conflits</button>
        <button class="btn btn-secondary" id="tt-print">${icon('printer', { size: 15 })} Imprimer</button>
        ${store.atLeast(75) ? `<button class="btn btn-primary" id="tt-add">${icon('plus', { size: 15 })} Ajouter un cours</button>` : ''}
      </div>
    </header>
    <div class="card"><div class="card-body" style="padding:12px;overflow-x:auto"><div id="tt-grid">${spinnerNote('Chargement de la grille…')}</div></div></div>
    <div class="grid grid-2 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('clock', { size: 16 })} Volume horaire par matière</h2></div></div>
        <div class="card-body" id="tt-hours"></div></div>
      <div class="card"><div class="card-head"><div><h2>${icon('users', { size: 16 })} Charge des enseignants</h2>
        <p class="subtle tiny mt-2">Heures hebdomadaires par enseignant de la classe</p></div></div>
        <div class="card-body" style="padding:0" id="tt-teachers"></div></div>
    </div>`;

  const DAYS = [1, 2, 3, 4, 5, 6];
  async function load() {
    const grid = el.querySelector('#tt-grid');
    grid.innerHTML = spinnerNote('Chargement de la grille…');
    try {
      const r = await api.get(`/academics/timetable?class_id=${classId}`);
      const slots = r.data.slots || [];
      const hours = r.data.hours || [];
      const dayNames = DAYS.map((d) => JOURS_COURTS[d] || '');
      grid.innerHTML = `<div class="tt-grid" style="grid-template-columns:78px repeat(${DAYS.length}, minmax(120px,1fr))">
        <div class="tt-head"></div>
        ${dayNames.map((d) => `<div class="tt-head">${esc(d)}</div>`).join('')}
        ${hours.map((hh) => `<div class="tt-time">${esc(hh)}</div>${DAYS.map((day) => {
          const cell = slots.find((s) => s.day_of_week === day && s.start_time === hh);
          return cell
            ? `<div class="tt-cell" style="--c:${esc(cell.color || '#0e7c66')}" data-slot="${cell.id}" tabindex="0" role="button"
                 title="${esc(cell.matiere)} · ${esc(cell.enseignant || '')} · ${esc(cell.room || '')}">
                <b>${esc(cell.code || cell.matiere.slice(0, 8))}</b>
                <span>${esc(cell.enseignant || '')}</span>
                <span class="tiny">${esc(cell.room || '')}</span></div>`
            : `<button class="tt-cell tt-empty" data-day="${day}" data-time="${esc(hh)}" aria-label="Ajouter un cours ${esc(dayNames[DAYS.indexOf(day)])} ${esc(hh)}">+</button>`;
        }).join('')}`).join('')}
      </div>`;
      grid.querySelectorAll('.tt-cell[data-slot]').forEach((cellEl) => {
        cellEl.addEventListener('click', () => slotForm(Number(cellEl.dataset.slot), load));
      });
      grid.querySelectorAll('.tt-empty').forEach((b) => b.addEventListener('click', () => slotForm(null, load, { day: Number(b.dataset.day), start_time: b.dataset.time })));
      // Volume horaire
      const bySubject = {};
      slots.forEach((s) => {
        const dur = (new Date(`2026-01-01T${s.end_time}`) - new Date(`2026-01-01T${s.start_time}`)) / 60000;
        bySubject[s.matiere] = (bySubject[s.matiere] || 0) + dur;
      });
      const entries = Object.entries(bySubject).sort((a, b) => b[1] - a[1]).slice(0, 8);
      el.querySelector('#tt-hours').innerHTML = entries.length ? '' : emptyState({ icon: 'clock', title: 'Aucun cours planifié', message: 'Ajoutez des cours pour visualiser les volumes.' });
      if (entries.length) {
        el.querySelector('#tt-hours').appendChild(barChart(entries, {
          labels: entries.map(([k]) => k.length > 14 ? `${k.slice(0, 13)}…` : k),
          series: [{ name: 'Heures', data: entries.map(([, v]) => v / 60), color: '#0e7c66' }],
          horizontal: true, height: Math.max(140, entries.length * 26 + 30), yFormat: (v) => `${v} h`,
        }));
      }
      // Charge enseignants
      const byTeacher = {};
      slots.forEach((s) => {
        const dur = (new Date(`2026-01-01T${s.end_time}`) - new Date(`2026-01-01T${s.start_time}`)) / 60000;
        byTeacher[s.enseignant || 'Non attribué'] = (byTeacher[s.enseignant || 'Non attribué'] || 0) + dur;
      });
      const tEntries = Object.entries(byTeacher).sort((a, b) => b[1] - a[1]);
      el.querySelector('#tt-teachers').innerHTML = tEntries.length ? `<div class="list">${tEntries.map(([t, mins]) => `<div class="list-item">
          <span class="li-ico" data-tone="brand">${icon('user', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(t)}</span><span class="li-sub">${Math.round(mins / 60 * 10) / 10} h/semaine dans cette classe</span></span>
          <span class="li-aside" style="width:88px">${progress(Math.min(100, (mins / 60 / 24) * 100))}</span></div>`).join('')}</div>`
        : emptyState({ icon: 'users', title: 'Aucun enseignant affecté', message: 'Affectez des enseignants aux matières de la classe.' });
    } catch (err) {
      grid.innerHTML = emptyState({ icon: 'wifi-off', title: 'Grille indisponible', message: err.message });
    }
  }
  el.querySelector('#tt-class').addEventListener('change', (e) => { classId = Number(e.target.value); load(); });
  el.querySelector('#tt-print').addEventListener('click', () => window.print());
  el.querySelector('#tt-add')?.addEventListener('click', () => slotForm(null, load));
  el.querySelector('#tt-conflicts').addEventListener('click', async () => {
    try {
      const r = await api.get('/academics/timetable-conflicts');
      const list = r.data?.conflicts || r.data || [];
      modal({
        title: 'Conflits d\'emploi du temps', icon: 'alert-triangle', size: 'modal-narrow',
        body: Array.isArray(list) && list.length ? `<div class="list">${list.map((x) => `<div class="list-item">
            <span class="li-ico" data-tone="danger">${icon('alert-triangle', { size: 15 })}</span>
            <span class="li-body"><span class="li-title">${esc(x.title || x.matiere || 'Conflit')}</span>
              <span class="li-sub">${esc(x.detail || x.message || '')}</span></span></div>`).join('')}</div>`
          : emptyState({ icon: 'check-circle', title: 'Aucun conflit', message: 'Aucun enseignant ni salle n\'est doublement réservé.' }),
        footer: '<button class="btn btn-primary" data-dismiss>Fermer</button>',
      });
    } catch (e) { toastErr('Vérification impossible', e.message); }
  });
  load();
}

async function slotForm(slotId, onDone, preset = {}) {
  let subjects = [];
  let teachers = [];
  let slots = [];
  try {
    const [s, t] = await Promise.all([
      api.get('/academics/subjects', { cacheTtl: 120000 }),
      api.get('/people/staff?limit=200', { cacheTtl: 60000 }).catch(() => ({ data: [] })),
    ]);
    subjects = s.data?.subjects || s.data || [];
    teachers = t.data || [];
  } catch { /* ignore */ }
  let current = null;
  if (slotId) {
    try {
      const r = await api.get(`/academics/timetable?class_id=0`);
      current = (r.data?.slots || []).find((x) => x.id === slotId);
    } catch { /* ignore */ }
  }
  modal({
    title: slotId ? 'Modifier le cours' : 'Planifier un cours', icon: 'calendar-plus', size: 'modal-narrow',
    body: `<form id="ts-form"><div class="grid-2">
        ${field({ label: 'Matière', name: 'subject_id', type: 'select', value: current?.subject_id || '', required: true, placeholder: '—', options: subjects.map((x) => ({ value: x.id, label: x.name })) })}
        ${field({ label: 'Enseignant', name: 'teacher_id', type: 'select', value: current?.teacher_id || '', placeholder: '—', options: teachers.map((x) => ({ value: x.id, label: `${x.first_name} ${x.last_name}` })) })}
        ${field({ label: 'Jour', name: 'day_of_week', type: 'select', value: current?.day_of_week || preset.day || 1, options: [1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: JOURS_COURTS[d] })) })}
        ${field({ label: 'Début', name: 'start_time', type: 'time', value: current?.start_time || preset.start_time || '07:30', required: true })}
        ${field({ label: 'Fin', name: 'end_time', type: 'time', value: current?.end_time || preset.end_time || '08:25', required: true })}
        ${field({ label: 'Salle', name: 'room', value: current?.room || '', placeholder: 'Salle 1' })}
      </div>
      ${field({ label: 'Note', name: 'note', value: current?.note || '', placeholder: 'Séance de TP, sortie pédagogique…' })}
      <div class="alert alert-info mt-2">${icon('info', { size: 16 })}<div class="alert-body"><div class="alert-msg">En cas de double réservation d'un enseignant ou d'une salle, l'enregistrement sera refusé et le conflit affiché.</div></div></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      ${slotId ? `<button class="btn btn-danger" id="ts-del" style="margin-right:auto">${icon('trash', { size: 15 })} Supprimer</button>` : ''}
      <button class="btn btn-primary" id="ts-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#ts-go').addEventListener('click', () => withBusy(layer.querySelector('#ts-go'), async () => {
        const payload = { ...readForm(layer.querySelector('#ts-form'), ['subject_id', 'teacher_id', 'day_of_week']), class_id: preset.class_id || current?.class_id };
        try {
          if (slotId) await api.patch(`/academics/timetable/${slotId}`, payload);
          else await api.post('/academics/timetable', payload);
          close();
          toastOk('Emploi du temps mis à jour');
          onDone?.();
        } catch (e) {
          if (e.conflicts) {
            toastErr('Conflit détecté', e.message);
            modal({ title: 'Conflits', icon: 'alert-triangle', size: 'modal-narrow',
              body: `<div class="list">${(e.conflicts || []).map((x) => `<div class="list-item"><span class="li-ico" data-tone="danger">${icon('alert-triangle', { size: 15 })}</span><span class="li-body"><span class="li-title">${esc(x.type || 'Conflit')}</span><span class="li-sub">${esc(x.detail || '')}</span></span></div>`).join('')}</div>`,
              footer: '<button class="btn btn-secondary" data-dismiss>Fermer</button>' });
          } else toastErr('Enregistrement impossible', e.message);
        }
      }));
      layer.querySelector('#ts-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Supprimer ce cours ?', danger: true, confirmLabel: 'Supprimer', message: 'Le créneau sera libéré dans l\'emploi du temps de la classe.' }))) return;
        try { await api.del(`/academics/timetable/${slotId}`); close(); toastOk('Cours supprimé'); onDone?.(); }
        catch (e) { toastErr('Suppression impossible', e.message); }
      });
    },
  });
}

/* ================================================================== */
/* NOTES & ÉVALUATIONS                                                 */
/* ================================================================== */
async function notesView(el, query) {
  const f = { q: '', class_id: query.class_id || '', subject_id: '', term_id: '', type: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Pédagogie</div><h1 class="h-page">Notes & évaluations</h1>
        <p class="subtle small mt-2">Créez une évaluation, saisissez les notes au clavier, publiez : les moyennes et les bulletins se recalculent instantanément.</p></div>
      <div class="row gap-2"><button class="btn btn-secondary" id="nt-export">${icon('download', { size: 15 })} Exporter</button>
        <button class="btn btn-primary" data-new id="nt-new">${icon('plus', { size: 15 })} Nouvelle évaluation</button></div>
    </header>
    <div class="card"><div class="card-body" id="nt-toolbar"></div>
      <div class="card-body" style="padding:0" id="nt-table">${skeletonRows(9, 7)}</div>
      <div class="card-foot" id="nt-pager"></div></div>`;

  const slot = el.querySelector('#nt-toolbar');
  slot.innerHTML = toolbar({
    search: f.q, searchPlaceholder: 'Nom de l\'évaluation, classe, matière…',
    filters: `<select class="select select-sm" data-f="type"><option value="">Tous types</option>${dictEntries(TYPES_EVALUATION).map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>`,
  });
  const fetchRows = debounce(async () => {
    const tableSlot = el.querySelector('#nt-table');
    tableSlot.innerHTML = skeletonRows(8, 7);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/academics/assessments?${q}`);
      const rows = r.data || [];
      tableSlot.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'name', label: 'Évaluation', render: (x) => `<a class="link-strong" href="#/pedagogie/notes/${x.id}">${esc(x.name)}</a><div class="tiny subtle">${esc(dictLabel(TYPES_EVALUATION, x.type))} · coef. ${x.coefficient}</div>` },
          { key: 'classe', label: 'Classe', width: '90px', render: (x) => esc(x.classe || '') },
          { key: 'matiere', label: 'Matière', width: '160px', hideBelow: 'md', render: (x) => `<span class="row gap-2"><i style="width:8px;height:8px;border-radius:99px;background:${esc(x.color || '#0e7c66')}"></i>${esc(x.matiere || '')}</span>` },
          { key: 'date', label: 'Date', width: '100px', hideBelow: 'lg', render: (x) => dateFr(x.assess_date) },
          { key: 'moyenne', label: 'Moyenne', width: '120px', align: 'right', render: (x) => (x.moyenne != null ? `<b class="num">${note(x.moyenne)}</b><span class="subtle tiny">/${x.max_score}</span>` : '—') },
          { key: 'progress', label: 'Saisie', width: '130px', hideBelow: 'md', render: (x) => `<div class="row gap-2">${progress((x.notes_saisies / Math.max(1, x.effectif)) * 100, x.notes_saisies < x.effectif ? 'warn' : 'ok')}<span class="num tiny">${x.notes_saisies}/${x.effectif}</span></div>` },
          { key: 'status', label: 'Statut', width: '110px', align: 'right', render: (x) => badge(x.status === 'published' ? 'Publiée' : 'Brouillon', x.status === 'published' ? 'ok' : 'neutral') },
          { key: 'act', label: '', width: '96px', align: 'right', render: (x) => `<button class="btn btn-sm ${x.notes_saisies ? 'btn-secondary' : 'btn-primary'}" data-open="${x.id}">${x.notes_saisies ? 'Ouvrir' : 'Noter'}</button>` },
        ],
        rows, dense: true, zebra: true, onRowClick: (x) => go(`/pedagogie/notes/${x.id}`),
      }).outerHTML : emptyState({ icon: 'pen-tool', title: 'Aucune évaluation', message: 'Créez votre première évaluation : les moyennes se calculent automatiquement.', actions: [{ id: 'new', label: 'Nouvelle évaluation', icon: 'plus', variant: 'btn-primary' }] });
      tableSlot.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); go(`/pedagogie/notes/${b.dataset.open}`); }));
      tableSlot.querySelectorAll('[data-empty-action="new"]').forEach((b) => b.addEventListener('click', () => assessmentForm(null, fetchRows)));
      const pager = el.querySelector('#nt-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'évaluations' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  slot.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); });
  slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
  el.querySelector('#nt-new').addEventListener('click', () => assessmentForm(null, fetchRows));
  el.querySelector('#nt-export').addEventListener('click', () => toastInfo('Export', 'Ouvrez une évaluation puis utilisez « Exporter » dans sa page.'));
  if (query.new) assessmentForm({ class_id: query.class_id }, fetchRows);
  await fetchRows.flush();
}

function assessmentForm(preset, onDone) {
  modal({
    title: 'Nouvelle évaluation', icon: 'pen-tool', size: 'modal-narrow',
    body: `<form id="af-form"><div class="grid-2">
        ${field({ label: 'Classe', name: 'class_id', type: 'select', value: preset?.class_id || '', required: true, placeholder: '—', options: [], hint: 'Chargement…' })}
        ${field({ label: 'Matière', name: 'subject_id', type: 'select', required: true, placeholder: '—', options: [] })}
      </div>
      ${field({ label: 'Intitulé', name: 'name', required: true, placeholder: 'Devoir surveillé n°2' })}
      <div class="grid-2">
        ${field({ label: 'Type', name: 'type', type: 'select', value: 'devoir', options: dictEntries(TYPES_EVALUATION).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Date', name: 'assess_date', type: 'date', value: new Date().toISOString().slice(0, 10), required: true })}
        ${field({ label: 'Barème', name: 'max_score', type: 'number', value: 20, min: 1, max: 100 })}
        ${field({ label: 'Coefficient', name: 'coefficient', type: 'number', value: 1, min: 0.5, step: 0.5 })}
      </div>
      ${field({ label: 'Compte pour la moyenne', name: 'counts_for', type: 'switch', value: true })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="af-go">${icon('plus', { size: 15 })} Créer et noter</button>`,
    onMount: async (layer, close) => {
      try {
        const [c, s] = await Promise.all([
          api.get('/academics/classes?limit=200', { cacheTtl: 120000 }),
          api.get('/academics/subjects', { cacheTtl: 120000 }),
        ]);
        const classes = c.data || [];
        const subjects = s.data?.subjects || s.data || [];
        layer.querySelector('[name=class_id]').innerHTML = `<option value="">— Choisir —</option>${classes.map((x) => `<option value="${x.id}" ${String(preset?.class_id) === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}`;
        layer.querySelector('[name=subject_id]').innerHTML = `<option value="">— Choisir —</option>${subjects.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}`;
      } catch { /* ignore */ }
      layer.querySelector('#af-go').addEventListener('click', () => withBusy(layer.querySelector('#af-go'), async () => {
        const payload = readForm(layer.querySelector('#af-form'), ['class_id', 'subject_id', 'max_score', 'coefficient']);
        try {
          const r = await api.post('/academics/assessments', payload);
          close();
          toastOk('Évaluation créée', 'Saisissez maintenant les notes.');
          onDone?.();
          go(`/pedagogie/notes/${r.data?.id || r.id}`);
        } catch (e) { toastErr('Création impossible', e.message); }
      }));
    },
  });
}

/** Saisie des notes : grille clavier + statistiques en direct. */
async function gradeEntry(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement de l\'évaluation…')}</div></div>`;
  try {
    const r = await api.get(`/academics/assessments/${id}/grades`);
    const a = r.data.assessment;
    const students = r.data.students || [];
    const stats = r.data.stats || {};
    const marks = new Map(students.map((s) => [s.id, { score: s.score, is_absent: !!s.is_absent, bonus: s.bonus || 0, comment: s.comment || '' }]));
    let cursor = 0;
    let dirty = false;

    function recompute() {
      const vals = [...marks.values()].filter((m) => !m.is_absent && m.score != null).map((m) => Math.min(a.max_score, Number(m.score) + Number(m.bonus || 0)));
      if (!vals.length) return { n: 0, avg: null, min: null, max: null, pass: null };
      const avg = vals.reduce((x, y) => x + y, 0) / vals.length;
      return { n: vals.length, avg, min: Math.min(...vals), max: Math.max(...vals), pass: (vals.filter((v) => v >= a.max_score / 2).length / vals.length) * 100 };
    }

    function paint() {
      const s = recompute();
      el.innerHTML = `
      <header class="row-between wrap mb-4">
        <div class="row gap-3">
          <a class="btn btn-ghost btn-icon" href="#/pedagogie/notes" aria-label="Retour">${icon('arrow-left', { size: 18 })}</a>
          <div><div class="uppercase mb-2">${esc(a.classe || '')} · ${esc(a.matiere || '')} · ${esc(dictLabel(TYPES_EVALUATION, a.type))}</div>
            <h1 class="h-page" style="margin:0">${esc(a.name)}</h1>
            <p class="subtle small">${dateLong(a.assess_date)} · barème /${a.max_score} · coef. ${a.coefficient} · ${badge(a.status === 'published' ? 'Publiée' : 'Brouillon', a.status === 'published' ? 'ok' : 'neutral')}</p></div>
        </div>
        <div class="row gap-2 wrap">
          <button class="btn btn-secondary" id="ge-export">${icon('download', { size: 15 })} Exporter CSV</button>
          <button class="btn btn-secondary" id="ge-moy">${icon('target', { size: 15 })} Mettre la moyenne</button>
          <button class="btn btn-primary" id="ge-save">${icon(a.status === 'published' ? 'save' : 'send', { size: 15 })} ${a.status === 'published' ? 'Enregistrer' : 'Publier les notes'}</button>
        </div>
      </header>
      <div class="grid grid-kpi">
        ${kpiCard('Notes saisies', `${s.n}/${students.length}`, 'pen-tool', s.n === students.length ? 'ok' : 'warn', s.n < students.length ? 'Complétez les cases vides' : 'Tous les élèves sont notés')}
        ${kpiCard('Moyenne', s.avg != null ? note(s.avg) : '—', 'chart-line', (s.avg || 0) >= a.max_score / 2 ? 'ok' : 'danger', `/${a.max_score}`)}
        ${kpiCard('Réussite', s.pass != null ? `${Math.round(s.pass)}` : '—', 'target', (s.pass || 0) >= 50 ? 'ok' : 'danger', `% ≥ ${a.max_score / 2}`)}
        ${kpiCard('Écart', s.min != null ? `${note(s.min)}–${note(s.max)}` : '—', 'activity', 'info', 'Min – max de la classe')}
      </div>
      <div class="card mt-4">
        <div class="card-head"><div><h2>${icon('type', { size: 16 })} Saisie des notes</h2>
          <p class="subtle tiny mt-2">Naviguez avec <kbd>↑</kbd><kbd>↓</kbd>, saisissez la note puis <kbd>Entrée</kbd> pour passer à l'élève suivant. <kbd>A</kbd> marque absent. <kbd>Ctrl</kbd>+<kbd>S</kbd> enregistre.</p></div>
          <span class="subtle tiny" id="ge-dirty"></span></div>
        <div class="card-body" style="padding:0">
          <div class="grade-grid" id="ge-grid" tabindex="0">
            <div class="gg-row gg-head"><span>#</span><span>Élève</span><span class="right">Note /${a.max_score}</span><span class="center">Absent</span><span class="hide-md">Appréciation rapide</span></div>
            ${students.map((st, i) => {
              const m = marks.get(st.id);
              return `<div class="gg-row" data-i="${i}" data-student="${st.id}" aria-selected="${i === cursor}">
                <span class="num gg-idx">${i + 1}</span>
                <span class="gg-stu">${avatar({ first: st.first_name, last: st.last_name, size: 'avatar-sm' })}<span>${esc(st.first_name)} ${esc(st.last_name)}</span></span>
                <span class="right"><input class="input grade-input num" type="number" min="0" max="${a.max_score}" step="0.25" inputmode="decimal"
                  value="${m.score != null ? m.score : ''}" data-student="${st.id}" ${m.is_absent ? 'disabled' : ''} placeholder="—" aria-label="Note de ${esc(st.first_name)} ${esc(st.last_name)}"></span>
                <span class="center"><label class="check" style="justify-content:center"><input type="checkbox" data-absent="${st.id}" ${m.is_absent ? 'checked' : ''} aria-label="Absent"><span class="check-box">${icon('check', { size: 11 })}</span></label></span>
                <span class="hide-md"><select class="select select-sm" data-comment="${st.id}" aria-label="Appréciation">
                  <option value="">—</option>
                  ${['Très bien', 'Bon travail', 'Peut mieux faire', 'Résultats fragiles', 'Doit s\'investir davantage', 'En progrès'].map((c) => `<option ${m.comment === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select></span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
      wire();
    }

    function wire() {
      const grid = el.querySelector('#ge-grid');
      grid.querySelectorAll('.grade-input').forEach((inp) => {
        inp.addEventListener('input', debounce(() => {
          const m = marks.get(Number(inp.dataset.student));
          m.score = inp.value === '' ? null : Number(inp.value);
          dirty = true;
          paintKpis();
        }, 120));
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); move(cursor + 1); }
          if (e.key === 'ArrowUp') { e.preventDefault(); move(cursor - 1); }
          if (e.key.toLowerCase() === 'a') { e.preventDefault(); toggleAbsent(Number(inp.dataset.student)); }
        });
      });
      grid.querySelectorAll('[data-absent]').forEach((cb) => cb.addEventListener('change', () => toggleAbsent(Number(cb.dataset.absent))));
      grid.querySelectorAll('[data-comment]').forEach((s2) => s2.addEventListener('change', () => { marks.get(Number(s2.dataset.comment)).comment = s2.value; dirty = true; }));
      grid.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      });
      el.querySelector('#ge-save').addEventListener('click', save);
      el.querySelector('#ge-moy').addEventListener('click', () => {
        const target = recompute().avg;
        if (target == null) return toastErr('Aucune note', 'Saisissez au moins une note d\'abord.');
        marks.forEach((m) => { if (!m.is_absent && m.score == null) m.score = Math.round(target * 4) / 4; });
        dirty = true;
        paint();
        toastInfo('Cases vides complétées', `Valeur appliquée : ${note(target)}/${a.max_score}.`);
      });
      el.querySelector('#ge-export').addEventListener('click', async () => {
        try {
          await api.download(`/academics/assessments/${id}/grades?format=csv`, `notes-${a.classe}-${a.name}.csv`.replace(/\s+/g, '-'));
          toastOk('Export terminé');
        } catch (e) { toastErr('Export impossible', e.message); }
      });
      move(cursor, false);
    }
    function paintKpis() {
      const s = recompute();
      const dirtyEl = el.querySelector('#ge-dirty');
      if (dirtyEl) dirtyEl.innerHTML = dirty ? badge('Non enregistré', 'warn') : '';
    }
    function move(i, scroll = true) {
      const rows = [...el.querySelectorAll('.gg-row[data-student]')];
      if (!rows.length) return;
      cursor = Math.max(0, Math.min(rows.length - 1, i));
      rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === cursor)));
      if (scroll) { rows[cursor]?.scrollIntoView({ block: 'nearest' }); rows[cursor]?.querySelector('.grade-input')?.focus(); }
    }
    function toggleAbsent(sid) {
      const m = marks.get(sid);
      m.is_absent = !m.is_absent;
      if (m.is_absent) m.score = null;
      dirty = true;
      paint();
    }
    async function save() {
      const grades = [...marks.entries()].map(([student_id, m]) => ({ student_id, score: m.is_absent ? null : m.score, is_absent: m.is_absent ? 1 : 0, bonus: m.bonus || 0, comment: m.comment || null }));
      const missing = grades.filter((g) => !g.is_absent && g.score == null).length;
      if (missing) {
        const go2 = await confirmDialog({ title: `${missing} note(s) manquante(s)`, message: 'Certaines cases sont vides. Enregistrer quand même (les absents non marqués compteront comme non notés) ?', confirmLabel: 'Enregistrer' });
        if (!go2) return;
      }
      const btn = el.querySelector('#ge-save');
      await withBusy(btn, async () => {
        try {
          await api.post(`/academics/assessments/${id}/grades`, { grades, publish: a.status !== 'published' });
          dirty = false;
          toastOk(a.status === 'published' ? 'Notes enregistrées' : 'Notes publiées', `${grades.length} note(s) · moyenne ${note(recompute().avg)}/${a.max_score}. Les parents seront informés.`);
          gradeEntry(el, id);
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      });
    }
    paint();
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Évaluation indisponible', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* RÉSULTATS DE CLASSE                                                 */
/* ================================================================== */
async function resultsView(el, query) {
  let classId = Number(query.class_id) || 0;
  let termId = Number(query.term_id) || 0;
  let classes = [];
  let terms = [];
  try {
    const [c, t] = await Promise.all([
      api.get('/academics/classes?limit=200', { cacheTtl: 120000 }),
      api.get('/academics/terms', { cacheTtl: 300000 }),
    ]);
    classes = c.data || [];
    terms = t.data?.terms || t.data || [];
    if (!classId && classes.length) classId = classes[0].id;
    if (!termId) termId = terms.find((x) => x.is_current)?.id || terms[0]?.id || 0;
  } catch { /* ignore */ }

  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Pédagogie</div><h1 class="h-page">Résultats de classe</h1>
        <p class="subtle small mt-2">Classement, moyennes par matière et appréciations. Exportez le tableau complet pour le conseil de classe.</p></div>
      <div class="row gap-2 wrap">
        <select class="select" id="rs-class">${classes.map((c) => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select class="select" id="rs-term">${terms.map((t) => `<option value="${t.id}" ${t.id === termId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <button class="btn btn-secondary" id="rs-export">${icon('download', { size: 15 })} Exporter</button>
        <button class="btn btn-primary" id="rs-rc">${icon('file-text', { size: 15 })} Générer les bulletins</button>
      </div>
    </header>
    <div class="grid grid-kpi" id="rs-kpis"></div>
    <div class="grid grid-2-1 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('table', { size: 16 })} Classement de la classe</h2>
        <p class="subtle tiny mt-2">Moyenne générale, rang et mention par élève.</p></div></div>
        <div class="card-body" style="padding:0" id="rs-table">${spinnerNote('Calcul des moyennes…')}</div></div>
      <div class="col gap-4">
        <div class="card"><div class="card-head"><div><h2>${icon('chart-line', { size: 16 })} Moyennes par matière</h2></div></div>
          <div class="card-body" id="rs-subjects"></div></div>
        <div class="card"><div class="card-head"><div><h2>${icon('medal', { size: 16 })} Podium</h2></div></div>
          <div class="card-body" style="padding:0" id="rs-podium"></div></div>
      </div>
    </div>`;

  async function load() {
    el.querySelector('#rs-table').innerHTML = spinnerNote('Calcul des moyennes…');
    try {
      const r = await api.get(`/academics/class-results?class_id=${classId}&term_id=${termId}`);
      const d = r.data;
      const st = d.stats || {};
      el.querySelector('#rs-kpis').innerHTML = [
        kpiCard('Moyenne de classe', note(st.moyenne_classe), 'chart-line', (st.moyenne_classe || 0) >= 10 ? 'ok' : 'danger', `${esc(d.term?.name || '')}`),
        kpiCard('Taux de réussite', st.reussite != null ? `${st.reussite}` : '—', 'target', (st.reussite || 0) >= 50 ? 'ok' : 'warn', '% avec la moyenne'),
        kpiCard('Meilleure moyenne', note(st.max), 'trophy', 'ok', ''),
        kpiCard('Effectif noté', `${st.effectif ?? d.students.length}`, 'users', 'brand', ''),
      ].join('');
      const students = [...(d.students || [])].sort((a, b) => (a.rank || 999) - (b.rank || 999));
      el.querySelector('#rs-table').innerHTML = dataTable({
        columns: [
          { key: 'rank', label: 'Rang', width: '70px', align: 'center', render: (x) => `<b class="num">${x.rank || '—'}</b>` },
          { key: 'nom', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}<div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.matricule)}</div></div></div>` },
          ...d.subjects.slice(0, 5).map((s) => ({ key: `s${s.id}`, label: s.code || s.name.slice(0, 6), align: 'right', width: '64px', hideBelow: 'xl', render: (x) => (x.bySubject?.[s.id] != null ? `<span class="num" style="color:${x.bySubject[s.id] >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(x.bySubject[s.id])}</span>` : '—') })),
          { key: 'general', label: 'Moyenne', width: '96px', align: 'right', render: (x) => `<b class="num" style="font-size:14px;color:${x.general >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(x.general)}</b>` },
          { key: 'mention', label: 'Mention', width: '120px', hideBelow: 'md', render: (x) => badge(x.mention || '—', (x.general || 0) >= 14 ? 'ok' : (x.general || 0) >= 10 ? 'info' : 'danger') },
          { key: 'appr', label: 'Appréciation', hideBelow: 'lg', render: (x) => `<span class="small subtle">${esc(x.appreciation || '')}</span>` },
          { key: 'act', label: '', width: '66px', align: 'right', render: (x) => `<a class="btn btn-ghost btn-icon btn-sm" href="#/pedagogie/bulletins?student=${x.id}&term_id=${termId}" title="Bulletin">${icon('file-text', { size: 15 })}</a>` },
        ],
        rows: students, dense: true, zebra: true, onRowClick: (x) => go(`/scolaire/eleves/${x.id}`),
      }).outerHTML;
      const pm = st.par_matiere || [];
      el.querySelector('#rs-subjects').innerHTML = pm.length ? '' : emptyState({ icon: 'chart-line', title: 'Pas de données', message: 'Aucune note sur ce trimestre.' });
      if (pm.length) {
        el.querySelector('#rs-subjects').appendChild(barChart(pm, {
          labels: pm.map((x) => (x.name || x.matiere || '').slice(0, 12)),
          series: [{ name: 'Moyenne', data: pm.map((x) => x.moyenne ?? x.avg), color: '#0e7c66' }],
          horizontal: true, height: Math.max(160, pm.length * 26 + 30), yFormat: (v) => note(v),
        }));
      }
      const top = students.slice(0, 3);
      el.querySelector('#rs-podium').innerHTML = top.length ? `<div class="list">${top.map((x, i) => `<div class="list-item">
          <span class="li-ico" data-tone="${i === 0 ? 'warn' : i === 1 ? 'info' : 'brand'}">${icon(i === 0 ? 'trophy' : 'medal', { size: 16 })}</span>
          <span class="li-body"><span class="li-title">${esc(x.first_name)} ${esc(x.last_name)}</span><span class="li-sub">${esc(x.mention || '')}</span></span>
          <span class="li-aside"><b class="num" style="font-size:15px">${note(x.general)}</b></span></div>`).join('')}</div>`
        : emptyState({ icon: 'medal', title: 'Pas de classement', message: 'Les notes ne sont pas encore publiées.' });
    } catch (err) {
      el.querySelector('#rs-table').innerHTML = emptyState({ icon: 'wifi-off', title: 'Résultats indisponibles', message: err.message });
    }
  }
  el.querySelector('#rs-class').addEventListener('change', (e) => { classId = Number(e.target.value); load(); });
  el.querySelector('#rs-term').addEventListener('change', (e) => { termId = Number(e.target.value); load(); });
  el.querySelector('#rs-export').addEventListener('click', async () => {
    try { await api.download(`/academics/class-results?class_id=${classId}&term_id=${termId}&format=csv`, `resultats-classe-${classId}.csv`); toastOk('Export terminé'); }
    catch (e) { toastErr('Export impossible', e.message); }
  });
  el.querySelector('#rs-rc').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Générer les bulletins ?', message: `Les bulletins du trimestre pour la classe seront (re)calculés à partir des notes publiées. ${''}Cette opération est rapide et sans risque : les bulletins existants sont mis à jour.`, confirmLabel: 'Générer' });
    if (!ok) return;
    try {
      const r = await api.post('/academics/report-cards/generate', { class_id: classId, term_id: termId });
      toastOk('Bulletins générés', `${r.data?.created ?? r.data?.count ?? ''} bulletin(s). Vous pouvez maintenant les imprimer.`);
      go(`/pedagogie/bulletins?class_id=${classId}&term_id=${termId}`);
    } catch (e) { toastErr('Génération impossible', e.message); }
  });
  load();
}

/* ================================================================== */
/* BULLETINS                                                           */
/* ================================================================== */
async function bulletinsView(el, query) {
  const studentId = Number(query.student) || 0;
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Pédagogie</div><h1 class="h-page">Bulletins scolaires</h1>
        <p class="subtle small mt-2">Bulletin officiel A4 : moyennes par matière, rang, mention, appréciations et signatures. Impression prête pour les familles.</p></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="rc-gen">${icon('zap', { size: 15 })} Générer par classe</button>
        <button class="btn btn-primary" id="rc-print">${icon('printer', { size: 15 })} Imprimer</button>
      </div>
    </header>
    <div class="card"><div class="card-body">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <div class="field" style="margin:0"><label for="rc-student">Élève</label>
          <input class="input" id="rc-student" placeholder="ID élève ou recherche…" value="${studentId || ''}"></div>
        <div class="field" style="margin:0"><label for="rc-term">Trimestre</label><select class="select" id="rc-term"></select></div>
        <div class="field" style="margin:0"><label>&nbsp;</label><button class="btn btn-primary btn-block" id="rc-load">${icon('eye', { size: 15 })} Afficher le bulletin</button></div>
      </div>
    </div></div>
    <div id="rc-body" class="mt-4"></div>`;

  try {
    const t = await api.get('/academics/terms', { cacheTtl: 300000 });
    const terms = t.data?.terms || t.data || [];
    el.querySelector('#rc-term').innerHTML = terms.map((x) => `<option value="${x.id}" ${x.is_current ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  } catch { /* ignore */ }

  async function load() {
    const sid = Number(el.querySelector('#rc-student').value);
    const tid = Number(el.querySelector('#rc-term').value);
    const body = el.querySelector('#rc-body');
    if (!sid) { body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'user', title: 'Choisissez un élève', message: 'Saisissez l\'identifiant de l\'élève ou ouvrez le bulletin depuis sa fiche.' })}</div></div>`; return; }
    body.innerHTML = spinnerNote('Composition du bulletin…');
    try {
      const r = await api.get(`/academics/report-cards/student/${sid}?term_id=${tid}`);
      const d = r.data;
      body.innerHTML = bulletinHtml(d);
    } catch (err) {
      body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'file-text', title: 'Bulletin indisponible', message: err.message })}</div></div>`;
    }
  }
  el.querySelector('#rc-load').addEventListener('click', load);
  el.querySelector('#rc-print').addEventListener('click', () => window.print());
  el.querySelector('#rc-gen').addEventListener('click', () => go('/pedagogie/resultats'));
  if (studentId) load();
}

/** Rendu A4 du bulletin — identique à l'écran et à l'impression. */
export function bulletinHtml(d) {
  const s = d.student;
  const card = d.card || {};
  const scale = d.scale || [];
  const mentionColor = scale.find((x) => x.mention === card.mention)?.color || '#0e7c66';
  const avgs = card.subject_avgs || [];
  return `<div class="print-area bulletin">
    <div class="doc-head">
      <div class="doc-head-republic">République du Sénégal<br><span>Un peuple — Un but — Une foi</span></div>
      <div class="doc-head-school">
        <b>${esc(d.school?.name || '')}</b>
        <span>${esc(d.school?.address || '')}${d.school?.city ? ` — ${esc(d.school.city)}` : ''}</span>
        <span>${esc(d.school?.phone || '')} · ${esc(d.school?.email || '')}</span>
        <span>Année scolaire ${esc(d.school?.academicYear || '')}</span>
      </div>
      <div class="doc-head-republic" style="text-align:right">Ministère de l'Éducation nationale<br><span>Inspection d'académie</span></div>
    </div>
    <div class="doc-title">Bulletin de notes — ${esc(card.trimestre || '')}</div>
    <div class="rc-student" style="padding:12px 0;border-block:1px solid var(--border)">
      <div style="flex:1"><dl class="dl">
        <div class="dl-row"><dt>Élève</dt><dd>${esc(s.first_name)} ${esc(s.last_name)} (${esc(s.gender === 'F' ? 'F' : 'M')})</dd></div>
        <div class="dl-row"><dt>Matricule</dt><dd>${esc(s.matricule)}</dd></div>
        <div class="dl-row"><dt>Né(e) le</dt><dd>${s.birth_date ? dateLong(s.birth_date) : '—'}${s.birth_place ? ` à ${esc(s.birth_place)}` : ''}</dd></div>
      </dl></div>
      <div style="flex:1"><dl class="dl">
        <div class="dl-row"><dt>Classe</dt><dd>${esc(s.classe || '')} — effectif ${card.total_students || '—'}</dd></div>
        <div class="dl-row"><dt>Prof. principal</dt><dd>${esc(s.prof_principal || '—')}</dd></div>
        <div class="dl-row"><dt>Assiduité</dt><dd>${card.attendance_pct != null ? `${card.attendance_pct} %` : '—'} (${card.absences_hours ?? 0} h d'absence)</dd></div>
      </dl></div>
      <div class="rc-summary" style="min-width:190px">
        <div class="rc-summary-row"><span>Moyenne générale</span><b class="num" style="color:${mentionColor}">${note(card.general_avg)}/20</b></div>
        <div class="rc-summary-row"><span>Rang</span><b class="num">${card.rank || '—'}${card.total_students ? `/${card.total_students}` : ''}</b></div>
        <div class="rc-summary-row"><span>Mention</span><b style="color:${mentionColor}">${esc(card.mention || '—')}</b></div>
        <div class="rc-summary-row"><span>Moyenne classe</span><b class="num">${note(d.classStats?.moyenne_classe)}</b></div>
      </div>
    </div>
    <table class="rc-table">
      <thead><tr><th>Matière</th><th class="right">Moy. /20</th><th class="right">Coef.</th><th class="right">Moy. × coef.</th>
        <th class="right">Moy. classe</th><th class="right">Min</th><th class="right">Max</th><th>Appréciation du professeur</th></tr></thead>
      <tbody>${avgs.map((x) => `<tr>
        <td><span class="row gap-2"><i style="width:8px;height:8px;border-radius:99px;background:${esc(x.color || '#0e7c66')}"></i>${esc(x.matiere || x.name || '')}</span></td>
        <td class="right"><b class="num" style="color:${(x.avg ?? x.moyenne ?? 0) >= 10 ? 'var(--ok)' : 'var(--danger)'}">${note(x.avg ?? x.moyenne)}</b></td>
        <td class="right num">${x.coefficient ?? 1}</td>
        <td class="right num">${note((x.avg ?? x.moyenne ?? 0) * (x.coefficient ?? 1))}</td>
        <td class="right num subtle">${note(x.class_avg)}</td>
        <td class="right num subtle">${note(x.min)}</td>
        <td class="right num subtle">${note(x.max)}</td>
        <td class="small">${esc(x.appreciation || (d.appreciations || []).find((a) => a.subject_id === x.subject_id)?.appreciation || '')}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>Total des coefficients</b></td><td class="right num"><b>${avgs.reduce((a, x) => a + (x.coefficient ?? 1), 0)}</b></td>
        <td colspan="4" class="right"><b>Somme des moyennes × coef. : <span class="num">${note(avgs.reduce((a, x) => a + (x.avg ?? x.moyenne ?? 0) * (x.coefficient ?? 1), 0))}</span></b></td></tr></tfoot>
    </table>
    <div class="rc-comments">
      <div class="rc-comment"><span class="rc-comment-label">Appréciation du professeur principal</span>${esc(card.teacher_comment || '—')}</div>
      <div class="rc-comment"><span class="rc-comment-label">Appréciation du chef d'établissement</span>${esc(card.principal_comment || '—')}</div>
    </div>
    <div class="rc-signatures">
      <div><span>Le professeur principal</span></div>
      <div><span>Le/La chef d'établissement<br><i>${esc(d.school?.headName || '')}</i></span></div>
      <div><span>Le parent / tuteur<br><i>${esc(d.guardian ? `${d.guardian.first_name} ${d.guardian.last_name}` : '')}</i></span></div>
    </div>
    <div class="doc-foot">${esc(d.school?.footer || 'Document généré électroniquement — valable sans signature manuscrite')} · ${esc(dateLong(new Date().toISOString()))}</div>
  </div>`;
}

async function bulletinPage(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement du bulletin…')}</div></div>`;
  try {
    const r = await api.get(`/academics/report-cards/${id}`);
    const d = r.data?.card ? r.data : { card: r.data, student: r.data?.student, school: r.data?.school };
    el.innerHTML = `<header class="row-between wrap mb-4 no-print">
        <div class="row gap-3"><a class="btn btn-ghost btn-icon" href="#/pedagogie/bulletins">${icon('arrow-left', { size: 18 })}</a>
          <div><h1 class="h-page" style="margin:0">Bulletin ${esc(d.card?.trimestre || '')}</h1>
          <p class="subtle small">${esc(d.student?.first_name || '')} ${esc(d.student?.last_name || '')} · ${esc(d.student?.classe || '')}</p></div></div>
        <div class="row gap-2"><button class="btn btn-secondary" id="bp-edit">${icon('edit', { size: 15 })} Appréciations</button>
          <button class="btn btn-primary" id="bp-print">${icon('printer', { size: 15 })} Imprimer / PDF</button></div>
      </header>
      <div class="print-area">${bulletinHtml(d)}</div>`;
    el.querySelector('#bp-print').addEventListener('click', () => window.print());
    el.querySelector('#bp-edit').addEventListener('click', () => modal({
      title: 'Appréciations du bulletin', icon: 'edit',
      body: `<form id="bc-form">
        ${field({ label: 'Appréciation du professeur principal', name: 'teacher_comment', type: 'textarea', rows: 3, value: d.card?.teacher_comment || '' })}
        ${field({ label: 'Appréciation du chef d\'établissement', name: 'principal_comment', type: 'textarea', rows: 3, value: d.card?.principal_comment || '' })}
        ${field({ label: 'Publier le bulletin (visible par la famille)', name: 'publish', type: 'switch', value: d.card?.status === 'publie' })}
      </form>`,
      footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="bc-go">${icon('save', { size: 15 })} Enregistrer</button>`,
      onMount: (layer, close) => layer.querySelector('#bc-go').addEventListener('click', async () => {
        const payload = readForm(layer.querySelector('#bc-form'));
        try { await api.patch(`/academics/report-cards/${id}`, payload); close(); toastOk('Bulletin mis à jour'); bulletinPage(el, id); }
        catch (e) { toastErr('Enregistrement impossible', e.message); }
      }),
    }));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'file-text', title: 'Bulletin introuvable', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* CAHIER DE TEXTES & DEVOIRS                                          */
/* ================================================================== */
async function lessonsView(el, query) {
  const f = { q: '', class_id: query.class_id || '', date_from: '', date_to: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Pédagogie</div><h1 class="h-page">Cahier de textes</h1>
        <p class="subtle small mt-2">Trace officielle des cours réalisés : contenu, objectifs, progression et devoirs donnés. Consultable par les familles.</p></div>
      <button class="btn btn-primary" data-new id="ls-new">${icon('plus', { size: 15 })} Nouvelle séance</button>
    </header>
    <div class="card"><div class="card-body" id="ls-toolbar"></div>
      <div class="card-body" style="padding:0" id="ls-list">${skeletonRows(8, 4)}</div>
      <div class="card-foot" id="ls-pager"></div></div>`;
  const slot = el.querySelector('#ls-toolbar');
  slot.innerHTML = toolbar({ search: f.q, searchPlaceholder: 'Titre, matière, classe…',
    filters: `<input class="input input-sm" type="date" data-f="date_from" aria-label="Du"> <input class="input input-sm" type="date" data-f="date_to" aria-label="Au">` });
  const fetchRows = debounce(async () => {
    const list = el.querySelector('#ls-list');
    list.innerHTML = skeletonRows(7, 4);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/academics/lessons?${q}`);
      const rows = r.data || [];
      list.innerHTML = rows.length ? `<div class="list">${rows.map((x) => `<div class="list-item" data-id="${x.id}" style="cursor:pointer">
          <span class="li-ico" style="background:${esc(x.color || '#0e7c66')}22;color:${esc(x.color || '#0e7c66')}">${icon('notebook', { size: 16 })}</span>
          <span class="li-body"><span class="li-title">${esc(x.title)}</span>
            <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matiere || '')} · ${dateFr(x.lesson_date)} · ${x.duration_min} min · ${esc(x.enseignant || '')}</span>
            <span class="li-sub subtle">${esc(x.content || '').slice(0, 140)}${(x.content || '').length > 140 ? '…' : ''}</span></span>
          <span class="li-aside" style="flex-direction:column;align-items:flex-end;gap:6px">
            ${x.progress_pct != null ? `<span class="row gap-2" style="width:90px">${progress(x.progress_pct)}<span class="tiny num">${x.progress_pct}%</span></span>` : ''}
            ${x.validated_at ? badge('Visé par la direction', 'ok', { iconName: 'check-circle' }) : badge('À viser', 'warn')}
          </span></div>`).join('')}</div>`
        : emptyState({ icon: 'notebook', title: 'Aucune séance', message: 'Consignez vos cours pour alimenter le cahier de textes consultable par les familles.' });
      list.querySelectorAll('[data-id]').forEach((i) => i.addEventListener('click', () => lessonForm(Number(i.dataset.id), fetchRows)));
      const pager = el.querySelector('#ls-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'séances' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      list.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  slot.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); });
  slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
  el.querySelector('#ls-new').addEventListener('click', () => lessonForm(null, fetchRows));
  if (query.new) lessonForm(null, fetchRows);
  await fetchRows.flush();
}

function lessonForm(id, onDone) {
  modal({
    title: id ? 'Séance du cahier de textes' : 'Nouvelle séance', icon: 'notebook', size: 'modal-wide',
    body: `<form id="lf-form">${spinnerNote('Chargement…')}</form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="lf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: async (layer, close) => {
      let current = null;
      let classes = [];
      let subjects = [];
      try {
        const [c, s, cur] = await Promise.all([
          api.get('/academics/classes?limit=200', { cacheTtl: 120000 }),
          api.get('/academics/subjects', { cacheTtl: 120000 }),
          id ? api.get(`/academics/lessons/${id}`).catch(() => null) : null,
        ]);
        classes = c.data || [];
        subjects = s.data?.subjects || s.data || [];
        current = cur?.data?.lesson || cur?.data || null;
      } catch { /* ignore */ }
      layer.querySelector('#lf-form').innerHTML = `<div class="grid-2">
          ${field({ label: 'Classe', name: 'class_id', type: 'select', value: current?.class_id || '', required: true, options: classes.map((x) => ({ value: x.id, label: x.name })) })}
          ${field({ label: 'Matière', name: 'subject_id', type: 'select', value: current?.subject_id || '', required: true, options: subjects.map((x) => ({ value: x.id, label: x.name })) })}
          ${field({ label: 'Date de la séance', name: 'lesson_date', type: 'date', value: current?.lesson_date || new Date().toISOString().slice(0, 10), required: true })}
          ${field({ label: 'Durée (min)', name: 'duration_min', type: 'number', value: current?.duration_min || 55, min: 15, step: 5 })}
        </div>
        ${field({ label: 'Titre de la séance', name: 'title', value: current?.title || '', required: true, placeholder: 'Chapitre 3 — Les fractions' })}
        ${field({ label: 'Objectif pédagogique', name: 'objective', value: current?.objective || '', placeholder: 'Ce que l\'élève saura faire à la fin de la séance.' })}
        ${field({ label: 'Contenu / déroulé', name: 'content', type: 'textarea', rows: 4, value: current?.content || '' })}
        <div class="grid-2">
          ${field({ label: 'Devoir donné', name: 'homework', type: 'textarea', rows: 2, value: current?.homework || '' })}
          ${field({ label: 'Progression du programme', name: 'progress_pct', type: 'number', value: current?.progress_pct || 0, min: 0, max: 100, suffix: '%' })}
        </div>`;
      layer.querySelector('#lf-go').addEventListener('click', () => withBusy(layer.querySelector('#lf-go'), async () => {
        const payload = readForm(layer.querySelector('#lf-form'), ['class_id', 'subject_id', 'duration_min', 'progress_pct']);
        try {
          if (id) await api.patch(`/academics/lessons/${id}`, payload);
          else await api.post('/academics/lessons', payload);
          close();
          toastOk(id ? 'Séance mise à jour' : 'Séance consignée', 'Le cahier de textes est à jour.');
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

async function homeworkView(el, query) {
  const f = { q: '', class_id: '', status: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Pédagogie</div><h1 class="h-page">Devoirs</h1>
        <p class="subtle small mt-2">Devoirs maison et suivi des rendus. Les familles sont notifiées à la création et la veille de l'échéance.</p></div>
      <button class="btn btn-primary" data-new id="hw-new">${icon('plus', { size: 15 })} Donner un devoir</button>
    </header>
    <div class="grid grid-kpi" id="hw-kpis"></div>
    <div class="card mt-4"><div class="card-body" id="hw-toolbar"></div>
      <div class="card-body" style="padding:0" id="hw-table">${skeletonRows(8, 6)}</div>
      <div class="card-foot" id="hw-pager"></div></div>`;
  const slot = el.querySelector('#hw-toolbar');
  slot.innerHTML = toolbar({ search: f.q, searchPlaceholder: 'Titre, matière…',
    filters: `<select class="select select-sm" data-f="status"><option value="">Tous</option><option value="encours">En cours</option><option value="echus">Échus</option><option value="corriges">Corrigés</option></select>` });
  const fetchRows = debounce(async () => {
    const t = el.querySelector('#hw-table');
    t.innerHTML = skeletonRows(7, 6);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/academics/homework?${q}`);
      const rows = r.data || [];
      const encours = rows.filter((x) => !x.retard && new Date(x.due_date) >= new Date()).length;
      const retard = rows.filter((x) => x.retard).length;
      el.querySelector('#hw-kpis').innerHTML = [
        kpiCard('Devoirs actifs', `${encours}`, 'book-marked', 'brand', 'À rendre prochainement'),
        kpiCard('En retard de rendu', `${retard}`, 'clock-alert', retard ? 'danger' : 'ok', 'Classes concernées'),
        kpiCard('Taux de rendu moyen', rows.length ? `${Math.round(rows.reduce((a, x) => a + ((x.rendus || 0) / Math.max(1, x.effectif || 1)) * 100, 0) / rows.length)}` : '—', 'check-circle', 'ok', '% d\'élèves ayant rendu'),
        kpiCard('Devoirs notés', `${rows.filter((x) => x.is_graded).length}`, 'pen-tool', 'info', 'Sur la liste affichée'),
      ].join('');
      t.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'title', label: 'Devoir', render: (x) => `<a class="link-strong" href="#/pedagogie/devoirs/${x.id}">${esc(x.title)}</a><div class="tiny subtle">${esc(x.classe || '')} · ${esc(x.matiere || '')}</div>` },
          { key: 'assigned', label: 'Donné le', width: '104px', hideBelow: 'md', render: (x) => dateFr(x.assigned_at) },
          { key: 'due', label: 'À rendre le', width: '120px', render: (x) => `<b class="small" style="${x.retard ? 'color:var(--danger)' : ''}">${dateFr(x.due_date)}</b>${x.retard ? ' ' + badge('Échu', 'danger') : ''}` },
          { key: 'rendus', label: 'Rendus', width: '140px', render: (x) => `<div class="row gap-2">${progress(((x.rendus || 0) / Math.max(1, x.effectif || 1)) * 100)}<span class="num tiny">${x.rendus ?? 0}/${x.effectif ?? 0}</span></div>` },
          { key: 'moyenne', label: 'Moyenne', width: '90px', align: 'right', hideBelow: 'lg', render: (x) => (x.moyenne != null ? `<b class="num">${note(x.moyenne)}</b>` : '—') },
          { key: 'act', label: '', width: '96px', align: 'right', render: (x) => `<button class="btn btn-secondary btn-sm" data-open="${x.id}">${icon('eye', { size: 13 })} Ouvrir</button>` },
        ],
        rows, dense: true, zebra: true, onRowClick: (x) => go(`/pedagogie/devoirs/${x.id}`),
      }).outerHTML : emptyState({ icon: 'book-marked', title: 'Aucun devoir', message: 'Donnez un devoir : il sera visible immédiatement par les élèves et leurs parents.' });
      t.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); go(`/pedagogie/devoirs/${b.dataset.open}`); }));
      const pager = el.querySelector('#hw-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'devoirs' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  slot.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); });
  slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
  el.querySelector('#hw-new').addEventListener('click', () => homeworkForm(null, fetchRows));
  if (query.new) homeworkForm(null, fetchRows);
  await fetchRows.flush();
}

function homeworkForm(id, onDone) {
  modal({
    title: id ? 'Modifier le devoir' : 'Donner un devoir', icon: 'book-marked', size: 'modal-narrow',
    body: `<form id="hf-form">${spinnerNote('Chargement…')}</form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="hf-go">${icon('send', { size: 15 })} Publier le devoir</button>`,
    onMount: async (layer, close) => {
      let classes = [];
      let subjects = [];
      let current = null;
      try {
        const [c, s, cur] = await Promise.all([
          api.get('/academics/classes?limit=200', { cacheTtl: 120000 }),
          api.get('/academics/subjects', { cacheTtl: 120000 }),
          id ? api.get(`/academics/homework/${id}`).catch(() => null) : null,
        ]);
        classes = c.data || [];
        subjects = s.data?.subjects || s.data || [];
        current = cur?.data?.homework || cur?.data || null;
      } catch { /* ignore */ }
      layer.querySelector('#hf-form').innerHTML = `<div class="grid-2">
          ${field({ label: 'Classe', name: 'class_id', type: 'select', value: current?.class_id || '', required: true, options: classes.map((x) => ({ value: x.id, label: x.name })) })}
          ${field({ label: 'Matière', name: 'subject_id', type: 'select', value: current?.subject_id || '', required: true, options: subjects.map((x) => ({ value: x.id, label: x.name })) })}
        </div>
        ${field({ label: 'Titre', name: 'title', value: current?.title || '', required: true, placeholder: 'DM n°4 — Mathématiques' })}
        ${field({ label: 'Consignes', name: 'description', type: 'textarea', rows: 4, value: current?.description || '', required: true })}
        <div class="grid-2">
          ${field({ label: 'À rendre le', name: 'due_date', type: 'date', value: current?.due_date || new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), required: true })}
          ${field({ label: 'Temps estimé', name: 'estimated_min', type: 'number', value: current?.estimated_min || 30, min: 5, step: 5, suffix: 'min' })}
        </div>
        ${field({ label: 'Devoir noté', name: 'is_graded', type: 'switch', value: current?.is_graded ?? true })}
        ${field({ label: 'Notifier les familles', name: 'notify', type: 'switch', value: true, hint: 'Annonce dans le portail + SMS la veille de l\'échéance.' })}`;
      layer.querySelector('#hf-go').addEventListener('click', () => withBusy(layer.querySelector('#hf-go'), async () => {
        const payload = readForm(layer.querySelector('#hf-form'), ['class_id', 'subject_id', 'estimated_min']);
        try {
          if (id) await api.patch(`/academics/homework/${id}`, payload);
          else await api.post('/academics/homework', payload);
          close();
          toastOk('Devoir publié', 'Les élèves et les parents le voient immédiatement.');
          onDone?.();
        } catch (e) { toastErr('Publication impossible', e.message); }
      }));
    },
  });
}

async function homeworkDetail(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement du devoir…')}</div></div>`;
  try {
    const r = await api.get(`/academics/homework/${id}`);
    const x = r.data.homework || r.data;
    const rendus = r.data.submissions || [];
    el.innerHTML = `
      <header class="row-between wrap mb-4">
        <div class="row gap-3"><a class="btn btn-ghost btn-icon" href="#/pedagogie/devoirs">${icon('arrow-left', { size: 18 })}</a>
          <div><div class="uppercase mb-2">${esc(x.classe || '')} · ${esc(x.matiere || '')}</div>
            <h1 class="h-page" style="margin:0">${esc(x.title)}</h1>
            <p class="subtle small">Donné le ${dateFr(x.assigned_at)} · à rendre le <b>${dateFr(x.due_date)}</b> · ${x.estimated_min ?? 30} min estimées · ${esc(x.enseignant || '')}</p></div></div>
        <div class="row gap-2 wrap">
          <button class="btn btn-secondary" id="hd-edit">${icon('edit', { size: 15 })} Modifier</button>
          ${store.atLeast(50) ? `<button class="btn btn-primary" id="hd-grade">${icon('pen-tool', { size: 15 })} Noter les rendus</button>` : ''}
        </div>
      </header>
      <div class="grid grid-kpi">
        ${kpiCard('Rendus', `${x.rendus ?? 0}/${x.effectif ?? 0}`, 'inbox', (x.rendus || 0) >= (x.effectif || 0) ? 'ok' : 'warn', 'Élèves ayant déposé leur travail')}
        ${kpiCard('Moyenne du devoir', x.moyenne != null ? note(x.moyenne) : '—', 'chart-line', (x.moyenne || 0) >= 10 ? 'ok' : 'danger', '/20')}
        ${kpiCard('Échéance', dateFr(x.due_date), 'calendar', x.retard ? 'danger' : 'info', x.retard ? 'Devoir échu' : 'À venir')}
        ${kpiCard('Noté', x.is_graded ? 'Oui' : 'Non', 'check-circle', x.is_graded ? 'ok' : 'neutral', '')}
      </div>
      <div class="grid grid-2-1 mt-4">
        <div class="card"><div class="card-head"><div><h2>${icon('list', { size: 16 })} Consignes</h2></div></div>
          <div class="card-body"><p style="white-space:pre-wrap;font-size:13.5px;line-height:1.65;color:var(--text-2)">${esc(x.description || '')}</p></div></div>
        <div class="card"><div class="card-head"><div><h2>${icon('chart-pie', { size: 16 })} Taux de rendu</h2></div></div>
          <div class="card-body" id="hd-donut"></div></div>
      </div>
      ${rendus.length ? `<div class="card mt-4"><div class="card-head"><div><h2>${icon('inbox', { size: 16 })} Travaux déposés (${rendus.length})</h2></div></div>
        <div class="card-body" style="padding:0"><div class="list">${rendus.map((s2) => `<div class="list-item">
          ${avatar({ first: s2.first_name, last: s2.last_name, size: 'avatar-sm' })}
          <span class="li-body"><span class="li-title">${esc(s2.first_name)} ${esc(s2.last_name)}</span>
            <span class="li-sub">Déposé le ${esc(dateFr(s2.submitted_at || s2.created_at))}${s2.late ? ' · en retard' : ''}</span></span>
          <span class="li-aside">${s2.score != null ? badge(note(s2.score), (s2.score || 0) >= 10 ? 'ok' : 'danger') : badge('Non noté', 'neutral')}</span></div>`).join('')}</div></div></div>` : ''}`;
    const host = el.querySelector('#hd-donut');
    host.appendChild(donutChart([
      { label: 'Rendus', value: x.rendus || 0, color: '#0e7c66' },
      { label: 'En attente', value: Math.max(0, (x.effectif || 0) - (x.rendus || 0)), color: '#cbd5e1' },
    ], { height: 150, thickness: 20, centerLabel: `${x.rendus || 0}/${x.effectif || 0}`, centerSub: 'élèves' }));
    el.querySelector('#hd-edit').addEventListener('click', () => homeworkForm(id, () => homeworkDetail(el, id)));
    el.querySelector('#hd-grade')?.addEventListener('click', () => gradeRendus(x, rendus, () => homeworkDetail(el, id)));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Devoir indisponible', message: err.message })}</div></div>`;
  }
}

/** Notation rapide des travaux déposés (modale). */
function gradeRendus(hw, rendus, onDone) {
  modal({
    title: `Noter « ${hw.title} »`, icon: 'pen-tool', size: 'modal-narrow',
    body: rendus.length ? `<form id="gr-form">${rendus.map((s2) => `<div class="row gap-3" style="align-items:center;padding:7px 0;border-bottom:1px solid var(--border-subtle)">
        <span class="row gap-2" style="flex:1;min-width:0">${avatar({ first: s2.first_name, last: s2.last_name, size: 'avatar-sm' })}
          <span class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s2.first_name)} ${esc(s2.last_name)}</span></span>
        <input class="input input-sm num" style="width:86px" type="number" min="0" max="20" step="0.25" value="${s2.score ?? ''}" data-student="${s2.id}" placeholder="/20" aria-label="Note de ${esc(s2.first_name)}"></div>`).join('')}</form>`
      : emptyState({ icon: 'inbox', title: 'Aucun travail déposé', message: 'Les élèves peuvent déposer leur devoir depuis le portail élève.' }),
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="gr-go">${icon('save', { size: 15 })} Enregistrer les notes</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#gr-go').addEventListener('click', () => withBusy(layer.querySelector('#gr-go'), async () => {
        const grades = [...layer.querySelectorAll('[data-student]')].map((i) => ({ student_id: Number(i.dataset.student), score: i.value === '' ? null : Number(i.value) }));
        try {
          await api.post(`/academics/homework/${hw.id}/grade`, { grades });
          close();
          toastOk('Notes enregistrées', 'Les moyennes du devoir sont à jour.');
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerAcademics(route) {
  route('/scolaire/classes', async () => { const el = h('<div class="view"></div>'); classesView(el); return el; }, { title: 'Classes & niveaux', group: 'Scolarité' });
  route('/scolaire/classes/:id', async ({ params }) => { const el = h('<div class="view"></div>'); classView(el, Number(params.id)); return el; }, { title: 'Classe', group: 'Scolarité' });
  route('/scolaire/emploi-du-temps', async ({ query }) => { const el = h('<div class="view"></div>'); timetableView(el, query); return el; }, { title: 'Emploi du temps', group: 'Scolarité' });
  route('/pedagogie/notes', async ({ query }) => { const el = h('<div class="view"></div>'); notesView(el, query); return el; }, { title: 'Notes & évaluations', group: 'Pédagogie' });
  route('/pedagogie/notes/:id', async ({ params }) => { const el = h('<div class="view"></div>'); gradeEntry(el, Number(params.id)); return el; }, { title: 'Saisie des notes', group: 'Pédagogie' });
  route('/pedagogie/resultats', async ({ query }) => { const el = h('<div class="view"></div>'); resultsView(el, query); return el; }, { title: 'Résultats de classe', group: 'Pédagogie' });
  route('/pedagogie/bulletins', async ({ query }) => { const el = h('<div class="view"></div>'); bulletinsView(el, query); return el; }, { title: 'Bulletins', group: 'Pédagogie' });
  route('/pedagogie/bulletins/:id', async ({ params }) => { const el = h('<div class="view"></div>'); bulletinPage(el, Number(params.id)); return el; }, { title: 'Bulletin', group: 'Pédagogie' });
  route('/pedagogie/cahier', async ({ query }) => { const el = h('<div class="view"></div>'); lessonsView(el, query); return el; }, { title: 'Cahier de textes', group: 'Pédagogie' });
  route('/pedagogie/devoirs', async ({ query }) => { const el = h('<div class="view"></div>'); homeworkView(el, query); return el; }, { title: 'Devoirs', group: 'Pédagogie' });
  route('/pedagogie/devoirs/:id', async ({ params }) => { const el = h('<div class="view"></div>'); homeworkDetail(el, Number(params.id)); return el; }, { title: 'Devoir', group: 'Pédagogie' });
}

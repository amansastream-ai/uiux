/**
 * SunuÉcole — Vie scolaire : appel des présences, absences & justificatifs,
 * discipline.
 *
 * L'appel est le geste le plus répété de toute l'application (plusieurs fois
 * par jour, par classe, par enseignant). Il est donc conçu pour être fait
 * AU CLAVIER en moins de 30 secondes pour 40 élèves, et surtout pour
 * fonctionner SANS RÉSEAU : la saisie est conservée localement puis
 * synchronisée. Sur le terrain, c'est la fonction qui déclenche l'adoption.
 */
import { api, isOnline } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination,
  toolbar, field, readForm, modal, confirmDialog, toast, toastOk, toastErr, toastInfo, debounce, withBusy,
} from '../ui/components.js';
import { num, dateFr, dateLong, heureFr, relatif, aujourdhui, ajouterJours, STATUT_PRESENCE, TYPES_INCIDENT, SEVERITES, SANCTIONS, dictLabel, dictEntries } from '../core/format.js';

const STATUTS = [
  { key: 'present', num: 1, label: 'Présent', short: 'P', tone: 'ok', icon: 'check-circle' },
  { key: 'absent', num: 2, label: 'Absent', short: 'A', tone: 'danger', icon: 'x-circle' },
  { key: 'retard', num: 3, label: 'Retard', short: 'R', tone: 'warn', icon: 'clock-alert' },
  { key: 'excuse', num: 4, label: 'Excusé', short: 'E', tone: 'info', icon: 'heart-pulse' },
];
const byKey = (k) => STATUTS.find((s) => s.key === k) || STATUTS[0];

/* ================================================================== */
/* APPEL DES PRÉSENCES                                                 */
/* ================================================================== */
async function rollCall(el, query) {
  const state = {
    classId: Number(query.class_id) || 0,
    date: query.date || aujourdhui(),
    slot: Number(query.slot_index || query.slot) || 1,
    subjectId: null,
    startTime: query.slot || null,
    sheet: null,
    marks: new Map(),      // studentId → { status, minutes_late, note }
    cursor: 0,             // élève actif pour la saisie clavier
    notify: true,
    dirty: false,
  };

  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div>
        <div class="uppercase mb-2">Vie scolaire</div>
        <h1 class="h-page">Appel des présences</h1>
        <p class="subtle small mt-2">Saisie au clavier : <kbd>1</kbd> présent · <kbd>2</kbd> absent · <kbd>3</kbd> retard · <kbd>4</kbd> excusé · <kbd>Entrée</kbd> élève suivant · <kbd>Ctrl</kbd>+<kbd>S</kbd> enregistrer.
          ${icon('cloud-off', { size: 13 })} Fonctionne aussi hors connexion.</p>
      </div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="rc-history">${icon('history', { size: 15 })} Historique des appels</button>
        <button class="btn btn-secondary" id="rc-absents">${icon('clock-alert', { size: 15 })} Absents du jour</button>
        <button class="btn btn-primary" id="rc-save" disabled>${icon('save', { size: 15 })} Enregistrer l'appel</button>
      </div>
    </header>

    <div class="card">
      <div class="card-body">
        <div class="grid" style="grid-template-columns:1.4fr 1fr 1fr 1fr;gap:12px" id="rc-pickers">
          <div class="field" style="margin:0"><label for="rc-class">Classe</label>
            <select class="select" id="rc-class"><option value="">Chargement…</option></select></div>
          <div class="field" style="margin:0"><label for="rc-date">Date</label>
            <input class="input" type="date" id="rc-date" value="${state.date}" max="${ajouterJours(aujourdhui(), 1)}"></div>
          <div class="field" style="margin:0"><label for="rc-slot">Créneau</label>
            <select class="select" id="rc-slot"><option value="1">Chargement…</option></select></div>
          <div class="field" style="margin:0"><label>&nbsp;</label>
            <div class="row gap-2">
              <button class="btn btn-secondary grow" id="rc-all-present" type="button">${icon('check-circle', { size: 15 })} Tout présent</button>
            </div></div>
        </div>
      </div>
    </div>

    <div id="rc-body" class="mt-4">${skeletonRows(10, 4)}</div>`;

  const classSel = el.querySelector('#rc-class');
  const slotSel = el.querySelector('#rc-slot');
  const dateInp = el.querySelector('#rc-date');
  const body = el.querySelector('#rc-body');
  const saveBtn = el.querySelector('#rc-save');

  /* ---- Chargement des classes autorisées ---- */
  try {
    const r = await api.get('/academics/classes?limit=200', { cacheTtl: 120000 });
    const classes = r.data || [];
    classSel.innerHTML = `<option value="">— Choisir une classe —</option>${classes.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.niveau || '')} (${c.effectif ?? 0} élèves)</option>`).join('')}`;
    if (!state.classId && classes.length === 1) state.classId = classes[0].id;
    classSel.value = state.classId || '';
  } catch (err) {
    classSel.innerHTML = '<option value="">Erreur de chargement</option>';
    toastErr('Classes indisponibles', err.message);
  }

  classSel.addEventListener('change', () => { state.classId = Number(classSel.value) || 0; state.slot = 1; loadSheet(); });
  dateInp.addEventListener('change', () => { state.date = dateInp.value || aujourdhui(); loadSheet(); });
  slotSel.addEventListener('change', () => {
    const opt = slotSel.selectedOptions[0];
    state.slot = Number(slotSel.value) || 1;
    state.startTime = opt?.dataset?.start || null;
    state.subjectId = Number(opt?.dataset?.subject) || null;
    loadSheet();
  });
  el.querySelector('#rc-all-present').addEventListener('click', () => {
    if (!state.sheet) return;
    state.sheet.students.forEach((s) => state.marks.set(s.id, { status: 'present', minutes_late: 0, note: null }));
    state.dirty = true;
    paintGrid();
    toastInfo('Tous marqués présents', 'Vérifiez les exceptions avant d\'enregistrer.');
  });
  el.querySelector('#rc-history').addEventListener('click', () => go(`/vie-scolaire/presences?tab=historique`));
  el.querySelector('#rc-absents').addEventListener('click', () => go('/vie-scolaire/absences'));

  async function loadSheet() {
    if (!state.classId) {
      body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'school', title: 'Sélectionnez une classe', message: 'Choisissez la classe et le créneau pour ouvrir la feuille d\'appel.' })}</div></div>`;
      saveBtn.disabled = true;
      return;
    }
    body.innerHTML = `<div class="card"><div class="card-body" style="padding:40px;text-align:center"><span class="spinner"></span><div class="subtle small mt-3">Chargement de la feuille d'appel…</div></div></div>`;
    try {
      const r = await api.get(`/academics/attendance/sheet?class_id=${state.classId}&date=${state.date}&slot=${state.slot}`);
      state.sheet = r.data;
      state.marks = new Map();
      r.data.students.forEach((s) => state.marks.set(s.id, {
        status: s.status || 'present',
        minutes_late: s.minutes_late || 0,
        note: s.note || null,
      }));
      state.cursor = 0;
      state.dirty = false;
      paintSlots();
      paintGrid();
      saveBtn.disabled = !isDirty();
    } catch (err) {
      body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Feuille indisponible', message: err.message })}</div></div>`;
    }
  }

  /** Le sélecteur de créneau est rempli depuis l'emploi du temps de la classe. */
  function paintSlots() {
    const tt = state.sheet?.timetable || [];
    const opts = tt.length
      ? tt.map((t) => `<option value="${t.slot}" data-start="${esc(t.start_time)}" data-subject="${t.subject_id || ''}">${esc(t.start_time)}–${esc(t.end_time)} · ${esc(t.matiere || 'Cours')}</option>`).join('')
      : [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `<option value="${i}">Créneau ${i}</option>`).join('');
    slotSel.innerHTML = `<option value="0">Appel du matin (toute la classe)</option>${opts}`;
    slotSel.value = String(state.slot);
  }

  const isDirty = () => state.dirty;

  function stats() {
    const c = { present: 0, absent: 0, retard: 0, excuse: 0 };
    state.marks.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    const total = state.marks.size || 1;
    return { ...c, total, taux: Math.round(((c.present + c.retard * 0.5) / total) * 1000) / 10 };
  }

  function paintGrid() {
    if (!state.sheet) return;
    const s = stats();
    const students = state.sheet.students || [];
    body.innerHTML = `
      <div class="card">
        <div class="card-head wrap gap-3">
          <div>
            <h2>${icon('clipboard-check', { size: 16 })} ${esc(state.sheet.class?.name || '')} — ${esc(dateLong(state.date))}</h2>
            <p class="subtle tiny mt-2">
              ${state.sheet.session ? `Appel déjà validé à ${heureFr(state.sheet.session.taken_at)} par ${esc(state.sheet.session.enseignant || '')}. Vous pouvez le corriger.` : 'Aucun appel enregistré pour ce créneau.'}
              ${state.sheet.session?.taken_offline ? ` ${badge('Saisi hors-ligne', 'warn')}` : ''}
            </p>
          </div>
          <div class="grow"></div>
          <div class="roll-stats">
            ${STATUTS.map((st) => `<span class="roll-stat" data-tone="${st.tone}"><b class="num">${s[st.key] || 0}</b>${st.label}</span>`).join('')}
            <span class="roll-stat" data-tone="${s.taux >= 92 ? 'ok' : s.taux >= 85 ? 'warn' : 'danger'}"><b class="num">${s.taux} %</b>Taux</span>
          </div>
        </div>
        <div class="card-body" style="padding:0">
          ${!isOnline() ? `<div class="alert alert-warn" style="margin:12px 14px;border-radius:var(--r-sm)">${icon('wifi-off', { size: 16 })}
            <div class="alert-body"><div class="alert-title">Mode hors connexion</div>
            <div class="alert-msg">Continuez l'appel normalement : il sera enregistré sur cet appareil puis envoyé automatiquement au retour du réseau.</div></div></div>` : ''}
          <div class="roll-grid" id="roll-grid" tabindex="0" role="grid" aria-label="Feuille d'appel de ${esc(state.sheet.class?.name || '')}">
            <div class="roll-row roll-head" role="row">
              <span role="columnheader">#</span><span role="columnheader">Élève</span>
              <span role="columnheader" class="hide-sm">Absences récentes</span>
              <span role="columnheader">Statut</span><span role="columnheader" class="hide-md">Détail</span>
            </div>
            ${students.map((st, i) => {
              const m = state.marks.get(st.id) || { status: 'present', minutes_late: 0, note: '' };
              return `<div class="roll-row" role="row" data-student="${st.id}" data-i="${i}" aria-selected="${i === state.cursor}">
                <span class="roll-idx num" role="gridcell">${i + 1}</span>
                <span class="roll-stu" role="gridcell">
                  ${avatar({ first: st.first_name, last: st.last_name, src: st.photo_url, size: 'avatar-sm' })}
                  <span style="min-width:0"><span class="roll-name">${esc(st.first_name)} ${esc(st.last_name)}</span>
                  <span class="roll-mat">${esc(st.matricule)}${st.absences_recentes ? ` · <span style="color:var(--warn)">${st.absences_recentes} abs. récente(s)</span>` : ''}</span></span>
                </span>
                <span class="roll-hist hide-sm" role="gridcell">
                  ${st.absences_recentes >= 5 ? badge('À surveiller', 'danger') : st.absences_recentes >= 2 ? badge(`${st.absences_recentes} abs.`, 'warn') : '<span class="subtle tiny">Aucune</span>'}
                </span>
                <span class="roll-acts" role="gridcell">
                  ${STATUTS.map((sb) => `<button type="button" class="roll-btn" data-s="${sb.key}" data-student="${st.id}"
                    aria-pressed="${m.status === sb.key}" aria-label="${sb.label} pour ${esc(st.first_name)} ${esc(st.last_name)}"
                    title="${sb.label} (touche ${sb.num})" data-tone="${sb.tone}">${sb.short}</button>`).join('')}
                </span>
                <span class="roll-extra hide-md" role="gridcell">
                  ${m.status === 'retard' ? `<input class="input input-sm" type="number" min="0" max="180" step="5" value="${m.minutes_late || 0}" data-min="${st.id}" aria-label="Minutes de retard" placeholder="min">` : ''}
                  ${m.status === 'absent' || m.status === 'excuse' ? `<input class="input input-sm" type="text" value="${esc(m.note || '')}" data-note="${st.id}" placeholder="Motif (optionnel)" aria-label="Motif">` : ''}
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div class="card-foot row-between wrap gap-3">
          <label class="check"><input type="checkbox" id="rc-notify" ${state.notify ? 'checked' : ''}>
            <span class="check-box">${icon('check', { size: 11 })}</span>
            <span>Prévenir les parents des absents par SMS <span class="subtle tiny">(${s.absent + s.retard} destinataire(s) · 25 FCFA/SMS)</span></span></label>
          <div class="row gap-2 wrap">
            <span class="subtle tiny" id="rc-state">${state.dirty ? 'Modifications non enregistrées' : 'À jour'}</span>
            <button class="btn btn-secondary" id="rc-reset">${icon('refresh', { size: 15 })} Réinitialiser</button>
            <button class="btn btn-primary" id="rc-save2" ${state.dirty ? '' : 'disabled'}>${icon('save', { size: 15 })} Enregistrer l'appel</button>
          </div>
        </div>
      </div>`;

    const grid = body.querySelector('#roll-grid');
    grid.querySelectorAll('.roll-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        setMark(Number(b.dataset.student), b.dataset.s);
        const row = b.closest('.roll-row');
        moveCursor(Number(row.dataset.i) + 1);
      });
    });
    grid.querySelectorAll('.roll-row[data-student]').forEach((row) => {
      row.addEventListener('click', () => moveCursor(Number(row.dataset.i)));
    });
    grid.querySelectorAll('[data-min]').forEach((inp) => inp.addEventListener('input', debounce(() => {
      const m = state.marks.get(Number(inp.dataset.min));
      if (m) { m.minutes_late = Number(inp.value) || 0; markDirty(); }
    }, 250)));
    grid.querySelectorAll('[data-note]').forEach((inp) => inp.addEventListener('input', debounce(() => {
      const m = state.marks.get(Number(inp.dataset.note));
      if (m) { m.note = inp.value.trim() || null; markDirty(); }
    }, 250)));
    grid.addEventListener('keydown', onGridKey);
    body.querySelector('#rc-notify').addEventListener('change', (e) => { state.notify = e.target.checked; });
    body.querySelector('#rc-reset').addEventListener('click', () => loadSheet());
    body.querySelector('#rc-save2').addEventListener('click', save);
    saveBtn.disabled = !state.dirty;
    saveBtn.onclick = save;
    moveCursor(state.cursor, false);
    grid.focus();
  }

  function setMark(studentId, status) {
    const m = state.marks.get(studentId) || { minutes_late: 0, note: null };
    if (m.status === status && status !== 'retard') return;
    m.status = status;
    if (status !== 'retard') m.minutes_late = 0;
    else if (!m.minutes_late) m.minutes_late = 10;
    state.marks.set(studentId, m);
    markDirty();
    // Mise à jour ciblée (pas de re-rendu complet : la saisie reste fluide)
    const row = body.querySelector(`.roll-row[data-student="${studentId}"]`);
    if (row) {
      row.querySelectorAll('.roll-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === status)));
      const extra = row.querySelector('.roll-extra');
      if (extra) {
        const st = state.sheet.students.find((x) => x.id === studentId);
        extra.innerHTML = status === 'retard'
          ? `<input class="input input-sm" type="number" min="0" max="180" step="5" value="${m.minutes_late}" data-min="${studentId}" aria-label="Minutes de retard">`
          : (status === 'absent' || status === 'excuse')
            ? `<input class="input input-sm" type="text" value="${esc(m.note || '')}" data-note="${studentId}" placeholder="Motif (optionnel)" aria-label="Motif">`
            : '';
        const inp = extra.querySelector('input');
        if (inp) {
          inp.addEventListener('input', debounce(() => {
            const mm = state.marks.get(studentId);
            if (mm) { if (inp.dataset.min) mm.minutes_late = Number(inp.value) || 0; else mm.note = inp.value.trim() || null; markDirty(); }
          }, 250));
        }
      }
      // Rafraîchit uniquement les compteurs
      refreshCounters();
    }
  }

  function refreshCounters() {
    const s = stats();
    body.querySelectorAll('.roll-stat').forEach((el2, i) => {
      const keys = [...STATUTS.map((x) => x.key), 'taux'];
      const k = keys[i];
      const b = el2.querySelector('b');
      if (b) b.textContent = k === 'taux' ? `${s.taux} %` : s[k] || 0;
      if (k === 'taux') el2.dataset.tone = s.taux >= 92 ? 'ok' : s.taux >= 85 ? 'warn' : 'danger';
    });
  }

  function moveCursor(i, scroll = true) {
    const rows = [...body.querySelectorAll('.roll-row[data-student]')];
    if (!rows.length) return;
    state.cursor = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => r.setAttribute('aria-selected', String(k === state.cursor)));
    rows[state.cursor]?.classList.add('is-cursor');
    rows.forEach((r, k) => { if (k !== state.cursor) r.classList.remove('is-cursor'); });
    if (scroll) rows[state.cursor]?.scrollIntoView({ block: 'nearest' });
  }

  function onGridKey(e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); moveCursor(state.cursor + 1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveCursor(state.cursor - 1); }
      return;
    }
    const st = STATUTS.find((x) => String(x.num) === e.key);
    if (st) {
      e.preventDefault();
      const row = body.querySelector(`.roll-row[data-i="${state.cursor}"]`);
      const sid = Number(row?.dataset.student);
      if (sid) { setMark(sid, st.key); moveCursor(state.cursor + 1); }
      return;
    }
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); moveCursor(state.cursor + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); moveCursor(state.cursor - 1); }
    else if (e.key === 'Home') { e.preventDefault(); moveCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); moveCursor(state.sheet.students.length - 1); }
    else if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      state.sheet.students.forEach((x) => state.marks.set(x.id, { status: 'present', minutes_late: 0, note: null }));
      state.dirty = true;
      paintGrid();
    }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  }
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.dirty) { e.preventDefault(); save(); }
  });

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      saveBtn.disabled = false;
      const b2 = body.querySelector('#rc-save2');
      if (b2) b2.disabled = false;
      const st = body.querySelector('#rc-state');
      if (st) st.textContent = 'Modifications non enregistrées';
    }
  }

  async function save() {
    if (!state.sheet) return;
    const records = [...state.marks.entries()].map(([student_id, m]) => ({ student_id, status: m.status, minutes_late: m.minutes_late || 0, note: m.note || null }));
    const s = stats();
    const payload = {
      class_id: state.classId,
      date: state.date,
      slot: state.slot,
      start_time: state.startTime || state.sheet.session?.start_time || null,
      subject_id: state.subjectId || null,
      period_label: state.slot === 0 ? 'Appel du matin' : `Créneau ${state.slot}`,
      records,
      notify_parents: state.notify,
      offline: !isOnline(),
    };
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span> Enregistrement…`;
    try {
      let r;
      if (isOnline()) r = await api.post('/academics/attendance', payload);
      else r = await api.offlinePost('attendance.create', payload, { label: `Appel ${state.sheet.class?.name} ${state.date}` });
      state.dirty = false;
      const msg = r?.data?.sms_queued ? ` · ${r.data.sms_queued} SMS parent(s) programmé(s)` : '';
      toast({
        title: isOnline() ? 'Appel enregistré' : 'Appel enregistré hors-ligne',
        message: `${s.present} présent(s), ${s.absent} absent(s), ${s.retard} retard(s), ${s.excuse} excusé(s) — taux ${s.taux} %.${msg}`,
        tone: isOnline() ? 'ok' : 'warn',
        duration: 5200,
      });
      saveBtn.innerHTML = `${icon('save', { size: 15 })} Enregistrer l'appel`;
      loadSheet();
    } catch (err) {
      toastErr('Enregistrement impossible', err.message);
      saveBtn.disabled = false;
      saveBtn.innerHTML = `${icon('save', { size: 15 })} Enregistrer l'appel`;
    }
  }

  if (state.classId) loadSheet();
  else {
    body.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'school', title: 'Sélectionnez une classe', message: 'Choisissez la classe et le créneau pour ouvrir la feuille d\'appel.' })}</div></div>`;
  }
}

/* ================================================================== */
/* ABSENCES & JUSTIFICATIFS                                            */
/* ================================================================== */
async function absencesView(el, query) {
  let tab = query.tab === 'justificatifs' ? 'justificatifs' : 'absences';
  const f = { q: '', class_id: '', status: '', from: ajouterJours(aujourdhui(), -14), to: aujourdhui(), page: 1, limit: 25 };

  function paint() {
    el.innerHTML = `
      <header class="row-between wrap mb-4" style="align-items:flex-end">
        <div><div class="uppercase mb-2">Vie scolaire</div><h1 class="h-page">Absences & justificatifs</h1>
          <p class="subtle small mt-2">Suivi des absences, retards et des justificatifs fournis par les familles. Un modèle de SMS de rappel est prêt à l'envoi.</p></div>
        <div class="row gap-2 wrap">
          <button class="btn btn-secondary" id="ab-export">${icon('download', { size: 15 })} Exporter</button>
          <button class="btn btn-primary" id="ab-sms">${icon('sms', { size: 15 })} Relancer les familles</button>
        </div>
      </header>
      <div id="ab-tabs"></div>
      <div class="card mt-4"><div class="card-body" id="ab-toolbar"></div>
        <div class="card-body" style="padding:0" id="ab-table">${skeletonRows(9, 6)}</div>
        <div class="card-foot" id="ab-pager"></div></div>`;
    const tabsHost = el.querySelector('#ab-tabs');
    tabsHost.appendChild(tabsEl([
      { id: 'absences', label: 'Absences & retards', icon: 'clock-alert' },
      { id: 'justificatifs', label: 'Justificatifs', icon: 'file-text' },
      { id: 'sessions', label: 'Appels réalisés', icon: 'clipboard-check' },
    ], tab, (t) => { tab = t; paint(); }));
    if (tab === 'justificatifs') loadJustif();
    else if (tab === 'sessions') loadSessions();
    else loadAbsences();
    el.querySelector('#ab-sms').addEventListener('click', () => go('/communication/sms?template=absence'));
    el.querySelector('#ab-export').addEventListener('click', () => toastInfo('Export', 'Utilisez la liste ci-dessous puis le bouton d\'export du module Élèves pour un CSV complet.'));
  }

  async function loadAbsences() {
    const slot = el.querySelector('#ab-toolbar');
    slot.innerHTML = toolbar({
      search: f.q, searchPlaceholder: 'Nom ou matricule…',
      filters: `<select class="select select-sm" data-f="status"><option value="">Tous les statuts</option>
          ${dictEntries(STATUT_PRESENCE).filter((o) => o.value !== 'present').map((o) => `<option value="${o.value}" ${f.status === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
        <input class="input input-sm" type="date" data-f="from" value="${f.from}" aria-label="Du">
        <input class="input input-sm" type="date" data-f="to" value="${f.to}" aria-label="Au">`,
      actions: `<button class="btn btn-secondary btn-sm" id="ab-week">Cette semaine</button>`,
    });
    slot.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); }, 300));
    slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
    slot.querySelector('#ab-week').addEventListener('click', () => {
      f.from = ajouterJours(aujourdhui(), -7); f.to = aujourdhui(); paint(); fetchRows();
    });
    await fetchRows();

    async function fetchRows() {
      const tableSlot = el.querySelector('#ab-table');
      tableSlot.innerHTML = skeletonRows(8, 6);
      try {
        const q = new URLSearchParams({ limit: f.limit, page: f.page });
        if (f.q) q.set('q', f.q);
        if (f.status) q.set('status', f.status);
        if (f.from) q.set('from', f.from);
        if (f.to) q.set('to', f.to);
        const r = await api.get(`/academics/attendance/absences?${q}`);
        const rows = r.data || [];
        if (!rows.length) {
          tableSlot.innerHTML = emptyState({ icon: 'check-circle', title: 'Aucune absence', message: 'Aucune absence sur la période sélectionnée. Excellent signe !' });
          el.querySelector('#ab-pager').innerHTML = '';
          return;
        }
        tableSlot.innerHTML = dataTable({
          columns: [
            { key: 'date', label: 'Date', width: '120px', render: (x) => `<b class="small">${dateFr(x.session_date)}</b><div class="tiny subtle">${esc(x.period_label || '')}</div>` },
            { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
                <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.matricule)}</div></div></div>` },
            { key: 'classe', label: 'Classe', width: '96px', render: (x) => esc(x.classe || '') },
            { key: 'status', label: 'Statut', width: '120px', render: (x) => {
              const st = STATUT_PRESENCE[x.status];
              return badge(dictLabel(STATUT_PRESENCE, x.status), st?.tone || 'neutral');
            } },
            { key: 'minutes', label: 'Retard', width: '90px', align: 'right', hideBelow: 'lg', render: (x) => (x.minutes_late ? `<span class="num">${x.minutes_late} min</span>` : '<span class="subtle tiny">—</span>') },
            { key: 'justif', label: 'Justificatif', width: '150px', hideBelow: 'md', render: (x) => (x.justificatif
              ? badge('Justifiée', 'ok', { iconName: 'check-circle' })
              : `<button class="btn btn-ghost btn-sm" data-justif="${x.student_id}" data-date="${esc(x.session_date)}">${icon('plus', { size: 13 })} Justifier</button>`) },
            { key: 'parent', label: 'Parent', width: '150px', hideBelow: 'xl', render: (x) => (x.parent_tel ? `<span class="num small">${esc(x.parent_tel)}</span>` : '<span class="subtle tiny">—</span>') },
            { key: 'act', label: '', width: '118px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
                ${x.parent_tel ? `<a class="btn btn-ghost btn-icon btn-sm" href="sms:${esc(x.parent_tel)}" title="SMS au parent">${icon('sms', { size: 15 })}</a>` : ''}
                <button class="btn btn-secondary btn-sm" data-open="${x.student_id}">Fiche</button></div>` },
          ],
          rows, dense: true, zebra: true,
        }).outerHTML;
        tableSlot.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go(`/scolaire/eleves/${b.dataset.open}`)));
        tableSlot.querySelectorAll('[data-justif]').forEach((b) => b.addEventListener('click', () => justifForm(b.dataset.justif, b.dataset.date, fetchRows)));
        const pager = el.querySelector('#ab-pager');
        pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'absences' });
        wirePagination(pager, (p) => { f.page = p; fetchRows(); });
      } catch (err) {
        tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
      }
    }
  }

  async function loadJustif() {
    const slot = el.querySelector('#ab-toolbar');
    slot.innerHTML = toolbar({ search: null,
      actions: `<button class="btn btn-primary btn-sm" id="j-new">${icon('plus', { size: 14 })} Enregistrer un justificatif</button>` });
    slot.querySelector('#j-new').addEventListener('click', () => justifForm(null, null, loadJustif));
    const tableSlot = el.querySelector('#ab-table');
    tableSlot.innerHTML = skeletonRows(6, 5);
    try {
      const r = await api.get('/academics/justifications?limit=60');
      const rows = r.data || [];
      tableSlot.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</div></div></div>` },
          { key: 'periode', label: 'Période', width: '190px', render: (x) => `${dateFr(x.date_from)} → ${dateFr(x.date_to)}` },
          { key: 'reason', label: 'Motif', render: (x) => `<span class="small">${esc(x.reason || '')}</span><div class="tiny subtle">${esc(x.reason_type || '')}</div>` },
          { key: 'status', label: 'Statut', width: '130px', align: 'right', render: (x) => badge(x.status === 'acceptee' ? 'Accepté' : x.status === 'refusee' ? 'Refusé' : 'En attente',
            x.status === 'acceptee' ? 'ok' : x.status === 'refusee' ? 'danger' : 'warn') },
          { key: 'act', label: '', width: '150px', align: 'right', render: (x) => (x.status === 'en_attente'
            ? `<button class="btn btn-secondary btn-sm" data-review="${x.id}">${icon('check', { size: 13 })} Traiter</button>`
            : `<span class="subtle tiny">${relatif(x.reviewed_at || x.created_at)}</span>`) },
        ], rows, dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'file-text', title: 'Aucun justificatif', message: 'Les familles peuvent déposer un justificatif via le portail parent.' });
      tableSlot.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => reviewJustif(b.dataset.review, loadJustif)));
      el.querySelector('#ab-pager').innerHTML = '';
    } catch (err) {
      tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }

  async function loadSessions() {
    const slot = el.querySelector('#ab-toolbar');
    slot.innerHTML = toolbar({ search: null,
      filters: `<input class="input input-sm" type="date" id="ses-date" value="${aujourdhui()}" aria-label="Date">`,
      actions: '' });
    const tableSlot = el.querySelector('#ab-table');
    const fetchS = async () => {
      tableSlot.innerHTML = skeletonRows(8, 5);
      const date = el.querySelector('#ses-date')?.value || aujourdhui();
      try {
        const r = await api.get(`/academics/attendance/sessions?date=${date}&limit=100`);
        const rows = r.data || [];
        const missing = rows.filter((x) => x.status !== 'validated');
        tableSlot.innerHTML = rows.length ? `
          <div class="row gap-3 wrap" style="padding:10px 14px;border-bottom:1px solid var(--border-subtle)">
            ${badge(`${rows.length} appel(s)`, 'brand')}${badge(`${rows.reduce((a, x) => a + (x.saisis || 0), 0)} pointages`, 'info')}
            ${missing.length ? badge(`${missing.length} à valider`, 'warn') : badge('Tous validés', 'ok')}
          </div>
          ${dataTable({
            columns: [
              { key: 'classe', label: 'Classe', width: '110px', render: (x) => `<b>${esc(x.classe || '')}</b>` },
              { key: 'time', label: 'Créneau', width: '140px', render: (x) => `<span class="num small">${esc(x.start_time || '')}</span><div class="tiny subtle">${esc(x.period_label || '')}</div>` },
              { key: 'enseignant', label: 'Enseignant', render: (x) => esc(x.enseignant || '—') },
              { key: 'saisis', label: 'Saisis', width: '86px', align: 'right', render: (x) => `<b class="num">${x.saisis ?? 0}</b>` },
              { key: 'presents', label: 'Présents', width: '96px', align: 'right', render: (x) => `<span class="num" style="color:var(--ok)">${x.presents ?? 0}</span>` },
              { key: 'absents', label: 'Absents', width: '86px', align: 'right', render: (x) => `<span class="num" style="color:${(x.absents ?? 0) ? 'var(--danger)' : 'var(--text-3)'}">${x.absents ?? 0}</span>` },
              { key: 'status', label: 'Statut', width: '120px', align: 'right', render: (x) => badge(x.status === 'validated' ? 'Validé' : x.status === 'taken_offline' ? 'Hors-ligne' : 'Brouillon', x.status === 'validated' ? 'ok' : 'warn') },
              { key: 'act', label: '', width: '110px', align: 'right', render: (x) => `<button class="btn btn-secondary btn-sm" data-open="${x.class_id}" data-slot="${x.slot_index}" data-date="${esc(x.session_date)}">${icon('eye', { size: 13 })} Ouvrir</button>` },
            ], rows, dense: true, zebra: true,
          }).outerHTML}`
          : emptyState({ icon: 'clipboard-check', title: 'Aucun appel ce jour', message: `Aucun appel enregistré le ${dateFr(date)}.` });
        tableSlot.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go(`/vie-scolaire/presences?class_id=${b.dataset.open}&date=${b.dataset.date}&slot_index=${b.dataset.slot}`)));
        el.querySelector('#ab-pager').innerHTML = '';
      } catch (err) {
        tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
      }
    };
    el.querySelector('#ses-date')?.addEventListener('change', fetchS);
    fetchS();
  }
  paint();
}

function tabsEl(items, active, onSelect) {
  const el = h(`<div class="tabs" role="tablist">${items.map((t) => `<button class="tab" role="tab" data-t="${esc(t.id)}" aria-selected="${t.id === active}">${icon(t.icon, { size: 14 })}${esc(t.label)}</button>`).join('')}</div>`);
  el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.t)));
  return el;
}

function justifForm(studentId, date, onDone) {
  modal({
    title: 'Enregistrer un justificatif d\'absence', icon: 'file-text', size: 'modal-narrow',
    body: `<form id="jf-form">
      ${studentId ? `<input type="hidden" name="student_id" value="${studentId}">` : field({ label: 'ID élève', name: 'student_id', type: 'number', required: true, hint: 'Choisissez l\'élève dans la liste des absences pour pré-remplir.' })}
      <div class="grid-2">
        ${field({ label: 'Du', name: 'date_from', type: 'date', value: date || aujourdhui(), required: true })}
        ${field({ label: 'Au', name: 'date_to', type: 'date', value: date || aujourdhui(), required: true })}
      </div>
      ${field({ label: 'Type de motif', name: 'reason_type', type: 'select', options: [
        { value: 'maladie', label: 'Maladie / certificat médical' }, { value: 'familial', label: 'Événement familial' },
        { value: 'voyage', label: 'Déplacement / voyage' }, { value: 'administratif', label: 'Démarche administrative' },
        { value: 'autre', label: 'Autre' }], required: true })}
      ${field({ label: 'Motif détaillé', name: 'reason', type: 'textarea', rows: 2, required: true })}
      ${field({ label: 'Décision', name: 'status', type: 'select', options: [
        { value: 'en_attente', label: 'En attente de validation' }, { value: 'acceptee', label: 'Accepté' }, { value: 'refusee', label: 'Refusé' }] })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="jf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#jf-go').addEventListener('click', () => withBusy(layer.querySelector('#jf-go'), async () => {
        const payload = readForm(layer.querySelector('#jf-form'), ['student_id']);
        try { await api.post('/academics/justifications', payload); close(); toastOk('Justificatif enregistré'); onDone?.(); }
        catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

function reviewJustif(id, onDone) {
  modal({
    title: 'Traiter le justificatif', icon: 'check-circle', size: 'modal-narrow',
    body: `<form id="rj-form">
      ${field({ label: 'Décision', name: 'status', type: 'select', required: true, options: [
        { value: 'acceptee', label: 'Accepter le justificatif' }, { value: 'refusee', label: 'Refuser' }] })}
      ${field({ label: 'Commentaire', name: 'review_note', type: 'textarea', rows: 2, placeholder: 'Précisions utiles pour le suivi…' })}
      ${field({ label: 'Notifier la famille', name: 'notify', type: 'switch', value: true })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="rj-go">${icon('check', { size: 15 })} Valider</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#rj-go').addEventListener('click', () => withBusy(layer.querySelector('#rj-go'), async () => {
        try {
          await api.patch(`/academics/justifications/${id}`, readForm(layer.querySelector('#rj-form')));
          close();
          toastOk('Justificatif traité', 'Les absences concernées sont marquées comme excusées.');
          onDone?.();
        } catch (e) { toastErr('Traitement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* DISCIPLINE                                                          */
/* ================================================================== */
async function disciplineView(el, query) {
  const f = { q: query.student ? '' : '', class_id: '', severity: '', status: '', type: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Vie scolaire</div><h1 class="h-page">Discipline</h1>
        <p class="subtle small mt-2">Registre des incidents, sanctions et suivis. Les parents sont notifiés automatiquement par SMS.</p></div>
      <div class="row gap-2"><button class="btn btn-secondary" id="di-stats">${icon('chart', { size: 15 })} Statistiques</button>
        <button class="btn btn-primary" data-new id="di-new">${icon('plus', { size: 15 })} Déclarer un incident</button></div>
    </header>
    <div class="grid grid-kpi" id="di-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4"><div class="card-body" id="di-toolbar"></div>
      <div class="card-body" style="padding:0" id="di-table">${skeletonRows(8, 6)}</div>
      <div class="card-foot" id="di-pager"></div></div>`;

  const slot = el.querySelector('#di-toolbar');
  slot.innerHTML = toolbar({
    search: f.q, searchPlaceholder: 'Élève, motif…',
    filters: `<select class="select select-sm" data-f="severity"><option value="">Toutes gravités</option>
        ${dictEntries(SEVERITES).map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>
      <select class="select select-sm" data-f="type"><option value="">Tous types</option>
        ${dictEntries(TYPES_INCIDENT).map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>
      <select class="select select-sm" data-f="status"><option value="">Tous statuts</option>
        <option value="nouveau">Nouveau</option><option value="traite">Traité</option><option value="clos">Clos</option></select>`,
  });
  const fetchRows = debounce(async () => {
    const tableSlot = el.querySelector('#di-table');
    tableSlot.innerHTML = skeletonRows(7, 6);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      if (query.student) q.set('student_id', query.student);
      const r = await api.get(`/academics/discipline?${q}`);
      const rows = r.data || [];
      const stats = r.stats || {};
      el.querySelector('#di-kpis').innerHTML = [
        kpiMini('Incidents (30 j)', num(stats.total_30j ?? rows.length), 'shield', 'brand', stats.tendance ? `${stats.tendance > 0 ? '+' : ''}${stats.tendance} % vs mois précédent` : 'Sur la période'),
        kpiMini('Non traités', num(stats.nouveau ?? rows.filter((x) => x.status === 'nouveau').length), 'alert-circle', 'danger', 'À instruire par la vie scolaire'),
        kpiMini('Sanctions prononcées', num(stats.sanctions ?? 0), 'scale', 'warn', 'Avertissements, retenues, exclusions'),
        kpiMini('Parents notifiés', num(stats.notifies ?? 0), 'sms', 'ok', 'SMS automatiques envoyés'),
      ].join('');
      tableSlot.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'date', label: 'Date', width: '112px', render: (x) => `<b class="small">${dateFr(x.incident_date)}</b><div class="tiny subtle">${esc(heureFr(x.created_at) || '')}</div>` },
          { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</div></div></div>` },
          { key: 'type', label: 'Type', width: '150px', render: (x) => `<span class="small">${esc(dictLabel(TYPES_INCIDENT, x.type))}</span>` },
          { key: 'description', label: 'Description', hideBelow: 'md', render: (x) => `<span class="small subtle">${esc(x.description || '')}</span>` },
          { key: 'severity', label: 'Gravité', width: '112px', render: (x) => badge(dictLabel(SEVERITES, x.severity), x.severity === 'grave' ? 'danger' : x.severity === 'moyen' ? 'warn' : 'info') },
          { key: 'sanction', label: 'Sanction', width: '140px', hideBelow: 'lg', render: (x) => (x.sanction ? esc(dictLabel(SANCTIONS, x.sanction)) : '<span class="subtle tiny">—</span>') },
          { key: 'declarant', label: 'Déclaré par', width: '140px', hideBelow: 'xl', render: (x) => esc(x.declarant || '—') },
          { key: 'status', label: 'Statut', width: '110px', align: 'right', render: (x) => badge(x.status === 'traite' ? 'Traité' : x.status === 'clos' ? 'Clos' : 'Nouveau', x.status === 'nouveau' ? 'danger' : x.status === 'traite' ? 'ok' : 'neutral') },
          { key: 'act', label: '', width: '96px', align: 'right', render: () => '<button class="btn btn-secondary btn-sm" data-edit>Traiter</button>' },
        ], rows, dense: true, zebra: true,
        onRowClick: (x) => incidentForm(x, fetchRows),
      }).outerHTML : emptyState({ icon: 'shield-check', title: 'Aucun incident', message: 'Le registre est vide sur ces critères : comportement irréprochable.' });
      tableSlot.querySelectorAll('[data-edit]').forEach((b, i) => b.addEventListener('click', (e) => { e.stopPropagation(); incidentForm(rows[i], fetchRows); }));
      const pager = el.querySelector('#di-pager');
      pager.innerHTML = pagination({ page: r.meta?.page || 1, pages: r.meta?.pages || 1, total: r.meta?.total || rows.length, size: r.meta?.size || 25, label: 'incidents' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      tableSlot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);

  slot.querySelector('[data-search]').addEventListener('input', (e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); });
  slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
  el.querySelector('#di-new').addEventListener('click', () => incidentForm(null, fetchRows));
  el.querySelector('#di-stats').addEventListener('click', () => go('/vie-scolaire/discipline?stats=1'));
  if (query.student) toastInfo('Filtré', 'Incidents de l\'élève sélectionné.');
  await fetchRows.flush();
}

function kpiMini(label, value, ic, tone, hint) {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="${tone}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
    <div class="kpi-val">${esc(String(value))}</div><div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
}

function incidentForm(incident, onDone) {
  const x = incident || { status: 'nouveau', severity: 'leger', incident_date: aujourdhui() };
  modal({
    title: incident ? 'Incident disciplinaire' : 'Déclarer un incident',
    subtitle: incident ? `${x.first_name || ''} ${x.last_name || ''} · ${dateFr(x.incident_date)}` : 'La déclaration est tracée et notifie la famille.',
    icon: incident ? 'edit' : 'alert-triangle',
    size: 'modal-wide',
    body: `<form id="in-form">
      <div class="fieldset"><legend>${icon('user', { size: 14 })} Élève concerné</legend>
        <div class="grid-2">
          ${incident ? `<div class="field"><label>Élève</label><div class="input" style="background:var(--surface-2)">${esc(x.first_name)} ${esc(x.last_name)} <span class="subtle">(${esc(x.classe || '')})</span></div>
            <input type="hidden" name="student_id" value="${x.student_id}"></div>`
            : field({ label: 'Élève', name: 'student_id', type: 'number', required: true, hint: 'Recherchez l\'élève depuis sa fiche pour pré-remplir.' })}
          ${field({ label: 'Date de l\'incident', name: 'incident_date', type: 'date', value: x.incident_date || aujourdhui(), required: true })}
        </div></div>
      <div class="fieldset"><legend>${icon('alert-triangle', { size: 14 })} Faits</legend>
        <div class="grid-2">
          ${field({ label: 'Type d\'incident', name: 'type', type: 'select', required: true, value: x.type || '',
            options: dictEntries(TYPES_INCIDENT).map((o) => ({ value: o.value, label: o.label })) })}
          ${field({ label: 'Gravité', name: 'severity', type: 'select', required: true, value: x.severity || 'leger',
            options: dictEntries(SEVERITES).map((o) => ({ value: o.value, label: o.label })) })}
        </div>
        ${field({ label: 'Description des faits', name: 'description', type: 'textarea', rows: 3, value: x.description || '', required: true,
          placeholder: 'Décrivez factuellement ce qui s\'est passé (lieu, circonstances, témoins).' })}
        <div class="grid-2">
          ${field({ label: 'Lieu', name: 'location', value: x.location || '', placeholder: 'Salle 12, cour, couloir…' })}
          ${field({ label: 'Témoins', name: 'witnesses', value: x.witnesses || '', placeholder: 'Noms des témoins' })}
        </div></div>
      <div class="fieldset"><legend>${icon('scale', { size: 14 })} Sanction & suivi</legend>
        <div class="grid-2">
          ${field({ label: 'Sanction', name: 'sanction', type: 'select', value: x.sanction || '', placeholder: '— Aucune —',
            options: dictEntries(SANCTIONS).map((o) => ({ value: o.value, label: o.label })) })}
          ${field({ label: 'Durée (jours d\'exclusion)', name: 'sanction_days', type: 'number', value: x.sanction_days || 0, min: 0 })}
          ${field({ label: 'Statut du dossier', name: 'status', type: 'select', value: x.status || 'nouveau',
            options: [{ value: 'nouveau', label: 'Nouveau' }, { value: 'traite', label: 'Traité' }, { value: 'clos', label: 'Clos' }] })}
          ${field({ label: 'Date de convocation', name: 'hearing_date', type: 'date', value: x.hearing_date || '' })}
        </div>
        ${field({ label: 'Suivi / mesures éducatives', name: 'followup', type: 'textarea', rows: 2, value: x.followup || '', placeholder: 'Entretien, accompagnement, engagement de l\'élève…' })}
        ${field({ label: 'Notifier les parents par SMS', name: 'notify_parents', type: 'switch', value: x.parents_notified == null ? true : !!x.parents_notified, hint: 'Le message reprend le type d\'incident et la sanction.' })}
      </div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      ${incident?.id && store.atLeast(75) ? `<button class="btn btn-danger" id="in-del" style="margin-right:auto">${icon('trash', { size: 15 })} Supprimer</button>` : ''}
      <button class="btn btn-primary" id="in-go">${icon('save', { size: 15 })} ${incident?.id ? 'Enregistrer' : 'Déclarer'}</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#in-go').addEventListener('click', () => withBusy(layer.querySelector('#in-go'), async () => {
        const payload = readForm(layer.querySelector('#in-form'), ['student_id', 'sanction_days']);
        try {
          if (incident?.id) await api.patch(`/academics/discipline/${incident.id}`, payload);
          else await api.post('/academics/discipline', payload);
          close();
          toastOk(incident?.id ? 'Incident mis à jour' : 'Incident déclaré', payload.notify_parents ? 'La famille a été notifiée par SMS.' : '');
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
      layer.querySelector('#in-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Supprimer cet incident ?', danger: true, confirmLabel: 'Supprimer', message: 'La ligne sera retirée du registre disciplinaire. L\'opération est tracée dans le journal d\'audit.' }))) return;
        try { await api.del(`/academics/discipline/${incident.id}`); close(); toastOk('Incident supprimé'); onDone?.(); }
        catch (e) { toastErr('Suppression impossible', e.message); }
      });
    },
  });
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerVieScolaire(route) {
  route('/vie-scolaire/presences', async ({ query }) => {
    const el = h('<div class="view"></div>');
    if (query.tab === 'historique') { absencesView(el, { tab: 'sessions' }); return el; }
    rollCall(el, query);
    return el;
  }, { title: 'Appel & présences', group: 'Vie scolaire' });

  route('/vie-scolaire/absences', async ({ query }) => {
    const el = h('<div class="view"></div>');
    absencesView(el, query);
    return el;
  }, { title: 'Absences & justificatifs', group: 'Vie scolaire' });

  route('/vie-scolaire/discipline', async ({ query }) => {
    const el = h('<div class="view"></div>');
    disciplineView(el, query);
    return el;
  }, { title: 'Discipline', group: 'Vie scolaire' });
}

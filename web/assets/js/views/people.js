/**
 * SunuÉcole — Ressources humaines, familles & services périscolaires.
 *
 * Couvre : équipe (fiches, contrats, salaires), congés, familles/tuteurs,
 * bibliothèque (catalogue + prêts), cantine (pointage du jour), transport
 * scolaire (lignes, arrêts, affectations), infirmerie et documents
 * administratifs. Tout est pensé « guichet unique » : une seule page par
 * service, des actions en un clic, et une impression possible partout.
 */
import { api } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination,
  toolbar, field, readForm, modal, drawer, confirmDialog, toastOk, toastErr, toastInfo, debounce, withBusy, tabs,
} from '../ui/components.js';
import {
  xof, num, pct, dateFr, dateLong, heureFr, relatif, aujourdhui, ajouterJours, joursEntre, telFr,
  dictLabel, dictEntries, nomComplet, JOURS_COURTS, TYPES_CONGE, TYPES_DOCUMENT,
} from '../core/format.js';
import { barChart } from '../core/charts.js';

/* ================================================================== */
/* Référentiels locaux                                                 */
/* ================================================================== */
const TYPES_PERSONNEL = {
  direction: { label: 'Direction', tone: 'brand' },
  enseignant: { label: 'Enseignant', tone: 'info' },
  administratif: { label: 'Administratif', tone: 'neutral' },
  service: { label: 'Service', tone: 'warn' },
  securite: { label: 'Sécurité', tone: 'neutral' },
};
const CONTRATS = { cdi: 'CDI', cdd: 'CDD', vacation: 'Vacation', stage: 'Stage' };
const STATUT_STAFF = {
  active: { label: 'Actif', tone: 'ok' }, conge: { label: 'En congé', tone: 'warn' },
  suspendu: { label: 'Suspendu', tone: 'danger' }, parti: { label: 'A quitté', tone: 'neutral' },
};
const STATUT_CONGE = {
  en_attente: { label: 'En attente', tone: 'warn' }, approuve: { label: 'Approuvé', tone: 'ok' },
  refuse: { label: 'Refusé', tone: 'danger' },
};
const STATUT_PRET = {
  en_cours: { label: 'En cours', tone: 'info' }, en_retard: { label: 'En retard', tone: 'danger' },
  rendu: { label: 'Rendu', tone: 'ok' },
};
const TYPES_SANTE = {
  blessure: 'Blessure', maladie: 'Maladie', malaise: 'Malaise', allergie: 'Allergie',
  visite: 'Visite de contrôle', vaccination: 'Vaccination', autre: 'Autre',
};
const STATUT_DOC = {
  en_attente: { label: 'En attente', tone: 'warn' }, en_cours: { label: 'En préparation', tone: 'info' },
  remis: { label: 'Remis', tone: 'ok' }, annule: { label: 'Annulé', tone: 'neutral' },
};
const REPAS = { petit_dejeuner: 'Petit-déjeuner', dejeuner: 'Déjeuner', gouter: 'Goûter' };

const spinnerNote = (t) => `<div class="row gap-3 subtle small" style="justify-content:center;padding:36px"><span class="spinner"></span>${esc(t)}</div>`;
const kpi = (label, value, ic, tone, hint) => `<div class="kpi"><div class="kpi-top">
    <span class="kpi-ico" data-tone="${tone}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
  <div class="kpi-val" style="font-size:22px">${esc(value)}</div>
  <div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
const dl = (rows) => `<dl class="dl">${rows.filter(Boolean).map(([k, v]) => `<div class="dl-row"><dt>${esc(k)}</dt><dd>${v ?? '<span class="subtle">—</span>'}</dd></div>`).join('')}</dl>`;
const canBill = () => store.atLeast(70);
const canAdmin = () => store.atLeast(90);

/** Recherche d'élèves asynchrone partagée (cantine, bibliothèque, transport…). */
async function searchStudents(term) {
  if (!term || term.length < 2) return [];
  const r = await api.get(`/students?q=${encodeURIComponent(term)}&limit=8`);
  return r.data || [];
}

/* ================================================================== */
/* ÉQUIPE                                                              */
/* ================================================================== */
async function staffView(el, query = {}) {
  const f = { q: query.q || '', type: query.type || '', status: query.status || '' };
  el.innerHTML = `
    <div class="grid grid-kpi" id="st-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="st-toolbar"></div>
      <div class="card-body" style="padding:0" id="st-table">${skeletonRows(8, 6)}</div>
    </div>`;

  const load = async () => {
    const t = el.querySelector('#st-table');
    t.innerHTML = skeletonRows(8, 6);
    try {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, v); });
      const r = await api.get(`/people/staff?${q}`);
      const rows = r.data || [];
      const profs = rows.filter((x) => x.staff_type === 'enseignant');
      const masse = rows.filter((x) => x.status !== 'parti').reduce((a, x) => a + (x.salary_base || 0), 0);
      const presences = rows.map((x) => x.taux_presence).filter((v) => v != null);
      const moyPres = presences.length ? presences.reduce((a, b) => a + b, 0) / presences.length : null;

      el.querySelector('#st-kpis').innerHTML = [
        kpi('Effectif du personnel', num(rows.length), 'users', 'brand', `${num(profs.length)} enseignant(s) · ${num(rows.length - profs.length)} autres`),
        kpi('Masse salariale / mois', xof(masse), 'wallet', canBill() ? 'info' : 'neutral', canBill() ? `${xof(masse * 12)} par an` : 'Visible par la direction et la comptabilité'),
        kpi('Présence moyenne (30 j)', moyPres == null ? '—' : pct(moyPres), 'clipboard-check', moyPres >= 95 ? 'ok' : 'warn', 'Pointage du personnel'),
        kpi('Sans compte utilisateur', num(rows.filter((x) => !x.a_un_compte).length), 'user-x', rows.some((x) => !x.a_un_compte) ? 'warn' : 'ok', 'Créez les accès en un clic'),
      ].join('');

      el.querySelector('#st-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Nom, fonction, matricule…',
        filters: `<select class="select select-sm" data-f="type"><option value="">Tous les types</option>
            ${dictEntries(TYPES_PERSONNEL).map((o) => `<option value="${o.value}" ${f.type === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <select class="select select-sm" data-f="status"><option value="">Tous les statuts</option>
            ${dictEntries(STATUT_STAFF).map((o) => `<option value="${o.value}" ${f.status === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: `${canAdmin() ? `<button class="btn btn-primary" id="st-add">${icon('user-plus', { size: 15 })} Nouveau membre</button>` : ''}`,
      });
      const tb = el.querySelector('#st-toolbar');
      tb.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; load(); }));
      tb.querySelector('#st-add')?.addEventListener('click', () => staffForm(null, load));

      t.innerHTML = rows.length ? dataTable({
        columns: [
          {
            key: 'nom', label: 'Membre', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm', src: x.photo_url })}
              <div><div class="cell-user-name">${esc(x.name || nomComplet(x))}</div>
              <div class="cell-user-sub">${esc(x.job_title || dictLabel(TYPES_PERSONNEL, x.staff_type))} · ${esc(x.matricule || '')}</div></div></div>`,
          },
          { key: 'type', label: 'Type', width: '130px', render: (x) => badge(dictLabel(TYPES_PERSONNEL, x.staff_type), dictToneLocal(TYPES_PERSONNEL, x.staff_type)) },
          {
            key: 'contact', label: 'Contact', hideBelow: 'md', render: (x) => `<span class="num small">${esc(telFr(x.phone) || '—')}</span>
              ${x.email ? `<div class="tiny subtle">${esc(x.email)}</div>` : ''}`,
          },
          { key: 'contrat', label: 'Contrat', width: '120px', hideBelow: 'lg', render: (x) => `<span class="small">${esc(CONTRATS[x.contract_type] || x.contract_type || '—')}</span><div class="tiny subtle">depuis ${dateFr(x.hired_at)}</div>` },
          { key: 'salaire', label: 'Salaire', width: '120px', align: 'right', hideBelow: 'lg', render: (x) => (canBill() ? `<b class="num small">${xof(x.salary_base)}</b>` : '<span class="subtle tiny">masqué</span>') },
          {
            key: 'charge', label: 'Charge', width: '150px', hideBelow: 'md', render: (x) => (x.staff_type === 'enseignant'
              ? `<span class="small num">${num(x.classes)} classe(s)</span><div class="tiny subtle">${num(x.heures, 1)} h / semaine</div>`
              : `<span class="small num">${num(x.weekly_hours)} h</span><div class="tiny subtle">hebdomadaires</div>`),
          },
          {
            key: 'presence', label: 'Présence', width: '120px', hideBelow: 'md', render: (x) => (x.taux_presence == null
              ? '<span class="subtle tiny">aucun pointage</span>'
              : `${progress(x.taux_presence, x.taux_presence >= 95 ? 'ok' : x.taux_presence >= 85 ? 'warn' : 'danger')}<span class="tiny num">${pct(x.taux_presence)}</span>`),
          },
          {
            key: 'act', label: '', width: '150px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              ${x.a_un_compte ? badge('Compte', 'ok') : badge('Sans compte', 'warn')}
              <button class="btn btn-secondary btn-sm" data-edit="${x.id}">${icon('pencil', { size: 13 })}</button></div>`,
          },
        ],
        rows, dense: true, zebra: true, stickyFirst: true,
        onRowClick: (x) => go(`/personnel/${x.id}`),
        empty: { icon: 'users', title: 'Aucun membre', message: 'Ajustez les filtres ou créez une fiche de personnel.' },
      }).outerHTML : emptyState({ icon: 'users', title: 'Aucun membre', message: 'Ajustez les filtres ou créez une fiche de personnel.' });

      t.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        staffForm(rows.find((x) => String(x.id) === b.dataset.edit), load);
      }));
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  };
  await load();
}

function dictToneLocal(dict, key, fallback = 'neutral') {
  const d = dict[key];
  return d && typeof d === 'object' ? d.tone || fallback : fallback;
}

function staffForm(current, onDone) {
  const c = current || {};
  modal({
    title: c.id ? `Fiche de ${c.name || nomComplet(c)}` : 'Nouveau membre du personnel',
    icon: c.id ? 'pencil' : 'user-plus',
    subtitle: c.id ? 'Les modifications sont tracées dans le journal d’audit.' : 'Un compte utilisateur peut être créé automatiquement avec un mot de passe temporaire.',
    body: `<form id="sf-form" class="form-grid">
      <div class="grid-2">
        ${field({ label: 'Prénom', name: 'first_name', value: c.first_name || '', required: true })}
        ${field({ label: 'Nom', name: 'last_name', value: c.last_name || '', required: true })}
        ${field({ label: 'Genre', name: 'gender', type: 'select', value: c.gender || 'M', options: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }] })}
        ${field({ label: 'Type de personnel', name: 'staff_type', type: 'select', value: c.staff_type || 'enseignant', required: true, options: dictEntries(TYPES_PERSONNEL).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Fonction / matière', name: 'job_title', value: c.job_title || '', placeholder: 'Professeur de Mathématiques' })}
        ${field({ label: 'Diplôme / qualification', name: 'qualification', value: c.qualification || '', placeholder: 'Master, CAPEN…' })}
        ${field({ label: 'Matricule interne', name: 'matricule', value: c.matricule || '', placeholder: 'ENS-101' })}
        ${field({ label: 'Date de naissance', name: 'birth_date', type: 'date', value: c.birth_date || '' })}
        ${field({ label: 'Téléphone', name: 'phone', type: 'tel', value: c.phone || '', placeholder: '+221 7X XXX XX XX' })}
        ${field({ label: 'Téléphone secondaire', name: 'phone2', type: 'tel', value: c.phone2 || '' })}
        ${field({ label: 'E-mail', name: 'email', type: 'email', value: c.email || '' })}
        ${field({ label: 'Adresse', name: 'address', value: c.address || '' })}
        ${field({ label: 'Ville', name: 'city', value: c.city || '' })}
        ${field({ label: 'N° NINA', name: 'nina', value: c.nina || '', hint: 'Identification nationale' })}
        ${field({ label: 'N° INPE', name: 'inpe', value: c.inpe || '', hint: 'Enseignants (RAFP)' })}
        ${field({ label: 'Date de recrutement', name: 'hired_at', type: 'date', value: c.hired_at || aujourdhui() })}
        ${field({ label: 'Contrat', name: 'contract_type', type: 'select', value: c.contract_type || 'cdi', options: Object.entries(CONTRATS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field({ label: 'Statut', name: 'status', type: 'select', value: c.status || 'active', options: dictEntries(STATUT_STAFF).map((o) => ({ value: o.value, label: o.label })) })}
        ${canBill() ? field({ label: 'Salaire de base', name: 'salary_base', type: 'number', value: c.salary_base || 0, min: 0, suffix: 'FCFA / mois' }) : ''}
        ${canBill() ? field({ label: 'Taux horaire (heures sup.)', name: 'hourly_rate', type: 'number', value: c.hourly_rate || 0, min: 0, suffix: 'FCFA / h' }) : ''}
        ${field({ label: 'Heures hebdomadaires', name: 'weekly_hours', type: 'number', value: c.weekly_hours || 18, min: 0, max: 60 })}
        ${field({ label: 'Banque', name: 'bank_name', value: c.bank_name || '' })}
        ${field({ label: 'Compte bancaire / IBAN', name: 'bank_account', value: c.bank_account || '' })}
        ${field({ label: 'Numéro Mobile Money (paie)', name: 'mobile_money', type: 'tel', value: c.mobile_money || '' })}
      </div>
      ${field({ label: 'Notes internes', name: 'notes', type: 'textarea', rows: 2, value: c.notes || '' })}
      ${c.id ? '' : `<div class="alert alert-info">${icon('key', { size: 16 })}<div class="alert-body">
          <div class="alert-title">Créer le compte utilisateur</div>
          <div class="alert-msg">Avec un e-mail renseigné, un accès est créé (rôle enseignant ou secrétaire) avec le mot de passe temporaire <b>Sunu2026!</b>, à changer à la première connexion.</div></div></div>`}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
      ${c.id && canAdmin() ? `<button class="btn btn-danger" id="sf-del">${icon('trash', { size: 15 })} Supprimer</button>` : ''}
      <span class="grow"></span>
      <button class="btn btn-primary" id="sf-save">${icon('save', { size: 15 })} ${c.id ? 'Enregistrer' : 'Créer la fiche'}</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#sf-save').addEventListener('click', () => withBusy(layer.querySelector('#sf-save'), async () => {
        const payload = readForm(layer.querySelector('#sf-form'), ['salary_base', 'hourly_rate', 'weekly_hours']);
        if (!payload.first_name || !payload.last_name) return toastErr('Champs requis', 'Le nom et le prénom sont obligatoires.');
        try {
          if (c.id) {
            await api.patch(`/people/staff/${c.id}`, payload);
            toastOk('Fiche mise à jour', `${payload.first_name} ${payload.last_name}.`);
          } else {
            await api.post('/people/staff', payload);
            toastOk('Membre créé', payload.email ? 'Le compte utilisateur et le mot de passe temporaire ont été générés.' : 'Fiche enregistrée.');
          }
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
      layer.querySelector('#sf-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({
          title: 'Supprimer cette fiche ?', danger: true, confirmLabel: 'Supprimer',
          message: `La fiche de ${c.name || nomComplet(c)} sera archivée. Les notes saisies, pointages et bulletins de paie sont conservés.`,
        }))) return;
        try {
          await api.del(`/people/staff/${c.id}`);
          toastOk('Fiche supprimée');
          close();
          onDone?.();
        } catch (e) { toastErr('Suppression impossible', e.message); }
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Fiche individuelle                                                  */
/* ------------------------------------------------------------------ */
async function staffDetail(el, id) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement de la fiche…')}</div></div>`;
  try {
    const r = await api.get(`/people/staff/${id}`);
    const d = r.data;
    const s = d.staff || {};
    const stats = d.stats || {};
    const classes = d.classes || [];
    const timetable = d.timetable || [];
    const leaves = d.leaves || [];
    const timesheets = d.timesheets || [];
    const payslips = d.payslips || [];
    const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'apercu';

    el.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="row gap-4 wrap" style="align-items:flex-start">
            <span class="avatar avatar-xl" style="--av:var(--brand)">${esc((s.first_name?.[0] || '') + (s.last_name?.[0] || ''))}</span>
            <div class="grow" style="min-width:220px">
              <div class="row gap-2 wrap" style="align-items:center">
                <h1 class="h-page" style="margin:0">${esc(nomComplet(s))}</h1>
                ${badge(dictLabel(TYPES_PERSONNEL, s.staff_type), dictToneLocal(TYPES_PERSONNEL, s.staff_type))}
                ${badge(dictLabel(STATUT_STAFF, s.status), dictToneLocal(STATUT_STAFF, s.status))}
                ${s.a_un_compte ? badge('Compte actif', 'ok') : badge('Sans compte', 'warn')}
              </div>
              <p class="subtle mt-2">${esc(s.job_title || '')}${s.matricule ? ` · ${esc(s.matricule)}` : ''}${s.login_email ? ` · ${esc(s.login_email)}` : ''}</p>
              <div class="row gap-2 wrap mt-3">
                ${s.phone ? `<a class="btn btn-secondary btn-sm" href="tel:${esc(String(s.phone).replace(/\s/g, ''))}">${icon('phone', { size: 14 })} ${esc(telFr(s.phone))}</a>` : ''}
                ${s.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(s.email)}">${icon('mail', { size: 14 })} E-mail</a>` : ''}
                <button class="btn btn-secondary btn-sm" id="sd-leave">${icon('calendar-plus', { size: 14 })} Demande de congé</button>
                ${canAdmin() ? `<button class="btn btn-secondary btn-sm" id="sd-edit">${icon('pencil', { size: 14 })} Modifier</button>` : ''}
                ${canBill() && s.user_id ? `<button class="btn btn-secondary btn-sm" id="sd-imp">${icon('user-cog', { size: 14 })} Voir le compte</button>` : ''}
              </div>
            </div>
            <div class="grid grid-kpi" style="min-width:260px;flex:1">
              ${kpi('Classes', num(stats.classes ?? classes.length), 'school', 'brand', s.staff_type === 'enseignant' ? `${num(stats.eleves ?? 0)} élèves suivis` : '—')}
              ${kpi('Heures / semaine', num(stats.heures ?? s.weekly_hours ?? 0, 1), 'clock', 'info', 'Charge hebdomadaire')}
              ${canBill() ? kpi('Salaire de base', xof(s.salary_base), 'wallet', 'plum', `${CONTRATS[s.contract_type] || ''} · depuis ${dateFr(s.hired_at)}`) : ''}
              ${kpi('Évaluations', num(stats.evaluations ?? 0), 'pen-tool', 'warn', 'Évaluations créées')}
            </div>
          </div>
        </div>
        <div class="card-body" style="padding-top:0" id="sd-tabs"></div>
        <div class="card-body" id="sd-body">${spinnerNote('Chargement…')}</div>
      </div>`;

    el.querySelector('#sd-leave').addEventListener('click', () => leaveForm({ staff_id: s.id, staff: s }, () => staffDetail(el, id)));
    el.querySelector('#sd-edit')?.addEventListener('click', () => staffForm(s, () => staffDetail(el, id)));
    el.querySelector('#sd-imp')?.addEventListener('click', () => go(`/parametres/utilisateurs?q=${encodeURIComponent(s.login_email || nomComplet(s))}`));

    const body = el.querySelector('#sd-body');
    const paint = (which) => {
      el.querySelector('#sd-tabs').innerHTML = '';
      el.querySelector('#sd-tabs').appendChild(tabs([
        { id: 'apercu', label: 'Aperçu', icon: 'id-card' },
        { id: 'emploi', label: 'Emploi du temps', icon: 'calendar-days', count: timetable.length },
        { id: 'classes', label: 'Classes', icon: 'school', count: classes.length },
        { id: 'conges', label: 'Congés', icon: 'calendar-check', count: leaves.length },
        { id: 'pointage', label: 'Pointage', icon: 'clock', count: timesheets.length },
        ...(canBill() ? [{ id: 'paie', label: 'Paie', icon: 'banknote', count: payslips.length }] : []),
      ], which, { onSelect: (t) => { history.replaceState(null, '', `#/personnel/${id}?tab=${t}`); paint(t); } }));

      if (which === 'apercu') {
        body.innerHTML = `<div class="grid-2">
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('id-card', { size: 15 })} Identité & contrat</h3>
            ${dl([
              ['Matricule', esc(s.matricule || '')], ['Genre', s.gender === 'F' ? 'Féminin' : 'Masculin'],
              ['Naissance', s.birth_date ? `${dateFr(s.birth_date)} (${num(joursEntre(s.birth_date, aujourdhui()) / 365.25, 0)} ans)` : null],
              ['Recruté(e) le', dateFr(s.hired_at)], ['Contrat', esc(CONTRATS[s.contract_type] || s.contract_type || '')],
              ['Heures / semaine', num(s.weekly_hours)], ['Statut', dictLabel(STATUT_STAFF, s.status)],
            ])}
          </div></div>
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('contact-card', { size: 15 })} Coordonnées</h3>
            ${dl([
              ['Téléphone', s.phone ? `<span class="num">${esc(telFr(s.phone))}</span>` : null],
              ['Téléphone 2', s.phone2 ? `<span class="num">${esc(telFr(s.phone2))}</span>` : null],
              ['E-mail', s.email ? esc(s.email) : null], ['Adresse', esc([s.address, s.city].filter(Boolean).join(', '))],
              ['NINA', esc(s.nina || '')], ['INPE', esc(s.inpe || '')],
              ['Mobile Money', s.mobile_money ? `<span class="num">${esc(telFr(s.mobile_money))}</span>` : null],
            ])}
          </div></div>
          ${canBill() ? `<div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('landmark', { size: 15 })} Paie & banque</h3>
            ${dl([
              ['Salaire de base', `<b class="num">${xof(s.salary_base)}</b>`],
              ['Taux horaire', `<span class="num">${xof(s.hourly_rate)}</span>`],
              ['Banque', esc(s.bank_name || '')], ['Compte', `<span class="num">${esc(s.bank_account || '')}</span>`],
              ['Dernier net', payslips[0] ? `<b class="num">${xof(payslips[0].net)}</b>` : null],
            ])}
          </div></div>` : ''}
          <div class="card card-flat"><div class="card-body">
            <h3 class="h-card">${icon('note', { size: 15 })} Notes internes</h3>
            <p class="small" style="white-space:pre-wrap;color:var(--text-2)">${esc(s.notes || 'Aucune note.')}</p>
            ${s.qualification ? `<p class="tiny subtle mt-3">Qualification : ${esc(s.qualification)}</p>` : ''}
          </div></div>
        </div>`;
      } else if (which === 'emploi') {
        body.innerHTML = timetable.length ? timetableGrid(timetable) : emptyState({ icon: 'calendar-days', title: 'Aucun créneau', message: 'Cet agent n’a pas encore de cours dans l’emploi du temps.' });
      } else if (which === 'classes') {
        body.innerHTML = classes.length ? `<div class="grid grid-cards">${classes.map((c) => `<div class="card card-flat">
            <div class="card-body">
              <div class="row gap-2 wrap" style="align-items:center;justify-content:space-between">
                <b>${esc(c.name)}</b>${badge(esc(c.matiere || ''), 'info')}
              </div>
              <p class="tiny subtle mt-2">Niveau ${esc(c.niveau || '')} · coefficient ${num(c.coefficient)} · ${num(c.hours_per_week)} h/semaine</p>
              <a class="link link-strong mt-3" href="#/scolaire/classes/${c.class_id || c.id}">${icon('arrow-right', { size: 13 })} Ouvrir la classe</a>
            </div></div>`).join('')}</div>`
          : emptyState({ icon: 'school', title: 'Aucune classe', message: 'Aucune matière affectée pour le moment.' });
      } else if (which === 'conges') {
        body.innerHTML = leaves.length ? `<div class="list">${leaves.map((x) => `<div class="list-item">
            <span class="li-ico" data-tone="${dictToneLocal(STATUT_CONGE, x.status)}">${icon('calendar-check', { size: 15 })}</span>
            <span class="li-body"><span class="li-title">${esc(dictLabel(TYPES_CONGE, x.leave_type))} — ${num(x.days)} jour(s)</span>
              <span class="li-sub">${dateFr(x.date_from)} → ${dateFr(x.date_to)}${x.reason ? ` · ${esc(x.reason)}` : ''}</span></span>
            <span class="li-aside">${badge(dictLabel(STATUT_CONGE, x.status), dictToneLocal(STATUT_CONGE, x.status))}</span></div>`).join('')}</div>`
          : emptyState({ icon: 'calendar-check', title: 'Aucun congé', message: 'Ce membre n’a pas de demande de congé enregistrée.' });
      } else if (which === 'pointage') {
        body.innerHTML = timesheets.length ? dataTable({
          columns: [
            { key: 'date', label: 'Date', width: '130px', render: (x) => dateFr(x.work_date) },
            { key: 'in', label: 'Arrivée', width: '90px', render: (x) => `<span class="num">${esc(x.check_in || '—')}</span>` },
            { key: 'out', label: 'Départ', width: '90px', render: (x) => `<span class="num">${esc(x.check_out || '—')}</span>` },
            { key: 'hours', label: 'Heures', width: '90px', align: 'right', render: (x) => `<b class="num">${num(x.hours, 1)}</b>` },
            { key: 'status', label: 'Statut', render: (x) => badge(x.status === 'present' ? 'Présent' : x.status === 'retard' ? 'Retard' : x.status === 'absent' ? 'Absent' : x.status, x.status === 'present' ? 'ok' : x.status === 'retard' ? 'warn' : 'danger') },
          ],
          rows: timesheets, dense: true, zebra: true,
        }).outerHTML : emptyState({ icon: 'clock', title: 'Aucun pointage', message: 'Le pointage du personnel apparaîtra ici.' });
      } else if (which === 'paie') {
        body.innerHTML = payslips.length ? dataTable({
          columns: [
            { key: 'mois', label: 'Bulletin', render: (x) => `<b class="small">${esc(x.period || `#${x.run_id}`)}</b>` },
            { key: 'base', label: 'Base', width: '120px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num small">${xof(x.base_salary)}</span>` },
            { key: 'bonus', label: 'Primes', width: '110px', align: 'right', hideBelow: 'lg', render: (x) => `<span class="num small">${xof(x.bonus)}</span>` },
            { key: 'retenues', label: 'Retenues', width: '120px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num small" style="color:var(--danger)">-${xof((x.tax || 0) + (x.social || 0))}</span>` },
            { key: 'net', label: 'Net', width: '130px', align: 'right', render: (x) => `<b class="num">${xof(x.net)}</b>` },
            { key: 'st', label: 'Statut', width: '110px', render: (x) => badge(x.status === 'valide' ? 'Validé' : 'Brouillon', x.status === 'valide' ? 'ok' : 'warn') },
          ],
          rows: payslips, dense: true, zebra: true,
          onRowClick: (x) => payslipModal(x),
        }).outerHTML : emptyState({ icon: 'banknote', title: 'Aucun bulletin', message: 'Générez la paie depuis Finances → Paie du personnel.' });
      }
    };
    paint(tab);
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Fiche indisponible', message: err.message })}</div></div>`;
  }
}

function timetableGrid(slots) {
  const days = [1, 2, 3, 4, 5, 6];
  const hours = [...new Set(slots.map((s) => s.start_time))].sort();
  return `<div class="tt-grid" style="grid-template-columns:74px repeat(${days.length},minmax(120px,1fr))">
    <div class="tt-head tt-time">Horaire</div>
    ${days.map((d) => `<div class="tt-head">${esc(JOURS_COURTS[d] || '')}</div>`).join('')}
    ${hours.map((hh) => `<div class="tt-time num">${esc(hh)}</div>
      ${days.map((d) => {
        const s = slots.find((x) => x.day_of_week === d && x.start_time === hh);
        return s ? `<div class="tt-cell" style="--tt:${s.color || '#0e7c66'}">
            <b>${esc(s.matiere || s.subject || '')}</b>
            <span>${esc(s.classe || '')}</span>
            ${s.room ? `<span class="tiny">${esc(s.room)}</span>` : ''}
          </div>` : '<div class="tt-empty"></div>';
      }).join('')}`).join('')}
  </div>`;
}

function payslipModal(p) {
  let lines = [];
  try { lines = JSON.parse(p.lines_json || '[]'); } catch { /* ignore */ }
  modal({
    title: `Bulletin de paie — ${p.period || `campagne #${p.run_id}`}`, icon: 'banknote', size: 'modal-narrow',
    body: `<div class="list">${(lines.length ? lines : [
      { label: 'Salaire de base', type: 'gain', amount: p.base_salary },
      { label: 'Retenues sociales', type: 'retenue', amount: p.social },
      { label: 'Impôt', type: 'retenue', amount: p.tax },
    ]).map((l) => `<div class="list-item"><span class="li-body">
        <span class="li-title small">${esc(l.label)}</span></span>
      <span class="li-aside num ${l.type === 'retenue' ? 'neg' : 'pos'}">${l.type === 'retenue' ? '-' : ''}${xof(l.amount)}</span></div>`).join('')}</div>
      <div class="receipt-total mt-3"><span>Net à payer</span><b class="num">${xof(p.net)}</b></div>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button><button class="btn btn-primary" onclick="window.print()">${icon('printer', { size: 15 })} Imprimer</button>`,
  });
}

/* ================================================================== */
/* CONGÉS                                                              */
/* ================================================================== */
async function leavesView(el) {
  el.innerHTML = `
    <div class="grid grid-kpi" id="lv-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-head"><h2 class="h-card">${icon('calendar-check', { size: 16 })} Demandes de congé</h2>
        <div class="row gap-2">
          <select class="select select-sm" id="lv-filter"><option value="">Tous les statuts</option>
            ${dictEntries(STATUT_CONGE).map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>
          <button class="btn btn-primary" id="lv-new">${icon('plus', { size: 15 })} Nouvelle demande</button>
        </div></div>
      <div class="card-body" style="padding:0" id="lv-table">${skeletonRows(6, 5)}</div>
    </div>`;
  const t = el.querySelector('#lv-table');
  const load = async () => {
    t.innerHTML = skeletonRows(6, 5);
    try {
      const status = el.querySelector('#lv-filter').value;
      const r = await api.get(`/people/leaves?${status ? `status=${status}&` : ''}limit=100`);
      const rows = r.data || [];
      const attente = rows.filter((x) => x.status === 'en_attente');
      const enCours = rows.filter((x) => x.status === 'approuve' && joursEntre(aujourdhui(), x.date_to) >= 0 && joursEntre(x.date_from, aujourdhui()) >= 0);
      el.querySelector('#lv-kpis').innerHTML = [
        kpi('En attente de validation', num(attente.length), 'hourglass', attente.length ? 'warn' : 'ok', attente.length ? 'À traiter par la direction' : 'Aucune demande en attente'),
        kpi('En congé aujourd’hui', num(enCours.length), 'beach', 'info', enCours.map((x) => `${x.first_name} ${x.last_name}`).slice(0, 3).join(', ')),
        kpi('Jours posés (12 mois)', num(rows.reduce((a, x) => a + (x.days || 0), 0)), 'calendar-days', 'brand', `${num(rows.length)} demande(s) enregistrée(s)`),
      ].join('');
      t.innerHTML = rows.length ? dataTable({
        columns: [
          {
            key: 'qui', label: 'Membre', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.job_title || '')}</div></div></div>`,
          },
          { key: 'type', label: 'Type', width: '150px', render: (x) => badge(dictLabel(TYPES_CONGE, x.leave_type), 'neutral') },
          { key: 'periode', label: 'Période', width: '200px', render: (x) => `<span class="small">${dateFr(x.date_from)} → ${dateFr(x.date_to)}</span><div class="tiny subtle">${num(x.days)} jour(s)</div>` },
          { key: 'motif', label: 'Motif', hideBelow: 'md', render: (x) => `<span class="small">${esc(x.reason || '—')}</span>` },
          { key: 'statut', label: 'Statut', width: '120px', render: (x) => badge(dictLabel(STATUT_CONGE, x.status), dictToneLocal(STATUT_CONGE, x.status)) },
          {
            key: 'act', label: '', width: '190px', align: 'right', render: (x) => (x.status === 'en_attente' && canAdmin()
              ? `<div class="row gap-1" style="justify-content:flex-end">
                  <button class="btn btn-secondary btn-sm" data-refuse="${x.id}">${icon('x', { size: 13 })} Refuser</button>
                  <button class="btn btn-primary btn-sm" data-approve="${x.id}">${icon('check', { size: 13 })} Approuver</button></div>`
              : `<span class="tiny subtle">${x.approved_at ? `traité ${relatif(x.approved_at)}` : ''}</span>`),
          },
        ],
        rows, dense: true, zebra: true,
        onRowClick: (x) => go(`/personnel/${x.staff_id}?tab=conges`),
      }).outerHTML : emptyState({ icon: 'calendar-check', title: 'Aucune demande', message: 'Les congés du personnel apparaîtront ici.' });

      const decide = async (id, status) => {
        if (status === 'refuse' && !(await confirmDialog({ title: 'Refuser ce congé ?', danger: true, confirmLabel: 'Refuser', message: 'Le membre sera notifié et son statut repassera à « actif ».' }))) return;
        try {
          await api.patch(`/people/leaves/${id}`, { status });
          toastOk(status === 'approuve' ? 'Congé approuvé' : 'Congé refusé');
          load();
        } catch (e) { toastErr('Décision impossible', e.message); }
      };
      t.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decide(Number(b.dataset.approve), 'approuve'); }));
      t.querySelectorAll('[data-refuse]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); decide(Number(b.dataset.refuse), 'refuse'); }));
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  };
  el.querySelector('#lv-filter').addEventListener('change', load);
  el.querySelector('#lv-new').addEventListener('click', () => leaveForm({}, load));
  await load();
}

function leaveForm(preset = {}, onDone) {
  modal({
    title: 'Demande de congé', icon: 'calendar-plus', size: 'modal-narrow',
    body: `<form id="lf-form">
      <div id="lf-staff">${preset.staff_id ? '' : spinnerNote('Chargement de l’équipe…')}</div>
      <div class="grid-2">
        ${field({ label: 'Type de congé', name: 'leave_type', type: 'select', value: 'conge_annuel', required: true, options: dictEntries(TYPES_CONGE).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Statut', name: 'status', type: 'select', value: canAdmin() ? 'approuve' : 'en_attente', options: dictEntries(STATUT_CONGE).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Du', name: 'date_from', type: 'date', value: aujourdhui(), required: true })}
        ${field({ label: 'Au', name: 'date_to', type: 'date', value: ajouterJours(aujourdhui(), 3), required: true })}
      </div>
      ${field({ label: 'Motif', name: 'reason', type: 'textarea', rows: 2, placeholder: 'Certificat médical, événement familial…' })}
      <div class="wizard-note" id="lf-days"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="lf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: async (layer, close) => {
      const slot = layer.querySelector('#lf-staff');
      if (!preset.staff_id) {
        try {
          const r = await api.get('/people/staff?status=active');
          slot.innerHTML = field({
            label: 'Membre du personnel', name: 'staff_id', type: 'select', required: true, placeholder: '— Choisir —',
            options: (r.data || []).map((x) => ({ value: x.id, label: `${x.name} — ${x.job_title || dictLabel(TYPES_PERSONNEL, x.staff_type)}` })),
          });
        } catch { slot.innerHTML = emptyState({ icon: 'wifi-off', title: 'Équipe indisponible' }); }
      }
      const paintDays = () => {
        const a = layer.querySelector('[name=date_from]').value;
        const b = layer.querySelector('[name=date_to]').value;
        if (!a || !b) return;
        const n = Math.max(1, joursEntre(a, b) + 1);
        layer.querySelector('#lf-days').textContent = `${n} jour(s) calendaire(s) — du ${dateLong(a)} au ${dateLong(b)}.`;
      };
      layer.querySelectorAll('[name=date_from],[name=date_to]').forEach((i) => i.addEventListener('change', paintDays));
      paintDays();
      layer.querySelector('#lf-go').addEventListener('click', () => withBusy(layer.querySelector('#lf-go'), async () => {
        const payload = readForm(layer.querySelector('#lf-form'), ['staff_id', 'days']);
        payload.staff_id = payload.staff_id || preset.staff_id;
        payload.days = Math.max(1, joursEntre(payload.date_from, payload.date_to || payload.date_from) + 1);
        if (!payload.staff_id) return toastErr('Membre requis');
        try {
          await api.post('/people/leaves', payload);
          toastOk('Demande enregistrée', payload.status === 'approuve' ? 'Le statut du membre passe à « en congé ».' : 'En attente de validation.');
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* FAMILLES / TUTEURS                                                  */
/* ================================================================== */
async function guardiansView(el, query = {}) {
  const f = { q: query.q || '', page: 1, limit: 25 };
  el.innerHTML = `
    <div class="grid grid-kpi" id="gd-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="gd-toolbar"></div>
      <div class="card-body" style="padding:0" id="gd-table">${skeletonRows(8, 5)}</div>
      <div class="card-foot" id="gd-pager"></div>
    </div>`;
  const load = debounce(async () => {
    const t = el.querySelector('#gd-table');
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.q) q.set('q', f.q);
      const r = await api.get(`/people/guardians?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      const avecSolde = rows.filter((x) => (x.solde || 0) > 0);
      el.querySelector('#gd-kpis').innerHTML = [
        kpi('Foyers référencés', num(total), 'contact-card', 'brand', 'Tuteurs et payeurs'),
        kpi('Comptes portail parent', num(rows.filter((x) => x.a_un_compte).length), 'user-check', 'ok', `${num(rows.filter((x) => !x.a_un_compte).length)} sans accès`),
        kpi('SMS activés', num(rows.filter((x) => x.sms_optin).length), 'sms', 'info', 'Consentement recueilli'),
      ].join('');
      el.querySelector('#gd-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Nom du parent, téléphone…',
        actions: avecSolde.length && canBill() ? `<span class="subtle small">${num(avecSolde.length)} foyer(s) avec solde sur cette page</span>` : '',
      });
      el.querySelector('#gd-toolbar').querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300));

      t.innerHTML = dataTable({
        columns: [
          {
            key: 'nom', label: 'Parent / tuteur', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(nomComplet(x))}</div>
              <div class="cell-user-sub">${esc(x.relation || 'tuteur')}${x.profession ? ` · ${esc(x.profession)}` : ''}</div></div></div>`,
          },
          {
            key: 'contact', label: 'Contact', width: '190px', render: (x) => `<span class="num small">${esc(telFr(x.phone) || '—')}</span>
              ${x.phone2 ? `<div class="tiny num subtle">${esc(telFr(x.phone2))}</div>` : ''}${x.email ? `<div class="tiny subtle">${esc(x.email)}</div>` : ''}`,
          },
          { key: 'enfants', label: 'Enfants', width: '200px', render: (x) => `<b class="num small">${num(x.enfants)}</b><div class="tiny subtle">${esc((x.noms_enfants || '').split(',').slice(0, 2).join(', '))}${x.enfants > 2 ? '…' : ''}</div>` },
          { key: 'solde', label: 'Solde dû', width: '130px', align: 'right', hideBelow: 'md', render: (x) => ((x.solde || 0) > 0 ? `<b class="num small" style="color:var(--danger)">${xof(x.solde)}</b>` : badge('À jour', 'ok')) },
          {
            key: 'optin', label: 'Notifications', width: '130px', hideBelow: 'lg', render: (x) => `<div class="row gap-1">
              ${x.sms_optin ? badge('SMS', 'info') : badge('SMS off', 'neutral')}
              ${x.email_optin ? badge('E-mail', 'info') : ''}</div>`,
          },
          { key: 'act', label: '', width: '90px', align: 'right', render: () => `<button class="btn btn-secondary btn-sm" data-open>${icon('arrow-right', { size: 13 })}</button>` },
        ],
        rows, dense: true, zebra: true,
        onRowClick: (x) => guardianDrawer(x.id),
      }).outerHTML;
      t.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); }));

      const pager = el.querySelector('#gd-pager');
      const pages = Math.max(1, Math.ceil(total / f.limit));
      pager.innerHTML = pagination({ page: r.meta?.page || f.page, pages, total, size: f.limit, label: 'foyers' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

async function guardianDrawer(id) {
  const panel = h('<div></div>');
  panel.innerHTML = spinnerNote('Chargement du foyer…');
  drawer({
    title: 'Foyer', wide: true, body: panel,
    footer: `<div class="row gap-2 wrap grow">
      <button class="btn btn-secondary" id="gd-sms">${icon('sms', { size: 15 })} Envoyer un SMS</button>
      <span class="grow"></span>
      <button class="btn btn-primary" id="gd-print">${icon('printer', { size: 15 })} Imprimer</button></div>`,
    onMount: (layer, close) => {
      layer.querySelector('#gd-print').addEventListener('click', () => window.print());
      layer.querySelector('#gd-sms').addEventListener('click', () => {
        const tel = layer.dataset.tel || '';
        close();
        go(`/communication/sms?to=${encodeURIComponent(tel)}`);
      });
      load();
    },
  });
  async function load() {
    try {
      const r = await api.get(`/people/guardians/${id}`);
      const g = r.data.guardian || {};
      const children = r.data.children || [];
      const paiements = r.data.paiements || [];
      panel.className = 'print-area';
      panel.innerHTML = `
        <div class="row gap-3 wrap" style="align-items:center">
          ${avatar({ first: g.first_name, last: g.last_name, size: 'avatar-lg' })}
          <div class="grow"><h2 class="h-card" style="margin:0">${esc(nomComplet(g))}</h2>
            <p class="subtle small">${esc(g.relation || 'tuteur')}${g.profession ? ` · ${esc(g.profession)}${g.employer ? ` (${esc(g.employer)})` : ''}` : ''}</p></div>
          ${g.a_un_compte ? badge('Portail parent', 'ok') : badge('Sans compte', 'warn')}
        </div>
        ${dl([
          ['Téléphone', `<span class="num">${esc(telFr(g.phone) || '—')}</span>`],
          ['Téléphone 2', g.phone2 ? `<span class="num">${esc(telFr(g.phone2))}</span>` : null],
          ['WhatsApp', g.whatsapp ? `<span class="num">${esc(telFr(g.whatsapp))}</span>` : null],
          ['E-mail', esc(g.email || '')], ['Adresse', esc([g.address, g.city].filter(Boolean).join(', '))],
          ['Notifications', `${g.sms_optin ? 'SMS ✓' : 'SMS ✗'} · ${g.email_optin ? 'E-mail ✓' : 'E-mail ✗'}`],
        ])}
        <h3 class="h-card mt-4">${icon('users', { size: 15 })} Enfants scolarisés (${children.length})</h3>
        ${children.length ? `<div class="list">${children.map((c) => `<div class="list-item">
            <span class="li-ico" data-tone="${c.gender === 'F' ? 'm' : 'brand'}">${icon('user', { size: 15 })}</span>
            <span class="li-body"><span class="li-title">${esc(c.first_name)} ${esc(c.last_name)}</span>
              <span class="li-sub">${esc(c.classe || '')} · ${esc(c.matricule || '')} · ${esc(c.relation || '')}${c.is_payer ? ' · payeur' : ''}</span></span>
            <span class="li-aside">${(c.solde || 0) > 0 ? `<b class="num small" style="color:var(--danger)">${xof(c.solde)}</b>` : badge('À jour', 'ok')}
              <a class="btn btn-link btn-sm" href="#/scolaire/eleves/${c.id}">Fiche</a></span></div>`).join('')}</div>`
          : emptyState({ icon: 'users', title: 'Aucun enfant rattaché' })}
        <h3 class="h-card mt-4">${icon('banknote', { size: 15 })} Derniers paiements</h3>
        ${paiements.length ? `<div class="list">${paiements.slice(0, 8).map((p) => `<div class="list-item">
            <span class="li-ico" data-tone="ok">${icon('banknote', { size: 15 })}</span>
            <span class="li-body"><span class="li-title">${xof(p.amount)}</span>
              <span class="li-sub">${dateFr(p.paid_at)} ${heureFr(p.paid_at)} · ${esc(p.receipt_number || '')}</span></span>
            <span class="li-aside"><a class="btn btn-link btn-sm" href="#/finance/paiements/${p.id}/recu">Reçu</a></span></div>`).join('')}</div>`
          : '<p class="subtle small">Aucun paiement enregistré.</p>'}`;
      const drawerEl = panel.closest('.drawer') || document;
      drawerEl.dataset.tel = g.phone || '';
    } catch (err) {
      panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }
}

/* ================================================================== */
/* BIBLIOTHÈQUE                                                        */
/* ================================================================== */
async function libraryView(el, query = {}) {
  const tab = query.tab || 'catalogue';
  el.innerHTML = `
    <div id="lb-tabs" class="mb-4"></div>
    <div id="lb-body">${spinnerNote('Chargement…')}</div>`;
  const paint = (which) => {
    el.querySelector('#lb-tabs').innerHTML = '';
    el.querySelector('#lb-tabs').appendChild(tabs([
      { id: 'catalogue', label: 'Catalogue', icon: 'library' },
      { id: 'prets', label: 'Prêts en cours', icon: 'book-open' },
    ], which, { onSelect: (t) => go(`/services/bibliotheque?tab=${t}`, { replace: true }) }));
    el.querySelector('#lb-body').innerHTML = '';
    if (which === 'catalogue') catalogue(el.querySelector('#lb-body'));
    else loans(el.querySelector('#lb-body'));
  };
  paint(tab);
}

async function catalogue(host) {
  const f = { q: '', category: '', page: 1, limit: 30 };
  host.innerHTML = `<div class="grid grid-kpi" id="bk-kpis"></div>
    <div class="card mt-4"><div class="card-body" id="bk-toolbar"></div>
      <div class="card-body" style="padding:0" id="bk-table">${skeletonRows(8, 5)}</div>
      <div class="card-foot" id="bk-pager"></div></div>`;
  const load = debounce(async () => {
    const t = host.querySelector('#bk-table');
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.q) q.set('q', f.q);
      if (f.category) q.set('category', f.category);
      const r = await api.get(`/people/library/books?${q}`);
      const rows = r.data || [];
      const cats = r.categories || [];
      const total = r.meta?.total || rows.length;
      const exemplaires = rows.reduce((a, x) => a + (x.copies || 0), 0);
      const dispo = rows.reduce((a, x) => a + (x.available || 0), 0);
      host.querySelector('#bk-kpis').innerHTML = [
        kpi('Titres au catalogue', num(total), 'library', 'brand', `${num(exemplaires)} exemplaire(s)`),
        kpi('Disponibles', num(dispo), 'book-open', dispo ? 'ok' : 'warn', exemplaires ? pct(Math.round((dispo / exemplaires) * 100)) : ''),
        kpi('Catégories', num(cats.length), 'tags', 'info', cats.slice(0, 3).map((c) => c.category).join(', ')),
      ].join('');
      host.querySelector('#bk-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Titre, auteur, ISBN…',
        filters: `<select class="select select-sm" data-f="category"><option value="">Toutes catégories</option>
          ${cats.map((c) => `<option value="${esc(c.category)}" ${f.category === c.category ? 'selected' : ''}>${esc(c.category)} (${c.n})</option>`).join('')}</select>`,
        actions: store.atLeast(45) ? `<button class="btn btn-primary" id="bk-add">${icon('plus', { size: 15 })} Ajouter un titre</button>` : '',
      });
      const tb = host.querySelector('#bk-toolbar');
      tb.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300));
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#bk-add')?.addEventListener('click', () => bookForm(load));

      t.innerHTML = dataTable({
        columns: [
          {
            key: 'titre', label: 'Titre', render: (x) => `<b class="small">${esc(x.title)}</b>
              <div class="tiny subtle">${esc(x.author || 'Auteur inconnu')}${x.isbn ? ` · ISBN ${esc(x.isbn)}` : ''}</div>`,
          },
          { key: 'cat', label: 'Catégorie', width: '130px', render: (x) => badge(x.category || 'Divers', 'neutral') },
          { key: 'rayon', label: 'Rayon', width: '90px', hideBelow: 'lg', render: (x) => `<span class="num small">${esc(x.shelf || '—')}</span>` },
          {
            key: 'dispo', label: 'Disponibilité', width: '170px', render: (x) => `${progress(Math.round(((x.available || 0) / Math.max(1, x.copies || 1)) * 100), x.available ? 'ok' : 'danger')}
              <span class="tiny num">${num(x.available)} / ${num(x.copies)} exemplaire(s)</span>`,
          },
          { key: 'pret', label: 'Durée', width: '90px', align: 'center', hideBelow: 'md', render: (x) => `${num(x.loan_days)} j` },
          {
            key: 'act', label: '', width: '150px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              ${store.atLeast(45) ? `<button class="btn btn-primary btn-sm" data-loan="${x.id}" ${x.available ? '' : 'disabled'}>${icon('book-open', { size: 13 })} Prêter</button>` : ''}
              ${store.atLeast(45) ? `<button class="btn btn-secondary btn-sm" data-edit="${x.id}">${icon('pencil', { size: 13 })}</button>` : ''}</div>`,
          },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'library', title: 'Catalogue vide', message: 'Ajoutez vos premiers titres pour démarrer les prêts.' },
      }).outerHTML;
      t.querySelectorAll('[data-loan]').forEach((b) => b.addEventListener('click', () => loanForm(Number(b.dataset.loan), rows.find((x) => String(x.id) === b.dataset.loan), load)));
      t.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => bookForm(load, rows.find((x) => String(x.id) === b.dataset.edit))));

      const pager = host.querySelector('#bk-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'titres' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

function bookForm(onDone, current) {
  const c = current || {};
  modal({
    title: c.id ? `Modifier « ${c.title} »` : 'Ajouter un titre', icon: 'library', size: 'modal-narrow',
    body: `<form id="bf-form"><div class="grid-2">
        ${field({ label: 'Titre', name: 'title', value: c.title || '', required: true })}
        ${field({ label: 'Auteur', name: 'author', value: c.author || '' })}
        ${field({ label: 'ISBN', name: 'isbn', value: c.isbn || '' })}
        ${field({ label: 'Catégorie', name: 'category', value: c.category || 'Roman', placeholder: 'Roman, Manuel, BD…' })}
        ${field({ label: 'Éditeur', name: 'publisher', value: c.publisher || '' })}
        ${field({ label: 'Année', name: 'publish_year', type: 'number', value: c.publish_year || '', min: 1800, max: 2100 })}
        ${field({ label: 'Exemplaires', name: 'copies', type: 'number', value: c.copies || 1, min: 1 })}
        ${field({ label: 'Rayon', name: 'shelf', value: c.shelf || '', placeholder: 'A-3' })}
        ${field({ label: 'Durée de prêt (jours)', name: 'loan_days', type: 'number', value: c.loan_days || 14, min: 1, max: 90 })}
      </div></form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="bf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#bf-go').addEventListener('click', () => withBusy(layer.querySelector('#bf-go'), async () => {
        const payload = readForm(layer.querySelector('#bf-form'), ['copies', 'loan_days', 'publish_year']);
        if (!payload.title) return toastErr('Titre requis');
        try {
          await api.post('/people/library/books', payload);
          toastOk(c.id ? 'Titre mis à jour' : 'Titre ajouté', `${payload.copies || 1} exemplaire(s).`);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

async function loans(host) {
  const f = { status: 'en_cours', page: 1, limit: 30 };
  host.innerHTML = `<div class="card"><div class="card-head"><h2 class="h-card">${icon('book-open', { size: 16 })} Prêts</h2>
      <div class="row gap-2">
        <select class="select select-sm" id="ln-filter">
          <option value="en_cours">En cours</option><option value="en_retard">En retard</option><option value="rendu">Rendus</option><option value="">Tous</option></select>
        <button class="btn btn-primary" id="ln-new">${icon('plus', { size: 15 })} Nouveau prêt</button>
      </div></div>
    <div class="card-body" style="padding:0" id="ln-table">${skeletonRows(8, 5)}</div>
    <div class="card-foot" id="ln-pager"></div></div>`;
  const t = host.querySelector('#ln-table');
  const load = async () => {
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.status) q.set('status', f.status);
      const r = await api.get(`/people/library/loans?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      t.innerHTML = dataTable({
        columns: [
          { key: 'livre', label: 'Ouvrage', render: (x) => `<b class="small">${esc(x.title)}</b><div class="tiny subtle">${esc(x.author || '')}</div>` },
          {
            key: 'eleve', label: 'Emprunteur', width: '200px', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-xs' })}
              <div><div class="cell-user-name small">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')}</div></div></div>`,
          },
          { key: 'pret', label: 'Prêté le', width: '110px', render: (x) => dateFr(x.loaned_at) },
          {
            key: 'echeance', label: 'À rendre', width: '150px', render: (x) => `<span class="small">${dateFr(x.due_at)}</span>
              ${x.status !== 'rendu' ? `<div class="tiny ${joursEntre(aujourdhui(), x.due_at) < 0 ? 'neg' : 'subtle'}">${joursEntre(aujourdhui(), x.due_at) < 0 ? `${Math.abs(joursEntre(aujourdhui(), x.due_at))} j de retard` : `dans ${joursEntre(aujourdhui(), x.due_at)} j`}</div>` : ''}`,
          },
          { key: 'statut', label: 'Statut', width: '110px', render: (x) => badge(dictLabel(STATUT_PRET, x.status), dictToneLocal(STATUT_PRET, x.status)) },
          {
            key: 'act', label: '', width: '170px', align: 'right', render: (x) => (x.status === 'rendu'
              ? `<span class="tiny subtle">rendu ${relatif(x.returned_at)}${x.fine ? ` · amende ${xof(x.fine)}` : ''}</span>`
              : `<button class="btn btn-primary btn-sm" data-return="${x.id}">${icon('check-circle', { size: 13 })} Retour</button>`),
          },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'book-open', title: 'Aucun prêt', message: 'Les prêts apparaîtront ici.' },
      }).outerHTML;
      t.querySelectorAll('[data-return]').forEach((b) => b.addEventListener('click', () => returnForm(Number(b.dataset.return), load)));
      const pager = host.querySelector('#ln-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'prêts' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  };
  host.querySelector('#ln-filter').addEventListener('change', (e) => { f.status = e.target.value; f.page = 1; load(); });
  host.querySelector('#ln-new').addEventListener('click', () => loanForm(null, null, load));
  await load();
}

function loanForm(bookId, book, onDone) {
  modal({
    title: book ? `Prêter « ${book.title} »` : 'Nouveau prêt', icon: 'book-open', size: 'modal-narrow',
    body: `<form id="lo-form">
      <div id="lo-book">${book ? `<div class="alert alert-brand" style="margin-bottom:12px">${icon('library', { size: 16 })}<div class="alert-body">
          <div class="alert-msg">${esc(book.title)} — ${esc(book.author || '')} · ${num(book.available)} exemplaire(s) disponible(s)</div></div></div>` : spinnerNote('Chargement du catalogue…')}</div>
      <div id="lo-student">${field({ label: 'Élève', name: 'student_query', placeholder: 'Tapez au moins 2 lettres…', hint: 'Recherche par nom ou matricule.' })}
        <div id="lo-results" class="mt-2"></div>
        <input type="hidden" name="student_id" id="lo-sid">
      </div>
      ${field({ label: 'Durée du prêt (jours)', name: 'loan_days', type: 'number', value: book?.loan_days || 14, min: 1, max: 90 })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="lo-go" disabled>${icon('check', { size: 15 })} Valider le prêt</button>`,
    onMount: async (layer, close) => {
      let chosenBook = bookId;
      const results = layer.querySelector('#lo-results');
      const sid = layer.querySelector('#lo-sid');
      const goBtn = layer.querySelector('#lo-go');
      const refresh = () => { goBtn.disabled = !(chosenBook && sid.value); };

      if (!book) {
        const r = await api.get('/people/library/books?limit=200').catch(() => ({ data: [] }));
        layer.querySelector('#lo-book').innerHTML = field({
          label: 'Ouvrage', name: 'book_id', type: 'select', required: true, placeholder: '— Choisir un titre —',
          options: (r.data || []).filter((x) => x.available > 0).map((x) => ({ value: x.id, label: `${x.title} — ${x.author || ''} (${x.available} dispo.)` })),
        });
        layer.querySelector('[name=book_id]').addEventListener('change', (e) => { chosenBook = Number(e.target.value) || null; refresh(); });
      }

      layer.querySelector('[name=student_query]').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        if (term.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = spinnerNote('Recherche…');
        const list = await searchStudents(term);
        results.innerHTML = list.length ? `<div class="list">${list.map((x) => `<div class="list-item clickable" data-sid="${x.id}">
            <span class="li-ico">${icon('user', { size: 14 })}</span>
            <span class="li-body"><span class="li-title small">${esc(x.first_name)} ${esc(x.last_name)}</span>
              <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</span></span></div>`).join('')}</div>`
          : '<p class="subtle small">Aucun élève trouvé.</p>';
        results.querySelectorAll('[data-sid]').forEach((li) => li.addEventListener('click', () => {
          sid.value = li.dataset.sid;
          layer.querySelector('[name=student_query]').value = li.querySelector('.li-title').textContent;
          results.innerHTML = `<div class="alert alert-ok" style="margin:0">${icon('check-circle', { size: 15 })}<div class="alert-body"><div class="alert-msg">Élève sélectionné.</div></div></div>`;
          refresh();
        }));
      }, 280));

      goBtn.addEventListener('click', () => withBusy(goBtn, async () => {
        const payload = readForm(layer.querySelector('#lo-form'), ['loan_days', 'student_id', 'book_id']);
        const bid = chosenBook || Number(payload.book_id) || null;
        if (!bid || !payload.student_id) return toastErr('Prêt incomplet', 'Choisissez un ouvrage et un élève.');
        try {
          const r = await api.post('/people/library/loans', { book_id: bid, student_id: Number(payload.student_id), loan_days: Number(payload.loan_days) || 14 });
          toastOk('Prêt enregistré', `À rendre le ${dateFr(r.data?.due_at || ajouterJours(aujourdhui(), Number(payload.loan_days) || 14))}.`);
          close();
          onDone?.();
        } catch (e) { toastErr('Prêt impossible', e.message); }
      }));
    },
  });
}

function returnForm(loanId, onDone) {
  modal({
    title: 'Retour d’ouvrage', icon: 'book-open', size: 'modal-narrow',
    body: `<form id="rt-form">
      ${field({ label: 'Amende de retard', name: 'fine', type: 'number', value: 0, min: 0, suffix: 'FCFA', hint: 'Appliquée si l’ouvrage est rendu après l’échéance.' })}
      ${field({ label: 'État de l’ouvrage', name: 'note', type: 'select', value: 'bon', options: [
        { value: 'bon', label: 'Bon état' }, { value: 'abime', label: 'Abîmé' }, { value: 'perdu', label: 'Perdu / non rendu' }] })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="rt-go">${icon('check-circle', { size: 15 })} Confirmer le retour</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#rt-go').addEventListener('click', () => withBusy(layer.querySelector('#rt-go'), async () => {
        const payload = readForm(layer.querySelector('#rt-form'), ['fine']);
        try {
          const r = await api.post(`/people/library/loans/${loanId}/return`, payload);
          toastOk('Retour enregistré', r.data?.late_days ? `${r.data.late_days} jour(s) de retard · amende ${xof(r.data?.fine || 0)}.` : 'Aucun retard constaté.');
          close();
          onDone?.();
        } catch (e) { toastErr('Retour impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* CANTINE                                                             */
/* ================================================================== */
async function canteenView(el, query = {}) {
  const date = query.date || aujourdhui();
  el.innerHTML = `
    <div class="card">
      <div class="card-head"><h2 class="h-card">${icon('utensils', { size: 16 })} Pointage cantine — ${dateLong(date)}</h2>
        <div class="row gap-2">
          <input type="date" class="input input-sm" id="ct-date" value="${esc(date)}" max="${aujourdhui()}">
          <button class="btn btn-secondary btn-sm" id="ct-all">${icon('check-check', { size: 14 })} Tout présent</button>
          <button class="btn btn-primary btn-sm" id="ct-save">${icon('save', { size: 14 })} Enregistrer</button>
        </div></div>
      <div class="card-body">
        <div class="grid grid-kpi" id="ct-kpis"></div>
        <div class="grid-2 mt-4">
          <div>${field({ label: 'Menu du jour', name: 'menu', id: 'ct-menu', placeholder: 'Thieboudienne + fruit' })}</div>
          <div>${field({ label: 'Repas', name: 'meal_type', type: 'select', value: 'dejeuner', options: Object.entries(REPAS).map(([v, l]) => ({ value: v, label: l })) })}</div>
        </div>
      </div>
      <div class="card-body" style="padding:0" id="ct-table">${skeletonRows(8, 4)}</div>
    </div>
    <div class="card mt-4"><div class="card-body" id="ct-histo"></div></div>`;

  const state = { date, rows: [], menu: '' };
  const load = async () => {
    const t = el.querySelector('#ct-table');
    t.innerHTML = skeletonRows(8, 4);
    try {
      const r = await api.get(`/people/canteen?date=${state.date}`);
      const d = r.data || {};
      state.rows = (d.inscrits || []).map((x) => ({ ...x, present: x.present == null ? 1 : x.present }));
      state.menu = d.inscrits?.find((x) => x.menu)?.menu || '';
      el.querySelector('#ct-menu').value = state.menu;
      const presents = state.rows.filter((x) => x.present).length;
      el.querySelector('#ct-kpis').innerHTML = [
        kpi('Inscrits à la cantine', num(state.rows.length), 'utensils', 'brand', 'Élèves abonnés au service'),
        kpi('Présents aujourd’hui', num(presents), 'check-circle', 'ok', `${presents ? pct(Math.round((presents / Math.max(1, state.rows.length)) * 100)) : '—'} de fréquentation`),
        kpi('Repas à prévoir', num(presents), 'chef-hat', 'warn', 'À transmettre à la cuisine'),
      ].join('');
      el.querySelector('#ct-histo').innerHTML = (d.historique || []).length
        ? `<h3 class="h-card">${icon('chart', { size: 15 })} Fréquentation des 14 derniers jours</h3>
           <div id="ct-chart"></div>
           <div class="list mt-3">${(d.historique || []).slice(0, 5).map((x) => `<div class="list-item">
             <span class="li-ico">${icon('utensils', { size: 14 })}</span>
             <span class="li-body"><span class="li-title small">${dateFr(x.date)}</span><span class="li-sub">${esc(x.menu || 'Menu non renseigné')}</span></span>
             <span class="li-aside"><b class="num small">${num(x.n)}</b> repas</span></div>`).join('')}</div>`
        : emptyState({ icon: 'chart', title: 'Pas d’historique', message: 'Enregistrez vos premiers pointages pour voir la fréquentation.' });
      if ((d.historique || []).length) {
        el.querySelector('#ct-chart')?.appendChild(barChart(
          d.historique.slice().reverse().map((x) => ({ label: dateFr(x.date).slice(0, 5), value: x.n })),
          { height: 170, color: '#0e7c66' }
        ));
      }
      paintTable();
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  };
  const paintTable = () => {
    const t = el.querySelector('#ct-table');
    if (!state.rows.length) {
      t.innerHTML = emptyState({ icon: 'utensils', title: 'Aucun élève inscrit', message: 'Activez l’option cantine sur les fiches élèves (Scolarité → Élèves).' });
      return;
    }
    t.innerHTML = dataTable({
      columns: [
        {
          key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
            <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')}</div></div></div>`,
        },
        {
          key: 'present', label: 'Présent au réfectoire', width: '150px', align: 'center', render: (x) => `<div class="roll-actions" data-id="${x.id}" style="justify-content:center">
            <button type="button" class="roll-btn" data-k="present" data-v="1" data-on="${x.present ? 1 : 0}" title="Présent (1)" aria-pressed="${!!x.present}">${icon('check', { size: 14 })}</button>
            <button type="button" class="roll-btn" data-k="absent" data-v="0" data-on="${x.present ? 0 : 1}" title="Absent (2)" aria-pressed="${!x.present}">${icon('x', { size: 14 })}</button></div>`,
        },
        { key: 'menu', label: 'Menu servi', width: '220px', hideBelow: 'md', render: (x) => `<span class="small subtle">${esc(x.menu || state.menu || '—')}</span>` },
      ],
      rows: state.rows, dense: true, zebra: true,
    }).outerHTML;
    t.querySelectorAll('.roll-actions[data-id]').forEach((box) => {
      box.querySelectorAll('.roll-btn').forEach((b) => b.addEventListener('click', () => {
        const id = Number(box.dataset.id);
        const row = state.rows.find((x) => x.id === id);
        if (row) row.present = Number(b.dataset.v);
        box.querySelectorAll('.roll-btn').forEach((o) => {
          o.dataset.on = o === b ? '1' : '0';
          o.setAttribute('aria-pressed', String(o === b));
        });
      }));
    });
  };
  el.querySelector('#ct-date').addEventListener('change', (e) => { state.date = e.target.value || aujourdhui(); go(`/services/cantine?date=${state.date}`, { replace: true }); load(); });
  el.querySelector('#ct-all').addEventListener('click', () => { state.rows.forEach((x) => { x.present = 1; }); paintTable(); toastInfo('Tous marqués présents', 'Pensez à enregistrer.'); });
  el.querySelector('#ct-save').addEventListener('click', () => withBusy(el.querySelector('#ct-save'), async () => {
    const menu = el.querySelector('#ct-menu').value.trim();
    const meal_type = el.querySelector('[name=meal_type]').value;
    try {
      const r = await api.post('/people/canteen/pointage', {
        date: state.date,
        records: state.rows.map((x) => ({ student_id: x.id, present: x.present, menu: menu || null, meal_type })),
      });
      toastOk('Pointage enregistré', `${num(r.data?.saved ?? state.rows.length)} repas du ${dateFr(state.date)} · ${num(state.rows.filter((x) => x.present).length)} présent(s).`);
      load();
    } catch (e) { toastErr('Enregistrement impossible', e.message); }
  }));
  await load();
}

/* ================================================================== */
/* TRANSPORT                                                           */
/* ================================================================== */
async function transportView(el) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement des lignes…')}</div></div>`;
  try {
    const r = await api.get('/people/transport');
    const routes = r.data?.routes || [];
    const students = r.data?.students || [];
    const abonnes = students.length;
    const capacite = routes.reduce((a, x) => a + (x.capacity || 0), 0);
    const revenu = routes.reduce((a, x) => a + (x.monthly_fee || 0) * (x.abonnes || 0), 0);

    el.innerHTML = `
      <div class="grid grid-kpi">
        ${kpi('Lignes actives', num(routes.filter((x) => x.is_active).length), 'bus', 'brand', `${num(routes.length)} ligne(s) créée(s)`)}
        ${kpi('Élèves transportés', num(abonnes), 'users', 'info', capacite ? `${pct(Math.round((abonnes / capacite) * 100))} de la capacité` : '')}
        ${kpi('Capacité totale', num(capacite), 'seat', 'neutral', `${num(routes.length)} véhicule(s)`)}
        ${kpi('Revenu mensuel', xof(revenu), 'wallet', 'ok', 'Abonnements transport')}
      </div>
      <div class="row gap-2 wrap mt-4 mb-4" style="justify-content:flex-end">
        ${canAdmin() ? `<button class="btn btn-secondary" id="tr-assign">${icon('user-plus', { size: 15 })} Affecter des élèves</button>` : ''}
        ${canAdmin() ? `<button class="btn btn-primary" id="tr-new">${icon('plus', { size: 15 })} Nouvelle ligne</button>` : ''}
      </div>
      <div class="grid grid-2">
        ${routes.map((rt) => `<div class="card card-flat">
          <div class="card-head"><h3 class="h-card" style="margin:0">${icon('bus', { size: 15 })} ${esc(rt.name)}</h3>
            ${rt.is_active ? badge('Active', 'ok') : badge('Suspendue', 'neutral')}</div>
          <div class="card-body">
            <div class="row gap-3 wrap mb-3">
              <div><div class="tiny subtle">Chauffeur</div><b class="small">${esc(rt.driver_name || '—')}</b></div>
              <div><div class="tiny subtle">Immatriculation</div><b class="small num">${esc(rt.plate || '—')}</b></div>
              <div><div class="tiny subtle">Départ</div><b class="small num">${esc(rt.departure || '—')}</b></div>
              <div><div class="tiny subtle">Abonnement</div><b class="small num">${xof(rt.monthly_fee)}</b></div>
            </div>
            ${rt.driver_phone ? `<a class="btn btn-secondary btn-sm" href="tel:${esc(String(rt.driver_phone).replace(/\s/g, ''))}">${icon('phone', { size: 13 })} ${esc(telFr(rt.driver_phone))}</a>` : ''}
            <div class="mt-3">${progress(Math.round(((rt.abonnes || 0) / Math.max(1, rt.capacity || 1)) * 100), rt.abonnes >= rt.capacity ? 'danger' : 'ok')}
              <span class="tiny num">${num(rt.abonnes)} / ${num(rt.capacity)} places</span></div>
            <h4 class="h-card mt-4">${icon('map-pin', { size: 14 })} Arrêts</h4>
            ${(rt.stops || []).length ? `<ol class="stops-list">${rt.stops.map((s) => `<li><b class="num small">${esc(s.time || '')}</b> ${esc(s.name)}</li>`).join('')}</ol>`
              : '<p class="subtle small">Aucun arrêt défini.</p>'}
            ${canAdmin() ? `<div class="row gap-2 mt-4"><button class="btn btn-secondary btn-sm" data-edit="${rt.id}">${icon('pencil', { size: 13 })} Modifier</button>
              <button class="btn btn-secondary btn-sm" data-list="${rt.id}">${icon('users', { size: 13 })} Élèves (${num(rt.abonnes)})</button></div>` : ''}
          </div></div>`).join('') || `<div class="card card-flat"><div class="card-body">${emptyState({ icon: 'bus', title: 'Aucune ligne', message: 'Créez votre première ligne de transport scolaire.' })}</div></div>`}
      </div>
      ${abonnes ? `<div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('users', { size: 16 })} Élèves abonnés</h3></div>
        <div class="card-body" style="padding:0">${dataTable({
          columns: [
            { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-xs' })}<div><div class="cell-user-name small">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')}</div></div></div>` },
            { key: 'ligne', label: 'Ligne', render: (x) => badge(x.ligne || 'Non affecté', x.ligne ? 'info' : 'warn') },
            { key: 'act', label: '', width: '120px', align: 'right', render: (x) => `<a class="btn btn-link btn-sm" href="#/scolaire/eleves/${x.id}">Fiche élève</a>` },
          ],
          rows: students.slice(0, 50), dense: true, zebra: true,
        }).outerHTML}</div>
        ${students.length > 50 ? `<div class="card-foot subtle small">${num(students.length - 50)} autre(s) élève(s) — utilisez la recherche Élèves.</div>` : ''}</div>` : ''}`;

    el.querySelector('#tr-new')?.addEventListener('click', () => routeForm(null, transportView.bind(null, el)));
    el.querySelector('#tr-assign')?.addEventListener('click', () => assignForm(routes, transportView.bind(null, el)));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => routeForm(routes.find((x) => String(x.id) === b.dataset.edit), transportView.bind(null, el))));
    el.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => {
      const rt = routes.find((x) => String(x.id) === b.dataset.list);
      const list = students.filter((x) => x.route_id === rt.id);
      modal({
        title: `${rt.name} — ${list.length} élève(s)`, icon: 'users', size: 'modal-narrow',
        body: list.length ? `<div class="list">${list.map((x) => `<div class="list-item"><span class="li-ico">${icon('user', { size: 14 })}</span>
            <span class="li-body"><span class="li-title small">${esc(x.first_name)} ${esc(x.last_name)}</span><span class="li-sub">${esc(x.classe || '')}</span></span>
            <span class="li-aside"><a class="btn btn-link btn-sm" href="#/scolaire/eleves/${x.id}">Fiche</a></span></div>`).join('')}</div>`
          : emptyState({ icon: 'users', title: 'Aucun élève', message: 'Affectez des élèves à cette ligne.' }),
        footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>`,
      });
    }));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message })}</div></div>`;
  }
}

function routeForm(current, onDone) {
  const c = current || {};
  const stops = c.stops || [];
  modal({
    title: c.id ? `Modifier ${c.name}` : 'Nouvelle ligne de transport', icon: 'bus',
    body: `<form id="rt-form">
      ${field({ label: 'Nom de la ligne', name: 'name', value: c.name || '', required: true, placeholder: 'Ligne 1 — Pikine / Guédiawaye' })}
      <div class="grid-2">
        ${field({ label: 'Chauffeur', name: 'driver_name', value: c.driver_name || '' })}
        ${field({ label: 'Téléphone chauffeur', name: 'driver_phone', type: 'tel', value: c.driver_phone || '' })}
        ${field({ label: 'Immatriculation', name: 'plate', value: c.plate || '', placeholder: 'DK-1234-A' })}
        ${field({ label: 'Capacité (places)', name: 'capacity', type: 'number', value: c.capacity || 30, min: 1 })}
        ${field({ label: 'Heure de départ', name: 'departure', type: 'time', value: c.departure || '06:40' })}
        ${field({ label: 'Abonnement mensuel', name: 'monthly_fee', type: 'number', value: c.monthly_fee || 0, min: 0, suffix: 'FCFA' })}
      </div>
      <div class="wizard-step mt-3">
        <div class="wizard-head"><span>Arrêts de la ligne</span><button type="button" id="rt-add-stop">${icon('plus', { size: 13 })} Ajouter</button></div>
        <div id="rt-stops"></div>
        <p class="wizard-note">Les arrêts sont affichés aux parents dans le portail et servent à la feuille de route du chauffeur.</p>
      </div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="rt-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      const box = layer.querySelector('#rt-stops');
      const list = stops.map((s) => ({ ...s }));
      const paint = () => {
        box.innerHTML = list.length ? list.map((s, i) => `<div class="row gap-2 mt-2" data-i="${i}">
            <input class="input input-sm" style="flex:2" value="${esc(s.name || '')}" data-k="name" placeholder="Nom de l'arrêt">
            <input class="input input-sm num" style="flex:1" type="time" value="${esc(s.time || '')}" data-k="time">
            <button type="button" class="btn btn-secondary btn-sm" data-del="${i}" aria-label="Retirer">${icon('trash', { size: 13 })}</button></div>`).join('')
          : '<p class="subtle small">Aucun arrêt — ajoutez-en pour informer les familles.</p>';
        box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
          const i = Number(inp.closest('[data-i]').dataset.i);
          list[i][inp.dataset.k] = inp.value;
        }));
        box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { list.splice(Number(b.dataset.del), 1); paint(); }));
      };
      layer.querySelector('#rt-add-stop').addEventListener('click', () => { list.push({ name: '', time: '07:00', order: list.length + 1 }); paint(); });
      paint();
      layer.querySelector('#rt-go').addEventListener('click', () => withBusy(layer.querySelector('#rt-go'), async () => {
        const payload = readForm(layer.querySelector('#rt-form'), ['capacity', 'monthly_fee', 'id']);
        if (!payload.name) return toastErr('Nom requis');
        payload.stops = list.filter((s) => s.name).map((s, i) => ({ ...s, order: i + 1 }));
        if (c.id) payload.id = c.id;
        try {
          await api.post('/people/transport', payload);
          toastOk(c.id ? 'Ligne mise à jour' : 'Ligne créée', `${payload.stops.length} arrêt(s) · capacité ${payload.capacity}.`);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

function assignForm(routes, onDone) {
  modal({
    title: 'Affecter des élèves à une ligne', icon: 'bus',
    body: `<form id="as-form">
      ${field({ label: 'Ligne', name: 'route_id', type: 'select', required: true, placeholder: '— Choisir —', options: routes.map((x) => ({ value: x.id, label: `${x.name} (${x.abonnes}/${x.capacity})` })) })}
      ${field({ label: 'Élève', name: 'student_query', placeholder: 'Tapez au moins 2 lettres…' })}
      <div id="as-results"></div>
      <div id="as-chosen" class="mt-3"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="as-go">${icon('check', { size: 15 })} Affecter</button>`,
    onMount: (layer, close) => {
      const chosen = new Set();
      const results = layer.querySelector('#as-results');
      const paintChosen = () => {
        layer.querySelector('#as-chosen').innerHTML = chosen.size
          ? `<div class="sel-bar">${icon('users', { size: 15 })}<b>${num(chosen.size)}</b> élève(s) sélectionné(s)
              <span class="grow"></span><button type="button" class="btn btn-link btn-sm" id="as-clear">Vider</button></div>` : '';
        layer.querySelector('#as-clear')?.addEventListener('click', () => { chosen.clear(); paintChosen(); });
      };
      layer.querySelector('[name=student_query]').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        if (term.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = spinnerNote('Recherche…');
        const list = await searchStudents(term);
        results.innerHTML = list.length ? `<div class="list">${list.map((x) => `<div class="list-item clickable" data-sid="${x.id}">
            <span class="li-ico">${icon('user', { size: 14 })}</span>
            <span class="li-body"><span class="li-title small">${esc(x.first_name)} ${esc(x.last_name)}</span>
              <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</span></span>
            <span class="li-aside">${chosen.has(x.id) ? badge('Ajouté', 'ok') : badge('Ajouter', 'neutral')}</span></div>`).join('')}</div>`
          : '<p class="subtle small">Aucun élève trouvé.</p>';
        results.querySelectorAll('[data-sid]').forEach((li) => li.addEventListener('click', () => {
          const id = Number(li.dataset.sid);
          if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
          li.querySelector('.li-aside').innerHTML = chosen.has(id) ? badge('Ajouté', 'ok') : badge('Ajouter', 'neutral');
          paintChosen();
        }));
      }, 280));
      layer.querySelector('#as-go').addEventListener('click', () => withBusy(layer.querySelector('#as-go'), async () => {
        const payload = readForm(layer.querySelector('#as-form'), ['route_id']);
        if (!payload.route_id) return toastErr('Ligne requise');
        if (!chosen.size) return toastErr('Aucun élève', 'Recherchez puis ajoutez au moins un élève.');
        try {
          const r = await api.post(`/people/transport/${payload.route_id}/assign`, { student_ids: [...chosen] });
          toastOk('Affectation enregistrée', `${num(r.data?.assigned ?? chosen.size)} élève(s) rattaché(s) à la ligne.`);
          close();
          onDone?.();
        } catch (e) { toastErr('Affectation impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* INFIRMERIE                                                          */
/* ================================================================== */
async function healthView(el, query = {}) {
  const f = { type: query.type || '', page: 1, limit: 25 };
  el.innerHTML = `
    <div class="grid grid-kpi" id="hl-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="hl-toolbar"></div>
      <div class="card-body" style="padding:0" id="hl-table">${skeletonRows(8, 5)}</div>
      <div class="card-foot" id="hl-pager"></div>
    </div>`;
  const load = debounce(async () => {
    const t = el.querySelector('#hl-table');
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.type) q.set('type', f.type);
      const r = await api.get(`/people/health?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      const parType = {};
      rows.forEach((x) => { parType[x.type] = (parType[x.type] || 0) + 1; });
      el.querySelector('#hl-kpis').innerHTML = [
        kpi('Interventions (page)', num(rows.length), 'heart-pulse', 'brand', `${num(total)} au total`),
        kpi('Parents notifiés', num(rows.filter((x) => x.parent_notified).length), 'sms', 'ok', 'SMS ou appel tracé'),
        kpi('Cas référés', num(rows.filter((x) => x.referred).length), 'ambulance', rows.some((x) => x.referred) ? 'danger' : 'neutral', 'Orientation vers un centre de santé'),
      ].join('');
      el.querySelector('#hl-toolbar').innerHTML = toolbar({
        search: null,
        filters: `<select class="select select-sm" data-f="type"><option value="">Tous les motifs</option>
          ${Object.entries(TYPES_SANTE).map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${esc(l)}${parType[v] ? ` (${parType[v]})` : ''}</option>`).join('')}</select>`,
        actions: store.atLeast(45) ? `<button class="btn btn-primary" id="hl-new">${icon('plus', { size: 15 })} Nouvelle intervention</button>` : '',
      });
      const tb = el.querySelector('#hl-toolbar');
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#hl-new')?.addEventListener('click', () => healthForm(load));

      t.innerHTML = dataTable({
        columns: [
          { key: 'date', label: 'Date', width: '120px', render: (x) => `<span class="small">${dateFr(x.record_date)}</span><div class="tiny subtle">${relatif(x.record_date)}</div>` },
          {
            key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-xs' })}
              <div><div class="cell-user-name small">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')}</div></div></div>`,
          },
          { key: 'type', label: 'Motif', width: '130px', render: (x) => badge(TYPES_SANTE[x.type] || x.type, x.type === 'blessure' || x.type === 'malaise' ? 'danger' : 'info') },
          { key: 'symptomes', label: 'Symptômes / diagnostic', hideBelow: 'md', render: (x) => `<span class="small">${esc(x.symptoms || '—')}</span>${x.diagnosis ? `<div class="tiny subtle">${esc(x.diagnosis)}</div>` : ''}` },
          { key: 'soin', label: 'Traitement', width: '180px', hideBelow: 'lg', render: (x) => `<span class="small subtle">${esc(x.treatment || '—')}</span>` },
          {
            key: 'suivi', label: 'Suivi', width: '150px', render: (x) => `<div class="row gap-1">
              ${x.parent_notified ? badge('Parent informé', 'ok') : badge('Non notifié', 'warn')}
              ${x.referred ? badge('Référé', 'danger') : ''}</div>`,
          },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'heart-pulse', title: 'Aucune intervention', message: 'Le registre de l’infirmerie est vide pour ce filtre.' },
      }).outerHTML;
      const pager = el.querySelector('#hl-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'interventions' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

function healthForm(onDone) {
  modal({
    title: 'Nouvelle intervention infirmerie', icon: 'heart-pulse',
    body: `<form id="hf-form">
      ${field({ label: 'Élève', name: 'student_query', placeholder: 'Tapez au moins 2 lettres…', required: true })}
      <div id="hf-results"></div>
      <input type="hidden" name="student_id" id="hf-sid">
      <div class="grid-2 mt-3">
        ${field({ label: 'Date', name: 'record_date', type: 'date', value: aujourdhui(), required: true })}
        ${field({ label: 'Motif', name: 'type', type: 'select', value: 'maladie', required: true, options: Object.entries(TYPES_SANTE).map(([v, l]) => ({ value: v, label: l })) })}
      </div>
      ${field({ label: 'Symptômes constatés', name: 'symptoms', placeholder: 'Fièvre 38,5 °C, maux de tête…' })}
      ${field({ label: 'Diagnostic / observation', name: 'diagnosis', type: 'textarea', rows: 2 })}
      ${field({ label: 'Traitement administré', name: 'treatment', placeholder: 'Paracétamol 500 mg, repos 30 min' })}
      <div class="grid-2">
        ${field({ label: 'Référé vers un centre de santé', name: 'referred', type: 'switch', value: false })}
        ${field({ label: 'Parent notifié', name: 'parent_notified', type: 'switch', value: true, hint: 'Tracé dans le dossier de l’élève.' })}
      </div>
      ${field({ label: 'Note interne', name: 'note', type: 'textarea', rows: 2 })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="hf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      const results = layer.querySelector('#hf-results');
      const sid = layer.querySelector('#hf-sid');
      layer.querySelector('[name=student_query]').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        if (term.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = spinnerNote('Recherche…');
        const list = await searchStudents(term);
        results.innerHTML = list.length ? `<div class="list">${list.map((x) => `<div class="list-item clickable" data-sid="${x.id}">
            <span class="li-ico">${icon('user', { size: 14 })}</span>
            <span class="li-body"><span class="li-title small">${esc(x.first_name)} ${esc(x.last_name)}</span>
              <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</span></span></div>`).join('')}</div>`
          : '<p class="subtle small">Aucun élève trouvé.</p>';
        results.querySelectorAll('[data-sid]').forEach((li) => li.addEventListener('click', () => {
          sid.value = li.dataset.sid;
          layer.querySelector('[name=student_query]').value = li.querySelector('.li-title').textContent;
          results.innerHTML = `<div class="alert alert-ok" style="margin:0">${icon('check-circle', { size: 15 })}<div class="alert-body"><div class="alert-msg">Élève sélectionné.</div></div></div>`;
        }));
      }, 280));
      layer.querySelector('#hf-go').addEventListener('click', () => withBusy(layer.querySelector('#hf-go'), async () => {
        const payload = readForm(layer.querySelector('#hf-form'));
        if (!payload.student_id) return toastErr('Élève requis', 'Sélectionnez l’élève dans la liste.');
        payload.referred = !!payload.referred;
        payload.parent_notified = !!payload.parent_notified;
        try {
          await api.post('/people/health', payload);
          toastOk('Intervention enregistrée', payload.parent_notified ? 'La famille a été notifiée.' : 'Pensez à informer la famille.');
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* DOCUMENTS ADMINISTRATIFS                                            */
/* ================================================================== */
async function documentsView(el, query = {}) {
  const f = { status: query.status || '', page: 1, limit: 25 };
  el.innerHTML = `
    <div class="grid grid-kpi" id="dc-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="dc-toolbar"></div>
      <div class="card-body" style="padding:0" id="dc-table">${skeletonRows(8, 5)}</div>
      <div class="card-foot" id="dc-pager"></div>
    </div>`;
  const load = debounce(async () => {
    const t = el.querySelector('#dc-table');
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.status) q.set('status', f.status);
      const r = await api.get(`/people/document-requests?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      const attente = rows.filter((x) => x.status === 'en_attente');
      el.querySelector('#dc-kpis').innerHTML = [
        kpi('Demandes (page)', num(rows.length), 'folder', 'brand', `${num(total)} au total`),
        kpi('En attente', num(attente.length), 'hourglass', attente.length ? 'warn' : 'ok', attente.length ? 'À traiter au secrétariat' : 'File vide'),
        kpi('Droits perçus', xof(rows.reduce((a, x) => a + (x.status === 'remis' ? (x.fee || 0) : 0), 0)), 'banknote', 'ok', 'Sur les documents remis'),
      ].join('');
      el.querySelector('#dc-toolbar').innerHTML = toolbar({
        search: null,
        filters: `<select class="select select-sm" data-f="status"><option value="">Tous les statuts</option>
          ${dictEntries(STATUT_DOC).map((o) => `<option value="${o.value}" ${f.status === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: `<button class="btn btn-primary" id="dc-new">${icon('plus', { size: 15 })} Nouvelle demande</button>`,
      });
      const tb = el.querySelector('#dc-toolbar');
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#dc-new').addEventListener('click', () => docForm(load));

      t.innerHTML = dataTable({
        columns: [
          { key: 'date', label: 'Demandé le', width: '130px', render: (x) => `<span class="small">${dateFr(x.requested_at)}</span><div class="tiny subtle">${relatif(x.requested_at)}</div>` },
          {
            key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-xs' })}
              <div><div class="cell-user-name small">${esc(x.first_name)} ${esc(x.last_name)}</div>
              <div class="cell-user-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</div></div></div>`,
          },
          { key: 'doc', label: 'Document', width: '190px', render: (x) => badge(dictLabel(TYPES_DOCUMENT, x.doc_type) || x.doc_type, 'info') },
          { key: 'motif', label: 'Motif', hideBelow: 'md', render: (x) => `<span class="small subtle">${esc(x.reason || '—')}</span>` },
          { key: 'copies', label: 'Ex.', width: '60px', align: 'center', hideBelow: 'lg', render: (x) => `<span class="num">${num(x.copies || 1)}</span>` },
          { key: 'frais', label: 'Droit', width: '100px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num small">${xof(x.fee || 0)}</span>` },
          { key: 'statut', label: 'Statut', width: '130px', render: (x) => badge(dictLabel(STATUT_DOC, x.status), dictToneLocal(STATUT_DOC, x.status)) },
          {
            key: 'act', label: '', width: '200px', align: 'right', render: (x) => (x.status === 'remis'
              ? `<span class="tiny subtle">remis ${x.delivered_at ? relatif(x.delivered_at) : ''}</span>`
              : `<div class="row gap-1" style="justify-content:flex-end">
                  <button class="btn btn-secondary btn-sm" data-prog="${x.id}">${icon('loader', { size: 13 })} En préparation</button>
                  <button class="btn btn-primary btn-sm" data-done="${x.id}">${icon('check', { size: 13 })} Remis</button></div>`),
          },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'folder', title: 'Aucune demande', message: 'Les demandes de documents administratifs apparaîtront ici.' },
      }).outerHTML;
      const setStatus = async (id, status) => {
        try {
          await api.patch(`/people/document-requests/${id}`, { status });
          toastOk(status === 'remis' ? 'Document remis' : 'Demande en préparation', status === 'remis' ? 'La date de remise est enregistrée.' : '');
          load();
        } catch (e) { toastErr('Mise à jour impossible', e.message); }
      };
      t.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => {
        const row = rows.find((x) => String(x.id) === b.dataset.done);
        if ((row?.fee || 0) > 0 && canBill()) {
          const paid = await confirmDialog({
            title: 'Droit de timbre à encaisser',
            message: `Ce document donne lieu à un droit de ${xof(row.fee)}. Confirmer la remise l’enregistre comme remis ; encaissez le montant via Finances → Paiements.`,
            confirmLabel: 'Remis',
          });
          if (!paid) return;
        }
        setStatus(Number(b.dataset.done), 'remis');
      }));
      t.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', () => setStatus(Number(b.dataset.prog), 'en_cours')));

      const pager = el.querySelector('#dc-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'demandes' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

function docForm(onDone) {
  modal({
    title: 'Nouvelle demande de document', icon: 'folder', size: 'modal-narrow',
    body: `<form id="df-form">
      ${field({ label: 'Élève', name: 'student_query', placeholder: 'Tapez au moins 2 lettres…', required: true })}
      <div id="df-results"></div>
      <input type="hidden" name="student_id" id="df-sid">
      <div class="grid-2 mt-3">
        ${field({ label: 'Document', name: 'doc_type', type: 'select', value: 'certificat_scolarite', required: true, options: dictEntries(TYPES_DOCUMENT).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Nombre d’exemplaires', name: 'copies', type: 'number', value: 1, min: 1, max: 10 })}
        ${field({ label: 'Droit de timbre', name: 'fee', type: 'number', value: 1000, min: 0, suffix: 'FCFA' })}
        ${field({ label: 'Statut', name: 'status', type: 'select', value: 'en_attente', options: dictEntries(STATUT_DOC).map((o) => ({ value: o.value, label: o.label })) })}
      </div>
      ${field({ label: 'Motif de la demande', name: 'reason', placeholder: 'Visa, inscription, bourse…' })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="df-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      const results = layer.querySelector('#df-results');
      const sid = layer.querySelector('#df-sid');
      layer.querySelector('[name=student_query]').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        if (term.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = spinnerNote('Recherche…');
        const list = await searchStudents(term);
        results.innerHTML = list.length ? `<div class="list">${list.map((x) => `<div class="list-item clickable" data-sid="${x.id}">
            <span class="li-ico">${icon('user', { size: 14 })}</span>
            <span class="li-body"><span class="li-title small">${esc(x.first_name)} ${esc(x.last_name)}</span>
              <span class="li-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</span></span></div>`).join('')}</div>`
          : '<p class="subtle small">Aucun élève trouvé.</p>';
        results.querySelectorAll('[data-sid]').forEach((li) => li.addEventListener('click', () => {
          sid.value = li.dataset.sid;
          layer.querySelector('[name=student_query]').value = li.querySelector('.li-title').textContent;
          results.innerHTML = `<div class="alert alert-ok" style="margin:0">${icon('check-circle', { size: 15 })}<div class="alert-body"><div class="alert-msg">Élève sélectionné.</div></div></div>`;
        }));
      }, 280));
      layer.querySelector('#df-go').addEventListener('click', () => withBusy(layer.querySelector('#df-go'), async () => {
        const payload = readForm(layer.querySelector('#df-form'), ['copies', 'fee']);
        if (!payload.student_id) return toastErr('Élève requis', 'Sélectionnez l’élève concerné.');
        try {
          await api.post('/people/document-requests', payload);
          toastOk('Demande enregistrée', `${dictLabel(TYPES_DOCUMENT, payload.doc_type)} — ${payload.copies} exemplaire(s).`);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerPeople(route) {
  route('/personnel', async ({ query }) => { const el = h('<div class="view"></div>'); staffView(el, query); return el; }, { title: 'Équipe', group: 'Personnel' });
  route('/personnel/conges', async () => { const el = h('<div class="view"></div>'); leavesView(el); return el; }, { title: 'Congés & pointage', group: 'Personnel' });
  route('/personnel/:id', async ({ params }) => { const el = h('<div class="view"></div>'); staffDetail(el, Number(params.id)); return el; }, { title: 'Fiche personnel', group: 'Personnel' });
  route('/scolaire/familles', async ({ query }) => { const el = h('<div class="view"></div>'); guardiansView(el, query); return el; }, { title: 'Familles & tuteurs', group: 'Scolarité' });
  route('/services/bibliotheque', async ({ query }) => { const el = h('<div class="view"></div>'); libraryView(el, query); return el; }, { title: 'Bibliothèque', group: 'Services' });
  route('/services/cantine', async ({ query }) => { const el = h('<div class="view"></div>'); canteenView(el, query); return el; }, { title: 'Cantine', group: 'Services' });
  route('/services/transport', async () => { const el = h('<div class="view"></div>'); transportView(el); return el; }, { title: 'Transport scolaire', group: 'Services' });
  route('/services/infirmerie', async ({ query }) => { const el = h('<div class="view"></div>'); healthView(el, query); return el; }, { title: 'Infirmerie', group: 'Services' });
  route('/administration/documents', async ({ query }) => { const el = h('<div class="view"></div>'); documentsView(el, query); return el; }, { title: 'Documents administratifs', group: 'Services' });
}

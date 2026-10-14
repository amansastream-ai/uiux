/**
 * SunuÉcole — Paramètres : établissement, structure pédagogique, comptes,
 * abonnement, journal d'audit et préférences personnelles.
 *
 * C'est ici qu'une école configure la plateforme sans assistance : barème de
 * mentions, horaires, expéditeur SMS, modules activés, comptes du personnel,
 * sauvegarde et export complet (réversibilité des données).
 */
import { api, getPrefs } from '../core/api.js';
import { store, go, updatePrefs } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination, toolbar,
  field, readForm, modal, confirmDialog, toastOk, toastErr, toastInfo, debounce, withBusy, tabs, copyText,
} from '../ui/components.js';
import {
  xof, num, pct, dateFr, dateLong, heureFr, relatif, aujourdhui, telFr, dictLabel, dictEntries, ROLES,
} from '../core/format.js';
import { donutChart } from '../core/charts.js';

const MODULES = {
  students: { label: 'Dossiers élèves', icon: 'users' },
  attendance: { label: 'Appel & présences', icon: 'clipboard-check' },
  grades: { label: 'Notes & bulletins', icon: 'pen-tool' },
  timetable: { label: 'Emploi du temps', icon: 'calendar-days' },
  lessons: { label: 'Cahier de textes', icon: 'notebook' },
  homework: { label: 'Devoirs', icon: 'book-marked' },
  discipline: { label: 'Discipline', icon: 'shield' },
  finance: { label: 'Facturation & paiements', icon: 'banknote' },
  payroll: { label: 'Paie & RH', icon: 'briefcase' },
  library: { label: 'Bibliothèque', icon: 'library' },
  canteen: { label: 'Cantine', icon: 'utensils' },
  transport: { label: 'Transport', icon: 'bus' },
  health: { label: 'Infirmerie', icon: 'heart-pulse' },
  parents: { label: 'Portail parents', icon: 'contact-card' },
  students_portal: { label: 'Portail élèves', icon: 'graduation-cap' },
  sms: { label: 'Notifications SMS', icon: 'sms' },
};
const CYCLES = ['Préscolaire', 'Primaire', 'Collège', 'Lycée'];
const SHIFTS = { jour: 'Journée', matin: 'Matin', apres_midi: 'Après-midi', double: 'Double vacation' };
const ACTION_LABELS = {
  create: { label: 'Création', tone: 'ok' }, update: { label: 'Modification', tone: 'info' },
  delete: { label: 'Suppression', tone: 'danger' }, login: { label: 'Connexion', tone: 'neutral' },
  logout: { label: 'Déconnexion', tone: 'neutral' }, export: { label: 'Export', tone: 'warn' },
  validate: { label: 'Validation', tone: 'ok' }, impersonate: { label: 'Impersonation', tone: 'danger' },
};

const spinnerNote = (t) => `<div class="row gap-3 subtle small" style="justify-content:center;padding:36px"><span class="spinner"></span>${esc(t)}</div>`;
const kpi = (label, value, ic, toneName, hint) => `<div class="kpi"><div class="kpi-top">
    <span class="kpi-ico" data-tone="${toneName}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
  <div class="kpi-val" style="font-size:22px">${esc(value)}</div>
  <div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
const sectionCard = (title, ic, body, actions = '') => `<div class="card"><div class="card-head">
    <h2 class="h-card">${icon(ic, { size: 16 })} ${esc(title)}</h2>${actions}</div>
  <div class="card-body">${body}</div></div>`;

/* ================================================================== */
/* ÉTABLISSEMENT                                                       */
/* ================================================================== */
async function schoolView(el) {
  el.innerHTML = spinnerNote('Chargement des paramètres…');
  try {
    const [sch, onb] = await Promise.all([
      api.get('/settings/school'),
      api.get('/settings/onboarding').catch(() => ({ data: { steps: [], progression: 0 } })),
    ]);
    const d = sch.data || {};
    const s = d.school || {};
    const st = s.settings || {};
    const counts = d.counts || {};
    const steps = onb.data?.steps || [];
    const progression = onb.data?.progression || 0;

    el.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="row gap-4 wrap" style="align-items:center">
            <span class="school-logo">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : icon('school', { size: 26 })}</span>
            <div class="grow" style="min-width:220px">
              <h1 class="h-page" style="margin:0">${esc(s.name || '')}</h1>
              <p class="subtle small">${esc([s.address, s.city, s.region, s.country].filter(Boolean).join(' · '))}</p>
              <div class="row gap-1 wrap mt-2">
                ${badge(`Plan ${esc(d.plan?.name || s.plan || '')}`, 'brand')}
                ${badge(s.subscription_status === 'active' ? 'Abonnement actif' : s.subscription_status === 'trial' ? 'Essai en cours' : s.subscription_status, s.subscription_status === 'active' ? 'ok' : 'warn')}
                ${s.trial_ends_at ? badge(`Essai jusqu'au ${dateFr(s.trial_ends_at)}`, 'info') : ''}
                ${badge(`${num(counts.eleves || 0)} / ${num(s.max_students || 0)} élèves`, counts.eleves > (s.max_students || 0) ? 'danger' : 'neutral')}
              </div>
            </div>
            <div class="row gap-2 wrap">
              <a class="btn btn-secondary" href="#/parametres/abonnement">${icon('rocket', { size: 15 })} Abonnement</a>
              <button class="btn btn-secondary" id="sc-export">${icon('download', { size: 15 })} Exporter mes données</button>
              <button class="btn btn-primary" id="sc-backup">${icon('database', { size: 15 })} Sauvegarder</button>
            </div>
          </div>
        </div>
      </div>

      ${steps.length && progression < 100 ? `<div class="card mt-4"><div class="card-body">
        <div class="row gap-3 wrap" style="align-items:center">
          <div class="grow" style="min-width:220px">
            <b>Mise en route — ${num(progression)} %</b>
            <p class="tiny subtle" style="margin:2px 0 0">Il reste ${num(steps.filter((x) => !x.fait).length)} étape(s) pour être opérationnel.</p>
            ${progress(progression, progression >= 80 ? 'ok' : 'warn')}
          </div>
          ${onb.data?.premier_pas ? `<a class="btn btn-primary" href="#${esc(onb.data.premier_pas.lien || '/parametres')}">${icon('zap', { size: 15 })} ${esc(onb.data.premier_pas.titre || 'Continuer')}</a>` : ''}
        </div></div></div>` : ''}

      <div class="grid grid-kpi mt-4">
        ${kpi('Élèves', num(counts.eleves || 0), 'users', 'brand', `${num(counts.classes || 0)} classe(s)`)}
        ${kpi('Personnel', num(counts.personnel || 0), 'briefcase', 'info', `${num(counts.utilisateurs || 0)} compte(s) utilisateur`)}
        ${kpi('Matières', num(counts.matieres || 0), 'book-open', 'neutral', 'Configurées pour les bulletins')}
        ${kpi('Année scolaire', esc(s.academic_year || d.year?.name || ''), 'calendar-days', 'ok', d.year ? `${dateFr(d.year.start_date)} → ${dateFr(d.year.end_date)}` : '')}
      </div>

      <div id="sc-tabs" class="mt-4"></div>
      <div id="sc-body">${spinnerNote('Chargement…')}</div>`;

    el.querySelector('#sc-export')?.addEventListener('click', async () => {
      try { await api.download('/settings/export', `export-${s.slug || 'sunuecole'}-${aujourdhui()}.json`); toastOk('Export terminé', 'Vos données sont téléchargeables : réversibilité garantie.'); } catch (e) { toastErr('Export impossible', e.message); }
    });
    el.querySelector('#sc-backup')?.addEventListener('click', () => withBusy(el.querySelector('#sc-backup'), async () => {
      try { const r = await api.post('/settings/backups', { kind: 'manuel' }); toastOk('Sauvegarde créée', `${num(Math.round((r.data?.size || 0) / 1024))} Ko — conservée sur le serveur.`); } catch (e) { toastErr('Sauvegarde impossible', e.message); }
    }));

    const body = el.querySelector('#sc-body');
    const paint = (which) => {
      el.querySelector('#sc-tabs').innerHTML = '';
      el.querySelector('#sc-tabs').appendChild(tabs([
        { id: 'identite', label: 'Identité', icon: 'school' },
        { id: 'pedagogie', label: 'Pédagogie & notes', icon: 'pen-tool' },
        { id: 'communication', label: 'Communication', icon: 'sms' },
        { id: 'modules', label: 'Modules activés', icon: 'grid' },
        { id: 'donnees', label: 'Données & sécurité', icon: 'database' },
      ], which, { onSelect: (t) => { history.replaceState(null, '', `#/parametres?tab=${t}`); paint(t); } }));

      if (which === 'identite') {
        body.innerHTML = sectionCard('Fiche établissement', 'school', `<form id="id-form" class="form-grid">
          <div class="grid-2">
            ${field({ label: 'Nom de l’établissement', name: 'name', value: s.name || '', required: true })}
            ${field({ label: 'Type', name: 'type', type: 'select', value: s.type || 'prive', options: [{ value: 'prive', label: 'Privé' }, { value: 'public', label: 'Public' }, { value: 'confessionnel', label: 'Confessionnel' }, { value: 'communautaire', label: 'Communautaire' }] })}
            ${field({ label: 'Téléphone', name: 'phone', type: 'tel', value: s.phone || '' })}
            ${field({ label: 'Téléphone secondaire', name: 'phone2', type: 'tel', value: s.phone2 || '' })}
            ${field({ label: 'E-mail', name: 'email', type: 'email', value: s.email || '' })}
            ${field({ label: 'Site web', name: 'website', value: s.website || '', placeholder: 'https://' })}
            ${field({ label: 'Adresse', name: 'address', value: s.address || '' })}
            ${field({ label: 'Ville', name: 'city', value: s.city || '' })}
            ${field({ label: 'Région', name: 'region', value: s.region || '' })}
            ${field({ label: 'Pays', name: 'country', value: s.country || 'Sénégal' })}
            ${field({ label: 'Chef d’établissement', name: 'head_name', value: s.head_name || '' })}
            ${field({ label: 'NINEA', name: 'ninea', value: s.ninea || '', hint: 'Apparaît sur les reçus et bulletins' })}
            ${field({ label: 'N° RNE / inscription', name: 'rne', value: s.rne || '' })}
            ${field({ label: 'Année scolaire (libellé)', name: 'academic_year', value: s.academic_year || '' })}
            ${field({ label: 'Devise', name: 'currency', type: 'select', value: s.currency || 'XOF', options: [{ value: 'XOF', label: 'XOF — Franc CFA' }, { value: 'GNF', label: 'GNF — Franc guinéen' }, { value: 'EUR', label: 'EUR — Euro' }] })}
            ${field({ label: 'Fuseau horaire', name: 'timezone', type: 'select', value: s.timezone || 'Africa/Dakar', options: ['Africa/Dakar', 'Africa/Abidjan', 'Africa/Bamako', 'Africa/Ouagadougou', 'Africa/Niamey', 'Africa/Cotonou', 'Africa/Lome', 'Africa/Conakry', 'Europe/Paris'].map((v) => ({ value: v, label: v })) })}
            ${field({ label: 'URL du logo', name: 'logo_url', value: s.logo_url || '', placeholder: 'https://…/logo.png' })}
          </div>
        </form>`, `<button class="btn btn-primary" id="id-save">${icon('save', { size: 15 })} Enregistrer</button>`);
        body.querySelector('#id-save').addEventListener('click', () => withBusy(body.querySelector('#id-save'), async () => {
          try {
            await api.patch('/settings/school', readForm(body.querySelector('#id-form')));
            toastOk('Établissement mis à jour', 'Les bulletins, reçus et SMS utiliseront ces informations.');
            schoolView(el);
          } catch (e) { toastErr('Enregistrement impossible', e.message); }
        }));
      } else if (which === 'pedagogie') {
        const scale = st.gradingScale || [];
        body.innerHTML = sectionCard('Barème & mentions', 'pen-tool', `<form id="pd-form">
          <div class="grid-2">
            ${field({ label: 'Système de notation', name: 'gradingSystem', type: 'select', value: st.gradingSystem || '20', options: [{ value: '20', label: 'Sur 20' }, { value: '100', label: 'Sur 100' }, { value: 'lettre', label: 'Lettres (A–F)' }] })}
            ${field({ label: 'Moyenne de passage', name: 'passMark', type: 'number', value: st.passMark ?? 10, min: 0, max: 20, step: '0.5' })}
            ${field({ label: 'Début des cours', name: 'dayStart', type: 'time', value: st.dayStart || '07:30' })}
            ${field({ label: 'Fin des cours', name: 'dayEnd', type: 'time', value: st.dayEnd || '17:30' })}
            ${field({ label: 'Durée d’un créneau (min)', name: 'slotMinutes', type: 'number', value: st.slotMinutes || 55, min: 20, max: 180, step: 5 })}
            ${field({ label: 'Alerte absence dès (jours)', name: 'absenceAlertThreshold', type: 'number', value: st.absenceAlertThreshold ?? 3, min: 1, max: 20, hint: 'Déclenche un SMS aux parents' })}
            ${field({ label: 'Pénalité de retard de paiement (%)', name: 'invoiceLateFeePct', type: 'number', value: st.invoiceLateFeePct ?? 0, min: 0, max: 50 })}
          </div>
          <div class="grid-2 mt-3">
            ${field({ label: 'Relances automatiques des impayés', name: 'autoReminders', type: 'switch', value: st.autoReminders !== false, hint: 'SMS de rappel à l’échéance + 7 jours' })}
            ${field({ label: 'Jours d’école', name: 'schoolDays', value: (st.schoolDays || [1, 2, 3, 4, 5]).join(','), hint: '1 = lundi … 7 = dimanche (séparés par des virgules)' })}
          </div>
          <h3 class="h-card mt-4">${icon('award', { size: 15 })} Échelle des mentions</h3>
          <div class="scale-list">${scale.map((x, i) => `<div class="scale-row">
              <span class="scale-dot" style="background:${esc(x.color || '#0e7c66')}"></span>
              <b>${esc(x.mention)}</b>
              <span class="tiny subtle">à partir de <b class="num">${num(x.min)}</b>/20</span>
            </div>`).join('') || '<p class="subtle small">Aucune mention configurée.</p>'}</div>
          <p class="wizard-note">Les mentions sont appliquées automatiquement aux bulletins. Modifiez-les dans le fichier de configuration si votre académie impose d’autres seuils.</p>
        </form>`, `<button class="btn btn-primary" id="pd-save">${icon('save', { size: 15 })} Enregistrer</button>`);
        body.querySelector('#pd-save').addEventListener('click', () => withBusy(body.querySelector('#pd-save'), async () => {
          const p = readForm(body.querySelector('#pd-form'), ['passMark', 'slotMinutes', 'absenceAlertThreshold', 'invoiceLateFeePct']);
          try {
            await api.patch('/settings/school', {
              settings: {
                gradingSystem: p.gradingSystem, passMark: Number(p.passMark), dayStart: p.dayStart, dayEnd: p.dayEnd,
                slotMinutes: Number(p.slotMinutes), absenceAlertThreshold: Number(p.absenceAlertThreshold),
                invoiceLateFeePct: Number(p.invoiceLateFeePct), autoReminders: !!p.autoReminders,
                schoolDays: String(p.schoolDays || '1,2,3,4,5').split(',').map((x) => Number(x.trim())).filter(Boolean),
              },
            });
            toastOk('Paramètres pédagogiques enregistrés');
            schoolView(el);
          } catch (e) { toastErr('Enregistrement impossible', e.message); }
        }));
      } else if (which === 'communication') {
        body.innerHTML = sectionCard('Communication avec les familles', 'sms', `<form id="cm-form">
          ${field({ label: 'Expéditeur SMS (sender ID)', name: 'smsSender', value: st.smsSender || '', placeholder: 'BAOBABS', hint: 'Nom affiché à la place du numéro (à déclarer chez l’opérateur).' })}
          ${field({ label: 'Pied de page des bulletins', name: 'reportCardFooter', type: 'textarea', rows: 2, value: st.reportCardFooter || '' })}
          ${field({ label: 'Pied de page des reçus', name: 'receiptFooter', type: 'textarea', rows: 2, value: st.receiptFooter || '' })}
          <div class="alert alert-info mt-3">${icon('info', { size: 16 })}<div class="alert-body">
            <div class="alert-title">Coût des SMS</div>
            <div class="alert-msg">25 FCFA par segment de 160 caractères. Seuls les numéros avec consentement (SMS opt-in) sont servis — le taux de délivrabilité reste élevé.</div></div></div>
        </form>`, `<button class="btn btn-primary" id="cm-save">${icon('save', { size: 15 })} Enregistrer</button>`);
        body.querySelector('#cm-save').addEventListener('click', () => withBusy(body.querySelector('#cm-save'), async () => {
          const p = readForm(body.querySelector('#cm-form'));
          try {
            await api.patch('/settings/school', { settings: { smsSender: p.smsSender, reportCardFooter: p.reportCardFooter, receiptFooter: p.receiptFooter } });
            toastOk('Communication mise à jour');
            schoolView(el);
          } catch (e) { toastErr('Enregistrement impossible', e.message); }
        }));
      } else if (which === 'modules') {
        const active = s.modules || Object.keys(MODULES);
        body.innerHTML = sectionCard('Modules activés', 'grid', `
          <p class="subtle small mb-3">Désactivez ce que vous n’utilisez pas : la navigation s’allège et l’application démarre plus vite.</p>
          <div class="module-grid" id="md-grid">
            ${Object.entries(MODULES).map(([key, m]) => `<label class="module-tile ${active.includes(key) ? 'is-on' : ''}">
              <input type="checkbox" name="mod_${key}" ${active.includes(key) ? 'checked' : ''}>
              <span class="module-ico">${icon(m.icon, { size: 18 })}</span>
              <span class="module-label">${esc(m.label)}</span></label>`).join('')}
          </div>`, `<button class="btn btn-primary" id="md-save">${icon('save', { size: 15 })} Enregistrer</button>`);
        body.querySelectorAll('#md-grid input').forEach((i) => i.addEventListener('change', () => i.closest('.module-tile').classList.toggle('is-on', i.checked)));
        body.querySelector('#md-save').addEventListener('click', () => withBusy(body.querySelector('#md-save'), async () => {
          const modules = Object.keys(MODULES).filter((k) => body.querySelector(`[name=mod_${k}]`).checked);
          try {
            await api.patch('/settings/school', { modules });
            toastOk('Modules mis à jour', `${modules.length} module(s) actif(s).`);
            schoolView(el);
          } catch (e) { toastErr('Enregistrement impossible', e.message); }
        }));
      } else {
        body.innerHTML = `
          ${sectionCard('Sauvegardes', 'database', `<div id="bk-list">${spinnerNote('Chargement…')}</div>`, `<button class="btn btn-secondary" id="bk-new">${icon('plus', { size: 15 })} Sauvegarder maintenant</button>`)}
          <div class="mt-4">${sectionCard('Réversibilité des données', 'download', `<p class="small" style="line-height:1.65;color:var(--text-2)">
              Vos données vous appartiennent. L’export JSON complet contient les élèves, familles, personnel, notes, bulletins,
              présences, factures, paiements, dépenses, messages, événements et le journal d’audit de l’établissement.</p>
            <div class="row gap-2 wrap mt-3">
              <button class="btn btn-primary" id="dt-export">${icon('download', { size: 15 })} Télécharger l’export JSON</button>
              <a class="btn btn-secondary" href="#/scolaire/eleves">${icon('table', { size: 15 })} Export CSV des élèves</a>
            </div>`)}</div>
          <div class="mt-4">${sectionCard('Checklist de mise en route', 'check-circle', steps.length ? `<div class="list">${steps.map((x) => `<div class="list-item">
              <span class="li-ico" data-tone="${x.fait ? 'ok' : 'warn'}">${icon(x.fait ? 'check-circle' : 'clock', { size: 15 })}</span>
              <span class="li-body"><span class="li-title small">${esc(x.titre)}</span><span class="li-sub">${esc(x.description || '')}</span></span>
              <span class="li-aside">${x.detail ? badge(`${num(x.detail.valeur)} ${x.detail.unite}`, 'info') : ''}${x.fait ? badge('Fait', 'ok') : `<a class="btn btn-link btn-sm" href="#${esc(x.lien || '/parametres')}">Ouvrir</a>`}</span></div>`).join('')}</div>`
            : '<p class="subtle small">Checklist indisponible.</p>')}</div>`;
        const loadBackups = async () => {
          const r = await api.get('/settings/backups').catch(() => ({ data: [] }));
          const rows = r.data || [];
          body.querySelector('#bk-list').innerHTML = rows.length ? `<div class="list">${rows.map((b) => `<div class="list-item">
              <span class="li-ico" data-tone="ok">${icon('database', { size: 15 })}</span>
              <span class="li-body"><span class="li-title small">${esc(String(b.file_path || '').split('/').pop())}</span>
                <span class="li-sub">${dateFr(b.created_at)} ${heureFr(b.created_at)} · ${num(Math.round((b.size_bytes || 0) / 1024))} Ko · ${esc(b.kind || 'manuel')}</span></span>
            </div>`).join('')}</div>`
            : '<p class="subtle small">Aucune sauvegarde manuelle — les sauvegardes automatiques quotidiennes restent actives.</p>';
        };
        body.querySelector('#bk-new').addEventListener('click', () => withBusy(body.querySelector('#bk-new'), async () => {
          try { await api.post('/settings/backups', { kind: 'manuel' }); toastOk('Sauvegarde créée'); loadBackups(); } catch (e) { toastErr('Sauvegarde impossible', e.message); }
        }));
        body.querySelector('#dt-export').addEventListener('click', async () => {
          try { await api.download('/settings/export', `export-${s.slug || 'sunuecole'}-${aujourdhui()}.json`); toastOk('Export téléchargé'); } catch (e) { toastErr('Export impossible', e.message); }
        });
        loadBackups();
      }
    };
    paint(new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'identite');
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Paramètres indisponibles', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* STRUCTURE PÉDAGOGIQUE                                               */
/* ================================================================== */
async function structureView(el) {
  el.innerHTML = spinnerNote('Chargement de la structure…');
  try {
    const r = await api.get('/settings/school');
    const d = r.data || {};
    const levels = d.levels || [];
    const terms = d.terms || [];
    const years = d.years || [];
    const [classes, subjects, staff] = await Promise.all([
      api.get('/academics/classes').catch(() => ({ data: [] })),
      api.get('/academics/subjects').catch(() => ({ data: [] })),
      api.get('/people/staff?type=enseignant').catch(() => ({ data: [] })),
    ]);
    const cs = classes.data || [];
    const subs = subjects.data || [];
    const profs = staff.data || [];

    el.innerHTML = `<div id="sr-tabs"></div><div id="sr-body">${spinnerNote('Chargement…')}</div>`;
    const body = el.querySelector('#sr-body');
    const paint = (which) => {
      el.querySelector('#sr-tabs').innerHTML = '';
      el.querySelector('#sr-tabs').appendChild(tabs([
        { id: 'niveaux', label: 'Niveaux', icon: 'layers', count: levels.length },
        { id: 'classes', label: 'Classes', icon: 'school', count: cs.length },
        { id: 'matieres', label: 'Matières', icon: 'book-open', count: subs.length },
        { id: 'annee', label: 'Année & trimestres', icon: 'calendar-days', count: terms.length },
      ], which, { onSelect: (t) => { history.replaceState(null, '', `#/parametres/structure?tab=${t}`); paint(t); } }));

      if (which === 'niveaux') {
        body.innerHTML = sectionCard('Niveaux scolaires', 'layers', levels.length ? dataTable({
          columns: [
            { key: 'seq', label: 'Ordre', width: '80px', align: 'center', render: (x) => `<span class="num">${num(x.seq)}</span>` },
            { key: 'name', label: 'Niveau', render: (x) => `<b>${esc(x.name)}</b>` },
            { key: 'cycle', label: 'Cycle', width: '130px', render: (x) => badge(x.cycle || '—', 'info') },
            { key: 'tuition', label: 'Scolarité annuelle', width: '160px', align: 'right', render: (x) => `<b class="num small">${xof(x.tuition || 0)}</b>` },
            { key: 'color', label: 'Couleur', width: '80px', render: (x) => `<span class="dot" style="background:${esc(x.color || '#0e7c66')}"></span>` },
            { key: 'act', label: '', width: '110px', align: 'right', render: (x) => `<button class="btn btn-secondary btn-sm" data-lvl="${x.id}">${icon('pencil', { size: 13 })} Modifier</button>` },
          ],
          rows: levels, dense: true, zebra: true,
        }).outerHTML : emptyState({ icon: 'layers', title: 'Aucun niveau', message: 'Créez vos niveaux de la CI à la Terminale.' }),
        `<button class="btn btn-primary" id="lv-new">${icon('plus', { size: 15 })} Nouveau niveau</button>`);
        body.querySelector('#lv-new').addEventListener('click', () => levelForm(null, levels.length + 1, () => structureView(el)));
        body.querySelectorAll('[data-lvl]').forEach((b) => b.addEventListener('click', () => levelForm(levels.find((x) => String(x.id) === b.dataset.lvl), 0, () => structureView(el))));
      } else if (which === 'classes') {
        body.innerHTML = sectionCard('Classes', 'school', cs.length ? dataTable({
          columns: [
            { key: 'name', label: 'Classe', render: (x) => `<div class="cell-user"><span class="dot" style="background:${esc(x.color || '#0e7c66')}"></span><div><div class="cell-user-name">${esc(x.name)}</div><div class="cell-user-sub">${esc(x.niveau || '')} · ${esc(x.cycle || '')}</div></div></div>` },
            { key: 'eff', label: 'Effectif', width: '150px', render: (x) => `${progress(Math.round(((x.effectif || 0) / Math.max(1, x.capacity || 1)) * 100), x.effectif >= x.capacity ? 'danger' : 'ok')}<span class="tiny num">${num(x.effectif || 0)} / ${num(x.capacity || 0)}</span>` },
            { key: 'pp', label: 'Prof. principal', width: '170px', hideBelow: 'md', render: (x) => esc(x.prof_principal || '—') },
            { key: 'salle', label: 'Salle', width: '110px', hideBelow: 'lg', render: (x) => `<span class="small">${esc(x.room || '—')}</span>` },
            { key: 'shift', label: 'Vacation', width: '120px', hideBelow: 'md', render: (x) => badge(SHIFTS[x.shift] || x.shift || 'Journée', 'neutral') },
            { key: 'mat', label: 'Matières', width: '90px', align: 'center', hideBelow: 'lg', render: (x) => `<span class="num">${num(x.matieres || 0)}</span>` },
            { key: 'act', label: '', width: '180px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
                <a class="btn btn-secondary btn-sm" href="#/scolaire/classes/${x.id}">${icon('arrow-right', { size: 13 })}</a>
                <button class="btn btn-secondary btn-sm" data-cls="${x.id}">${icon('pencil', { size: 13 })}</button></div>` },
          ],
          rows: cs, dense: true, zebra: true,
          onRowClick: (x) => go(`/scolaire/classes/${x.id}`),
        }).outerHTML : emptyState({ icon: 'school', title: 'Aucune classe', message: 'Créez vos classes pour démarrer.' }),
        `<button class="btn btn-primary" id="cl-new">${icon('plus', { size: 15 })} Nouvelle classe</button>`);
        body.querySelector('#cl-new').addEventListener('click', () => classForm(null, levels, profs, () => structureView(el)));
        body.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); classForm(cs.find((x) => String(x.id) === b.dataset.cls), levels, profs, () => structureView(el)); }));
      } else if (which === 'matieres') {
        body.innerHTML = sectionCard('Matières', 'book-open', subs.length ? dataTable({
          columns: [
            { key: 'name', label: 'Matière', render: (x) => `<span class="dot" style="background:${esc(x.color || '#0e7c66')}"></span> <b>${esc(x.name)}</b>` },
            { key: 'code', label: 'Code', width: '110px', render: (x) => `<span class="num small">${esc(x.code || '—')}</span>` },
            { key: 'classes', label: 'Classes concernées', hideBelow: 'md', render: (x) => `<span class="small subtle">${num(x.classes ?? 0)} affectation(s)</span>` },
            { key: 'act', label: '', width: '110px', align: 'right', render: (x) => `<button class="btn btn-secondary btn-sm" data-sub="${x.id}">${icon('pencil', { size: 13 })} Modifier</button>` },
          ],
          rows: subs, dense: true, zebra: true,
        }).outerHTML : emptyState({ icon: 'book-open', title: 'Aucune matière', message: 'Les matières alimentent les moyennes et les bulletins.' }),
        `<button class="btn btn-primary" id="sb-new">${icon('plus', { size: 15 })} Nouvelle matière</button>`);
        body.querySelector('#sb-new').addEventListener('click', () => subjectForm(null, () => structureView(el)));
        body.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => subjectForm(subs.find((x) => String(x.id) === b.dataset.sub), () => structureView(el))));
      } else {
        const year = d.year || years.find((y) => y.is_current) || {};
        body.innerHTML = `
          ${sectionCard('Année scolaire en cours', 'calendar-days', `<div class="grid-2">
            ${field({ label: 'Nom', name: 'year_name', value: year.name || '', required: true })}
            ${field({ label: 'Statut', name: 'year_status', type: 'select', value: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archivée' }] })}
            ${field({ label: 'Début', name: 'start_date', type: 'date', value: year.start_date || '' })}
            ${field({ label: 'Fin', name: 'end_date', type: 'date', value: year.end_date || '' })}
          </div>`, `<button class="btn btn-primary" id="yr-new">${icon('plus', { size: 15 })} Créer / basculer l'année</button>`)}
          <div class="mt-4">${sectionCard('Trimestres & conseils de classe', 'flag', terms.length ? `<div class="list">${terms.map((t) => `<div class="list-item">
              <span class="li-ico" data-tone="${t.is_current ? 'ok' : 'neutral'}">${icon('flag', { size: 15 })}</span>
              <span class="li-body"><span class="li-title">${esc(t.name)}</span>
                <span class="li-sub">${dateFr(t.start_date)} → ${dateFr(t.end_date)} · conseil ${t.council_date ? dateFr(t.council_date) : '—'} · bulletins ${t.report_date ? dateFr(t.report_date) : '—'}</span></span>
              <span class="li-aside">${t.is_current ? badge('En cours', 'ok') : badge('Terminé', 'neutral')}</span></div>`).join('')}</div>`
            : '<p class="subtle small">Aucun trimestre défini.</p>')}</div>}`;
        body.querySelector('#yr-new').addEventListener('click', () => withBusy(body.querySelector('#yr-new'), async () => {
          const p = readForm(body.querySelector('form'));
          try {
            await api.post('/settings/years', p);
            toastOk('Année scolaire enregistrée', `${p.year_name || p.name || ''} est maintenant l'année courante.`);
            structureView(el);
          } catch (e) { toastErr('Création impossible', e.message); }
        }));
      }
    };
    paint(new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'niveaux');
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Structure indisponible', message: err.message })}</div></div>`;
  }
}

function levelForm(current, nextSeq, onDone) {
  const c = current || {};
  modal({
    title: c.id ? `Modifier ${c.name}` : 'Nouveau niveau', icon: 'layers', size: 'modal-narrow',
    body: `<form id="lf-form"><div class="grid-2">
        ${field({ label: 'Nom', name: 'name', value: c.name || '', required: true, placeholder: '6ème, Terminale S…' })}
        ${field({ label: 'Cycle', name: 'cycle', type: 'select', value: c.cycle || 'Primaire', options: CYCLES.map((x) => ({ value: x, label: x })) })}
        ${field({ label: 'Ordre', name: 'seq', type: 'number', value: c.seq || nextSeq || 1, min: 1 })}
        ${field({ label: 'Scolarité annuelle', name: 'tuition', type: 'number', value: c.tuition || 0, min: 0, suffix: 'FCFA' })}
      </div>
      ${field({ label: 'Couleur', name: 'color', type: 'color', value: c.color || '#0e7c66' })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="lf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#lf-go').addEventListener('click', () => withBusy(layer.querySelector('#lf-go'), async () => {
        const payload = readForm(layer.querySelector('#lf-form'), ['seq', 'tuition']);
        try {
          if (c.id) await api.patch(`/settings/levels/${c.id}`, payload);
          else await api.post('/settings/levels', payload);
          toastOk(c.id ? 'Niveau mis à jour' : 'Niveau créé', payload.name);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

function classForm(current, levels, teachers, onDone) {
  const c = current || {};
  modal({
    title: c.id ? `Modifier ${c.name}` : 'Nouvelle classe', icon: 'school',
    body: `<form id="cf-form"><div class="grid-2">
        ${field({ label: 'Nom de la classe', name: 'name', value: c.name || '', required: true, placeholder: '6ème A' })}
        ${field({ label: 'Niveau', name: 'level_id', type: 'select', value: c.level_id || '', required: true, placeholder: '— Choisir —', options: levels.map((l) => ({ value: l.id, label: `${l.name} (${l.cycle})` })) })}
        ${field({ label: 'Capacité', name: 'capacity', type: 'number', value: c.capacity || 40, min: 1 })}
        ${field({ label: 'Salle', name: 'room', value: c.room || '', placeholder: 'Salle B3' })}
        ${field({ label: 'Professeur principal', name: 'main_teacher_id', type: 'select', value: c.main_teacher_id || '', placeholder: '— Aucun —', options: teachers.map((t) => ({ value: t.id, label: `${t.name || `${t.first_name} ${t.last_name}`} — ${t.job_title || ''}` })) })}
        ${field({ label: 'Vacation', name: 'shift', type: 'select', value: c.shift || 'jour', options: Object.entries(SHIFTS).map(([v, l]) => ({ value: v, label: l })) })}
        ${field({ label: 'Couleur', name: 'color', type: 'color', value: c.color || '#0e7c66' })}
      </div></form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="cf-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#cf-go').addEventListener('click', () => withBusy(layer.querySelector('#cf-go'), async () => {
        const payload = readForm(layer.querySelector('#cf-form'), ['level_id', 'capacity', 'main_teacher_id']);
        if (!payload.name || !payload.level_id) return toastErr('Champs requis', 'Nom et niveau obligatoires.');
        if (c.id) payload.id = c.id;
        try {
          await api.post('/settings/classes', payload);
          toastOk(c.id ? 'Classe mise à jour' : 'Classe créée', `${payload.name} · capacité ${payload.capacity}.`);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

function subjectForm(current, onDone) {
  const c = current || {};
  modal({
    title: c.id ? `Modifier ${c.name}` : 'Nouvelle matière', icon: 'book-open', size: 'modal-narrow',
    body: `<form id="sb-form"><div class="grid-2">
        ${field({ label: 'Nom', name: 'name', value: c.name || '', required: true, placeholder: 'Mathématiques' })}
        ${field({ label: 'Code', name: 'code', value: c.code || '', placeholder: 'MATH' })}
        ${field({ label: 'Coefficient par défaut', name: 'coefficient', type: 'number', value: c.coefficient || 2, min: 1, max: 10 })}
        ${field({ label: 'Couleur', name: 'color', type: 'color', value: c.color || '#0e7c66' })}
      </div></form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="sb-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#sb-go').addEventListener('click', () => withBusy(layer.querySelector('#sb-go'), async () => {
        const payload = readForm(layer.querySelector('#sb-form'), ['coefficient']);
        if (!payload.name) return toastErr('Nom requis');
        try {
          if (c.id) await api.patch(`/settings/subjects/${c.id}`, payload);
          else await api.post('/settings/subjects', payload);
          toastOk(c.id ? 'Matière mise à jour' : 'Matière créée', payload.name);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* COMPTES & DROITS                                                    */
/* ================================================================== */
async function usersView(el, query = {}) {
  const f = { q: query.q || '', role: query.role || '' };
  el.innerHTML = `
    <div class="grid grid-kpi" id="us-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="us-toolbar"></div>
      <div class="card-body" style="padding:0" id="us-table">${skeletonRows(8, 5)}</div>
    </div>`;
  let roles = [];
  const load = debounce(async () => {
    const t = el.querySelector('#us-table');
    t.innerHTML = skeletonRows(8, 5);
    try {
      const q = new URLSearchParams();
      if (f.q) q.set('q', f.q);
      if (f.role) q.set('role', f.role);
      const r = await api.get(`/settings/users?${q}`);
      const rows = r.data?.users || [];
      roles = r.data?.roles || [];
      const actifs = rows.filter((x) => x.is_active).length;
      const jamais = rows.filter((x) => !x.last_login_at).length;
      const deuxF = rows.filter((x) => x.two_factor).length;

      el.querySelector('#us-kpis').innerHTML = [
        kpi('Comptes', num(rows.length), 'shield-check', 'brand', `${num(actifs)} actif(s)`),
        kpi('Jamais connectés', num(jamais), 'user-x', jamais ? 'warn' : 'ok', 'Relancez-les par SMS ou e-mail'),
        kpi('Double authentification', num(deuxF), 'lock', deuxF ? 'ok' : 'warn', `${rows.length ? pct(Math.round((deuxF / rows.length) * 100)) : '—'} des comptes`),
        kpi('Rôles disponibles', num(roles.length), 'key', 'info', 'Droits progressifs par niveau'),
      ].join('');

      el.querySelector('#us-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Nom, e-mail…',
        filters: `<select class="select select-sm" data-f="role"><option value="">Tous les rôles</option>
          ${dictEntries(ROLES).map((o) => `<option value="${o.value}" ${f.role === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: `<button class="btn btn-primary" id="us-new">${icon('user-plus', { size: 15 })} Nouveau compte</button>`,
      });
      const tb = el.querySelector('#us-toolbar');
      tb.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); load(); }, 300));
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; load(); }));
      tb.querySelector('#us-new').addEventListener('click', () => userForm(null, () => load()));

      t.innerHTML = dataTable({
        columns: [
          {
            key: 'nom', label: 'Utilisateur', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm', color: x.avatar_color })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div>
              <div class="cell-user-sub">${esc(x.email || 'pas d’e-mail')} · ${esc(x.phone || '')}</div></div></div>`,
          },
          { key: 'role', label: 'Rôle', width: '150px', render: (x) => badge(dictLabel(ROLES, x.role), x.role === 'direction' || x.role === 'super_admin' ? 'brand' : 'neutral') },
          { key: 'poste', label: 'Fonction', width: '170px', hideBelow: 'lg', render: (x) => `<span class="small subtle">${esc(x.job_title || '—')}</span>` },
          { key: 'derniere', label: 'Dernière connexion', width: '150px', hideBelow: 'md', render: (x) => (x.last_login_at ? `<span class="small">${relatif(x.last_login_at)}</span><div class="tiny subtle">${num(x.login_count || 0)} connexion(s)</div>` : badge('Jamais', 'warn')) },
          {
            key: 'securite', label: 'Sécurité', width: '130px', hideBelow: 'md', render: (x) => `<div class="row gap-1">
              ${x.two_factor ? badge('2FA', 'ok') : ''}${x.must_change_pw ? badge('Mdp à changer', 'warn') : ''}${!x.two_factor && !x.must_change_pw ? '<span class="tiny subtle">—</span>' : ''}</div>`,
          },
          { key: 'statut', label: 'Statut', width: '100px', render: (x) => (x.is_active ? badge('Actif', 'ok') : badge('Désactivé', 'danger')) },
          {
            key: 'act', label: '', width: '200px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" data-edit="${x.id}" title="Modifier">${icon('pencil', { size: 13 })}</button>
              <button class="btn btn-secondary btn-sm" data-reset="${x.id}" title="Réinitialiser le mot de passe">${icon('key', { size: 13 })}</button>
              ${x.is_active ? `<button class="btn btn-secondary btn-sm" data-off="${x.id}" title="Désactiver">${icon('lock', { size: 13 })}</button>` : ''}</div>`,
          },
        ],
        rows, dense: true, zebra: true, stickyFirst: true,
        empty: { icon: 'shield-check', title: 'Aucun compte', message: 'Créez les accès de votre équipe.' },
      }).outerHTML;

      t.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => userForm(rows.find((x) => String(x.id) === b.dataset.edit), () => load())));
      t.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
        const u = rows.find((x) => String(x.id) === b.dataset.reset);
        if (!(await confirmDialog({ title: 'Réinitialiser le mot de passe ?', message: `Un mot de passe temporaire sera généré pour ${u.first_name} ${u.last_name}. Il devra le changer à la prochaine connexion.`, confirmLabel: 'Réinitialiser' }))) return;
        try {
          const r2 = await api.post(`/settings/users/${u.id}/reset-password`, {});
          modal({
            title: 'Mot de passe temporaire', icon: 'key', size: 'modal-narrow',
            body: `<p class="small">Communiquez ce mot de passe à <b>${esc(u.first_name)} ${esc(u.last_name)}</b> (${esc(u.email || 'sans e-mail')}) :</p>
              <div class="temp-pw"><code id="pw-val">${esc(r2.data?.tempPassword || '')}</code></div>`,
            footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
              <button class="btn btn-primary" id="pw-copy">${icon('copy', { size: 15 })} Copier</button>`,
            onMount: (layer, close) => layer.querySelector('#pw-copy').addEventListener('click', () => copyText(r2.data?.tempPassword || '')),
          });
          toastOk('Mot de passe réinitialisé');
        } catch (e) { toastErr('Réinitialisation impossible', e.message); }
      }));
      t.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', async () => {
        const u = rows.find((x) => String(x.id) === b.dataset.off);
        if (!(await confirmDialog({ title: 'Désactiver ce compte ?', danger: true, confirmLabel: 'Désactiver', message: `${u.first_name} ${u.last_name} ne pourra plus se connecter. Ses données (notes, saisies) sont conservées.` }))) return;
        try { await api.del(`/settings/users/${u.id}`); toastOk('Compte désactivé'); load(); } catch (e) { toastErr('Désactivation impossible', e.message); }
      }));
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

function userForm(current, onDone) {
  const c = current || {};
  modal({
    title: c.id ? `Compte de ${c.first_name} ${c.last_name}` : 'Nouveau compte utilisateur', icon: c.id ? 'pencil' : 'user-plus',
    subtitle: c.id ? 'Modifiez le rôle ou désactivez l’accès.' : 'Sans e-mail, un mot de passe temporaire est généré automatiquement.',
    body: `<form id="uf-form"><div class="grid-2">
        ${field({ label: 'Prénom', name: 'first_name', value: c.first_name || '', required: true })}
        ${field({ label: 'Nom', name: 'last_name', value: c.last_name || '', required: true })}
        ${field({ label: 'Rôle', name: 'role', type: 'select', value: c.role || 'enseignant', required: true, options: dictEntries(ROLES).filter((o) => o.value !== 'super_admin').map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Genre', name: 'gender', type: 'select', value: c.gender || '', placeholder: '—', options: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }] })}
        ${field({ label: 'E-mail (identifiant)', name: 'email', type: 'email', value: c.email || '', disabled: !!c.id })}
        ${field({ label: 'Téléphone', name: 'phone', type: 'tel', value: c.phone || '' })}
        ${c.id ? field({ label: 'Compte actif', name: 'is_active', type: 'switch', value: !!c.is_active }) : ''}
        ${c.id ? field({ label: 'Exiger la double authentification', name: 'two_factor', type: 'switch', value: !!c.two_factor }) : ''}
      </div>
      <div class="alert alert-info mt-3" id="uf-role-hint"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="uf-go">${icon('save', { size: 15 })} ${c.id ? 'Enregistrer' : 'Créer le compte'}</button>`,
    onMount: (layer, close) => {
      const hint = layer.querySelector('#uf-role-hint');
      const HINTS = {
        direction: 'Accès complet : pédagogie, finances, RH, paramètres et validation des bulletins.',
        censeur: 'Pédagogie et vie scolaire : notes, bulletins, conseils de classe, discipline.',
        comptable: 'Finances : facturation, encaissements Mobile Money, dépenses, paie.',
        secretaire: 'Scolarité : élèves, inscriptions, documents administratifs, annonces.',
        enseignant: 'Ses classes uniquement : appel, cahier de textes, notes, devoirs.',
        surveillant: 'Vie scolaire : appel, absences, discipline, cantine.',
        bibliothecaire: 'Bibliothèque : catalogue, prêts et retours.',
        infirmier: 'Infirmerie : registre des interventions de santé.',
        parent: 'Portail famille : ses enfants, notes, absences, factures et paiement.',
        eleve: 'Portail élève : ses notes, devoirs, emploi du temps et présences.',
      };
      const paint = () => {
        const ro = layer.querySelector('[name=role]').value;
        hint.innerHTML = `${icon('shield-check', { size: 16 })}<div class="alert-body"><div class="alert-title">${esc(dictLabel(ROLES, ro))}</div>
          <div class="alert-msg">${esc(HINTS[ro] || '')}</div></div>`;
      };
      layer.querySelector('[name=role]').addEventListener('change', paint);
      paint();
      layer.querySelector('#uf-go').addEventListener('click', () => withBusy(layer.querySelector('#uf-go'), async () => {
        const payload = readForm(layer.querySelector('#uf-form'));
        if (!payload.first_name || !payload.last_name) return toastErr('Champs requis');
        if (payload.is_active !== undefined) payload.is_active = !!payload.is_active;
        if (payload.two_factor !== undefined) payload.two_factor = !!payload.two_factor;
        try {
          if (c.id) {
            await api.patch(`/settings/users/${c.id}`, payload);
            toastOk('Compte mis à jour');
          } else {
            const r = await api.post('/settings/users', payload);
            if (r.data?.tempPassword) {
              modal({
                title: 'Compte créé', icon: 'check-circle', size: 'modal-narrow',
                body: `<p class="small">Identifiant : <b>${esc(payload.first_name)} ${esc(payload.last_name)}</b> (sans e-mail).</p>
                  <div class="temp-pw"><code>${esc(r.data.tempPassword)}</code></div>
                  <p class="tiny subtle mt-3">Ce mot de passe doit être changé à la première connexion.</p>`,
                footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
                  <button class="btn btn-primary" id="tp-copy">${icon('copy', { size: 15 })} Copier</button>`,
                onMount: (l2) => l2.querySelector('#tp-copy').addEventListener('click', () => copyText(r.data.tempPassword)),
              });
            } else toastOk('Compte créé', payload.email ? `Un accès a été créé pour ${payload.email}.` : '');
          }
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* ABONNEMENT                                                          */
/* ================================================================== */
async function subscriptionView(el) {
  el.innerHTML = spinnerNote('Chargement de votre abonnement…');
  try {
    const r = await api.get('/settings/plans');
    const d = r.data || {};
    const plans = d.plans || [];
    const used = d.effectif || 0;
    const max = d.max_students || 0;

    el.innerHTML = `
      <div class="card"><div class="card-body">
        <div class="row gap-4 wrap" style="align-items:center">
          <div class="grow" style="min-width:240px">
            <h1 class="h-page" style="margin:0">Abonnement ${esc(d.current || '')}</h1>
            <p class="subtle small">${d.status === 'trial' ? `Essai gratuit jusqu'au ${dateFr(d.trial_ends_at)}` : `Statut : ${esc(d.status || 'active')} · ${num(used)} élève(s) sur ${num(max)} places`}</p>
            <div class="mt-3" style="max-width:360px">${progress(max ? Math.round((used / max) * 100) : 0, used >= max ? 'danger' : used >= max * 0.8 ? 'warn' : 'ok')}
              <span class="tiny num">${pct(max ? Math.round((used / max) * 100) : 0)} des places utilisées</span></div>
          </div>
          <div class="grid grid-kpi" style="min-width:240px;flex:1">
            ${kpi('Effectif déclaré', num(used), 'users', 'brand', 'Élèves actifs')}
            ${kpi('Places incluses', num(max), 'ticket', 'info', max ? `${num(Math.max(0, max - used))} disponible(s)` : 'Illimité')}
            ${kpi('Coût mensuel', xof(plans.find((p) => p.current)?.price || 0), 'wallet', 'ok', 'Facturation en FCFA')}
          </div>
        </div></div></div>

      <div class="plans-grid mt-4">
        ${plans.map((p) => `<article class="plan-card ${p.current ? 'is-current' : ''} ${p.popular ? 'is-popular' : ''}">
          ${p.popular ? '<span class="plan-flag">Le plus choisi</span>' : ''}
          <div class="plan-head">
            <h3>${esc(p.name)}</h3>
            <div class="plan-price"><b class="num">${xof(p.price)}</b><span>/ ${esc(p.period || 'mois')}</span></div>
            <p class="plan-tagline">${esc(p.tagline || '')}</p>
          </div>
          <ul class="plan-features">
            ${(p.features || []).map((x) => `<li>${icon('check-circle', { size: 14 })} ${esc(x)}</li>`).join('')}
          </ul>
          <div class="plan-foot">
            <div class="tiny subtle mb-2">Jusqu'à <b class="num">${p.maxStudents >= 99999 ? 'illimité' : num(p.maxStudents)}</b> élèves</div>
            ${p.current ? badge('Plan actuel', 'ok') : `<button class="btn ${p.id === 'elite' ? 'btn-primary' : 'btn-secondary'}" data-plan="${esc(p.id)}" style="width:100%">${icon('rocket', { size: 15 })} Passer à ${esc(p.name)}</button>`}
          </div></article>`).join('')}
      </div>

      <div class="card mt-4"><div class="card-body">
        <h3 class="h-card">${icon('help-circle', { size: 15 })} Comment ça marche ?</h3>
        <div class="grid-2">
          <div><p class="small" style="line-height:1.65;color:var(--text-2)">Le paiement se fait par Mobile Money ou virement après validation de votre commande.
            Vous pouvez changer de plan à tout moment ; la limite d'élèves est appliquée immédiatement.</p></div>
          <div><p class="small" style="line-height:1.65;color:var(--text-2)">Besoin d'un devis pour un réseau d'établissements ou d'une installation sur vos serveurs ?
            Écrivez-nous : <a class="link link-strong" href="mailto:contact@sunuecole.app">contact@sunuecole.app</a>.</p></div>
        </div></div></div>`;

    el.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
      const plan = plans.find((p) => p.id === b.dataset.plan);
      const period = await new Promise((resolve) => {
        modal({
          title: `Passer au plan ${plan.name}`, icon: 'rocket', size: 'modal-narrow',
          body: `<p class="small">Choisissez votre cycle de facturation :</p>
            <div class="list mt-3">
              <label class="list-item clickable"><input type="radio" name="period" value="monthly" checked style="margin-right:10px">
                <span class="li-body"><span class="li-title small">Mensuel</span><span class="li-sub">${xof(plan.price)} / mois</span></span></label>
              <label class="list-item clickable"><input type="radio" name="period" value="yearly" style="margin-right:10px">
                <span class="li-body"><span class="li-title small">Annuel <b class="badge badge-ok">-15 %</b></span><span class="li-sub">${xof(Math.round(plan.price * 12 * 0.85))} / an</span></span></label>
            </div>`,
          footer: `<button class="btn btn-secondary" data-cancel>Annuler</button><button class="btn btn-primary" data-ok>Continuer</button>`,
          onMount: (layer, close) => {
            layer.querySelector('[data-cancel]').addEventListener('click', () => { close(); resolve(null); });
            layer.querySelector('[data-ok]').addEventListener('click', () => { const v = layer.querySelector('[name=period]:checked').value; close(); resolve(v); });
          },
        });
      });
      if (!period) return;
      try {
        const r2 = await api.post('/settings/subscription', { plan: plan.id, period });
        toastOk('Abonnement mis à jour', `Plan ${r2.data?.name || plan.name} — ${xof(r2.data?.price || plan.price)} (${period === 'yearly' ? 'annuel' : 'mensuel'}).`);
        subscriptionView(el);
      } catch (e) { toastErr('Changement impossible', e.message); }
    }));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Abonnement indisponible', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* JOURNAL D'AUDIT                                                     */
/* ================================================================== */
async function auditView(el, query = {}) {
  const f = { q: query.q || '', action: query.action || '', entity: query.entity || '', page: 1, limit: 30 };
  el.innerHTML = `
    <div class="grid grid-kpi" id="au-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="au-toolbar"></div>
      <div class="card-body" style="padding:0" id="au-table">${skeletonRows(9, 5)}</div>
      <div class="card-foot" id="au-pager"></div>
    </div>`;
  let filters = { actions: [], entities: [] };
  const load = debounce(async () => {
    const t = el.querySelector('#au-table');
    t.innerHTML = skeletonRows(9, 5);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.q) q.set('q', f.q);
      if (f.action) q.set('action', f.action);
      if (f.entity) q.set('entity', f.entity);
      const r = await api.get(`/settings/audit?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      filters = r.filters || filters;

      el.querySelector('#au-kpis').innerHTML = [
        kpi('Opérations tracées', num(total), 'history', 'brand', 'Journal infalsifiable'),
        kpi('Sur cette page', num(rows.length), 'list', 'info', `${rows.filter((x) => x.action === 'delete').length} suppression(s)`),
        kpi('Dernière activité', rows[0] ? relatif(rows[0].created_at) : '—', 'activity', 'neutral', rows[0] ? esc(rows[0].user_name || '') : ''),
      ].join('');

      el.querySelector('#au-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Utilisateur, résumé…',
        filters: `<select class="select select-sm" data-f="action"><option value="">Toutes actions</option>
            ${(filters.actions || []).map((a) => `<option value="${esc(a)}" ${f.action === a ? 'selected' : ''}>${esc(ACTION_LABELS[a]?.label || a)}</option>`).join('')}</select>
          <select class="select select-sm" data-f="entity"><option value="">Toutes entités</option>
            ${(filters.entities || []).map((e) => `<option value="${esc(e)}" ${f.entity === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>`,
        actions: `<button class="btn btn-secondary" id="au-export">${icon('download', { size: 15 })} Exporter</button>`,
      });
      const tb = el.querySelector('#au-toolbar');
      tb.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300));
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#au-export').addEventListener('click', () => {
        const csv = ['date;utilisateur;action;entite;id;resume;ip',
          ...rows.map((x) => [x.created_at, x.user_name, x.action, x.entity, x.entity_id, `"${String(x.summary || '').replace(/"/g, '""')}"`, x.ip].join(';'))].join('\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `audit-${aujourdhui()}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toastOk('Export CSV généré', `${rows.length} ligne(s).`);
      });

      t.innerHTML = dataTable({
        columns: [
          { key: 'date', label: 'Horodatage', width: '160px', render: (x) => `<span class="small num">${dateFr(x.created_at)} ${heureFr(x.created_at)}</span><div class="tiny subtle">${relatif(x.created_at)}</div>` },
          { key: 'qui', label: 'Utilisateur', width: '180px', render: (x) => `<div class="cell-user">${avatar({ first: (x.user_name || '?')[0], last: (x.user_name || '').split(' ')[1] || '', size: 'avatar-xs' })}<div><div class="cell-user-name small">${esc(x.user_name || 'système')}</div></div></div>` },
          { key: 'action', label: 'Action', width: '130px', render: (x) => badge(ACTION_LABELS[x.action]?.label || x.action, ACTION_LABELS[x.action]?.tone || 'neutral') },
          { key: 'entite', label: 'Entité', width: '150px', hideBelow: 'md', render: (x) => `<span class="small">${esc(x.entity || '')}${x.entity_id ? ` <span class="tiny subtle num">#${esc(x.entity_id)}</span>` : ''}</span>` },
          { key: 'resume', label: 'Détail', render: (x) => `<span class="small">${esc(x.summary || '—')}</span>` },
          { key: 'ip', label: 'IP', width: '120px', hideBelow: 'lg', render: (x) => `<span class="num tiny subtle">${esc(x.ip || '')}</span>` },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'history', title: 'Journal vide', message: 'Aucune opération ne correspond à ces filtres.' },
      }).outerHTML;

      const pager = el.querySelector('#au-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'entrées' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Journal indisponible', message: err.message });
    }
  }, 220);
  await load.flush();
}

/* ================================================================== */
/* MES PRÉFÉRENCES                                                     */
/* ================================================================== */
async function preferencesView(el) {
  const user = store.state.user || {};
  const prefs = { ...getPrefs(), ...(user.preferences || {}) };
  el.innerHTML = spinnerNote('Chargement de vos préférences…');
  try {
    const sessions = await api.get('/auth/sessions').catch(() => ({ sessions: [] }));
    el.innerHTML = `
      <div class="grid-2-1">
        <div>
          ${sectionCard('Mon profil', 'user', `<form id="pf-form" class="form-grid"><div class="grid-2">
              ${field({ label: 'Prénom', name: 'first_name', value: user.first_name || '' })}
              ${field({ label: 'Nom', name: 'last_name', value: user.last_name || '' })}
              ${field({ label: 'Téléphone', name: 'phone', type: 'tel', value: user.phone || '' })}
              ${field({ label: 'Genre', name: 'gender', type: 'select', value: user.gender || '', placeholder: '—', options: [{ value: 'M', label: 'Masculin' }, { value: 'F', label: 'Féminin' }] })}
            </div>
            ${field({ label: 'E-mail (identifiant, non modifiable)', name: 'email', value: user.email || '', disabled: true })}
          </form>`, `<button class="btn btn-primary" id="pf-save">${icon('save', { size: 15 })} Enregistrer</button>`)}

          <div class="mt-4">${sectionCard('Apparence & confort', 'palette', `<form id="ap-form">
            <div class="grid-2">
              ${field({ label: 'Thème', name: 'theme', type: 'select', value: prefs.theme || 'auto', options: [{ value: 'auto', label: 'Automatique (système)' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }] })}
              ${field({ label: 'Densité', name: 'density', type: 'select', value: prefs.density || 'confort', options: [{ value: 'compact', label: 'Compacte' }, { value: 'confort', label: 'Confortable' }, { value: 'spacieux', label: 'Spacieuse' }] })}
            </div>
            <p class="wizard-note">Vos préférences sont appliquées avant l'affichage de la page (aucun clignotement) et synchronisées sur tous vos appareils.</p>
          </form>`, `<button class="btn btn-primary" id="ap-save">${icon('check', { size: 15 })} Appliquer</button>`)}</div>

          <div class="mt-4">${sectionCard('Sécurité du compte', 'lock', `
            <form id="pw-form">
              ${field({ label: 'Mot de passe actuel', name: 'currentPassword', type: 'password', required: true, placeholder: '••••••••' })}
              <div class="grid-2">
                ${field({ label: 'Nouveau mot de passe', name: 'newPassword', type: 'password', required: true, hint: '8 caractères minimum' })}
                ${field({ label: 'Confirmation', name: 'confirm', type: 'password', required: true })}
              </div>
              <div class="pw-meter" id="pw-meter"><span></span></div>
            </form>
            <div class="row gap-2 wrap mt-3">
              <button class="btn btn-primary" id="pw-save">${icon('key', { size: 15 })} Changer le mot de passe</button>
              <button class="btn btn-secondary" id="pw-2fa">${icon('shield-check', { size: 15 })} ${user.two_factor ? 'Désactiver' : 'Activer'} la double authentification</button>
            </div>
            <p class="wizard-note">La double authentification ajoute un code à 6 chiffres demandé à chaque connexion sur un nouvel appareil.</p>`)}</div>
        </div>

        <div>
          ${sectionCard('Appareils connectés', 'smartphone', (sessions.sessions || []).length ? `<div class="list">${sessions.sessions.map((s) => `<div class="list-item">
              <span class="li-ico" data-tone="${s.revoked ? 'neutral' : 'ok'}">${icon('smartphone', { size: 15 })}</span>
              <span class="li-body"><span class="li-title small">${esc(s.device || 'Appareil inconnu')}</span>
                <span class="li-sub">${esc(s.ip || '')} · ${relatif(s.createdAt)}</span></span>
              <span class="li-aside">${s.revoked ? badge('Révoquée', 'neutral') : `<button class="btn btn-secondary btn-sm" data-rev="${s.id}">Révoquer</button>`}</span></div>`).join('')}</div>`
            : '<p class="subtle small">Aucune session active enregistrée.</p>')}
          <div class="mt-4">${sectionCard('Mon rôle', 'shield-check', `
            <div class="row gap-2 wrap">${badge(dictLabel(ROLES, user.role), 'brand')}${badge(`Niveau ${store.level()}`, 'info')}</div>
            <p class="small mt-3" style="line-height:1.6;color:var(--text-2)">${esc({
              direction: 'Vous pilotez l’établissement : pédagogie, finances, personnel et paramètres.',
              censeur: 'Vous suivez la pédagogie : notes, bulletins, conseils de classe et discipline.',
              comptable: 'Vous gérez la facturation, les encaissements, les dépenses et la paie.',
              secretaire: 'Vous tenez la scolarité : élèves, familles, documents et annonces.',
              enseignant: 'Vous faites l’appel, saisissez vos notes et publiez vos devoirs.',
              surveillant: 'Vous assurez l’appel, le suivi des absences et la discipline.',
              bibliothecaire: 'Vous gérez le catalogue et les prêts d’ouvrages.',
              infirmier: 'Vous tenez le registre des interventions de santé.',
              parent: 'Vous suivez la scolarité et les paiements de vos enfants.',
              eleve: 'Tu suis tes notes, tes devoirs et ton emploi du temps.',
              super_admin: 'Vous administrez la plateforme et tous les établissements.',
            }[user.role] || '')}</p>`)}
          </div>
          <div class="mt-4">${sectionCard('Application mobile', 'download', `<p class="small" style="line-height:1.6;color:var(--text-2)">
              Installez SunuÉcole sur votre téléphone : accès rapide, fonctionnement hors-ligne et notifications.</p>
            <button class="btn btn-secondary mt-3" id="pf-install" style="width:100%">${icon('download', { size: 15 })} Installer l'application</button>`)}</div>
        </div>
      </div>`;

    el.querySelector('#pf-save').addEventListener('click', () => withBusy(el.querySelector('#pf-save'), async () => {
      try {
        const r = await api.patch('/auth/profile', readForm(el.querySelector('#pf-form')));
        store.set({ user: { ...store.state.user, ...(r.user || {}) } });
        toastOk('Profil mis à jour');
      } catch (e) { toastErr('Enregistrement impossible', e.message); }
    }));

    el.querySelector('#ap-save').addEventListener('click', () => {
      const p = readForm(el.querySelector('#ap-form'));
      updatePrefs({ theme: p.theme, density: p.density });
      toastOk('Apparence appliquée', `${dictLabel({ auto: 'Automatique', light: 'Clair', dark: 'Sombre' }, p.theme)} · ${p.density}.`);
    });

    const meter = el.querySelector('#pw-meter');
    el.querySelector('[name=newPassword]').addEventListener('input', (e) => {
      const v = e.target.value;
      const score = [v.length >= 8, /[A-Z]/.test(v), /[0-9]/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
      meter.dataset.score = String(score);
      meter.querySelector('span').style.width = `${(score / 4) * 100}%`;
    });

    el.querySelector('#pw-save').addEventListener('click', () => withBusy(el.querySelector('#pw-save'), async () => {
      const p = readForm(el.querySelector('#pw-form'));
      if (p.newPassword !== p.confirm) return toastErr('Confirmation différente', 'Les deux mots de passe ne correspondent pas.');
      if (String(p.newPassword || '').length < 8) return toastErr('Mot de passe trop court', '8 caractères minimum.');
      try {
        await api.post('/auth/change-password', { currentPassword: p.currentPassword, newPassword: p.newPassword });
        toastOk('Mot de passe changé', 'Vos autres sessions restent connectées.');
        el.querySelector('#pw-form').reset();
        meter.dataset.score = '0';
        meter.querySelector('span').style.width = '0%';
      } catch (e) { toastErr('Changement impossible', e.message); }
    }));

    el.querySelector('#pw-2fa').addEventListener('click', async () => {
      const enable = !user.two_factor;
      try {
        await api.post('/auth/two-factor', { enable });
        store.set({ user: { ...store.state.user, two_factor: enable } });
        toastOk(enable ? 'Double authentification activée' : 'Double authentification désactivée');
        preferencesView(el);
      } catch (e) { toastErr('Modification impossible', e.message); }
    });

    el.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Révoquer cette session ?', danger: true, confirmLabel: 'Révoquer', message: 'L’appareil devra se reconnecter avec le mot de passe.' }))) return;
      try { await api.del(`/auth/sessions/${b.dataset.rev}`); toastOk('Session révoquée'); preferencesView(el); } catch (e) { toastErr('Révocation impossible', e.message); }
    }));

    el.querySelector('#pf-install')?.addEventListener('click', () => {
      if (typeof window.sunuecoleInstall === 'function') window.sunuecoleInstall();
      else toastInfo('Installation indisponible', 'Utilisez « Ajouter à l’écran d’accueil » dans le menu de votre navigateur.');
    });
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Préférences indisponibles', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
const SECTIONS = {
  structure: { title: 'Structure & matières', render: structureView, level: 65 },
  utilisateurs: { title: 'Comptes & droits', render: usersView, level: 65 },
  abonnement: { title: 'Abonnement', render: subscriptionView, level: 0 },
  audit: { title: 'Journal d’audit', render: auditView, level: 75 },
  preferences: { title: 'Mes préférences', render: preferencesView, level: 0 },
};

export function registerSettings(route) {
  route('/parametres', async ({ query }) => { const el = h('<div class="view"></div>'); schoolView(el, query); return el; }, { title: 'Établissement', group: 'Paramètres' });
  route('/parametres/:section', async ({ params, query }) => {
    const el = h('<div class="view"></div>');
    const cfg = SECTIONS[params.section];
    if (!cfg) {
      el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'settings', title: 'Section introuvable', message: 'Choisissez une section dans le menu Paramètres.' })}</div></div>`;
      return el;
    }
    if (cfg.level && !store.atLeast(cfg.level)) {
      el.innerHTML = `<div class="card"><div class="card-body">${emptyState({
        icon: 'lock', title: 'Accès restreint',
        message: 'Cette section est réservée à la direction et au secrétariat. Contactez un administrateur si vous devez y accéder.',
      })}</div></div>`;
      return el;
    }
    cfg.render(el, query);
    return el;
  }, { title: 'Paramètres', group: 'Paramètres' });
}

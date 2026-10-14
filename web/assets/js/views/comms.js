/**
 * SunuÉcole — Communication : annonces, campagnes SMS et calendrier scolaire.
 *
 * Trois usages critiques pour une école en Afrique francophone :
 *  1. prévenir vite (annonce + notification + SMS en une action),
 *  2. recouvrer (campagnes SMS ciblées avec coût estimé en FCFA),
 *  3. planifier (calendrier avec jours fériés, conseils et remises de bulletins).
 */
import { api } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, emptyState, skeletonRows, dataTable, pagination, wirePagination, toolbar,
  field, readForm, modal, drawer, confirmDialog, toastOk, toastErr, debounce, withBusy, copyText,
} from '../ui/components.js';
import {
  xof, num, pct, dateFr, dateLong, heureFr, relatif, aujourdhui, joursEntre, telFr,
  dictLabel, dictEntries, MOIS, TYPES_EVENEMENT, ROLES,
} from '../core/format.js';
import { donutChart } from '../core/charts.js';

/* ================================================================== */
/* Référentiels                                                        */
/* ================================================================== */
const TYPES_MESSAGE = {
  annonce: { label: 'Annonce', tone: 'info' }, urgence: { label: 'Urgence', tone: 'danger' },
  pedagogie: { label: 'Pédagogie', tone: 'brand' }, finance: { label: 'Finances', tone: 'warn' },
  evenement: { label: 'Événement', tone: 'neutral' },
};
const PRIORITES = { normale: { label: 'Normale', tone: 'neutral' }, haute: { label: 'Haute', tone: 'warn' }, urgente: { label: 'Urgente', tone: 'danger' } };
const STATUT_SMS = {
  en_attente: { label: 'En file', tone: 'warn' }, programme: { label: 'Programmé', tone: 'info' },
  envoye: { label: 'Envoyé', tone: 'ok' }, echoue: { label: 'Échoué', tone: 'danger' },
};
const AUDIENCES = [
  { value: 'tous_parents', label: 'Tous les parents (SMS opt-in)' },
  { value: 'classe', label: 'Parents d’une classe' },
  { value: 'impayes', label: 'Familles avec solde impayé' },
  { value: 'libre', label: 'Numéros saisis manuellement' },
];
const ROLES_AUDIENCE = ['parent', 'eleve', 'enseignant', 'direction', 'secretaire', 'comptable'];
const PRET_SMS = 25; // FCFA par segment de 160 caractères

const spinnerNote = (t) => `<div class="row gap-3 subtle small" style="justify-content:center;padding:36px"><span class="spinner"></span>${esc(t)}</div>`;
const kpi = (label, value, ic, tone, hint) => `<div class="kpi"><div class="kpi-top">
    <span class="kpi-ico" data-tone="${tone}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
  <div class="kpi-val" style="font-size:22px">${esc(value)}</div>
  <div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
const tone = (dict, key, fb = 'neutral') => (dict[key] && typeof dict[key] === 'object' ? dict[key].tone || fb : fb);
const segments = (t) => Math.max(1, Math.ceil(String(t || '').length / 160));

/* ================================================================== */
/* ANNONCES & MESSAGES                                                 */
/* ================================================================== */
async function messagesView(el, query = {}) {
  const f = { q: query.q || '', type: query.type || '', page: 1, limit: 20 };
  el.innerHTML = `
    <div class="grid grid-kpi" id="ms-kpis">${Array.from({ length: 3 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="card mt-4">
      <div class="card-body" id="ms-toolbar"></div>
      <div class="card-body" style="padding:0" id="ms-table">${skeletonRows(6, 4)}</div>
      <div class="card-foot" id="ms-pager"></div>
    </div>`;

  const load = debounce(async () => {
    const t = el.querySelector('#ms-table');
    t.innerHTML = skeletonRows(6, 4);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.q) q.set('q', f.q);
      if (f.type) q.set('type', f.type);
      const r = await api.get(`/comms/messages?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      const epingles = rows.filter((x) => x.pinned).length;
      el.querySelector('#ms-kpis').innerHTML = [
        kpi('Messages publiés', num(total), 'megaphone', 'brand', 'Annonces, urgences, pédagogie'),
        kpi('Non lus pour vous', num(r.unread || 0), 'bell', r.unread ? 'warn' : 'ok', r.unread ? 'Ouvrez-les pour les marquer lus' : 'Vous êtes à jour'),
        kpi('Épinglés', num(epingles), 'bookmark', 'info', 'Affichés en tête de liste'),
      ].join('');

      el.querySelector('#ms-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Objet, expéditeur, contenu…',
        filters: `<select class="select select-sm" data-f="type"><option value="">Tous les types</option>
          ${dictEntries(TYPES_MESSAGE).map((o) => `<option value="${o.value}" ${f.type === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: store.atLeast(50) ? `<button class="btn btn-primary" id="ms-new">${icon('send', { size: 15 })} Nouvelle annonce</button>` : '',
      });
      const tb = el.querySelector('#ms-toolbar');
      tb.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; load(); }, 300));
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#ms-new')?.addEventListener('click', () => composeModal(null, load));

      t.innerHTML = rows.length ? `<div class="list list-plain">${rows.map((x) => `<article class="msg-item ${x.pinned ? 'is-pinned' : ''}" data-id="${x.id}" tabindex="0" role="button">
          <span class="msg-ico" data-tone="${tone(TYPES_MESSAGE, x.msg_type)}">${icon(x.priority === 'urgente' ? 'alert-triangle' : x.msg_type === 'finance' ? 'banknote' : 'megaphone', { size: 16 })}</span>
          <div class="msg-body">
            <div class="msg-top">
              <b class="msg-subject">${x.pinned ? `${icon('bookmark', { size: 12 })} ` : ''}${esc(x.subject)}</b>
              <span class="grow"></span>
              <span class="tiny subtle num">${dateFr(x.sent_at)} ${heureFr(x.sent_at)}</span>
            </div>
            <p class="msg-excerpt">${esc(String(x.body || '').slice(0, 180))}${String(x.body || '').length > 180 ? '…' : ''}</p>
            <div class="row gap-1 wrap mt-2">
              ${badge(dictLabel(TYPES_MESSAGE, x.msg_type), tone(TYPES_MESSAGE, x.msg_type))}
              ${x.priority !== 'normale' ? badge(dictLabel(PRIORITES, x.priority), tone(PRIORITES, x.priority)) : ''}
              ${x.notify_sms ? badge('SMS envoyé', 'info') : ''}
              ${(x.audience?.roles || []).slice(0, 3).map((ro) => badge(dictLabel(ROLES, ro) || ro, 'neutral')).join('')}
              <span class="tiny subtle">par ${esc(x.sender_name || '—')}</span>
            </div>
          </div>
        </article>`).join('')}</div>`
        : emptyState({ icon: 'megaphone', title: 'Aucune annonce', message: 'Publiez votre premier message pour informer familles et personnels.' });

      t.querySelectorAll('[data-id]').forEach((card) => {
        const open = () => messageDrawer(Number(card.dataset.id), rows.find((x) => String(x.id) === card.dataset.id), load);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });

      const pager = el.querySelector('#ms-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'messages' });
      wirePagination(pager, (p) => { f.page = p; load(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
}

function messageDrawer(id, preview, onDone) {
  const panel = h('<div class="print-area"></div>');
  panel.innerHTML = preview ? renderMessage(preview) : spinnerNote('Chargement du message…');
  drawer({
    title: preview?.subject || 'Message', subtitle: preview ? `${esc(preview.sender_name || '')} · ${dateLong(preview.sent_at)}` : '',
    wide: true, body: panel,
    footer: `<div class="row gap-2 wrap grow">
        <button class="btn btn-secondary" id="md-copy">${icon('copy', { size: 15 })} Copier</button>
        <button class="btn btn-secondary" id="md-print">${icon('printer', { size: 15 })} Imprimer</button>
        ${store.atLeast(65) ? `<button class="btn btn-danger" id="md-del">${icon('trash', { size: 15 })} Retirer</button>` : ''}
        <span class="grow"></span>
        <button class="btn btn-primary" id="md-again">${icon('send', { size: 15 })} Renvoyer</button></div>`,
    onMount: (layer, close) => {
      layer.querySelector('#md-print').addEventListener('click', () => window.print());
      layer.querySelector('#md-copy').addEventListener('click', () => copyText(panel.innerText));
      layer.querySelector('#md-again').addEventListener('click', () => { close(); composeModal(preview ? { ...preview, subject: `[Rappel] ${preview.subject}` } : null, onDone); });
      layer.querySelector('#md-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Retirer ce message ?', danger: true, confirmLabel: 'Retirer', message: 'Le message ne sera plus visible par les destinataires. Les notifications déjà envoyées restent.' }))) return;
        try { await api.del(`/comms/messages/${id}`); toastOk('Message retiré'); close(); onDone?.(); } catch (e) { toastErr('Suppression impossible', e.message); }
      });
      if (!preview) {
        api.get(`/comms/messages/${id}`).then((r) => {
          const m = r.data?.message || r.data;
          layer.querySelector('.drawer-head h2').textContent = m.subject || 'Message';
          panel.innerHTML = renderMessage(m);
        }).catch((e) => { panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Message indisponible', message: e.message }); });
      }
    },
  });
}

function renderMessage(m) {
  return `<div class="msg-full">
    <div class="row gap-2 wrap mb-3">
      ${badge(dictLabel(TYPES_MESSAGE, m.msg_type), tone(TYPES_MESSAGE, m.msg_type))}
      ${m.priority !== 'normale' ? badge(dictLabel(PRIORITES, m.priority), tone(PRIORITES, m.priority)) : ''}
      ${m.pinned ? badge('Épinglé', 'brand') : ''}
      ${m.notify_sms ? badge('Doublé par SMS', 'info') : ''}
      ${m.notify_email ? badge('Doublé par e-mail', 'info') : ''}
      ${m.expires_at ? badge(`Expire le ${dateFr(m.expires_at)}`, 'warn') : ''}
    </div>
    <h2 class="h-card" style="font-size:18px">${esc(m.subject || '')}</h2>
    <p class="subtle small mb-4">${esc(m.sender_name || '')} · ${dateLong(m.sent_at)} à ${heureFr(m.sent_at)} (${relatif(m.sent_at)})</p>
    <div class="msg-text">${esc(m.body || '').replace(/\n/g, '<br>')}</div>
    ${(m.attachments || []).length ? `<h3 class="h-card mt-4">${icon('archive', { size: 15 })} Pièces jointes</h3>
      <div class="list">${m.attachments.map((a) => `<div class="list-item"><span class="li-ico">${icon('file-text', { size: 14 })}</span>
        <span class="li-body"><span class="li-title small">${esc(a.name || a.url || 'Document')}</span></span></div>`).join('')}</div>` : ''}
    <h3 class="h-card mt-4">${icon('users', { size: 15 })} Destinataires</h3>
    <div class="row gap-1 wrap">${(m.audience?.roles || ['parent']).map((ro) => badge(dictLabel(ROLES, ro) || ro, 'neutral')).join('')}${m.audience?.userIds?.length ? badge(`${num(m.audience.userIds.length)} comptes précis`, 'info') : ''}</div>
  </div>`;
}

function composeModal(prefill, onDone) {
  const p = prefill || {};
  modal({
    title: p.id ? 'Renvoyer l’annonce' : 'Nouvelle annonce', icon: 'megaphone',
    subtitle: 'Publié dans l’application, et doublé par SMS pour les parents qui l’ont accepté.',
    body: `<form id="cm-form">
      ${field({ label: 'Objet', name: 'subject', value: p.subject || '', required: true, placeholder: 'Ex. : Réunion des parents samedi' })}
      <div class="grid-2">
        ${field({ label: 'Type', name: 'msg_type', type: 'select', value: p.msg_type || 'annonce', options: dictEntries(TYPES_MESSAGE).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Priorité', name: 'priority', type: 'select', value: p.priority || 'normale', options: dictEntries(PRIORITES).map((o) => ({ value: o.value, label: o.label })) })}
      </div>
      ${field({ label: 'Message', name: 'body', type: 'textarea', rows: 6, value: p.body || '', required: true, placeholder: 'Rédigez un message clair et court : quoi, quand, où, que faire.' })}
      <div class="wizard-step mt-3">
        <div class="wizard-head"><span>Destinataires</span></div>
        <div class="row gap-2 wrap" id="cm-roles">
          ${ROLES_AUDIENCE.map((ro) => `<label class="chip-check"><input type="checkbox" name="role_${ro}" value="${ro}" ${(p.audience?.roles || ['parent', 'eleve']).includes(ro) ? 'checked' : ''}>
            <span>${esc(dictLabel(ROLES, ro) || ro)}</span></label>`).join('')}
        </div>
      </div>
      <div class="grid-2 mt-3">
        ${field({ label: 'Doubler par SMS (parents)', name: 'notify_sms', type: 'switch', value: p.notify_sms ?? true, hint: `${PRET_SMS} FCFA / segment de 160 caractères` })}
        ${field({ label: 'Doubler par e-mail', name: 'notify_email', type: 'switch', value: p.notify_email ?? false })}
      </div>
      ${field({ label: 'Épingler en haut de la liste', name: 'pinned', type: 'switch', value: p.pinned ?? false })}
      ${field({ label: 'Expire le (optionnel)', name: 'expires_at', type: 'date', value: p.expires_at || '', hint: 'Utile pour une urgence datée.' })}
      <div class="campaign-preview mt-3" id="cm-cost"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="cm-go">${icon('send', { size: 15 })} Publier</button>`,
    onMount: (layer, close) => {
      const body = layer.querySelector('[name=body]');
      const cost = layer.querySelector('#cm-cost');
      const paint = () => {
        const wantSms = layer.querySelector('[name=notify_sms]').checked;
        const parents = layer.querySelector('[name=role_parent]').checked;
        const seg = segments(body.value);
        cost.innerHTML = wantSms && parents
          ? `${icon('sms', { size: 15 })} <b>${seg}</b> segment(s) de 160 caractères seront envoyés aux parents ayant accepté les SMS. Coût : <b class="num">${PRET_SMS} FCFA</b> par SMS (total visible après publication).`
          : `${icon('info', { size: 15 })} Diffusion dans l’application uniquement — aucun coût SMS.`;
      };
      body.addEventListener('input', debounce(paint, 300));
      layer.querySelector('[name=notify_sms]').addEventListener('change', paint);
      layer.querySelector('[name=role_parent]').addEventListener('change', paint);
      paint();

      layer.querySelector('#cm-go').addEventListener('click', () => withBusy(layer.querySelector('#cm-go'), async () => {
        const payload = readForm(layer.querySelector('#cm-form'));
        if (!payload.subject || !payload.body) return toastErr('Champs requis', 'L’objet et le message sont obligatoires.');
        const roles = ROLES_AUDIENCE.filter((ro) => payload[`role_${ro}`]);
        if (!roles.length) return toastErr('Destinataires requis', 'Sélectionnez au moins un rôle.');
        try {
          const r = await api.post('/comms/messages', {
            subject: payload.subject, body: payload.body, msg_type: payload.msg_type, priority: payload.priority,
            pinned: !!payload.pinned, notify_sms: !!payload.notify_sms, notify_email: !!payload.notify_email,
            expires_at: payload.expires_at || null, audience: { roles },
          });
          close();
          toastOk('Annonce publiée', `${num(r.data?.recipients ?? 0)} destinataire(s) notifié(s)${payload.notify_sms ? ' · SMS en file' : ''}.`);
          onDone?.();
        } catch (e) { toastErr('Publication impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* CAMPAGNES SMS                                                       */
/* ================================================================== */
async function smsView(el, query = {}) {
  const f = { status: query.status || '', page: 1, limit: 25 };
  const preset = { to: query.to || '', template: query.template || '', student: query.student || '' };
  el.innerHTML = `
    <div class="grid grid-kpi" id="sm-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="grid-2-1 mt-4">
      <div class="card"><div class="card-body" id="sm-toolbar"></div>
        <div class="card-body" style="padding:0" id="sm-table">${skeletonRows(7, 4)}</div>
        <div class="card-foot" id="sm-pager"></div></div>
      <div>
        <div class="card"><div class="card-body" id="sm-cost"></div></div>
        <div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('note', { size: 15 })} Modèles de messages</h3>
          ${store.atLeast(65) ? '<button class="btn btn-secondary btn-sm" id="sm-tpl-new">Ajouter</button>' : ''}</div>
          <div class="card-body" id="sm-templates"></div></div>
      </div>
    </div>`;

  let templates = [];
  const load = debounce(async () => {
    const t = el.querySelector('#sm-table');
    t.innerHTML = skeletonRows(7, 4);
    try {
      const q = new URLSearchParams({ page: f.page, limit: f.limit });
      if (f.status) q.set('status', f.status);
      const r = await api.get(`/comms/sms?${q}`);
      const rows = r.data || [];
      const total = r.meta?.total || rows.length;
      const st = r.stats || {};
      templates = r.templates || [];
      el.querySelector('#sm-kpis').innerHTML = [
        kpi('SMS au total', num(st.total || total), 'sms', 'brand', `${num(st.segments || 0)} segment(s) facturés`),
        kpi('Envoyés', num(st.envoyes || 0), 'check-circle', 'ok', st.total ? pct(Math.round(((st.envoyes || 0) / st.total) * 100)) : ''),
        kpi('En file / programmés', num((st.en_attente || 0)), 'hourglass', st.en_attente ? 'warn' : 'neutral', 'Prêts à être distribués'),
        kpi('Coût estimé', xof(st.cout_estime || 0), 'coins', 'plum', `${PRET_SMS} FCFA / segment · ${num(st.echoues || 0)} échec(s)`),
      ].join('');

      el.querySelector('#sm-toolbar').innerHTML = toolbar({
        search: null,
        filters: `<select class="select select-sm" data-f="status"><option value="">Tous les statuts</option>
          ${dictEntries(STATUT_SMS).map((o) => `<option value="${o.value}" ${f.status === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: `${store.atLeast(50) ? `<button class="btn btn-secondary" id="sm-dispatch">${icon('zap', { size: 15 })} Distribuer la file</button>` : ''}
          ${store.atLeast(50) ? `<button class="btn btn-primary" id="sm-new">${icon('plus', { size: 15 })} Nouveau SMS</button>` : ''}`,
      });
      const tb = el.querySelector('#sm-toolbar');
      tb.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; load(); }));
      tb.querySelector('#sm-new')?.addEventListener('click', () => smsModal(templates, load, preset));
      tb.querySelector('#sm-dispatch')?.addEventListener('click', async () => {
        if (!(await confirmDialog({
          title: 'Distribuer la file SMS ?', confirmLabel: 'Envoyer maintenant',
          message: `Les messages en attente seront transmis à l’agrégateur (${st.en_attente || 0} SMS · ${xof((st.en_attente || 0) * PRET_SMS)} environ).`,
        }))) return;
        try {
          const d = await api.post('/comms/sms/dispatch');
          toastOk('Distribution terminée', `${num(d.data?.sent || 0)} envoyé(s) · ${num(d.data?.failed || 0)} échec(s) · ${num(d.data?.remaining || 0)} restant(s).`);
          load();
        } catch (e) { toastErr('Distribution impossible', e.message); }
      });

      t.innerHTML = dataTable({
        columns: [
          {
            key: 'dest', label: 'Destinataire', width: '200px', render: (x) => `<div class="cell-user">${avatar({ first: (x.recipient_name || '?')[0], last: '', size: 'avatar-xs' })}
              <div><div class="cell-user-name small">${esc(x.recipient_name || 'Destinataire')}</div><div class="cell-user-sub num">${esc(telFr(x.to_number))}</div></div></div>`,
          },
          { key: 'message', label: 'Message', render: (x) => `<span class="small">${esc(String(x.body || '').slice(0, 120))}${String(x.body || '').length > 120 ? '…' : ''}</span>` },
          { key: 'modele', label: 'Modèle', width: '120px', hideBelow: 'lg', render: (x) => badge(x.template || 'libre', 'neutral') },
          { key: 'quand', label: 'Envoyé', width: '140px', hideBelow: 'md', render: (x) => (x.sent_at ? `<span class="small">${dateFr(x.sent_at)} ${heureFr(x.sent_at)}</span>` : x.scheduled_at ? `<span class="small">programmé ${dateFr(x.scheduled_at)}</span>` : `<span class="tiny subtle">${relatif(x.created_at)}</span>`) },
          { key: 'statut', label: 'Statut', width: '120px', render: (x) => badge(dictLabel(STATUT_SMS, x.status), tone(STATUT_SMS, x.status)) },
          { key: 'act', label: '', width: '110px', align: 'right', render: (x) => (x.status === 'echoue' ? `<button class="btn btn-secondary btn-sm" data-retry="${x.id}">${icon('refresh', { size: 13 })} Renvoyer</button>` : `<button class="btn btn-link btn-sm" data-copy>${icon('copy', { size: 13 })}</button>`) },
        ],
        rows, dense: true, zebra: true,
        empty: { icon: 'sms', title: 'Aucun SMS', message: 'Lancez votre première campagne pour informer les familles.' },
      }).outerHTML;

      t.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
        const row = b.closest('tr');
        copyText(row?.querySelector('td:nth-child(2)')?.innerText || '');
      }));
      t.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => {
        const row = rows.find((x) => String(x.id) === b.dataset.retry);
        smsModal(templates, load, { to: row.to_number, body: row.body });
      }));

      const pager = el.querySelector('#sm-pager');
      pager.innerHTML = pagination({ page: f.page, pages: Math.max(1, Math.ceil(total / f.limit)), total, size: f.limit, label: 'SMS' });
      wirePagination(pager, (p) => { f.page = p; load(); });

      // Panneau coût + modèles
      el.querySelector('#sm-cost').innerHTML = `
        <h3 class="h-card">${icon('chart-pie', { size: 15 })} Répartition des statuts</h3>
        <div id="sm-donut"></div>
        <div class="mt-3 tiny subtle">Tarif appliqué : <b class="num">${PRET_SMS} FCFA</b> par segment de 160 caractères (${esc(r.config?.provider || 'opérateur')}, mode ${esc(r.config?.mode || 'simulated')}).</div>`;
      el.querySelector('#sm-donut')?.appendChild(donutChart([
        { label: 'Envoyés', value: st.envoyes || 0, color: '#0e7c66' },
        { label: 'En file', value: st.en_attente || 0, color: '#d97706' },
        { label: 'Échoués', value: st.echoues || 0, color: '#dc2626' },
      ].filter((x) => x.value > 0), { height: 180, thickness: 22, centerLabel: num(st.total || 0), centerSub: 'SMS' }));

      el.querySelector('#sm-templates').innerHTML = templates.length ? `<div class="list">${templates.map((x) => `<div class="list-item">
          <span class="li-ico">${icon('note', { size: 14 })}</span>
          <span class="li-body"><span class="li-title small">${esc(x.name || x.code)}</span>
            <span class="li-sub">${esc(String(x.body || '').slice(0, 90))}…</span></span>
          <span class="li-aside">${store.atLeast(50) ? `<button class="btn btn-secondary btn-sm" data-use="${esc(x.code)}">Utiliser</button>` : ''}</span></div>`).join('')}</div>`
        : '<p class="subtle small">Aucun modèle — créez-en pour gagner du temps.</p>';
      el.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
        const tpl = templates.find((x) => x.code === b.dataset.use);
        smsModal(templates, load, { ...preset, template: tpl?.code, body: tpl?.body });
      }));
      el.querySelector('#sm-tpl-new')?.addEventListener('click', () => templateModal(load));
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  await load.flush();
  if (preset.to || preset.template) smsModal(templates, () => load.flush(), preset);
}

function smsModal(templates, onDone, preset = {}) {
  let classes = [];
  modal({
    title: 'Nouveau SMS', icon: 'sms',
    subtitle: 'Choisissez une audience ciblée : le coût est estimé avant l’envoi.',
    body: `<form id="sm-form">
      ${field({ label: 'Audience', name: 'audience', type: 'select', value: preset.to ? 'libre' : 'tous_parents', options: AUDIENCES })}
      <div id="sm-extra"></div>
      <div id="sm-manual" class="mt-3" style="display:none">
        ${field({ label: 'Numéros (un par ligne)', name: 'to_raw', type: 'textarea', rows: 3, value: preset.to || '', placeholder: '+221 77 123 45 67' })}
      </div>
      ${field({ label: 'Modèle', name: 'template', type: 'select', value: preset.template || 'libre', options: [{ value: 'libre', label: 'Message libre' }, ...templates.map((x) => ({ value: x.code, label: x.name || x.code }))] })}
      ${field({ label: 'Texte du SMS', name: 'body', type: 'textarea', rows: 4, value: preset.body || '', required: true, placeholder: 'Bonjour, …' })}
      <div class="row gap-2 wrap">
        <span class="tiny subtle">Variables :</span>
        ${['{parent}', '{eleve}', '{classe}', '{solde}', '{ecole}', '{tel}'].map((v) => `<button type="button" class="btn btn-link btn-sm" data-var="${v}">${v}</button>`).join('')}
      </div>
      ${field({ label: 'Envoi programmé (optionnel)', name: 'schedule', type: 'datetime-local', value: '' })}
      <div class="campaign-preview mt-3" id="sm-preview"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="sm-go">${icon('send', { size: 15 })} Mettre en file</button>`,
    onMount: async (layer, close) => {
      const body = layer.querySelector('[name=body]');
      const extra = layer.querySelector('#sm-extra');
      const manual = layer.querySelector('#sm-manual');
      const preview = layer.querySelector('#sm-preview');
      try {
        const r = await api.get('/academics/classes');
        classes = r.data || [];
      } catch { classes = []; }

      const paintExtra = () => {
        const a = layer.querySelector('[name=audience]').value;
        manual.style.display = a === 'libre' ? '' : 'none';
        extra.innerHTML = a === 'classe' ? field({
          label: 'Classe', name: 'class_id', type: 'select', required: true, placeholder: '— Choisir —',
          options: classes.map((c) => ({ value: c.id, label: `${c.name} (${c.effectif ?? c.students ?? '?'} élèves)` })),
        }) : '';
        paintPreview();
      };
      const paintPreview = () => {
        const a = layer.querySelector('[name=audience]').value;
        const seg = segments(body.value);
        const n = a === 'libre' ? body.value && layer.querySelector('[name=to_raw]').value.split('\n').filter(Boolean).length || 0 : null;
        preview.innerHTML = `<b>${seg}</b> segment(s) de 160 caractères · ${body.value.length} caractère(s).
          ${n != null ? `Coût estimé : <b class="num">${num(n * seg * PRET_SMS)} FCFA</b> pour ${num(n)} destinataire(s).`
            : 'Coût : <b class="num">25 FCFA</b> par destinataire et par segment. Seuls les numéros ayant accepté les SMS sont servis.'}`;
      };
      layer.querySelector('[name=audience]').addEventListener('change', paintExtra);
      layer.querySelector('[name=template]').addEventListener('change', (e) => {
        const tpl = templates.find((x) => x.code === e.target.value);
        if (tpl) body.value = tpl.body;
        paintPreview();
      });
      body.addEventListener('input', debounce(paintPreview, 250));
      layer.querySelector('[name=to_raw]')?.addEventListener('input', debounce(paintPreview, 250));
      layer.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
        body.value = `${body.value}${body.value && !body.value.endsWith(' ') ? ' ' : ''}${b.dataset.var}`;
        body.focus();
        paintPreview();
      }));
      paintExtra();

      layer.querySelector('#sm-go').addEventListener('click', () => withBusy(layer.querySelector('#sm-go'), async () => {
        const payload = readForm(layer.querySelector('#sm-form'), ['class_id']);
        if (!payload.body) return toastErr('Texte requis');
        const send = { body: payload.body, template: payload.template, schedule: payload.schedule || null };
        if (payload.audience === 'libre') {
          send.to = String(payload.to_raw || '').split('\n').map((x) => x.trim()).filter(Boolean).map((phone) => ({ phone }));
          if (!send.to.length) return toastErr('Aucun numéro', 'Saisissez au moins un destinataire.');
        } else {
          send.audience = payload.audience;
          if (payload.audience === 'classe') send.class_id = Number(payload.class_id);
        }
        try {
          const r = await api.post('/comms/sms', send);
          close();
          toastOk('SMS mis en file', `${num(r.data?.queued || 0)} message(s) · ${num(r.data?.segments || 1)} segment(s) · ${xof(r.data?.cost_estimate || 0)}.`);
          onDone?.();
        } catch (e) { toastErr('Envoi impossible', e.message); }
      }));
    },
  });
}

function templateModal(onDone) {
  modal({
    title: 'Modèle de SMS', icon: 'note', size: 'modal-narrow',
    body: `<form id="tp-form">
      ${field({ label: 'Code', name: 'code', required: true, placeholder: 'relance_cantine', hint: 'Utilisé par les automatisations.' })}
      ${field({ label: 'Nom affiché', name: 'name', required: true, placeholder: 'Rappel cantine' })}
      ${field({ label: 'Texte', name: 'body', type: 'textarea', rows: 4, required: true, placeholder: 'Bonjour {parent}, …' })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="tp-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#tp-go').addEventListener('click', () => withBusy(layer.querySelector('#tp-go'), async () => {
        const payload = readForm(layer.querySelector('#tp-form'));
        if (!payload.code || !payload.body) return toastErr('Champs requis');
        try { await api.post('/comms/sms/templates', payload); toastOk('Modèle enregistré'); close(); onDone?.(); } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* CALENDRIER SCOLAIRE                                                 */
/* ================================================================== */
async function eventsView(el, query = {}) {
  const now = new Date();
  const state = { year: Number(query.y || now.getFullYear()), month: Number(query.m || now.getMonth() + 1), view: query.view || 'mois' };
  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2 class="h-card" id="ev-title">${icon('calendar', { size: 16 })} Calendrier</h2>
        <div class="row gap-2 wrap">
          <button class="btn btn-secondary btn-sm" id="ev-prev" aria-label="Période précédente">${icon('chevron-left', { size: 15 })}</button>
          <button class="btn btn-secondary btn-sm" id="ev-today">Aujourd’hui</button>
          <button class="btn btn-secondary btn-sm" id="ev-next" aria-label="Période suivante">${icon('chevron-right', { size: 15 })}</button>
          <select class="select select-sm" id="ev-view">
            <option value="mois">Vue mois</option><option value="liste">Vue liste</option><option value="annee">Vue année</option></select>
          ${store.atLeast(50) ? `<button class="btn btn-primary btn-sm" id="ev-new">${icon('plus', { size: 15 })} Événement</button>` : ''}
        </div>
      </div>
      <div class="card-body" id="ev-body">${spinnerNote('Chargement du calendrier…')}</div>
    </div>
    <div class="grid-2 mt-4">
      <div class="card"><div class="card-body" id="ev-side">${skeletonRows(5, 3)}</div></div>
      <div class="card"><div class="card-body" id="ev-year">${skeletonRows(5, 3)}</div></div>
    </div>`;

  let all = { events: [], holidays: [], terms: [], year: null };
  const load = async () => {
    try {
      const r = await api.get('/comms/events');
      all = r.data || all;
      paint();
    } catch (err) {
      el.querySelector('#ev-body').innerHTML = emptyState({ icon: 'wifi-off', title: 'Calendrier indisponible', message: err.message });
    }
  };
  const key = (d) => (typeof d === 'string' ? d.slice(0, 10) : '');
  const eventsOn = (iso) => (all.events || []).filter((e) => key(e.event_date) === iso || (e.end_date && key(e.event_date) <= iso && iso <= key(e.end_date)));
  const holidayOn = (iso) => (all.holidays || []).find((x) => key(x.date) === iso || (x.end_date && key(x.date) <= iso && iso <= key(x.end_date)));

  const paint = () => {
    const title = el.querySelector('#ev-title');
    const body = el.querySelector('#ev-body');
    const todayIso = aujourdhui();
    if (state.view === 'mois') {
      title.innerHTML = `${icon('calendar', { size: 16 })} ${esc(MOIS[state.month - 1] || '')} ${state.year}`;
      const first = new Date(Date.UTC(state.year, state.month - 1, 1));
      const startDow = (first.getUTCDay() + 6) % 7; // lundi = 0
      const days = new Date(Date.UTC(state.year, state.month, 0)).getUTCDate();
      const cells = [];
      for (let i = 0; i < startDow; i += 1) cells.push(null);
      for (let d = 1; d <= days; d += 1) cells.push(`${state.year}-${String(state.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      while (cells.length % 7 !== 0) cells.push(null);
      body.innerHTML = `<div class="cal-grid">
        ${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => `<div class="cal-head">${d}</div>`).join('')}
        ${cells.map((iso) => {
          if (!iso) return '<div class="cal-cell is-out"></div>';
          const evs = eventsOn(iso);
          const hol = holidayOn(iso);
          const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
          const weekend = dow === 0 || dow === 6;
          return `<div class="cal-cell ${iso === todayIso ? 'is-today' : ''} ${hol ? 'is-holiday' : ''} ${weekend ? 'is-weekend' : ''}" data-iso="${iso}" tabindex="0" role="button" aria-label="${esc(dateLong(iso))}">
            <div class="cal-day num">${Number(iso.slice(8, 10))}</div>
            ${hol ? `<div class="cal-chip holiday">${icon('gift', { size: 10 })} ${esc(hol.name)}</div>` : ''}
            ${evs.slice(0, 3).map((e) => `<div class="cal-chip" style="--c:${e.color || '#0e7c66'}">${e.start_time ? `<span class="num">${esc(e.start_time.slice(0, 5))}</span> ` : ''}${esc(e.title)}</div>`).join('')}
            ${evs.length > 3 ? `<div class="cal-more">+${evs.length - 3} autre(s)</div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
      body.querySelectorAll('[data-iso]').forEach((cell) => {
        const open = () => dayDrawer(cell.dataset.iso, eventsOn(cell.dataset.iso), holidayOn(cell.dataset.iso));
        cell.addEventListener('click', open);
        cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
    } else if (state.view === 'liste') {
      const from = `${state.year}-${String(state.month).padStart(2, '0')}-01`;
      const to = `${state.year}-${String(state.month).padStart(2, '0')}-31`;
      const list = (all.events || []).filter((e) => key(e.event_date) >= from && key(e.event_date) <= to);
      title.innerHTML = `${icon('list', { size: 16 })} Événements de ${esc(MOIS[state.month - 1] || '')} ${state.year}`;
      body.innerHTML = list.length ? `<div class="list">${list.map((e) => `<div class="list-item clickable" data-ev="${e.id}" tabindex="0" role="button">
          <span class="li-ico" style="background:${e.color || '#0e7c66'}1f;color:${e.color || '#0e7c66'}">${icon('calendar-days', { size: 15 })}</span>
          <span class="li-body"><span class="li-title">${esc(e.title)}</span>
            <span class="li-sub">${dateLong(e.event_date)}${e.start_time ? ` · ${heureFr(e.start_time)}${e.end_time ? ` – ${heureFr(e.end_time)}` : ''}` : ' · toute la journée'}${e.location ? ` · ${esc(e.location)}` : ''}</span></span>
          <span class="li-aside">${badge(dictLabel(TYPES_EVENEMENT, e.event_type) || e.event_type, 'info')}</span></div>`).join('')}</div>`
        : emptyState({ icon: 'calendar', title: 'Rien ce mois-ci', message: 'Ajoutez un événement ou changez de période.' });
      body.querySelectorAll('[data-ev]').forEach((li) => {
        const ev = (all.events || []).find((x) => String(x.id) === li.dataset.ev);
        const open = () => eventModal(ev, load);
        li.addEventListener('click', open);
        li.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
      });
    } else {
      title.innerHTML = `${icon('calendar-days', { size: 16 })} Année ${state.year}`;
      const months = Array.from({ length: 12 }, (_, i) => {
        const prefix = `${state.year}-${String(i + 1).padStart(2, '0')}`;
        const evs = (all.events || []).filter((e) => key(e.event_date).startsWith(prefix));
        const hols = (all.holidays || []).filter((x) => key(x.date).startsWith(prefix));
        return `<button class="year-month" data-m="${i + 1}">
          <b>${esc(MOIS[i])}</b>
          <span class="num">${evs.length} événement(s)</span>
          ${hols.length ? `<span class="tiny subtle">${esc(hols.map((x) => x.name).join(', '))}</span>` : ''}
        </button>`;
      }).join('');
      body.innerHTML = `<div class="year-grid">${months}</div>`;
      body.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { state.month = Number(b.dataset.m); state.view = 'mois'; el.querySelector('#ev-view').value = 'mois'; paint(); }));
    }

    // Panneau latéral : prochains rendez-vous + périodes scolaires
    const upcoming = (all.events || [])
      .filter((e) => key(e.event_date) >= todayIso)
      .sort((a, b) => key(a.event_date).localeCompare(key(b.event_date)))
      .slice(0, 6);
    el.querySelector('#ev-side').innerHTML = `
      <h3 class="h-card">${icon('bell-ring', { size: 15 })} Prochains rendez-vous</h3>
      ${upcoming.length ? `<div class="list">${upcoming.map((e) => `<div class="list-item clickable" data-ev="${e.id}" tabindex="0" role="button">
          <span class="li-ico" style="background:${e.color || '#0e7c66'}1f;color:${e.color || '#0e7c66'}">${icon('calendar-days', { size: 14 })}</span>
          <span class="li-body"><span class="li-title small">${esc(e.title)}</span>
            <span class="li-sub">${dateFr(e.event_date)} · dans ${num(joursEntre(todayIso, key(e.event_date)))} j</span></span>
          <span class="li-aside">${badge(dictLabel(TYPES_EVENEMENT, e.event_type) || e.event_type, 'neutral')}</span></div>`).join('')}</div>`
        : '<p class="subtle small">Aucun événement à venir.</p>'}`;
    el.querySelectorAll('#ev-side [data-ev]').forEach((li) => {
      const ev = (all.events || []).find((x) => String(x.id) === li.dataset.ev);
      li.addEventListener('click', () => eventModal(ev, load));
    });

    const terms = all.terms || [];
    el.querySelector('#ev-year').innerHTML = `
      <h3 class="h-card">${icon('school', { size: 15 })} Année ${esc(all.year?.name || String(state.year))}</h3>
      ${terms.length ? `<div class="list">${terms.map((t) => `<div class="list-item">
          <span class="li-ico" data-tone="${t.is_current ? 'ok' : 'neutral'}">${icon('flag', { size: 14 })}</span>
          <span class="li-body"><span class="li-title small">${esc(t.name)}${t.is_current ? ' · en cours' : ''}</span>
            <span class="li-sub">${dateFr(t.start_date)} → ${dateFr(t.end_date)}${t.council_date ? ` · conseil ${dateFr(t.council_date)}` : ''}${t.report_date ? ` · bulletins ${dateFr(t.report_date)}` : ''}</span></span>
        </div>`).join('')}</div>` : '<p class="subtle small">Aucun trimestre défini.</p>'}
      ${(all.holidays || []).length ? `<h3 class="h-card mt-4">${icon('gift', { size: 15 })} Jours fériés & vacances</h3>
        <div class="row gap-1 wrap">${all.holidays.slice(0, 12).map((x) => badge(`${dateFr(x.date)} — ${x.name}`, 'neutral')).join('')}</div>` : ''}`;
  };

  const shift = (delta) => {
    if (state.view === 'annee') { state.year += delta; } else {
      state.month += delta;
      if (state.month > 12) { state.month = 1; state.year += 1; }
      if (state.month < 1) { state.month = 12; state.year -= 1; }
    }
    paint();
  };
  el.querySelector('#ev-prev').addEventListener('click', () => shift(-1));
  el.querySelector('#ev-next').addEventListener('click', () => shift(1));
  el.querySelector('#ev-today').addEventListener('click', () => { const n = new Date(); state.year = n.getFullYear(); state.month = n.getMonth() + 1; paint(); });
  el.querySelector('#ev-view').value = state.view;
  el.querySelector('#ev-view').addEventListener('change', (e) => { state.view = e.target.value; paint(); });
  el.querySelector('#ev-new')?.addEventListener('click', () => eventModal(null, load, `${state.year}-${String(state.month).padStart(2, '0')}-01`));
  await load();
}

function dayDrawer(iso, events, holiday) {
  const panel = h('<div></div>');
  panel.innerHTML = `
    ${holiday ? `<div class="alert alert-brand">${icon('gift', { size: 16 })}<div class="alert-body">
      <div class="alert-title">${esc(holiday.name)}</div><div class="alert-msg">Jour férié — pas de cours.</div></div></div>` : ''}
    ${events.length ? `<div class="list">${events.map((e) => `<div class="list-item">
        <span class="li-ico" style="background:${e.color || '#0e7c66'}1f;color:${e.color || '#0e7c66'}">${icon('calendar-days', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">${esc(e.title)}</span>
          <span class="li-sub">${e.start_time ? `${heureFr(e.start_time)}${e.end_time ? ` – ${heureFr(e.end_time)}` : ''}` : 'Toute la journée'}${e.location ? ` · ${esc(e.location)}` : ''}</span>
          ${e.description ? `<span class="li-sub">${esc(e.description)}</span>` : ''}</span>
        <span class="li-aside">${badge(dictLabel(TYPES_EVENEMENT, e.event_type) || e.event_type, 'info')}</span></div>`).join('')}</div>`
      : `<p class="subtle small">Aucun événement ce jour-là.</p>`}`;
  drawer({
    title: dateLong(iso), subtitle: `${events.length} événement(s)`, body: panel,
    footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
      ${store.atLeast(50) ? `<button class="btn btn-primary" id="dd-add">${icon('plus', { size: 15 })} Ajouter un événement</button>` : ''}`,
    onMount: (layer, close) => {
      layer.querySelector('#dd-add')?.addEventListener('click', () => { close(); eventModal(null, null, iso); });
    },
  });
}

function eventModal(current, onDone, defaultDate) {
  const c = current || {};
  modal({
    title: c.id ? `Modifier « ${c.title} »` : 'Nouvel événement', icon: 'calendar-plus',
    body: `<form id="ev-form">
      ${field({ label: 'Titre', name: 'title', value: c.title || '', required: true, placeholder: 'Conseil de classe, remise des bulletins…' })}
      <div class="grid-2">
        ${field({ label: 'Type', name: 'event_type', type: 'select', value: c.event_type || 'reunion', options: dictEntries(TYPES_EVENEMENT).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Couleur', name: 'color', type: 'color', value: c.color || '#0e7c66' })}
        ${field({ label: 'Date de début', name: 'event_date', type: 'date', value: c.event_date || defaultDate || aujourdhui(), required: true })}
        ${field({ label: 'Date de fin (optionnelle)', name: 'end_date', type: 'date', value: c.end_date || '' })}
        ${field({ label: 'Heure de début', name: 'start_time', type: 'time', value: c.start_time || '' })}
        ${field({ label: 'Heure de fin', name: 'end_time', type: 'time', value: c.end_time || '' })}
      </div>
      ${field({ label: 'Lieu', name: 'location', value: c.location || '', placeholder: 'Salle des profs, cour…' })}
      ${field({ label: 'Description', name: 'description', type: 'textarea', rows: 3, value: c.description || '' })}
      <div class="grid-2">
        ${field({ label: 'Toute la journée', name: 'is_all_day', type: 'switch', value: !!c.is_all_day })}
        ${field({ label: 'Inscription requise', name: 'requires_registration', type: 'switch', value: !!c.requires_registration })}
      </div>
    </form>`,
    footer: `${c.id && store.atLeast(65) ? `<button class="btn btn-danger" id="ev-del">${icon('trash', { size: 15 })} Supprimer</button>` : ''}
      <span class="grow"></span>
      <button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="ev-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#ev-go').addEventListener('click', () => withBusy(layer.querySelector('#ev-go'), async () => {
        const payload = readForm(layer.querySelector('#ev-form'));
        if (!payload.title || !payload.event_date) return toastErr('Champs requis', 'Titre et date obligatoires.');
        if (c.id) payload.id = c.id;
        try {
          await api.post('/comms/events', payload);
          toastOk(c.id ? 'Événement mis à jour' : 'Événement ajouté', `${payload.title} — ${dateFr(payload.event_date)}.`);
          close();
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
      layer.querySelector('#ev-del')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Supprimer cet événement ?', danger: true, confirmLabel: 'Supprimer', message: `« ${c.title} » sera retiré du calendrier de toute la communauté.` }))) return;
        try { await api.del(`/comms/events/${c.id}`); toastOk('Événement supprimé'); close(); onDone?.(); } catch (e) { toastErr('Suppression impossible', e.message); }
      });
    },
  });
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerComms(route) {
  route('/communication/messages', async ({ query }) => { const el = h('<div class="view"></div>'); messagesView(el, query); return el; }, { title: 'Annonces & messages', group: 'Communication' });
  route('/communication/messages/:id', async ({ params }) => {
    const el = h('<div class="view"></div>');
    messageDrawer(Number(params.id), null, () => go('/communication/messages'));
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'megaphone', title: 'Message ouvert', message: 'Le message s’affiche dans le panneau latéral.' })}
      <div class="actions"><a class="btn btn-primary" href="#/communication/messages">Retour à la liste</a></div></div></div>`;
    return el;
  }, { title: 'Message', group: 'Communication' });
  route('/communication/sms', async ({ query }) => { const el = h('<div class="view"></div>'); smsView(el, query); return el; }, { title: 'Campagnes SMS', group: 'Communication' });
  route('/communication/evenements', async ({ query }) => { const el = h('<div class="view"></div>'); eventsView(el, query); return el; }, { title: 'Calendrier scolaire', group: 'Communication' });
  route('/calendrier', async () => { go('/communication/evenements', { replace: true }); return h('<div class="view"></div>'); }, { title: 'Calendrier scolaire', group: 'Communication' });
}

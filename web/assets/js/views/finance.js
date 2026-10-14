/**
 * SunuÉcole — Finances : recouvrement, facturation, encaissements Mobile Money,
 * impayés & relances SMS, dépenses, paie.
 *
 * Le nerf de la guerre pour une école privée : encaisser. Chaque écran de ce
 * module ramène vers une action d'encaissement ou de relance en un clic,
 * et l'échelonnement des paiements (très répandu) est géré nativement.
 */
import { api, isOnline } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, skeletonRows, dataTable, pagination, wirePagination,
  toolbar, field, readForm, modal, drawer, confirmDialog, toast, toastOk, toastErr, toastInfo, debounce, withBusy, copyText,
} from '../ui/components.js';
import { xof, xofShort, num, pct, note, dateFr, dateLong, heureFr, relatif, aujourdhui, ajouterJours, joursEntre, telFr, dictLabel, dictEntries, METHODE_PAIEMENT, STATUT_FACTURE, CATEGORIES_DEPENSE, CATEGORIES_FRAIS } from '../core/format.js';
import { barChart, donutChart, lineChart, sparkline } from '../core/charts.js';

const spinnerNote = (t) => `<div class="row gap-3 subtle small" style="justify-content:center;padding:36px"><span class="spinner"></span>${esc(t)}</div>`;

const PROVIDER_COLORS = { orange_money: '#ff7900', wave: '#1dc8f5', mtn_momo: '#ffcc00', moov_money: '#0066b3', free_money: '#e2001a', especes: '#0e7c66', virement: '#1d4ed8', cheque: '#7c3aed', carte: '#334155' };
const methodeBadge = (m) => {
  const d = METHODE_PAIEMENT[m] || { label: m || '—' };
  return `<span class="row gap-2" title="${esc(d.label || m)}"><i style="width:9px;height:9px;border-radius:99px;background:${PROVIDER_COLORS[m] || '#94a3b8'};display:inline-block;flex-shrink:0"></i><span class="small">${esc(d.label || m || '—')}</span></span>`;
};
const statutFacture = (s) => {
  const d = STATUT_FACTURE[s] || { label: s, tone: 'neutral' };
  return badge(d.label || s, d.tone || 'neutral');
};

/* ================================================================== */
/* VUE FINANCIÈRE (tableau de bord comptable)                          */
/* ================================================================== */
async function financeDashboard(el, query) {
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Vue financière</h1>
        <p class="subtle small mt-2">Recouvrement, encaissements du jour, dépenses et santé de la trésorerie — en un coup d'œil.</p></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="fd-journal">${icon('printer', { size: 15 })} Journal de caisse</button>
        <button class="btn btn-secondary" id="fd-export">${icon('download', { size: 15 })} Export comptable</button>
        <button class="btn btn-primary" id="fd-pay">${icon('banknote', { size: 15 })} Encaisser un paiement</button>
      </div>
    </header>
    <div id="fd-kpis" class="grid grid-kpi">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="grid grid-2-1 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('chart', { size: 16 })} Encaissements & dépenses (12 mois)</h2>
        <p class="subtle tiny mt-2">Le résultat mensuel révèle la saisonnalité des rentrées (octobre, janvier, avril).</p></div></div>
        <div class="card-body" id="fd-flux">${skeletonRows(3, 1)}</div></div>
      <div class="card"><div class="card-head"><div><h2>${icon('smartphone', { size: 16 })} Répartition par moyen de paiement</h2>
        <p class="subtle tiny mt-2">Part du Mobile Money dans vos encaissements</p></div></div>
        <div class="card-body" id="fd-methodes"></div></div>
    </div>
    <div class="grid grid-2-1 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('receipt', { size: 16 })} Recouvrement par catégorie de frais</h2>
        <p class="subtle tiny mt-2">Identifiez les postes qui fuient (cantine, transport…).</p></div>
        <a class="btn btn-ghost btn-sm" href="#/finance/frais">Frais ${icon('chevron-right', { size: 13 })}</a></div>
        <div class="card-body" style="padding:0" id="fd-cat"></div></div>
      <div class="card"><div class="card-head"><div><h2>${icon('clock-alert', { size: 16 })} Ancienneté des impayés</h2>
        <p class="subtle tiny mt-2">Plus une dette est ancienne, moins elle se recouvre.</p></div>
        <a class="btn btn-ghost btn-sm" href="#/finance/impayes">Relancer ${icon('chevron-right', { size: 13 })}</a></div>
        <div class="card-body" id="fd-ancien"></div></div>
    </div>
    <div class="card mt-4"><div class="card-head"><div><h2>${icon('alert-circle', { size: 16 })} Plus gros soldes impayés</h2>
      <p class="subtle tiny mt-2">Relancez directement par SMS ou par appel — le message est pré-rédigé.</p></div></div>
      <div class="card-body" style="padding:0" id="fd-top"></div></div>`;

  el.querySelector('#fd-pay').addEventListener('click', () => paymentForm(null, () => financeDashboard(el)));
  el.querySelector('#fd-journal').addEventListener('click', () => printJournal());
  el.querySelector('#fd-export').addEventListener('click', async () => {
    try { await api.download('/finance/reports/cashflow?format=csv', 'tresorerie.csv'); toastOk('Export terminé'); }
    catch (e) { toastErr('Export impossible', e.message); }
  });

  try {
    const [sum, charts] = await Promise.all([
      api.get('/finance/summary', { cacheTtl: 20000 }),
      api.get('/dashboard/charts', { cacheTtl: 30000 }).catch(() => ({ data: null })),
    ]);
    const t = sum.data.totals;
    const mois = sum.data.mois_courant;
    const flux = charts?.data?.flux_12m || [];
    el.querySelector('#fd-kpis').innerHTML = [
      kpiFin('Encaissé (année)', xof(t.encaisse), 'banknote', 'ok', `${num(t.payees ?? t.payees_count ?? t.payees)} facture(s) soldée(s) · ${pct(t.taux_recouvrement)} de recouvrement`),
      kpiFin('Reste à recouvrer', xof(t.solde), 'wallet', t.solde ? 'danger' : 'ok', `${num(t.impayees)} facture(s) impayée(s) dont ${num(t.retard)} de +30 j`),
      kpiFin('Encaissé ce mois', xof(mois.encaisse), 'trending', mois.encaisse ? 'brand' : 'warn', `${num(mois.paiements)} paiement(s) · résultat ${xofShort(mois.resultat)}`),
      kpiFin('Dépenses du mois', xof(mois.depenses), 'credit-card', 'plum', `Total année : ${xofShort(sum.data.depenses_total)}`),
    ].join('');
    if (flux.length) {
      const host = el.querySelector('#fd-flux');
      host.innerHTML = '';
      host.appendChild(barChart(flux, {
        labels: flux.map((x) => moisCourt(x.mois)),
        series: [
          { name: 'Encaissements', data: flux.map((x) => x.encaissements), color: '#0e7c66', format: xofShort },
          { name: 'Dépenses', data: flux.map((x) => x.depenses), color: '#dc2626', format: xofShort },
        ],
        height: 220, yFormat: (v) => xofShort(v),
        legend: [{ label: 'Encaissements', color: '#0e7c66' }, { label: 'Dépenses', color: '#dc2626' }],
      }));
    } else el.querySelector('#fd-flux').innerHTML = emptyState({ icon: 'chart', title: 'Pas encore de flux', message: 'Les encaissements apparaîtront ici.' });

    const pm = sum.data.par_methode || [];
    if (pm.length) {
      el.querySelector('#fd-methodes').appendChild(donutChart(pm.map((x) => ({ label: dictLabel(METHODE_PAIEMENT, x.methode || x.method), value: x.total, color: PROVIDER_COLORS[x.methode || x.method] || '#94a3b8' })),
        { height: 190, thickness: 26, format: xofShort, centerLabel: xofShort(pm.reduce((a, x) => a + x.total, 0)), centerSub: 'encaissé' }));
    } else el.querySelector('#fd-methodes').innerHTML = emptyState({ icon: 'smartphone', title: 'Aucun paiement', message: 'Encaissez votre premier paiement pour voir la répartition.' });

    const cat = sum.data.par_categorie || [];
    el.querySelector('#fd-cat').innerHTML = cat.length ? dataTable({
      columns: [
        { key: 'categorie', label: 'Catégorie', render: (x) => `<b class="small">${esc(dictLabel(CATEGORIES_FRAIS, x.categorie))}</b>` },
        { key: 'n', label: 'Factures', width: '90px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num">${num(x.n)}</span>` },
        { key: 'attendu', label: 'Attendu', width: '130px', align: 'right', render: (x) => `<span class="num">${xof(x.attendu)}</span>` },
        { key: 'encaisse', label: 'Encaissé', width: '130px', align: 'right', render: (x) => `<b class="num" style="color:var(--ok)">${xof(x.encaisse)}</b>` },
        { key: 'taux', label: 'Recouvrement', width: '160px', render: (x) => `<div class="row gap-2">${progress(x.taux, x.taux < 70 ? 'danger' : x.taux < 85 ? 'warn' : 'ok')}<span class="num tiny" style="width:38px;text-align:right">${x.taux}%</span></div>` },
      ], rows: cat, dense: true, zebra: true,
    }).outerHTML : emptyState({ icon: 'tag', title: 'Aucun frais paramétré', message: 'Créez vos types de frais pour lancer la facturation.' });

    const a = sum.data.anciennete || {};
    el.querySelector('#fd-ancien').appendChild(donutChart([
      { label: 'Moins de 30 j', value: a.moins_30 || 0, color: '#16a34a' },
      { label: '30 à 60 j', value: a.entre_30_60 || 0, color: '#f59e0b' },
      { label: '60 à 90 j', value: a.entre_60_90 || 0, color: '#ea580c' },
      { label: 'Plus de 90 j', value: a.plus_90 || 0, color: '#dc2626' },
    ].filter((x) => x.value > 0), { height: 170, thickness: 22, format: xofShort, centerLabel: xofShort((a.moins_30 || 0) + (a.entre_30_60 || 0) + (a.entre_60_90 || 0) + (a.plus_90 || 0)), centerSub: 'impayés' }));

    const top = sum.data.top_impayes || [];
    el.querySelector('#fd-top').innerHTML = top.length ? dataTable({
      columns: [
        { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
            <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')}</div></div></div>` },
        { key: 'solde', label: 'Solde dû', width: '130px', align: 'right', render: (x) => `<b class="num" style="color:var(--danger)">${xof(x.solde)}</b>` },
        { key: 'ancienne', label: 'Plus ancienne facture', width: '150px', hideBelow: 'md', render: (x) => `<span class="small">${dateFr(x.plus_ancienne)}</span> <span class="tiny subtle">(${joursEntre(x.plus_ancienne, aujourdhui())} j)</span>` },
        { key: 'tel', label: 'Parent', width: '150px', hideBelow: 'lg', render: (x) => (x.parent_tel ? `<span class="num small">${esc(telFr(x.parent_tel))}</span>` : '<span class="subtle tiny">—</span>') },
        { key: 'act', label: '', width: '190px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
            ${x.parent_tel ? `<button class="btn btn-secondary btn-sm" data-sms="${x.student_id}" data-tel="${esc(x.parent_tel)}" data-nom="${esc(x.first_name)}">${icon('sms', { size: 13 })} Relancer</button>` : ''}
            <button class="btn btn-primary btn-sm" data-pay="${x.student_id}">${icon('banknote', { size: 13 })} Encaisser</button></div>` },
      ], rows: top, dense: true, zebra: true,
    }).outerHTML : emptyState({ icon: 'check-circle', title: 'Aucun impayé', message: 'Toutes les factures sont soldées. Félicitations !' });
    el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => paymentForm({ student_id: Number(b.dataset.pay) }, () => financeDashboard(el))));
    el.querySelectorAll('[data-sms]').forEach((b) => b.addEventListener('click', () => go(`/communication/sms?to=${encodeURIComponent(b.dataset.tel)}&template=relance&student=${b.dataset.sms}`)));
  } catch (err) {
    el.querySelector('#fd-kpis').innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Données indisponibles', message: err.message })}</div></div>`;
  }
}
function kpiFin(label, value, ic, tone, hint) {
  return `<div class="kpi"><div class="kpi-top"><span class="kpi-ico" data-tone="${tone}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
    <div class="kpi-val" style="font-size:22px">${esc(value)}</div><div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
}
function moisCourt(m) {
  const mm = Number(String(m).split('-')[1]);
  return ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'][mm - 1] || mm;
}

/* ================================================================== */
/* FACTURES                                                            */
/* ================================================================== */
async function invoicesView(el, query) {
  const f = { q: '', status: query.status || '', class_id: '', student_id: query.student || '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Factures</h1>
        <p class="subtle small mt-2">Facturation par échéances (trimestres), réductions automatiques (fratrie, bourse) et génération en masse par classe ou niveau.</p></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="inv-export">${icon('download', { size: 15 })} Exporter</button>
        ${store.atLeast(70) ? `<button class="btn btn-primary" data-new id="inv-gen">${icon('zap', { size: 15 })} Générer des factures</button>` : ''}
      </div>
    </header>
    <div class="card"><div class="card-body" id="inv-toolbar"></div>
      <div class="card-body" style="padding:0" id="inv-table">${skeletonRows(9, 7)}</div>
      <div class="card-foot" id="inv-pager"></div></div>`;
  const slot = el.querySelector('#inv-toolbar');
  const paintToolbar = (agg) => {
    slot.innerHTML = toolbar({
      search: f.q, searchPlaceholder: 'N° de facture, élève, matricule…',
      filters: `<select class="select select-sm" data-f="status">
          <option value="">Tous statuts</option>
          ${dictEntries(STATUT_FACTURE).map((o) => `<option value="${o.value}" ${f.status === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
      actions: agg ? `<span class="row gap-3 subtle small">${icon('receipt', { size: 14 })} Attendu <b class="num">${xof(agg.attendu)}</b> · Encaissé <b class="num" style="color:var(--ok)">${xof(agg.encaisse)}</b> · Reste <b class="num" style="color:var(--danger)">${xof(agg.solde)}</b></span>` : '',
    });
    slot.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); }, 300));
    slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
  };
  const fetchRows = debounce(async () => {
    const t = el.querySelector('#inv-table');
    t.innerHTML = skeletonRows(8, 7);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/finance/invoices?${q}`);
      const rows = r.data || [];
      paintToolbar(r.aggregate);
      t.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'num', label: 'N° facture', width: '150px', render: (x) => `<a class="link-strong" href="#/finance/factures/${x.id}">${esc(x.invoice_number)}</a><div class="tiny subtle">${esc(x.label || '')}</div>` },
          { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.matricule || '')}${x.classe ? ` · ${esc(x.classe)}` : ''}</div></div></div>` },
          { key: 'amount', label: 'Montant', width: '120px', align: 'right', render: (x) => `<b class="num">${xof(x.amount)}</b>${x.discount ? `<div class="tiny subtle">réduction ${x.discount}%</div>` : ''}` },
          { key: 'paid', label: 'Payé', width: '110px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num" style="color:var(--ok)">${xof(x.amount_paid || 0)}</span>` },
          { key: 'due', label: 'Échéance', width: '120px', render: (x) => {
            const late = x.status !== 'payee' && joursEntre(aujourdhui(), x.due_date) < 0;
            return `<span class="small" style="${late ? 'color:var(--danger);font-weight:640' : ''}">${dateFr(x.due_date)}</span>${x.installment_of > 1 ? `<div class="tiny subtle">éch. ${x.installment_no}/${x.installment_of}</div>` : ''}`;
          } },
          { key: 'status', label: 'Statut', width: '130px', align: 'right', render: (x) => statutFacture(x.status) },
          { key: 'act', label: '', width: '170px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              ${x.status !== 'payee' ? `<button class="btn btn-primary btn-sm" data-pay="${x.id}" data-student="${x.student_id}">${icon('banknote', { size: 13 })} Encaisser</button>` : ''}
              <button class="btn btn-secondary btn-sm" data-open="${x.id}">${icon('eye', { size: 13 })} Détail</button></div>` },
        ],
        rows, dense: true, zebra: true, onRowClick: (x) => invoiceDrawer(x.id),
      }).outerHTML : emptyState({ icon: 'receipt', title: 'Aucune facture', message: 'Générez les factures de scolarité en masse par classe ou par niveau.', actions: [{ id: 'gen', label: 'Générer des factures', icon: 'zap', variant: 'btn-primary' }] });
      t.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); invoiceDrawer(Number(b.dataset.open)); }));
      t.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); paymentForm({ invoice_id: Number(b.dataset.pay), student_id: Number(b.dataset.student) }, fetchRows); }));
      t.querySelectorAll('[data-empty-action="gen"]').forEach((b) => b.addEventListener('click', generateWizard));
      const pager = el.querySelector('#inv-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'factures' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  el.querySelector('#inv-gen')?.addEventListener('click', generateWizard);
  el.querySelector('#inv-export').addEventListener('click', async () => {
    try { await api.download(`/finance/invoices?${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}&format=csv`, 'factures.csv'); toastOk('Export terminé'); }
    catch (e) { toastErr('Export impossible', e.message); }
  });
  if (query.students) toastInfo('Sélection', 'Facturation des élèves sélectionnés : utilisez l\'assistant de génération.');
  await fetchRows.flush();
}

function generateWizard() {
  modal({
    title: 'Générer des factures en masse', icon: 'zap', size: 'modal-wide',
    subtitle: 'Facturation par échéance : chaque élève concerné reçoit sa part, réductions appliquées.',
    body: `<form id="gw-form">${spinnerNote('Chargement des frais…')}</form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="gw-go">${icon('zap', { size: 15 })} Générer</button>`,
    onMount: async (layer, close) => {
      let fees = [];
      let classes = [];
      let levels = [];
      try {
        const [fe, cl, lv] = await Promise.all([
          api.get('/finance/fee-types', { cacheTtl: 60000 }),
          api.get('/academics/classes?limit=200', { cacheTtl: 120000 }),
          api.get('/academics/levels', { cacheTtl: 120000 }),
        ]);
        fees = fe.data || [];
        classes = cl.data || [];
        levels = lv.data?.levels || lv.data || [];
      } catch { /* ignore */ }
      layer.querySelector('#gw-form').innerHTML = `
        ${field({ label: 'Type de frais', name: 'fee_type_id', type: 'select', required: true, placeholder: '— Choisir —',
          options: fees.map((x) => ({ value: x.id, label: `${x.name} — ${xof(x.amount)}${x.installments > 1 ? ` en ${x.installments} échéances` : ''}` })) })}
        <div class="grid-2">
          ${field({ label: 'Portée', name: 'scope', type: 'select', value: 'all', options: [
            { value: 'all', label: 'Tous les élèves actifs' }, { value: 'class', label: 'Une classe' },
            { value: 'level', label: 'Un niveau' }, { value: 'unbilled', label: 'Seulement les non facturés' }] })}
          ${field({ label: 'Classe', name: 'class_id', type: 'select', placeholder: '—', options: classes.map((c) => ({ value: c.id, label: c.name })) })}
          ${field({ label: 'Niveau', name: 'level_id', type: 'select', placeholder: '—', options: levels.map((c) => ({ value: c.id, label: c.name })) })}
          ${field({ label: 'Date d\'échéance', name: 'due_date', type: 'date', value: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) })}
          ${field({ label: 'Nombre d\'échéances', name: 'installments', type: 'number', value: 1, min: 1, max: 12, hint: '3 = trimestriel, 10 = mensuel' })}
          ${field({ label: 'Montant forcé (optionnel)', name: 'amount_override', type: 'number', placeholder: 'Montant du type de frais', suffix: 'FCFA' })}
        </div>
        ${field({ label: 'Ignorer les élèves déjà facturés pour ce frais', name: 'only_unbilled', type: 'switch', value: true, hint: 'Évite les doublons lors des relances de facturation.' })}
        <div class="alert alert-warn mt-2">${icon('alert-triangle', { size: 16 })}<div class="alert-body">
          <div class="alert-title">Vérifiez avant de lancer</div>
          <div class="alert-msg">La génération crée une facture par élève concerné. L'opération est tracée dans le journal d'audit et peut être annulée facture par facture.</div></div></div>`;
      layer.querySelector('#gw-go').addEventListener('click', () => withBusy(layer.querySelector('#gw-go'), async () => {
        const payload = readForm(layer.querySelector('#gw-form'), ['fee_type_id', 'class_id', 'level_id', 'installments', 'amount_override']);
        if (!payload.fee_type_id) return toastErr('Type de frais requis');
        try {
          const r = await api.post('/finance/invoices/generate', payload);
          close();
          toastOk('Facturation en masse terminée', `${num(r.data?.created ?? 0)} facture(s) pour ${num(r.data?.students ?? 0)} élève(s) — ${r.data?.fee || ''}.`);
          go('/finance/factures');
        } catch (e) { toastErr('Génération impossible', e.message); }
      }));
    },
  });
}

async function invoiceDrawer(id) {
  let loadedStudentId = null;
  const panel = document.createElement('div');
  panel.innerHTML = spinnerNote('Chargement de la facture…');
  const d = drawer({
    title: 'Facture', wide: true, body: panel,
    footer: `<div class="row gap-2 wrap grow">
        <button class="btn btn-secondary" id="iv-print">${icon('printer', { size: 15 })} Imprimer</button>
        <button class="btn btn-secondary" id="iv-reminder">${icon('sms', { size: 15 })} Envoyer une relance</button>
        <span class="grow"></span>
        <button class="btn btn-primary" id="iv-pay">${icon('banknote', { size: 15 })} Encaisser</button></div>`,
    onMount: (layer, close) => {
      layer.querySelector('#iv-print').addEventListener('click', () => window.print());
      layer.querySelector('#iv-pay').addEventListener('click', () => { close(); paymentForm({ invoice_id: id }, () => invoiceDrawer(id)); });
      layer.querySelector('#iv-reminder').addEventListener('click', async () => {
        if (!loadedStudentId) return toastErr('Relance impossible', 'Élève non identifié sur cette facture.');
        try {
          const r = await api.post('/finance/reminders', { student_ids: [loadedStudentId] });
          toastOk('Relance envoyée', `${num(r.data?.queued ?? 0)} SMS programmé(s) · ${xof(r.data?.cost_estimate || 0)}.`);
        } catch (e) { toastErr('Relance impossible', e.message); }
      });
      load();
    },
  });
  async function load() {
    try {
      const r = await api.get(`/finance/invoices/${id}`);
      const x = r.data.invoice || r.data;
      const pays = r.data.payments || [];
      loadedStudentId = x.student_id ? Number(x.student_id) : null;
      d.el.querySelector('.drawer-head h2').textContent = x.invoice_number;
      d.el.querySelector('.drawer-head .subtle').innerHTML = `${esc(x.label || '')} · ${statutFacture(x.status)}`;
      panel.className = 'print-area';
      panel.innerHTML = `
        <div class="receipt" style="max-width:520px;margin:0 auto">
          <div class="receipt-no">${esc(x.invoice_number)}</div>
          <div class="receipt-table">
            <div class="receipt-row"><span>Élève</span><b>${esc(x.first_name || '')} ${esc(x.last_name || '')} <span class="subtle">(${esc(x.matricule || '')})</span></b></div>
            <div class="receipt-row"><span>Libellé</span><b>${esc(x.label || '')}</b></div>
            <div class="receipt-row"><span>Émise le</span><b>${dateFr(x.issued_at)}</b></div>
            <div class="receipt-row"><span>Échéance</span><b>${dateFr(x.due_date)}${x.installment_of > 1 ? ` (éch. ${x.installment_no}/${x.installment_of})` : ''}</b></div>
            <div class="receipt-row"><span>Montant</span><b class="num">${xof(x.amount)}</b></div>
            ${x.discount ? `<div class="receipt-row"><span>Réduction</span><b class="num" style="color:var(--ok)">-${x.discount} %</b></div>` : ''}
            <div class="receipt-row"><span>Déjà payé</span><b class="num" style="color:var(--ok)">${xof(x.amount_paid || 0)}</b></div>
          </div>
          <div class="receipt-total"><span>Reste à payer</span><b class="num">${xof((x.amount || 0) - (x.amount_paid || 0))}</b></div>
          ${x.note ? `<p class="tiny subtle mt-3" style="text-align:center">${esc(x.note)}</p>` : ''}
        </div>
        <h3 class="h-card mt-4">${icon('banknote', { size: 15 })} Paiements imputés</h3>
        ${pays.length ? `<div class="list">${pays.map((p) => `<div class="list-item">
            <span class="li-ico" style="background:${PROVIDER_COLORS[p.method] || '#0e7c66'}22;color:${PROVIDER_COLORS[p.method] || '#0e7c66'}">${icon('banknote', { size: 15 })}</span>
            <span class="li-body"><span class="li-title">${xof(p.amount)}</span>
              <span class="li-sub">${dateFr(p.paid_at || p.created_at)} ${heureFr(p.paid_at || p.created_at)} · ${esc(dictLabel(METHODE_PAIEMENT, p.method))}${p.provider_ref ? ` · réf. ${esc(p.provider_ref)}` : ''}</span></span>
            <span class="li-aside"><button class="btn btn-ghost btn-sm" data-receipt="${p.id}">${icon('printer', { size: 13 })} Reçu</button></span></div>`).join('')}</div>`
          : `<p class="subtle small">Aucun paiement imputé à ce jour.</p>`}`;
      panel.querySelectorAll('[data-receipt]').forEach((b) => b.addEventListener('click', () => printReceipt(Number(b.dataset.receipt))));
    } catch (err) {
      panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Facture indisponible', message: err.message });
    }
  }
}

/* ================================================================== */
/* ENCAISSEMENT (Mobile Money / espèces)                               */
/* ================================================================== */
async function paymentForm(preset = {}, onDone) {
  let providers = [];
  let student = null;
  let openInvoices = [];
  if (preset.student_id) {
    try {
      const r = await api.get(`/students/${preset.student_id}`);
      student = r.data.student;
      openInvoices = (r.data.invoices || []).filter((i) => i.status !== 'payee');
    } catch { /* ignore */ }
  }
  try {
    const s = await api.get('/finance/summary', { cacheTtl: 30000 });
    providers = s.data.providers || [];
  } catch { /* ignore */ }

  const isMobile = (m) => ['orange_money', 'wave', 'mtn_momo', 'moov_money', 'free_money'].includes(m);
  const m = modal({
    title: 'Encaisser un paiement', icon: 'banknote', size: 'modal-wide',
    subtitle: 'L\'imputation se fait automatiquement sur les factures les plus anciennes (FIFO).',
    body: `<form id="pf-form">
      <div class="fieldset"><legend>${icon('user', { size: 14 })} Élève</legend>
        ${student ? `<div class="row gap-3" style="padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm)">
            ${avatar({ first: student.first_name, last: student.last_name, size: 'avatar' })}
            <div style="flex:1;min-width:0"><b>${esc(student.first_name)} ${esc(student.last_name)}</b>
              <div class="subtle small">${esc(student.matricule)} · ${esc(student.classe || '')} · solde dû <b class="num" style="color:var(--danger)">${xof(student.solde || 0)}</b></div></div>
            <input type="hidden" name="student_id" value="${student.id}"></div>`
          : field({ label: 'Rechercher un élève', name: 'student_q', placeholder: 'Nom, matricule…', hint: 'Tapez au moins 2 caractères puis choisissez dans la liste.', required: true })}
        <div id="pf-results"></div>
        ${openInvoices.length ? `<div class="mt-3">${field({ label: 'Facture à imputer en priorité', name: 'invoice_id', type: 'select', value: preset.invoice_id || '', placeholder: 'Imputation automatique (FIFO)',
          options: openInvoices.map((i) => ({ value: i.id, label: `${i.invoice_number} — ${xof(i.amount - (i.amount_paid || 0))} (${dateFr(i.due_date)})` })) })}</div>` : ''}
      </div>
      <div class="fieldset"><legend>${icon('banknote', { size: 14 })} Paiement</legend>
        <div class="grid-2">
          ${field({ label: 'Montant', name: 'amount', type: 'number', required: true, min: 1, suffix: 'FCFA', value: preset.amount || '', placeholder: '25 000' })}
          ${field({ label: 'Moyen de paiement', name: 'method', type: 'select', value: preset.method || 'especes',
            options: dictEntries(METHODE_PAIEMENT).map((o) => ({ value: o.value, label: o.label })) })}
        </div>
        <div id="pf-momo" hidden>
          <div class="grid-2">
            ${field({ label: 'Numéro Mobile Money', name: 'phone', type: 'tel', placeholder: '+221 77 000 00 00', hint: 'Le client recevra une demande de confirmation sur son téléphone.' })}
            ${field({ label: 'Opérateur', name: 'provider', type: 'select', options: providers.map((p) => ({ value: p.id, label: `${p.label}${p.ussd ? ` (${p.ussd})` : ''}` })) })}
          </div>
          <div class="alert alert-brand" id="pf-momo-status">${icon('smartphone', { size: 16 })}<div class="alert-body">
            <div class="alert-title">Paiement Mobile Money</div>
            <div class="alert-msg">Une demande de paiement sera poussée sur le téléphone du payeur. Validez ici une fois la confirmation reçue (mode simulation : confirmation immédiate).</div></div></div>
        </div>
        <div class="grid-2">
          ${field({ label: 'Référence externe', name: 'provider_ref', placeholder: 'N° de transaction, chèque…' })}
          ${field({ label: 'Reçu par', name: 'received_by', value: store.state.user ? `${store.state.user.firstName} ${store.state.user.lastName}` : '' })}
        </div>
        ${field({ label: 'Envoyer le reçu par SMS au payeur', name: 'send_receipt', type: 'switch', value: true, hint: '25 FCFA par SMS. Le reçu mentionne le solde restant.' })}
      </div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="pf-go">${icon('check-circle', { size: 15 })} Encaisser et éditer le reçu</button>`,
    onMount: (layer, close) => {
      const form = layer.querySelector('#pf-form');
      const methodSel = form.querySelector('[name=method]');
      const momoBox = layer.querySelector('#pf-momo');
      const syncMomo = () => { momoBox.hidden = !isMobile(methodSel.value); if (!momoBox.hidden) form.querySelector('[name=phone]')?.focus(); };
      methodSel.addEventListener('change', syncMomo);
      syncMomo();
      // Recherche d'élève à la volée
      const qIn = form.querySelector('[name=student_q]');
      if (qIn) {
        const results = layer.querySelector('#pf-results');
        qIn.addEventListener('input', debounce(async () => {
          const term = qIn.value.trim();
          if (term.length < 2) { results.innerHTML = ''; return; }
          try {
            const r = await api.get(`/students/search/global?q=${encodeURIComponent(term)}`);
            const list = (r.data?.results || []).filter((x) => x.type === 'eleve').slice(0, 6);
            results.innerHTML = list.length ? `<div class="list mt-2" style="border:1px solid var(--border);border-radius:var(--r-sm)">${list.map((x) => `<button type="button" class="list-item" data-pick="${x.id}" style="width:100%">
                ${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
                <span class="li-body"><span class="li-title">${esc(x.first_name)} ${esc(x.last_name)}</span><span class="li-sub">${esc(x.matricule || '')} · ${esc(x.classe || '')}</span></span></button>`).join('')}</div>` : '';
            results.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
              form.insertAdjacentHTML('beforebegin', '');
              const hid = document.createElement('input');
              hid.type = 'hidden';
              hid.name = 'student_id';
              hid.value = b.dataset.pick;
              form.appendChild(hid);
              qIn.closest('.field').innerHTML = `<div class="row gap-3" style="padding:8px 10px;background:var(--surface-2);border-radius:var(--r-sm)">
                ${b.querySelector('.avatar').outerHTML}<div><b>${b.querySelector('.li-title').textContent}</b><div class="subtle small">${b.querySelector('.li-sub').textContent}</div></div></div>`;
              results.innerHTML = '';
            }));
          } catch { /* ignore */ }
        }, 260));
      }
      layer.querySelector('#pf-go').addEventListener('click', () => withBusy(layer.querySelector('#pf-go'), async () => {
        const payload = readForm(form, ['amount', 'student_id', 'invoice_id']);
        if (!payload.student_id) return toastErr('Élève requis', 'Recherchez et sélectionnez l\'élève concerné.');
        if (!payload.amount || payload.amount <= 0) return toastErr('Montant invalide', 'Saisissez un montant supérieur à zéro.');
        try {
          let r;
          if (isMobile(payload.method) && isOnline()) {
            const init = await api.post('/finance/payments/mobile-money/initiate', {
              student_id: payload.student_id, amount: payload.amount, provider: payload.provider || payload.method, phone: payload.phone,
            });
            const okSend = await confirmDialog({
              title: `${init.data?.providerLabel || 'Mobile Money'} — ${xof(init.data?.amount || payload.amount)}`,
              message: init.data?.instruction || 'Confirmez le paiement sur le téléphone du payeur.',
              confirmLabel: 'Le client a validé', cancelLabel: 'Annuler la demande',
            });
            if (!okSend) return;
            r = await api.post(`/finance/payments/mobile-money/${init.data.id}/confirm`, { success: true });
            r = { data: { payment: { id: r.data.payment_id, amount: r.data.amount, receipt_number: `reçu ${r.data.provider_ref || ''}` } } };
          } else {
            r = await api.post('/finance/payments', payload);
          }
          close();
          const p = r.data?.payment || r.data;
          toastOk('Paiement encaissé', `${xof(p?.amount || payload.amount)} · reçu ${p?.receipt_number || ''}.`);
          if (p?.id) printReceipt(p.id);
          onDone?.();
        } catch (e) { toastErr('Encaissement impossible', e.message); }
      }));
    },
  });
  return m;
}

/* ================================================================== */
/* PAIEMENTS (journal)                                                 */
/* ================================================================== */
async function paymentsView(el, query) {
  const f = { q: '', method: '', from: '', to: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Paiements & journal de caisse</h1>
        <p class="subtle small mt-2">Chaque encaissement génère un reçu numéroté. Le journal de caisse du jour s'imprime pour la comptabilité.</p></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="py-journal">${icon('printer', { size: 15 })} Journal du jour</button>
        <button class="btn btn-primary" data-new id="py-new">${icon('banknote', { size: 15 })} Encaisser</button>
      </div>
    </header>
    <div class="card"><div class="card-body" id="py-toolbar"></div>
      <div class="card-body" style="padding:0" id="py-table">${skeletonRows(9, 7)}</div>
      <div class="card-foot" id="py-pager"></div></div>`;
  const slot = el.querySelector('#py-toolbar');
  const fetchRows = debounce(async () => {
    const t = el.querySelector('#py-table');
    t.innerHTML = skeletonRows(8, 7);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/finance/payments?${q}`);
      const rows = r.data || [];
      slot.innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Reçu, élève, référence…',
        filters: `<select class="select select-sm" data-f="method"><option value="">Tous moyens</option>
            ${dictEntries(METHODE_PAIEMENT).map((o) => `<option value="${o.value}" ${f.method === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <input class="input input-sm" type="date" data-f="from" value="${f.from}" aria-label="Du">
          <input class="input input-sm" type="date" data-f="to" value="${f.to}" aria-label="Au">`,
        actions: r.aggregate ? `<span class="subtle small">${icon('banknote', { size: 14 })} Total affiché : <b class="num">${xof(r.aggregate.total || 0)}</b></span>` : '',
      });
      slot.querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); }, 300));
      slot.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
      t.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'receipt', label: 'Reçu', width: '160px', render: (x) => `<a class="link-strong" href="#/finance/paiements/${x.id}/recu">${esc(x.receipt_number)}</a><div class="tiny subtle">${dateFr(x.paid_at || x.created_at)} ${heureFr(x.paid_at || x.created_at)}</div>` },
          { key: 'eleve', label: 'Élève / payeur', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name || '')} ${esc(x.last_name || '')}</div><div class="cell-user-sub">${esc(x.payeur || x.matricule || '')}</div></div></div>` },
          { key: 'amount', label: 'Montant', width: '130px', align: 'right', render: (x) => `<b class="num" style="font-size:14px">${xof(x.amount)}</b>` },
          { key: 'method', label: 'Moyen', width: '150px', render: (x) => methodeBadge(x.method) },
          { key: 'ref', label: 'Référence', hideBelow: 'lg', render: (x) => `<span class="tiny subtle">${esc(x.provider_ref || '—')}</span>` },
          { key: 'caisse', label: 'Caisse', width: '120px', hideBelow: 'xl', render: (x) => esc(x.recorded_by || x.caissier || '—') },
          { key: 'act', label: '', width: '150px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              <button class="btn btn-secondary btn-sm" data-rc="${x.id}">${icon('printer', { size: 13 })} Reçu</button>
              ${store.atLeast(70) ? `<button class="btn btn-ghost btn-icon btn-sm" data-rev="${x.id}" title="Annuler le paiement">${icon('repeat', { size: 15 })}</button>` : ''}</div>` },
        ],
        rows, dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'banknote', title: 'Aucun paiement', message: 'Les encaissements du jour apparaîtront ici.' });
      t.querySelectorAll('[data-rc]').forEach((b) => b.addEventListener('click', () => printReceipt(Number(b.dataset.rc))));
      t.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Annuler ce paiement ?', danger: true, confirmLabel: 'Annuler le paiement',
          message: 'Le montant sera réimputé aux factures concernées et le reçu sera marqué « annulé ». L\'opération est tracée dans l\'audit.' });
        if (!ok) return;
        try { await api.post(`/finance/payments/${b.dataset.rev}/reverse`); toastOk('Paiement annulé'); fetchRows(); }
        catch (e) { toastErr('Annulation impossible', e.message); }
      }));
      const pager = el.querySelector('#py-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'paiements' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  el.querySelector('#py-new').addEventListener('click', () => paymentForm({}, fetchRows));
  el.querySelector('#py-journal').addEventListener('click', () => printJournal(query.date));
  await fetchRows.flush();
  if (query.new) paymentForm(query.student ? { student_id: Number(query.student) } : {}, fetchRows);
}

/* ================================================================== */
/* Impayés & relances                                                  */
/* ================================================================== */
async function unpaidView(el, query) {
  const f = { q: '', class_id: '', min: '', retard: query.retard || '', page: 1, limit: 25 };
  let selection = new Set();
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Impayés & relances</h1>
        <p class="subtle small mt-2">Campagnes de relance SMS en un clic, échéanciers de paiement et suivi des promesses de règlement.</p></div>
      <div class="row gap-2 wrap">
        <button class="btn btn-secondary" id="up-export">${icon('download', { size: 15 })} Exporter</button>
        <button class="btn btn-primary" id="up-campaign">${icon('sms', { size: 15 })} Campagne de relance</button>
      </div>
    </header>
    <div class="grid grid-kpi" id="up-kpis"></div>
    <div class="card mt-4"><div class="card-body" id="up-toolbar"></div>
      <div class="card-body" style="padding:0" id="up-table">${skeletonRows(9, 6)}</div>
      <div class="card-foot" id="up-pager"></div></div>`;
  let totalDossiers = 0;
  const fetchRows = debounce(async () => {
    const t = el.querySelector('#up-table');
    t.innerHTML = skeletonRows(8, 6);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/finance/unpaid?${q}`);
      const rows = r.data || [];
      const agg = r.aggregate || {};
      totalDossiers = r.meta?.total ?? rows.length;
      el.querySelector('#up-kpis').innerHTML = [
        kpiFin('Dossiers avec solde', num(agg.dossiers || rows.length), 'users', 'danger', `${num(agg.factures || 0)} facture(s) concernée(s)`),
        kpiFin('Montant à recouvrer', xof(agg.total || rows.reduce((a, x) => a + x.solde, 0)), 'wallet', 'danger', 'Toutes échéances confondues'),
        kpiFin('Relances déjà envoyées', num(agg.relances || rows.reduce((a, x) => a + (x.relances || 0), 0)), 'sms', 'warn', 'SMS partis sur la période'),
        kpiFin('Dette moyenne / dossier', xof(Math.round((agg.total || 0) / Math.max(1, agg.dossiers || rows.length))), 'chart-pie', 'info', ''),
      ].join('');
      el.querySelector('#up-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Élève, parent, matricule…',
        filters: `<select class="select select-sm" data-f="retard"><option value="">Tous retards</option>
            <option value="30" ${f.retard === '30' ? 'selected' : ''}>+ de 30 jours</option>
            <option value="60" ${f.retard === '60' ? 'selected' : ''}>+ de 60 jours</option>
            <option value="90" ${f.retard === '90' ? 'selected' : ''}>+ de 90 jours</option></select>`,
        actions: `<span class="subtle small" id="up-sel"></span>`,
      });
      el.querySelector('#up-toolbar').querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); }, 300));
      el.querySelector('#up-toolbar').querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
      t.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'eleve', label: 'Élève', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
              <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.classe || '')} · ${esc(x.matricule || '')}</div></div></div>` },
          { key: 'solde', label: 'Solde dû', width: '130px', align: 'right', render: (x) => `<b class="num" style="color:var(--danger)">${xof(x.solde)}</b><div class="tiny subtle">${x.factures} facture(s)</div>` },
          { key: 'retard', label: 'Retard max', width: '110px', render: (x) => badge(`${x.jours_retard} j`, x.jours_retard > 90 ? 'danger' : x.jours_retard > 30 ? 'warn' : 'info') },
          { key: 'parent', label: 'Parent à contacter', hideBelow: 'md', render: (x) => `<span class="small">${esc(x.payeur || '—')}</span>${x.parent_tel ? `<div class="tiny num subtle">${esc(telFr(x.parent_tel))}</div>` : ''}` },
          { key: 'relances', label: 'Relances', width: '100px', align: 'center', hideBelow: 'lg', render: (x) => `<span class="num">${x.relances || 0}</span>${x.derniere_relance ? `<div class="tiny subtle">${dateFr(x.derniere_relance)}</div>` : ''}` },
          { key: 'act', label: '', width: '210px', align: 'right', render: (x) => `<div class="row gap-1" style="justify-content:flex-end">
              ${x.parent_tel ? `<button class="btn btn-secondary btn-sm" data-sms="${x.student_id}" data-tel="${esc(x.parent_tel)}">${icon('sms', { size: 13 })} SMS</button>` : ''}
              <button class="btn btn-secondary btn-sm" data-ech="${x.student_id}" data-solde="${x.solde}">${icon('calendar-days', { size: 13 })} Échéancier</button>
              <button class="btn btn-primary btn-sm" data-pay="${x.student_id}">${icon('banknote', { size: 13 })} Encaisser</button></div>` },
        ],
        rows, dense: true, zebra: true, selectable: true, selected: selection, onSelect: (s) => paintSel(s),
      }).outerHTML : emptyState({ icon: 'check-circle', title: 'Aucun impayé', message: 'Tous les dossiers sont à jour. Un exploit à souligner !' });
      t.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => paymentForm({ student_id: Number(b.dataset.pay) }, fetchRows)));
      t.querySelectorAll('[data-sms]').forEach((b) => b.addEventListener('click', () => go(`/communication/sms?to=${encodeURIComponent(b.dataset.tel)}&template=relance&student=${b.dataset.sms}`)));
      t.querySelectorAll('[data-ech]').forEach((b) => b.addEventListener('click', () => scheduleWizard(Number(b.dataset.ech), fetchRows, Number(b.dataset.solde))));
      const pager = el.querySelector('#up-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'dossiers' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
      paintSel(selection);
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  const paintSel = (s) => {
    const slot = el.querySelector('#up-sel');
    if (slot) slot.innerHTML = s.size ? `${badge(`${s.size} sélectionné(s)`, 'brand')} <button class="btn btn-link btn-sm" id="up-sel-relance">Relancer par SMS</button>` : '';
    slot?.querySelector('#up-sel-relance')?.addEventListener('click', () => campaign([...s]));
  };
  const campaign = (ids) => {
    modal({
      title: `Campagne de relance (${ids ? ids.length : 'tous les impayés'})`, icon: 'sms', size: 'modal-narrow',
      body: `<form id="cp-form">
        ${field({ label: 'Modèle de message', name: 'template', type: 'select', value: 'relance', options: [
          { value: 'relance', label: 'Rappel simple du solde' }, { value: 'relance_ferme', label: 'Relance ferme (après 30 j)' },
          { value: 'echeancier', label: 'Proposition d\'échéancier' }, { value: 'convocation', label: 'Convocation au bureau' }] })}
        <div id="cp-preview" class="mt-3"></div>
        ${field({ label: 'Limiter aux retards de plus de', name: 'min_days', type: 'number', value: f.retard ? Number(f.retard) : 0, min: 0, suffix: 'jours', hint: '0 = tous les dossiers avec solde.' })}
        <div class="alert alert-info mt-3">${icon('info', { size: 16 })}<div class="alert-body"><div class="alert-msg">
          Coût estimé : <b class="num" id="cp-cost">—</b> (25 FCFA / SMS de 160 caractères). Seuls les numéros ayant accepté les SMS seront servis.</div></div></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="cp-go">${icon('send', { size: 15 })} Envoyer la campagne</button>`,
      onMount: (layer, close) => {
        const preview = layer.querySelector('#cp-preview');
        const paintPreview = () => {
          const tpl = layer.querySelector('[name=template]').value;
          const texts = {
            relance: 'Bonjour, le solde de scolarité de {eleve} est de {solde} FCFA. Merci de régulariser par Orange Money ou Wave. {ecole}',
            relance_ferme: "RAPPEL URGENT : le solde de {eleve} est de {solde} FCFA et dépasse l'échéance. Sans règlement sous 8 jours, l'accès au portail sera suspendu. {ecole}",
            echeancier: 'Nous vous proposons un échéancier en 3 versements pour le solde de {eleve} ({solde} FCFA). Répondez OUI pour accepter. {ecole}',
            convocation: "Merci de passer au bureau de l'école {ecole} avant vendredi concernant la scolarité de {eleve} (solde {solde} FCFA).",
          };
          const sample = texts[tpl] || texts.relance;
          layer.dataset.message = sample;
          preview.innerHTML = `<div class="alert alert-brand" style="margin:0">${icon('sms', { size: 16 })}<div class="alert-body">
            <div class="alert-title">Aperçu du message</div><div class="alert-msg">${esc(sample)}</div></div></div>`;
          const segments = Math.ceil(sample.length / 160);
          const n = ids ? ids.length : (totalDossiers || 0);
          layer.querySelector('#cp-cost').textContent = `${num(n * segments * 25)} FCFA (${num(n)} SMS × ${segments} segment(s) · ${num(n)} famille(s) consentante(s))`;
        };
        layer.querySelector('[name=template]').addEventListener('change', paintPreview);
        paintPreview();
        layer.querySelector('#cp-go').addEventListener('click', () => withBusy(layer.querySelector('#cp-go'), async () => {
          try {
            const r = await api.post('/finance/reminders', {
              student_ids: ids && ids.length ? ids : null,
              template: layer.dataset.message || null,
              retard: Number(layer.querySelector('[name=min_days]').value) || 0,
            });
            close();
            toastOk('Campagne lancée', `${num(r.data?.queued ?? 0)} SMS mis en file · coût estimé ${xof(r.data?.cost_estimate || 0)}.`);
            fetchRows();
          } catch (e) { toastErr('Envoi impossible', e.message); }
        }));
      },
    });
  };
  el.querySelector('#up-campaign').addEventListener('click', () => campaign(null));
  el.querySelector('#up-export').addEventListener('click', async () => {
    try { await api.download('/finance/unpaid?format=csv', 'impayes.csv'); toastOk('Export terminé'); }
    catch (e) { toastErr('Export impossible', e.message); }
  });
  await fetchRows.flush();
}

function scheduleWizard(studentId, onDone, solde = 0) {
  modal({
    title: 'Proposer un échéancier', icon: 'calendar-days', size: 'modal-narrow',
    subtitle: 'Le solde est réparti en versements réguliers, chacun devenant une facture échéancée.',
    body: `<form id="sw-form">
      <div class="alert alert-brand" style="margin-bottom:12px">${icon('wallet', { size: 16 })}<div class="alert-body">
        <div class="alert-msg">Solde à répartir : <b class="num">${xof(solde)}</b></div></div></div>
      <div class="grid-2">
        ${field({ label: 'Nombre de versements', name: 'installments', type: 'number', value: 3, min: 2, max: 12 })}
        ${field({ label: 'Première échéance', name: 'first_due', type: 'date', value: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), required: true })}
      </div>
      ${field({ label: 'Fréquence', name: 'frequency', type: 'select', options: [
        { value: '30', label: 'Mensuelle (30 jours)' }, { value: '15', label: 'Toutes les 2 semaines' }, { value: '7', label: 'Hebdomadaire' }] })}
      ${field({ label: 'Notifier la famille', name: 'notify', type: 'switch', value: true, hint: 'SMS récapitulatif du plan de paiement.' })}
      <div class="wizard-note" id="sw-preview"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="sw-go">${icon('save', { size: 15 })} Créer l\'échéancier</button>`,
    onMount: (layer, close) => {
      const paint = () => {
        const n = Math.max(2, Number(layer.querySelector('[name=installments]').value) || 3);
        const step = Number(layer.querySelector('[name=frequency]').value) || 30;
        const first = layer.querySelector('[name=first_due]').value || aujourdhui();
        const part = Math.floor(solde / n);
        const rest = solde - part * (n - 1);
        layer.querySelector('#sw-preview').innerHTML = Array.from({ length: n }, (_, k) => {
          const d = k === 0 ? first : ajouterJours(first, k * step);
          return `<div class="expense-row"><span>Échéance ${k + 1}/${n} — ${dateFr(d)}</span><b class="num">${xof(k === n - 1 ? rest : part)}</b></div>`;
        }).join('');
      };
      layer.querySelectorAll('[name=installments],[name=frequency],[name=first_due]').forEach((inp) => inp.addEventListener('input', paint));
      paint();
      layer.querySelector('#sw-go').addEventListener('click', () => withBusy(layer.querySelector('#sw-go'), async () => {
        const payload = readForm(layer.querySelector('#sw-form'), ['installments', 'first_due', 'frequency', 'notify']);
        const n = Math.max(2, Number(payload.installments) || 3);
        const step = Number(payload.frequency) || 30;
        if (!solde) return toastErr('Solde inconnu', 'Rechargez la liste des impayés puis réessayez.');
        const part = Math.floor(solde / n);
        const rest = solde - part * (n - 1);
        try {
          for (let k = 0; k < n; k += 1) {
            await api.post('/finance/invoices', {
              student_id: studentId,
              amount: k === n - 1 ? rest : part,
              due_date: k === 0 ? payload.first_due : ajouterJours(payload.first_due, k * step),
              label: `Échéancier — versement ${k + 1}/${n}`,
              installment_no: k + 1, installment_of: n,
              note: `Plan de paiement en ${n} versements de ~${xof(part)}.`,
            });
          }
          if (payload.notify) {
            const r = await api.post('/finance/reminders', { student_ids: [studentId] });
            toastOk('Échéancier créé', `${n} échéances · ${num(r.data?.queued ?? 0)} SMS envoyé(s).`);
          } else {
            toastOk('Échéancier créé', `${n} échéances planifiées à partir du ${dateFr(payload.first_due)}.`);
          }
          close();
          onDone?.();
        } catch (e) { toastErr('Création impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* Frais scolaires                                                     */
/* ================================================================== */
async function feeTypesView(el) {
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Frais scolaires</h1>
        <p class="subtle small mt-2">Types de frais (scolarité, inscription, cantine, transport…), montants et nombre d'échéances. Base de toute la facturation.</p></div>
        ${store.atLeast(70) ? `<button class="btn btn-primary" data-new id="ft-new">${icon('plus', { size: 15 })} Nouveau type de frais</button>` : ''}
    </header>
    <div class="card"><div class="card-body" style="padding:0" id="ft-table">${skeletonRows(6, 6)}</div></div>`;
  const load = async () => {
    try {
      const r = await api.get('/finance/fee-types', { cacheTtl: 30000 });
      const rows = r.data || [];
      el.querySelector('#ft-table').innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'name', label: 'Frais', render: (x) => `<b>${esc(x.name)}</b><div class="tiny subtle">${esc(x.code || '')} · ${esc(dictLabel(CATEGORIES_FRAIS, x.category))}</div>` },
          { key: 'amount', label: 'Montant', width: '130px', align: 'right', render: (x) => `<b class="num">${xof(x.amount)}</b>` },
          { key: 'installments', label: 'Échéances', width: '120px', align: 'center', render: (x) => badge(x.installments > 1 ? `${x.installments} fois` : '1 fois', x.installments > 1 ? 'info' : 'neutral') },
          { key: 'recurring', label: 'Récurrent', width: '110px', align: 'center', hideBelow: 'md', render: (x) => (x.is_recurring ? badge('Chaque année', 'ok') : badge('Ponctuel', 'neutral')) },
          { key: 'required', label: 'Obligatoire', width: '110px', align: 'center', hideBelow: 'md', render: (x) => (x.is_required ? badge('Oui', 'brand') : badge('Option', 'neutral')) },
          { key: 'act', label: '', width: '96px', align: 'right', render: (x) => `<button class="btn btn-secondary btn-sm" data-edit="${x.id}">${icon('edit', { size: 13 })} Modifier</button>` },
        ],
        rows, dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'tag', title: 'Aucun type de frais', message: 'Créez au moins la scolarité annuelle pour pouvoir facturer.' });
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => feeForm(Number(b.dataset.edit), load)));
    } catch (err) {
      el.querySelector('#ft-table').innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  };
  el.querySelector('#ft-new')?.addEventListener('click', () => feeForm(null, load));
  load();
}

async function feeForm(id, onDone) {
  let current = null;
  if (id) {
    const r = await api.get('/finance/fee-types');
    current = (r.data || []).find((x) => x.id === id);
  }
  modal({
    title: id ? 'Modifier le type de frais' : 'Nouveau type de frais', icon: 'tag', size: 'modal-narrow',
    body: `<form id="ff-form"><div class="grid-2">
        ${field({ label: 'Nom', name: 'name', value: current?.name || '', required: true, placeholder: 'Scolarité annuelle' })}
        ${field({ label: 'Code', name: 'code', value: current?.code || '', placeholder: 'SCOL' })}
        ${field({ label: 'Catégorie', name: 'category', type: 'select', value: current?.category || 'scolarite', options: dictEntries(CATEGORIES_FRAIS).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Montant', name: 'amount', type: 'number', value: current?.amount || '', required: true, min: 0, suffix: 'FCFA' })}
        ${field({ label: 'Nombre d\'échéances', name: 'installments', type: 'number', value: current?.installments || 1, min: 1, max: 12, hint: '3 = trimestriel' })}
        ${field({ label: 'Pénalité de retard', name: 'late_fee_pct', type: 'number', value: current?.late_fee_pct || 0, min: 0, max: 50, suffix: '%' })}
      </div>
      ${field({ label: 'Récurrent chaque année', name: 'is_recurring', type: 'switch', value: current?.is_recurring ?? true })}
      ${field({ label: 'Obligatoire pour tous', name: 'is_required', type: 'switch', value: current?.is_required ?? true, hint: 'Sinon facturable à la demande (cantine, transport…).' })}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="ff-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#ff-go').addEventListener('click', () => withBusy(layer.querySelector('#ff-go'), async () => {
        const payload = readForm(layer.querySelector('#ff-form'), ['amount', 'installments', 'late_fee_pct']);
        try {
          if (id) await api.patch(`/finance/fee-types/${id}`, payload);
          else await api.post('/finance/fee-types', payload);
          close();
          toastOk(id ? 'Frais mis à jour' : 'Frais créé', payload.name);
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* Dépenses                                                            */
/* ================================================================== */
async function expensesView(el, query) {
  const f = { q: '', category: '', from: '', to: '', page: 1, limit: 25 };
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Dépenses</h1>
        <p class="subtle small mt-2">Salaires, loyers, fournitures, énergie : suivez la sortie de trésorerie par catégorie et par mode de règlement.</p></div>
        ${store.atLeast(70) ? `<button class="btn btn-primary" data-new id="ex-new">${icon('plus', { size: 15 })} Nouvelle dépense</button>` : ''}
    </header>
    <div class="grid grid-2-1">
      <div class="card"><div class="card-body" id="ex-toolbar"></div>
        <div class="card-body" style="padding:0" id="ex-table">${skeletonRows(8, 6)}</div>
        <div class="card-foot" id="ex-pager"></div></div>
      <div class="card"><div class="card-head"><div><h2>${icon('chart-pie', { size: 16 })} Dépenses par catégorie</h2></div></div>
        <div class="card-body" id="ex-chart"></div></div>
    </div>`;
  const fetchRows = debounce(async () => {
    const t = el.querySelector('#ex-table');
    t.innerHTML = skeletonRows(7, 6);
    try {
      const q = new URLSearchParams({ limit: f.limit, page: f.page });
      Object.entries(f).forEach(([k, v]) => { if (v && !['limit', 'page'].includes(k)) q.set(k, v); });
      const r = await api.get(`/finance/expenses?${q}`);
      const rows = r.data || [];
      el.querySelector('#ex-toolbar').innerHTML = toolbar({
        search: f.q, searchPlaceholder: 'Libellé, fournisseur, référence…',
        filters: `<select class="select select-sm" data-f="category"><option value="">Toutes catégories</option>
          ${dictEntries(CATEGORIES_DEPENSE).map((o) => `<option value="${o.value}" ${f.category === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`,
        actions: r.aggregate ? `<span class="subtle small">${icon('wallet', { size: 14 })} Total : <b class="num">${xof(r.aggregate.total || 0)}</b></span>` : '',
      });
      el.querySelector('#ex-toolbar').querySelector('[data-search]').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); f.page = 1; fetchRows(); }, 300));
      el.querySelector('#ex-toolbar').querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { f[s.dataset.f] = s.value; f.page = 1; fetchRows(); }));
      t.innerHTML = rows.length ? dataTable({
        columns: [
          { key: 'date', label: 'Date', width: '110px', render: (x) => `<b class="small">${dateFr(x.expense_date)}</b>` },
          { key: 'label', label: 'Libellé', render: (x) => `<b class="small">${esc(x.label)}</b><div class="tiny subtle">${esc(x.supplier || '')} · réf. ${esc(x.reference || '—')}</div>` },
          { key: 'category', label: 'Catégorie', width: '140px', hideBelow: 'md', render: (x) => badge(dictLabel(CATEGORIES_DEPENSE, x.category), 'neutral') },
          { key: 'amount', label: 'Montant', width: '130px', align: 'right', render: (x) => `<b class="num">${xof(x.amount)}</b>` },
          { key: 'method', label: 'Réglée par', width: '140px', hideBelow: 'lg', render: (x) => methodeBadge(x.method) },
          { key: 'status', label: 'Statut', width: '110px', align: 'right', render: (x) => badge(x.status === 'validee' ? 'Validée' : x.status === 'en_attente' ? 'À valider' : x.status, x.status === 'validee' ? 'ok' : 'warn') },
          { key: 'act', label: '', width: '80px', align: 'right', render: (x) => (store.atLeast(70) ? `<button class="btn btn-ghost btn-icon btn-sm" data-edit="${x.id}" title="Modifier">${icon('edit', { size: 15 })}</button>` : '') },
        ],
        rows, dense: true, zebra: true,
      }).outerHTML : emptyState({ icon: 'wallet', title: 'Aucune dépense', message: 'Enregistrez vos sorties de caisse pour suivre la trésorerie réelle.' });
      el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => expenseForm(Number(b.dataset.edit), fetchRows)));
      const pager = el.querySelector('#ex-pager');
      pager.innerHTML = pagination({ page: r.meta.page, pages: r.meta.pages || 1, total: r.meta.total, size: r.meta.size, label: 'dépenses' });
      wirePagination(pager, (p) => { f.page = p; fetchRows(); });
      const cats = r.aggregate?.categories || [];
      const host = el.querySelector('#ex-chart');
      host.innerHTML = '';
      if (cats.length) {
        host.appendChild(donutChart(cats.map((x) => ({ label: dictLabel(CATEGORIES_DEPENSE, x.categorie), value: x.total })),
          { height: 190, thickness: 24, format: xofShort, centerLabel: xofShort(cats.reduce((a, x) => a + x.total, 0)), centerSub: 'dépensé' }));
      } else host.innerHTML = emptyState({ icon: 'chart-pie', title: 'Pas de données', message: 'Aucune dépense enregistrée.' });
    } catch (err) {
      t.innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
    }
  }, 220);
  el.querySelector('#ex-new')?.addEventListener('click', () => expenseForm(null, fetchRows));
  await fetchRows.flush();
}

async function expenseForm(id, onDone) {
  let current = null;
  if (id) {
    const r = await api.get(`/finance/expenses?limit=200`);
    current = (r.data || []).find((x) => x.id === id);
  }
  modal({
    title: id ? 'Modifier la dépense' : 'Nouvelle dépense', icon: 'wallet', size: 'modal-narrow',
    body: `<form id="ef-form"><div class="grid-2">
        ${field({ label: 'Date', name: 'expense_date', type: 'date', value: current?.expense_date || aujourdhui(), required: true })}
        ${field({ label: 'Catégorie', name: 'category', type: 'select', value: current?.category || 'fournitures', required: true, options: dictEntries(CATEGORIES_DEPENSE).map((o) => ({ value: o.value, label: o.label })) })}
      </div>
      ${field({ label: 'Libellé', name: 'label', value: current?.label || '', required: true, placeholder: 'Achat de craies et registres' })}
      <div class="grid-2">
        ${field({ label: 'Montant', name: 'amount', type: 'number', value: current?.amount || '', required: true, min: 0, suffix: 'FCFA' })}
        ${field({ label: 'Mode de règlement', name: 'method', type: 'select', value: current?.method || 'especes', options: dictEntries(METHODE_PAIEMENT).map((o) => ({ value: o.value, label: o.label })) })}
        ${field({ label: 'Fournisseur / bénéficiaire', name: 'supplier', value: current?.supplier || '' })}
        ${field({ label: 'Référence (facture, quittance)', name: 'reference', value: current?.reference || '' })}
      </div>
      ${field({ label: 'Note', name: 'note', type: 'textarea', rows: 2, value: current?.note || '' })}
      ${store.atLeast(90) ? field({ label: 'Valider immédiatement', name: 'approve', type: 'switch', value: false, hint: 'Sinon la dépense restera « à valider » par la direction.' }) : ''}
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button><button class="btn btn-primary" id="ef-go">${icon('save', { size: 15 })} Enregistrer</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#ef-go').addEventListener('click', () => withBusy(layer.querySelector('#ef-go'), async () => {
        const payload = readForm(layer.querySelector('#ef-form'), ['amount']);
        try {
          if (id) await api.patch(`/finance/expenses/${id}`, payload);
          else await api.post('/finance/expenses', payload);
          close();
          toastOk(id ? 'Dépense mise à jour' : 'Dépense enregistrée', `${xof(payload.amount)} · ${dictLabel(CATEGORIES_DEPENSE, payload.category)}`);
          onDone?.();
        } catch (e) { toastErr('Enregistrement impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* Paie                                                                */
/* ================================================================== */
async function payrollView(el) {
  el.innerHTML = `
    <header class="row-between wrap mb-4" style="align-items:flex-end">
      <div><div class="uppercase mb-2">Finances</div><h1 class="h-page">Paie du personnel</h1>
        <p class="subtle small mt-2">Génération mensuelle de la paie (salaire de base, primes, retenues CNSS/impôt), bulletins de paie et validation par la direction.</p></div>
        ${store.atLeast(70) ? `<button class="btn btn-primary" id="pw-gen">${icon('zap', { size: 15 })} Générer la paie du mois</button>` : ''}
    </header>
    <div class="grid grid-kpi" id="pw-kpis"></div>
    <div class="grid grid-2-1 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('briefcase', { size: 16 })} Personnel & salaires</h2>
        <p class="subtle tiny mt-2">Cliquez pour voir le détail et l'historique de paie.</p></div></div>
        <div class="card-body" style="padding:0" id="pw-staff">${skeletonRows(8, 5)}</div></div>
      <div class="col gap-4">
        <div class="card"><div class="card-head"><div><h2>${icon('history', { size: 16 })} Campagnes de paie</h2></div></div>
          <div class="card-body" style="padding:0" id="pw-runs"></div></div>
        <div class="card"><div class="card-head"><div><h2>${icon('calendar-check', { size: 16 })} Congés en cours</h2></div></div>
          <div class="card-body" style="padding:0" id="pw-leaves"></div></div>
      </div>
    </div>`;
  try {
    const r = await api.get('/finance/payroll');
    const d = r.data;
    el.querySelector('#pw-kpis').innerHTML = [
      kpiFin('Masse salariale mensuelle', xof(d.masse_salariale), 'briefcase', 'brand', `${d.staff?.length || 0} membre(s) du personnel`),
      kpiFin('Masse annuelle projetée', xof(d.masse_annuelle), 'trending', 'info', 'Hors primes exceptionnelles'),
      kpiFin('Dernier net versé', xof(d.runs?.[0]?.total_net || 0), 'banknote', 'ok', d.runs?.[0] ? `Période ${d.runs[0].period}` : 'Aucune paie validée'),
      kpiFin('Ratio masse / recettes', `${d.ratio ?? '—'}`, 'gauge', (d.ratio || 0) > 60 ? 'danger' : (d.ratio || 0) > 45 ? 'warn' : 'ok', '% des encaissements (repère : < 50 %)'),
    ].join('');
    el.querySelector('#pw-staff').innerHTML = dataTable({
      columns: [
        { key: 'nom', label: 'Agent', render: (x) => `<div class="cell-user">${avatar({ first: x.first_name, last: x.last_name, size: 'avatar-sm' })}
            <div><div class="cell-user-name">${esc(x.first_name)} ${esc(x.last_name)}</div><div class="cell-user-sub">${esc(x.job_title || '')}</div></div></div>` },
        { key: 'type', label: 'Type', width: '120px', hideBelow: 'md', render: (x) => badge(x.staff_type === 'enseignant' ? 'Enseignant' : x.staff_type === 'administratif' ? 'Admin.' : x.staff_type, 'neutral') },
        { key: 'contract', label: 'Contrat', width: '90px', hideBelow: 'lg', render: (x) => esc((x.contract_type || '').toUpperCase()) },
        { key: 'base', label: 'Salaire base', width: '120px', align: 'right', render: (x) => `<b class="num">${xof(x.salary_base)}</b>` },
        { key: 'net', label: 'Dernier net', width: '120px', align: 'right', render: (x) => `<span class="num" style="color:var(--ok)">${xof(x.dernier_net || 0)}</span>` },
      ],
      rows: d.staff || [], dense: true, zebra: true, onRowClick: (x) => go(`/personnel/${x.id}`),
    }).outerHTML;
    el.querySelector('#pw-runs').innerHTML = (d.runs || []).length ? `<div class="list">${d.runs.slice(0, 8).map((x) => `<div class="list-item">
        <span class="li-ico" data-tone="${x.status === 'valide' ? 'ok' : 'warn'}">${icon('banknote', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">Paie ${esc(x.period)}</span>
          <span class="li-sub">Brut ${xof(x.total_gross)} · net ${xof(x.total_net)} · ${x.bulletins} bulletin(s)</span></span>
        <span class="li-aside">${badge(x.status === 'valide' ? 'Validée' : 'Brouillon', x.status === 'valide' ? 'ok' : 'warn')}
          ${x.status !== 'valide' ? `<button class="btn btn-secondary btn-sm" data-validate="${x.id}">Valider</button>` : ''}</span></div>`).join('')}</div>`
      : emptyState({ icon: 'banknote', title: 'Aucune campagne', message: 'Générez la paie du mois en un clic.' });
    el.querySelectorAll('[data-validate]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Valider cette paie ?', message: 'Les bulletins de paie seront verrouillés et la dépense salariale enregistrée en comptabilité.', confirmLabel: 'Valider' }))) return;
      try { await api.post(`/finance/payroll/${b.dataset.validate}/validate`); toastOk('Paie validée'); payrollView(el); }
      catch (e) { toastErr('Validation impossible', e.message); }
    }));
    const leaves = d['congés'] || d.conges || [];
    el.querySelector('#pw-leaves').innerHTML = leaves.length ? `<div class="list">${leaves.slice(0, 5).map((x) => `<div class="list-item">
        <span class="li-ico" data-tone="${x.status === 'approuve' ? 'ok' : x.status === 'refuse' ? 'danger' : 'warn'}">${icon('calendar-check', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">${esc(x.first_name)} ${esc(x.last_name)}</span>
          <span class="li-sub">${dateFr(x.date_from)} → ${dateFr(x.date_to)} · ${x.days} j</span></span>
        <span class="li-aside">${badge(x.status === 'approuve' ? 'Approuvé' : x.status === 'refuse' ? 'Refusé' : 'En attente', x.status === 'approuve' ? 'ok' : x.status === 'refuse' ? 'danger' : 'warn')}</span></div>`).join('')}</div>`
      : `<div style="padding:18px"><p class="subtle small">Aucun congé en cours.</p></div>`;
  } catch (err) {
    el.querySelector('#pw-staff').innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
  }
  el.querySelector('#pw-gen')?.addEventListener('click', async () => {
    const period = new Date().toISOString().slice(0, 7);
    const go1 = await confirmDialog({
      title: `Générer la paie de ${period} ?`,
      message: 'Le calcul applique le salaire de base, les heures supplémentaires saisies et les retenues (IPRES 5,6 %, impôt au-delà de 300 000 FCFA). Vous pourrez vérifier chaque bulletin avant validation.',
      confirmLabel: 'Générer les bulletins',
    });
    if (!go1) return;
    const generate = async (force) => {
      const r = await api.post('/finance/payroll/generate', force ? { period, force: true } : { period });
      const run = r.data?.run_id ? await api.get(`/finance/payroll/${r.data.run_id}`).catch(() => null) : null;
      toastOk('Paie générée', run ? `${num(run.data?.slips?.length || 0)} bulletin(s) · net total ${xof(run.data?.run?.total_net || 0)} — à valider.` : `Campagne ${period} prête à vérifier.`);
      payrollView(el);
    };
    try {
      await generate(false);
    } catch (e) {
      if (String(e.message).includes('existe déjà')) {
        const again = await confirmDialog({ title: 'Paie déjà générée', message: `La campagne de ${period} existe déjà en brouillon. La régénérer écrasera les bulletins non validés.`, confirmLabel: 'Régénérer', danger: true });
        if (again) { try { await generate(true); } catch (e2) { toastErr('Génération impossible', e2.message); } }
        return;
      }
      toastErr('Génération impossible', e.message);
    }
  });
}

/* ================================================================== */
/* Reçus & journal (impression)                                        */
/* ================================================================== */
async function printReceipt(paymentId) {
  try {
    const r = await api.get(`/finance/payments/${paymentId}/receipt`);
    const p = r.data.payment;
    const school = r.data.school || {};
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return toastErr('Fenêtre bloquée', 'Autorisez les fenêtres pop-up pour imprimer le reçu.');
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Reçu ${esc(p.receipt_number || '')}</title>
      <link rel="stylesheet" href="/assets/css/tokens.css"><link rel="stylesheet" href="/assets/css/print.css"></head>
      <body><div class="print-area">
        <div class="receipt">
          <div class="receipt-head"><b>${esc(school.name || '')}</b><span>${esc(school.address || '')} ${esc(school.city || '')}</span><span>${esc(school.phone || '')}</span></div>
          <div class="receipt-no">REÇU N° ${esc(p.receipt_number || '')}</div>
          <div class="receipt-table">
            <div class="receipt-row"><span>Date</span><b>${dateFr(p.paid_at || p.created_at)} ${heureFr(p.paid_at || p.created_at)}</b></div>
            <div class="receipt-row"><span>Reçu de</span><b>${esc(p.payeur || `${p.first_name || ''} ${p.last_name || ''}`)}</b></div>
            <div class="receipt-row"><span>Élève</span><b>${esc(p.first_name || '')} ${esc(p.last_name || '')} (${esc(p.matricule || '')})</b></div>
            <div class="receipt-row"><span>Motif</span><b>${esc(p.label || 'Paiement de scolarité')}</b></div>
            <div class="receipt-row"><span>Moyen</span><b>${esc(dictLabel(METHODE_PAIEMENT, p.method))}${p.provider_ref ? ` · ${esc(p.provider_ref)}` : ''}</b></div>
          </div>
          <div class="receipt-total"><span>MONTANT REÇU</span><b class="num">${xof(p.amount)}</b></div>
          <div class="receipt-table"><div class="receipt-row"><span>Solde restant</span><b class="num">${xof(p.remaining ?? p.solde_restant ?? 0)}</b></div></div>
          <div class="receipt-foot">Caissier(ère) : ${esc(p.caissier || '')} — ${esc(school.footer || 'Merci de conserver ce reçu.')}<br>Document généré électroniquement — valable sans signature manuscrite</div>
          <div class="receipt-stamp">PAYÉ</div>
        </div></div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    w.document.close();
  } catch (e) { toastErr('Reçu indisponible', e.message); }
}

async function printJournal(date) {
  const d = date || aujourdhui();
  try {
    const r = await api.get(`/finance/reports/cash-journal?date=${d}`);
    const rows = r.data?.payments || r.data?.rows || [];
    const tot = r.data?.totals || {};
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return toastErr('Fenêtre bloquée', 'Autorisez les fenêtres pop-up pour imprimer.');
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Journal de caisse ${d}</title>
      <link rel="stylesheet" href="/assets/css/tokens.css"><link rel="stylesheet" href="/assets/css/print.css"></head>
      <body><div class="print-area">
        <div class="doc-head"><div></div><div class="doc-head-school"><b>${esc(r.data?.school_name || '')}</b><span>Journal de caisse du ${dateFr(d)}</span></div><div></div></div>
        <div class="doc-title">Journal de caisse</div>
        <table class="print-list"><thead><tr><th>Reçu</th><th>Heure</th><th>Payeur / élève</th><th>Motif</th><th>Moyen</th><th class="right">Montant</th></tr></thead>
        <tbody>${rows.map((x) => `<tr><td>${esc(x.receipt_number || '')}</td><td>${heureFr(x.paid_at || x.created_at)}</td>
          <td>${esc(x.payeur || `${x.first_name || ''} ${x.last_name || ''}`)}</td><td>${esc(x.label || '')}</td>
          <td>${esc(dictLabel(METHODE_PAIEMENT, x.method))}</td><td class="right num">${xof(x.amount)}</td></tr>`).join('') || '<tr><td colspan="6">Aucun encaissement ce jour.</td></tr>'}</tbody>
        <tfoot><tr><td colspan="5"><b>Total encaissé</b></td><td class="right num"><b>${xof(tot.encaisse ?? tot.total ?? rows.reduce((a, x) => a + x.amount, 0))}</b></td></tr>
        ${tot.especes != null ? `<tr><td colspan="5">Dont espèces en caisse</td><td class="right num">${xof(tot.especes)}</td></tr>` : ''}
        ${tot.mobile != null ? `<tr><td colspan="5">Dont Mobile Money</td><td class="right num">${xof(tot.mobile)}</td></tr>` : ''}</tfoot></table>
        <div class="doc-foot">Arrêté le ${dateFr(d)} à ${heureFr(new Date().toISOString())} — signature du caissier : ____________________ — visa direction : ____________________</div>
      </div><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    w.document.close();
  } catch (e) { toastErr('Journal indisponible', e.message); }
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerFinance(route) {
  route('/finance', async ({ query }) => { const el = h('<div class="view"></div>'); if (query.journal) printJournal(); financeDashboard(el, query); return el; }, { title: 'Vue financière', group: 'Finances' });
  route('/finance/factures', async ({ query }) => { const el = h('<div class="view"></div>'); invoicesView(el, query); return el; }, { title: 'Factures', group: 'Finances' });
  route('/finance/factures/:id', async ({ params }) => { const el = h('<div class="view"></div>'); el.innerHTML = '<div class="card"><div class="card-body">' + spinnerNote('Chargement…') + '</div></div>'; invoiceDrawer(Number(params.id)); return el; }, { title: 'Facture', group: 'Finances' });
  route('/finance/paiements', async ({ query }) => { const el = h('<div class="view"></div>'); paymentsView(el, query); return el; }, { title: 'Paiements', group: 'Finances' });
  route('/finance/paiements/:id/recu', async ({ params }) => { printReceipt(Number(params.id)); const el = h('<div class="view"></div>'); el.innerHTML = '<div class="card"><div class="card-body">' + emptyState({ icon: 'printer', title: 'Reçu ouvert', message: 'La fenêtre d\'impression du reçu vient de s\'ouvrir.' }) + '<div class="actions"><button class="btn btn-primary" onclick="history.back()">Retour</button></div></div></div>'; return el; }, { title: 'Reçu', group: 'Finances' });
  route('/finance/impayes', async ({ query }) => { const el = h('<div class="view"></div>'); unpaidView(el, query); return el; }, { title: 'Impayés & relances', group: 'Finances' });
  route('/finance/frais', async () => { const el = h('<div class="view"></div>'); feeTypesView(el); return el; }, { title: 'Frais scolaires', group: 'Finances' });
  route('/finance/depenses', async ({ query }) => { const el = h('<div class="view"></div>'); expensesView(el, query); return el; }, { title: 'Dépenses', group: 'Finances' });
  route('/finance/paie', async () => { const el = h('<div class="view"></div>'); payrollView(el); return el; }, { title: 'Paie du personnel', group: 'Finances' });
}

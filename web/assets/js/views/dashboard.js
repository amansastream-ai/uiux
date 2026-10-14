/**
 * SunuÉcole — Tableaux de bord (direction, enseignant) et centre d'alertes.
 *
 * Principe : la page s'affiche immédiatement en squelette, puis chaque bloc
 * se remplit dès que sa donnée arrive. Sur une connexion 3G lente, le
 * directeur voit sa structure d'écran en moins de 100 ms au lieu d'un écran
 * blanc pendant plusieurs secondes.
 */
import { api, setToken } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import { h, esc, badge, avatar, progress, emptyState, skeletonCards, dataTable, toastOk, toastErr, withBusy, debounce } from '../ui/components.js';
import { xof, xofShort, num, pct, note, dateLong, dateFr, relatif, METHODE_PAIEMENT, STATUT_FACTURE, etatNote, joursEntre } from '../core/format.js';
import { lineChart, barChart, donutChart, gauge, sparkline } from '../core/charts.js';

const ROLE_TITLES = {
  direction: 'Vue d\'ensemble de l\'établissement',
  censeur: 'Vie scolaire & pédagogie',
  comptable: 'Finances & recouvrement',
  secretaire: 'Scolarité & accueil',
  enseignant: 'Ma journée et mes classes',
  surveillant: 'Vie scolaire',
  bibliothecaire: 'Bibliothèque',
  infirmier: 'Infirmerie',
  super_admin: 'Vue plateforme',
};

/* ================================================================== */
/* Tuile KPI                                                           */
/* ================================================================== */
function kpi({ label, value, unit, tone = '', delta, hint, iconName, spark, to }) {
  const d = delta != null && delta !== ''
    ? `<span class="delta ${Number(delta) >= 0 ? 'up' : 'down'}">${icon(Number(delta) >= 0 ? 'trending' : 'trending-down', { size: 13 })}${num(Math.abs(Number(delta)), 1)} %</span>`
    : '';
  const inner = `
    <div class="kpi-top">
      <span class="kpi-ico" ${tone ? `data-tone="${tone}"` : ''}>${icon(iconName, { size: 18 })}</span>
      <span class="kpi-label">${esc(label)}</span>
      ${to ? `<span class="kpi-go">${icon('arrow-right', { size: 15 })}</span>` : ''}
    </div>
    <div class="kpi-val">${esc(value)}${unit ? `<span class="kpi-unit">${esc(unit)}</span>` : ''}</div>
    <div class="kpi-foot">
      ${d}${hint ? `<span class="kpi-hint">${hint}</span>` : ''}
      ${spark ? `<span class="kpi-spark">${spark}</span>` : ''}
    </div>`;
  return to ? `<a class="kpi" href="#${to}">${inner}</a>` : `<div class="kpi">${inner}</div>`;
}

/* ================================================================== */
/* DASHBOARD DIRECTION                                                 */
/* ================================================================== */
function adminSkeleton() {
  return `${skeletonCards(4)}
    <div class="grid grid-2-1 mt-4">
      <div class="skeleton sk-card" style="height:280px"></div>
      <div class="skeleton sk-card" style="height:280px"></div>
    </div>`;
}

async function adminDashboard(el) {
  const [sum, charts, alerts, todo] = await Promise.all([
    api.get('/dashboard/summary', { cacheTtl: 20000 }),
    api.get('/dashboard/charts', { cacheTtl: 30000 }).catch(() => ({ data: null })),
    api.get('/dashboard/alerts').catch(() => ({ data: { alerts: [], total: 0 } })),
    api.get('/dashboard/todo').catch(() => ({ data: { tasks: [] } })),
  ]);
  const d = sum.data;
  const c = charts.data || {};
  const k = d.kpis;
  store.set({ school: d.school });

  const sparkPresence = sparkline((c.presence_30j || []).slice(-14).map((x) => x.taux), { color: '#0e7c66' });
  const sparkFlux = sparkline((c.flux_12m || []).map((x) => x.encaissements), { color: '#1d4ed8' });

  el.innerHTML = `
    <!-- Bandeau d'accueil + actions rapides -->
    <div class="dash-hero">
      <div class="dash-hero-txt">
        <div class="tiny" style="opacity:.85">${icon('calendar', { size: 12 })} ${esc(dateLong(d.date))} · ${esc(d.school.name)} · Année ${esc(d.school.academicYear || '')}</div>
        <h1>Bonjour ${esc(store.state.user.firstName)} ${greeting()}</h1>
        <p>${esc(ROLE_TITLES[store.state.user.role] || '')} —
          ${k.presence.taux != null ? `${k.presence.taux} % de présence aujourd'hui, ` : ''}
          ${k.finance.taux_recouvrement} % de recouvrement, moyenne générale ${note(k.pedagogie.moyenne)}/20.</p>
      </div>
      <div class="dash-hero-actions" id="quick-actions"></div>
    </div>

    ${d.school.subscriptionStatus === 'trial' ? trialBanner(d.school) : ''}

    <!-- KPI principaux -->
    <div class="grid grid-kpi mt-4">
      ${kpi({ label: 'Effectif total', value: num(k.effectif.total), unit: 'élèves', iconName: 'users', tone: 'brand',
        hint: `${num(k.effectif.filles)} filles · parité ${pct(k.effectif.parite)} · ${k.effectif.sortis} sorti(s)`, to: '/scolaire/eleves' })}
      ${kpi({ label: 'Présence du jour', value: k.presence.taux == null ? '—' : `${k.presence.taux}`, unit: '%', iconName: 'clipboard-check',
        tone: k.presence.taux >= 92 ? 'ok' : k.presence.taux >= 85 ? 'warn' : 'danger',
        delta: sparkDelta(c.presence_30j), spark: sparkPresence,
        hint: `${k.presence.absents} absent(s) · ${k.presence.retards} retard(s)`, to: '/vie-scolaire/presences' })}
      ${kpi({ label: 'Recouvrement', value: `${k.finance.taux_recouvrement}`, unit: '%', iconName: 'wallet',
        tone: k.finance.taux_recouvrement >= 85 ? 'ok' : k.finance.taux_recouvrement >= 70 ? 'warn' : 'danger',
        spark: sparkFlux,
        hint: `${xofShort(k.finance.solde)} restant à encaisser · ${k.finance.impayees} facture(s)`, to: '/finance' })}
      ${kpi({ label: 'Moyenne générale', value: note(k.pedagogie.moyenne), unit: '/20', iconName: 'graduation-cap',
        tone: k.pedagogie.moyenne >= 12 ? 'ok' : k.pedagogie.moyenne >= 10 ? 'warn' : 'danger',
        hint: `${esc(k.pedagogie.trimestre)} · ${num(k.pedagogie.notes)} notes saisies`, to: '/pedagogie/resultats' })}
    </div>

    <!-- Graphiques -->
    <div class="grid grid-2-1 mt-4">
      <div class="card">
        <div class="card-head">
          <div><h2>${icon('activity', { size: 16 })} Présence sur 30 jours</h2>
            <p class="subtle tiny mt-2">Taux journalier de présence — surveillez les creux (épidémies, jours fériés, grèves).</p></div>
          <a class="btn btn-ghost btn-sm" href="#/vie-scolaire/absences">Détails ${icon('chevron-right', { size: 14 })}</a>
        </div>
        <div class="card-body" id="ch-presence"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon('alert-triangle', { size: 16 })} Alertes</h2>
          <p class="subtle tiny mt-2">${alerts.data.total} point(s) demandent votre attention.</p></div>
          <a class="btn btn-ghost btn-sm" href="#/alertes">Tout voir</a></div>
        <div class="card-body" id="box-alerts" style="padding:0"></div>
      </div>
    </div>

    <div class="grid grid-3 mt-4">
      <div class="card">
        <div class="card-head"><div><h2>${icon('chart', { size: 16 })} Flux financiers (12 mois)</h2>
          <p class="subtle tiny mt-2">Encaissements vs dépenses</p></div></div>
        <div class="card-body" id="ch-flux"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon('smartphone', { size: 16 })} Moyens de paiement</h2>
          <p class="subtle tiny mt-2">Mobile Money en tête : adaptez vos relances</p></div></div>
        <div class="card-body" id="ch-methodes"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon('receipt', { size: 16 })} État des factures</h2>
          <p class="subtle tiny mt-2">Répartition et montants restants</p></div></div>
        <div class="card-body" id="ch-factures"></div>
      </div>
    </div>

    <div class="grid grid-2-1 mt-4">
      <div class="card">
        <div class="card-head">
          <div><h2>${icon('school', { size: 16 })} Classes — effectifs et remplissage</h2>
            <p class="subtle tiny mt-2">${k.classes.surchargees} classe(s) au-dessus de la capacité. Cliquez pour ouvrir le détail.</p></div>
          <a class="btn btn-secondary btn-sm" href="#/scolaire/classes">${icon('layers', { size: 14 })} Gérer</a>
        </div>
        <div class="card-body" style="padding:0" id="box-classes"></div>
      </div>
      <div class="col gap-4">
        <div class="card">
          <div class="card-head"><div><h2>${icon('list-checks', { size: 16 })} À faire aujourd'hui</h2></div></div>
          <div class="card-body" style="padding:0" id="box-todo"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>${icon('clock-alert', { size: 16 })} Élèves les plus absents</h2>
            <p class="subtle tiny mt-2">À convoquer avec les familles</p></div></div>
          <div class="card-body" style="padding:0" id="box-absents"></div>
        </div>
      </div>
    </div>

    <div class="grid grid-2 mt-4">
      <div class="card">
        <div class="card-head"><div><h2>${icon('chart-pie', { size: 16 })} Répartition des moyennes</h2>
          <p class="subtle tiny mt-2">Nombre d'élèves par tranche de moyenne</p></div></div>
        <div class="card-body" id="ch-distri"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>${icon('users', { size: 16 })} Effectifs par niveau</h2>
          <p class="subtle tiny mt-2">Filles / garçons</p></div></div>
        <div class="card-body" id="ch-niveau"></div>
      </div>
    </div>`;

  /* ---- Remplissage progressif ---- */
  paintQuickActions(el.querySelector('#quick-actions'));
  paintAlerts(el.querySelector('#box-alerts'), alerts.data.alerts);
  paintTodo(el.querySelector('#box-todo'), todo.data.tasks || []);
  paintClasses(el.querySelector('#box-classes'), d.classes);
  paintTopAbsents(el.querySelector('#box-absents'), c.top_absents || []);

  if (c.presence_30j?.length) {
    mount(el, '#ch-presence', lineChart(c.presence_30j, {
      labels: c.presence_30j.map((x) => dateFr(x.date).slice(0, 5)),
      series: [
        { name: 'Présence ', data: c.presence_30j.map((x) => x.taux), color: '#0e7c66', format: (v) => `${v} %` },
        { name: 'Absents ', data: c.presence_30j.map((x) => x.absents), color: '#dc2626', format: (v) => `${v} élèves` },
      ],
      height: 210, yFormat: (v) => Math.round(v),
      legend: [{ label: 'Taux de présence (%)', color: '#0e7c66' }, { label: 'Nombre d\'absents', color: '#dc2626' }],
    }));
  } else el.querySelector('#ch-presence').innerHTML = emptyState({ icon: 'activity', title: 'Pas encore de données', message: 'Faites l\'appel pour alimenter ce graphique.' });

  if (c.flux_12m?.length) {
    mount(el, '#ch-flux', barChart(c.flux_12m, {
      labels: c.flux_12m.map((x) => moisCourt(x.mois)),
      series: [
        { name: 'Encaissements', data: c.flux_12m.map((x) => x.encaissements), color: '#0e7c66', format: xofShort },
        { name: 'Dépenses', data: c.flux_12m.map((x) => x.depenses), color: '#dc2626', format: xofShort },
      ],
      height: 200, yFormat: (v) => xofShort(v),
      legend: [{ label: 'Encaissements', color: '#0e7c66' }, { label: 'Dépenses', color: '#dc2626' }],
    }));
  }
  if (c.methodes_paiement?.length) {
    const colors = { orange_money: '#ff7900', wave: '#1dc8f5', mtn_momo: '#ffcc00', moov_money: '#0066b3', free_money: '#e2001a', especes: '#0e7c66', virement: '#1d4ed8', cheque: '#7c3aed', carte: '#334155' };
    mount(el, '#ch-methodes', donutChart(
      c.methodes_paiement.map((m) => ({ label: METHODE_PAIEMENT[m.methode]?.label || m.methode, value: m.total, color: colors[m.methode] || '#94a3b8' })),
      { height: 176, thickness: 24, format: xofShort, centerLabel: xofShort(c.methodes_paiement.reduce((a, m) => a + m.total, 0)), centerSub: 'encaissé' }
    ));
  }
  if (c.statut_factures?.length) {
    const tones = { payee: '#0e7c66', partiellement_payee: '#f59e0b', en_retard: '#dc2626', impayee: '#94a3b8', annulee: '#475569' };
    mount(el, '#ch-factures', donutChart(
      c.statut_factures.map((s) => ({ label: STATUT_FACTURE[s.statut]?.label || s.statut, value: s.n, color: tones[s.statut] || '#94a3b8' })),
      { height: 176, thickness: 24, format: (v) => `${v} facture(s)`, centerLabel: String(c.statut_factures.reduce((a, s) => a + s.n, 0)), centerSub: 'factures' }
    ));
  }
  if (c.distribution_moyennes?.length) {
    const distColors = ['#dc2626', '#ea580c', '#f59e0b', '#84cc16', '#16a34a', '#0e7c66'];
    mount(el, '#ch-distri', barChart(c.distribution_moyennes, {
      labels: c.distribution_moyennes.map((x) => x.tranche),
      series: [{ name: 'Élèves', data: c.distribution_moyennes.map((x) => x.n), color: '#0e7c66' }],
      height: 190,
    }));
    // Colore chaque barre selon la tranche
    el.querySelectorAll('#ch-distri .bar').forEach((b, i) => b.setAttribute('fill', distColors[i % distColors.length]));
  }
  if (c.par_niveau?.length) {
    mount(el, '#ch-niveau', barChart(c.par_niveau, {
      labels: c.par_niveau.map((x) => x.niveau),
      series: [
        { name: 'Filles', data: c.par_niveau.map((x) => x.filles), color: '#db2777' },
        { name: 'Garçons', data: c.par_niveau.map((x) => x.garcons), color: '#1d4ed8' },
      ],
      stacked: true, height: 190,
      legend: [{ label: 'Filles', color: '#db2777' }, { label: 'Garçons', color: '#1d4ed8' }],
    }));
  }
}

function sparkDelta(list) {
  if (!list || list.length < 8) return '';
  const last = list.slice(-7).reduce((a, x) => a + (x.taux || 0), 0) / 7;
  const prev = list.slice(-14, -7).reduce((a, x) => a + (x.taux || 0), 0) / Math.min(7, Math.max(1, list.length - 7));
  return (last - prev).toFixed(1);
}
const greeting = () => {
  const hgt = new Date().getHours();
  return hgt < 12 ? '👋' : hgt < 18 ? '👋' : '👋';
};
function moisCourt(m) {
  const [y, mm] = String(m).split('-');
  return ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'][Number(mm) - 1] || mm;
}
function mount(root, sel, node) {
  const slot = root.querySelector(sel);
  if (slot && node) { slot.innerHTML = ''; slot.appendChild(node); }
}

function trialBanner(school) {
  const left = school.trialEndsAt ? joursEntre(new Date().toISOString().slice(0, 10), school.trialEndsAt) : null;
  return `<div class="alert alert-brand mt-4" id="trial-banner">${icon('rocket', { size: 18 })}
    <div class="alert-body">
      <div class="alert-title">Essai gratuit — ${left != null && left >= 0 ? `${left} jour(s) restant(s)` : 'en cours'}</div>
      <div class="alert-msg">Vous utilisez toutes les fonctions du plan <b>${esc(school.planLabel || school.plan)}</b>.
        Choisissez votre formule pour conserver vos données et activer les SMS.</div>
    </div>
    <button class="btn btn-primary btn-sm" id="btn-plan">Voir les formules</button>
    <button class="btn btn-ghost btn-icon" id="close-trial" aria-label="Masquer">${icon('x', { size: 15 })}</button>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Actions rapides selon le rôle                                       */
/* ------------------------------------------------------------------ */
function paintQuickActions(slot) {
  if (!slot) return;
  const role = store.state.user.role;
  const acts = {
    direction: [
      { label: 'Faire l\'appel', icon: 'clipboard-check', to: '/vie-scolaire/presences', primary: true },
      { label: 'Encaisser', icon: 'banknote', to: '/finance/paiements?new=1' },
      { label: 'Bulletin', icon: 'file-text', to: '/pedagogie/bulletins' },
      { label: 'Annonce', icon: 'megaphone', to: '/communication/messages?new=1' },
    ],
    comptable: [
      { label: 'Encaisser', icon: 'banknote', to: '/finance/paiements?new=1', primary: true },
      { label: 'Relancer', icon: 'sms', to: '/finance/impayes' },
      { label: 'Journal de caisse', icon: 'printer', to: '/finance?journal=1' },
      { label: 'Dépense', icon: 'wallet', to: '/finance/depenses?new=1' },
    ],
    secretaire: [
      { label: 'Nouvel élève', icon: 'user-plus', to: '/scolaire/eleves?new=1', primary: true },
      { label: 'Importer Excel', icon: 'upload', to: '/scolaire/eleves?import=1' },
      { label: 'Certificat', icon: 'file-text', to: '/administration/documents?new=1' },
      { label: 'Annonce', icon: 'megaphone', to: '/communication/messages?new=1' },
    ],
    censeur: [
      { label: 'Notes', icon: 'pen-tool', to: '/pedagogie/notes?new=1', primary: true },
      { label: 'Résultats', icon: 'chart-line', to: '/pedagogie/resultats' },
      { label: 'Bulletins', icon: 'file-text', to: '/pedagogie/bulletins' },
      { label: 'Discipline', icon: 'shield', to: '/vie-scolaire/discipline' },
    ],
    enseignant: [
      { label: 'Faire l\'appel', icon: 'clipboard-check', to: '/vie-scolaire/presences', primary: true },
      { label: 'Saisir des notes', icon: 'pen-tool', to: '/pedagogie/notes?new=1' },
      { label: 'Cahier de textes', icon: 'notebook', to: '/pedagogie/cahier?new=1' },
      { label: 'Donner un devoir', icon: 'book-marked', to: '/pedagogie/devoirs?new=1' },
    ],
  };
  const list = acts[role] || acts.direction;
  slot.innerHTML = list.map((a) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-glass'}" data-go="${a.to}">
    ${icon(a.icon, { size: 15 })}${esc(a.label)}</button>`).join('');
  slot.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

/* ------------------------------------------------------------------ */
/* Alertes                                                             */
/* ------------------------------------------------------------------ */
const ALERT_ICONS = { finance: 'wallet', vie_scolaire: 'clock-alert', pedagogie: 'pen-tool', administration: 'folder', admissions: 'user-plus', bibliotheque: 'library', organisation: 'calendar', rh: 'briefcase', sante: 'heart-pulse', plateforme: 'server' };
const SEV_TONE = { haute: 'danger', moyenne: 'warn', basse: 'info' };

function paintAlerts(slot, alerts) {
  if (!slot) return;
  if (!alerts.length) {
    slot.innerHTML = `<div style="padding:26px">${emptyState({ icon: 'check-circle', title: 'Tout est en ordre', message: 'Aucune alerte critique pour le moment.' })}</div>`;
    return;
  }
  slot.innerHTML = `<div class="list">${alerts.slice(0, 7).map((a) => `<a class="list-item clickable" href="#${esc(a.link || '/alertes')}">
      <span class="li-ico" data-tone="${SEV_TONE[a.severity] || 'info'}">${icon(ALERT_ICONS[a.type] || 'alert-triangle', { size: 16 })}</span>
      <span class="li-body"><span class="li-title">${esc(a.title)}</span><span class="li-sub">${esc(a.detail || '')}</span></span>
      <span class="li-aside">${a.count ? badge(num(a.count), SEV_TONE[a.severity] || 'info') : ''}<span class="li-time">${esc(a.date || '')}</span></span>
    </a>`).join('')}</div>`;
}

function paintTodo(slot, tasks) {
  if (!slot) return;
  if (!tasks.length) {
    slot.innerHTML = `<div style="padding:24px">${emptyState({ icon: 'check-circle', title: 'Rien en attente', message: 'Votre journée est dégagée.' })}</div>`;
    return;
  }
  const dot = { haute: 'danger', moyenne: 'warn', basse: 'info' };
  slot.innerHTML = `<div class="list">${tasks.map((t) => `<a class="list-item clickable" href="#${esc(t.link)}">
      <span class="li-ico" data-tone="${dot[t.priority] || 'info'}">${icon('list-checks', { size: 15 })}</span>
      <span class="li-body"><span class="li-title" style="font-weight:560">${esc(t.label)}</span></span>
      <span class="li-aside">${icon('chevron-right', { size: 15 })}</span></a>`).join('')}</div>`;
}

function paintClasses(slot, classes) {
  if (!slot) return;
  slot.innerHTML = dataTable({
    columns: [
      { key: 'name', label: 'Classe', sortable: false, width: '86px', render: (r) => `<a class="link-strong" href="#/scolaire/classes/${r.id}">${esc(r.name)}</a>` },
      { key: 'level', label: 'Niveau', hideBelow: 'md', render: (r) => `<span class="subtle small">${esc(r.level)}</span>` },
      { key: 'effectif', label: 'Effectif', align: 'right', width: '86px', render: (r) => `<b class="num">${r.effectif}</b><span class="subtle tiny">/${r.capacity}</span>` },
      { key: 'fill', label: 'Remplissage', width: '30%', render: (r) => `<div class="row gap-2">${progress(r.taux_remplissage, r.surcharge ? 'danger' : r.taux_remplissage > 90 ? 'warn' : '')}<span class="num tiny" style="width:34px;text-align:right">${r.taux_remplissage}%</span></div>` },
      { key: 'prof', label: 'Prof. principal', hideBelow: 'lg', render: (r) => r.prof_principal ? `<span class="small">${esc(r.prof_principal)}</span>` : '<span class="subtle tiny">Non attribué</span>' },
      { key: 'room', label: 'Salle', hideBelow: 'xl', render: (r) => `<span class="subtle small">${esc(r.room || '—')}</span>` },
    ],
    rows: classes,
    rowKey: (r) => r.id,
    onRowClick: (r) => go(`/scolaire/classes/${r.id}`),
    dense: true, zebra: true,
    empty: { icon: 'school', title: 'Aucune classe', message: 'Créez vos classes dans Paramètres → Structure.' },
  }).outerHTML;
}

function paintTopAbsents(slot, list) {
  if (!slot) return;
  if (!list.length) {
    slot.innerHTML = `<div style="padding:22px">${emptyState({ icon: 'check-circle', title: 'Aucun élève signalé', message: 'Pas d\'absences répétées sur la période.' })}</div>`;
    return;
  }
  slot.innerHTML = `<div class="list">${list.slice(0, 6).map((s) => `<a class="list-item clickable" href="#/scolaire/eleves/${s.id}">
      ${avatar({ first: s.first_name, last: s.last_name, size: 'avatar-sm' })}
      <span class="li-body"><span class="li-title">${esc(s.first_name)} ${esc(s.last_name)}</span>
        <span class="li-sub">${esc(s.classe)} · ${s.retards ? `${s.retards} retard(s)` : 'aucun retard'}</span></span>
      <span class="li-aside">${badge(`${s.absences} abs.`, s.absences >= 8 ? 'danger' : s.absences >= 4 ? 'warn' : 'neutral')}</span>
    </a>`).join('')}</div>`;
}

/* ================================================================== */
/* PAGE ALERTES (détail complet)                                       */
/* ================================================================== */
async function alertsPage(el) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerBlock()}</div></div>`;
  try {
    const r = await api.get('/dashboard/alerts');
    const alerts = r.data.alerts || [];
    const groups = {};
    alerts.forEach((a) => { (groups[a.type] ||= []).push(a); });
    el.innerHTML = `
      <header class="row-between wrap mb-4" style="align-items:flex-end">
        <div><div class="uppercase mb-2">Pilotage</div><h1 class="h-page">Alertes & points de vigilance</h1>
          <p class="subtle small mt-2">SunuÉcole analyse en continu vos données et signale ce qui nécessite une décision.
            <b class="num">${alerts.length}</b> alerte(s) active(s).</p></div>
        <div class="row gap-2">
          <button class="btn btn-secondary" id="btn-refresh">${icon('refresh', { size: 15 })} Actualiser</button>
          <button class="btn btn-primary" id="btn-relance">${icon('sms', { size: 15 })} Relancer les impayés</button>
        </div>
      </header>
      ${!alerts.length ? `<div class="card"><div class="card-body">${emptyState({ icon: 'check-circle', title: 'Aucune alerte', message: 'Votre établissement fonctionne normalement. Revenez plus tard.' })}</div></div>`
        : Object.entries(groups).map(([type, list]) => `
        <section class="card mt-4">
          <div class="card-head"><div><h2>${icon(ALERT_ICONS[type] || 'alert-triangle', { size: 16 })} ${esc(typeLabel(type))}</h2>
            <p class="subtle tiny mt-2">${list.length} alerte(s)</p></div></div>
          <div class="card-body" style="padding:0">
            <div class="list">${list.map((a) => `<div class="list-item" data-tone="${SEV_TONE[a.severity] || 'info'}">
              <span class="li-ico" data-tone="${SEV_TONE[a.severity] || 'info'}">${icon(ALERT_ICONS[a.type] || 'alert-triangle', { size: 16 })}</span>
              <span class="li-body"><span class="li-title">${esc(a.title)}</span>
                <span class="li-sub">${esc(a.detail || '')}${a.date ? ` · ${esc(dateFr(a.date))}` : ''}</span></span>
              <span class="li-aside">${badge(a.severity === 'haute' ? 'Prioritaire' : a.severity === 'moyenne' ? 'À traiter' : 'Information', SEV_TONE[a.severity] || 'info')}
                ${a.link ? `<a class="btn btn-secondary btn-sm" href="#${esc(a.link)}">Traiter ${icon('chevron-right', { size: 13 })}</a>` : ''}</span>
            </div>`).join('')}</div>
          </div>
        </section>`).join('')}`;
    el.querySelector('#btn-refresh').addEventListener('click', () => { api.clearCache?.(); alertsPage(el); });
    el.querySelector('#btn-relance').addEventListener('click', () => go('/finance/impayes?relance=1'));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message })}</div></div>`;
  }
}
const typeLabel = (t) => ({ finance: 'Finances & recouvrement', vie_scolaire: 'Vie scolaire', pedagogie: 'Pédagogie', administration: 'Administration', admissions: 'Admissions', bibliotheque: 'Bibliothèque', organisation: 'Organisation & calendrier', rh: 'Ressources humaines', sante: 'Santé', plateforme: 'Plateforme' }[t] || t);
const spinnerBlock = () => `<div class="row gap-3 subtle small" style="justify-content:center;padding:40px"><span class="spinner"></span>Chargement…</div>`;

/* ================================================================== */
/* DASHBOARD ENSEIGNANT                                                */
/* ================================================================== */
async function teacherDashboard(el) {
  el.innerHTML = `
    <div class="dash-hero dash-hero-teacher">
      <div class="dash-hero-txt">
        <div class="tiny" style="opacity:.85">${icon('calendar', { size: 12 })} ${esc(dateLong(new Date()))}</div>
        <h1>Bonjour, <span id="t-name">…</span></h1>
        <p id="t-sub">Chargement de votre journée…</p>
      </div>
      <div class="dash-hero-actions" id="quick-actions"></div>
    </div>
    <div class="grid grid-kpi mt-4" id="t-kpis">${Array.from({ length: 4 }, () => '<div class="skeleton sk-card"></div>').join('')}</div>
    <div class="grid grid-2-1 mt-4">
      <div class="card"><div class="card-head"><div><h2>${icon('clock', { size: 16 })} Mon emploi du temps du jour</h2>
        <p class="subtle tiny mt-2">Faites l'appel directement depuis cette liste.</p></div></div>
        <div class="card-body" id="t-cours" style="padding:0">${spinnerBlock()}</div></div>
      <div class="col gap-4">
        <div class="card"><div class="card-head"><div><h2>${icon('pen-tool', { size: 16 })} À corriger / saisir</h2></div></div>
          <div class="card-body" style="padding:0" id="t-devoirs">${spinnerBlock()}</div></div>
        <div class="card"><div class="card-head"><div><h2>${icon('school', { size: 16 })} Mes classes</h2></div>
          <a class="btn btn-ghost btn-sm" href="#/enseignant/classes">Tout voir</a></div>
          <div class="card-body" style="padding:0" id="t-classes">${spinnerBlock()}</div></div>
      </div>
    </div>
    <div class="card mt-4"><div class="card-head"><div><h2>${icon('clipboard-list', { size: 16 })} Mes évaluations</h2>
      <p class="subtle tiny mt-2">Notes déjà publiées ou en attente de publication.</p></div></div>
      <div class="card-body" style="padding:0" id="t-evals">${spinnerBlock()}</div></div>`;

  paintQuickActions(el.querySelector('#quick-actions'));
  try {
    const r = await api.get('/dashboard/teacher', { cacheTtl: 20000 });
    const d = r.data;
    el.querySelector('#t-name').textContent = d.staff?.name || '';
    el.querySelector('#t-sub').textContent = `${d.stats?.cours || 0} cours aujourd'hui · ${d.stats?.classes || 0} classe(s) · moyenne de vos élèves ${note(d.stats?.moyenne)}/20`;

    el.querySelector('#t-kpis').innerHTML = [
      kpi({ label: 'Cours aujourd\'hui', value: num(d.stats?.cours || 0), iconName: 'clock', tone: 'brand', hint: d.cours_du_jour?.filter((c) => !c.appel_fait).length ? `${d.cours_du_jour.filter((c) => !c.appel_fait).length} appel(s) à faire` : 'Tous les appels sont faits', to: '/vie-scolaire/presences' }),
      kpi({ label: 'Mes classes', value: num(d.stats?.classes || 0), iconName: 'school', hint: `${num(d.mes_classes?.reduce((a, c) => a + (c.effectif || 0), 0) || 0)} élèves au total`, to: '/enseignant/classes' }),
      kpi({ label: 'Notes saisies', value: num(d.stats?.notes || 0), iconName: 'pen-tool', tone: 'ok', hint: `${d.evaluations?.length || 0} évaluation(s)`, to: '/pedagogie/notes' }),
      kpi({ label: 'Moyenne de mes élèves', value: note(d.stats?.moyenne), unit: '/20', iconName: 'graduation-cap', tone: d.stats?.moyenne >= 12 ? 'ok' : d.stats?.moyenne >= 10 ? 'warn' : 'danger', hint: 'Toutes matières et classes confondues', to: '/pedagogie/resultats' }),
    ].join('');

    // Cours du jour — timeline
    const cours = d.cours_du_jour || [];
    el.querySelector('#t-cours').innerHTML = cours.length ? `<div class="timeline">${cours.map((c) => {
      const done = !!c.appel_fait;
      const past = `${c.end_time}` < new Date().toTimeString().slice(0, 5);
      return `<div class="tl-item ${done ? 'tl-done' : past ? 'tl-late' : ''}">
        <span class="tl-dot" style="--c:${esc(c.color || '#0e7c66')}"></span>
        <div class="tl-body">
          <div class="row-between wrap gap-2">
            <div><b class="num">${esc(c.start_time)}–${esc(c.end_time)}</b>
              <span class="li-title" style="margin-left:8px">${esc(c.matiere)}</span>
              <span class="subtle small"> · ${esc(c.classe)} · ${esc(c.room || '')}</span></div>
            <div class="row gap-2">
              ${done ? badge('Appel fait', 'ok', { iconName: 'check-circle' })
                : past ? badge('Appel manquant', 'danger', { iconName: 'alert-triangle' })
                : badge('À venir', 'info', { iconName: 'clock' })}
              <a class="btn btn-sm ${done ? 'btn-secondary' : 'btn-primary'}" href="#/vie-scolaire/presences?class_id=${c.class_id}&slot=${esc(c.start_time)}">
                ${icon(done ? 'eye' : 'clipboard-check', { size: 14 })}${done ? 'Voir' : 'Appel'}</a>
            </div>
          </div>
        </div></div>`;
    }).join('')}</div>` : `<div style="padding:22px">${emptyState({ icon: 'calendar-check', title: 'Aucun cours aujourd\'hui', message: 'Profitez-en pour saisir vos notes ou préparer vos devoirs.' })}</div>`;

    // Devoirs à corriger
    const dw = d.devoirs_a_corriger || [];
    el.querySelector('#t-devoirs').innerHTML = dw.length ? `<div class="list">${dw.slice(0, 5).map((x) => `<a class="list-item clickable" href="#/pedagogie/devoirs/${x.id}">
        <span class="li-ico" style="background:${esc(x.color || '#0e7c66')}22;color:${esc(x.color || '#0e7c66')}">${icon('book-marked', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">${esc(x.title)}</span><span class="li-sub">${esc(x.classe || '')} · ${esc(x.matiere || '')} · rendu ${esc(dateFr(x.due_date))}</span></span>
        <span class="li-aside">${badge(`${x.a_corriger ?? x.pending ?? 0} à corriger`, 'warn')}</span></a>`).join('')}</div>`
      : `<div style="padding:22px">${emptyState({ icon: 'check-circle', title: 'Rien à corriger', message: 'Tous les devoirs rendus ont été notés.' })}</div>`;

    // Mes classes
    const cls = d.mes_classes || [];
    el.querySelector('#t-classes').innerHTML = cls.length ? `<div class="list">${cls.map((c) => `<a class="list-item clickable" href="#/scolaire/classes/${c.id}">
        <span class="li-ico" data-tone="brand">${icon('school', { size: 15 })}</span>
        <span class="li-body"><span class="li-title">${esc(c.name)}</span><span class="li-sub">${esc(c.niveau || '')}</span></span>
        <span class="li-aside"><b class="num">${c.effectif}</b><span class="li-time">élèves</span></span></a>`).join('')}</div>`
      : `<div style="padding:22px">${emptyState({ icon: 'school', title: 'Aucune classe attribuée', message: 'Contactez la direction pour être affecté à vos classes.' })}</div>`;

    // Évaluations
    const ev = d.evaluations || [];
    el.querySelector('#t-evals').innerHTML = ev.length ? dataTable({
      columns: [
        { key: 'name', label: 'Évaluation', render: (r) => `<a class="link-strong" href="#/pedagogie/notes/${r.id}">${esc(r.name)}</a>` },
        { key: 'classe', label: 'Classe', width: '90px' },
        { key: 'matiere', label: 'Matière', hideBelow: 'md' },
        { key: 'type', label: 'Type', hideBelow: 'lg', width: '110px' },
        { key: 'assess_date', label: 'Date', width: '100px', render: (r) => dateFr(r.assess_date) },
        { key: 'max', label: 'Barème', align: 'right', width: '72px', render: (r) => `<span class="num">/${r.max_score}</span>` },
        { key: 'status', label: 'Statut', width: '120px', render: (r) => badge(r.status === 'published' ? 'Publiée' : r.status === 'draft' ? 'Brouillon' : r.status, r.status === 'published' ? 'ok' : 'neutral') },
        { key: 'act', label: '', align: 'right', width: '92px', render: (r) => `<a class="btn btn-sm ${r.status === 'published' ? 'btn-secondary' : 'btn-primary'}" href="#/pedagogie/notes/${r.id}">${r.status === 'published' ? 'Voir' : 'Noter'}</a>` },
      ],
      rows: ev, dense: true, zebra: true,
    }).outerHTML : `<div style="padding:22px">${emptyState({ icon: 'pen-tool', title: 'Aucune évaluation', message: 'Créez une évaluation pour commencer à noter.' })}</div>`;
  } catch (err) {
    el.querySelector('#t-cours').innerHTML = emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message });
  }
}

/* ================================================================== */
/* SUPER ADMIN — vue plateforme                                        */
/* ================================================================== */
async function platformDashboard(el) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerBlock()}</div></div>`;
  try {
    const r = await api.get('/dashboard/platform');
    const d = r.data;
    el.innerHTML = `
      <div class="dash-hero">
        <div class="dash-hero-txt">
          <div class="tiny" style="opacity:.85">${icon('shield-check', { size: 12 })} Accès plateforme</div>
          <h1>Administration SunuÉcole</h1>
          <p>Suivi des établissements abonnés, de la santé technique et des usages.</p>
        </div>
      </div>
      <div class="grid grid-kpi mt-4">
        ${kpi({ label: 'Établissements', value: num(d.schools?.total ?? d.ecoles ?? 0), iconName: 'school', tone: 'brand', hint: `${num(d.schools?.trial ?? 0)} en essai · ${num(d.schools?.active ?? 0)} actifs` })}
        ${kpi({ label: 'Élèves gérés', value: num(d.students ?? d.eleves ?? 0), iconName: 'users', hint: 'Tous établissements confondus' })}
        ${kpi({ label: 'Volume encaissé', value: xofShort(d.payments_total ?? d.encaisse ?? 0), unit: 'FCFA', iconName: 'banknote', tone: 'ok', hint: 'Paiements traités via la plateforme' })}
        ${kpi({ label: 'Revenu abonnement', value: xofShort(d.mrr ?? 0), unit: 'FCFA/mois', iconName: 'trending', hint: `${num(d.subscriptions?.active ?? 0)} abonnement(s) actif(s)` })}
      </div>
      <div class="card mt-4">
        <div class="card-head"><div><h2>${icon('server', { size: 16 })} Établissements</h2>
          <p class="subtle tiny mt-2">Cliquez sur une école pour y ouvrir une session direction.</p></div></div>
        <div class="card-body" style="padding:0" id="p-schools"></div>
      </div>`;
    const rows = d.schools?.list || d.list || [];
    el.querySelector('#p-schools').innerHTML = rows.length ? dataTable({
      columns: [
        { key: 'name', label: 'Établissement', render: (r) => `<b>${esc(r.name)}</b><div class="tiny subtle">${esc(r.city || '')}</div>` },
        { key: 'plan', label: 'Plan', width: '100px', render: (r) => badge(r.plan, r.plan === 'elite' ? 'brand' : r.plan === 'pro' ? 'ok' : 'neutral') },
        { key: 'subscription_status', label: 'Abonnement', width: '130px', render: (r) => badge(r.subscription_status, r.subscription_status === 'active' ? 'ok' : r.subscription_status === 'trial' ? 'info' : 'danger') },
        { key: 'students', label: 'Élèves', align: 'right', width: '86px', render: (r) => `<b class="num">${num(r.students ?? r.eleves ?? 0)}</b>` },
        { key: 'usage', label: 'Usage 30 j', width: '130px', render: (r) => progress(r.usage ?? 0) },
        { key: 'act', label: '', align: 'right', width: '110px', render: (r) => r.id ? `<button class="btn btn-sm btn-secondary" data-impersonate="${r.id}">${icon('log-in', { size: 13 })} Ouvrir</button>` : '' },
      ],
      rows, dense: true, zebra: true,
      onRowClick: () => {},
    }).outerHTML : `<div style="padding:22px">${emptyState({ icon: 'school', title: 'Aucun établissement', message: 'Aucune école enregistrée pour le moment.' })}</div>`;
    el.querySelectorAll('[data-impersonate]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const r2 = await api.post(`/settings/impersonate/${b.dataset.impersonate}`);
        setToken(r2.token);
        location.reload();
      } catch (err) { toastErr('Accès impossible', err.message); }
    }));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'shield', title: 'Accès réservé', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* ENREGISTREMENT DES ROUTES                                           */
/* ================================================================== */
export function registerDashboard(route) {
  route('/', async ({ container }) => {
    const el = h('<div class="view dash-view"></div>');
    const role = store.state.user?.role;
    if (role === 'enseignant') { teacherDashboard(el); return el; }
    if (role === 'parent') { go('/parent', { replace: true }); return el; }
    if (role === 'eleve') { go('/eleve', { replace: true }); return el; }
    if (role === 'super_admin' && !store.state.user?.schoolId) { platformDashboard(el); return el; }
    el.innerHTML = adminSkeleton();
    adminDashboard(el).catch((err) => {
      el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Tableau de bord indisponible', message: err.message })}
        <div class="actions"><button class="btn btn-primary" onclick="location.reload()">Recharger</button></div></div></div>`;
    });
    // Bannière d'essai
    setTimeout(() => {
      el.querySelector('#btn-plan')?.addEventListener('click', () => go('/parametres/abonnement'));
      el.querySelector('#close-trial')?.addEventListener('click', (e) => {
        const b = e.target.closest('.alert');
        b.style.opacity = '0';
        setTimeout(() => b.remove(), 200);
      });
    }, 400);
    return el;
  }, { title: 'Tableau de bord', group: 'Pilotage' });

  route('/alertes', async () => {
    const el = h('<div class="view"></div>');
    alertsPage(el);
    return el;
  }, { title: 'Alertes & vigilance', group: 'Pilotage' });

  route('/enseignant/classes', async () => {
    const el = h('<div class="view"></div>');
    el.innerHTML = `<div class="card"><div class="card-body">${spinnerBlock()}</div></div>`;
    (async () => {
      try {
        const r = await api.get('/dashboard/teacher');
        const cls = r.data.mes_classes || [];
        el.innerHTML = `<header class="row-between wrap mb-4"><div><h1 class="h-page">Mes classes</h1>
          <p class="subtle small mt-2">${cls.length} classe(s) · ${num(cls.reduce((a, c) => a + (c.effectif || 0), 0))} élèves au total.</p></div>
          <a class="btn btn-primary" href="#/vie-scolaire/presences">${icon('clipboard-check', { size: 15 })} Faire l'appel</a></header>
          <div class="grid grid-3">${cls.map((c) => `<a class="card card-click" href="#/scolaire/classes/${c.id}">
            <div class="card-body"><div class="row-between"><b style="font-size:16px">${esc(c.name)}</b>${badge(c.niveau || '', 'brand')}</div>
            <div class="row gap-3 mt-3 subtle small">${icon('users', { size: 14 })} <b class="num">${c.effectif}</b> élèves</div>
            <div class="row gap-2 mt-3">${icon('clipboard-check', { size: 14 })}<a class="btn btn-link btn-sm" href="#/vie-scolaire/presences?class_id=${c.id}" style="padding:0">Faire l'appel</a>
            <a class="btn btn-link btn-sm" href="#/pedagogie/notes?class_id=${c.id}" style="padding:0;margin-left:8px">Saisir des notes</a></div></div></a>`).join('')}</div>`;
      } catch (err) {
        el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Chargement impossible', message: err.message })}</div></div>`;
      }
    })();
    return el;
  }, { title: 'Mes classes', group: 'Pédagogie' });
}

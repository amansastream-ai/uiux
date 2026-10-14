/**
 * SunuÉcole — Portails familles (parent) et élève.
 *
 * Objectif produit : un parent doit pouvoir, en moins de 30 secondes et sur
 * un téléphone à bas débit, voir la moyenne de son enfant, ses absences, son
 * solde et payer par Mobile Money. L'élève suit ses notes, ses devoirs et son
 * emploi du temps. Aucune donnée d'autres familles n'est accessible : le
 * périmètre est garanti côté API (familyScope).
 */
import { api } from '../core/api.js';
import { store, go } from '../core/store.js';
import { icon } from '../core/icons.js';
import {
  h, esc, badge, avatar, progress, emptyState, dataTable, field, readForm, modal,
  confirmDialog, toastOk, toastErr, toastInfo, withBusy,
} from '../ui/components.js';
import {
  xof, num, pct, note as noteFr, dateFr, dateLong, heureFr, relatif, aujourdhui, joursEntre,
  dictLabel, mention, JOURS_COURTS, METHODE_PAIEMENT, STATUT_FACTURE, TYPES_EVENEMENT,
} from '../core/format.js';
import { lineChart, barChart, radarChart } from '../core/charts.js';
import { bulletinHtml } from './academics.js';

const LS_CHILD = 'sue.parent.child';
const spinnerNote = (t) => `<div class="row gap-3 subtle small" style="justify-content:center;padding:36px"><span class="spinner"></span>${esc(t)}</div>`;
const kpi = (label, value, ic, toneName, hint) => `<div class="kpi"><div class="kpi-top">
    <span class="kpi-ico" data-tone="${toneName}">${icon(ic, { size: 18 })}</span><span class="kpi-label">${esc(label)}</span></div>
  <div class="kpi-val" style="font-size:22px">${esc(value)}</div>
  <div class="kpi-foot"><span class="kpi-hint">${esc(hint || '')}</span></div></div>`;
const mentionTone = (avg) => (avg >= 14 ? 'ok' : avg >= 10 ? 'info' : avg >= 8 ? 'warn' : 'danger');

/* ================================================================== */
/* Contexte famille                                                    */
/* ================================================================== */
async function loadChildren() {
  const r = await api.get('/dashboard/parent');
  return r.data?.children || [];
}

function selectedChild(children) {
  const saved = Number(localStorage.getItem(LS_CHILD) || 0);
  return children.find((c) => c.id === saved) || children[0] || null;
}

/** Barre de sélection d'enfant, commune à toutes les sections parent. */
function childSwitcher(children, active, section) {
  if (children.length <= 1) return '';
  return `<div class="child-switch">${children.map((c) => `<button class="child-chip ${c.id === active?.id ? 'is-on' : ''}" data-child="${c.id}">
      ${avatar({ first: c.first_name, last: c.last_name, size: 'avatar-xs' })}
      <span>${esc(c.first_name)}</span><small>${esc(c.classe || '')}</small></button>`).join('')}</div>`;
}

function wireSwitcher(host, children, section) {
  host.querySelectorAll('[data-child]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem(LS_CHILD, b.dataset.child);
    go(`/parent/${section}`.replace(/\/$/, ''));
  }));
}

async function parentShell(el, section, render) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement de votre espace…')}</div></div>`;
  try {
    const children = await loadChildren();
    if (!children.length) {
      el.innerHTML = `<div class="card"><div class="card-body">${emptyState({
        icon: 'contact-card', title: 'Aucun enfant rattaché',
        message: 'Votre compte n’est pas encore associé à un élève. Contactez le secrétariat de l’établissement pour le rattachement.',
      })}</div></div>`;
      return;
    }
    const child = selectedChild(children);
    el.innerHTML = `<div class="view-portail">
      ${childSwitcher(children, child, section)}
      <div id="pt-body">${spinnerNote('Chargement…')}</div></div>`;
    wireSwitcher(el, children, section);
    await render(el.querySelector('#pt-body'), child, children);
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Espace indisponible', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* PARENT — ACCUEIL                                                    */
/* ================================================================== */
async function parentHome(el) {
  el.innerHTML = spinnerNote('Chargement…');
  try {
    const [home, msgs] = await Promise.all([
      api.get('/dashboard/parent'),
      api.get('/comms/messages?limit=4').catch(() => ({ data: [] })),
    ]);
    const d = home.data || {};
    const children = d.children || [];
    const child = selectedChild(children);
    const events = (d.prochains_evenements || []).slice(0, 4);
    const annonces = (msgs.data || d.dernieres_annonces || []).slice(0, 4);
    const user = store.state.user || {};

    el.innerHTML = `<div class="view-portail">
      <div class="portal-hero">
        <div>
          <p class="portal-hello">Bonjour ${esc(user.first_name || '')} 👋</p>
          <h1 class="h-page" style="margin:4px 0 0">${children.length > 1 ? `Suivi de vos ${children.length} enfants` : `Suivi de ${esc(child ? `${child.first_name} ${child.last_name}` : '')}`}</h1>
          <p class="portal-sub">Notes, présences, devoirs et paiements — tout est à jour ${esc(relatif(new Date().toISOString()))}.</p>
        </div>
        <div class="portal-hero-actions">
          ${(d.solde_total || 0) > 0 ? `<button class="btn btn-primary" id="ph-pay">${icon('smartphone', { size: 16 })} Payer ${esc(xof(d.solde_total))}</button>` : `<span class="badge badge-ok">${icon('check-circle', { size: 13 })} Aucun solde dû</span>`}
          <a class="btn btn-secondary" href="#/parent/notes">${icon('file-text', { size: 15 })} Bulletins</a>
        </div>
      </div>

      ${children.length > 1 ? childSwitcher(children, child, '') : ''}

      <div class="grid grid-cards mt-4">
        ${children.map((c) => `<article class="card card-flat child-card ${c.id === child?.id ? 'is-active' : ''}" data-go="${c.id}">
          <div class="card-body">
            <div class="row gap-3" style="align-items:center">
              ${avatar({ first: c.first_name, last: c.last_name, size: 'avatar-md', src: c.photo_url })}
              <div class="grow" style="min-width:0">
                <b class="child-name">${esc(c.first_name)} ${esc(c.last_name)}</b>
                <div class="tiny subtle">${esc(c.classe || '')} · ${esc(c.matricule || '')} · ${esc(c.relation || 'parent')}</div>
              </div>
              ${badge(c.status === 'actif' ? 'Inscrit' : c.status, c.status === 'actif' ? 'ok' : 'warn')}
            </div>
            <div class="child-stats mt-3">
              <div><span class="tiny subtle">Moyenne</span><b class="num" data-tone="${mentionTone(c.derniere_moyenne)}">${c.derniere_moyenne != null ? noteFr(c.derniere_moyenne) : '—'}</b></div>
              <div><span class="tiny subtle">Rang</span><b class="num">${c.rang ? `${c.rang}${c.rang === 1 ? 'er' : 'e'}` : '—'}</b></div>
              <div><span class="tiny subtle">Absences 30 j</span><b class="num" data-tone="${c.absences_30j > 3 ? 'danger' : c.absences_30j > 0 ? 'warn' : 'ok'}">${num(c.absences_30j || 0)}</b></div>
              <div><span class="tiny subtle">Solde</span><b class="num" data-tone="${c.solde > 0 ? 'danger' : 'ok'}">${xof(c.solde || 0)}</b></div>
            </div>
            ${c.derniere_moyenne != null ? `<div class="mt-3">${progress(Math.min(100, (c.derniere_moyenne / 20) * 100), mentionTone(c.derniere_moyenne))}
              <span class="tiny subtle">${esc(c.derniere_mention || mention(c.derniere_moyenne))}</span></div>` : ''}
            <div class="row gap-2 wrap mt-4">
              <button class="btn btn-secondary btn-sm" data-act="notes" data-id="${c.id}">${icon('pen-tool', { size: 13 })} Notes</button>
              <button class="btn btn-secondary btn-sm" data-act="presences" data-id="${c.id}">${icon('clipboard-check', { size: 13 })} Présences</button>
              <button class="btn btn-secondary btn-sm" data-act="devoirs" data-id="${c.id}">${icon('book-marked', { size: 13 })} Devoirs</button>
              ${(c.solde || 0) > 0 ? `<button class="btn btn-primary btn-sm" data-act="payer" data-id="${c.id}">${icon('banknote', { size: 13 })} Payer</button>` : ''}
            </div>
          </div></article>`).join('')}
      </div>

      <div class="grid-2 mt-4">
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('megaphone', { size: 16 })} Annonces de l'école</h2>
          <a class="btn btn-link btn-sm" href="#/parent/messages">Tout voir</a></div>
          <div class="card-body" style="padding-top:0">
            ${annonces.length ? `<div class="list">${annonces.map((m) => `<div class="list-item clickable" data-msg="${m.id}" tabindex="0" role="button">
                <span class="li-ico" data-tone="${m.priority === 'urgente' ? 'danger' : 'info'}">${icon(m.msg_type === 'urgence' ? 'alert-triangle' : 'megaphone', { size: 15 })}</span>
                <span class="li-body"><span class="li-title small">${esc(m.subject)}</span>
                  <span class="li-sub">${esc(String(m.body || '').slice(0, 90))}…</span></span>
                <span class="li-aside tiny subtle">${dateFr(m.sent_at)}</span></div>`).join('')}</div>`
              : '<p class="subtle small">Aucune annonce récente.</p>'}
          </div></div>
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('calendar-days', { size: 16 })} À venir</h2>
          <a class="btn btn-link btn-sm" href="#/parent/calendrier">Calendrier</a></div>
          <div class="card-body" style="padding-top:0">
            ${events.length ? `<div class="list">${events.map((e) => `<div class="list-item">
                <span class="li-ico" style="background:${e.color || '#0e7c66'}1f;color:${e.color || '#0e7c66'}">${icon('calendar-days', { size: 15 })}</span>
                <span class="li-body"><span class="li-title small">${esc(e.title)}</span>
                  <span class="li-sub">${dateLong(e.event_date)}${e.start_time ? ` · ${heureFr(e.start_time)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</span></span>
                <span class="li-aside">${badge(dictLabel(TYPES_EVENEMENT, e.event_type) || e.event_type, 'neutral')}</span></div>`).join('')}</div>`
              : '<p class="subtle small">Aucun événement annoncé.</p>'}
          </div></div>
      </div>
    </div>`;

    el.querySelectorAll('[data-child]').forEach((b) => b.addEventListener('click', () => { localStorage.setItem(LS_CHILD, b.dataset.child); parentHome(el); }));
    el.querySelectorAll('.child-card [data-act]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem(LS_CHILD, b.dataset.id);
      if (b.dataset.act === 'payer') go('/parent/factures');
      else go(`/parent/${b.dataset.act}`);
    }));
    el.querySelectorAll('[data-msg]').forEach((li) => li.addEventListener('click', () => go(`/parent/messages?id=${li.dataset.msg}`)));
    el.querySelector('#ph-pay')?.addEventListener('click', () => go('/parent/factures'));
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Espace indisponible', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* PARENT — MES ENFANTS                                                */
/* ================================================================== */
async function parentChildren(el) {
  await parentShell(el, 'enfants', async (host, child, children) => {
    host.innerHTML = children.map((c) => `<div class="card card-flat mt-4"><div class="card-body">
        <div class="row gap-3 wrap" style="align-items:center">
          ${avatar({ first: c.first_name, last: c.last_name, size: 'avatar-lg', src: c.photo_url })}
          <div class="grow" style="min-width:200px">
            <h3 class="h-card" style="margin:0">${esc(c.first_name)} ${esc(c.last_name)}</h3>
            <p class="subtle small">${esc(c.classe || '')} · ${esc(c.niveau || '')} · matricule ${esc(c.matricule || '')}</p>
          </div>
          <div class="row gap-2 wrap">
            <a class="btn btn-secondary btn-sm" href="#/parent/notes">${icon('pen-tool', { size: 14 })} Notes</a>
            <a class="btn btn-secondary btn-sm" href="#/parent/presences">${icon('clipboard-check', { size: 14 })} Présences</a>
            <a class="btn btn-secondary btn-sm" href="#/parent/factures">${icon('wallet', { size: 14 })} Factures</a>
          </div>
        </div>
        <div class="child-stats mt-4">
          <div><span class="tiny subtle">Dernière moyenne</span><b class="num" data-tone="${mentionTone(c.derniere_moyenne)}">${c.derniere_moyenne != null ? noteFr(c.derniere_moyenne) : '—'}</b></div>
          <div><span class="tiny subtle">Mention</span><b>${esc(c.derniere_mention || '—')}</b></div>
          <div><span class="tiny subtle">Rang</span><b class="num">${c.rang ? `${c.rang} / ?` : '—'}</b></div>
          <div><span class="tiny subtle">Absences (30 j)</span><b class="num">${num(c.absences_30j || 0)}</b></div>
          <div><span class="tiny subtle">Solde dû</span><b class="num" data-tone="${c.solde > 0 ? 'danger' : 'ok'}">${xof(c.solde || 0)}</b></div>
        </div>
      </div></div>`).join('');
  });
}

/* ================================================================== */
/* PARENT — NOTES & BULLETINS                                          */
/* ================================================================== */
async function parentNotes(el) {
  await parentShell(el, 'notes', async (host, child) => {
    host.innerHTML = spinnerNote('Chargement du bulletin…');
    try {
      const r = await api.get(`/academics/report-cards/student/${child.id}`);
      const d = r.data || {};
      const card = d.card || {};
      const subjects = card.subject_avgs || [];
      const history = d.history || [];
      host.innerHTML = `
        <div class="grid grid-kpi">
          ${kpi('Moyenne générale', card.general_avg != null ? noteFr(card.general_avg) : '—', 'chart-line', mentionTone(card.general_avg), `${esc(d.student?.classe || '')} · ${esc(card.trimestre || '')}`)}
          ${kpi('Rang', card.rank ? `${card.rank} / ${card.total_students || '?'}` : '—', 'trophy', card.rank && card.rank <= 5 ? 'ok' : 'info', `Mention ${esc(card.mention || mention(card.general_avg) || '—')}`)}
          ${kpi('Présence', card.attendance_pct != null ? pct(card.attendance_pct) : '—', 'clipboard-check', card.attendance_pct >= 95 ? 'ok' : 'warn', `${num(card.absences_hours || 0)} h d'absence`)}
          ${kpi('Moyenne de la classe', d.classStats?.moyenne != null ? noteFr(d.classStats.moyenne) : '—', 'users', 'neutral', 'Pour situer votre enfant')}
        </div>
        <div class="grid-2 mt-4">
          <div class="card"><div class="card-head"><h2 class="h-card">${icon('table', { size: 16 })} Résultats par matière</h2>
            ${card.status === 'publie' ? badge('Publié', 'ok') : badge('Non publié', 'warn')}</div>
            <div class="card-body" style="padding:0">
              ${subjects.length ? dataTable({
                columns: [
                  { key: 'm', label: 'Matière', render: (x) => `<span class="dot" style="background:${x.color || '#0e7c66'}"></span> ${esc(x.matiere)}` },
                  { key: 'coef', label: 'Coef.', width: '60px', align: 'center', hideBelow: 'sm', render: (x) => `<span class="num small">${num(x.coefficient)}</span>` },
                  { key: 'avg', label: 'Moyenne', width: '90px', align: 'right', render: (x) => `<b class="num" data-tone="${mentionTone(x.avg)}">${noteFr(x.avg)}</b>` },
                  { key: 'classe', label: 'Classe', width: '90px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num small subtle">${noteFr(x.class_avg)}</span>` },
                  { key: 'ecart', label: 'Écart', width: '110px', hideBelow: 'lg', render: (x) => { const e = (x.avg || 0) - (x.class_avg || 0); return `<span class="num small ${e >= 0 ? 'pos' : 'neg'}">${e >= 0 ? '+' : ''}${noteFr(e)}</span>`; } },
                ],
                rows: subjects, dense: true, zebra: true,
              }).outerHTML : emptyState({ icon: 'pen-tool', title: 'Aucune note publiée', message: 'Les notes apparaîtront dès la publication du bulletin.' })}
            </div>
            ${card.teacher_comment || card.principal_comment ? `<div class="card-body">
              ${card.teacher_comment ? `<div class="comment-box"><b class="tiny uppercase">Appréciation du professeur principal</b><p>${esc(card.teacher_comment)}</p></div>` : ''}
              ${card.principal_comment ? `<div class="comment-box mt-3"><b class="tiny uppercase">Appréciation de la direction</b><p>${esc(card.principal_comment)}</p></div>` : ''}
            </div>` : ''}
          </div>
          <div>
            ${subjects.length >= 3 ? `<div class="card"><div class="card-body">
              <h3 class="h-card">${icon('target', { size: 15 })} Profil par matière</h3>
              <div id="pn-radar"></div></div></div>` : ''}
            <div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('history', { size: 15 })} Historique</h3></div>
              <div class="card-body" style="padding-top:0">
                ${history.length ? `<div class="list">${history.map((x) => `<div class="list-item">
                    <span class="li-ico" data-tone="${mentionTone(x.general_avg)}">${icon('file-text', { size: 14 })}</span>
                    <span class="li-body"><span class="li-title small">${esc(x.trimestre || x.term || 'Bulletin')}</span>
                      <span class="li-sub">Rang ${x.rank || '—'} · ${esc(x.mention || mention(x.general_avg) || '')}</span></span>
                    <span class="li-aside"><b class="num">${noteFr(x.general_avg)}</b></span></div>`).join('')}</div>`
                  : '<p class="subtle small">Pas encore d’historique.</p>'}
              </div></div>
            ${history.filter((x) => x.general_avg != null).length > 1 ? `<div class="card mt-4"><div class="card-body">
              <h3 class="h-card">${icon('trending', { size: 15 })} Évolution des moyennes</h3><div id="pn-line"></div></div></div>` : ''}
            <div class="card mt-4"><div class="card-body">
              <button class="btn btn-primary" id="pn-print" style="width:100%">${icon('printer', { size: 15 })} Imprimer le bulletin</button>
              <p class="tiny subtle mt-3">Format A4, identique au bulletin remis en classe.</p></div></div>
          </div>
        </div>`;

      if (subjects.length >= 3) {
        host.querySelector('#pn-radar')?.appendChild(radarChart(
          subjects.slice(0, 8).map((x) => ({ label: x.matiere, value: Number(x.avg) || 0 })),
          { height: 240, max: 20 }
        ));
      }
      const hist = history.filter((x) => x.general_avg != null);
      if (hist.length > 1) {
        host.querySelector('#pn-line')?.appendChild(lineChart(
          hist.map((x) => ({ label: x.trimestre || '', value: Number(x.general_avg) })),
          { height: 160, color: '#0e7c66', yMax: 20 }
        ));
      }
      host.querySelector('#pn-print')?.addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) return toastErr('Fenêtre bloquée', 'Autorisez les fenêtres pop-up pour imprimer.');
        w.document.write(bulletinHtml(d));
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 350);
      });
    } catch (err) {
      host.innerHTML = emptyState({ icon: 'wifi-off', title: 'Bulletin indisponible', message: err.message });
    }
  });
}

/* ================================================================== */
/* PARENT — PRÉSENCES                                                  */
/* ================================================================== */
async function parentAttendance(el) {
  await parentShell(el, 'presences', async (host, child) => {
    host.innerHTML = spinnerNote('Chargement des présences…');
    try {
      const [abs, heat, dossier] = await Promise.all([
        api.get(`/academics/attendance/absences?student_id=${child.id}&limit=50`),
        api.get(`/academics/attendance/heatmap/${child.id}`).catch(() => ({ data: [] })),
        api.get(`/students/${child.id}`).catch(() => ({ data: {} })),
      ]);
      const rows = abs.data || [];
      const days = heat.data || [];
      const att = dossier.data?.attendance || {};
      const justifs = (dossier.data?.document_requests || []);
      const counts = { absent: 0, retard: 0, excuse: 0 };
      rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
      const taux = att.taux ?? (days.length ? Math.round((days.filter((d) => d.status === 'present').length / days.length) * 1000) / 10 : null);

      host.innerHTML = `
        <div class="grid grid-kpi">
          ${kpi('Taux de présence', taux != null ? pct(taux) : '—', 'clipboard-check', taux >= 95 ? 'ok' : taux >= 90 ? 'warn' : 'danger', 'Sur les 120 derniers jours')}
          ${kpi('Absences', num(counts.absent), 'clock-alert', counts.absent ? 'danger' : 'ok', 'Non justifiées en rouge')}
          ${kpi('Retards', num(counts.retard), 'timer', counts.retard ? 'warn' : 'ok', 'Cumul sur la période')}
          ${kpi('Excusées', num(counts.excuse), 'check-circle', 'ok', 'Justificatifs acceptés')}
        </div>
        <div class="grid-2 mt-4">
          <div class="card"><div class="card-head"><h2 class="h-card">${icon('list', { size: 16 })} Dernières absences & retards</h2>
            <button class="btn btn-primary btn-sm" id="pa-just">${icon('file-plus', { size: 14 })} Justifier</button></div>
            <div class="card-body" style="padding:0">
              ${rows.length ? `<div class="list">${rows.slice(0, 12).map((r) => `<div class="list-item">
                  <span class="li-ico" data-tone="${r.status === 'absent' ? 'danger' : r.status === 'retard' ? 'warn' : 'info'}">${icon(r.status === 'retard' ? 'timer' : 'clock-alert', { size: 15 })}</span>
                  <span class="li-body"><span class="li-title small">${dateLong(r.session_date)}</span>
                    <span class="li-sub">${esc(r.period_label || 'Appel')}${r.minutes_late ? ` · ${num(r.minutes_late)} min de retard` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span></span>
                  <span class="li-aside">${badge(r.status === 'absent' ? 'Absence' : r.status === 'retard' ? 'Retard' : r.status === 'excuse' ? 'Excusée' : r.status, r.status === 'absent' ? 'danger' : r.status === 'retard' ? 'warn' : 'ok')}</span></div>`).join('')}</div>`
                : emptyState({ icon: 'check-circle', title: 'Aucune absence', message: `${child.first_name} est assidu(e) — bravo !` })}
            </div></div>
          <div>
            <div class="card"><div class="card-body">
              <h3 class="h-card">${icon('grid', { size: 15 })} Assiduité jour par jour</h3>
              ${days.length ? `<div class="heatmap">${days.map((d) => `<span class="heatmap-cell" data-s="${esc(d.status)}" title="${esc(dateFr(d.date))} — ${esc(d.status)}"></span>`).join('')}</div>
                <div class="row gap-2 wrap mt-3 tiny subtle">
                  <span class="hm-key" data-s="present"></span> Présent
                  <span class="hm-key" data-s="absent"></span> Absent
                  <span class="hm-key" data-s="retard"></span> Retard
                  <span class="hm-key" data-s="excuse"></span> Excusé</div>`
                : '<p class="subtle small">Pas encore de pointage.</p>'}
            </div></div>
            ${justifs.length ? `<div class="card mt-4"><div class="card-body"><h3 class="h-card">${icon('folder', { size: 15 })} Demandes de documents</h3>
              <div class="list">${justifs.slice(0, 4).map((x) => `<div class="list-item"><span class="li-ico">${icon('file-text', { size: 14 })}</span>
                <span class="li-body"><span class="li-title small">${esc(dictLabel({ certificat_scolarite: 'Certificat de scolarité', releve_notes: 'Relevé de notes', attestation_reussite: 'Attestation', bulletin_dupli: 'Duplicata de bulletin', acte_naissance: 'Acte de naissance' }, x.doc_type) || x.doc_type)}</span>
                <span class="li-sub">${dateFr(x.requested_at)}</span></span>
                <span class="li-aside">${badge(x.status === 'remis' ? 'Remis' : x.status === 'en_cours' ? 'En préparation' : 'En attente', x.status === 'remis' ? 'ok' : 'warn')}</span></div>`).join('')}</div></div></div>` : ''}
          </div>
        </div>`;

      host.querySelector('#pa-just')?.addEventListener('click', () => justificationModal(child, () => parentAttendance(el)));
    } catch (err) {
      host.innerHTML = emptyState({ icon: 'wifi-off', title: 'Présences indisponibles', message: err.message });
    }
  });
}

function justificationModal(child, onDone) {
  modal({
    title: `Justifier une absence — ${child.first_name}`, icon: 'file-plus', size: 'modal-narrow',
    subtitle: 'Votre justificatif est transmis à la vie scolaire pour validation.',
    body: `<form id="ju-form">
      <div class="grid-2">
        ${field({ label: 'Du', name: 'date_from', type: 'date', value: aujourdhui(), required: true })}
        ${field({ label: 'Au', name: 'date_to', type: 'date', value: aujourdhui() })}
      </div>
      ${field({ label: 'Motif', name: 'reason_type', type: 'select', value: 'maladie', options: [
        { value: 'maladie', label: 'Maladie' }, { value: 'familial', label: 'Raison familiale' },
        { value: 'deplacement', label: 'Déplacement' }, { value: 'autre', label: 'Autre' }] })}
      ${field({ label: 'Explication', name: 'reason', type: 'textarea', rows: 3, required: true, placeholder: 'Ex. : paludisme, certificat médical disponible sur demande.' })}
      ${field({ label: 'Référence du document (optionnel)', name: 'document', placeholder: 'N° de certificat médical' })}
      <div class="alert alert-info">${icon('info', { size: 16 })}<div class="alert-body"><div class="alert-msg">
        Les absences justifiées par un parent passent en « excusée » après validation de la vie scolaire.</div></div></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="ju-go">${icon('send', { size: 15 })} Envoyer le justificatif</button>`,
    onMount: (layer, close) => {
      layer.querySelector('#ju-go').addEventListener('click', () => withBusy(layer.querySelector('#ju-go'), async () => {
        const payload = readForm(layer.querySelector('#ju-form'));
        if (!payload.date_from || !payload.reason) return toastErr('Champs requis', 'La date et le motif sont obligatoires.');
        try {
          await api.post('/academics/justifications', { ...payload, student_id: child.id });
          toastOk('Justificatif envoyé', 'La vie scolaire va l’examiner.');
          close();
          onDone?.();
        } catch (e) { toastErr('Envoi impossible', e.message); }
      }));
    },
  });
}

/* ================================================================== */
/* PARENT — FACTURES & PAIEMENT MOBILE MONEY                           */
/* ================================================================== */
async function parentInvoices(el) {
  await parentShell(el, 'factures', async (host, child, children) => {
    host.innerHTML = spinnerNote('Chargement de vos factures…');
    try {
      const [inv, pay, prov] = await Promise.all([
        api.get(`/finance/invoices?student_id=${child.id}&limit=50`),
        api.get(`/finance/payments?student_id=${child.id}&limit=20`).catch(() => ({ data: [] })),
        api.get('/finance/providers').catch(() => ({ data: { providers: [] } })),
      ]);
      const invoices = inv.data || [];
      const payments = pay.data || [];
      const providers = (prov.data?.providers || []).filter((p) => p.mobile);
      const agg = inv.aggregate || {};
      const solde = invoices.filter((i) => i.status !== 'payee').reduce((a, i) => a + ((i.amount || 0) - (i.amount_paid || 0)), 0) || agg.solde || 0;

      host.innerHTML = `
        <div class="grid grid-kpi">
          ${kpi('Solde à régler', xof(solde), 'wallet', solde > 0 ? 'danger' : 'ok', solde > 0 ? 'Payez en une fois ou par échéance' : 'Vous êtes à jour, merci !')}
          ${kpi('Factures', num(invoices.length), 'receipt', 'brand', `${num(invoices.filter((i) => i.status === 'payee').length)} réglée(s)`)}
          ${kpi('Déjà payé', xof(agg.encaisse || payments.reduce((a, p) => a + (p.amount || 0), 0)), 'banknote', 'ok', 'Cumul des règlements')}
          ${kpi('En retard', num(invoices.filter((i) => i.status === 'en_retard').length), 'alert-circle', invoices.some((i) => i.status === 'en_retard') ? 'warn' : 'neutral', 'Échéances dépassées')}
        </div>

        ${solde > 0 ? `<div class="card mt-4 pay-cta"><div class="card-body">
          <div class="row gap-3 wrap" style="align-items:center">
            <span class="pay-cta-ico">${icon('smartphone', { size: 22 })}</span>
            <div class="grow" style="min-width:200px">
              <b>Payer ${esc(xof(solde))} par Mobile Money</b>
              <p class="tiny subtle" style="margin:2px 0 0">Orange Money, Wave, MTN MoMo, Moov Money ou Free Money — reçu par SMS immédiatement.</p>
            </div>
            <button class="btn btn-primary" id="pi-pay">${icon('zap', { size: 15 })} Payer maintenant</button>
          </div></div></div>` : ''}

        <div class="card mt-4"><div class="card-head"><h2 class="h-card">${icon('receipt', { size: 16 })} Factures de ${esc(child.first_name)}</h2></div>
          <div class="card-body" style="padding:0">
            ${invoices.length ? dataTable({
              columns: [
                { key: 'num', label: 'Facture', width: '140px', render: (x) => `<b class="num small">${esc(x.invoice_number)}</b><div class="tiny subtle">${dateFr(x.issued_at)}</div>` },
                { key: 'label', label: 'Libellé', render: (x) => `<span class="small">${esc(x.label || 'Frais scolaire')}</span>${x.installment_of > 1 ? `<div class="tiny subtle">Échéance ${x.installment_no}/${x.installment_of}</div>` : ''}` },
                { key: 'echeance', label: 'Échéance', width: '120px', hideBelow: 'md', render: (x) => `<span class="small">${dateFr(x.due_date)}</span>` },
                { key: 'montant', label: 'Montant', width: '120px', align: 'right', render: (x) => `<b class="num small">${xof(x.amount)}</b>${x.amount_paid ? `<div class="tiny subtle">payé ${xof(x.amount_paid)}</div>` : ''}` },
                { key: 'reste', label: 'Reste', width: '110px', align: 'right', render: (x) => { const r = (x.amount || 0) - (x.amount_paid || 0); return r > 0 ? `<b class="num small" style="color:var(--danger)">${xof(r)}</b>` : '<span class="tiny subtle">—</span>'; } },
                { key: 'statut', label: 'Statut', width: '120px', render: (x) => badge(dictLabel(STATUT_FACTURE, x.status), STATUT_FACTURE[x.status]?.tone || 'neutral') },
                { key: 'act', label: '', width: '130px', align: 'right', render: (x) => ((x.amount || 0) - (x.amount_paid || 0) > 0
                  ? `<button class="btn btn-primary btn-sm" data-pay="${x.id}" data-amount="${(x.amount || 0) - (x.amount_paid || 0)}">${icon('banknote', { size: 13 })} Payer</button>`
                  : `<button class="btn btn-link btn-sm" data-receipt>${icon('check-circle', { size: 13 })} Réglée</button>`) },
              ],
              rows: invoices, dense: true, zebra: true,
            }).outerHTML : emptyState({ icon: 'receipt', title: 'Aucune facture', message: 'Aucun frais n’a encore été émis pour cet élève.' })}
          </div></div>

        <div class="card mt-4"><div class="card-head"><h2 class="h-card">${icon('banknote', { size: 16 })} Mes derniers paiements</h2></div>
          <div class="card-body" style="padding:0">
            ${payments.length ? `<div class="list">${payments.map((p) => `<div class="list-item">
                <span class="li-ico" data-tone="ok">${icon('check-circle', { size: 15 })}</span>
                <span class="li-body"><span class="li-title small">${xof(p.amount)} — ${esc(dictLabel(METHODE_PAIEMENT, p.method))}</span>
                  <span class="li-sub">${dateFr(p.paid_at)} ${heureFr(p.paid_at)} · reçu ${esc(p.receipt_number || '')}${p.provider_ref ? ` · réf. ${esc(p.provider_ref)}` : ''}</span></span>
                <span class="li-aside"><button class="btn btn-secondary btn-sm" data-recu="${p.id}">${icon('printer', { size: 13 })} Reçu</button></span></div>`).join('')}</div>`
              : '<p class="subtle small" style="padding:14px">Aucun paiement enregistré.</p>'}
          </div></div>`;

      const openPay = (invoiceId, amount) => payModal({ child, invoiceId, amount, providers }, () => parentInvoices(el));
      host.querySelector('#pi-pay')?.addEventListener('click', () => openPay(null, solde));
      host.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPay(Number(b.dataset.pay), Number(b.dataset.amount))));
      host.querySelectorAll('[data-recu]').forEach((b) => b.addEventListener('click', () => receiptDrawer(Number(b.dataset.recu))));
    } catch (err) {
      host.innerHTML = emptyState({ icon: 'wifi-off', title: 'Factures indisponibles', message: err.message });
    }
  });
}

function payModal({ child, invoiceId, amount, providers }, onDone) {
  const list = providers.length ? providers : Object.entries(METHODE_PAIEMENT).filter(([k]) => !['especes', 'virement', 'cheque', 'carte'].includes(k)).map(([key, v]) => ({ key, label: v.label, color: v.color, mobile: true }));
  modal({
    title: `Payer ${xof(amount)}`, icon: 'smartphone',
    subtitle: `${child.first_name} ${child.last_name} · ${child.classe || ''}`,
    body: `<form id="pm-form">
      <div class="alert alert-brand">${icon('info', { size: 16 })}<div class="alert-body">
        <div class="alert-title">Comment ça marche ?</div>
        <div class="alert-msg">1. Choisissez votre opérateur et saisissez le numéro du compte Mobile Money.<br>
        2. Vous recevez une demande de paiement sur votre téléphone (code USSD ou application).<br>
        3. Validez : le reçu arrive par SMS et la facture est mise à jour immédiatement.</div></div></div>
      <div class="wizard-step">
        <div class="wizard-head"><span>Opérateur</span></div>
        <div class="provider-grid">
          ${list.map((p, i) => `<label><input type="radio" name="provider" value="${esc(p.key)}" ${i === 0 ? 'checked' : ''}>
            <span class="prov-dot" style="background:${p.color || '#0e7c66'}"></span>${esc(p.label)}
            ${p.ussd ? `<small class="num">${esc(p.ussd)}</small>` : ''}</label>`).join('')}
        </div>
      </div>
      <div class="grid-2">
        ${field({ label: 'Numéro du compte Mobile Money', name: 'phone', type: 'tel', required: true, placeholder: '77 123 45 67', hint: 'Le numéro qui recevra la demande de paiement.' })}
        ${field({ label: 'Montant à payer', name: 'amount', type: 'number', value: amount, min: 100, required: true, suffix: 'FCFA' })}
      </div>
      <div class="campaign-preview" id="pm-hint"></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
      <button class="btn btn-primary" id="pm-go">${icon('zap', { size: 15 })} Envoyer la demande</button>`,
    onMount: (layer, close) => {
      const hint = layer.querySelector('#pm-hint');
      const paint = () => {
        const key = layer.querySelector('[name=provider]:checked')?.value;
        const p = list.find((x) => x.key === key);
        hint.innerHTML = p ? `${icon('smartphone', { size: 15 })} <b>${esc(p.label)}</b>${p.ussd ? ` — composez ${esc(p.ussd)} si la demande n'arrive pas` : ''}. Numéros acceptés : ${esc(p.prefix || 'tous opérateurs')}.` : '';
      };
      layer.querySelectorAll('[name=provider]').forEach((r) => r.addEventListener('change', paint));
      paint();

      layer.querySelector('#pm-go').addEventListener('click', () => withBusy(layer.querySelector('#pm-go'), async () => {
        const payload = readForm(layer.querySelector('#pm-form'), ['amount']);
        if (!payload.phone) return toastErr('Numéro requis');
        if (!payload.amount || payload.amount < 100) return toastErr('Montant minimum', 'Le paiement minimum est de 100 FCFA.');
        try {
          const init = await api.post('/finance/payments/mobile-money/initiate', {
            provider: payload.provider, phone: payload.phone, amount: Number(payload.amount),
            student_id: child.id, invoice_id: invoiceId || undefined,
          });
          const confirmed = await confirmDialog({
            title: `${init.data?.providerLabel || 'Mobile Money'} — ${xof(init.data?.amount || payload.amount)}`,
            message: `${init.data?.instruction || 'Validez la demande sur votre téléphone.'} Confirmez ici une fois le paiement accepté.`,
            confirmLabel: 'J’ai validé sur mon téléphone', cancelLabel: 'Annuler',
          });
          if (!confirmed) { toastInfo('Demande annulée', 'Aucun débit n’a été effectué.'); return; }
          const r = await api.post(`/finance/payments/mobile-money/${init.data.id}/confirm`, { success: true });
          close();
          toastOk('Paiement confirmé', `${xof(r.data?.amount || payload.amount)} · référence ${r.data?.provider_ref || '—'}. Reçu envoyé par SMS.`);
          onDone?.();
        } catch (e) { toastErr('Paiement impossible', e.message); }
      }));
    },
  });
}

async function receiptDrawer(paymentId) {
  const panel = h('<div class="print-area"></div>');
  panel.innerHTML = spinnerNote('Chargement du reçu…');
  const d = drawer({
    title: 'Reçu de paiement', body: panel,
    footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>
      <button class="btn btn-primary" id="rc-print">${icon('printer', { size: 15 })} Imprimer</button>`,
    onMount: (layer) => { layer.querySelector('#rc-print').addEventListener('click', () => window.print()); },
  });
  try {
    const r = await api.get(`/finance/payments/${paymentId}/receipt`);
    const p = r.data.payment || {};
    const school = r.data.school || {};
    panel.innerHTML = `<div class="receipt-card">
      <div class="receipt-head"><b>${esc(school.name || '')}</b><span>${esc([school.address, school.city].filter(Boolean).join(' · '))}</span><span>${esc(school.phone || '')}</span></div>
      <div class="receipt-row"><span>Reçu n°</span><b class="num">${esc(p.receipt_number || '')}</b></div>
      <div class="receipt-row"><span>Date</span><b>${dateFr(p.paid_at)} ${heureFr(p.paid_at)}</b></div>
      <div class="receipt-row"><span>Élève</span><b>${esc(p.first_name || '')} ${esc(p.last_name || '')}</b></div>
      <div class="receipt-row"><span>Classe</span><b>${esc(p.classe || '')}</b></div>
      ${p.invoice_number ? `<div class="receipt-row"><span>Facture</span><b class="num">${esc(p.invoice_number)}</b></div>` : ''}
      <div class="receipt-row"><span>Moyen</span><b>${esc(dictLabel(METHODE_PAIEMENT, p.method))}${p.provider_ref ? ` · ${esc(p.provider_ref)}` : ''}</b></div>
      <div class="receipt-total"><span>Montant payé</span><b class="num">${xof(p.amount)}</b></div>
      ${r.data.solde_restant != null ? `<div class="receipt-row"><span>Solde restant</span><b class="num">${xof(r.data.solde_restant)}</b></div>` : ''}
      <div class="receipt-foot">Caissier(ère) : ${esc(p.caissier || '')}<br>${esc(school.footer || 'Merci de conserver ce reçu.')}</div>
    </div>`;
  } catch (err) {
    panel.innerHTML = emptyState({ icon: 'wifi-off', title: 'Reçu indisponible', message: err.message });
  }
  return d;
}

/* ================================================================== */
/* PARENT — DEVOIRS                                                    */
/* ================================================================== */
async function parentHomework(el) {
  await parentShell(el, 'devoirs', async (host, child) => {
    host.innerHTML = spinnerNote('Chargement des devoirs…');
    try {
      const dossier = await api.get(`/students/${child.id}`);
      const classId = dossier.data?.student?.class_id;
      const r = await api.get(`/academics/homework?class_id=${classId || ''}&limit=30`);
      const rows = r.data || [];
      const aRendre = rows.filter((x) => joursEntre(aujourdhui(), x.due_date) >= 0);
      host.innerHTML = `
        <div class="grid grid-kpi">
          ${kpi('Devoirs à rendre', num(aRendre.length), 'book-marked', aRendre.length ? 'warn' : 'ok', 'Échéances à venir')}
          ${kpi('Devoirs publiés', num(rows.length), 'notebook', 'brand', esc(child.classe || ''))}
          ${kpi('Prochaine échéance', aRendre[0] ? dateFr(aRendre[0].due_date) : '—', 'calendar-days', 'info', aRendre[0] ? esc(aRendre[0].title).slice(0, 34) : '')}
        </div>
        <div class="card mt-4"><div class="card-body" style="padding:0">
          ${rows.length ? `<div class="list list-plain" style="padding:12px">${rows.map((x) => {
            const jours = joursEntre(aujourdhui(), x.due_date);
            return `<article class="hw-card" style="--c:${x.color || '#0e7c66'}">
              <div class="row gap-2 wrap" style="align-items:center">
                <span class="hw-subject">${esc(x.matiere || '')}</span>
                <span class="grow"></span>
                ${badge(jours < 0 ? `Rendu le ${dateFr(x.due_date)}` : jours === 0 ? 'À rendre aujourd’hui' : `Dans ${jours} j`, jours < 0 ? 'neutral' : jours === 0 ? 'danger' : 'warn')}
              </div>
              <h3 class="hw-title">${esc(x.title)}</h3>
              <p class="hw-desc">${esc(String(x.description || '').slice(0, 240))}${String(x.description || '').length > 240 ? '…' : ''}</p>
              <div class="row gap-2 wrap mt-3 tiny subtle">
                <span>${icon('user', { size: 12 })} ${esc(x.enseignant || '—')}</span>
                ${x.estimated_min ? `<span>${icon('timer', { size: 12 })} ~${num(x.estimated_min)} min</span>` : ''}
                ${x.is_graded ? `<span>${icon('pen-tool', { size: 12 })} noté</span>` : ''}
                ${x.rendus != null ? `<span>${icon('check-circle', { size: 12 })} ${num(x.rendus)}/${num(x.effectif || 0)} rendus</span>` : ''}
              </div></article>`;
          }).join('')}</div>`
            : emptyState({ icon: 'book-marked', title: 'Aucun devoir', message: 'Les devoirs donnés par les professeurs apparaîtront ici.' })}
        </div></div>`;
    } catch (err) {
      host.innerHTML = emptyState({ icon: 'wifi-off', title: 'Devoirs indisponibles', message: err.message });
    }
  });
}

/* ================================================================== */
/* PARENT — MESSAGES & CALENDRIER                                      */
/* ================================================================== */
async function parentMessages(el, query = {}) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement des annonces…')}</div></div>`;
  try {
    const r = await api.get('/comms/messages?limit=30');
    const rows = r.data || [];
    el.innerHTML = `<div class="card">
      <div class="card-head"><h2 class="h-card">${icon('megaphone', { size: 16 })} Annonces de l'établissement</h2>
        <span class="subtle small">${num(rows.length)} message(s)</span></div>
      <div class="card-body" style="padding:0">
        ${rows.length ? `<div class="list list-plain" style="padding:12px">${rows.map((m) => `<article class="msg-item ${m.pinned ? 'is-pinned' : ''}" data-id="${m.id}" tabindex="0" role="button">
            <span class="msg-ico" data-tone="${m.priority === 'urgente' ? 'danger' : 'info'}">${icon(m.msg_type === 'urgence' ? 'alert-triangle' : m.msg_type === 'finance' ? 'banknote' : 'megaphone', { size: 16 })}</span>
            <div class="msg-body">
              <div class="msg-top"><b class="msg-subject">${m.pinned ? `${icon('bookmark', { size: 12 })} ` : ''}${esc(m.subject)}</b>
                <span class="grow"></span><span class="tiny subtle num">${dateFr(m.sent_at)}</span></div>
              <p class="msg-excerpt">${esc(String(m.body || '').slice(0, 220))}${String(m.body || '').length > 220 ? '…' : ''}</p>
              <div class="row gap-1 wrap mt-2"><span class="tiny subtle">par ${esc(m.sender_name || '')}</span>${m.priority === 'urgente' ? badge('Urgent', 'danger') : ''}</div>
            </div></article>`).join('')}</div>`
          : emptyState({ icon: 'megaphone', title: 'Aucune annonce', message: 'L’établissement n’a rien publié pour le moment.' })}
      </div></div>`;
    el.querySelectorAll('[data-id]').forEach((card) => {
      const open = () => {
        const m = rows.find((x) => String(x.id) === card.dataset.id);
        modal({
          title: m.subject, icon: 'megaphone',
          body: `<p class="subtle small mb-3">${esc(m.sender_name || '')} · ${dateLong(m.sent_at)}</p><div class="msg-text">${esc(m.body || '').replace(/\n/g, '<br>')}</div>`,
          footer: `<button class="btn btn-secondary" data-dismiss>Fermer</button>`,
        });
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    });
    if (query.id) el.querySelector(`[data-id="${esc(query.id)}"]`)?.click();
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Annonces indisponibles', message: err.message })}</div></div>`;
  }
}

async function portalCalendar(el) {
  el.innerHTML = `<div class="card"><div class="card-body">${spinnerNote('Chargement du calendrier…')}</div></div>`;
  try {
    const r = await api.get('/comms/events');
    const d = r.data || {};
    const todayIso = aujourdhui();
    const upcoming = (d.events || []).filter((e) => String(e.event_date).slice(0, 10) >= todayIso).slice(0, 20);
    const past = (d.events || []).filter((e) => String(e.event_date).slice(0, 10) < todayIso).slice(-6).reverse();
    el.innerHTML = `
      <div class="grid grid-kpi">
        ${kpi('Événements à venir', num(upcoming.length), 'calendar-days', 'brand', 'Réunions, examens, jours fériés')}
        ${kpi('Prochaine échéance', upcoming[0] ? dateFr(upcoming[0].event_date) : '—', 'bell-ring', 'warn', upcoming[0] ? esc(upcoming[0].title).slice(0, 32) : '')}
        ${kpi('Jours fériés', num((d.holidays || []).length), 'gift', 'info', 'Sur l’année scolaire')}
      </div>
      <div class="grid-2 mt-4">
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('calendar-days', { size: 16 })} À venir</h2></div>
          <div class="card-body" style="padding:0">
            ${upcoming.length ? `<div class="list">${upcoming.map((e) => `<div class="list-item">
                <span class="li-ico" style="background:${e.color || '#0e7c66'}1f;color:${e.color || '#0e7c66'}">${icon('calendar-days', { size: 15 })}</span>
                <span class="li-body"><span class="li-title small">${esc(e.title)}</span>
                  <span class="li-sub">${dateLong(e.event_date)}${e.start_time ? ` · ${heureFr(e.start_time)}${e.end_time ? ` – ${heureFr(e.end_time)}` : ''}` : ' · toute la journée'}${e.location ? ` · ${esc(e.location)}` : ''}</span>
                  ${e.description ? `<span class="li-sub">${esc(e.description)}</span>` : ''}</span>
                <span class="li-aside">${badge(dictLabel(TYPES_EVENEMENT, e.event_type) || e.event_type, 'neutral')}
                  <div class="tiny subtle mt-2">dans ${num(joursEntre(todayIso, String(e.event_date).slice(0, 10)))} j</div></span></div>`).join('')}</div>`
              : emptyState({ icon: 'calendar', title: 'Rien de prévu', message: 'Aucun événement à venir.' })}
          </div></div>
        <div>
          <div class="card"><div class="card-head"><h3 class="h-card">${icon('gift', { size: 15 })} Jours fériés & vacances</h3></div>
            <div class="card-body" style="padding-top:0">
              ${(d.holidays || []).length ? `<div class="row gap-1 wrap">${d.holidays.map((x) => badge(`${dateFr(x.date)} — ${x.name}`, 'neutral')).join('')}</div>` : '<p class="subtle small">Aucun jour férié enregistré.</p>'}
            </div></div>
          <div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('flag', { size: 15 })} Trimestres</h3></div>
            <div class="card-body" style="padding-top:0">
              ${(d.terms || []).length ? `<div class="list">${d.terms.map((t) => `<div class="list-item">
                  <span class="li-ico" data-tone="${t.is_current ? 'ok' : 'neutral'}">${icon('flag', { size: 14 })}</span>
                  <span class="li-body"><span class="li-title small">${esc(t.name)}</span>
                    <span class="li-sub">${dateFr(t.start_date)} → ${dateFr(t.end_date)}${t.council_date ? ` · conseil ${dateFr(t.council_date)}` : ''}${t.report_date ? ` · bulletins ${dateFr(t.report_date)}` : ''}</span></span>
                </div>`).join('')}</div>` : '<p class="subtle small">Aucun trimestre défini.</p>'}
            </div></div>
          ${past.length ? `<div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('history', { size: 15 })} Récents</h3></div>
            <div class="card-body" style="padding-top:0"><div class="list">${past.map((e) => `<div class="list-item">
              <span class="li-ico">${icon('check-circle', { size: 14 })}</span>
              <span class="li-body"><span class="li-title small">${esc(e.title)}</span><span class="li-sub">${dateFr(e.event_date)}</span></span></div>`).join('')}</div></div></div>` : ''}
        </div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Calendrier indisponible', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* ÉLÈVE                                                               */
/* ================================================================== */
async function studentHome(el) {
  el.innerHTML = spinnerNote('Chargement de ton espace…');
  try {
    const r = await api.get('/dashboard/student');
    const d = r.data || {};
    if (d.empty) {
      el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'graduation-cap', title: 'Dossier introuvable', message: 'Ton compte n’est pas encore rattaché à un dossier élève. Vois le secrétariat.' })}</div></div>`;
      return;
    }
    const s = d.student || {};
    const presences = d.presences || {};
    const bulletins = d.bulletins || [];
    const dernier = bulletins[bulletins.length - 1];
    const devoirs = d.devoirs || [];
    const notes = d.dernieres_notes || [];
    const aRendre = devoirs.filter((x) => joursEntre(aujourdhui(), x.due_date) >= 0);

    el.innerHTML = `<div class="view-portail">
      <div class="portal-hero">
        <div class="row gap-3" style="align-items:center">
          ${avatar({ first: s.firstName, last: s.lastName, size: 'avatar-xl', src: s.photo })}
          <div>
            <p class="portal-hello">Salut ${esc(s.firstName || '')} 👋</p>
            <h1 class="h-page" style="margin:4px 0 0">${esc(s.classe || '')} · ${esc(s.niveau || '')}</h1>
            <p class="portal-sub">Matricule ${esc(s.matricule || '')}${s.profPrincipal ? ` · professeur principal ${esc(s.profPrincipal)}` : ''}</p>
          </div>
        </div>
        <div class="portal-hero-actions">
          <a class="btn btn-primary" href="#/eleve/devoirs">${icon('book-marked', { size: 15 })} ${aRendre.length} devoir(s) à rendre</a>
          <a class="btn btn-secondary" href="#/eleve/notes">${icon('pen-tool', { size: 15 })} Mes notes</a>
        </div>
      </div>

      <div class="grid grid-kpi mt-4">
        ${kpi('Moyenne générale', dernier?.general_avg != null ? noteFr(dernier.general_avg) : '—', 'chart-line', mentionTone(dernier?.general_avg), dernier ? `${esc(dernier.trimestre || '')} · ${esc(dernier.mention || mention(dernier.general_avg) || '')}` : 'En attente de bulletin')}
        ${kpi('Rang', dernier?.rank ? `${dernier.rank} / ${dernier.total_students || '?'}` : '—', 'trophy', dernier?.rank <= 5 ? 'ok' : 'info', 'Dans ta classe')}
        ${kpi('Présence', presences.taux != null ? pct(presences.taux) : '—', 'clipboard-check', presences.taux >= 95 ? 'ok' : 'warn', `${num(presences.absents || 0)} absence(s) · ${num(presences.retards || 0)} retard(s)`)}
        ${kpi('Devoirs à rendre', num(aRendre.length), 'book-marked', aRendre.length ? 'warn' : 'ok', aRendre[0] ? `Prochain : ${dateFr(aRendre[0].due_date)}` : 'Tout est à jour')}
      </div>

      <div class="grid-2 mt-4">
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('book-marked', { size: 16 })} Devoirs à rendre</h2>
          <a class="btn btn-link btn-sm" href="#/eleve/devoirs">Tout voir</a></div>
          <div class="card-body" style="padding:0">
            ${devoirs.length ? `<div class="list">${devoirs.slice(0, 6).map((x) => {
              const j = joursEntre(aujourdhui(), x.due_date);
              return `<div class="list-item">
                <span class="li-ico" style="background:${x.color || '#0e7c66'}1f;color:${x.color || '#0e7c66'}">${icon('notebook', { size: 15 })}</span>
                <span class="li-body"><span class="li-title small">${esc(x.title)}</span>
                  <span class="li-sub">${esc(x.matiere || '')} · à rendre ${dateFr(x.due_date)}</span></span>
                <span class="li-aside">${x.mon_statut ? badge(x.mon_statut === 'rendu' ? 'Rendu' : x.mon_statut, x.mon_statut === 'rendu' ? 'ok' : 'info') : badge(j < 0 ? 'Échu' : j === 0 ? 'Aujourd’hui' : `J-${j}`, j <= 0 ? 'danger' : 'warn')}</span></div>`;
            }).join('')}</div>` : emptyState({ icon: 'book-marked', title: 'Aucun devoir', message: 'Rien à rendre pour le moment.' })}
          </div></div>
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('pen-tool', { size: 16 })} Dernières notes</h2>
          <a class="btn btn-link btn-sm" href="#/eleve/notes">Tout voir</a></div>
          <div class="card-body" style="padding-top:0">
            ${notes.length ? `<div class="grade-grid"><table style="width:100%"><tbody>
              ${notes.slice(0, 8).map((x) => `<tr>
                <td style="padding:7px 8px"><span class="dot" style="background:${x.color || '#0e7c66'}"></span> ${esc(x.matiere || '')}<div class="tiny subtle">${esc(x.name || '')} · ${dateFr(x.assess_date)}</div></td>
                <td style="padding:7px 8px;text-align:right" class="num"><b data-tone="${x.is_absent ? 'neutral' : mentionTone((x.score / (x.max_score || 20)) * 20)}">${x.is_absent ? 'ABS' : noteFr((x.score / (x.max_score || 20)) * 20)}</b></td>
              </tr>`).join('')}
            </tbody></table></div>` : '<p class="subtle small">Aucune note saisie pour l’instant.</p>'}
          </div></div>
      </div>

      <div class="card mt-4"><div class="card-head"><h2 class="h-card">${icon('calendar-days', { size: 16 })} Emploi du temps</h2>
        <a class="btn btn-link btn-sm" href="#/eleve/emploi-du-temps">Version complète</a></div>
        <div class="card-body">${todayTimetable(d.emploi_du_temps || [])}</div></div>
    </div>`;
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Espace indisponible', message: err.message })}</div></div>`;
  }
}

function todayTimetable(slots) {
  const dow = new Date().getDay() || 7; // lundi=1 … dimanche=7
  const today = slots.filter((s) => Number(s.day_of_week) === dow).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  if (!today.length) return `<p class="subtle small">Aucun cours ${esc(JOURS_COURTS[dow] || '')} — profitez-en !</p>`;
  return `<div class="day-flow">${today.map((s, i) => `<div class="day-slot" style="--c:${s.color || '#0e7c66'}">
      <div class="day-time num">${esc(String(s.start_time).slice(0, 5))}<span>${esc(String(s.end_time || '').slice(0, 5))}</span></div>
      <div class="day-body"><b>${esc(s.matiere || '')}</b><span>${esc(s.room || '')}</span></div>
      ${i < today.length - 1 ? '<div class="day-line"></div>' : ''}
    </div>`).join('')}</div>`;
}

async function studentGrades(el) {
  el.innerHTML = spinnerNote('Chargement de tes notes…');
  try {
    const r = await api.get('/dashboard/student');
    const d = r.data || {};
    const notes = d.dernieres_notes || [];
    const bulletins = d.bulletins || [];
    const parMatiere = {};
    notes.forEach((x) => {
      const v = x.is_absent ? null : (x.score / (x.max_score || 20)) * 20;
      if (v == null) return;
      parMatiere[x.matiere] = parMatiere[x.matiere] || [];
      parMatiere[x.matiere].push(v);
    });
    const moyennes = Object.entries(parMatiere).map(([m, vals]) => ({ matiere: m, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length }));
    const best = moyennes.slice().sort((a, b) => b.avg - a.avg)[0] || null;

    el.innerHTML = `
      <div class="grid grid-kpi">
        ${kpi('Notes récentes', num(notes.length), 'pen-tool', 'brand', 'Sur les dernières évaluations')}
        ${kpi('Meilleure matière', best ? esc(best.matiere) : '—', 'trophy', 'ok', best ? `${noteFr(best.avg)} / 20 sur ${best.n} note(s)` : '')}
        ${kpi('Bulletins publiés', num(bulletins.filter((b) => b.status === 'publie').length), 'file-text', 'info', `${num(bulletins.length)} au total`)}
      </div>
      <div class="grid-2 mt-4">
        <div class="card"><div class="card-head"><h2 class="h-card">${icon('list', { size: 16 })} Détail des notes</h2></div>
          <div class="card-body" style="padding:0">
            ${notes.length ? dataTable({
              columns: [
                { key: 'date', label: 'Date', width: '110px', render: (x) => dateFr(x.assess_date) },
                { key: 'matiere', label: 'Matière', render: (x) => `<span class="dot" style="background:${x.color || '#0e7c66'}"></span> ${esc(x.matiere || '')}<div class="tiny subtle">${esc(x.name || '')}</div>` },
                { key: 'score', label: 'Note', width: '110px', align: 'right', render: (x) => (x.is_absent ? badge('Absent', 'danger') : `<b class="num" data-tone="${mentionTone((x.score / (x.max_score || 20)) * 20)}">${noteFr(x.score)}<span class="tiny subtle">/${num(x.max_score || 20)}</span></b>`) },
                { key: 'sur20', label: '/20', width: '80px', align: 'right', hideBelow: 'md', render: (x) => (x.is_absent ? '—' : `<span class="num small">${noteFr((x.score / (x.max_score || 20)) * 20)}</span>`) },
              ],
              rows: notes, dense: true, zebra: true,
            }).outerHTML : emptyState({ icon: 'pen-tool', title: 'Aucune note', message: 'Tes notes apparaîtront dès leur saisie par les professeurs.' })}
          </div></div>
        <div>
          ${moyennes.length ? `<div class="card"><div class="card-body"><h3 class="h-card">${icon('chart', { size: 15 })} Moyennes par matière</h3><div id="sg-bar"></div></div></div>` : ''}
          <div class="card mt-4"><div class="card-head"><h3 class="h-card">${icon('file-text', { size: 15 })} Bulletins</h3></div>
            <div class="card-body" style="padding:0">
              ${bulletins.length ? `<div class="list">${bulletins.map((b) => `<div class="list-item">
                  <span class="li-ico" data-tone="${mentionTone(b.general_avg)}">${icon('file-text', { size: 14 })}</span>
                  <span class="li-body"><span class="li-title small">${esc(b.trimestre || 'Bulletin')}</span>
                    <span class="li-sub">Rang ${b.rank || '—'} / ${b.total_students || '?'} · ${esc(b.mention || mention(b.general_avg) || '')}</span></span>
                  <span class="li-aside"><b class="num">${noteFr(b.general_avg)}</b>
                    ${b.status === 'publie' ? `<a class="btn btn-link btn-sm" href="#/eleve/bulletins">Voir</a>` : badge('Bientôt', 'neutral')}</span></div>`).join('')}</div>`
                : '<p class="subtle small">Aucun bulletin pour l’instant.</p>'}
            </div></div>
        </div>
      </div>`;
    if (moyennes.length) {
      el.querySelector('#sg-bar')?.appendChild(barChart(
        moyennes.map((m) => ({ label: m.matiere.slice(0, 12), value: Math.round(m.avg * 100) / 100 })),
        { height: 200, yMax: 20, color: '#0e7c66' }
      ));
    }
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Notes indisponibles', message: err.message })}</div></div>`;
  }
}

async function studentBulletins(el) {
  el.innerHTML = spinnerNote('Chargement de ton bulletin…');
  try {
    const me = await api.get('/dashboard/student');
    const studentId = me.data?.student?.id;
    if (!studentId) throw new Error('Dossier élève introuvable.');
    const r = await api.get(`/academics/report-cards/student/${studentId}`);
    const d = r.data || {};
    const card = d.card || {};
    const subjects = card.subject_avgs || [];
    el.innerHTML = `
      <div class="card"><div class="card-head"><h2 class="h-card">${icon('file-text', { size: 16 })} Bulletin — ${esc(card.trimestre || '')}</h2>
        <div class="row gap-2">
          ${card.status === 'publie' ? badge('Publié', 'ok') : badge('Non publié', 'warn')}
          <button class="btn btn-primary btn-sm" id="sb-print">${icon('printer', { size: 14 })} Imprimer</button></div></div>
        <div class="card-body">
          <div class="grid grid-kpi">
            ${kpi('Moyenne générale', card.general_avg != null ? noteFr(card.general_avg) : '—', 'chart-line', mentionTone(card.general_avg), esc(card.mention || mention(card.general_avg) || ''))}
            ${kpi('Rang', card.rank ? `${card.rank} / ${card.total_students || '?'}` : '—', 'trophy', 'info', 'Dans la classe')}
            ${kpi('Présence', card.attendance_pct != null ? pct(card.attendance_pct) : '—', 'clipboard-check', card.attendance_pct >= 95 ? 'ok' : 'warn', `${num(card.absences_hours || 0)} h d'absence`)}
            ${kpi('Moyenne classe', d.classStats?.moyenne != null ? noteFr(d.classStats.moyenne) : '—', 'users', 'neutral', 'Repère collectif')}
          </div>
          <div class="mt-4">
            ${subjects.length ? dataTable({
              columns: [
                { key: 'm', label: 'Matière', render: (x) => `<span class="dot" style="background:${x.color || '#0e7c66'}"></span> ${esc(x.matiere)}` },
                { key: 'coef', label: 'Coef.', width: '70px', align: 'center', render: (x) => `<span class="num small">${num(x.coefficient)}</span>` },
                { key: 'avg', label: 'Ma moyenne', width: '120px', align: 'right', render: (x) => `<b class="num" data-tone="${mentionTone(x.avg)}">${noteFr(x.avg)}</b>` },
                { key: 'cl', label: 'Classe', width: '100px', align: 'right', hideBelow: 'md', render: (x) => `<span class="num small subtle">${noteFr(x.class_avg)}</span>` },
                { key: 'min', label: 'Min / Max', width: '130px', align: 'right', hideBelow: 'lg', render: (x) => `<span class="num tiny subtle">${noteFr(x.min)} / ${noteFr(x.max)}</span>` },
              ],
              rows: subjects, dense: true, zebra: true,
            }).outerHTML : emptyState({ icon: 'file-text', title: 'Bulletin non disponible', message: 'Il sera publié après le conseil de classe.' })}
          </div>
          ${card.teacher_comment ? `<div class="comment-box mt-4"><b class="tiny uppercase">Appréciation du professeur principal</b><p>${esc(card.teacher_comment)}</p></div>` : ''}
          ${card.principal_comment ? `<div class="comment-box mt-3"><b class="tiny uppercase">Appréciation de la direction</b><p>${esc(card.principal_comment)}</p></div>` : ''}
        </div></div>`;
    el.querySelector('#sb-print')?.addEventListener('click', () => {
      const w = window.open('', '_blank');
      if (!w) return toastErr('Fenêtre bloquée', 'Autorise les fenêtres pop-up pour imprimer.');
      w.document.write(bulletinHtml(d));
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 350);
    });
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Bulletin indisponible', message: err.message })}</div></div>`;
  }
}

async function studentTimetable(el) {
  el.innerHTML = spinnerNote('Chargement de ton emploi du temps…');
  try {
    const r = await api.get('/dashboard/student');
    const slots = r.data?.emploi_du_temps || [];
    const jours = [...new Set(slots.map((s) => Number(s.day_of_week)))].sort();
    const heures = [...new Set(slots.map((s) => s.start_time))].sort();
    el.innerHTML = `<div class="card">
      <div class="card-head"><h2 class="h-card">${icon('calendar-days', { size: 16 })} Mon emploi du temps</h2>
        <button class="btn btn-secondary btn-sm" id="st-print">${icon('printer', { size: 14 })} Imprimer</button></div>
      <div class="card-body print-area">
        ${slots.length ? `<div class="tt-grid" style="grid-template-columns:74px repeat(${jours.length || 5},minmax(120px,1fr))">
          <div class="tt-head tt-time">Horaire</div>
          ${jours.map((d) => `<div class="tt-head">${esc(JOURS_COURTS[d] || '')}</div>`).join('')}
          ${heures.map((hh) => `<div class="tt-time num">${esc(String(hh).slice(0, 5))}</div>
            ${jours.map((d) => {
              const s = slots.find((x) => Number(x.day_of_week) === d && x.start_time === hh);
              return s ? `<div class="tt-cell" style="--tt:${s.color || '#0e7c66'}"><b>${esc(s.matiere || '')}</b>${s.room ? `<span class="tiny">${esc(s.room)}</span>` : ''}</div>` : '<div class="tt-empty"></div>';
            }).join('')}`).join('')}
        </div>` : emptyState({ icon: 'calendar-days', title: 'Aucun créneau', message: 'Ton emploi du temps n’est pas encore publié.' })}
      </div></div>`;
    el.querySelector('#st-print')?.addEventListener('click', () => window.print());
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Emploi du temps indisponible', message: err.message })}</div></div>`;
  }
}

async function studentHomework(el) {
  el.innerHTML = spinnerNote('Chargement de tes devoirs…');
  try {
    const r = await api.get('/dashboard/student');
    const rows = r.data?.devoirs || [];
    const aRendre = rows.filter((x) => joursEntre(aujourdhui(), x.due_date) >= 0);
    el.innerHTML = `
      <div class="grid grid-kpi">
        ${kpi('À rendre', num(aRendre.length), 'book-marked', aRendre.length ? 'warn' : 'ok', aRendre[0] ? `Prochain : ${dateFr(aRendre[0].due_date)}` : 'Tout est rendu')}
        ${kpi('Devoirs suivis', num(rows.length), 'notebook', 'brand', 'Publiés par tes professeurs')}
        ${kpi('Rendus', num(rows.filter((x) => x.mon_statut === 'rendu').length), 'check-circle', 'ok', 'Marqués comme rendus')}
      </div>
      <div class="card mt-4"><div class="card-body" style="padding:0">
        ${rows.length ? `<div class="list list-plain" style="padding:12px">${rows.map((x) => {
          const j = joursEntre(aujourdhui(), x.due_date);
          return `<article class="hw-card" style="--c:${x.color || '#0e7c66'}">
            <div class="row gap-2 wrap" style="align-items:center">
              <span class="hw-subject">${esc(x.matiere || '')}</span><span class="grow"></span>
              ${x.mon_statut ? badge(x.mon_statut === 'rendu' ? 'Rendu' : x.mon_statut, x.mon_statut === 'rendu' ? 'ok' : 'info') : ''}
              ${badge(j < 0 ? `Échu le ${dateFr(x.due_date)}` : j === 0 ? 'À rendre aujourd’hui' : `Dans ${j} j`, j < 0 ? 'danger' : j === 0 ? 'warn' : 'neutral')}
            </div>
            <h3 class="hw-title">${esc(x.title)}</h3>
            <p class="hw-desc">${esc(x.description || 'Pas de consigne détaillée.')}</p>
            ${x.score != null ? `<div class="mt-3 tiny subtle">Note obtenue : <b class="num">${noteFr(x.score)}</b></div>` : ''}
          </article>`;
        }).join('')}</div>`
          : emptyState({ icon: 'book-marked', title: 'Aucun devoir', message: 'Rien à rendre pour le moment.' })}
      </div></div>`;
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Devoirs indisponibles', message: err.message })}</div></div>`;
  }
}

async function studentAttendance(el) {
  el.innerHTML = spinnerNote('Chargement de tes présences…');
  try {
    const r = await api.get('/dashboard/student');
    const d = r.data || {};
    const p = d.presences || {};
    const studentId = d.student?.id;
    const [heat, abs] = await Promise.all([
      api.get(`/academics/attendance/heatmap/${studentId}`).catch(() => ({ data: [] })),
      api.get(`/academics/attendance/absences?student_id=${studentId}&limit=30`).catch(() => ({ data: [] })),
    ]);
    const days = heat.data || [];
    const rows = abs.data || [];
    el.innerHTML = `
      <div class="grid grid-kpi">
        ${kpi('Taux de présence', p.taux != null ? pct(p.taux) : '—', 'clipboard-check', p.taux >= 95 ? 'ok' : 'warn', `${num(p.total || 0)} appel(s)`)}
        ${kpi('Présences', num(p.presents || 0), 'check-circle', 'ok', 'Appels validés')}
        ${kpi('Absences', num(p.absents || 0), 'clock-alert', p.absents ? 'danger' : 'ok', 'À justifier auprès de la vie scolaire')}
        ${kpi('Retards', num(p.retards || 0), 'timer', p.retards ? 'warn' : 'ok', 'Minutes cumulées')}
      </div>
      <div class="grid-2 mt-4">
        <div class="card"><div class="card-body">
          <h3 class="h-card">${icon('grid', { size: 15 })} Assiduité jour par jour</h3>
          ${days.length ? `<div class="heatmap">${days.map((x) => `<span class="heatmap-cell" data-s="${esc(x.status)}" title="${esc(dateFr(x.date))} — ${esc(x.status)}"></span>`).join('')}</div>
            <div class="row gap-2 wrap mt-3 tiny subtle">
              <span class="hm-key" data-s="present"></span> Présent <span class="hm-key" data-s="absent"></span> Absent
              <span class="hm-key" data-s="retard"></span> Retard <span class="hm-key" data-s="excuse"></span> Excusé</div>`
            : '<p class="subtle small">Pas encore de pointage.</p>'}
        </div></div>
        <div class="card"><div class="card-head"><h3 class="h-card">${icon('clock-alert', { size: 15 })} Absences & retards</h3></div>
          <div class="card-body" style="padding:0">
            ${rows.length ? `<div class="list">${rows.slice(0, 10).map((x) => `<div class="list-item">
                <span class="li-ico" data-tone="${x.status === 'absent' ? 'danger' : 'warn'}">${icon(x.status === 'retard' ? 'timer' : 'clock-alert', { size: 14 })}</span>
                <span class="li-body"><span class="li-title small">${dateLong(x.session_date)}</span>
                  <span class="li-sub">${esc(x.period_label || 'Appel')}${x.minutes_late ? ` · ${num(x.minutes_late)} min` : ''}</span></span>
                <span class="li-aside">${badge(x.status === 'absent' ? 'Absence' : x.status === 'retard' ? 'Retard' : x.status, x.status === 'absent' ? 'danger' : 'warn')}</span></div>`).join('')}</div>`
              : '<p class="subtle small" style="padding:14px">Aucune absence enregistrée — continue comme ça !</p>'}
          </div></div>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="card"><div class="card-body">${emptyState({ icon: 'wifi-off', title: 'Présences indisponibles', message: err.message })}</div></div>`;
  }
}

/* ================================================================== */
/* ROUTES                                                              */
/* ================================================================== */
export function registerPortails(route) {
  route('/parent', async () => { const el = h('<div class="view"></div>'); parentHome(el); return el; }, { title: 'Espace parents', group: 'Mon espace' });
  route('/parent/enfants', async () => { const el = h('<div class="view"></div>'); parentChildren(el); return el; }, { title: 'Mes enfants', group: 'Mon espace' });
  route('/parent/notes', async () => { const el = h('<div class="view"></div>'); parentNotes(el); return el; }, { title: 'Notes & bulletins', group: 'Mon espace' });
  route('/parent/presences', async () => { const el = h('<div class="view"></div>'); parentAttendance(el); return el; }, { title: 'Présences', group: 'Mon espace' });
  route('/parent/factures', async () => { const el = h('<div class="view"></div>'); parentInvoices(el); return el; }, { title: 'Factures & paiement', group: 'Mon espace' });
  route('/parent/devoirs', async () => { const el = h('<div class="view"></div>'); parentHomework(el); return el; }, { title: 'Devoirs', group: 'Mon espace' });
  route('/parent/messages', async ({ query }) => { const el = h('<div class="view"></div>'); parentMessages(el, query); return el; }, { title: 'Messages', group: 'Mon espace' });
  route('/parent/calendrier', async () => { const el = h('<div class="view"></div>'); portalCalendar(el); return el; }, { title: 'Calendrier', group: 'Mon espace' });

  route('/eleve', async () => { const el = h('<div class="view"></div>'); studentHome(el); return el; }, { title: 'Espace élève', group: 'Mon espace' });
  route('/eleve/notes', async () => { const el = h('<div class="view"></div>'); studentGrades(el); return el; }, { title: 'Mes notes', group: 'Mon espace' });
  route('/eleve/bulletins', async () => { const el = h('<div class="view"></div>'); studentBulletins(el); return el; }, { title: 'Mes bulletins', group: 'Mon espace' });
  route('/eleve/emploi-du-temps', async () => { const el = h('<div class="view"></div>'); studentTimetable(el); return el; }, { title: 'Emploi du temps', group: 'Mon espace' });
  route('/eleve/devoirs', async () => { const el = h('<div class="view"></div>'); studentHomework(el); return el; }, { title: 'Mes devoirs', group: 'Mon espace' });
  route('/eleve/presences', async () => { const el = h('<div class="view"></div>'); studentAttendance(el); return el; }, { title: 'Mes présences', group: 'Mon espace' });
  route('/eleve/messages', async ({ query }) => { const el = h('<div class="view"></div>'); parentMessages(el, query); return el; }, { title: 'Messages', group: 'Mon espace' });
}

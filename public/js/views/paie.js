/** Paie : aperçu, génération du bordereau, validation, paiements, bulletins. */
import { api } from '../api.js';
import {
  icons, esc, fcfa, num, personCell, badge, modal, toast,
  emptyState, barChart
} from '../ui.js';

export async function renderPaie(el, ctx) {
  const period = new Date().toISOString().slice(0, 7);
  let currentPeriod = period;
  let runs = [];

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Paie &amp; salaires</h2>
        <div class="sub">H.sup. (+15 % / +40 %) et majorations (nuit +60 %, dimanche/férié +60 %, nuit fériée +100 %) calculées directement sur le salaire de base mensuel — base 40 h/semaine.</div>
      </div>
      <div class="actions">
        <input class="input" type="month" id="pay-period" value="${period}" style="width:170px" />
        <button class="btn outline" id="pay-csv">${icons.download} Export CSV</button>
        <button class="btn accent" id="pay-gen">${icons.zap} Générer le bordereau</button>
      </div>
    </div>

    <div class="card pad mb-6" style="background:linear-gradient(120deg,#0B1F3A,#122B4D);border:0;color:#fff">
      <div class="flex wrap" style="justify-content:space-between">
        <div>
          <div class="tiny" style="color:#9FB0C6;letter-spacing:.12em;text-transform:uppercase">Barème appliqué automatiquement</div>
          <div class="mt-2" style="display:flex;flex-wrap:wrap;gap:6px">
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">🌙 Nuit 22h→5h <b style="color:#C9C2F8">+60 %</b></span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">☀️ Dimanche / férié <b style="color:#F6D78A">+60 %</b></span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">🌌 Nuit dimanche/férié <b style="color:#F6D78A">+100 %</b></span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">⏱️ H.sup. &gt; 40 h/sem. <b style="color:#8FD8BC">8 h à +15 %</b> puis <b style="color:#8FD8BC">+40 %</b></span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">📅 Quota 32 h.sup./mois à +15 %</span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">🧺 Panier si ≥ 10 h ou nuit — <b style="color:#8FD8BC">compteur 1, 2, 3…</b></span>
            <span class="rule-chip" style="background:rgba(255,255,255,.1);color:#DCE6F2">🎉 Jour férié non travaillé = <b style="color:#F6D78A">8 h payées</b></span>
          </div>
          <div class="tiny mt-2" style="color:#C8D5E4">Toutes les primes sont calculées directement sur le salaire de base mensuel (base 40 h/semaine).</div>
        </div>
        <div style="text-align:right">
          <div class="tiny" style="color:#9FB0C6">Période sélectionnée</div>
          <div style="font-size:28px;font-weight:800" id="pay-period-label"></div>
        </div>
      </div>
    </div>

    <div class="grid cols-4 mb-6" id="pay-kpis"></div>

    <div class="card">
      <div class="card-head">
        <h3>Simulation &amp; bordereaux</h3>
        <div class="right" id="pay-run-status"></div>
      </div>
      <div class="card-body tight" id="pay-body"><div class="loading"><div class="spinner"></div></div></div>
    </div>

    <div class="card mt-6">
      <div class="card-head"><h3>Historique des bordereaux</h3></div>
      <div class="card-body tight" id="pay-runs"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  const periodLabel = (p) => {
    const [y, m] = p.split('-');
    return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  async function loadRuns() {
    const data = await api.get('/payroll/runs');
    runs = data.runs;
    el.querySelector('#pay-runs').innerHTML = runs.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Période</th><th>Statut</th><th class="num">Brut total</th><th class="num">Net total</th><th></th></tr></thead>
        <tbody>${runs.map((r) => `
          <tr>
            <td class="b">${periodLabel(r.period)}</td>
            <td>${r.status === 'payé' ? badge('green', 'Payé') : r.status === 'validé' ? badge('blue', 'Validé') : badge('orange', 'Brouillon')}</td>
            <td class="num">${fcfa(r.total_gross)}</td>
            <td class="num b">${fcfa(r.total_net)}</td>
            <td><button class="btn sm outline" data-run="${r.id}">Consulter</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyState('money', 'Aucun bordereau généré', 'Cliquez sur « Générer le bordereau » pour la période.');

    el.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => openRun(b.dataset.run)));
  }

  async function loadPreview() {
    el.querySelector('#pay-period-label').textContent = periodLabel(currentPeriod);
    const data = await api.get(`/payroll/preview?period=${currentPeriod}`);
    const { results, totals } = data;

    el.querySelector('#pay-kpis').innerHTML = `
      <div class="card kpi"><div class="kpi-ico blue">${icons.users}</div>
        <div class="kpi-label">Employés</div><div class="kpi-value num">${results.length}</div>
        <div class="kpi-hint">Inclus dans le calcul</div></div>
      <div class="card kpi"><div class="kpi-ico gold">${icons.clock}</div>
        <div class="kpi-label">Heures totales</div><div class="kpi-value num">${num(totals.hours)} h</div>
        <div class="kpi-hint">Toutes catégories confondues</div></div>
      <div class="card kpi"><div class="kpi-ico violet">${icons.money}</div>
        <div class="kpi-label">Masse salariale brute</div><div class="kpi-value num" style="font-size:22px">${fcfa(totals.gross)}</div>
        <div class="kpi-hint">Primes incluses</div></div>
      <div class="card kpi"><div class="kpi-ico green">${icons.check}</div>
        <div class="kpi-label">Net à payer</div><div class="kpi-value num" style="font-size:22px">${fcfa(totals.net)}</div>
        <div class="kpi-hint">Après IPRES &amp; CSS</div></div>`;

    const runStatus = runs.find((r) => r.period === currentPeriod);
    el.querySelector('#pay-run-status').innerHTML = runStatus
      ? `${runStatus.status === 'brouillon'
          ? `<span class="badge orange">Brouillon</span>
             <button class="btn sm success" id="pay-validate">${icons.check} Valider le bordereau</button>`
          : runStatus.status === 'validé'
            ? `<span class="badge blue">Validé le ${runStatus.validated_at ? runStatus.validated_at.slice(0, 10) : ''}</span>`
            : `<span class="badge green">Payé</span>`}`
      : `<span class="badge gray">Simulation uniquement</span>`;

    el.querySelector('#pay-validate')?.addEventListener('click', async () => {
      await api.post(`/payroll/runs/${runStatus.id}/validate`);
      toast('success', 'Bordereau validé ✓', 'Les montants sont figés pour la période.');
      loadRuns(); loadPreview();
    });

    el.querySelector('#pay-body').innerHTML = results.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead>
          <tr>
            <th>Employé</th>
            <th class="num">Heures</th>
            <th class="num">Nuit</th>
            <th class="num">Dim./Férié</th>
            <th class="num">H.sup 15%</th>
            <th class="num">H.sup 40%</th>
            <th class="num">Paniers</th>
            <th class="num">Brut</th>
            <th class="num">Net</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${results.map((r, i) => `
            <tr class="breakdown-row" data-i="${i}">
              <td>${personCell(r.employee.first_name, r.employee.last_name, r.employee.matricule + ' · ' + (r.employee.department || ''))}</td>
              <td class="num b">${num(r.hours.total)}</td>
              <td class="num">${r.hours.night ? `<span style="color:var(--color-night);font-weight:700">${num(r.hours.night)}</span>` : '—'}</td>
              <td class="num">${(r.hours.rest_day + r.hours.rest_night) ? `<span style="color:var(--gold-600);font-weight:700">${num(r.hours.rest_day + r.hours.rest_night)}</span>` : '—'}</td>
              <td class="num">${r.hours.overtime_15 ? num(r.hours.overtime_15) : '—'}</td>
              <td class="num">${r.hours.overtime_40 ? num(r.hours.overtime_40) : '—'}</td>
              <td class="num">${r.paniers.count ? `🧺 ${r.paniers.count}` : '—'}</td>
              <td class="num">${fcfa(r.gross)}</td>
              <td class="num b">${fcfa(r.net)}</td>
              <td><button class="btn sm outline" data-slip="${i}">Bulletin</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="tiny muted mt-4" style="padding:0 16px 12px">Cliquez sur une ligne pour voir le détail. Les h.sup. (+15 % / +40 %) et majorations nuit (+60 %), dimanche/férié (+60 %), nuit fériée (+100 %) partent du salaire de base mensuel (base 40 h/semaine).</div>`
      : emptyState('users', 'Aucun employé actif');

    el.querySelectorAll('.breakdown-row').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('[data-slip]')) return;
      const r = results[Number(row.dataset.i)];
      openBreakdown(r, row);
    }));
    el.querySelectorAll('[data-slip]').forEach((b) =>
      b.addEventListener('click', () => openPayslip(results[Number(b.dataset.slip)], currentPeriod, runStatus)));
  }

  function openBreakdown(r, row) {
    const next = row.nextElementSibling;
    if (next && next.classList.contains('breakdown-detail')) { next.remove(); return; }
    document.querySelectorAll('.breakdown-detail').forEach((x) => x.remove());
    const tr = document.createElement('tr');
    tr.className = 'breakdown-detail';
    tr.innerHTML = `<td colspan="10">
      <div class="grid cols-2">
        <div>
          <div class="b mb-2">Lignes de paie</div>
          <div class="tiny muted mb-2">Calcul sur le salaire de base mensuel, base 40 h/semaine ; les h.sup. et majorations affichées appliquent le pourcentage correspondant à cette base.</div>
          <div class="payslip">
            <table>
              ${r.lines.map((l) => `
                <tr>
                  <td>${esc(l.label)}${l.premium_pct ? ` <span class="badge gold" style="font-size:10px">+${l.premium_pct}%</span>` : ''}
                    <div class="tiny muted">${esc(l.note || '')}</div></td>
                  <td class="r">${l.quantity} ${l.unit}</td>
                  <td class="r b">${l.code === 'PANIER' ? `<span class="badge gray">compté</span>` : fcfa(l.amount)}</td>
                </tr>`).join('')}
              <tr class="tot"><td>Brut</td><td class="r"></td><td class="r">${fcfa(r.gross)}</td></tr>
            </table>
          </div>
        </div>
        <div>
          <div class="b mb-2">Déductions &amp; net</div>
          <div class="payslip">
            <table>
              ${r.deductions.map((d) => `
                <tr><td>${esc(d.label)}</td><td class="r b" style="color:var(--color-danger)">- ${fcfa(d.amount)}</td></tr>`).join('')}
              <tr class="tot"><td>Net à payer</td><td class="r">${fcfa(r.net)}</td></tr>
            </table>
          </div>
          <div class="mt-4 b mb-2">Détail des heures</div>
          <div class="small">
            <div class="stat-line"><span class="lbl">Heures normales</span><span class="val">${num(r.hours.base)} h</span></div>
            <div class="stat-line"><span class="lbl">Heures de nuit (22h→5h)</span><span class="val">${num(r.hours.night)} h</span></div>
            <div class="stat-line"><span class="lbl">Dimanche / jour férié</span><span class="val">${num(r.hours.rest_day)} h</span></div>
            <div class="stat-line"><span class="lbl">Nuit dimanche/férié</span><span class="val">${num(r.hours.rest_night)} h</span></div>
            <div class="stat-line"><span class="lbl">H.sup. +15 %</span><span class="val">${num(r.hours.overtime_15)} h</span></div>
            <div class="stat-line"><span class="lbl">H.sup. +40 %</span><span class="val">${num(r.hours.overtime_40)} h</span></div>
            <div class="stat-line"><span class="lbl">Jours fériés crédités</span><span class="val">${r.holidays_credited.map((h) => esc(h.name)).join(', ') || '—'}</span></div>
          </div>
        </div>
      </div>
    </td>`;
    row.after(tr);
  }

  function openPayslip(r, period, runStatus) {
    const [y, m] = period.split('-');
    const label = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const m2 = modal({
      title: `Bulletin de paie — ${esc(label)}`,
      wide: true,
      body: `
        <div class="payslip print-area" id="slip">
          <div class="flex" style="justify-content:space-between;margin-bottom:14px">
            <div>
              <div class="b" style="font-size:16px">${esc(ctx.state.settings.company_name || 'Société')}</div>
              <div class="tiny muted">${esc(ctx.state.settings.company_address || '')}</div>
              <div class="tiny muted">RCC : ${esc(ctx.state.settings.company_rcc || '—')}</div>
            </div>
            <div style="text-align:right">
              <div class="badge blue">BULLETIN DE PAIE</div>
              <div class="tiny muted mt-2">Période : ${esc(label)}</div>
              <div class="tiny muted">Devise : FCFA (XOF)</div>
            </div>
          </div>
          <div class="grid cols-2 mb-2">
            <div>
              <div class="tiny muted">Salarié</div>
              <div class="b">${esc(r.employee.first_name)} ${esc(r.employee.last_name)}</div>
              <div class="tiny muted">${esc(r.employee.matricule)} · ${esc(r.employee.position || '')} · ${esc(r.employee.department || '')}</div>
            </div>
            <div style="text-align:right">
              <div class="tiny muted">Salaire de base mensuel</div>
              <div class="b">${fcfa(r.employee.base_salary)}</div>
              <div class="tiny muted">Calcul des h.sup. et majorations sur le salaire mensuel — base 40 h/semaine.</div>
            </div>
          </div>
          <table>
            <thead><tr><td><b>Désignation</b></td><td class="r"><b>Quantité</b></td><td class="r"><b>Montant</b></td></tr></thead>
            <tbody>
              ${r.lines.map((l) => `
                <tr><td>${esc(l.label)}</td><td class="r">${l.quantity} ${l.unit}</td><td class="r">${l.code === 'PANIER' ? '<span class="badge gray">compté</span>' : fcfa(l.amount)}</td></tr>`).join('')}
              <tr class="tot"><td>SALAIRE BRUT</td><td class="r"></td><td class="r">${fcfa(r.gross)}</td></tr>
              ${r.deductions.map((d) => `
                <tr><td>${esc(d.label)}</td><td class="r">- ${d.rate} %</td><td class="r" style="color:var(--color-danger)">- ${fcfa(d.amount)}</td></tr>`).join('')}
              <tr class="tot"><td>NET À PAYER</td><td class="r"></td><td class="r" style="font-size:16px">${fcfa(r.net)}</td></tr>
            </tbody>
          </table>
          <div class="tiny muted mt-4">
            Heures : ${num(r.hours.total)} h au total — nuit ${num(r.hours.night)} h · dimanche/férié ${num(r.hours.rest_day + r.hours.rest_night)} h ·
            h.sup. ${num(r.hours.overtime_15 + r.hours.overtime_40)} h · paniers : ${r.paniers.count}.<br/>
            Majorations appliquées sur le salaire de base mensuel (base 40 h/semaine) : nuit +60 %, dimanche/férié +60 %, nuit fériée +100 %, h.sup. +15 % puis +40 %.
          </div>
        </div>`,
      footer: `<button class="btn outline" data-close>Fermer</button>
               <button class="btn dark" id="slip-print">${icons.print} Imprimer</button>
               ${runStatus && runStatus.status === 'validé' ? `<button class="btn success" id="slip-pay">${icons.money} Marquer payé</button>` : ''}`
    });
    m2.el.querySelector('#slip-print').addEventListener('click', () => window.print());
    m2.el.querySelector('#slip-pay')?.addEventListener('click', async () => {
      const ref = prompt('Mode / référence du paiement (Wave, Orange Money, virement, espèces…) :', 'Wave');
      if (ref === null) return;
      try {
        // Retrouver l'item de paie de cet employé dans le bordereau de la période
        const { runs } = await api.get('/payroll/runs');
        const run = runs.find((x) => x.period === currentPeriod);
        if (!run) { toast('error', 'Aucun bordereau pour cette période'); return; }
        const detail = await api.get(`/payroll/runs/${run.id}`);
        const item = detail.items.find((i) => i.employee_id === r.employee.id);
        if (!item) { toast('error', 'Ligne de paie introuvable'); return; }
        await api.post(`/payroll/items/${item.id}/pay`, { method: ref || 'Mobile Money', reference: '' });
        toast('success', 'Paiement enregistré ✓', `${r.employee.first_name} ${r.employee.last_name} — ${ref || 'Mobile Money'}`);
        m2.close();
        loadPreview();
      } catch (e) {
        toast('error', 'Erreur de paiement', e.message);
      }
    });
  }

  async function openRun(runId) {
    const data = await api.get(`/payroll/runs/${runId}`);
    const r = data.run;
    const label = periodLabel(r.period);
    const m = modal({
      title: `Bordereau — ${esc(label)}`,
      wide: true,
      body: `
        <div class="flex wrap mb-4">
          ${r.status === 'brouillon' ? badge('orange', 'Brouillon') : r.status === 'validé' ? badge('blue', 'Validé') : badge('green', 'Payé')}
          <span class="muted small">Brut : <b>${fcfa(r.total_gross)}</b></span>
          <span class="muted small">Net : <b>${fcfa(r.total_net)}</b></span>
        </div>
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>Employé</th><th class="num">Heures</th><th class="num">Brut</th><th class="num">Net</th><th>Statut</th></tr></thead>
          <tbody>${data.items.map((i) => `
            <tr>
              <td>${personCell(i.first_name, i.last_name, i.matricule)}</td>
              <td class="num">${num(JSON.parse(i.hours_json || '{}').total || 0)}</td>
              <td class="num">${fcfa(i.gross)}</td>
              <td class="num b">${fcfa(i.net)}</td>
              <td>${i.status === 'payé' ? badge('green', 'Payé') : i.status === 'validé' ? badge('blue', 'Validé') : badge('orange', 'Calculé')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`,
      footer: `<button class="btn outline" data-close>Fermer</button>`
    });
    void m;
  }

  el.querySelector('#pay-period').addEventListener('change', (e) => {
    currentPeriod = e.target.value || period;
    loadPreview();
  });
  el.querySelector('#pay-csv').addEventListener('click', () => {
    window.open(`/api/export/csv?period=${currentPeriod}`, '_blank');
  });
  el.querySelector('#pay-gen').addEventListener('click', async () => {
    const btn = el.querySelector('#pay-gen');
    btn.disabled = true;
    btn.textContent = 'Calcul en cours…';
    try {
      const res = await api.post('/payroll/runs', { period: currentPeriod });
      toast('success', 'Bordereau généré ✓', `Brut ${fcfa(res.total_gross)} · Net ${fcfa(res.total_net)}`);
      await loadRuns();
      await loadPreview();
    } catch (e) {
      toast('error', 'Erreur', e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icons.zap} Générer le bordereau`;
    }
  });

  await loadRuns();
  await loadPreview();
}

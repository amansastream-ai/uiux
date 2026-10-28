/** Rapports : heures par employé, supplémentaires, masse salariale. */
import { api } from '../api.js';
import { icons, esc, fcfa, num, barChart, badge, emptyState, personCell } from '../ui.js';

export async function renderRapports(el, ctx) {
  const period = new Date().toISOString().slice(0, 7);
  let currentPeriod = period;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Rapports</h2>
        <div class="sub">Synthèse des heures travaillées, supplémentaires et de la masse salariale</div>
      </div>
      <div class="actions">
        <input class="input" type="month" id="rp-period" value="${period}" style="width:170px" />
        <button class="btn outline" id="rp-csv">${icons.download} Export CSV</button>
      </div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h3>📊 Heures travaillées par employé</h3></div>
        <div class="card-body" id="rp-chart"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>⏱️ Répartition des heures</h3></div>
        <div class="card-body" id="rp-split"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>
    <div class="card mt-6">
      <div class="card-head"><h3>Détail par employé</h3>
        <div class="right"><span class="badge gray" id="rp-count"></span></div>
      </div>
      <div class="card-body tight" id="rp-table"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  async function load() {
    const data = await api.get(`/reports/hours?period=${currentPeriod}`);
    const rows = data.rows;

    const chartVals = rows.map((r) => ({ label: r.matricule.replace('EMP-', ''), value: r.hours.total }));
    el.querySelector('#rp-chart').innerHTML = rows.length
      ? barChart(chartVals) + `<div class="tiny muted mt-2">Total (heures) par matricule — période ${currentPeriod}</div>`
      : emptyState('chart', 'Aucune donnée');

    const tot = rows.reduce((a, r) => ({
      base: a.base + r.hours.base, night: a.night + r.hours.night,
      rest: a.rest + r.hours.rest_day + r.hours.rest_night,
      ot: a.ot + r.hours.overtime_15 + r.hours.overtime_40,
      panier: a.panier + r.paniers
    }), { base: 0, night: 0, rest: 0, ot: 0, panier: 0 });
    const sum = Math.max(1, tot.base + tot.night + tot.rest + tot.ot);
    const pct = (v) => `${Math.round((v / sum) * 100)} %`;

    el.querySelector('#rp-split').innerHTML = `
      <div class="stat-line"><span class="lbl">Heures normales</span>
        <span class="val">${num(tot.base)} h · ${pct(tot.base)}</span></div>
      <div class="stat-line"><span class="lbl">Heures de nuit (22h→5h)</span>
        <span class="val" style="color:var(--color-night)">${num(tot.night)} h · ${pct(tot.night)}</span></div>
      <div class="stat-line"><span class="lbl">Dimanche / jour férié</span>
        <span class="val" style="color:var(--gold-600)">${num(tot.rest)} h · ${pct(tot.rest)}</span></div>
      <div class="stat-line"><span class="lbl">Heures supplémentaires</span>
        <span class="val" style="color:var(--color-success)">${num(tot.ot)} h · ${pct(tot.ot)}</span></div>
      <div class="divider"></div>
      <div class="stat-line"><span class="lbl">Paniers distribués</span>
        <span class="val">🧺 ${tot.panier}</span></div>
      <div class="mt-4">${barChart([
        { label: 'Normales', value: tot.base },
        { label: 'Nuit', value: tot.night },
        { label: 'Dim./Férié', value: tot.rest, gold: true },
        { label: 'H.sup.', value: tot.ot }
      ])}</div>`;

    el.querySelector('#rp-count').textContent = `${rows.length} employé(s)`;
    el.querySelector('#rp-table').innerHTML = rows.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr>
          <th>Employé</th><th>Département</th><th>Horaires</th>
          <th class="num">Total</th><th class="num">Nuit</th><th class="num">Dim./Férié</th>
          <th class="num">H.sup 15%</th><th class="num">H.sup 40%</th><th class="num">Paniers</th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td>${personCell(r.name.split(' ')[0], r.name.split(' ').slice(1).join(' '), r.matricule)}</td>
            <td>${esc(r.department || '—')}</td>
            <td class="small">${esc(r.schedule)}<br/><span class="muted">${r.weekly_hours} h/sem. · ${r.monthly_hours} h/mois</span></td>
            <td class="num b">${num(r.hours.total)}</td>
            <td class="num">${num(r.hours.night)}</td>
            <td class="num">${num(r.hours.rest_day + r.hours.rest_night)}</td>
            <td class="num">${num(r.hours.overtime_15)}</td>
            <td class="num">${num(r.hours.overtime_40)}</td>
            <td class="num">${r.paniers}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyState('chart', 'Aucune donnée pour cette période');
  }

  el.querySelector('#rp-period').addEventListener('change', (e) => {
    currentPeriod = e.target.value || period;
    load();
  });
  el.querySelector('#rp-csv').addEventListener('click', () => {
    if (['admin', 'comptable'].includes(ctx.state.user.role)) {
      window.open(`/api/export/csv?period=${currentPeriod}`, '_blank');
    } else {
      window.print();
    }
  });

  await load();
}

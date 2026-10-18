/** Tableau de bord — adaptatif selon le rôle. */
import { api } from '../api.js';
import { icons, esc, fcfa, num, timeFR, dateTimeFR, methodBadge, personCell, badge, emptyState, ROLE_LABELS } from '../ui.js';

export async function renderDashboard(el, ctx) {
  const d = await api.get('/dashboard');
  const role = ctx.state.user.role;
  const month = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const kpis = [];
  kpis.push({
    ico: 'users', color: 'blue', label: 'Employés actifs',
    value: d.activeEmployees, hint: 'Effectif sous contrat'
  });
  kpis.push({
    ico: 'check', color: 'green', label: 'Présents maintenant',
    value: d.present, hint: `sur ${d.activeEmployees} employés`
  });
  kpis.push({
    ico: 'clock', color: 'gold', label: 'Pointages aujourd’hui',
    value: d.punchesToday, hint: d.absentCount ? `${d.absentCount} sans pointage` : 'Tous ont pointé'
  });
  if (role !== 'pointage') {
    kpis.push({
      ico: 'chart', color: 'violet', label: `Heures — ${month}`,
      value: `${num(d.monthHours)} h`, hint: 'Total cumulé équipes'
    });
  }
  if (d.payroll && ['admin', 'comptable'].includes(role)) {
    kpis.push({
      ico: 'money', color: 'red', label: `Masse salariale ${d.payroll.period}`,
      value: fcfa(d.payroll.total_gross), hint: `Net : ${fcfa(d.payroll.total_net)} · ${d.payroll.status}`
    });
  }

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Tableau de bord</h2>
        <div class="sub">Bonjour <b>${esc(ctx.state.user.name)}</b> — ${ROLE_LABELS[role]}. Voici l’activité en temps réel.</div>
      </div>
      <div class="actions">
        <button class="btn outline" id="btn-borne">${icons.tablet} Ouvrir la borne</button>
        ${['admin', 'drh'].includes(role) ? `<button class="btn primary" id="btn-add-emp">${icons.plus} Nouvel employé</button>` : ''}
        ${['admin', 'comptable'].includes(role) ? `<button class="btn accent" id="btn-paie">${icons.money} Voir la paie</button>` : ''}
      </div>
    </div>

    <div class="grid cols-${Math.min(kpis.length, 4)} mb-6">
      ${kpis.map((k) => `
        <div class="card kpi">
          <div class="kpi-ico ${k.color}">${icons[k.ico]}</div>
          <div class="kpi-label">${k.label}</div>
          <div class="kpi-value num">${k.value}</div>
          <div class="kpi-hint">${k.hint}</div>
        </div>`).join('')}
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h3>🟢 Présents sur site</h3>
          <div class="right"><span class="badge green">${d.openSessions.length} en cours</span></div>
        </div>
        <div class="card-body tight">
          ${d.openSessions.length ? `
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Employé</th><th>Poste</th><th>Depuis</th><th>Méthode</th></tr></thead>
            <tbody>${d.openSessions.map((s) => `
              <tr>
                <td>${personCell(s.first_name, s.last_name, s.matricule)}</td>
                <td>${esc(s.schedule_name)}</td>
                <td class="num"><b>${timeFR(s.since)}</b></td>
                <td>${methodBadge(s.method)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>` : emptyState('clock', 'Personne sur site', 'Les prochains pointages apparaîtront ici en direct.')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>⏱️ Derniers pointages</h3>
          <div class="right"><span class="badge gray">temps réel</span></div>
        </div>
        <div class="card-body tight">
          ${d.recent.length ? `
          <div class="table-wrap"><table class="tbl">
            <thead><tr><th>Employé</th><th>Type</th><th>Heure</th><th>Méthode</th></tr></thead>
            <tbody>${d.recent.map((a) => `
              <tr>
                <td>${personCell(a.first_name, a.last_name, a.matricule)}</td>
                <td>${a.type === 'in' ? badge('green', 'Entrée') : badge('red', 'Sortie')}</td>
                <td class="num">${dateTimeFR(a.ts)}</td>
                <td>${methodBadge(a.method)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>` : emptyState('clock', 'Aucun pointage')}
        </div>
      </div>
    </div>

    ${d.absents.length ? `
    <div class="card mt-6">
      <div class="card-head"><h3>🔴 Sans pointage aujourd’hui</h3>
        <div class="right"><span class="badge red">${d.absentCount} employé(s)</span></div>
      </div>
      <div class="card-body tight">
        <div class="flex wrap">
          ${d.absents.map((a) => `<span class="rule-chip"><b>${esc(a.first_name)} ${esc(a.last_name)}</b> · ${esc(a.matricule)} · ${esc(a.schedule_name)}</span>`).join('')}
        </div>
      </div>
    </div>` : ''}`;

  el.querySelector('#btn-borne').addEventListener('click', () => ctx.go('#/borne'));
  el.querySelector('#btn-add-emp')?.addEventListener('click', () => ctx.go('#/employes'));
  el.querySelector('#btn-paie')?.addEventListener('click', () => ctx.go('#/paie'));
}

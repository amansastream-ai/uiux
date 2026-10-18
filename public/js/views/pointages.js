/** Pointages : vue journalière, corrections manuelles. */
import { api } from '../api.js';
import {
  icons, esc, timeFR, dateTimeFR, methodBadge, personCell, badge,
  modal, toast, confirmDialog, emptyState, dayName
} from '../ui.js';

export async function renderPointages(el, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  let date = today;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Pointages</h2>
        <div class="sub" id="pt-sub"></div>
      </div>
      <div class="actions">
        <input class="input" type="date" id="pt-date" value="${date}" style="width:180px" />
        <button class="btn outline" id="pt-today">${icons.calendar} Aujourd’hui</button>
        ${ctx.state.user.role !== 'comptable' ? `<button class="btn primary" id="pt-add">${icons.plus} Pointage manuel</button>` : ''}
      </div>
    </div>
    <div class="grid cols-3 mb-6" id="pt-stats"></div>
    <div class="card">
      <div class="card-head"><h3 id="pt-title">Registre du jour</h3>
        <div class="right"><span class="badge gray" id="pt-count"></span></div>
      </div>
      <div class="card-body tight" id="pt-body"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  async function load() {
    const data = await api.get(`/attendance?date=${date}`);
    const rows = data.attendance;
    const ins = rows.filter((r) => r.type === 'in');
    const outs = rows.filter((r) => r.type === 'out');
    const byEmp = {};
    rows.forEach((r) => { (byEmp[r.employee_id] = byEmp[r.employee_id] || []).push(r); });

    el.querySelector('#pt-sub').textContent = dayName(date + 'T12:00:00');
    el.querySelector('#pt-title').textContent = 'Registre — ' + dayName(date + 'T12:00:00');
    el.querySelector('#pt-count').textContent = `${rows.length} pointage(s)`;

    el.querySelector('#pt-stats').innerHTML = `
      <div class="card kpi"><div class="kpi-ico green">${icons.check}</div>
        <div class="kpi-label">Entrées</div><div class="kpi-value num">${ins.length}</div>
        <div class="kpi-hint">Arrivées enregistrées</div></div>
      <div class="card kpi"><div class="kpi-ico red">${icons.logout}</div>
        <div class="kpi-label">Sorties</div><div class="kpi-value num">${outs.length}</div>
        <div class="kpi-hint">Départs enregistrés</div></div>
      <div class="card kpi"><div class="kpi-ico blue">${icons.users}</div>
        <div class="kpi-label">Employés concernés</div><div class="kpi-value num">${Object.keys(byEmp).length}</div>
        <div class="kpi-hint">Uniques sur la journée</div></div>`;

    el.querySelector('#pt-body').innerHTML = rows.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Heure</th><th>Employé</th><th>Type</th><th>Méthode</th><th>Terminal</th><th>Note</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="num b">${timeFR(r.ts)}</td>
            <td>${personCell(r.first_name, r.last_name, r.matricule)}</td>
            <td>${r.type === 'in' ? badge('green', 'Entrée') : badge('red', 'Sortie')}</td>
            <td>${methodBadge(r.method)}</td>
            <td class="small muted">${esc(r.device || '—')}</td>
            <td class="small muted">${esc(r.note || '')}</td>
            <td>${['admin', 'pointage'].includes(ctx.state.user.role)
              ? `<button class="btn-icon danger" data-del="${r.id}" title="Supprimer">${icons.trash}</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyState('clock', 'Aucun pointage ce jour-là', 'Essayez une autre date ou ajoutez un pointage manuel.');

    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('Supprimer ce pointage ?', 'Cette action est irréversible.', async () => {
        await api.del(`/attendance/${b.dataset.del}`);
        toast('success', 'Pointage supprimé');
        load();
      });
    }));
  }

  el.querySelector('#pt-date').addEventListener('change', (e) => { date = e.target.value; load(); });
  el.querySelector('#pt-today').addEventListener('click', () => {
    date = today;
    el.querySelector('#pt-date').value = today;
    load();
  });

  el.querySelector('#pt-add')?.addEventListener('click', async () => {
    const { employees } = await api.get('/employees');
    const m = modal({
      title: 'Ajouter un pointage manuel',
      body: `
        <form id="pt-form" class="form-grid">
          <div class="field full"><label>Employé</label>
            <select class="input" name="employee_id" required>
              ${employees.filter((e) => e.status === 'actif').map((e) =>
                `<option value="${e.id}">${esc(e.matricule)} — ${esc(e.first_name)} ${esc(e.last_name)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Type</label>
            <select class="input" name="type"><option value="in">Entrée</option><option value="out">Sortie</option></select></div>
          <div class="field"><label>Méthode</label>
            <select class="input" name="method"><option value="manual">Manuel</option><option value="qr">QR</option><option value="fingerprint">Empreinte</option></select></div>
          <div class="field"><label>Date &amp; heure</label>
            <input class="input" name="ts" type="datetime-local" required
              value="${new Date().toISOString().slice(0, 16)}" /></div>
          <div class="field"><label>Note</label>
            <input class="input" name="note" placeholder="Ex. : oubli de badge" /></div>
        </form>`,
      footer: `<button class="btn outline" data-close>Annuler</button><button class="btn primary" id="pt-save">Enregistrer</button>`
    });
    m.el.querySelector('#pt-save').addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(m.el.querySelector('#pt-form')).entries());
      data.employee_id = Number(data.employee_id);
      if (data.ts.length === 16) data.ts += ':00';
      try {
        await api.post('/attendance', data);
        m.close();
        toast('success', 'Pointage enregistré');
        load();
      } catch (e) { toast('error', 'Erreur', e.message); }
    });
  });

  await load();
}

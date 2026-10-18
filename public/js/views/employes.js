/** Employés : CRUD, badges QR imprimables, enrôlement d'empreintes. */
import { api } from '../api.js';
import {
  icons, esc, fcfa, dateFR, personCell, badge, modal, toast,
  confirmDialog, emptyState, methodBadge
} from '../ui.js';

export async function renderEmployes(el, ctx) {
  const [{ employees }, { departments }] = await Promise.all([
    api.get('/employees'),
    api.get('/departments')
  ]);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Employés &amp; badges</h2>
        <div class="sub">${employees.length} employé(s) — salaire de base mensuel servant au calcul direct des h.sup. et majorations (base 40 h/semaine)</div>
      </div>
      <div class="actions">
        <div class="search-box" style="width:260px">
          ${icons.search}
          <input class="input" id="emp-search" placeholder="Rechercher (nom, matricule…)" />
        </div>
        <button class="btn primary" id="btn-new">${icons.plus} Nouvel employé</button>
      </div>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table class="tbl" id="emp-table">
          <thead>
            <tr>
              <th>Employé</th><th>Matricule</th><th>Département</th><th>Poste</th>
              <th>Horaires</th><th class="num">Salaire de base</th><th>Badge</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>`;

  const tbody = el.querySelector('#emp-table tbody');

  const draw = (list) => {
    tbody.innerHTML = list.length ? list.map((e) => `
      <tr class="clickable" data-open="${e.id}">
        <td>${personCell(e.first_name, e.last_name, e.email || '')}</td>
        <td><code class="tiny">${esc(e.matricule)}</code></td>
        <td>${esc(e.department || '—')}</td>
        <td>${esc(e.position || '—')}</td>
        <td class="small">${esc(e.schedule_name)} · ${esc(e.schedule_start)}–${esc(e.schedule_end)}</td>
        <td class="num b">${fcfa(e.base_salary)}</td>
        <td>
          ${badge('blue', 'QR')} ${e.fingerprint_id ? badge('violet', 'Empreinte') : badge('gray', 'Sans empreinte')}
        </td>
        <td>${e.status === 'actif' ? badge('green', 'Actif') : badge('red', 'Inactif')}</td>
        <td>
          <div class="flex" style="gap:6px">
            <button class="btn-icon" title="Modifier" data-edit="${e.id}">${icons.edit}</button>
            <button class="btn-icon danger" title="Désactiver" data-del="${e.id}">${icons.trash}</button>
          </div>
        </td>
      </tr>`).join('') : `<tr><td colspan="9">${emptyState('users', 'Aucun employé trouvé')}</td></tr>`;

    tbody.querySelectorAll('[data-open]').forEach((r) =>
      r.addEventListener('click', (ev) => {
        if (ev.target.closest('button')) return;
        openDetail(r.dataset.open);
      }));
    tbody.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openForm(employees.find((x) => x.id == b.dataset.edit))));
    tbody.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const emp = employees.find((x) => x.id == b.dataset.del);
        confirmDialog('Désactiver l’employé ?', `${emp.first_name} ${emp.last_name} ne pourra plus pointer avec son badge.`, async () => {
          await api.put(`/employees/${emp.id}`, { ...emp, status: emp.status === 'actif' ? 'inactif' : 'actif' });
          toast('success', 'Statut mis à jour');
          ctx.refresh();
        });
      }));
  };
  draw(employees);

  el.querySelector('#emp-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    draw(employees.filter((x) =>
      `${x.first_name} ${x.last_name} ${x.matricule} ${x.position} ${x.department}`.toLowerCase().includes(q)));
  });

  /* ---------------- Formulaire création / édition ---------------- */
  function openForm(emp = null) {
    const isNew = !emp;
    const depOpts = departments.map((d) =>
      `<option value="${d.id}" ${emp && emp.department_id == d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    const m = modal({
      title: isNew ? 'Nouvel employé' : `Modifier — ${esc(emp.first_name)} ${esc(emp.last_name)}`,
      wide: true,
      body: `
        <form id="emp-form" class="form-grid">
          <div class="field"><label>Matricule *</label>
            <input class="input" name="matricule" required value="${esc(emp?.matricule || `EMP-${String(Math.floor(Math.random() * 900) + 100)}`)}" /></div>
          <div class="field"><label>Département</label>
            <select class="input" name="department_id"><option value="">—</option>${depOpts}</select></div>
          <div class="field"><label>Prénom *</label>
            <input class="input" name="first_name" required value="${esc(emp?.first_name || '')}" /></div>
          <div class="field"><label>Nom *</label>
            <input class="input" name="last_name" required value="${esc(emp?.last_name || '')}" /></div>
          <div class="field"><label>E-mail</label>
            <input class="input" name="email" type="email" value="${esc(emp?.email || '')}" /></div>
          <div class="field"><label>Téléphone</label>
            <input class="input" name="phone" value="${esc(emp?.phone || '')}" placeholder="77 000 00 00" /></div>
          <div class="field"><label>Poste</label>
            <input class="input" name="position" value="${esc(emp?.position || '')}" /></div>
          <div class="field"><label>Type de contrat</label>
            <select class="input" name="contract_type">
              ${['CDI', 'CDD', 'Stage', 'Essai', 'Consultant'].map((c) =>
                `<option ${emp?.contract_type === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></div>
          <div class="field"><label>Date d’embauche</label>
            <input class="input" type="date" name="hire_date" value="${esc(emp?.hire_date || '')}" /></div>
          <div class="field"><label>Salaire de base mensuel (FCFA) *</label>
            <input class="input" type="number" name="base_salary" required min="0" step="5000" value="${emp?.base_salary || 200000}" /></div>
          <div class="field"><label>Horaires</label>
            <select class="input" name="schedule_name">
              ${['Jour', 'Équipe jour', 'Nuit', 'Rotation 7j/7', 'Flexible'].map((c) =>
                `<option ${emp?.schedule_name === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></div>
          <div class="field"><label>Statut</label>
            <select class="input" name="status">
              <option value="actif" ${!emp || emp.status === 'actif' ? 'selected' : ''}>Actif</option>
              <option value="inactif" ${emp?.status === 'inactif' ? 'selected' : ''}>Inactif</option>
            </select></div>
          <div class="field"><label>Heure de début</label>
            <input class="input" name="schedule_start" value="${esc(emp?.schedule_start || '08:00')}" type="time" /></div>
          <div class="field"><label>Heure de fin</label>
            <input class="input" name="schedule_end" value="${esc(emp?.schedule_end || '17:00')}" type="time" /></div>
        </form>`,
      footer: `<button class="btn outline" data-close>Annuler</button>
               <button class="btn primary" id="emp-save">${isNew ? 'Créer l’employé' : 'Enregistrer'}</button>`
    });

    m.el.querySelector('#emp-save').addEventListener('click', async () => {
      const form = m.el.querySelector('#emp-form');
      const data = Object.fromEntries(new FormData(form).entries());
      if (!data.matricule || !data.first_name || !data.last_name || !data.base_salary) {
        toast('error', 'Champs obligatoires manquants');
        return;
      }
      try {
        if (isNew) {
          const created = await api.post('/employees', data);
          m.close();
          toast('success', 'Employé créé 🎉', 'Téléchargez son badge QR ci-dessous.');
          openDetail(created.employee.id);
          return;
        }
        await api.put(`/employees/${emp.id}`, data);
        m.close();
        toast('success', 'Employé mis à jour');
        ctx.refresh();
      } catch (e) {
        toast('error', 'Erreur', e.message);
      }
    });
  }

  el.querySelector('#btn-new').addEventListener('click', () => openForm());

  /* ---------------- Détail : badge QR + empreinte ---------------- */
  async function openDetail(id) {
    const { employee: e, recent } = await api.get(`/employees/${id}`);
    const m = modal({
      title: `${esc(e.first_name)} ${esc(e.last_name)} <span class="muted small">· ${esc(e.matricule)}</span>`,
      wide: true,
      body: `
        <div class="grid cols-2">
          <div>
            <div class="flex mb-4">
              <div class="avatar lg" style="background:linear-gradient(135deg,#1662DD,#124FB0)">
                ${esc((e.first_name[0] || '') + (e.last_name[0] || ''))}</div>
              <div>
                <div class="b">${esc(e.position || 'Employé')}</div>
                <div class="muted small">${esc(e.department || '')} · ${esc(e.contract_type)} · embauché le ${dateFR(e.hire_date)}</div>
                <div class="mt-2">${e.status === 'actif' ? badge('green', 'Actif') : badge('red', 'Inactif')}
                  ${e.fingerprint_id ? badge('violet', 'Empreinte OK') : badge('orange', 'Empreinte à enregistrer')}</div>
              </div>
            </div>
            <div class="card pad" style="background:var(--gray-50)">
              <div class="stat-line"><span class="lbl">Salaire de base mensuel</span><span class="val">${fcfa(e.base_salary)}</span></div>
              <p class="tiny muted mt-2">Les heures supplémentaires (+15 % / +40 %) et majorations (nuit +60 %, dimanche/férié +60 %, nuit fériée +100 %) sont calculées directement sur ce salaire — base 40 h/semaine.</p>
              <div class="stat-line"><span class="lbl">Horaires</span><span class="val">${esc(e.schedule_name)} · ${esc(e.schedule_start)}–${esc(e.schedule_end)}</span></div>
              <div class="stat-line"><span class="lbl">Téléphone</span><span class="val">${esc(e.phone || '—')}</span></div>
              <div class="stat-line"><span class="lbl">E-mail</span><span class="val small">${esc(e.email || '—')}</span></div>
            </div>
            <div class="divider"></div>
            <div class="b mb-2">Empreinte digitale</div>
            <div class="flex">
              <code class="tiny">${esc(e.fingerprint_id || 'Non enrôlée')}</code>
              <button class="btn sm outline" id="btn-fp">${icons.fingerprint} ${e.fingerprint_id ? 'Ré-enrôler' : 'Enrôler'}</button>
            </div>
            <div class="divider"></div>
            <div class="b mb-2">Badge QR</div>
            <div class="flex wrap">
              <code class="tiny">${esc(e.qr_token)}</code>
              <button class="btn sm outline" id="btn-qr">${icons.qr} Régénérer</button>
            </div>
            <div class="flex wrap mt-2">
              <a class="btn sm primary" href="/api/employees/${e.id}/badge.png?dl=1" download="badge-${esc(e.matricule)}.png">${icons.download} Télécharger PNG</a>
              <a class="btn sm outline" href="/api/employees/${e.id}/badge.svg?dl=1" download="badge-${esc(e.matricule)}.svg">${icons.download} SVG</a>
              <button class="btn sm dark" id="btn-print">${icons.print} Imprimer la carte</button>
            </div>
            <div class="tiny muted mt-2">QR réellement scannable : placez le PNG téléchargé sur la carte de l’employé, il fonctionnera directement sur la borne.</div>
          </div>
          <div>
            <div class="badge-print print-area" id="badge-area">
              <div class="b-head">CHRONORH · BADGE</div>
              <div class="b-body">
                <img id="badge-qr" alt="QR" src="/api/employees/${e.id}/badge.svg" />
                <div class="b-name">${esc(e.first_name)} ${esc(e.last_name)}</div>
                <div class="b-meta">${esc(e.matricule)} · ${esc(e.department || '')}</div>
                <div class="b-meta">${esc(ctx.state.settings.company_name || 'Société')}</div>
              </div>
            </div>
            <div class="tiny muted mt-2" style="text-align:center">Scannez ce QR sur la borne pour pointer</div>
            <div class="divider"></div>
            <div class="b mb-2">Derniers pointages</div>
            <div class="table-wrap" style="max-height:200px;overflow-y:auto">
              <table class="tbl">
                <tbody>${recent.slice(0, 8).map((a) => `
                  <tr>
                    <td class="small">${dateFR(a.ts)} ${a.ts.slice(11, 16)}</td>
                    <td>${a.type === 'in' ? badge('green', 'Entrée') : badge('red', 'Sortie')}</td>
                    <td>${methodBadge(a.method)}</td>
                  </tr>`).join('') || '<tr><td class="muted small">Aucun pointage</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>`
    });

    m.el.querySelector('#btn-print').addEventListener('click', () => window.print());
    m.el.querySelector('#btn-qr').addEventListener('click', async () => {
      await api.post(`/employees/${e.id}/regenerate-qr`);
      toast('success', 'Badge QR régénéré', 'Les anciens codes ne fonctionnent plus.');
      m.close(); ctx.refresh();
    });
    m.el.querySelector('#btn-fp').addEventListener('click', () => openEnroll(e, m));
  }

  function openEnroll(e, parentModal) {
    const m = modal({
      title: 'Enrôlement d’empreinte digitale',
      body: `
        <div class="fp-enroll">
          <div class="muted">Placez le doigt sur le capteur de la tablette — 3 captures nécessaires.</div>
          <div class="fp-big" id="fp-big">
            ${icons.fingerprint}
            <div class="scan-line" id="fp-line" style="display:none"></div>
          </div>
          <div class="fp-progress" id="fp-prog"><i></i><i></i><i></i></div>
          <div class="mt-4"><b id="fp-msg">Appuyez sur « Lancer la capture »</b></div>
        </div>`,
      footer: `<button class="btn outline" data-close>Fermer</button>
               <button class="btn primary" id="fp-start">${icons.fingerprint} Lancer la capture</button>`
    });
    m.el.querySelector('#fp-start').addEventListener('click', () => {
      const bars = m.el.querySelectorAll('#fp-prog i');
      const line = m.el.querySelector('#fp-line');
      const msg = m.el.querySelector('#fp-msg');
      line.style.display = 'block';
      let step = 0;
      const t = setInterval(() => {
        bars[step].classList.add('done');
        step++;
        msg.textContent = step < 3 ? `Capture ${step}/3 réussie — relevez puis reposez le doigt` : 'Captures validées ✓';
        if (step >= 3) {
          clearInterval(t);
          line.style.display = 'none';
          api.post(`/employees/${e.id}/enroll-fingerprint`).then(() => {
            toast('success', 'Empreinte enregistrée', `${e.first_name} ${e.last_name} peut pointer par empreinte.`);
            setTimeout(() => { m.close(); parentModal.close(); ctx.refresh(); }, 900);
          });
        }
      }, 850);
    });
  }
}

/** Gestion des utilisateurs (admin). */
import { api } from '../api.js';
import { icons, esc, modal, toast, badge, ROLE_LABELS, personCell, confirmDialog } from '../ui.js';

export async function renderUtilisateurs(el, ctx) {
  const { users } = await api.get('/users');

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Utilisateurs</h2>
        <div class="sub">Comptes de la plateforme et leurs rôles</div>
      </div>
      <div class="actions">
        <button class="btn primary" id="btn-new">${icons.plus} Nouvel utilisateur</button>
      </div>
    </div>

    <div class="grid cols-4 mb-6">
      ${['admin', 'drh', 'comptable', 'pointage'].map((r) => {
        const n = users.filter((u) => u.role === r).length;
        const colors = { admin: 'blue', drh: 'green', comptable: 'gold', pointage: 'violet' };
        return `<div class="card kpi">
          <div class="kpi-ico ${colors[r]}">${icons.shield}</div>
          <div class="kpi-label">${ROLE_LABELS[r]}</div>
          <div class="kpi-value num">${n}</div>
          <div class="kpi-hint">compte(s)</div>
        </div>`;
      }).join('')}
    </div>

    <div class="card">
      <div class="card-head"><h3>Tous les comptes</h3></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Utilisateur</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th>Créé le</th><th></th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td>${personCell(u.name.split(' ')[0], u.name.split(' ').slice(1).join(' '), '')}</td>
              <td class="small">${esc(u.email)}</td>
              <td>${badge(u.role === 'admin' ? 'blue' : u.role === 'drh' ? 'green' : u.role === 'comptable' ? 'gold' : 'violet', ROLE_LABELS[u.role])}</td>
              <td>${u.active ? badge('green', 'Actif') : badge('red', 'Désactivé')}</td>
              <td class="small muted">${(u.created_at || '').slice(0, 10)}</td>
              <td>
                <div class="flex" style="gap:6px">
                  <button class="btn-icon" data-edit="${u.id}" title="Modifier">${icons.edit}</button>
                  ${u.id !== ctx.state.user.id ? `<button class="btn-icon danger" data-toggle="${u.id}" title="Activer / désactiver">${icons.trash}</button>` : ''}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  function openForm(user = null) {
    const isNew = !user;
    const m = modal({
      title: isNew ? 'Nouvel utilisateur' : `Modifier — ${esc(user.email)}`,
      body: `
        <form id="u-form" class="form-grid">
          <div class="field full"><label>Nom complet *</label>
            <input class="input" name="name" required value="${esc(user?.name || '')}" /></div>
          <div class="field full"><label>E-mail *</label>
            <input class="input" name="email" type="email" required value="${esc(user?.email || '')}" /></div>
          <div class="field"><label>Rôle *</label>
            <select class="input" name="role">
              ${Object.entries(ROLE_LABELS).map(([k, v]) =>
                `<option value="${k}" ${user?.role === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div class="field"><label>${isNew ? 'Mot de passe *' : 'Nouveau mot de passe'}</label>
            <input class="input" name="password" type="password" ${isNew ? 'required' : ''} placeholder="••••••••" /></div>
        </form>
        <div class="login-note mt-4">
          <b>Rôles :</b> Administrateur (tout) · DRH (employés, badges, pointages) ·
          Comptable (paie, paiements) · Pointeur (borne, corrections).
        </div>`,
      footer: `<button class="btn outline" data-close>Annuler</button>
               <button class="btn primary" id="u-save">${isNew ? 'Créer' : 'Enregistrer'}</button>`
    });
    m.el.querySelector('#u-save').addEventListener('click', async () => {
      const data = Object.fromEntries(new FormData(m.el.querySelector('#u-form')).entries());
      try {
        if (isNew) await api.post('/users', data);
        else await api.put(`/users/${user.id}`, data);
        m.close();
        toast('success', isNew ? 'Utilisateur créé' : 'Utilisateur mis à jour');
        ctx.refresh();
      } catch (e) { toast('error', 'Erreur', e.message); }
    });
  }

  el.querySelector('#btn-new').addEventListener('click', () => openForm());
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openForm(users.find((u) => u.id == b.dataset.edit))));
  el.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const u = users.find((x) => x.id == b.dataset.toggle);
      confirmDialog(u.active ? 'Désactiver ce compte ?' : 'Réactiver ce compte ?', u.email, async () => {
        await api.put(`/users/${u.id}`, { name: u.name, role: u.role, active: !u.active });
        toast('success', 'Compte mis à jour');
        ctx.refresh();
      });
    }));
}

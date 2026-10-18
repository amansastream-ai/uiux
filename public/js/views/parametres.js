/** Paramètres : société, règles de paie, jours fériés, journal d'audit. */
import { api } from '../api.js';
import { icons, esc, modal, toast, badge, confirmDialog, dateTimeFR, fcfa, num } from '../ui.js';

export async function renderParametres(el, ctx) {
  const [{ settings }, { rules }, { holidays }] = await Promise.all([
    api.get('/settings'),
    api.get('/pay-rules'),
    api.get('/holidays')
  ]);
  let audit = { logs: [] };
  try { audit = await api.get('/audit'); } catch { /* */ }

  el.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Paramètres &amp; règles</h2>
        <div class="sub">Société, barème de majoration, jours fériés et traçabilité</div>
      </div>
    </div>

    <div class="tabs" id="pf-tabs">
      <button class="tab active" data-tab="societe">🏢 Société</button>
      <button class="tab" data-tab="regles">⚖️ Règles de paie</button>
      <button class="tab" data-tab="feries">🎉 Jours fériés</button>
      <button class="tab" data-tab="audit">📜 Journal d’audit</button>
    </div>
    <div id="pf-content"></div>`;

  const content = el.querySelector('#pf-content');

  /* ---------- Société ---------- */
  function tabSociete() {
    content.innerHTML = `
      <div class="card pad" style="max-width:720px">
        <h3 class="mb-4">Informations de l’entreprise</h3>
        <form id="s-form" class="form-grid">
          <div class="field full"><label>Nom de la société</label>
            <input class="input" name="company_name" value="${esc(settings.company_name || '')}" /></div>
          <div class="field full"><label>Adresse</label>
            <input class="input" name="company_address" value="${esc(settings.company_address || '')}" /></div>
          <div class="field"><label>N° RCC</label>
            <input class="input" name="company_rcc" value="${esc(settings.company_rcc || '')}" /></div>
          <div class="field"><label>Devise</label>
            <input class="input" value="FCFA (XOF)" disabled /></div>
          <div class="field"><label>Nom du terminal de pointage</label>
            <input class="input" name="device_name" value="${esc(settings.device_name || '')}" /></div>
          <div class="field"><label>Fuseau horaire</label>
            <input class="input" name="timezone" value="${esc(settings.timezone || 'Africa/Dakar')}" /></div>
          <div class="full"><button class="btn primary" type="submit">${icons.check} Enregistrer</button></div>
        </form>
      </div>`;
    content.querySelector('#s-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      await api.put('/settings', data);
      toast('success', 'Paramètres enregistrés');
    });
  }

  /* ---------- Règles de paie ---------- */
  function tabRegles() {
    const R = (k, fallback) => rules[k] !== undefined ? rules[k] : fallback;
    content.innerHTML = `
      <div class="grid cols-2">
        <div class="card pad">
          <h3 class="mb-4">Barème des majorations &amp; primes</h3>
          <form id="r-form" class="form-grid">
            <div class="field"><label>🌙 Majoration nuit 22h→5h (%)</label>
              <input class="input" name="night_premium_pct" type="number" value="${R('night_premium_pct', 60)}" /></div>
            <div class="field"><label>☀️ Majoration dimanche / férié (%)</label>
              <input class="input" name="rest_day_premium_pct" type="number" value="${R('rest_day_premium_pct', 60)}" /></div>
            <div class="field"><label>🌌 Nuit dimanche / férié 22h→5h (%)</label>
              <input class="input" name="rest_night_premium_pct" type="number" value="${R('rest_night_premium_pct', 100)}" /></div>
            <div class="field"><label>Base hebdomadaire (h)</label>
              <input class="input" name="week_base_hours" type="number" value="${R('week_base_hours', 40)}" /></div>
            <div class="field"><label>⏱️ 1res heures sup./semaine à +15 % (h)</label>
              <input class="input" name="ot_week_first_hours" type="number" value="${R('ot_week_first_hours', 8)}" /></div>
            <div class="field"><label>Taux 1res heures sup. (%)</label>
              <input class="input" name="ot_week_first_pct" type="number" value="${R('ot_week_first_pct', 15)}" /></div>
            <div class="field"><label>📅 Quota mensuel d’h.sup. à +15 % (h)</label>
              <input class="input" name="ot_month_quota_hours" type="number" value="${R('ot_month_quota_hours', 32)}" /></div>
            <div class="field"><label>Taux du reste des h.sup. (%)</label>
              <input class="input" name="ot_rest_pct" type="number" value="${R('ot_rest_pct', 40)}" /></div>
            <div class="field"><label>🧺 Panier si journée ≥ (h)</label>
              <input class="input" name="panier_min_hours" type="number" value="${R('panier_min_hours', 10)}" /></div>
            <div class="field"><label>Montant du panier (FCFA)</label>
              <input class="input" name="panier_amount" type="number" value="${R('panier_amount', 2500)}" /></div>
            <div class="field"><label>🎉 Heures payées par férié non travaillé</label>
              <input class="input" name="holiday_paid_hours" type="number" value="${R('holiday_paid_hours', 8)}" /></div>
            <div class="field"><label>Diviseur horaire mensuel</label>
              <input class="input" name="hourly_divisor" type="number" step="0.01" value="${R('hourly_divisor', 173.33)}" /></div>
            <div class="field"><label>IPRES salarié (%)</label>
              <input class="input" name="ipres_pct" type="number" step="0.1" value="${R('ipres_pct', 5.6)}" /></div>
            <div class="field"><label>CSS salarié (%)</label>
              <input class="input" name="css_pct" type="number" step="0.1" value="${R('css_pct', 5)}" /></div>
            <div class="field"><label>Panier si heures de nuit</label>
              <select class="input" name="panier_night">
                <option value="1" ${R('panier_night', 1) == 1 ? 'selected' : ''}>Oui</option>
                <option value="0" ${R('panier_night', 1) == 0 ? 'selected' : ''}>Non</option>
              </select></div>
            <div class="field"><label>Férié : crédit 8 h seulement si non travaillé</label>
              <select class="input" name="holiday_credit_only_unworked">
                <option value="1" ${R('holiday_credit_only_unworked', 1) == 1 ? 'selected' : ''}>Oui</option>
                <option value="0" ${R('holiday_credit_only_unworked', 1) == 0 ? 'selected' : ''}>Non</option>
              </select></div>
            <div class="full"><button class="btn primary" type="submit">${icons.check} Enregistrer le barème</button></div>
          </form>
        </div>
        <div>
          <div class="card pad mb-6">
            <h3 class="mb-4">🧪 Simulateur de règle</h3>
            <div class="form-grid">
              <div class="field"><label>Salaire mensuel (FCFA)</label>
                <input class="input" id="sim-salary" type="number" value="260000" /></div>
              <div class="field"><label>Heures travaillées</label>
                <input class="input" id="sim-hours" type="number" value="10" /></div>
              <div class="field"><label>Scénario</label>
                <select class="input" id="sim-scenario">
                  <option value="day">Journée normale (jour)</option>
                  <option value="night">Nuit (22h→5h)</option>
                  <option value="sunday">Dimanche / jour férié</option>
                  <option value="sundaynight">Nuit du dimanche / férié</option>
                  <option value="ot">Heures supplémentaires</option>
                </select></div>
              <div class="field"><label>Panier applicable ?</label>
                <input class="input" id="sim-panier" value="calculé auto." disabled /></div>
            </div>
            <div class="divider"></div>
            <div id="sim-out"></div>
          </div>
          <div class="card pad">
            <h3 class="mb-2">📌 Rappel de la convention</h3>
            <ul class="small muted" style="line-height:2;padding-left:18px;margin:0">
              <li>Travail de <b>22h à 5h</b> → majoration <b>60 %</b></li>
              <li>Travail le <b>dimanche</b> ou un <b>jour férié</b> → toutes les heures à <b>+60 %</b></li>
              <li><b>Dimanche/férié de nuit</b> (22h→5h) → majoration <b>100 %</b></li>
              <li>Au-delà de <b>40 h/semaine</b> : les <b>8 premières h.sup.</b> à <b>+15 %</b>, le reste à <b>+40 %</b></li>
              <li><b>32 h.sup./mois</b> maximum à +15 % (4 semaines × 8 h), le reste à <b>+40 %</b></li>
              <li><b>Panier</b> si la journée atteint <b>10 h</b> ou comporte des heures de <b>nuit</b></li>
              <li>Chaque <b>jour férié</b> non travaillé est payé <b>8 h</b></li>
            </ul>
          </div>
        </div>
      </div>`;

    const sim = () => {
      const salary = Number(content.querySelector('#sim-salary').value) || 0;
      const hours = Number(content.querySelector('#sim-hours').value) || 0;
      const sc = content.querySelector('#sim-scenario').value;
      const rate = salary / (Number(R('hourly_divisor', 173.33)));
      const pct = sc === 'night' ? Number(R('night_premium_pct', 60)) :
        sc === 'sunday' ? Number(R('rest_day_premium_pct', 60)) :
        sc === 'sundaynight' ? Number(R('rest_night_premium_pct', 100)) :
        sc === 'ot' ? Number(R('ot_rest_pct', 40)) : 0;
      const amount = Math.round(hours * rate * (1 + pct / 100));
      const premium = Math.round(hours * rate * pct / 100);
      const panier = (hours >= Number(R('panier_min_hours', 10)) || sc === 'night' || sc === 'sundaynight')
        ? Number(R('panier_amount', 2500)) : 0;
      content.querySelector('#sim-panier').value = panier ? `Oui (${fcfa(panier)})` : 'Non';
      content.querySelector('#sim-out').innerHTML = `
        <div class="stat-line"><span class="lbl">Taux horaire</span><span class="val">${fcfa(rate)} / h</span></div>
        <div class="stat-line"><span class="lbl">Majoration appliquée</span><span class="val">+${pct} %</span></div>
        <div class="stat-line"><span class="lbl">Montant des heures</span><span class="val">${fcfa(amount)}</span></div>
        <div class="stat-line"><span class="lbl">dont majoration</span><span class="val" style="color:var(--gold-600)">${fcfa(premium)}</span></div>
        <div class="stat-line"><span class="lbl">Panier</span><span class="val">${panier ? fcfa(panier) : '—'}</span></div>
        <div class="stat-line"><span class="lbl"><b>Total brut simulé</b></span><span class="val" style="font-size:16px">${fcfa(amount + panier)}</span></div>`;
    };
    ['#sim-salary', '#sim-hours', '#sim-scenario'].forEach((s) =>
      content.querySelector(s).addEventListener('input', sim));
    sim();

    content.querySelector('#r-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      await api.put('/pay-rules', data);
      toast('success', 'Barème enregistré', 'Les prochains calculs utiliseront ces valeurs.');
    });
  }

  /* ---------- Jours fériés ---------- */
  function tabFeries() {
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Jours fériés (Sénégal)</h3>
          <div class="right"><button class="btn primary sm" id="hol-add">${icons.plus} Ajouter</button></div>
        </div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Date</th><th>Libellé</th><th></th></tr></thead>
            <tbody>${holidays.map((h) => `
              <tr>
                <td class="b">${esc(h.date)}</td>
                <td>${esc(h.name)}</td>
                <td><button class="btn-icon danger" data-hol="${h.id}">${icons.trash}</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="login-note mt-4" style="max-width:640px">
        🌙 Les dates des fêtes religieuses (Korité, Tabaski, Maouloud, Magal…) dépendent de l’observation lunaire :
        ajustez-les chaque année. Chaque férié non travaillé est payé <b>8 h</b> automatiquement dans la paie.
      </div>`;

    content.querySelector('#hol-add').addEventListener('click', () => {
      const m = modal({
        title: 'Ajouter un jour férié',
        body: `<form id="h-form" class="form-grid">
          <div class="field"><label>Date</label><input class="input" type="date" name="date" required /></div>
          <div class="field"><label>Libellé</label><input class="input" name="name" required placeholder="Ex. : Tabaski" /></div>
        </form>`,
        footer: `<button class="btn outline" data-close>Annuler</button><button class="btn primary" id="h-save">Ajouter</button>`
      });
      m.el.querySelector('#h-save').addEventListener('click', async () => {
        const data = Object.fromEntries(new FormData(m.el.querySelector('#h-form')).entries());
        await api.post('/holidays', data);
        m.close();
        toast('success', 'Jour férié ajouté');
        ctx.refresh();
      });
    });
    content.querySelectorAll('[data-hol]').forEach((b) => b.addEventListener('click', async () => {
      confirmDialog('Supprimer ce jour férié ?', 'Il ne sera plus payé automatiquement.', async () => {
        await api.del(`/holidays/${b.dataset.hol}`);
        toast('success', 'Supprimé');
        ctx.refresh();
      });
    }));
  }

  /* ---------- Audit ---------- */
  function tabAudit() {
    content.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Journal d’audit</h3>
          <div class="right"><span class="badge gray">${audit.logs.length} entrée(s)</span></div>
        </div>
        <div class="table-wrap" style="max-height:520px;overflow-y:auto">
          <table class="tbl">
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détails</th></tr></thead>
            <tbody>${audit.logs.map((l) => `
              <tr>
                <td class="small nowrap">${dateTimeFR(l.created_at)}</td>
                <td class="small">${esc(l.user_name || '—')}</td>
                <td>${badge('blue', esc(l.action))}</td>
                <td class="small muted">${esc(l.details || '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  const tabs = { societe: tabSociete, regles: tabRegles, feries: tabFeries, audit: tabAudit };
  el.querySelectorAll('#pf-tabs .tab').forEach((t) => t.addEventListener('click', () => {
    el.querySelectorAll('#pf-tabs .tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    tabs[t.dataset.tab]();
  }));
  tabSociete();
}

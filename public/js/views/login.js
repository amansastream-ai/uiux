/** Vue connexion et création de compte. */
import { api } from '../api.js';
import { icons, toast, esc } from '../ui.js';

const DEMO_ACCOUNTS = [
  { email: 'admin@sahelservices.sn', label: '👑 Administrateur' },
  { email: 'drh@sahelservices.sn', label: '🧑‍💼 DRH' },
  { email: 'compta@sahelservices.sn', label: '💰 Comptable' },
  { email: 'pointage@sahelservices.sn', label: '⏱️ Pointeur' }
];

const ROLE_LABELS = {
  admin: 'Administrateur',
  drh: 'DRH',
  comptable: 'Comptable',
  pointage: 'Pointeur'
};

export function renderLogin(el, onLogin, { initialTab = 'login' } = {}) {
  el.innerHTML = `
  <div class="login-page">
    <div class="login-hero">
      <div class="inner">
        <div class="flex" style="gap:14px">
          <div class="brand-mark" style="width:52px;height:52px;font-size:24px;border-radius:14px">C</div>
          <div>
            <div class="brand-name" style="font-size:24px">Chrono<span>RH</span></div>
            <div class="brand-sub">La SaaS RH pensée pour l’Afrique</div>
          </div>
        </div>
        <h1>Le pointage <em>biométrique</em> &amp; la paie <em>en FCFA</em>, enfin réunis.</h1>
        <p class="lede">Badges QR, empreintes digitales, borne pour tablette, calcul automatique
        des heures supplémentaires, majorations nuit / dimanche / férié et bulletins de paie prêts à payer.</p>
        <div class="hero-features">
          <div class="hero-feature">
            <div class="hf-ico">${icons.fingerprint}</div>
            <div><b>Empreinte digitale &amp; QR</b><span>Double mode d’identification sur tablette, anti-fraude</span></div>
          </div>
          <div class="hero-feature">
            <div class="hf-ico">${icons.money}</div>
            <div><b>Moteur de paie conforme</b><span>H.sup. +15 % / +40 % · Nuit +60 % · Dimanche/férié +60 % · Nuit fériée +100 %, calculés directement sur le salaire de base mensuel (base 40 h/semaine)</span></div>
          </div>
          <div class="hero-feature">
            <div class="hf-ico">${icons.shield}</div>
            <div><b>4 rôles, 4 métiers</b><span>Administrateur · DRH · Comptable · Pointeur</span></div>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>×2</b><span>Nuit fériée majorée</span></div>
          <div class="hero-stat"><b>8 h</b><span>Payées par jour férié</span></div>
          <div class="hero-stat"><b>40 h</b><span>Base hebdomadaire</span></div>
          <div class="hero-stat"><b>100 %</b><span>Calculé en FCFA</span></div>
        </div>
      </div>
    </div>
    <div class="login-form-side">
      <div class="login-card">
        <h2>Bienvenue 👋</h2>
        <p class="sub">Connectez-vous à votre espace ChronoRH ou créez votre compte entreprise.</p>
        <div class="tabs login-tabs" id="auth-tabs" role="tablist" aria-label="Accès au compte">
          <button class="tab" type="button" data-auth-tab="login" role="tab">Se connecter</button>
          <button class="tab" type="button" data-auth-tab="register" role="tab">Créer un compte</button>
        </div>
        <div id="auth-panel"></div>
      </div>
    </div>
  </div>`;

  const panel = el.querySelector('#auth-panel');

  async function submitAuth(form, endpoint, button) {
    const originalMarkup = button.innerHTML;
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = endpoint === '/auth/register'
      ? {
          name: String(values.name || '').trim(),
          email: String(values.email || '').trim(),
          password: values.password,
          role: values.role,
          company_name: String(values.company_name || '').trim() || undefined
        }
      : { email: String(values.email || '').trim(), password: values.password };

    button.disabled = true;
    button.textContent = endpoint === '/auth/register' ? 'Création…' : 'Connexion…';
    try {
      const res = await api.post(endpoint, payload);
      const firstName = String(res.user.name || '').trim().split(/\s+/)[0];
      toast('success', endpoint === '/auth/register' ? 'Compte créé' : 'Connexion réussie', `Bienvenue ${firstName} · ${ROLE_LABELS[res.user.role] || res.user.role}`);
      await onLogin(res.user);
    } catch (err) {
      toast('error', endpoint === '/auth/register' ? 'Création impossible' : 'Connexion impossible', err.message);
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = originalMarkup;
      }
    }
  }

  function showTab(tab) {
    const activeTab = tab === 'register' ? 'register' : 'login';
    el.querySelectorAll('[data-auth-tab]').forEach((button) => {
      const active = button.dataset.authTab === activeTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });

    if (activeTab === 'login') {
      panel.innerHTML = `
        <form id="login-form" class="grid" style="gap:16px">
          <div class="field">
            <label for="lg-email">Adresse e-mail</label>
            <input class="input" type="email" id="lg-email" name="email" placeholder="vous@societe.sn" required autocomplete="username" />
          </div>
          <div class="field">
            <label for="lg-pass">Mot de passe</label>
            <input class="input" type="password" id="lg-pass" name="password" placeholder="••••••••" required autocomplete="current-password" />
          </div>
          <button class="btn primary lg block" type="submit" id="lg-btn">Se connecter ${icons.arrowRight}</button>
        </form>
        <div class="mt-6">
          <div class="tiny muted mb-2">Comptes de démonstration — cliquez pour remplir :</div>
          <div class="demo-chips">
            ${DEMO_ACCOUNTS.map((account) => `<button class="demo-chip" type="button" data-demo="${esc(account.email)}">${account.label}</button>`).join('')}
          </div>
        </div>
        <div class="login-note">
          <b>Mot de passe commun :</b> <code>demo2026</code><br/>
          Données de démonstration incluses : 12 employés, pointages de septembre &amp; octobre 2026 et bordereau de paie prêt à valider.
        </div>`;

      panel.querySelector('#login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        submitAuth(event.currentTarget, '/auth/login', panel.querySelector('#lg-btn'));
      });
      panel.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => {
        panel.querySelector('#lg-email').value = button.dataset.demo;
        panel.querySelector('#lg-pass').value = 'demo2026';
      }));
      return;
    }

    panel.innerHTML = `
      <form id="register-form" class="grid" style="gap:14px">
        <div class="field">
          <label for="reg-name">Nom complet</label>
          <input class="input" type="text" id="reg-name" name="name" placeholder="Awa Diallo" required minlength="2" maxlength="100" autocomplete="name" />
        </div>
        <div class="field">
          <label for="reg-email">Adresse e-mail</label>
          <input class="input" type="email" id="reg-email" name="email" placeholder="vous@societe.sn" required maxlength="254" autocomplete="email" />
        </div>
        <div class="field">
          <label for="reg-company">Nom de l’entreprise <span class="muted">(facultatif)</span></label>
          <input class="input" type="text" id="reg-company" name="company_name" placeholder="Votre société" maxlength="120" autocomplete="organization" />
        </div>
        <div class="field">
          <label for="reg-role">Votre rôle</label>
          <select class="input" id="reg-role" name="role" required>
            <option value="" selected disabled>— Choisir un rôle —</option>
            <option value="admin">👑 Administrateur</option>
            <option value="drh">🧑‍💼 DRH</option>
            <option value="comptable">💰 Comptable</option>
            <option value="pointage">⏱️ Pointeur</option>
          </select>
        </div>
        <div class="field">
          <label for="reg-pass">Mot de passe <span class="muted">(8 caractères minimum)</span></label>
          <input class="input" type="password" id="reg-pass" name="password" placeholder="••••••••" required minlength="8" maxlength="128" autocomplete="new-password" />
        </div>
        <button class="btn primary lg block" type="submit" id="reg-btn">Créer mon compte ${icons.arrowRight}</button>
      </form>
      <div class="login-note">Votre compte est ouvert immédiatement. Les comptes et les 12 employés de démonstration restent disponibles.</div>`;

    panel.querySelector('#register-form').addEventListener('submit', (event) => {
      event.preventDefault();
      submitAuth(event.currentTarget, '/auth/register', panel.querySelector('#reg-btn'));
    });
  }

  el.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.authTab)));
  showTab(initialTab);
}

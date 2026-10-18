/** Vue connexion. */
import { api } from '../api.js';
import { icons, toast, esc } from '../ui.js';

export function renderLogin(el, onLogin) {
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
            <div><b>Moteur de paie conforme</b><span>Nuit +60 % · Dimanche/férié +60 % · Nuit férié +100 % · H.sup. +15/+40 %</span></div>
          </div>
          <div class="hero-feature">
            <div class="hf-ico">${icons.shield}</div>
            <div><b>4 rôles, 4 métiers</b><span>Administrateur · DRH · Comptable · Gestionnaire de pointage</span></div>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hero-stat"><b>×2</b><span>Nuit fériée majorée</span></div>
          <div class="hero-stat"><b>8 h</b><span>Payées par jour férié</span></div>
          <div class="hero-stat"><b>173,33 h</b><span>Base horaire mensuelle</span></div>
          <div class="hero-stat"><b>100 %</b><span>Calculé en FCFA</span></div>
        </div>
      </div>
    </div>
    <div class="login-form-side">
      <div class="login-card">
        <h2>Bienvenue 👋</h2>
        <p class="sub">Connectez-vous à votre espace ChronoRH</p>
        <form id="login-form" class="grid" style="gap:16px">
          <div class="field">
            <label>Adresse e-mail</label>
            <input class="input" type="email" id="lg-email" placeholder="vous@societe.sn" required autocomplete="username" />
          </div>
          <div class="field">
            <label>Mot de passe</label>
            <input class="input" type="password" id="lg-pass" placeholder="••••••••" required autocomplete="current-password" />
          </div>
          <button class="btn primary lg block" type="submit" id="lg-btn">Se connecter ${icons.arrowRight}</button>
        </form>
        <div class="mt-6">
          <div class="tiny muted mb-2">Comptes de démonstration — cliquez pour remplir :</div>
          <div class="demo-chips">
            <button class="demo-chip" data-demo="admin@sahelservices.sn">👑 Administrateur</button>
            <button class="demo-chip" data-demo="drh@sahelservices.sn">🧑‍💼 DRH</button>
            <button class="demo-chip" data-demo="compta@sahelservices.sn">💰 Comptable</button>
            <button class="demo-chip" data-demo="pointage@sahelservices.sn">⏱️ Gestion pointage</button>
          </div>
        </div>
        <div class="login-note">
          <b>Mot de passe commun :</b> <code>demo2026</code><br/>
          Données de démonstration incluses : 12 employés, pointages de septembre &amp; octobre 2026, bordereau de paie prêt à valider.
        </div>
      </div>
    </div>
  </div>`;

  el.querySelectorAll('.demo-chip').forEach((c) => c.addEventListener('click', () => {
    el.querySelector('#lg-email').value = c.dataset.demo;
    el.querySelector('#lg-pass').value = 'demo2026';
  }));

  el.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('#lg-btn');
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    try {
      const res = await api.post('/auth/login', {
        email: el.querySelector('#lg-email').value,
        password: el.querySelector('#lg-pass').value
      });
      toast('success', `Bienvenue ${res.user.name.split(' ')[0]} !`, `Rôle : ${res.user.role}`);
      onLogin(res.user);
    } catch (err) {
      toast('error', 'Connexion impossible', err.message);
      btn.disabled = false;
      btn.innerHTML = 'Se connecter';
    }
  });
}

/**
 * SunuÉcole — Page de connexion.
 *
 * Objectif d'adoption : une école doit pouvoir tester en moins de 10 secondes.
 * D'où les comptes de démonstration en un clic, pré-remplis par rôle.
 */
import { api, setToken, setRefreshToken, isOnline } from '../core/api.js';
import { icon } from '../core/icons.js';
import { h, esc, toastErr, toastOk, modal } from '../ui/components.js';
import { ROLES } from '../core/format.js';

const ROLE_ICONS = {
  direction: 'school',
  secretaire: 'contact-card',
  comptable: 'wallet',
  enseignant: 'pen-tool',
  parent: 'users',
  eleve: 'graduation-cap',
  super_admin: 'shield-check',
};

export function loginView({ onLoggedIn, notice = null }) {
  let demo = null;
  let busy = false;

  const root = h(`<div class="auth-page">
    <!-- Colonne de présentation : argumentaire commercial et preuves -->
    <div class="auth-hero">
      <div class="auth-hero-top">
        <span class="brand-mark">${icon('graduation-cap', { size: 26, strokeWidth: 1.9 })}</span>
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.02em">SunuÉcole</span>
      </div>
      <div class="auth-hero-body">
        <h1>La gestion de votre école,<br><span>simplifiée.</span></h1>
        <p class="auth-hero-sub">Scolarité, présences, notes, bulletins, facturation et
          paiements Mobile Money — réunis dans une seule plateforme conçue pour l'Afrique
          francophone, qui fonctionne même sans connexion internet.</p>
        <ul class="auth-features">
          <li>${icon('check-circle', { size: 17 })}<span><b>Mobile Money intégré</b> — Orange Money, Wave, MTN, Moov, Free Money</span></li>
          <li>${icon('check-circle', { size: 17 })}<span><b>100 % hors-ligne</b> — l'appel et les notes se synchronisent tout seuls</span></li>
          <li>${icon('check-circle', { size: 17 })}<span><b>Bulletins en un clic</b> — impression A4 prête pour les conseils de classe</span></li>
          <li>${icon('check-circle', { size: 17 })}<span><b>SMS aux parents</b> — absences, notes et relances de paiement automatiques</span></li>
          <li>${icon('check-circle', { size: 17 })}<span><b>Espaces parents et élèves</b> — accessibles sur n'importe quel téléphone</span></li>
        </ul>
      </div>
      <div class="auth-hero-foot">
        <div class="auth-stat"><b class="num">1 061</b><span>élèves en démo</span></div>
        <div class="auth-stat"><b class="num">3</b><span>établissements</span></div>
        <div class="auth-stat"><b class="num">5 220</b><span>factures</span></div>
        <div class="auth-stat"><b class="num">15 j</b><span>d'essai gratuit</span></div>
      </div>
    </div>

    <!-- Colonne du formulaire -->
    <div class="auth-form-col">
      <div class="auth-form-wrap">
        <div class="auth-form-top">
          <span class="brand-mark" style="background:var(--brand-600)">${icon('graduation-cap', { size: 18 })}</span>
          <span style="font-weight:700;font-size:16px;color:var(--text)">SunuÉcole</span>
        </div>

        <h2 style="font-size:23px;letter-spacing:-.02em;margin-bottom:5px">Connexion</h2>
        <p class="subtle" style="font-size:13.5px;margin-bottom:22px">Accédez à votre espace de gestion scolaire.</p>

        ${notice ? `<div class="alert alert-warn mb-4" role="status">
          ${icon('alert-circle', { size: 16 })}
          <div class="alert-body">
            <div class="alert-title">${esc(notice.title || 'Session expirée')}</div>
            <div class="alert-msg">${esc(notice.message || 'Merci de vous reconnecter.')}</div>
          </div></div>` : ''}

        <div id="offline-note" hidden></div>

        <form id="login-form" novalidate>
          <div class="field">
            <label for="lf-email">Adresse électronique</label>
            <input class="input" id="lf-email" name="email" type="email" autocomplete="username" required
              placeholder="prenom.nom@ecole.sn" autofocus>
            <div class="error-msg" data-error-for="email" hidden></div>
          </div>
          <div class="field">
            <label for="lf-pass">Mot de passe</label>
            <div class="input-group">
              <input class="input" id="lf-pass" name="password" type="password" autocomplete="current-password" required placeholder="••••••••">
              <button type="button" class="input-action" id="toggle-pass" aria-label="Afficher le mot de passe">${icon('eye', { size: 16 })}</button>
            </div>
            <div class="error-msg" data-error-for="password" hidden></div>
          </div>
          <div class="row-between mb-4" style="font-size:13px">
            <label class="check"><input type="checkbox" id="lf-remember" checked><span class="check-box">${icon('check', { size: 11 })}</span><span>Rester connecté</span></label>
            <button type="button" class="btn btn-link btn-sm" id="btn-forgot">Mot de passe oublié ?</button>
          </div>
          <button class="btn btn-primary btn-block" id="btn-login" type="submit">
            ${icon('log-in', { size: 16 })} Se connecter
          </button>
        </form>

        <div class="auth-alt">
          <span>Comptes de démonstration</span>
        </div>
        <div id="demo-slot">${demoSkeleton()}</div>

        <p class="tiny subtle center mt-4" style="line-height:1.6">
          Pas encore d'établissement sur SunuÉcole ?
          <button class="btn btn-link btn-sm" id="btn-signup">Créer mon école gratuitement</button>
        </p>
      </div>
      <div class="auth-form-foot tiny subtle">
        <span>${icon('lock', { size: 12 })} Connexion chiffrée</span>
        <span>${icon('cloud-off', { size: 12 })} Fonctionne hors-ligne</span>
        <button type="button" class="btn btn-link btn-sm" id="btn-reset-app" title="Vide le cache local et recharge l'application">
          ${icon('refresh', { size: 12 })} Réinitialiser l'application</button>
        <span>© ${new Date().getFullYear()} SunuÉcole</span>
      </div>
    </div>
  </div>`);

  /* ---------------- Interactions ---------------- */
  root.querySelector('#btn-reset-app')?.addEventListener('click', async () => {
    if (typeof window.sunuecoleReset === 'function') {
      await window.sunuecoleReset();
    } else {
      try { localStorage.clear(); } catch { /* stockage indisponible */ }
      location.reload();
    }
  });

  const emailInput = root.querySelector('#lf-email');
  const passInput = root.querySelector('#lf-pass');

  root.querySelector('#toggle-pass').addEventListener('click', () => {
    const btn = root.querySelector('#toggle-pass');
    const shown = passInput.type === 'text';
    passInput.type = shown ? 'password' : 'text';
    btn.innerHTML = icon(shown ? 'eye' : 'eye-off', { size: 16 });
    btn.setAttribute('aria-label', shown ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  });

  if (!isOnline()) {
    const note = root.querySelector('#offline-note');
    note.hidden = false;
    note.innerHTML = `<div class="alert alert-warn mb-4">${icon('wifi-off', { size: 17 })}
      <div class="alert-body"><div class="alert-title">Connexion internet indisponible</div>
      <div class="alert-msg">Si vous êtes déjà connecté sur cet appareil, vous pourrez continuer à faire l'appel et saisir des notes : tout sera synchronisé au retour du réseau.</div></div></div>`;
  }

  async function submit(form) {
    if (busy) return;
    busy = true;
    const btn = root.querySelector('#btn-login');
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width:15px;height:15px"></span> Connexion…`;
    clearErrors();
    try {
      const res = await api.post('/auth/login', {
        email: emailInput.value.trim(),
        password: passInput.value,
        remember: root.querySelector('#lf-remember').checked,
      });
      setToken(res.token);
      setRefreshToken(res.refreshToken);
      toastOk(`Bienvenue, ${res.user.firstName}`, `${res.user.roleLabel || ROLES[res.user.role]} · ${res.user.school?.name || ''}`);
      onLoggedIn();
    } catch (err) {
      if (err.fields) {
        Object.entries(err.fields).forEach(([k, v]) => setError(k, v));
      }
      toastErr('Connexion refusée', err.message);
      btn.disabled = false;
      btn.innerHTML = original;
      busy = false;
      passInput.select();
    }
  }
  function setError(name, msg) {
    const el = root.querySelector(`[data-error-for="${name}"]`);
    if (el) { el.innerHTML = `${icon('alert-circle', { size: 12 })}${esc(msg)}`; el.hidden = false; }
  }
  function clearErrors() {
    root.querySelectorAll('[data-error-for]').forEach((el) => { el.innerHTML = ''; el.hidden = true; });
  }
  root.querySelector('#login-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  root.querySelector('#btn-forgot').addEventListener('click', () => {
    const m = modal({
      title: 'Mot de passe oublié',
      icon: 'key',
      size: 'modal-narrow',
      body: `<p class="subtle small mb-3">Saisissez l'adresse électronique de votre compte. Un code de réinitialisation vous sera envoyé.</p>
        <form id="forgot-form"><div class="field"><label for="fp-email">Adresse électronique</label>
        <input class="input" id="fp-email" type="email" required placeholder="prenom.nom@ecole.sn" value="${esc(emailInput.value)}"></div></form>`,
      footer: `<button class="btn btn-secondary" data-dismiss>Annuler</button>
               <button class="btn btn-primary" id="fp-send">${icon('send', { size: 15 })} Envoyer le code</button>`,
      onMount: (el, close) => {
        el.querySelector('#fp-send').addEventListener('click', async () => {
          const email = el.querySelector('#fp-email').value.trim();
          if (!email) return;
          el.querySelector('#fp-send').disabled = true;
          try {
            const r = await api.post('/auth/forgot-password', { email });
            close();
            modal({
              title: 'Code de réinitialisation',
              icon: 'key', size: 'modal-narrow',
              body: `<div class="alert alert-ok mb-3">${icon('check-circle', { size: 17 })}<div class="alert-body">
                  <div class="alert-title">Vérifiez vos messages</div>
                  <div class="alert-msg">${esc(r.message || 'Un code a été envoyé.')}</div></div></div>
                ${r.code ? `<div class="alert alert-brand">${icon('info', { size: 17 })}<div class="alert-body">
                  <div class="alert-title">Mode démonstration</div>
                  <div class="alert-msg">Votre code est <b class="num" style="font-size:16px;letter-spacing:.08em">${esc(r.code)}</b></div></div></div>` : ''}
                <form id="reset-form">
                  <div class="field"><label for="rs-code">Code reçu</label><input class="input" id="rs-code" required placeholder="6 chiffres" inputmode="numeric"></div>
                  <div class="field"><label for="rs-pass">Nouveau mot de passe</label><input class="input" id="rs-pass" type="password" required minlength="8" placeholder="8 caractères minimum"></div>
                </form>`,
              footer: `<button class="btn btn-primary" id="rs-submit">Réinitialiser</button>`,
              onMount: (el2, close2) => {
                el2.querySelector('#rs-submit').addEventListener('click', async () => {
                  try {
                    await api.post('/auth/reset-password', { email, code: el2.querySelector('#rs-code').value.trim(), password: el2.querySelector('#rs-pass').value });
                    close2();
                    passInput.value = el2.querySelector('#rs-pass').value;
                    toastOk('Mot de passe modifié', 'Vous pouvez vous connecter avec votre nouveau mot de passe.');
                  } catch (e) { toastErr('Réinitialisation impossible', e.message); }
                });
              },
            });
          } catch (e) { toastErr('Envoi impossible', e.message); el.querySelector('#fp-send').disabled = false; }
        });
      },
    });
    setTimeout(() => m.el.querySelector('#fp-email')?.focus(), 120);
  });

  root.querySelector('#btn-signup').addEventListener('click', () => {
    modal({
      title: 'Créer votre école sur SunuÉcole',
      subtitle: '15 jours d\'essai gratuit, sans carte bancaire.',
      icon: 'rocket',
      body: `<form id="signup-form">
        <div class="fieldset"><legend>${icon('school', { size: 14 })} L'établissement</legend>
          <div class="grid-2">
            <div class="field"><label for="su-name">Nom de l'école</label><input class="input" id="su-name" name="schoolName" required placeholder="Ex. Collège Les Baobabs"></div>
            <div class="field"><label for="su-type">Type</label>
              <select class="select" id="su-type" name="schoolType">
                <option value="ecole">École primaire</option><option value="college" selected>Collège</option>
                <option value="lycee">Lycée</option><option value="prive">École privée (primaire + secondaire)</option>
                <option value="institut">Institut / Formation</option></select></div>
            <div class="field"><label for="su-city">Ville</label><input class="input" id="su-city" name="city" required placeholder="Dakar"></div>
            <div class="field"><label for="su-country">Pays</label>
              <select class="select" id="su-country" name="country">
                <option value="SN" selected>Sénégal</option><option value="CI">Côte d'Ivoire</option>
                <option value="ML">Mali</option><option value="BF">Burkina Faso</option>
                <option value="GN">Guinée</option><option value="BJ">Bénin</option>
                <option value="TG">Togo</option><option value="NE">Niger</option><option value="CM">Cameroun</option>
              </select></div>
          </div>
        </div>
        <div class="fieldset"><legend>${icon('user', { size: 14 })} Votre compte direction</legend>
          <div class="grid-2">
            <div class="field"><label for="su-first">Prénom</label><input class="input" id="su-first" name="firstName" required></div>
            <div class="field"><label for="su-last">Nom</label><input class="input" id="su-last" name="lastName" required></div>
          </div>
          <div class="grid-2">
            <div class="field"><label for="su-email">Adresse électronique</label><input class="input" id="su-email" name="email" type="email" required placeholder="direction@ecole.sn"></div>
            <div class="field"><label for="su-phone">Téléphone</label><input class="input" id="su-phone" name="phone" placeholder="+221 77 000 00 00"></div>
          </div>
          <div class="grid-2">
            <div class="field"><label for="su-pass">Mot de passe</label><input class="input" id="su-pass" name="password" type="password" required minlength="8" placeholder="8 caractères minimum"></div>
            <div class="field"><label for="su-size">Nombre d'élèves</label>
              <select class="select" id="su-size" name="studentCount">
                <option value="50">Moins de 150</option><option value="300" selected>150 à 600</option>
                <option value="900">Plus de 600</option></select></div>
          </div>
        </div>
        <div class="alert alert-brand">${icon('sparkles', { size: 17 })}<div class="alert-body">
          <div class="alert-title">Ce qui est inclus dans l'essai</div>
          <div class="alert-msg">Tous les modules (scolarité, pédagogie, finances, vie scolaire, services),
          le plan <b>Pro</b>, 1 000 SMS et l'import de vos élèves depuis Excel. Un conseiller vous accompagne
          pour la mise en route.</div></div></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-dismiss>Plus tard</button>
               <button class="btn btn-primary" id="su-submit">${icon('rocket', { size: 15 })} Créer mon école</button>`,
      onMount: (el, close) => {
        el.querySelector('#su-submit').addEventListener('click', async () => {
          const f = el.querySelector('#signup-form');
          if (!f.reportValidity()) return;
          const data = Object.fromEntries(new FormData(f).entries());
          const btn = el.querySelector('#su-submit');
          btn.disabled = true;
          try {
            const r = await api.post('/auth/register', data);
            close();
            if (r.token) {
              setToken(r.token);
      setRefreshToken(r.refreshToken);
              onLoggedIn();
            } else {
              modal({
                title: 'Demande enregistrée', icon: 'check-circle', size: 'modal-narrow',
                body: `<div class="alert alert-ok">${icon('check-circle', { size: 17 })}<div class="alert-body">
                  <div class="alert-title">Votre école va être activée</div>
                  <div class="alert-msg">${esc(r.message || 'Un conseiller SunuÉcole vous contacte sous 24 h pour finaliser la création et importer vos élèves.')}</div></div></div>`,
                footer: '<button class="btn btn-primary" data-dismiss>Parfait</button>',
              });
            }
          } catch (e) { toastErr('Création impossible', e.message); btn.disabled = false; }
        });
      },
    });
  });

  /* ---------------- Comptes de démonstration ---------------- */
  async function loadDemo() {
    const slot = root.querySelector('#demo-slot');
    try {
      demo = await api.get('/auth/demo-accounts', { cacheTtl: 300000 });
      slot.innerHTML = renderDemo(demo);
      wireDemo();
    } catch {
      slot.innerHTML = `<p class="tiny subtle center">Les comptes de démonstration sont indisponibles pour le moment.</p>`;
    }
  }
  function renderDemo(d) {
    return `<div class="demo-accounts">
      ${d.accounts.map((a) => `<button type="button" class="demo-card" data-email="${esc(a.email)}" data-slug="${esc(a.slug)}" title="Connexion en un clic : ${esc(a.name)}">
        <span class="demo-ico" data-tone="${esc(a.slug)}">${icon(ROLE_ICONS[a.slug] || 'user', { size: 16 })}</span>
        <span class="demo-txt"><b>${esc(a.roleLabel)}</b><small>${esc(a.name)}</small></span>
      </button>`).join('')}
    </div>
    <p class="tiny subtle center mt-3">Mot de passe commun : <b class="num">Sunu2026!</b> — données fictives, réinitialisables à tout moment.</p>`;
  }
  function wireDemo() {
    root.querySelectorAll('.demo-card').forEach((card) => {
      card.addEventListener('click', async () => {
        if (busy) return;
        const account = demo.accounts.find((a) => a.email === card.dataset.email);
        root.querySelectorAll('.demo-card').forEach((c) => c.classList.remove('is-active'));
        card.classList.add('is-active');
        busy = true;
        const btn = root.querySelector('#btn-login');
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner" style="width:15px;height:15px"></span> Connexion « ${esc(account.roleLabel)} »…`;
        try {
          const res = await api.post('/auth/login', { email: account.email, password: demo.password });
          setToken(res.token);
      setRefreshToken(res.refreshToken);
          toastOk(`Bienvenue, ${res.user.firstName}`, `Démo ${res.user.roleLabel} · ${res.user.school?.name || 'Plateforme'}`);
          setTimeout(onLoggedIn, 260);
        } catch (err) {
          toastErr('Connexion de démonstration impossible', err.message);
          btn.disabled = false;
          btn.innerHTML = `${icon('log-in', { size: 16 })} Se connecter`;
          busy = false;
        }
      });
    });
  }
  function demoSkeleton() {
    return `<div class="demo-accounts">${Array.from({ length: 6 }, () => '<div class="skeleton" style="height:44px;border-radius:var(--r-sm)"></div>').join('')}</div>`;
  }
  loadDemo();

  return root;
}

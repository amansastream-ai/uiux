/** Borne de pointage (mode tablette / kiosque) — QR + empreinte digitale. */
import { api } from '../api.js';
import { esc, icons, timeFR } from '../ui.js';

export async function renderBorne(el, ctx) {
  el.innerHTML = `
  <div class="kiosk">
    <div class="kiosk-top">
      <div class="brand-mark">C</div>
      <div>
        <div class="brand-name">Chrono<span>RH</span></div>
        <div class="brand-sub">${esc(ctx.state.settings.company_name || 'Borne de pointage')} · ${esc(ctx.state.settings.device_name || 'Tablette-01')}</div>
      </div>
      <div class="kiosk-clock">
        <div class="k-time" id="k-time">--:--:--</div>
        <div class="k-date" id="k-date"></div>
      </div>
      <div class="kiosk-top-actions">
        <button class="btn outline" id="k-account" type="button">Autre compte</button>
        <button class="btn outline" id="k-exit" type="button">Quitter la borne</button>
        <button class="btn danger" id="k-logout" type="button">${icons.logout} Sortir</button>
      </div>
    </div>
    <div class="kiosk-main">
      <div class="scan-zone">
        <div class="kiosk-feedback" id="k-fb">
          <div class="big" id="k-fb-title"></div>
          <div class="who" id="k-fb-who"></div>
          <div id="k-fb-time" style="color:#9FB0C6;margin-top:6px"></div>
        </div>
        <div class="scan-frame" id="k-frame">
          <div class="corner c1"></div><div class="corner c2"></div>
          <div class="corner c3"></div><div class="corner c4"></div>
          <div class="laser"></div>
          <video id="k-video" autoplay playsinline style="display:none"></video>
        </div>
        <h2 style="font-size:22px;font-weight:800">Présentez votre badge QR</h2>
        <p style="color:#9FB0C6;margin:10px 0 22px;max-width:420px">
          Scannez le QR de votre badge dans le cadre, saisissez le code ci-dessous,
          ou posez votre doigt sur le capteur d’empreinte.
        </p>
        <div class="kiosk-input-row" style="width:100%;max-width:440px">
          <input class="input" id="k-code" placeholder="Code badge (ex. QR-A1B2C3…)" autocomplete="off" />
          <button class="btn primary" id="k-send">Valider</button>
          <button class="btn accent" id="k-cam">${icons.qr} Caméra</button>
        </div>
        <div class="tiny" style="color:#7A8AA0;margin-top:12px">
          Lecteurs USB de codes-barres : cliquez dans le champ puis scannez.
        </div>
      </div>
      <div class="kiosk-panel">
        <h3>${icons.fingerprint} Empreinte digitale</h3>
        <div class="fp-pad" id="k-fp" title="Posez le doigt">
          ${icons.fingerprint}
        </div>
        <div class="tiny" style="color:#9FB0C6;text-align:center">
          Mode démonstration — choisissez l’empreinte à simuler :
          <select class="input" id="k-fp-select" style="margin-top:8px;background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:#fff">
            <option value="">— sélectionner —</option>
          </select>
        </div>
        <div class="divider" style="background:rgba(255,255,255,.1)"></div>
        <h3>${icons.clock} Derniers pointages</h3>
        <div class="punch-log" id="k-log"></div>
      </div>
    </div>
  </div>`;

  // Horloge
  const tEl = el.querySelector('#k-time');
  const dEl = el.querySelector('#k-date');
  const tickClock = () => {
    const now = new Date();
    tEl.textContent = now.toLocaleTimeString('fr-FR');
    dEl.textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };
  tickClock();
  const clockTimer = setInterval(tickClock, 1000);
  let cameraStream = null;
  const cleanup = () => {
    clearInterval(clockTimer);
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    const video = el.querySelector('#k-video');
    if (video) {
      video.srcObject = null;
      video.style.display = 'none';
    }
  };

  // Remplir le select d'empreintes + journal
  const { employees } = await api.get('/employees');
  const sel = el.querySelector('#k-fp-select');
  employees.filter((e) => e.status === 'actif' && e.fingerprint_id).forEach((e) => {
    const o = document.createElement('option');
    o.value = e.fingerprint_id;
    o.textContent = `${e.matricule} — ${e.first_name} ${e.last_name}`;
    sel.appendChild(o);
  });

  async function refreshLog() {
    try {
      const d = await api.get('/attendance');
      el.querySelector('#k-log').innerHTML = d.attendance.slice(0, 10).map((a) => `
        <div class="punch-item">
          <div class="avatar sm" style="background:${a.type === 'in' ? '#0E9F6E' : '#D64545'}">${a.type === 'in' ? 'IN' : 'OUT'}</div>
          <div><b>${esc(a.first_name)} ${esc(a.last_name)}</b>
            <div class="tiny" style="color:#9FB0C6">${esc(a.matricule)} · ${a.method === 'qr' ? 'QR' : a.method === 'fingerprint' ? 'Empreinte' : 'Manuel'}</div></div>
          <div class="p-time">${timeFR(a.ts)}</div>
        </div>`).join('') || '<div class="tiny" style="color:#7A8AA0">Aucun pointage aujourd’hui</div>';
    } catch { /* borne hors session éventuellement */ }
  }
  refreshLog();

  function feedback(ok, title, who, ts) {
    const fb = el.querySelector('#k-fb');
    fb.className = 'kiosk-feedback show ' + (ok ? 'ok' : 'bad');
    el.querySelector('#k-fb-title').textContent = title;
    el.querySelector('#k-fb-who').textContent = who;
    el.querySelector('#k-fb-time').textContent = ts ? new Date(ts).toLocaleString('fr-FR') : '';
    setTimeout(() => fb.classList.remove('show'), 5000);
  }

  async function punch({ code, fingerprint_id }) {
    try {
      const res = await api.post('/kiosk/punch', { code, fingerprint_id });
      feedback(true,
        res.type === 'in' ? '✓ Bonjour — Entrée enregistrée' : '✓ À bientôt — Sortie enregistrée',
        `${res.employee.first_name} ${res.employee.last_name} (${res.employee.matricule})`,
        res.ts);
      refreshLog();
    } catch (e) {
      feedback(false, '✗ Pointage refusé', e.message, null);
    }
    el.querySelector('#k-code').value = '';
  }

  el.querySelector('#k-send').addEventListener('click', () => {
    const code = el.querySelector('#k-code').value.trim();
    if (code) punch({ code });
  });
  el.querySelector('#k-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = e.target.value.trim();
      if (code) punch({ code }); // compatible douchette USB (saisie + Entrée)
    }
  });

  el.querySelector('#k-fp').addEventListener('click', () => {
    const fp = sel.value;
    if (!fp) {
      feedback(false, '✗ Aucune empreinte sélectionnée', 'Choisissez une empreinte de démonstration à droite.', null);
      return;
    }
    const pad = el.querySelector('#k-fp');
    pad.style.boxShadow = '0 0 0 3px rgba(109,74,224,.6)';
    setTimeout(() => {
      pad.style.boxShadow = '';
      punch({ fingerprint_id: fp });
    }, 650);
  });

  // Caméra + décodage QR (jsQR si disponible)
  el.querySelector('#k-cam').addEventListener('click', async () => {
    const video = el.querySelector('#k-video');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraStream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      feedback(true, 'Caméra activée', 'Présentez le QR devant la caméra…', null);
      if (!window.jsQR) {
        const s = document.createElement('script');
        s.src = '/vendor/jsQR.js';
        s.onerror = () => feedback(false, '✗ Module QR indisponible', 'Utilisez la saisie du code badge.', null);
        document.head.appendChild(s);
      }
      const scan = () => {
        if (!video.srcObject) return;
        if (video.readyState === 4 && window.jsQR) {
          const c = document.createElement('canvas');
          c.width = video.videoWidth; c.height = video.videoHeight;
          c.getContext('2d').drawImage(video, 0, 0);
          const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
          const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            stream.getTracks().forEach((t) => t.stop());
            cameraStream = null;
            video.srcObject = null;
            video.style.display = 'none';
            punch({ code: code.data });
            return;
          }
        }
        requestAnimationFrame(scan);
      };
      scan();
    } catch {
      feedback(false, '✗ Caméra inaccessible', 'Autorisez la caméra ou utilisez la saisie manuelle.', null);
    }
  });

  el.querySelector('#k-account').addEventListener('click', () => {
    ctx.openAccountSwitcher({ onChange: cleanup });
  });
  el.querySelector('#k-exit').addEventListener('click', () => {
    cleanup();
    ctx.go('#/dashboard');
  });
  el.querySelector('#k-logout').addEventListener('click', () => {
    cleanup();
    ctx.logout();
  });
}

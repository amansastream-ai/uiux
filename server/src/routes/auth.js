/**
 * SunuÉcole — Authentification : connexion, refresh, profil, sécurité du compte.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { config, ROLES } from '../config.js';
import {
  authenticate, signAccessToken, signRefreshToken, hashRefresh,
  invalidateUser, loadSchool, audit,
} from '../middleware/auth.js';
import { HttpError } from '../lib/utils.js';
import { onboardSchool, validateSignup, currentYearName } from '../lib/onboard.js';

/** Table de secours pour la réinitialisation de mot de passe (créée si absente). */
db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  email      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const router = Router();

/**
 * Options du cookie de renouvellement, adaptées au contexte de la requête.
 *
 * En HTTPS (prévisualisation dans une iframe tierce, déploiement réel) le cookie
 * doit être SameSite=None + Secure pour être renvoyé ; en HTTP local, SameSite=None
 * est refusé par les navigateurs, on reste donc en Lax.
 */
function cookieOptsFor(req) {
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = config.auth.secureCookies || !!req.secure || fwd === 'https';
  return {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    maxAge: config.auth.refreshTokenTtlDays * 864e5,
    path: '/api/auth',
  };
}

/** Compteurs de tentatives par IP+email (protection anti force brute en mémoire). */
const attempts = new Map();
function tooManyAttempts(key) {
  const rec = attempts.get(key);
  return rec && rec.count >= config.auth.maxFailedAttempts && Date.now() < rec.until;
}
function registerFailure(key) {
  const rec = attempts.get(key) || { count: 0, until: 0 };
  rec.count += 1;
  rec.until = Date.now() + config.auth.lockMinutes * 60000;
  attempts.set(key, rec);
}
function clearAttempts(key) {
  attempts.delete(key);
}

function publicUser(u, school) {
  let prefs = {};
  try { prefs = JSON.parse(u.preferences_json || '{}'); } catch { /* ignore */ }
  return {
    id: u.id,
    schoolId: u.school_id,
    role: u.role,
    roleLabel: ROLES[u.role]?.label || u.role,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    phone: u.phone,
    avatarColor: u.avatar_color,
    gender: u.gender,
    twoFactor: !!u.two_factor,
    mustChangePassword: !!u.must_change_pw,
    preferences: { theme: 'auto', density: 'confort', lang: 'fr', ...prefs },
    lastLoginAt: u.last_login_at,
    school: school
      ? {
          id: school.id, name: school.name, slug: school.slug, city: school.city,
          plan: school.plan, currency: school.currency, academicYear: school.academic_year,
          subscriptionStatus: school.subscription_status, logoUrl: school.logo_url,
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* POST /api/auth/login                                                */
/* ------------------------------------------------------------------ */
router.post('/login', (req, res, next) => {
  try {
    const { email, phone, password } = req.body || {};
    const identifier = String(email || phone || '').trim().toLowerCase();
    if (!identifier || !password) throw new HttpError(422, 'Identifiant et mot de passe requis.');
    const key = `${req.ip}:${identifier}`;
    if (tooManyAttempts(key)) {
      throw new HttpError(429, `Trop de tentatives. Réessayez dans ${config.auth.lockMinutes} minutes.`);
    }

    const user = db.get(
      'SELECT * FROM users WHERE lower(email)=? OR replace(phone,\' \',\'\')=? LIMIT 1',
      [identifier, identifier.replace(/\s/g, '')]
    );
    // Message volontairement générique : ne révèle pas l'existence du compte.
    if (!user || !user.is_active) {
      registerFailure(key);
      audit(req, 'login_failed', 'user', null, `Échec de connexion : ${identifier}`);
      throw new HttpError(401, 'Identifiants incorrects.');
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      registerFailure(key);
      db.run('UPDATE users SET failed_attempts=failed_attempts+1 WHERE id=?', [user.id]);
      audit(req, 'login_failed', 'user', user.id, `Mot de passe erroné pour ${user.email}`);
      throw new HttpError(401, 'Identifiants incorrects.');
    }

    clearAttempts(key);
    const school = user.school_id ? loadSchool(user.school_id) : null;
    if (school && school.subscription_status === 'suspended') {
      throw new HttpError(402, `L'abonnement de « ${school.name} » est suspendu. Contactez la direction.`);
    }

    db.run(
      `UPDATE users SET last_login_at=datetime('now'), last_login_ip=?, failed_attempts=0, login_count=login_count+1 WHERE id=?`,
      [req.ip, user.id]
    );
    invalidateUser(user.id);

    const token = signAccessToken(user);
    const refreshToken = signRefreshToken(user, req.headers['user-agent'] || '', req.ip);
    res.cookie(config.auth.cookieName, refreshToken, cookieOptsFor(req));
    audit(req, 'login', 'user', user.id, `Connexion de ${user.email}`, { role: user.role });

    res.json({
      token,
      refreshToken,
      expiresIn: config.auth.accessTokenTtl,
      user: publicUser(user, school),
      demo: { password: 'Sunu2026!' },
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/refresh                                              */
/* ------------------------------------------------------------------ */
router.post('/refresh', (req, res, next) => {
  try {
    const token = req.cookies?.[config.auth.cookieName] || req.body?.refreshToken;
    if (!token) throw new HttpError(401, 'Jeton de renouvellement absent.');
    const row = db.get(
      'SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked_at IS NULL',
      [hashRefresh(token)]
    );
    if (!row || new Date(row.expires_at) < new Date()) {
      throw new HttpError(401, 'Session expirée.');
    }
    const user = db.get('SELECT * FROM users WHERE id=? AND is_active=1', [row.user_id]);
    if (!user) throw new HttpError(401, 'Compte désactivé.');
    const school = user.school_id ? loadSchool(user.school_id) : null;
    // Rotation : l'ancien jeton est révoqué.
    db.run("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=?", [row.id]);
    const newToken = signAccessToken(user);
    const newRefresh = signRefreshToken(user, req.headers['user-agent'] || '', req.ip);
    res.cookie(config.auth.cookieName, newRefresh, cookieOptsFor(req));
    res.json({ token: newToken, refreshToken: newRefresh, user: publicUser(user, school) });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/logout                                               */
/* ------------------------------------------------------------------ */
router.post('/logout', (req, res) => {
  const token = req.cookies?.[config.auth.cookieName];
  if (token) db.run("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE token_hash=?", [hashRefresh(token)]);
  const clearOpts = cookieOptsFor(req);
  delete clearOpts.maxAge;
  res.clearCookie(config.auth.cookieName, clearOpts);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/me                                                    */
/* ------------------------------------------------------------------ */
router.get('/me', authenticate, (req, res) => {
  const u = db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
  const school = u.school_id ? loadSchool(u.school_id) : null;
  res.json({ user: publicUser(u, school) });
});

/* ------------------------------------------------------------------ */
/* PATCH /api/auth/profile — préférences UX (thème, densité, langue)   */
/* ------------------------------------------------------------------ */
router.patch('/profile', authenticate, (req, res, next) => {
  try {
    const allowed = ['first_name', 'last_name', 'phone', 'gender', 'avatar_color'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    }
    if (req.body.preferences && typeof req.body.preferences === 'object') {
      const current = JSON.parse(db.get('SELECT preferences_json FROM users WHERE id=?', [req.user.id]).preferences_json || '{}');
      sets.push('preferences_json=?');
      params.push(JSON.stringify({ ...current, ...req.body.preferences }));
    }
    if (sets.length) {
      params.push(req.user.id);
      db.run(`UPDATE users SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`, params);
      invalidateUser(req.user.id);
    }
    const u = db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    res.json({ user: publicUser(u, u.school_id ? loadSchool(u.school_id) : null) });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/change-password                                      */
/* ------------------------------------------------------------------ */
router.post('/change-password', authenticate, (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (String(newPassword || '').length < 8) throw new HttpError(422, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
    const u = db.get('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!bcrypt.compareSync(String(currentPassword || ''), u.password_hash)) {
      throw new HttpError(401, 'Mot de passe actuel incorrect.');
    }
    db.run('UPDATE users SET password_hash=?, must_change_pw=0 WHERE id=?', [
      bcrypt.hashSync(newPassword, config.auth.bcryptRounds), u.id,
    ]);
    invalidateUser(u.id);
    audit(req, 'update', 'user', u.id, 'Mot de passe modifié');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/demo-accounts — boutons de connexion rapide en démo   */
/* ------------------------------------------------------------------ */
router.get('/demo-accounts', (_req, res) => {
  const rows = db.all(
    `SELECT u.email, u.role, u.first_name, u.last_name, s.name AS school, s.slug, s.plan
       FROM users u JOIN schools s ON s.id = u.school_id
      WHERE s.demo=1 AND u.email IS NOT NULL
        AND u.email IN ('direction@lesbaobabs.sn','secretariat@lesbaobabs.sn','compta@lesbaobabs.sn',
                        'prof@lesbaobabs.sn','parent@lesbaobabs.sn','eleve@lesbaobabs.sn',
                        'direction@saintemarie.sn','direction@ndiandiaye.sn')
      ORDER BY CASE u.role WHEN 'direction' THEN 1 WHEN 'secretaire' THEN 2 WHEN 'comptable' THEN 3
                           WHEN 'enseignant' THEN 4 WHEN 'parent' THEN 5 ELSE 6 END`
  );
  res.json({
    password: 'Sunu2026!',
    accounts: rows.map((r) => ({
      email: r.email, role: r.role, roleLabel: ROLES[r.role]?.label || r.role,
      name: `${r.first_name} ${r.last_name}`, school: r.school, slug: r.slug, plan: r.plan,
    })),
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/register — inscription libre d'un établissement      */
/* ------------------------------------------------------------------ */
router.post('/register', (req, res, next) => {
  try {
    const b = req.body || {};
    validateSignup(b);
    const email = String(b.email).trim().toLowerCase();
    const plan = ['essentiel', 'pro', 'elite'].includes(b.plan) ? b.plan : 'pro';

    const created = db.tx(() => {
      const { schoolId, slug } = onboardSchool({
        name: b.schoolName,
        type: b.schoolType || 'prive',
        city: b.city,
        country: b.country || 'Sénégal',
        phone: b.phone,
        email,
        address: b.address,
        academicYear: b.academicYear || currentYearName(),
        headName: `${b.firstName} ${b.lastName}`,
        plan,
        trialDays: config.platform?.trialDays || 15,
      });
      const userId = db.insert(
        `INSERT INTO users (school_id, role, first_name, last_name, email, phone, password_hash, avatar_color, gender, must_change_pw)
         VALUES (?,?,?,?,?,?,?,?,?,0)`,
        [schoolId, 'direction', String(b.firstName).trim(), String(b.lastName).trim(), email,
         b.phone || null, bcrypt.hashSync(b.password, config.auth.bcryptRounds),
         '#0e7c66', b.gender || null]
      );
      return { schoolId, userId, slug };
    });

    const u = db.get('SELECT * FROM users WHERE id=?', [created.userId]);
    const school = loadSchool(created.schoolId);
    const token = signAccessToken(u);
    // signRefreshToken() persiste déjà le jeton (hash) en base : un second INSERT
    // ici violait la contrainte UNIQUE et faisait échouer toutes les inscriptions.
    const rt = signRefreshToken(u, req.headers['user-agent']?.slice(0, 120) || '', req.ip);
    res.cookie(config.auth.cookieName, rt, cookieOptsFor(req));

    res.status(201).json({
      token,
      refreshToken: rt,
      user: publicUser(u, school),
      onboarding: '/parametres',
      message: `Bienvenue ! Votre école « ${school.name} » est prête. Importez vos élèves depuis Excel pour démarrer.`,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/forgot-password — génère un code de réinitialisation */
/* ------------------------------------------------------------------ */
router.post('/forgot-password', (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) throw new HttpError(422, 'Adresse électronique requise.', { fields: { email: 'Champ requis.' } });
    const key = `forgot:${email}`;
    if (tooManyAttempts(key)) throw new HttpError(429, 'Trop de demandes. Réessayez dans quelques minutes.');

    const u = db.get('SELECT * FROM users WHERE email=? AND is_active=1', [email]);
    // Réponse identique que le compte existe ou non (pas de fuite d'information)
    const generic = { ok: true, message: 'Si un compte existe avec cette adresse, un code de réinitialisation vient d\u2019être envoyé.' };
    if (!u) { registerFailure(key); return res.json(generic); }

    const code = String(crypto.randomInt(100000, 999999));
    db.run("DELETE FROM password_resets WHERE email=? AND used_at IS NULL AND created_at > datetime('now','-1 hour')", [email]);
    const expiresAt = new Date(Date.now() + 30 * 60000).toISOString().replace('T', ' ').slice(0, 19);
    db.run('INSERT INTO password_resets (user_id, code_hash, email, expires_at) VALUES (?,?,?,?)',
      [u.id, bcrypt.hashSync(code, 6), email, expiresAt]);

    const mode = config.integrations?.email?.mode || 'simulated';
    res.json({
      ...generic,
      // En simulation (démo / déploiement sans SMTP), on renvoie le code :
      // l'établissement voit le parcours complet sans infrastructure.
      ...(mode === 'simulated' ? { code, expiresInMinutes: 30, channel: 'simulated' } : {}),
      phone: u.phone ? `${u.phone.slice(0, 4)}••••${u.phone.slice(-2)}` : null,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/reset-password                                       */
/* ------------------------------------------------------------------ */
router.post('/reset-password', (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const password = String(req.body?.password || '');
    const key = `reset:${email}`;
    if (tooManyAttempts(key)) throw new HttpError(429, 'Trop de tentatives. Demandez un nouveau code.');
    if (password.length < 8) throw new HttpError(422, 'Le mot de passe doit contenir au moins 8 caractères.');

    const rec = db.get("SELECT * FROM password_resets WHERE email=? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", [email]);
    if (!rec) throw new HttpError(400, 'Code invalide ou expiré. Demandez un nouveau code.');
    if (!bcrypt.compareSync(code, rec.code_hash)) {
      registerFailure(key);
      db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE id=?', [rec.id]);
      throw new HttpError(400, 'Code incorrect.');
    }
    db.tx(() => {
      db.run('UPDATE users SET password_hash=?, must_change_pw=0, failed_attempts=0, locked_until=NULL WHERE id=?',
        [bcrypt.hashSync(password, config.auth.bcryptRounds), rec.user_id]);
      db.run("UPDATE password_resets SET used_at=datetime('now') WHERE id=?", [rec.id]);
      db.run("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL", [rec.user_id]);
    });
    invalidateUser(rec.user_id);
    clearAttempts(key);
    res.json({ ok: true, message: 'Mot de passe modifié. Vous pouvez vous connecter.' });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/auth/two-factor — active/désactive la double authentification */
/* ------------------------------------------------------------------ */
router.post('/two-factor', authenticate, (req, res, next) => {
  try {
    const enable = req.body?.enable !== false;
    db.run('UPDATE users SET two_factor=? WHERE id=?', [enable ? 1 : 0, req.user.id]);
    invalidateUser(req.user.id);
    res.json({ ok: true, twoFactor: enable });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* GET /api/auth/sessions — appareils connectés au compte              */
/* ------------------------------------------------------------------ */
router.get('/sessions', authenticate, (_req, res) => {
  const rows = db.all(
    `SELECT id, device, ip, created_at, expires_at, revoked_at FROM refresh_tokens
      WHERE user_id=? ORDER BY created_at DESC LIMIT 20`, [_req.user.id]);
  res.json({ sessions: rows.map((r) => ({
    id: r.id, device: r.device, ip: r.ip, createdAt: r.created_at,
    expiresAt: r.expires_at, revoked: !!r.revoked_at,
  })) });
});

router.delete('/sessions/:id', authenticate, (req, res) => {
  db.run("UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=? AND user_id=?", [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
});

export default router;

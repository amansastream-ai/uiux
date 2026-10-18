'use strict';
/**
 * ChronoRH — sessions & contrôle d'accès par rôle.
 * Compatible multi-instances serverless (Vercel) : jeton signé HMAC + persistance SQLite.
 */
const crypto = require('node:crypto');
const { hashPassword } = require('./db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const COOKIE = 'chronorh_session';
const VALID_ROLES = new Set(['admin', 'drh', 'comptable', 'pointage']);
const revokedTokens = new Set();

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    'chronorh-sahel-services-session-secret-2026'
  );
}

function signTokenPayload(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyTokenPayload(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const dot = token.indexOf('.');
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) return null;
  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function createSession(db, userId, res) {
  const userRow = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId);
  if (!userRow) throw new Error('Utilisateur introuvable pour créer la session');

  const expMs = Date.now() + SESSION_TTL_MS;
  const expires = new Date(expMs).toISOString();
  const token = signTokenPayload({
    u: userRow.id,
    name: userRow.name,
    email: userRow.email,
    role: userRow.role,
    exp: expMs,
    jti: crypto.randomBytes(12).toString('hex')
  });
  db.prepare('INSERT OR REPLACE INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userRow.id, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(process.env.VERCEL),
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  return token;
}

function destroySession(db, req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) {
    revokedTokens.add(token);
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.clearCookie(COOKIE, { path: '/' });
}

function findUserByEmail(db, email) {
  if (!email) return null;
  return db.prepare('SELECT id, name, email, role, active FROM users WHERE lower(email) = ?').get(email.toLowerCase()) || null;
}

/**
 * Recrée localement le compte porté par un jeton HMAC lorsqu'une instance
 * serverless neuve ne possède pas encore sa ligne SQLite. Le mot de passe
 * aléatoire n'est connu de personne : l'authentification reste celle du jeton.
 */
function materializeTokenUser(db, payload) {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const role = payload.role;
  if (!email || !name || !VALID_ROLES.has(role)) return null;

  let user = findUserByEmail(db, email);
  if (user) return user.active ? user : null;

  try {
    db.prepare('INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hashPassword(crypto.randomBytes(32).toString('hex')), role);
  } catch {
    // Une requête simultanée a pu matérialiser le même compte entre-temps.
  }
  user = findUserByEmail(db, email);
  return user && user.active ? user : null;
}

function currentUser(db, req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token || revokedTokens.has(token)) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1
  `).get(token);
  if (row) return row;

  // Repli stateless signé pour un démarrage à froid / changement d'instance.
  const payload = verifyTokenPayload(token);
  if (!payload) return null;

  // Les sessions historiques contenaient seulement l'e-mail et l'identifiant.
  // Les nouveaux jetons portent l'identité complète pour les comptes créés à la volée.
  let user = materializeTokenUser(db, payload);
  if (!user && typeof payload.name !== 'string' && payload.email) {
    user = findUserByEmail(db, payload.email);
    if (user && !user.active) user = null;
  }
  if (!user && !payload.email && payload.u != null) {
    user = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ? AND active = 1').get(payload.u) || null;
  }
  if (!user) return null;

  try {
    db.prepare('INSERT OR IGNORE INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, user.id, new Date(payload.exp).toISOString());
  } catch {
    // La session signée reste valide même si l'instance n'enregistre pas le cache SQLite.
  }
  return user;
}

/** Middleware : requiert une connexion. */
function requireAuth(db) {
  return (req, res, next) => {
    const user = currentUser(db, req);
    if (!user) return res.status(401).json({ error: 'Authentification requise' });
    req.user = user;
    next();
  };
}

/** Middleware : requiert l'un des rôles listés. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé pour ce rôle' });
    }
    next();
  };
}

function audit(db, user, action, details) {
  db.prepare('INSERT INTO audit_logs(user_id, user_name, action, details) VALUES (?, ?, ?, ?)')
    .run(user ? user.id : null, user ? user.name : 'système', action, details || '');
}

module.exports = {
  createSession,
  destroySession,
  currentUser,
  requireAuth,
  requireRole,
  audit,
  COOKIE,
  signTokenPayload,
  verifyTokenPayload
};

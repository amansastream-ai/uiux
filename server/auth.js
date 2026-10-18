'use strict';
/** ChronoRH — sessions & contrôle d'accès par rôle. */
const crypto = require('node:crypto');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const COOKIE = 'chronorh_session';

function createSession(db, userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/'
  });
  return token;
}

function destroySession(db, req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

function currentUser(db, req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1
  `).get(token);
  return row || null;
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

module.exports = { createSession, destroySession, currentUser, requireAuth, requireRole, audit, COOKIE };

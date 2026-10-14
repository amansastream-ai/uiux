/**
 * SunuÉcole — Middleware d'authentification, de rôles et d'isolation multi-établissement.
 */
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { config, roleLevel } from '../config.js';
import { HttpError } from '../lib/utils.js';

/** Champs utilisateur jamais exposés au client. */
const PUBLIC_USER = `u.id, u.school_id, u.role, u.first_name, u.last_name, u.email, u.phone,
                     u.avatar_color, u.gender, u.is_active, u.preferences_json, u.last_login_at, u.two_factor`;

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, sid: user.school_id, role: user.role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.accessTokenTtl }
  );
}

export function signRefreshToken(user, device = '', ip = '') {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.run(
    `INSERT INTO refresh_tokens (user_id, token_hash, device, ip, expires_at) VALUES (?,?,?,?,?)`,
    [user.id, tokenHash, device, ip, new Date(Date.now() + config.auth.refreshTokenTtlDays * 864e5).toISOString()]
  );
  return token;
}

export function hashRefresh(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Charge l'utilisateur courant + son établissement (1 requête chacun, mis en cache court). */
const userCache = new Map();
export function loadUser(userId) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < 5000) return hit.user;
  const user = db.get(`SELECT ${PUBLIC_USER} FROM users u WHERE u.id=? AND u.is_active=1`, [userId]);
  if (!user) return null;
  if (user.preferences_json) {
    try { user.preferences = JSON.parse(user.preferences_json); } catch { user.preferences = {}; }
  }
  delete user.preferences_json;
  userCache.set(userId, { user, at: Date.now() });
  return user;
}
export const invalidateUser = (userId) => userCache.delete(Number(userId));
export function invalidateSchool(schoolId) {
  for (const [k, v] of userCache) if (v.user?.school_id === Number(schoolId)) userCache.delete(k);
}

const schoolCache = new Map();
export function loadSchool(schoolId) {
  if (!schoolId) return null;
  const hit = schoolCache.get(schoolId);
  if (hit && Date.now() - hit.at < 15000) return hit.school;
  const school = db.get('SELECT * FROM schools WHERE id=?', [schoolId]);
  if (!school) return null;
  for (const f of ['settings_json', 'modules_json', 'cycles']) {
    try { school[f.replace('_json', '')] = JSON.parse(school[f] || '{}'); } catch { /* ignore */ }
  }
  schoolCache.set(schoolId, { school, at: Date.now() });
  return school;
}
export const invalidateSchoolCache = (id) => schoolCache.delete(Number(id));

/** Décode le Bearer token et attache req.user / req.school. */
export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentification requise.'));
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    const user = loadUser(payload.sub);
    if (!user) return next(new HttpError(401, 'Session expirée, reconnectez-vous.'));
    req.user = user;
    req.schoolId = payload.sid || null;
    req.isSuperAdmin = user.role === 'super_admin';
    req.school = req.schoolId ? loadSchool(req.schoolId) : null;
    // Un super admin peut agir sur un établissement précis via ?school_id=
    if (req.isSuperAdmin && req.query.school_id) {
      req.schoolId = Number(req.query.school_id);
      req.school = loadSchool(req.schoolId);
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new HttpError(401, 'Session expirée, reconnectez-vous.'));
    next(new HttpError(401, 'Jeton invalide.'));
  }
}

/** Autorise uniquement certains rôles. Le super admin passe toujours. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentification requise.'));
    if (req.isSuperAdmin) return next();
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, `Action réservée aux rôles : ${roles.join(', ')}.`));
    }
    next();
  };
}

/** Autorise à partir d'un niveau de permission (utile pour la direction et ses délégations). */
export function requireLevel(minLevel) {
  return (req, _res, next) => {
    if (req.isSuperAdmin) return next();
    if (roleLevel(req.user?.role) < minLevel) return next(new HttpError(403, 'Droits insuffisants.'));
    next();
  };
}

/** Garantit qu'un établissement est bien rattaché à la requête. */
export function requireSchool(req, _res, next) {
  if (!req.schoolId) return next(new HttpError(400, 'Aucun établissement associé à ce compte.'));
  if (!req.school) return next(new HttpError(404, 'Établissement introuvable.'));
  if (req.school.subscription_status === 'suspended') {
    return next(new HttpError(402, 'Abonnement suspendu : régularisez votre situation pour continuer.'));
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Périmètre « famille » (parents / élèves)                             */
/* ------------------------------------------------------------------ */

/** Rôles qui ne voient que leurs propres enfants (ou leur propre dossier). */
export const FAMILY_ROLES = ['parent', 'eleve'];

export const isFamily = (req) => !!req.user && FAMILY_ROLES.includes(req.user.role);

/**
 * Identifiants des élèves accessibles au compte courant.
 * `null` pour le personnel (aucune restriction), tableau (éventuellement vide)
 * pour un parent ou un élève.
 */
export function familyScope(req) {
  if (!isFamily(req)) return null;
  if (req.user.role === 'eleve') {
    const st = db.get('SELECT id FROM students WHERE user_id=? AND school_id=?', [req.user.id, req.schoolId]);
    return st ? [st.id] : [];
  }
  return db.all(
    `SELECT sg.student_id AS id FROM student_guardians sg
       JOIN guardians g ON g.id=sg.guardian_id
      WHERE g.user_id=? AND g.school_id=?`,
    [req.user.id, req.schoolId]
  ).map((r) => Number(r.id));
}

/** Route réservée au personnel : bloque les comptes parent/élève. */
export function requireStaff(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentification requise.'));
  if (isFamily(req)) return next(new HttpError(403, 'Cet espace est réservé au personnel de l\u2019établissement.'));
  next();
}

/** Vérifie qu'un élève est bien dans le périmètre famille (no-op pour le personnel). */
export function assertFamilyAccess(req, studentId) {
  const scope = familyScope(req);
  if (!scope) return true;
  if (!scope.includes(Number(studentId))) {
    throw new HttpError(403, 'Accès refusé : cet élève n\u2019est pas rattaché à votre compte.');
  }
  return true;
}

/**
 * Restreint un filtre `student_id` au périmètre famille.
 * Renvoie la liste d'identifiants à utiliser dans la requête, ou `null`
 * si le personnel n'a pas besoin de restriction.
 */
export function scopedStudentIds(req, requestedId) {
  const scope = familyScope(req);
  if (!scope) return requestedId ? [Number(requestedId)] : null;
  if (!scope.length) return [];
  if (requestedId) return scope.includes(Number(requestedId)) ? [Number(requestedId)] : [];
  return scope;
}

/** Trace une action sensible dans le journal d'audit. */
export function audit(req, action, entity, entityId, summary, meta) {
  try {
    db.run(
      `INSERT INTO audit_logs (school_id, user_id, user_name, action, entity, entity_id, summary, meta_json, ip)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        req.schoolId ?? req.user?.school_id ?? null,
        req.user?.id ?? null,
        req.user ? `${req.user.first_name} ${req.user.last_name}` : 'anonyme',
        action, entity, entityId ? String(entityId) : null, summary || null,
        meta ? JSON.stringify(meta) : null,
        req.ip,
      ]
    );
  } catch {
    /* l'audit ne doit jamais casser une opération métier */
  }
}

/**
 * Garde-fou multi-tenant : vérifie qu'une ressource appartient bien à
 * l'établissement de l'utilisateur courant.
 */
export function assertOwnership(req, table, id, column = 'id') {
  const row = db.get(`SELECT id, school_id FROM ${table} WHERE ${column}=?`, [id]);
  if (!row) throw new HttpError(404, 'Ressource introuvable.');
  if (!req.isSuperAdmin && row.school_id !== req.schoolId) {
    throw new HttpError(403, 'Accès refusé : cette ressource appartient à un autre établissement.');
  }
  return row;
}

/** Restriction automatique des données d'un enseignant à ses classes/matières. */
export function teacherScope(req) {
  if (req.isSuperAdmin || roleLevel(req.user.role) >= 65) return null;
  if (req.user.role !== 'enseignant') return null;
  const staff = db.get('SELECT id FROM staff WHERE user_id=? AND school_id=?', [req.user.id, req.schoolId]);
  if (!staff) return null;
  const classes = db.all(
    `SELECT DISTINCT cs.class_id AS id FROM class_subjects cs WHERE cs.teacher_id=?
     UNION SELECT DISTINCT ts.class_id FROM timetable_slots ts WHERE ts.teacher_id=?
     UNION SELECT DISTINCT ls.class_id FROM lesson_logs ls WHERE ls.teacher_id=?`,
    [staff.id, staff.id, staff.id]
  ).map((r) => r.id);
  return { staffId: staff.id, classIds: classes };
}

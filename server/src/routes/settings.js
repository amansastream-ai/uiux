/**
 * SunuÉcole — Paramètres : établissement, comptes utilisateurs, journal d'audit,
 * sauvegardes, export des données (portabilité/RGPD), abonnement, onboarding.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, audit, invalidateSchoolCache, invalidateUser, signAccessToken } from '../middleware/auth.js';
import { ok, created, paginate, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, money, isValidEmail, slugify, addMonths } from '../lib/utils.js';
import { config, PLANS, ROLES } from '../config.js';

const router = Router();
router.use(authenticate);
/**
 * Toutes les routes exigent un établissement — sauf l'assistance plateforme
 * (impersonation), utilisée par le super administrateur sur les écoles clientes.
 */
const PLATFORM_ONLY = /^\/impersonate\//;
router.use((req, res, next) => (PLATFORM_ONLY.test(req.path) ? next() : requireSchool(req, res, next)));

const S = (req) => req.schoolId;
const ADMIN = ['direction', 'super_admin'];

/* ================================================================== */
/* ÉTABLISSEMENT                                                       */
/* ================================================================== */
router.get('/school', (req, res) => {
  const school = db.get('SELECT * FROM schools WHERE id=?', [S(req)]);
  const year = db.get('SELECT * FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
  const years = db.all('SELECT * FROM school_years WHERE school_id=? ORDER BY start_date DESC', [S(req)]);
  const terms = db.all('SELECT * FROM terms WHERE school_id=? ORDER BY seq', [S(req)]);
  const levels = db.all('SELECT * FROM levels WHERE school_id=? ORDER BY seq', [S(req)]);
  const counts = {
    eleves: db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN ('radie','abandon')`, [S(req)]),
    classes: db.pluck('SELECT COUNT(*) FROM classes WHERE school_id=?', [S(req)]),
    personnel: db.pluck('SELECT COUNT(*) FROM staff WHERE school_id=?', [S(req)]),
    utilisateurs: db.pluck('SELECT COUNT(*) FROM users WHERE school_id=? AND is_active=1', [S(req)]),
    matieres: db.pluck('SELECT COUNT(*) FROM subjects WHERE school_id=?', [S(req)]),
  };
  ok(res, {
    school: parseJsonFields({ ...school }, ['settings_json', 'modules_json', 'cycles']),
    year, years, terms, levels, counts,
    plan: PLANS[school.plan] || null,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p })),
  });
});

router.patch('/school', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const b = req.body || {};
    const allowed = ['name', 'phone', 'phone2', 'email', 'website', 'address', 'city', 'region', 'country',
      'head_name', 'ninea', 'rne', 'logo_url', 'type', 'academic_year', 'currency', 'language', 'timezone', 'max_students'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (b[f] !== undefined) { sets.push(`${f}=?`); params.push(b[f]); }
    if (b.settings && typeof b.settings === 'object') {
      const current = JSON.parse(db.get('SELECT settings_json FROM schools WHERE id=?', [S(req)]).settings_json || '{}');
      sets.push('settings_json=?');
      params.push(JSON.stringify({ ...current, ...b.settings }));
    }
    if (b.modules) { sets.push('modules_json=?'); params.push(JSON.stringify(b.modules)); }
    if (b.cycles) { sets.push('cycles=?'); params.push(JSON.stringify(b.cycles)); }
    if (!sets.length) return ok(res, { updated: false });
    params.push(S(req));
    db.run(`UPDATE schools SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`, params);
    invalidateSchoolCache(S(req));
    audit(req, 'update', 'school', S(req), 'Paramètres de l\'établissement mis à jour');
    ok(res, { updated: true });
  } catch (err) { next(err); }
});

/* --- Niveaux / classes / matières (structure pédagogique) --- */
router.post('/levels', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const { name, cycle, seq, tuition } = req.body || {};
    if (!name) throw new HttpError(422, 'Nom du niveau requis.');
    const id = db.insert('INSERT INTO levels (school_id, name, cycle, seq, tuition) VALUES (?,?,?,?,?)',
      [S(req), name, cycle || 'Primaire', Number(seq) || 1, money(tuition) || 0]);
    created(res, { id });
  } catch (err) { next(err); }
});

router.post('/classes', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.level_id) throw new HttpError(422, 'Nom et niveau requis.');
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    if (b.id) {
      db.run('UPDATE classes SET name=?, level_id=?, capacity=?, room=?, main_teacher_id=?, shift=?, color=?, is_active=? WHERE id=? AND school_id=?',
        [b.name, Number(b.level_id), Number(b.capacity) || 40, b.room || null, b.main_teacher_id || null,
          b.shift || 'jour', b.color || null, b.is_active === false ? 0 : 1, Number(b.id), S(req)]);
      return ok(res, { id: Number(b.id) });
    }
    const id = db.insert(
      `INSERT INTO classes (school_id, year_id, level_id, name, capacity, room, main_teacher_id, shift, color)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [S(req), year, Number(b.level_id), b.name, Number(b.capacity) || 40, b.room || null,
        b.main_teacher_id || null, b.shift || 'jour', b.color || null]
    );
    audit(req, 'create', 'class', id, `Classe « ${b.name} » créée`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.delete('/classes/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const eff = db.pluck('SELECT COUNT(*) FROM students WHERE class_id=?', [id]);
    if (eff) throw new HttpError(409, `Cette classe contient encore ${eff} élève(s). Réaffectez-les d'abord.`);
    db.run('DELETE FROM classes WHERE id=? AND school_id=?', [id, S(req)]);
    ok(res, { id });
  } catch (err) { next(err); }
});

router.post('/subjects', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const { name, code, color } = req.body || {};
    if (!name) throw new HttpError(422, 'Nom de la matière requis.');
    const id = db.insert('INSERT INTO subjects (school_id, name, code, color) VALUES (?,?,?,?)',
      [S(req), name, code || slugify(name).slice(0, 6).toUpperCase(), color || '#0e7c66']);
    created(res, { id });
  } catch (err) { next(err); }
});

/** Affectation matière ↔ classe ↔ enseignant (avec coefficient). */
router.post('/class-subjects', requireRole(...ADMIN, 'censeur', 'secretaire'), (req, res, next) => {
  try {
    const { class_id: classId, subject_id: subjectId, teacher_id: teacherId, coefficient, hours_per_week: hours } = req.body || {};
    if (!classId || !subjectId) throw new HttpError(422, 'Classe et matière requises.');
    db.run(
      `INSERT INTO class_subjects (school_id, class_id, subject_id, teacher_id, coefficient, hours_per_week)
       VALUES (?,?,?,?,?,?) ON CONFLICT(class_id, subject_id) DO UPDATE SET
         teacher_id=excluded.teacher_id, coefficient=excluded.coefficient, hours_per_week=excluded.hours_per_week`,
      [S(req), Number(classId), Number(subjectId), teacherId || null, Number(coefficient) || 1, Number(hours) || 2]
    );
    ok(res, { class_id: Number(classId), subject_id: Number(subjectId) });
  } catch (err) { next(err); }
});

router.delete('/class-subjects/:id(\\d+)', requireRole(...ADMIN, 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    db.run('DELETE FROM class_subjects WHERE id=? AND school_id=?', [id, S(req)]);
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* UTILISATEURS & DROITS                                               */
/* ================================================================== */
router.get('/users', requireRole(...ADMIN, 'secretaire', 'comptable'), (req, res) => {
  const where = ['u.school_id=?'];
  const params = [S(req)];
  if (req.query.role) { where.push('u.role=?'); params.push(req.query.role); }
  if (req.query.q) {
    where.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
    const t = `%${req.query.q}%`;
    params.push(t, t, t);
  }
  const rows = db.all(
    `SELECT u.id, u.role, u.first_name, u.last_name, u.email, u.phone, u.is_active, u.last_login_at,
            u.login_count, u.two_factor, u.must_change_pw, u.avatar_color, u.created_at,
            st.id AS staff_id, st.job_title
       FROM users u LEFT JOIN staff st ON st.user_id=u.id
      WHERE ${where.join(' AND ')} ORDER BY u.role, u.last_name COLLATE NOCASE`, params
  );
  ok(res, { users: rows, roles: Object.entries(ROLES).map(([id, r]) => ({ id, ...r })) });
});

router.post('/users', requireRole(...ADMIN), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name || !b.role) throw new HttpError(422, 'Nom, prénom et rôle requis.');
    const email = b.email ? String(b.email).toLowerCase().trim() : null;
    if (email && !isValidEmail(email)) throw new HttpError(422, 'Adresse e-mail invalide.');
    if (email && db.get('SELECT id FROM users WHERE lower(email)=?', [email])) {
      throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
    }
    const password = b.password || 'Sunu2026!';
    if (String(password).length < 8) throw new HttpError(422, 'Mot de passe : 8 caractères minimum.');
    const id = db.insert(
      `INSERT INTO users (school_id, role, first_name, last_name, email, phone, password_hash, avatar_color, gender, must_change_pw)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [S(req), b.role, b.first_name, b.last_name, email, b.phone || null,
        bcrypt.hashSync(password, config.auth.bcryptRounds), b.avatar_color || '#0e7c66',
        b.gender || null, b.email ? 0 : 1]
    );
    audit(req, 'create', 'user', id, `Compte créé : ${b.role} ${b.first_name} ${b.last_name}`);
    created(res, { id, tempPassword: b.email ? null : password });
  } catch (err) { next(err); }
});

router.patch('/users/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const u = db.get('SELECT * FROM users WHERE id=? AND school_id=?', [id, S(req)]);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const allowed = ['role', 'first_name', 'last_name', 'phone', 'is_active', 'two_factor'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    if (sets.length) { params.push(id); db.run(`UPDATE users SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`, params); }
    invalidateUser(id);
    audit(req, 'update', 'user', id, 'Compte modifié');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.post('/users/:id(\\d+)/reset-password', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const u = db.get('SELECT id FROM users WHERE id=? AND school_id=?', [id, S(req)]);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const temp = req.body.password || `Sunu${Math.random().toString(36).slice(2, 8)}!`;
    db.run('UPDATE users SET password_hash=?, must_change_pw=1, failed_attempts=0, locked_until=NULL WHERE id=?',
      [bcrypt.hashSync(temp, config.auth.bcryptRounds), id]);
    invalidateUser(id);
    audit(req, 'update', 'user', id, 'Mot de passe réinitialisé');
    ok(res, { id, tempPassword: temp });
  } catch (err) { next(err); }
});

router.delete('/users/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(409, 'Vous ne pouvez pas désactiver votre propre compte.');
    db.run('UPDATE users SET is_active=0 WHERE id=? AND school_id=?', [id, S(req)]);
    db.run('DELETE FROM refresh_tokens WHERE user_id=?', [id]);
    invalidateUser(id);
    audit(req, 'delete', 'user', id, 'Compte désactivé');
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* JOURNAL D'AUDIT                                                     */
/* ================================================================== */
router.get('/audit', requireRole(...ADMIN, 'censeur'), (req, res) => {
  const where = ['a.school_id=?'];
  const params = [S(req)];
  if (req.query.entity) { where.push('a.entity=?'); params.push(req.query.entity); }
  if (req.query.action) { where.push('a.action=?'); params.push(req.query.action); }
  if (req.query.user_id) { where.push('a.user_id=?'); params.push(Number(req.query.user_id)); }
  if (req.query.from) { where.push('a.created_at>=?'); params.push(req.query.from); }
  if (req.query.to) { where.push('a.created_at<=?'); params.push(`${req.query.to}T23:59:59Z`); }
  const { rows, total } = paginate(req.query, {
    from: 'audit_logs a', select: 'a.*', where, params, orderBy: 'a.created_at DESC',
  });
  const actions = db.all('SELECT DISTINCT action FROM audit_logs WHERE school_id=? ORDER BY action', [S(req)]);
  const entities = db.all('SELECT DISTINCT entity FROM audit_logs WHERE school_id=? ORDER BY entity', [S(req)]);
  res.json({
    data: rows.map((r) => parseJsonFields(r, ['meta_json'])),
    meta: { total },
    filters: { actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity) },
  });
});

/* ================================================================== */
/* SAUVEGARDE & EXPORT DES DONNÉES                                     */
/* ================================================================== */
router.get('/backups', requireRole(...ADMIN), (req, res) => {
  ok(res, db.all('SELECT * FROM backups WHERE school_id=? OR school_id IS NULL ORDER BY created_at DESC LIMIT 30', [S(req)]));
});

router.post('/backups', requireRole(...ADMIN), (req, res, next) => {
  try {
    const file = `${config.paths.backups}/sunuecole-${today()}-${Date.now()}.sqlite`;
    const result = db.backup(file);
    const id = db.insert('INSERT INTO backups (school_id, file_path, size_bytes, kind, created_by) VALUES (?,?,?,?,?)',
      [S(req), result.file, result.size, req.body.kind || 'manuel', req.user.id]);
    audit(req, 'create', 'backup', id, `Sauvegarde manuelle (${Math.round(result.size / 1024)} Ko)`);
    created(res, { id, file: result.file, size: result.size });
  } catch (err) { next(err); }
});

/**
 * Export JSON complet des données de l'établissement.
 * Indispensable pour la réversibilité : une école doit pouvoir repartir
 * avec ses données si elle quitte la plateforme.
 */
router.get('/export', requireRole(...ADMIN), (req, res) => {
  const s = S(req);
  const scopedTables = ['students', 'guardians', 'staff', 'classes', 'levels', 'subjects', 'invoices', 'payments',
    'expenses', 'attendance_sessions', 'attendance_records', 'assessments', 'grades', 'report_cards',
    'timetable_slots', 'lesson_logs', 'homework', 'messages', 'events', 'applications', 'discipline_incidents',
    'library_books', 'library_loans', 'transport_routes', 'health_records', 'document_requests', 'audit_logs'];
  const out = {
    exported_at: new Date().toISOString(),
    school: db.get('SELECT * FROM schools WHERE id=?', [s]),
    counts: {},
  };
  for (const t of scopedTables) {
    try {
      const rows = db.all(`SELECT * FROM ${t} WHERE school_id=?`, [s]);
      out[t] = rows;
      out.counts[t] = rows.length;
    } catch { /* table absente */ }
  }
  audit(req, 'export', 'school', s, 'Export complet des données (JSON)');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export-${req.school.slug}-${today()}.json"`);
  res.send(JSON.stringify(out, null, 2));
});


/* --- Mise à jour / suppression des niveaux et matières --- */
router.patch('/levels/:id(\\d+)', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = [];
    const params = [];
    for (const f of ['name', 'cycle', 'seq', 'tuition', 'color']) {
      if (b[f] !== undefined) { sets.push(`${f}=?`); params.push(f === 'tuition' ? money(b[f]) : f === 'seq' ? Number(b[f]) || 1 : b[f]); }
    }
    if (!sets.length) throw new HttpError(422, 'Aucune modification fournie.');
    params.push(id, S(req));
    const r = db.run(`UPDATE levels SET ${sets.join(', ')} WHERE id=? AND school_id=?`, params);
    if (!r.changes) throw new HttpError(404, 'Niveau introuvable.');
    audit(req, 'update', 'level', id, 'Niveau mis à jour');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/levels/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const n = db.pluck('SELECT COUNT(*) FROM classes WHERE level_id=?', [id]) || 0;
    if (n) throw new HttpError(409, `Ce niveau contient ${n} classe(s). Supprimez-les ou réaffectez-les d'abord.`);
    db.run('DELETE FROM levels WHERE id=? AND school_id=?', [id, S(req)]);
    audit(req, 'delete', 'level', id, 'Niveau supprimé');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.patch('/subjects/:id(\\d+)', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = [];
    const params = [];
    for (const f of ['name', 'code', 'color', 'short_name', 'is_active']) {
      if (b[f] !== undefined) { sets.push(`${f}=?`); params.push(f === 'is_active' ? (b[f] ? 1 : 0) : b[f]); }
    }
    if (!sets.length) throw new HttpError(422, 'Aucune modification fournie.');
    params.push(id, S(req));
    const r = db.run(`UPDATE subjects SET ${sets.join(', ')} WHERE id=? AND school_id=?`, params);
    if (!r.changes) throw new HttpError(404, 'Matière introuvable.');
    audit(req, 'update', 'subject', id, 'Matière mise à jour');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/subjects/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const n = db.pluck('SELECT COUNT(*) FROM grades WHERE subject_id=?', [id]) || 0;
    if (n) {
      // On ne supprime jamais des notes : la matière est désactivée à la place.
      db.run('UPDATE subjects SET is_active=0 WHERE id=? AND school_id=?', [id, S(req)]);
      audit(req, 'update', 'subject', id, `Matière désactivée (${n} notes conservées)`);
      return ok(res, { id, deactivated: true, grades: n });
    }
    db.run('DELETE FROM subjects WHERE id=? AND school_id=?', [id, S(req)]);
    audit(req, 'delete', 'subject', id, 'Matière supprimée');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.patch('/classes/:id(\\d+)', requireRole(...ADMIN, 'secretaire'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = [];
    const params = [];
    for (const f of ['name', 'level_id', 'capacity', 'room', 'main_teacher_id', 'shift', 'color', 'is_active']) {
      if (b[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(['level_id', 'capacity'].includes(f) ? Number(b[f]) || null : f === 'is_active' ? (b[f] ? 1 : 0) : b[f]);
      }
    }
    if (!sets.length) throw new HttpError(422, 'Aucune modification fournie.');
    params.push(id, S(req));
    const r = db.run(`UPDATE classes SET ${sets.join(', ')} WHERE id=? AND school_id=?`, params);
    if (!r.changes) throw new HttpError(404, 'Classe introuvable.');
    audit(req, 'update', 'class', id, 'Classe mise à jour');
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Année scolaire suivante : bascule encadrée (passage de classe en masse). */
router.post('/years', requireRole(...ADMIN), (req, res, next) => {
  try {
    const { name, start_date: start, end_date: end } = req.body || {};
    if (!name || !start || !end) throw new HttpError(422, 'Nom, date de début et date de fin requis.');
    const id = db.tx(() => {
      db.run('UPDATE school_years SET is_current=0 WHERE school_id=?', [S(req)]);
      const yid = db.insert('INSERT INTO school_years (school_id, name, start_date, end_date, is_current) VALUES (?,?,?,?,1)',
        [S(req), name, start, end]);
      db.run('UPDATE schools SET academic_year=? WHERE id=?', [name, S(req)]);
      return yid;
    });
    invalidateSchoolCache(S(req));
    audit(req, 'create', 'school_year', id, `Année scolaire ${name} ouverte`);
    created(res, { id, name });
  } catch (err) { next(err); }
});

/**
 * POST /impersonate/:schoolId — support : le super administrateur ouvre une
 * session « direction » dans l'école cliente pour diagnostiquer un problème.
 * Chaque usage est tracé dans le journal d'audit de la plateforme.
 */
router.post('/impersonate/:id(\\d+)', requireRole('super_admin'), (req, res, next) => {
  try {
    const schoolId = Number(req.params.id);
    const school = db.get('SELECT * FROM schools WHERE id=?', [schoolId]);
    if (!school) throw new HttpError(404, 'Établissement introuvable.');
    const target = db.get("SELECT * FROM users WHERE school_id=? AND role='direction' AND is_active=1 ORDER BY id LIMIT 1", [schoolId])
      || db.get('SELECT * FROM users WHERE school_id=? AND is_active=1 ORDER BY id LIMIT 1', [schoolId]);
    if (!target) throw new HttpError(409, 'Aucun compte actif dans cet établissement.');
    const token = signAccessToken({ ...target, impersonated_by: req.user.id });
    audit(req, 'impersonate', 'school', schoolId, `Session ouverte dans « ${school.name} » en tant que ${target.first_name} ${target.last_name}`,
      { target_user: target.id });
    ok(res, { token, school: { id: school.id, name: school.name }, as: `${target.first_name} ${target.last_name}`, role: target.role });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* ABONNEMENT                                                          */
/* ================================================================== */
router.get('/plans', (req, res) => {
  const current = req.school.plan;
  ok(res, {
    current,
    status: req.school.subscription_status,
    trial_ends_at: req.school.trial_ends_at,
    max_students: req.school.max_students,
    effectif: db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN ('radie','abandon')`, [S(req)]),
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, ...p, current: id === current })),
  });
});

router.post('/subscription', requireRole(...ADMIN), (req, res, next) => {
  try {
    const { plan, period = 'monthly' } = req.body || {};
    if (!PLANS[plan]) throw new HttpError(422, 'Plan invalide.');
    const p = PLANS[plan];
    const effectif = db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN ('radie','abandon')`, [S(req)]) || 0;
    if (effectif > p.maxStudents && plan !== 'elite') {
      throw new HttpError(409, `Le plan ${p.name} est limité à ${p.maxStudents} élèves (vous en avez ${effectif}).`);
    }
    const expires = period === 'yearly' ? addMonths(today(), 12) : addMonths(today(), 1);
    db.tx(() => {
      db.run('UPDATE schools SET plan=?, subscription_status=\'active\', max_students=?, modules_json=? WHERE id=?',
        [plan, p.maxStudents, JSON.stringify(p.modules), S(req)]);
      db.insert(
        `INSERT INTO subscriptions (school_id, plan, seats, amount, period, status, started_at, expires_at)
         VALUES (?,?,?,?,?, 'active', date('now'), ?)`,
        [S(req), plan, p.maxStudents, period === 'yearly' ? p.price * 12 * 0.85 : p.price, period, expires]
      );
    });
    invalidateSchoolCache(S(req));
    audit(req, 'update', 'subscription', S(req), `Passage au plan ${p.name} (${period})`);
    created(res, { plan, name: p.name, price: period === 'yearly' ? Math.round(p.price * 12 * 0.85) : p.price, period });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* ONBOARDING — checklist d'adoption (objectif : opérationnel en 1 h)  */
/* ================================================================== */
router.get('/onboarding', (req, res) => {
  const s = S(req);
  const c = (sql, params = []) => db.pluck(sql, params) || 0;
  const steps = [
    {
      id: 'profil', titre: 'Compléter la fiche établissement', description: 'Nom, adresse, téléphone, logo : ils apparaissent sur les bulletins et les reçus.',
      fait: !!(req.school.name && req.school.phone && req.school.address), lien: '/parametres', poids: 10,
    },
    {
      id: 'niveaux', titre: 'Définir les niveaux et classes', description: 'Créez la structure pédagogique (CI → Terminale) et les classes avec leur capacité.',
      fait: c('SELECT COUNT(*) FROM classes WHERE school_id=?', [s]) > 0, lien: '/scolaire/classes', poids: 15,
      detail: { valeur: c('SELECT COUNT(*) FROM classes WHERE school_id=?', [s]), unite: 'classes' },
    },
    {
      id: 'matieres', titre: 'Configurer les matières et coefficients', description: 'Indispensable pour le calcul automatique des moyennes et des bulletins.',
      fait: c('SELECT COUNT(*) FROM subjects WHERE school_id=?', [s]) > 0, lien: '/parametres/structure', poids: 10,
    },
    {
      id: 'eleves', titre: 'Importer les élèves', description: 'Import CSV depuis Excel ou saisie individuelle. Le matricule est généré automatiquement.',
      fait: c('SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN (\'radie\',\'abandon\')', [s]) > 0, lien: '/scolaire/eleves', poids: 20,
      detail: { valeur: c('SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN (\'radie\',\'abandon\')', [s]), unite: 'élèves' },
    },
    {
      id: 'parents', titre: 'Rattacher les parents/tuteurs', description: 'Le numéro de téléphone permet les alertes SMS (absences, impayés, bulletins).',
      fait: c('SELECT COUNT(*) FROM guardians WHERE school_id=? AND phone IS NOT NULL', [s]) > 0, lien: '/scolaire/familles', poids: 10,
    },
    {
      id: 'profs', titre: 'Créer les comptes enseignants', description: 'Chaque enseignant fait son appel et saisit ses notes en autonomie.',
      fait: c('SELECT COUNT(*) FROM users WHERE school_id=? AND role=\'enseignant\'', [s]) > 0, lien: '/parametres/utilisateurs', poids: 10,
    },
    {
      id: 'emploi', titre: 'Construire l\'emploi du temps', description: 'La grille hebdomadaire détecte automatiquement les conflits de profs et de salles.',
      fait: c('SELECT COUNT(*) FROM timetable_slots WHERE school_id=?', [s]) > 0, lien: '/scolaire/emploi-du-temps', poids: 10,
    },
    {
      id: 'frais', titre: 'Paramétrer les frais de scolarité', description: 'Scolarité, inscription, cantine, transport : définissez montants et échéances.',
      fait: c('SELECT COUNT(*) FROM fee_types WHERE school_id=?', [s]) > 0, lien: '/finance/frais', poids: 5,
    },
    {
      id: 'factures', titre: 'Générer les factures', description: 'Facturation en masse par classe ou par niveau, avec application automatique des réductions.',
      fait: c('SELECT COUNT(*) FROM invoices WHERE school_id=?', [s]) > 0, lien: '/finance/factures', poids: 5,
    },
    {
      id: 'appel', titre: 'Faire le premier appel', description: 'Testez l\'appel : il fonctionne aussi hors connexion et se synchronise ensuite.',
      fait: c('SELECT COUNT(*) FROM attendance_sessions WHERE school_id=?', [s]) > 0, lien: '/vie-scolaire/presences', poids: 5,
    },
  ];
  const total = steps.reduce((a, s2) => a + (s2.fait ? s2.poids : 0), 0);
  ok(res, { steps, progression: total, complet: total >= 100, premier_pas: steps.find((s2) => !s2.fait) || null });
});

export default router;

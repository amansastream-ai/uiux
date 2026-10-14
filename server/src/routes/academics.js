/**
 * SunuÉcole — Pédagogie : classes, matières, présences, notes, bulletins,
 * emploi du temps, cahier de textes, devoirs.
 *
 * Points d'attention UX/performance :
 *  - l'appel des présences accepte un envoi groupé (1 requête pour une classe) ;
 *  - les notes sont enregistrées en lot dans une transaction ;
 *  - les bulletins sont calculés et mis en base (pas recalculés à chaque lecture).
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, requireStaff, assertOwnership, assertFamilyAccess, scopedStudentIds, audit, teacherScope } from '../middleware/auth.js';
import { ok, created, paginate, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, addDays, round, money, likeParam, mentionFor } from '../lib/utils.js';
import { config } from '../config.js';

const router = Router();
router.use(authenticate, requireSchool);

const S = (req) => req.schoolId;

/* ================================================================== */
/* STRUCTURE : classes, matières, trimestres                           */
/* ================================================================== */
router.get('/classes', requireStaff, (req, res) => {
  const rows = db.all(
    `SELECT c.id, c.name, c.capacity, c.room, c.shift, c.color, c.is_active,
            l.id AS level_id, l.name AS niveau, l.cycle, l.seq, l.tuition,
            mt.id AS main_teacher_id, mt.first_name||' '||mt.last_name AS prof_principal,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=c.id AND st.status NOT IN ('radie','abandon')) AS effectif,
            (SELECT COUNT(*) FROM class_subjects cs WHERE cs.class_id=c.id) AS matieres,
            (SELECT ROUND(AVG(rc.general_avg),2) FROM report_cards rc WHERE rc.class_id=c.id AND rc.status='publie') AS moyenne
       FROM classes c
       LEFT JOIN levels l ON l.id=c.level_id
       LEFT JOIN staff mt ON mt.id=c.main_teacher_id
      WHERE c.school_id=? ORDER BY l.seq, c.name`, [S(req)]
  );
  ok(res, rows.map((r) => ({ ...r, taux_remplissage: r.capacity ? Math.round((r.effectif / r.capacity) * 100) : 0 })));
});

router.get('/classes/:id(\\d+)', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'classes', id);
  const cls = db.get(
    `SELECT c.*, l.name AS niveau, l.cycle, l.seq, mt.first_name||' '||mt.last_name AS prof_principal
       FROM classes c LEFT JOIN levels l ON l.id=c.level_id LEFT JOIN staff mt ON mt.id=c.main_teacher_id
      WHERE c.id=?`, [id]
  );
  const students = db.all(
    `SELECT st.id, st.matricule, st.first_name, st.last_name, st.gender, st.status,
            (SELECT rc.general_avg FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie' ORDER BY rc.id DESC LIMIT 1) AS moyenne,
            (SELECT COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard')) AS solde
       FROM students st WHERE st.class_id=? AND st.status NOT IN ('radie','abandon')
      ORDER BY st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE`, [id]
  );
  const subjects = db.all(
    `SELECT cs.id, cs.coefficient, cs.hours_per_week, sub.id AS subject_id, sub.name, sub.code, sub.color,
            st.id AS teacher_id, st.first_name||' '||st.last_name AS teacher
       FROM class_subjects cs JOIN subjects sub ON sub.id=cs.subject_id LEFT JOIN staff st ON st.id=cs.teacher_id
      WHERE cs.class_id=? ORDER BY cs.coefficient DESC, sub.name`, [id]
  );
  const stats = db.get(
    `SELECT ROUND(AVG(rc.general_avg),2) moyenne, MIN(rc.general_avg) min, MAX(rc.general_avg) max, COUNT(rc.id) n
       FROM report_cards rc WHERE rc.class_id=? AND rc.status='publie'`, [id]
  );
  const attendance = db.get(
    `SELECT ROUND(100.0*SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END)/COUNT(*),1) taux
       FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
      WHERE a.class_id=? AND a.session_date>=?`, [id, addDays(today(), -30)]
  );
  ok(res, { class: cls, students: students.map((s) => ({ ...s, solde: money(s.solde) })), subjects, stats, attendance });
});

router.get('/subjects', (req, res) => {
  ok(res, db.all('SELECT * FROM subjects WHERE school_id=? ORDER BY name', [S(req)]));
});

router.get('/terms', (req, res) => {
  ok(res, db.all('SELECT * FROM terms WHERE school_id=? ORDER BY seq', [S(req)]));
});

router.get('/levels', (req, res) => {
  ok(res, db.all('SELECT * FROM levels WHERE school_id=? ORDER BY seq', [S(req)]));
});

/* ================================================================== */
/* PRÉSENCES — appel rapide par classe                                 */
/* ================================================================== */

/** Renvoie la feuille d'appel : élèves de la classe + statut déjà saisi. */
router.get('/attendance/sheet', requireStaff, (req, res) => {
  const { class_id: classId, date, slot = 1 } = req.query;
  const d = String(date || today()).slice(0, 10);
  if (!classId) throw new HttpError(422, 'class_id requis.');
  assertOwnership(req, 'classes', Number(classId));

  const students = db.all(
    `SELECT st.id, st.matricule, st.first_name, st.last_name, st.gender, st.photo_url, st.status,
            (SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
              WHERE ar.student_id=st.id AND ar.status='absent' AND a.session_date>=?) AS absences_recentes,
            (SELECT aj.status FROM absence_justifications aj WHERE aj.student_id=st.id
              AND aj.date_from<=? AND aj.date_to>=? ORDER BY aj.id DESC LIMIT 1) AS justificatif
       FROM students st WHERE st.class_id=? AND st.status NOT IN ('radie','abandon','transfere')
      ORDER BY st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE`,
    [addDays(d, -30), d, d, Number(classId)]
  );

  const session = db.get(
    `SELECT a.*, c.name AS classe, sub.name AS matiere, st.first_name||' '||st.last_name AS enseignant
       FROM attendance_sessions a JOIN classes c ON c.id=a.class_id
       LEFT JOIN subjects sub ON sub.id=a.subject_id LEFT JOIN staff st ON st.id=a.teacher_id
      WHERE a.class_id=? AND a.session_date=? AND a.slot_index=?`, [Number(classId), d, Number(slot)]
  );
  const existing = session
    ? db.all('SELECT student_id, status, minutes_late, note FROM attendance_records WHERE session_id=?', [session.id])
    : [];
  const map = new Map(existing.map((e) => [e.student_id, e]));

  const cls = db.get('SELECT name, room FROM classes WHERE id=?', [Number(classId)]);
  const timetable = db.all(
    `SELECT ts.start_time, ts.end_time, sub.name AS matiere, sub.color
       FROM timetable_slots ts JOIN subjects sub ON sub.id=ts.subject_id
      WHERE ts.class_id=? AND ts.day_of_week=? ORDER BY ts.start_time`,
    [Number(classId), new Date(`${d}T12:00:00Z`).getUTCDay()]
  ).map((t, i) => ({ ...t, slot: i + 1 }));

  ok(res, {
    date: d,
    class: cls,
    session: session || null,
    students: students.map((s) => ({
      ...s,
      status: map.get(s.id)?.status || null,
      minutes_late: map.get(s.id)?.minutes_late || 0,
      note: map.get(s.id)?.note || null,
    })),
    timetable,
    stats: {
      total: students.length,
      presents: existing.filter((e) => e.status === 'present').length,
      absents: existing.filter((e) => e.status === 'absent').length,
      retards: existing.filter((e) => e.status === 'retard').length,
      excuses: existing.filter((e) => e.status === 'excuse').length,
    },
  });
});

/**
 * POST /api/academics/attendance — enregistre tout l'appel d'un coup.
 * body: { class_id, date, slot?, subject_id?, teacher_id?, records:[{student_id,status,minutes_late?,note?}], notify_parents? }
 */
router.post('/attendance', requireRole('direction', 'enseignant', 'censeur', 'secretaire', 'surveillant'), (req, res, next) => {
  try {
    const b = req.body || {};
    const classId = Number(b.class_id);
    const d = String(b.date || today()).slice(0, 10);
    const slot = Number(b.slot || 1);
    if (!classId || !Array.isArray(b.records) || !b.records.length) {
      throw new HttpError(422, 'class_id et records[] sont requis.');
    }
    assertOwnership(req, 'classes', classId);

    const scope = teacherScope(req);
    if (scope && !scope.classIds.includes(classId)) {
      throw new HttpError(403, 'Vous n\'enseignez pas dans cette classe.');
    }
    const teacher = scope?.staffId
      ? scope.staffId
      : (db.pluck('SELECT id FROM staff WHERE user_id=? AND school_id=?', [req.user.id, S(req)]) || b.teacher_id || null);

    const result = db.tx(() => {
      let sessionId = db.pluck(
        'SELECT id FROM attendance_sessions WHERE class_id=? AND session_date=? AND slot_index=?',
        [classId, d, slot]
      );
      if (!sessionId) {
        sessionId = db.insert(
          `INSERT INTO attendance_sessions (school_id, class_id, subject_id, teacher_id, session_date, slot_index,
              start_time, status, period_label, taken_at, taken_offline)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [S(req), classId, b.subject_id || null, teacher, d, slot, b.start_time || null,
            'validated', b.period_label || 'Appel', new Date().toISOString(), b.offline ? 1 : 0]
        );
      } else {
        db.run('UPDATE attendance_sessions SET teacher_id=?, subject_id=?, taken_at=?, status=\'validated\' WHERE id=?',
          [teacher, b.subject_id || null, new Date().toISOString(), sessionId]);
      }
      let counts = { present: 0, absent: 0, retard: 0, excuse: 0 };
      for (const r of b.records) {
        const status = ['present', 'absent', 'retard', 'excuse'].includes(r.status) ? r.status : 'present';
        counts[status] += 1;
        db.run(
          `INSERT INTO attendance_records (school_id, session_id, student_id, status, minutes_late, note)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(session_id, student_id) DO UPDATE SET status=excluded.status,
             minutes_late=excluded.minutes_late, note=excluded.note`,
          [S(req), sessionId, Number(r.student_id), status, Number(r.minutes_late) || 0, r.note || null]
        );
      }
      return { sessionId, counts };
    });

    // Notification automatique des parents (file SMS, non bloquante)
    let smsQueued = 0;
    if (b.notify_parents !== false) {
      const absents = b.records.filter((r) => r.status === 'absent' || (r.status === 'retard' && r.minutes_late > 15));
      for (const r of absents.slice(0, 200)) {
        const rows = db.all(
          `SELECT g.phone, g.sms_optin, st.first_name, st.last_name, st.id AS student_id
             FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
             JOIN students st ON st.id=sg.student_id
            WHERE sg.student_id=? AND sg.is_primary=1 AND g.phone IS NOT NULL AND g.sms_optin=1`, [Number(r.student_id)]
        );
        for (const g of rows) {
          const body = r.status === 'absent'
            ? `Bonjour, ${g.first_name} ${g.last_name} est absent(e) ce ${d} à ${req.school.name}. Merci de nous contacter.`
            : `Bonjour, ${g.first_name} ${g.last_name} est arrivé(e) en retard de ${r.minutes_late || 0} min ce ${d} à ${req.school.name}.`;
          db.run(
            `INSERT INTO sms_queue (school_id, to_number, body, recipient_name, student_id, template, status, provider, created_by)
             VALUES (?,?,?,?,?,?, 'en_attente', ?, ?)`,
            [S(req), g.phone, body, `${g.first_name} ${g.last_name}`, g.student_id,
              r.status === 'absent' ? 'absence' : 'retard', 'simule', req.user.id]
          );
          smsQueued += 1;
        }
      }
    }

    audit(req, 'create', 'attendance_session', result.sessionId,
      `Appel ${d} — ${result.counts.presents}P/${result.counts.absents}A/${result.counts.retards}R`);
    created(res, { session_id: result.sessionId, ...result, sms_queued: smsQueued });
  } catch (err) { next(err); }
});

/** Absences à l'échelle de l'établissement (page Vie scolaire). */
router.get('/attendance/absences', (req, res) => {
  const { date_from, date_to, class_id, student_id, status } = req.query;
  const where = ['a.school_id=?'];
  const params = [S(req)];
  if (date_from) { where.push('a.session_date>=?'); params.push(date_from); }
  if (date_to) { where.push('a.session_date<=?'); params.push(date_to); }
  if (class_id) { where.push('a.class_id=?'); params.push(Number(class_id)); }
  // Un parent ne consulte que les absences de ses propres enfants.
  const scopeIds = scopedStudentIds(req, student_id);
  if (scopeIds) {
    where.push(scopeIds.length ? `ar.student_id IN (${scopeIds.map(() => '?').join(',')})` : 'ar.student_id=-1');
    params.push(...scopeIds);
  }
  where.push("ar.status <> 'present'");
  if (status) { where.push('ar.status=?'); params.push(status); }

  const { rows, total } = paginate(req.query, {
    from: `attendance_records ar
      JOIN attendance_sessions a ON a.id=ar.session_id
      JOIN students st ON st.id=ar.student_id
      JOIN classes c ON c.id=a.class_id
      LEFT JOIN subjects sub ON sub.id=a.subject_id`,
    select: `ar.id, ar.status, ar.minutes_late, ar.note, a.session_date, a.period_label,
             st.id AS student_id, st.first_name, st.last_name, st.matricule,
             c.id AS class_id, c.name AS classe, sub.name AS matiere,
             (SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
               WHERE sg.student_id=st.id AND sg.is_primary=1 LIMIT 1) AS parent_tel,
             (SELECT aj.status FROM absence_justifications aj WHERE aj.student_id=st.id
               AND aj.date_from<=a.session_date AND aj.date_to>=a.session_date LIMIT 1) AS justificatif`,
    where, params, orderBy: 'a.session_date DESC, c.name, st.last_name',
  });
  res.json({ data: rows, meta: { total } });
});

/** Historique des appels (pour vérifier ce qui a été fait). */
router.get('/attendance/sessions', requireStaff, (req, res) => {
  const { class_id: classId, date } = req.query;
  const where = ['a.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('a.class_id=?'); params.push(Number(classId)); }
  if (date) { where.push('a.session_date=?'); params.push(date); }
  const { rows, total } = paginate(req.query, {
    from: 'attendance_sessions a JOIN classes c ON c.id=a.class_id LEFT JOIN staff st ON st.id=a.teacher_id',
    select: `a.*, c.name AS classe, st.first_name||' '||st.last_name AS enseignant,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id=a.id) AS saisis,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id=a.id AND ar.status='present') AS presents,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id=a.id AND ar.status='absent') AS absents`,
    where, params, orderBy: 'a.session_date DESC, a.slot_index',
  });
  res.json({ data: rows, meta: { total } });
});

/** Calendrier de présence type "GitHub" pour un élève. */
router.get('/attendance/heatmap/:studentId(\\d+)', (req, res) => {
  const id = Number(req.params.studentId);
  assertOwnership(req, 'students', id);
  assertFamilyAccess(req, id);
  const rows = db.all(
    `SELECT a.session_date AS date, ar.status FROM attendance_records ar
       JOIN attendance_sessions a ON a.id=ar.session_id
      WHERE ar.student_id=? AND a.session_date>=? ORDER BY a.session_date`, [id, addDays(today(), -120)]
  );
  ok(res, rows);
});

/* ================================================================== */
/* ABSENCES : justificatifs                                            */
/* ================================================================== */
router.get('/justifications', requireStaff, (req, res) => {
  const where = ['aj.school_id=?'];
  const params = [S(req)];
  if (req.query.statut) { where.push('aj.status=?'); params.push(req.query.statut); }
  const { rows, total } = paginate(req.query, {
    from: 'absence_justifications aj JOIN students st ON st.id=aj.student_id LEFT JOIN classes c ON c.id=st.class_id',
    select: 'aj.*, st.first_name, st.last_name, st.matricule, c.name AS classe',
    where, params, orderBy: 'aj.created_at DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/justifications', (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.student_id || !b.date_from) throw new HttpError(422, 'Élève et date de début requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const id = db.insert(
      `INSERT INTO absence_justifications (school_id, student_id, date_from, date_to, reason, reason_type, document, submitted_by, status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.student_id), b.date_from, b.date_to || b.date_from, b.reason || null,
        b.reason_type || 'autre', b.document || null, req.user.id, b.status || 'en_attente']
    );
    // Les absences couvertes deviennent automatiquement "excusées"
    if (b.status === 'acceptee' || req.user.role !== 'parent') {
      db.run(
        `UPDATE attendance_records SET status='excuse' WHERE student_id=? AND status='absent'
           AND session_id IN (SELECT id FROM attendance_sessions WHERE session_date BETWEEN ? AND ?)`,
        [Number(b.student_id), b.date_from, b.date_to || b.date_from]
      );
    }
    audit(req, 'create', 'justification', id, 'Justificatif d\'absence déposé');
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/justifications/:id(\\d+)', requireRole('direction', 'secretaire', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'absence_justifications', id);
    const status = req.body.status;
    if (!['acceptee', 'refusee', 'en_attente'].includes(status)) throw new HttpError(422, 'Statut invalide.');
    db.run('UPDATE absence_justifications SET status=?, reviewed_by=?, reviewed_at=datetime(\'now\') WHERE id=?',
      [status, req.user.id, id]);
    if (status === 'acceptee') {
      const j = db.get('SELECT * FROM absence_justifications WHERE id=?', [id]);
      db.run(
        `UPDATE attendance_records SET status='excuse' WHERE student_id=? AND status='absent'
           AND session_id IN (SELECT id FROM attendance_sessions WHERE session_date BETWEEN ? AND ?)`,
        [j.student_id, j.date_from, j.date_to]
      );
    }
    audit(req, 'update', 'justification', id, `Justificatif ${status}`);
    ok(res, { id, status });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* ÉVALUATIONS & NOTES                                                 */
/* ================================================================== */
router.get('/assessments', requireStaff, (req, res) => {
  const { class_id: classId, subject_id: subjectId, term_id: termId, status } = req.query;
  const where = ['a.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('a.class_id=?'); params.push(Number(classId)); }
  if (subjectId) { where.push('a.subject_id=?'); params.push(Number(subjectId)); }
  if (termId) { where.push('a.term_id=?'); params.push(Number(termId)); }
  if (status) { where.push('a.status=?'); params.push(status); }
  const scope = teacherScope(req);
  if (scope) { where.push('a.class_id IN (' + (scope.classIds.join(',') || '0') + ')'); }

  const { rows, total } = paginate(req.query, {
    from: 'assessments a JOIN classes c ON c.id=a.class_id JOIN subjects sub ON sub.id=a.subject_id LEFT JOIN terms t ON t.id=a.term_id',
    select: `a.*, c.name AS classe, sub.name AS matiere, sub.code, sub.color, t.name AS trimestre,
      (SELECT COUNT(*) FROM grades g WHERE g.assessment_id=a.id) AS notes_saisies,
      (SELECT COUNT(*) FROM students st WHERE st.class_id=a.class_id AND st.status NOT IN ('radie','abandon')) AS effectif,
      (SELECT ROUND(AVG(g.score),2) FROM grades g WHERE g.assessment_id=a.id AND g.is_absent=0) AS moyenne,
      (SELECT MAX(g.score) FROM grades g WHERE g.assessment_id=a.id) AS max,
      (SELECT MIN(g.score) FROM grades g WHERE g.assessment_id=a.id AND g.is_absent=0) AS min`,
    where, params, orderBy: 'a.assess_date DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/assessments', requireRole('direction', 'enseignant', 'censeur'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.class_id || !b.subject_id || !b.name) throw new HttpError(422, 'Classe, matière et intitulé requis.');
    assertOwnership(req, 'classes', Number(b.class_id));
    const term = b.term_id || db.pluck('SELECT id FROM terms WHERE school_id=? AND is_current=1', [S(req)]);
    const teacher = teacherScope(req)?.staffId || b.teacher_id || null;
    const id = db.insert(
      `INSERT INTO assessments (school_id, class_id, subject_id, term_id, name, type, assess_date, max_score, coefficient, teacher_id, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.class_id), Number(b.subject_id), term || null, b.name, b.type || 'devoir',
        b.assess_date || today(), Number(b.max_score) || 20, Number(b.coefficient) || 1, teacher, b.status || 'draft']
    );
    // Pré-crée une ligne de note par élève : la grille est prête à saisir
    const students = db.all('SELECT id FROM students WHERE class_id=? AND status NOT IN (\'radie\',\'abandon\')', [Number(b.class_id)]);
    db.tx(() => {
      for (const s of students) {
        db.run('INSERT OR IGNORE INTO grades (school_id, assessment_id, student_id) VALUES (?,?,?)', [S(req), id, s.id]);
      }
    });
    audit(req, 'create', 'assessment', id, `Création de l'évaluation « ${b.name} »`);
    created(res, { id, effectif: students.length });
  } catch (err) { next(err); }
});

/** Grille de saisie : élèves + notes existantes en une requête. */
router.get('/assessments/:id(\\d+)/grades', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'assessments', id);
  const a = db.get(
    `SELECT a.*, c.name AS classe, sub.name AS matiere, sub.color, sub.code, t.name AS trimestre
       FROM assessments a JOIN classes c ON c.id=a.class_id JOIN subjects sub ON sub.id=a.subject_id
       LEFT JOIN terms t ON t.id=a.term_id WHERE a.id=?`, [id]
  );
  const students = db.all(
    `SELECT st.id, st.matricule, st.first_name, st.last_name, st.gender, g.score, g.is_absent, g.bonus, g.comment
       FROM students st LEFT JOIN grades g ON g.student_id=st.id AND g.assessment_id=?
      WHERE st.class_id=? AND st.status NOT IN ('radie','abandon')
      ORDER BY st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE`, [id, a.class_id]
  );
  const scores = students.map((s) => s.score).filter((v) => v != null);
  ok(res, {
    assessment: a,
    students,
    stats: {
      effectif: students.length,
      saisis: scores.length,
      moyenne: scores.length ? round(scores.reduce((x, y) => x + y, 0) / scores.length, 2) : null,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      reussite: scores.length ? round((scores.filter((v) => v >= a.max_score / 2).length / scores.length) * 100, 1) : null,
    },
  });
});

/** Enregistrement en lot des notes (transaction unique). */
router.post('/assessments/:id(\\d+)/grades', requireRole('direction', 'enseignant', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'assessments', id);
    const a = db.get('SELECT * FROM assessments WHERE id=?', [id]);
    const grades = Array.isArray(req.body.grades) ? req.body.grades : [];
    if (!grades.length) throw new HttpError(422, 'Aucune note transmise.');

    const invalid = grades.filter((g) => g.score != null && (Number(g.score) < 0 || Number(g.score) > a.max_score));
    if (invalid.length) {
      throw new HttpError(422, `${invalid.length} note(s) hors barème (0 à ${a.max_score}).`, { invalid });
    }
    let saved = 0;
    db.tx(() => {
      for (const g of grades) {
        db.run(
          `INSERT INTO grades (school_id, assessment_id, student_id, score, is_absent, bonus, comment, updated_at)
           VALUES (?,?,?,?,?,?,?, datetime('now'))
           ON CONFLICT(assessment_id, student_id) DO UPDATE SET
             score=excluded.score, is_absent=excluded.is_absent, bonus=excluded.bonus,
             comment=excluded.comment, updated_at=datetime('now')`,
          [S(req), id, Number(g.student_id), g.score === null || g.score === '' ? null : Number(g.score),
            g.is_absent ? 1 : 0, Number(g.bonus) || 0, g.comment || null]
        );
        saved += 1;
      }
      if (req.body.publish) db.run("UPDATE assessments SET status='published' WHERE id=?", [id]);
    });
    audit(req, 'update', 'assessment', id, `${saved} notes enregistrées`);
    ok(res, { saved, published: !!req.body.publish });
  } catch (err) { next(err); }
});

router.patch('/assessments/:id(\\d+)', requireRole('direction', 'enseignant', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'assessments', id);
    const allowed = ['name', 'type', 'assess_date', 'max_score', 'coefficient', 'status', 'counts_for'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    if (sets.length) { params.push(id); db.run(`UPDATE assessments SET ${sets.join(', ')} WHERE id=?`, params); }
    audit(req, 'update', 'assessment', id, 'Évaluation modifiée');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/assessments/:id(\\d+)', requireRole('direction', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'assessments', id);
    db.tx(() => {
      db.run('DELETE FROM grades WHERE assessment_id=?', [id]);
      db.run('DELETE FROM assessments WHERE id=?', [id]);
    });
    audit(req, 'delete', 'assessment', id, 'Évaluation supprimée');
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Résultats consolidés d'une classe : classement + moyennes par matière. */
router.get('/class-results', requireStaff, (req, res) => {
  const { class_id: classId, term_id: termId } = req.query;
  if (!classId) throw new HttpError(422, 'class_id requis.');
  assertOwnership(req, 'classes', Number(classId));
  const tid = Number(termId) || db.pluck('SELECT id FROM terms WHERE school_id=? AND is_current=1', [S(req)]);
  const cls = db.get('SELECT c.*, l.name AS niveau FROM classes c LEFT JOIN levels l ON l.id=c.level_id WHERE c.id=?', [Number(classId)]);
  const subjects = db.all(
    `SELECT sub.id, sub.name, sub.code, sub.color, cs.coefficient
       FROM class_subjects cs JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.class_id=? ORDER BY cs.coefficient DESC`,
    [Number(classId)]
  );
  const students = db.all(
    `SELECT st.id, st.matricule, st.first_name, st.last_name, st.gender FROM students st
      WHERE st.class_id=? AND st.status NOT IN ('radie','abandon')
      ORDER BY st.last_name COLLATE NOCASE`, [Number(classId)]
  );

  const computed = students.map((st) => {
    let weighted = 0;
    let coefSum = 0;
    const bySubject = {};
    for (const sub of subjects) {
      const row = db.get(
        `SELECT AVG(g.score) avg FROM grades g JOIN assessments a ON a.id=g.assessment_id
          WHERE a.class_id=? AND a.subject_id=? AND a.term_id=? AND g.student_id=? AND g.is_absent=0 AND a.counts_for=1`,
        [Number(classId), sub.id, tid, st.id]
      );
      if (row?.avg != null) {
        bySubject[sub.id] = round(row.avg, 2);
        weighted += row.avg * sub.coefficient;
        coefSum += sub.coefficient;
      }
    }
    const general = coefSum ? round(weighted / coefSum, 2) : null;
    return { ...st, general, bySubject, coefSum };
  });
  const ranked = computed.filter((c) => c.general != null).sort((a, b) => b.general - a.general);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const avgs = ranked.map((r) => r.general);
  const scale = req.school.settings?.gradingScale || config.schoolDefaults.gradingScale;

  ok(res, {
    class: cls,
    term: db.get('SELECT id, name, seq FROM terms WHERE id=?', [tid]),
    subjects,
    students: computed.map((c) => ({
      ...c, mention: c.general != null ? mentionFor(c.general, scale) : null,
      appreciation: c.general == null ? null : c.general >= 14 ? 'Félicitations' : c.general >= 12 ? 'Encouragements' : c.general >= 10 ? 'Avertissement de travail' : 'Avertissement sérieux',
    })),
    stats: {
      effectif: students.length, notes: ranked.length,
      moyenne_classe: avgs.length ? round(avgs.reduce((a, b) => a + b, 0) / avgs.length, 2) : null,
      min: avgs.length ? Math.min(...avgs) : null,
      max: avgs.length ? Math.max(...avgs) : null,
      reussite: avgs.length ? round((avgs.filter((v) => v >= 10).length / avgs.length) * 100, 1) : null,
      par_matiere: subjects.map((sub) => {
        const vals = computed.map((c) => c.bySubject[sub.id]).filter((v) => v != null);
        return { ...sub, moyenne: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, 2) : null, reussite: vals.length ? round((vals.filter((v) => v >= 10).length / vals.length) * 100, 1) : null };
      }),
    },
  });
});

/* ================================================================== */
/* BULLETINS                                                           */
/* ================================================================== */

/** Génère (ou régénère) les bulletins d'une classe pour un trimestre. */
router.post('/report-cards/generate', requireRole('direction', 'censeur', 'secretaire'), (req, res, next) => {
  try {
    const { class_id: classId, term_id: termId } = req.body || {};
    if (!classId) throw new HttpError(422, 'class_id requis.');
    assertOwnership(req, 'classes', Number(classId));
    const tid = Number(termId) || db.pluck('SELECT id FROM terms WHERE school_id=? AND is_current=1', [S(req)]);
    const term = db.get('SELECT * FROM terms WHERE id=?', [tid]);
    if (!term) throw new HttpError(404, 'Trimestre introuvable.');
    const cls = db.get('SELECT * FROM classes WHERE id=?', [Number(classId)]);
    const subjects = db.all(
      `SELECT sub.id, sub.name, sub.code, sub.color, cs.coefficient, cs.teacher_id
         FROM class_subjects cs JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.class_id=?`, [Number(classId)]
    );
    const students = db.all(
      `SELECT * FROM students WHERE class_id=? AND status NOT IN ('radie','abandon')`, [Number(classId)]
    );
    const scale = req.school.settings?.gradingScale || config.schoolDefaults.gradingScale;

    const generated = db.tx(() => {
      // 1) moyennes par élève et par matière
      const perStudent = students.map((st) => {
        const subjectAvgs = [];
        let weighted = 0;
        let coefSum = 0;
        for (const sub of subjects) {
          const row = db.get(
            `SELECT AVG(g.score) avg FROM grades g JOIN assessments a ON a.id=g.assessment_id
              WHERE a.class_id=? AND a.subject_id=? AND a.term_id=? AND g.student_id=? AND g.is_absent=0 AND a.counts_for=1`,
            [Number(classId), sub.id, tid, st.id]
          );
          if (row?.avg == null) continue;
          const avg = round(row.avg, 2);
          subjectAvgs.push({ subject_id: sub.id, subject: sub.name, code: sub.code, color: sub.color, avg, coef: sub.coefficient, teacher_id: sub.teacher_id });
          weighted += avg * sub.coefficient;
          coefSum += sub.coefficient;
        }
        return { st, general: coefSum ? round(weighted / coefSum, 2) : null, subjectAvgs, coefSum };
      });
      // 2) statistiques par matière (moyenne/min/max/rang de classe)
      for (const p of perStudent) {
        for (const sa of p.subjectAvgs) {
          const all = perStudent.map((x) => x.subjectAvgs.find((y) => y.subject_id === sa.subject_id)?.avg).filter((v) => v != null);
          sa.class_avg = all.length ? round(all.reduce((a, b) => a + b, 0) / all.length, 2) : null;
          sa.min = all.length ? round(Math.min(...all), 2) : null;
          sa.max = all.length ? round(Math.max(...all), 2) : null;
          sa.rank = all.slice().sort((a, b) => b - a).indexOf(sa.avg) + 1;
          sa.appreciation = sa.avg >= 16 ? 'Excellent travail, continuez ainsi.'
            : sa.avg >= 14 ? 'Très bon trimestre, de réelles capacités.'
            : sa.avg >= 12 ? 'Bon ensemble, peut mieux faire avec plus de rigueur.'
            : sa.avg >= 10 ? 'Travail correct mais résultats fragiles.'
            : sa.avg >= 8 ? 'Résultats insuffisants : fournir un effort soutenu.'
            : 'Très insuffisant. Un suivi à la maison est indispensable.';
        }
      }
      // 3) classement + présence + insertion
      const ranked = perStudent.filter((p) => p.general != null).sort((a, b) => b.general - a.general);
      let n = 0;
      for (const p of perStudent) {
        const rankIdx = ranked.findIndex((r) => r.st.id === p.st.id);
        const att = db.get(
          `SELECT COUNT(*) total, SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) presents,
                  SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) absents
             FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
            WHERE ar.student_id=? AND a.session_date BETWEEN ? AND ?`, [p.st.id, term.start_date, term.end_date]
        );
        const general = p.general;
        db.run(
          `INSERT INTO report_cards (school_id, student_id, term_id, class_id, general_avg, subject_avgs_json,
              rank, total_students, attendance_pct, absences_hours, mention, teacher_comment, principal_comment,
              status, generated_at, validated_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'brouillon', datetime('now'), ?)
           ON CONFLICT(student_id, term_id) DO UPDATE SET
             general_avg=excluded.general_avg, subject_avgs_json=excluded.subject_avgs_json,
             rank=excluded.rank, total_students=excluded.total_students, attendance_pct=excluded.attendance_pct,
             absences_hours=excluded.absences_hours, mention=excluded.mention, generated_at=datetime('now'),
             teacher_comment=COALESCE(report_cards.teacher_comment, excluded.teacher_comment)`,
          [S(req), p.st.id, tid, Number(classId), general, JSON.stringify(p.subjectAvgs),
            rankIdx >= 0 ? rankIdx + 1 : null, ranked.length,
            att?.total ? round((att.presents / att.total) * 100, 1) : null,
            (att?.absents || 0) * 5,
            general != null ? mentionFor(general, scale) : null,
            general == null ? 'Aucune note saisie pour ce trimestre.'
              : general >= 14 ? 'Trimestre réussi. Félicitations du conseil de classe.'
              : general >= 12 ? 'Bon trimestre dans l\'ensemble. Encouragements.'
              : general >= 10 ? 'Trimestre satisfaisant mais perfectible.'
              : general >= 8 ? 'Résultats justes. Un travail personnel plus régulier est attendu.'
              : 'Avertissement de travail : résultats très insuffisants.',
            req.user.id]
        );
        // Appréciations par matière (modifiables ensuite par l'enseignant)
        for (const sa of p.subjectAvgs) {
          db.run(
            `INSERT INTO subject_appreciations (school_id, student_id, term_id, subject_id, teacher_id, appreciation)
             VALUES (?,?,?,?,?,?) ON CONFLICT(student_id, term_id, subject_id) DO NOTHING`,
            [S(req), p.st.id, tid, sa.subject_id, sa.teacher_id, sa.appreciation]
          );
        }
        n += 1;
      }
      return n;
    });
    audit(req, 'create', 'report_card', classId, `Génération de ${generated} bulletins (${cls.name}, ${term.name})`);
    created(res, { generated, class: cls.name, term: term.name });
  } catch (err) { next(err); }
});

router.get('/report-cards', requireStaff, (req, res) => {
  const { class_id: classId, term_id: termId, status } = req.query;
  const where = ['rc.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('rc.class_id=?'); params.push(Number(classId)); }
  if (termId) { where.push('rc.term_id=?'); params.push(Number(termId)); }
  if (status) { where.push('rc.status=?'); params.push(status); }
  const { rows, total } = paginate(req.query, {
    from: 'report_cards rc JOIN students st ON st.id=rc.student_id JOIN classes c ON c.id=rc.class_id JOIN terms t ON t.id=rc.term_id',
    select: 'rc.id, rc.student_id, rc.general_avg, rc.rank, rc.total_students, rc.mention, rc.status, rc.attendance_pct, st.first_name, st.last_name, st.matricule, c.name AS classe, t.name AS trimestre',
    where, params, orderBy: 'rc.rank IS NULL, rc.rank',
  });
  res.json({ data: rows, meta: { total } });
});

/** Bulletin imprimable complet (données + entête établissement). */
router.get('/report-cards/student/:studentId(\\d+)', (req, res) => {
  const studentId = Number(req.params.studentId);
  assertOwnership(req, 'students', studentId);
  assertFamilyAccess(req, studentId);
  const termId = Number(req.query.term_id) || db.pluck('SELECT id FROM terms WHERE school_id=? AND is_current=1', [S(req)]);
  const student = db.get(
    `SELECT st.id, st.first_name, st.last_name, st.matricule, st.gender, st.birth_date, st.birth_place,
            c.name AS classe, l.name AS niveau, mt.first_name||' '||mt.last_name AS prof_principal
       FROM students st LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN levels l ON l.id=c.level_id
       LEFT JOIN staff mt ON mt.id=c.main_teacher_id WHERE st.id=?`, [studentId]
  );
  if (!student) throw new HttpError(404, 'Élève introuvable.');
  const card = db.get(
    `SELECT rc.*, t.name AS trimestre, t.seq FROM report_cards rc JOIN terms t ON t.id=rc.term_id
      WHERE rc.student_id=? AND rc.term_id=?`, [studentId, termId]
  );
  const appreciations = db.all(
    `SELECT sa.*, sub.name AS matiere, sub.color FROM subject_appreciations sa JOIN subjects sub ON sub.id=sa.subject_id
      WHERE sa.student_id=? AND sa.term_id=?`, [studentId, termId]
  );
  const history = db.all(
    `SELECT rc.general_avg, rc.rank, rc.total_students, rc.mention, t.name AS trimestre, t.seq
       FROM report_cards rc JOIN terms t ON t.id=rc.term_id WHERE rc.student_id=? ORDER BY t.seq`, [studentId]
  );
  // Comparaison avec la classe
  const classStats = card
    ? db.get(
        `SELECT ROUND(AVG(general_avg),2) moyenne_classe, MIN(general_avg) min, MAX(general_avg) max, COUNT(*) n
           FROM report_cards WHERE class_id=? AND term_id=? AND general_avg IS NOT NULL`, [card.class_id, termId]
      )
    : null;
  const guardian = db.get(
    `SELECT g.first_name, g.last_name, g.phone, g.profession FROM student_guardians sg
       JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=? AND sg.is_primary=1`, [studentId]
  );
  ok(res, {
    school: {
      name: req.school.name, address: req.school.address, city: req.school.city, phone: req.school.phone,
      email: req.school.email, academicYear: req.school.academic_year, headName: req.school.head_name,
      footer: req.school.settings?.reportCardFooter || '', logo: req.school.logo_url, ninea: req.school.ninea,
    },
    student, card: card ? parseJsonFields(card, ['subject_avgs_json']) : null,
    appreciations, history, classStats, guardian,
    scale: req.school.settings?.gradingScale || config.schoolDefaults.gradingScale,
  });
});

router.patch('/report-cards/:id(\\d+)', requireRole('direction', 'censeur', 'enseignant'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'report_cards', id);
    const allowed = ['teacher_comment', 'principal_comment', 'status'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    if (req.body.status === 'publie') sets.push('published_at=datetime(\'now\')');
    if (sets.length) { params.push(id); db.run(`UPDATE report_cards SET ${sets.join(', ')} WHERE id=?`, params); }
    audit(req, 'update', 'report_card', id, `Bulletin ${req.body.status || 'modifié'}`);
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Publication en masse d'une classe (avec notification parents). */
router.post('/report-cards/publish', requireRole('direction', 'censeur'), (req, res, next) => {
  try {
    const { class_id: classId, term_id: termId, notify = true } = req.body || {};
    const where = ['school_id=?', "status<>'publie'"];
    const params = [S(req)];
    if (classId) { where.push('class_id=?'); params.push(Number(classId)); }
    if (termId) { where.push('term_id=?'); params.push(Number(termId)); }
    const cards = db.all(`SELECT id, student_id FROM report_cards WHERE ${where.join(' AND ')}`, params);
    db.tx(() => {
      for (const c of cards) db.run("UPDATE report_cards SET status='publie', published_at=datetime('now') WHERE id=?", [c.id]);
    });
    if (notify) {
      for (const c of cards) {
        const rows = db.all(
          `SELECT g.phone, st.first_name FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
             JOIN students st ON st.id=sg.student_id WHERE sg.student_id=? AND sg.is_primary=1 AND g.phone IS NOT NULL`, [c.student_id]
        );
        for (const g of rows) {
          db.run(
            `INSERT INTO sms_queue (school_id, to_number, body, student_id, template, status, provider)
             VALUES (?,?,?,?, 'note', 'en_attente', 'simule')`,
            [S(req), g.phone, `Bonjour, le bulletin de ${g.first_name} est disponible sur le portail ${req.school.name}.`]
          );
        }
      }
    }
    audit(req, 'update', 'report_card', classId, `Publication de ${cards.length} bulletins`);
    ok(res, { published: cards.length });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* EMPLOI DU TEMPS                                                     */
/* ================================================================== */
router.get('/timetable', (req, res) => {
  const { class_id: classId, teacher_id: teacherId } = req.query;
  const where = ['ts.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('ts.class_id=?'); params.push(Number(classId)); }
  if (teacherId) { where.push('ts.teacher_id=?'); params.push(Number(teacherId)); }
  const rows = db.all(
    `SELECT ts.*, c.name AS classe, sub.name AS matiere, sub.code, sub.color,
            st.first_name||' '||st.last_name AS enseignant, st.id AS staff_id
       FROM timetable_slots ts JOIN classes c ON c.id=ts.class_id JOIN subjects sub ON sub.id=ts.subject_id
       LEFT JOIN staff st ON st.id=ts.teacher_id
      WHERE ${where.join(' AND ')} ORDER BY ts.day_of_week, ts.start_time`, params
  );
  // Grille horaire utilisée par l'école (déduite des créneaux existants)
  const hours = [...new Set(rows.map((r) => r.start_time))].sort();
  ok(res, { slots: rows, hours, days: [1, 2, 3, 4, 5, 6] });
});

router.post('/timetable', requireRole('direction', 'censeur', 'secretaire'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.class_id || !b.subject_id || !b.day_of_week || !b.start_time || !b.end_time) {
      throw new HttpError(422, 'Classe, matière, jour et horaires requis.');
    }
    // Détection des conflits (prof, salle, classe)
    const conflicts = [];
    if (b.teacher_id) {
      const c = db.get(
        `SELECT ts.id, cl.name AS classe FROM timetable_slots ts JOIN classes cl ON cl.id=ts.class_id
          WHERE ts.teacher_id=? AND ts.day_of_week=? AND ts.start_time<? AND ts.end_time>? AND ts.id<>?`,
        [Number(b.teacher_id), Number(b.day_of_week), b.end_time, b.start_time, Number(b.id) || -1]
      );
      if (c) conflicts.push({ type: 'teacher', message: `L'enseignant est déjà en ${c.classe} sur ce créneau.` });
    }
    const sameClass = db.get(
      `SELECT id FROM timetable_slots WHERE class_id=? AND day_of_week=? AND start_time<? AND end_time>? AND id<>?`,
      [Number(b.class_id), Number(b.day_of_week), b.end_time, b.start_time, Number(b.id) || -1]
    );
    if (sameClass) conflicts.push({ type: 'class', message: 'Cette classe a déjà cours sur ce créneau.' });
    if (b.room) {
      const sameRoom = db.get(
        `SELECT id FROM timetable_slots WHERE room=? AND day_of_week=? AND start_time<? AND end_time>? AND id<>?`,
        [b.room, Number(b.day_of_week), b.end_time, b.start_time, Number(b.id) || -1]
      );
      if (sameRoom) conflicts.push({ type: 'room', message: `La salle ${b.room} est déjà occupée.` });
    }
    if (conflicts.length && !b.force) throw new HttpError(409, 'Conflits détectés dans l\'emploi du temps.', { conflicts });

    if (b.id) {
      assertOwnership(req, 'timetable_slots', Number(b.id));
      db.run(
        `UPDATE timetable_slots SET class_id=?, subject_id=?, teacher_id=?, day_of_week=?, start_time=?, end_time=?, room=?, note=? WHERE id=?`,
        [Number(b.class_id), Number(b.subject_id), b.teacher_id || null, Number(b.day_of_week), b.start_time, b.end_time, b.room || null, b.note || null, Number(b.id)]
      );
      audit(req, 'update', 'timetable_slot', b.id, 'Créneau modifié');
      return ok(res, { id: Number(b.id), conflicts });
    }
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    const id = db.insert(
      `INSERT INTO timetable_slots (school_id, year_id, class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [S(req), year, Number(b.class_id), Number(b.subject_id), b.teacher_id || null, Number(b.day_of_week),
        b.start_time, b.end_time, b.room || null, b.note || null]
    );
    audit(req, 'create', 'timetable_slot', id, 'Créneau ajouté');
    created(res, { id, conflicts });
  } catch (err) { next(err); }
});

router.delete('/timetable/:id(\\d+)', requireRole('direction', 'censeur', 'secretaire'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'timetable_slots', id);
    db.run('DELETE FROM timetable_slots WHERE id=?', [id]);
    audit(req, 'delete', 'timetable_slot', id, 'Créneau supprimé');
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Détection proactive de tous les conflits (page emploi du temps). */
router.get('/timetable-conflicts', requireStaff, (req, res) => {
  const teachers = db.all(
    `SELECT t1.id, st.first_name||' '||st.last_name AS enseignant, t1.day_of_week, t1.start_time, t1.end_time,
            c1.name AS classe1, c2.name AS classe2, t1.teacher_id
       FROM timetable_slots t1
       JOIN timetable_slots t2 ON t1.teacher_id=t2.teacher_id AND t1.day_of_week=t2.day_of_week
         AND t1.start_time=t2.start_time AND t1.id<t2.id
       JOIN classes c1 ON c1.id=t1.class_id JOIN classes c2 ON c2.id=t2.class_id
       JOIN staff st ON st.id=t1.teacher_id
      WHERE t1.school_id=?`, [S(req)]
  );
  const rooms = db.all(
    `SELECT t1.id, t1.room, t1.day_of_week, t1.start_time, c1.name AS classe1, c2.name AS classe2
       FROM timetable_slots t1 JOIN timetable_slots t2 ON t1.room=t2.room AND t1.day_of_week=t2.day_of_week
         AND t1.start_time=t2.start_time AND t1.id<t2.id
       JOIN classes c1 ON c1.id=t1.class_id JOIN classes c2 ON c2.id=t2.class_id
      WHERE t1.school_id=? AND t1.room IS NOT NULL`, [S(req)]
  );
  const unassigned = db.all(
    `SELECT ts.id, c.name AS classe, sub.name AS matiere, ts.day_of_week, ts.start_time
       FROM timetable_slots ts JOIN classes c ON c.id=ts.class_id JOIN subjects sub ON sub.id=ts.subject_id
      WHERE ts.school_id=? AND ts.teacher_id IS NULL`, [S(req)]
  );
  ok(res, { teachers, rooms, unassigned, total: teachers.length + rooms.length });
});

/* ================================================================== */
/* CAHIER DE TEXTES & DEVOIRS                                          */
/* ================================================================== */
router.get('/lessons', (req, res) => {
  const { class_id: classId, subject_id: subjectId, date_from: dateFrom } = req.query;
  const where = ['ll.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('ll.class_id=?'); params.push(Number(classId)); }
  if (subjectId) { where.push('ll.subject_id=?'); params.push(Number(subjectId)); }
  if (dateFrom) { where.push('ll.lesson_date>=?'); params.push(dateFrom); }
  const scope = teacherScope(req);
  if (scope) where.push(`ll.class_id IN (${scope.classIds.join(',') || '0'})`);
  const { rows, total } = paginate(req.query, {
    from: 'lesson_logs ll JOIN classes c ON c.id=ll.class_id JOIN subjects sub ON sub.id=ll.subject_id LEFT JOIN staff st ON st.id=ll.teacher_id',
    select: 'll.*, c.name AS classe, sub.name AS matiere, sub.color, st.first_name||\' \'||st.last_name AS enseignant',
    where, params, orderBy: 'll.lesson_date DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/lessons', requireRole('direction', 'enseignant', 'censeur'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.class_id || !b.subject_id) throw new HttpError(422, 'Classe et matière requises.');
    const teacher = teacherScope(req)?.staffId || b.teacher_id || null;
    const id = db.insert(
      `INSERT INTO lesson_logs (school_id, class_id, subject_id, teacher_id, lesson_date, duration_min, title, content, objective, homework, progress_pct)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.class_id), Number(b.subject_id), teacher, b.lesson_date || today(),
        Number(b.duration_min) || 55, b.title || null, b.content || null, b.objective || null,
        b.homework || null, Number(b.progress_pct) || 0]
    );
    audit(req, 'create', 'lesson_log', id, 'Séance enregistrée dans le cahier de textes');
    created(res, { id });
  } catch (err) { next(err); }
});

router.get('/homework', (req, res) => {
  const { class_id: classId, student_id: studentId } = req.query;
  const where = ['h.school_id=?'];
  const params = [S(req)];
  if (classId) { where.push('h.class_id=?'); params.push(Number(classId)); }
  if (studentId) { where.push('h.class_id=(SELECT class_id FROM students WHERE id=?)'); params.push(Number(studentId)); }
  const scope = teacherScope(req);
  if (scope) where.push(`h.class_id IN (${scope.classIds.join(',') || '0'})`);
  const { rows, total } = paginate(req.query, {
    from: 'homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id LEFT JOIN staff st ON st.id=h.teacher_id',
    select: `h.*, c.name AS classe, sub.name AS matiere, sub.color, st.first_name||' '||st.last_name AS enseignant,
      (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.status IN ('rendu','en_retard')) AS rendus,
      (SELECT COUNT(*) FROM students s WHERE s.class_id=h.class_id AND s.status NOT IN ('radie','abandon')) AS effectif,
      (SELECT ROUND(AVG(hs.score),1) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.score IS NOT NULL) AS moyenne`,
    where, params, orderBy: 'h.due_date DESC',
  });
  res.json({ data: rows.map((r) => ({ ...r, retard: r.due_date < today() && r.rendus < r.effectif })), meta: { total } });
});

router.post('/homework', requireRole('direction', 'enseignant'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.class_id || !b.subject_id || !b.title) throw new HttpError(422, 'Classe, matière et titre requis.');
    const teacher = teacherScope(req)?.staffId || b.teacher_id || null;
    const id = db.insert(
      `INSERT INTO homework (school_id, class_id, subject_id, teacher_id, title, description, assigned_at, due_date, estimated_min, is_graded, attachments_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.class_id), Number(b.subject_id), teacher, b.title, b.description || null,
        today(), b.due_date || addDays(today(), 7), Number(b.estimated_min) || 30, b.is_graded ? 1 : 0,
        JSON.stringify(b.attachments || [])]
    );
    // Prépare le suivi des rendus pour chaque élève
    const students = db.all('SELECT id FROM students WHERE class_id=? AND status NOT IN (\'radie\',\'abandon\')', [Number(b.class_id)]);
    db.tx(() => {
      for (const s of students) {
        db.run("INSERT OR IGNORE INTO homework_submissions (homework_id, student_id, status) VALUES (?,?,'a_rendre')", [id, s.id]);
      }
    });
    audit(req, 'create', 'homework', id, `Devoir « ${b.title} » donné`);
    created(res, { id, effectif: students.length });
  } catch (err) { next(err); }
});

router.get('/homework/:id(\\d+)', requireStaff, (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'homework', id);
  const hw = db.get(
    `SELECT h.*, c.name AS classe, sub.name AS matiere, sub.color, st.first_name||' '||st.last_name AS enseignant
       FROM homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id
       LEFT JOIN staff st ON st.id=h.teacher_id WHERE h.id=?`, [id]
  );
  const submissions = db.all(
    `SELECT hs.*, s.first_name, s.last_name, s.matricule FROM homework_submissions hs
       JOIN students s ON s.id=hs.student_id WHERE hs.homework_id=?
      ORDER BY CASE hs.status WHEN 'manquant' THEN 0 WHEN 'en_retard' THEN 1 WHEN 'a_rendre' THEN 2 ELSE 3 END, s.last_name`, [id]
  );
  ok(res, { homework: parseJsonFields(hw, ['attachments_json']), submissions });
});

router.post('/homework/:id(\\d+)/grade', requireRole('direction', 'enseignant'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'homework', id);
    const items = Array.isArray(req.body.submissions) ? req.body.submissions : [];
    db.tx(() => {
      for (const it of items) {
        db.run(
          `UPDATE homework_submissions SET status=?, score=?, feedback=?, submitted_at=COALESCE(submitted_at, datetime('now'))
            WHERE homework_id=? AND student_id=?`,
          [it.status || 'rendu', it.score ?? null, it.feedback || null, id, Number(it.student_id)]
        );
      }
    });
    audit(req, 'update', 'homework', id, `${items.length} rendus évalués`);
    ok(res, { graded: items.length });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* DISCIPLINE                                                          */
/* ================================================================== */
router.get('/discipline', requireStaff, (req, res) => {
  const { student_id: studentId, status, severity, class_id: classId } = req.query;
  const where = ['di.school_id=?'];
  const params = [S(req)];
  if (studentId) { where.push('di.student_id=?'); params.push(Number(studentId)); }
  if (status) { where.push('di.status=?'); params.push(status); }
  if (severity) { where.push('di.severity=?'); params.push(severity); }
  if (classId) { where.push('st.class_id=?'); params.push(Number(classId)); }
  const { rows, total } = paginate(req.query, {
    from: 'discipline_incidents di JOIN students st ON st.id=di.student_id JOIN classes c ON c.id=st.class_id LEFT JOIN staff rp ON rp.id=di.reported_by',
    select: `di.*, st.first_name, st.last_name, st.matricule, c.name AS classe, rp.first_name||' '||rp.last_name AS declarant`,
    where, params, orderBy: 'di.incident_date DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/discipline', requireRole('direction', 'enseignant', 'censeur', 'surveillant'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.student_id || !b.type) throw new HttpError(422, 'Élève et type d\'incident requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const reporter = teacherScope(req)?.staffId || b.reported_by || null;
    const id = db.insert(
      `INSERT INTO discipline_incidents (school_id, student_id, incident_date, type, severity, description, location, reported_by, sanction, sanction_days, status, parents_notified)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.student_id), b.incident_date || today(), b.type, b.severity || 'leger',
        b.description || null, b.location || null, reporter, b.sanction || null,
        Number(b.sanction_days) || 0, b.status || 'ouvert', b.parents_notified ? 1 : 0]
    );
    if (b.parents_notified) {
      const g = db.get(
        `SELECT g.phone, st.first_name FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
           JOIN students st ON st.id=sg.student_id WHERE sg.student_id=? AND sg.is_primary=1`, [Number(b.student_id)]
      );
      if (g?.phone) {
        db.run(
          `INSERT INTO sms_queue (school_id, to_number, body, student_id, template, status, provider)
           VALUES (?,?,?,?, 'libre', 'en_attente', 'simule')`,
          [S(req), g.phone, `Bonjour, un incident (${b.type}) concernant ${g.first_name} a été signalé le ${b.incident_date || today()}. Merci de contacter ${req.school.name}.`]
        );
      }
    }
    audit(req, 'create', 'discipline', id, `Incident ${b.type} signalé`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/discipline/:id(\\d+)', requireRole('direction', 'censeur', 'surveillant'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'discipline_incidents', id);
    const allowed = ['sanction', 'sanction_days', 'status', 'followup', 'parents_notified'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    if (sets.length) { params.push(id); db.run(`UPDATE discipline_incidents SET ${sets.join(', ')} WHERE id=?`, params); }
    ok(res, { id });
  } catch (err) { next(err); }
});

export default router;

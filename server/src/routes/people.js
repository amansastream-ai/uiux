/**
 * SunuÉcole — Personnes & services : personnel, familles, admissions,
 * bibliothèque, infirmerie, cantine, transport, documents administratifs.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, requireStaff, assertOwnership, audit } from '../middleware/auth.js';
import { ok, created, paginate, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, addDays, money, round } from '../lib/utils.js';

const router = Router();
router.use(authenticate, requireSchool);
// RH, familles, bibliothèque, cantine, transport, infirmerie, documents :
// aucune de ces données ne doit être visible depuis un compte parent/élève.
router.use(requireStaff);

const S = (req) => req.schoolId;
const ADMIN = ['direction', 'secretaire', 'censeur', 'super_admin'];

/* ================================================================== */
/* PERSONNEL                                                           */
/* ================================================================== */
router.get('/staff', (req, res) => {
  const where = ['st.school_id=?'];
  const params = [S(req)];
  if (req.query.type) { where.push('st.staff_type=?'); params.push(req.query.type); }
  if (req.query.status) { where.push('st.status=?'); params.push(req.query.status); }
  if (req.query.q) {
    where.push('(st.first_name LIKE ? OR st.last_name LIKE ? OR st.job_title LIKE ? OR st.matricule LIKE ?)');
    const t = `%${req.query.q}%`;
    params.push(t, t, t, t);
  }
  const rows = db.all(
    `SELECT st.*, u.id AS user_id, u.is_active AS a_un_compte,
            (SELECT COUNT(*) FROM class_subjects cs WHERE cs.teacher_id=st.id) AS classes,
            (SELECT SUM(hours_per_week) FROM class_subjects cs WHERE cs.teacher_id=st.id) AS heures,
            (SELECT ROUND(100.0*SUM(CASE WHEN sw.status='present' THEN 1 ELSE 0 END)/COUNT(*),1)
               FROM staff_timesheets sw WHERE sw.staff_id=st.id AND sw.work_date>=?) AS taux_presence
       FROM staff st LEFT JOIN users u ON u.id=st.user_id
      WHERE ${where.join(' AND ')} ORDER BY st.staff_type, st.last_name COLLATE NOCASE`,
    [addDays(today(), -30), ...params]
  );
  ok(res, rows.map((r) => ({
    ...r, salary_base: money(r.salary_base), heures: round(r.heures || 0, 1),
    name: `${r.first_name} ${r.last_name}`,
  })));
});

router.get('/staff/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'staff', id);
  const st = db.get('SELECT st.*, u.email AS login_email, u.is_active FROM staff st LEFT JOIN users u ON u.id=st.user_id WHERE st.id=?', [id]);
  const classes = db.all(
    `SELECT DISTINCT c.id, c.name, l.name AS niveau, sub.name AS matiere, cs.coefficient, cs.hours_per_week
       FROM class_subjects cs JOIN classes c ON c.id=cs.class_id LEFT JOIN levels l ON l.id=c.level_id
       JOIN subjects sub ON sub.id=cs.subject_id WHERE cs.teacher_id=? ORDER BY l.seq, c.name`, [id]
  );
  const timetable = db.all(
    `SELECT ts.*, c.name AS classe, sub.name AS matiere, sub.color FROM timetable_slots ts
       JOIN classes c ON c.id=ts.class_id JOIN subjects sub ON sub.id=ts.subject_id
      WHERE ts.teacher_id=? ORDER BY ts.day_of_week, ts.start_time`, [id]
  );
  const leaves = db.all('SELECT * FROM staff_leaves WHERE staff_id=? ORDER BY date_from DESC LIMIT 20', [id]);
  const timesheets = db.all('SELECT * FROM staff_timesheets WHERE staff_id=? ORDER BY work_date DESC LIMIT 30', [id]);
  const payslips = db.all(
    `SELECT ps.*, pr.period FROM payslips ps JOIN payroll_runs pr ON pr.id=ps.run_id
      WHERE ps.staff_id=? ORDER BY pr.period DESC LIMIT 12`, [id]
  );
  ok(res, {
    staff: { ...st, salary_base: money(st.salary_base), name: `${st.first_name} ${st.last_name}` },
    classes, timetable, leaves, timesheets,
    payslips: payslips.map((p) => ({ ...p, net: money(p.net), base_salary: money(p.base_salary), lines: safeParse(p.lines_json) })),
    stats: {
      classes: classes.length,
      heures: round(classes.reduce((a, c) => a + (c.hours_per_week || 0), 0), 1),
      eleves: db.pluck(
        `SELECT COUNT(*) FROM students st WHERE st.class_id IN (SELECT class_id FROM class_subjects WHERE teacher_id=?) AND st.status NOT IN ('radie','abandon')`, [id]
      ) || 0,
      evaluations: db.pluck('SELECT COUNT(*) FROM assessments WHERE teacher_id=?', [id]) || 0,
    },
  });
});

router.post('/staff', requireRole(...ADMIN, 'comptable'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name) throw new HttpError(422, 'Nom et prénom requis.');
    const withAccount = b.create_account !== false;
    const id = db.tx(() => {
      let userId = null;
      if (withAccount && b.email) {
        const exists = db.get('SELECT id FROM users WHERE email=?', [String(b.email).toLowerCase()]);
        if (exists) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
        // bcrypt importé dynamiquement pour éviter un chargement inutile ici
        userId = db.insert(
          `INSERT INTO users (school_id, role, first_name, last_name, email, phone, password_hash, avatar_color, gender, must_change_pw)
           VALUES (?,?,?,?,?,?,?,?,?,1)`,
          [S(req), b.staff_type === 'enseignant' ? 'enseignant' : b.role || 'secretaire', b.first_name, b.last_name,
            String(b.email).toLowerCase(), b.phone || null,
            bcrypt.hashSync(b.temp_password || 'Sunu2026!', 10),
            '#0e7c66', b.gender || 'M']
        );
      }
      const staffId = db.insert(
        `INSERT INTO staff (school_id, user_id, first_name, last_name, gender, staff_type, job_title, qualification,
            matricule, phone, phone2, email, birth_date, address, city, hired_at, contract_type, salary_base,
            hourly_rate, weekly_hours, bank_name, bank_account, mobile_money, status, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [S(req), userId, b.first_name, b.last_name, b.gender || 'M', b.staff_type || 'enseignant',
          b.job_title || null, b.qualification || null, b.matricule || null, b.phone || null, b.phone2 || null,
          b.email || null, b.birth_date || null, b.address || null, b.city || null, b.hired_at || today(),
          b.contract_type || 'cdi', money(b.salary_base) || 0, money(b.hourly_rate) || 0,
          Number(b.weekly_hours) || 18, b.bank_name || null, b.bank_account || null, b.mobile_money || null,
          b.status || 'active', b.notes || null]
      );
      return staffId;
    });
    // Le mot de passe temporaire (par défaut Sunu2026!) est envoyé lors de la
    // première connexion : must_change_pw=1 force sa modification.
    audit(req, 'create', 'staff', id, `Fiche personnel créée : ${b.first_name} ${b.last_name}`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/staff/:id(\\d+)', requireRole(...ADMIN, 'comptable'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'staff', id);
    const allowed = ['first_name', 'last_name', 'gender', 'staff_type', 'job_title', 'qualification', 'matricule',
      'phone', 'phone2', 'email', 'birth_date', 'address', 'city', 'hired_at', 'contract_type', 'salary_base',
      'hourly_rate', 'weekly_hours', 'bank_name', 'bank_account', 'mobile_money', 'status', 'notes', 'inpe', 'nina'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] === undefined) continue;
      sets.push(`${f}=?`);
      params.push(['salary_base', 'hourly_rate'].includes(f) ? money(req.body[f]) : req.body[f]);
    }
    if (sets.length) { params.push(id); db.run(`UPDATE staff SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`, params); }
    audit(req, 'update', 'staff', id, 'Fiche personnel modifiée');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/staff/:id(\\d+)', requireRole('direction', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'staff', id);
    db.run("UPDATE staff SET status='parti' WHERE id=?", [id]);
    db.run('UPDATE users SET is_active=0 WHERE id=(SELECT user_id FROM staff WHERE id=?)', [id]);
    audit(req, 'delete', 'staff', id, 'Départ du personnel enregistré');
    ok(res, { id });
  } catch (err) { next(err); }
});

/* --- Congés --- */
router.get('/leaves', (req, res) => {
  const where = ['sl.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('sl.status=?'); params.push(req.query.status); }
  const { rows, total } = paginate(req.query, {
    from: 'staff_leaves sl JOIN staff st ON st.id=sl.staff_id',
    select: 'sl.*, st.first_name, st.last_name, st.job_title', where, params, orderBy: 'sl.date_from DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/leaves', (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.staff_id || !b.date_from) throw new HttpError(422, 'Membre du personnel et date de début requis.');
    assertOwnership(req, 'staff', Number(b.staff_id));
    const days = b.days || Math.max(1, Math.round((new Date(b.date_to || b.date_from) - new Date(b.date_from)) / 864e5) + 1);
    const id = db.insert(
      `INSERT INTO staff_leaves (school_id, staff_id, leave_type, date_from, date_to, days, reason, status, approved_by, replacement_staff_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.staff_id), b.leave_type || 'conge_annuel', b.date_from, b.date_to || b.date_from,
        days, b.reason || null, b.status || 'en_attente', b.approved_by || null, b.replacement_staff_id || null]
    );
    if ((b.status || 'en_attente') === 'approuve') db.run("UPDATE staff SET status='conge' WHERE id=?", [Number(b.staff_id)]);
    audit(req, 'create', 'staff_leave', id, 'Demande de congé enregistrée');
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/leaves/:id(\\d+)', requireRole('direction', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'staff_leaves', id);
    db.run('UPDATE staff_leaves SET status=?, approved_by=?, approved_at=datetime(\'now\') WHERE id=?',
      [req.body.status, req.user.id, id]);
    const lv = db.get('SELECT * FROM staff_leaves WHERE id=?', [id]);
    if (req.body.status === 'approuve') db.run("UPDATE staff SET status='conge' WHERE id=?", [lv.staff_id]);
    else db.run("UPDATE staff SET status='active' WHERE id=?", [lv.staff_id]);
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* FAMILLES / TUTEURS                                                  */
/* ================================================================== */
router.get('/guardians', (req, res) => {
  const where = ['g.school_id=?'];
  const params = [S(req)];
  if (req.query.q) {
    where.push('(g.first_name LIKE ? OR g.last_name LIKE ? OR g.phone LIKE ?)');
    const t = `%${req.query.q}%`;
    params.push(t, t, t.replace(/\s/g, ''));
  }
  const { rows, total } = paginate(req.query, {
    from: 'guardians g LEFT JOIN users u ON u.id=g.user_id',
    select: `g.*, u.id AS user_id, u.is_active AS a_un_compte,
      (SELECT COUNT(*) FROM student_guardians sg WHERE sg.guardian_id=g.id) AS enfants,
      (SELECT GROUP_CONCAT(st.first_name||' '||st.last_name, ', ') FROM student_guardians sg JOIN students st ON st.id=sg.student_id WHERE sg.guardian_id=g.id) AS noms_enfants,
      (SELECT COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) FROM invoices i JOIN student_guardians sg ON sg.student_id=i.student_id WHERE sg.guardian_id=g.id AND sg.is_payer=1 AND i.status IN ('impayee','partielle','en_retard')) AS solde`,
    where, params, orderBy: 'g.last_name COLLATE NOCASE',
  });
  res.json({ data: rows.map((r) => ({ ...r, solde: money(r.solde) })), meta: { total } });
});

router.get('/guardians/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'guardians', id);
  const g = db.get('SELECT * FROM guardians WHERE id=?', [id]);
  const children = db.all(
    `SELECT st.id, st.first_name, st.last_name, st.matricule, st.gender, c.name AS classe, sg.relation, sg.is_payer,
            (SELECT COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard')) AS solde
       FROM student_guardians sg JOIN students st ON st.id=sg.student_id LEFT JOIN classes c ON c.id=st.class_id
      WHERE sg.guardian_id=?`, [id]
  );
  const paiements = db.all(
    `SELECT p.* FROM payments p JOIN student_guardians sg ON sg.student_id=p.student_id
      WHERE sg.guardian_id=? AND sg.is_payer=1 ORDER BY p.paid_at DESC LIMIT 20`, [id]
  );
  ok(res, { guardian: g, children: children.map((c) => ({ ...c, solde: money(c.solde) })), paiements: paiements.map((p) => ({ ...p, amount: money(p.amount) })) });
});

/* ================================================================== */
/* ADMISSIONS                                                          */
/* ================================================================== */
router.get('/applications', (req, res) => {
  const where = ['a.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('a.status=?'); params.push(req.query.status); }
  if (req.query.level) { where.push('a.level_requested=?'); params.push(req.query.level); }
  if (req.query.q) {
    where.push('(a.first_name LIKE ? OR a.last_name LIKE ? OR a.guardian_phone LIKE ? OR a.reference LIKE ?)');
    const t = `%${req.query.q}%`;
    params.push(t, t, t, t);
  }
  const { rows, total } = paginate(req.query, {
    from: 'applications a', select: 'a.*', where, params, orderBy: 'a.created_at DESC',
  });
  const stats = db.all('SELECT status, COUNT(*) n FROM applications WHERE school_id=? GROUP BY status', [S(req)]);
  res.json({ data: rows, meta: { total }, stats });
});

router.post('/applications', (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name) throw new HttpError(422, 'Nom et prénom du candidat requis.');
    const seq = (db.pluck('SELECT COUNT(*) FROM applications WHERE school_id=?', [S(req)]) || 0) + 1;
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    const id = db.insert(
      `INSERT INTO applications (school_id, year_id, reference, first_name, last_name, gender, birth_date,
          level_requested, class_requested, previous_school, guardian_name, guardian_phone, guardian_email,
          address, status, score, interview_date, interview_note, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), year, `CAND-${String(seq).padStart(4, '0')}`, b.first_name, b.last_name, b.gender || 'M',
        b.birth_date || null, b.level_requested || null, b.class_requested || null, b.previous_school || null,
        b.guardian_name || null, b.guardian_phone || null, b.guardian_email || null, b.address || null,
        b.status || 'nouveau', b.score ?? null, b.interview_date || null, b.interview_note || null, b.source || 'guichet']
    );
    audit(req, 'create', 'application', id, `Candidature ${b.first_name} ${b.last_name}`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/applications/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'applications', id);
    const allowed = ['status', 'score', 'interview_date', 'interview_note', 'decision_note', 'level_requested', 'class_requested'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(req.body[f]); }
    if (['admis', 'refuse', 'inscrit'].includes(req.body.status)) {
      sets.push('decided_at=datetime(\'now\')', 'decided_by=?');
      params.push(req.user.id);
    }
    if (sets.length) { params.push(id); db.run(`UPDATE applications SET ${sets.join(', ')} WHERE id=?`, params); }
    audit(req, 'update', 'application', id, `Candidature → ${req.body.status || 'modifiée'}`);
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Convertit une candidature admise en dossier élève (1 clic). */
router.post('/applications/:id(\\d+)/convert', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'applications', id);
    const a = db.get('SELECT * FROM applications WHERE id=?', [id]);
    if (a.student_id) throw new HttpError(409, 'Cette candidature a déjà été convertie.');
    const classId = req.body.class_id
      || db.pluck('SELECT id FROM classes WHERE school_id=? AND name=?', [S(req), a.class_requested])
      || db.pluck(
        `SELECT c.id FROM classes c JOIN levels l ON l.id=c.level_id WHERE c.school_id=? AND l.name=? LIMIT 1`,
        [S(req), a.level_requested]
      );
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    const seq = (db.pluck('SELECT COUNT(*) FROM students WHERE school_id=?', [S(req)]) || 0) + 1;
    const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();

    const studentId = db.tx(() => {
      const sid = db.insert(
        `INSERT INTO students (school_id, matricule, first_name, last_name, gender, birth_date, class_id, year_id,
            status, address, previous_school, enrolled_at)
         VALUES (?,?,?,?,?,?,?,?, 'inscrit', ?,?, date('now'))`,
        [S(req), `${prefix}-${String(seq).padStart(4, '0')}`, a.first_name, a.last_name, a.gender,
          a.birth_date, classId || null, year, a.address, a.previous_school]
      );
      if (a.guardian_name || a.guardian_phone) {
        const parts = String(a.guardian_name || 'Parent Tuteur').split(' ');
        const gid = db.insert(
          `INSERT INTO guardians (school_id, first_name, last_name, gender, relation, phone, email, address)
           VALUES (?,?,?,?,?,?,?,?)`,
          [S(req), parts[0], parts.slice(1).join(' ') || parts[0], 'M', 'père', a.guardian_phone, a.guardian_email, a.address]
        );
        db.run('INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relation, is_primary, is_payer) VALUES (?,?,?,1,1)', [sid, gid, 'père']);
      }
      db.run("UPDATE applications SET status='inscrit', student_id=?, decided_at=datetime('now'), decided_by=? WHERE id=?", [sid, req.user.id, id]);
      return sid;
    });
    audit(req, 'create', 'student', studentId, `Conversion de la candidature ${a.reference} en élève`);
    created(res, { student_id: studentId, class_id: classId });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* BIBLIOTHÈQUE                                                        */
/* ================================================================== */
router.get('/library/books', (req, res) => {
  const where = ['lb.school_id=?'];
  const params = [S(req)];
  if (req.query.q) {
    where.push('(lb.title LIKE ? OR lb.author LIKE ? OR lb.isbn LIKE ?)');
    const t = `%${req.query.q}%`;
    params.push(t, t, t);
  }
  if (req.query.category) { where.push('lb.category=?'); params.push(req.query.category); }
  const { rows, total } = paginate(req.query, {
    from: 'library_books lb',
    select: `lb.*, (SELECT COUNT(*) FROM library_loans ll WHERE ll.book_id=lb.id AND ll.status<>'rendu') AS en_pret`,
    where, params, orderBy: 'lb.title COLLATE NOCASE',
  });
  const categories = db.all('SELECT category, COUNT(*) n FROM library_books WHERE school_id=? GROUP BY category', [S(req)]);
  res.json({ data: rows, meta: { total }, categories });
});

router.post('/library/books', requireRole(...ADMIN, 'bibliothecaire'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title) throw new HttpError(422, 'Titre requis.');
    const id = db.insert(
      `INSERT INTO library_books (school_id, title, author, isbn, category, publisher, publish_year, copies, available, shelf, loan_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), b.title, b.author || null, b.isbn || null, b.category || 'Divers', b.publisher || null,
        b.publish_year || null, Number(b.copies) || 1, Number(b.copies) || 1, b.shelf || null, Number(b.loan_days) || 14]
    );
    created(res, { id });
  } catch (err) { next(err); }
});

router.get('/library/loans', (req, res) => {
  const where = ['ll.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('ll.status=?'); params.push(req.query.status); }
  if (req.query.student_id) { where.push('ll.student_id=?'); params.push(Number(req.query.student_id)); }
  const { rows, total } = paginate(req.query, {
    from: 'library_loans ll JOIN library_books lb ON lb.id=ll.book_id JOIN students st ON st.id=ll.student_id LEFT JOIN classes c ON c.id=st.class_id',
    select: 'll.*, lb.title, lb.author, st.first_name, st.last_name, c.name AS classe',
    where, params, orderBy: 'll.loaned_at DESC',
  });
  // Les prêts échus non rendus passent automatiquement en retard
  db.run("UPDATE library_loans SET status='en_retard' WHERE school_id=? AND status='en_cours' AND due_at<?", [S(req), today()]);
  res.json({ data: rows, meta: { total } });
});

router.post('/library/loans', requireRole(...ADMIN, 'bibliothecaire'), (req, res, next) => {
  try {
    const { book_id: bookId, student_id: studentId, loan_days: loanDays } = req.body || {};
    assertOwnership(req, 'library_books', Number(bookId));
    assertOwnership(req, 'students', Number(studentId));
    const book = db.get('SELECT * FROM library_books WHERE id=?', [Number(bookId)]);
    if (book.available <= 0) throw new HttpError(409, 'Aucun exemplaire disponible pour ce titre.');
    const days = Number(loanDays) || book.loan_days || 14;
    const id = db.tx(() => {
      const lid = db.insert(
        `INSERT INTO library_loans (school_id, book_id, student_id, loaned_at, due_at, status, handled_by)
         VALUES (?,?,?, date('now'), ?, 'en_cours', ?)`,
        [S(req), Number(bookId), Number(studentId), addDays(today(), days), req.user.id]
      );
      db.run('UPDATE library_books SET available=MAX(0, available-1) WHERE id=?', [Number(bookId)]);
      return lid;
    });
    created(res, { id, due_at: addDays(today(), days) });
  } catch (err) { next(err); }
});

router.post('/library/loans/:id(\\d+)/return', requireRole(...ADMIN, 'bibliothecaire'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'library_loans', id);
    const loan = db.get('SELECT * FROM library_loans WHERE id=?', [id]);
    if (loan.status === 'rendu') throw new HttpError(409, 'Ce prêt est déjà retourné.');
    const late = Math.max(0, Math.round((new Date(today()) - new Date(loan.due_at)) / 864e5));
    const fine = Math.min(late * 500, 10000); // 500 FCFA/jour, plafond 10 000
    db.tx(() => {
      db.run("UPDATE library_loans SET returned_at=date('now'), status='rendu', fine=? WHERE id=?", [fine, id]);
      db.run('UPDATE library_books SET available=MIN(copies, available+1) WHERE id=?', [loan.book_id]);
    });
    ok(res, { id, fine, late_days: late });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* INFIRMERIE / SANTÉ                                                  */
/* ================================================================== */
router.get('/health', (req, res) => {
  const where = ['h.school_id=?'];
  const params = [S(req)];
  if (req.query.student_id) { where.push('h.student_id=?'); params.push(Number(req.query.student_id)); }
  if (req.query.type) { where.push('h.type=?'); params.push(req.query.type); }
  const { rows, total } = paginate(req.query, {
    from: 'health_records h JOIN students st ON st.id=h.student_id LEFT JOIN classes c ON c.id=st.class_id',
    select: 'h.*, st.first_name, st.last_name, c.name AS classe', where, params, orderBy: 'h.record_date DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/health', requireRole(...ADMIN, 'infirmier', 'enseignant'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.student_id || !b.type) throw new HttpError(422, 'Élève et type d\'intervention requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const id = db.insert(
      `INSERT INTO health_records (school_id, student_id, record_date, type, symptoms, diagnosis, treatment, referred, parent_notified, recorded_by, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.student_id), b.record_date || today(), b.type, b.symptoms || null, b.diagnosis || null,
        b.treatment || null, b.referred ? 1 : 0, b.parent_notified ? 1 : 0, req.user.id, b.note || null]
    );
    created(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* CANTINE & TRANSPORT                                                 */
/* ================================================================== */
router.get('/canteen', (req, res) => {
  const d = String(req.query.date || today()).slice(0, 10);
  const inscrits = db.all(
    `SELECT st.id, st.first_name, st.last_name, c.name AS classe,
            (SELECT cr.present FROM canteen_records cr WHERE cr.student_id=st.id AND cr.record_date=?) AS present,
            (SELECT cr.menu FROM canteen_records cr WHERE cr.student_id=st.id AND cr.record_date=?) AS menu
       FROM students st LEFT JOIN classes c ON c.id=st.class_id
      WHERE st.school_id=? AND st.canteen=1 AND st.status NOT IN ('radie','abandon')
      ORDER BY c.name, st.last_name`, [d, d, S(req)]
  );
  const stats = db.get(
    `SELECT COUNT(*) inscrits, SUM(CASE WHEN present=1 THEN 1 ELSE 0 END) presents FROM canteen_records
      WHERE school_id=? AND record_date=?`, [S(req), d]
  );
  const historique = db.all(
    `SELECT record_date AS date, menu, COUNT(*) n FROM canteen_records WHERE school_id=? AND record_date>=?
      GROUP BY record_date, menu ORDER BY record_date DESC LIMIT 14`, [S(req), addDays(d, -14)]
  );
  ok(res, { date: d, inscrits, stats, historique });
});

router.post('/canteen/pointage', requireRole(...ADMIN, 'surveillant'), (req, res, next) => {
  try {
    const { date, records } = req.body || {};
    const d = String(date || today()).slice(0, 10);
    db.tx(() => {
      for (const r of records || []) {
        db.run(
          `INSERT INTO canteen_records (school_id, student_id, record_date, meal_type, menu, present)
           VALUES (?,?,?,?,?,?) ON CONFLICT(student_id, record_date, meal_type) DO UPDATE SET present=excluded.present, menu=excluded.menu`,
          [S(req), Number(r.student_id), d, r.meal_type || 'dejeuner', r.menu || null, r.present ? 1 : 0]
        );
      }
    });
    ok(res, { saved: (records || []).length, date: d });
  } catch (err) { next(err); }
});

router.get('/transport', (req, res) => {
  const routes = db.all(
    `SELECT tr.*, (SELECT COUNT(*) FROM students st WHERE st.transport_route_id=tr.id AND st.status NOT IN ('radie','abandon')) AS abonnes
       FROM transport_routes tr WHERE tr.school_id=? ORDER BY tr.name`, [S(req)]
  ).map((r) => parseJsonFields(r, ['stops_json']));
  const students = db.all(
    `SELECT st.id, st.first_name, st.last_name, c.name AS classe, tr.name AS ligne, tr.id AS route_id
       FROM students st JOIN transport_routes tr ON tr.id=st.transport_route_id LEFT JOIN classes c ON c.id=st.class_id
      WHERE st.school_id=? AND st.status NOT IN ('radie','abandon') ORDER BY tr.name, st.last_name`, [S(req)]
  );
  ok(res, { routes: routes.map((r) => ({ ...r, monthly_fee: money(r.monthly_fee) })), students });
});

router.post('/transport', requireRole(...ADMIN), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) throw new HttpError(422, 'Nom de la ligne requis.');
    if (b.id) {
      assertOwnership(req, 'transport_routes', Number(b.id));
      db.run('UPDATE transport_routes SET name=?, driver_name=?, driver_phone=?, plate=?, capacity=?, stops_json=?, departure=?, monthly_fee=?, is_active=? WHERE id=?',
        [b.name, b.driver_name || null, b.driver_phone || null, b.plate || null, Number(b.capacity) || 30,
          JSON.stringify(b.stops || []), b.departure || null, money(b.monthly_fee) || 0, b.is_active === false ? 0 : 1, Number(b.id)]);
      return ok(res, { id: Number(b.id) });
    }
    const id = db.insert(
      `INSERT INTO transport_routes (school_id, name, driver_name, driver_phone, plate, capacity, stops_json, departure, monthly_fee)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [S(req), b.name, b.driver_name || null, b.driver_phone || null, b.plate || null, Number(b.capacity) || 30,
        JSON.stringify(b.stops || []), b.departure || '06:40', money(b.monthly_fee) || 0]
    );
    created(res, { id });
  } catch (err) { next(err); }
});

router.post('/transport/:id(\\d+)/assign', requireRole(...ADMIN), (req, res, next) => {
  try {
    const routeId = Number(req.params.id);
    assertOwnership(req, 'transport_routes', routeId);
    const ids = Array.isArray(req.body.student_ids) ? req.body.student_ids.map(Number) : [];
    db.tx(() => {
      for (const sid of ids) db.run('UPDATE students SET transport_route_id=? WHERE id=? AND school_id=?', [routeId, sid, S(req)]);
    });
    ok(res, { assigned: ids.length });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* DOCUMENTS ADMINISTRATIFS                                            */
/* ================================================================== */
router.get('/document-requests', (req, res) => {
  const where = ['dr.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('dr.status=?'); params.push(req.query.status); }
  const { rows, total } = paginate(req.query, {
    from: 'document_requests dr JOIN students st ON st.id=dr.student_id LEFT JOIN classes c ON c.id=st.class_id',
    select: 'dr.*, st.first_name, st.last_name, st.matricule, c.name AS classe', where, params, orderBy: 'dr.requested_at DESC',
  });
  res.json({ data: rows, meta: { total } });
});

router.post('/document-requests', (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.student_id || !b.doc_type) throw new HttpError(422, 'Élève et type de document requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const id = db.insert(
      `INSERT INTO document_requests (school_id, student_id, doc_type, requested_by, reason, status, copies, fee)
       VALUES (?,?,?,?,?, 'en_attente', ?,?)`,
      [S(req), Number(b.student_id), b.doc_type, req.user.id, b.reason || null, Number(b.copies) || 1, money(b.fee) || 0]
    );
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/document-requests/:id(\\d+)', requireRole(...ADMIN), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'document_requests', id);
    db.run('UPDATE document_requests SET status=?, processed_by=?, delivered_at=CASE WHEN ?=\'remis\' THEN datetime(\'now\') ELSE delivered_at END WHERE id=?',
      [req.body.status, req.user.id, req.body.status, id]);
    ok(res, { id });
  } catch (err) { next(err); }
});

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

export default router;

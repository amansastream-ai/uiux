/**
 * SunuÉcole — Dossiers élèves : recherche avancée, fiche complète, import/export CSV.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, requireStaff, assertOwnership, assertFamilyAccess, familyScope, audit } from '../middleware/auth.js';
import { ok, created, paginate, searchClause, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, addDays, round, money, slugify, unaccent, likeParam } from '../lib/utils.js';

const router = Router();
router.use(authenticate, requireSchool);

const STUDENT_SELECT = `
  st.id, st.matricule, st.first_name, st.last_name, st.gender, st.birth_date, st.status,
  st.photo_url, st.address, st.city, st.enrolled_at, st.canteen, st.transport_route_id,
  st.discount_pct, st.scholarship, st.tags_json, st.medical_notes, st.allergies,
  st.emergency_phone, st.previous_school, st.notes,
  c.id AS class_id, c.name AS classe, c.room, l.name AS niveau, l.cycle,
  mt.first_name || ' ' || mt.last_name AS prof_principal,
  (SELECT COALESCE(SUM(i.amount - i.discount - i.amount_paid),0) FROM invoices i
     WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard')) AS solde,
  (SELECT i.status FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard')
     ORDER BY i.due_date LIMIT 1) AS statut_paiement,
  (SELECT rc.general_avg FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie'
     ORDER BY rc.id DESC LIMIT 1) AS moyenne,
  (SELECT rc.rank FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie'
     ORDER BY rc.id DESC LIMIT 1) AS rang,
  (SELECT ROUND(100.0*SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END)/COUNT(*),1)
     FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
    WHERE ar.student_id=st.id) AS taux_presence,
  (SELECT COUNT(*) FROM discipline_incidents di WHERE di.student_id=st.id) AS incidents,
  (SELECT g.first_name || ' ' || g.last_name FROM student_guardians sg
     JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=st.id AND sg.is_primary=1 LIMIT 1) AS parent_nom,
  (SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
    WHERE sg.student_id=st.id AND sg.is_primary=1 LIMIT 1) AS parent_tel
`;

const STUDENT_FROM = `students st
  LEFT JOIN classes c ON c.id=st.class_id
  LEFT JOIN levels l ON l.id=c.level_id
  LEFT JOIN staff mt ON mt.id=c.main_teacher_id`;

/* ------------------------------------------------------------------ */
/* GET /api/students                                                   */
/* ------------------------------------------------------------------ */
router.get('/', (req, res) => {
  const { q, class_id, level_id, cycle, status, gender, paiement, transport, canteen, sort } = req.query;
  const where = ['st.school_id=?'];
  const params = [req.schoolId];

  // Un compte parent/élève ne voit jamais le trombinoscope de l'établissement :
  // la liste est restreinte à ses propres enfants (ou à son propre dossier).
  const scope = familyScope(req);
  if (scope) {
    where.push(scope.length ? `st.id IN (${scope.map(() => '?').join(',')})` : 'st.id=-1');
    params.push(...scope);
  }

  if (q) {
    // Recherche sur nom, prénom, matricule et téléphone du parent responsable
    where.push(`(st.first_name LIKE ? OR st.last_name LIKE ? OR st.matricule LIKE ?
       OR (st.first_name || ' ' || st.last_name) LIKE ?
       OR EXISTS (SELECT 1 FROM student_guardians sg2 JOIN guardians g2 ON g2.id=sg2.guardian_id
                   WHERE sg2.student_id=st.id AND g2.phone LIKE ?))`);
    const t = likeParam(q);
    params.push(t, t, t, t, likeParam(String(q).replace(/\s/g, '')));
  }
  if (class_id) { where.push('st.class_id=?'); params.push(Number(class_id)); }
  if (level_id) { where.push('c.level_id=?'); params.push(Number(level_id)); }
  if (cycle) { where.push('l.cycle=?'); params.push(cycle); }
  if (status) { where.push('st.status=?'); params.push(status); }
  else where.push("st.status NOT IN ('radie','abandon')");
  if (gender) { where.push('st.gender=?'); params.push(gender); }
  if (transport === '1') where.push('st.transport_route_id IS NOT NULL');
  if (canteen === '1') where.push('st.canteen=1');
  if (paiement === 'impaye') {
    where.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard'))`);
  } else if (paiement === 'retard') {
    where.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.student_id=st.id AND i.status='en_retard')`);
  } else if (paiement === 'a_jour') {
    where.push(`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard'))`);
  }

  const orderBy = {
    nom: 'st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE',
    recent: 'st.created_at DESC',
    matricule: 'st.matricule',
    classe: 'l.seq, c.name, st.last_name',
    solde: 'solde DESC',
    moyenne: 'moyenne DESC',
  }[sort] || 'l.seq, c.name, st.last_name COLLATE NOCASE, st.first_name COLLATE NOCASE';

  const { rows, total } = paginate(req.query, {
    from: STUDENT_FROM, select: STUDENT_SELECT, where, params, orderBy,
  });
  res.json({
    data: rows.map((r) => ({ ...r, solde: money(r.solde), tags: safeJson(r.tags_json) })),
    meta: {
      total,
      page: Number(req.query.page) || 1,
      size: Number(req.query.limit) || 25,
      pages: Math.max(1, Math.ceil(total / (Number(req.query.limit) || 25))),
    },
    facets: facets(req.schoolId),
  });
});

function safeJson(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

/** Valeurs de filtres + compteurs pour l'UI (une seule requête groupée). */
function facets(schoolId) {
  const classes = db.all(
    `SELECT c.id, c.name, l.name AS niveau, l.cycle, l.seq,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=c.id AND st.status NOT IN ('radie','abandon')) AS n
       FROM classes c LEFT JOIN levels l ON l.id=c.level_id
      WHERE c.school_id=? AND c.is_active=1 ORDER BY l.seq, c.name`, [schoolId]
  );
  const statuts = db.all(
    `SELECT status, COUNT(*) n FROM students WHERE school_id=? GROUP BY status`, [schoolId]
  );
  const niveaux = db.all(`SELECT id, name, cycle, seq FROM levels WHERE school_id=? ORDER BY seq`, [schoolId]);
  const annees = db.all(`SELECT id, name FROM school_years WHERE school_id=? ORDER BY start_date DESC`, [schoolId]);
  return { classes, statuts, niveaux, annees };
}

/* ------------------------------------------------------------------ */
/* GET /api/students/stats — synthèse pour la page liste               */
/* ------------------------------------------------------------------ */
router.get('/stats', requireStaff, (req, res) => {
  const s = req.schoolId;
  ok(res, {
    total: db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND status NOT IN ('radie','abandon')`, [s]) || 0,
    filles: db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND gender='F' AND status NOT IN ('radie','abandon')`, [s]) || 0,
    nouveaux_30j: db.pluck(`SELECT COUNT(*) FROM students WHERE school_id=? AND enrolled_at>=?`, [s, addDays(today(), -30)]) || 0,
    impayes: db.pluck(
      `SELECT COUNT(DISTINCT student_id) FROM invoices WHERE school_id=? AND status IN ('impayee','partielle','en_retard')`, [s]
    ) || 0,
    moyenne_presence: round(
      db.pluck(
        `SELECT 100.0*SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END)/COUNT(*)
           FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
          WHERE a.school_id=? AND a.session_date>=?`, [s, addDays(today(), -30)]
      ) || 0, 1
    ),
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/students/:id — fiche complète (1 requête + sections)       */
/* ------------------------------------------------------------------ */
router.get('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'students', id);
  assertFamilyAccess(req, id);
  const st = db.get(`SELECT ${STUDENT_SELECT} FROM ${STUDENT_FROM} WHERE st.id=?`, [id]);
  if (!st) throw new HttpError(404, 'Élève introuvable.');
  st.tags = safeJson(st.tags_json);
  delete st.tags_json;

  const guardians = db.all(
    `SELECT g.*, sg.relation, sg.is_primary, sg.is_payer, sg.can_pickup, u.email AS login_email, u.is_active AS a_un_compte
       FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
       LEFT JOIN users u ON u.id=g.user_id
      WHERE sg.student_id=? ORDER BY sg.is_primary DESC`, [id]
  );
  const fratrie = db.all(
    `SELECT st.id, st.first_name, st.last_name, c.name AS classe
       FROM student_guardians sg
       JOIN student_guardians sg2 ON sg2.guardian_id=sg.guardian_id
       JOIN students st ON st.id=sg2.student_id
       LEFT JOIN classes c ON c.id=st.class_id
      WHERE sg.student_id=? AND st.id<>? AND st.status NOT IN ('radie','abandon')`, [id, id]
  );

  const invoices = db.all(
    `SELECT i.*, ft.category, ft.code FROM invoices i LEFT JOIN fee_types ft ON ft.id=i.fee_type_id
      WHERE i.student_id=? ORDER BY i.due_date DESC`, [id]
  ).map((i) => ({ ...i, reste: money(i.amount - i.discount - i.amount_paid) }));
  const payments = db.all(
    `SELECT * FROM payments WHERE student_id=? ORDER BY paid_at DESC LIMIT 50`, [id]
  );

  const attendance = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) presents,
            SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) absents,
            SUM(CASE WHEN ar.status='retard' THEN 1 ELSE 0 END) retards,
            SUM(CASE WHEN ar.status='excuse' THEN 1 ELSE 0 END) excuses
       FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id WHERE ar.student_id=?`, [id]
  );
  const absencesDetail = db.all(
    `SELECT a.session_date, ar.status, ar.minutes_late, ar.note, c.name AS classe, sub.name AS matiere
       FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
       JOIN classes c ON c.id=a.class_id LEFT JOIN subjects sub ON sub.id=a.subject_id
      WHERE ar.student_id=? AND ar.status<>'present' ORDER BY a.session_date DESC LIMIT 30`, [id]
  );

  const reportCards = db.all(
    `SELECT rc.id, rc.general_avg, rc.rank, rc.total_students, rc.mention, rc.status, rc.subject_avgs_json,
            rc.teacher_comment, rc.principal_comment, rc.published_at, t.name AS trimestre, t.seq
       FROM report_cards rc JOIN terms t ON t.id=rc.term_id WHERE rc.student_id=? ORDER BY t.seq`, [id]
  ).map((r) => parseJsonFields(r, ['subject_avgs_json']));

  const lastNotes = db.all(
    `SELECT g.score, g.is_absent, a.name, a.assess_date, a.max_score, a.type, sub.name AS matiere, sub.color
       FROM grades g JOIN assessments a ON a.id=g.assessment_id JOIN subjects sub ON sub.id=a.subject_id
      WHERE g.student_id=? ORDER BY a.assess_date DESC LIMIT 20`, [id]
  );

  // Progression par matière pour le graphique radar
  const parMatiere = db.all(
    `SELECT sub.name AS matiere, sub.color, AVG(g.score) AS moyenne, a.term_id
       FROM grades g JOIN assessments a ON a.id=g.assessment_id JOIN subjects sub ON sub.id=a.subject_id
      WHERE g.student_id=? AND g.is_absent=0 GROUP BY sub.id ORDER BY sub.name`, [id]
  ).map((r) => ({ ...r, moyenne: round(r.moyenne, 2) }));

  const incidents = db.all(
    `SELECT di.*, st2.first_name||' '||st2.last_name AS declared_by FROM discipline_incidents di
       LEFT JOIN staff st2 ON st2.id=di.reported_by
      WHERE di.student_id=? ORDER BY di.incident_date DESC`, [id]
  );
  const documents = db.all(`SELECT * FROM student_documents WHERE student_id=? ORDER BY created_at DESC`, [id]);
  const docRequests = db.all(`SELECT * FROM document_requests WHERE student_id=? ORDER BY requested_at DESC`, [id]);
  const loans = db.all(
    `SELECT ll.*, lb.title, lb.author FROM library_loans ll JOIN library_books lb ON lb.id=ll.book_id
      WHERE ll.student_id=? ORDER BY ll.loaned_at DESC LIMIT 10`, [id]
  );
  const health = db.all(`SELECT * FROM health_records WHERE student_id=? ORDER BY record_date DESC LIMIT 10`, [id]);
  const transport = st.transport_route_id
    ? db.get('SELECT * FROM transport_routes WHERE id=?', [st.transport_route_id])
    : null;
  const timeline = db.all(
    `SELECT 'inscription' AS type, enrolled_at AS date, 'Inscription à l''établissement' AS label FROM students WHERE id=?
     UNION ALL SELECT 'paiement' AS type, substr(paid_at,1,10) AS date, 'Paiement de ' || amount || ' FCFA (' || method || ')' AS label FROM payments WHERE student_id=? ORDER BY date DESC LIMIT 20`,
    [id, id]
  );

  ok(res, {
    student: st, guardians, fratrie, invoices, payments,
    attendance: { ...attendance, taux: attendance?.total ? round((attendance.presents / attendance.total) * 100, 1) : 0 },
    absences: absencesDetail, report_cards: reportCards, last_notes: lastNotes,
    par_matiere: parMatiere, incidents, documents, document_requests: docRequests,
    loans, health, transport: transport ? parseJsonFields(transport, ['stops_json']) : null, timeline,
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/students — création (avec tuteur et matricule automatique) */
/* ------------------------------------------------------------------ */
router.post('/', requireRole('direction', 'secretaire', 'censeur'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.first_name || !b.last_name) throw new HttpError(422, 'Le nom et le prénom sont obligatoires.');
    const year = db.get('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [req.schoolId]);
    const seq = (db.pluck('SELECT COUNT(*) FROM students WHERE school_id=?', [req.schoolId]) || 0) + 1;
    const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
    const matricule = b.matricule || `${prefix}-${String(seq).padStart(4, '0')}`;

    const id = db.tx(() => {
      const studentId = db.insert(
        `INSERT INTO students (school_id, matricule, first_name, last_name, gender, birth_date, birth_place,
            class_id, year_id, status, address, city, blood_group, medical_notes, allergies, emergency_phone,
            previous_school, enrolled_at, canteen, discount_pct, scholarship, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          req.schoolId, matricule, b.first_name.trim(), b.last_name.trim(), b.gender || 'M',
          b.birth_date || null, b.birth_place || null, b.class_id || null, year?.id || null,
          b.status || 'inscrit', b.address || null, b.city || req.school.city, b.blood_group || null,
          b.medical_notes || null, b.allergies || null, b.emergency_phone || null, b.previous_school || null,
          b.enrolled_at || today(), b.canteen ? 1 : 0, Number(b.discount_pct) || 0,
          b.scholarship || null, b.notes || null,
        ]
      );
      // Tuteur : création ou rattachement à un existant (par téléphone)
      if (b.guardian && (b.guardian.first_name || b.guardian.phone)) {
        let gid = null;
        if (b.guardian.phone) {
          gid = db.pluck('SELECT id FROM guardians WHERE school_id=? AND phone=?', [req.schoolId, b.guardian.phone]);
        }
        if (!gid) {
          gid = db.insert(
            `INSERT INTO guardians (school_id, first_name, last_name, gender, relation, phone, phone2, email,
                profession, address, city) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              req.schoolId, b.guardian.first_name || '—', b.guardian.last_name || b.last_name,
              b.guardian.gender || 'M', b.guardian.relation || 'père', b.guardian.phone || null,
              b.guardian.phone2 || null, b.guardian.email || null, b.guardian.profession || null,
              b.guardian.address || null, b.guardian.city || req.school.city,
            ]
          );
        }
        db.run(
          'INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relation, is_primary, is_payer) VALUES (?,?,?,?,1)',
          [studentId, gid, b.guardian.relation || 'père', 1]
        );
      }
      return studentId;
    });

    audit(req, 'create', 'student', id, `Création du dossier élève ${b.first_name} ${b.last_name}`);
    created(res, { id, matricule });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* PATCH /api/students/:id                                             */
/* ------------------------------------------------------------------ */
router.patch('/:id(\\d+)', requireRole('direction', 'secretaire', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'students', id);
    const allowed = ['first_name', 'last_name', 'gender', 'birth_date', 'birth_place', 'class_id', 'status',
      'address', 'city', 'blood_group', 'medical_notes', 'allergies', 'emergency_phone', 'emergency_contact',
      'previous_school', 'canteen', 'transport_route_id', 'discount_pct', 'scholarship', 'notes', 'photo_url',
      'matricule', 'nationality', 'exit_date', 'exit_reason'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(typeof req.body[f] === 'boolean' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    }
    if (!sets.length) return ok(res, { id });
    params.push(id);
    db.run(`UPDATE students SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=?`, params);
    audit(req, 'update', 'student', id, 'Modification du dossier élève');
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* DELETE /api/students/:id — radiation (jamais de suppression physique */
/* pour préserver l'historique comptable et scolaire)                  */
/* ------------------------------------------------------------------ */
router.delete('/:id(\\d+)', requireRole('direction'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'students', id);
    db.run("UPDATE students SET status='radie', exit_date=?, exit_reason=? WHERE id=?", [
      today(), req.body?.reason || 'Radiation', id,
    ]);
    audit(req, 'delete', 'student', id, `Radiation de l'élève #${id}`);
    ok(res, { id, radie: true });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* POST /api/students/:id/change-class — passage / transfert           */
/* ------------------------------------------------------------------ */
router.post('/:id(\\d+)/change-class', requireRole('direction', 'secretaire', 'censeur'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { class_id, reason } = req.body || {};
    assertOwnership(req, 'students', id);
    const cls = db.get('SELECT * FROM classes WHERE id=? AND school_id=?', [class_id, req.schoolId]);
    if (!cls) throw new HttpError(404, 'Classe de destination introuvable.');
    const eff = db.pluck('SELECT COUNT(*) FROM students WHERE class_id=?', [class_id]);
    db.run('UPDATE students SET class_id=?, updated_at=datetime(\'now\') WHERE id=?', [class_id, id]);
    audit(req, 'update', 'student', id, `Changement de classe → ${cls.name}`, { reason });
    ok(res, { id, class_id, effectif: eff + 1, capacity: cls.capacity, surcharge: eff + 1 > cls.capacity });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* Passage de classe en masse (fin d'année)                            */
/* ------------------------------------------------------------------ */
router.post('/promote', requireRole('direction'), (req, res, next) => {
  try {
    const { class_id, target_class_id, only_if_avg_above } = req.body || {};
    if (!class_id || !target_class_id) throw new HttpError(422, 'Classe d\'origine et de destination requises.');
    const seuil = Number(only_if_avg_above) || 0;
    let moved = 0;
    db.tx(() => {
      const rows = db.all(
        `SELECT st.id, (SELECT rc.general_avg FROM report_cards rc WHERE rc.student_id=st.id ORDER BY rc.id DESC LIMIT 1) AS avg
           FROM students st WHERE st.class_id=? AND st.status NOT IN ('radie','abandon','transfere')`, [class_id]
      );
      for (const r of rows) {
        if (seuil && (r.avg ?? 0) < seuil) continue;
        db.run("UPDATE students SET class_id=?, updated_at=datetime('now') WHERE id=?", [target_class_id, r.id]);
        moved += 1;
      }
    });
    audit(req, 'update', 'class', class_id, `Passage de ${moved} élève(s) vers la classe #${target_class_id}`);
    ok(res, { moved });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* GET /api/students/export — CSV compatible Excel (BOM UTF-8)         */
/* ------------------------------------------------------------------ */
router.get('/export/csv', requireStaff, (req, res) => {
  const { rows } = paginate({ ...req.query, limit: 100000 }, {
    from: STUDENT_FROM, select: STUDENT_SELECT, where: ['st.school_id=?'], params: [req.schoolId],
    orderBy: 'l.seq, c.name, st.last_name',
  });
  const cols = [
    ['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['gender', 'Sexe'],
    ['birth_date', 'Date de naissance'], ['classe', 'Classe'], ['niveau', 'Niveau'], ['parent_nom', 'Parent/Tuteur'],
    ['parent_tel', 'Téléphone parent'], ['taux_presence', 'Présence %'], ['moyenne', 'Moyenne'],
    ['solde', 'Solde dû (FCFA)'], ['status', 'Statut'], ['enrolled_at', 'Inscrit le'],
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\ufeff' + [
    cols.map((c) => esc(c[1])).join(';'),
    ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(';')),
  ].join('\r\n');
  audit(req, 'export', 'student', null, `Export CSV de ${rows.length} élèves`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="eleves-${today()}.csv"`);
  res.send(csv);
});

/* ------------------------------------------------------------------ */
/* POST /api/students/import — analyse un CSV et signale les erreurs   */
/* ------------------------------------------------------------------ */
router.post('/import', requireRole('direction', 'secretaire'), (req, res, next) => {
  try {
    const { content, commit } = req.body || {};
    if (!content) throw new HttpError(422, 'Contenu CSV manquant.');
    const lines = String(content).replace(/^\ufeff/, '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new HttpError(422, 'Le fichier doit contenir un en-tête et au moins une ligne.');
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map((h) => slugify(h.replace(/"/g, '')).replace(/-/g, '_'));
    const year = db.get('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [req.schoolId]);
    const classes = db.all('SELECT id, name FROM classes WHERE school_id=?', [req.schoolId]);
    const preview = [];
    const errors = [];
    const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
    let seq = (db.pluck('SELECT COUNT(*) FROM students WHERE school_id=?', [req.schoolId]) || 0) + 1;

    for (let i = 1; i < lines.length; i += 1) {
      const cells = lines[i].split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
      const row = {};
      headers.forEach((h, k) => { row[h] = cells[k] || ''; });
      const nom = row.nom || row.last_name || row.nom_de_famille;
      const prenom = row.prenom || row.first_name;
      if (!nom || !prenom) {
        errors.push({ line: i + 1, message: 'Nom et prénom obligatoires' });
        continue;
      }
      const classe = classes.find((c) => unaccent(c.name).toLowerCase() === unaccent(row.classe || row.class || '').toLowerCase());
      if ((row.classe || row.class) && !classe) errors.push({ line: i + 1, message: `Classe « ${row.classe} » introuvable` });
      const gender = /^f/i.test(row.sexe || row.gender || '') ? 'F' : 'M';
      preview.push({
        line: i + 1, nom, prenom, gender,
        birth_date: row.date_de_naissance || row.birth_date || null,
        class_id: classe?.id || null, classe: classe?.name || row.classe || null,
        parent_nom: row.parent || row.tuteur || row.guardian || null,
        parent_tel: row.telephone_parent || row.phone || null,
        matricule: row.matricule || `${prefix}-${String(seq++).padStart(4, '0')}`,
        valid: true,
      });
    }

    let imported = 0;
    if (commit && preview.length) {
      db.tx(() => {
        for (const p of preview) {
          const sid = db.insert(
            `INSERT INTO students (school_id, matricule, first_name, last_name, gender, birth_date, class_id, year_id, status)
             VALUES (?,?,?,?,?,?,?,?, 'inscrit')`,
            [req.schoolId, p.matricule, p.prenom, p.nom, p.gender, p.birth_date, p.class_id, year?.id || null]
          );
          if (p.parent_nom || p.parent_tel) {
            const parts = String(p.parent_nom || 'Parent Tuteur').split(' ');
            const gid = db.insert(
              `INSERT INTO guardians (school_id, first_name, last_name, gender, relation, phone) VALUES (?,?,?,?,?,?)`,
              [req.schoolId, parts[0], parts.slice(1).join(' ') || parts[0], 'M', 'père', p.parent_tel || null]
            );
            db.run('INSERT OR REPLACE INTO student_guardians (student_id, guardian_id, relation, is_primary, is_payer) VALUES (?,?,?,?,1)', [sid, gid, 'père', 1]);
          }
          imported += 1;
        }
      });
      audit(req, 'create', 'student', null, `Import CSV de ${imported} élèves`);
    }

    ok(res, { preview, errors, imported, commit: !!commit, total_lines: lines.length - 1 });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ */
/* GET /api/students/search — recherche globale instantanée (Ctrl+K)   */
/* ------------------------------------------------------------------ */
router.get('/search/global', requireStaff, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, { results: [] });
  const s = req.schoolId;
  const t = likeParam(q);
  const students = db.all(
    `SELECT st.id, st.first_name, st.last_name, st.matricule, c.name AS classe, 'eleve' AS type
       FROM students st LEFT JOIN classes c ON c.id=st.class_id
      WHERE st.school_id=? AND (st.first_name LIKE ? OR st.last_name LIKE ? OR st.matricule LIKE ?)
        AND st.status NOT IN ('radie','abandon') LIMIT 8`, [s, t, t, t]
  );
  const classes = db.all(
    `SELECT id, name, 'classe' AS type FROM classes WHERE school_id=? AND name LIKE ? LIMIT 4`, [s, t]
  );
  const staff = db.all(
    `SELECT id, first_name, last_name, job_title, 'personnel' AS type FROM staff WHERE school_id=?
      AND (first_name LIKE ? OR last_name LIKE ?) LIMIT 4`, [s, t, t]
  );
  const invoices = db.all(
    `SELECT i.id, i.invoice_number, i.amount, i.status, st.first_name, st.last_name, 'facture' AS type
       FROM invoices i JOIN students st ON st.id=i.student_id
      WHERE i.school_id=? AND (i.invoice_number LIKE ? OR st.last_name LIKE ?) LIMIT 4`, [s, t, t]
  );
  const subjects = db.all(`SELECT id, name, code, 'matiere' AS type FROM subjects WHERE school_id=? AND name LIKE ? LIMIT 3`, [s, t]);
  ok(res, { results: [...students, ...classes, ...staff.map((x) => ({ ...x, name: `${x.first_name} ${x.last_name}` })), ...invoices, ...subjects] });
});

export default router;

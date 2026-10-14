/**
 * SunuÉcole — Tableaux de bord.
 * Un point d'entrée par profil (direction, enseignant, parent, élève, plateforme)
 * afin que chaque utilisateur voie immédiatement ce qui le concerne.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireSchool, requireStaff, teacherScope } from '../middleware/auth.js';
import { ok, parseJsonFields } from '../lib/respond.js';
import { today, addDays, monthKey, money, round } from '../lib/utils.js';
import { PLANS } from '../config.js';

const router = Router();
router.use(authenticate);

const D = () => today();

/* ================================================================== */
/* DIRECTION / ADMINISTRATION                                          */
/* ================================================================== */
router.get('/summary', requireSchool, requireStaff, (req, res) => {
  const s = req.schoolId;
  const d = D();

  const effectif = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN gender='F' THEN 1 ELSE 0 END) filles,
            SUM(CASE WHEN status='actif' THEN 1 ELSE 0 END) actifs,
            SUM(CASE WHEN status IN ('suspendu','transfere','radie') THEN 1 ELSE 0 END) sortis
       FROM students WHERE school_id=? AND status NOT IN ('radie','abandon')`, [s]
  );

  // Présence du jour (ou du dernier jour saisi si week-end/férié)
  const lastAtt = db.get(
    `SELECT session_date FROM attendance_sessions WHERE school_id=? AND session_date<=?
      ORDER BY session_date DESC LIMIT 1`, [s, d]
  );
  const attDate = lastAtt?.session_date || d;
  const att = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) presents,
            SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) absents,
            SUM(CASE WHEN ar.status='retard' THEN 1 ELSE 0 END) retards,
            SUM(CASE WHEN ar.status='excuse' THEN 1 ELSE 0 END) excuses
       FROM attendance_records ar
       JOIN attendance_sessions a ON a.id = ar.session_id
      WHERE a.school_id=? AND a.session_date=?`, [s, attDate]
  );

  // Finance : attendu, encaissé, solde, taux de recouvrement
  const fin = db.get(
    `SELECT COUNT(*) factures,
            COALESCE(SUM(amount - discount),0) attendu,
            COALESCE(SUM(amount_paid),0) encaisse,
            SUM(CASE WHEN status IN ('impayee','partielle','en_retard') THEN 1 ELSE 0 END) impayees,
            COALESCE(SUM(CASE WHEN status='en_retard' THEN amount - discount - amount_paid ELSE 0 END),0) retard
       FROM invoices WHERE school_id=?`, [s]
  );
  const encaisseMois = db.pluck(
    `SELECT COALESCE(SUM(amount),0) FROM payments WHERE school_id=? AND substr(paid_at,1,7)=?`,
    [s, monthKey(d)]
  );
  const depensesMois = db.pluck(
    `SELECT COALESCE(SUM(amount),0) FROM expenses WHERE school_id=? AND substr(expense_date,1,7)=?`,
    [s, monthKey(d)]
  );

  // Pédagogie : moyenne générale du trimestre courant
  const term = db.get('SELECT * FROM terms WHERE school_id=? AND is_current=1 ORDER BY seq LIMIT 1', [s]);
  const pedag = db.get(
    `SELECT COUNT(*) evaluations,
            COALESCE(AVG(g.score),0) moyenne,
            COUNT(DISTINCT a.id) devoirs
       FROM grades g JOIN assessments a ON a.id=g.assessment_id
      WHERE a.school_id=? AND g.is_absent=0`, [s]
  );

  // Ressources humaines
  const rh = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN staff_type='enseignant' THEN 1 ELSE 0 END) enseignants,
            SUM(CASE WHEN status='conge' THEN 1 ELSE 0 END) en_conge
       FROM staff WHERE school_id=?`, [s]
  );
  const absentsProfs = db.all(
    `SELECT sl.id, st.first_name, st.last_name, sl.leave_type, sl.date_from, sl.date_to
       FROM staff_leaves sl JOIN staff st ON st.id=sl.staff_id
      WHERE sl.school_id=? AND sl.date_from<=? AND sl.date_to>=? AND sl.status='approuve'`, [s, d, d]
  );

  const classes = db.all(
    `SELECT c.id, c.name, c.capacity, c.room, l.name AS level, l.cycle,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=c.id AND st.status NOT IN ('radie','abandon')) AS effectif,
            mt.first_name || ' ' || mt.last_name AS prof_principal
       FROM classes c
       LEFT JOIN levels l ON l.id=c.level_id
       LEFT JOIN staff mt ON mt.id=c.main_teacher_id
      WHERE c.school_id=? AND c.is_active=1
      ORDER BY l.seq, c.name`, [s]
  ).map((c) => ({
    ...c,
    taux_remplissage: c.capacity ? Math.round((c.effectif / c.capacity) * 100) : 0,
    surcharge: c.effectif > c.capacity,
  }));

  const ratio = effectif.total && rh.enseignants ? round(effectif.total / rh.enseignants, 1) : 0;

  ok(res, {
    date: d,
    school: {
      id: req.school.id, name: req.school.name, city: req.school.city, plan: req.school.plan,
      planLabel: PLANS[req.school.plan]?.name || req.school.plan,
      subscriptionStatus: req.school.subscription_status,
      academicYear: req.school.academic_year,
      trialEndsAt: req.school.trial_ends_at,
      currency: req.school.currency,
    },
    kpis: {
      effectif: { total: effectif.total || 0, filles: effectif.filles || 0, actifs: effectif.actifs || 0, sortis: effectif.sortis || 0,
        parite: effectif.total ? round((effectif.filles / effectif.total) * 100, 1) : 0 },
      presence: {
        date: attDate, total: att?.total || 0, presents: att?.presents || 0, absents: att?.absents || 0,
        retards: att?.retards || 0, excuses: att?.excuses || 0,
        taux: att?.total ? round((att.presents / att.total) * 100, 1) : null,
      },
      finance: {
        attendu: money(fin.attendu), encaisse: money(fin.encaisse),
        solde: money(fin.attendu - fin.encaisse), impayees: fin.impayees || 0,
        retard: money(fin.retard),
        taux_recouvrement: fin.attendu ? round((fin.encaisse / fin.attendu) * 100, 1) : 0,
        mois_courant: { encaisse: money(encaisseMois), depenses: money(depensesMois), resultat: money(encaisseMois - depensesMois) },
      },
      pedagogie: {
        evaluations: pedag.devoirs || 0, notes: pedag.evaluations || 0,
        moyenne: round(pedag.moyenne, 2), trimestre: term?.name || '—', termId: term?.id || null,
      },
      rh: { total: rh.total || 0, enseignants: rh.enseignants || 0, en_conge: rh.en_conge || 0, ratio_eleves_par_prof: ratio },
      classes: { total: classes.length, surchargees: classes.filter((c) => c.surcharge).length },
    },
    classes,
    absents_du_jour: absentsProfs,
  });
});

/** Séries pour les graphiques du tableau de bord direction. */
router.get('/charts', requireSchool, requireStaff, (req, res) => {
  const s = req.schoolId;
  const d = D();

  // Effectifs par niveau + répartition filles/garçons
  const parNiveau = db.all(
    `SELECT l.name AS niveau, l.cycle, l.seq,
            COUNT(st.id) AS effectif,
            SUM(CASE WHEN st.gender='F' THEN 1 ELSE 0 END) AS filles,
            SUM(CASE WHEN st.gender='M' THEN 1 ELSE 0 END) AS garcons
       FROM levels l
       LEFT JOIN classes c ON c.level_id=l.id AND c.school_id=l.school_id
       LEFT JOIN students st ON st.class_id=c.id AND st.status NOT IN ('radie','abandon')
      WHERE l.school_id=? GROUP BY l.id ORDER BY l.seq`, [s]
  );

  // Taux de présence sur 30 jours ouvrés
  const presence30 = db.all(
    `SELECT a.session_date AS date,
            ROUND(100.0*SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS taux,
            SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) AS absents,
            SUM(CASE WHEN ar.status='retard' THEN 1 ELSE 0 END) AS retards,
            COUNT(*) AS total
       FROM attendance_sessions a JOIN attendance_records ar ON ar.session_id=a.id
      WHERE a.school_id=? AND a.session_date BETWEEN ? AND ?
      GROUP BY a.session_date ORDER BY a.session_date`, [s, addDays(d, -45), d]
  );

  // Encaissements vs dépenses sur 12 mois
  const mois = [];
  for (let i = 11; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() - i);
    mois.push(dt.toISOString().slice(0, 7));
  }
  const encaissements = db.all(
    `SELECT substr(paid_at,1,7) AS m, SUM(amount) AS total, COUNT(*) AS n
       FROM payments WHERE school_id=? GROUP BY m`, [s]
  );
  const depenses = db.all(
    `SELECT substr(expense_date,1,7) AS m, SUM(amount) AS total FROM expenses WHERE school_id=? GROUP BY m`, [s]
  );
  const flux = mois.map((m) => ({
    mois: m,
    encaissements: money(encaissements.find((e) => e.m === m)?.total || 0),
    depenses: money(depenses.find((e) => e.m === m)?.total || 0),
    paiements: encaissements.find((e) => e.m === m)?.n || 0,
  }));

  // Moyens de paiement
  const methodes = db.all(
    `SELECT method AS methode, SUM(amount) AS total, COUNT(*) AS n FROM payments
      WHERE school_id=? GROUP BY method ORDER BY total DESC`, [s]
  );

  // Distribution des moyennes (dernier trimestre publié)
  const distrib = db.all(
    `SELECT CASE
              WHEN general_avg>=16 THEN '16-20' WHEN general_avg>=14 THEN '14-16'
              WHEN general_avg>=12 THEN '12-14' WHEN general_avg>=10 THEN '10-12'
              WHEN general_avg>=8 THEN '8-10' ELSE '0-8' END AS tranche,
            COUNT(*) AS n
       FROM report_cards WHERE school_id=? AND general_avg IS NOT NULL GROUP BY tranche`, [s]
  );
  const ordreTranches = ['0-8', '8-10', '10-12', '12-14', '14-16', '16-20'];
  const distribution = ordreTranches.map((t) => ({ tranche: t, n: distrib.find((x) => x.tranche === t)?.n || 0 }));

  // Statut des factures
  const statutFactures = db.all(
    `SELECT status AS statut, COUNT(*) AS n, COALESCE(SUM(amount-discount-amount_paid),0) AS solde
       FROM invoices WHERE school_id=? GROUP BY status`, [s]
  );

  // Absences chroniques : top élèves
  const topAbsents = db.all(
    `SELECT st.id, st.first_name, st.last_name, c.name AS classe,
            SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) AS absences,
            SUM(CASE WHEN ar.status='retard' THEN 1 ELSE 0 END) AS retards
       FROM students st
       JOIN classes c ON c.id=st.class_id
       LEFT JOIN attendance_records ar ON ar.student_id=st.id
       LEFT JOIN attendance_sessions a ON a.id=ar.session_id AND a.session_date>=?
      WHERE st.school_id=? GROUP BY st.id HAVING absences>0
      ORDER BY absences DESC LIMIT 8`, [addDays(d, -60), s]
  );

  ok(res, {
    par_niveau: parNiveau,
    presence_30j: presence30,
    flux_12m: flux,
    methodes_paiement: methodes.map((m) => ({ ...m, total: money(m.total) })),
    distribution_moyennes: distribution,
    statut_factures: statutFactures.map((f) => ({ ...f, solde: money(f.solde) })),
    top_absents: topAbsents,
  });
});

/** Alertes actionnables, triées par gravité. */
router.get('/alerts', requireSchool, requireStaff, (req, res) => {
  const s = req.schoolId;
  const d = D();
  const alerts = [];
  const add = (severity, type, title, detail, link, count) =>
    alerts.push({ severity, type, title, detail, link, count: count ?? null, date: d });

  const impayes = db.get(
    `SELECT COUNT(*) n, COALESCE(SUM(amount-discount-amount_paid),0) montant FROM invoices
      WHERE school_id=? AND status IN ('impayee','partielle','en_retard')`, [s]
  );
  if (impayes.n > 0) add(impayes.montant > 2000000 ? 'haute' : 'moyenne', 'finance',
    `${impayes.n} factures impayées`, `${Math.round(impayes.montant).toLocaleString('fr-FR')} FCFA à recouvrer`, '/finance/impayes', impayes.n);

  const retardsCritiques = db.pluck(
    `SELECT COUNT(*) FROM invoices WHERE school_id=? AND status='en_retard' AND due_date < ?`,
    [s, addDays(d, -30)]
  );
  if (retardsCritiques > 0) add('haute', 'finance', `${retardsCritiques} factures en retard de +30 jours`,
    'Lancez une campagne de relance SMS en un clic', '/finance/impayes?retard=30', retardsCritiques);

  const absentsJour = db.pluck(
    `SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
      WHERE a.school_id=? AND a.session_date=(SELECT MAX(session_date) FROM attendance_sessions WHERE school_id=? AND session_date<=?) AND ar.status='absent'`,
    [s, s, d]
  );
  if (absentsJour > 0) add('moyenne', 'vie_scolaire', `${absentsJour} élèves absents aujourd'hui`,
    'Les parents ont été notifiés par SMS', '/vie-scolaire/absences', absentsJour);

  const appelsManquants = db.all(
    `SELECT c.id, c.name FROM classes c WHERE c.school_id=? AND c.is_active=1
       AND NOT EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.class_id=c.id AND a.session_date=?)`,
    [s, d]
  );
  const jourOuvre = [0, 6].indexOf(new Date(`${d}T12:00:00Z`).getUTCDay()) === -1;
  if (jourOuvre && appelsManquants.length) add('haute', 'vie_scolaire',
    `${appelsManquants.length} appels non faits aujourd'hui`,
    appelsManquants.slice(0, 4).map((c) => c.name).join(', ') + (appelsManquants.length > 4 ? '…' : ''),
    '/vie-scolaire/presences', appelsManquants.length);

  const notesASaisir = db.pluck(
    `SELECT COUNT(*) FROM assessments a WHERE a.school_id=? AND a.status='draft'`, [s]
  );
  if (notesASaisir > 0) add('moyenne', 'pedagogie', `${notesASaisir} évaluations en attente de publication`,
    'Saisissez les notes pour publier les bulletins', '/pedagogie/evaluations', notesASaisir);

  const classesSurchargees = db.all(
    `SELECT c.name, c.capacity, (SELECT COUNT(*) FROM students st WHERE st.class_id=c.id) eff
       FROM classes c WHERE c.school_id=? AND c.is_active=1`, [s]
  ).filter((c) => c.eff > c.capacity);
  if (classesSurchargees.length) add('basse', 'organisation',
    `${classesSurchargees.length} classes au-dessus de leur capacité`,
    classesSurchargees.map((c) => `${c.name} (${c.eff}/${c.capacity})`).join(', '), '/scolaire/classes');

  const justificatifs = db.pluck(
    `SELECT COUNT(*) FROM absence_justifications WHERE school_id=? AND status='en_attente'`, [s]
  );
  if (justificatifs > 0) add('basse', 'vie_scolaire', `${justificatifs} justificatifs d'absence à traiter`,
    'Validez ou refusez les demandes des parents', '/vie-scolaire/absences?statut=en_attente', justificatifs);

  const conflitsEmploi = db.all(
    `SELECT t1.id, st.first_name||' '||st.last_name AS prof, t1.day_of_week, t1.start_time
       FROM timetable_slots t1 JOIN timetable_slots t2
         ON t1.teacher_id=t2.teacher_id AND t1.day_of_week=t2.day_of_week AND t1.start_time=t2.start_time AND t1.id<t2.id
       JOIN staff st ON st.id=t1.teacher_id
      WHERE t1.school_id=?`, [s]
  );
  if (conflitsEmploi.length) add('haute', 'organisation', `${conflitsEmploi.length} conflits d'emploi du temps`,
    'Un enseignant est programmé sur deux classes en même temps', '/scolaire/emploi-du-temps', conflitsEmploi.length);

  const candidatures = db.pluck(`SELECT COUNT(*) FROM applications WHERE school_id=? AND status IN ('nouveau','entretien')`, [s]);
  if (candidatures > 0) add('basse', 'admissions', `${candidatures} candidatures en attente`,
    'Relancez les familles pour finaliser les inscriptions', '/scolaire/admissions', candidatures);

  const documents = db.pluck(`SELECT COUNT(*) FROM document_requests WHERE school_id=? AND status='en_attente'`, [s]);
  if (documents > 0) add('basse', 'administration', `${documents} demandes de documents`,
    'Certificats de scolarité et relevés de notes à préparer', '/administration/documents', documents);

  const biblio = db.pluck(`SELECT COUNT(*) FROM library_loans WHERE school_id=? AND status='en_retard'`, [s]);
  if (biblio > 0) add('basse', 'bibliotheque', `${biblio} livres en retard de retour`, null, '/services/bibliotheque', biblio);

  const trial = req.school.subscription_status === 'trial' && req.school.trial_ends_at;
  if (trial) {
    const jours = Math.ceil((new Date(req.school.trial_ends_at) - new Date(d)) / 864e5);
    if (jours <= 14) add(jours <= 3 ? 'haute' : 'moyenne', 'abonnement',
      jours <= 0 ? 'Période d\'essai terminée' : `Essai gratuit : ${jours} jour${jours > 1 ? 's' : ''} restant${jours > 1 ? 's' : ''}`,
      'Passez à un abonnement payant pour ne pas perdre l\'accès', '/parametres/abonnement');
  }

  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  alerts.sort((a, b) => ordre[a.severity] - ordre[b.severity]);
  ok(res, { alerts, total: alerts.length });
});

/** Tâches du jour, adaptées au rôle. */
router.get('/todo', requireSchool, requireStaff, (req, res) => {
  const s = req.schoolId;
  const d = D();
  const tasks = [];
  const role = req.user.role;

  if (['direction', 'censeur', 'secretaire', 'super_admin'].includes(role)) {
    const aFaire = db.all(
      `SELECT c.id, c.name FROM classes c WHERE c.school_id=? AND c.is_active=1
         AND NOT EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.class_id=c.id AND a.session_date=?)`,
      [s, d]
    );
    if (aFaire.length) tasks.push({ id: 'appels', label: `Faire l'appel dans ${aFaire.length} classe(s)`, link: '/vie-scolaire/presences', priority: 'haute' });
    const just = db.pluck(`SELECT COUNT(*) FROM absence_justifications WHERE school_id=? AND status='en_attente'`, [s]);
    if (just) tasks.push({ id: 'justif', label: `Traiter ${just} justificatif(s) d'absence`, link: '/vie-scolaire/absences', priority: 'moyenne' });
    const docs = db.pluck(`SELECT COUNT(*) FROM document_requests WHERE school_id=? AND status='en_attente'`, [s]);
    if (docs) tasks.push({ id: 'docs', label: `Préparer ${docs} document(s) administratif(s)`, link: '/administration/documents', priority: 'moyenne' });
    const evt = db.get(`SELECT title, event_date, start_time, location FROM events WHERE school_id=? AND event_date>=? ORDER BY event_date LIMIT 1`, [s, d]);
    if (evt) tasks.push({ id: 'evt', label: `Prochain événement : ${evt.title} (${evt.event_date})`, link: '/communication/evenements', priority: 'basse' });
    const sms = db.pluck(`SELECT COUNT(*) FROM sms_queue WHERE school_id=? AND status='echoue'`, [s]);
    if (sms) tasks.push({ id: 'sms', label: `${sms} SMS en échec à renvoyer`, link: '/communication/sms', priority: 'moyenne' });
  }

  if (role === 'comptable' || role === 'direction') {
    const caisse = db.pluck(`SELECT COUNT(*) FROM payments WHERE school_id=? AND substr(paid_at,1,10)=?`, [s, d]);
    tasks.push({ id: 'caisse', label: caisse ? `${caisse} paiement(s) encaissé(s) aujourd'hui` : 'Aucun encaissement aujourd\'hui', link: '/finance/paiements', priority: 'basse' });
    const relances = db.pluck(`SELECT COUNT(*) FROM invoices WHERE school_id=? AND status IN ('impayee','en_retard') AND due_date<?`, [s, d]);
    if (relances) tasks.push({ id: 'relance', label: `Relancer ${relances} famille(s)`, link: '/finance/impayes', priority: 'haute' });
  }

  const scope = teacherScope(req);
  if (scope?.staffId) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    const cours = db.all(
      `SELECT ts.start_time, ts.end_time, c.name AS classe, sub.name AS matiere, sub.color
         FROM timetable_slots ts JOIN classes c ON c.id=ts.class_id JOIN subjects sub ON sub.id=ts.subject_id
        WHERE ts.teacher_id=? AND ts.day_of_week=? ORDER BY ts.start_time`, [scope.staffId, dow]
    );
    tasks.push({ id: 'cours', label: cours.length ? `${cours.length} cours aujourd'hui` : 'Pas de cours aujourd\'hui', link: '/scolaire/emploi-du-temps', priority: 'basse', detail: cours });
    const notes = db.pluck(`SELECT COUNT(*) FROM assessments WHERE school_id=? AND teacher_id=? AND status='draft'`, [s, scope.staffId]);
    if (notes) tasks.push({ id: 'notes', label: `Saisir les notes de ${notes} évaluation(s)`, link: '/pedagogie/notes', priority: 'haute' });
    const hw = db.pluck(
      `SELECT COUNT(*) FROM homework h WHERE h.school_id=? AND h.due_date<=? AND h.teacher_id=?`, [s, d, scope.staffId]
    );
    if (hw) tasks.push({ id: 'dm', label: `${hw} devoir(s) à corriger`, link: '/pedagogie/devoirs', priority: 'moyenne' });
    const appelFait = db.get(
      `SELECT a.id, c.name FROM attendance_sessions a JOIN classes c ON c.id=a.class_id
        WHERE a.teacher_id=? AND a.session_date=? LIMIT 1`, [scope.staffId, d]
    );
    if (!appelFait && cours.length) tasks.push({ id: 'appel', label: 'Faire l\'appel de vos classes', link: '/vie-scolaire/presences', priority: 'haute' });
  }

  if (role === 'parent') {
    const kids = db.all(
      `SELECT st.id, st.first_name, st.last_name FROM student_guardians sg JOIN students st ON st.id=sg.student_id
        WHERE sg.guardian_id IN (SELECT id FROM guardians WHERE user_id=?)`, [req.user.id]
    );
    const ids = kids.map((k) => k.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const solde = db.pluck(`SELECT COALESCE(SUM(amount-discount-amount_paid),0) FROM invoices WHERE student_id IN (${ph}) AND status IN ('impayee','partielle','en_retard')`, ids);
      if (solde > 0) tasks.push({ id: 'solde', label: `${Math.round(solde).toLocaleString('fr-FR')} FCFA à régler`, link: '/parent/factures', priority: 'haute' });
      const abs = db.pluck(
        `SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
          WHERE ar.student_id IN (${ph}) AND ar.status IN ('absent','retard') AND a.session_date>=?`, [...ids, addDays(d, -7)]
      );
      if (abs > 0) tasks.push({ id: 'abs', label: `${abs} absence(s)/retard(s) cette semaine`, link: '/parent/presences', priority: 'moyenne' });
      const bulletins = db.pluck(`SELECT COUNT(*) FROM report_cards WHERE student_id IN (${ph}) AND status='publie'`, ids);
      if (bulletins) tasks.push({ id: 'bull', label: `${bulletins} bulletin(s) disponible(s)`, link: '/parent/bulletins', priority: 'basse' });
      const dm = db.pluck(
        `SELECT COUNT(*) FROM homework h JOIN students st ON st.class_id=h.class_id
          WHERE st.id IN (${ph}) AND h.due_date>=? AND h.due_date<=?`, [...ids, d, addDays(d, 7)]
      );
      if (dm) tasks.push({ id: 'dm', label: `${dm} devoir(s) à rendre cette semaine`, link: '/parent/devoirs', priority: 'moyenne' });
    }
    tasks.push({ id: 'kids', label: kids.length ? `${kids.length} enfant(s) suivi(s)` : 'Aucun enfant rattaché', link: '/parent/enfants', priority: 'basse' });
  }

  ok(res, { tasks, date: d });
});

/* ================================================================== */
/* ENSEIGNANT                                                          */
/* ================================================================== */
router.get('/teacher', requireSchool, requireStaff, (req, res) => {
  const s = req.schoolId;
  const d = D();
  const staff = db.get('SELECT * FROM staff WHERE user_id=? AND school_id=?', [req.user.id, s]);
  if (!staff) return ok(res, { empty: true });
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();

  const coursJour = db.all(
    `SELECT ts.id, ts.start_time, ts.end_time, ts.room, c.id AS class_id, c.name AS classe,
            sub.name AS matiere, sub.code, sub.color
       FROM timetable_slots ts JOIN classes c ON c.id=ts.class_id JOIN subjects sub ON sub.id=ts.subject_id
      WHERE ts.teacher_id=? AND ts.day_of_week=? ORDER BY ts.start_time`, [staff.id, dow]
  ).map((c) => ({
    ...c,
    appel_fait: !!db.get('SELECT id FROM attendance_sessions WHERE class_id=? AND session_date=? AND slot_index=1', [c.class_id, d]),
  }));

  const mesClasses = db.all(
    `SELECT DISTINCT c.id, c.name, l.name AS niveau,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=c.id AND st.status NOT IN ('radie','abandon')) AS effectif
       FROM class_subjects cs JOIN classes c ON c.id=cs.class_id LEFT JOIN levels l ON l.id=c.level_id
      WHERE cs.teacher_id=? ORDER BY l.seq, c.name`, [staff.id]
  );

  const evals = db.all(
    `SELECT a.id, a.name, a.type, a.assess_date, a.max_score, a.status, c.name AS classe, sub.name AS matiere, sub.color,
            (SELECT COUNT(*) FROM grades g WHERE g.assessment_id=a.id) AS notes_saisies,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=a.class_id AND st.status NOT IN ('radie','abandon')) AS effectif
       FROM assessments a JOIN classes c ON c.id=a.class_id JOIN subjects sub ON sub.id=a.subject_id
      WHERE a.teacher_id=? OR a.class_id IN (SELECT class_id FROM class_subjects WHERE teacher_id=?)
      ORDER BY a.assess_date DESC LIMIT 12`, [staff.id, staff.id]
  );

  const aCorriger = db.all(
    `SELECT h.id, h.title, h.due_date, c.name AS classe, sub.name AS matiere,
            (SELECT COUNT(*) FROM homework_submissions hs WHERE hs.homework_id=h.id AND hs.status IN ('rendu','en_retard')) AS rendus,
            (SELECT COUNT(*) FROM students st WHERE st.class_id=h.class_id) AS effectif
       FROM homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id
      WHERE h.teacher_id=? ORDER BY h.due_date ASC LIMIT 8`, [staff.id]
  );

  const stats = db.get(
    `SELECT COALESCE(AVG(g.score),0) moyenne, COUNT(g.id) notes FROM grades g
       JOIN assessments a ON a.id=g.assessment_id WHERE a.teacher_id=? AND g.is_absent=0`, [staff.id]
  );

  ok(res, {
    staff: { id: staff.id, name: `${staff.first_name} ${staff.last_name}`, jobTitle: staff.job_title },
    cours_du_jour: coursJour,
    mes_classes: mesClasses,
    evaluations: evals,
    devoirs_a_corriger: aCorriger,
    stats: { moyenne: round(stats.moyenne, 2), notes: stats.notes || 0, classes: mesClasses.length, cours: coursJour.length },
  });
});

/* ================================================================== */
/* PARENT                                                              */
/* ================================================================== */
router.get('/parent', requireSchool, (req, res) => {
  const d = D();
  const children = db.all(
    `SELECT st.id, st.first_name, st.last_name, st.gender, st.matricule, st.status,
            c.name AS classe, l.name AS niveau, st.photo_url, sg.relation,
            (SELECT rc.general_avg FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie' ORDER BY rc.id DESC LIMIT 1) AS derniere_moyenne,
            (SELECT rc.mention FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie' ORDER BY rc.id DESC LIMIT 1) AS derniere_mention,
            (SELECT rc.rank FROM report_cards rc WHERE rc.student_id=st.id AND rc.status='publie' ORDER BY rc.id DESC LIMIT 1) AS rang,
            (SELECT COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) FROM invoices i WHERE i.student_id=st.id AND i.status IN ('impayee','partielle','en_retard')) AS solde,
            (SELECT COUNT(*) FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
              WHERE ar.student_id=st.id AND ar.status IN ('absent','retard') AND a.session_date>=?) AS absences_30j
       FROM student_guardians sg
       JOIN students st ON st.id=sg.student_id
       LEFT JOIN classes c ON c.id=st.class_id
       LEFT JOIN levels l ON l.id=c.level_id
      WHERE sg.guardian_id IN (SELECT id FROM guardians WHERE user_id=? AND school_id=?)`,
    [addDays(d, -30), req.user.id, req.schoolId]
  );

  const ids = children.map((c) => c.id);
  let evenements = [];
  let messages = [];
  let soldeTotal = 0;
  if (ids.length) {
    soldeTotal = money(ids.reduce((sum, c) => sum + (children.find((x) => x.id === c)?.solde || 0), 0));
    evenements = db.all(
      `SELECT id, title, event_type, event_date, start_time, location FROM events
        WHERE school_id=? AND event_date>=? ORDER BY event_date LIMIT 6`, [req.schoolId, d]
    );
    messages = db.all(
      `SELECT id, subject, body, msg_type, priority, sender_name, sent_at FROM messages
        WHERE school_id=? AND sent_at IS NOT NULL ORDER BY pinned DESC, sent_at DESC LIMIT 5`, [req.schoolId]
    );
  }

  ok(res, {
    children: children.map((c) => ({ ...c, solde: money(c.solde) })),
    solde_total: soldeTotal,
    prochains_evenements: evenements,
    dernieres_annonces: messages,
  });
});

/* ================================================================== */
/* ÉLÈVE                                                               */
/* ================================================================== */
router.get('/student', requireSchool, (req, res) => {
  const d = D();
  const st = db.get(
    `SELECT st.*, c.name AS classe, l.name AS niveau, mt.first_name||' '||mt.last_name AS prof_principal
       FROM students st LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN levels l ON l.id=c.level_id
       LEFT JOIN staff mt ON mt.id=c.main_teacher_id
      WHERE st.user_id=? AND st.school_id=?`, [req.user.id, req.schoolId]
  );
  if (!st) return ok(res, { empty: true });

  const bulletins = db.all(
    `SELECT rc.id, rc.general_avg, rc.rank, rc.total_students, rc.mention, rc.status, t.name AS trimestre
       FROM report_cards rc JOIN terms t ON t.id=rc.term_id WHERE rc.student_id=? ORDER BY t.seq`, [st.id]
  ).map((b) => parseJsonFields(b, ['subject_avgs_json']));

  const emploi = db.all(
    `SELECT ts.day_of_week, ts.start_time, ts.end_time, sub.name AS matiere, sub.color, ts.room
       FROM timetable_slots ts JOIN subjects sub ON sub.id=ts.subject_id
      WHERE ts.class_id=? ORDER BY ts.day_of_week, ts.start_time`, [st.class_id]
  );

  const devoirs = db.all(
    `SELECT h.id, h.title, h.due_date, h.description, sub.name AS matiere, sub.color,
            hs.status AS mon_statut, hs.score
       FROM homework h JOIN subjects sub ON sub.id=h.subject_id
       LEFT JOIN homework_submissions hs ON hs.homework_id=h.id AND hs.student_id=?
      WHERE h.class_id=? AND h.due_date>=? ORDER BY h.due_date LIMIT 10`, [st.id, st.class_id, addDays(d, -3)]
  );

  const presences = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN ar.status='present' THEN 1 ELSE 0 END) presents,
            SUM(CASE WHEN ar.status='absent' THEN 1 ELSE 0 END) absents,
            SUM(CASE WHEN ar.status='retard' THEN 1 ELSE 0 END) retards
       FROM attendance_records ar JOIN attendance_sessions a ON a.id=ar.session_id
      WHERE ar.student_id=?`, [st.id]
  );

  const dernieresNotes = db.all(
    `SELECT g.score, g.is_absent, a.name, a.assess_date, a.max_score, sub.name AS matiere, sub.color
       FROM grades g JOIN assessments a ON a.id=g.assessment_id JOIN subjects sub ON sub.id=a.subject_id
      WHERE g.student_id=? ORDER BY a.assess_date DESC LIMIT 10`, [st.id]
  );

  ok(res, {
    student: {
      id: st.id, firstName: st.first_name, lastName: st.last_name, matricule: st.matricule,
      classe: st.classe, niveau: st.niveau, profPrincipal: st.prof_principal, photo: st.photo_url, gender: st.gender,
    },
    bulletins,
    emploi_du_temps: emploi,
    devoirs,
    dernieres_notes: dernieresNotes,
    presences: {
      ...presences,
      taux: presences?.total ? round((presences.presents / presences.total) * 100, 1) : 0,
    },
  });
});

/* ================================================================== */
/* PLATEFORME (super admin)                                            */
/* ================================================================== */
router.get('/platform', (req, res) => {
  if (!req.isSuperAdmin) return ok(res, { forbidden: true });
  const schools = db.all(
    `SELECT s.id, s.name, s.slug, s.city, s.plan, s.subscription_status, s.created_at, s.trial_ends_at,
            (SELECT COUNT(*) FROM students st WHERE st.school_id=s.id) AS eleves,
            (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id) AS utilisateurs,
            (SELECT COALESCE(SUM(amount_paid),0) FROM payments p WHERE p.school_id=s.id) AS encaisse
       FROM schools s ORDER BY s.id`
  );
  const mrr = schools.reduce((sum, s) => {
    if (s.subscription_status === 'active') return sum + (PLANS[s.plan]?.price || 0);
    return sum;
  }, 0);
  ok(res, {
    schools: schools.map((s) => ({ ...s, encaisse: money(s.encaisse) })),
    kpis: {
      etablissements: schools.length,
      actifs: schools.filter((s) => s.subscription_status === 'active').length,
      essais: schools.filter((s) => s.subscription_status === 'trial').length,
      eleves: schools.reduce((a, b) => a + b.eleves, 0),
      utilisateurs: schools.reduce((a, b) => a + b.utilisateurs, 0),
      mrr, arr: mrr * 12,
      encaisse_total: money(schools.reduce((a, b) => a + b.encaisse, 0)),
    },
    repartition_plans: Object.keys(PLANS).map((p) => ({
      plan: PLANS[p].name, n: schools.filter((s) => s.plan === p).length,
    })),
  });
});

export default router;

/**
 * SunuÉcole — Jeu de démonstration réaliste.
 *
 * Génère 3 établissements (privé, confessionnel, public) avec toute la vie
 * scolaire : élèves, familles, enseignants, classes, matières, emploi du temps,
 * présences sur 10 semaines, évaluations, bulletins, factures, paiements
 * Mobile Money, dépenses, paie, messages, SMS, événements, bibliothèque…
 *
 * Usage :
 *   npm run seed          → peuple si la base est vide
 *   npm run seed:fresh    → efface et régénère (démo propre)
 *
 * Le tirage est déterministe (PRNG à graine) : la démo est reproductible.
 */
import db from './index.js';
import { config } from '../config.js';
import bcrypt from 'bcryptjs';
import { avatarColor, slugify, today, addDays, addMonths, round, money, randInt } from '../lib/utils.js';

const FRESH = process.argv.includes('--fresh');

/* ------------------------------------------------------------------ */
/* PRNG déterministe                                                   */
/* ------------------------------------------------------------------ */
let _seed = 20261013;
function rnd() {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const R = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ------------------------------------------------------------------ */
/* Vocabulaire local                                                   */
/* ------------------------------------------------------------------ */
const FIRST_M = ['Amadou', 'Moussa', 'Ousmane', 'Cheikh', 'Abdoulaye', 'Modou', 'Mamadou', 'Ibrahima', 'Serigne', 'Pape', 'Babacar', 'Aliou', 'Lamine', 'Oumar', 'Youssou', 'Djibril', 'Malick', 'Samba', 'Tafsir', 'Ismaïla', 'Matar', 'El Hadji', 'Khadim', 'Souleymane', 'Abdou', 'Mouhamed', 'Papa', 'Assane', 'Birane', 'Saliou'];
const FIRST_F = ['Fatou', 'Aïssatou', 'Mariama', 'Khadija', 'Astou', 'Coumba', 'Awa', 'Ndèye', 'Sokhna', 'Aminata', 'Rokhaya', 'Dior', 'Bineta', 'Saly', 'Fatoumata', 'Diatou', 'Penda', 'Yacine', 'Seynabou', 'Aïda', 'Mame', 'Adama', 'Nafissatou', 'Khady', 'Marième', 'Tening', 'Coumba Ndèye', 'Zeynabou', 'Hawa', 'Absa'];
const LAST = ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Ba', 'Diallo', 'Sy', 'Mbaye', 'Faye', 'Sarr', 'Gueye', 'Kane', 'Seck', 'Cissé', 'Thiam', 'Camara', 'Dieng', 'Ndoye', 'Sall', 'Touré', 'Diouf', 'Lô', 'Gaye', 'Sané', 'Mané', 'Diatta', 'Samb', 'Wade', 'Niang', 'Dème', 'Diagne', 'Badiane', 'Sène', 'Ka', 'Tine', 'Ndao', 'Sow Ndiaye', 'Faye Mbaye', 'Gningue', 'Diack', 'Cissokho', 'Balde', 'Dabo', 'Sadio', 'Coly'];
const QUARTIERS = ['Pikine', 'Guédiawaye', 'Keur Massar', 'Rufisque', 'Parcelles Assainies', 'Grand Yoff', 'Médina', 'Ouakam', 'Yoff', 'Sacré-Cœur', 'Liberté 6', 'Hann Bel-Air', 'Thiès', 'Mbour', 'Saint-Louis', 'Touba', 'Diamniadio', 'Sébikotane', 'Bambey', 'Kaolack'];
const PROFESSIONS = ['Commerçant(e)', 'Enseignant(e)', 'Infirmier(ère)', 'Chauffeur', 'Couturier(ère)', 'Fonctionnaire', 'Ménagère', 'Électricien', 'Médecin', 'Restaurateur(trice)', 'Maçon', 'Coiffeur(se)', 'Agent bancaire', 'Pêcheur', 'Agriculteur(trice)', 'Ingénieur(e)', 'Pharmacien(ne)', 'Gendarme', 'Tailleur', 'Vendeur(se)'];
const PHONE_PREFIX = ['77', '78', '76', '70', '75', '33', '77', '78'];
const ph = () => `+221 ${pick(PHONE_PREFIX)} ${R(100, 999)} ${R(10, 99)} ${R(10, 99)}`;
const phRaw = () => `+221${pick(PHONE_PREFIX)}${String(R(1000000, 9999999))}`;

const personName = (gender) =>
  gender === 'F' ? `${pick(FIRST_F)} ${pick(LAST)}` : `${pick(FIRST_M)} ${pick(LAST)}`;

const birthDate = (age) => {
  const y = new Date().getUTCFullYear() - age;
  return `${y}-${String(R(1, 12)).padStart(2, '0')}-${String(R(1, 28)).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ */
/* Réinitialisation                                                    */
/* ------------------------------------------------------------------ */
function wipe() {
  db.exec('PRAGMA foreign_keys = OFF;');
  const tables = db
    .all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .map((t) => t.name);
  db.tx(() => {
    for (const t of tables) db.run(`DELETE FROM ${t}`);
    try { db.exec("DELETE FROM sqlite_sequence"); } catch { /* pas encore créé */ }
  });
  db.exec('PRAGMA foreign_keys = ON;');
  console.log(`  · ${tables.length} tables vidées`);
}

/* ------------------------------------------------------------------ */
/* Helpers d'insertion                                                 */
/* ------------------------------------------------------------------ */
function insert(table, row) {
  const keys = Object.keys(row);
  const vals = keys.map((k) => {
    const v = row[k];
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return db.insert(sql, vals);
}

const pwdHashCache = new Map();
function hash(pw) {
  if (!pwdHashCache.has(pw)) pwdHashCache.set(pw, bcrypt.hashSync(pw, 10));
  return pwdHashCache.get(pw);
}

const DEMO_PASSWORD = 'Sunu2026!';

function mkUser(schoolId, role, first, last, email, phone, extra = {}) {
  const id = insert('users', {
    school_id: schoolId,
    role,
    first_name: first,
    last_name: last,
    email,
    phone,
    password_hash: hash(extra.password || DEMO_PASSWORD),
    avatar_color: avatarColor(email || first + last),
    gender: extra.gender || null,
    preferences_json: { theme: 'auto', density: 'confort', lang: 'fr' },
    ...extra,
  });
  return id;
}

/* ------------------------------------------------------------------ */
/* Définition des établissements                                       */
/* ------------------------------------------------------------------ */
const SCHOOL_DEFS = [
  {
    name: 'Complexe Scolaire Les Baobabs',
    slug: 'baobabs',
    type: 'prive',
    city: 'Pikine',
    region: 'Dakar',
    address: 'Cité Damel, Route de Rufisque, Pikine',
    phone: '+221 33 834 12 45',
    email: 'contact@lesbaobabs.sn',
    head: 'M. Ibrahima Gueye',
    plan: 'pro',
    cycles: ['Primaire', 'Collège'],
    maxStudents: 600,
    demoEmails: {
      direction: 'direction@lesbaobabs.sn',
      secretaire: 'secretariat@lesbaobabs.sn',
      comptable: 'compta@lesbaobabs.sn',
      enseignant: 'prof@lesbaobabs.sn',
      parent: 'parent@lesbaobabs.sn',
      eleve: 'eleve@lesbaobabs.sn',
    },
    levels: [
      { name: 'CI', cycle: 'Primaire', seq: 1, tuition: 45000 },
      { name: 'CP', cycle: 'Primaire', seq: 2, tuition: 48000 },
      { name: 'CE1', cycle: 'Primaire', seq: 3, tuition: 50000 },
      { name: 'CE2', cycle: 'Primaire', seq: 4, tuition: 52000 },
      { name: 'CM1', cycle: 'Primaire', seq: 5, tuition: 55000 },
      { name: 'CM2', cycle: 'Primaire', seq: 6, tuition: 58000 },
      { name: '6ème', cycle: 'Collège', seq: 7, tuition: 85000 },
      { name: '5ème', cycle: 'Collège', seq: 8, tuition: 88000 },
      { name: '4ème', cycle: 'Collège', seq: 9, tuition: 92000 },
      { name: '3ème', cycle: 'Collège', seq: 10, tuition: 98000 },
    ],
    subjects: [
      ['Mathématiques', 'MATH', '#1d4ed8'], ['Français', 'FRAN', '#b91c1c'],
      ['Sciences de la Vie et de la Terre', 'SVT', '#15803d'], ['Histoire-Géographie', 'HG', '#b45309'],
      ['Anglais', 'ANGL', '#7c3aed'], ['Éducation Physique et Sportive', 'EPS', '#0f766e'],
      ['Arts Plastiques', 'ARTS', '#a21caf'], ['Informatique', 'INFO', '#0369a1'],
      ['Éducation Islamique', 'EI', '#166534'], ['Sciences Physiques', 'PHY', '#c2410c'],
    ],
    classCount: { 'CI': 1, 'CP': 1, 'CE1': 1, 'CE2': 1, 'CM1': 1, 'CM2': 1, '6ème': 2, '5ème': 2, '4ème': 2, '3ème': 2 },
    perClass: { Primaire: 32, Collège: 38 },
  },
  {
    name: 'Institution Sainte-Marie de Hann',
    slug: 'sainte-marie',
    type: 'confessionnel',
    city: 'Dakar',
    region: 'Dakar',
    address: 'Route des Pères Maristes, Hann, Dakar',
    phone: '+221 33 832 05 77',
    email: 'direction@saintemarie.sn',
    head: 'Sœur Marie-Claire Diouf',
    plan: 'elite',
    cycles: ['Maternelle', 'Primaire', 'Collège', 'Lycée'],
    maxStudents: 3000,
    levels: [
      { name: 'Grande Section', cycle: 'Maternelle', seq: 1, tuition: 90000 },
      { name: '6ème', cycle: 'Collège', seq: 2, tuition: 165000 },
      { name: '5ème', cycle: 'Collège', seq: 3, tuition: 168000 },
      { name: '3ème', cycle: 'Collège', seq: 4, tuition: 175000 },
      { name: '2nde', cycle: 'Lycée', seq: 5, tuition: 195000 },
      { name: '1ère', cycle: 'Lycée', seq: 6, tuition: 205000 },
      { name: 'Terminale', cycle: 'Lycée', seq: 7, tuition: 220000 },
    ],
    subjects: [
      ['Mathématiques', 'MATH', '#1d4ed8'], ['Français', 'FRAN', '#b91c1c'],
      ['Philosophie', 'PHILO', '#4d7c0f'], ['Sciences Physiques', 'PHY', '#c2410c'],
      ['Sciences de la Vie et de la Terre', 'SVT', '#15803d'], ['Anglais', 'ANGL', '#7c3aed'],
      ['Espagnol', 'ESP', '#a16207'], ['Histoire-Géographie', 'HG', '#b45309'],
      ['Informatique', 'INFO', '#0369a1'], ['Éducation Physique et Sportive', 'EPS', '#0f766e'],
    ],
    classCount: { 'Grande Section': 1, '6ème': 2, '5ème': 2, '3ème': 2, '2nde': 2, '1ère': 2, 'Terminale': 2 },
    perClass: { Maternelle: 25, Primaire: 30, Collège: 34, Lycée: 36 },
  },
  {
    name: 'École Élémentaire Ndiandiaye 1',
    slug: 'ndiandiaye',
    type: 'public',
    city: 'Thiès',
    region: 'Thiès',
    address: 'Quartier Escale, Thiès',
    phone: '+221 33 951 22 08',
    email: 'ndiandiaye1@education.gouv.sn',
    head: 'M. Abdoulaye Faye',
    plan: 'essentiel',
    subscriptionStatus: 'trial',
    cycles: ['Primaire'],
    maxStudents: 150,
    levels: [
      { name: 'CP', cycle: 'Primaire', seq: 1, tuition: 0 },
      { name: 'CE1', cycle: 'Primaire', seq: 2, tuition: 0 },
      { name: 'CE2', cycle: 'Primaire', seq: 3, tuition: 0 },
      { name: 'CM1', cycle: 'Primaire', seq: 4, tuition: 0 },
      { name: 'CM2', cycle: 'Primaire', seq: 5, tuition: 0 },
    ],
    subjects: [
      ['Français', 'FRAN', '#b91c1c'], ['Mathématiques', 'MATH', '#1d4ed8'],
      ['Découverte du Monde', 'DDM', '#15803d'], ['Éducation Physique et Sportive', 'EPS', '#0f766e'],
      ['Arts Plastiques', 'ARTS', '#a21caf'], ['Arabe', 'ARA', '#166534'],
    ],
    classCount: { 'CP': 1, 'CE1': 1, 'CE2': 1, 'CM1': 1, 'CM2': 1 },
    perClass: { Primaire: 28 },
  },
];

/* ------------------------------------------------------------------ */
/* Année scolaire & trimestres (calendrier sénégalais)                 */
/* ------------------------------------------------------------------ */
const YEAR_START = '2025-10-06';
const YEAR_END = '2026-07-03';
const TODAY = today();

function yearDef() {
  return {
    name: '2025-2026',
    start_date: YEAR_START,
    end_date: YEAR_END,
    is_current: 1,
  };
}

function termDefs() {
  return [
    { name: '1er Trimestre', seq: 1, start_date: '2025-10-06', end_date: '2025-12-31', council_date: '2026-01-06', report_date: '2026-01-10' },
    { name: '2ème Trimestre', seq: 2, start_date: '2026-01-06', end_date: '2026-03-31', council_date: '2026-04-07', report_date: '2026-04-11' },
    { name: '3ème Trimestre', seq: 3, start_date: '2026-04-07', end_date: '2026-07-03', council_date: '2026-07-07', report_date: '2026-07-11' },
  ];
}

/** Renvoie les jours ouvrés (lun-ven) entre deux dates. */
function schoolDays(from, to) {
  const out = [];
  let d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SEED PRINCIPAL                                                      */
/* ------------------------------------------------------------------ */
function seedSchool(def, index) {
  const t0 = Date.now();
  const schoolId = insert('schools', {
    name: def.name,
    slug: def.slug,
    type: def.type,
    cycles: def.cycles,
    phone: def.phone,
    email: def.email,
    address: def.address,
    city: def.city,
    region: def.region,
    country: 'Sénégal',
    currency: 'XOF',
    academic_year: '2025-2026',
    head_name: def.head,
    ninea: `00${R(100000, 999999)}A${R(10, 99)}`,
    plan: def.plan,
    subscription_status: def.subscriptionStatus || 'active',
    trial_ends_at: addDays(TODAY, 18),
    max_students: def.maxStudents,
    modules_json: ['students', 'attendance', 'grades', 'timetable', 'finance', 'parents', 'homework', 'discipline', 'payroll', 'library', 'canteen', 'transport'],
    settings_json: {
      gradingScale: config.schoolDefaults.gradingScale,
      dayStart: '07:30',
      dayEnd: '17:00',
      slotMinutes: 55,
      schoolDays: [1, 2, 3, 4, 5],
      gradingSystem: '20',
      passMark: 10,
      absenceAlertThreshold: 3,
      invoiceLateFeePct: 0,
      autoReminders: true,
      smsSender: def.slug.toUpperCase().slice(0, 10),
      reportCardFooter: 'Document généré électroniquement — valable sans signature manuscrite',
    },
    onboarded: 1,
    demo: 1,
  });

  insert('subscriptions', {
    school_id: schoolId,
    plan: def.plan,
    seats: def.plan === 'elite' ? 500 : def.plan === 'pro' ? 120 : 40,
    amount: def.plan === 'elite' ? 75000 : def.plan === 'pro' ? 35000 : 15000,
    period: 'monthly',
    status: def.subscriptionStatus === 'trial' ? 'trial' : 'active',
    started_at: '2025-09-15',
    expires_at: addDays(TODAY, def.subscriptionStatus === 'trial' ? 18 : 210),
  });

  const yearId = insert('school_years', { school_id: schoolId, ...yearDef() });
  const termIds = termDefs().map((t) => {
    const id = insert('terms', {
      school_id: schoolId,
      year_id: yearId,
      ...t,
      is_current: TODAY >= t.start_date && TODAY <= t.end_date ? 1 : 0,
    });
    return id;
  });
  // Si aucun trimestre courant (hors période), on prend le 1er.
  if (!db.get('SELECT id FROM terms WHERE school_id=? AND is_current=1', [schoolId])) {
    db.run('UPDATE terms SET is_current=1 WHERE id=?', [termIds[0]]);
  }
  const currentTerm = db.get('SELECT id, seq FROM terms WHERE school_id=? AND is_current=1', [schoolId]);

  /* --- Niveaux --- */
  const levelIds = {};
  for (const l of def.levels) {
    levelIds[l.name] = insert('levels', {
      school_id: schoolId, name: l.name, cycle: l.cycle, seq: l.seq, tuition: l.tuition,
      color: l.cycle === 'Maternelle' ? '#f59e0b' : l.cycle === 'Primaire' ? '#0e7c66' : l.cycle === 'Collège' ? '#1d4ed8' : '#7c3aed',
    });
  }

  /* --- Matières --- */
  const subjectIds = {};
  for (const [name, code, color] of def.subjects) {
    subjectIds[code] = insert('subjects', {
      school_id: schoolId, name, code, color, short_name: name.split(' ')[0], is_active: 1,
    });
  }

  /* --- Personnel administratif & direction --- */
  const [headFirst, headLast] = def.head.replace(/^(M\.|Mme|Sœur|Mr)\s*/, '').split(' ');
  const dirUserId = mkUser(schoolId, 'direction', headFirst || 'Ibrahima', headLast || 'Gueye', def.demoEmails?.direction || `direction@${def.slug}.sn`, ph(), { gender: 'M' });
  const secUserId = mkUser(schoolId, 'secretaire', personName('F').split(' ')[0], pick(LAST), def.demoEmails?.secretaire || `secretariat@${def.slug}.sn`, ph(), { gender: 'F' });
  const cptUserId = mkUser(schoolId, 'comptable', personName('M').split(' ')[0], pick(LAST), def.demoEmails?.comptable || `compta@${def.slug}.sn`, ph(), { gender: 'M' });
  const cenUserId = mkUser(schoolId, 'censeur', personName('M').split(' ')[0], pick(LAST), `censeur@${def.slug}.sn`, ph(), { gender: 'M' });

  const dirStaffId = insert('staff', {
    school_id: schoolId, user_id: dirUserId, first_name: headFirst || 'Ibrahima', last_name: headLast || 'Gueye',
    gender: 'M', staff_type: 'direction', job_title: 'Directeur / Chef d\'établissement', matricule: `DIR-${index + 1}01`,
    phone: def.phone, email: def.demoEmails?.direction, hired_at: '2015-10-01', contract_type: 'cdi',
    salary_base: index === 0 ? 450000 : index === 1 ? 620000 : 320000, status: 'active',
  });
  insert('staff', {
    school_id: schoolId, user_id: secUserId, first_name: db.get('SELECT first_name FROM users WHERE id=?', [secUserId]).first_name,
    last_name: db.get('SELECT last_name FROM users WHERE id=?', [secUserId]).last_name, gender: 'F', staff_type: 'administratif',
    job_title: 'Secrétaire générale', matricule: `ADM-${index + 1}02`, phone: ph(), hired_at: '2018-09-15',
    contract_type: 'cdi', salary_base: 185000, status: 'active',
  });
  insert('staff', {
    school_id: schoolId, user_id: cptUserId, first_name: db.get('SELECT first_name FROM users WHERE id=?', [cptUserId]).first_name,
    last_name: db.get('SELECT last_name FROM users WHERE id=?', [cptUserId]).last_name, gender: 'M', staff_type: 'administratif',
    job_title: 'Comptable', matricule: `ADM-${index + 1}03`, phone: ph(), hired_at: '2019-11-01',
    contract_type: 'cdi', salary_base: 240000, status: 'active',
  });

  /* --- Enseignants --- */
  const teacherCount = def.plan === 'elite' ? 22 : def.plan === 'pro' ? 16 : 7;
  const teachers = [];
  const subjectCodes = Object.keys(subjectIds);
  for (let i = 0; i < teacherCount; i += 1) {
    const gender = chance(0.55) ? 'F' : 'M';
    const first = gender === 'F' ? pick(FIRST_F) : pick(FIRST_M);
    const last = pick(LAST);
    const email = `${slugify(first)}.${slugify(last)}${i}@${def.slug}.sn`;
    const isDemoTeacher = i === 0 && def.demoEmails?.enseignant;
    const userId = mkUser(schoolId, 'enseignant', first, last, isDemoTeacher ? def.demoEmails.enseignant : email, phRaw(), { gender });
    const taught = shuffle(subjectCodes).slice(0, R(1, 2));
    const staffId = insert('staff', {
      school_id: schoolId, user_id: userId, first_name: first, last_name: last, gender,
      staff_type: 'enseignant', job_title: `Professeur de ${def.subjects.find((s) => s[1] === taught[0])?.[0] || 'Français'}`,
      qualification: pick(['Licence', 'Master 2', 'CAFOP', 'CAP', 'Agrégation', 'DEA']),
      matricule: `ENS-${index + 1}${String(i + 10).padStart(2, '0')}`,
      phone: phRaw(), phone2: chance(0.4) ? phRaw() : null, email: isDemoTeacher ? def.demoEmails.enseignant : email,
      birth_date: birthDate(R(27, 58)), address: pick(QUARTIERS), city: def.city,
      hired_at: `${2015 + R(0, 9)}-10-01`, contract_type: pick(['cdi', 'cdi', 'cdd', 'vacation']),
      salary_base: R(95, 320) * 1000, weekly_hours: R(16, 22), status: chance(0.94) ? 'active' : 'conge',
    });
    teachers.push({ id: staffId, userId, first, last, gender, subjects: taught, email: isDemoTeacher ? def.demoEmails.enseignant : email });
  }

  /* --- Classes --- */
  const classes = [];
  let classSeq = 0;
  for (const lvl of def.levels) {
    const count = def.classCount[lvl.name] || 1;
    for (let c = 0; c < count; c += 1) {
      classSeq += 1;
      const suffix = count > 1 ? String.fromCharCode(65 + c) : '';
      const mainTeacher = pick(teachers);
      const id = insert('classes', {
        school_id: schoolId, year_id: yearId, level_id: levelIds[lvl.name],
        name: `${lvl.name}${suffix ? ` ${suffix}` : ''}`,
        capacity: def.perClass[lvl.cycle] + R(0, 4),
        room: `Salle ${String.fromCharCode(65 + (classSeq % 12))}${R(1, 3)}`,
        main_teacher_id: mainTeacher.id,
        shift: lvl.cycle === 'Primaire' && chance(0.2) ? 'matin' : 'jour',
        color: lvl.cycle === 'Maternelle' ? '#f59e0b' : lvl.cycle === 'Primaire' ? '#0e7c66' : lvl.cycle === 'Collège' ? '#1d4ed8' : '#7c3aed',
      });
      // Matières de la classe avec coefficients
      const nSubjects = lvl.cycle === 'Maternelle' ? 3 : lvl.cycle === 'Primaire' ? R(5, 6) : def.subjects.length;
      const chosen = shuffle(def.subjects).slice(0, nSubjects);
      for (const [name, code] of chosen) {
        const teacher = teachers.find((t) => t.subjects.includes(code)) || pick(teachers);
        insert('class_subjects', {
          school_id: schoolId, class_id: id, subject_id: subjectIds[code], teacher_id: teacher.id,
          coefficient: ['MATH', 'FRAN'].includes(code) ? (lvl.cycle === 'Primaire' ? 4 : 3) : code === 'ANGL' || code === 'PHY' || code === 'SVT' ? 2 : 1,
          hours_per_week: ['MATH', 'FRAN'].includes(code) ? (lvl.cycle === 'Primaire' ? 6 : 4) : 2,
        });
      }
      classes.push({ id, name: `${lvl.name}${suffix ? ` ${suffix}` : ''}`, level: lvl, cycle: lvl.cycle, mainTeacher });
    }
  }

  /* --- Parents / tuteurs --- */
  const guardians = [];
  const guardianCount = Math.round(classes.reduce((s, c) => s + (def.perClass[c.cycle] || 30), 0) * 0.95);
  for (let i = 0; i < guardianCount; i += 1) {
    const gender = chance(0.62) ? 'M' : 'F';
    const first = gender === 'M' ? pick(FIRST_M) : pick(FIRST_F);
    const last = pick(LAST);
    const phone = phRaw();
    const isDemoParent = i === 0 && def.demoEmails?.parent;
    const userId = isDemoParent
      ? mkUser(schoolId, 'parent', first, last, def.demoEmails.parent, phone, { gender })
      : chance(0.5)
        ? mkUser(schoolId, 'parent', first, last, `${slugify(first)}.${slugify(last)}${i}@gmail.com`, phone, { gender })
        : null;
    const gid = insert('guardians', {
      school_id: schoolId, user_id: userId, first_name: first, last_name: last, gender,
      relation: gender === 'M' ? pick(['père', 'père', 'oncle', 'tuteur', 'grand-père']) : pick(['mère', 'mère', 'tante', 'tutrice', 'grand-mère']),
      phone, phone2: chance(0.35) ? phRaw() : null, whatsapp: chance(0.7) ? phone : null,
      email: userId ? db.get('SELECT email FROM users WHERE id=?', [userId]).email : null,
      profession: pick(PROFESSIONS), employer: chance(0.5) ? pick(['Marché Sandaga', 'Senelec', 'Sonatel', 'Indépendant', 'UCAD', 'Hôpital Général', 'Port Autonome', 'Mairie']) : null,
      address: pick(QUARTIERS), city: pick([def.city, 'Dakar', 'Guédiawaye']),
      sms_optin: chance(0.92) ? 1 : 0,
    });
    guardians.push({ id: gid, userId, first, last, phone, isDemoParent });
  }

  /* --- Élèves --- */
  const students = [];
  let matSeq = 0;
  const demoParent = guardians.find((g) => g.isDemoParent);
  for (const cls of classes) {
    const n = Math.min(cls.level ? def.perClass[cls.cycle] + R(-3, 2) : 30, def.perClass[cls.cycle] + 2);
    for (let i = 0; i < n; i += 1) {
      matSeq += 1;
      const gender = chance(0.5) ? 'F' : 'M';
      const first = gender === 'F' ? pick(FIRST_F) : pick(FIRST_M);
      const last = pick(LAST);
      const age = cls.cycle === 'Maternelle' ? R(5, 6) : cls.cycle === 'Primaire' ? 6 + cls.level.seq : 11 + (cls.level.seq - (def.levels.find((l) => l.cycle === 'Collège')?.seq || 7));
      const isDemoStudent = cls === classes[classes.length - 1] && i === 0 && def.demoEmails?.eleve;
      const userId = isDemoStudent
        ? mkUser(schoolId, 'eleve', first, last, def.demoEmails.eleve, phRaw(), { gender })
        : chance(0.25) && cls.cycle !== 'Primaire'
          ? mkUser(schoolId, 'eleve', first, last, `${slugify(first)}.${slugify(last)}${matSeq}@eleve.${def.slug}.sn`, phRaw(), { gender })
          : null;

      const sid = insert('students', {
        school_id: schoolId,
        user_id: userId,
        matricule: `${def.slug.slice(0, 3).toUpperCase()}-${String(matSeq).padStart(4, '0')}`,
        first_name: first, last_name: last, gender,
        birth_date: birthDate(Math.max(4, age)), birth_place: pick([def.city, 'Dakar', 'Thiès', 'Kaolack', 'Saint-Louis', 'Touba', 'Ziguinchor']),
        nationality: chance(0.94) ? 'Sénégalaise' : pick(['Malienne', 'Guinéenne', 'Mauritanienne', 'Ivoirienne', 'Gambienne']),
        class_id: cls.id, year_id: yearId,
        status: chance(0.96) ? 'actif' : pick(['suspendu', 'transfere']),
        address: pick(QUARTIERS), city: def.city,
        blood_group: pick(['O+', 'A+', 'B+', 'AB+', 'O-', 'A+']),
        allergies: chance(0.08) ? pick(['Arachide', 'Poussière', 'Lactose', 'Pollen']) : null,
        medical_notes: chance(0.05) ? pick(['Asthme léger — ventoline dans le cartable', 'Port de lunettes', 'Suivi cardiologique']) : null,
        emergency_phone: phRaw(),
        previous_school: chance(0.4) ? pick(['École Darou Salam', 'Complexe Amadou Hampâté Bâ', 'École Keur Yoff', 'Collège Sacré-Cœur']) : null,
        enrolled_at: addDays(YEAR_START, -R(5, 60)),
        canteen: chance(0.35) ? 1 : 0,
        transport_route_id: null,
        discount_pct: chance(0.1) ? pick([10, 15, 20, 50, 100]) : 0,
        scholarship: chance(0.06) ? pick(['Bourse d\'excellence', 'Bourse sociale', 'Fille maintenue à l\'école']) : null,
        tags_json: chance(0.12) ? [pick(['délégué', 'club maths', 'équipe foot', 'besoin de suivi', 'allophone'])] : [],
      });

      // 1 à 2 tuteurs
      const primary = demoParent && isDemoStudent ? demoParent : pick(guardians);
      insert('student_guardians', {
        student_id: sid, guardian_id: primary.id, relation: primary.id === demoParent?.id ? 'père' : pick(['père', 'mère']),
        is_primary: 1, is_payer: 1,
      });
      if (chance(0.55)) {
        const second = pick(guardians.filter((g) => g.id !== primary.id));
        if (second) {
          insert('student_guardians', {
            student_id: sid, guardian_id: second.id, relation: pick(['mère', 'oncle', 'tante', 'frère', 'grand-mère']),
            is_primary: 0, is_payer: 0,
          });
        }
      }
      students.push({ id: sid, userId, first, last, gender, class: cls, guardian: primary, isDemoStudent, tuition: cls.level.tuition });
    }
  }

  /* --- Transport scolaire --- */
  const routes = [
    { name: 'Ligne 1 — Pikine / Guédiawaye', driver: 'Mbaye Sarr', stops: ['Pikine Taxi Dao', 'Cité Damel', 'Guédiawaye Marché', 'Hammo'] },
    { name: 'Ligne 2 — Keur Massar / Rufisque', driver: 'Cheikh Ndao', stops: ['Keur Massar', 'Malika', 'Rufisque Gare', 'Bargny'] },
    { name: 'Ligne 3 — Dakar Plateau / Médina', driver: 'Ousmane Ka', stops: ['Médina', 'Sandaga', 'Plateau', 'Fann'] },
  ].map((r, i) => {
    const id = insert('transport_routes', {
      school_id: schoolId, name: r.name, driver_name: r.driver, driver_phone: phRaw(),
      plate: `DK-${R(1000, 9999)}-A`, capacity: R(28, 42),
      stops_json: r.stops.map((s, k) => ({ name: s, time: `06:${40 + k * 8}`, order: k + 1 })),
      departure: '06:40', monthly_fee: pick([15000, 18000, 20000]), is_active: 1,
    });
    return id;
  });
  students.filter((s) => chance(0.22)).forEach((s) => {
    const routeId = pick(routes);
    db.run('UPDATE students SET transport_route_id=? WHERE id=?', [routeId, s.id]);
  });

  /* --- Frais de scolarité & facturation --- */
  const feeTypes = [
    { name: 'Frais d\'inscription', code: 'INSC', category: 'inscription', amount: def.type === 'public' ? 5000 : pick([15000, 20000, 25000]), installments: 1, is_recurring: 0 },
    { name: 'Scolarité annuelle', code: 'SCOL', category: 'scolarite', amount: 0, installments: 3, is_recurring: 1 },
    { name: 'Cantine (mensuel)', code: 'CANT', category: 'cantine', amount: def.type === 'public' ? 8000 : 20000, installments: 9, is_recurring: 1, applies_to: 'canteen' },
    { name: 'Transport scolaire (mensuel)', code: 'TRAN', category: 'transport', amount: 18000, installments: 9, is_recurring: 1, applies_to: 'transport' },
    { name: 'Tenue & fournitures', code: 'TENUE', category: 'uniforme', amount: def.type === 'public' ? 12000 : 25000, installments: 1, is_recurring: 0 },
    { name: 'Cotisation APE', code: 'APE', category: 'autre', amount: 5000, installments: 1, is_recurring: 0 },
  ];
  const feeIds = {};
  for (const f of feeTypes) {
    feeIds[f.code] = insert('fee_types', {
      school_id: schoolId, name: f.name, code: f.code, category: f.category,
      amount: f.code === 'SCOL' ? 0 : f.amount, installments: f.installments,
      is_recurring: f.is_recurring ? 1 : 0, is_required: f.code === 'SCOL' || f.code === 'INSC' ? 1 : 0,
      applies_to_json: f.applies_to || [],
    });
  }

  let invoiceSeq = 0;
  const invoices = [];
  for (const s of students) {
    const tuition = s.class.level.tuition || 0;
    const discount = Math.round((tuition * (s.discount || 0)) / 100);
    // Inscription
    const insc = feeTypes[0];
    invoiceSeq += 1;
    const inscAmount = money(insc.amount * (1 - (db.get('SELECT discount_pct FROM students WHERE id=?', [s.id]).discount_pct || 0) / 100));
    const inscId = insert('invoices', {
      school_id: schoolId, student_id: s.id, year_id: yearId, fee_type_id: feeIds.INSC,
      invoice_number: `${def.slug.slice(0, 3).toUpperCase()}-FAC-${String(invoiceSeq).padStart(5, '0')}`,
      label: insc.name, amount: inscAmount, due_date: addDays(YEAR_START, -10), issued_at: addDays(YEAR_START, -30),
    });
    invoices.push({ id: inscId, student: s, amount: inscAmount, due: addDays(YEAR_START, -10), kind: 'INSC' });

    // Scolarité en 3 échéances
    if (tuition > 0) {
      const base = Math.round(tuition / 3);
      const dates = [addDays(YEAR_START, 30), '2026-01-15', '2026-04-15'];
      dates.forEach((d, i) => {
        invoiceSeq += 1;
        const amt = i === 2 ? tuition - base * 2 : base;
        const pct = db.get('SELECT discount_pct FROM students WHERE id=?', [s.id]).discount_pct || 0;
        const final = money(amt * (1 - pct / 100));
        const iid = insert('invoices', {
          school_id: schoolId, student_id: s.id, year_id: yearId, fee_type_id: feeIds.SCOL,
          invoice_number: `${def.slug.slice(0, 3).toUpperCase()}-FAC-${String(invoiceSeq).padStart(5, '0')}`,
          label: `Scolarité — échéance ${i + 1}/3`, amount: final, due_date: d, issued_at: addDays(d, -20),
          installment_no: i + 1, installment_of: 3, discount: money(amt - final),
        });
        invoices.push({ id: iid, student: s, amount: final, due: d, kind: 'SCOL' });
      });
    }
    // Cantine / transport mensuels (3 mois facturés)
    const stu = db.get('SELECT canteen, transport_route_id FROM students WHERE id=?', [s.id]);
    if (stu.canteen) {
      ['2025-10-05', '2025-11-05', '2025-12-05'].forEach((d, i) => {
        invoiceSeq += 1;
        const iid = insert('invoices', {
          school_id: schoolId, student_id: s.id, year_id: yearId, fee_type_id: feeIds.CANT,
          invoice_number: `${def.slug.slice(0, 3).toUpperCase()}-FAC-${String(invoiceSeq).padStart(5, '0')}`,
          label: `Cantine — ${['octobre', 'novembre', 'décembre'][i]}`, amount: 20000, due_date: d, issued_at: addDays(d, -5),
        });
        invoices.push({ id: iid, student: s, amount: 20000, due: d, kind: 'CANT' });
      });
    }
    if (stu.transport_route_id) {
      invoiceSeq += 1;
      const iid = insert('invoices', {
        school_id: schoolId, student_id: s.id, year_id: yearId, fee_type_id: feeIds.TRAN,
        invoice_number: `${def.slug.slice(0, 3).toUpperCase()}-FAC-${String(invoiceSeq).padStart(5, '0')}`,
        label: 'Transport scolaire — octobre', amount: 18000, due_date: '2025-10-10', issued_at: '2025-10-01',
      });
      invoices.push({ id: iid, student: s, amount: 18000, due: '2025-10-10', kind: 'TRAN' });
    }
  }

  /* --- Paiements (taux de recouvrement réaliste) --- */
  const methods = ['orange_money', 'wave', 'especes', 'mtn_momo', 'moov_money', 'free_money', 'virement', 'cheque'];
  const methodWeights = [0.34, 0.26, 0.22, 0.06, 0.03, 0.03, 0.04, 0.02];
  let paySeq = 0;
  const pickMethod = () => {
    const r = rnd();
    let acc = 0;
    for (let i = 0; i < methods.length; i += 1) {
      acc += methodWeights[i];
      if (r <= acc) return methods[i];
    }
    return 'especes';
  };

  for (const inv of invoices) {
    const age = (new Date(TODAY) - new Date(inv.due)) / 86400000;
    // Les factures anciennes sont majoritairement réglées
    const payProb = age > 90 ? 0.93 : age > 45 ? 0.85 : age > 15 ? 0.72 : age > 0 ? 0.5 : 0.25;
    const paid = chance(payProb);
    if (!paid) {
      db.run('UPDATE invoices SET status=? WHERE id=?', [age > 0 ? 'en_retard' : 'impayee', inv.id]);
      continue;
    }
    const partial = chance(0.18);
    const amount = partial ? Math.round((inv.amount * (0.3 + rnd() * 0.4)) / 500) * 500 : inv.amount;
    const method = pickMethod();
    const paidAt = addDays(inv.due, R(-12, Math.max(1, Math.min(20, Math.round(age)))));
    paySeq += 1;
    const pid = insert('payments', {
      school_id: schoolId,
      receipt_number: `${def.slug.slice(0, 3).toUpperCase()}-REC-${String(paySeq).padStart(5, '0')}`,
      student_id: inv.student.id, invoice_id: inv.id, amount, method,
      provider_ref: method.includes('money') || method === 'wave' || method === 'mtn_momo' || method === 'moov_money'
        ? `MP${R(100000000, 999999999)}` : method === 'cheque' ? `CHQ${R(100000, 999999)}` : null,
      phone: inv.student.guardian.phone, paid_at: paidAt, received_by: cptUserId,
      note: partial ? 'Paiement partiel — solde à régler' : null,
    });
    if (method !== 'especes' && method !== 'virement' && method !== 'cheque') {
      insert('mobile_money_requests', {
        school_id: schoolId, payment_id: pid, invoice_id: inv.id, student_id: inv.student.id,
        provider: method, phone: inv.student.guardian.phone, amount, status: 'success',
        request_id: `req_${pid}`, paid_at: paidAt,
      });
    }
    db.run('UPDATE invoices SET amount_paid=?, status=? WHERE id=?', [
      amount, amount >= inv.amount ? 'payee' : 'partielle', inv.id,
    ]);
  }

  /* --- Dépenses --- */
  const expenseCategories = [
    ['salaires', 0.42], ['eau_electricite', 0.1], ['fournitures', 0.08], ['entretien', 0.09],
    ['transport', 0.05], ['evenements', 0.06], ['equipements', 0.12], ['impots', 0.05], ['autre', 0.03],
  ];
  const expenseLabels = {
    salaires: ['Salaires enseignants — octobre', 'Salaires personnel administratif', 'Primes de surveillance'],
    eau_electricite: ['Facture Senelec', 'Facture Sen\'Eau', 'Recharge compteur prépayé'],
    fournitures: ['Craies et marqueurs', 'Ramettes de papier A4', 'Registres et cahiers d\'appel', 'Encre imprimante'],
    entretien: ['Réparation bancs', 'Peinture salle 3', 'Entretien climatisation', 'Plomberie sanitaires'],
    transport: ['Carburant bus scolaire', 'Vidange véhicule', 'Péage autoroute'],
    evenements: ['Fête de fin d\'année', 'Journée sportive', 'Cérémonie de remise des prix'],
    equipements: ['Ordinateurs salle informatique', 'Vidéoprojecteur', 'Tableaux blancs', 'Groupe électrogène'],
    impots: ['Taxe communale', 'Impôt sur les salaires', 'Contribution foncière'],
    autre: ['Frais bancaires', 'Abonnement internet', 'Fournitures infirmerie'],
  };
  for (let i = 0; i < 46; i += 1) {
    const r = rnd();
    let acc = 0;
    let cat = 'autre';
    for (const [c, w] of expenseCategories) {
      acc += w;
      if (r <= acc) { cat = c; break; }
    }
    const d = addDays(TODAY, -R(0, 120));
    insert('expenses', {
      school_id: schoolId, expense_date: d, category: cat,
      label: pick(expenseLabels[cat]),
      amount: cat === 'salaires' ? R(900, 4200) * 1000 : R(8, 450) * 1000,
      method: pickMethod(), supplier: chance(0.6) ? pick(['Senelec', 'Sen\'Eau', 'Papel', 'Sonatel', 'CSE', 'Shell', 'Total', 'Entreprise Ndiaye & Frères', 'Librairie 4 Vents']) : null,
      reference: `DEP-${R(10000, 99999)}`, recorded_by: cptUserId, approved_by: dirUserId, status: 'validee',
    });
  }

  /* --- Emploi du temps --- */
  const slotsByDay = [
    ['07:30', '08:25'], ['08:25', '09:20'], ['09:35', '10:30'], ['10:30', '11:25'],
    ['13:00', '13:55'], ['13:55', '14:50'], ['15:05', '16:00'], ['16:00', '16:55'],
  ];
  for (const cls of classes) {
    const csRows = db.all('SELECT * FROM class_subjects WHERE class_id=?', [cls.id]);
    // Répartition des heures par matière selon le volume hebdomadaire
    const plan = [];
    for (const cs of csRows) {
      const hours = Math.max(1, Math.round(cs.hours_per_week));
      for (let h = 0; h < hours; h += 1) plan.push(cs);
    }
    const shuffled = shuffle(plan);
    const days = [1, 2, 3, 4, 5];
    let idx = 0;
    for (const day of days) {
      for (const [start, end] of slotsByDay) {
        if (idx >= shuffled.length) break;
        const cs = shuffled[idx];
        idx += 1;
        insert('timetable_slots', {
          school_id: schoolId, year_id: yearId, class_id: cls.id, subject_id: cs.subject_id,
          teacher_id: cs.teacher_id, day_of_week: day, start_time: start, end_time: end,
          room: cls.id ? db.get('SELECT room FROM classes WHERE id=?', [cls.id]).room : null,
        });
      }
    }
  }

  /* --- Présences (10 dernières semaines) --- */
  const attDays = schoolDays(addDays(TODAY, -70), TODAY).slice(-48);
  let attSessions = 0;
  let attRecords = 0;
  for (const cls of classes) {
    const roster = students.filter((s) => s.class.id === cls.id);
    for (const d of attDays) {
      if (chance(0.03)) continue; // jour non saisi
      attSessions += 1;
      const sessionId = insert('attendance_sessions', {
        school_id: schoolId, class_id: cls.id, teacher_id: cls.mainTeacher.id,
        session_date: d, slot_index: 1, start_time: '07:30', status: 'validated',
        period_label: 'Appel du matin', taken_at: `${d}T07:35:00Z`, validated_at: `${d}T07:40:00Z`,
      });
      for (const st of roster) {
        const r = rnd();
        // ~4% d'absences, 3% de retards, 1% d'excusés ; quelques élèves chroniques
        const chronic = st.id % 23 === 0;
        let status = 'present';
        let late = 0;
        if (chronic ? r < 0.28 : r < 0.045) status = 'absent';
        else if (chronic ? r < 0.4 : r < 0.075) { status = 'retard'; late = R(5, 40); }
        else if (r < 0.085) status = 'excuse';
        attRecords += 1;
        insert('attendance_records', {
          school_id: schoolId, session_id: sessionId, student_id: st.id, status,
          minutes_late: late, note: status === 'absent' && chance(0.25) ? pick(['Non justifié', 'Motif familial', 'Maladie']) : null,
        });
      }
    }
  }

  // Justificatifs d'absence
  for (const s of students) {
    if (!chance(0.12)) continue;
    const from = addDays(TODAY, -R(5, 60));
    insert('absence_justifications', {
      school_id: schoolId, student_id: s.id, date_from: from, date_to: addDays(from, R(0, 3)),
      reason: pick(['Paludisme — certificat médical joint', 'Décès dans la famille', 'Baptême / Magal de Touba', 'Déplacement à l\'intérieur du pays', 'Consultation médicale']),
      reason_type: pick(['maladie', 'familial', 'deplacement']),
      status: chance(0.75) ? 'acceptee' : chance(0.5) ? 'refusee' : 'en_attente',
      submitted_by: s.guardian.userId, created_at: `${from}T09:00:00Z`,
    });
  }

  /* --- Évaluations & notes --- */
  let assessments = 0;
  let gradesCount = 0;
  for (const cls of classes) {
    const csRows = db.all('SELECT * FROM class_subjects WHERE class_id=?', [cls.id]);
    const roster = students.filter((s) => s.class.id === cls.id);
    for (const cs of csRows) {
      const subj = db.get('SELECT * FROM subjects WHERE id=?', [cs.subject_id]);
      const types = cls.cycle === 'Primaire'
        ? [['Interrogation', 2], ['Devoir surveillé n°1', 1], ['Devoir surveillé n°2', 1], ['Composition du 1er trimestre', 2]]
        : [['Devoir surveillé n°1', 1], ['Devoir surveillé n°2', 1], ['Interrogation orale', 0.5], ['Composition du 1er trimestre', 2]];
      for (const [name, coef] of types) {
        const date = name.includes('Composition') ? pick(['2025-12-08', '2025-12-09', '2025-12-10', '2025-12-11', '2025-12-12']) : addDays(YEAR_START, R(10, 55));
        assessments += 1;
        const aid = insert('assessments', {
          school_id: schoolId, class_id: cls.id, subject_id: cs.subject_id, term_id: termIds[0],
          name, type: name.includes('Composition') ? 'composition' : name.includes('orale') ? 'oral' : name.includes('Interrogation') ? 'interrogation' : 'devoir',
          assess_date: date, max_score: 20, coefficient: coef, counts_for: 1,
          teacher_id: cs.teacher_id, status: 'published',
        });
        // Profil de classe : niveau moyen et dispersion
        const classMean = 9.5 + rnd() * 4;
        for (const st of roster) {
          const talent = (st.id % 17) / 17; // stabilité relative de l'élève
          const noise = (rnd() - 0.5) * 4.5;
          let score = classMean + talent * 6 - 3 + noise;
          score = Math.max(1, Math.min(20, score));
          const absent = chance(0.02);
          gradesCount += 1;
          insert('grades', {
            school_id: schoolId, assessment_id: aid, student_id: st.id,
            score: absent ? null : round(score, 2), is_absent: absent ? 1 : 0,
          });
        }
      }
    }
  }

  /* --- Bulletins du 1er trimestre --- */
  const gradingScale = config.schoolDefaults.gradingScale;
  let reports = 0;
  for (const cls of classes) {
    const roster = students.filter((s) => s.class.id === cls.id);
    const csRows = db.all('SELECT cs.*, s.name AS subject_name, s.code FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id WHERE cs.class_id=?', [cls.id]);
    const perStudent = [];
    for (const st of roster) {
      const subjectAvgs = [];
      let weighted = 0;
      let coefSum = 0;
      for (const cs of csRows) {
        const row = db.get(
          `SELECT AVG(g.score) avg, COUNT(g.id) n FROM grades g
             JOIN assessments a ON a.id = g.assessment_id
            WHERE a.class_id=? AND a.subject_id=? AND a.term_id=? AND g.student_id=? AND g.is_absent=0`,
          [cls.id, cs.subject_id, termIds[0], st.id]
        );
        const avg = row?.avg ? round(row.avg, 2) : null;
        if (avg !== null) {
          subjectAvgs.push({ subject_id: cs.subject_id, subject: cs.subject_name, code: cs.code, avg, coef: cs.coefficient, teacher_id: cs.teacher_id });
          weighted += avg * cs.coefficient;
          coefSum += cs.coefficient;
        }
      }
      const general = coefSum ? round(weighted / coefSum, 2) : 0;
      perStudent.push({ st, general, subjectAvgs });
    }
    const sorted = [...perStudent].sort((a, b) => b.general - a.general);
    sorted.forEach((entry, rank) => {
      const { st, general, subjectAvgs } = entry;
      const mention = gradingScale.find((m) => general >= m.min)?.mention || 'Insuffisant';
      // Stats de classe par matière
      for (const sa of subjectAvgs) {
        const vals = perStudent.map((p) => p.subjectAvgs.find((x) => x.subject_id === sa.subject_id)?.avg).filter((v) => v != null);
        sa.class_avg = round(vals.reduce((a, b) => a + b, 0) / (vals.length || 1), 2);
        sa.min = round(Math.min(...vals), 2);
        sa.max = round(Math.max(...vals), 2);
        sa.rank = vals.slice().sort((a, b) => b - a).indexOf(sa.avg) + 1;
        sa.appreciation = sa.avg >= 16 ? 'Excellent travail, continuez ainsi.'
          : sa.avg >= 14 ? 'Très bon trimestre, des capacités réelles.'
          : sa.avg >= 12 ? 'Bon ensemble, peut mieux faire avec plus de rigueur.'
          : sa.avg >= 10 ? 'Travail correct mais résultats fragiles.'
          : sa.avg >= 8 ? 'Résultats insuffisants : fournir un effort soutenu.'
          : 'Très insuffisant. Un suivi à la maison est indispensable.';
      }
      reports += 1;
      insert('report_cards', {
        school_id: schoolId, student_id: st.id, term_id: termIds[0], class_id: cls.id,
        general_avg: general, subject_avgs_json: subjectAvgs, rank: rank + 1, total_students: sorted.length,
        attendance_pct: round(85 + rnd() * 15, 1), absences_hours: round(rnd() * 24, 1), mention,
        teacher_comment: general >= 14 ? 'Trimestre réussi. Félicitations du conseil de classe.'
          : general >= 12 ? 'Bon trimestre dans l\'ensemble. Encouragements.'
          : general >= 10 ? 'Trimestre satisfaisant mais perfectible. Poursuivre les efforts.'
          : general >= 8 ? 'Résultats justes. Un travail personnel plus régulier est attendu.'
          : 'Avertissement de travail : les résultats sont très insuffisants.',
        principal_comment: general >= 14 ? 'Félicitations de la Direction.' : general < 8 ? 'La Direction appelle à une mobilisation de la famille.' : null,
        status: 'publie', generated_at: '2026-01-06T10:00:00Z', validated_by: cenUserId, published_at: '2026-01-10T08:00:00Z',
      });
      for (const sa of subjectAvgs) {
        insert('subject_appreciations', {
          school_id: schoolId, student_id: st.id, term_id: termIds[0], subject_id: sa.subject_id,
          teacher_id: sa.teacher_id, appreciation: sa.appreciation,
        });
      }
    });
  }

  /* --- Cahier de textes & devoirs --- */
  const lessonTitles = {
    MATH: ['Les fractions — comparaison', 'Théorème de Pythagore', 'Calcul littéral et factorisation', 'Proportionnalité', 'Les nombres décimaux', 'Géométrie : symétrie axiale', 'Statistiques : moyennes'],
    FRAN: ['La description — portrait physique', 'Le récit d\'aventures', 'Conjugaison : le passé composé', 'Dictée préparée n°4', 'Étude de texte : "Une si longue lettre"', 'Grammaire : les compléments'],
    SVT: ['La respiration chez les végétaux', 'Les chaînes alimentaires', 'Le corps humain : la digestion', 'Reproduction des plantes à fleurs'],
    HG: ['Le Sénégal colonial', 'Les grands fleuves d\'Afrique', 'La population mondiale', 'L\'empire du Mali'],
    ANGL: ['Present perfect', 'Vocabulary: school life', 'Reading comprehension: a day in Banjul'],
    PHY: ['Les circuits électriques', 'La combustion', 'Les états de la matière'],
    EPS: ['Course de durée — endurance', 'Basket-ball : passes et dribbles', 'Athlétisme : saut en longueur'],
    INFO: ['Traitement de texte : mise en forme', 'Tableur : formules de base', 'Internet et sécurité numérique'],
    ARTS: ['Le dessin à main levée', 'Couleurs primaires et secondaires', 'Masques et motifs africains'],
    EI: ['Les piliers de l\'Islam', 'Valeurs morales : le respect', 'Récits du Coran'],
    PHILO: ['La conscience', 'Le travail et la technique', 'La liberté'],
    ESP: ['El presente de indicativo', 'Vocabulario: la familia'],
    ARA: ['Lecture et écriture — leçon 5', 'Conjugaison arabe : le présent'],
    DDM: ['Le cycle de l\'eau', 'Les instruments de mesure', 'Le temps qui passe'],
  };
  for (const cls of classes) {
    const csRows = db.all('SELECT cs.*, s.code AS code, s.name AS subject_name FROM class_subjects cs JOIN subjects s ON s.id=cs.subject_id WHERE cs.class_id=?', [cls.id]);
    for (const d of schoolDays(addDays(TODAY, -45), TODAY)) {
      for (const cs of csRows) {
        if (!chance(0.35)) continue;
        const titles = lessonTitles[cs.code] || ['Séance de révision', 'Exercices d\'application', 'Contrôle des acquis'];
        insert('lesson_logs', {
          school_id: schoolId, class_id: cls.id, subject_id: cs.subject_id, teacher_id: cs.teacher_id,
          lesson_date: d, duration_min: pick([55, 55, 50, 45]),
          title: pick(titles),
          content: pick(titles) + ' — exercices d\'application au tableau puis en autonomie.',
          objective: 'Maîtriser les notions fondamentales et savoir les mobiliser en situation.',
          homework: chance(0.6) ? `Exercices ${R(1, 12)} à ${R(13, 20)} p. ${R(20, 180)} — à rendre pour le ${addDays(d, R(2, 6))}` : null,
          progress_pct: round(20 + rnd() * 55, 0),
          validated_by: chance(0.8) ? cenUserId : null,
          validated_at: chance(0.8) ? `${d}T16:00:00Z` : null,
        });
      }
    }
    // Devoirs maison
    for (const cs of csRows.slice(0, 4)) {
      if (!chance(0.7)) continue;
      const hwId = insert('homework', {
        school_id: schoolId, class_id: cls.id, subject_id: cs.subject_id, teacher_id: cs.teacher_id,
        title: `DM n°${R(1, 3)} — ${db.get('SELECT name FROM subjects WHERE id=?', [cs.subject_id]).name}`,
        description: 'Travail individuel. Soignez la présentation et justifiez chaque réponse. Barème sur 20.',
        assigned_at: addDays(TODAY, -R(3, 12)), due_date: addDays(TODAY, R(-2, 8)),
        estimated_min: pick([30, 45, 60]), is_graded: 1,
      });
      const roster = students.filter((s) => s.class.id === cls.id);
      for (const st of roster) {
        const r = rnd();
        insert('homework_submissions', {
          homework_id: hwId, student_id: st.id,
          status: r < 0.68 ? 'rendu' : r < 0.8 ? 'en_retard' : r < 0.92 ? 'a_rendre' : 'manquant',
          submitted_at: r < 0.88 ? `${addDays(TODAY, -R(0, 6))}T1${R(0, 9)}:${R(10, 59)}:00Z` : null,
          score: r < 0.8 ? round(8 + rnd() * 11, 1) : null,
        });
      }
    }
  }

  /* --- Discipline --- */
  const incidentTypes = [
    ['retard', 'leger', 'Arrivée en retard sans justification'],
    ['bavardage', 'leger', 'Bavardages répétés pendant le cours'],
    ['telephone', 'moyen', 'Utilisation du téléphone en classe'],
    ['absence_non_justifiee', 'moyen', 'Absence non justifiée auprès de la vie scolaire'],
    ['insolence', 'grave', 'Propos irrespectueux envers un enseignant'],
    ['bagarre', 'grave', 'Bagarre dans la cour de récréation'],
    ['tricherie', 'moyen', 'Tricherie pendant une évaluation'],
    ['degradation', 'moyen', 'Dégradation de matériel scolaire'],
  ];
  for (const s of students) {
    if (!chance(0.09)) continue;
    const [type, severity, desc] = pick(incidentTypes);
    const d = addDays(TODAY, -R(1, 80));
    insert('discipline_incidents', {
      school_id: schoolId, student_id: s.id, incident_date: d, type, severity, description: desc,
      location: pick(['Salle de classe', 'Cour de récréation', 'Réfectoire', 'Couloir', 'Portail', 'Salle informatique']),
      reported_by: pick(teachers).id,
      sanction: severity === 'leger' ? 'avertissement' : severity === 'moyen' ? pick(['avertissement', 'retenue', 'blame']) : pick(['retenue', 'exclusion_temporaire', 'blame']),
      sanction_days: severity === 'grave' ? R(1, 3) : 0,
      parents_notified: chance(0.8) ? 1 : 0,
      status: chance(0.7) ? 'traite' : 'ouvert',
      followup: chance(0.4) ? 'Entretien avec le parent le ' + addDays(d, 2) : null,
    });
  }

  /* --- Admissions / candidatures --- */
  for (let i = 0; i < (def.plan === 'elite' ? 34 : def.plan === 'pro' ? 22 : 9); i += 1) {
    const gender = chance(0.5) ? 'F' : 'M';
    const first = gender === 'F' ? pick(FIRST_F) : pick(FIRST_M);
    const last = pick(LAST);
    const status = pick(['nouveau', 'dossier_complet', 'entretien', 'teste', 'admis', 'admis', 'liste_attente', 'refuse', 'inscrit']);
    insert('applications', {
      school_id: schoolId, year_id: yearId, reference: `CAND-${String(i + 1).padStart(4, '0')}`,
      first_name: first, last_name: last, gender, birth_date: birthDate(R(6, 17)),
      level_requested: pick(def.levels).name, previous_school: pick(['École Darou Salam', 'Complexe Amadou Hampâté Bâ', 'École publique Keur Massar', 'Collège Moderne']),
      guardian_name: personName(chance(0.6) ? 'M' : 'F'), guardian_phone: phRaw(),
      address: pick(QUARTIERS), status, score: status === 'teste' || status === 'admis' ? round(9 + rnd() * 9, 1) : null,
      interview_date: chance(0.4) ? addDays(TODAY, R(-20, 15)) : null,
      decision_note: status === 'refuse' ? 'Effectif complet / niveau insuffisant' : null,
      source: pick(['guichet', 'site_web', 'telephone', 'parrainage', 'sms']),
      created_at: `${addDays(TODAY, -R(0, 90))}T${R(8, 17)}:${R(10, 59)}:00Z`,
    });
  }

  /* --- Bibliothèque --- */
  const books = [
    ['Une si longue lettre', 'Mariama Bâ', 'Roman'], ['Les Bouts de bois de Dieu', 'Ousmane Sembène', 'Roman'],
    ["L'Aventure ambiguë", 'Cheikh Hamidou Kane', 'Roman'], ['Le Docker noir', 'Ousmane Sembène', 'Roman'],
    ['Contes et légendes du Sénégal', 'Amadou Cissé Dia', 'Conte'], ['Les Petits de la guenon', 'Birago Diop', 'Conte'],
    ['Nouvelles du Sénégal', 'Collectif', 'Nouvelle'], ['Mathématiques 3ème — CIAM', 'CIAM', 'Manuel'],
    ['Français 6ème — CIAM', 'CIAM', 'Manuel'], ['SVT 4ème', 'EDICEF', 'Manuel'],
    ['Le Petit Prince', 'Antoine de Saint-Exupéry', 'Roman'], ['Les Misérables (abrégé)', 'Victor Hugo', 'Roman'],
    ['Dictionnaire Larousse scolaire', 'Larousse', 'Dictionnaire'], ['Atlas de l\'Afrique', 'Jaguar', 'Documentaire'],
    ['Histoire du Sénégal', 'Iba Der Thiam', 'Documentaire'], ['Tintin au Congo', 'Hergé', 'BD'],
  ];
  const bookIds = books.map(([title, author, category], i) =>
    insert('library_books', {
      school_id: schoolId, title, author, isbn: `978-2-${R(1000, 9999)}-${R(100, 999)}-${i}`,
      category, publisher: pick(['Présence Africaine', 'Karthala', 'EDICEF', 'NEAS', 'Gallimard', 'Hachette']),
      publish_year: R(1960, 2022), copies: R(2, 12), available: R(0, 8), shelf: `${String.fromCharCode(65 + (i % 6))}-${R(1, 9)}`,
      loan_days: 14, is_active: 1,
    }));
  for (const s of students) {
    if (!chance(0.16)) continue;
    const bookId = pick(bookIds);
    const loaned = addDays(TODAY, -R(1, 40));
    const due = addDays(loaned, 14);
    const returned = chance(0.6);
    const overdue = !returned && due < TODAY;
    insert('library_loans', {
      school_id: schoolId, book_id: bookId, student_id: s.id, loaned_at: loaned, due_at: due,
      returned_at: returned ? addDays(loaned, R(3, 16)) : null, renewals: chance(0.2) ? 1 : 0,
      fine: overdue ? R(1, 8) * 500 : 0, status: returned ? 'rendu' : overdue ? 'en_retard' : 'en_cours',
    });
  }

  /* --- Cantine & santé --- */
  const menus = ['Thiéboudienne + jus de bissap', 'Yassa poulet + riz blanc', 'Mafé de bœuf + riz', 'Couscous sénégalais + lait', 'Poulet DG + frites', 'Soupe kandia + poisson', 'Haricots rouges + riz', 'Sandwich thon + fruit'];
  for (const d of schoolDays(addDays(TODAY, -20), TODAY)) {
    for (const s of students) {
      const stu = db.get('SELECT canteen FROM students WHERE id=?', [s.id]);
      if (!stu?.canteen) continue;
      if (!chance(0.85)) continue;
      insert('canteen_records', {
        school_id: schoolId, student_id: s.id, record_date: d, meal_type: 'dejeuner',
        menu: pick(menus), present: chance(0.93) ? 1 : 0,
      });
    }
  }
  for (const s of students) {
    if (!chance(0.07)) continue;
    insert('health_records', {
      school_id: schoolId, student_id: s.id, record_date: addDays(TODAY, -R(1, 60)),
      type: pick(['consultation', 'blessure', 'malaise', 'traitement']),
      symptoms: pick(['Maux de tête', 'Fièvre légère', 'Blessure au genou', 'Vertiges', 'Douleurs abdominales', 'Coupure au doigt']),
      diagnosis: pick(['Fatigue', 'Déshydratation légère', 'Plaie superficielle', 'Crise de paludisme probable']),
      treatment: pick(['Repos à l\'infirmerie 30 min', 'Paracétamol 500mg', 'Pansement + désinfectant', 'ORS + surveillance']),
      parent_notified: 1, recorded_by: dirUserId,
    });
  }

  /* --- Paie --- */
  const runId = insert('payroll_runs', {
    school_id: schoolId, period: monthOf(TODAY), status: 'valide', created_by: cptUserId,
    validated_at: `${TODAY}T09:00:00Z`,
  });
  const staffRows = db.all('SELECT * FROM staff WHERE school_id=? AND staff_type IN (\'enseignant\',\'direction\',\'administratif\')', [schoolId]);
  for (const st of staffRows) {
    const base = st.salary_base || 0;
    const extra = chance(0.3) ? round(R(2, 8), 1) : 0;
    const bonus = extra * (st.hourly_rate || 2500);
    const social = Math.round(base * 0.056);
    const tax = base > 300000 ? Math.round((base - 300000) * 0.12) : 0;
    const net = base + bonus - social - tax;
    insert('payslips', {
      school_id: schoolId, run_id: runId, staff_id: st.id, base_salary: base, hours_extra: extra,
      bonus: Math.round(bonus), deductions: 0, tax, social, net,
      lines_json: [
        { label: 'Salaire de base', type: 'gain', amount: base },
        ...(extra ? [{ label: `Heures supplémentaires (${extra}h)`, type: 'gain', amount: Math.round(bonus) }] : []),
        { label: 'Retenue IPRES (5,6%)', type: 'retenue', amount: social },
        ...(tax ? [{ label: 'IRF / impôt sur salaire', type: 'retenue', amount: tax }] : []),
      ],
      status: 'valide', method: pick(['virement', 'especes', 'orange_money']),
    });
  }
  db.run(
    'UPDATE payroll_runs SET total_gross=(SELECT COALESCE(SUM(base_salary+bonus),0) FROM payslips WHERE run_id=?), total_net=(SELECT COALESCE(SUM(net),0) FROM payslips WHERE run_id=?) WHERE id=?',
    [runId, runId, runId]
  );

  // Congés & pointage du personnel
  for (const st of staffRows) {
    if (chance(0.15)) {
      const from = addDays(TODAY, R(-40, 20));
      insert('staff_leaves', {
        school_id: schoolId, staff_id: st.id, leave_type: pick(['conge_annuel', 'maladie', 'maternite', 'familial', 'evenement']),
        date_from: from, date_to: addDays(from, R(1, 12)), days: R(1, 12),
        reason: pick(['Congé annuel planifié', 'Certificat médical', 'Événement familial', 'Congé maternité']),
        status: pick(['approuve', 'approuve', 'en_attente', 'refuse']), approved_by: dirUserId,
      });
    }
    for (const d of schoolDays(addDays(TODAY, -14), TODAY)) {
      const r = rnd();
      insert('staff_timesheets', {
        school_id: schoolId, staff_id: st.id, work_date: d,
        check_in: r < 0.85 ? `07:${String(R(15, 35)).padStart(2, '0')}` : r < 0.93 ? `07:${String(R(40, 59)).padStart(2, '0')}` : null,
        check_out: `1${R(3, 7)}:${String(R(0, 59)).padStart(2, '0')}`,
        hours: round(7 + rnd() * 2.5, 1),
        status: r < 0.85 ? 'present' : r < 0.93 ? 'retard' : 'absent',
      });
    }
  }

  /* --- Messages, notifications, SMS, événements --- */
  const announcements = [
    ['Rentrée des classes 2025-2026', 'La rentrée officielle est fixée au lundi 6 octobre 2025 à 7h30. Les listes de classes sont affichées au secrétariat et disponibles sur le portail parents.', 'annonce', 'haute'],
    ['Calendrier des compositions du 1er trimestre', 'Les compositions se dérouleront du lundi 8 au vendredi 12 décembre 2025 selon le planning communiqué. Aucun téléphone n\'est autorisé en salle.', 'circulaire', 'haute'],
    ['Réunion parents-professeurs', 'Nous invitons l\'ensemble des parents à la réunion trimestrielle le samedi à 9h00 dans la salle polyvalente. Ordre du jour : résultats, discipline, cantine.', 'annonce', 'normale'],
    ['Paiement de la scolarité — échéance de janvier', 'Nous rappelons aux parents que la 2ème échéance de scolarité est due avant le 15 janvier. Le paiement par Orange Money et Wave est disponible depuis le portail parents, sans frais.', 'annonce', 'haute'],
    ['Journée sportive inter-classes', 'La journée sportive aura lieu sur le terrain municipal. Tenue de sport obligatoire. Rendez-vous à 8h00.', 'annonce', 'normale'],
    ['Interdiction des téléphones portables', 'Conformément au règlement intérieur, l\'usage du téléphone est strictement interdit dans l\'enceinte de l\'établissement. Tout appareil confisqué sera restitué au parent.', 'circulaire', 'haute'],
    ['Coupure d\'eau jeudi', 'La Sen\'Eau annonce une coupure ce jeudi de 9h à 14h. Merci de prévoir une gourde pour vos enfants.', 'urgence', 'urgente'],
    ['Résultats du BFEM / Baccalauréat', 'Les résultats seront affichés dès leur publication officielle. Les bulletins du 3ème trimestre seront remis contre signature.', 'annonce', 'normale'],
  ];
  const msgIds = [];
  for (const [subject, body, type, priority] of announcements) {
    const sender = type === 'circulaire' ? dirUserId : secUserId;
    const u = db.get('SELECT first_name,last_name FROM users WHERE id=?', [sender]);
    const id = insert('messages', {
      school_id: schoolId, sender_id: sender, sender_name: `${u.first_name} ${u.last_name}`,
      subject, body, msg_type: type, priority,
      audience_json: { roles: type === 'urgence' ? ['parent', 'eleve', 'enseignant'] : ['parent', 'eleve'] },
      pinned: priority === 'urgente' ? 1 : 0,
      notify_sms: priority === 'haute' || priority === 'urgente' ? 1 : 0,
      sent_at: `${addDays(TODAY, -R(1, 60))}T${R(8, 16)}:00:00Z`,
    });
    msgIds.push(id);
  }
  // Quelques messages directs
  for (let i = 0; i < 8; i += 1) {
    const t = pick(teachers);
    const g = pick(guardians);
    if (!g.userId) continue;
    insert('messages', {
      school_id: schoolId, sender_id: t.userId, sender_name: `${t.first} ${t.last}`,
      subject: pick(['Suivi de votre enfant', 'Retard de devoir', 'Progrès à souligner', 'Rendez-vous souhaité']),
      body: pick([
        'Bonjour, je souhaiterais échanger avec vous sur les résultats de votre enfant ce trimestre. Seriez-vous disponible cette semaine ?',
        'Votre enfant a rendu son devoir avec retard. Merci de veiller à ce qu\'il s\'organise mieux.',
        'Je tiens à vous féliciter pour les progrès remarquables constatés en classe. Continuez à l\'encourager.',
      ]),
      msg_type: 'direct', audience_json: { users: [g.userId] }, sent_at: `${addDays(TODAY, -R(1, 30))}T${R(9, 17)}:00:00Z`,
    });
  }

  // Notifications par utilisateur
  const notifTargets = db.all('SELECT id, role FROM users WHERE school_id=? AND role IN (\'direction\',\'comptable\',\'enseignant\',\'secretaire\',\'parent\',\'eleve\')', [schoolId]);
  for (const u of notifTargets) {
    const count = u.role === 'direction' ? 6 : u.role === 'comptable' ? 5 : u.role === 'parent' ? 4 : u.role === 'enseignant' ? 4 : 2;
    for (let i = 0; i < count; i += 1) {
      const tpl = pick([
        ['paiement', 'Nouveau paiement reçu', 'Un paiement de 25 000 FCFA a été reçu via Orange Money.', '/finance/paiements'],
        ['absence', 'Absence signalée', 'Un élève est absent aujourd\'hui. Le parent a été notifié par SMS.', '/vie-scolaire/presences'],
        ['note', 'Notes à saisir', 'La composition de Mathématiques attend la saisie des notes.', '/pedagogie/notes'],
        ['message', 'Nouveau message', 'Vous avez reçu un message de la direction.', '/communication/messages'],
        ['facture', 'Impayés en hausse', '12 factures sont en retard de plus de 30 jours.', '/finance/impayes'],
        ['evenement', 'Conseil de classe', 'Le conseil de classe est programmé dans 5 jours.', '/calendrier'],
        ['systeme', 'Sauvegarde effectuée', 'La sauvegarde automatique quotidienne a réussi.', '/parametres/securite'],
        ['alerte', 'Effectif dépassé', 'Une classe dépasse sa capacité maximale.', '/scolaire/classes'],
      ]);
      insert('notifications', {
        school_id: schoolId, user_id: u.id, type: tpl[0], title: tpl[1], body: tpl[2], link: tpl[3],
        priority: chance(0.2) ? 'haute' : 'normale',
        read_at: chance(0.45) ? `${addDays(TODAY, -R(0, 5))}T10:00:00Z` : null,
        created_at: `${addDays(TODAY, -R(0, 21))}T${R(7, 19)}:${R(10, 59)}:00Z`,
      });
    }
  }

  // File SMS
  const smsTemplates = [
    ['absence', 'Alerte absence', 'Bonjour {parent}, {eleve} est absent(e) ce jour à {ecole}. Merci de nous contacter au {tel}.'],
    ['retard', 'Alerte retard', 'Bonjour {parent}, {eleve} est arrivé(e) en retard de {minutes} min à {ecole}.'],
    ['facture', 'Relance facture', 'Bonjour {parent}, il reste {solde} FCFA à régler pour {eleve} ({facture}). Payez via Orange Money/Wave sur le portail {ecole}.'],
    ['note', 'Publication notes', 'Bonjour {parent}, le bulletin du 1er trimestre de {eleve} est disponible sur le portail {ecole}.'],
    ['evenement', 'Rappel événement', 'Bonjour, rappel : {evenement} le {date} à {heure} — {ecole}.'],
    ['paiement', 'Reçu paiement', '{ecole} confirme votre paiement de {montant} FCFA (reçu {recu}). Merci.'],
    ['libre', 'Message libre', '{message}'],
  ];
  for (const [code, name, body] of smsTemplates) insert('sms_templates', { school_id: schoolId, code, name, body });

  const absences = db.all(
    `SELECT ar.student_id, s.first_name, s.last_name, g.phone, asess.session_date, ar.status, ar.minutes_late
       FROM attendance_records ar
       JOIN attendance_sessions asess ON asess.id = ar.session_id
       JOIN students s ON s.id = ar.student_id
       JOIN student_guardians sg ON sg.student_id = s.id AND sg.is_primary=1
       JOIN guardians g ON g.id = sg.guardian_id
      WHERE ar.status IN ('absent','retard') AND s.school_id=? AND asess.session_date >= date('now','-45 day')
      LIMIT 420`,
    [schoolId]
  );
  for (const a of absences) {
    if (!a.phone) continue;
    const body = a.status === 'absent'
      ? `Bonjour, ${a.first_name} ${a.last_name} est absent(e) ce jour à ${def.name}. Merci de nous contacter.`
      : `Bonjour, ${a.first_name} ${a.last_name} est arrivé(e) en retard de ${a.minutes_late} min à ${def.name}.`;
    insert('sms_queue', {
      school_id: schoolId, to_number: a.phone, body, recipient_name: `${a.first_name} ${a.last_name}`,
      student_id: a.student_id, template: a.status === 'absent' ? 'absence' : 'retard',
      status: chance(0.92) ? 'envoye' : chance(0.5) ? 'echoue' : 'en_attente',
      provider: pick(['orange_api', 'simule']), provider_ref: chance(0.9) ? `SMS${R(100000, 999999)}` : null,
      error: null, sent_at: `${a.session_date}T08:15:00Z`, created_at: `${a.session_date}T08:10:00Z`,
    });
  }
  // Relances de facture
  const lateInvoices = db.all(
    `SELECT i.*, s.first_name, s.last_name, g.phone FROM invoices i
       JOIN students s ON s.id=i.student_id
       JOIN student_guardians sg ON sg.student_id=s.id AND sg.is_payer=1
       JOIN guardians g ON g.id=sg.guardian_id
      WHERE i.school_id=? AND i.status IN ('impayee','partielle','en_retard') AND i.due_date < date('now') LIMIT 120`,
    [schoolId]
  );
  for (const i of lateInvoices) {
    const solde = i.amount - i.amount_paid;
    insert('sms_queue', {
      school_id: schoolId, to_number: i.phone,
      body: `Bonjour, il reste ${solde.toLocaleString('fr-FR')} FCFA à régler pour ${i.first_name} ${i.last_name} (${i.invoice_number}). Payez par Orange Money/Wave sur le portail ${def.name}.`,
      recipient_name: `${i.first_name} ${i.last_name}`, student_id: i.student_id, template: 'facture',
      status: 'envoye', provider: 'orange_api', provider_ref: `SMS${R(100000, 999999)}`,
      sent_at: `${addDays(TODAY, -R(1, 20))}T10:00:00Z`,
    });
    db.run('UPDATE invoices SET reminder_count=?, last_reminder_at=? WHERE id=?', [R(1, 3), addDays(TODAY, -R(1, 20)), i.id]);
  }

  /* --- Événements & jours fériés --- */
  const evts = [
    ['Rentrée officielle', 'autre', '2025-10-06', null, '07:30', 'Cour de l\'établissement'],
    ['Toussaint — vacances', 'ferie', '2025-11-01', '2025-11-03', null, null],
    ['Réunion parents-professeurs', 'reunion', addDays(TODAY, R(3, 20)), null, '09:00', 'Salle polyvalente'],
    ['Compositions du 1er trimestre', 'examen', '2025-12-08', '2025-12-12', '08:00', 'Salles d\'examen'],
    ['Conseil de classe T1', 'conseil_classe', '2026-01-06', null, '14:00', 'Salle des professeurs'],
    ['Remise des bulletins T1', 'remise_bulletins', '2026-01-10', null, '09:00', 'Secrétariat'],
    ['Journée sportive', 'sport', addDays(TODAY, R(5, 40)), null, '08:00', 'Terrain municipal'],
    ['Fête de fin d\'année', 'culturel', '2026-06-27', null, '15:00', 'Cour de l\'établissement'],
    ['Magal de Touba', 'ferie', '2025-11-11', null, null, null],
    ['Gamou (Maouloud)', 'ferie', '2025-12-05', null, null, null],
    ['Journée de l\'excellence', 'culturel', addDays(TODAY, R(20, 90)), null, '10:00', 'Cour'],
    ['Formation des enseignants au numérique', 'formation', addDays(TODAY, R(2, 25)), null, '14:00', 'Salle informatique'],
    ['Examen blanc BFEM', 'examen', '2026-05-11', '2026-05-15', '08:00', 'Salles'],
    ['Vacances de Pâques / Korité', 'ferie', '2026-03-20', '2026-03-28', null, null],
  ];
  for (const [title, type, date, end, time, loc] of evts) {
    insert('events', {
      school_id: schoolId, title, event_type: type, event_date: date, end_date: end,
      start_time: time, location: loc, is_all_day: time ? 0 : 1,
      color: type === 'examen' ? '#b91c1c' : type === 'ferie' ? '#15803d' : type === 'reunion' ? '#1d4ed8' : '#7c3aed',
      audience_json: { roles: ['parent', 'eleve', 'enseignant', 'direction'] },
    });
  }
  for (const [name, date] of [
    ['Nouvel An', '2026-01-01'], ['Fête du Travail', '2026-05-01'], ['Fête de l\'Indépendance', '2026-04-04'],
    ['Assomption', '2026-08-15'], ['Noël', '2025-12-25'], ['Pâques', '2026-04-05'],
  ]) insert('holidays', { school_id: schoolId, name, date, is_recurring: 1 });

  /* --- Demandes de documents --- */
  for (const s of students) {
    if (!chance(0.06)) continue;
    insert('document_requests', {
      school_id: schoolId, student_id: s.id, doc_type: pick(['certificat_scolarite', 'releve_notes', 'attestation_reussite', 'bulletin_dupli']),
      requested_by: s.guardian.userId || secUserId, reason: pick(['Dossier scolaire', 'Allocations familiales', 'Assurance', 'Visa', 'Concours']),
      status: pick(['en_attente', 'pret', 'remis']), copies: R(1, 3), fee: pick([0, 1000, 2000]),
      processed_by: secUserId, requested_at: `${addDays(TODAY, -R(1, 45))}T${R(8, 16)}:00:00Z`,
    });
  }

  /* --- Budget prévisionnel --- */
  for (const [cat, amt] of [['salaires', 38000000], ['eau_electricite', 2400000], ['entretien', 3200000], ['equipements', 6500000], ['fournitures', 1800000], ['evenements', 2200000]]) {
    insert('budgets', { school_id: schoolId, year_id: yearId, category: cat, amount: amt });
  }

  /* --- Audit log de départ --- */
  for (const [action, entity, summary] of [
    ['login', 'user', 'Connexion réussie'], ['create', 'student', 'Création d\'un dossier élève'],
    ['validate', 'report_card', 'Validation des bulletins du 1er trimestre'], ['export', 'finance', 'Export CSV des paiements'],
    ['update', 'settings', 'Modification des paramètres de l\'établissement'],
  ]) {
    insert('audit_logs', {
      school_id: schoolId, user_id: dirUserId, user_name: `${headFirst || 'Ibrahima'} ${headLast || 'Gueye'}`,
      action, entity, summary, ip: '196.168.1.10', created_at: `${addDays(TODAY, -R(0, 20))}T${R(8, 18)}:00:00Z`,
    });
  }

  console.log(
    `  · ${def.name} (${def.plan}) → ${students.length} élèves, ${classes.length} classes, ${teachers.length} enseignants, ` +
    `${invoices.length} factures, ${attRecords} pointages, ${gradesCount} notes, ${reports} bulletins [${Date.now() - t0} ms]`
  );
  return { schoolId, students, classes, teachers, guardians };
}

function monthOf(d) {
  return String(d).slice(0, 7);
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */
function isEmpty() {
  return db.get('SELECT COUNT(*) c FROM schools').c === 0;
}

export function seed() {
  const partial = !isEmpty() === false && db.get('SELECT COUNT(*) c FROM users').c > 0;
  if (FRESH || partial) {
    console.log(partial && !FRESH ? 'Base partiellement peuplée → réinitialisation…' : 'Réinitialisation de la base de démonstration…');
    wipe();
  } else if (!isEmpty()) {
    console.log('Base déjà peuplée — utilisez « npm run seed:fresh » pour régénérer.');
    return { skipped: true };
  }
  const t0 = Date.now();
  console.log('Génération du jeu de démonstration (Sénégal — 3 établissements)…');

  // Super administrateur plateforme (idempotent)
  const existing = db.get('SELECT id FROM users WHERE email=?', [config.platform.superAdminEmail]);
  if (existing) {
    db.run('UPDATE users SET password_hash=?, role=\'super_admin\', is_active=1 WHERE id=?', [
      hash(config.platform.superAdminPassword), existing.id,
    ]);
  } else {
    insert('users', {
      school_id: null, role: 'super_admin', first_name: 'Super', last_name: 'Admin',
      email: config.platform.superAdminEmail, phone: '+221770000000',
      password_hash: hash(config.platform.superAdminPassword), avatar_color: '#0f172a',
    });
  }

  const results = SCHOOL_DEFS.map((def, i) => seedSchool(def, i));

  console.log(`\nTerminé en ${Date.now() - t0} ms.`);
  console.log('\n──────── Comptes de démonstration (mot de passe : Sunu2026!) ────────');
  for (const def of SCHOOL_DEFS) {
    console.log(`\n${def.name}`);
    if (def.demoEmails) {
      console.log(`   Direction    ${def.demoEmails.direction}`);
      console.log(`   Secrétariat  ${def.demoEmails.secretaire}`);
      console.log(`   Comptable    ${def.demoEmails.comptable}`);
      console.log(`   Enseignant   ${def.demoEmails.enseignant}`);
      console.log(`   Parent       ${def.demoEmails.parent}`);
      console.log(`   Élève        ${def.demoEmails.eleve}`);
    }
  }
  console.log(`\nPlateforme     ${config.platform.superAdminEmail} / ${config.platform.superAdminPassword}`);
  console.log('──────────────────────────────────────────────────────────────────────\n');
  return { schools: results.length };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    seed();
  } finally {
    db.close();
  }
}

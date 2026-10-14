/**
 * SunuÉcole — Mise en route automatique d'un nouvel établissement.
 *
 * Un directeur qui s'inscrit doit arriver sur une école déjà structurée :
 * niveaux, matières, année scolaire, trimestres et frais types sont créés
 * immédiatement. Il ne reste plus qu'à importer les élèves (Excel) ou à les
 * saisir. C'est ce qui fait passer la mise en route de « plusieurs jours »
 * à « quelques minutes », un critère décisif pour l'adoption.
 */
import { db } from '../db/index.js';
import { config, PLANS } from '../config.js';
import { addDays, slugify, today, HttpError, isValidEmail } from './utils.js';

/** INSERT orienté objet (SQLite via node:sqlite n'accepte ni undefined ni objets). */
function ins(table, row) {
  const keys = Object.keys(row);
  const vals = keys.map((k) => {
    const v = row[k];
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
  return db.insert(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, vals);
}

/** Niveaux proposés selon le type d'établissement (Sénégal / Afrique de l'Ouest). */
export const LEVEL_SETS = {
  maternelle: [
    ['Petite Section', 'Maternelle', 1], ['Moyenne Section', 'Maternelle', 2], ['Grande Section', 'Maternelle', 3],
  ],
  ecole: [
    ['CI', 'Primaire', 1], ['CP', 'Primaire', 2], ['CE1', 'Primaire', 3],
    ['CE2', 'Primaire', 4], ['CM1', 'Primaire', 5], ['CM2', 'Primaire', 6],
  ],
  college: [
    ['6ème', 'Collège', 1], ['5ème', 'Collège', 2], ['4ème', 'Collège', 3], ['3ème', 'Collège', 4],
  ],
  lycee: [
    ['Seconde', 'Lycée', 1], ['Première', 'Lycée', 2], ['Terminale', 'Lycée', 3],
  ],
  prive: [
    ['CI', 'Primaire', 1], ['CP', 'Primaire', 2], ['CE1', 'Primaire', 3], ['CE2', 'Primaire', 4],
    ['CM1', 'Primaire', 5], ['CM2', 'Primaire', 6],
    ['6ème', 'Collège', 7], ['5ème', 'Collège', 8], ['4ème', 'Collège', 9], ['3ème', 'Collège', 10],
    ['Seconde', 'Lycée', 11], ['Première', 'Lycée', 12], ['Terminale', 'Lycée', 13],
  ],
  institut: [
    ['Niveau 1', 'Formation', 1], ['Niveau 2', 'Formation', 2], ['Niveau 3', 'Formation', 3],
  ],
  technique: [
    ['Seconde T', 'Lycée', 1], ['Première T', 'Lycée', 2], ['Terminale T', 'Lycée', 3],
  ],
};

/** Matières standards par cycle — modifiables ensuite dans les paramètres. */
const SUBJECT_SETS = {
  Primaire: [
    ['Français', 'FRAN', '#1d4ed8'], ['Mathématiques', 'MATH', '#0e7c66'],
    ['Sciences', 'SCI', '#15803d'], ['Histoire-Géographie', 'HG', '#a16207'],
    ['Éducation civique', 'ECM', '#7c3aed'], ['Anglais', 'ANGL', '#b45309'],
    ['Arts plastiques', 'ART', '#db2777'], ['Sport', 'EPS', '#0891b2'], ['Wolof / Langue nationale', 'WOL', '#c2410c'],
  ],
  Collège: [
    ['Français', 'FRAN', '#1d4ed8'], ['Mathématiques', 'MATH', '#0e7c66'],
    ['SVT', 'SVT', '#15803d'], ['Physique-Chimie', 'PC', '#0891b2'],
    ['Histoire-Géographie', 'HG', '#a16207'], ['Anglais', 'ANGL', '#b45309'],
    ['Espagnol / Arabe', 'LV2', '#7c3aed'], ['EPS', 'EPS', '#db2777'],
    ['Informatique', 'INFO', '#334155'], ['Éducation civique', 'ECM', '#c2410c'],
  ],
  Lycée: [
    ['Français', 'FRAN', '#1d4ed8'], ['Philosophie', 'PHILO', '#7c3aed'],
    ['Mathématiques', 'MATH', '#0e7c66'], ['Physique-Chimie', 'PC', '#0891b2'],
    ['SVT', 'SVT', '#15803d'], ['Histoire-Géographie', 'HG', '#a16207'],
    ['Anglais', 'ANGL', '#b45309'], ['LV2', 'LV2', '#db2777'], ['EPS', 'EPS', '#0f766e'],
    ['Informatique', 'INFO', '#334155'],
  ],
  Maternelle: [
    ['Langage', 'LANG', '#1d4ed8'], ['Mathématiques', 'MATH', '#0e7c66'],
    ['Découverte du monde', 'DDM', '#15803d'], ['Motricité', 'MOT', '#db2777'], ['Arts', 'ART', '#a16207'],
  ],
  Formation: [
    ['Français', 'FRAN', '#1d4ed8'], ['Mathématiques', 'MATH', '#0e7c66'],
    ['Spécialité professionnelle', 'SPEC', '#0e7c66'], ['Informatique', 'INFO', '#334155'], ['Anglais', 'ANGL', '#b45309'],
  ],
};

const FEE_DEFAULTS = [
  { name: 'Frais d\'inscription', code: 'INSC', category: 'inscription', amount: 25000, installments: 1, is_recurring: 0, is_required: 1 },
  { name: 'Scolarité annuelle', code: 'SCOL', category: 'scolarite', amount: 150000, installments: 3, is_recurring: 1, is_required: 1 },
  { name: 'Cantine (mensuel)', code: 'CANT', category: 'cantine', amount: 15000, installments: 1, is_recurring: 1, is_required: 0 },
  { name: 'Transport (mensuel)', code: 'TRAN', category: 'transport', amount: 12000, installments: 1, is_recurring: 1, is_required: 0 },
  { name: 'Tenue & fournitures', code: 'UNIF', category: 'uniforme', amount: 20000, installments: 1, is_recurring: 0, is_required: 0 },
];

/**
 * Crée l'école complète. Renvoie { schoolId, yearId, termIds, levelIds }.
 * À appeler dans une transaction (db.tx) par l'appelant si besoin.
 */
export function onboardSchool({
  name, type = 'prive', city, country = 'Sénégal', phone, email, address,
  academicYear, headName, plan = 'pro', trialDays = 15, demo = 0, settings = {},
}) {
  if (!name || String(name).trim().length < 3) throw new HttpError(422, 'Le nom de l\'établissement est requis.');
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (db.get('SELECT id FROM schools WHERE slug=?', [slug])) { slug = `${base}-${n}`; n += 1; }

  const levels = LEVEL_SETS[type] || LEVEL_SETS.prive;
  const cycles = [...new Set(levels.map((l) => l[1]))];
  const year = academicYear || currentYearName();
  const now = today();

  const schoolId = ins('schools', {
    name: String(name).trim(),
    slug,
    type,
    cycles: JSON.stringify(cycles),
    phone: phone || null,
    email: email || null,
    address: address || null,
    city: city || null,
    country,
    currency: 'XOF',
    timezone: 'Africa/Dakar',
    language: 'fr',
    academic_year: year,
    head_name: headName || null,
    plan,
    subscription_status: 'trial',
    trial_ends_at: addDays(now, trialDays),
    max_students: PLANS[plan]?.maxStudents || 600,
    modules_json: JSON.stringify(['students', 'attendance', 'grades', 'timetable', 'finance', 'parents', 'homework', 'discipline', 'payroll', 'library', 'canteen', 'transport', 'health']),
    settings_json: JSON.stringify({
      gradingScale: config.schoolDefaults.gradingScale,
      dayStart: config.schoolDefaults.dayStart,
      dayEnd: config.schoolDefaults.dayEnd,
      slotMinutes: config.schoolDefaults.slotMinutes,
      schoolDays: config.schoolDefaults.schoolDays,
      gradingSystem: '20',
      passMark: 10,
      absenceAlertThreshold: 3,
      invoiceLateFeePct: 0,
      autoReminders: true,
      smsSender: slug.toUpperCase().slice(0, 10),
      reportCardFooter: 'Document généré électroniquement — valable sans signature manuscrite',
      ...settings,
    }),
    onboarded: 0,
    demo,
  });

  ins('subscriptions', {
    school_id: schoolId,
    plan,
    seats: plan === 'elite' ? 500 : plan === 'pro' ? 120 : 40,
    amount: PLANS[plan]?.price || 35000,
    period: 'monthly',
    status: 'trial',
    started_at: now,
    expires_at: addDays(now, trialDays),
    notes: 'Essai gratuit — mise en route accompagnée',
  });

  const levelIds = levels.map(([lname, cycle, seq]) => ins('levels', {
    school_id: schoolId, name: lname, cycle, seq,
    tuition: cycle === 'Primaire' ? 120000 : cycle === 'Collège' ? 150000 : 200000,
  }));

  const seen = new Set();
  cycles.forEach((cycle) => {
    (SUBJECT_SETS[cycle] || SUBJECT_SETS.Collège).forEach(([sname, code, color]) => {
      const key = `${cycle}:${code}`;
      if (seen.has(key)) return;
      seen.add(key);
      ins('subjects', { school_id: schoolId, name: sname, code: `${cycle.slice(0, 3).toUpperCase()}-${code}`, color, short_name: code });
    });
  });

  const yearId = ins('school_years', {
    school_id: schoolId, name: year, start_date: `${yearStartOf(year)}-10-01`, end_date: `${yearEndOf(year)}-09-30`, is_current: 1,
  });
  const terms = termDefsFor(year);
  const termIds = terms.map((t) => ins('terms', {
    school_id: schoolId, year_id: yearId, ...t,
    is_current: now >= t.start_date && now <= t.end_date ? 1 : 0,
  }));

  FEE_DEFAULTS.forEach((f) => ins('fee_types', { school_id: schoolId, ...f }));

  return { schoolId, slug, yearId, termIds, levelIds, cycles };
}

/** Année scolaire courante au format « 2025-2026 » (rentrée d'octobre). */
export function currentYearName(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}
const yearStartOf = (name) => name.slice(0, 4);
const yearEndOf = (name) => name.slice(5, 9);

/** Trimestres/semestres calés sur l'année scolaire en cours. */
export function termDefsFor(yearName) {
  const y = Number(yearStartOf(yearName));
  const y2 = Number(yearEndOf(yearName));
  return [
    { name: '1er Trimestre', seq: 1, start_date: `${y}-10-01`, end_date: `${y}-12-31`, council_date: `${y2}-01-05`, report_date: `${y2}-01-10` },
    { name: '2ème Trimestre', seq: 2, start_date: `${y2}-01-05`, end_date: `${y2}-03-31`, council_date: `${y2}-04-06`, report_date: `${y2}-04-11` },
    { name: '3ème Trimestre', seq: 3, start_date: `${y2}-04-06`, end_date: `${y2}-06-30`, council_date: `${y2}-07-05`, report_date: `${y2}-07-10` },
  ];
}

/** Validation légère d'un formulaire d'inscription. */
export function validateSignup(body = {}) {
  const errors = {};
  const required = { schoolName: 'Nom de l\'école', firstName: 'Prénom', lastName: 'Nom', email: 'Adresse électronique', password: 'Mot de passe' };
  for (const [k, label] of Object.entries(required)) {
    if (!String(body[k] || '').trim()) errors[k] = `${label} requis.`;
  }
  if (body.email && !isValidEmail(body.email)) errors.email = 'Adresse électronique invalide.';
  if (body.email && db.get('SELECT id FROM users WHERE email=?', [String(body.email).trim().toLowerCase()])) {
    errors.email = 'Un compte existe déjà avec cette adresse.';
  }
  if (body.password && String(body.password).length < 8) errors.password = 'Au moins 8 caractères.';
  if (Object.keys(errors).length) {
    const err = new HttpError(422, 'Veuillez corriger les champs signalés.');
    err.fields = errors;
    throw err;
  }
}

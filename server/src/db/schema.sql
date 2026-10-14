-- ============================================================================
--  SunuÉcole — Schéma de base de données (SQLite / better-sqlite3)
--  Multi-établissements (multi-tenant) : chaque ligne métier porte school_id.
--  Conventions : id INTEGER PK AUTOINCREMENT, created_at/updated_at TEXT (ISO).
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ---------------------------------------------------------------------------
-- 1. PLATEFORME : établissements, abonnements, utilisateurs, audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schools (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  logo_url           TEXT,
  type               TEXT NOT NULL DEFAULT 'prive',           -- public | prive | confessionnel | technique
  cycles             TEXT NOT NULL DEFAULT '["Primaire","Collège"]', -- JSON
  phone              TEXT,
  phone2             TEXT,
  email              TEXT,
  website            TEXT,
  address            TEXT,
  city               TEXT,
  region             TEXT,
  country            TEXT NOT NULL DEFAULT 'Sénégal',
  currency           TEXT NOT NULL DEFAULT 'XOF',
  timezone           TEXT NOT NULL DEFAULT 'Africa/Dakar',
  language           TEXT NOT NULL DEFAULT 'fr',
  academic_year      TEXT,                                     -- ex: 2025-2026
  head_name          TEXT,
  ninea              TEXT,                                     -- identifiant fiscal (Sénégal)
  rne                TEXT,                                     -- registre national des établissements
  plan               TEXT NOT NULL DEFAULT 'essentiel',        -- essentiel | pro | elite | sur_mesure
  subscription_status TEXT NOT NULL DEFAULT 'trial',           -- trial | active | past_due | suspended | cancelled
  trial_ends_at      TEXT,
  max_students       INTEGER NOT NULL DEFAULT 300,
  modules_json       TEXT NOT NULL DEFAULT '[]',               -- modules activés
  settings_json      TEXT NOT NULL DEFAULT '{}',               -- barèmes, mentions, horaires, etc.
  onboarded          INTEGER NOT NULL DEFAULT 0,
  demo               INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL,
  seats         INTEGER NOT NULL DEFAULT 50,
  amount        INTEGER NOT NULL DEFAULT 0,                    -- en XOF, HT
  period        TEXT NOT NULL DEFAULT 'yearly',                -- monthly | yearly
  status        TEXT NOT NULL DEFAULT 'active',
  started_at    TEXT NOT NULL DEFAULT (date('now')),
  expires_at    TEXT NOT NULL,
  auto_renew    INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER REFERENCES schools(id) ON DELETE CASCADE,  -- NULL = super admin plateforme
  role           TEXT NOT NULL,                                 -- super_admin | direction | secretaire | comptable | enseignant | surveillant | parent | eleve | bibliothecaire | censeur | infirmier
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  email          TEXT UNIQUE,
  phone          TEXT,
  password_hash  TEXT NOT NULL,
  avatar_color   TEXT NOT NULL DEFAULT '#0e7c66',
  gender         TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  two_factor     INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  last_login_ip  TEXT,
  login_count    INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  preferences_json TEXT NOT NULL DEFAULT '{}',                  -- thème, densité, langue, page d'accueil
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  device      TEXT,
  ip          TEXT,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER,
  user_id    INTEGER,
  user_name  TEXT,
  action     TEXT NOT NULL,                                     -- create | update | delete | login | export | print | validate ...
  entity     TEXT NOT NULL,                                     -- student | invoice | grade ...
  entity_id  TEXT,
  summary    TEXT,
  meta_json  TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 2. STRUCTURE PÉDAGOGIQUE : années, trimestres, niveaux, classes, matières
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS school_years (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                                     -- 2025-2026
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS terms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id    INTEGER NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                                     -- 1er Trimestre
  seq        INTEGER NOT NULL DEFAULT 1,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0,
  council_date TEXT,                                            -- conseil de classe
  report_date  TEXT                                             -- remise des bulletins
);

CREATE TABLE IF NOT EXISTS levels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                                     -- 6ème, CI, Terminale...
  cycle      TEXT NOT NULL DEFAULT 'Primaire',                  -- Maternelle | Primaire | Collège | Lycée
  seq        INTEGER NOT NULL DEFAULT 1,
  tuition    INTEGER NOT NULL DEFAULT 0,                        -- frais annuels par défaut
  color      TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,                                     -- Mathématiques
  code       TEXT NOT NULL,                                     -- MATH
  color      TEXT NOT NULL DEFAULT '#0e7c66',
  short_name TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id         INTEGER NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  level_id        INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,                                -- 6ème A
  capacity        INTEGER NOT NULL DEFAULT 45,
  room            TEXT,
  main_teacher_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  shift           TEXT NOT NULL DEFAULT 'jour',                 -- jour | soir | matin
  is_active       INTEGER NOT NULL DEFAULT 1,
  color           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id       INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id     INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id     INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  coefficient    REAL NOT NULL DEFAULT 1,
  hours_per_week REAL NOT NULL DEFAULT 2,
  UNIQUE(class_id, subject_id)
);

-- ---------------------------------------------------------------------------
-- 3. PERSONNES : personnel, parents/tuteurs, élèves
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  gender         TEXT NOT NULL DEFAULT 'M',
  staff_type     TEXT NOT NULL DEFAULT 'enseignant',            -- enseignant | direction | administratif | service | securite
  job_title      TEXT,                                          -- Professeur de Mathématiques
  qualification  TEXT,
  matricule      TEXT,
  phone          TEXT,
  phone2         TEXT,
  email          TEXT,
  birth_date     TEXT,
  address        TEXT,
  city           TEXT,
  nina           TEXT,                                          -- N° identification nationale
  inpe           TEXT,                                          -- matricule enseignant (DAER)
  hired_at       TEXT,
  contract_type  TEXT NOT NULL DEFAULT 'cdi',                   -- cdi | cdd | vacation | stage
  salary_base    INTEGER NOT NULL DEFAULT 0,                    -- XOF mensuel
  hourly_rate    INTEGER NOT NULL DEFAULT 0,
  weekly_hours   REAL NOT NULL DEFAULT 18,
  bank_name      TEXT,
  bank_account   TEXT,
  mobile_money   TEXT,
  status         TEXT NOT NULL DEFAULT 'active',                -- active | conge | suspendu | parti
  photo_url      TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guardians (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  gender        TEXT NOT NULL DEFAULT 'M',
  relation      TEXT,                                           -- père | mère | tuteur | oncle...
  phone         TEXT,
  phone2        TEXT,
  whatsapp      TEXT,
  email         TEXT,
  profession    TEXT,
  employer      TEXT,
  address       TEXT,
  city          TEXT,
  id_number     TEXT,
  sms_optin     INTEGER NOT NULL DEFAULT 1,
  email_optin   INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  matricule       TEXT,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  gender          TEXT NOT NULL DEFAULT 'M',
  birth_date      TEXT,
  birth_place     TEXT,
  nationality     TEXT DEFAULT 'Sénégalaise',
  class_id        INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  year_id         INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'inscrit',              -- inscrit | actif | suspendu | transfere | radie | diplome | abandon
  photo_url       TEXT,
  address         TEXT,
  city            TEXT,
  blood_group     TEXT,
  medical_notes   TEXT,
  allergies       TEXT,
  emergency_contact TEXT,
  emergency_phone TEXT,
  previous_school TEXT,
  previous_level  TEXT,
  enrolled_at     TEXT NOT NULL DEFAULT (date('now')),
  exit_date       TEXT,
  exit_reason     TEXT,
  sibling_group   TEXT,                                          -- regroupe une fratrie
  transport_route_id INTEGER REFERENCES transport_routes(id) ON DELETE SET NULL,
  canteen         INTEGER NOT NULL DEFAULT 0,
  boarding        INTEGER NOT NULL DEFAULT 0,
  scholarship     TEXT,                                          -- bourse / réduction
  discount_pct    REAL NOT NULL DEFAULT 0,
  notes           TEXT,
  tags_json       TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_matricule ON students(school_id, matricule);

CREATE TABLE IF NOT EXISTS student_guardians (
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  relation    TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  is_payer    INTEGER NOT NULL DEFAULT 0,                        -- responsable financier
  can_pickup  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (student_id, guardian_id)
);

CREATE TABLE IF NOT EXISTS student_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL,                                    -- acte_naissance | carnet_vaccination | photo | bulletin_anterieur | certificat_scolarite | releve_notes
  name         TEXT NOT NULL,
  file_path    TEXT,
  file_size    INTEGER,
  mime         TEXT,
  is_verified  INTEGER NOT NULL DEFAULT 0,
  uploaded_by  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 4. ADMISSIONS / INSCRIPTIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS applications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id        INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
  reference      TEXT,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  gender         TEXT DEFAULT 'M',
  birth_date     TEXT,
  level_requested TEXT,
  class_requested TEXT,
  previous_school TEXT,
  guardian_name  TEXT,
  guardian_phone TEXT,
  guardian_email TEXT,
  address        TEXT,
  status         TEXT NOT NULL DEFAULT 'nouveau',                -- nouveau | dossier_complet | entretien | teste | admis | liste_attente | refuse | inscrit
  score          REAL,
  interview_date TEXT,
  interview_note TEXT,
  decision_note  TEXT,
  decided_by     INTEGER,
  decided_at     TEXT,
  student_id     INTEGER REFERENCES students(id) ON DELETE SET NULL,
  source         TEXT DEFAULT 'guichet',                         -- guichet | site_web | telephone | parrainage | sms
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollment_fees (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id      INTEGER REFERENCES school_years(id),
  name         TEXT NOT NULL,                                    -- Frais d'inscription
  amount       INTEGER NOT NULL DEFAULT 0,
  category     TEXT NOT NULL DEFAULT 'inscription',
  is_required  INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- 5. VIE SCOLAIRE : présences, absences, discipline
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  session_date TEXT NOT NULL,
  slot_index   INTEGER DEFAULT 1,                                -- numéro du créneau dans la journée
  start_time   TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',                    -- draft | validated
  period_label TEXT,
  note         TEXT,
  taken_at     TEXT,
  validated_at TEXT,
  taken_offline INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(class_id, session_date, slot_index, subject_id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id    INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'present',                 -- present | absent | retard | excuse
  minutes_late  INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  UNIQUE(session_id, student_id)
);

CREATE TABLE IF NOT EXISTS absence_justifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date_from   TEXT NOT NULL,
  date_to     TEXT NOT NULL,
  reason      TEXT,
  reason_type TEXT,                                              -- maladie | familial | deplacement | autre
  document    TEXT,
  submitted_by INTEGER,                                          -- guardian user_id ou secrétariat
  status      TEXT NOT NULL DEFAULT 'en_attente',                -- en_attente | acceptee | refusee
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discipline_incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  incident_date TEXT NOT NULL,
  type         TEXT NOT NULL,                                    -- retard | bavardage | bagarre | telephone | absence_non_justifiee | insolence | degradation | tricherie
  severity     TEXT NOT NULL DEFAULT 'leger',                    -- leger | moyen | grave
  description  TEXT,
  location     TEXT,
  reported_by  INTEGER,
  sanction     TEXT,                                             -- avertissement | retenue | exclusion_temporaire | exclusion_definitive | blame
  sanction_days INTEGER DEFAULT 0,
  parents_notified INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ouvert',                   -- ouvert | traite | clos
  followup     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 6. ÉVALUATIONS : notes, moyennes, bulletins
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assessments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  term_id     INTEGER REFERENCES terms(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,                                     -- Devoir surveillé n°1
  type        TEXT NOT NULL DEFAULT 'devoir',                    -- devoir | composition | oral | projet | tp | interrogation
  assess_date TEXT NOT NULL,
  max_score   REAL NOT NULL DEFAULT 20,
  coefficient REAL NOT NULL DEFAULT 1,
  counts_for  INTEGER NOT NULL DEFAULT 1,                        -- pris en compte dans la moyenne
  teacher_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'draft',                     -- draft | published
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score        REAL,
  is_absent    INTEGER NOT NULL DEFAULT 0,
  bonus        REAL NOT NULL DEFAULT 0,
  comment      TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(assessment_id, student_id)
);

CREATE TABLE IF NOT EXISTS report_cards (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term_id         INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  general_avg     REAL,
  subject_avgs_json TEXT,                                        -- [{subject, avg, coef, rank, min, max, class_avg, appreciation}]
  rank            INTEGER,
  total_students  INTEGER,
  attendance_pct  REAL,
  absences_hours  REAL,
  mention         TEXT,
  teacher_comment TEXT,
  principal_comment TEXT,
  status          TEXT NOT NULL DEFAULT 'brouillon',             -- brouillon | valide | publie
  generated_at    TEXT,
  validated_by    INTEGER,
  published_at    TEXT,
  UNIQUE(student_id, term_id)
);

CREATE TABLE IF NOT EXISTS subject_appreciations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term_id     INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id  INTEGER,
  appreciation TEXT,
  UNIQUE(student_id, term_id, subject_id)
);

-- ---------------------------------------------------------------------------
-- 7. EMPLOI DU TEMPS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timetable_slots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id     INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  day_of_week INTEGER NOT NULL,                                  -- 1=lun ... 7=dim
  start_time  TEXT NOT NULL,                                     -- HH:MM
  end_time    TEXT NOT NULL,
  room        TEXT,
  is_recurrent INTEGER NOT NULL DEFAULT 1,
  valid_from  TEXT,
  valid_to    TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS timetable_exceptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  slot_id     INTEGER REFERENCES timetable_slots(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'annule',                    -- annule | deplace | remplace
  replacement_teacher_id INTEGER,
  new_start   TEXT,
  new_end     TEXT,
  new_room    TEXT,
  reason      TEXT
);

-- ---------------------------------------------------------------------------
-- 8. CAHIER DE TEXTES / DEVOIRS / RESSOURCES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lesson_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  lesson_date  TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 55,
  title        TEXT,
  content      TEXT,                                             -- "Leçons faites"
  objective    TEXT,                                             -- objectifs pédagogiques
  homework     TEXT,                                             -- "Travaux à faire"
  progress_pct REAL DEFAULT 0,                                   -- avancement du programme
  validated_by INTEGER,
  validated_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homework (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id   INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  assigned_at  TEXT NOT NULL DEFAULT (date('now')),
  due_date     TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  estimated_min INTEGER DEFAULT 30,
  is_graded    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homework_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  homework_id INTEGER NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  submitted_at TEXT,
  status      TEXT NOT NULL DEFAULT 'a_rendre',                  -- a_rendre | rendu | en_retard | manquant
  file_path   TEXT,
  score       REAL,
  feedback    TEXT,
  UNIQUE(homework_id, student_id)
);

-- ---------------------------------------------------------------------------
-- 9. FINANCES : frais, factures, paiements, Mobile Money, dépenses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fee_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                                    -- Scolarité annuelle
  code         TEXT,
  category     TEXT NOT NULL DEFAULT 'scolarite',                -- scolarite | inscription | cantine | transport | uniforme | activite | examen | internat | autre
  amount       INTEGER NOT NULL DEFAULT 0,
  installments INTEGER NOT NULL DEFAULT 1,                       -- nombre d'échéances
  is_recurring INTEGER NOT NULL DEFAULT 1,
  is_required  INTEGER NOT NULL DEFAULT 1,
  applies_to_json TEXT NOT NULL DEFAULT '[]',                    -- niveaux/classes concernés (vide = tous)
  late_fee_pct REAL NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id      INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year_id        INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
  fee_type_id    INTEGER REFERENCES fee_types(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  label          TEXT NOT NULL,
  amount         INTEGER NOT NULL DEFAULT 0,
  discount       INTEGER NOT NULL DEFAULT 0,
  amount_paid    INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  installment_no INTEGER DEFAULT 1,
  installment_of INTEGER DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'impayee',                -- impayee | partielle | payee | en_retard | annulee | avoir
  issued_at      TEXT NOT NULL DEFAULT (date('now')),
  last_reminder_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  invoice_id    INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  amount        INTEGER NOT NULL,
  method        TEXT NOT NULL,                                   -- orange_money | wave | mtn_momo | moov_money | free_money | especes | virement | cheque | carte
  provider_ref  TEXT,
  phone         TEXT,
  paid_at       TEXT NOT NULL DEFAULT (datetime('now')),
  received_by   INTEGER,
  note          TEXT,
  is_reversed   INTEGER NOT NULL DEFAULT 0,
  reversed_at   TEXT,
  synced        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS mobile_money_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id   INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  student_id   INTEGER REFERENCES students(id) ON DELETE SET NULL,
  provider     TEXT NOT NULL,                                    -- orange_money | wave | mtn_momo | moov_money | free_money
  phone        TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',                  -- pending | success | failed | cancelled | expired
  request_id   TEXT,
  response_json TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at      TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  expense_date TEXT NOT NULL DEFAULT (date('now')),
  category     TEXT NOT NULL,                                    -- salaires | fournitures | entretien | eau_electricite | transport | evenements | equipements | impots | autre
  label        TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  method       TEXT NOT NULL DEFAULT 'especes',
  supplier     TEXT,
  reference    TEXT,
  recorded_by  INTEGER,
  approved_by  INTEGER,
  status       TEXT NOT NULL DEFAULT 'validee',                  -- en_attente | validee | refusee
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year_id    INTEGER REFERENCES school_years(id) ON DELETE SET NULL,
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);

-- ---------------------------------------------------------------------------
-- 10. RESSOURCES HUMAINES : paie, congés, pointage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payroll_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,                                      -- 2025-10
  status     TEXT NOT NULL DEFAULT 'brouillon',                  -- brouillon | valide | paye
  total_gross INTEGER NOT NULL DEFAULT 0,
  total_net  INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(school_id, period)
);

CREATE TABLE IF NOT EXISTS payslips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id    INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  run_id       INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id     INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  base_salary  INTEGER NOT NULL DEFAULT 0,
  hours_extra  REAL NOT NULL DEFAULT 0,
  bonus        INTEGER NOT NULL DEFAULT 0,
  deductions   INTEGER NOT NULL DEFAULT 0,
  tax          INTEGER NOT NULL DEFAULT 0,
  social       INTEGER NOT NULL DEFAULT 0,
  net          INTEGER NOT NULL DEFAULT 0,
  lines_json   TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'brouillon',
  paid_at      TEXT,
  method       TEXT DEFAULT 'especes',
  UNIQUE(run_id, staff_id)
);

CREATE TABLE IF NOT EXISTS staff_leaves (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id    INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  leave_type  TEXT NOT NULL,                                     -- conge_annuel | maladie | maternite | familial | sans_solde | evenement
  date_from   TEXT NOT NULL,
  date_to     TEXT NOT NULL,
  days        INTEGER,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'en_attente',                -- en_attente | approuve | refuse
  approved_by INTEGER,
  approved_at TEXT,
  replacement_staff_id INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff_timesheets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id   INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  work_date  TEXT NOT NULL,
  check_in   TEXT,
  check_out  TEXT,
  hours      REAL,
  status     TEXT NOT NULL DEFAULT 'present',                    -- present | absent | retard | conge
  note       TEXT,
  UNIQUE(staff_id, work_date)
);

-- ---------------------------------------------------------------------------
-- 11. COMMUNICATION : messages, notifications, SMS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sender_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  msg_type    TEXT NOT NULL DEFAULT 'annonce',                   -- annonce | circulaire | direct | urgence
  audience_json TEXT NOT NULL DEFAULT '{}',                      -- {roles:[], classes:[], students:[]}
  priority    TEXT NOT NULL DEFAULT 'normale',                   -- basse | normale | haute | urgente
  pinned      INTEGER NOT NULL DEFAULT 0,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  notify_sms  INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 0,
  sent_at     TEXT,
  expires_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                                     -- absence | note | paiement | message | evenement | systeme | alerte
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  icon        TEXT,
  priority    TEXT NOT NULL DEFAULT 'normale',
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  to_number   TEXT NOT NULL,
  body        TEXT NOT NULL,
  recipient_name TEXT,
  student_id  INTEGER REFERENCES students(id) ON DELETE SET NULL,
  template    TEXT,                                              -- absence | retard | facture | note | evenement | libre
  status      TEXT NOT NULL DEFAULT 'en_attente',                -- en_attente | envoye | echoue | programme
  provider    TEXT NOT NULL DEFAULT 'simule',                    -- orange_api | sonatel | twilio | simule
  provider_ref TEXT,
  error       TEXT,
  scheduled_at TEXT,
  sent_at     TEXT,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(school_id, code)
);

-- ---------------------------------------------------------------------------
-- 12. CALENDRIER & ÉVÉNEMENTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  event_type  TEXT NOT NULL DEFAULT 'autre',                     -- examen | conseil_classe | reunion | ferie | sport | culturel | remise_bulletins | inscription | formation | autre
  event_date  TEXT NOT NULL,
  end_date    TEXT,
  start_time  TEXT,
  end_time    TEXT,
  location    TEXT,
  description TEXT,
  color       TEXT,
  audience_json TEXT NOT NULL DEFAULT '{}',
  is_all_day  INTEGER NOT NULL DEFAULT 1,
  requires_registration INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,
  end_date   TEXT,
  is_recurring INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- 13. BIBLIOTHÈQUE, CANTINE, TRANSPORT, INFIRMERIE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS library_books (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  author      TEXT,
  isbn        TEXT,
  category    TEXT,
  publisher   TEXT,
  publish_year INTEGER,
  copies      INTEGER NOT NULL DEFAULT 1,
  available   INTEGER NOT NULL DEFAULT 1,
  shelf       TEXT,
  cover_url   TEXT,
  loan_days   INTEGER NOT NULL DEFAULT 14,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_loans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  loaned_at  TEXT NOT NULL DEFAULT (date('now')),
  due_at     TEXT NOT NULL,
  returned_at TEXT,
  renewals   INTEGER NOT NULL DEFAULT 0,
  fine       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'en_cours',                   -- en_cours | en_retard | rendu | perdu
  handled_by INTEGER
);

CREATE TABLE IF NOT EXISTS transport_routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  driver_name TEXT,
  driver_phone TEXT,
  plate       TEXT,
  capacity    INTEGER NOT NULL DEFAULT 30,
  stops_json  TEXT NOT NULL DEFAULT '[]',
  departure   TEXT,
  monthly_fee INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS canteen_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL,
  meal_type  TEXT NOT NULL DEFAULT 'dejeuner',                   -- petit_dejeuner | dejeuner | gouter
  menu       TEXT,
  present    INTEGER NOT NULL DEFAULT 1,
  UNIQUE(student_id, record_date, meal_type)
);

CREATE TABLE IF NOT EXISTS health_records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL DEFAULT (date('now')),
  type        TEXT NOT NULL,                                     -- consultation | blessure | malaise | traitement | vaccin
  symptoms    TEXT,
  diagnosis   TEXT,
  treatment   TEXT,
  referred    INTEGER NOT NULL DEFAULT 0,
  parent_notified INTEGER NOT NULL DEFAULT 0,
  recorded_by INTEGER,
  note        TEXT
);

-- ---------------------------------------------------------------------------
-- 14. DOCUMENTS, DEMANDES & SAUVEGARDES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,                                     -- certificat_scolarite | releve_notes | attestation_reussite | bulletin_dupli | acte_naissance
  requested_by INTEGER,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'en_attente',                -- en_attente | pret | remis | refuse
  copies      INTEGER NOT NULL DEFAULT 1,
  fee         INTEGER NOT NULL DEFAULT 0,
  processed_by INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id  INTEGER,
  file_path  TEXT NOT NULL,
  size_bytes INTEGER,
  kind       TEXT NOT NULL DEFAULT 'auto',                       -- auto | manuel
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 15. SYNCHRONISATION HORS-LIGNE (mode dégradé / bas débit)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id   INTEGER,
  user_id     INTEGER,
  client_id   TEXT NOT NULL,                                     -- UUID généré côté client (idempotence)
  entity      TEXT NOT NULL,
  action      TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',                   -- pending | applied | failed
  attempts    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  device      TEXT,
  captured_at TEXT,
  applied_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- INDEX (performance des requêtes multi-tenant)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id, role);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id, status);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_year ON students(year_id);
CREATE INDEX IF NOT EXISTS idx_classes_school ON classes(school_id, year_id);
CREATE INDEX IF NOT EXISTS idx_att_sessions ON attendance_sessions(school_id, session_date, class_id);
CREATE INDEX IF NOT EXISTS idx_att_records_student ON attendance_records(student_id, session_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class ON assessments(class_id, term_id, assess_date);
CREATE INDEX IF NOT EXISTS idx_invoices_student ON invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_school ON invoices(school_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_expenses_school ON expenses(school_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_school ON messages(school_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_school ON events(school_id, event_date);
CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable_slots(class_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_slots(teacher_id, day_of_week, start_time);
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id, due_date);
CREATE INDEX IF NOT EXISTS idx_lesson_logs ON lesson_logs(class_id, lesson_date);
CREATE INDEX IF NOT EXISTS idx_staff_school ON staff(school_id, status);
CREATE INDEX IF NOT EXISTS idx_guardians_phone ON guardians(school_id, phone);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_logs(school_id, created_at);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(school_id, status);
CREATE INDEX IF NOT EXISTS idx_discipline_student ON discipline_incidents(student_id, incident_date);
CREATE INDEX IF NOT EXISTS sms_queue_status ON sms_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sync_client ON sync_queue(client_id);

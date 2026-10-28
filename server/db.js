'use strict';
/**
 * ChronoRH — couche base de données (SQLite via node:sqlite)
 * Schéma + jeu de données de démonstration.
 */
const sqlite = (typeof process.getBuiltinModule === 'function' && process.getBuiltinModule('node:sqlite')) || require('node:sqlite');
const { DatabaseSync } = sqlite;
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { DEFAULT_RULES, isoWeekKey } = require('./payroll');

function isServerlessEnv() {
  return Boolean(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY
  );
}

function resolveDbPath(customPath) {
  if (customPath) return customPath;
  if (process.env.CHRONORH_DB_PATH) return process.env.CHRONORH_DB_PATH;
  const preferredDir = process.env.CHRONORH_DATA_DIR ||
    (isServerlessEnv() ? path.join(os.tmpdir(), 'chronorh') : path.join(__dirname, '..', 'data'));
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return path.join(preferredDir, 'chronorh.db');
  } catch {
    const fallbackDir = path.join(os.tmpdir(), 'chronorh');
    fs.mkdirSync(fallbackDir, { recursive: true });
    return path.join(fallbackDir, 'chronorh.db');
  }
}

const DB_PATH = resolveDbPath();

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function open(customPath) {
  const targetPath = resolveDbPath(customPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new DatabaseSync(targetPath);
  try {
    db.exec('PRAGMA journal_mode = WAL');
  } catch {
    // Sur certains systèmes de fichiers éphémères (/tmp serverless), le mode par défaut suffit
  }
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function schema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','drh','comptable','pointage')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    matricule TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department_id INTEGER REFERENCES departments(id),
    position TEXT,
    contract_type TEXT DEFAULT 'CDI',
    hire_date TEXT,
    base_salary INTEGER NOT NULL DEFAULT 0,
    weekly_hours INTEGER NOT NULL DEFAULT 40,
    schedule_name TEXT DEFAULT 'Jour',
    schedule_start TEXT DEFAULT '08:00',
    schedule_end TEXT DEFAULT '17:00',
    status TEXT NOT NULL DEFAULT 'actif',
    qr_token TEXT UNIQUE NOT NULL,
    fingerprint_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    ts TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','fingerprint','manual')),
    device TEXT DEFAULT 'Tablette-01',
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_att_emp_ts ON attendance(employee_id, ts);
  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pay_rules (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payroll_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'brouillon',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    validated_at TEXT,
    total_gross INTEGER DEFAULT 0,
    total_net INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS payroll_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    base_salary INTEGER NOT NULL,
    weekly_hours INTEGER NOT NULL DEFAULT 40,
    hours_json TEXT,
    lines_json TEXT,
    gross INTEGER NOT NULL,
    deductions_json TEXT,
    net INTEGER NOT NULL,
    paniers INTEGER DEFAULT 0,
    status TEXT DEFAULT 'calculé',
    paid_at TEXT,
    payment_method TEXT,
    payment_ref TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );
  `);

  const employeeColumns = db.prepare('PRAGMA table_info(employees)').all();
  if (!employeeColumns.some((column) => column.name === 'weekly_hours')) {
    db.exec('ALTER TABLE employees ADD COLUMN weekly_hours INTEGER NOT NULL DEFAULT 40');
    db.exec("UPDATE employees SET weekly_hours = 56 WHERE schedule_name IN ('Nuit', 'Rotation 7j/7')");
  }

  const payrollItemColumns = db.prepare('PRAGMA table_info(payroll_items)').all();
  if (!payrollItemColumns.some((column) => column.name === 'weekly_hours')) {
    db.exec('ALTER TABLE payroll_items ADD COLUMN weekly_hours INTEGER NOT NULL DEFAULT 40');
  }
}

const DEMO_ATTENDANCE_VERSION = '2';
// SHA-256 of the untouched v1 demo attendance table. Migrate only this exact fixture.
const LEGACY_DEMO_ATTENDANCE_SHA256 = '575d95534233591291793599cce41f252bba5ef30a2287d89205cc11f0b0554f';
const DEFAULT_DEMO_USERS = [
  ['admin@sahelservices.sn', 'admin'],
  ['compta@sahelservices.sn', 'comptable'],
  ['drh@sahelservices.sn', 'drh'],
  ['pointage@sahelservices.sn', 'pointage']
];
const DEFAULT_DEMO_SCHEDULES = [
  ['EMP-001', 40, 'Jour', '08:00', '17:00'],
  ['EMP-002', 40, 'Jour', '08:00', '17:00'],
  ['EMP-003', 40, 'Jour', '08:00', '17:00'],
  ['EMP-004', 40, 'Jour', '08:00', '17:00'],
  ['EMP-005', 40, 'Jour', '08:00', '17:00'],
  ['EMP-006', 40, 'Équipe jour', '07:00', '16:00'],
  ['EMP-007', 40, 'Équipe jour', '07:00', '16:00'],
  ['EMP-008', 40, 'Jour', '08:00', '17:00'],
  ['EMP-009', 56, 'Nuit', '22:00', '06:00'],
  ['EMP-010', 56, 'Nuit', '22:00', '06:00'],
  ['EMP-011', 56, 'Rotation 7j/7', '06:00', '14:00'],
  ['EMP-012', 56, 'Rotation 7j/7', '14:00', '22:00']
];

function attendanceFingerprint(db) {
  const rows = db.prepare(`SELECT employee_id, type, ts, method, device, note, created_by
    FROM attendance ORDER BY id`).all();
  const canonical = rows.map((row) => ({
    employee_id: row.employee_id, type: row.type, ts: row.ts,
    method: row.method, device: row.device, note: row.note, created_by: row.created_by
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function isUntouchedLegacyDemo(db) {
  const users = db.prepare('SELECT email, role FROM users ORDER BY email').all();
  if (JSON.stringify(users.map((user) => [user.email, user.role])) !== JSON.stringify(DEFAULT_DEMO_USERS)) return false;
  const company = db.prepare("SELECT value FROM settings WHERE key = 'company_name'").get();
  if (!company || company.value !== 'Sahel Services SARL') return false;
  const employees = db.prepare(`SELECT matricule, weekly_hours, schedule_name, schedule_start, schedule_end
    FROM employees ORDER BY matricule`).all();
  const schedules = employees.map((employee) => [
    employee.matricule, employee.weekly_hours, employee.schedule_name,
    employee.schedule_start, employee.schedule_end
  ]);
  if (JSON.stringify(schedules) !== JSON.stringify(DEFAULT_DEMO_SCHEDULES)) return false;
  return attendanceFingerprint(db) === LEGACY_DEMO_ATTENDANCE_SHA256;
}

function migrateLegacyDemoAttendance(db) {
  const existingVersion = db.prepare("SELECT value FROM settings WHERE key = 'demo_attendance_version'").get();
  if (existingVersion && existingVersion.value === DEMO_ATTENDANCE_VERSION) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare("SELECT value FROM settings WHERE key = 'demo_attendance_version'").get();
    if ((version && version.value === DEMO_ATTENDANCE_VERSION) || !isUntouchedLegacyDemo(db)) {
      db.exec('COMMIT');
      return false;
    }
    db.exec('DELETE FROM attendance');
    seedAttendance(db);
    db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)')
      .run('demo_attendance_version', DEMO_ATTENDANCE_VERSION);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function seed(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const empCount = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
  if (userCount >= 4 && empCount >= 12) {
    const quota = db.prepare("SELECT value FROM pay_rules WHERE key = 'ot_month_quota_hours'").get();
    if (!quota || Number(quota.value) === 32) {
      db.prepare("INSERT OR REPLACE INTO pay_rules(key, value) VALUES ('ot_month_quota_hours', '40')").run();
    }
    migrateLegacyDemoAttendance(db);
    return false;
  }

  db.exec('BEGIN');
  try {
    if (userCount > 0 || empCount > 0) {
      db.exec('DELETE FROM attendance; DELETE FROM employees; DELETE FROM departments; DELETE FROM sessions; DELETE FROM users;');
    }

  // ---------- Paramètres société ----------
  const set = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
  set.run('company_name', 'Sahel Services SARL');
  set.run('company_address', 'Route de Ouakam, Dakar — Sénégal');
  set.run('company_rcc', 'SN-DKR-2019-B-4412');
  set.run('currency', 'FCFA');
  set.run('timezone', 'Africa/Dakar');
  set.run('device_name', 'Tablette-Pointage-01');
  set.run('subscription', 'Premium — illimité');
  set.run('demo_attendance_version', DEMO_ATTENDANCE_VERSION);

  // ---------- Règles de paie ----------
  const rule = db.prepare('INSERT OR REPLACE INTO pay_rules(key, value) VALUES (?, ?)');
  const allRules = {
    ...DEFAULT_RULES,
    ipres_pct: 5.6,
    css_pct: 5
  };
  for (const [k, v] of Object.entries(allRules)) rule.run(k, String(v));

  // ---------- Utilisateurs ----------
  const user = db.prepare('INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)');
  user.run('Awa Diallo (Admin)', 'admin@sahelservices.sn', hashPassword('demo2026'), 'admin');
  user.run('Moustapha Sow (DRH)', 'drh@sahelservices.sn', hashPassword('demo2026'), 'drh');
  user.run('Fatou Ndiaye (Comptable)', 'compta@sahelservices.sn', hashPassword('demo2026'), 'comptable');
  user.run('Ibrahima Ba (Pointage)', 'pointage@sahelservices.sn', hashPassword('demo2026'), 'pointage');

  // ---------- Départements ----------
  const dep = db.prepare('INSERT INTO departments(name) VALUES (?)');
  const deps = ['Administration', 'Production', 'Logistique', 'Commercial', 'Sécurité'];
  for (const d of deps) dep.run(d);

  // ---------- Employés ----------
  const emp = db.prepare(`INSERT INTO employees
    (matricule, first_name, last_name, email, phone, department_id, position, contract_type, hire_date,
     base_salary, weekly_hours, schedule_name, schedule_start, schedule_end, qr_token, fingerprint_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const employees = [
    ['EMP-001', 'Cheikh', 'Diop', 'cheikh.diop@sahelservices.sn', '77 312 44 10', 1, 'Assistant administratif', 'CDI', '2021-02-15', 285000, 'Jour', '08:00', '17:00'],
    ['EMP-002', 'Aminata', 'Fall', 'aminata.fall@sahelservices.sn', '77 445 21 08', 1, 'Chargée RH', 'CDI', '2020-06-01', 420000, 'Jour', '08:00', '17:00'],
    ['EMP-003', 'Ousmane', 'Sy', 'ousmane.sy@sahelservices.sn', '76 220 18 44', 2, 'Chef d\'équipe production', 'CDI', '2019-03-11', 350000, 'Jour', '08:00', '17:00'],
    ['EMP-004', 'Mame', 'Diouf', 'mame.diouf@sahelservices.sn', '78 110 33 27', 2, 'Opératrice de ligne', 'CDI', '2022-01-10', 195000, 'Jour', '08:00', '17:00'],
    ['EMP-005', 'Pape', 'Gueye', 'pape.gueye@sahelservices.sn', '77 654 90 12', 2, 'Opérateur de ligne', 'CDD', '2023-05-22', 185000, 'Jour', '08:00', '17:00'],
    ['EMP-006', 'Awa', 'Sarr', 'awa.sarr@sahelservices.sn', '77 891 23 56', 3, 'Logisticienne', 'CDI', '2021-09-05', 265000, 'Équipe jour', '07:00', '16:00'],
    ['EMP-007', 'Moussa', 'Camara', 'moussa.camara@sahelservices.sn', '76 334 77 89', 3, 'Chauffeur-livreur', 'CDI', '2020-11-19', 210000, 'Équipe jour', '07:00', '16:00'],
    ['EMP-008', 'Khady', 'Mbengue', 'khady.mbengue@sahelservices.sn', '78 222 11 90', 4, 'Commerciale', 'CDI', '2022-08-01', 310000, 'Jour', '08:00', '17:00'],
    ['EMP-009', 'Abdou', 'Thiam', 'abdou.thiam@sahelservices.sn', '77 555 40 20', 2, 'Technicien de nuit', 'CDI', '2021-04-12', 275000, 'Nuit', '22:00', '06:00'],
    ['EMP-010', 'Sokhna', 'Diagne', 'sokhna.diagne@sahelservices.sn', '76 111 22 33', 2, 'Technicienne de nuit', 'CDI', '2022-10-03', 265000, 'Nuit', '22:00', '06:00'],
    ['EMP-011', 'Mamadou', 'Lô', 'mamadou.lo@sahelservices.sn', '77 909 87 65', 5, 'Agent de sécurité', 'CDI', '2018-07-07', 165000, 'Rotation 7j/7', '06:00', '14:00'],
    ['EMP-012', 'Ndeye', 'Sow', 'ndeye.sow@sahelservices.sn', '78 404 50 60', 5, 'Agente de sécurité', 'CDI', '2019-12-02', 165000, 'Rotation 7j/7', '14:00', '22:00'],
  ];
  let fpSeq = 1;
  for (const e of employees) {
    const digest = crypto.createHash('sha256').update(`chronorh-demo-${e[0]}`).digest('hex').toUpperCase();
    const qr = 'QR-' + digest.slice(0, 12);
    const fp = 'FP-' + digest.slice(12, 28);
    const weeklyHours = ['Nuit', 'Rotation 7j/7'].includes(e[10]) ? 56 : 40;
    emp.run(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], weeklyHours, e[10], e[11], e[12], qr, fp);
    fpSeq++;
  }

  // ---------- Jours fériés (Sénégal, dates lunaires présumées = modifiables) ----------
  const hol = db.prepare('INSERT OR REPLACE INTO holidays(date, name) VALUES (?, ?)');
  const holidays = [
    ['2026-01-01', "Jour de l'An"],
    ['2026-03-20', 'Korité (Eid al-Fitr) — présumé'],
    ['2026-04-04', "Fête de l'Indépendance"],
    ['2026-05-01', 'Fête du Travail'],
    ['2026-05-27', 'Tabaski (Eid al-Adha) — présumé'],
    ['2026-08-13', 'Grand Magal de Touba — présumé'],
    ['2026-08-25', 'Maouloud (Mawlid) — présumé'],
    ['2026-09-18', 'Tamkharit / Achoura — présumé'],
    ['2026-12-25', 'Noël'],
  ];
  for (const h of holidays) hol.run(h[0], h[1]);

  // ---------- Pointages de démonstration (septembre + octobre 2026) ----------
  seedAttendance(db);

  db.prepare(`INSERT INTO audit_logs(user_id, user_name, action, details) VALUES (?, ?, ?, ?)`)
    .run(1, 'Système', 'initialisation', 'Base de démonstration créée avec succès');
  db.exec('COMMIT');
  return true;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

function seedAttendance(db) {
  const att = db.prepare('INSERT INTO attendance(employee_id, type, ts, method, device, note) VALUES (?, ?, ?, ?, ?, ?)');
  const emps = db.prepare('SELECT * FROM employees ORDER BY id').all();
  // Four-week windows make the demo's 40/56 h weekly references exactly 160/224 h.
  const monthPlans = [
    {
      month: '2026-09',
      lastDay: 28,
      employees: {
        'EMP-001': { extraByWeek: [4] },
        'EMP-002': { absentDays: 1 },
        'EMP-005': { extraByWeek: [10] },
        'EMP-007': { absentDays: 1, extraByWeek: [4] },
        'EMP-008': { extraByWeek: [4] },
        'EMP-009': { extraByWeek: [4] },
        'EMP-010': { absentDays: 1 }
      }
    },
    {
      month: '2026-10',
      lastDay: 28,
      employees: {
        'EMP-002': { absentDays: 1 },
        'EMP-003': { extraByWeek: [4] },
        'EMP-005': { extraByWeek: [10] },
        'EMP-006': { absentDays: 1 },
        'EMP-010': { extraByWeek: [4] },
        'EMP-011': { absentDays: 1 }
      }
    }
  ];

  const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const formatTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const timeMinutes = (value) => {
    const [hours, minutes] = String(value || '00:00').split(':').map(Number);
    return hours * 60 + minutes;
  };
  const dateTimeAt = (dateIso, minuteOffset) => {
    const dayOffset = Math.floor(minuteOffset / 1440);
    const minuteOfDay = ((minuteOffset % 1440) + 1440) % 1440;
    const date = new Date(`${dateIso}T12:00:00`);
    date.setDate(date.getDate() + dayOffset);
    return `${formatDate(date)}T${formatTime(minuteOfDay)}:00`;
  };
  const pushAt = (employeeId, type, dateIso, minuteOffset, method) => {
    att.run(employeeId, type, dateTimeAt(dateIso, minuteOffset), method, 'Tablette-Pointage-01', null);
  };
  const methodFor = (employeeId, dateIso, pointIndex) => {
    const day = Number(dateIso.slice(-2));
    return (employeeId + day + pointIndex) % 2 === 0 ? 'qr' : 'fingerprint';
  };

  for (const monthPlan of monthPlans) {
    for (const employee of emps) {
      const employeeId = Number(employee.id);
      const weeklyHours = Number(employee.weekly_hours);
      const workDates = [];
      for (let day = 1; day <= monthPlan.lastDay; day++) {
        const date = new Date(`${monthPlan.month}-01T12:00:00`);
        date.setDate(day);
        const dayOfWeek = date.getDay();
        if (weeklyHours === 56 || (dayOfWeek >= 1 && dayOfWeek <= 5)) workDates.push(formatDate(date));
      }

      const plan = monthPlan.employees[employee.matricule] || {};
      const absentDays = Number(plan.absentDays || 0);
      if (absentDays > workDates.length) throw new Error(`Absences de démonstration invalides pour ${employee.matricule}`);
      const absent = new Set(workDates.slice(0, absentDays));
      const scheduledDates = workDates.filter((date) => !absent.has(date));
      const datesPerFullWeek = weeklyHours === 56 ? 7 : 5;
      const byWeek = new Map();
      for (const date of scheduledDates) {
        const week = isoWeekKey(new Date(`${date}T12:00:00`));
        if (!byWeek.has(week)) byWeek.set(week, []);
        byWeek.get(week).push(date);
      }
      const fullWeeks = [...byWeek.values()].filter((dates) => dates.length === datesPerFullWeek);
      const extraMinutesByDate = new Map();
      for (const [weekIndex, hours] of (plan.extraByWeek || []).entries()) {
        const weekDates = fullWeeks[weekIndex];
        if (!weekDates) throw new Error(`Semaine d’heures supplémentaires de démonstration absente pour ${employee.matricule}`);
        let remaining = Number(hours) * 60;
        for (const date of [...weekDates].reverse()) {
          const extra = Math.min(remaining, 2 * 60);
          if (extra > 0) extraMinutesByDate.set(date, extra);
          remaining -= extra;
          if (remaining === 0) break;
        }
        if (remaining > 0) throw new Error(`Heures supplémentaires de démonstration non distribuées pour ${employee.matricule}`);
      }

      for (const dateIso of scheduledDates) {
        const start = timeMinutes(employee.schedule_start);
        const extra = extraMinutesByDate.get(dateIso) || 0;
        const dayOfMonth = Number(dateIso.slice(-2));
        const late = (employeeId + dayOfMonth) % 11 === 0 ? 5 : 0;

        if (weeklyHours === 56) {
          let end = timeMinutes(employee.schedule_end);
          if (end <= start) end += 1440;
          pushAt(employeeId, 'in', dateIso, start + late, methodFor(employeeId, dateIso, 0));
          pushAt(employeeId, 'out', dateIso, end + late + extra, methodFor(employeeId, dateIso, 1));
        } else {
          // Deux sessions séparées par une pause d’une heure : 8 h nettes.
          pushAt(employeeId, 'in', dateIso, start + late, methodFor(employeeId, dateIso, 0));
          pushAt(employeeId, 'out', dateIso, start + 4 * 60, methodFor(employeeId, dateIso, 1));
          pushAt(employeeId, 'in', dateIso, start + 5 * 60, methodFor(employeeId, dateIso, 2));
          pushAt(employeeId, 'out', dateIso, start + 9 * 60 + late + extra, methodFor(employeeId, dateIso, 3));
        }
      }
    }
  }
}

module.exports = { open, schema, seed, hashPassword, verifyPassword, DB_PATH, resolveDbPath, isServerlessEnv };


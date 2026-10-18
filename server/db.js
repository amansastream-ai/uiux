'use strict';
/**
 * ChronoRH — couche base de données (SQLite via node:sqlite)
 * Schéma + jeu de données de démonstration.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { DEFAULT_RULES } = require('./payroll');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'chronorh.db');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function open() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
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
}

function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return false;

  // ---------- Paramètres société ----------
  const set = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
  set.run('company_name', 'Sahel Services SARL');
  set.run('company_address', 'Route de Ouakam, Dakar — Sénégal');
  set.run('company_rcc', 'SN-DKR-2019-B-4412');
  set.run('currency', 'FCFA');
  set.run('timezone', 'Africa/Dakar');
  set.run('device_name', 'Tablette-Pointage-01');
  set.run('subscription', 'Premium — illimité');

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
     base_salary, schedule_name, schedule_start, schedule_end, qr_token, fingerprint_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

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
    const qr = 'QR-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const fp = 'FP-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    emp.run(e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], e[12], qr, fp);
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
  return true;
}

function seedAttendance(db) {
  const att = db.prepare('INSERT INTO attendance(employee_id, type, ts, method, device, note) VALUES (?, ?, ?, ?, ?, ?)');
  const getEmp = db.prepare('SELECT * FROM employees ORDER BY id');
  const emps = getEmp.all();

  // Tirage pseudo-aléatoire déterministe
  let seedn = 42;
  const rnd = () => (seedn = (seedn * 1103515245 + 12345) % 2147483648) / 2147483648;

  const push = (empId, type, dateStr, timeStr, method) =>
    att.run(empId, type, `${dateStr}T${timeStr}:00`, method || (rnd() > 0.4 ? 'qr' : 'fingerprint'), 'Tablette-Pointage-01', null);

  const eachDate = (from, to, cb) => {
    const d = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    while (d <= end) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cb(iso, d.getDay(), d);
      d.setDate(d.getDate() + 1);
    }
  };

  // Septembre 2026 (complet) + octobre 2026 jusqu'au 17
  eachDate('2026-09-01', '2026-10-17', (iso, dow) => {
    for (const e of emps) {
      const id = Number(e.id);
      const dep = Number(e.department_id);
      const absent = rnd() < 0.04;
      if (absent) continue;

      if (e.schedule_name === 'Nuit') {
        // Équipe de nuit : 22h → 06h (enregistré la veille au soir pour l'arrivée)
        // On représente l'arrivée le jour même 22h et la sortie lendemain 6h —
        // sauf samedi/dimanche : rotation normale.
        push(id, 'in', iso, '21:58');
        push(id, 'out', iso, '06:02'); // sera décalé au lendemain ci-dessous
      } else if (e.schedule_name === 'Rotation 7j/7') {
        if (dep === 5 && id === 11) {
          // Mamadou : matin 6h→14h, y compris dimanches
          push(id, 'in', iso, '05:57');
          push(id, 'out', iso, '14:05');
        } else {
          // Ndeye : après-midi 14h→22h
          push(id, 'in', iso, '13:58');
          push(id, 'out', iso, '22:04');
        }
      } else {
        // Équipe de jour — lundi→vendredi (+ samedi parfois pour production)
        const worksSaturday = dep === 2 && id !== 4 && rnd() > 0.55;
        const isSunday = dow === 0;
        if (isSunday) continue;
        if (dow === 6 && !worksSaturday) continue;
        const late = rnd() < 0.08;
        const startMin = e.schedule_start === '07:00' ? '07:0' : '08:0';
        push(id, 'in', iso, late ? (e.schedule_start === '07:00' ? '07:22' : '08:19') : (e.schedule_start === '07:00' ? '06:58' : '07:58'));
        // Fin : 17h05 standard ; vendredi 16h ; certains jours de grosse charge jusqu'à 20h
        const heavy = rnd() < 0.18;
        let outTime = '17:05';
        if (dow === 5) outTime = '16:07';
        if (worksSaturday && dow === 6) outTime = '13:10';
        if (heavy) outTime = rnd() > 0.5 ? '20:12' : '19:35';
        if (e.schedule_start === '07:00') outTime = heavy ? '18:40' : '16:08';
        push(id, 'out', iso, outTime);
      }
    }
  });

  // Correction des nuits : sortie le lendemain 06:02 (format local, sans UTC)
  const fix = db.prepare(`UPDATE attendance SET ts = ? WHERE id = ?`);
  const nights = db.prepare(`SELECT id, ts FROM attendance WHERE employee_id IN (9,10) AND type='out' AND ts LIKE '%T06:02:00'`).all();
  for (const n of nights) {
    const d = new Date(n.ts);
    d.setDate(d.getDate() + 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fix.run(`${iso}T06:02:00`, n.id);
  }

  // Quelques pointages manuels de correction (par la gestionnaire de pointage)
  att.run(4, 'out', '2026-10-14T18:10:00', 'manual', 'Bureau', 'Correction : oubli de pointage de sortie');
  att.run(7, 'in', '2026-09-23T07:15:00', 'manual', 'Bureau', 'Badge QR non reconnu, saisie manuelle');
}

module.exports = { open, schema, seed, hashPassword, verifyPassword, DB_PATH };

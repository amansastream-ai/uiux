'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { open, schema, seed, resolveDbPath } = require('../server/db');
const { buildSessions } = require('../server/api');
const { computePayroll } = require('../server/payroll');
const { verifyTokenPayload } = require('../server/auth');
const { seedLegacyDemoAttendance } = require('./fixtures/legacy-demo-attendance');
const appModule = require('../server/index');
const vercelHandler = require('../api/index');

function createTempDb(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `chronorh-test-${tag}-`));
  const dbPath = path.join(dir, 'chronorh.db');
  const db = open(dbPath);
  schema(db);
  seed(db);
  return { db, dbPath, dir };
}

function attendanceHash(db) {
  const rows = db.prepare(`SELECT employee_id, type, ts, method, device, note, created_by
    FROM attendance ORDER BY id`).all();
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function requestHandler(handler, { method = 'GET', url = '/', body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      try {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (cookie) headers['Cookie'] = cookie;
        const res = await fetch(`http://127.0.0.1:${port}${url}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const setCookie = res.headers.get('set-cookie') || '';
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* HTML or plain */ }
        resolve({ status: res.status, json, text, setCookie });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test('Vercel : resolveDbPath bascule vers /tmp lorsque VERCEL=1', () => {
  const prevVercel = process.env.VERCEL;
  const prevDir = process.env.CHRONORH_DATA_DIR;
  const prevPath = process.env.CHRONORH_DB_PATH;
  try {
    delete process.env.CHRONORH_DATA_DIR;
    delete process.env.CHRONORH_DB_PATH;
    process.env.VERCEL = '1';
    const resolved = resolveDbPath();
    assert.ok(resolved.startsWith(os.tmpdir()), `Attendu un chemin dans ${os.tmpdir()}, obtenu : ${resolved}`);
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = prevVercel;
    if (prevDir === undefined) delete process.env.CHRONORH_DATA_DIR; else process.env.CHRONORH_DATA_DIR = prevDir;
    if (prevPath === undefined) delete process.env.CHRONORH_DB_PATH; else process.env.CHRONORH_DB_PATH = prevPath;
  }
});

test('Vercel : api/index.js répond sur /api/health et sur /health (préfixe normalisé)', async () => {
  const r1 = await requestHandler(vercelHandler, { url: '/api/health' });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.status, 'ok');
  assert.ok(r1.json.employees >= 12);

  const r2 = await requestHandler(vercelHandler, { url: '/health' });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.status, 'ok');
});

test('Vercel : la session survit à un démarrage à froid / changement d’instance serverless', async () => {
  const instA = createTempDb('instA');
  const instB = createTempDb('instB');
  const appA = appModule.createApp(instA.db);
  const appB = appModule.createApp(instB.db);

  // 1. Connexion sur l'instance A
  const login = await requestHandler(appA, {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'drh@sahelservices.sn', password: 'demo2026' }
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.role, 'drh');
  const cookie = login.setCookie.split(';')[0];
  assert.ok(cookie.startsWith('chronorh_session='));

  // 2. Requête authentifiée sur l'instance B (base SQLite distincte en /tmp)
  const meOnB = await requestHandler(appB, {
    method: 'GET',
    url: '/api/auth/me',
    cookie
  });
  assert.equal(meOnB.status, 200, 'La session signée doit être reconnue par une nouvelle instance');
  assert.equal(meOnB.json.user.email, 'drh@sahelservices.sn');

  // 3. Les jetons QR de démo sont déterministes d'une instance à l'autre
  const empA = instA.db.prepare("SELECT qr_token, fingerprint_id FROM employees WHERE matricule = 'EMP-001'").get();
  const empB = instB.db.prepare("SELECT qr_token, fingerprint_id FROM employees WHERE matricule = 'EMP-001'").get();
  assert.equal(empA.qr_token, empB.qr_token);
  assert.equal(empA.fingerprint_id, empB.fingerprint_id);
  assert.equal(attendanceHash(instA.db), attendanceHash(instB.db), 'Les pointages démo doivent être reproductibles entre instances');
});

test('Création de compte : rôle Pointeur, entreprise facultative et session stateless entre instances', async () => {
  const instA = createTempDb('registerA');
  const instB = createTempDb('registerB');
  const appA = appModule.createApp(instA.db);
  const appB = appModule.createApp(instB.db);

  const registration = await requestHandler(appA, {
    method: 'POST',
    url: '/api/auth/register',
    body: {
      name: 'Aminata Test',
      email: 'AMINATA.TEST@EXAMPLE.SN',
      password: 'secure-pass-2026',
      role: 'pointeur',
      company_name: 'Entreprise Test'
    }
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.json.user.role, 'pointage');
  assert.equal(registration.json.user.email, 'aminata.test@example.sn');
  assert.equal(instA.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
  assert.equal(instA.db.prepare(`SELECT COUNT(*) AS n FROM users
    WHERE email IN ('admin@sahelservices.sn', 'drh@sahelservices.sn', 'compta@sahelservices.sn', 'pointage@sahelservices.sn')`).get().n, 4);
  assert.equal(instA.db.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 12);

  const cookie = registration.setCookie.split(';')[0];
  const token = cookie.slice('chronorh_session='.length);
  const claims = verifyTokenPayload(token);
  assert.equal(claims.name, 'Aminata Test');
  assert.equal(claims.email, 'aminata.test@example.sn');
  assert.equal(claims.role, 'pointage');
  assert.equal(typeof claims.exp, 'number');
  assert.ok(claims.u);

  const meOnA = await requestHandler(appA, { url: '/api/auth/me', cookie });
  assert.equal(meOnA.status, 200);
  assert.equal(meOnA.json.settings.company_name, 'Entreprise Test');

  const meOnB = await requestHandler(appB, { url: '/api/auth/me', cookie });
  assert.equal(meOnB.status, 200, 'Le jeton signé doit restaurer le compte sur une nouvelle instance');
  assert.equal(meOnB.json.user.name, 'Aminata Test');
  assert.equal(meOnB.json.user.email, 'aminata.test@example.sn');
  assert.equal(meOnB.json.user.role, 'pointage');
  assert.equal(instB.db.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 12);

  const punch = await requestHandler(appB, {
    method: 'POST',
    url: '/api/attendance',
    body: { employee_id: 1, type: 'in', ts: '2026-10-18T08:00:00', method: 'manual' },
    cookie
  });
  assert.equal(punch.status, 201, 'Le compte restauré garde ses droits dans les routes nécessitant un utilisateur local');

  const duplicate = await requestHandler(appA, {
    method: 'POST',
    url: '/api/auth/register',
    body: {
      name: 'Another Name', email: 'aminata.test@example.sn',
      password: 'secure-pass-2026', role: 'admin'
    }
  });
  assert.equal(duplicate.status, 409);
});

test('Migration et données de démo : seuils 40/56 h, quota de 40 h et totaux mensuels cohérents', () => {
  const inst = createTempDb('weekly-seed');
  const dayEmployees = inst.db.prepare('SELECT COUNT(*) AS n FROM employees WHERE weekly_hours = 40').get().n;
  const longWeekEmployees = inst.db.prepare('SELECT COUNT(*) AS n FROM employees WHERE weekly_hours = 56').get().n;
  const quota = inst.db.prepare("SELECT value FROM pay_rules WHERE key = 'ot_month_quota_hours'").get();
  const version = inst.db.prepare("SELECT value FROM settings WHERE key = 'demo_attendance_version'").get();
  assert.equal(dayEmployees, 8);
  assert.equal(longWeekEmployees, 4);
  assert.equal(quota.value, '40');
  assert.equal(version.value, '2');
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 12);
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 4);
  assert.deepEqual(inst.db.prepare('SELECT email, role FROM users ORDER BY email').all().map((user) => [user.email, user.role]), [
    ['admin@sahelservices.sn', 'admin'],
    ['compta@sahelservices.sn', 'comptable'],
    ['drh@sahelservices.sn', 'drh'],
    ['pointage@sahelservices.sn', 'pointage']
  ]);

  const employees = inst.db.prepare('SELECT id, matricule, base_salary, weekly_hours FROM employees ORDER BY matricule').all();
  const expectedMonthlyHours = {
    '2026-09': [164, 152, 160, 160, 170, 160, 156, 164, 228, 216, 224, 224],
    '2026-10': [160, 152, 164, 160, 170, 152, 160, 160, 224, 228, 216, 224]
  };
  for (const [month, expected] of Object.entries(expectedMonthlyHours)) {
    const from = `${month}-01`;
    const to = month === '2026-09' ? '2026-09-30' : '2026-10-31';
    const sessions = buildSessions(inst.db, from, to);
    const results = employees.map((employee) => {
      const result = computePayroll({
        sessions: sessions.filter((session) => session.employee_id === employee.id),
        baseSalary: employee.base_salary,
        weeklyHours: employee.weekly_hours,
        holidays: [], rules: {}, periodFrom: from, periodTo: to
      });
      return result.hours.total;
    });
    assert.deepEqual(results, expected, `totaux d'heures de démonstration pour ${month}`);
  }
  const septemberSessions = buildSessions(inst.db, '2026-09-01', '2026-09-30');
  const septemberEmp005 = employees.find((employee) => employee.matricule === 'EMP-005');
  const emp005Payroll = computePayroll({
    sessions: septemberSessions.filter((session) => session.employee_id === septemberEmp005.id),
    baseSalary: septemberEmp005.base_salary, weeklyHours: septemberEmp005.weekly_hours,
    holidays: [], rules: {}, periodFrom: '2026-09-01', periodTo: '2026-09-30'
  });
  assert.equal(emp005Payroll.hours.overtime_15, 8);
  assert.equal(emp005Payroll.hours.overtime_40, 2);
  const septemberEmp007 = employees.find((employee) => employee.matricule === 'EMP-007');
  const emp007Payroll = computePayroll({
    sessions: septemberSessions.filter((session) => session.employee_id === septemberEmp007.id),
    baseSalary: septemberEmp007.base_salary, weeklyHours: septemberEmp007.weekly_hours,
    holidays: [], rules: {}, periodFrom: '2026-09-01', periodTo: '2026-09-30'
  });
  assert.equal(emp007Payroll.hours.total, 156);
  assert.equal(emp007Payroll.hours.overtime_15 + emp007Payroll.hours.overtime_40, 0);
  const septemberEmp009 = employees.find((employee) => employee.matricule === 'EMP-009');
  const emp009Payroll = computePayroll({
    sessions: septemberSessions.filter((session) => session.employee_id === septemberEmp009.id),
    baseSalary: septemberEmp009.base_salary, weeklyHours: septemberEmp009.weekly_hours,
    holidays: [], rules: {}, periodFrom: '2026-09-01', periodTo: '2026-09-30'
  });
  assert.equal(emp009Payroll.hours.total, 228);
  assert.equal(emp009Payroll.hours.overtime_15, 4);
  assert.equal(emp009Payroll.hours.overtime_40, 0);
  inst.db.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronorh-test-old-schema-'));
  const legacy = open(path.join(dir, 'chronorh.db'));
  legacy.exec("CREATE TABLE employees (id INTEGER PRIMARY KEY, schedule_name TEXT); INSERT INTO employees(schedule_name) VALUES ('Jour'), ('Nuit'), ('Rotation 7j/7')");
  legacy.exec('CREATE TABLE payroll_items (id INTEGER PRIMARY KEY, base_salary INTEGER NOT NULL)');
  schema(legacy);
  assert.deepEqual(legacy.prepare('SELECT weekly_hours FROM employees ORDER BY id').all().map((row) => row.weekly_hours), [40, 56, 56]);
  assert.ok(legacy.prepare('PRAGMA table_info(payroll_items)').all().some((column) => column.name === 'weekly_hours'));
  legacy.close();
});

test('seed : l’ancien jeu de démo est migré vers les pointages mensuels déterministes', () => {
  const inst = createTempDb('legacy-attendance');
  inst.db.exec('DELETE FROM attendance');
  inst.db.prepare("DELETE FROM settings WHERE key = 'demo_attendance_version'").run();
  seedLegacyDemoAttendance(inst.db);
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, 898);

  seed(inst.db);
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, 1708);
  assert.equal(inst.db.prepare("SELECT value FROM settings WHERE key = 'demo_attendance_version'").get().value, '2');
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 4);
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM employees').get().n, 12);
  inst.db.close();
});

test('seed : les pointages personnalisés ne sont pas écrasés par la migration de démo', () => {
  const inst = createTempDb('custom-attendance');
  const originalCount = inst.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n;
  const customRow = inst.db.prepare('SELECT id, employee_id, type, ts FROM attendance ORDER BY id LIMIT 1').get();
  inst.db.prepare("DELETE FROM settings WHERE key = 'demo_attendance_version'").run();
  inst.db.prepare('UPDATE attendance SET note = ? WHERE id = ?').run('Pointage personnalisé conservé', customRow.id);

  seed(inst.db);
  const preserved = inst.db.prepare('SELECT employee_id, type, ts, note FROM attendance WHERE id = ?').get(customRow.id);
  assert.deepEqual({ ...preserved }, {
    employee_id: customRow.employee_id,
    type: customRow.type,
    ts: customRow.ts,
    note: 'Pointage personnalisé conservé'
  });
  assert.equal(inst.db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, originalCount);
  inst.db.close();
});

test('Employé : la référence de 40/56 h est validée et enregistrée par salarié', async () => {
  const inst = createTempDb('employee-weekly');
  const app = appModule.createApp(inst.db);
  const login = await requestHandler(app, {
    method: 'POST',
    url: '/api/auth/login',
    body: { email: 'admin@sahelservices.sn', password: 'demo2026' }
  });
  assert.equal(login.status, 200);
  const cookie = login.setCookie.split(';')[0];

  const created = await requestHandler(app, {
    method: 'POST',
    url: '/api/employees',
    cookie,
    body: {
      matricule: 'EMP-TEST', first_name: 'Test', last_name: 'Référence',
      base_salary: 200000, schedule_name: 'Flexible', weekly_hours: '56'
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.employee.weekly_hours, 56);
  assert.equal(created.json.employee.schedule_name, 'Flexible');

  const invalid = await requestHandler(app, {
    method: 'PUT',
    url: `/api/employees/${created.json.employee.id}`,
    cookie,
    body: { ...created.json.employee, weekly_hours: '48' }
  });
  assert.equal(invalid.status, 400);

  const updated = await requestHandler(app, {
    method: 'PUT',
    url: `/api/employees/${created.json.employee.id}`,
    cookie,
    body: { ...created.json.employee, weekly_hours: '40' }
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.employee.weekly_hours, 40);

  const generated = await requestHandler(app, {
    method: 'POST',
    url: '/api/payroll/runs',
    cookie,
    body: { period: '2026-10' }
  });
  assert.equal(generated.status, 201);
  const run = await requestHandler(app, {
    url: `/api/payroll/runs/${generated.json.run_id}`,
    cookie
  });
  assert.equal(run.status, 200);
  assert.equal(run.json.items.find((item) => item.matricule === 'EMP-001').weekly_hours, 40);
  assert.equal(run.json.items.find((item) => item.matricule === 'EMP-009').weekly_hours, 56);
  inst.db.close();
});

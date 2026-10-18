'use strict';
/** ChronoRH — API REST. */
const express = require('express');
const QRCode = require('qrcode');
const crypto = require('node:crypto');
const { computePayroll, computeDeductions, DEFAULT_RULES, dateKey, isoWeekKey } = require('./payroll');
const { createSession, destroySession, currentUser, requireAuth, requireRole, audit } = require('./auth');

function apiRouter(db) {
  const router = express.Router();
  const auth = requireAuth(db);
  const parseRules = () => {
    const rows = db.prepare('SELECT key, value FROM pay_rules').all();
    const rules = {};
    for (const r of rows) {
      const v = Number(r.value);
      rules[r.key] = Number.isNaN(v) ? r.value : v;
    }
    return rules;
  };
  const getSettings = () => {
    const out = {};
    for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
    return out;
  };

  // ============================================================ AUTH
  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    const u = user || db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(String(email || '').trim().toLowerCase());
    if (!u || !require('./db').verifyPassword(password || '', u.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    if (!u.active) return res.status(403).json({ error: 'Compte désactivé' });
    createSession(db, u.id, res);
    audit(db, u, 'connexion', `${u.name} s'est connecté (${u.role})`);
    res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  });

  router.post('/auth/logout', (req, res) => {
    const user = currentUser(db, req);
    destroySession(db, req, res);
    if (user) audit(db, user, 'déconnexion', `${user.name} s'est déconnecté`);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({ user: req.user, settings: getSettings() });
  });

  // ============================================================ DASHBOARD
  router.get('/dashboard', auth, (req, res) => {
    const today = dateKey(new Date());
    const month = today.slice(0, 7);

    const activeEmployees = db.prepare(`SELECT COUNT(*) n FROM employees WHERE status='actif'`).get().n;

    // Sessions ouvertes (dernier pointage = 'in' sans 'out')
    const openRows = db.prepare(`
      SELECT e.id, e.first_name, e.last_name, e.matricule, e.schedule_name, a.ts AS since, a.method
      FROM employees e
      JOIN attendance a ON a.id = (
        SELECT a2.id FROM attendance a2 WHERE a2.employee_id = e.id ORDER BY a2.ts DESC, a2.id DESC LIMIT 1
      )
      WHERE a.type = 'in' AND e.status = 'actif'
      ORDER BY a.ts ASC
    `).all();

    const punchesToday = db.prepare(`SELECT COUNT(*) n FROM attendance WHERE ts LIKE ?`).get(today + '%').n;

    // Heures du mois en cours (approximation par sessions appariées)
    const monthSessions = buildSessions(db, month + '-01', endOfMonth(month));
    const monthHours = monthSessions.reduce((a, s) => a + (new Date(s.end) - new Date(s.start)) / 3600000, 0);

    // Derniers pointages
    const recent = db.prepare(`
      SELECT a.*, e.first_name, e.last_name, e.matricule
      FROM attendance a JOIN employees e ON e.id = a.employee_id
      ORDER BY a.ts DESC, a.id DESC LIMIT 12
    `).all();

    // Absents du jour (actifs sans pointage aujourd'hui)
    const punchedToday = new Set(db.prepare(`SELECT DISTINCT employee_id id FROM attendance WHERE ts LIKE ?`).all(today + '%').map((r) => r.id));
    const absents = db.prepare(`SELECT id, first_name, last_name, matricule, schedule_name FROM employees WHERE status='actif'`).all()
      .filter((e) => !punchedToday.has(e.id));

    let payroll = null;
    if (['admin', 'comptable'].includes(req.user.role)) {
      const run = db.prepare(`SELECT * FROM payroll_runs ORDER BY period DESC LIMIT 1`).get();
      if (run) payroll = { period: run.period, status: run.status, total_gross: run.total_gross, total_net: run.total_net };
    }

    res.json({
      activeEmployees,
      present: openRows.length,
      openSessions: openRows,
      punchesToday,
      monthHours: Math.round(monthHours * 10) / 10,
      recent,
      absents: absents.slice(0, 8),
      absentCount: absents.length,
      payroll,
      serverTime: new Date().toISOString()
    });
  });

  // ============================================================ EMPLOYÉS
  router.get('/employees', auth, (req, res) => {
    const q = String(req.query.q || '').toLowerCase();
    const rows = db.prepare(`
      SELECT e.*, d.name AS department
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      ORDER BY e.matricule
    `).all().filter((e) =>
      !q || `${e.first_name} ${e.last_name} ${e.matricule} ${e.position} ${e.department}`.toLowerCase().includes(q)
    );
    res.json({ employees: rows });
  });

  const employeeBody = (b) => ({
    matricule: b.matricule,
    first_name: b.first_name,
    last_name: b.last_name,
    email: b.email || null,
    phone: b.phone || null,
    department_id: b.department_id ? Number(b.department_id) : null,
    position: b.position || '',
    contract_type: b.contract_type || 'CDI',
    hire_date: b.hire_date || null,
    base_salary: Number(b.base_salary) || 0,
    schedule_name: b.schedule_name || 'Jour',
    schedule_start: b.schedule_start || '08:00',
    schedule_end: b.schedule_end || '17:00',
    status: b.status || 'actif'
  });

  router.post('/employees', auth, requireRole('admin', 'drh'), (req, res) => {
    const e = employeeBody(req.body || {});
    if (!e.matricule || !e.first_name || !e.last_name) return res.status(400).json({ error: 'Matricule, prénom et nom obligatoires' });
    const qr = 'QR-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const fp = 'FP-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    try {
      const info = db.prepare(`INSERT INTO employees
        (matricule, first_name, last_name, email, phone, department_id, position, contract_type, hire_date,
         base_salary, schedule_name, schedule_start, schedule_end, status, qr_token, fingerprint_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(e.matricule, e.first_name, e.last_name, e.email, e.phone, e.department_id, e.position,
          e.contract_type, e.hire_date, e.base_salary, e.schedule_name, e.schedule_start, e.schedule_end,
          e.status, qr, fp);
      audit(db, req.user, 'employé créé', `${e.matricule} ${e.first_name} ${e.last_name}`);
      const created = db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json({ employee: created });
    } catch (err) {
      res.status(400).json({ error: 'Matricule déjà utilisé ? (' + err.message + ')' });
    }
  });

  router.put('/employees/:id', auth, requireRole('admin', 'drh'), (req, res) => {
    const e = employeeBody(req.body || {});
    const exists = db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
    if (!exists) return res.status(404).json({ error: 'Employé introuvable' });
    db.prepare(`UPDATE employees SET matricule=?, first_name=?, last_name=?, email=?, phone=?, department_id=?,
      position=?, contract_type=?, hire_date=?, base_salary=?, schedule_name=?, schedule_start=?, schedule_end=?, status=?
      WHERE id=?`)
      .run(e.matricule, e.first_name, e.last_name, e.email, e.phone, e.department_id, e.position,
        e.contract_type, e.hire_date, e.base_salary, e.schedule_name, e.schedule_start, e.schedule_end, e.status, req.params.id);
    audit(db, req.user, 'employé modifié', `${e.matricule} ${e.first_name} ${e.last_name}`);
    res.json({ employee: db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id) });
  });

  router.get('/employees/:id', auth, (req, res) => {
    const e = db.prepare(`SELECT e.*, d.name AS department FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?`).get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Employé introuvable' });
    const recent = db.prepare(`SELECT * FROM attendance WHERE employee_id = ? ORDER BY ts DESC LIMIT 30`).all(req.params.id);
    res.json({ employee: e, recent });
  });

  router.post('/employees/:id/enroll-fingerprint', auth, requireRole('admin', 'drh'), (req, res) => {
    const fp = 'FP-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    db.prepare('UPDATE employees SET fingerprint_id = ? WHERE id = ?').run(fp, req.params.id);
    audit(db, req.user, 'empreinte enregistrée', `Employé #${req.params.id}`);
    res.json({ fingerprint_id: fp });
  });

  router.post('/employees/:id/regenerate-qr', auth, requireRole('admin', 'drh'), (req, res) => {
    const qr = 'QR-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    db.prepare('UPDATE employees SET qr_token = ? WHERE id = ?').run(qr, req.params.id);
    audit(db, req.user, 'badge QR régénéré', `Employé #${req.params.id}`);
    res.json({ qr_token: qr });
  });

  router.get('/employees/:id/badge.svg', auth, async (req, res) => {
    const e = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).send('introuvable');
    const payload = `CHRONORH|${e.qr_token}`;
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 320, color: { dark: '#0B1F33', light: '#FFFFFF' } });
    res.type('image/svg+xml').send(svg);
  });

  router.get('/employees/:id/badge', auth, (req, res) => {
    const e = db.prepare('SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'introuvable' });
    const settings = getSettings();
    res.json({ employee: e, company: settings.company_name || 'ChronoRH' });
  });

  // ============================================================ POINTAGES
  router.get('/attendance', auth, (req, res) => {
    const day = req.query.date || dateKey(new Date());
    const rows = db.prepare(`
      SELECT a.*, e.first_name, e.last_name, e.matricule, e.schedule_name
      FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.ts LIKE ?
      ORDER BY a.ts DESC
    `).all(day + '%');
    res.json({ date: day, attendance: rows });
  });

  router.post('/attendance', auth, requireRole('admin', 'drh', 'pointage'), (req, res) => {
    const { employee_id, type, ts, method, note } = req.body || {};
    if (!employee_id || !['in', 'out'].includes(type) || !ts) {
      return res.status(400).json({ error: 'employee_id, type (in/out) et ts requis' });
    }
    const emp = db.prepare('SELECT id FROM employees WHERE id = ?').get(employee_id);
    if (!emp) return res.status(404).json({ error: 'Employé introuvable' });
    const info = db.prepare('INSERT INTO attendance(employee_id, type, ts, method, device, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(employee_id, type, ts, method || 'manual', getSettings().device_name || 'Manuel', note || 'Ajout manuel', req.user.id);
    audit(db, req.user, 'pointage ajouté', `Employé #${employee_id} ${type} @ ${ts}`);
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.delete('/attendance/:id', auth, requireRole('admin', 'pointage'), (req, res) => {
    const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Pointage introuvable' });
    db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
    audit(db, req.user, 'pointage supprimé', `#${req.params.id} (${row.ts})`);
    res.json({ ok: true });
  });

  // ============================================================ BORNE (KIOSK)
  router.post('/kiosk/punch', (req, res) => {
    // Ouvert à la borne : authentification par badge (QR token ou empreinte)
    const { code, fingerprint_id } = req.body || {};
    let emp = null;
    if (code) {
      const token = String(code).replace(/^CHRONORH\|/, '').trim();
      emp = db.prepare('SELECT * FROM employees WHERE qr_token = ?').get(token);
    } else if (fingerprint_id) {
      emp = db.prepare('SELECT * FROM employees WHERE fingerprint_id = ?').get(String(fingerprint_id).trim());
    }
    if (!emp) return res.status(404).json({ error: 'Badge ou empreinte inconnu(e)' });
    if (emp.status !== 'actif') return res.status(403).json({ error: 'Ce badge est désactivé' });

    const last = db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(emp.id);
    // Anti double-scan : moins de 60 s depuis le dernier pointage
    if (last && (Date.now() - new Date(last.ts).getTime()) < 60000) {
      return res.status(429).json({ error: 'Pointage déjà enregistré à l\'instant', employee: { first_name: emp.first_name, last_name: emp.last_name, matricule: emp.matricule } });
    }
    const type = !last || last.type === 'out' ? 'in' : 'out';
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const method = fingerprint_id ? 'fingerprint' : 'qr';
    db.prepare('INSERT INTO attendance(employee_id, type, ts, method, device) VALUES (?, ?, ?, ?, ?)')
      .run(emp.id, type, ts, method, getSettings().device_name || 'Tablette-01');
    res.json({
      ok: true,
      type,
      ts,
      employee: {
        id: emp.id, first_name: emp.first_name, last_name: emp.last_name,
        matricule: emp.matricule, position: emp.position, schedule_name: emp.schedule_name
      }
    });
  });

  // ============================================================ DÉPARTEMENTS / HOLIDAYS
  router.get('/departments', auth, (req, res) => {
    res.json({ departments: db.prepare('SELECT * FROM departments ORDER BY name').all() });
  });

  router.get('/holidays', auth, (req, res) => {
    res.json({ holidays: db.prepare('SELECT * FROM holidays ORDER BY date').all() });
  });

  router.post('/holidays', auth, requireRole('admin', 'drh'), (req, res) => {
    const { date, name } = req.body || {};
    if (!date || !name) return res.status(400).json({ error: 'date et name requis' });
    db.prepare('INSERT OR REPLACE INTO holidays(date, name) VALUES (?, ?)').run(date, name);
    audit(db, req.user, 'jour férié', `${date} — ${name}`);
    res.json({ holidays: db.prepare('SELECT * FROM holidays ORDER BY date').all() });
  });

  router.delete('/holidays/:id', auth, requireRole('admin', 'drh'), (req, res) => {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ============================================================ RÈGLES & PARAMÈTRES
  router.get('/pay-rules', auth, (req, res) => {
    res.json({ rules: parseRules(), defaults: DEFAULT_RULES });
  });

  router.put('/pay-rules', auth, requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const stmt = db.prepare('INSERT OR REPLACE INTO pay_rules(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(body)) {
      if (DEFAULT_RULES[k] !== undefined || ['ipres_pct', 'css_pct'].includes(k)) stmt.run(k, String(v));
    }
    audit(db, req.user, 'règles de paie modifiées', JSON.stringify(body));
    res.json({ rules: parseRules() });
  });

  router.get('/settings', auth, (req, res) => res.json({ settings: getSettings() }));

  router.put('/settings', auth, requireRole('admin'), (req, res) => {
    const stmt = db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(req.body || {})) stmt.run(k, String(v));
    audit(db, req.user, 'paramètres modifiés', JSON.stringify(req.body));
    res.json({ settings: getSettings() });
  });

  // ============================================================ UTILISATEURS (admin)
  router.get('/users', auth, requireRole('admin'), (req, res) => {
    res.json({ users: db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY id').all() });
  });

  router.post('/users', auth, requireRole('admin'), (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Champs requis : name, email, password, role' });
    const hash = require('./db').hashPassword(password);
    try {
      const info = db.prepare('INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, String(email).toLowerCase(), hash, role);
      audit(db, req.user, 'utilisateur créé', `${name} (${role})`);
      res.status(201).json({ user: db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(info.lastInsertRowid) });
    } catch (e) {
      res.status(400).json({ error: 'Email déjà utilisé' });
    }
  });

  router.put('/users/:id', auth, requireRole('admin'), (req, res) => {
    const { name, role, active, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable' });
    db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').run(name ?? u.name, role ?? u.role, active === undefined ? u.active : (active ? 1 : 0), u.id);
    if (password) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(require('./db').hashPassword(password), u.id);
    audit(db, req.user, 'utilisateur modifié', `${u.email}`);
    res.json({ ok: true });
  });

  // ============================================================ JOURNAL (admin)
  router.get('/audit', auth, requireRole('admin'), (req, res) => {
    res.json({ logs: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all() });
  });

  // ============================================================ PAIE
  const sessionsFor = (from, to) => buildSessions(db, from, to);

  router.get('/payroll/preview', auth, requireRole('admin', 'comptable', 'drh'), (req, res) => {
    const period = req.query.period || dateKey(new Date()).slice(0, 7);
    const { from, to } = periodRange(period);
    const rules = parseRules();
    const holidays = db.prepare('SELECT * FROM holidays').all();
    const emps = db.prepare(`SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status='actif' ORDER BY e.matricule`).all();
    const sessions = sessionsFor(from, to);

    const results = emps.map((e) => {
      const mine = sessions.filter((s) => s.employee_id === e.id);
      const pay = computePayroll({ sessions: mine, holidays, rules, baseSalary: e.base_salary, periodFrom: from, periodTo: to });
      const deductions = computeDeductions(pay.gross, rules);
      const totalDed = deductions.reduce((a, d) => a + d.amount, 0);
      return {
        employee: {
          id: e.id, matricule: e.matricule, first_name: e.first_name, last_name: e.last_name,
          position: e.position, department: e.department, base_salary: e.base_salary
        },
        hours: pay.hours, paniers: pay.paniers, lines: pay.lines,
        hourly_rate: pay.hourly_rate, holidays_credited: pay.holidays_credited,
        gross: pay.gross, deductions, net: pay.gross - totalDed
      };
    });
    const totals = results.reduce((a, r) => ({
      gross: a.gross + r.gross, net: a.net + r.net,
      hours: a.hours + r.hours.total, paniers: a.paniers + r.paniers.count
    }), { gross: 0, net: 0, hours: 0, paniers: 0 });
    res.json({ period, from, to, results, totals, rules });
  });

  router.post('/payroll/runs', auth, requireRole('admin', 'comptable'), (req, res) => {
    const period = (req.body && req.body.period) || dateKey(new Date()).slice(0, 7);
    const { from, to } = periodRange(period);
    const rules = parseRules();
    const holidays = db.prepare('SELECT * FROM holidays').all();
    const emps = db.prepare(`SELECT * FROM employees WHERE status='actif' ORDER BY matricule`).all();
    const sessions = sessionsFor(from, to);

    db.exec('BEGIN');
    try {
      // Remplace un éventuel brouillon du même mois
      const old = db.prepare(`SELECT id FROM payroll_runs WHERE period = ?`).get(period);
      if (old) {
        db.prepare('DELETE FROM payroll_items WHERE run_id = ?').run(old.id);
        db.prepare('DELETE FROM payroll_runs WHERE id = ?').run(old.id);
      }
      const runInfo = db.prepare('INSERT INTO payroll_runs(period, status, created_by) VALUES (?, ?, ?)')
        .run(period, 'brouillon', req.user.id);
      const runId = runInfo.lastInsertRowid;
      let tg = 0, tn = 0;
      for (const e of emps) {
        const mine = sessions.filter((s) => s.employee_id === e.id);
        const pay = computePayroll({ sessions: mine, holidays, rules, baseSalary: e.base_salary, periodFrom: from, periodTo: to });
        const deductions = computeDeductions(pay.gross, rules);
        const totalDed = deductions.reduce((a, d) => a + d.amount, 0);
        const net = pay.gross - totalDed;
        tg += pay.gross; tn += net;
        db.prepare(`INSERT INTO payroll_items(run_id, employee_id, base_salary, hours_json, lines_json, gross, deductions_json, net, paniers)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(runId, e.id, e.base_salary, JSON.stringify(pay.hours), JSON.stringify(pay.lines),
            pay.gross, JSON.stringify(deductions), net, pay.paniers.count);
      }
      db.prepare('UPDATE payroll_runs SET total_gross=?, total_net=? WHERE id=?').run(tg, tn, runId);
      db.exec('COMMIT');
      audit(db, req.user, 'paie générée', `Période ${period} — brut ${tg} FCFA`);
      res.status(201).json({ run_id: runId, period, total_gross: tg, total_net: tn });
    } catch (e) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/payroll/runs', auth, requireRole('admin', 'comptable', 'drh'), (req, res) => {
    res.json({ runs: db.prepare('SELECT * FROM payroll_runs ORDER BY period DESC').all() });
  });

  router.get('/payroll/runs/:id', auth, requireRole('admin', 'comptable', 'drh'), (req, res) => {
    const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Bordereau introuvable' });
    const items = db.prepare(`
      SELECT p.*, e.matricule, e.first_name, e.last_name, e.position, e.department_id,
        (SELECT name FROM departments WHERE id = e.department_id) AS department
      FROM payroll_items p JOIN employees e ON e.id = p.employee_id
      WHERE p.run_id = ? ORDER BY e.matricule
    `).all(run.id);
    res.json({
      run,
      items: items.map((i) => ({
        ...i,
        hours: JSON.parse(i.hours_json || '{}'),
        lines: JSON.parse(i.lines_json || '[]'),
        deductions: JSON.parse(i.deductions_json || '[]')
      }))
    });
  });

  router.post('/payroll/runs/:id/validate', auth, requireRole('admin', 'comptable'), (req, res) => {
    const run = db.prepare('SELECT * FROM payroll_runs WHERE id = ?').get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Bordereau introuvable' });
    db.prepare(`UPDATE payroll_runs SET status='validé', validated_at=datetime('now') WHERE id=?`).run(run.id);
    db.prepare(`UPDATE payroll_items SET status='validé' WHERE run_id=?`).run(run.id);
    audit(db, req.user, 'paie validée', `Période ${run.period}`);
    res.json({ ok: true });
  });

  router.post('/payroll/items/:id/pay', auth, requireRole('admin', 'comptable'), (req, res) => {
    const { method, reference } = req.body || {};
    const item = db.prepare('SELECT * FROM payroll_items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Ligne de paie introuvable' });
    db.prepare(`UPDATE payroll_items SET status='payé', paid_at=datetime('now'), payment_method=?, payment_ref=? WHERE id=?`)
      .run(method || 'Mobile Money', reference || '', item.id);
    audit(db, req.user, 'paiement enregistré', `Item #${item.id} — ${method || 'Mobile Money'}`);
    res.json({ ok: true });
  });

  // ============================================================ RAPPORTS
  router.get('/reports/hours', auth, requireRole('admin', 'drh', 'comptable', 'pointage'), (req, res) => {
    const period = req.query.period || dateKey(new Date()).slice(0, 7);
    const { from, to } = periodRange(period);
    const rules = parseRules();
    const holidays = db.prepare('SELECT * FROM holidays').all();
    const emps = db.prepare(`SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status='actif' ORDER BY e.matricule`).all();
    const sessions = sessionsFor(from, to);
    const rows = emps.map((e) => {
      const mine = sessions.filter((s) => s.employee_id === e.id);
      const pay = computePayroll({ sessions: mine, holidays, rules, baseSalary: e.base_salary, periodFrom: from, periodTo: to });
      return {
        matricule: e.matricule,
        name: `${e.first_name} ${e.last_name}`,
        department: e.department,
        schedule: e.schedule_name,
        hours: pay.hours,
        paniers: pay.paniers.count
      };
    });
    res.json({ period, from, to, rows });
  });

  // ============================================================ EXPORT CSV
  router.get('/export/csv', auth, requireRole('admin', 'comptable'), (req, res) => {
    const period = req.query.period || dateKey(new Date()).slice(0, 7);
    const { from, to } = periodRange(period);
    const rules = parseRules();
    const holidays = db.prepare('SELECT * FROM holidays').all();
    const emps = db.prepare(`SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.status='actif' ORDER BY e.matricule`).all();
    const sessions = sessionsFor(from, to);
    const lines = ['Matricule;Nom;Département;Heures totales;Heures nuit;Dimanche/Férié;H.sup 15%;H.sup 40%;Paniers;Brut FCFA;Net FCFA'];
    let tg = 0, tn = 0;
    for (const e of emps) {
      const mine = sessions.filter((s) => s.employee_id === e.id);
      const pay = computePayroll({ sessions: mine, holidays, rules, baseSalary: e.base_salary, periodFrom: from, periodTo: to });
      const deductions = computeDeductions(pay.gross, rules);
      const net = pay.gross - deductions.reduce((a, d) => a + d.amount, 0);
      tg += pay.gross; tn += net;
      lines.push([
        e.matricule, `${e.first_name} ${e.last_name}`, e.department || '',
        pay.hours.total, pay.hours.night, (pay.hours.rest_day + pay.hours.rest_night),
        pay.hours.overtime_15, pay.hours.overtime_40, pay.paniers.count, pay.gross, net
      ].join(';'));
    }
    lines.push('');
    lines.push(`TOTAL;;;;;;;${''};;;;${tg};${tn}`);
    res.type('text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="paie-chronorh-${period}.csv"`)
      .send('\uFEFF' + lines.join('\r\n'));
  });

  return router;
}

// ---------------------------------------------------------------- helpers
function periodRange(period) {
  const [y, m] = period.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function endOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/** Apparie les pointages in/out en sessions de travail. */
function buildSessions(db, from, to) {
  const rows = db.prepare(`
    SELECT * FROM attendance
    WHERE ts >= ? AND ts <= ?
    ORDER BY employee_id, ts, id
  `).all(from + 'T00:00:00', to + 'T23:59:59');

  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push(r);
  }
  const sessions = [];
  for (const [empId, list] of byEmp) {
    let open = null;
    for (const r of list) {
      if (r.type === 'in') {
        if (open) {
          // pointage in sans sortie : on ferme 8h plus tard (garde-fou)
          const end = new Date(new Date(open.ts).getTime() + 8 * 3600000);
          if (end <= new Date(r.ts)) {
            const local = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}:00`;
            sessions.push({ employee_id: empId, start: open.ts, end: local, start_id: open.id });
            open = r;
            continue;
          }
        }
        open = r;
      } else if (r.type === 'out' && open) {
        sessions.push({ employee_id: empId, start: open.ts, end: r.ts, start_id: open.id, end_id: r.id });
        open = null;
      }
    }
  }
  return sessions;
}

module.exports = { apiRouter, buildSessions, periodRange };

/**
 * SunuÉcole — Communication : annonces, messagerie, notifications, SMS,
 * événements et calendrier scolaire.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, requireStaff, assertOwnership, audit } from '../middleware/auth.js';
import { ok, created, paginate, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, addDays, money, normalizePhone, smsSegments } from '../lib/utils.js';
import { config } from '../config.js';

const router = Router();
router.use(authenticate, requireSchool);

const S = (req) => req.schoolId;
const CAN_PUBLISH = ['direction', 'secretaire', 'censeur', 'super_admin'];

/* ================================================================== */
/* MESSAGERIE & ANNONCES                                               */
/* ================================================================== */
router.get('/messages', (req, res) => {
  const where = ['m.school_id=?'];
  const params = [S(req)];
  const role = req.user.role;
  // Un parent/élève ne voit que les annonces et messages qui le concernent.
  if (['parent', 'eleve'].includes(role)) {
    where.push(`(m.msg_type IN ('annonce','circulaire','urgence') OR EXISTS (
        SELECT 1 FROM message_reads WHERE 1=0))`);
  }
  if (req.query.type) { where.push('m.msg_type=?'); params.push(req.query.type); }
  if (req.query.q) { where.push('(m.subject LIKE ? OR m.body LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const { rows, total } = paginate(req.query, {
    from: 'messages m', select: 'm.*', where, params, orderBy: 'm.pinned DESC, m.sent_at DESC, m.created_at DESC',
  });
  const unread = db.pluck(
    `SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL`, [req.user.id]
  );
  res.json({
    data: rows.map((m) => parseJsonFields(m, ['audience_json', 'attachments_json'])),
    meta: { total },
    unread: unread || 0,
  });
});

router.get('/messages/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'messages', id);
  const m = db.get('SELECT * FROM messages WHERE id=?', [id]);
  db.run('INSERT OR IGNORE INTO message_reads (message_id, user_id) VALUES (?,?)', [id, req.user.id]);
  db.run('UPDATE notifications SET read_at=datetime(\'now\') WHERE user_id=? AND link=? AND read_at IS NULL',
    [req.user.id, `/communication/messages/${id}`]);
  ok(res, parseJsonFields(m, ['audience_json', 'attachments_json']));
});

router.post('/messages', requireRole(...CAN_PUBLISH, 'enseignant', 'comptable'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.subject || !b.body) throw new HttpError(422, 'Objet et message requis.');
    const id = db.insert(
      `INSERT INTO messages (school_id, sender_id, sender_name, subject, body, msg_type, audience_json, priority,
          pinned, notify_sms, notify_email, sent_at, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'), ?)`,
      [S(req), req.user.id, `${req.user.first_name} ${req.user.last_name}`, b.subject, b.body,
        b.msg_type || 'annonce', JSON.stringify(b.audience || { roles: ['parent', 'eleve'] }),
        b.priority || 'normale', b.pinned ? 1 : 0, b.notify_sms ? 1 : 0, b.notify_email ? 1 : 0, b.expires_at || null]
    );

    // Destinataires → notifications in-app (+ SMS si demandé)
    const audience = b.audience || { roles: ['parent', 'eleve'] };
    const users = audience.userIds?.length
      ? db.all(`SELECT id, role FROM users WHERE id IN (${audience.userIds.map(() => '?').join(',')})`, audience.userIds.map(Number))
      : db.all(
          `SELECT id, role FROM users WHERE school_id=? AND is_active=1 AND role IN (${(audience.roles || ['parent']).map(() => '?').join(',')})`,
          [S(req), ...(audience.roles || ['parent'])]
        );
    db.tx(() => {
      for (const u of users) {
        db.run(
          `INSERT INTO notifications (school_id, user_id, type, title, body, link, priority)
           VALUES (?,?,?,?,?,?,?)`,
          [S(req), u.id, b.priority === 'urgente' ? 'alerte' : 'message', b.subject,
            String(b.body).slice(0, 140), `/communication/messages/${id}`, b.priority === 'urgente' ? 'haute' : 'normale']
        );
      }
    });
    if (b.notify_sms && (audience.roles || []).includes('parent')) {
      const phones = db.all(
        `SELECT DISTINCT g.phone FROM guardians g JOIN users u ON u.id=g.user_id
          WHERE g.school_id=? AND g.phone IS NOT NULL AND g.sms_optin=1 AND u.is_active=1`, [S(req)]
      );
      for (const p of phones.slice(0, 500)) {
        db.run(
          `INSERT INTO sms_queue (school_id, to_number, body, template, status, provider, created_by)
           VALUES (?,?,?,?, 'en_attente', ?, ?)`,
          [S(req), p.phone, `${b.subject} : ${String(b.body).slice(0, 120)} — ${req.school.name}`, 'libre', config.integrations.sms.provider, req.user.id]
        );
      }
    }
    audit(req, 'create', 'message', id, `Annonce « ${b.subject} » publiée à ${users.length} destinataire(s)`);
    created(res, { id, recipients: users.length });
  } catch (err) { next(err); }
});

router.delete('/messages/:id(\\d+)', requireRole(...CAN_PUBLISH), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'messages', id);
    db.run('DELETE FROM messages WHERE id=?', [id]);
    audit(req, 'delete', 'message', id, 'Message supprimé');
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* NOTIFICATIONS                                                       */
/* ================================================================== */
router.get('/notifications', (req, res) => {
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const rows = db.all(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY read_at IS NOT NULL, created_at DESC LIMIT ?',
    [req.user.id, limit]
  );
  const unread = db.pluck('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL', [req.user.id]) || 0;
  ok(res, { notifications: rows, unread });
});

router.post('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  if (req.body.all) {
    db.run('UPDATE notifications SET read_at=datetime(\'now\') WHERE user_id=? AND read_at IS NULL', [req.user.id]);
  } else if (ids.length) {
    db.tx(() => {
      for (const id of ids) db.run('UPDATE notifications SET read_at=datetime(\'now\') WHERE id=? AND user_id=?', [id, req.user.id]);
    });
  }
  ok(res, { unread: db.pluck('SELECT COUNT(*) FROM notifications WHERE user_id=? AND read_at IS NULL', [req.user.id]) || 0 });
});

router.delete('/notifications/:id(\\d+)', (req, res) => {
  db.run('DELETE FROM notifications WHERE id=? AND user_id=?', [Number(req.params.id), req.user.id]);
  ok(res, { id: Number(req.params.id) });
});

/* ================================================================== */
/* SMS                                                                 */
/* ================================================================== */
router.get('/sms', requireStaff, (req, res) => {
  const where = ['sq.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('sq.status=?'); params.push(req.query.status); }
  if (req.query.template) { where.push('sq.template=?'); params.push(req.query.template); }
  const { rows, total } = paginate(req.query, {
    from: 'sms_queue sq', select: 'sq.*', where, params, orderBy: 'sq.created_at DESC',
  });
  const stats = db.get(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN status='envoye' THEN 1 ELSE 0 END) envoyes,
            SUM(CASE WHEN status='en_attente' THEN 1 ELSE 0 END) en_attente,
            SUM(CASE WHEN status='echoue' THEN 1 ELSE 0 END) echoues,
            SUM(CASE WHEN status='envoye' THEN LENGTH(body)/160+1 ELSE 0 END) segments
       FROM sms_queue WHERE school_id=?`, [S(req)]
  );
  const templates = db.all('SELECT * FROM sms_templates WHERE school_id=? ORDER BY code', [S(req)]);
  res.json({
    data: rows, meta: { total },
    stats: { ...stats, cout_estime: money((stats.segments || 0) * config.integrations.sms.pricePerSegment) },
    templates,
    config: { mode: config.integrations.sms.mode, provider: config.integrations.sms.provider, prix_segment: config.integrations.sms.pricePerSegment },
  });
});

router.post('/sms', requireRole(...CAN_PUBLISH, 'enseignant', 'comptable'), (req, res, next) => {
  try {
    const b = req.body || {};
    const body = String(b.body || '').trim();
    if (!body) throw new HttpError(422, 'Texte du SMS requis.');
    let targets = [];
    if (Array.isArray(b.to) && b.to.length) targets = b.to.map((t) => ({ phone: t.phone || t, name: t.name || null, student_id: t.student_id || null }));
    else if (b.audience === 'impayes') {
      targets = db.all(
        `SELECT DISTINCT g.phone, g.first_name||' '||g.last_name AS name, st.id AS student_id
           FROM invoices i JOIN students st ON st.id=i.student_id
           JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
           JOIN guardians g ON g.id=sg.guardian_id
          WHERE i.school_id=? AND i.status IN ('impayee','partielle','en_retard') AND g.phone IS NOT NULL AND g.sms_optin=1`, [S(req)]
      );
    } else if (b.audience === 'classe' && b.class_id) {
      targets = db.all(
        `SELECT DISTINCT g.phone, g.first_name||' '||g.last_name AS name, st.id AS student_id
           FROM students st JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
           JOIN guardians g ON g.id=sg.guardian_id
          WHERE st.class_id=? AND g.phone IS NOT NULL AND g.sms_optin=1`, [Number(b.class_id)]
      );
    } else if (b.audience === 'tous_parents') {
      targets = db.all(
        `SELECT DISTINCT g.phone, g.first_name||' '||g.last_name AS name FROM guardians g
          WHERE g.school_id=? AND g.phone IS NOT NULL AND g.sms_optin=1`, [S(req)]
      );
    }
    if (!targets.length) throw new HttpError(422, 'Aucun destinataire trouvé pour cette audience.');

    const segments = smsSegments(body);
    const cost = money(targets.length * segments * config.integrations.sms.pricePerSegment);
    let queued = 0;
    db.tx(() => {
      for (const t of targets) {
        const phone = normalizePhone(t.phone, '221');
        if (!phone) continue;
        db.run(
          `INSERT INTO sms_queue (school_id, to_number, body, recipient_name, student_id, template, status, provider, created_by, scheduled_at)
           VALUES (?,?,?,?,?,?,?, ?, ?, ?)`,
          [S(req), phone, body, t.name || null, t.student_id || null, b.template || 'libre',
            b.schedule ? 'programme' : 'en_attente', config.integrations.sms.provider, req.user.id, b.schedule || null]
        );
        queued += 1;
      }
    });
    audit(req, 'create', 'sms_campaign', null, `Campagne SMS : ${queued} message(s), ~${cost} FCFA`);
    created(res, { queued, segments, cost_estimate: cost });
  } catch (err) { next(err); }
});

/** Simule l'envoi de la file (en production : worker branché sur l'agrégateur). */
router.post('/sms/dispatch', requireRole(...CAN_PUBLISH), (req, res, next) => {
  try {
    const pending = db.all(
      `SELECT * FROM sms_queue WHERE school_id=? AND status IN ('en_attente','programme')
        AND (scheduled_at IS NULL OR scheduled_at<=datetime('now')) LIMIT 500`, [S(req)]
    );
    let sent = 0;
    let failed = 0;
    db.tx(() => {
      for (const s of pending) {
        // En mode simulation : 96 % de réussite, échecs réalistes (numéro injoignable)
        const success = config.integrations.sms.mode === 'live' ? true : Math.random() < 0.96;
        if (success) {
          db.run("UPDATE sms_queue SET status='envoye', sent_at=datetime('now'), provider_ref=? WHERE id=?",
            [`SMS${Date.now()}${s.id}`, s.id]);
          sent += 1;
        } else {
          db.run("UPDATE sms_queue SET status='echoue', error=? WHERE id=?", ['Numéro injoignable / solde insuffisant', s.id]);
          failed += 1;
        }
      }
    });
    ok(res, { sent, failed, remaining: db.pluck("SELECT COUNT(*) FROM sms_queue WHERE school_id=? AND status='en_attente'", [S(req)]) });
  } catch (err) { next(err); }
});

router.post('/sms/templates', requireRole(...CAN_PUBLISH), (req, res, next) => {
  try {
    const { code, name, body } = req.body || {};
    if (!code || !body) throw new HttpError(422, 'Code et texte requis.');
    db.run(
      `INSERT INTO sms_templates (school_id, code, name, body) VALUES (?,?,?,?)
       ON CONFLICT(school_id, code) DO UPDATE SET name=excluded.name, body=excluded.body`,
      [S(req), code, name || code, body]
    );
    ok(res, { code });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* ÉVÉNEMENTS & CALENDRIER                                             */
/* ================================================================== */
router.get('/events', (req, res) => {
  const { from, to, type } = req.query;
  const where = ['e.school_id=?'];
  const params = [S(req)];
  if (from) { where.push('e.event_date>=?'); params.push(from); }
  if (to) { where.push('COALESCE(e.end_date, e.event_date)<=?'); params.push(to); }
  if (type) { where.push('e.event_type=?'); params.push(type); }
  const events = db.all(
    `SELECT e.* FROM events e WHERE ${where.join(' AND ')} ORDER BY e.event_date`, params
  ).map((e) => parseJsonFields(e, ['audience_json']));
  const holidays = db.all('SELECT * FROM holidays WHERE school_id=? ORDER BY date', [S(req)]);
  const terms = db.all('SELECT * FROM terms WHERE school_id=? ORDER BY seq', [S(req)]);
  const year = db.get('SELECT * FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
  ok(res, { events, holidays, terms, year });
});

router.post('/events', requireRole(...CAN_PUBLISH, 'enseignant'), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.event_date) throw new HttpError(422, 'Titre et date requis.');
    if (b.id) {
      assertOwnership(req, 'events', Number(b.id));
      db.run(
        `UPDATE events SET title=?, event_type=?, event_date=?, end_date=?, start_time=?, end_time=?, location=?, description=?, color=?, is_all_day=? WHERE id=?`,
        [b.title, b.event_type || 'autre', b.event_date, b.end_date || null, b.start_time || null, b.end_time || null,
          b.location || null, b.description || null, b.color || null, b.is_all_day ? 1 : 0, Number(b.id)]
      );
      return ok(res, { id: Number(b.id) });
    }
    const id = db.insert(
      `INSERT INTO events (school_id, title, event_type, event_date, end_date, start_time, end_time, location, description, color, audience_json, is_all_day, requires_registration)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), b.title, b.event_type || 'autre', b.event_date, b.end_date || null, b.start_time || null,
        b.end_time || null, b.location || null, b.description || null, b.color || null,
        JSON.stringify(b.audience || {}), b.is_all_day ? 1 : 0, b.requires_registration ? 1 : 0]
    );
    audit(req, 'create', 'event', id, `Événement « ${b.title} » ajouté au calendrier`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.delete('/events/:id(\\d+)', requireRole(...CAN_PUBLISH), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'events', id);
    db.run('DELETE FROM events WHERE id=?', [id]);
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* SYNCHRONISATION HORS-LIGNE                                          */
/* ================================================================== */

/**
 * Accepte un lot d'opérations enregistrées hors-ligne (mode dégradé).
 * Idempotent grâce au client_id : un renvoi ne crée pas de doublon.
 */
router.post('/sync', (req, res, next) => {
  try {
    const ops = Array.isArray(req.body.operations) ? req.body.operations : [];
    if (!ops.length) throw new HttpError(422, 'operations[] requis.');
    let applied = 0;
    let failed = 0;
    const errors = [];
    db.tx(() => {
      for (const op of ops) {
        const dup = op.client_id
          ? db.get("SELECT id FROM sync_queue WHERE client_id=? AND status='applied'", [op.client_id])
          : null;
        if (dup) { applied += 1; continue; }
        try {
          applyOperation(req, op);
          db.run(
            `INSERT INTO sync_queue (school_id, user_id, client_id, entity, action, payload_json, status, applied_at, device, captured_at)
             VALUES (?,?,?,?,?,?, 'applied', datetime('now'), ?, ?)`,
            [S(req), req.user.id, op.client_id || `op_${Date.now()}_${Math.random()}`, op.entity, op.action,
              JSON.stringify(op.payload || {}), req.body.device || null, op.captured_at || null]
          );
          applied += 1;
        } catch (err) {
          failed += 1;
          errors.push({ client_id: op.client_id, message: err.message });
          db.run(
            `INSERT INTO sync_queue (school_id, user_id, client_id, entity, action, payload_json, status, error, device)
             VALUES (?,?,?,?,?,?, 'failed', ?, ?)`,
            [S(req), req.user.id, op.client_id || null, op.entity, op.action, JSON.stringify(op.payload || {}), err.message, req.body.device || null]
          );
        }
      }
    });
    ok(res, { applied, failed, errors });
  } catch (err) { next(err); }
});

function applyOperation(req, op) {
  const p = op.payload || {};
  if (op.entity === 'attendance' && op.action === 'create') {
    const classId = Number(p.class_id);
    assertOwnership(req, 'classes', classId);
    const d = String(p.date || today()).slice(0, 10);
    const slot = Number(p.slot || 1);
    let sessionId = db.pluck(
      'SELECT id FROM attendance_sessions WHERE class_id=? AND session_date=? AND slot_index=?', [classId, d, slot]
    );
    if (!sessionId) {
      sessionId = db.insert(
        `INSERT INTO attendance_sessions (school_id, class_id, teacher_id, session_date, slot_index, status, period_label, taken_at, taken_offline)
         VALUES (?,?,?,?,?, 'validated', ?, ?, 1)`,
        [S(req), classId, p.teacher_id || null, d, slot, p.period_label || 'Appel', new Date().toISOString()]
      );
    }
    for (const r of p.records || []) {
      db.run(
        `INSERT INTO attendance_records (school_id, session_id, student_id, status, minutes_late, note)
         VALUES (?,?,?,?,?,?) ON CONFLICT(session_id, student_id) DO UPDATE SET status=excluded.status,
           minutes_late=excluded.minutes_late, note=excluded.note`,
        [S(req), sessionId, Number(r.student_id), r.status || 'present', Number(r.minutes_late) || 0, r.note || null]
      );
    }
    return;
  }
  if (op.entity === 'grade' && op.action === 'upsert') {
    db.run(
      `INSERT INTO grades (school_id, assessment_id, student_id, score, is_absent, comment)
       VALUES (?,?,?,?,?,?) ON CONFLICT(assessment_id, student_id) DO UPDATE SET score=excluded.score,
         is_absent=excluded.is_absent, comment=excluded.comment, updated_at=datetime('now')`,
      [S(req), Number(p.assessment_id), Number(p.student_id), p.score ?? null, p.is_absent ? 1 : 0, p.comment || null]
    );
    return;
  }
  if (op.entity === 'lesson' && op.action === 'create') {
    db.insert(
      `INSERT INTO lesson_logs (school_id, class_id, subject_id, teacher_id, lesson_date, title, content, homework)
       VALUES (?,?,?,?,?,?,?,?)`,
      [S(req), Number(p.class_id), Number(p.subject_id), p.teacher_id || null, p.lesson_date || today(),
        p.title || null, p.content || null, p.homework || null]
    );
    return;
  }
  throw new HttpError(422, `Opération non supportée : ${op.entity}.${op.action}`);
}

router.get('/sync/status', (req, res) => {
  const rows = db.all(
    `SELECT client_id, entity, action, status, error, captured_at, applied_at, created_at
       FROM sync_queue WHERE school_id=? ORDER BY created_at DESC LIMIT 50`, [S(req)]
  );
  const stats = db.get(
    `SELECT COUNT(*) total, SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) applied,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending
       FROM sync_queue WHERE school_id=?`, [S(req)]
  );
  ok(res, { queue: rows, stats });
});

export default router;

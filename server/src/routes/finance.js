/**
 * SunuÉcole — Finances : frais, factures, encaissements (Mobile Money, espèces,
 * banque), relances, dépenses, caisse, rapports et paie du personnel.
 *
 * Conçu pour l'Afrique francophone : montants entiers en FCFA (XOF), paiements
 * partiels fréquents, Orange Money / Wave / MTN MoMo / Moov Money / Free Money,
 * relances SMS, et fonctionnement possible sans connexion bancaire.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { authenticate, requireSchool, requireRole, requireStaff, assertOwnership, assertFamilyAccess, scopedStudentIds, audit } from '../middleware/auth.js';
import { ok, created, paginate, parseJsonFields } from '../lib/respond.js';
import { HttpError, today, addDays, monthKey, money, round, normalizePhone, smsSegments } from '../lib/utils.js';
import { config } from '../config.js';

const router = Router();
router.use(authenticate, requireSchool);

const S = (req) => req.schoolId;
const CAN_BILL = ['direction', 'comptable', 'secretaire', 'super_admin'];

const PROVIDERS = {
  orange_money: { label: 'Orange Money', color: '#ff7900', ussd: '#144#', prefix: '77,78,76,70,75' },
  wave: { label: 'Wave', color: '#1dcff1', ussd: 'Application Wave', prefix: 'tous opérateurs' },
  mtn_momo: { label: 'MTN MoMo', color: '#ffcc00', ussd: '*126#', prefix: '96,97' },
  moov_money: { label: 'Moov Money', color: '#005baa', ussd: '*155#', prefix: '90,91' },
  free_money: { label: 'Free Money', color: '#e60028', ussd: '#555#', prefix: '76,77,78' },
  especes: { label: 'Espèces', color: '#15803d' },
  virement: { label: 'Virement bancaire', color: '#1d4ed8' },
  cheque: { label: 'Chèque', color: '#7c3aed' },
  carte: { label: 'Carte bancaire', color: '#0f172a' },
};

/* ================================================================== */
/* MOYENS DE PAIEMENT (public pour tout compte authentifié)            */
/* ================================================================== */
/**
 * Liste des opérateurs Mobile Money et modes de règlement acceptés.
 * Accessible aux familles : le portail parent doit pouvoir proposer un
 * paiement sans exposer la synthèse financière de l'établissement.
 */
router.get('/providers', (req, res) => {
  ok(res, {
    providers: Object.entries(PROVIDERS).map(([key, v]) => ({
      key, label: v.label, color: v.color, ussd: v.ussd || null, prefix: v.prefix || null,
      mobile: !['especes', 'virement', 'cheque', 'carte'].includes(key),
    })),
    price_sms: config.integrations.sms.pricePerSegment,
    mode: config.integrations.mobileMoney.mode,
  });
});

/* ================================================================== */
/* SYNTHÈSE FINANCIÈRE                                                 */
/* ================================================================== */
router.get('/summary', requireStaff, (req, res) => {
  const s = S(req);
  const d = today();
  const totals = db.get(
    `SELECT COUNT(*) factures,
            COALESCE(SUM(amount-discount),0) attendu,
            COALESCE(SUM(amount_paid),0) encaisse,
            COALESCE(SUM(CASE WHEN status IN ('impayee','partielle','en_retard') THEN amount-discount-amount_paid ELSE 0 END),0) solde,
            SUM(CASE WHEN status='payee' THEN 1 ELSE 0 END) payees,
            SUM(CASE WHEN status IN ('impayee','partielle','en_retard') THEN 1 ELSE 0 END) impayees,
            SUM(CASE WHEN status='en_retard' THEN 1 ELSE 0 END) retard
       FROM invoices WHERE school_id=?`, [s]
  );
  const mois = db.get(
    `SELECT COALESCE(SUM(amount),0) encaisse, COUNT(*) n FROM payments WHERE school_id=? AND substr(paid_at,1,7)=?`,
    [s, monthKey(d)]
  );
  const jour = db.get(
    `SELECT COALESCE(SUM(amount),0) encaisse, COUNT(*) n FROM payments WHERE school_id=? AND substr(paid_at,1,10)=?`,
    [s, d]
  );
  const depenses = db.get(
    `SELECT COALESCE(SUM(CASE WHEN substr(expense_date,1,7)=? THEN amount ELSE 0 END),0) mois,
            COALESCE(SUM(CASE WHEN substr(expense_date,1,10)=? THEN amount ELSE 0 END),0) jour,
            COALESCE(SUM(amount),0) total
       FROM expenses WHERE school_id=?`, [monthKey(d), d, s]
  );
  const parMethode = db.all(
    `SELECT method AS methode, COALESCE(SUM(amount),0) total, COUNT(*) n FROM payments
      WHERE school_id=? AND substr(paid_at,1,7)=? GROUP BY method ORDER BY total DESC`, [s, monthKey(d)]
  );
  const parCategorie = db.all(
    `SELECT ft.category AS categorie, COALESCE(SUM(i.amount-i.discount),0) attendu,
            COALESCE(SUM(i.amount_paid),0) encaisse, COUNT(*) n
       FROM invoices i LEFT JOIN fee_types ft ON ft.id=i.fee_type_id
      WHERE i.school_id=? GROUP BY ft.category ORDER BY attendu DESC`, [s]
  );
  const topImpayes = db.all(
    `SELECT st.id AS student_id, st.first_name, st.last_name, c.name AS classe,
            COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) AS solde,
            MIN(i.due_date) AS plus_ancienne, g.phone AS parent_tel
       FROM invoices i JOIN students st ON st.id=i.student_id LEFT JOIN classes c ON c.id=st.class_id
       LEFT JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
       LEFT JOIN guardians g ON g.id=sg.guardian_id
      WHERE i.school_id=? AND i.status IN ('impayee','partielle','en_retard')
      GROUP BY st.id ORDER BY solde DESC LIMIT 10`, [s]
  );
  const anciennete = {
    moins_30: db.pluck(`SELECT COALESCE(SUM(amount-discount-amount_paid),0) FROM invoices WHERE school_id=? AND status IN ('impayee','partielle','en_retard') AND due_date>=?`, [s, addDays(d, -30)]) || 0,
    entre_30_60: db.pluck(`SELECT COALESCE(SUM(amount-discount-amount_paid),0) FROM invoices WHERE school_id=? AND status IN ('impayee','partielle','en_retard') AND due_date<? AND due_date>=?`, [s, addDays(d, -30), addDays(d, -60)]) || 0,
    entre_60_90: db.pluck(`SELECT COALESCE(SUM(amount-discount-amount_paid),0) FROM invoices WHERE school_id=? AND status IN ('impayee','partielle','en_retard') AND due_date<? AND due_date>=?`, [s, addDays(d, -60), addDays(d, -90)]) || 0,
    plus_90: db.pluck(`SELECT COALESCE(SUM(amount-discount-amount_paid),0) FROM invoices WHERE school_id=? AND status IN ('impayee','partielle','en_retard') AND due_date<?`, [s, addDays(d, -90)]) || 0,
  };
  ok(res, {
    totals: {
      ...totals,
      attendu: money(totals.attendu), encaisse: money(totals.encaisse), solde: money(totals.solde),
      taux_recouvrement: totals.attendu ? round((totals.encaisse / totals.attendu) * 100, 1) : 0,
    },
    mois_courant: { encaisse: money(mois.encaisse), paiements: mois.n || 0, depenses: money(depenses.mois), resultat: money(mois.encaisse - depenses.mois) },
    aujourd_hui: { encaisse: money(jour.encaisse), paiements: jour.n || 0, depenses: money(depenses.jour) },
    depenses_total: money(depenses.total),
    par_methode: parMethode.map((m) => ({ ...m, total: money(m.total), label: PROVIDERS[m.methode]?.label || m.methode, color: PROVIDERS[m.methode]?.color })),
    par_categorie: parCategorie.map((c) => ({ ...c, attendu: money(c.attendu), encaisse: money(c.encaisse), taux: c.attendu ? round((c.encaisse / c.attendu) * 100, 1) : 0 })),
    top_impayes: topImpayes.map((t) => ({ ...t, solde: money(t.solde) })),
    anciennete: Object.fromEntries(Object.entries(anciennete).map(([k, v]) => [k, money(v)])),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })),
  });
});

/* ================================================================== */
/* FRAIS (catalogue paramétrable par école)                            */
/* ================================================================== */
router.get('/fee-types', requireStaff, (req, res) => {
  ok(res, db.all('SELECT * FROM fee_types WHERE school_id=? ORDER BY is_required DESC, category, name', [S(req)]));
});

router.post('/fee-types', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) throw new HttpError(422, 'Libellé du frais requis.');
    const id = db.insert(
      `INSERT INTO fee_types (school_id, name, code, category, amount, installments, is_recurring, is_required, applies_to_json, late_fee_pct, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), b.name, b.code || null, b.category || 'autre', money(b.amount) || 0,
        Number(b.installments) || 1, b.is_recurring ? 1 : 0, b.is_required ? 1 : 0,
        JSON.stringify(b.applies_to || []), Number(b.late_fee_pct) || 0, b.is_active === false ? 0 : 1]
    );
    audit(req, 'create', 'fee_type', id, `Frais « ${b.name} » créé`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/fee-types/:id(\\d+)', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'fee_types', id);
    const allowed = ['name', 'code', 'category', 'amount', 'installments', 'is_recurring', 'is_required', 'late_fee_pct', 'is_active'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(f === 'amount' ? money(req.body[f]) : req.body[f]); }
    if (req.body.applies_to) { sets.push('applies_to_json=?'); params.push(JSON.stringify(req.body.applies_to)); }
    if (sets.length) { params.push(id); db.run(`UPDATE fee_types SET ${sets.join(', ')} WHERE id=?`, params); }
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/fee-types/:id(\\d+)', requireRole('direction', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'fee_types', id);
    const used = db.pluck('SELECT COUNT(*) FROM invoices WHERE fee_type_id=?', [id]);
    if (used) throw new HttpError(409, `Ce frais est utilisé par ${used} facture(s) : désactivez-le plutôt que de le supprimer.`);
    db.run('DELETE FROM fee_types WHERE id=?', [id]);
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* FACTURES                                                            */
/* ================================================================== */
const INVOICE_SELECT = `i.*, st.first_name, st.last_name, st.matricule, c.name AS classe,
  ft.name AS frais_nom, ft.category,
  g.phone AS parent_tel,
  (i.amount - i.discount - i.amount_paid) AS reste`;

router.get('/invoices', (req, res) => {
  const { q, status, class_id: classId, student_id: studentId, category, from, to, retard } = req.query;
  const where = ['i.school_id=?'];
  const params = [S(req)];
  if (q) {
    where.push('(i.invoice_number LIKE ? OR st.first_name LIKE ? OR st.last_name LIKE ? OR st.matricule LIKE ?)');
    const t = likeParamSafe(q);
    params.push(t, t, t, t);
  }
  if (status) { where.push('i.status=?'); params.push(status); }
  if (classId) { where.push('st.class_id=?'); params.push(Number(classId)); }
  // Les familles ne voient que leurs propres factures.
  const scopeInv = scopedStudentIds(req, studentId);
  if (scopeInv) {
    where.push(scopeInv.length ? `i.student_id IN (${scopeInv.map(() => '?').join(',')})` : 'i.student_id=-1');
    params.push(...scopeInv);
  }
  if (category) { where.push('ft.category=?'); params.push(category); }
  if (from) { where.push('i.due_date>=?'); params.push(from); }
  if (to) { where.push('i.due_date<=?'); params.push(to); }
  if (retard) { where.push("i.status IN ('impayee','partielle','en_retard') AND i.due_date<?"); params.push(addDays(today(), -Number(retard))); }

  const { rows, total } = paginate(req.query, {
    from: `invoices i JOIN students st ON st.id=i.student_id LEFT JOIN classes c ON c.id=st.class_id
           LEFT JOIN fee_types ft ON ft.id=i.fee_type_id
           LEFT JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
           LEFT JOIN guardians g ON g.id=sg.guardian_id`,
    select: INVOICE_SELECT, where, params,
    orderBy: { ancien: 'i.due_date', montant: 'reste DESC', recent: 'i.created_at DESC' }[req.query.sort] || 'i.due_date DESC',
  });
  const aggregate = db.get(
    `SELECT COALESCE(SUM(i.amount-i.discount),0) attendu, COALESCE(SUM(i.amount_paid),0) encaisse,
            COALESCE(SUM(CASE WHEN i.status IN ('impayee','partielle','en_retard') THEN i.amount-i.discount-i.amount_paid ELSE 0 END),0) solde
       FROM invoices i JOIN students st ON st.id=i.student_id
       LEFT JOIN fee_types ft ON ft.id=i.fee_type_id WHERE i.school_id=?${where.slice(1).map((w) => ` AND ${w}`).join('')}`,
    params
  );
  res.json({
    data: rows.map((r) => ({ ...r, reste: money(r.reste), amount: money(r.amount), discount: money(r.discount), amount_paid: money(r.amount_paid) })),
    meta: { total },
    aggregate: { attendu: money(aggregate.attendu), encaisse: money(aggregate.encaisse), solde: money(aggregate.solde) },
  });
});

function likeParamSafe(q) {
  return likeParam(q);
}

router.get('/invoices/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'invoices', id);
  assertFamilyAccess(req, db.pluck('SELECT student_id FROM invoices WHERE id=?', [id]));
  const inv = db.get(
    `SELECT ${INVOICE_SELECT}, st.birth_date, st.gender, l.name AS niveau,
            (SELECT g.first_name||' '||g.last_name FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=st.id AND sg.is_payer=1 LIMIT 1) AS payeur
       FROM invoices i JOIN students st ON st.id=i.student_id LEFT JOIN classes c ON c.id=st.class_id
       LEFT JOIN levels l ON l.id=c.level_id LEFT JOIN fee_types ft ON ft.id=i.fee_type_id
       LEFT JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
       LEFT JOIN guardians g ON g.id=sg.guardian_id WHERE i.id=?`, [id]
  );
  const payments = db.all('SELECT * FROM payments WHERE invoice_id=? ORDER BY paid_at DESC', [id]);
  ok(res, {
    invoice: { ...inv, reste: money(inv.amount - inv.discount - inv.amount_paid) },
    payments,
    school: {
      name: req.school.name, address: req.school.address, city: req.school.city, phone: req.school.phone,
      email: req.school.email, ninea: req.school.ninea, currency: req.school.currency, headName: req.school.head_name,
    },
  });
});

router.post('/invoices', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.student_id || !b.amount) throw new HttpError(422, 'Élève et montant requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    const seq = (db.pluck('SELECT COUNT(*) FROM invoices WHERE school_id=?', [S(req)]) || 0) + 1;
    const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
    const id = db.insert(
      `INSERT INTO invoices (school_id, student_id, year_id, fee_type_id, invoice_number, label, amount, discount, due_date, installment_no, installment_of, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), Number(b.student_id), year, b.fee_type_id || null,
        b.invoice_number || `${prefix}-FAC-${String(seq).padStart(5, '0')}`,
        b.label || 'Frais scolaire', money(b.amount), money(b.discount) || 0,
        b.due_date || addDays(today(), 30), Number(b.installment_no) || 1, Number(b.installment_of) || 1, b.note || null]
    );
    audit(req, 'create', 'invoice', id, `Facture de ${money(b.amount)} FCFA créée`);
    created(res, { id });
  } catch (err) { next(err); }
});

/**
 * Facturation en masse : le cas d'usage n°1 d'une rentrée scolaire.
 * body: { fee_type_id, scope:'all'|'class'|'level', class_id?, level_id?, due_date?, amount_override? }
 */
router.post('/invoices/generate', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const b = req.body || {};
    const fee = db.get('SELECT * FROM fee_types WHERE id=? AND school_id=?', [Number(b.fee_type_id), S(req)]);
    if (!fee) throw new HttpError(404, 'Type de frais introuvable.');
    const where = ['st.school_id=?', "st.status NOT IN ('radie','abandon','transfere')"];
    const params = [S(req)];
    if (b.scope === 'class' && b.class_id) { where.push('st.class_id=?'); params.push(Number(b.class_id)); }
    if (b.scope === 'level' && b.level_id) { where.push('c.level_id=?'); params.push(Number(b.level_id)); }
    if (b.only_unbilled) {
      where.push('NOT EXISTS (SELECT 1 FROM invoices i WHERE i.student_id=st.id AND i.fee_type_id=? AND i.year_id=(SELECT id FROM school_years WHERE school_id=st.school_id AND is_current=1))');
      params.push(fee.id);
    }
    const targets = db.all(
      `SELECT st.id, st.discount_pct FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE ${where.join(' AND ')}`, params
    );
    const year = db.pluck('SELECT id FROM school_years WHERE school_id=? AND is_current=1', [S(req)]);
    const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
    let seq = (db.pluck('SELECT COUNT(*) FROM invoices WHERE school_id=?', [S(req)]) || 0);
    const installments = Math.max(1, Number(b.installments) || fee.installments || 1);
    const dueBase = b.due_date || addDays(today(), 30);
    const createdIds = [];

    db.tx(() => {
      for (const t of targets) {
        const amount = Number(b.amount_override) || fee.amount || 0;
        const discount = Math.round((amount * (Number(t.discount_pct) || 0)) / 100);
        for (let k = 0; k < installments; k += 1) {
          seq += 1;
          const part = k === installments - 1
            ? amount - discount - Math.floor((amount - discount) / installments) * (installments - 1)
            : Math.floor((amount - discount) / installments);
          const id = db.insert(
            `INSERT INTO invoices (school_id, student_id, year_id, fee_type_id, invoice_number, label, amount, discount,
                due_date, installment_no, installment_of, issued_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?, date('now'))`,
            [S(req), t.id, year, fee.id, `${prefix}-FAC-${String(seq).padStart(5, '0')}`,
              installments > 1 ? `${fee.name} — échéance ${k + 1}/${installments}` : fee.name,
              part, k === 0 ? discount : 0,
              installments > 1 ? addDays(dueBase, k * 30) : dueBase, k + 1, installments]
          );
          createdIds.push(id);
        }
      }
    });
    audit(req, 'create', 'invoice', null, `Facturation en masse « ${fee.name} » : ${createdIds.length} factures pour ${targets.length} élèves`);
    created(res, { created: createdIds.length, students: targets.length, fee: fee.name });
  } catch (err) { next(err); }
});

router.patch('/invoices/:id(\\d+)', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'invoices', id);
    const allowed = ['amount', 'discount', 'due_date', 'status', 'label', 'note', 'installment_no'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(['amount', 'discount'].includes(f) ? money(req.body[f]) : req.body[f]); }
    if (sets.length) { params.push(id); db.run(`UPDATE invoices SET ${sets.join(', ')} WHERE id=?`, params); }
    resyncInvoice(id);
    audit(req, 'update', 'invoice', id, 'Facture modifiée');
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/invoices/:id(\\d+)', requireRole('direction', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'invoices', id);
    const paid = db.pluck('SELECT COUNT(*) FROM payments WHERE invoice_id=? AND is_reversed=0', [id]);
    if (paid) throw new HttpError(409, 'Cette facture a déjà des paiements encaissés. Annulez-la plutôt que de la supprimer.');
    db.run('DELETE FROM invoices WHERE id=?', [id]);
    audit(req, 'delete', 'invoice', id, 'Facture supprimée');
    ok(res, { id });
  } catch (err) { next(err); }
});

/** Recalcule le statut d'une facture à partir des paiements non annulés. */
function resyncInvoice(invoiceId) {
  const inv = db.get('SELECT * FROM invoices WHERE id=?', [invoiceId]);
  if (!inv) return;
  const paid = db.pluck('SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=? AND is_reversed=0', [invoiceId]) || 0;
  const net = inv.amount - inv.discount;
  const due = inv.due_date || today();
  let status = 'impayee';
  if (inv.status === 'annulee' || inv.status === 'avoir') status = inv.status;
  else if (paid >= net && net > 0) status = 'payee';
  else if (paid > 0) status = 'partielle';
  else if (due < today()) status = 'en_retard';
  db.run('UPDATE invoices SET amount_paid=?, status=? WHERE id=?', [money(paid), status, invoiceId]);
}

/* ================================================================== */
/* PAIEMENTS                                                           */
/* ================================================================== */
router.get('/payments', (req, res) => {
  const { q, method, from, to, student_id: studentId } = req.query;
  const where = ['p.school_id=?', 'p.is_reversed=0'];
  const params = [S(req)];
  if (q) {
    where.push('(p.receipt_number LIKE ? OR st.first_name LIKE ? OR st.last_name LIKE ? OR p.provider_ref LIKE ?)');
    const t = likeParamSafe(q);
    params.push(t, t, t, t);
  }
  if (method) { where.push('p.method=?'); params.push(method); }
  if (from) { where.push('substr(p.paid_at,1,10)>=?'); params.push(from); }
  if (to) { where.push('substr(p.paid_at,1,10)<=?'); params.push(to); }
  const scopePay = scopedStudentIds(req, studentId);
  if (scopePay) {
    where.push(scopePay.length ? `p.student_id IN (${scopePay.map(() => '?').join(',')})` : 'p.student_id=-1');
    params.push(...scopePay);
  }

  const { rows, total } = paginate(req.query, {
    from: 'payments p JOIN students st ON st.id=p.student_id LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN users u ON u.id=p.received_by LEFT JOIN invoices i ON i.id=p.invoice_id',
    select: `p.*, st.first_name, st.last_name, st.matricule, c.name AS classe,
             u.first_name||' '||u.last_name AS caissier, i.invoice_number`,
    where, params, orderBy: 'p.paid_at DESC', countFrom: 'payments p JOIN students st ON st.id=p.student_id LEFT JOIN invoices i ON i.id=p.invoice_id',
  });
  const totalAmount = db.pluck(
    `SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN students st ON st.id=p.student_id WHERE ${where.join(' AND ')}`, params
  );
  res.json({
    data: rows.map((r) => ({ ...r, amount: money(r.amount), methodLabel: PROVIDERS[r.method]?.label || r.method })),
    meta: { total },
    aggregate: { total: money(totalAmount) },
  });
});

/** Encaissement au guichet ou confirmation d'un paiement Mobile Money. */
router.post('/payments', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = money(b.amount);
    if (!b.student_id || amount <= 0) throw new HttpError(422, 'Élève et montant supérieur à 0 requis.');
    assertOwnership(req, 'students', Number(b.student_id));
    const method = PROVIDERS[b.method] ? b.method : 'especes';

    const result = db.tx(() => {
      let invoiceId = b.invoice_id ? Number(b.invoice_id) : null;
      // Sans facture précisée : on impute automatiquement sur la plus ancienne due (FIFO)
      if (!invoiceId) {
        const oldest = db.get(
          `SELECT id FROM invoices WHERE student_id=? AND status IN ('impayee','partielle','en_retard')
            ORDER BY due_date LIMIT 1`, [Number(b.student_id)]
        );
        invoiceId = oldest?.id || null;
      }
      const seq = (db.pluck('SELECT COUNT(*) FROM payments WHERE school_id=?', [S(req)]) || 0) + 1;
      const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
      const paymentId = db.insert(
        `INSERT INTO payments (school_id, receipt_number, student_id, invoice_id, amount, method, provider_ref, phone, paid_at, received_by, note)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [S(req), b.receipt_number || `${prefix}-REC-${String(seq).padStart(5, '0')}`, Number(b.student_id),
          invoiceId, amount, method, b.provider_ref || null, b.phone || null,
          b.paid_at || new Date().toISOString(), req.user.id, b.note || null]
      );
      if (invoiceId) {
        db.run('UPDATE invoices SET amount_paid=amount_paid+? WHERE id=?', [amount, invoiceId]);
        resyncInvoice(invoiceId);
      }
      if (method !== 'especes' && method !== 'virement' && method !== 'cheque') {
        db.run(
          `INSERT INTO mobile_money_requests (school_id, payment_id, invoice_id, student_id, provider, phone, amount, status, request_id, paid_at)
           VALUES (?,?,?,?,?,?,?, 'success', ?, datetime('now'))`,
          [S(req), paymentId, invoiceId, Number(b.student_id), method, b.phone || null, amount, `req_${paymentId}`]
        );
      }
      return { paymentId, invoiceId };
    });

    // Reçu SMS automatique
    if (b.send_receipt !== false) {
      const st = db.get('SELECT first_name, last_name FROM students WHERE id=?', [Number(b.student_id)]);
      const g = db.get(
        `SELECT g.phone FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id
          WHERE sg.student_id=? AND sg.is_payer=1 AND g.phone IS NOT NULL`, [Number(b.student_id)]
      );
      if (g?.phone) {
        db.run(
          `INSERT INTO sms_queue (school_id, to_number, body, student_id, template, status, provider, created_by)
           VALUES (?,?,?,?, 'paiement', 'en_attente', ?, ?)`,
          [S(req), g.phone,
            `${req.school.name} confirme votre paiement de ${amount.toLocaleString('fr-FR')} FCFA pour ${st.first_name} ${st.last_name}. Merci.`,
            Number(b.student_id), config.integrations.sms.provider, req.user.id]
        );
      }
    }

    audit(req, 'create', 'payment', result.paymentId, `Encaissement de ${amount} FCFA (${PROVIDERS[method].label})`);
    const payment = db.get('SELECT * FROM payments WHERE id=?', [result.paymentId]);
    const student = db.get('SELECT first_name, last_name, matricule FROM students WHERE id=?', [Number(b.student_id)]);
    const invoice = result.invoiceId ? db.get('SELECT * FROM invoices WHERE id=?', [result.invoiceId]) : null;
    created(res, { payment: { ...payment, amount: money(payment.amount) }, student, invoice, solde_restant: invoice ? money(invoice.amount - invoice.discount - invoice.amount_paid) : null });
  } catch (err) { next(err); }
});

/**
 * Paiement Mobile Money en 2 étapes (flow USSD/push réel) :
 *  1) POST /payments/mobile-money/initiate → envoie la demande sur le téléphone du parent
 *  2) POST /payments/mobile-money/:id/confirm → le parent valide, le paiement est enregistré
 * En mode « simulated », l'étape 2 est immédiate pour la démonstration.
 */
router.post('/payments/mobile-money/initiate', (req, res, next) => {
  try {
    const b = req.body || {};
    const provider = PROVIDERS[b.provider] ? b.provider : null;
    if (!provider) throw new HttpError(422, 'Opérateur Mobile Money invalide.');
    const amount = money(b.amount);
    if (amount < 100) throw new HttpError(422, 'Le montant minimum est de 100 FCFA.');
    const phone = normalizePhone(b.phone, '221');
    if (!phone) throw new HttpError(422, 'Numéro de téléphone invalide.');

    const id = db.insert(
      `INSERT INTO mobile_money_requests (school_id, invoice_id, student_id, provider, phone, amount, status, request_id, response_json)
       VALUES (?,?,?,?,?,?, 'pending', ?, ?)`,
      [S(req), b.invoice_id ? Number(b.invoice_id) : null, b.student_id ? Number(b.student_id) : null,
        provider, phone, amount, `MM-${Date.now()}`,
        JSON.stringify({ mode: config.integrations.mobileMoney.mode, sentAt: new Date().toISOString(), ussd: PROVIDERS[provider].ussd || null })]
    );
    audit(req, 'create', 'mobile_money_request', id, `Demande ${PROVIDERS[provider].label} de ${amount} FCFA vers ${phone}`);
    created(res, {
      id, provider, providerLabel: PROVIDERS[provider].label, amount, phone,
      mode: config.integrations.mobileMoney.mode,
      instruction: config.integrations.mobileMoney.mode === 'simulated'
        ? `Démo : confirmez le paiement pour simuler la validation du client sur son téléphone.`
        : `Le client doit composer ${PROVIDERS[provider].ussd || 'son application'} et valider le montant de ${amount.toLocaleString('fr-FR')} FCFA.`,
      expires_in: 300,
    });
  } catch (err) { next(err); }
});

router.post('/payments/mobile-money/:id(\\d+)/confirm', requireRole(...CAN_BILL, 'parent', 'eleve'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const reqRow = db.get('SELECT * FROM mobile_money_requests WHERE id=? AND school_id=?', [id, S(req)]);
    if (!reqRow) throw new HttpError(404, 'Demande de paiement introuvable.');
    if (reqRow.status !== 'pending') throw new HttpError(409, `Cette demande est déjà ${reqRow.status}.`);
    const success = req.body.success !== false;

    if (!success) {
      db.run("UPDATE mobile_money_requests SET status='failed', error=?, updated_at=datetime('now') WHERE id=?",
        [req.body.error || 'Refusé par le client', id]);
      return ok(res, { id, status: 'failed' });
    }

    let studentId = reqRow.student_id;
    if (!studentId && reqRow.invoice_id) {
      studentId = db.pluck('SELECT student_id FROM invoices WHERE id=?', [reqRow.invoice_id]);
    }
    if (!studentId) throw new HttpError(422, 'Impossible de rattacher ce paiement à un élève.');

    const created = db.tx(() => {
      const seq = (db.pluck('SELECT COUNT(*) FROM payments WHERE school_id=?', [S(req)]) || 0) + 1;
      const prefix = (req.school.slug || 'ECO').slice(0, 3).toUpperCase();
      const providerRef = `${reqRow.provider.slice(0, 2).toUpperCase()}${String(Date.now()).slice(-8)}`;
      const paymentId = db.insert(
        `INSERT INTO payments (school_id, receipt_number, student_id, invoice_id, amount, method, provider_ref, phone, received_by, note)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [S(req), `${prefix}-REC-${String(seq).padStart(5, '0')}`, studentId, reqRow.invoice_id,
          reqRow.amount, reqRow.provider, providerRef, reqRow.phone, req.user.id, 'Paiement Mobile Money en ligne']
      );
      db.run(
        `UPDATE mobile_money_requests SET status='success', payment_id=?, response_json=?, paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?`,
        [paymentId, JSON.stringify({ status: 'SUCCESS', providerRef, confirmedAt: new Date().toISOString() }), id]
      );
      if (reqRow.invoice_id) {
        db.run('UPDATE invoices SET amount_paid=amount_paid+? WHERE id=?', [reqRow.amount, reqRow.invoice_id]);
        resyncInvoice(reqRow.invoice_id);
      }
      return { paymentId, providerRef };
    });

    audit(req, 'create', 'payment', created.paymentId, `Paiement Mobile Money confirmé (${reqRow.amount} FCFA)`);
    ok(res, { id, status: 'success', payment_id: created.paymentId, provider_ref: created.providerRef, amount: money(reqRow.amount) });
  } catch (err) { next(err); }
});

router.get('/payments/mobile-money', requireStaff, (req, res) => {
  const where = ['m.school_id=?'];
  const params = [S(req)];
  if (req.query.status) { where.push('m.status=?'); params.push(req.query.status); }
  const { rows, total } = paginate(req.query, {
    from: 'mobile_money_requests m LEFT JOIN students st ON st.id=m.student_id',
    select: 'm.*, st.first_name, st.last_name', where, params, orderBy: 'm.created_at DESC',
  });
  res.json({ data: rows.map((r) => ({ ...r, amount: money(r.amount) })), meta: { total } });
});

/** Annulation d'un paiement (erreur de caisse) — jamais de suppression physique. */
router.post('/payments/:id(\\d+)/reverse', requireRole('direction', 'comptable', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'payments', id);
    const p = db.get('SELECT * FROM payments WHERE id=?', [id]);
    if (p.is_reversed) throw new HttpError(409, 'Ce paiement est déjà annulé.');
    db.tx(() => {
      db.run("UPDATE payments SET is_reversed=1, reversed_at=datetime('now') WHERE id=?", [id]);
      if (p.invoice_id) {
        db.run('UPDATE invoices SET amount_paid=MAX(0, amount_paid-?) WHERE id=?', [p.amount, p.invoice_id]);
        resyncInvoice(p.invoice_id);
      }
    });
    audit(req, 'delete', 'payment', id, `Annulation du paiement ${p.receipt_number} (${p.amount} FCFA)`);
    ok(res, { id, reversed: true });
  } catch (err) { next(err); }
});

/** Reçu imprimable. */
router.get('/payments/:id(\\d+)/receipt', (req, res) => {
  const id = Number(req.params.id);
  assertOwnership(req, 'payments', id);
  assertFamilyAccess(req, db.pluck('SELECT student_id FROM payments WHERE id=?', [id]));
  const p = db.get(
    `SELECT p.*, st.first_name, st.last_name, st.matricule, c.name AS classe, l.name AS niveau,
            i.invoice_number, i.label, i.amount AS invoice_amount, i.discount,
            u.first_name||' '||u.last_name AS caissier,
            (SELECT g.first_name||' '||g.last_name FROM student_guardians sg JOIN guardians g ON g.id=sg.guardian_id WHERE sg.student_id=st.id AND sg.is_payer=1 LIMIT 1) AS payeur
       FROM payments p JOIN students st ON st.id=p.student_id
       LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN levels l ON l.id=c.level_id
       LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN users u ON u.id=p.received_by
      WHERE p.id=?`, [id]
  );
  if (!p) throw new HttpError(404, 'Paiement introuvable.');
  const historique = db.all(
    `SELECT receipt_number, amount, method, paid_at FROM payments WHERE student_id=? AND is_reversed=0 ORDER BY paid_at DESC LIMIT 10`, [p.student_id]
  );
  ok(res, {
    payment: { ...p, amount: money(p.amount), methodLabel: PROVIDERS[p.method]?.label || p.method },
    historique: historique.map((h) => ({ ...h, amount: money(h.amount) })),
    solde_restant: p.invoice_id ? money(p.invoice_amount - p.discount - (db.pluck('SELECT amount_paid FROM invoices WHERE id=?', [p.invoice_id]) || 0)) : null,
    school: {
      name: req.school.name, address: req.school.address, city: req.school.city, phone: req.school.phone,
      email: req.school.email, ninea: req.school.ninea, headName: req.school.head_name,
      footer: req.school.settings?.receiptFooter || 'Merci de conserver ce reçu. Aucun remboursement sans présentation de l\'original.',
    },
  });
});

/* ================================================================== */
/* RELANCES                                                             */
/* ================================================================== */
router.get('/unpaid', requireStaff, (req, res) => {
  const { retard, class_id: classId, min } = req.query;
  const where = ['i.school_id=?', "i.status IN ('impayee','partielle','en_retard')"];
  const params = [S(req)];
  if (retard) { where.push('i.due_date<?'); params.push(addDays(today(), -Number(retard))); }
  if (classId) { where.push('st.class_id=?'); params.push(Number(classId)); }
  if (min) { where.push('(i.amount-i.discount-i.amount_paid)>=?'); params.push(Number(min)); }
  const rows = db.all(
    `SELECT st.id AS student_id, st.first_name, st.last_name, st.matricule, c.name AS classe,
            g.phone AS parent_tel, g.first_name||' '||g.last_name AS payeur, g.sms_optin,
            COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) AS solde,
            COUNT(i.id) AS factures, MIN(i.due_date) AS plus_ancienne,
            MAX(i.reminder_count) AS relances, MAX(i.last_reminder_at) AS derniere_relance
       FROM invoices i JOIN students st ON st.id=i.student_id LEFT JOIN classes c ON c.id=st.class_id
       LEFT JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
       LEFT JOIN guardians g ON g.id=sg.guardian_id
      WHERE ${where.join(' AND ')}
      GROUP BY st.id ORDER BY solde DESC`, params
  );
  ok(res, rows.map((r) => ({
    ...r, solde: money(r.solde),
    jours_retard: r.plus_ancienne ? Math.max(0, Math.round((new Date(today()) - new Date(r.plus_ancienne)) / 864e5)) : 0,
  })));
});

/** Envoie une campagne de relances SMS (mise en file, envoi asynchrone). */
router.post('/reminders', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const { student_ids: studentIds, retard = 0, template } = req.body || {};
    const where = ['i.school_id=?', "i.status IN ('impayee','partielle','en_retard')"];
    const params = [S(req)];
    if (Array.isArray(studentIds) && studentIds.length) {
      where.push(`st.id IN (${studentIds.map(() => '?').join(',')})`);
      params.push(...studentIds.map(Number));
    }
    if (retard) { where.push('i.due_date<?'); params.push(addDays(today(), -Number(retard))); }
    const rows = db.all(
      `SELECT st.id AS student_id, st.first_name, st.last_name, g.phone, g.sms_optin,
              COALESCE(SUM(i.amount-i.discount-i.amount_paid),0) AS solde,
              GROUP_CONCAT(i.invoice_number) AS factures
         FROM invoices i JOIN students st ON st.id=i.student_id
         LEFT JOIN student_guardians sg ON sg.student_id=st.id AND sg.is_payer=1
         LEFT JOIN guardians g ON g.id=sg.guardian_id
        WHERE ${where.join(' AND ')} AND g.phone IS NOT NULL AND g.sms_optin=1
        GROUP BY st.id`, params
    );
    let queued = 0;
    db.tx(() => {
      for (const r of rows) {
        const body = template
          ? template.replace('{eleve}', `${r.first_name} ${r.last_name}`).replace('{solde}', money(r.solde).toLocaleString('fr-FR')).replace('{ecole}', req.school.name)
          : `Bonjour, il reste ${money(r.solde).toLocaleString('fr-FR')} FCFA à régler pour ${r.first_name} ${r.last_name} (${r.factures}). Payez par Orange Money ou Wave sur le portail ${req.school.name}. Merci.`;
        db.run(
          `INSERT INTO sms_queue (school_id, to_number, body, recipient_name, student_id, template, status, provider, created_by)
           VALUES (?,?,?,?,?, 'facture', 'en_attente', ?, ?)`,
          [S(req), r.phone, body, `${r.first_name} ${r.last_name}`, r.student_id, config.integrations.sms.provider, req.user.id]
        );
        db.run('UPDATE invoices SET reminder_count=reminder_count+1, last_reminder_at=datetime(\'now\') WHERE student_id=? AND status IN (\'impayee\',\'partielle\',\'en_retard\')', [r.student_id]);
        queued += 1;
      }
    });
    audit(req, 'create', 'sms_campaign', null, `Campagne de relance : ${queued} SMS`);
    created(res, { queued, cost_estimate: money(queued * smsSegments('x'.repeat(200)) * config.integrations.sms.pricePerSegment) });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* DÉPENSES                                                            */
/* ================================================================== */
router.get('/expenses', requireStaff, (req, res) => {
  const { category, from, to, q } = req.query;
  const where = ['e.school_id=?'];
  const params = [S(req)];
  if (category) { where.push('e.category=?'); params.push(category); }
  if (from) { where.push('e.expense_date>=?'); params.push(from); }
  if (to) { where.push('e.expense_date<=?'); params.push(to); }
  if (q) { where.push('(e.label LIKE ? OR e.supplier LIKE ?)'); const t = likeParamSafe(q); params.push(t, t); }
  const { rows, total } = paginate(req.query, {
    from: 'expenses e LEFT JOIN users u ON u.id=e.recorded_by',
    select: 'e.*, u.first_name||\' \'||u.last_name AS saisi_par', where, params, orderBy: 'e.expense_date DESC',
  });
  const sum = db.pluck(`SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE ${where.join(' AND ')}`, params);
  const categories = db.all(
    `SELECT category AS categorie, COALESCE(SUM(amount),0) total, COUNT(*) n FROM expenses WHERE school_id=? GROUP BY category ORDER BY total DESC`, [S(req)]
  );
  res.json({ data: rows.map((r) => ({ ...r, amount: money(r.amount) })), meta: { total }, aggregate: { total: money(sum), categories: categories.map((c) => ({ ...c, total: money(c.total) })) } });
});

router.post('/expenses', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.label || !b.amount) throw new HttpError(422, 'Libellé et montant requis.');
    const id = db.insert(
      `INSERT INTO expenses (school_id, expense_date, category, label, amount, method, supplier, reference, recorded_by, approved_by, status, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [S(req), b.expense_date || today(), b.category || 'autre', b.label, money(b.amount),
        b.method || 'especes', b.supplier || null, b.reference || null, req.user.id,
        b.approved_by || req.user.id, b.status || 'validee', b.note || null]
    );
    audit(req, 'create', 'expense', id, `Dépense de ${money(b.amount)} FCFA (${b.category || 'autre'})`);
    created(res, { id });
  } catch (err) { next(err); }
});

router.patch('/expenses/:id(\\d+)', requireRole(...CAN_BILL), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'expenses', id);
    const allowed = ['expense_date', 'category', 'label', 'amount', 'method', 'supplier', 'reference', 'status', 'note'];
    const sets = [];
    const params = [];
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=?`); params.push(f === 'amount' ? money(req.body[f]) : req.body[f]); }
    if (sets.length) { params.push(id); db.run(`UPDATE expenses SET ${sets.join(', ')} WHERE id=?`, params); }
    ok(res, { id });
  } catch (err) { next(err); }
});

router.delete('/expenses/:id(\\d+)', requireRole('direction', 'super_admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    assertOwnership(req, 'expenses', id);
    db.run('DELETE FROM expenses WHERE id=?', [id]);
    audit(req, 'delete', 'expense', id, 'Dépense supprimée');
    ok(res, { id });
  } catch (err) { next(err); }
});

/* ================================================================== */
/* RAPPORTS                                                            */
/* ================================================================== */
router.get('/reports/cashflow', requireStaff, (req, res) => {
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const dt = new Date();
    dt.setUTCDate(1);
    dt.setUTCMonth(dt.getUTCMonth() - i);
    months.push(dt.toISOString().slice(0, 7));
  }
  const inc = db.all(`SELECT substr(paid_at,1,7) m, SUM(amount) total, COUNT(*) n FROM payments WHERE school_id=? AND is_reversed=0 GROUP BY m`, [S(req)]);
  const out = db.all(`SELECT substr(expense_date,1,7) m, SUM(amount) total FROM expenses WHERE school_id=? GROUP BY m`, [S(req)]);
  const budget = db.all('SELECT category, amount FROM budgets WHERE school_id=?', [S(req)]);
  let cumul = 0;
  const series = months.map((m) => {
    const entrees = money(inc.find((x) => x.m === m)?.total || 0);
    const sorties = money(out.find((x) => x.m === m)?.total || 0);
    cumul += entrees - sorties;
    return { mois: m, entrees, sorties, resultat: entrees - sorties, cumul, paiements: inc.find((x) => x.m === m)?.n || 0 };
  });
  ok(res, {
    series,
    budget: budget.map((b) => {
      const reel = money(db.pluck('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE school_id=? AND category=?', [S(req), b.category]) || 0);
      return { categorie: b.category, prevu: money(b.amount), reel, ecart: money(b.amount) - reel, taux: b.amount ? round((reel / b.amount) * 100, 1) : 0 };
    }),
    totaux: {
      entrees: money(series.reduce((a, b) => a + b.entrees, 0)),
      sorties: money(series.reduce((a, b) => a + b.sorties, 0)),
      resultat: money(series.reduce((a, b) => a + b.resultat, 0)),
    },
  });
});

/** Journal de caisse imprimable (clôture journalière). */
router.get('/reports/cash-journal', requireStaff, (req, res) => {
  const d = String(req.query.date || today()).slice(0, 10);
  const payments = db.all(
    `SELECT p.*, st.first_name, st.last_name, u.first_name||' '||u.last_name AS caissier
       FROM payments p JOIN students st ON st.id=p.student_id LEFT JOIN users u ON u.id=p.received_by
      WHERE p.school_id=? AND substr(p.paid_at,1,10)=? AND p.is_reversed=0 ORDER BY p.paid_at`, [S(req), d]
  );
  const expenses = db.all(`SELECT * FROM expenses WHERE school_id=? AND expense_date=? ORDER BY id`, [S(req), d]);
  const parMethode = {};
  for (const p of payments) parMethode[p.method] = money(parMethode[p.method] || 0) + money(p.amount);
  ok(res, {
    date: d,
    payments: payments.map((p) => ({ ...p, amount: money(p.amount), methodLabel: PROVIDERS[p.method]?.label || p.method })),
    expenses: expenses.map((e) => ({ ...e, amount: money(e.amount) })),
    totaux: {
      encaissements: money(payments.reduce((a, b) => a + money(b.amount), 0)),
      decomptes: money(expenses.reduce((a, b) => a + money(b.amount), 0)),
      par_methode: Object.entries(parMethode).map(([k, v]) => ({ methode: k, label: PROVIDERS[k]?.label || k, total: v })),
      solde: money(payments.reduce((a, b) => a + money(b.amount), 0) - expenses.reduce((a, b) => a + money(b.amount), 0)),
    },
  });
});

/* ================================================================== */
/* PAIE DU PERSONNEL                                                   */
/* ================================================================== */
router.get('/payroll', requireStaff, (req, res) => {
  const runs = db.all(
    `SELECT pr.*, (SELECT COUNT(*) FROM payslips ps WHERE ps.run_id=pr.id) AS bulletins
       FROM payroll_runs pr WHERE pr.school_id=? ORDER BY pr.period DESC`, [S(req)]
  );
  const staff = db.all(
    `SELECT st.id, st.first_name, st.last_name, st.job_title, st.staff_type, st.salary_base, st.contract_type, st.status,
            st.weekly_hours, st.hourly_rate,
            (SELECT ps.net FROM payslips ps JOIN payroll_runs pr ON pr.id=ps.run_id
              WHERE ps.staff_id=st.id AND pr.school_id=? ORDER BY pr.period DESC LIMIT 1) AS dernier_net,
            (SELECT pr.period FROM payslips ps JOIN payroll_runs pr ON pr.id=ps.run_id
              WHERE ps.staff_id=st.id AND pr.school_id=? ORDER BY pr.period DESC LIMIT 1) AS dernier_mois
       FROM staff st WHERE st.school_id=? ORDER BY st.staff_type, st.last_name`, [S(req), S(req), S(req)]
  );
  const masse = db.pluck(`SELECT COALESCE(SUM(salary_base),0) FROM staff WHERE school_id=? AND status='active'`, [S(req)]) || 0;
  const congés = db.all(
    `SELECT sl.*, st.first_name, st.last_name FROM staff_leaves sl JOIN staff st ON st.id=sl.staff_id
      WHERE sl.school_id=? ORDER BY sl.date_from DESC LIMIT 20`, [S(req)]
  );
  ok(res, {
    runs: runs.map((r) => ({ ...r, total_gross: money(r.total_gross), total_net: money(r.total_net) })),
    staff: staff.map((s) => ({ ...s, salary_base: money(s.salary_base), dernier_net: money(s.dernier_net || 0) })),
    masse_salariale: money(masse),
    masse_annuelle: money(masse * 12),
    congés,
    ratio: (() => {
      const recette = db.pluck(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE school_id=? AND is_reversed=0`, [S(req)]) || 0;
      return recette ? round((masse / recette) * 100, 1) : null;
    })(),
  });
});

router.post('/payroll/generate', requireRole('direction', 'comptable', 'super_admin'), (req, res, next) => {
  try {
    const period = req.body.period || monthKey(today());
    const existing = db.get('SELECT * FROM payroll_runs WHERE school_id=? AND period=?', [S(req), period]);
    if (existing && !req.body.force) throw new HttpError(409, `La paie de ${period} existe déjà.`);
    if (existing && req.body.force) db.run('DELETE FROM payroll_runs WHERE id=?', [existing.id]);

    const runId = db.tx(() => {
      const id = db.insert(
        `INSERT INTO payroll_runs (school_id, period, status, created_by) VALUES (?,?, 'brouillon', ?)`,
        [S(req), period, req.user.id]
      );
      const staffRows = db.all(
        `SELECT * FROM staff WHERE school_id=? AND status IN ('active','conge')`, [S(req)]
      );
      let gross = 0;
      let net = 0;
      for (const st of staffRows) {
        const base = money(st.salary_base);
        const extraHours = round(db.pluck(
          `SELECT COALESCE(SUM(hours_extra),0) FROM payslips WHERE staff_id=?`, [st.id]
        ) || 0, 1);
        const bonus = money(st.hourly_rate * extraHours);
        const social = Math.round(base * 0.056);          // IPRES part salariale
        const tax = base > 300000 ? Math.round((base - 300000) * 0.12) : 0;
        const netPay = base + bonus - social - tax;
        db.insert(
          `INSERT INTO payslips (school_id, run_id, staff_id, base_salary, hours_extra, bonus, tax, social, net, lines_json, status)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [S(req), id, st.id, base, extraHours, bonus, tax, social, netPay,
            JSON.stringify([
              { label: 'Salaire de base', type: 'gain', amount: base },
              ...(extraHours ? [{ label: `Heures supplémentaires (${extraHours}h)`, type: 'gain', amount: bonus }] : []),
              { label: 'Retenue IPRES (5,6%)', type: 'retenue', amount: social },
              ...(tax ? [{ label: 'Impôt sur salaire', type: 'retenue', amount: tax }] : []),
            ]), 'brouillon']
        );
        gross += base + bonus;
        net += netPay;
      }
      db.run('UPDATE payroll_runs SET total_gross=?, total_net=? WHERE id=?', [gross, net, id]);
      return id;
    });
    audit(req, 'create', 'payroll_run', runId, `Génération de la paie ${period}`);
    created(res, { run_id: runId, period });
  } catch (err) { next(err); }
});

router.get('/payroll/:runId(\\d+)', requireStaff, (req, res) => {
  const runId = Number(req.params.runId);
  assertOwnership(req, 'payroll_runs', runId);
  const run = db.get('SELECT * FROM payroll_runs WHERE id=?', [runId]);
  const slips = db.all(
    `SELECT ps.*, st.first_name, st.last_name, st.job_title, st.staff_type, st.matricule
       FROM payslips ps JOIN staff st ON st.id=ps.staff_id WHERE ps.run_id=? ORDER BY st.last_name`, [runId]
  );
  ok(res, {
    run: { ...run, total_gross: money(run.total_gross), total_net: money(run.total_net) },
    slips: slips.map((s) => ({ ...s, lines: safeParse(s.lines_json), base_salary: money(s.base_salary), bonus: money(s.bonus), tax: money(s.tax), social: money(s.social), net: money(s.net) })),
  });
});

router.post('/payroll/:runId(\\d+)/validate', requireRole('direction', 'comptable', 'super_admin'), (req, res, next) => {
  try {
    const runId = Number(req.params.runId);
    assertOwnership(req, 'payroll_runs', runId);
    db.tx(() => {
      db.run("UPDATE payroll_runs SET status='valide', validated_at=datetime('now') WHERE id=?", [runId]);
      db.run("UPDATE payslips SET status='valide' WHERE run_id=?", [runId]);
    });
    audit(req, 'update', 'payroll_run', runId, 'Paie validée');
    ok(res, { run_id: runId, status: 'valide' });
  } catch (err) { next(err); }
});

function safeParse(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

export default router;

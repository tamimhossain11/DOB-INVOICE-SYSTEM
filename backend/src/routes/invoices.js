'use strict';

const express = require('express');
const { db, getSettings, nextInvoiceNumber } = require('../db');
const { computeTotals, deriveStatus, num, round2 } = require('../calc');
const { amountInWords } = require('../words');

const router = express.Router();

const ITEM_KINDS = new Set(['programme', 'service', 'product']);

function withItems(invoice) {
  if (!invoice) return null;
  invoice.items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id')
    .all(invoice.id);
  invoice.balance = round2(invoice.total - invoice.amount_paid);
  // Spelled out here rather than in the browser so the wording stays canonical.
  invoice.amount_in_words = amountInWords(invoice.total, invoice.currency);
  return invoice;
}

/** Normalises the request body into the shape the invoice tables expect. */
function readInvoice(body) {
  const settings = getSettings();

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it, i) => ({
      programme_id: it.programme_id ? Number(it.programme_id) : null,
      kind: ITEM_KINDS.has(it.kind) ? it.kind : 'service',
      description: String(it.description || '').trim(),
      details: String(it.details || '').trim(),
      quantity: num(it.quantity),
      rate: num(it.rate),
      position: i,
    }))
    .filter((it) => it.description !== '');

  const totals = computeTotals({
    items,
    discount_type: body.discount_type === 'percent' ? 'percent' : 'amount',
    discount_value: body.discount_value,
    tax_rate: body.tax_rate,
    amount_paid: body.amount_paid,
  });

  return {
    items: totals.items,
    fields: {
      client_id: body.client_id ? Number(body.client_id) : null,
      client_name: String(body.client_name || '').trim(),
      client_org: String(body.client_org || '').trim(),
      client_email: String(body.client_email || '').trim(),
      client_phone: String(body.client_phone || '').trim(),
      client_address: String(body.client_address || '').trim(),
      issue_date: String(body.issue_date || '').trim() || new Date().toISOString().slice(0, 10),
      due_date: String(body.due_date || '').trim(),
      currency: String(body.currency || settings.currency || 'BDT').trim(),
      subtotal: totals.subtotal,
      discount_type: body.discount_type === 'percent' ? 'percent' : 'amount',
      discount_value: round2(num(body.discount_value)),
      discount_amount: totals.discount_amount,
      tax_label: String(body.tax_label || settings.tax_label || 'VAT').trim(),
      tax_rate: round2(num(body.tax_rate)),
      tax_amount: totals.tax_amount,
      total: totals.total,
      amount_paid: totals.amount_paid,
      status: deriveStatus(body.status, totals.total, totals.amount_paid),
      payment_method: String(body.payment_method || '').trim(),
      payment_ref: String(body.payment_ref || '').trim(),
      payment_date: String(body.payment_date || '').trim(),
      notes: String(body.notes || '').trim(),
      terms: String(body.terms ?? settings.default_terms).trim(),
    },
  };
}

function replaceItems(invoiceId, items) {
  db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
  const insert = db.prepare(
    `INSERT INTO invoice_items (invoice_id, programme_id, kind, description, details, quantity, rate, amount, position)
     VALUES (@invoice_id, @programme_id, @kind, @description, @details, @quantity, @rate, @amount, @position)`
  );
  for (const it of items) insert.run({ ...it, invoice_id: invoiceId });
}

/* ------------------------------------------------------------------- list */

router.get('/', (req, res) => {
  const { q = '', status = '', from = '', to = '', client_id = '' } = req.query;
  const where = [];
  const params = {};

  if (q) {
    where.push('(invoice_no LIKE @q OR client_name LIKE @q OR client_org LIKE @q)');
    params.q = `%${String(q).trim()}%`;
  }
  if (status) {
    where.push('status = @status');
    params.status = String(status);
  }
  if (from) {
    where.push('issue_date >= @from');
    params.from = String(from);
  }
  if (to) {
    where.push('issue_date <= @to');
    params.to = String(to);
  }
  if (client_id) {
    where.push('client_id = @client_id');
    params.client_id = Number(client_id);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM invoices ${clause} ORDER BY date(issue_date) DESC, id DESC LIMIT 500`)
    .all(params);

  for (const r of rows) r.balance = round2(r.total - r.amount_paid);
  res.json(rows);
});

/* ------------------------------------------------------------------ stats */

router.get('/stats', (req, res) => {
  const live = "status NOT IN ('draft','cancelled')";
  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                   AS invoices,
         COALESCE(SUM(total), 0)                    AS billed,
         COALESCE(SUM(amount_paid), 0)              AS collected,
         COALESCE(SUM(total - amount_paid), 0)      AS outstanding
       FROM invoices WHERE ${live}`
    )
    .get();

  const byStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM invoices GROUP BY status')
    .all()
    .reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});

  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total - amount_paid), 0) AS amount
       FROM invoices
       WHERE ${live} AND status != 'paid' AND due_date != '' AND date(due_date) < date('now')`
    )
    .get();

  const topProgrammes = db
    .prepare(
      `SELECT i.description AS name, SUM(i.quantity) AS units, SUM(i.amount) AS amount
       FROM invoice_items i
       JOIN invoices v ON v.id = i.invoice_id
       WHERE i.kind = 'programme' AND v.status NOT IN ('draft','cancelled')
       GROUP BY i.description ORDER BY amount DESC LIMIT 5`
    )
    .all();

  res.json({ ...row, byStatus, overdue, topProgrammes });
});

/* ------------------------------------------------------------------- read */

router.get('/:id', (req, res) => {
  const invoice = withItems(db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  res.json(invoice);
});

/* ----------------------------------------------------------------- create */

router.post('/', (req, res) => {
  const { items, fields } = readInvoice(req.body);
  if (!fields.client_name) return res.status(400).json({ error: 'A client name is required.' });
  if (items.length === 0) return res.status(400).json({ error: 'Add at least one line item.' });

  const create = db.transaction(() => {
    const invoice_no = String(req.body.invoice_no || '').trim() || nextInvoiceNumber();
    const info = db
      .prepare(
        `INSERT INTO invoices (
           invoice_no, client_id, client_name, client_org, client_email, client_phone, client_address,
           issue_date, due_date, currency, subtotal, discount_type, discount_value, discount_amount,
           tax_label, tax_rate, tax_amount, total, amount_paid, status,
           payment_method, payment_ref, payment_date, notes, terms
         ) VALUES (
           @invoice_no, @client_id, @client_name, @client_org, @client_email, @client_phone, @client_address,
           @issue_date, @due_date, @currency, @subtotal, @discount_type, @discount_value, @discount_amount,
           @tax_label, @tax_rate, @tax_amount, @total, @amount_paid, @status,
           @payment_method, @payment_ref, @payment_date, @notes, @terms
         )`
      )
      .run({ ...fields, invoice_no });
    replaceItems(info.lastInsertRowid, items);
    return info.lastInsertRowid;
  });

  try {
    const id = create();
    res.status(201).json(withItems(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'That invoice number is already in use.' });
    }
    throw err;
  }
});

/* ----------------------------------------------------------------- update */

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found.' });

  const { items, fields } = readInvoice(req.body);
  if (!fields.client_name) return res.status(400).json({ error: 'A client name is required.' });
  if (items.length === 0) return res.status(400).json({ error: 'Add at least one line item.' });

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE invoices SET
         client_id=@client_id, client_name=@client_name, client_org=@client_org,
         client_email=@client_email, client_phone=@client_phone, client_address=@client_address,
         issue_date=@issue_date, due_date=@due_date, currency=@currency,
         subtotal=@subtotal, discount_type=@discount_type, discount_value=@discount_value,
         discount_amount=@discount_amount, tax_label=@tax_label, tax_rate=@tax_rate,
         tax_amount=@tax_amount, total=@total, amount_paid=@amount_paid, status=@status,
         payment_method=@payment_method, payment_ref=@payment_ref, payment_date=@payment_date,
         notes=@notes, terms=@terms, updated_at=datetime('now')
       WHERE id=@id`
    ).run({ ...fields, id: existing.id });
    replaceItems(existing.id, items);
  });

  update();
  res.json(withItems(db.prepare('SELECT * FROM invoices WHERE id = ?').get(existing.id)));
});

/* ---------------------------------------------------------- record payment */

router.post('/:id/payment', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found.' });

  const paid = Math.max(0, round2(num(req.body.amount_paid)));
  const status = deriveStatus(req.body.status, existing.total, paid);

  db.prepare(
    `UPDATE invoices SET amount_paid=?, status=?, payment_method=?, payment_ref=?, payment_date=?,
     updated_at=datetime('now') WHERE id=?`
  ).run(
    paid,
    status,
    String(req.body.payment_method || existing.payment_method || '').trim(),
    String(req.body.payment_ref || existing.payment_ref || '').trim(),
    String(req.body.payment_date || existing.payment_date || '').trim(),
    existing.id
  );

  res.json(withItems(db.prepare('SELECT * FROM invoices WHERE id = ?').get(existing.id)));
});

/* ---------------------------------------------------------------- delete */

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Invoice not found.' });
  res.json({ ok: true });
});

module.exports = router;

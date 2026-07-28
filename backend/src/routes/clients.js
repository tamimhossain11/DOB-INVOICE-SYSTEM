'use strict';

const express = require('express');
const { db } = require('../db');
const { num, round2 } = require('../calc');

const router = express.Router();

const FIELDS = ['name', 'organisation', 'email', 'phone', 'address', 'notes'];

function readBody(body) {
  const out = {};
  for (const f of FIELDS) out[f] = String(body[f] ?? '').trim();
  out.opening_balance = round2(num(body.opening_balance));
  out.opening_balance_note = String(body.opening_balance_note ?? '').trim();
  return out;
}

/**
 * Money owed per client: whatever they carried in when they were added, plus
 * everything billed to them since, less everything they have paid.
 * Draft and cancelled invoices are excluded — they are not real debts.
 */
const BALANCE_SQL = `
  SELECT
    c.id                                                            AS client_id,
    c.opening_balance                                               AS opening_balance,
    COALESCE(v.invoice_count, 0)                                    AS invoice_count,
    COALESCE(v.billed, 0)                                           AS billed,
    COALESCE(v.paid, 0)                                             AS paid,
    c.opening_balance + COALESCE(v.billed, 0) - COALESCE(v.paid, 0) AS due
  FROM clients c
  LEFT JOIN (
    SELECT client_id,
           COUNT(*)         AS invoice_count,
           SUM(total)       AS billed,
           SUM(amount_paid) AS paid
    FROM invoices
    WHERE status NOT IN ('draft', 'cancelled') AND client_id IS NOT NULL
    GROUP BY client_id
  ) v ON v.client_id = c.id
`;

/* -------------------------------------------------------------------- list */

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = ['c.archived = 0'];
  const params = {};

  if (q) {
    where.push('(c.name LIKE @q OR c.organisation LIKE @q OR c.email LIKE @q OR c.phone LIKE @q)');
    params.q = `%${q}%`;
  }

  const rows = db
    .prepare(
      `SELECT c.*, b.invoice_count, b.billed, b.paid, b.due
       FROM clients c
       JOIN (${BALANCE_SQL}) b ON b.client_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.name COLLATE NOCASE`
    )
    .all(params);

  for (const r of rows) {
    r.billed = round2(r.billed);
    r.paid = round2(r.paid);
    r.due = round2(r.due);
  }
  res.json(rows);
});

/* ------------------------------------------------------------- balance only */

/** Lightweight lookup for the invoice editor: what does this client owe? */
router.get('/:id/balance', (req, res) => {
  const row = db.prepare(`SELECT * FROM (${BALANCE_SQL}) WHERE client_id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Client not found.' });
  res.json({
    client_id: row.client_id,
    opening_balance: round2(row.opening_balance),
    billed: round2(row.billed),
    paid: round2(row.paid),
    due: round2(row.due),
    invoice_count: row.invoice_count,
  });
});

/* ----------------------------------------------------------- assigned items */

const ITEM_KINDS = new Set(['programme', 'service', 'product']);

router.get('/:id/items', (req, res) => {
  res.json(
    db
      .prepare('SELECT * FROM client_items WHERE client_id = ? ORDER BY position, id')
      .all(req.params.id)
  );
});

/** Replaces the client's whole assigned-item list in one call. */
router.put('/:id/items', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });

  const items = (Array.isArray(req.body.items) ? req.body.items : [])
    .map((it, i) => ({
      client_id: client.id,
      programme_id: it.programme_id ? Number(it.programme_id) : null,
      kind: ITEM_KINDS.has(it.kind) ? it.kind : 'programme',
      description: String(it.description || '').trim(),
      details: String(it.details || '').trim(),
      quantity: num(it.quantity) || 1,
      rate: round2(num(it.rate)),
      position: i,
    }))
    .filter((it) => it.description !== '');

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM client_items WHERE client_id = ?').run(client.id);
    const insert = db.prepare(
      `INSERT INTO client_items (client_id, programme_id, kind, description, details, quantity, rate, position)
       VALUES (@client_id, @programme_id, @kind, @description, @details, @quantity, @rate, @position)`
    );
    for (const it of items) insert.run(it);
  });

  replace();
  res.json(
    db.prepare('SELECT * FROM client_items WHERE client_id = ? ORDER BY position, id').all(client.id)
  );
});

/* --------------------------------------------------------------- statement */

/** Everything owed and paid by one client: totals, invoices and payments. */
router.get('/:id/statement', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found.' });

  const totals = db.prepare(`SELECT * FROM (${BALANCE_SQL}) WHERE client_id = ?`).get(client.id);

  const invoices = db
    .prepare(
      `SELECT id, invoice_no, issue_date, due_date, currency, total, amount_paid,
              (total - amount_paid) AS balance, status
       FROM invoices
       WHERE client_id = ?
       ORDER BY date(issue_date) DESC, id DESC`
    )
    .all(client.id);

  const payments = db
    .prepare(
      `SELECT p.*, i.invoice_no, i.id AS invoice_id
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE i.client_id = ?
       ORDER BY date(p.paid_on) DESC, p.id DESC`
    )
    .all(client.id);

  const overdue = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total - amount_paid), 0) AS amount
       FROM invoices
       WHERE client_id = ? AND status NOT IN ('draft','cancelled') AND status != 'paid'
         AND due_date != '' AND date(due_date) < date('now')`
    )
    .get(client.id);

  const assignedItems = db
    .prepare('SELECT * FROM client_items WHERE client_id = ? ORDER BY position, id')
    .all(client.id);

  res.json({
    client,
    assignedItems,
    totals: {
      opening_balance: round2(totals.opening_balance),
      billed: round2(totals.billed),
      paid: round2(totals.paid),
      due: round2(totals.due),
      invoice_count: totals.invoice_count,
      overdue,
    },
    invoices,
    payments,
  });
});

/* ----------------------------------------------------------- create/update */

router.post('/', (req, res) => {
  const data = readBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Client name is required.' });

  const info = db
    .prepare(
      `INSERT INTO clients (name, organisation, email, phone, address, notes,
                            opening_balance, opening_balance_note)
       VALUES (@name, @organisation, @email, @phone, @address, @notes,
               @opening_balance, @opening_balance_note)`
    )
    .run(data);
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Client not found.' });

  const data = readBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Client name is required.' });

  db.prepare(
    `UPDATE clients SET name=@name, organisation=@organisation, email=@email,
     phone=@phone, address=@address, notes=@notes,
     opening_balance=@opening_balance, opening_balance_note=@opening_balance_note
     WHERE id=@id`
  ).run({ ...data, id: existing.id });
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(existing.id));
});

router.delete('/:id', (req, res) => {
  const used = db
    .prepare('SELECT COUNT(*) AS n FROM invoices WHERE client_id = ?')
    .get(req.params.id).n;

  // Clients attached to invoices are archived, never deleted, so the invoice
  // history stays intact.
  if (used > 0) {
    db.prepare('UPDATE clients SET archived = 1 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, archived: true, invoices: used });
  }

  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true, archived: false });
});

module.exports = router;

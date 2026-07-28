'use strict';

const express = require('express');
const { db } = require('../db');

const router = express.Router();

const FIELDS = ['name', 'organisation', 'email', 'phone', 'address', 'notes'];

function readBody(body) {
  const out = {};
  for (const f of FIELDS) out[f] = String(body[f] ?? '').trim();
  return out;
}

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM clients
           WHERE archived = 0 AND (name LIKE @q OR organisation LIKE @q OR email LIKE @q OR phone LIKE @q)
           ORDER BY name COLLATE NOCASE`
        )
        .all({ q: `%${q}%` })
    : db.prepare('SELECT * FROM clients WHERE archived = 0 ORDER BY name COLLATE NOCASE').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const data = readBody(req.body);
  if (!data.name) return res.status(400).json({ error: 'Client name is required.' });

  const info = db
    .prepare(
      `INSERT INTO clients (name, organisation, email, phone, address, notes)
       VALUES (@name, @organisation, @email, @phone, @address, @notes)`
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
     phone=@phone, address=@address, notes=@notes WHERE id=@id`
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

'use strict';

const express = require('express');
const { db } = require('../db');
const { num, round2 } = require('../calc');

const router = express.Router();

router.get('/', (req, res) => {
  const all = String(req.query.all || '') === '1';
  const rows = db
    .prepare(
      `SELECT * FROM programmes ${all ? '' : 'WHERE active = 1'} ORDER BY active DESC, name COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Programme name is required.' });

  const info = db
    .prepare('INSERT INTO programmes (name, description, default_rate, active) VALUES (?, ?, ?, ?)')
    .run(
      name,
      String(req.body.description || '').trim(),
      round2(num(req.body.default_rate)),
      req.body.active === false ? 0 : 1
    );
  res.status(201).json(db.prepare('SELECT * FROM programmes WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM programmes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Programme not found.' });

  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Programme name is required.' });

  db.prepare(
    'UPDATE programmes SET name = ?, description = ?, default_rate = ?, active = ? WHERE id = ?'
  ).run(
    name,
    String(req.body.description ?? existing.description).trim(),
    round2(num(req.body.default_rate)),
    req.body.active === false ? 0 : 1,
    existing.id
  );
  res.json(db.prepare('SELECT * FROM programmes WHERE id = ?').get(existing.id));
});

router.delete('/:id', (req, res) => {
  const used = db
    .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE programme_id = ?')
    .get(req.params.id).n;

  // Keep programmes that already appear on an invoice — deactivate instead so
  // they drop out of the picker without rewriting history.
  if (used > 0) {
    db.prepare('UPDATE programmes SET active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, deactivated: true, invoices: used });
  }

  db.prepare('DELETE FROM programmes WHERE id = ?').run(req.params.id);
  res.json({ ok: true, deactivated: false });
});

module.exports = router;

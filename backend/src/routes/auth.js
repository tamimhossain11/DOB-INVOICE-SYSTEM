'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { issue, clear, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }

  issue(res, admin);
  res.json({ admin: { id: admin.id, name: admin.name, email: admin.email } });
});

router.post('/logout', (req, res) => {
  clear(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

router.post('/password', requireAuth, (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');

  if (next.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(current, admin.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(
    bcrypt.hashSync(next, 10),
    admin.id
  );
  res.json({ ok: true });
});

router.post('/profile', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  const clash = db.prepare('SELECT id FROM admins WHERE email = ? AND id != ?').get(email, req.admin.id);
  if (clash) return res.status(400).json({ error: 'That email is already in use.' });

  db.prepare('UPDATE admins SET name = ?, email = ? WHERE id = ?').run(name, email, req.admin.id);
  res.json({ admin: { id: req.admin.id, name, email } });
});

module.exports = router;

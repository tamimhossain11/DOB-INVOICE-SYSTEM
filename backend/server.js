'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');

const { bootstrap } = require('./src/db');
const { requireAuth, requireAuthPage, currentAdmin } = require('./src/auth');

/** The frontend is a separate, dependency-free folder served as static files. */
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const page = (file) => path.join(FRONTEND_DIR, file);

bootstrap();

const app = express();
app.disable('x-powered-by');
// Railway/Fly/nginx terminate TLS in front of the app; trust their headers so
// req.protocol and req.ip reflect the original request.
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

/* ------------------------------------------------------------ health check */

// Used by the host to tell a live deploy from a broken one.
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ---------------------------------------------------------------- json api */

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/clients', requireAuth, require('./src/routes/clients'));
app.use('/api/programmes', requireAuth, require('./src/routes/programmes'));
app.use('/api/invoices', requireAuth, require('./src/routes/invoices'));
app.use('/api/settings', requireAuth, require('./src/routes/settings'));

/* --------------------------------------------------------------- frontend */

app.use(express.static(FRONTEND_DIR, { index: false }));

app.get('/', (req, res) => res.redirect(currentAdmin(req) ? '/app' : '/login'));

app.get('/login', (req, res) => {
  if (currentAdmin(req)) return res.redirect('/app');
  res.sendFile(page('login.html'));
});

app.get('/app', requireAuthPage, (req, res) => res.sendFile(page('app.html')));

// The printable invoice is a frontend page too; it loads its data from the API.
app.get('/invoice/:id', requireAuthPage, (req, res) => res.sendFile(page('invoice.html')));

/* ------------------------------------------------------------- error trap */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).send('Not found.');
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
  res.status(500).send('Something went wrong.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Dreams of Bangladesh — Invoice System`);
  console.log(`  http://localhost:${PORT}\n`);
});

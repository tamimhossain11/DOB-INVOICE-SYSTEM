'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

/**
 * Where invoices.db lives. Defaults to backend/data for local use; hosts that
 * mount a persistent volume (Railway, Fly, a VPS) point DATA_DIR at the mount
 * so the database survives redeploys and restarts.
 */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'invoices.db');
console.log(`  Database: ${DB_FILE}`);

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL DEFAULT 'Administrator',
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  organisation TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programmes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  default_rate REAL NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no      TEXT NOT NULL UNIQUE,
  client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name     TEXT NOT NULL DEFAULT '',
  client_org      TEXT NOT NULL DEFAULT '',
  client_email    TEXT NOT NULL DEFAULT '',
  client_phone    TEXT NOT NULL DEFAULT '',
  client_address  TEXT NOT NULL DEFAULT '',
  issue_date      TEXT NOT NULL,
  due_date        TEXT NOT NULL DEFAULT '',
  currency        TEXT NOT NULL DEFAULT 'BDT',
  subtotal        REAL NOT NULL DEFAULT 0,
  discount_type   TEXT NOT NULL DEFAULT 'amount',
  discount_value  REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_label       TEXT NOT NULL DEFAULT 'VAT',
  tax_rate        REAL NOT NULL DEFAULT 0,
  tax_amount      REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  amount_paid     REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'unpaid',
  payment_method  TEXT NOT NULL DEFAULT '',
  payment_ref     TEXT NOT NULL DEFAULT '',
  payment_date    TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  terms           TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  programme_id INTEGER REFERENCES programmes(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'service',
  description  TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  quantity     REAL NOT NULL DEFAULT 1,
  rate         REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue ON invoices(issue_date);
`);

/* ---------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  company_name: 'Dreams of Bangladesh',
  company_tagline: 'Innovation • Robotics • Youth Development',
  company_address: 'Dhaka, Bangladesh',
  company_phone: '',
  company_email: 'info@dreamsofbangladesh.com',
  company_website: 'dreamsofbangladesh.com',
  company_bin: '',
  currency: 'BDT',
  currency_symbol: 'BDT ',
  tax_label: 'VAT',
  tax_rate: '0',
  invoice_prefix: 'DOB',
  next_number: '1',
  number_padding: '4',
  payment_instructions: 'Bank: \nAccount name: Dreams of Bangladesh\nAccount no: \nbKash / Nagad: ',
  default_terms:
    'Payment is due within 7 days of the invoice date. Participation charges must be settled before the programme start date to confirm a seat.',
  footer_note: 'Thank you for being part of Dreams of Bangladesh.',
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key, fallback = '') {
  const row = getSettingStmt.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  setSettingStmt.run(key, String(value ?? ''));
}

/**
 * Public settings only. Keys prefixed with "_" are internal (e.g. the signing
 * secret) and must never reach the settings API response.
 */
function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

/* ------------------------------------------------------------ bootstrapping */

function bootstrap() {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!getSettingStmt.get(key)) setSetting(key, value);
  }

  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (adminCount === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@dreamsofbangladesh.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    db.prepare('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)').run(
      'Dreams of Bangladesh Admin',
      email,
      bcrypt.hashSync(password, 10)
    );
    console.log(`\n  Admin account created: ${email}`);
    console.log(`  Password: ${password}`);
    console.log('  Change it from Settings after your first login.\n');
  }

  const programmeCount = db.prepare('SELECT COUNT(*) AS n FROM programmes').get().n;
  if (programmeCount === 0) {
    const insert = db.prepare(
      'INSERT INTO programmes (name, description, default_rate) VALUES (?, ?, ?)'
    );
    insert.run('Robotics Workshop', 'Participation charge per participant', 0);
    insert.run('STEM Bootcamp', 'Participation charge per participant', 0);
    insert.run('Innovation Competition', 'Team registration / participation charge', 0);
  }
}

/* ------------------------------------------------------- invoice numbering */

function nextInvoiceNumber() {
  const prefix = getSetting('invoice_prefix', 'DOB');
  const padding = parseInt(getSetting('number_padding', '4'), 10) || 4;
  const year = new Date().getFullYear();

  let n = parseInt(getSetting('next_number', '1'), 10) || 1;
  let candidate;
  const exists = db.prepare('SELECT 1 FROM invoices WHERE invoice_no = ?');
  do {
    candidate = `${prefix}-${year}-${String(n).padStart(padding, '0')}`;
    n += 1;
  } while (exists.get(candidate));

  setSetting('next_number', n);
  return candidate;
}

module.exports = { db, bootstrap, getSetting, setSetting, getSettings, nextInvoiceNumber, DEFAULT_SETTINGS };

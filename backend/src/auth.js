'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db, getSetting, setSetting } = require('./db');

const COOKIE = 'dob_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
const PLACEHOLDER = 'change-this-to-a-long-random-string';

let cachedSecret = null;

/**
 * Prefers JWT_SECRET from the environment. If it is missing or still the
 * placeholder, a random secret is generated once and stored in the database —
 * that keeps sign-in working out of the box without falling back to a shared
 * hard-coded key, and sessions survive a restart.
 */
function secret() {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv !== PLACEHOLDER) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  let stored = getSetting('_jwt_secret', '');
  if (!stored) {
    stored = crypto.randomBytes(48).toString('hex');
    setSetting('_jwt_secret', stored);
    console.warn(
      '  JWT_SECRET is not set — generated one and saved it to the database.\n' +
        '  Set JWT_SECRET in .env to control it yourself.\n'
    );
  }
  cachedSecret = stored;
  return cachedSecret;
}

function issue(res, admin) {
  const token = jwt.sign({ sub: admin.id, email: admin.email }, secret(), {
    expiresIn: MAX_AGE_MS / 1000,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIE === '1',
    maxAge: MAX_AGE_MS,
  });
}

function clear(res) {
  res.clearCookie(COOKIE);
}

function currentAdmin(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret());
    return db.prepare('SELECT id, name, email FROM admins WHERE id = ?').get(payload.sub) || null;
  } catch {
    return null;
  }
}

/** Guard for JSON API routes. */
function requireAuth(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Not signed in.' });
  req.admin = admin;
  next();
}

/** Guard for HTML pages — redirects to the login screen instead of 401-ing. */
function requireAuthPage(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return res.redirect('/login');
  req.admin = admin;
  next();
}

module.exports = { issue, clear, currentAdmin, requireAuth, requireAuthPage, COOKIE };

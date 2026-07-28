# Dreams of Bangladesh — Invoice System

A single-admin invoicing system for Dreams of Bangladesh. Raise invoices for
programme participation charges, services and products, track payments, and
print or save a branded PDF carrying the DoB logo and the green/white/red
brand palette.

Frontend and backend live in separate folders. The backend is a pure JSON API
(plus static file serving); the frontend is plain HTML/CSS/JS with no build
step and no dependencies, and talks to the backend only over `/api`.

## Running it

```bash
npm install
cp backend/.env.example backend/.env    # then edit it — see below
npm start
```

Open <http://localhost:3000> and sign in.

On the very first run an admin account is created from `.env` and printed to
the terminal. The defaults are `admin@dreamsofbangladesh.com` /
`ChangeMe123!` — change the password from **Settings** immediately after
signing in.

### backend/.env

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default `3000`). |
| `JWT_SECRET` | Signs the admin session cookie. If left unset, a random secret is generated and stored in the database on first run. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Only used to create the admin on first run. Changing them later has no effect — update the account from Settings. |
| `SECURE_COOKIE` | Set to `1` when serving over HTTPS. |

## What the admin can do

**Dashboard** — total billed, collected, outstanding and overdue amounts, plus
the top programmes by revenue.

**Invoices** — create, edit, filter by status/date/client, record payments and
delete. Every invoice supports:

- unlimited line items, each tagged **Programme**, **Service** or **Product**,
  with a description, a specification line, quantity and rate
- a discount as either a flat amount or a percentage
- a configurable tax line (labelled VAT by default)
- payment status (`unpaid`, `partial`, `paid`, `draft`, `cancelled`), method
  (bKash, Nagad, Rocket, bank transfer, cash, cheque, card), reference and date
- amount paid and the resulting balance due

Status is derived automatically from the amount paid, except for `draft` and
`cancelled`, which you set deliberately.

**Programmes** — the list of programmes clients can be charged a participation
fee for, each with a default charge. Picking one on an invoice fills in the
description and rate in a single click. A programme that already appears on an
invoice is deactivated rather than deleted so past invoices never change.

**Clients** — saved billing contacts. Invoices snapshot the client's details at
the time they were raised, so editing a client later does not rewrite history.
A client with invoices is archived rather than deleted.

**Settings** — company details, payment instructions, default terms, invoice
number format, currency, default tax rate, and your own admin name, email and
password.

## Printing / PDF

Open an invoice and press **Download / Print PDF**, or go to `/invoice/:id`
directly. The page is laid out for A4 and prints without the toolbar. Use your
browser's "Save as PDF" destination to get a file.

## Invoice numbers

Numbers follow `PREFIX-YEAR-NNNN`, e.g. `DOB-2026-0001`. The prefix, padding
and next number are all editable in Settings. If a number is already taken the
next free one is used instead, so numbers never collide.

## Layout

```
package.json                 dependencies and the start scripts

backend/                     Node + Express + SQLite — JSON API only
  server.js                  app setup, API mounting, static frontend serving
  .env                       configuration (not committed)
  src/db.js                  sqlite schema, settings, invoice numbering
  src/auth.js                cookie session, admin guards
  src/calc.js                money maths (subtotal -> discount -> tax)
  src/words.js               amount in words, lakh/crore style
  src/routes/                auth, clients, programmes, invoices, settings
  data/invoices.db           the database (created on first run)

frontend/                    plain HTML/CSS/JS — no build step, no dependencies
  login.html                 admin sign in
  app.html + js/app.js       the admin console (hash-routed)
  invoice.html + js/invoice.js   the printable A4 invoice
  css/app.css                console styling
  css/invoice.css            invoice + print styling
  assets/dob-logo.png        the DoB logo
```

Every screen, including the printable invoice, gets its data from the API —
the backend never renders HTML. If you ever want to host the frontend
somewhere else (a CDN or a separate static host), serve the `frontend/` folder
from there and point it at the backend; only `/api/*` and the cookie need to
reach the Node process.

## Backups

Everything lives in `backend/data/invoices.db`. Copy that file to back the
system up; drop it back in place to restore. Stop the server first so the
write-ahead log is flushed.

## The database

There is no database server to install, and no connection string. SQLite is an
embedded database: the whole thing is one file, `invoices.db`, read and written
directly by the app. That is why the only setting it needs is *where to put the
file* — `DATA_DIR`.

Locally you can ignore it; the file goes in `backend/data/`. On a host, point
`DATA_DIR` at a persistent volume.

> **The one thing you must get right when hosting:** if the app writes to a
> container's normal filesystem, every redeploy and restart wipes the database.
> Attach a volume and set `DATA_DIR` to its mount path.

## Deploying to Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo** in
   Railway. It detects Node and runs `npm start`; [railway.json](railway.json)
   sets the healthcheck.
2. **Add a Volume** to the service and set its mount path to `/data`. This is
   the step that keeps your invoices.
3. Under **Variables**, set:

   | Variable | Value |
   | --- | --- |
   | `DATA_DIR` | `/data` — must match the volume mount path |
   | `JWT_SECRET` | a long random string (see `.env.example` for a generator) |
   | `SECURE_COOKIE` | `1` |
   | `ADMIN_EMAIL` | your admin email |
   | `ADMIN_PASSWORD` | a strong password, used only on first boot |

   Leave `PORT` alone — Railway sets it.
4. **Settings → Networking → Generate Domain**, or attach a custom domain such
   as `invoices.dreamsofbangladesh.com`.
5. Open the domain, sign in, and change the password under Settings.

Check the deploy logs for `Database: /data/invoices.db`. If it says anything
else, `DATA_DIR` and the volume mount path do not agree and your data will not
survive the next deploy.

### Backups on Railway

The volume is not a backup. Download a copy periodically:

```bash
railway run cat /data/invoices.db > invoices-backup-$(date +%F).db
```

## Deploying anywhere else

Any host that runs Node 18+ works the same way: set `SECURE_COOKIE=1`, a strong
`JWT_SECRET`, and `DATA_DIR` pointing at persistent storage.

Serverless platforms (Vercel, Netlify, Cloudflare Pages) will **not** work for
the backend — they have no persistent filesystem, so SQLite has nowhere to
live.

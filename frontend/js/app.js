/* Dreams of Bangladesh — invoice admin console */
'use strict';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const view = $('#view');
const pageTitle = $('#page-title');
const pageSub = $('#page-sub');
const pageActions = $('#page-actions');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round(num(n) * 100) / 100;

const money = (n) =>
  num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDate(d) {
  if (!d) return '—';
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return esc(d);
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const isOverdue = (inv) =>
  inv.due_date &&
  inv.status !== 'paid' &&
  inv.status !== 'draft' &&
  inv.status !== 'cancelled' &&
  inv.due_date < today();

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast${kind === 'err' ? ' err' : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Session expired.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

/* -------------------------------------------------------------------- modal */

function modal({ title, body, confirmLabel = 'Save', danger = false, onConfirm }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" data-close>×</button>
        </div>
        <div class="modal-body">
          <div class="alert" id="modal-error"></div>
          ${body}
        </div>
        <div class="modal-foot">
          <button class="btn" data-close>Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>
        </div>
      </div>
    </div>`;

  const close = () => (root.innerHTML = '');
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
  $('.modal-backdrop', root).addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  $('[data-confirm]', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await onConfirm(root, close);
    } catch (err) {
      $('#modal-error', root).textContent = err.message;
      btn.disabled = false;
    }
  });

  return { close, root };
}

function confirmDialog(title, message, onYes, confirmLabel = 'Delete') {
  modal({
    title,
    body: `<p>${esc(message)}</p>`,
    confirmLabel,
    danger: true,
    onConfirm: async (_root, close) => {
      await onYes();
      close();
    },
  });
}

/* -------------------------------------------------------------------- state */

const state = { admin: null, settings: null, programmes: [], clients: [] };

async function loadReference() {
  const [settings, programmes, clients] = await Promise.all([
    api('/settings'),
    api('/programmes'),
    api('/clients'),
  ]);
  state.settings = settings;
  state.programmes = programmes;
  state.clients = clients;
}

function setPage(title, sub = '', actionsHtml = '') {
  pageTitle.textContent = title;
  pageSub.textContent = sub;
  pageActions.innerHTML = actionsHtml;
}

const statusPill = (inv) =>
  `<span class="pill pill-${esc(inv.status)}">${esc(inv.status)}</span>` +
  (isOverdue(inv) ? '<span class="pill pill-overdue">overdue</span>' : '');

/* ==================================================================== views */

/* ------------------------------------------------------------- dashboard */

async function viewDashboard() {
  setPage('Dashboard', 'Billing overview for Dreams of Bangladesh', `
    <a class="btn btn-primary" href="#/invoice/new">＋ New invoice</a>`);
  view.innerHTML = '<div class="empty">Loading…</div>';

  const [stats, recent] = await Promise.all([api('/invoices/stats'), api('/invoices')]);
  const cur = state.settings.currency;

  view.innerHTML = `
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Total billed</div>
        <div class="stat-value">${cur} ${money(stats.billed)}</div>
        <div class="stat-note">${stats.invoices} invoice${stats.invoices === 1 ? '' : 's'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Collected</div>
        <div class="stat-value">${cur} ${money(stats.collected)}</div>
        <div class="stat-note">${stats.byStatus.paid || 0} fully paid</div>
      </div>
      <div class="stat accent-amber">
        <div class="stat-label">Outstanding</div>
        <div class="stat-value">${cur} ${money(stats.outstanding)}</div>
        <div class="stat-note">${(stats.byStatus.unpaid || 0) + (stats.byStatus.partial || 0)} awaiting payment</div>
      </div>
      <div class="stat accent-red">
        <div class="stat-label">Overdue</div>
        <div class="stat-value">${cur} ${money(stats.overdue.amount)}</div>
        <div class="stat-note">${stats.overdue.n} past due date</div>
      </div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head">
          <h2>Recent invoices</h2>
          <a class="btn btn-sm" href="#/invoices">View all</a>
        </div>
        <div class="table-wrap">${
          recent.length
            ? `<table class="data">
                 <thead><tr><th>Invoice</th><th>Client</th><th class="num">Total</th><th>Status</th></tr></thead>
                 <tbody>${recent
                   .slice(0, 8)
                   .map(
                     (inv) => `
                     <tr>
                       <td><a class="strong" href="#/invoice/${inv.id}/edit">${esc(inv.invoice_no)}</a>
                           <div class="hint">${prettyDate(inv.issue_date)}</div></td>
                       <td>${esc(inv.client_name)}${
                         inv.client_org ? `<div class="hint">${esc(inv.client_org)}</div>` : ''
                       }</td>
                       <td class="num mono strong">${money(inv.total)}</td>
                       <td>${statusPill(inv)}</td>
                     </tr>`
                   )
                   .join('')}</tbody>
               </table>`
            : `<div class="empty">
                 <div class="empty-title">No invoices yet</div>
                 <div>Create your first invoice to see it here.</div>
               </div>`
        }</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Top programmes by revenue</h2></div>
        <div class="table-wrap">${
          stats.topProgrammes.length
            ? `<table class="data">
                 <thead><tr><th>Programme</th><th class="num">Participants</th><th class="num">Revenue</th></tr></thead>
                 <tbody>${stats.topProgrammes
                   .map(
                     (p) => `<tr>
                       <td class="strong">${esc(p.name)}</td>
                       <td class="num mono">${num(p.units).toLocaleString('en-US')}</td>
                       <td class="num mono strong">${money(p.amount)}</td>
                     </tr>`
                   )
                   .join('')}</tbody>
               </table>`
            : `<div class="empty">
                 <div class="empty-title">No programme charges billed yet</div>
                 <div>Add a programme line to an invoice and it will show up here.</div>
               </div>`
        }</div>
      </div>
    </div>`;
}

/* -------------------------------------------------------------- invoices */

let invoiceFilters = { q: '', status: '', from: '', to: '' };

async function viewInvoices() {
  setPage('Invoices', 'Every invoice raised by Dreams of Bangladesh', `
    <a class="btn btn-primary" href="#/invoice/new">＋ New invoice</a>`);

  view.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-body">
        <div class="grid grid-4" style="margin-bottom:0">
          <div class="field" style="margin:0">
            <label>Search</label>
            <input type="text" id="f-q" placeholder="Invoice no, client, organisation" value="${esc(invoiceFilters.q)}">
          </div>
          <div class="field" style="margin:0">
            <label>Status</label>
            <select id="f-status">
              ${['', 'unpaid', 'partial', 'paid', 'draft', 'cancelled']
                .map(
                  (s) =>
                    `<option value="${s}" ${invoiceFilters.status === s ? 'selected' : ''}>${
                      s === '' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)
                    }</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field" style="margin:0">
            <label>Issued from</label>
            <input type="date" id="f-from" value="${esc(invoiceFilters.from)}">
          </div>
          <div class="field" style="margin:0">
            <label>Issued to</label>
            <input type="date" id="f-to" value="${esc(invoiceFilters.to)}">
          </div>
        </div>
      </div>
    </div>
    <div class="card"><div id="invoice-list"><div class="empty">Loading…</div></div></div>`;

  const apply = async () => {
    invoiceFilters = {
      q: $('#f-q').value.trim(),
      status: $('#f-status').value,
      from: $('#f-from').value,
      to: $('#f-to').value,
    };
    await renderInvoiceList();
  };

  $('#f-q').addEventListener('input', debounce(apply, 280));
  ['#f-status', '#f-from', '#f-to'].forEach((s) => $(s).addEventListener('change', apply));

  await renderInvoiceList();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function renderInvoiceList() {
  const box = $('#invoice-list');
  if (!box) return;

  const qs = new URLSearchParams(
    Object.entries(invoiceFilters).filter(([, v]) => v)
  ).toString();
  const rows = await api(`/invoices${qs ? `?${qs}` : ''}`);

  if (!rows.length) {
    box.innerHTML = `<div class="empty">
        <div class="empty-title">No invoices match</div>
        <div>Try clearing the filters, or create a new invoice.</div>
      </div>`;
    return;
  }

  const total = rows.reduce((s, r) => s + r.total, 0);
  const due = rows.reduce((s, r) => s + (r.status === 'cancelled' ? 0 : r.balance), 0);

  box.innerHTML = `
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th>
            <th class="num">Total</th><th class="num">Balance</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (inv) => `
            <tr>
              <td><a class="strong" href="#/invoice/${inv.id}/edit">${esc(inv.invoice_no)}</a></td>
              <td>${esc(inv.client_name)}${
                inv.client_org ? `<div class="hint">${esc(inv.client_org)}</div>` : ''
              }</td>
              <td>${prettyDate(inv.issue_date)}</td>
              <td>${prettyDate(inv.due_date)}</td>
              <td class="num mono strong">${money(inv.total)}</td>
              <td class="num mono">${money(inv.balance)}</td>
              <td>${statusPill(inv)}</td>
              <td class="num">
                <a class="btn btn-sm" href="/invoice/${inv.id}" target="_blank" rel="noopener">Print</a>
                <button class="btn btn-sm" data-pay="${inv.id}">Payment</button>
                <button class="btn btn-sm btn-danger" data-del="${inv.id}" data-no="${esc(inv.invoice_no)}">Delete</button>
              </td>
            </tr>`
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4" class="strong">${rows.length} invoice${rows.length === 1 ? '' : 's'}</td>
            <td class="num mono strong">${money(total)}</td>
            <td class="num mono strong">${money(due)}</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>
      </table>
    </div>`;

  $$('[data-pay]', box).forEach((b) =>
    b.addEventListener('click', () => paymentModal(Number(b.dataset.pay)))
  );
  $$('[data-del]', box).forEach((b) =>
    b.addEventListener('click', () =>
      confirmDialog(
        'Delete invoice',
        `Delete ${b.dataset.no}? This removes the invoice and its line items permanently.`,
        async () => {
          await api(`/invoices/${b.dataset.del}`, { method: 'DELETE' });
          toast('Invoice deleted.');
          await renderInvoiceList();
        }
      )
    )
  );
}

const PAYMENT_METHODS = ['', 'bKash', 'Nagad', 'Rocket', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other'];

/** Adds one payment to an invoice's ledger. Several add up as installments. */
function addPaymentModal(inv, onDone) {
  const cur = state.settings.currency;

  modal({
    title: `Record payment — ${inv.invoice_no}`,
    confirmLabel: 'Add payment',
    body: `
      <div class="totals-box" style="margin-bottom:14px">
        <div class="total-line"><span>Invoice total</span><strong>${cur} ${money(inv.total)}</strong></div>
        <div class="total-line"><span>Already received</span><strong>− ${money(inv.amount_paid)}</strong></div>
        <div class="total-line due"><span>Balance now</span><strong>${cur} ${money(inv.balance)}</strong></div>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label>Amount now *</label>
          <input type="number" step="0.01" min="0" id="m-amount" value="${inv.balance > 0 ? inv.balance : ''}">
          <div class="hint"><a href="#" id="m-full">Settle the full balance</a></div>
        </div>
        <div class="field">
          <label>Paid on</label>
          <input type="date" id="m-date" value="${today()}">
        </div>
      </div>
      <div class="grid grid-2">
        <div class="field">
          <label>Method</label>
          <select id="m-method">
            ${PAYMENT_METHODS.map((m) => `<option value="${esc(m)}">${m || '— select —'}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Reference / TrxID</label>
          <input type="text" id="m-ref" placeholder="e.g. BKH8842013">
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Note</label>
        <input type="text" id="m-note" placeholder="Optional, e.g. 1st installment">
      </div>`,
    onConfirm: async (root, close) => {
      const updated = await api(`/invoices/${inv.id}/payments`, {
        method: 'POST',
        body: {
          amount: $('#m-amount', root).value,
          paid_on: $('#m-date', root).value,
          method: $('#m-method', root).value,
          reference: $('#m-ref', root).value,
          note: $('#m-note', root).value,
        },
      });
      close();
      toast(`Payment of ${money(updated.amount_paid - inv.amount_paid)} recorded.`);
      await onDone(updated);
    },
  });

  $('#m-full').addEventListener('click', (e) => {
    e.preventDefault();
    $('#m-amount').value = inv.balance;
  });
}

async function paymentModal(id) {
  const inv = await api(`/invoices/${id}`);
  addPaymentModal(inv, async () => renderInvoiceList());
}

/* ---------------------------------------------------------- invoice editor */

async function viewInvoiceForm(id, presetClientId) {
  const editing = Boolean(id);
  const preset = presetClientId ? state.clients.find((c) => String(c.id) === presetClientId) : null;
  const inv = editing
    ? await api(`/invoices/${id}`)
    : {
        invoice_no: '',
        client_id: preset ? preset.id : null,
        client_name: preset ? preset.name : '',
        client_org: preset ? preset.organisation : '',
        client_email: preset ? preset.email : '',
        client_phone: preset ? preset.phone : '',
        client_address: preset ? preset.address : '',
        issue_date: today(),
        due_date: addDays(today(), 7),
        currency: state.settings.currency,
        discount_type: 'amount',
        discount_value: 0,
        tax_label: state.settings.tax_label,
        tax_rate: num(state.settings.tax_rate),
        amount_paid: 0,
        status: 'unpaid',
        payment_method: '',
        payment_ref: '',
        payment_date: '',
        notes: '',
        terms: state.settings.default_terms,
        items: [],
        payments: [],
      };

  // When editing, the payments ledger owns this figure — not a form field.
  let paidToDate = num(inv.amount_paid);

  setPage(
    editing ? `Invoice ${inv.invoice_no}` : 'New invoice',
    editing ? `Created ${prettyDate((inv.created_at || '').slice(0, 10))}` : 'Fill in the client, items and charges',
    editing
      ? `<a class="btn" href="/invoice/${inv.id}" target="_blank" rel="noopener">Print / PDF</a>
         <a class="btn" href="#/invoices">Close</a>`
      : `<a class="btn" href="#/invoices">Cancel</a>`
  );

  view.innerHTML = `
    <form id="inv-form">
      <div class="alert" id="form-error"></div>

      <div class="grid grid-2" style="align-items:start;margin-bottom:16px">
        <div class="card">
          <div class="card-head">
            <h2>Client</h2>
            <select id="client-picker" style="max-width:220px">
              <option value="">— Pick a saved client —</option>
              ${state.clients
                .map(
                  (c) =>
                    `<option value="${c.id}" ${inv.client_id === c.id ? 'selected' : ''}>${esc(
                      c.name
                    )}${c.organisation ? ` · ${esc(c.organisation)}` : ''}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="card-body">
            <div class="grid grid-2">
              <div class="field">
                <label>Client name *</label>
                <input type="text" id="client_name" value="${esc(inv.client_name)}" required>
              </div>
              <div class="field">
                <label>Organisation / school</label>
                <input type="text" id="client_org" value="${esc(inv.client_org)}">
              </div>
            </div>
            <div class="grid grid-2">
              <div class="field">
                <label>Email</label>
                <input type="text" id="client_email" value="${esc(inv.client_email)}">
              </div>
              <div class="field">
                <label>Phone</label>
                <input type="text" id="client_phone" value="${esc(inv.client_phone)}">
              </div>
            </div>
            <div class="field" style="margin-bottom:0">
              <label>Address</label>
              <textarea id="client_address" rows="2">${esc(inv.client_address)}</textarea>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Invoice details</h2></div>
          <div class="card-body">
            <div class="grid grid-2">
              <div class="field">
                <label>Invoice number</label>
                <input type="text" id="invoice_no" value="${esc(inv.invoice_no)}" ${
    editing ? 'readonly' : 'placeholder="Auto-generated"'
  }>
              </div>
              <div class="field">
                <label>Currency</label>
                <input type="text" id="currency" value="${esc(inv.currency)}">
              </div>
            </div>
            <div class="grid grid-2">
              <div class="field">
                <label>Issue date *</label>
                <input type="date" id="issue_date" value="${esc(inv.issue_date)}" required>
              </div>
              <div class="field">
                <label>Due date</label>
                <input type="date" id="due_date" value="${esc(inv.due_date)}">
              </div>
            </div>
            <div class="field" style="margin-bottom:0">
              <label>Notes on the invoice</label>
              <textarea id="notes" rows="2" placeholder="Anything the client should see, e.g. batch name or event dates">${esc(
                inv.notes
              )}</textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <h2>Items &amp; charges</h2>
          <div class="row row-nowrap">
            <select id="programme-add" style="max-width:250px">
              <option value="">＋ Add a programme charge…</option>
              ${state.programmes
                .map(
                  (p) =>
                    `<option value="${p.id}">${esc(p.name)}${
                      p.default_rate ? ` · ${money(p.default_rate)}` : ''
                    }</option>`
                )
                .join('')}
            </select>
            <button type="button" class="btn btn-sm" id="add-line">＋ Add blank line</button>
          </div>
        </div>
        <div class="card-body">
          <div class="table-wrap">
            <table class="items-table">
              <thead>
                <tr>
                  <th class="w-kind">Type</th>
                  <th>Description &amp; specification</th>
                  <th class="w-qty">Qty</th>
                  <th class="w-rate">Rate</th>
                  <th class="w-amt">Amount</th>
                  <th class="w-x"></th>
                </tr>
              </thead>
              <tbody id="lines"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="align-items:start">
        <div class="card">
          <div class="card-head">
            <h2>Payments &amp; terms</h2>
            ${editing ? '<button type="button" class="btn btn-sm" id="add-payment">＋ Record payment</button>' : ''}
          </div>
          <div class="card-body">
            <div class="field">
              <label>Status</label>
              <select id="status">
                <option value="auto" ${
                  !['draft', 'cancelled'].includes(inv.status) ? 'selected' : ''
                }>Automatic (from payments received)</option>
                <option value="draft" ${inv.status === 'draft' ? 'selected' : ''}>Draft</option>
                <option value="cancelled" ${inv.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
              </select>
            </div>

            ${
              editing
                ? `<div class="field">
                     <label>Payments received</label>
                     <div id="payments-list"></div>
                   </div>`
                : `<div class="grid grid-3">
                     <div class="field">
                       <label>Initial payment</label>
                       <input type="number" step="0.01" min="0" id="amount_paid" value="0">
                     </div>
                     <div class="field">
                       <label>Method</label>
                       <select id="payment_method">
                         ${['', 'bKash', 'Nagad', 'Rocket', 'Bank transfer', 'Cash', 'Cheque', 'Card', 'Other']
                           .map((m) => `<option value="${esc(m)}">${m || '—'}</option>`)
                           .join('')}
                       </select>
                     </div>
                     <div class="field">
                       <label>Paid on</label>
                       <input type="date" id="payment_date" value="">
                     </div>
                   </div>
                   <div class="hint" style="margin:-8px 0 14px">
                     Optional. Once saved you can record further payments as installments.
                   </div>`
            }

            <div class="field" style="margin-bottom:0">
              <label>Terms &amp; conditions</label>
              <textarea id="terms" rows="3">${esc(inv.terms)}</textarea>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Totals</h2></div>
          <div class="card-body">
            <div class="grid grid-2">
              <div class="field">
                <label>Discount</label>
                <div class="row" style="flex-wrap:nowrap">
                  <input type="number" step="0.01" min="0" id="discount_value" value="${inv.discount_value}">
                  <select id="discount_type" style="max-width:110px">
                    <option value="amount" ${inv.discount_type === 'amount' ? 'selected' : ''}>Amount</option>
                    <option value="percent" ${inv.discount_type === 'percent' ? 'selected' : ''}>%</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label>Tax</label>
                <div class="row" style="flex-wrap:nowrap">
                  <input type="text" id="tax_label" value="${esc(inv.tax_label)}" style="max-width:90px">
                  <input type="number" step="0.01" min="0" id="tax_rate" value="${inv.tax_rate}">
                  <span class="hint" style="margin:0">%</span>
                </div>
              </div>
            </div>

            <div class="totals-box" id="totals"></div>

            <div class="row row-end" style="margin-top:16px">
              <button type="submit" class="btn btn-primary" id="save">
                ${editing ? 'Save changes' : 'Create invoice'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>`;

  /* ---- line items ---- */

  const linesBody = $('#lines');

  function lineRow(item = {}) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <select class="l-kind">
          ${['programme', 'service', 'product']
            .map(
              (k) =>
                `<option value="${k}" ${(item.kind || 'service') === k ? 'selected' : ''}>${
                  k[0].toUpperCase() + k.slice(1)
                }</option>`
            )
            .join('')}
        </select>
      </td>
      <td>
        <input type="text" class="l-desc" placeholder="What is being charged" value="${esc(item.description || '')}">
        <input type="text" class="l-details" placeholder="Specification / details (optional)"
               value="${esc(item.details || '')}" style="margin-top:5px">
      </td>
      <td><input type="number" step="0.01" min="0" class="l-qty" value="${
        item.quantity ?? 1
      }"></td>
      <td><input type="number" step="0.01" min="0" class="l-rate" value="${item.rate ?? 0}"></td>
      <td class="w-amt"><span class="line-amount">0.00</span></td>
      <td><button type="button" class="icon-btn l-del" title="Remove line">×</button></td>`;

    tr.dataset.programmeId = item.programme_id || '';
    $('.l-del', tr).addEventListener('click', () => {
      tr.remove();
      if (!linesBody.children.length) linesBody.appendChild(lineRow());
      recalc();
    });
    $$('input, select', tr).forEach((el) => el.addEventListener('input', recalc));
    return tr;
  }

  function readLines() {
    return $$('tr', linesBody).map((tr) => ({
      programme_id: tr.dataset.programmeId || null,
      kind: $('.l-kind', tr).value,
      description: $('.l-desc', tr).value.trim(),
      details: $('.l-details', tr).value.trim(),
      quantity: num($('.l-qty', tr).value),
      rate: num($('.l-rate', tr).value),
    }));
  }

  function recalc() {
    const cur = $('#currency').value || 'BDT';
    let subtotal = 0;

    $$('tr', linesBody).forEach((tr) => {
      const amount = round2(num($('.l-qty', tr).value) * num($('.l-rate', tr).value));
      $('.line-amount', tr).textContent = money(amount);
      subtotal += amount;
    });
    subtotal = round2(subtotal);

    const dType = $('#discount_type').value;
    const dValue = Math.max(0, num($('#discount_value').value));
    let discount = dType === 'percent' ? round2((subtotal * Math.min(dValue, 100)) / 100) : round2(dValue);
    discount = Math.min(discount, subtotal);

    const taxable = round2(subtotal - discount);
    const taxRate = Math.max(0, num($('#tax_rate').value));
    const tax = round2((taxable * taxRate) / 100);
    const total = round2(taxable + tax);
    const paid = editing ? paidToDate : Math.max(0, round2(num($('#amount_paid').value)));
    const balance = round2(total - paid);

    $('#totals').innerHTML = `
      <div class="total-line"><span>Subtotal</span><strong>${cur} ${money(subtotal)}</strong></div>
      ${
        discount > 0
          ? `<div class="total-line"><span>Discount${
              dType === 'percent' ? ` (${dValue}%)` : ''
            }</span><strong>− ${money(discount)}</strong></div>`
          : ''
      }
      ${
        taxRate > 0
          ? `<div class="total-line"><span>${esc($('#tax_label').value || 'VAT')} (${taxRate}%)</span><strong>${money(
              tax
            )}</strong></div>`
          : ''
      }
      <div class="total-line grand"><span>Total</span><span>${cur} ${money(total)}</span></div>
      ${
        paid > 0
          ? `<div class="total-line"><span>Paid</span><strong>− ${money(paid)}</strong></div>
             <div class="total-line ${balance > 0 ? 'due' : ''}"><span>${
               balance > 0 ? 'Balance due' : 'Settled in full'
             }</span><strong>${cur} ${money(balance)}</strong></div>`
          : ''
      }`;
  }

  (inv.items.length ? inv.items : [{}]).forEach((it) => linesBody.appendChild(lineRow(it)));

  /* ---- payments ledger (existing invoices only) ---- */

  function renderPayments(payments) {
    const box = $('#payments-list');
    if (!box) return;

    box.innerHTML = payments.length
      ? `<table class="data payments-table">
           <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th></th></tr></thead>
           <tbody>${payments
             .map(
               (p) => `<tr>
                 <td>${prettyDate(p.paid_on)}</td>
                 <td>${esc(p.method) || '—'}</td>
                 <td class="mono">${esc(p.reference) || '—'}${
                   p.note ? `<div class="hint">${esc(p.note)}</div>` : ''
                 }</td>
                 <td class="num mono strong">${money(p.amount)}</td>
                 <td class="num"><button type="button" class="icon-btn" data-delpay="${p.id}"
                     title="Delete this payment">×</button></td>
               </tr>`
             )
             .join('')}</tbody>
           <tfoot><tr>
             <td colspan="3" class="strong">Total received</td>
             <td class="num mono strong">${money(payments.reduce((s, p) => s + p.amount, 0))}</td>
             <td></td>
           </tr></tfoot>
         </table>`
      : `<div class="hint" style="padding:10px 0">No payments recorded yet.</div>`;

    $$('[data-delpay]', box).forEach((b) =>
      b.addEventListener('click', () =>
        confirmDialog(
          'Delete payment',
          'Remove this payment from the ledger? The invoice balance and the client statement will update.',
          async () => {
            const updated = await api(`/invoices/${id}/payments/${b.dataset.delpay}`, {
              method: 'DELETE',
            });
            paidToDate = num(updated.amount_paid);
            renderPayments(updated.payments);
            recalc();
            toast('Payment deleted.');
          }
        )
      )
    );
  }

  if (editing) {
    renderPayments(inv.payments || []);
    $('#add-payment').addEventListener('click', () =>
      addPaymentModal(inv, async (updated) => {
        paidToDate = num(updated.amount_paid);
        renderPayments(updated.payments);
        recalc();
      })
    );
  }

  $('#add-line').addEventListener('click', () => {
    linesBody.appendChild(lineRow());
    recalc();
  });

  $('#programme-add').addEventListener('change', (e) => {
    const programme = state.programmes.find((p) => String(p.id) === e.target.value);
    e.target.value = '';
    if (!programme) return;

    const first = $$('tr', linesBody)[0];
    if (first && !$('.l-desc', first).value.trim() && linesBody.children.length === 1) first.remove();

    linesBody.appendChild(
      lineRow({
        programme_id: programme.id,
        kind: 'programme',
        description: programme.name,
        details: programme.description,
        quantity: 1,
        rate: programme.default_rate,
      })
    );
    recalc();
  });

  $('#client-picker').addEventListener('change', (e) => {
    const client = state.clients.find((c) => String(c.id) === e.target.value);
    if (!client) return;
    $('#client_name').value = client.name;
    $('#client_org').value = client.organisation;
    $('#client_email').value = client.email;
    $('#client_phone').value = client.phone;
    $('#client_address').value = client.address;
  });

  ['#discount_value', '#discount_type', '#tax_rate', '#tax_label', '#amount_paid', '#currency'].forEach(
    (sel) => $(sel)?.addEventListener('input', recalc)
  );
  $('#discount_type').addEventListener('change', recalc);

  recalc();

  /* ---- save ---- */

  $('#inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#save');
    const errorBox = $('#form-error');
    errorBox.textContent = '';
    btn.disabled = true;

    const payload = {
      invoice_no: $('#invoice_no').value.trim(),
      client_id: $('#client-picker').value || null,
      client_name: $('#client_name').value,
      client_org: $('#client_org').value,
      client_email: $('#client_email').value,
      client_phone: $('#client_phone').value,
      client_address: $('#client_address').value,
      issue_date: $('#issue_date').value,
      due_date: $('#due_date').value,
      currency: $('#currency').value,
      discount_type: $('#discount_type').value,
      discount_value: $('#discount_value').value,
      tax_label: $('#tax_label').value,
      tax_rate: $('#tax_rate').value,
      status: $('#status').value,
      notes: $('#notes').value,
      terms: $('#terms').value,
      items: readLines(),
      // Only a brand new invoice can carry an opening payment; on an existing
      // one the ledger is the only way money goes in or out.
      ...(editing
        ? {}
        : {
            amount_paid: $('#amount_paid').value,
            payment_method: $('#payment_method').value,
            payment_date: $('#payment_date').value,
          }),
    };

    try {
      const saved = editing
        ? await api(`/invoices/${id}`, { method: 'PUT', body: payload })
        : await api('/invoices', { method: 'POST', body: payload });
      toast(editing ? 'Invoice updated.' : `Invoice ${saved.invoice_no} created.`);
      window.location.hash = `#/invoice/${saved.id}/edit`;
      if (editing) await router();
    } catch (err) {
      errorBox.textContent = err.message;
      btn.disabled = false;
    }
  });
}

/* --------------------------------------------------------------- clients */

async function viewClients() {
  setPage('Clients', 'Saved billing contacts, schools and partners', `
    <button class="btn btn-primary" id="add-client">＋ Add client</button>`);

  const render = async () => {
    state.clients = await api('/clients');
    const totalDue = state.clients.reduce((s, c) => s + num(c.due), 0);

    view.innerHTML = `<div class="card">${
      state.clients.length
        ? `<div class="table-wrap"><table class="data">
             <thead><tr>
               <th>Name</th><th>Organisation</th><th>Contact</th>
               <th class="num">Invoices</th><th class="num">Billed</th>
               <th class="num">Paid</th><th class="num">Due</th><th></th>
             </tr></thead>
             <tbody>${state.clients
               .map(
                 (c) => `<tr>
                   <td><a class="strong" href="#/client/${c.id}">${esc(c.name)}</a></td>
                   <td>${esc(c.organisation) || '—'}</td>
                   <td>${esc(c.phone) || '—'}${c.email ? `<div class="hint">${esc(c.email)}</div>` : ''}</td>
                   <td class="num mono">${c.invoice_count}</td>
                   <td class="num mono">${money(c.billed)}</td>
                   <td class="num mono">${money(c.paid)}</td>
                   <td class="num mono strong ${num(c.due) > 0 ? 'due-amount' : ''}">${money(c.due)}</td>
                   <td class="num">
                     <a class="btn btn-sm" href="#/client/${c.id}">Statement</a>
                     <button class="btn btn-sm" data-edit="${c.id}">Edit</button>
                     <button class="btn btn-sm btn-danger" data-del="${c.id}">Remove</button>
                   </td>
                 </tr>`
               )
               .join('')}</tbody>
             <tfoot><tr>
               <td colspan="6" class="strong">Total outstanding across all clients</td>
               <td class="num mono strong due-amount">${money(totalDue)}</td>
               <td></td>
             </tr></tfoot>
           </table></div>`
        : `<div class="empty">
             <div class="empty-title">No clients saved</div>
             <div>Add a client so you do not have to retype their details on every invoice.</div>
           </div>`
    }</div>`;

    $$('[data-edit]').forEach((b) =>
      b.addEventListener('click', () =>
        clientModal(state.clients.find((c) => c.id === Number(b.dataset.edit)), render)
      )
    );
    $$('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const client = state.clients.find((c) => c.id === Number(b.dataset.del));
        confirmDialog(
          'Remove client',
          `Remove ${client.name}? If they already have invoices, the client is archived instead so the invoice history stays intact.`,
          async () => {
            const res = await api(`/clients/${client.id}`, { method: 'DELETE' });
            toast(res.archived ? 'Client archived (invoices kept).' : 'Client removed.');
            await render();
          },
          'Remove'
        );
      })
    );
  };

  $('#add-client').addEventListener('click', () => clientModal(null, render));
  await render();
}

function clientModal(client, onDone) {
  const c = client || {
    name: '', organisation: '', email: '', phone: '', address: '', notes: '',
    opening_balance: 0, opening_balance_note: '',
  };
  modal({
    title: client ? 'Edit client' : 'Add client',
    confirmLabel: client ? 'Save changes' : 'Add client',
    body: `
      <div class="field"><label>Name *</label><input type="text" id="c-name" value="${esc(c.name)}"></div>
      <div class="grid grid-2">
        <div class="field"><label>Organisation</label><input type="text" id="c-org" value="${esc(c.organisation)}"></div>
        <div class="field"><label>Phone</label><input type="text" id="c-phone" value="${esc(c.phone)}"></div>
      </div>
      <div class="field"><label>Email</label><input type="text" id="c-email" value="${esc(c.email)}"></div>
      <div class="field"><label>Address</label><textarea id="c-address" rows="2">${esc(c.address)}</textarea></div>

      <div class="grid grid-2">
        <div class="field">
          <label>Opening balance</label>
          <input type="number" step="0.01" id="c-opening" value="${num(c.opening_balance)}">
          <div class="hint">Money already owed before this system. Added on top of their invoices.</div>
        </div>
        <div class="field">
          <label>Why</label>
          <input type="text" id="c-opening-note" value="${esc(c.opening_balance_note)}"
                 placeholder="e.g. dues carried over from 2025">
        </div>
      </div>

      <div class="field" style="margin-bottom:0"><label>Internal notes</label><textarea id="c-notes" rows="2">${esc(
        c.notes
      )}</textarea></div>`,
    onConfirm: async (root, close) => {
      const body = {
        name: $('#c-name', root).value,
        organisation: $('#c-org', root).value,
        email: $('#c-email', root).value,
        phone: $('#c-phone', root).value,
        address: $('#c-address', root).value,
        notes: $('#c-notes', root).value,
        opening_balance: $('#c-opening', root).value,
        opening_balance_note: $('#c-opening-note', root).value,
      };
      if (client) await api(`/clients/${client.id}`, { method: 'PUT', body });
      else await api('/clients', { method: 'POST', body });
      close();
      toast(client ? 'Client updated.' : 'Client added.');
      await onDone();
    },
  });
}

/* ------------------------------------------------------ client statement */

async function viewClientStatement(id) {
  view.innerHTML = '<div class="empty">Loading…</div>';
  const { client, totals, invoices, payments } = await api(`/clients/${id}/statement`);
  const cur = state.settings.currency;

  setPage(
    client.name,
    [client.organisation, client.phone, client.email].filter(Boolean).join(' · ') || 'Client statement',
    `<button class="btn" id="edit-client">Edit client</button>
     <a class="btn btn-primary" href="#/invoice/new?client=${client.id}">＋ New invoice</a>`
  );

  view.innerHTML = `
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Opening balance</div>
        <div class="stat-value">${cur} ${money(totals.opening_balance)}</div>
        <div class="stat-note">${esc(client.opening_balance_note) || 'Carried forward'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Billed on invoices</div>
        <div class="stat-value">${cur} ${money(totals.billed)}</div>
        <div class="stat-note">${totals.invoice_count} invoice${totals.invoice_count === 1 ? '' : 's'}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Paid</div>
        <div class="stat-value">${cur} ${money(totals.paid)}</div>
        <div class="stat-note">${payments.length} payment${payments.length === 1 ? '' : 's'}</div>
      </div>
      <div class="stat accent-red">
        <div class="stat-label">Total due</div>
        <div class="stat-value">${cur} ${money(totals.due)}</div>
        <div class="stat-note">${
          totals.overdue.n
            ? `${totals.overdue.n} overdue · ${money(totals.overdue.amount)}`
            : 'nothing overdue'
        }</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><h2>How the total due is made up</h2></div>
      <div class="card-body">
        <div class="totals-box" style="max-width:460px">
          <div class="total-line"><span>Opening balance</span><strong>${money(totals.opening_balance)}</strong></div>
          <div class="total-line"><span>Billed on invoices</span><strong>+ ${money(totals.billed)}</strong></div>
          <div class="total-line"><span>Payments received</span><strong>− ${money(totals.paid)}</strong></div>
          <div class="total-line grand"><span>Total due</span><span>${cur} ${money(totals.due)}</span></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><h2>Invoices under this client</h2></div>
      ${
        invoices.length
          ? `<div class="table-wrap"><table class="data">
               <thead><tr>
                 <th>Invoice</th><th>Issued</th><th>Due</th>
                 <th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th>
               </tr></thead>
               <tbody>${invoices
                 .map(
                   (inv) => `<tr>
                     <td><a class="strong" href="#/invoice/${inv.id}/edit">${esc(inv.invoice_no)}</a></td>
                     <td>${prettyDate(inv.issue_date)}</td>
                     <td>${prettyDate(inv.due_date)}</td>
                     <td class="num mono">${money(inv.total)}</td>
                     <td class="num mono">${money(inv.amount_paid)}</td>
                     <td class="num mono strong ${inv.balance > 0 ? 'due-amount' : ''}">${money(inv.balance)}</td>
                     <td>${statusPill(inv)}</td>
                     <td class="num"><a class="btn btn-sm" href="/invoice/${inv.id}" target="_blank" rel="noopener">Print</a></td>
                   </tr>`
                 )
                 .join('')}</tbody>
               <tfoot><tr>
                 <td colspan="3" class="strong">${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</td>
                 <td class="num mono strong">${money(invoices.reduce((s, i) => s + i.total, 0))}</td>
                 <td class="num mono strong">${money(invoices.reduce((s, i) => s + i.amount_paid, 0))}</td>
                 <td class="num mono strong due-amount">${money(invoices.reduce((s, i) => s + i.balance, 0))}</td>
                 <td colspan="2"></td>
               </tr></tfoot>
             </table></div>`
          : `<div class="empty"><div class="empty-title">No invoices yet</div>
               <div>Raise one and it will appear here.</div></div>`
      }
    </div>

    <div class="card">
      <div class="card-head"><h2>Payment breakdown</h2></div>
      ${
        payments.length
          ? `<div class="table-wrap"><table class="data">
               <thead><tr>
                 <th>Date</th><th>Against invoice</th><th>Method</th><th>Reference</th><th>Note</th><th class="num">Amount</th>
               </tr></thead>
               <tbody>${payments
                 .map(
                   (p) => `<tr>
                     <td>${prettyDate(p.paid_on)}</td>
                     <td><a href="#/invoice/${p.invoice_id}/edit">${esc(p.invoice_no)}</a></td>
                     <td>${esc(p.method) || '—'}</td>
                     <td class="mono">${esc(p.reference) || '—'}</td>
                     <td>${esc(p.note) || '—'}</td>
                     <td class="num mono strong">${money(p.amount)}</td>
                   </tr>`
                 )
                 .join('')}</tbody>
               <tfoot><tr>
                 <td colspan="5" class="strong">Total received</td>
                 <td class="num mono strong">${money(totals.paid)}</td>
               </tr></tfoot>
             </table></div>`
          : `<div class="empty"><div class="empty-title">No payments recorded</div>
               <div>Record one from an invoice and it will show up here.</div></div>`
      }
    </div>`;

  $('#edit-client').addEventListener('click', () =>
    clientModal(client, async () => {
      await loadReference();
      await viewClientStatement(id);
    })
  );
}

/* ------------------------------------------------------------ programmes */

async function viewProgrammes() {
  setPage('Programmes', 'Programmes clients can be charged a participation fee for', `
    <button class="btn btn-primary" id="add-programme">＋ Add programme</button>`);

  const render = async () => {
    const all = await api('/programmes?all=1');
    state.programmes = all.filter((p) => p.active);

    view.innerHTML = `<div class="card">${
      all.length
        ? `<div class="table-wrap"><table class="data">
             <thead><tr><th>Programme</th><th>Description</th><th class="num">Default charge</th><th>Status</th><th></th></tr></thead>
             <tbody>${all
               .map(
                 (p) => `<tr>
                   <td class="strong">${esc(p.name)}</td>
                   <td>${esc(p.description) || '—'}</td>
                   <td class="num mono">${money(p.default_rate)}</td>
                   <td><span class="pill ${p.active ? 'pill-paid' : 'pill-draft'}">${
                     p.active ? 'Active' : 'Inactive'
                   }</span></td>
                   <td class="num">
                     <button class="btn btn-sm" data-edit="${p.id}">Edit</button>
                     <button class="btn btn-sm btn-danger" data-del="${p.id}">Remove</button>
                   </td>
                 </tr>`
               )
               .join('')}</tbody>
           </table></div>`
        : `<div class="empty">
             <div class="empty-title">No programmes yet</div>
             <div>Add a programme and its participation charge to pick it on an invoice in one click.</div>
           </div>`
    }</div>`;

    $$('[data-edit]').forEach((b) =>
      b.addEventListener('click', () =>
        programmeModal(all.find((p) => p.id === Number(b.dataset.edit)), render)
      )
    );
    $$('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const programme = all.find((p) => p.id === Number(b.dataset.del));
        confirmDialog(
          'Remove programme',
          `Remove ${programme.name}? If it already appears on an invoice it is deactivated instead, so past invoices stay unchanged.`,
          async () => {
            const res = await api(`/programmes/${programme.id}`, { method: 'DELETE' });
            toast(res.deactivated ? 'Programme deactivated.' : 'Programme removed.');
            await render();
          },
          'Remove'
        );
      })
    );
  };

  $('#add-programme').addEventListener('click', () => programmeModal(null, render));
  await render();
}

function programmeModal(programme, onDone) {
  const p = programme || { name: '', description: '', default_rate: 0, active: 1 };
  modal({
    title: programme ? 'Edit programme' : 'Add programme',
    confirmLabel: programme ? 'Save changes' : 'Add programme',
    body: `
      <div class="field"><label>Programme name *</label><input type="text" id="p-name" value="${esc(p.name)}"></div>
      <div class="field">
        <label>Description</label>
        <input type="text" id="p-desc" value="${esc(p.description)}" placeholder="e.g. Participation charge per participant">
      </div>
      <div class="grid grid-2" style="margin-bottom:0">
        <div class="field" style="margin-bottom:0">
          <label>Default participation charge</label>
          <input type="number" step="0.01" min="0" id="p-rate" value="${p.default_rate}">
        </div>
        <div class="field" style="margin-bottom:0">
          <label>Status</label>
          <select id="p-active">
            <option value="1" ${p.active ? 'selected' : ''}>Active</option>
            <option value="0" ${p.active ? '' : 'selected'}>Inactive</option>
          </select>
        </div>
      </div>`,
    onConfirm: async (root, close) => {
      const body = {
        name: $('#p-name', root).value,
        description: $('#p-desc', root).value,
        default_rate: $('#p-rate', root).value,
        active: $('#p-active', root).value === '1',
      };
      if (programme) await api(`/programmes/${programme.id}`, { method: 'PUT', body });
      else await api('/programmes', { method: 'POST', body });
      close();
      toast(programme ? 'Programme updated.' : 'Programme added.');
      await onDone();
    },
  });
}

/* -------------------------------------------------------------- settings */

async function viewSettings() {
  setPage('Settings', 'Company details, invoice defaults and your admin account');
  const s = await api('/settings');
  state.settings = s;

  const text = (id, label, value, hint = '') => `
    <div class="field">
      <label>${label}</label>
      <input type="text" id="${id}" value="${esc(value)}">
      ${hint ? `<div class="hint">${hint}</div>` : ''}
    </div>`;

  view.innerHTML = `
    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h2>Company details on the invoice</h2></div>
        <div class="card-body">
          <div class="alert" id="s-error"></div>
          ${text('company_name', 'Company name', s.company_name)}
          ${text('company_tagline', 'Tagline', s.company_tagline)}
          <div class="field">
            <label>Address</label>
            <textarea id="company_address" rows="2">${esc(s.company_address)}</textarea>
          </div>
          <div class="grid grid-2">
            ${text('company_phone', 'Phone', s.company_phone)}
            ${text('company_email', 'Email', s.company_email)}
          </div>
          <div class="grid grid-2">
            ${text('company_website', 'Website', s.company_website)}
            ${text('company_bin', 'BIN / VAT reg. no', s.company_bin)}
          </div>
          <div class="field">
            <label>Payment details shown on invoices</label>
            <textarea id="payment_instructions" rows="4">${esc(s.payment_instructions)}</textarea>
          </div>
          <div class="field">
            <label>Default terms &amp; conditions</label>
            <textarea id="default_terms" rows="3">${esc(s.default_terms)}</textarea>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Footer note</label>
            <input type="text" id="footer_note" value="${esc(s.footer_note)}">
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><h2>Invoice defaults</h2></div>
          <div class="card-body">
            <div class="grid grid-2">
              ${text('invoice_prefix', 'Number prefix', s.invoice_prefix, 'Numbers look like PREFIX-YEAR-0001')}
              ${text('number_padding', 'Number padding', s.number_padding, 'Digits after the year')}
            </div>
            <div class="grid grid-2">
              ${text('next_number', 'Next number', s.next_number)}
              ${text('currency', 'Currency code', s.currency)}
            </div>
            <div class="grid grid-2" style="margin-bottom:0">
              ${text('tax_label', 'Tax label', s.tax_label, 'e.g. VAT, AIT')}
              ${text('tax_rate', 'Default tax rate (%)', s.tax_rate)}
            </div>
            <div class="row row-end" style="margin-top:14px">
              <button class="btn btn-primary" id="save-settings">Save settings</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Admin account</h2></div>
          <div class="card-body">
            <div class="alert" id="a-error"></div>
            <div class="grid grid-2">
              ${text('admin_name', 'Name', state.admin.name)}
              ${text('admin_email', 'Email', state.admin.email)}
            </div>
            <div class="row row-end" style="margin-bottom:18px">
              <button class="btn btn-sm" id="save-profile">Update profile</button>
            </div>

            <div class="field">
              <label>Current password</label>
              <input type="password" id="pw-current" autocomplete="current-password">
            </div>
            <div class="field">
              <label>New password</label>
              <input type="password" id="pw-new" autocomplete="new-password">
              <div class="hint">At least 8 characters.</div>
            </div>
            <div class="row row-end">
              <button class="btn btn-sm" id="save-password">Change password</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const settingKeys = [
    'company_name', 'company_tagline', 'company_address', 'company_phone', 'company_email',
    'company_website', 'company_bin', 'payment_instructions', 'default_terms', 'footer_note',
    'invoice_prefix', 'number_padding', 'next_number', 'currency', 'tax_label', 'tax_rate',
  ];

  $('#save-settings').addEventListener('click', async () => {
    const body = {};
    settingKeys.forEach((k) => (body[k] = $(`#${k}`).value));
    try {
      state.settings = await api('/settings', { method: 'PUT', body });
      toast('Settings saved.');
    } catch (err) {
      $('#s-error').textContent = err.message;
    }
  });

  $('#save-profile').addEventListener('click', async () => {
    try {
      const res = await api('/auth/profile', {
        method: 'POST',
        body: { name: $('#admin_name').value, email: $('#admin_email').value },
      });
      state.admin = res.admin;
      renderWho();
      toast('Profile updated.');
    } catch (err) {
      $('#a-error').textContent = err.message;
    }
  });

  $('#save-password').addEventListener('click', async () => {
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { current_password: $('#pw-current').value, new_password: $('#pw-new').value },
      });
      $('#pw-current').value = '';
      $('#pw-new').value = '';
      toast('Password changed.');
    } catch (err) {
      $('#a-error').textContent = err.message;
    }
  });
}

/* =================================================================== router */

const ROUTES = [
  [/^#?\/?dashboard?$/, () => viewDashboard(), 'dashboard'],
  [/^#\/invoices$/, () => viewInvoices(), 'invoices'],
  [/^#\/invoice\/new(\?client=(\d+))?$/, (m) => viewInvoiceForm(null, m[2]), 'invoice-new'],
  [/^#\/invoice\/(\d+)\/edit$/, (m) => viewInvoiceForm(m[1]), 'invoices'],
  [/^#\/clients$/, () => viewClients(), 'clients'],
  [/^#\/client\/(\d+)$/, (m) => viewClientStatement(m[1]), 'clients'],
  [/^#\/programmes$/, () => viewProgrammes(), 'programmes'],
  [/^#\/settings$/, () => viewSettings(), 'settings'],
];

function highlightNav(routeName) {
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === routeName));
}

async function router() {
  const hash = window.location.hash || '#/dashboard';
  const match = ROUTES.find(([re]) => re.test(hash));

  if (!match) {
    window.location.hash = '#/dashboard';
    return;
  }

  const [re, handler, navName] = match;
  highlightNav(navName);
  window.scrollTo(0, 0);

  try {
    await handler(hash.match(re));
  } catch (err) {
    view.innerHTML = `<div class="card"><div class="empty">
        <div class="empty-title">Could not load this page</div>
        <div>${esc(err.message)}</div>
      </div></div>`;
  }
}

function renderWho() {
  $('#who').innerHTML = `<strong>${esc(state.admin.name)}</strong>${esc(state.admin.email)}`;
}

async function boot() {
  try {
    const me = await api('/auth/me');
    state.admin = me.admin;
  } catch {
    window.location.href = '/login';
    return;
  }

  renderWho();
  await loadReference();

  $('#logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  window.addEventListener('hashchange', router);
  if (!window.location.hash) window.location.hash = '#/dashboard';
  await router();
}

boot();

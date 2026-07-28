/* Dreams of Bangladesh — printable invoice page.
   Renders entirely from the JSON API so the backend stays a pure data layer. */
'use strict';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');

const money = (n, currency) =>
  `${currency === 'BDT' ? '৳' : ''}${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function prettyDate(d) {
  if (!d) return '—';
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return esc(d);
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_LABEL = {
  paid: 'PAID',
  partial: 'PARTLY PAID',
  unpaid: 'UNPAID',
  draft: 'DRAFT',
  cancelled: 'CANCELLED',
};

async function get(path) {
  const res = await fetch(`/api${path}`);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Not signed in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load the invoice.');
  return data;
}

function renderInvoice(invoice, settings) {
  const cur = invoice.currency || 'BDT';
  const balance = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
  const status = invoice.status || 'unpaid';

  const rows = invoice.items
    .map((it, i) => {
      const tag =
        it.kind === 'programme'
          ? '<span class="tag tag-programme">Programme</span>'
          : it.kind === 'product'
          ? '<span class="tag tag-product">Product</span>'
          : '<span class="tag tag-service">Service</span>';
      return `
        <tr>
          <td class="c-num">${i + 1}</td>
          <td class="c-desc">
            <div class="desc-main">${esc(it.description)} ${tag}</div>
            ${it.details ? `<div class="desc-sub">${nl2br(it.details)}</div>` : ''}
          </td>
          <td class="c-qty">${Number(it.quantity).toLocaleString('en-US')}</td>
          <td class="c-rate">${money(it.rate, cur)}</td>
          <td class="c-amt">${money(it.amount, cur)}</td>
        </tr>`;
    })
    .join('');

  const discountRow =
    invoice.discount_amount > 0
      ? `<tr>
           <td>Discount${invoice.discount_type === 'percent' ? ` (${invoice.discount_value}%)` : ''}</td>
           <td class="v">− ${money(invoice.discount_amount, cur)}</td>
         </tr>`
      : '';

  const taxRow =
    invoice.tax_rate > 0
      ? `<tr>
           <td>${esc(invoice.tax_label || 'VAT')} (${invoice.tax_rate}%)</td>
           <td class="v">${money(invoice.tax_amount, cur)}</td>
         </tr>`
      : '';

  const paidRow =
    invoice.amount_paid > 0
      ? `<tr><td>Amount paid</td><td class="v">− ${money(invoice.amount_paid, cur)}</td></tr>`
      : '';

  const balanceRow =
    invoice.amount_paid > 0
      ? `<tr class="balance"><td>Balance due</td><td class="v">${money(balance, cur)}</td></tr>`
      : '';

  // Every payment against this invoice, so the client can see exactly what
  // they have paid, when, and what is still outstanding.
  const payments = invoice.payments || [];
  const paymentsBlock = payments.length
    ? `<div class="block">
         <div class="block-label">Payments received</div>
         <table class="payments">
           <thead>
             <tr><th>Date</th><th>Method</th><th>Reference</th><th class="p-amt">Amount (${esc(cur)})</th></tr>
           </thead>
           <tbody>
             ${payments
               .map(
                 (p) => `<tr>
                   <td>${prettyDate(p.paid_on)}</td>
                   <td>${esc(p.method) || '—'}</td>
                   <td>${esc(p.reference) || '—'}${
                     p.note ? `<div class="p-note">${esc(p.note)}</div>` : ''
                   }</td>
                   <td class="p-amt">${money(p.amount, cur)}</td>
                 </tr>`
               )
               .join('')}
           </tbody>
           <tfoot>
             <tr>
               <td colspan="3">Total paid</td>
               <td class="p-amt">${money(invoice.amount_paid, cur)}</td>
             </tr>
             <tr class="${balance > 0 ? 'p-due' : 'p-settled'}">
               <td colspan="3">${balance > 0 ? 'Balance still due' : 'Settled in full'}</td>
               <td class="p-amt">${money(balance, cur)}</td>
             </tr>
           </tfoot>
         </table>
       </div>`
    : '';

  return `
    <div class="sheet">
      <div class="sheet-stripe"></div>

      <header class="head">
        <div class="brand">
          <img class="logo" src="/assets/dob-logo.png" alt="${esc(settings.company_name)}">
          <div class="brand-meta">
            <div class="brand-name">${esc(settings.company_name)}</div>
            ${settings.company_tagline ? `<div class="brand-tag">${esc(settings.company_tagline)}</div>` : ''}
          </div>
        </div>
        <div class="doc">
          <div class="doc-title">INVOICE</div>
          <div class="doc-no">${esc(invoice.invoice_no)}</div>
          <div class="stamp stamp-${esc(status)}">${STATUS_LABEL[status] || esc(status).toUpperCase()}</div>
        </div>
      </header>

      <section class="parties">
        <div class="party">
          <div class="party-label">From</div>
          <div class="party-name">${esc(settings.company_name)}</div>
          ${settings.company_address ? `<div>${nl2br(settings.company_address)}</div>` : ''}
          ${settings.company_phone ? `<div>${esc(settings.company_phone)}</div>` : ''}
          ${settings.company_email ? `<div>${esc(settings.company_email)}</div>` : ''}
          ${settings.company_website ? `<div>${esc(settings.company_website)}</div>` : ''}
          ${settings.company_bin ? `<div>BIN: ${esc(settings.company_bin)}</div>` : ''}
        </div>

        <div class="party">
          <div class="party-label">Billed to</div>
          <div class="party-name">${esc(invoice.client_name)}</div>
          ${invoice.client_org ? `<div>${esc(invoice.client_org)}</div>` : ''}
          ${invoice.client_address ? `<div>${nl2br(invoice.client_address)}</div>` : ''}
          ${invoice.client_phone ? `<div>${esc(invoice.client_phone)}</div>` : ''}
          ${invoice.client_email ? `<div>${esc(invoice.client_email)}</div>` : ''}
        </div>

        <div class="party dates">
          <div class="date-row"><span>Issue date</span><strong>${prettyDate(invoice.issue_date)}</strong></div>
          <div class="date-row"><span>Due date</span><strong>${prettyDate(invoice.due_date)}</strong></div>
          <div class="date-row total-chip">
            <span>Total ${esc(cur)}</span><strong>${money(invoice.total, cur)}</strong>
          </div>
        </div>
      </section>

      <table class="items">
        <thead>
          <tr>
            <th class="c-num">#</th>
            <th class="c-desc">Description</th>
            <th class="c-qty">Qty</th>
            <th class="c-rate">Rate (${esc(cur)})</th>
            <th class="c-amt">Amount (${esc(cur)})</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <section class="foot">
        <div class="foot-left">
          <div class="words">
            <div class="words-label">Amount in words</div>
            <div class="words-value">${esc(invoice.amount_in_words)}</div>
          </div>

          ${
            settings.payment_instructions
              ? `<div class="block">
                   <div class="block-label">Payment details</div>
                   <div class="block-body">${nl2br(settings.payment_instructions)}</div>
                 </div>`
              : ''
          }
          ${paymentsBlock}
          ${
            invoice.notes
              ? `<div class="block">
                   <div class="block-label">Notes</div>
                   <div class="block-body">${nl2br(invoice.notes)}</div>
                 </div>`
              : ''
          }
        </div>

        <div class="foot-right">
          <table class="totals">
            <tr><td>Subtotal</td><td class="v">${money(invoice.subtotal, cur)}</td></tr>
            ${discountRow}
            ${taxRow}
            <tr class="grand"><td>Total</td><td class="v">${money(invoice.total, cur)}</td></tr>
            ${paidRow}
            ${balanceRow}
          </table>

          <div class="sign">
            <div class="sign-line"></div>
            <div class="sign-label">Authorised signature</div>
            <div class="sign-org">${esc(settings.company_name)}</div>
          </div>
        </div>
      </section>

      ${
        invoice.terms
          ? `<section class="terms">
               <div class="block-label">Terms &amp; conditions</div>
               <div class="block-body">${nl2br(invoice.terms)}</div>
             </section>`
          : ''
      }

      <footer class="sheet-foot">
        <span>${esc(settings.footer_note)}</span>
        <span>${esc(invoice.invoice_no)}</span>
      </footer>
    </div>`;
}

(async function main() {
  const id = window.location.pathname.split('/').pop();
  const root = document.getElementById('sheet-root');

  try {
    const [invoice, settings] = await Promise.all([get(`/invoices/${id}`), get('/settings')]);

    root.innerHTML = renderInvoice(invoice, settings);
    document.title = `${invoice.invoice_no} — ${settings.company_name}`;
    document.getElementById('edit-link').href = `/app#/invoice/${invoice.id}/edit`;
    document.getElementById('print-btn').addEventListener('click', () => window.print());

    // Only reveal the toolbar once there is something worth printing.
    document.getElementById('toolbar').hidden = false;
  } catch (err) {
    root.innerHTML = `<div class="loading error">${esc(err.message)}</div>`;
  }
})();

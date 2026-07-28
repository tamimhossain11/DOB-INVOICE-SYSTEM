'use strict';

const { db } = require('./db');
const { deriveStatus, round2 } = require('./calc');

/**
 * The payments table is the source of truth for what a client has paid.
 * This recalculates the invoice's cached amount_paid and status from it, and
 * mirrors the most recent payment onto the invoice so the printed document can
 * still show a "payment received" line without querying the ledger.
 */
function recomputeInvoice(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;

  const paid = round2(
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = ?').get(
      invoiceId
    ).total
  );

  const latest = db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date(paid_on) DESC, id DESC LIMIT 1')
    .get(invoiceId);

  db.prepare(
    `UPDATE invoices
     SET amount_paid = ?, status = ?, payment_method = ?, payment_ref = ?, payment_date = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    paid,
    deriveStatus(invoice.status, invoice.total, paid),
    latest ? latest.method : '',
    latest ? latest.reference : '',
    latest ? latest.paid_on : '',
    invoiceId
  );

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}

function listPayments(invoiceId) {
  return db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date(paid_on), id')
    .all(invoiceId);
}

module.exports = { recomputeInvoice, listPayments };

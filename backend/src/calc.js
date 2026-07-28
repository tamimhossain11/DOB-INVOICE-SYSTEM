'use strict';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/**
 * Recomputes every money field on an invoice from its items.
 * Order of operations: subtotal -> discount -> tax on the discounted base.
 */
function computeTotals({ items, discount_type, discount_value, tax_rate, amount_paid }) {
  const priced = (items || []).map((it) => ({
    ...it,
    quantity: num(it.quantity),
    rate: num(it.rate),
    amount: round2(num(it.quantity) * num(it.rate)),
  }));

  const subtotal = round2(priced.reduce((s, it) => s + it.amount, 0));

  const dValue = Math.max(0, num(discount_value));
  let discount_amount =
    discount_type === 'percent' ? round2((subtotal * Math.min(dValue, 100)) / 100) : round2(dValue);
  discount_amount = Math.min(discount_amount, subtotal);

  const taxable = round2(subtotal - discount_amount);
  const rate = Math.max(0, num(tax_rate));
  const tax_amount = round2((taxable * rate) / 100);
  const total = round2(taxable + tax_amount);

  const paid = Math.max(0, round2(num(amount_paid)));
  const balance = round2(total - paid);

  return { items: priced, subtotal, discount_amount, tax_amount, total, amount_paid: paid, balance };
}

/**
 * Payment status is derived from the numbers, except for the two states the
 * admin sets deliberately (draft, cancelled), which always win.
 */
function deriveStatus(requested, total, paid) {
  if (requested === 'draft' || requested === 'cancelled') return requested;
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

module.exports = { round2, num, computeTotals, deriveStatus };

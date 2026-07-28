'use strict';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigit(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

function threeDigit(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigit(rest));
  return parts.join(' ');
}

/**
 * South Asian numbering (lakh / crore) — matches how amounts are read in
 * Bangladesh, e.g. 125000 -> "One Lakh Twenty Five Thousand".
 */
function intToWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  if (crore) parts.push(`${intToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigit(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigit(thousand)} Thousand`);
  if (rest) parts.push(threeDigit(rest));
  return parts.join(' ');
}

/** "1250.50", "BDT" -> "Taka One Thousand Two Hundred Fifty and 50/100 only" */
function amountInWords(amount, currency = 'BDT') {
  const value = Math.max(0, Math.round((Number(amount) || 0) * 100) / 100);
  const whole = Math.floor(value);
  const paisa = Math.round((value - whole) * 100);
  const unit = currency === 'BDT' ? 'Taka' : currency;

  let out = `${unit} ${intToWords(whole)}`;
  if (paisa > 0) out += ` and ${String(paisa).padStart(2, '0')}/100`;
  return `${out} only`;
}

module.exports = { amountInWords, intToWords };

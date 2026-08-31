// Stable identity for a money row across statement re-uploads.
//
// Ledger rows born from bank statements (`entry_source='bank_statement'`) are
// soft-deleted and recreated under NEW ids when a statement is deleted or
// re-uploaded, so report dismissals and month overrides cannot key on the row
// id — they key on this fingerprint, with the id stored beside it for display
// only and allowed to go stale.
//
// Shape:  e|2026-03-04|1250.00|facebk      (expense)
//         i|2026-03-04|500.00|distrokid    (income)
//
// The payee key falls back to lower-trim when descriptor normalization
// empties it — a payee-less row must still fingerprint to SOMETHING, or its
// dismissal matches nothing and quietly returns (the reference app shipped
// exactly that bug on rows identified only by email).

const { normalizeBankPayee } = require('./normalizeBankPayee');

const ymd = (d) => {
  if (!d) return '';
  if (d instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return String(d).slice(0, 10);
};

const payeeKey = (raw) => {
  const s = String(raw || '');
  return normalizeBankPayee(s) || s.toLowerCase().trim();
};

const fingerprintOfExpense = (r) =>
  ['e', ymd(r.payment_date), (Number(r.amount) || 0).toFixed(2), payeeKey(r.payee)].join('|');

const fingerprintOfIncome = (r) =>
  ['i', ymd(r.income_date), (Number(r.amount) || 0).toFixed(2),
    payeeKey(r.source || r.description || r.artist_name)].join('|');

module.exports = { fingerprintOfExpense, fingerprintOfIncome, payeeKey, ymd };

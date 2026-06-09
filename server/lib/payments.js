// Payment terms → number of days until due. Used to derive a scheduled
// payment (due) date from an invoice date.
const TERM_DAYS = {
  'Due on receipt': 0,
  'Net 7': 7,
  'Net 14': 14,
  'Net 30': 30,
  'Net 45': 45,
  'Net 60': 60,
  'Net 90': 90,
};

const PAYMENT_TERMS = Object.keys(TERM_DAYS);

// Compute a due date (YYYY-MM-DD) from an invoice date + terms. Returns null
// if there's no invoice date or the terms aren't recognized.
function computeDueDate(invoiceDate, terms) {
  if (!invoiceDate) return null;
  const days = TERM_DAYS[terms];
  if (days === undefined) return null;
  const d = new Date(invoiceDate);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { PAYMENT_TERMS, TERM_DAYS, computeDueDate };

/**
 * Payment terms, and the due date they imply — ONE definition.
 *
 * ── Why the server owns this ──
 * The create-invoice page shows a live preview of the document before it is
 * saved, so both sides need the date. Computing it in each would put two
 * implementations of the same arithmetic on opposite sides of a timezone; the
 * failure would be the worst kind, because the preview a person reads and the
 * date the client is billed by would differ by a day and nothing would say so.
 *
 * So the client ASKS (`GET /api/invoices/due-date`) rather than computing, and
 * the write recomputes from the stored terms regardless of what was posted.
 * The value on the wire is a proposal; this file is the authority.
 *
 * ── Date-only arithmetic, deliberately ──
 * Everything here is 'YYYY-MM-DD' in and out, added through Date.UTC. No local
 * Date objects: `new Date('2026-08-19')` is midnight UTC but prints as the
 * 18th in Los Angeles. A due date that shifts by a day when the server moves
 * is not a due date.
 *
 * ── Multi-tenant timezone ──
 * The reference app pinned America/Los_Angeles. Cadence is multi-tenant, so
 * the business timezone is per-label (`labels.settings.business_tz`), falling
 * back to the same default. Every function that needs "today" takes a tz.
 */

const TERMS = [
  { label: 'Due on receipt', days: 0, custom: false },
  { label: 'Net 15', days: 15, custom: false },
  { label: 'Net 30', days: 30, custom: false },
  { label: 'Net 45', days: 45, custom: false },
  { label: 'Net 60', days: 60, custom: false },
  { label: 'Net 90', days: 90, custom: false },
  // A negotiated date that is not N days out. The caller supplies it; nothing
  // is derived, and the label still records that somebody chose it by hand.
  { label: 'Custom', days: null, custom: true },
];

const DEFAULT_TERMS = 'Net 30';
const DEFAULT_BUSINESS_TZ = 'America/Los_Angeles';

const byLabel = new Map(TERMS.map((t) => [t.label.toLowerCase(), t]));
/** The term record, or null when the label is not one we offer. */
const termFor = (label) => byLabel.get(String(label || '').trim().toLowerCase()) || null;

// One formatter per timezone — Intl.DateTimeFormat construction is expensive
// and the set of tenant timezones is tiny. en-CA because its numeric format IS
// 'YYYY-MM-DD', the same shape every other date in this file is in.
const dayFmtCache = new Map();
function dayFmt(tz) {
  const zone = tz || DEFAULT_BUSINESS_TZ;
  if (!dayFmtCache.has(zone)) {
    try {
      dayFmtCache.set(zone, new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      }));
    } catch {
      // A garbage tz stored in settings must not take the invoice page down.
      dayFmtCache.set(zone, dayFmt(DEFAULT_BUSINESS_TZ));
    }
  }
  return dayFmtCache.get(zone);
}

/**
 * The 'YYYY-MM-DD' an instant falls on in the company's timezone. An invoice
 * raised on the evening of the 18th in Los Angeles is dated the 18th
 * everywhere, including for a client reading it in Berlin.
 */
function businessDay(v, tz) {
  const d = v instanceof Date ? v : new Date(v == null ? Date.now() : v);
  if (Number.isNaN(d.getTime())) return null;
  return dayFmt(tz).format(d);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isDay = (s) => DATE_RE.test(String(s || ''));

/** Add whole days to a 'YYYY-MM-DD', in UTC, returning the same shape. */
function addDays(day, n) {
  const m = DATE_RE.exec(String(day || ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + (Number(n) || 0) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The due date an invoice carries.
 *
 * @param {string} terms        a label from TERMS
 * @param {string} invoiceDate  'YYYY-MM-DD' — the invoice's own date, not today's
 * @param {string} customDate   'YYYY-MM-DD', required when terms are Custom
 * @returns {{ terms, due_date, due_by, error }} `due_date` is null for Due on
 *          receipt: there is no date to state, and inventing one would put a
 *          deadline on a document that does not have one.
 */
function resolveDue(terms, invoiceDate, customDate) {
  const t = termFor(terms) || termFor(DEFAULT_TERMS);
  const label = t.label;
  if (!isDay(invoiceDate)) return { terms: label, due_date: null, due_by: null, error: 'invoice date must be YYYY-MM-DD' };
  if (t.custom) {
    if (!isDay(customDate)) return { terms: label, due_date: null, due_by: null, error: 'a custom due date is required' };
    if (customDate < invoiceDate) return { terms: label, due_date: null, due_by: null, error: 'the due date cannot be before the invoice date' };
    return { terms: label, due_date: customDate, due_by: printed(label, customDate), error: null };
  }
  if (t.days === 0) return { terms: label, due_date: null, due_by: 'UPON RECEIPT', error: null };
  const due = addDays(invoiceDate, t.days);
  return { terms: label, due_date: due, due_by: printed(label, due), error: null };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * What the invoice PRINTS. Both the date and the terms, because a client
 * reading "Net 30" has to count and a client reading only a date cannot check
 * it. Formatted from the string parts, never through toLocaleDateString —
 * that reads the server's locale and timezone, and would render a different
 * day for the same stored value depending on where the process runs.
 */
function printed(terms, dueDate) {
  if (!isDay(dueDate)) return 'UPON RECEIPT';
  const [y, m, d] = dueDate.split('-');
  const long = `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
  const t = termFor(terms);
  return t && !t.custom && t.days > 0 ? `${long} (${t.label})` : long;
}

module.exports = { TERMS, DEFAULT_TERMS, DEFAULT_BUSINESS_TZ, termFor, resolveDue, printed, addDays, isDay, businessDay };

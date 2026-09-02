// Bookkeeper Reconcile — diff the ledger against an outside bookkeeper's
// spreadsheet.
//
// SCOPE, deliberately narrow. This is NOT bank reconciliation: /bank-matching
// reconciles bank statement lines against the ledger, and nothing in this file
// touches `bank_transactions`, `lib/bankReconcile.js` or its scoring. The third
// dataset here is a file a human uploads — an outside firm's working copy of
// what they believe is outstanding — and the deliverable is a list of the
// places the two disagree. Nothing is persisted: the diff is computed per
// upload and thrown away, because a saved diff of a file we do not control
// goes stale the moment either side edits a row.
//
// The matching rules live in `diffLedger`, which is pure — no database, no
// ExcelJS — so `server/scripts/finance-fixtures.cjs` can hold them.

const { vendorsMatch } = require('./vendorMatch');
const { normalizeInvoiceNum } = require('./normalizeInvoiceNum');

// Order is the tab order in the workbook AND the tile order on the page.
// Action-first: the categories a bookkeeper must DO something about lead, and
// `matched` sinks to the end so a green result never opens on itself.
const DIFF_CATEGORIES = [
  { key: 'amount_mismatch', label: 'Amount mismatches', priority: 'HIGH',
    action: 'Reconcile each row — confirm the billed amount against the invoice document.' },
  { key: 'paid_status_mismatch', label: 'Paid-status mismatches', priority: 'HIGH',
    action: 'One side thinks this is settled and the other does not. Confirm against the bank before paying again.' },
  { key: 'missing_from_ledger', label: 'Missing on Cadence', priority: 'HIGH',
    action: 'The bookkeeper is tracking an invoice the ledger has never seen. Chase the document, or confirm it was cancelled.' },
  { key: 'paid_date_mismatch', label: 'Paid-date mismatches', priority: 'MEDIUM',
    action: 'Both sides agree it is paid but not when. Usually a posting-date vs value-date difference.' },
  { key: 'missing_from_bookkeeper', label: 'Missing on the bookkeeper sheet', priority: 'MEDIUM',
    action: 'The ledger holds this invoice and the workbook does not. Send it across so their outstanding list is complete.' },
  { key: 'vendor_name_variation', label: 'Vendor name variations', priority: 'LOW',
    action: 'Same invoice, same amount, different spelling. Informational — pick one spelling if you want the next diff quieter.' },
  { key: 'no_invoice_num', label: 'No invoice number', priority: 'LOW',
    action: 'These rows cannot be matched at all. Ask the bookkeeper to add the invoice number.' },
  { key: 'matched', label: 'Clean', priority: 'INFO',
    action: 'No disagreement found. Listed so the report accounts for every row.' },
];
const CATEGORY_KEYS = DIFF_CATEGORIES.map((c) => c.key);

// Money agreement tolerance. A cent, not a dollar: rounding drift is a cent,
// and anything larger is a real disagreement the bookkeeper wants to see.
const AMOUNT_TOLERANCE = 0.01;

const ymd = (v) => {
  if (!v) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The whole diff, as a pure function.
 *
 * @param bookkeeperRows [{ sheet, rowNum, vendor, payee_name, invoice, amount,
 *   paid_date, paid_amount, invoice_date, artist, description }]
 * @param ledgerRows [{ id, payee, invoice_number, invoice_date, payment_date,
 *   payment_status, amount, family_amount, currency, usd, artist, song,
 *   description }]  — family roots only; `family_amount` is parent + live
 *   children so a split invoice compares at its full billed amount.
 * @param opts { sheetYears: number[], weekEnding: 'YYYY-MM-DD'|null }
 */
function diffLedger(bookkeeperRows = [], ledgerRows = [], opts = {}) {
  const sheetYears = new Set(opts.sheetYears || []);
  const weekEnding = ymd(opts.weekEnding) || null;

  // Index the ledger by normalized invoice number. Empty and all-zero keys are
  // dropped: "0" and "" are not invoice numbers, and indexing them would make
  // every unnumbered row a candidate for every other.
  const byInvoice = new Map();
  for (const d of ledgerRows) {
    const n = normalizeInvoiceNum(d.invoice_number);
    if (!n || n === '0') continue;
    if (!byInvoice.has(n)) byInvoice.set(n, []);
    byInvoice.get(n).push(d);
  }

  const claimed = new Set();
  const diffs = [];

  for (const b of bookkeeperRows) {
    const normInv = normalizeInvoiceNum(b.invoice);
    if (!normInv || normInv === '0') {
      diffs.push({ kind: 'no_invoice_num', sheet: b.sheet, row_num: b.rowNum, bookkeeper: b, ledger: null,
        issues: ['This row has no invoice number, so it cannot be matched to anything.'] });
      continue;
    }
    const candidates = byInvoice.get(normInv) || [];
    if (!candidates.length) {
      diffs.push({ kind: 'missing_from_ledger', sheet: b.sheet, row_num: b.rowNum, bookkeeper: b, ledger: null,
        issues: ['Invoice number does not appear anywhere in the ledger.'] });
      continue;
    }

    // Strongest vendor match wins. The sheet may carry both a VENDOR and a
    // PAYEE NAME column (they disagree often enough to be worth trying both).
    let best = null;
    for (const c of candidates) {
      const m1 = vendorsMatch(b.vendor, c.payee);
      const m2 = b.payee_name ? vendorsMatch(b.payee_name, c.payee) : null;
      const m = m2 && m2.score > m1.score ? m2 : m1;
      if (!best || m.score > best.match.score) best = { row: c, match: m };
    }

    // An invoice-number hit with a NON-matching vendor is a coincidental
    // collision, not a match. Two vendors numbering from 1 collide constantly.
    // The ledger row is left UNCLAIMED so it can still surface in the reverse
    // direction — silently consuming it would hide a real gap on both sides.
    if (!best.match.match) {
      const note = !String(b.vendor || '').trim()
        ? `Invoice ${b.invoice} exists in the ledger for "${best.row.payee}", but this row names no vendor — the match could not be confirmed.`
        : `Invoice number exists in the ledger but under a different vendor ("${best.row.payee}" vs "${b.vendor}"). Treated as not found — check whether either side is wrong.`;
      diffs.push({ kind: 'missing_from_ledger', sheet: b.sheet, row_num: b.rowNum, bookkeeper: b, ledger: null, issues: [note] });
      continue;
    }

    claimed.add(best.row.id);
    const issues = [];
    if (best.match.score < 1.0) {
      issues.push(`Vendor names differ: bookkeeper "${b.vendor}" vs ledger "${best.row.payee}" (${best.match.label.toLowerCase()}).`);
    }

    // Amounts are compared NATIVE to NATIVE and never converted. Both sides are
    // recording what one document says; converting either would invent a
    // disagreement that the paper does not have. The currency is named in the
    // message so a unit difference is never read as an error.
    const cur = String(best.row.currency || 'USD').toUpperCase();
    const ledgerAmount = num(best.row.family_amount ?? best.row.amount);
    const bookAmount = num(b.amount);
    // Round the GAP to cents before comparing. `100.01 - 100` is
    // 0.010000000000005 in binary floating point, so a bare `> 0.01` reports a
    // one-cent rounding difference as a disagreement on every such row.
    const gap = ledgerAmount == null || bookAmount == null ? null : Math.round(Math.abs(bookAmount - ledgerAmount) * 100) / 100;
    if (gap != null && gap > AMOUNT_TOLERANCE) {
      issues.push(`Amount mismatch: bookkeeper ${bookAmount.toFixed(2)} vs ledger ${ledgerAmount.toFixed(2)} ${cur}.`);
      if (cur !== 'USD') {
        issues.push(`The ledger holds this invoice in ${cur}. If the workbook records USD, the gap is a unit difference rather than an error.`);
      }
      if (best.row.family_amount != null && Number(best.row.family_amount) !== Number(best.row.amount)) {
        issues.push('The ledger amount shown is the whole split family (parent + live children), which is what was billed.');
      }
    }

    // The bookkeeper considers a row paid when it carries a paid date or a
    // positive paid amount; the ledger's truth is payment_status.
    const bookPaid = !!String(b.paid_date || '').trim() || (num(b.paid_amount) != null && num(b.paid_amount) > 0);
    const ledgerPaid = String(best.row.payment_status || '').toLowerCase() === 'paid';
    if (bookPaid !== ledgerPaid) {
      issues.push(`Paid status differs: bookkeeper says ${bookPaid ? 'PAID' : 'unpaid'}, ledger says ${ledgerPaid ? 'PAID' : 'unpaid'}.`);
    } else if (bookPaid && ledgerPaid) {
      // Only meaningful when both sides agree it is settled.
      const bd = ymd(b.paid_date);
      const dd = ymd(best.row.payment_date);
      if (bd && dd && bd !== dd) issues.push(`Paid date differs: bookkeeper ${bd} vs ledger ${dd}.`);
    }

    // ONE bucket per row, strongest signal first — a row in three categories is
    // a row worked three times.
    let kind = 'matched';
    if (issues.some((i) => i.startsWith('Amount mismatch'))) kind = 'amount_mismatch';
    else if (issues.some((i) => i.startsWith('Paid status'))) kind = 'paid_status_mismatch';
    else if (issues.some((i) => i.startsWith('Paid date'))) kind = 'paid_date_mismatch';
    else if (issues.some((i) => i.startsWith('Vendor names'))) kind = 'vendor_name_variation';

    diffs.push({
      kind, sheet: b.sheet, row_num: b.rowNum, bookkeeper: b, ledger: best.row,
      vendor_match_tier: best.match.tier, vendor_match_label: best.match.label,
      vendor_match_reason: best.match.reason, issues,
    });
  }

  // ── Reverse direction, noise-capped twice ─────────────────────────────────
  // Without both caps this bucket drowns the report: it would list every
  // invoice the bookkeeper was never engaged for, plus everything filed since
  // they took their snapshot.
  let outsideYears = 0;
  let afterSnapshot = 0;
  for (const d of ledgerRows) {
    if (claimed.has(d.id)) continue;
    if (sheetYears.size) {
      const src = ymd(d.invoice_date) || ymd(d.payment_date);
      const year = src ? Number(src.slice(0, 4)) : null;
      // Falls OPEN when no year could be read from either side.
      if (year && !sheetYears.has(year)) { outsideYears++; continue; }
    }
    if (weekEnding) {
      const inv = ymd(d.invoice_date);
      if (inv && inv > weekEnding) { afterSnapshot++; continue; }
    }
    diffs.push({ kind: 'missing_from_bookkeeper', sheet: null, row_num: null, bookkeeper: null, ledger: d,
      issues: ['The ledger holds this invoice; the workbook does not.'] });
  }

  const counts = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
  for (const r of diffs) counts[r.kind] = (counts[r.kind] || 0) + 1;

  return {
    counts,
    diffs,
    suppressed: { outside_sheet_years: outsideYears, after_week_ending: afterSnapshot },
  };
}

// Dollars at stake, defined per category rather than as one formula — "the
// amount" means a different thing for a mismatch (the gap) than for a row only
// one side has (the whole invoice). USD-equivalent is used wherever the ledger
// supplies one; a bookkeeper-only row has no currency, so its sheet figure is
// taken at face value. Both facts are disclosed on the report.
function rowDollarDelta(d) {
  const led = d.ledger ? (num(d.ledger.usd) ?? num(d.ledger.family_amount) ?? num(d.ledger.amount) ?? 0) : null;
  const book = d.bookkeeper ? (num(d.bookkeeper.amount) ?? 0) : null;
  switch (d.kind) {
    case 'amount_mismatch': {
      const ledNative = num(d.ledger?.family_amount) ?? num(d.ledger?.amount) ?? 0;
      return Math.abs((book ?? 0) - ledNative);
    }
    case 'missing_from_ledger':
      return Math.abs(book ?? 0);
    case 'missing_from_bookkeeper':
      return Math.abs(led ?? 0);
    case 'paid_status_mismatch':
      return Math.abs(led ?? book ?? 0);
    default:
      return 0;
  }
}

// Top vendors by money at stake — where to start, when the report is long.
function topVendors(diffs, limit = 8) {
  const by = new Map();
  for (const d of diffs) {
    const at = rowDollarDelta(d);
    if (at <= 0) continue;
    const name = String(d.ledger?.payee || d.bookkeeper?.vendor || '').trim() || 'Unnamed';
    const key = name.toLowerCase();
    if (!by.has(key)) by.set(key, { vendor: name, at_stake: 0, rows: 0 });
    const v = by.get(key);
    v.at_stake += at;
    v.rows += 1;
  }
  return Array.from(by.values())
    .map((v) => ({ ...v, at_stake: Math.round(v.at_stake * 100) / 100 }))
    .sort((a, b) => b.at_stake - a.at_stake)
    .slice(0, limit);
}

module.exports = {
  DIFF_CATEGORIES, CATEGORY_KEYS, AMOUNT_TOLERANCE,
  diffLedger, rowDollarDelta, topVendors, ymd,
};

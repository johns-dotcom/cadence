// Recoupment rules — ONE definition of "what counts", shared by the
// Recoupments index, the artist detail, Planning and Statements.
//
// Two things live here that were previously restated (or missing) per handler:
//
//   1. The row gate. A recoupable cost is an APPROVED, live, family-root row
//      that somebody decided was recoupable. `recoupable BOOLEAN DEFAULT TRUE`
//      means a bank-born row inherits "recoupable" from a column default, not
//      from a decision — and bookDebitAsEntry writes those rows approved+Paid.
//      In the reference app that put 1,972 rows / $3,101,837 of unvetted spend
//      on artists' cards. `recoupReviewedSql` is the gate: a statement-born row
//      is admitted only once somebody ANSWERED the question (POST
//      /recoupments/review), which is also where its artist gets set.
//
//   2. The four bank-evidence states, mirroring client/src/utils/recoupState.js
//      character for character. A row must not read "verified" on one screen
//      and "unverified" on another.

const PRIORITIES = ['high', 'medium', 'low'];

/**
 * Canonicalize a priority tag. Returns 'high'|'medium'|'low' for anything that
 * names one, null for a clear, and `undefined` for a value that names nothing —
 * which the caller must reject rather than store. Priority drives subtabs and
 * their counts; a free-text value creates a band nobody can select.
 */
function normalizePriority(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (PRIORITIES.includes(s)) return s;
  const short = { h: 'high', m: 'medium', l: 'low' }[s];
  return short || undefined;
}

/** Statement-born rows enter the recoupment surfaces only once answered. */
const recoupReviewedSql = (e = 'e') =>
  `NOT (COALESCE(${e}.entry_source, '') = 'bank_statement' AND COALESCE(${e}.recoup_reviewed, FALSE) = FALSE)`;

/**
 * The shared WHERE body for "a live recoupable cost". Label scoping stays at
 * the call site (it is the caller's parameter, never interpolated here).
 * `parent_id IS NULL` keeps a split family counted once — children carry the
 * slices and the root carries the family total.
 */
const recoupBaseSql = (e = 'e') => `${e}.recoupable = TRUE
  AND COALESCE(${e}.status, 'approved') = 'approved'
  AND (${e}.deleted = false OR ${e}.deleted IS NULL)
  AND (${e}.voided = false OR ${e}.voided IS NULL)
  AND ${e}.parent_id IS NULL
  AND ${recoupReviewedSql(e)}`;

// ── The four states ─────────────────────────────────────────────────────────
// verified            a ready statement shows the payment — provable.
// awaiting_statement  paid, and no ready statement covers the date yet.
// unverified          paid, a statement DOES cover the date, no line matches.
// unpaid              nothing left the bank.
function recoupStateOf(row) {
  if (row && row.bank_evidence) return 'verified';
  if (!row || row.payment_status !== 'Paid') return 'unpaid';
  return row.bank_expected ? 'unverified' : 'awaiting_statement';
}

const RECOUP_COUNTED = ['verified', 'awaiting_statement'];
const recoupCounted = (row) => RECOUP_COUNTED.includes(recoupStateOf(row));
const bankUnverified = (row) => recoupStateOf(row) === 'unverified';

/**
 * The bank proves it and nobody claimed it. This is the only set where a bulk
 * "upload for recoupment" is safe to offer as one button — every member has a
 * statement line behind the claim.
 */
const isProvableUnclaimed = (row) => recoupStateOf(row) === 'verified' && !row.ufr;

/**
 * Best display spelling for a bucket of rows that normalized to one key:
 * the most-used spelling, ties broken by the longest (which keeps punctuation
 * and casing rather than the flattened variant).
 */
function bestSpelling(names) {
  const counts = new Map();
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (!n) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  let best = null;
  let bestN = -1;
  for (const [n, c] of counts) {
    if (c > bestN || (c === bestN && n.length > (best || '').length)) { best = n; bestN = c; }
  }
  return best;
}

module.exports = {
  PRIORITIES, normalizePriority,
  recoupReviewedSql, recoupBaseSql,
  recoupStateOf, RECOUP_COUNTED, recoupCounted, bankUnverified, isProvableUnclaimed,
  bestSpelling,
};

// Bank evidence for a ledger row — "did this payment actually leave the bank?"
//
// The statements subsystem already knows this; these SQL fragments let any
// expense list endpoint carry the answer (Ledger / Payments / Artist Budgets /
// Recoupments) without each one hand-rolling the join.
//
// Two derived fields:
//   bank_evidence — the matching bank transaction as JSON, or NULL. Matches
//                   are recorded against the FAMILY ROOT (the matcher only
//                   considers `parent_id IS NULL` rows — see candidates() in
//                   lib/bankReconcile.js), so children resolve through
//                   COALESCE(parent_id, id) and a split inherits its parent's
//                   evidence.
//   bank_expected — whether a ready statement SHOULD have shown this payment:
//                   its period covers the payment date (± settle lag) and the
//                   account is method-compatible.
//
// Both key off `payment_date` ALONE — an unpaid row is never "expected" on a
// statement, and scheduled_payment_date fallbacks contribute nothing but type
// hazards (the reference app broke every list endpoint on a
// COALESCE(date, text) here).
//
// `bank_evidence IS NULL` alone is not a problem — the statement may simply
// not be uploaded yet. Only paid AND no-evidence AND expected is the real
// "paid, no bank match" discrepancy.
//
// ── Multi-tenant deltas from the reference implementation ──
// Every subquery is label-scoped through the expense alias's own label_id, so
// the fragments stay correct inside any label-scoped outer query. Method
// compatibility is built per label from `labels.bank_accounts` (see
// accountsFor in lib/bankReconcile.js) instead of a hardcoded bofa/paypal
// rule; account keys and method names are user-configurable JSONB and are
// escaped before interpolation.
//
// ── The PayPal trap (keep in sync with the funding-pair logic) ──
// Every PayPal payment is bank-funded, so it appears on BOTH statements: the
// PayPal debit and the bank pull that funded it. The funding-pair flow
// dismisses the bank leg and keeps the PayPal side canonical, so the match
// lives on the PayPal transaction. Method compatibility is what stops a
// naive "is there a bank debit for this?" check from reporting every
// PayPal-funded invoice as unverified.

// Settle lag: a ledger payment date sits 1-3 business days off the bank date,
// so a statement period counts as covering it with a 3-day skirt either side.
const SETTLE_LAG_DAYS = 3;

const esc = (s) => String(s).replace(/'/g, "''");

// ── One payment can settle several invoices ─────────────────────────────────
// `bank_transactions.matched_expense_id` holds ONE invoice — the primary —
// while `bank_txn_invoice_links` holds every invoice the payment settled,
// including that primary. Both helpers ask both questions, or a vendor paid
// for two invoices in one transfer keeps showing one as unpaid forever.
//
// Behind a boot-time probe: runMigrations runs after app.listen, and a query
// naming a missing table fails at PARSE time, taking down every list endpoint
// embedding these fragments. Until the probe confirms the table exists the
// fragments emit the pre-links SQL, which is correct for every row that
// predates the feature. `markLinksReady(pool)` is called once at boot.
let linksReady = false;

async function markLinksReady(pool) {
  try {
    const { rows } = await pool.query(`SELECT to_regclass('public.bank_txn_invoice_links') AS t`);
    linksReady = !!rows[0]?.t;
  } catch { linksReady = false; }
  return linksReady;
}
const linksAreReady = () => linksReady;

// "bank transaction `bt` settles expense `e`" — through the primary column or
// a link row. A link is only meaningful while its transaction still holds a
// match, so unlinking anywhere (by any of the paths that clear
// matched_expense_id) makes every link on that row inert in the same instant.
const SETTLES_SQL = (bt, e) => linksReady
  ? `(${bt}.label_id = ${e}.label_id
      AND (${bt}.matched_expense_id = COALESCE(${e}.parent_id, ${e}.id)
           OR (${bt}.matched_expense_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM bank_txn_invoice_links bl
                            WHERE bl.txn_id = ${bt}.id
                              AND bl.label_id = ${e}.label_id
                              AND bl.expense_id = COALESCE(${e}.parent_id, ${e}.id)))))`
  : `(${bt}.label_id = ${e}.label_id
      AND ${bt}.matched_expense_id = COALESCE(${e}.parent_id, ${e}.id))`;

/**
 * Per-label method compatibility between a statement's account and an
 * expense's payment_method. `accounts` comes from accountsFor(labelRow)
 * (lib/bankReconcile.js). Semantics match candidates(): an account with
 * methods:null accepts anything; a blank payment_method is compatible with
 * every account; otherwise the method must be in the account's list.
 * Unknown account keys default to compatible (visible beats hidden).
 */
const methodCompatibleSql = (s, e, accounts) => {
  const cases = (accounts || [])
    .filter((a) => a && a.key)
    .map((a) => {
      if (!Array.isArray(a.methods) || !a.methods.length) return `WHEN ${s}.account = '${esc(a.key)}' THEN TRUE`;
      const list = a.methods.map((m) => `'${esc(String(m).toLowerCase())}'`).join(', ');
      return `WHEN ${s}.account = '${esc(a.key)}' THEN LOWER(COALESCE(${e}.payment_method, '')) IN (${list}, '')`;
    })
    .join('\n        ');
  return cases ? `(CASE ${cases} ELSE TRUE END)` : 'TRUE';
};

/**
 * Load and shape a label's account list for the fragments above.
 * Small enough to call once per request.
 */
async function loadAccounts(db, labelId) {
  const { accountsFor } = require('./bankReconcile');
  const { rows } = await db.query(`SELECT bank_accounts FROM labels WHERE id = $1`, [labelId]);
  return accountsFor(rows[0] || {});
}

/**
 * Derived bank-evidence columns for an expense list SELECT.
 * @param {string} e         alias of the `expenses` table in the query
 * @param {Array}  accounts  accountsFor(labelRow) — used for bank_expected
 * @returns {string} SQL fragment — leading comma NOT included
 */
const bankEvidenceCols = (e = 'e', accounts = []) => `
  (SELECT json_build_object(
            'txn_id', bet.id,
            'account', bes.account,
            'txn_date', bet.txn_date,
            'amount', bet.amount,
            'statement_id', bet.statement_id,
            'period_start', bes.period_start,
            'method', bet.match_method)
     FROM bank_transactions bet
     JOIN bank_statements bes ON bes.id = bet.statement_id AND bes.status = 'ready'
    WHERE ${SETTLES_SQL('bet', e)}
      AND bet.dismissed = false
    ORDER BY bet.matched_at DESC NULLS LAST
    LIMIT 1) AS bank_evidence,
  EXISTS (
    SELECT 1 FROM bank_statements bxs
     WHERE bxs.label_id = ${e}.label_id
       AND bxs.status = 'ready'
       AND bxs.period_start IS NOT NULL AND bxs.period_end IS NOT NULL
       AND ${e}.payment_date
             BETWEEN bxs.period_start - ${SETTLE_LAG_DAYS} AND bxs.period_end + ${SETTLE_LAG_DAYS}
       AND ${methodCompatibleSql('bxs', e, accounts)}
  ) AS bank_expected`;

/**
 * WHERE predicate for "marked Paid but the bank never showed it" — paid,
 * nothing settles it, and a ready method-compatible statement covers the
 * date. The only one of the three no-evidence shapes that is a discrepancy.
 */
const noBankEvidenceSql = (e = 'e', accounts = []) => `(
  ${e}.payment_status = 'Paid'
  AND ${e}.payment_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bank_transactions nbt
     JOIN bank_statements nbs ON nbs.id = nbt.statement_id AND nbs.status = 'ready'
    WHERE ${SETTLES_SQL('nbt', e)}
      AND nbt.dismissed = false)
  AND EXISTS (
    SELECT 1 FROM bank_statements nxs
     WHERE nxs.label_id = ${e}.label_id
       AND nxs.status = 'ready'
       AND nxs.period_start IS NOT NULL AND nxs.period_end IS NOT NULL
       AND ${e}.payment_date
             BETWEEN nxs.period_start - ${SETTLE_LAG_DAYS} AND nxs.period_end + ${SETTLE_LAG_DAYS}
       AND ${methodCompatibleSql('nxs', e, accounts)})
)`;

// ── Why a paid row has no bank line: three answers, not one ─────────────────
// AWAITING — dated later than the newest compatible statement; nothing wrong.
// MISSING  — inside the held span, no statement covers it; a month somebody
//            never uploaded. Must never hide.
// The three partition the paid-and-unmatched set — every such row is in
// exactly one (assert in a fixture). noBankEvidenceSql is deliberately NOT
// rewritten in terms of these; restating a shipped money predicate is how a
// consumer quietly changes meaning.

/** Paid, dated, and nothing on any ready statement settles it. */
const paidUnmatchedSql = (e = 'e') => `(
  ${e}.payment_status = 'Paid'
  AND ${e}.payment_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM bank_transactions nbt
     JOIN bank_statements nbs ON nbs.id = nbt.statement_id AND nbs.status = 'ready'
    WHERE ${SETTLES_SQL('nbt', e)}
      AND nbt.dismissed = false)
)`;

/** Does a ready, method-compatible statement period cover this payment date? */
const statementCoversSql = (e = 'e', accounts = []) => `EXISTS (
  SELECT 1 FROM bank_statements cxs
   WHERE cxs.label_id = ${e}.label_id
     AND cxs.status = 'ready'
     AND cxs.period_start IS NOT NULL AND cxs.period_end IS NOT NULL
     AND ${e}.payment_date
           BETWEEN cxs.period_start - ${SETTLE_LAG_DAYS} AND cxs.period_end + ${SETTLE_LAG_DAYS}
     AND ${methodCompatibleSql('cxs', e, accounts)})`;

/**
 * Newest statement date held for an account compatible with this row, with
 * the same +settle-lag skirt the coverage test uses — so the boundary between
 * "not in yet" and "a month is missing" sits exactly where covered/uncovered
 * does.
 */
const latestStatementEndSql = (e = 'e', accounts = []) => `(
  SELECT MAX(lxs.period_end) + ${SETTLE_LAG_DAYS}
    FROM bank_statements lxs
   WHERE lxs.label_id = ${e}.label_id
     AND lxs.status = 'ready' AND lxs.period_end IS NOT NULL
     AND ${methodCompatibleSql('lxs', e, accounts)})`;

/** Paid, unmatched, dated past the newest statement — nothing is wrong yet. */
const awaitingStatementSql = (e = 'e', accounts = []) => `(
  ${paidUnmatchedSql(e)}
  AND NOT ${statementCoversSql(e, accounts)}
  AND ${e}.payment_date > COALESCE(${latestStatementEndSql(e, accounts)}, DATE '1900-01-01')
)`;

/**
 * Paid, unmatched, uncovered, and NOT in the future — the statement for that
 * month was never uploaded. COALESCE to 1900 in awaiting / here the same
 * constant flips the default: with no statements at all for a compatible
 * account, everything is awaiting, nothing is missing.
 */
const missingStatementSql = (e = 'e', accounts = []) => `(
  ${paidUnmatchedSql(e)}
  AND NOT ${statementCoversSql(e, accounts)}
  AND ${e}.payment_date <= COALESCE(${latestStatementEndSql(e, accounts)}, DATE '1900-01-01')
)`;

module.exports = {
  SETTLE_LAG_DAYS, markLinksReady, linksAreReady,
  SETTLES_SQL, methodCompatibleSql, loadAccounts,
  bankEvidenceCols, noBankEvidenceSql,
  paidUnmatchedSql, statementCoversSql, awaitingStatementSql, missingStatementSql,
};

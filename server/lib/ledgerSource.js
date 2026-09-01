// How a ledger row was born (`expenses.entry_source`), and the null-safe
// predicates for excluding whole classes of rows.
//
// Values in the wild: 'expense' | 'invoice' | 'reimbursement' |
// 'artist_campaigns' | 'recoupment' | 'bank_statement' | 'creator_payment' |
// NULL (hand-entered / vendor-submitted rows predating the column).
//
// ── The IS DISTINCT FROM rule (load-bearing) ──
// Most rows have entry_source IS NULL. `entry_source <> 'bank_statement'`
// evaluates to NULL for those — not true — so a naive inequality (or NOT IN)
// filters out every hand-entered row and EMPTIES the page instead of
// narrowing it. Exclusion must always be IS DISTINCT FROM. Plain equality is
// correct for INCLUSION (NULL is genuinely "no").

const BANK_SOURCE = 'bank_statement';
const CREATOR_SOURCE = 'creator_payment';

const excludeBankRows = (alias = 'e') => `${alias}.entry_source IS DISTINCT FROM '${BANK_SOURCE}'`;
const excludeCreatorRows = (alias = 'e') => `${alias}.entry_source IS DISTINCT FROM '${CREATOR_SOURCE}'`;
const isCreatorRow = (alias = 'e') => `${alias}.entry_source = '${CREATOR_SOURCE}'`;

// The match_method to write when attaching a bank transaction to an EXISTING
// expense. Creator payments record 'creator' so they never count as
// invoice-backed in any completion metric ("explained" and "documented" are
// different claims — a creator payment has no invoice document behind it).
// Resolved in SQL inside the same UPDATE so a mid-flight source change can't
// desync the two writes.
//
// Contract with the reconciliation subsystem:
//   * invoice-backed / completion metrics exclude match_method = 'creator'
//   * any future refusal to match undocumented hand-added rows must exempt
//     isCreatorRow() — creator payments are undocumented BY DESIGN and must
//     still reconcile against the bank.
const movedMatchMethodSql = (expenseParam, intended) =>
  `CASE WHEN (SELECT src.entry_source FROM expenses src WHERE src.id = ${expenseParam})
              = '${CREATOR_SOURCE}' THEN 'creator' ELSE '${intended}' END`;

// ── Undoing a creator conversion ────────────────────────────────────────────
// Moving a row into Creator Payments relabels its live bank matches to
// 'creator'. Moving it back out has to put each match back to the EXACT method
// it carried, which is why the conversion audits one bk_audit_log row per bank
// transaction (field='match_method', old_value=<prior>, detail='bank_txn:<id>').
//
// The rule this enforces: NEVER invent 'manual'. An earlier build reset every
// relabelled match to 'manual' unconditionally, and 'manual' is counted as
// invoice-backed by the reconciliation metrics — so unconverting promoted an
// undocumented campaign/recoupment row into the invoice-backed bucket, which is
// the one claim the 'creator' disposition exists to never make. A match with no
// audit row (matched AFTER the conversion) is left 'creator': explained but not
// invoice-backed over-states nothing.
const CREATOR_MATCH_DETAIL = 'bank_txn:';

// `auditRows` are that expense's match_method audit rows, NEWEST FIRST.
function restoreMatchPlan(auditRows) {
  const plan = [];
  const seen = new Set();
  for (const a of auditRows || []) {
    const detail = String(a.detail || '');
    if (!detail.startsWith(CREATOR_MATCH_DETAIL)) continue;
    const txnId = Number(detail.slice(CREATOR_MATCH_DETAIL.length));
    if (!Number.isInteger(txnId) || txnId <= 0 || seen.has(txnId)) continue;
    seen.add(txnId);
    const prior = a.old_value == null ? '' : String(a.old_value).trim();
    // A blank audit means the match carried no method at all — restore NULL.
    plan.push({ txn_id: txnId, match_method: prior || null });
  }
  return plan;
}

// 1099 reporting threshold per calendar year (OBBBA: $2,000 from tax year
// 2026; $600 before). Shared by /creators/directory and the 1099 report so
// the two never disagree about who is exposed.
const reportingThresholdFor = (year) => (Number(year) >= 2026 ? 2000 : 600);

module.exports = {
  excludeBankRows, excludeCreatorRows, isCreatorRow,
  movedMatchMethodSql, reportingThresholdFor,
  restoreMatchPlan, CREATOR_MATCH_DETAIL,
  BANK_SOURCE, CREATOR_SOURCE,
};

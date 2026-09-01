// The statement lens: what a bank line IS, and whether a month adds up.
//
// Ported from the reference app's client/src/lib/statementLens.js, but placed
// on the SERVER for two reasons that are specific to this codebase:
//
//   1. `dispositionOf` already existed here twice — routes/bank-statements.js
//      and routes/bank-matching.js — and the two copies had already DIVERGED
//      (bank-matching also treated `match_method = 'created'` as booked, the
//      statements copy did not). That is exactly the "money rules exist in
//      three places and get fixed in one" failure the reference file was
//      extracted to prevent. One definition now; both routes import it.
//   2. Pure + CJS means `server/scripts/finance-fixtures.cjs` can hold the
//      properties, instead of them being verified by looking at a screen.
//
// The client never re-derives any of this. `GET /bank-statements/:id/lens`
// returns the summary AND a per-line `disposition`, so the Bank Ledger's
// extra-lines list is a set difference over server-decided facts rather than a
// fourth copy of the rule.

// ── Disposition: every bank line is exactly one thing ────────────────────────
//
// Cadence's vocabulary (NOT the reference app's — these strings are a shipped
// contract: BankStatements.jsx, BankMatching.jsx and StatementReviewDeck.jsx
// all switch on them, and `STATUS_CHIP[disposition]` renders nothing for a
// value it doesn't know):
//
//   debits
//     dismissed  a sweep or a person said this line needs no entry
//     booked     an entry this app INVENTED from the line — it has a ledger id
//                but no document behind it. A booking is NOT a match.
//     matched    a real ledger entry settles it, and that entry reads Paid
//     toconfirm  a real ledger entry settles it but still reads Unpaid
//     open       nothing has been decided
//   credits
//     booked-income  booked into artist_income
//     dismissed      not income (internal movement, transfer, funding leg)
//     open-credit    nothing has been decided
//
// Order matters. `dismissed` is checked before the matched columns because a
// dismissed line can still carry a stale `matched_expense_id`, and reporting it
// as matched puts a resolved line back in front of somebody. `booked` is
// checked before the bare `matched_expense_id` because a booking has one too.
//
// `t.booked || t.match_method === 'created'` is the UNION of what the two old
// copies did. Widening bank-statements.js to include 'created' is the correct
// direction: a 'created' row's expense was invented from the line, so calling
// it `matched` would count an undocumented row as invoice-backed.
function dispositionOf(t) {
  if (!t) return 'open';
  if (t.direction === 'credit') {
    if (t.matched_income_id) return 'booked-income';
    return t.dismissed ? 'dismissed' : 'open-credit';
  }
  if (t.dismissed) return 'dismissed';
  if (t.booked || t.match_method === 'created') return 'booked';
  if (t.matched_expense_id) return t.exp_payment_status === 'Paid' ? 'matched' : 'toconfirm';
  return 'open';
}

// ── The lens bucket: disposition, plus the one distinction a tie-out needs ───
//
// A creator payment is a REAL entry a person made on /creators, matched to this
// line — but it is deliberately never invoice-backed, because no invoice
// exists. "Explained" and "documented" are different claims, and the completion
// model in routes/bank-matching.js already keeps them apart.
//
// This is a SUMMARY-ONLY refinement. `dispositionOf` is deliberately left
// alone: adding a sixth debit value to it would drop creator rows out of the
// `matched` chip counts on two shipped pages and render an unstyled chip on a
// third. So the lens splits the bucket for its own arithmetic and nothing else
// sees it.
function lensBucketOf(t) {
  const d = dispositionOf(t);
  if ((d === 'matched' || d === 'toconfirm') && t && t.match_method === 'creator') return 'creator';
  return d;
}

// A transaction's value in dollars, UNSIGNED.
//
// `usd` is the conversion the statement endpoint already did at request time;
// `amount_usd` is the stored column (the printed USD settlement on a foreign
// PDF row); face `amount` is the last resort — visible and greppable rather
// than zeroed, per lib/usd.js's never-silently-1:1 rule.
//
// Absolute, because direction is a separate field: a debit stored negative
// would otherwise subtract from the debit total.
function txUsd(t) {
  if (!t) return 0;
  const v = t.usd != null ? t.usd : (t.amount_usd != null ? t.amount_usd : t.amount);
  return Math.abs(Number(v) || 0);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Summarise one statement: both directions, every bucket, and the tie-out.
 *
 * The tie-out is `beginning + credits − debits = ending`, against the balances
 * the statement itself prints (captured at upload by lib/statementPdfText.js or
 * the CSV balance column). Agreement is confirmation rather than a fresh claim;
 * DISagreement means rows changed after upload, which is worth saying loudly.
 *
 * `hasBalances` is false for accounts parsed without them (PayPal statements
 * arrive with a null beginning and a 0.00 ending). A check that always fails
 * for a reason that is not a problem trains people to ignore the check, so
 * those statements report that there is nothing to tie against.
 *
 * Rounds ONCE, at the end — per lib/usd.js this is a TOTAL, not a row, and
 * summing already-rounded parts has broken a tie-out by exactly a cent before.
 * Credits and debits are subtotalled APART and never netted.
 *
 * @param {object}   statement     bank_statements row
 * @param {object[]} transactions  its bank_transactions rows
 */
function summariseStatement(statement, transactions) {
  const st = statement || {};
  const list = Array.isArray(transactions) ? transactions : [];

  const side = () => ({ n: 0, usd: 0, by: {} });
  const moneyOut = side();
  const moneyIn = side();
  for (const t of list) {
    const s = t.direction === 'credit' ? moneyIn : moneyOut;
    const d = lensBucketOf(t);
    const v = txUsd(t);
    s.n += 1;
    s.usd += v;
    s.by[d] = s.by[d] || { n: 0, usd: 0 };
    s.by[d].n += 1;
    s.by[d].usd += v;
  }
  moneyOut.usd = round2(moneyOut.usd);
  moneyIn.usd = round2(moneyIn.usd);
  for (const s of [moneyOut, moneyIn]) {
    for (const k of Object.keys(s.by)) s.by[k].usd = round2(s.by[k].usd);
  }

  const begin = st.beginning_balance == null ? null : Number(st.beginning_balance);
  const end = st.ending_balance == null ? null : Number(st.ending_balance);
  const hasBalances = begin != null && end != null && !(begin === 0 && end === 0);
  const computed = hasBalances ? round2(begin + moneyIn.usd - moneyOut.usd) : null;
  const drift = hasBalances ? round2(computed - end) : null;

  return {
    statement: {
      id: st.id, account: st.account, filename: st.filename,
      period_start: st.period_start, period_end: st.period_end,
      beginning_balance: st.beginning_balance, ending_balance: st.ending_balance,
      status: st.status,
    },
    moneyOut,
    moneyIn,
    hasBalances,
    begin,
    end,
    computed,
    drift,
    // EXACT, on the ROUNDED value. The statement parser reconciles with a small
    // tolerance because it is checking numbers it just read out of a PDF, where
    // a rounding artifact is a parse problem and not a data one. Here the rows
    // are already in the database: nothing is being extracted, so a cent of
    // drift is a cent that genuinely does not add up. Comparing the rounded
    // figure rather than the raw float is what makes `=== 0` safe.
    ties: hasBalances && drift === 0,
  };
}

/**
 * The lines a statement has that the Bank Ledger has no editable row for.
 *
 * A booked debit already appears above as a full ledger row, so it is excluded
 * — but ONLY when the ledger row is actually present. A booked line whose entry
 * was deleted, or whose row the current filters exclude, still belongs in this
 * list: the alternative is a line that exists on the statement and appears
 * nowhere on a page claiming to account for the month.
 *
 * Everything else is here by definition — matched lines are settled by invoices
 * that live on the OTHER half of the ledger, and the whole credit side has no
 * `expenses` row it could ever have.
 *
 * @param {object[]} transactions
 * @param {Set|Map}  haveRowFor   ids of transactions with a ledger row on screen
 * @param {'out'|'in'|'both'} direction
 */
function extraTransactions(transactions, haveRowFor, direction = 'out') {
  const list = Array.isArray(transactions) ? transactions : [];
  const has = (id) => (haveRowFor && typeof haveRowFor.has === 'function' ? haveRowFor.has(id) : false);
  const wantOut = direction === 'out' || direction === 'both';
  const wantIn = direction === 'in' || direction === 'both';
  return list
    .filter((t) => {
      const isCredit = t.direction === 'credit';
      if (isCredit ? !wantIn : !wantOut) return false;
      return !(dispositionOf(t) === 'booked' && has(t.id));
    })
    .sort((a, b) => String(b.txn_date || '').localeCompare(String(a.txn_date || '')));
}

module.exports = { dispositionOf, lensBucketOf, txUsd, summariseStatement, extraTransactions, round2 };

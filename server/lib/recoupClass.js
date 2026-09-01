// Spend that is never recoupable against an artist — the class rules.
//
// ── Why this exists ──
// `expenses.recoupable` is `BOOLEAN DEFAULT TRUE` and `bookDebitAsEntry` never
// lists the column, so every statement-born row arrives claiming to be
// recoupable. `recoup_reviewed` (lib/recoupments.js) is the gate that lets a
// person answer one of them — but per-row review is the wrong instrument for
// the SHAPE of a bank pile: it gives a $12 card charge the same ceremony as a
// $200,000 advance, and the queue can never reach zero. In the reference app
// 560 of the unanswered rows were Bank Fees worth $3,251.43 between them, while
// eight category rules (Royalties, Salary, partner draws, Rent, cards) took
// $2,074,917 off the queue and left the two piles that are a real question:
// Advance and Marketing.
//
// ── What it does NOT do ──
// It moves no money and writes nothing to the ledger. Ruled rows are already
// off every recoupment surface — `recoupReviewedSql` admits a bank-born row
// only once `recoup_reviewed` is true — so a rule only removes them from the
// QUEUE of things still to answer. `recoupable` is left alone, which is what
// makes DELETE a complete undo: the rows come straight back.
//
// That is the difference from `recoup_reviewed`, and it is deliberate. A
// per-row answer is one person's decision about one payment and is meant to
// persist. A rule is a statement about a CLASS of spend, has to cover rows that
// arrive next month, and has to be retractable without reconstructing who
// decided what.
//
// ── EQUALITY, never substring ──
// The trap `statement_no_invoice_rules` already documents in this repo: "TONE"
// is a substring of "Tone Pay, Inc" and "Dean St" of "Dean Street Media". Here
// the same rule is load-bearing in the other direction — `Salary` and
// `Salary (Felipe)` are two separate live categories, as are `Partner - Felipe`
// and `Partner - Tyler`. A `Salary` rule must leave the `Salary (Felipe)` rows
// exactly where they are, which is why eight decisions are eight rules and not
// four.

const SCOPES = ['vendor', 'category'];

/** lower + trim + collapse internal whitespace. Both sides normalize this way. */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Load one label's rules.
 *
 * Degrades to "no rules" on any error, the table not existing included:
 * `runMigrations()` runs in the BACKGROUND after `app.listen`, and a queue that
 * 500s during a deploy window is worse than a queue that briefly offers rows a
 * rule already covers.
 */
async function loadRecoupmentClassRules(pool, labelId) {
  const empty = { vendors: new Set(), categories: new Set(), rows: [], size: 0, has: () => false };
  try {
    const { rows } = await pool.query(
      `SELECT id, scope, rule_key, reason, created_by, created_at
         FROM recoupment_class_rules
        WHERE label_id = $1
        ORDER BY scope, LOWER(rule_key)`,
      [labelId]
    );
    return rulesFrom(rows);
  } catch (err) {
    console.error('recoupment class rules unavailable — queue offers everything:', err.message);
    return empty;
  }
}

/**
 * Pure half of the loader, so the matching rule is fixture-able without a
 * database. A CATEGORY rule answers for everything in it; a VENDOR rule answers
 * for that payee whatever the category.
 */
function rulesFrom(rows) {
  const vendors = new Set();
  const categories = new Set();
  for (const r of rows || []) {
    if (r.scope === 'vendor') vendors.add(norm(r.rule_key));
    else if (r.scope === 'category') categories.add(norm(r.rule_key));
  }
  return {
    vendors, categories, rows: rows || [], size: (rows || []).length,
    has: (payee, category) => categories.has(norm(category)) || vendors.has(norm(payee)),
  };
}

/**
 * WHERE fragment: this row is NOT covered by any rule.
 *
 * Written as a NOT EXISTS against the table rather than an `IN (…)` built from
 * the loaded rows, so the queue and the rules list cannot disagree because of a
 * stale read between two queries.
 *
 * `labelParam` is the placeholder ALREADY carrying `req.labelId` in the calling
 * query (e.g. `'$1'`) — never a literal, and never user text.
 */
const notClassRuledSql = (e = 'e', labelParam = '$1') => `NOT EXISTS (
  SELECT 1 FROM recoupment_class_rules rcr
   WHERE rcr.label_id = ${labelParam}
     AND ((rcr.scope = 'category'
            AND regexp_replace(LOWER(TRIM(rcr.rule_key)), '\\s+', ' ', 'g')
              = regexp_replace(LOWER(TRIM(COALESCE(${e}.category, ''))), '\\s+', ' ', 'g'))
       OR (rcr.scope = 'vendor'
            AND regexp_replace(LOWER(TRIM(rcr.rule_key)), '\\s+', ' ', 'g')
              = regexp_replace(LOWER(TRIM(COALESCE(${e}.payee, ''))), '\\s+', ' ', 'g')))
)`;

module.exports = { loadRecoupmentClassRules, rulesFrom, notClassRuledSql, norm, SCOPES };

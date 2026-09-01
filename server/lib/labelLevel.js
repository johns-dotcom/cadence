// Spend that bills the LABEL rather than a release — the ad pool.
//
// ── What the pool is, and why it needs a rule ──
// Ad-platform charges carry no artist evidence at all: the descriptors are
// merchant ids repeated on every charge ("PURCHASE 0724 FACEBK *F4EE6X5GP2").
// The reference app measured 495 of 499 `Advertisements` rows ($291,299) naming
// nobody. That is a different fact from "nobody has got round to attributing
// this yet", and conflating the two is what makes a coverage percentage
// unreachable: label-level money can never name an artist, so leaving it in the
// denominator caps coverage below 100 forever.
//
// So the pool is declared, not guessed. A vendor rule ("Meta Platforms bills the
// label") or a category rule ("Advertisements") says which spend is in it. With
// no rules a workspace has no pool, and the Allocate Advertising page says so
// rather than inventing one.
//
// ── EQUALITY, never substring ──
// Same trap `statement_no_invoice_rules` and `recoupment_class_rules` already
// document: "TONE" is a substring of "Tone Pay, Inc", and `Salary` and
// `Salary (Felipe)` are two separate live categories. Both sides normalize with
// lower + trim + collapse-whitespace and are then compared with `=`.
//
// ── Deliberately NOT unified with statement_artist_rules.is_overhead ──
// That column answers a different question — "do not GUESS an artist for this
// bank descriptor" — and is consumed at booking time by bookEntry(). A row can
// be overhead-for-guessing purposes and still be a release cost somebody names
// by hand. Folding the two would make one admin surface silently change the
// other's money. The Allocate Advertising page offers overhead-ruled payees as
// suggested rules instead, which is a prompt, not a coupling.
//
// ── Relationship to the P&L (cadence-specific, differs from the reference app) ──
// The reference app makes label-level a THIRD bucket beside attributed and
// unattributed. Cadence's `by_artist.ties_to_pnl` is a shipped contract the
// Reports client REFUSES to render on, and it compares the by-artist accumulator
// against the operating expense total. So here label-level is a disclosed SUBSET
// of the unattributed bucket: a row is label-level only when it already names
// nobody. Nothing moves between buckets, ties_to_pnl is untouched, and
// `label_level.total <= unattributed.total` by construction.

const SCOPES = ['vendor', 'category'];

/** lower + trim + collapse internal whitespace. Both sides normalize this way. */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

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
    vendors,
    categories,
    rows: rows || [],
    size: (rows || []).length,
    has: (payee, category) => categories.has(norm(category)) || vendors.has(norm(payee)),
  };
}

const EMPTY = rulesFrom([]);

/**
 * Load one label's rules.
 *
 * Degrades to "no rules" on any error, the table not existing included:
 * runMigrations() runs in the BACKGROUND after app.listen, and a P&L that 500s
 * during a deploy window is worse than one that briefly reports no pool.
 */
async function loadLabelLevelRules(db, labelId) {
  try {
    const { rows } = await db.query(
      `SELECT id, scope, rule_key, reason, created_by, created_at
         FROM label_level_spend_rules
        WHERE label_id = $1
        ORDER BY scope, LOWER(rule_key)`,
      [labelId]
    );
    return rulesFrom(rows);
  } catch (err) {
    console.warn('label-level rules unavailable — no ad pool this request:', err.message);
    return EMPTY;
  }
}

module.exports = { loadLabelLevelRules, rulesFrom, norm, SCOPES, EMPTY };

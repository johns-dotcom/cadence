// What counts as CAMPAIGN spend on the Artist Campaigns surface — one
// definition, shared by the index's two layers, the catch-up queue, the artist
// detail's `in_scope` flag and the export.
//
// ── Why a category LIST and not a regex ──
// The page previously auto-detected scope with
// `LOWER(category) ~ 'market|advertis|promo|influenc|public|social'`, which
// silently swept in any free-text category containing "public" or "social", and
// stated its scope nowhere. The reference app used a fixed
// `['Marketing','Advertisements']` and printed it. Cadence can do better than
// either: categories are per-label DATA, and every expense category already
// carries a `ui_group` — the same classification that drives the Artist Budgets
// sheet sections. `ui_group = 'campaign'` IS the workspace's own answer to
// "which of our categories are campaign & promotion", maintained in one place,
// and every consumer of this file discloses the resolved list in `meta.scope`.
//
// ── Scope is category-only, on BOTH layers, on purpose ──
// The Settled layer comes from `buildPnl().by_artist` rows' `by_category`, which
// has no per-row dimension at all. If the Committed layer honoured a per-row
// include/exclude the two layers would be scoped differently and could not be
// added together — which is the one property the whole two-layer model exists
// for. So `expenses.artist_campaign` is NOT a scope input here. It survives as
// the marker other surfaces read, kept in step by the dismiss / not-a-campaign
// actions, and person-level exclusions are the flag_dismissals below, which are
// disclosed in `meta.excluded` because they move the Committed figure.

// Used only when the `categories` table has no campaign rows yet (a fresh label
// mid-seed, or one whose ui_groups were all reclassified). 'Advertisements' is
// not in cadence's seed but is the reference app's ad category and is commonly
// added by hand.
const FALLBACK_CAMPAIGN_CATEGORIES = [
  'Marketing', 'Advertisements', 'PR', 'Music Video', 'Design', 'Sync/Licensing', 'Distribution',
];

const DISMISS_KIND = 'artist_campaign';
const NOT_CAMPAIGN_KIND = 'artist_campaign_not_campaign';

/** The strip-all artist key + placeholder folding — reuse, never re-derive. */
const { artistBucketKey, artistKeyOf } = require('./artistKey');

/** Song bucket key. `__no_song__` is a REAL bucket, not an absence. */
const NO_SONG_KEY = '__no_song__';
const songKeyOf = (s) => String(s || '').trim().toLowerCase() || NO_SONG_KEY;

/**
 * Resolve a label's campaign category names.
 * Degrades to the fallback list on any error — a reporting refinement must
 * never take the page down.
 */
async function loadCampaignCategories(db, labelId) {
  try {
    const { rows } = await db.query(
      `SELECT name FROM categories
        WHERE label_id = $1 AND kind = 'expense' AND active = TRUE AND ui_group = 'campaign'
        ORDER BY sort_order, name`,
      [labelId]
    );
    const names = rows.map((r) => String(r.name || '').trim()).filter(Boolean);
    return names.length ? names : FALLBACK_CAMPAIGN_CATEGORIES.slice();
  } catch (err) {
    console.warn('campaign categories degraded to the fallback list:', err.message);
    return FALLBACK_CAMPAIGN_CATEGORIES.slice();
  }
}

/** Lowered+trimmed, for the `= ANY($n::text[])` comparisons below. */
const catKeys = (names) => (names || []).map((n) => String(n || '').trim().toLowerCase());

/**
 * SQL: is this row's category inside the campaign scope?
 * @param {string} e         expenses alias
 * @param {string} catParam  the placeholder ALREADY carrying catKeys(names)
 */
const inScopeSql = (e = 'e', catParam = '$2') =>
  `(LOWER(TRIM(COALESCE(${e}.category, ''))) = ANY(${catParam}::text[]))`;

/** JS twin of inScopeSql, for post-processing loops. */
const inScope = (category, keys) => keys.includes(String(category || '').trim().toLowerCase());

/** SQL: a person removed this row from the page (either kind). */
const personExcludedSql = (e = 'e', labelParam = '$1') => `EXISTS (
  SELECT 1 FROM flag_dismissals fd
   WHERE fd.label_id = ${labelParam} AND fd.expense_id = ${e}.id
     AND fd.flag_kind IN ('${DISMISS_KIND}', '${NOT_CAMPAIGN_KIND}'))`;

const dismissedSql = (e = 'e', labelParam = '$1') => `EXISTS (
  SELECT 1 FROM flag_dismissals fd
   WHERE fd.label_id = ${labelParam} AND fd.expense_id = ${e}.id
     AND fd.flag_kind = '${DISMISS_KIND}')`;

const notCampaignSql = (e = 'e', labelParam = '$1') => `EXISTS (
  SELECT 1 FROM flag_dismissals fd
   WHERE fd.label_id = ${labelParam} AND fd.expense_id = ${e}.id
     AND fd.flag_kind = '${NOT_CAMPAIGN_KIND}')`;

/**
 * Most-used spelling wins, ties break alphabetically. The same rule
 * `lib/recoupments.js bestSpelling` and buildPnl's `bestSpelling` already use —
 * a committed-only card whose artist the settled layer has never heard of would
 * otherwise be titled with its bucket key ("nobodyserious").
 */
function bestOf(tally) {
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || '';
}

/**
 * THE DOUBLE-COUNT GUARD, as a pure function.
 *
 * Artist Campaigns states two layers and adds them together, so no row may
 * appear in both. `countedIds` is the set `buildPnl` reports it counted — set
 * MEMBERSHIP, never a re-derived predicate: reconstructing "approved and Paid
 * and dated in range and not report-dismissed and not month-moved" drifts the
 * first time either side changes.
 *
 * `seen` is not paranoia: the members query joins, and a future join that
 * multiplies rows would otherwise silently double a total rather than fail.
 *
 * @param {Array<{id:number}>} rows
 * @param {Set<number>} countedIds
 * @returns {{settled: Array, committed: Array}} a PARTITION — every input row is
 *   in exactly one side, and each contributes exactly once.
 */
function partitionByLayer(rows, countedIds) {
  const settled = [];
  const committed = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    (countedIds && countedIds.has(r.id) ? settled : committed).push(r);
  }
  return { settled, committed };
}

module.exports = {
  FALLBACK_CAMPAIGN_CATEGORIES, DISMISS_KIND, NOT_CAMPAIGN_KIND,
  NO_SONG_KEY, songKeyOf, artistBucketKey, artistKeyOf,
  loadCampaignCategories, catKeys, inScopeSql, inScope,
  personExcludedSql, dismissedSql, notCampaignSql, bestOf, partitionByLayer,
};

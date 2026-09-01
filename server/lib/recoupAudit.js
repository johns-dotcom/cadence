// The pure half of the recoupment integrity audit.
//
// The endpoint (routes/financials.js `GET /recoupment-audit`) does the SQL; the
// shapes below decide what counts as a finding. They live here for the same
// reason `lib/recoupments.js` does: a predicate about money that lives in two
// places disagrees with itself eventually, and these are also the only parts a
// fixture can hold without a database.

const { normalizeInvoiceNum } = require('./normalizeInvoiceNum');
const { usdOf, round2 } = require('./usd');

/** A row's own USD, locked rate first. Never face value for a foreign row. */
const rowUsdOf = (r) => usdOf(r.amount, r.currency, r.fx_rate_to_usd);

/**
 * Sum a row set in USD, rounding ONCE at the end.
 * Summing already-rounded parts broke a tie-out by exactly a cent in the
 * reference app. (Note the deliberate contrast with lib/usd.js `rowUsd2`,
 * which rounds AT THE ROW — that is for sheets that slice the same rows two
 * ways and need both slicings to tie. Here nothing is re-sliced.)
 */
const sumUsd = (rows) => round2((rows || []).reduce((t, r) => t + rowUsdOf(r), 0));

/**
 * Check 3 — same vendor, same invoice number, claimed more than once.
 *
 * A SENSOR, not a verdict: two deliverables billed on one invoice number are
 * legitimate, and the UI says so. Groups spanning two artists sort first,
 * because those are the ones where one cost may be charged to two people.
 *
 * A row with no invoice number is skipped — the absence of a number is not
 * evidence of anything.
 */
function groupDoubleClaims(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const num = normalizeInvoiceNum(r.invoice_number || '');
    if (!num) continue;
    const key = `${String(r.payee || '').trim().toLowerCase()}|${num}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()]
    .filter((v) => v.length > 1)
    .map((v) => {
      const artists = [...new Set(v.map((r) => String(r.artist || '').trim()).filter(Boolean))];
      return {
        payee: v[0].payee,
        invoice_number: v[0].invoice_number,
        rows: v,
        artists,
        cross_artist: artists.length > 1,
        usd: sumUsd(v),
      };
    })
    .sort((a, b) => (Number(b.cross_artist) - Number(a.cross_artist)) || (b.usd - a.usd));
}

/**
 * Check 5 — a split payment with part of it claimed and part not.
 *
 * The family root is `COALESCE(parent_id, id)`. Only RECOUPABLE members count:
 * a family whose non-recoupable slice is unclaimed is correct, not incomplete.
 *
 * Reachable in cadence today, and not by anyone's mistake: claim an entry, then
 * split it. `POST /ledger/entries/:id/split` gives the parent the first slice
 * and creates children WITHOUT `ufr`/`ufr_marked_at` in the insert list, so the
 * parent stays claimed at a smaller amount and the rest of the payment silently
 * becomes unclaimed money.
 */
function partialFamilies(rows) {
  const byRoot = new Map();
  for (const r of rows || []) {
    const root = r.root_id != null ? r.root_id : (r.parent_id || r.id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(r);
  }
  return [...byRoot.entries()]
    .map(([root_id, members]) => {
      const claimed = members.filter((m) => m.ufr === true);
      const open = members.filter((m) => m.ufr !== true);
      const root = members.find((m) => m.id === root_id) || members[0];
      return {
        root_id,
        payee: root.payee, artist: root.artist, song: root.song,
        currency: root.currency,
        members,
        claimed_usd: sumUsd(claimed), open_usd: sumUsd(open),
        open_ids: open.map((m) => m.id),
        // A child cannot be reached from the Recoupments/Planning surfaces
        // (`recoupBaseSql` is root-only, by design, so a family is counted
        // once). Said on the finding rather than discovered by clicking.
        hidden_ids: open.filter((m) => m.parent_id != null).map((m) => m.id),
      };
    })
    .filter((f) => f.open_ids.length > 0 && f.claimed_usd > 0)
    .sort((a, b) => b.open_usd - a.open_usd);
}

/**
 * Check 4 — claimed with no document, grouped BY ARTIST.
 * By artist because that is the conversation this protects: one artist asking
 * to see what they were charged for.
 */
function groupNoDocument(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const k = String(r.artist || '').trim() || '— no artist';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()]
    .map(([artist, list]) => ({
      artist,
      list: [...list].sort((a, b) => rowUsdOf(b) - rowUsdOf(a)),
      usd: sumUsd(list),
    }))
    .sort((a, b) => b.usd - a.usd);
}

module.exports = { rowUsdOf, sumUsd, groupDoubleClaims, partialFamilies, groupNoDocument };

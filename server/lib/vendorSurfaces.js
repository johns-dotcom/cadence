// The two vendor rollups that are not "one row per payee in the ledger":
//
//   addedExpenseRollup — payees that exist ONLY because somebody added an
//     expense on Recoupments or Artist Campaigns. Those rows carry no invoice
//     number, so nothing structural stops the same payment being entered
//     twice, and a creator's total climbs quietly. The rollup buckets by the
//     canonical strip-all key so spelling variants land together, then flags
//     same-amount-same-week pairs and multi-spelling buckets.
//
//   unifiedRows — one row per COMPANY joining the ledger to bank activity,
//     with the three worklists (needs matching / needs artist / to attach)
//     counted per vendor.
//
// Both are pure so the fixtures can hold their money rules without a database.

const { artistKeyOf, namesAnArtist } = require('./artistKey');
const { foldKey } = require('./nameMatch');
const { round2 } = require('./usd');

// Vendors created implicitly by an add-expense modal. 'recoupment' is
// SINGULAR in this codebase (lib/ledgerSource.js is the vocabulary) — the
// reference app spelled it 'recoupments' and a straight port returns nothing.
// The plural is accepted too so a row written by any older path still shows.
const ADDED_SOURCES = ['recoupment', 'recoupments', 'artist_campaigns'];

// Spend bands, USD-equivalent. Fixed thresholds, not percentiles: "the top
// 10% of my creators" is true in every workspace and says nothing.
const bandFor = (usd) => (usd >= 5000 ? 'high' : usd >= 1000 ? 'watch' : 'ok');

const dayNum = (d) => {
  const s = String(d || '').slice(0, 10);
  const t = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(t) ? t / 86400000 : null;
};

/**
 * @param rows [{id, payee, amount, currency, usd, artist, song, spent_date}]
 * @param opts.windowDays  how close two identical amounts must be to be a
 *                         suspected double entry (default 7)
 * @param opts.maxPairs    cap on duplicate pairs returned (default 100)
 */
function addedExpenseRollup(rows, { windowDays = 7, maxPairs = 100 } = {}) {
  const buckets = new Map();
  for (const r of rows || []) {
    const raw = String(r.payee || '').trim();
    if (!raw) continue;
    // The canonical strip-all key — artist-campaigns' normKey, one definition
    // (lib/artistKey.js). A second normalizer here is how two surfaces come to
    // disagree about whether two spellings are one creator.
    const key = artistKeyOf(raw);
    if (!key) continue;
    let b = buckets.get(key);
    if (!b) {
      b = { key, spellings: new Map(), items: 0, totals: {}, usd: 0, artists: new Set(), last_date: null, rows: [] };
      buckets.set(key, b);
    }
    b.spellings.set(raw, (b.spellings.get(raw) || 0) + 1);
    b.items += 1;
    const cur = (r.currency || 'USD').toUpperCase();
    b.totals[cur] = round2((b.totals[cur] || 0) + (Number(r.amount) || 0));
    b.usd = round2(b.usd + (Number(r.usd) || 0));
    if (namesAnArtist(r.artist)) b.artists.add(String(r.artist).trim());
    const d = String(r.spent_date || '').slice(0, 10);
    if (d && (!b.last_date || d > b.last_date)) b.last_date = d;
    b.rows.push(r);
  }

  // The bucket's display name is the most-common spelling — the same one the
  // table shows. Using the first spelling SEEN would head the duplicate card
  // with whichever variant happened to be typed first.
  const displayName = (b) => [...b.spellings.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];

  const dupePairs = [];
  for (const b of buckets.values()) {
    if (b.rows.length < 2) continue;
    const items = b.rows.slice().sort((x, y) => String(x.spent_date || '').localeCompare(String(y.spent_date || '')));
    for (let i = 0; i < items.length && dupePairs.length < maxPairs; i++) {
      for (let j = i + 1; j < items.length && dupePairs.length < maxPairs; j++) {
        const a = items[i], c = items[j];
        if (round2(a.amount) !== round2(c.amount)) continue;
        if ((a.currency || 'USD') !== (c.currency || 'USD')) continue;
        const da = dayNum(a.spent_date), dc = dayNum(c.spent_date);
        // Undated rows cannot be shown to be a week apart, so they are not
        // claimed to be — a pair nobody can check is noise in a review queue.
        if (da === null || dc === null) continue;
        if (Math.abs(da - dc) > windowDays) continue;
        dupePairs.push({
          payee: displayName(b),
          amount: round2(a.amount),
          currency: (a.currency || 'USD').toUpperCase(),
          days_apart: Math.round(Math.abs(da - dc)),
          a: { id: a.id, date: String(a.spent_date || '').slice(0, 10), artist: a.artist || null, song: a.song || null, payee: a.payee },
          b: { id: c.id, date: String(c.spent_date || '').slice(0, 10), artist: c.artist || null, song: c.song || null, payee: c.payee },
        });
      }
    }
  }

  const vendors = [...buckets.values()].map((b) => {
    const spellings = [...b.spellings.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return {
      key: b.key,
      name: spellings[0][0],
      spellings: spellings.map(([s]) => s),
      items: b.items,
      totals: b.totals,
      usd: round2(b.usd),
      artists: [...b.artists].sort(),
      last_date: b.last_date,
      band: bandFor(b.usd),
    };
  }).sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name));

  const nameVariants = vendors.filter((v) => v.spellings.length > 1)
    .map((v) => ({ key: v.key, name: v.name, spellings: v.spellings }));

  return { vendors, dupePairs, nameVariants };
}

// ── The unified ledger + bank view ─────────────────────────────────────────
// Wire fees mean the bank almost never shows the invoice amount to the cent,
// so a delta inside the tolerance is a tick, not a discrepancy. Same tolerance
// the multi-invoice attach uses (lib/statementLinks.feeTolerance).
const feeTolerance = (n) => Math.max(35, Math.abs(Number(n) || 0) * 0.01);

/**
 * @param ledger  [{payee, is_root, usd, artist, has_invoice, payment_status,
 *                  bank_evidence, bank_expected, last_activity, entry_source,
 *                  w9_on_file, category}]
 * @param bankGroups [{key, name, n, total, last_seen, resolved_vendor}]
 *                  — resolved_vendor null means the descriptor names nobody.
 */
function unifiedRows(ledger, bankGroups) {
  const byKey = new Map();
  const ensure = (name) => {
    const k = foldKey(name) || String(name || '').toLowerCase();
    let v = byKey.get(k);
    if (!v) {
      v = {
        key: k, name, invoices: 0, invoiced_usd: 0, open_usd: 0, paid_usd: 0,
        needs_matching: 0, needs_artist: 0, to_attach: 0,
        bank_out: 0, bank_txns: 0, w9_on_file: false, last_activity: null,
        books_as: null, _cats: new Map(),
      };
      byKey.set(k, v);
    }
    return v;
  };

  for (const r of ledger || []) {
    const name = String(r.payee || '').trim();
    if (!name) continue;
    const v = ensure(name);
    // The display spelling is the one on the most recent activity — a vendor
    // that was renamed should read under the new name.
    const d = String(r.last_activity || '').slice(0, 10);
    if (d && (!v.last_activity || d > v.last_activity)) { v.last_activity = d; v.name = name; }
    const usd = Number(r.usd) || 0;
    v.invoiced_usd = round2(v.invoiced_usd + usd);
    if (r.payment_status === 'Paid') v.paid_usd = round2(v.paid_usd + usd);
    else v.open_usd = round2(v.open_usd + usd);
    if (r.w9_on_file) v.w9_on_file = true;
    if (r.category) v._cats.set(r.category, (v._cats.get(r.category) || 0) + 1);
    // Counts are per FAMILY. A split invoice is one invoice the vendor sent,
    // and counting its slices inflates every worklist it lands in.
    if (!r.is_root) continue;
    v.invoices += 1;
    // "Needs matching" is the ONE bank state that is a discrepancy: paid, a
    // ready statement covers the date, and no line matches. Paid-and-no-
    // statement-yet is normal and is deliberately not a worklist item.
    if (r.payment_status === 'Paid' && !r.bank_evidence && r.bank_expected) v.needs_matching += 1;
    if (!namesAnArtist(r.artist)) v.needs_artist += 1;
    if (!r.has_invoice && r.entry_source !== 'bank_statement') v.to_attach += 1;
  }

  const unlinked = [];
  for (const g of bankGroups || []) {
    if (!g.resolved_vendor) { unlinked.push(g); continue; }
    const v = ensure(g.resolved_vendor);
    v.bank_out = round2(v.bank_out + (Number(g.total) || 0));
    v.bank_txns += Number(g.n) || 0;
    const d = String(g.last_seen || '').slice(0, 10);
    if (d && (!v.last_activity || d > v.last_activity)) v.last_activity = d;
  }

  const rows = [...byKey.values()].map((v) => {
    const cats = [...v._cats.entries()].sort((a, b) => b[1] - a[1]);
    const delta = round2(v.bank_out - v.invoiced_usd);
    return {
      ...v,
      _cats: undefined,
      books_as: cats.length ? cats[0][0] : null,
      delta,
      // No bank activity at all is not agreement — say nothing rather than ✓.
      in_tolerance: v.bank_txns > 0 ? Math.abs(delta) <= feeTolerance(v.invoiced_usd) : null,
    };
  }).sort((a, b) => (b.invoiced_usd + b.bank_out) - (a.invoiced_usd + a.bank_out));

  return { rows, unlinked: unlinked.sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0)) };
}

module.exports = { ADDED_SOURCES, bandFor, addedExpenseRollup, unifiedRows, feeTolerance };

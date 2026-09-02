// Vendor duplicate pairs — the scoring behind the vendor duplicate-review deck.
//
// The Data-Quality flags engine already GROUPS look-alike payees (union-find
// over the same fold key). That answers "which names cluster"; a review deck
// needs a different answer for every PAIR: how confident, why, which spelling
// survives, and has somebody already said no to exactly this pair. Grouping
// cannot carry a per-pair decision — a three-name cluster where two are the
// same company and the third is not has no group-level verdict.
//
// Everything here is pure. The route supplies the vendor rows, the alias set
// (pairs an admin already resolved) and the ack set (pairs somebody said are
// NOT duplicates) — the deck must never re-offer either.

const { foldKey, levDist, fuzzyThreshold, similarity } = require('./nameMatch');

// Order-independent identity for a pair of names. The ack that survives a
// rename is a deliberate non-goal: a rename changes which pair this is.
const pairKey = (a, b) => [String(a || '').trim().toLowerCase(), String(b || '').trim().toLowerCase()]
  .sort().join('|');
// Stored in data_quality_dismissals.flag_key, alongside every other dismissal.
const ackKey = (a, b) => `vdup:${pairKey(a, b)}`;

// Blocking — the cheap test that stops the O(n²) pass from scoring every pair
// of a 400-vendor directory against each other. Two names are worth scoring if
// they start alike, share a substantial token, or are close in length.
function sharesBlock(a, b) {
  const x = foldKey(a), y = foldKey(b);
  if (!x || !y) return false;
  if (x.slice(0, 4) === y.slice(0, 4)) return true;
  if (Math.abs(x.length - y.length) <= 3) return true;
  const tok = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const ta = new Set(tok(a));
  return tok(b).some((t) => ta.has(t));
}

// Words that carry no identity on their own. A shared "records" or "llc" is
// not evidence of anything, and containment on one of them would pair every
// company in the workspace.
const NOISE_TOKENS = new Set([
  'llc', 'inc', 'ltd', 'co', 'corp', 'company', 'the', 'and',
  'records', 'music', 'media', 'group', 'studio', 'studios', 'entertainment',
]);

/**
 * Score one pair. Returns null when they are not plausibly the same vendor.
 * @returns {{score:number, tier:'exact'|'high'|'fuzzy', reason:string}|null}
 */
function scorePair(a, b) {
  const x = foldKey(a), y = foldKey(b);
  if (!x || !y || x.length < 3 || y.length < 3) return null;
  if (x === y) {
    return { score: 1, tier: 'exact', reason: 'Identical once case, spacing, punctuation and accents are ignored' };
  }
  // Containment: "Acme" vs "Acme Records LLC". Only meaningful when the short
  // side is a real name rather than a suffix word.
  const shortSide = x.length <= y.length ? x : y;
  const longSide = x.length <= y.length ? y : x;
  const shortRaw = (x.length <= y.length ? a : b);
  const shortIsNoise = String(shortRaw || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(Boolean).every((t) => NOISE_TOKENS.has(t));
  if (!shortIsNoise && shortSide.length >= 5 && longSide.startsWith(shortSide)) {
    return { score: 0.9, tier: 'high', reason: 'One name is the other plus extra words' };
  }
  const d = levDist(x, y);
  const longer = Math.max(x.length, y.length);
  if (d > fuzzyThreshold(longer)) return null;
  const score = Math.round(similarity(a, b) * 1000) / 1000;
  return {
    score,
    tier: score >= 0.85 ? 'high' : 'fuzzy',
    reason: d === 1 ? 'One character apart' : `${d} characters apart`,
  };
}

/**
 * Which spelling survives. Most invoices first, then a W9 on file, then the
 * longest history — the same canonical-looking rule the flags engine uses, so
 * the deck and the Data-Quality tab never disagree about direction. The deck
 * still offers Swap: this is a default, not a verdict.
 */
function orderPair(a, b) {
  const rank = (v) => [
    -(v.invoice_count || 0),
    v.has_w9 ? 0 : 1,
    v.first_invoice ? new Date(v.first_invoice).getTime() : Infinity,
  ];
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? [a, b] : [b, a];
  return String(a.payee) <= String(b.payee) ? [a, b] : [b, a];
}

/**
 * Every reviewable duplicate pair in a directory.
 * @param vendors [{payee, invoice_count, total_usd, has_w9, first_invoice, last_invoice}]
 * @param opts.aliased  Set of pairKey()s already linked through vendor_aliases
 * @param opts.acked    Set of pairKey()s somebody marked "not duplicates"
 * @param opts.limit    hard cap on returned pairs (default 200)
 */
function vendorDupePairs(vendors, { aliased = new Set(), acked = new Set(), limit = 200 } = {}) {
  const list = (vendors || []).filter((v) => v && String(v.payee || '').trim());
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const key = pairKey(a.payee, b.payee);
      if (aliased.has(key) || acked.has(key)) continue;
      if (!sharesBlock(a.payee, b.payee)) continue;
      const s = scorePair(a.payee, b.payee);
      if (!s) continue;
      const [keep, fold] = orderPair(a, b);
      out.push({
        pair_key: key,
        ack_key: `vdup:${key}`,
        keep,
        fold,
        score: s.score,
        tier: s.tier,
        reason: s.reason,
      });
    }
  }
  // Highest confidence first, then by how much money the merge would move —
  // a wrong merge of a busy vendor is the expensive mistake, so it is reviewed
  // while attention is fresh.
  return out
    .sort((p, q) => q.score - p.score
      || ((q.keep.total_usd || 0) + (q.fold.total_usd || 0)) - ((p.keep.total_usd || 0) + (p.fold.total_usd || 0)))
    .slice(0, limit);
}

module.exports = { pairKey, ackKey, sharesBlock, scorePair, orderPair, vendorDupePairs, NOISE_TOKENS };

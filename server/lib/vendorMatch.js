// Tiered vendor-NAME matcher, for reconciling an outside party's spreadsheet
// against the ledger.
//
// ── Why this is not lib/bankReconcile.js ─────────────────────────────────────
// bankReconcile's name scoring is calibrated for BANK DESCRIPTORS: machine
// noise, truncation, store numbers, `FACEBK *R3FA8FDGP2`. Its thresholds are
// held by fixtures against a shipped automation ladder, and its output feeds
// amount·0.55 + name·0.30 + date·0.15. What this file compares is a HUMAN'S
// TYPED VENDOR NAME on one side and a human's typed payee on the other:
// "10FIFTY LLC (UKG CENTRAL)" vs "10FIFTY LLC", "ACME CO." vs "Acme Co LLC",
// "Jane M Doe" vs "Doe Jane M". Those are legal-entity suffixes, parenthetical
// asides and reordered words — a different failure vocabulary, and one whose
// answer has to carry a REASON, because the reconciliation report shows the
// bookkeeper why two names were treated as the same vendor.
//
// Folding both into one scorer would mean retuning a matcher that is already
// live on money to satisfy a report. These stay separate on purpose.
//
// `foldKey` comes from lib/nameMatch.js so accent/Unicode folding has ONE
// definition app-wide; the tiers below are this file's own.

const { foldKey } = require('./nameMatch');

// Legal-entity noise, dropped before comparing. Includes the non-anglophone
// forms a real roster carries ("Sedyy OÜ", "CW Media Group S.R.L." — the dots
// are already gone by the time this runs, so it arrives as "srl").
const SUFFIX_RE = /\b(llc|llp|ltd|limited|inc|incorporated|corp|corporation|co|company|gmbh|ag|sa|sl|bv|pty|plc|sarl|kg|ou|srl|oy|ab|nv|spa|pte|holdings?|group|enterprises?|partners?)\b/g;

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const stripParens = (s) => s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const stripSuffixes = (s) => s.replace(/[.,]/g, ' ').replace(SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(String(s || '').split(/\s+/).filter((t) => t.length >= 2));

// Containment on a WORD BOUNDARY, not a raw substring. "Neo" is inside
// "Neon Media Group" as characters and is a different company; "IBM" is inside
// "IBM Global Services" as a word and is the same one. A raw `includes` cannot
// tell those apart, and a bare length floor would block the second to stop the
// first. Three characters is the floor underneath that — below it a whole-word
// hit is still mostly noise, and the legal-suffix strip has already removed the
// two-letter words worth removing.
const contains = (long, short) => {
  if (!short || short.length < 3) return false;
  const esc = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${esc}(\\s|$)`).test(long);
};
const containment = (a, b) => (a.length >= b.length ? contains(a, b) : contains(b, a));

// Every tier is a named, orderable reason. The score exists so a caller with
// several invoice-number candidates can prefer the better vendor; it is NOT a
// probability and is never blended into another scorer.
const TIERS = {
  exact: 'Identical',
  parentheticals: 'Identical aside from a parenthetical',
  suffixes: 'Identical once legal suffixes are dropped',
  substring: 'One name contains the other',
  'suffix-substring': 'One name contains the other, suffixes aside',
  tokens: 'Same words, reordered or partially spelled',
  'no-match': 'Different names',
  empty: 'One side has no name',
};

/**
 * @returns {{ match: boolean, score: number, reason: string, tier: string, label: string }}
 *   `tier` is the stable key (safe to switch on); `label` is the plain-English
 *   phrase the report prints; `reason` carries the tier plus any measurement.
 */
function vendorsMatch(a, b) {
  const A = norm(a);
  const B = norm(b);
  const out = (tier, score, extra) => ({
    match: score > 0,
    score,
    tier,
    label: TIERS[tier] || tier,
    reason: extra ? `${tier}-${extra}` : tier,
  });
  if (!A || !B) return out('empty', 0);
  if (A === B) return out('exact', 1.0);

  const Ap = stripParens(A);
  const Bp = stripParens(B);
  if (Ap && Bp && Ap === Bp) return out('parentheticals', 0.95);
  if (Ap && Bp && containment(Ap, Bp)) return out('substring', 0.88);

  const As = stripSuffixes(Ap);
  const Bs = stripSuffixes(Bp);
  if (As && Bs && As === Bs) return out('suffixes', 0.92);
  if (As && Bs && containment(As, Bs)) return out('suffix-substring', 0.85);

  // Spacing-only difference — the one shape a token comparison is blind to,
  // because "KYRAJOHNSON" is one token and "Kyra Johnson" is two. Checked
  // AFTER the word-based tiers so it only ever adds matches.
  const Af = foldKey(As || Ap);
  const Bf = foldKey(Bs || Bp);
  if (Af && Bf && Af === Bf) return out('suffixes', 0.92);

  const At = tokens(As || Ap);
  const Bt = tokens(Bs || Bp);
  if (At.size >= 2 && Bt.size >= 2) {
    let inter = 0;
    for (const t of At) if (Bt.has(t)) inter++;
    const jaccard = inter / (At.size + Bt.size - inter);
    if (jaccard >= 0.7) return out('tokens', 0.6 + 0.3 * jaccard, jaccard.toFixed(2));
  }
  return out('no-match', 0);
}

module.exports = { vendorsMatch, TIERS };

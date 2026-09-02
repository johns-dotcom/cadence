// Fuzzy name matching — ONE definition of "are these two typed names the same
// thing", shared by the Data-Quality flags engine and the vendor duplicate
// deck. Two copies would drift, and a drifted threshold means one surface
// offers a merge the other says is not a duplicate.
//
// `artistKeyOf` (lib/artistKey.js) is the canonical strip-everything key and
// stays that; `foldKey` layers Unicode decomposition on top so "Beyoncé" and
// "Beyonce" — and names carrying non-breaking spaces or trailing periods —
// hash together FOR MATCHING ONLY. It is never persisted, so it cannot drift
// from artist_meta.artist_key.

const { artistKeyOf } = require('./artistKey');

const foldKey = (s) => artistKeyOf(String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));

// Iterative Levenshtein (two-row). Called O(n²) over roster/payee lists, so it
// allocates one row rather than a full matrix.
function levDist(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const v = new Array(n + 1);
  for (let j = 0; j <= n; j++) v[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = v[0]; v[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = v[j];
      v[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, v[j], v[j - 1]);
      prev = tmp;
    }
  }
  return v[n];
}

// Longer strings tolerate more noise. Same scale for artists and vendors.
const fuzzyThreshold = (longer) => (longer <= 6 ? 1 : longer <= 12 ? 2 : 3);

// 0..1 similarity over the folded keys. 1 means "the same name once case,
// spacing, punctuation and accents are ignored" — NOT "the same string".
function similarity(a, b) {
  const x = foldKey(a), y = foldKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const longer = Math.max(x.length, y.length);
  return Math.max(0, 1 - levDist(x, y) / longer);
}

module.exports = { foldKey, levDist, fuzzyThreshold, similarity };

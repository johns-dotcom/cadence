// Does the name on a W9 match the payee we pay?
//
// This question has to be answered LENIENTLY or it is worse than useless: a
// vendor list where a third of the rows carry a red "name mismatch" badge for
// "Smith, LLC" vs "Smith LLC" trains everyone to ignore the badge, and then a
// real mismatch — the one that means the 1099 goes to the wrong entity — is
// invisible too.
//
// Tolerated, because they are the same entity:
//   * entity suffixes and punctuation (LLC / L.L.C. / Inc. / Corp / Ltd / Co)
//   * "Doe, Jane" vs "Jane Doe" (token-set equality, not order)
//   * a middle name or initial on one side only
//   * "&" vs "and", accents, double spaces, case
//
// NOT tolerated: a different surname, a different company, or an individual's
// name against an unrelated company name. Those are the ones worth surfacing.

const SUFFIXES = new Set([
  'llc', 'lc', 'llp', 'lp', 'inc', 'incorporated', 'corp', 'corporation',
  'ltd', 'limited', 'co', 'company', 'plc', 'gmbh', 'pty', 'sa', 'sas', 'bv',
  'dba', 'the',
]);

const strip = (s) => String(s || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Meaningful tokens: entity suffixes and bare initials carry no identity. */
function tokens(s) {
  return strip(s).split(' ').filter((t) => t && !SUFFIXES.has(t));
}

/**
 * true when the two names name the same party. Either side blank ⇒ no claim
 * (returns true), because "we have not read a name" is not a mismatch.
 */
function namesMatch(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return true;
  if (A.join(' ') === B.join(' ')) return true;

  // Initials are dropped only for the comparison, so "Jane Q Doe" and
  // "Jane Doe" agree while "Jane Doe" and "John Doe" still do not.
  const core = (t) => t.filter((x) => x.length > 1);
  const setA = new Set(core(A));
  const setB = new Set(core(B));
  if (!setA.size || !setB.size) return true;
  // One side's meaningful tokens being a subset of the other's is a match:
  // that is exactly the "extra middle name" and "extra trading name" case.
  const subset = (x, y) => [...x].every((t) => y.has(t));
  return subset(setA, setB) || subset(setB, setA);
}

/** The reportable form: null when they agree, else the two names. */
function mismatchOf(payee, w9Name) {
  if (namesMatch(payee, w9Name)) return null;
  return { payee: String(payee || '').trim(), w9_name: String(w9Name || '').trim() };
}

module.exports = { namesMatch, mismatchOf, tokens };

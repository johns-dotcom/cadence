// Does an artist breakdown add up to the invoice it describes?
//
// Cadence splits are a parent+child FAMILY where the parent keeps slice 1, so
// the family total IS the sum of the slices. A breakdown that does not sum to
// the invoice therefore does not merely mis-attribute money — it INVENTS it,
// and every downstream surface (recoupments, artist campaigns, spend sheets,
// P&L) reads family slices.
//
// The public vendor form enforced this in the browser only. routes/vendor.js
// says of the song rule, two hundred lines above the breakdown it stores:
// "a check only the browser performs is a request, not a requirement". This is
// that check for the amounts. Proved before the fix: a $250 invoice submitted
// with lines of $200 and $9,800 approved into a $10,000 family.
//
// TOLERANCE: breakdownChildLines drops a sub-cent remainder per input line, so
// the expanded slices can legitimately fall a cent short per line. Anything
// beyond that is a real disagreement.
function breakdownSum(lines) {
  let cents = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    cents += Math.round((parseFloat(l?.amount) || 0) * 100);
  }
  return cents / 100;
}

function toleranceFor(lines) {
  return 0.01 * ((Array.isArray(lines) ? lines.length : 0) + 1);
}

// true when `lines` add up to `total` within the per-line rounding tolerance.
// An EMPTY breakdown is balanced by definition — there is nothing to reconcile,
// and nothing will be split.
function breakdownBalances(lines, total) {
  if (!Array.isArray(lines) || !lines.length) return true;
  const amt = Number(total);
  if (!Number.isFinite(amt)) return false;
  return Math.abs(breakdownSum(lines) - amt) <= toleranceFor(lines);
}

module.exports = { breakdownSum, breakdownBalances, toleranceFor };

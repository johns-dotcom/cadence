// A real calendar day, not just the right shape.
//
// '2026-02-31' matches /^\d{4}-\d{2}-\d{2}$/ but is not a date. Passed through
// to SQL it becomes a Postgres type error, which surfaces to the user as a 500
// on what is really a 400. This lived as two divergent copies — reports.js
// checked realness, artist-campaigns.js checked only the shape — which is
// exactly how the second copy went stale. One definition, both callers.
function isValidDay(s) {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  // `new Date(y, m, 0)` is the last day of month `m` (months are 1-based here
  // because day 0 of the NEXT month is the last day of this one). Leap-aware.
  return d <= new Date(y, m, 0).getDate();
}

module.exports = { isValidDay };

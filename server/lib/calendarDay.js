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

// Normalize a pg DATE (or timestamp) to 'YYYY-MM-DD' without a TZ round-trip.
//
// node-pg hands a DATE column back as a JS Date built at LOCAL midnight, so
// `new Date(v).toISOString()` shifts the calendar day for anything east of
// UTC. Reading the local parts off the Date pg already built keeps the day
// intact. Returns null for anything that isn't a usable day.
function dayString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

module.exports = { isValidDay, dayString };

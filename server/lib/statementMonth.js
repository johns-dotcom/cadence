// The ONE shared statement-month rule. Day-of-month >= 21 rolls the statement
// to the NEXT month. Uses UTC getters — local getters caused off-by-one-month
// bugs when the server TZ pushed a boundary date across midnight. Everything
// that stamps or buckets recoupment statements imports this.
function statementMonthFor(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return null;
  let m = d.getUTCMonth();
  let y = d.getUTCFullYear();
  if (d.getUTCDate() >= 21) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

module.exports = { statementMonthFor };

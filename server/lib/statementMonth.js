// The ONE shared statement-month rule. Day-of-month >= 21 rolls the statement
// to the NEXT month. Uses UTC getters — local getters caused off-by-one-month
// bugs when the server TZ pushed a boundary date across midnight. Everything
// that stamps or buckets recoupment statements imports this.
//
// Statements are released on the 20th and cover the prior release-to-release
// window: the June statement is released June 20 and holds everything uploaded
// for recoupment between May 21 and June 20 inclusive.
//
// NULL in, NULL out. A UFR row whose `ufr_marked_at` never got stamped belongs
// to NO statement — defaulting it to "now" silently files unstamped claims into
// whichever month you happen to be looking at the page, and makes the client's
// "Unstamped" bucket unreachable.
function statementMonthFor(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  let m = d.getUTCMonth();
  let y = d.getUTCFullYear();
  if (d.getUTCDate() >= 21) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * The timestamp to write when MOVING an item into statement `ym`: noon UTC on
 * the 1st. Day 1 is unambiguously <= 20 in every timezone, so the stamp reads
 * back as `ym` through statementMonthFor, and noon keeps it there no matter
 * which way a viewer's TZ shifts the display.
 * Returns null for anything that is not a real YYYY-MM.
 */
function statementStampFor(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return null;
  const month = Number(m[2]);
  const year = Number(m[1]);
  if (!(month >= 1 && month <= 12) || !(year >= 1900 && year <= 2999)) return null;
  return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
}

/** "May 21, 2026 – Jun 20, 2026" — the upload window a statement covers. */
function statementWindowLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  let sy = year;
  let sm = month - 1;
  if (sm < 1) { sm = 12; sy = year - 1; }
  const f = (y, mo, day) => new Date(Date.UTC(y, mo - 1, day))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${f(sy, sm, 21)} – ${f(year, month, 20)}`;
}

module.exports = { statementMonthFor, statementStampFor, statementWindowLabel };

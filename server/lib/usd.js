// One definition of "what is this row worth in USD" — every report, sheet and
// stat card must convert the same way or two pages disagree about the same row.
//
// Rate convention (matches lib/fx.js and lib/fxStamp.js): rates are units of
// `currency` per 1 USD, so USD = native / rate. `expenses.fx_rate_to_usd` is
// stamped when a row flips to Paid and is immutable after — the locked rate is
// the historically-correct one and always wins over a live rate.
//
// Two rules, both paid for in production by the reference app:
//   * NEVER silently 1:1 a foreign currency. An unknown currency passes
//     through at face value (visible, greppable) rather than zeroing, but a
//     known currency always converts.
//   * Round AT THE ROW, not at subtotals. A sheet that slices the same rows
//     two ways (by state and by category) can only have both slicings tie to
//     the total if each row contributes one already-rounded number.

const { toUSD, getCachedRates } = require('./fx');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Synchronous conversion: locked rate first, else the cached live rate, else
// face value. For code paths that cannot await (SQL post-processing loops
// where a per-row fetch would be pathological).
function usdOf(amount, currency, lockedRate) {
  const n = Number(amount) || 0;
  const locked = Number(lockedRate) || 0;
  if (locked > 0) return n / locked;
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'USD' || !n) return n;
  const rate = Number(getCachedRates()[cur]) || 0;
  return rate > 0 ? n / rate : n;
}

// Async row conversion honoring the lock, with a date-aware live fallback for
// unstamped rows (unpaid foreign rows have no fx_rate_to_usd — fxStamp only
// stamps on Paid). Row needs { amount, currency, fx_rate_to_usd } and
// optionally payment_date / invoice_date / created_at for the as-of date.
async function rowUsd(e) {
  const n = Number(e.amount) || 0;
  const locked = Number(e.fx_rate_to_usd) || 0;
  if (locked > 0) return n / locked;
  const cur = (e.currency || 'USD').toUpperCase();
  if (cur === 'USD' || !n) return n;
  const d = e.payment_date || e.invoice_date || e.created_at || null;
  return toUSD(n, cur, d ? String(d).slice(0, 10) : null);
}

// Rounded-at-the-row variant — the one rounding site for sheet/report rows.
const rowUsd2 = async (e) => round2(await rowUsd(e));

module.exports = { usdOf, rowUsd, rowUsd2, round2 };

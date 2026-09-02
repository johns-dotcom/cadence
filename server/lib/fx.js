// Foreign-exchange rates via frankfurter.app (ECB mid-market, free, no key).
// Converts foreign amounts to USD. Rates cached in-memory: latest for 12h,
// historical dates forever (immutable). Falls back to a hardcoded table if the
// first fetch fails so conversions never hard-break.

const { CURRENCIES } = require('./constants');

// 1 USD = X foreign (fallback only; refreshed from frankfurter on first use).
const FALLBACK = { USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.52, MXN: 17.1, JPY: 150, BRL: 5.0, CHF: 0.88, SEK: 10.5, NOK: 10.7, DKK: 6.9 };

let latest = null;
let latestAt = 0;
const historical = new Map(); // 'YYYY-MM-DD' -> rates object

async function fetchRates(date) {
  // frankfurter: base=USD returns { rates: { EUR: 0.92, ... } }
  const url = `https://api.frankfurter.app/${date || 'latest'}?from=USD`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`FX ${res.status}`);
  const json = await res.json();
  return { USD: 1, ...json.rates };
}

// Coerce whatever a caller has to the 'YYYY-MM-DD' cache/URL key, or null for
// "use the latest rate".
//
// This is load-bearing, not defensive tidying. node-pg hands back a DATE column
// as a JS Date, and the old `String(date).slice(0, 10)` turned that into
// "Tue Sep 01" — a key that never hits the cache, produces a 404 from
// frankfurter, and silently falls through to the hardcoded FALLBACK table. The
// row still converted, so nothing looked broken; it just converted at last
// year's rate, and it re-fetched over the network for EVERY row of EVERY
// request because a failed fetch is never cached. That was measured as ~270ms
// per foreign row on /api/dashboard/widgets.
//
// Local components, never toISOString(): pg parses DATE at LOCAL midnight, so
// getFullYear/getMonth/getDate give back the calendar day pg meant, while
// toISOString() would shift it a day west of UTC.
function dateKey(date) {
  if (!date) return null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  const s = String(date).slice(0, 10);
  // Anything that isn't a real date key means "latest" — asking frankfurter for
  // a garbage path is a guaranteed round-trip to a guaranteed error.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function getRates(date) {
  const key = dateKey(date);
  if (key) {
    if (historical.has(key)) return historical.get(key);
    try { const r = await fetchRates(key); historical.set(key, r); return r; }
    catch { return FALLBACK; }
  }
  if (latest && Date.now() - latestAt < 12 * 3600 * 1000) return latest;
  try { latest = await fetchRates(); latestAt = Date.now(); return latest; }
  catch { return latest || FALLBACK; }
}

// Convert an amount in `currency` to USD. `date` (YYYY-MM-DD, or a Date) uses
// the rate as-of that date; omit for the latest rate. Returns a Number (USD).
async function toUSD(amount, currency, date) {
  const amt = Number(amount) || 0;
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'USD' || !amt) return amt;
  const rates = await getRates(date);
  const rate = rates[cur];
  if (!rate) return amt; // unknown currency — pass through rather than zero it
  return amt / rate;
}

// Warm the cache for a set of as-of dates in ONE parallel burst. Without it a
// loop of per-row toUSD() calls serialises N HTTP round-trips inside a single
// request; with it they overlap and every row then resolves from memory.
// Failures are swallowed — a warmed date that could not be fetched simply
// falls back exactly as it would have.
async function warmRates(dates) {
  const keys = [...new Set((dates || []).map(dateKey).filter(Boolean))].filter((k) => !historical.has(k));
  if (!keys.length) return;
  await Promise.all(keys.map((k) => getRates(k).catch(() => null)));
}

// Convert many { amount, currency, date } rows to a single USD total.
async function sumUSD(rows) {
  let total = 0;
  for (const r of rows) total += await toUSD(r.amount, r.currency, r.date);
  return total;
}

// Synchronous view of the freshest known rates (latest cache, else the
// fallback table). For request-path conversions that cannot await —
// lib/usd.js usdOf(). index.js primes the cache at boot so this is never
// the fallback for long.
function getCachedRates() {
  return latest || FALLBACK;
}

module.exports = { toUSD, sumUSD, getRates, getCachedRates, warmRates, dateKey, SUPPORTED: CURRENCIES };

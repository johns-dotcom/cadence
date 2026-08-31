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

async function getRates(date) {
  if (date) {
    if (historical.has(date)) return historical.get(date);
    try { const r = await fetchRates(date); historical.set(date, r); return r; }
    catch { return FALLBACK; }
  }
  if (latest && Date.now() - latestAt < 12 * 3600 * 1000) return latest;
  try { latest = await fetchRates(); latestAt = Date.now(); return latest; }
  catch { return latest || FALLBACK; }
}

// Convert an amount in `currency` to USD. `date` (YYYY-MM-DD) uses the rate
// as-of that date; omit for the latest rate. Returns a Number (USD).
async function toUSD(amount, currency, date) {
  const amt = Number(amount) || 0;
  const cur = (currency || 'USD').toUpperCase();
  if (cur === 'USD' || !amt) return amt;
  const rates = await getRates(date ? String(date).slice(0, 10) : null);
  const rate = rates[cur];
  if (!rate) return amt; // unknown currency — pass through rather than zero it
  return amt / rate;
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

module.exports = { toUSD, sumUSD, getRates, getCachedRates, SUPPORTED: CURRENCIES };

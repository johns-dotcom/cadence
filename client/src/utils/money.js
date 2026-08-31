// Shared money formatting — one definition instead of the per-page `money()`
// clones. USD-first app; native currencies render with their code.

const fmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "$1,234.56" — for figures already in USD.
export const money = (n) => `$${fmt(n)}`;

// "EUR 1,234.56" — an amount in its own currency.
export const moneyOrig = (n, currency) => `${currency || 'USD'} ${fmt(n)}`;

// "$1.2M" / "$45K" / "$980" — for dense spots (chart axes, callout strips)
// where 2-decimal formatting turns into noise.
export const moneyCompact = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

// "USD 1,200.00 · EUR 500.00" — mixed-currency totals, never netted across
// currencies. `totals` is { CUR: amount }.
export const moneyByCurrency = (totals, sep = ' · ') =>
  Object.entries(totals || {})
    .filter(([, v]) => Math.abs(Number(v) || 0) >= 0.005)
    .map(([c, v]) => moneyOrig(v, c))
    .join(sep);

// Accumulate rows into { CUR: total } using the split-family convention
// (family_amount covers a parent's hidden children).
export const totalsByCurrency = (rows, amountOf) => {
  const t = {};
  for (const r of rows || []) {
    const v = amountOf ? amountOf(r) : Number(r.family_amount ?? r.amount ?? 0);
    const c = r.currency || 'USD';
    t[c] = (t[c] || 0) + (Number(v) || 0);
  }
  return t;
};

export default money;

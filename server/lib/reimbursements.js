// Out-of-pocket reimbursement rollups.
//
// A paid expense whose funding source is a REIMBURSABLE individual (not the
// label's own account) is money the label owes that person until it is marked
// reimbursed. This groups those rows per source into what's owed — per currency
// (never cross-currency summed) plus a USD-equivalent for a single headline.
//
// Pure so the fixture can hold the math. USD conversion honours the locked
// `fx_rate_to_usd` and rounds AT THE ROW (the repo's convention), so the
// per-source total equals what a reader adds up from the rows.
const { usdOf, round2 } = require('./usd');

// True when a row is an outstanding out-of-pocket payment: it was actually paid,
// it came from a reimbursable source, and it hasn't been paid back yet.
function isOwed(row) {
  return row
    && row.payment_status === 'Paid'
    && row.paid_source_id != null
    && row.reimbursable !== false
    && row.reimbursed !== true;
}

// Group rows by funding source. Each row needs { paid_source_id, source_name,
// amount, currency, fx_rate_to_usd }. Returns one entry per source, newest-first
// by usd_total, each with per-currency native totals and a rounded USD total.
function groupBySource(rows) {
  const bySource = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = r.paid_source_id;
    if (id == null) continue;
    let g = bySource.get(id);
    if (!g) { g = { source_id: id, source_name: r.source_name || null, count: 0, by_currency: {}, usd_total: 0 }; bySource.set(id, g); }
    const cur = (r.currency || 'USD').toUpperCase();
    g.by_currency[cur] = round2((g.by_currency[cur] || 0) + (Number(r.amount) || 0));
    g.usd_total += usdOf(r.amount, r.currency, r.fx_rate_to_usd); // sum unrounded, round once at the end
    g.count += 1;
  }
  const out = [...bySource.values()].map(g => ({ ...g, usd_total: round2(g.usd_total) }));
  out.sort((a, b) => b.usd_total - a.usd_total);
  return out;
}

module.exports = { isOwed, groupBySource };

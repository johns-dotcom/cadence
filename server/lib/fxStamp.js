// FX rate stamper.
//
// When an expense row's payment_status flips to 'Paid', we snapshot the
// exchange rate as-of payment_date onto expenses.fx_rate_to_usd. Once stamped,
// the row's USD-equivalent never changes again — the audit guarantee for paid
// invoices. Convention matches lib/fx.js getRates(): value of `currency` per
// 1 USD, so USD = native / fx_rate_to_usd. USD rows get a literal 1 so the
// "is stamped?" check stays consistent (NULL = needs stamping).
//
// Idempotent and best-effort: no-ops if already stamped, not yet paid, or the
// historical fetch fails (row stays NULL; live rates used for display until a
// retry succeeds).

const pool = require('../db');
const { getRates } = require('./fx');

function dateToYmd(d) {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const j = new Date(s);
  return isNaN(j.getTime()) ? null : j.toISOString().slice(0, 10);
}

// Stamp one entry. Pass an optional pg client to join an open transaction.
async function stampFxRateIfPaid(client, entryId) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT id, currency, payment_status, payment_date, fx_rate_to_usd
       FROM expenses WHERE id = $1`,
    [entryId]
  );
  if (!rows.length) return;
  const e = rows[0];
  if (e.fx_rate_to_usd != null) return;     // already locked
  if (e.payment_status !== 'Paid') return;  // not yet paid

  const cur = (e.currency || 'USD').toUpperCase();
  if (cur === 'USD') {
    await db.query(`UPDATE expenses SET fx_rate_to_usd = 1 WHERE id = $1 AND fx_rate_to_usd IS NULL`, [entryId]);
    return;
  }
  const asOf = dateToYmd(e.payment_date) || new Date().toISOString().slice(0, 10);
  const rates = await getRates(asOf);
  const rate = rates?.[cur];
  if (rate == null || !Number.isFinite(Number(rate)) || Number(rate) <= 0) {
    console.warn(`[fxStamp] No rate for ${cur} on ${asOf}; entry ${entryId} stays unlocked`);
    return;
  }
  await db.query(`UPDATE expenses SET fx_rate_to_usd = $1 WHERE id = $2 AND fx_rate_to_usd IS NULL`, [rate, entryId]);
}

// Fire-and-forget for PATCH/PUT handlers — never blocks the response.
function stampFxRateAsync(entryId) {
  stampFxRateIfPaid(null, entryId).catch(err =>
    console.warn(`[fxStamp] async stamp failed for entry ${entryId}: ${err.message}`));
}

// One-shot startup scan for un-stamped paid rows, batched by distinct
// payment_date to keep FX hits proportional to dates, not rows.
async function backfillPaidRows() {
  const { rows } = await pool.query(`
    SELECT id, currency, payment_date FROM expenses
     WHERE payment_status = 'Paid' AND fx_rate_to_usd IS NULL
       AND (deleted = false OR deleted IS NULL)
       AND currency IS NOT NULL AND UPPER(currency) != 'USD'`);

  const stampUsd = () => pool.query(`
    UPDATE expenses SET fx_rate_to_usd = 1
     WHERE payment_status = 'Paid' AND fx_rate_to_usd IS NULL
       AND (deleted = false OR deleted IS NULL)
       AND (currency IS NULL OR UPPER(currency) = 'USD')`).catch(() => {});

  if (!rows.length) { await stampUsd(); console.log('[fxStamp] backfill: no non-USD paid rows pending'); return; }

  const byDate = new Map();
  for (const r of rows) {
    const ymd = dateToYmd(r.payment_date) || new Date().toISOString().slice(0, 10);
    if (!byDate.has(ymd)) byDate.set(ymd, []);
    byDate.get(ymd).push(r);
  }
  let stamped = 0, skipped = 0;
  for (const [ymd, group] of byDate) {
    const rates = await getRates(ymd);
    if (!rates) { skipped += group.length; continue; }
    for (const r of group) {
      const rate = rates[(r.currency || 'USD').toUpperCase()];
      if (rate == null || !Number.isFinite(Number(rate)) || Number(rate) <= 0) { skipped++; continue; }
      try { await pool.query(`UPDATE expenses SET fx_rate_to_usd = $1 WHERE id = $2 AND fx_rate_to_usd IS NULL`, [rate, r.id]); stamped++; }
      catch { skipped++; }
    }
  }
  await stampUsd();
  console.log(`[fxStamp] backfill done: ${stamped} stamped, ${skipped} skipped, across ${byDate.size} dates`);
}

module.exports = { stampFxRateIfPaid, stampFxRateAsync, backfillPaidRows };

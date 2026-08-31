// Reversal pairs — a debit that came back. A credit whose text says
// refund/reversal/return, paired one-to-one with an earlier same-amount debit
// on the same account within the window, with POSITIVE counterparty evidence
// on both sides (never pair blank payees — same-amount coincidences are
// everywhere at $50).

const { normalizeBankPayee } = require('./normalizeBankPayee');

const REVERSAL_RE = /(refund|reversal|reversed|returned? (payment|item|wire)|charge ?back|rtn\b|ret\b.*(ach|wire))/i;
const REVERSAL_WINDOW_DAYS = 21;

const dayMs = 86400000;
const dayGap = (a, b) => Math.abs((new Date(String(a).slice(0, 10)) - new Date(String(b).slice(0, 10))) / dayMs);

function counterpartyKey(t) {
  return normalizeBankPayee(t.payee_guess || '') || normalizeBankPayee(t.description || '');
}
function counterpartyMatch(credit, debit) {
  const c = counterpartyKey(credit);
  const d = counterpartyKey(debit);
  if (!c || !d) return false; // positive evidence required on BOTH sides
  if (c === d) return true;
  // The credit's description often prints the original payee.
  const hay = `${credit.description || ''} ${credit.payee_guess || ''}`.toLowerCase();
  const dp = String(debit.payee_guess || '').toLowerCase().trim();
  return dp.length >= 4 && hay.includes(dp);
}

/**
 * Greedy one-to-one pairing, closest gap first. `txns` = live bank rows of
 * one label (any statements). Returns [{ credit, debit, gap_days }].
 */
function pairReversals(txns) {
  const credits = txns.filter((t) => t.direction === 'credit' && !t.dismissed
    && REVERSAL_RE.test(`${t.description || ''} ${t.payee_guess || ''}`));
  const debits = txns.filter((t) => t.direction === 'debit' && !t.dismissed);
  const candidates = [];
  for (const c of credits) {
    for (const d of debits) {
      if (d.account !== c.account) continue;
      if (Math.abs(Number(d.amount) - Number(c.amount)) > 0.01) continue;
      if (String(d.txn_date).slice(0, 10) > String(c.txn_date).slice(0, 10)) continue; // debit first
      const gap = dayGap(c.txn_date, d.txn_date);
      if (gap > REVERSAL_WINDOW_DAYS) continue;
      if (!counterpartyMatch(c, d)) continue;
      candidates.push({ credit: c, debit: d, gap_days: Math.round(gap) });
    }
  }
  candidates.sort((a, b) => a.gap_days - b.gap_days);
  const usedC = new Set(); const usedD = new Set(); const out = [];
  for (const p of candidates) {
    if (usedC.has(p.credit.id) || usedD.has(p.debit.id)) continue;
    usedC.add(p.credit.id); usedD.add(p.debit.id);
    out.push(p);
  }
  return out;
}

module.exports = { pairReversals, REVERSAL_RE, REVERSAL_WINDOW_DAYS, counterpartyMatch };

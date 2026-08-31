// PayPal funding pairs — every PayPal payment is bank-funded, so it appears
// on BOTH statements: the PayPal debit and the bank pull that funded it.
// Left unpaired, the same spend counts twice. The fix dismisses the BANK PULL
// leg (reason 'funding') and keeps the PayPal side canonical.
//
// Propose-only in cadence: no auto-sweep (a sweep deletes bookings; a person
// confirms each pair).

const { usdOf } = require('./usd');

const DEFAULT_WINDOW_DAYS = 4;
const PAYPAL_FLAT_FEE_GRACE = 4.99; // same-currency pull may exceed by a flat fee

const looksLikePull = (description, payeeGuess) =>
  /paypal/i.test(`${description || ''} ${payeeGuess || ''}`) &&
  /(inst xfer|instant transfer|transfer|des:|echeck|withdrawal|funding)/i.test(`${description || ''}`);

const dayGap = (a, b) => Math.abs((new Date(String(a).slice(0, 10)) - new Date(String(b).slice(0, 10))) / 86400000);

// Does the bank pull's text name the PayPal payment's recipient? A pull that
// names the recipient is strong evidence; single short tokens ("Q", "DJ")
// match everything and are refused.
function namesRecipient(pullText, ppPayee) {
  const name = String(ppPayee || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (!name) return false;
  const hay = String(pullText || '').toLowerCase();
  if (name.length >= 10 && hay.includes(name.slice(0, 10))) return true;
  const tokens = name.split(/\s+/).filter((t) => t.length >= 4);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
}

/**
 * Propose cross-account funding pairs. `ppDebits` = live debits on paypal
 * accounts; `bankDebits` = live debits on non-paypal accounts (not dismissed,
 * not matched/booked — a claimed pull is somebody's answer already).
 * Returns { pairs, ambiguous } — ambiguity is LABELLED, never dropped.
 */
function proposeFundingPairs(ppDebits, bankDebits, { windowDays = DEFAULT_WINDOW_DAYS, under = 0.05, over = 0.20 } = {}) {
  const pairs = [];
  const ambiguous = [];
  const usedBank = new Set();
  for (const pp of ppDebits) {
    const cands = [];
    for (const b of bankDebits) {
      if (usedBank.has(b.id)) continue;
      if (!looksLikePull(b.description, b.payee_guess)) continue;
      if (dayGap(pp.txn_date, b.txn_date) > windowDays) continue;
      const sameCur = (pp.currency || 'USD') === (b.currency || 'USD');
      if (sameCur) {
        const delta = Number(b.amount) - Number(pp.amount);
        if (delta < -0.01 || delta > PAYPAL_FLAT_FEE_GRACE) continue;
        cands.push({ bank: b, tier: 'exact', delta });
      } else {
        // Cross-currency: the pull (USD) sits inside an asymmetric band
        // around the payment's USD value (FX spread + PayPal margin).
        const ppUsd = usdOf(pp.amount, pp.currency, null);
        const ratio = Number(b.amount) / (ppUsd || 1);
        if (ratio < 1 - under || ratio > 1 + over) continue;
        if (!namesRecipient(`${b.description || ''} ${b.payee_guess || ''}`, pp.payee_guess)) continue;
        cands.push({ bank: b, tier: 'fx', delta: Number(b.amount) - ppUsd });
      }
    }
    if (!cands.length) continue;
    cands.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    if (cands.length > 1 && Math.abs(cands[0].delta - cands[1].delta) < 0.01) {
      ambiguous.push({ pp, candidates: cands.map((c) => c.bank) });
      continue;
    }
    usedBank.add(cands[0].bank.id);
    pairs.push({ pp, bank: cands[0].bank, tier: cands[0].tier, delta: Math.round(cands[0].delta * 100) / 100 });
  }
  return { pairs, ambiguous };
}

module.exports = { proposeFundingPairs, looksLikePull, namesRecipient, DEFAULT_WINDOW_DAYS, PAYPAL_FLAT_FEE_GRACE };

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
 *
 * THREE tiers, and the difference between them is what the evidence proves:
 *   exact    — same currency, inside the flat-fee grace. Arithmetic proves it.
 *   fx       — cross-currency AND the pull's text names the recipient. Two
 *              independent facts agree.
 *   unproven — cross-currency, amount fits, nothing names the recipient. The
 *              band alone is not proof, so these are RETURNED SEPARATELY, kept
 *              out of any bulk, and the server demands `confirm_unnamed`.
 *
 * `namesFor(pp)` may supply extra names for the recipient (alias group,
 * learned link, vendor override) — a pull that says "TONE PAY INC" proves a
 * payment to "Tone" only if something knows they are the same company.
 *
 * Returns { pairs, unproven, ambiguous, summary }. Ambiguity is LABELLED,
 * never silently resolved.
 */
function proposeFundingPairs(ppDebits, bankDebits, { windowDays = DEFAULT_WINDOW_DAYS, under = 0.05, over = 0.20, namesFor = null } = {}) {
  const pairs = [];
  const unproven = [];
  const ambiguous = [];
  const usedBank = new Set();
  let usdTwice = 0;
  for (const pp of ppDebits) {
    const cands = [];
    const recipientNames = [pp.payee_guess, ...(namesFor ? namesFor(pp) || [] : [])].filter(Boolean);
    for (const b of bankDebits) {
      if (usedBank.has(b.id)) continue;
      if (!looksLikePull(b.description, b.payee_guess)) continue;
      if (dayGap(pp.txn_date, b.txn_date) > windowDays) continue;
      const sameCur = (pp.currency || 'USD') === (b.currency || 'USD');
      if (sameCur) {
        const delta = Number(b.amount) - Number(pp.amount);
        if (delta < -0.01 || delta > PAYPAL_FLAT_FEE_GRACE) continue;
        cands.push({ bank: b, tier: 'exact', delta, spread_pct: 0, named: null });
      } else {
        // Cross-currency: the pull (USD) sits inside an asymmetric band
        // around the payment's USD value (FX spread + PayPal margin).
        const ppUsd = usdOf(pp.amount, pp.currency, null);
        const ratio = Number(b.amount) / (ppUsd || 1);
        if (ratio < 1 - under || ratio > 1 + over) continue;
        const named = recipientNames.find((n) => namesRecipient(`${b.description || ''} ${b.payee_guess || ''}`, n)) || null;
        cands.push({
          bank: b, tier: named ? 'fx' : 'unproven', delta: Number(b.amount) - ppUsd,
          spread_pct: Math.round((ratio - 1) * 1000) / 10, named,
        });
      }
    }
    if (!cands.length) continue;
    // Proven tiers outrank unproven ones — an unproven candidate must never
    // displace a provable pairing just by being closer on amount.
    const rank = { exact: 0, fx: 1, unproven: 2 };
    cands.sort((a, b) => rank[a.tier] - rank[b.tier] || Math.abs(a.delta) - Math.abs(b.delta));
    const provable = cands.filter((c) => c.tier !== 'unproven');
    const pool = provable.length ? provable : cands;
    if (pool.length > 1 && pool[0].tier === pool[1].tier && Math.abs(pool[0].delta - pool[1].delta) < 0.01) {
      ambiguous.push({ pp, candidates: pool.map((c) => c.bank) });
      continue;
    }
    const best = pool[0];
    usedBank.add(best.bank.id);
    usdTwice += usdOf(pp.amount, pp.currency, null);
    const row = {
      pp, bank: best.bank, tier: best.tier,
      delta: Math.round(best.delta * 100) / 100,
      spread_pct: best.spread_pct, named_by: best.named,
    };
    (best.tier === 'unproven' ? unproven : pairs).push(row);
  }
  return {
    pairs, unproven, ambiguous,
    summary: {
      total: pairs.length + unproven.length + ambiguous.length,
      provable: pairs.length, unproven: unproven.length, ambiguous: ambiguous.length,
      counted_twice_usd: Math.round(usdTwice * 100) / 100,
    },
  };
}

module.exports = { proposeFundingPairs, looksLikePull, namesRecipient, DEFAULT_WINDOW_DAYS, PAYPAL_FLAT_FEE_GRACE };

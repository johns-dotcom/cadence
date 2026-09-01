// Group proposals — one bank debit that settles SEVERAL invoices.
//
// A vendor paid in one transfer for three invoices leaves one bank line and
// three ledger families. Single-invoice matching can only ever answer it
// wrongly (over-claim 409) or not at all, so the debit sits open forever.
//
// The proposal engine looks for a SET of candidate families whose combined
// total lands on the debit. Two rules make it safe to offer:
//
//  * AMBIGUITY IS A REFUSAL, not a coin flip. If two DIFFERENT sets both land
//    on the amount, nothing is offered — a wrong multi-invoice attach marks
//    several real invoices paid by a payment that never covered them, and
//    nothing downstream contradicts it.
//  * ONE VENDOR PER SET. Two unrelated vendors whose invoices happen to add up
//    is an arithmetic coincidence, not evidence. Alias groups count as one
//    vendor; the learned payee map does not (it is an inference, not a fact).
//
// Pure functions — no db. The caller supplies candidates already filtered to
// live, approved, unclaimed family roots.

const { normalizeName } = require('./bankReconcile');

const MAX_PARTS = 4;          // beyond this the search is guessing
const MAX_CANDIDATES = 14;    // 2^14 subsets is the ceiling on the work

/** Vendor identity for grouping: alias group first, else the normalized name. */
function vendorKeyOf(payee, aliasGroups) {
  const raw = String(payee || '').toLowerCase().trim();
  if (!raw) return '';
  const group = aliasGroups && aliasGroups.get(raw);
  if (group && group.size) return [...group].sort()[0];
  return normalizeName(payee) || raw;
}

/**
 * Propose invoice SETS that settle one debit.
 *
 * @param {object} txn        { amount }
 * @param {Array}  candidates [{ id, payee, invoice_number, family_amount, currency, ... }]
 * @param {object} opts       { aliasGroups, tolerance }
 * @returns {{ sets: Array, ambiguous: boolean, considered: number }}
 *   Each set: { expense_ids, invoices, total, delta, vendor }.
 */
function proposeGroups(txn, candidates, { aliasGroups = new Map(), tolerance = null } = {}) {
  const amt = Number(txn.amount);
  if (!Number.isFinite(amt) || amt <= 0) return { sets: [], ambiguous: false, considered: 0 };
  // The same fee tolerance the capacity model uses, so a proposal the engine
  // offers can never be refused by the settle path it feeds.
  const tol = tolerance != null ? tolerance : Math.max(35, amt * 0.01);

  // Group by vendor; only a vendor with 2+ live invoices can form a set.
  const byVendor = new Map();
  for (const c of candidates) {
    const total = Number(c.family_amount);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (total >= amt - 0.005) continue;    // a single invoice covering it is not a GROUP
    const k = vendorKeyOf(c.payee, aliasGroups);
    if (!k) continue;
    const arr = byVendor.get(k) || [];
    arr.push(c);
    byVendor.set(k, arr);
  }

  const found = [];
  let considered = 0;
  for (const [vendor, listRaw] of byVendor) {
    if (listRaw.length < 2) continue;
    // Largest first, capped — the subset search is exponential and the tail of
    // tiny invoices is where false positives live.
    const list = listRaw.slice().sort((a, b) => Number(b.family_amount) - Number(a.family_amount)).slice(0, MAX_CANDIDATES);
    considered += list.length;
    const chosen = [];
    const walk = (start, sum) => {
      if (found.length > 4) return;                     // enough to prove ambiguity
      if (chosen.length >= 2 && Math.abs(sum - amt) <= tol) {
        found.push({
          vendor,
          expense_ids: chosen.map((c) => c.id),
          invoices: chosen.map((c) => ({
            id: c.id, payee: c.payee, invoice_number: c.invoice_number,
            amount: Number(c.family_amount), currency: c.currency || 'USD',
            payment_status: c.payment_status, invoice_date: c.invoice_date,
          })),
          total: Math.round(sum * 100) / 100,
          delta: Math.round((sum - amt) * 100) / 100,
        });
        return;                                          // no supersets of a hit
      }
      if (chosen.length >= MAX_PARTS) return;
      if (sum - tol > amt) return;                       // pruned: already over
      for (let i = start; i < list.length; i++) {
        chosen.push(list[i]);
        walk(i + 1, sum + Number(list[i].family_amount));
        chosen.pop();
      }
    };
    walk(0, 0);
  }

  if (found.length !== 1) return { sets: found.slice(0, 3), ambiguous: found.length > 1, considered };
  return { sets: found, ambiguous: false, considered };
}

module.exports = { proposeGroups, vendorKeyOf, MAX_PARTS };

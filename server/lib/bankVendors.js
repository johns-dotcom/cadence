// Bank vendor groups — the ONE definition of "who the bank says this is".
//
// A bank descriptor is not a vendor name: card processors staple a per-charge
// code onto it, so the same company arrives as a dozen spellings. Grouping is
// by `normalizeBankPayee` (the same key /completion clusters on), and each
// group carries three separate facts that must never be conflated:
//
//   linked_vendor   — what the LEARNED map says future statements should match
//                     (an inference, rewritable)
//   override_vendor — what a PERSON said this descriptor is (a decision)
//   ledger_vendors  — who this group's existing matches actually point at
//                     (the evidence)
//
// The flags engine reads all three: a lesson that contradicts the evidence is
// a wrong link; a group with evidence and no lesson is a link nobody made.
// Rebuilding this grouping anywhere else is how a flag and the surface it
// links to come to disagree.

const pool = require('../db');
const { normalizeBankPayee } = require('./normalizeBankPayee');
const { normalizeName, vendorsMatch } = require('./bankReconcile');

/** Does the raw descriptor visibly contain the ledger vendor's name? */
function descriptorMentions(descriptor, ledgerPayee) {
  const hay = String(descriptor || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const needle = String(ledgerPayee || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!hay || needle.length < 5) return false;
  return hay.includes(needle) || needle.includes(hay);
}

/** Same name once every separator and case difference is squashed away. */
function sameSquashedName(a, b) {
  const sq = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const x = sq(a), y = sq(b);
  return !!x && x.length >= 4 && x === y;
}

/**
 * Aggregate every live debit into bank vendor groups.
 * Returns [{ key, name, n, total, last_seen, linked_vendor, overridden,
 *            override_vendor, ledger_vendors, txn_ids }].
 */
async function aggregateBankVendors(labelId, { limit = 400 } = {}) {
  const { rows } = await pool.query(
    `SELECT t.id, t.payee_guess, t.description, t.amount, t.currency, t.txn_date,
            t.vendor_override, t.matched_expense_id, t.match_method,
            e.payee AS exp_payee, e.entry_source AS exp_source
       FROM bank_transactions t
       JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
       LEFT JOIN expenses e ON e.id = t.matched_expense_id AND (e.deleted IS NULL OR e.deleted = FALSE)
      WHERE t.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE`,
    [labelId]
  );
  const lessons = new Map(
    (await pool.query(`SELECT bank_payee, ledger_payee FROM statement_payee_map WHERE label_id = $1`, [labelId])).rows
      .map((r) => [normalizeBankPayee(r.bank_payee) || normalizeName(r.bank_payee), r.ledger_payee])
  );

  const groups = new Map();
  for (const t of rows) {
    const raw = t.payee_guess || t.description || '';
    const key = normalizeBankPayee(raw) || normalizeName(raw);
    if (!key || key.length < 3) continue;
    const g = groups.get(key) || {
      key, name: raw, n: 0, total: 0, last_seen: null,
      linked_vendor: lessons.get(key) || null,
      overridden: false, override_vendor: null,
      ledgerSet: new Set(), txn_ids: [],
    };
    g.n += 1;
    g.total += Number(t.amount) || 0;
    const d = t.txn_date ? String(t.txn_date).slice(0, 10) : null;
    if (d && (!g.last_seen || d > g.last_seen)) { g.last_seen = d; g.name = raw; }
    if (t.vendor_override) { g.overridden = true; g.override_vendor = t.vendor_override; }
    // Only a REAL invoice names a vendor. An entry the app invented from this
    // very bank line names the descriptor back at itself — circular evidence.
    if (t.exp_payee && t.exp_source !== 'bank_statement') g.ledgerSet.add(t.exp_payee);
    if (g.txn_ids.length < 200) g.txn_ids.push(t.id);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, ledger_vendors: [...g.ledgerSet], ledgerSet: undefined, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * The ledger vendor a descriptor is KNOWN to mean, with its provenance —
 * the queue's `vendor_hint`. Order is the confidence order: a person's
 * override outranks a learned lesson, which outranks an alias, which outranks
 * this row's own past matches.
 */
function vendorHintFor(txn, maps, matchedNames) {
  if (txn.vendor_override) return { name: txn.vendor_override, source: 'override' };
  const raw = txn.payee_guess || txn.description || '';
  const norm = normalizeBankPayee(raw);
  const exact = maps.payeeMap[normalizeName(raw)];
  if (exact) return { name: exact, source: 'learned' };
  if (norm.length >= 3 && maps.payeeMap[`~${norm}`]) return { name: maps.payeeMap[`~${norm}`], source: 'learned' };
  const alias = maps.aliasGroups && maps.aliasGroups.get(String(raw).toLowerCase().trim());
  if (alias && alias.size > 1) return { name: [...alias].sort()[0], source: 'alias' };
  const seen = matchedNames && matchedNames.get(norm);
  if (seen && seen.size === 1) return { name: [...seen][0], source: 'history' };
  return null;
}

module.exports = { aggregateBankVendors, vendorHintFor, descriptorMentions, sameSquashedName, vendorsMatch };

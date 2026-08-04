// Split-family payment coherence. A split family (parent + children via
// parent_id) must NEVER disagree about payment state — every payment flip
// cascades to the whole family in one write. Totals elsewhere assume the parent
// keeps only its own slice and children carry theirs, so we SUM all rows.
const pool = require('../db');

// Resolve the family root id for any member (parent keeps its own id).
async function familyRoot(db, id, labelId) {
  const { rows } = await (db || pool).query('SELECT COALESCE(parent_id, id) AS root FROM expenses WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows[0]?.root || null;
}

// Set the given payment fields on every row of the family (root + children).
async function cascadePaymentFieldsToFamily(db, rootId, labelId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length || !rootId) return;
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const vals = cols.map(c => fields[c]);
  vals.push(rootId, labelId);
  await (db || pool).query(
    `UPDATE expenses SET ${sets.join(', ')} WHERE (id = $${vals.length - 1} OR parent_id = $${vals.length - 1}) AND label_id = $${vals.length}`,
    vals
  );
}

// Sum installments across the family; promote the WHOLE family to Paid when
// covered (cents-tolerant), Partial when 0 < sum < total, else Unpaid.
async function recomputeFamilyPaymentStatus(db, rootId, labelId) {
  const c = db || pool;
  const fam = await c.query('SELECT id, amount FROM expenses WHERE (id = $1 OR parent_id = $1) AND label_id = $2', [rootId, labelId]);
  if (!fam.rows.length) return null;
  const total = fam.rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  const ids = fam.rows.map(r => r.id);
  const paidRow = await c.query('SELECT COALESCE(SUM(amount), 0) AS s FROM payment_installments WHERE label_id = $1 AND expense_id = ANY($2::int[])', [labelId, ids]);
  const sum = Number(paidRow.rows[0].s);
  let status = 'Unpaid';
  if (total > 0 && sum >= total - 0.01) status = 'Paid';
  else if (sum > 0) status = 'Partial';
  await c.query('UPDATE expenses SET payment_status = $1 WHERE (id = $2 OR parent_id = $2) AND label_id = $3', [status, rootId, labelId]);
  return status;
}

module.exports = { familyRoot, cascadePaymentFieldsToFamily, recomputeFamilyPaymentStatus };

// Multi-invoice settlement plumbing — one payment settling several invoices
// through bank_txn_invoice_links, with the capacity model (claimed sums) that
// refuses over-payment in code rather than schema.

const pool = require('../db');
const { usdOf, round2 } = require('./usd');

const feeTolerance = (n) => Math.max(35, Number(n) * 0.01);

/** Σ of live bank debits settling each family root. Map<rootId, amount>. */
async function loadClaimedSums(labelId) {
  const { rows } = await pool.query(
    `SELECT matched_expense_id AS root, SUM(amount) AS s
       FROM bank_transactions
      WHERE label_id = $1 AND matched_expense_id IS NOT NULL AND dismissed = FALSE AND direction = 'debit'
      GROUP BY matched_expense_id`,
    [labelId]
  );
  return new Map(rows.map((r) => [r.root, Number(r.s)]));
}

/**
 * Settle one bank txn against one-or-more invoice family roots, atomically.
 * Validates every family (approved, live, not bank-born) and the combined
 * capacity; matched_expense_id gets the PRIMARY (largest family); link rows
 * cover every id INCLUDING the primary. Throws {status, message} on refusal.
 */
async function settleTxnWithInvoices(labelId, txnId, expenseIds, { userName, allowPrepayment = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const t = (await client.query(`SELECT * FROM bank_transactions WHERE id = $1 AND label_id = $2 FOR UPDATE`, [txnId, labelId])).rows[0];
    if (!t) throw Object.assign(new Error('Transaction not found'), { status: 404 });
    if (t.direction !== 'debit') throw Object.assign(new Error('Only debits settle invoices'), { status: 400 });
    if (t.match_method === 'created' || t.booked) throw Object.assign(new Error('This line was booked — unbook it first'), { status: 400 });

    const ids = [...new Set(expenseIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    if (!ids.length || ids.length > 25) throw Object.assign(new Error('1-25 invoices per payment'), { status: 400 });

    const fams = (await client.query(
      `SELECT e.id, e.payee, e.invoice_date, e.entry_source, e.parent_id, e.status, e.deleted, e.voided,
              COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd,
              (e.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = e.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS family_amount
         FROM expenses e WHERE e.id = ANY($1::int[]) AND e.label_id = $2`,
      [ids, labelId]
    )).rows;
    if (fams.length !== ids.length) throw Object.assign(new Error('Some invoices were not found'), { status: 400 });
    for (const f of fams) {
      if (f.parent_id) throw Object.assign(new Error(`Entry #${f.id} is a split slice — attach its family root`), { status: 400 });
      if (f.status !== 'approved' || f.deleted || f.voided) throw Object.assign(new Error(`Entry #${f.id} ("${f.payee}") is not a live approved invoice`), { status: 400 });
      if (f.entry_source === 'bank_statement') throw Object.assign(new Error(`Entry #${f.id} was itself created from a bank line`), { status: 400 });
      if (!allowPrepayment && f.invoice_date && String(t.txn_date).slice(0, 10) < String(f.invoice_date).slice(0, 10)) {
        const early = Math.round((new Date(String(f.invoice_date).slice(0, 10)) - new Date(String(t.txn_date).slice(0, 10))) / 86400000);
        if (early > 5) throw Object.assign(new Error(`The debit predates invoice #${f.id} by ${early} days — pass allow_prepayment to record it anyway`), { status: 400, prepayment_possible: true });
      }
    }
    // Capacity: this txn + other live txns already settling these families
    // must not exceed the combined family total (in USD to survive mixes).
    const combinedUsd = fams.reduce((s, f) => s + usdOf(f.family_amount, f.currency, f.fx_rate_to_usd), 0);
    const others = (await client.query(
      `SELECT COALESCE(SUM(bt.amount), 0) AS s FROM bank_transactions bt
        WHERE bt.label_id = $1 AND bt.dismissed = FALSE AND bt.id <> $2
          AND (bt.matched_expense_id = ANY($3::int[])
               OR EXISTS (SELECT 1 FROM bank_txn_invoice_links bl WHERE bl.txn_id = bt.id AND bl.label_id = $1 AND bl.expense_id = ANY($3::int[])))`,
      [labelId, txnId, ids]
    )).rows[0];
    const txnUsd = usdOf(t.amount, t.currency, null);
    const claimed = Number(others.s) || 0; // face value; close enough same-currency, refined per-currency below tolerance
    if (claimed + txnUsd > combinedUsd + (claimed > 0 ? 0.01 : feeTolerance(combinedUsd))) {
      throw Object.assign(new Error(`That would over-pay: ${round2(claimed + txnUsd)} against invoices totalling ${round2(combinedUsd)}`), { status: 409 });
    }

    const primary = fams.slice().sort((a, b) => Number(b.family_amount) - Number(a.family_amount))[0];
    await client.query(`DELETE FROM bank_txn_invoice_links WHERE txn_id = $1 AND label_id = $2`, [txnId, labelId]);
    for (const f of fams) {
      await client.query(
        `INSERT INTO bank_txn_invoice_links (label_id, txn_id, expense_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [labelId, txnId, f.id, userName || null]
      );
    }
    await client.query(
      `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'manual', match_score = 1.0,
              matched_by = $2, matched_at = NOW(), dismissed = FALSE, dismissed_reason = NULL, booked = FALSE
        WHERE id = $3 AND label_id = $4`,
      [primary.id, userName || null, txnId, labelId]
    );
    await client.query('COMMIT');
    return { matched_expense_id: primary.id, linked: fams.map((f) => f.id) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Restore the booking a rematch/attach DISPLACED, if there is one.
 *
 * A rematch soft-deletes the invented entry with the breadcrumb
 * `rematch#<txnId>` and repoints the txn at the real invoice. Unlinking that
 * txn afterwards must not leave the row OPEN with its entry in the graveyard —
 * that is a dead-end state: the money reads unanswered while an archived entry
 * holds the only record of the original answer. Restoring puts the row back
 * exactly where the rematch found it.
 *
 * Returns the restored root id, or null when nothing was displaced.
 */
async function restoreDisplacedBooking(labelId, txnId, actor) {
  const tag = `rematch#${txnId}`;
  const root = (await pool.query(
    `SELECT id FROM expenses WHERE label_id = $1 AND deleted_by = $2 AND parent_id IS NULL LIMIT 1`,
    [labelId, tag]
  )).rows[0];
  if (!root) return null;
  await pool.query(
    `UPDATE expenses SET deleted = FALSE, deleted_by = NULL, deleted_at = NULL WHERE label_id = $1 AND deleted_by = $2`,
    [labelId, tag]
  );
  await pool.query(
    `UPDATE bank_transactions SET matched_expense_id = $1, match_method = 'created', match_score = 1.0,
            booked = TRUE, matched_by = $2, matched_at = NOW()
      WHERE id = $3 AND label_id = $4`,
    [root.id, actor || null, txnId, labelId]
  );
  return root.id;
}

/**
 * Unlink a txn (links + primary). Never touches ledger rows — EXCEPT that a
 * booking this txn's match displaced is restored (see above), because the
 * alternative is an open row whose only answer is soft-deleted.
 * Returns { ok, restored } — `restored` is the root id put back, or null.
 */
async function detachTxn(labelId, txnId, { restore = true, actor = null } = {}) {
  await pool.query(`DELETE FROM bank_txn_invoice_links WHERE txn_id = $1 AND label_id = $2`, [txnId, labelId]);
  const { rows } = await pool.query(
    `UPDATE bank_transactions SET matched_expense_id = NULL, match_method = NULL, match_score = NULL,
            matched_by = NULL, matched_at = NULL, booked = FALSE
      WHERE id = $1 AND label_id = $2 AND match_method IS DISTINCT FROM 'created'
      RETURNING id`,
    [txnId, labelId]
  );
  if (!rows.length) return { ok: false, restored: null };
  const restored = restore ? await restoreDisplacedBooking(labelId, txnId, actor).catch(() => null) : null;
  return { ok: true, restored };
}

module.exports = { loadClaimedSums, settleTxnWithInvoices, detachTxn, restoreDisplacedBooking, feeTolerance };

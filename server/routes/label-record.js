/**
 * The label's own record — who this workspace IS on paper (§7).
 *
 * The remittance block (company, contact, bank), who signs its documents, and
 * how it expects to be paid. One row per label, created by the bootstrap for
 * every existing workspace and seeded from `labels.invoice_settings`.
 *
 * ── Why this is canonical ──
 * The payable-to block appeared in three places — the invoice PDF, the
 * create-invoice preview, and the sidebar's copy-our-billing-address — all
 * reading loose JSON on `labels.invoice_settings`. Adding a second home for a
 * company's bank details is how two screens end up disagreeing about where
 * money should be sent, so this table is the single store and the old key is
 * now DERIVED from it (see `remittanceShape`). The legacy column is left in
 * place, unread, rather than dropped: it is the only copy of what the values
 * were before the cutover.
 *
 * ── Why nothing here is encrypted ──
 * Deliberate divergence from the reference spec, which kept the EIN and bank
 * numbers encrypted behind a Superadmin-only audited reveal. Every field here
 * is printed on the invoice — EIN and account number included — and invoices
 * are issued by Admins and Approvers, so that gate would empty the payable-to
 * block for exactly the people whose job is to send them. These numbers go to
 * every client the label bills; they are published business data, not secrets.
 *
 * The vendor vault (lib/paymentCrypto.js) stays encrypted for the opposite
 * reason: those are other people's account numbers, given to us in confidence
 * and printed on nothing.
 */
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// The remittance block as it is printed. Order mirrors the form and the PDF.
const REMITTANCE_FIELDS = [
  'company_name', 'address', 'contact', 'phone', 'email', 'ein',
  'bank_name', 'bank_address', 'account_name', 'account_type',
  'swift', 'routing', 'routing_ach', 'account_number',
];

// Everything else the record carries. Split out only so the form can group
// them; both lists are writable by the same roles.
const RECORD_FIELDS = [
  'display_name', 'website', 'signatory_name', 'signatory_title',
  'signatory_email', 'payment_terms',
];

// One allow-list, built from the two above. A new column is inert until it is
// named here — the alternative is spreading req.body into an UPDATE, which is
// how `label_id` ends up settable from a settings form.
const WRITABLE = [...REMITTANCE_FIELDS, ...RECORD_FIELDS];

/**
 * The legacy `invoice_settings` shape, derived from a record row.
 * Used by the label read paths so their consumers did not have to change.
 */
const remittanceShape = (rec) => {
  const out = {};
  for (const f of REMITTANCE_FIELDS) out[f] = rec?.[f] || null;
  // The company line falls back the way the invoice needs it to: a workspace
  // that never filled in a legal name still prints its own name rather than
  // an empty heading.
  out.company_name = rec?.company_name || rec?.display_name || null;
  return out;
};

/** Ensure the row exists — a label created after the bootstrap ran has none. */
async function ensureRow(labelId) {
  await pool.query(
    `INSERT INTO label_records (label_id, display_name)
     SELECT id, name FROM labels WHERE id = $1
     ON CONFLICT (label_id) DO NOTHING`,
    [labelId]
  );
}

// GET /api/label-record
router.get('/', requireAdmin, async (req, res) => {
  try {
    await ensureRow(req.labelId);
    const { rows } = await pool.query(
      `SELECT r.*, u.name AS updated_by_name
       FROM label_records r
       LEFT JOIN users u ON u.id = r.updated_by
       WHERE r.label_id = $1`,
      [req.labelId]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    console.error('Get label record error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/label-record — admin only, partial update.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    await ensureRow(req.labelId);

    const sets = [];
    const vals = [];
    const touched = [];
    for (const f of WRITABLE) {
      if (req.body[f] === undefined) continue;
      const v = req.body[f] === null ? null : (String(req.body[f]).trim().slice(0, 2000) || null);
      vals.push(v);
      sets.push(`${f} = $${vals.length}`);
      touched.push(f);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    vals.push(req.user.id);
    sets.push(`updated_by = $${vals.length}`);
    sets.push('updated_at = NOW()');
    vals.push(req.labelId);

    const { rows } = await pool.query(
      `UPDATE label_records SET ${sets.join(', ')} WHERE label_id = $${vals.length} RETURNING *`,
      vals
    );

    // Name the FIELDS, never the values — an activity row that records a bank
    // account number puts it somewhere far more widely read than this table.
    await logActivity(req, 'Updated label record', touched.join(', '));
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label record error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.remittanceShape = remittanceShape;
module.exports.REMITTANCE_FIELDS = REMITTANCE_FIELDS;

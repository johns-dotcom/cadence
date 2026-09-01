const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { TERMS, DEFAULT_TERMS, DEFAULT_BUSINESS_TZ, resolveDue, isDay, businessDay } = require('../lib/payment-terms');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// The label's business timezone — the calendar its invoices are dated in.
// Stored in labels.settings.business_tz; the default matches the reference app.
// A lookup failure falls back rather than 500s: a missing setting must not take
// down a page whose job here is only to show a date.
async function labelTz(labelId) {
  try {
    const { rows } = await pool.query('SELECT settings FROM labels WHERE id = $1', [labelId]);
    return rows[0]?.settings?.business_tz || DEFAULT_BUSINESS_TZ;
  } catch {
    return DEFAULT_BUSINESS_TZ;
  }
}

// The invoice's own date. An invoice created today is dated today; an edit
// keeps the date the invoice was issued on, because re-saving a document must
// not move the deadline the client was given.
const dayOf = (v) => {
  if (isDay(v)) return v;
  // pg hands back a DATE/TIMESTAMP as a JS Date, and String(date).slice(0, 10)
  // is "Tue Jun 10" — not a date. UTC via toISOString, like every other date
  // in this file.
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v || '');
  if (isDay(s.slice(0, 10))) return s.slice(0, 10);
  const p = new Date(s);
  return Number.isNaN(p.getTime()) ? null : p.toISOString().slice(0, 10);
};

/**
 * The date an invoice BEARS, attached to every row this router hands out.
 *
 * Derived from `created_at` through `businessDay`, the same function the
 * due-date arithmetic anchors on — so the date printed on the document and the
 * date its deadline was counted from cannot be two different days. The client
 * prints this string and does no date math of its own; rendering `created_at`
 * with `toLocaleDateString` is what put them a day apart.
 */
const withInvoiceDate = (row, tz) => (row ? { ...row, invoice_date: businessDay(row.created_at, tz) } : row);

// GET the terms this app offers — one list, so the dropdown cannot drift from
// the arithmetic behind it.
router.get('/terms', (req, res) => {
  res.json({ success: true, data: { terms: TERMS.map((t) => ({ label: t.label, days: t.days, custom: t.custom })), default: DEFAULT_TERMS } });
});

// GET the due date for a choice, so the live preview shows exactly what a save
// would store rather than a second implementation's opinion of it.
router.get('/due-date', async (req, res) => {
  const tz = await labelTz(req.labelId);
  // The anchor is the SERVER's, not the caller's. `invoice_id` re-terms an
  // existing invoice from the date it was issued; with neither that nor an
  // explicit date, a new invoice is dated today in the company's timezone.
  let issued = dayOf(req.query.date);
  if (!issued && /^\d+$/.test(String(req.query.invoice_id || ''))) {
    // A lookup failure must not break the preview: fall through to today.
    try {
      const { rows } = await pool.query('SELECT created_at FROM invoices WHERE id = $1 AND label_id = $2', [req.query.invoice_id, req.labelId]);
      if (rows.length) issued = businessDay(rows[0].created_at, tz);
    } catch { /* fall through to today */ }
  }
  if (!issued) issued = businessDay(new Date(), tz);
  const out = resolveDue(req.query.terms, issued, req.query.custom);
  // 200 with the error named: the preview asks this on every keystroke of a
  // custom date, and a half-typed date is not a failure worth a 400.
  res.json({ success: true, data: { ...out, invoice_date: issued } });
});

// GET /api/invoices — all invoices issued by this label
router.get('/', async (req, res) => {
  try {
    const tz = await labelTz(req.labelId);
    const { rows } = await pool.query(
      'SELECT * FROM invoices WHERE label_id = $1 ORDER BY invoice_number DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows.map((r) => withInvoiceDate(r, tz)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/invoices/next-number — next sequential number FOR THIS LABEL
router.get('/next-number', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT COALESCE(MAX(invoice_number), -1) + 1 AS next_number FROM invoices WHERE label_id = $1',
      [req.labelId]
    );
    res.json({ success: true, data: { next_number: rows[0].next_number } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/invoices — create. Number is assigned per-label.
router.post('/', async (req, res) => {
  try {
    const { bill_to, bill_to_address, description, amount, purchase_order, line_items, currency,
      payment_terms, due_date } = req.body;
    if (!bill_to || amount == null) {
      return res.status(400).json({ success: false, error: 'Bill-to and amount are required' });
    }

    const tz = await labelTz(req.labelId);

    // `due_by` is RECOMPUTED here, never taken from the request. It used to be
    // a free string the caller supplied, so the printed deadline and the terms
    // could say different things and neither was checked. Now the terms are
    // the input and both the date and the printed line are derived from them.
    //
    // A new invoice is dated today in the COMPANY's timezone, and `created_at`
    // is pinned to the very instant that day was read from. Letting the column
    // default to NOW() instead leaves a window around midnight in which the
    // stored timestamp lands on the next day and the printed date stops
    // matching the deadline; passing it closes that by construction.
    const raisedAt = new Date();
    const issued = dayOf(req.body.invoice_date) || businessDay(raisedAt, tz);
    const due = resolveDue(payment_terms || DEFAULT_TERMS, issued, due_date);
    if (due.error) return res.status(400).json({ success: false, error: due.error });

    // Assign the next number atomically within the label's sequence.
    const { rows: numRows } = await pool.query(
      'SELECT COALESCE(MAX(invoice_number), -1) + 1 AS next_number FROM invoices WHERE label_id = $1',
      [req.labelId]
    );
    const invoice_number = numRows[0].next_number;

    const cur = (currency || 'USD').toUpperCase().slice(0, 6);
    const { rows } = await pool.query(
      `INSERT INTO invoices (label_id, invoice_number, bill_to, bill_to_address, description, amount, purchase_order, due_by, line_items, currency, created_by, payment_terms, due_date, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        req.labelId, invoice_number, bill_to, bill_to_address || null, description || null, amount,
        purchase_order || 'N/A', due.due_by || 'UPON RECEIPT',
        line_items ? JSON.stringify(line_items) : null, cur, req.user.name,
        due.terms, due.due_date, raisedAt,
      ]
    );
    await logActivity(req, 'Created invoice', `#${invoice_number} — ${bill_to}`);
    res.status(201).json({ success: true, data: withInvoiceDate(rows[0], tz) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Invoice number collision — retry' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/invoices/:id — update allowed fields (incl. payment_status).
// `due_by` is no longer settable directly — it is DERIVED. Leaving it writable
// alongside payment_terms would let the printed deadline and the terms
// disagree, which is the state this route exists to remove.
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(404).json({ success: false, error: 'Invoice not found' });
    const tz = await labelTz(req.labelId);
    const allowed = ['payment_status', 'bill_to', 'bill_to_address', 'description', 'amount', 'purchase_order', 'line_items', 'currency'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    const patch = {};
    // Re-terming an invoice recomputes from the date it was ISSUED, not today.
    // Anchoring on today would move a deadline the client has already been
    // given every time somebody fixed a typo in the description.
    if (req.body.payment_terms !== undefined || req.body.due_date !== undefined) {
      const { rows: cur } = await pool.query(
        'SELECT created_at, payment_terms, due_date FROM invoices WHERE id = $1 AND label_id = $2', [id, req.labelId]);
      if (!cur.length) return res.status(404).json({ success: false, error: 'Invoice not found' });
      // businessDay, not dayOf: the UTC day of a 5pm-Pacific timestamp is
      // tomorrow, so re-terming an invoice raised in the evening would move
      // its deadline a day past what the document printed.
      const issued = businessDay(cur[0].created_at, tz);
      if (!issued) return res.status(400).json({ success: false, error: 'this invoice has no readable issue date to count terms from' });
      const terms = req.body.payment_terms !== undefined ? req.body.payment_terms : cur[0].payment_terms;
      const custom = req.body.due_date !== undefined ? req.body.due_date : dayOf(cur[0].due_date);
      const due = resolveDue(terms, issued, custom);
      if (due.error) return res.status(400).json({ success: false, error: due.error });
      patch.payment_terms = due.terms;
      patch.due_date = due.due_date;
      patch.due_by = due.due_by || 'UPON RECEIPT';
    }
    const patchKeys = Object.keys(patch);
    if (!fields.length && !patchKeys.length) return res.status(400).json({ success: false, error: 'No valid fields' });
    const setClauses = [...fields, ...patchKeys].map((f, i) => `${f} = $${i + 3}`);
    const values = [
      ...fields.map(f => (f === 'line_items' && req.body[f] ? JSON.stringify(req.body[f]) : req.body[f])),
      ...patchKeys.map(k => patch[k]),
    ];
    const { rows } = await pool.query(
      `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $1 AND label_id = $2 RETURNING *`,
      [id, req.labelId, ...values]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true, data: withInvoiceDate(rows[0], tz) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM invoices WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

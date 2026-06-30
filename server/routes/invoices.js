const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// GET /api/invoices — all invoices issued by this label
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM invoices WHERE label_id = $1 ORDER BY invoice_number DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
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
    const { bill_to, bill_to_address, description, amount, purchase_order, due_by, line_items, currency } = req.body;
    if (!bill_to || amount == null) {
      return res.status(400).json({ success: false, error: 'Bill-to and amount are required' });
    }

    // Assign the next number atomically within the label's sequence.
    const { rows: numRows } = await pool.query(
      'SELECT COALESCE(MAX(invoice_number), -1) + 1 AS next_number FROM invoices WHERE label_id = $1',
      [req.labelId]
    );
    const invoice_number = numRows[0].next_number;

    const { rows } = await pool.query(
      `INSERT INTO invoices (label_id, invoice_number, bill_to, bill_to_address, description, amount, purchase_order, due_by, line_items, currency, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        req.labelId, invoice_number, bill_to, bill_to_address || null, description || null, amount,
        purchase_order || 'N/A', due_by || 'UPON RECEIPT',
        line_items ? JSON.stringify(line_items) : null, currency || 'USD', req.user.name,
      ]
    );
    await logActivity(req, 'Created invoice', `#${invoice_number} — ${bill_to}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Invoice number collision — retry' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/invoices/:id — update allowed fields (incl. payment_status)
router.put('/:id', async (req, res) => {
  try {
    const allowed = ['payment_status', 'bill_to', 'bill_to_address', 'description', 'amount', 'purchase_order', 'due_by', 'line_items', 'currency'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ success: false, error: 'No valid fields' });
    const setClauses = fields.map((f, i) => `${f} = $${i + 3}`);
    const values = fields.map(f => (f === 'line_items' && req.body[f] ? JSON.stringify(req.body[f]) : req.body[f]));
    const { rows } = await pool.query(
      `UPDATE invoices SET ${setClauses.join(', ')} WHERE id = $1 AND label_id = $2 RETURNING *`,
      [parseInt(req.params.id, 10), req.labelId, ...values]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true, data: rows[0] });
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

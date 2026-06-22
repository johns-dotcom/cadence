const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

const UPDATABLE = ['counterparty', 'type', 'status', 'sent_date', 'due_date', 'notes'];

// GET /api/pending-contracts — the signing queue for this workspace.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM pending_contracts WHERE label_id = $1 ORDER BY created_at DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List pending contracts error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/pending-contracts
router.post('/', async (req, res) => {
  try {
    const counterparty = (req.body.counterparty || '').trim();
    if (!counterparty) return res.status(400).json({ success: false, error: 'Counterparty is required' });
    const { rows } = await pool.query(
      `INSERT INTO pending_contracts (label_id, counterparty, type, status, sent_date, due_date, notes, created_by)
       VALUES ($1,$2,$3,COALESCE($4,'Not Sent'),$5,$6,$7,$8) RETURNING *`,
      [req.labelId, counterparty, req.body.type || null, req.body.status || null, req.body.sent_date || null, req.body.due_date || null, req.body.notes || null, req.user.id]
    );
    await logActivity(req, 'Added pending contract', counterparty);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create pending contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/pending-contracts/:id
router.patch('/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE pending_contracts SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update pending contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/pending-contracts/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM pending_contracts WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete pending contract error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
// Generated NDA documents (the builder at /create-nda/:template). Approver+
// only. Distinct from /api/ndas, which tracks executed counterparty NDAs.
router.use(authMiddleware, withTenant, requireApprover);

// `data` holds the template-specific field set + which optional clauses are
// enabled; custom_body is the final, possibly hand-edited, document text.
const FIELDS = ['template', 'title', 'data', 'custom_body'];

// GET /api/nda-documents — all saved generated NDAs for this workspace.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM nda_documents WHERE label_id = $1 ORDER BY created_at DESC, id DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List NDA documents error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/nda-documents — create.
router.post('/', async (req, res) => {
  try {
    if (!req.body.template) return res.status(400).json({ success: false, error: 'Template is required' });
    if (!req.body.custom_body || !String(req.body.custom_body).trim()) {
      return res.status(400).json({ success: false, error: 'Document body is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO nda_documents (label_id, created_by, template, title, data, custom_body)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.labelId, req.user.id, req.body.template, req.body.title || null, req.body.data || {}, req.body.custom_body]
    );
    await logActivity(req, 'Created NDA', req.body.title || req.body.template);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create NDA document error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/nda-documents/:id — update.
router.put('/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => FIELDS.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE nda_documents SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'NDA not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update NDA document error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/nda-documents/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM nda_documents WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'NDA not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete NDA document error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

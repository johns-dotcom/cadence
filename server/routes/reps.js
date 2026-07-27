const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/reps — the workspace's rep list. Any authenticated member can read
// it (the names populate dropdowns); only admins mutate it. ?all=1 includes
// deactivated reps (for the management screen).
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const { rows } = await pool.query(
      `SELECT id, name, email, active FROM reps
       WHERE label_id = $1 ${includeInactive ? '' : 'AND active = TRUE'}
       ORDER BY active DESC, LOWER(name)`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List reps error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/reps — add a rep (admin).
router.post('/', requireAdmin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO reps (label_id, name) VALUES ($1, $2) RETURNING id, name, active`,
      [req.labelId, name]
    );
    await logActivity(req, 'Added rep', name);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'That rep already exists' });
    console.error('Create rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/reps/:id — rename or (de)activate (admin). Deactivating keeps the
// name on historical records but hides it from new dropdowns.
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const fields = [];
    const values = [];
    if (typeof req.body.name === 'string' && req.body.name.trim()) { fields.push(`name = $${fields.length + 1}`); values.push(req.body.name.trim()); }
    if (typeof req.body.active === 'boolean') { fields.push(`active = $${fields.length + 1}`); values.push(req.body.active); }
    if (!fields.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE reps SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING id, name, active`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'That rep already exists' });
    console.error('Update rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/reps/:id — remove a rep entirely (admin).
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM reps WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

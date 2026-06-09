const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/label — the current workspace (tenant) settings
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, created_at,
              (SELECT COUNT(*) FROM users WHERE label_id = labels.id) AS member_count
       FROM labels WHERE id = $1`,
      [req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/label — rename the workspace (admin only). Slug is immutable
// once created so existing login/SSO links never break.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    const { rows } = await pool.query(
      'UPDATE labels SET name = $1 WHERE id = $2 RETURNING id, name, slug, created_at',
      [name.trim(), req.labelId]
    );
    await logActivity(req, 'Renamed workspace', name.trim());
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

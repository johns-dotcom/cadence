const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/announcements/active — live announcements for this workspace that the
// caller hasn't dismissed and that are within their time window.
router.get('/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.body, a.level
         FROM announcements a
        WHERE a.active = true
          AND (a.starts_at IS NULL OR a.starts_at <= NOW())
          AND (a.ends_at IS NULL OR a.ends_at >= NOW())
          AND (a.target_label_ids IS NULL OR cardinality(a.target_label_ids) = 0 OR $1 = ANY(a.target_label_ids))
          AND NOT EXISTS (SELECT 1 FROM announcement_dismissals d WHERE d.announcement_id = a.id AND d.user_id = $2)
        ORDER BY CASE a.level WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.created_at DESC`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Active announcements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/announcements/:id/dismiss — dismiss for the current user.
router.post('/:id/dismiss', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid announcement id' });
    // SELECT the id rather than passing it straight in: an unknown id would
    // otherwise fail the FK and surface as a 500 on what is really a 404.
    const { rowCount } = await pool.query(
      `INSERT INTO announcement_dismissals (announcement_id, user_id)
       SELECT a.id, $2 FROM announcements a WHERE a.id = $1
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [id, req.user.id]
    );
    if (!rowCount) {
      const exists = await pool.query('SELECT 1 FROM announcements WHERE id = $1', [id]);
      if (!exists.rows.length) return res.status(404).json({ success: false, error: 'Announcement not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Dismiss announcement error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

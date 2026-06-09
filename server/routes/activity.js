const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/activity — audit trail for the current label (admins only).
router.get('/', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const { rows } = await pool.query(
      `SELECT al.id, al.action, al.detail, al.ip_address, al.method, al.endpoint, al.created_at,
              u.name AS user_name, u.email AS user_email
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
       WHERE al.label_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2`,
      [req.labelId, limit]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

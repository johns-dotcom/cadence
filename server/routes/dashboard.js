const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/dashboard — headline counts + recent activity, all label-scoped
router.get('/', async (req, res) => {
  try {
    const [artists, releases, upcoming, openDeals, myTasks, recent] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM artists WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT COUNT(*)::int AS n FROM releases WHERE label_id = $1', [req.labelId]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM releases
         WHERE label_id = $1 AND release_date >= CURRENT_DATE AND status != 'Archived'`,
        [req.labelId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM deals WHERE label_id = $1 AND stage NOT IN ('Signed', 'Passed')`,
        [req.labelId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM tasks WHERE label_id = $1 AND user_id = $2 AND status != 'Done'`,
        [req.labelId, req.user.id]
      ),
      pool.query(
        `SELECT al.id, al.action, al.detail, al.created_at, u.name AS user_name
         FROM activity_log al LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
         WHERE al.label_id = $1 ORDER BY al.created_at DESC LIMIT 10`,
        [req.labelId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          artists: artists.rows[0].n,
          releases: releases.rows[0].n,
          upcoming: upcoming.rows[0].n,
          openDeals: openDeals.rows[0].n,
          myTasks: myTasks.rows[0].n,
        },
        recentActivity: recent.rows,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

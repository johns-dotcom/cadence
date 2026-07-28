const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Collapse dynamic path segments so /releases/42 and /artists/7 group together.
// Numeric ids and long hex/uuid-ish tokens become :id.
function normalizePath(raw) {
  let p = String(raw || '/').split('?')[0].split('#')[0];
  if (p.length > 1) p = p.replace(/\/+$/, '');
  p = p.replace(/\/\d+(?=\/|$)/g, '/:id')
       .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id');
  return p.slice(0, 160) || '/';
}

// POST /api/analytics/ping — fire-and-forget route view. Dedupes against this
// user's most recent view so a re-render / back-forward doesn't double count.
router.post('/ping', async (req, res) => {
  // Respond immediately; never let analytics slow or fail a navigation.
  res.json({ success: true });
  try {
    const path = normalizePath(req.body?.path);
    const { rows } = await pool.query(
      'SELECT path FROM page_views WHERE label_id = $1 AND user_id = $2 ORDER BY id DESC LIMIT 1',
      [req.labelId, req.user.id]
    );
    if (rows.length && rows[0].path === path) return; // dedupe consecutive
    await pool.query(
      'INSERT INTO page_views (label_id, user_id, path) VALUES ($1, $2, $3)',
      [req.labelId, req.user.id, path]
    );
  } catch (e) { /* swallow — analytics must never break navigation */ }
});

const RANGES = { '7d': 7, '30d': 30, '90d': 90 };

// GET /api/analytics?range=30d — workspace usage dashboard. Admin/Approver only.
router.get('/', requireApprover, async (req, res) => {
  try {
    const days = RANGES[req.query.range] || 30;
    const since = `NOW() - INTERVAL '${days} days'`;
    const L = [req.labelId];

    const [views, actives, logins, actions, daily, pages, users] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM page_views WHERE label_id = $1 AND created_at >= ${since}`, L),
      pool.query(`SELECT COUNT(DISTINCT user_id)::int AS n FROM page_views WHERE label_id = $1 AND created_at >= ${since}`, L),
      pool.query(`SELECT COUNT(*)::int AS n FROM user_login_logs WHERE label_id = $1 AND logged_in_at >= ${since}`, L),
      pool.query(`SELECT COUNT(*)::int AS n FROM activity_log WHERE label_id = $1 AND created_at >= ${since}`, L),
      pool.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS day, COUNT(*)::int AS views, COUNT(DISTINCT user_id)::int AS users
           FROM page_views WHERE label_id = $1 AND created_at >= ${since}
          GROUP BY 1 ORDER BY 1`, L),
      pool.query(
        `SELECT path, COUNT(*)::int AS views FROM page_views
          WHERE label_id = $1 AND created_at >= ${since}
          GROUP BY 1 ORDER BY views DESC LIMIT 12`, L),
      pool.query(
        `SELECT u.id, u.name, u.email,
                COUNT(pv.id)::int AS views,
                MAX(pv.created_at) AS last_seen
           FROM page_views pv JOIN users u ON u.id = pv.user_id AND u.label_id = pv.label_id
          WHERE pv.label_id = $1 AND pv.created_at >= ${since}
          GROUP BY u.id, u.name, u.email ORDER BY views DESC LIMIT 10`, L),
    ]);

    // Zero-fill the daily series so the chart has a continuous x-axis.
    const map = Object.fromEntries(daily.rows.map(r => [r.day, r]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = map[key];
      series.push({ day: key.slice(5), views: row?.views || 0, users: row?.users || 0 });
    }

    res.json({ success: true, data: {
      range: `${days}d`,
      stats: { views: views.rows[0].n, actives: actives.rows[0].n, logins: logins.rows[0].n, actions: actions.rows[0].n },
      daily: series,
      pages: pages.rows,
      users: users.rows,
    } });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

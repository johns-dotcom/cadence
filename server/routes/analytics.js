/**
 * /api/analytics — in-workspace usage analytics.
 *
 * Data sources, all three label-scoped:
 *   page_views       — one row per client route change (POST /pageview below)
 *   user_login_logs  — written by the login endpoints
 *   activity_log     — mutations, written by activityLogger
 *
 * The ping is fire-and-forget from Layout.jsx and must never break navigation,
 * so it ALWAYS answers success — including when the table doesn't exist yet
 * (a container running ahead of its migration). Summary reads are admin-only
 * and degrade to an empty payload for the same reason.
 */
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// Postgres "undefined_table" — the one error that means "not migrated yet"
// rather than "something is wrong".
const MISSING_TABLE = '42P01';

// Two consecutive route changes to the same page within this window count once.
// Client-side consecutive-dedup already drops the common case; this is the
// backstop for a remount loop or two tabs on the same screen.
const DEDUP_SECONDS = 30;

/**
 * Normalize a client path for storage.
 * Returns null when the path is unusable — never throws.
 */
function normalizePath(raw) {
  // Query strings are dropped BEFORE anything else: they carry invite tokens,
  // signed-URL signatures and search terms, none of which belong in an
  // analytics table that admins read.
  let path = String(raw || '').split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/') || path.length > 200) return null;
  // Group dynamic segments so /releases/123 and /artists/9 roll up.
  path = path.replace(/\/\d+(?=\/|$)/g, '/:id');
  return path.length <= 200 ? path : null;
}

// POST /api/analytics/pageview — { path }. Any authenticated member.
router.post('/pageview', async (req, res) => {
  try {
    const path = normalizePath(req.body?.path);
    if (!path) return res.json({ success: true });
    // Dedup in the INSERT itself: one round trip, and no read-then-write race
    // between two tabs.
    // Every value is bound TWICE and cast. Reusing one placeholder across the
    // bare SELECT list and the `path = $n` comparison makes Postgres deduce two
    // types for it and raise 42P08 "inconsistent types deduced for parameter" —
    // the same trap that killed task status changes in Phase 8. Casting alone
    // doesn't fix it; separate binds do.
    await pool.query(
      `INSERT INTO page_views (label_id, user_id, path)
       SELECT $1::int, $2::int, $3::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM page_views
          WHERE label_id = $4::int AND user_id = $5::int AND path = $6::varchar
            AND ts > NOW() - make_interval(secs => $7::int)
       )`,
      [req.labelId, req.user.id, path, req.labelId, req.user.id, path, DEDUP_SECONDS]
    );
    res.json({ success: true });
  } catch {
    // Analytics must never fail the client.
    res.json({ success: true });
  }
});

// GET /api/analytics/summary?days=30 — Admin/Superadmin.
router.get('/summary', requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const L = req.labelId;
  try {
    const [topPages, topUsers, logins, daily, actions, totals] = await Promise.all([
      pool.query(
        `SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT user_id)::int AS users
           FROM page_views
          WHERE label_id = $1 AND ts > NOW() - make_interval(days => $2)
          GROUP BY path
          ORDER BY views DESC
          LIMIT 15`,
        [L, days]
      ),
      pool.query(
        `SELECT COALESCE(u.name, 'Removed user') AS name,
                COUNT(*)::int AS views,
                COUNT(DISTINCT date_trunc('day', pv.ts))::int AS active_days,
                MAX(pv.ts) AS last_seen
           FROM page_views pv
           LEFT JOIN users u ON u.id = pv.user_id AND u.label_id = pv.label_id
          WHERE pv.label_id = $1 AND pv.ts > NOW() - make_interval(days => $2)
          GROUP BY 1
          ORDER BY views DESC
          LIMIT 20`,
        [L, days]
      ),
      pool.query(
        `SELECT COALESCE(u.name, 'Removed user') AS name,
                COUNT(*)::int AS logins,
                MAX(l.logged_in_at) AS last_login
           FROM user_login_logs l
           LEFT JOIN users u ON u.id = l.user_id AND u.label_id = l.label_id
          WHERE l.label_id = $1 AND l.logged_in_at > NOW() - make_interval(days => $2)
          GROUP BY 1
          ORDER BY logins DESC
          LIMIT 20`,
        [L, days]
      ),
      pool.query(
        `SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS views,
                COUNT(DISTINCT user_id)::int AS users
           FROM page_views
          WHERE label_id = $1 AND ts > NOW() - make_interval(days => $2)
          GROUP BY 1
          ORDER BY 1`,
        [L, days]
      ),
      pool.query(
        `SELECT COALESCE(u.name, 'Removed user') AS name, COUNT(*)::int AS actions
           FROM activity_log a
           LEFT JOIN users u ON u.id = a.user_id AND u.label_id = a.label_id
          WHERE a.label_id = $1 AND a.created_at > NOW() - make_interval(days => $2)
          GROUP BY 1
          ORDER BY actions DESC
          LIMIT 20`,
        [L, days]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS views, COUNT(DISTINCT user_id)::int AS users
           FROM page_views
          WHERE label_id = $1 AND ts > NOW() - make_interval(days => $2)`,
        [L, days]
      ),
    ]);

    res.json({
      success: true,
      data: {
        days,
        retention_days: 180,
        totals: totals.rows[0] || { views: 0, users: 0 },
        topPages: topPages.rows,
        topUsers: topUsers.rows,
        logins: logins.rows,
        daily: daily.rows,
        actions: actions.rows,
      },
    });
  } catch (err) {
    if (err.code === MISSING_TABLE) {
      // Not migrated yet — an empty surface is the honest answer, not a 500.
      return res.json({
        success: true,
        data: { days, retention_days: 180, totals: { views: 0, users: 0 }, topPages: [], topUsers: [], logins: [], daily: [], actions: [] },
      });
    }
    console.error('GET /api/analytics/summary:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.normalizePath = normalizePath;

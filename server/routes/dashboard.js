const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { toUSD } = require('../lib/fx');

const router = express.Router();
router.use(authMiddleware, withTenant);

const isBkAdmin = (req) => ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

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

// GET /api/dashboard/widgets — richer home widgets: upcoming releases,
// release-by-month trend, genre mix, my-task counts, and (bk admins) the
// approvals + bookkeeping summary.
router.get('/widgets', async (req, res) => {
  try {
    const bk = isBkAdmin(req);
    const [upcoming, byMonth, genres, tasks, pending, mtd] = await Promise.all([
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.release_type, r.cover_art_url, a.name AS artist_name
           FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1 AND r.release_date >= CURRENT_DATE AND r.release_date <= CURRENT_DATE + INTERVAL '21 days'
            AND (r.archived = false OR r.archived IS NULL)
          ORDER BY r.release_date ASC LIMIT 8`,
        [req.labelId]
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', release_date), 'YYYY-MM') AS month, COUNT(*)::int AS count
           FROM releases WHERE label_id = $1 AND release_date >= (CURRENT_DATE - INTERVAL '11 months')
          GROUP BY 1 ORDER BY 1`,
        [req.labelId]
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(genre,''),'Unspecified') AS genre, COUNT(*)::int AS count
           FROM releases WHERE label_id = $1 GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        [req.labelId]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status != 'Done')::int AS open,
           COUNT(*) FILTER (WHERE status != 'Done' AND due_date < CURRENT_DATE)::int AS overdue,
           COUNT(*) FILTER (WHERE status != 'Done' AND due_date = CURRENT_DATE)::int AS due_today
         FROM tasks WHERE label_id = $1 AND user_id = $2`,
        [req.labelId, req.user.id]
      ),
      bk ? pool.query(`SELECT COUNT(*)::int AS n FROM expenses WHERE label_id = $1 AND status = 'pending' AND (deleted=false OR deleted IS NULL)`, [req.labelId]) : Promise.resolve({ rows: [{ n: 0 }] }),
      bk ? pool.query(
        `SELECT amount, currency, payment_status, COALESCE(payment_date, invoice_date, created_at::date) AS d
           FROM expenses WHERE label_id = $1 AND status = 'approved' AND (deleted=false OR deleted IS NULL)
             AND parent_id IS NULL AND (voided=false OR voided IS NULL)
             AND COALESCE(payment_date, invoice_date, created_at::date) >= date_trunc('month', CURRENT_DATE)`,
        [req.labelId]
      ) : Promise.resolve({ rows: [] }),
    ]);

    // last-12-month buckets, zero-filled
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
    const cnt = Object.fromEntries(byMonth.rows.map(r => [r.month, r.count]));
    const releasesByMonth = months.map(m => ({ month: m.slice(2), count: cnt[m] || 0 }));

    let loggedMtd = 0, paidMtd = 0;
    for (const r of mtd.rows) { const usd = await toUSD(r.amount, r.currency, r.d); loggedMtd += usd; if (r.payment_status === 'Paid') paidMtd += usd; }
    const round = (n) => Math.round((n || 0) * 100) / 100;

    res.json({ success: true, data: {
      upcomingReleases: upcoming.rows,
      releasesByMonth,
      genres: genres.rows,
      myTasks: tasks.rows[0],
      isBkAdmin: bk,
      pendingApprovals: pending.rows[0].n,
      bookkeeping: { loggedMtd: round(loggedMtd), paidMtd: round(paidMtd), awaitingApproval: pending.rows[0].n },
    } });
  } catch (error) {
    console.error('Dashboard widgets error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

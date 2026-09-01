const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { toUSD } = require('../lib/fx');

const router = express.Router();
router.use(authMiddleware, withTenant);

const isBkAdmin = (req) => ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

// The 14-item release-prep checklist (mirrors RELEASE_CHECKLIST client-side).
// Summed as ::int for the low-completion alerts.
const CHECKLIST_COLS = [
  'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
  'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
  'pitched_amazon', 'pitched_pandora', 'youtube_video', 'official_thread',
  'musixmatch', 'recoup_setup',
];

// GET /api/dashboard — headline counts + recent activity, all label-scoped
router.get('/', async (req, res) => {
  try {
    const [artists, releases, upcoming, openDeals, myTasks, teamMembers, recent] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM artists WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT COUNT(*)::int AS n FROM releases WHERE label_id = $1', [req.labelId]),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM releases
         WHERE label_id = $1 AND release_date > CURRENT_DATE`,
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
      pool.query('SELECT COUNT(*)::int AS n FROM users WHERE label_id = $1', [req.labelId]),
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
          teamMembers: teamMembers.rows[0].n,
        },
        recentActivity: recent.rows,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/dashboard/chart?year&genre&format — Releases-per-Month data for the
// filterable bar chart: selected-year series + same-filters prior-year series,
// zero-filled Jan–Dec, plus the filter option lists. All label-scoped.
router.get('/chart', async (req, res) => {
  try {
    const { year, genre, format } = req.query;
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();

    const [yearsResult, genresResult, formatsResult] = await Promise.all([
      pool.query(
        `SELECT DISTINCT EXTRACT(YEAR FROM release_date)::int AS year
           FROM releases WHERE label_id = $1 AND release_date IS NOT NULL
          ORDER BY year DESC`,
        [req.labelId]
      ),
      pool.query(
        `SELECT DISTINCT genre FROM releases
          WHERE label_id = $1 AND genre IS NOT NULL AND genre != '' ORDER BY genre`,
        [req.labelId]
      ),
      pool.query(
        `SELECT DISTINCT release_type FROM releases
          WHERE label_id = $1 AND release_type IS NOT NULL AND release_type != '' ORDER BY release_type`,
        [req.labelId]
      ),
    ]);

    // Shared filtered WHERE — $1 label, $2 year, then optional genre/format.
    const baseParams = [req.labelId];
    const conditions = ['label_id = $1', 'release_date IS NOT NULL', 'EXTRACT(YEAR FROM release_date) = $2'];
    const extraParams = [];
    if (genre) {
      extraParams.push(genre);
      conditions.push(`LOWER(TRIM(genre)) = LOWER(TRIM($${2 + extraParams.length}))`);
    }
    if (format) {
      extraParams.push(format);
      conditions.push(`LOWER(TRIM(release_type)) = LOWER(TRIM($${2 + extraParams.length}))`);
    }
    const chartWhere = conditions.join(' AND ');
    const monthSql = `
      SELECT TO_CHAR(release_date, 'Mon') AS month,
             EXTRACT(MONTH FROM release_date)::int AS month_num,
             COUNT(*)::int AS releases
        FROM releases WHERE ${chartWhere}
       GROUP BY month, month_num ORDER BY month_num`;

    const [thisYearResult, lastYearResult] = await Promise.all([
      pool.query(monthSql, [...baseParams, selectedYear, ...extraParams]),
      pool.query(monthSql, [...baseParams, selectedYear - 1, ...extraParams]),
    ]);

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const thisMap = Object.fromEntries(thisYearResult.rows.map(r => [r.month, r.releases]));
    const lastMap = Object.fromEntries(lastYearResult.rows.map(r => [r.month, r.releases]));
    const releasesByMonth = MONTHS.map(m => ({ month: m, releases: thisMap[m] || 0, lastYear: lastMap[m] || 0 }));

    res.json({
      success: true,
      data: {
        selectedYear,
        availableYears: yearsResult.rows.map(r => r.year),
        availableGenres: genresResult.rows.map(r => r.genre),
        availableFormats: formatsResult.rows.map(r => r.release_type),
        releasesByMonth,
      },
    });
  } catch (error) {
    console.error('Dashboard chart error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/dashboard/notifications — computed alert feed for the home
// Notifications panel. Severity: critical | warning | info. Label-scoped;
// contract/admin-doc alerts are additionally role-gated so that metadata never
// reaches a dashboard the viewer couldn't open the page for.
router.get('/notifications', async (req, res) => {
  try {
    const notifications = [];
    const role = req.user.role;

    // Releases dropping this calendar week
    const thisWeekCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM releases
        WHERE label_id = $1
          AND release_date >= date_trunc('week', CURRENT_DATE)
          AND release_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'`,
      [req.labelId]
    );
    const weekCount = thisWeekCount.rows[0].n;
    if (weekCount > 0) {
      notifications.push({
        type: 'This Week',
        severity: 'info',
        message: `${weekCount} release${weekCount > 1 ? 's' : ''} dropping this week`,
      });
    }

    // Releases in the next 14 days with low checklist completion
    const checklistSum = CHECKLIST_COLS.map(c => `r.${c}::int`).join(' + ');
    const lowCompletionResult = await pool.query(
      `SELECT r.id, r.project_name, r.release_date, COALESCE(a.name, 'Unknown artist') AS artist_name,
              (${checklistSum}) AS items_completed
         FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
        WHERE r.label_id = $1
          AND r.release_date > CURRENT_DATE
          AND r.release_date <= CURRENT_DATE + INTERVAL '14 days'
        ORDER BY r.release_date`,
      [req.labelId]
    );
    lowCompletionResult.rows.forEach((release) => {
      const completion = Math.round((parseInt(release.items_completed, 10) / CHECKLIST_COLS.length) * 100);
      if (completion < 50) {
        notifications.push({
          type: 'Low Completion',
          severity: completion < 25 ? 'critical' : 'warning',
          message: `${release.artist_name} — "${release.project_name}" is ${completion}% complete (${release.release_date ? new Date(release.release_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'})`,
          releaseId: release.id,
        });
      }
    });

    // Upcoming releases missing key metadata (UPC, ISRC, Spotify URI)
    const missingMetaResult = await pool.query(
      `SELECT r.id, r.project_name, COALESCE(a.name, 'Unknown artist') AS artist_name,
              r.release_date, r.upc, r.isrc, r.spotify_uri
         FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
        WHERE r.label_id = $1
          AND r.release_date > CURRENT_DATE
          AND r.release_date <= CURRENT_DATE + INTERVAL '30 days'
          AND (r.upc IS NULL OR r.isrc IS NULL OR r.spotify_uri IS NULL)
        ORDER BY r.release_date
        LIMIT 5`,
      [req.labelId]
    );
    missingMetaResult.rows.forEach((release) => {
      const missing = [];
      if (!release.upc) missing.push('UPC');
      if (!release.isrc) missing.push('ISRC');
      if (!release.spotify_uri) missing.push('Spotify URI');
      notifications.push({
        type: 'Missing Metadata',
        severity: 'warning',
        message: `${release.artist_name} — "${release.project_name}" missing ${missing.join(', ')}`,
        releaseId: release.id,
      });
    });

    // Expiring contracts (next 60 days) — Approver+ only; others skip the
    // query entirely so contract metadata never reaches their dashboard.
    const canSeeContracts = ['Superadmin', 'Admin', 'Approver'].includes(role);
    if (canSeeContracts) {
      const expiringResult = await pool.query(
        `SELECT c.id, COALESCE(a.name, 'Unknown artist') AS artist_name, c.type,
                (c.expiration_date - CURRENT_DATE) AS days_left
           FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.label_id = $1
            AND c.expiration_date IS NOT NULL
            AND c.expiration_date > CURRENT_DATE
            AND c.expiration_date <= CURRENT_DATE + INTERVAL '60 days'
          ORDER BY c.expiration_date`,
        [req.labelId]
      );
      expiringResult.rows.forEach((contract) => {
        const days = parseInt(contract.days_left, 10);
        notifications.push({
          type: 'Contract Expiring',
          severity: days <= 14 ? 'critical' : 'warning',
          message: `${contract.artist_name} ${contract.type} contract expires in ${days} day${days !== 1 ? 's' : ''}`,
          contractId: contract.id,
        });
      });
    }

    // Expiring admin docs — Admin/Superadmin only; restricted-confidentiality
    // docs are hidden from non-superadmins.
    const canSeeAdminDocs = role === 'Admin' || role === 'Superadmin';
    if (canSeeAdminDocs) {
      const adminDocExpiring = await pool.query(
        `SELECT id, title, category, (expiration_date - CURRENT_DATE) AS days_left
           FROM admin_docs
          WHERE label_id = $1
            AND expiration_date IS NOT NULL
            AND expiration_date > CURRENT_DATE
            AND expiration_date <= CURRENT_DATE + INTERVAL '60 days'
            AND (status IS NULL OR status NOT IN ('Archived', 'Expired'))
            ${role === 'Superadmin' ? '' : "AND confidentiality IS DISTINCT FROM 'Restricted'"}
          ORDER BY expiration_date ASC`,
        [req.labelId]
      );
      adminDocExpiring.rows.forEach((doc) => {
        const days = parseInt(doc.days_left, 10);
        notifications.push({
          type: 'Admin Doc Expiring',
          severity: days <= 14 ? 'critical' : 'warning',
          message: `${doc.title} (${doc.category || 'Uncategorized'}) expires in ${days} day${days !== 1 ? 's' : ''}`,
          adminDocId: doc.id,
        });
      });
    }

    // Overdue tasks — the viewer's own (task visibility is narrower than the
    // label: department is a permission boundary, so no workspace-wide count).
    const overdueResult = await pool.query(
      `SELECT COUNT(*)::int AS n FROM tasks
        WHERE label_id = $1 AND user_id = $2 AND status != 'Done' AND due_date < CURRENT_DATE`,
      [req.labelId, req.user.id]
    );
    const overdueCount = overdueResult.rows[0].n;
    if (overdueCount > 0) {
      notifications.push({
        type: 'Overdue Tasks',
        severity: 'critical',
        message: `${overdueCount} overdue task${overdueCount > 1 ? 's' : ''} need attention`,
      });
    }

    // Open internal requests (cadence's analog of boom's distributor requests)
    const pendingRequestsResult = await pool.query(
      `SELECT COUNT(*)::int AS n FROM internal_requests WHERE label_id = $1 AND status = 'open'`,
      [req.labelId]
    );
    const pendingCount = pendingRequestsResult.rows[0].n;
    if (pendingCount > 0) {
      notifications.push({
        type: 'Pending Requests',
        severity: 'info',
        message: `${pendingCount} internal request${pendingCount > 1 ? 's' : ''} pending`,
      });
    }

    res.json({ success: true, data: notifications });
  } catch (error) {
    console.error('Dashboard notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/dashboard/widgets — richer home widgets: this/next-week release
// buckets, genre mix, my-task counts, and (bk admins) the approvals +
// bookkeeping summary.
router.get('/widgets', async (req, res) => {
  try {
    const bk = isBkAdmin(req);
    const [thisWeek, nextWeek, genres, tasks, pending, mtd, recentInv] = await Promise.all([
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, a.name AS artist_name
           FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1
            AND r.release_date >= date_trunc('week', CURRENT_DATE)
            AND r.release_date < date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
          ORDER BY r.release_date`,
        [req.labelId]
      ),
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, a.name AS artist_name
           FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1
            AND r.release_date >= date_trunc('week', CURRENT_DATE) + INTERVAL '7 days'
            AND r.release_date < date_trunc('week', CURRENT_DATE) + INTERVAL '14 days'
          ORDER BY r.release_date`,
        [req.labelId]
      ),
      pool.query(
        `SELECT genre, COUNT(*)::int AS count
           FROM releases WHERE label_id = $1 AND genre IS NOT NULL AND genre != ''
          GROUP BY genre ORDER BY count DESC LIMIT 8`,
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
      bk ? pool.query(
        `SELECT payee, category, amount, currency, COALESCE(invoice_date, created_at::date) AS d
           FROM expenses WHERE label_id = $1 AND (deleted=false OR deleted IS NULL)
             AND parent_id IS NULL AND (voided=false OR voided IS NULL)
          ORDER BY created_at DESC LIMIT 3`,
        [req.labelId]
      ) : Promise.resolve({ rows: [] }),
    ]);

    const round = (n) => Math.round((n || 0) * 100) / 100;
    let loggedMtd = 0, paidMtd = 0;
    for (const r of mtd.rows) { const usd = await toUSD(r.amount, r.currency, r.d); loggedMtd += usd; if (r.payment_status === 'Paid') paidMtd += usd; }
    const recent = [];
    for (const r of recentInv.rows) {
      recent.push({ payee: r.payee, category: r.category, date: r.d, amount: round(await toUSD(r.amount, r.currency, r.d)) });
    }

    res.json({ success: true, data: {
      thisWeek: thisWeek.rows,
      nextWeek: nextWeek.rows,
      genres: genres.rows,
      myTasks: tasks.rows[0],
      isBkAdmin: bk,
      pendingApprovals: pending.rows[0].n,
      bookkeeping: {
        loggedMtd: round(loggedMtd),
        paidMtd: round(paidMtd),
        awaitingApproval: pending.rows[0].n,
        invoiceCount: mtd.rows.length,
        recent,
      },
    } });
  } catch (error) {
    console.error('Dashboard widgets error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { requirePlatformAdmin, requirePlatformOwner } = require('../middleware/tenant');
const { uniqueSlug } = require('../lib/slug');
const { signToken, publicUser } = require('../lib/token');
const { getSignedFileUrl, uploadFile, deleteFile, isConfigured } = require('../lib/r2');
const { sendEmail, inviteEmail } = require('../lib/email');
const { deleteUserWithSweep } = require('../lib/userDelete');
const aiUsage = require('../lib/aiUsage');
const activityBot = require('../lib/activityBot');
const { operatorAccess, accessibleLabelIds, scopeClause, operatorRoles, OPERATOR_ROLES, DEFAULT_OPERATOR_ROLE } = require('../lib/operatorAccess');
const { likeContains, LIKE_ESCAPE } = require('../lib/likePattern');
const { ensureGhost } = require('../lib/operatorGhost');
const { toUSD, warmRates } = require('../lib/fx');
const { dayString, isValidDay } = require('../lib/calendarDay');
const { foldMoney, buildAttention, round2 } = require('../lib/platformRollup');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const INVITE_DAYS = 7;
function inviteLink(req, token) {
  // Never fall back to the raw Host header (attacker-controllable → poisoned
  // invite links). Use the configured FRONTEND_URL, else the browser Origin.
  const origin = process.env.FRONTEND_URL || req.headers.origin || '';
  return `${origin.replace(/\/$/, '')}/accept-invite?token=${token}`;
}

// Resolve a label's primary owner. An explicit owner_user_id pointer (which may
// reference a console operator) wins; otherwise fall back to the most-senior
// non-operator Superadmin member.
async function ownerOf(labelId) {
  const ptr = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_platform_admin
       FROM labels l JOIN users u ON u.id = l.owner_user_id
      WHERE l.id = $1`,
    [labelId]
  );
  if (ptr.rows.length) return ptr.rows[0];
  const { rows } = await pool.query(
    `SELECT id, name, email, role FROM users
     WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
     ORDER BY (role = 'Superadmin') DESC, hierarchy_level ASC, id ASC LIMIT 1`,
    [labelId]
  );
  return rows[0] || null;
}

// Platform routes operate ACROSS tenants and are the only place that's allowed
// to. Every route requires an authenticated platform admin — the SaaS
// operator, a level above any label's Superadmin.
router.use(authMiddleware, requirePlatformAdmin);

// GET /api/platform/workspaces — every label with operational + activity stats.
// One round-trip via correlated subqueries; references only base tables that
// always exist, so it's robust regardless of migration state.
router.get('/workspaces', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.name, l.slug, l.accent_color, l.console_color, l.logo_r2_key, l.logo_data,
              COALESCE(l.status, 'active') AS status, l.suspended_at, l.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.label_id = l.id AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL))::int AS members,
              (SELECT COUNT(*) FROM artists WHERE label_id = l.id)::int AS artists,
              (SELECT COUNT(*) FROM releases WHERE label_id = l.id)::int AS releases,
              (SELECT COUNT(*) FROM deals WHERE label_id = l.id)::int AS deals,
              (SELECT COUNT(*) FROM contracts WHERE label_id = l.id)::int AS contracts,
              (SELECT COUNT(*) FROM expenses WHERE label_id = l.id AND (deleted = false OR deleted IS NULL))::int AS ledger_entries,
              (SELECT COUNT(*) FROM invoices WHERE label_id = l.id)::int AS invoices,
              (SELECT MAX(created_at) FROM activity_log WHERE label_id = l.id) AS last_active,
              COALESCE(
                (SELECT json_build_object('name', name, 'email', email) FROM users WHERE id = l.owner_user_id),
                (SELECT json_build_object('name', name, 'email', email)
                   FROM users WHERE label_id = l.id AND (is_platform_admin = false OR is_platform_admin IS NULL)
                   ORDER BY (role = 'Superadmin') DESC, hierarchy_level ASC, id ASC LIMIT 1)
              ) AS owner
       FROM labels l
       WHERE (l.is_system = false OR l.is_system IS NULL)
       ORDER BY l.created_at DESC`
    );
    // Sign logo URLs (best-effort) for branding previews.
    for (const r of rows) {
      r.logo_url = r.logo_r2_key ? await getSignedFileUrl(r.logo_r2_key, 6 * 3600).catch(() => null) : (r.logo_data || null);
      delete r.logo_r2_key;
      delete r.logo_data;
    }
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/workspaces/:id — full detail for the drawer: every domain
// count, the member roster (by role), recent activity, branding + owner.
router.get('/workspaces/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const labelRes = await pool.query(
      `SELECT id, name, slug, accent_color, console_color, logo_r2_key, logo_data, COALESCE(status,'active') AS status, suspended_at, created_at, owner_user_id
         FROM labels WHERE id = $1`,
      [id]
    );
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : (label.logo_data || null);
    delete label.logo_r2_key;
    delete label.logo_data;

    const [counts, members, byRole, recent, lastLogin] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM artists WHERE label_id=$1)::int AS artists,
           (SELECT COUNT(*) FROM releases WHERE label_id=$1)::int AS releases,
           (SELECT COUNT(*) FROM deals WHERE label_id=$1)::int AS deals,
           (SELECT COUNT(*) FROM contracts WHERE label_id=$1)::int AS contracts,
           (SELECT COUNT(*) FROM expenses WHERE label_id=$1 AND (deleted=false OR deleted IS NULL) AND parent_id IS NULL)::int AS ledger_entries,
           (SELECT COUNT(*) FROM expenses WHERE label_id=$1 AND status='pending' AND (deleted=false OR deleted IS NULL))::int AS pending_approvals,
           (SELECT COUNT(*) FROM invoices WHERE label_id=$1)::int AS invoices,
           (SELECT COUNT(*) FROM tasks WHERE label_id=$1 AND status != 'Done')::int AS open_tasks`,
        [id]
      ),
      pool.query(
        `SELECT id, name, email, role, department, hierarchy_level, created_at FROM users
         WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
         ORDER BY (role='Superadmin') DESC, hierarchy_level ASC, name`,
        [id]
      ),
      pool.query(
        `SELECT role, COUNT(*)::int AS n FROM users
         WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL) GROUP BY role`,
        [id]
      ),
      pool.query(
        `SELECT al.action, al.detail, al.created_at, u.name AS user_name
         FROM activity_log al LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
         WHERE al.label_id = $1 ORDER BY al.created_at DESC LIMIT 12`,
        [id]
      ),
      pool.query('SELECT MAX(logged_in_at) AS t FROM user_login_logs WHERE label_id = $1', [id]),
    ]);

    res.json({
      success: true,
      data: {
        label,
        owner: await ownerOf(id),
        counts: counts.rows[0],
        members: members.rows,
        membersByRole: Object.fromEntries(byRole.rows.map(r => [r.role, r.n])),
        recentActivity: recent.rows,
        lastLogin: lastLogin.rows[0]?.t || null,
        ai: await (async () => {
          const lim = await aiUsage.limitFor(id);
          const u = await aiUsage.usageFor(id);
          return { limit: lim.limit, type: lim.type, usedCalls: u.calls, usedTokens: u.in_tokens + u.out_tokens, used: lim.type === 'tokens' ? u.in_tokens + u.out_tokens : u.calls, month: aiUsage.ym(), default: aiUsage.DEFAULT_LIMIT };
        })(),
      },
    });
  } catch (error) {
    console.error('Workspace detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Cross-workspace roll-up ────────────────────────────────────────────────
//
// Shared SQL predicates. `LIVE_EXPENSE` is the family-root, not-deleted,
// not-voided population every money surface in the app agrees on; `PLAIN_USD`
// is the half that needs no FX round-trip (see lib/platformRollup foldMoney).
const LIVE_EXPENSE = "(e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL) AND e.parent_id IS NULL";
const PLAIN_USD = "(COALESCE(e.currency,'USD') = 'USD' AND (e.fx_rate_to_usd IS NULL OR e.fx_rate_to_usd = 1))";
const MTD_DATE = "COALESCE(e.payment_date, e.invoice_date, e.created_at::date)";

// GET /api/platform/overview — the operator's dashboard: the same vocabulary as
// a workspace dashboard, but every figure computed across every workspace the
// caller can see.
//
// Two properties worth preserving:
//  1. Every platform total is a REDUCTION over the per-workspace rows returned
//     alongside it, never an independent COUNT. A headline computed separately
//     from the list beneath it drifts, and this repo has fixed that class of
//     bug on four surfaces already.
//  2. One GROUP BY per domain, not the per-label correlated subqueries the
//     /workspaces list uses — that shape is O(workspaces x domains) and this
//     page is the one that has to stay fast as tenants are added.
router.get('/overview', async (req, res) => {
  try {
    const ids = await accessibleLabelIds(req);
    // Each query owns its params array; scopeClause appends the allowlist when
    // the operator is restricted and is a no-op when they are not.
    const q = (sql, col, extra = []) => {
      const params = [...extra];
      return pool.query(sql.replace('/*SCOPE*/', scopeClause(ids, col, params)), params);
    };

    const [labels, members, artists, releases, deals, tasks, lastActive,
           mtdAgg, mtdRows, pendAgg, pendRows, recent, upcoming] = await Promise.all([
      q(`SELECT l.id, l.name, l.slug, l.accent_color, l.console_color,
                COALESCE(l.status,'active') AS status, l.created_at
           FROM labels l WHERE (l.is_system = false OR l.is_system IS NULL) /*SCOPE*/
          ORDER BY l.name`, 'l.id'),
      q(`SELECT label_id, COUNT(*)::int AS n FROM users
          WHERE (is_platform_admin = false OR is_platform_admin IS NULL) AND label_id IS NOT NULL /*SCOPE*/
          GROUP BY 1`, 'label_id'),
      q(`SELECT label_id, COUNT(*)::int AS n FROM artists WHERE 1=1 /*SCOPE*/ GROUP BY 1`, 'label_id'),
      q(`SELECT label_id, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE release_date > CURRENT_DATE AND status IS DISTINCT FROM 'Archived')::int AS upcoming
           FROM releases WHERE 1=1 /*SCOPE*/ GROUP BY 1`, 'label_id'),
      q(`SELECT label_id, COUNT(*)::int AS n FROM deals
          WHERE stage NOT IN ('Signed','Passed') /*SCOPE*/ GROUP BY 1`, 'label_id'),
      q(`SELECT label_id, COUNT(*)::int AS open,
                COUNT(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS overdue
           FROM tasks WHERE status != 'Done' /*SCOPE*/ GROUP BY 1`, 'label_id'),
      q(`SELECT label_id, MAX(created_at) AS t FROM activity_log WHERE 1=1 /*SCOPE*/ GROUP BY 1`, 'label_id'),

      // Money, month to date. SQL sums the plain-USD half (rounded AT THE ROW,
      // matching the tenant dashboard's own rule) so only rows that genuinely
      // need a rate are pulled into JS.
      q(`SELECT e.label_id, COUNT(*)::int AS invoices,
                COALESCE(SUM(ROUND(e.amount,2)) FILTER (WHERE ${PLAIN_USD}),0) AS plain_logged,
                COALESCE(SUM(ROUND(e.amount,2)) FILTER (WHERE ${PLAIN_USD} AND e.payment_status = 'Paid'),0) AS plain_paid
           FROM expenses e
          WHERE e.status = 'approved' AND ${LIVE_EXPENSE}
            AND ${MTD_DATE} >= date_trunc('month', CURRENT_DATE) /*SCOPE*/
          GROUP BY 1`, 'e.label_id'),
      q(`SELECT e.label_id, e.amount, e.currency, e.fx_rate_to_usd, e.payment_status, ${MTD_DATE} AS d
           FROM expenses e
          WHERE e.status = 'approved' AND ${LIVE_EXPENSE}
            AND ${MTD_DATE} >= date_trunc('month', CURRENT_DATE)
            AND NOT ${PLAIN_USD} /*SCOPE*/`, 'e.label_id'),

      // The approval queue is NOT month-scoped: an invoice raised in June and
      // still unapproved in September is exactly what this figure is for.
      q(`SELECT e.label_id, COUNT(*)::int AS invoices,
                COALESCE(SUM(ROUND(e.amount,2)) FILTER (WHERE ${PLAIN_USD}),0) AS plain_logged,
                0 AS plain_paid
           FROM expenses e WHERE e.status = 'pending' AND ${LIVE_EXPENSE} /*SCOPE*/
          GROUP BY 1`, 'e.label_id'),
      q(`SELECT e.label_id, e.amount, e.currency, e.fx_rate_to_usd, NULL::varchar AS payment_status,
                COALESCE(e.invoice_date, e.created_at::date) AS d
           FROM expenses e
          WHERE e.status = 'pending' AND ${LIVE_EXPENSE} AND NOT ${PLAIN_USD} /*SCOPE*/`, 'e.label_id'),

      q(`SELECT al.action, al.detail, al.created_at, l.name AS workspace, l.id AS label_id, u.name AS user_name
           FROM activity_log al
           JOIN labels l ON l.id = al.label_id AND (l.is_system = false OR l.is_system IS NULL)
           LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
          WHERE 1=1 /*SCOPE*/
          ORDER BY al.created_at DESC LIMIT 20`, 'al.label_id'),
      q(`SELECT r.id, r.label_id, r.project_name, r.release_date, r.release_type, a.name AS artist_name
           FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.release_date >= CURRENT_DATE
            AND r.release_date < CURRENT_DATE + INTERVAL '45 days'
            AND r.status IS DISTINCT FROM 'Archived' /*SCOPE*/
          ORDER BY r.release_date LIMIT 20`, 'r.label_id'),
    ]);

    // Resolve every FX rate this response needs in ONE parallel burst. Left
    // per-row the awaits serialise into one HTTP round-trip per distinct date,
    // inside the request (measured at ~270ms/row on /dashboard/widgets).
    const fxRows = [...mtdRows.rows, ...pendRows.rows];
    await warmRates(fxRows.filter(r => !(Number(r.fx_rate_to_usd) > 0)).map(r => r.d));
    const rowUsd = async (r) => {
      const amt = Number(r.amount) || 0;
      const locked = Number(r.fx_rate_to_usd) || 0;
      // A stamped rate is the historically-correct one and ALWAYS wins. Never
      // a silent 1:1 fallback — that is the bug lib/usd.js exists to prevent.
      if (locked > 0) return round2(amt / locked);
      return round2(await toUSD(amt, r.currency, r.d));
    };
    for (const r of fxRows) r.usd = await rowUsd(r);

    const mtdMoney = foldMoney(mtdAgg.rows, mtdRows.rows);
    const pendMoney = foldMoney(pendAgg.rows, pendRows.rows);

    const by = (rows, key = 'n') => {
      const m = new Map();
      for (const r of rows) m.set(Number(r.label_id), r[key]);
      return m;
    };
    const mMembers = by(members.rows), mArtists = by(artists.rows), mDeals = by(deals.rows);
    const mRel = new Map(releases.rows.map(r => [Number(r.label_id), r]));
    const mTasks = new Map(tasks.rows.map(r => [Number(r.label_id), r]));
    const mActive = by(lastActive.rows, 't');

    const workspaces = labels.rows.map(l => {
      const rel = mRel.get(l.id) || {}, tk = mTasks.get(l.id) || {};
      const money = mtdMoney.get(l.id) || { invoices: 0, logged: 0, paid: 0 };
      const pend = pendMoney.get(l.id) || { invoices: 0, logged: 0 };
      return {
        id: l.id, name: l.name, slug: l.slug,
        accent_color: l.accent_color, console_color: l.console_color,
        status: l.status, created_at: l.created_at,
        members: mMembers.get(l.id) || 0,
        artists: mArtists.get(l.id) || 0,
        releases: rel.total || 0,
        upcoming: rel.upcoming || 0,
        open_deals: mDeals.get(l.id) || 0,
        open_tasks: tk.open || 0,
        overdue_tasks: tk.overdue || 0,
        pending: pend.invoices || 0,
        pending_usd: round2(pend.logged),
        invoices_mtd: money.invoices,
        logged_mtd: money.logged,
        paid_mtd: money.paid,
        last_active: mActive.get(l.id) || null,
      };
    });

    // Every headline is a reduction over the rows above — the grid and the band
    // cannot disagree.
    const sum = (k) => workspaces.reduce((a, w) => a + (Number(w[k]) || 0), 0);
    const monthAgo = Date.now() - 30 * 86400000;
    const totals = {
      workspaces: workspaces.length,
      active: workspaces.filter(w => w.status !== 'suspended').length,
      suspended: workspaces.filter(w => w.status === 'suspended').length,
      new_30d: workspaces.filter(w => w.created_at && new Date(w.created_at).getTime() > monthAgo).length,
      members: sum('members'), artists: sum('artists'), releases: sum('releases'),
      upcoming: sum('upcoming'), open_deals: sum('open_deals'),
      open_tasks: sum('open_tasks'), overdue_tasks: sum('overdue_tasks'),
      pending: sum('pending'),
      pending_usd: round2(sum('pending_usd')),
      invoices_mtd: sum('invoices_mtd'),
      logged_mtd: round2(sum('logged_mtd')),
      paid_mtd: round2(sum('paid_mtd')),
    };

    res.json({
      success: true,
      data: {
        scoped: !!ids,                       // the console says so when the view is narrowed
        totals,
        workspaces,
        attention: buildAttention(workspaces),
        recentActivity: recent.rows,
        upcomingReleases: upcoming.rows.map(r => ({ ...r, release_date: dayString(r.release_date) })),
      },
    });
  } catch (error) {
    console.error('Platform overview error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Cross-workspace calendar ───────────────────────────────────────────────
//
// The tenant calendar answers "what is happening here this month". This one
// answers "what is happening ANYWHERE this month", which is the only view that
// catches two labels dropping singles on the same Friday.
//
// Each source runs behind its own guard: one missing column or one slow table
// should cost the month that bucket, not 500 a page whose other three feeds
// were fine. The client is told which bucket degraded rather than being shown
// a quietly thinner month.
async function feedQuery(label, sql, params) {
  try { return await pool.query(sql, params); }
  catch (err) { console.error(`Platform calendar source "${label}" failed:`, err.message); return { rows: [], failed: true }; }
}

// GET /api/platform/calendar?from=&to= — every workspace's releases, manual
// events, contract dates and DSP milestones in one feed, each row carrying the
// workspace that owns it so the client can colour by tenant.
router.get('/calendar', async (req, res) => {
  try {
    const ids = await accessibleLabelIds(req);

    // Window server-side. The tenant calendar fetches everything and filters in
    // the browser, which is fine for one label; across every tenant the DSP
    // feed alone is one row per release per platform, so an unbounded pull is
    // the thing that would make this page unusable at scale.
    const today = dayString(new Date());
    let { from, to } = req.query;
    if (from !== undefined && !isValidDay(from)) return res.status(400).json({ success: false, error: 'Invalid "from" date' });
    if (to !== undefined && !isValidDay(to)) return res.status(400).json({ success: false, error: 'Invalid "to" date' });
    if (!from || !to) {
      const now = new Date();
      from = dayString(new Date(now.getFullYear(), now.getMonth(), 1));
      to = dayString(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    }
    if (from > to) return res.status(400).json({ success: false, error: '"from" must not be after "to"' });
    // A 400-day ceiling. Without it a hand-built ?from=1900 pulls every row in
    // every tenant, and the request that does it looks perfectly innocent.
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
    if (span > 400) return res.status(400).json({ success: false, error: 'Range too wide (max 400 days)' });

    const q = (name, sql, col) => {
      const params = [from, to];
      return feedQuery(name, sql.replace('/*SCOPE*/', scopeClause(ids, col, params)), params);
    };

    const [labels, releases, events, signed, expiring, dsp] = await Promise.all([
      (() => { const params = []; return pool.query(
        `SELECT l.id, l.name, l.accent_color, l.console_color, COALESCE(l.status,'active') AS status
           FROM labels l WHERE (l.is_system = false OR l.is_system IS NULL)
           ${scopeClause(ids, 'l.id', params)} ORDER BY l.name`, params); })(),

      q('releases',
        `SELECT r.id, r.label_id, r.project_name, r.release_date, r.release_type, a.name AS artist_name
           FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.release_date BETWEEN $1::date AND $2::date
            AND r.status IS DISTINCT FROM 'Archived' /*SCOPE*/`, 'r.label_id'),

      q('events',
        `SELECT id, label_id, title, event_date, description, color, event_type
           FROM calendar_events
          WHERE event_date BETWEEN $1::date AND $2::date /*SCOPE*/`, 'label_id'),

      q('contracts_signed',
        `SELECT c.id, c.label_id, c.type, c.date_signed, a.name AS artist_name
           FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.date_signed BETWEEN $1::date AND $2::date /*SCOPE*/`, 'c.label_id'),

      q('contracts_expiring',
        `SELECT c.id, c.label_id, c.type, c.expiration_date, a.name AS artist_name
           FROM contracts c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.expiration_date BETWEEN $1::date AND $2::date
            AND c.status = 'Active' /*SCOPE*/`, 'c.label_id'),

      q('dsp',
        `SELECT d.id, d.label_id, d.platform, d.live_date, d.submitted_date, d.status,
                r.project_name, r.id AS release_id
           FROM dsp_submissions d JOIN releases r ON r.id = d.release_id AND r.label_id = d.label_id
          WHERE (d.live_date BETWEEN $1::date AND $2::date
              OR d.submitted_date BETWEEN $1::date AND $2::date) /*SCOPE*/`, 'd.label_id'),
    ]);

    const evs = [];
    const push = (e) => { if (e.date) evs.push(e); };

    for (const r of releases.rows) push({
      kind: 'release', id: `release-${r.id}`, label_id: r.label_id,
      title: r.project_name, subtitle: r.artist_name || null, meta: r.release_type || null,
      date: dayString(r.release_date), link: `/releases/${r.id}`,
    });
    for (const e of events.rows) push({
      kind: 'event', id: `event-${e.id}`, label_id: e.label_id,
      title: e.title,
      subtitle: e.event_type && e.event_type !== 'manual' ? e.event_type : null,
      description: e.description, event_type: e.event_type || 'manual',
      date: dayString(e.event_date), link: '/calendar',
    });
    for (const c of signed.rows) push({
      kind: 'contract_signed', id: `csign-${c.id}`, label_id: c.label_id,
      title: `${c.artist_name || 'Contract'} — signed`, subtitle: c.type || null,
      date: dayString(c.date_signed), link: '/contracts',
    });
    for (const c of expiring.rows) push({
      kind: 'contract_expiry', id: `cexp-${c.id}`, label_id: c.label_id,
      title: `${c.artist_name || 'Contract'} — expires`, subtitle: c.type || null,
      date: dayString(c.expiration_date), link: '/renewals',
    });
    for (const s of dsp.rows) {
      // One row can carry BOTH milestones; the window matched if either landed
      // in it, so each is re-tested rather than assumed.
      const live = dayString(s.live_date), sub = dayString(s.submitted_date);
      if (live && live >= from && live <= to) push({
        kind: 'dsp_live', id: `dsplive-${s.id}`, label_id: s.label_id,
        title: `${s.project_name} — live on ${s.platform}`, subtitle: s.platform,
        meta: s.status || null, date: live, link: `/releases/${s.release_id}`,
      });
      if (sub && sub >= from && sub <= to) push({
        kind: 'dsp_submitted', id: `dspsub-${s.id}`, label_id: s.label_id,
        title: `${s.project_name} — submitted to ${s.platform}`, subtitle: s.platform,
        meta: s.status || null, date: sub, link: `/releases/${s.release_id}`,
      });
    }

    const degraded = [
      releases.failed && 'releases', events.failed && 'events',
      (signed.failed || expiring.failed) && 'contracts', dsp.failed && 'DSP',
    ].filter(Boolean);

    res.json({
      success: true,
      data: evs,
      // The colour key rides along so the client needs no second fetch, and so
      // a workspace with nothing on this month still gets a legend entry.
      workspaces: labels.rows,
      range: { from, to },
      scoped: !!ids,
      degraded: [...new Set(degraded)],
      today,
    });
  } catch (error) {
    console.error('Platform calendar error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/activity — global cross-tenant audit feed. Optional
// ?label_id, ?q (search action/detail), ?limit (default 100, max 300).
router.get('/activity', async (req, res) => {
  try {
    const params = [];
    let where = '1=1';
    // A restricted operator's feed is narrowed to the workspaces they can
    // actually enter — an audit line naming a workspace you are blocked from is
    // a leak, not context.
    where += scopeClause(await accessibleLabelIds(req), 'al.label_id', params);
    if (req.query.label_id) {
      const id = parseInt(req.query.label_id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid workspace' });
      params.push(id); where += ` AND al.label_id = $${params.length}`;
    }
    if (req.query.q) { params.push(`%${req.query.q}%`); where += ` AND (al.action ILIKE $${params.length} OR al.detail ILIKE $${params.length})`; }
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT al.action, al.detail, al.created_at, al.ip_address, l.name AS workspace, l.id AS label_id, u.name AS user_name
       FROM activity_log al
       JOIN labels l ON l.id = al.label_id
       LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
       WHERE ${where}
       ORDER BY al.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Platform activity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Tenant support inbox ─────────────────────────────────────────────────────
// internal_requests is written by tenants ("report a bug / request a feature")
// and, until now, read by nothing on the operator side — every request went
// into a void. These give the console the receiving end. Every query is scoped
// to the workspaces this operator may enter (accessibleLabelIds), the same rule
// activity + overview use: a request from a workspace you're blocked from is not
// yours to read.
const REQUEST_KINDS = ['feature', 'bug', 'question'];

// GET /platform/requests?status=&kind=&label_id=&q= — the inbox list.
router.get('/requests', async (req, res) => {
  try {
    const params = [];
    let where = "ir.subject IS NOT NULL";
    where += scopeClause(await accessibleLabelIds(req), 'ir.label_id', params);
    const status = req.query.status;
    if (status === 'open' || status === 'resolved') { params.push(status); where += ` AND ir.status = $${params.length}`; }
    if (REQUEST_KINDS.includes(req.query.kind)) { params.push(req.query.kind); where += ` AND ir.kind = $${params.length}`; }
    if (req.query.label_id) {
      const id = parseInt(req.query.label_id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid workspace' });
      params.push(id); where += ` AND ir.label_id = $${params.length}`;
    }
    if (req.query.q) { params.push(likeContains(req.query.q)); where += ` AND (ir.subject ILIKE $${params.length} ${LIKE_ESCAPE} OR ir.body ILIKE $${params.length} ${LIKE_ESCAPE})`; }
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT ir.id, ir.kind, ir.subject, ir.body, ir.page_context, ir.status, ir.created_at,
              ir.resolved_at, ir.label_id, l.name AS workspace,
              u.name AS submitter_name, u.email AS submitter_email,
              r.name AS resolved_by_name
         FROM internal_requests ir
         JOIN labels l ON l.id = ir.label_id
         LEFT JOIN users u ON u.id = ir.user_id
         LEFT JOIN users r ON r.id = ir.resolved_by
        WHERE ${where}
        ORDER BY (ir.status = 'open') DESC, ir.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Platform requests error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /platform/requests/count — open count for the nav badge (scoped).
router.get('/requests/count', async (req, res) => {
  try {
    const params = [];
    let where = "ir.status = 'open'";
    where += scopeClause(await accessibleLabelIds(req), 'ir.label_id', params);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS open FROM internal_requests ir WHERE ${where}`, params);
    res.json({ success: true, data: { open: rows[0].open } });
  } catch { res.json({ success: true, data: { open: 0 } }); }
});

// POST /platform/requests/:id(\d+)/status — { status: 'open' | 'resolved' }.
// Scoped: an operator can only act on requests in a workspace they may enter.
// Records who resolved it and when (cleared on reopen).
router.post('/requests/:id(\\d+)/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = req.body.status === 'resolved' ? 'resolved' : req.body.status === 'open' ? 'open' : null;
    if (!status) return res.status(400).json({ success: false, error: 'status must be open or resolved' });
    const params = [id];
    let scope = scopeClause(await accessibleLabelIds(req), 'label_id', params);
    // Confirm the request is in an accessible workspace before touching it.
    const found = await pool.query(`SELECT id FROM internal_requests WHERE id = $1${scope}`, params);
    if (!found.rows.length) return res.status(404).json({ success: false, error: 'Request not found' });
    const resolved = status === 'resolved';
    await pool.query(
      `UPDATE internal_requests
          SET status = $2, resolved_at = ${resolved ? 'NOW()' : 'NULL'}, resolved_by = ${resolved ? '$3' : 'NULL'}
        WHERE id = $1`,
      resolved ? [id, status, req.user.id] : [id, status]
    );
    res.json({ success: true, data: { id, status } });
  } catch (error) {
    console.error('Request status error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Operator permissions ────────────────────────────────────────────────────
// Console pages an admin operator can be restricted from. Overview ('/') and
// Account are always allowed so an operator is never fully locked out;
// Operators is owner-only anyway.
// Adding a page here is not free: the model is an ALLOWLIST, so any operator
// who already has one silently loses a page the moment it becomes restrictable.
// That is the right default for a NEW cross-tenant surface (/calendar, which
// nobody has been granted yet) and the wrong one for a page that is visible to
// everybody today — which is why /analytics is deliberately not in this list.
const RESTRICTABLE_PAGES = ['/workspaces', '/calendar', '/activity', '/announcements'];

// operatorAccess / accessibleLabelIds / scopeClause now live in
// lib/operatorAccess.js — the cross-tenant message boards need the identical
// answer, and a second copy of a visibility rule is how one console page ends
// up showing a workspace another page has blocked.

// Middleware: an admin-tier operator may only act on a workspace that's in
// their allowlist (owners are unrestricted). Mirrors the /enter check — applied
// to the member/owner mutation routes so a restricted admin can't manage a
// workspace they've been denied. Expects the workspace id at req.params.id.
async function requireWorkspaceAccess(req, res, next) {
  try {
    if (req.user.platform_role === 'owner') return next();
    const labelId = parseInt(req.params.id, 10);
    const access = await operatorAccess(req.user.email);
    if (access.workspaces && !access.workspaces.includes(labelId)) {
      return res.status(403).json({ success: false, error: 'You do not have access to this workspace' });
    }
    next();
  } catch { return res.status(403).json({ success: false, error: 'Access check failed' }); }
}

// GET /api/platform/my-access — the caller operator's own restrictions. Owners
// are unrestricted. Used by the console shell to filter nav + guard routes.
router.get('/my-access', async (req, res) => {
  try {
    // `restrictablePages` rides along so the client does not need its own copy
    // of the list: a page that is NOT restrictable is always visible, and a
    // client that hardcoded the four would silently hide new console pages.
    if (req.user.platform_role === 'owner') {
      return res.json({ success: true, data: { workspaces: null, pages: null, restrictablePages: RESTRICTABLE_PAGES } });
    }
    res.json({ success: true, data: { ...(await operatorAccess(req.user.email)), restrictablePages: RESTRICTABLE_PAGES } });
  } catch (error) {
    console.error('My-access error:', error);
    res.json({ success: true, data: { workspaces: null, pages: null } }); // fail open
  }
});

// GET /api/platform/operators/:email/access — owner view of one operator's access.
router.get('/operators/:email/access', requirePlatformOwner, async (req, res) => {
  try {
    const [access, roles] = await Promise.all([
      operatorAccess(req.params.email),
      operatorRoles(req.params.email),
    ]);
    res.json({
      success: true,
      data: {
        ...access, restrictablePages: RESTRICTABLE_PAGES,
        roles, assignableRoles: OPERATOR_ROLES, defaultRole: DEFAULT_OPERATOR_ROLE,
      },
    });
  } catch (error) {
    console.error('Operator access error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/platform/operators/:email/access — replace an operator's allowlists.
// Body { workspaces: [labelId]|null, pages: [path]|null }. null/empty = all.
router.put('/operators/:email/access', requirePlatformOwner, async (req, res) => {
  const client = await pool.connect();
  try {
    const email = (req.params.email || '').toLowerCase();
    // Never restrict an owner-tier operator.
    const { rows: who } = await client.query('SELECT platform_role FROM users WHERE LOWER(email) = $1 AND is_platform_admin = true LIMIT 1', [email]);
    if (who[0]?.platform_role === 'owner') { return res.status(400).json({ success: false, error: 'Owners cannot be restricted' }); }

    const workspaces = Array.isArray(req.body.workspaces) ? req.body.workspaces.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const pages = Array.isArray(req.body.pages) ? req.body.pages.filter(p => RESTRICTABLE_PAGES.includes(p)) : [];

    // What this operator may BE inside a workspace. Validated, never coerced: a
    // role outside the vocabulary would pass no `includes()` gate in the app and
    // strand them in a tier nothing recognises.
    const bad = [];
    const defaultRole = req.body.default_role === undefined || req.body.default_role === null || req.body.default_role === ''
      ? null
      : (OPERATOR_ROLES.includes(req.body.default_role) ? req.body.default_role : (bad.push(req.body.default_role), null));
    const wsRoles = [];
    const rawRoles = req.body.workspace_roles && typeof req.body.workspace_roles === 'object' ? req.body.workspace_roles : {};
    for (const [k, v] of Object.entries(rawRoles)) {
      const id = parseInt(k, 10);
      if (!Number.isInteger(id)) continue;
      if (v === null || v === '' || v === undefined) continue;   // cleared → inherit the default
      if (!OPERATOR_ROLES.includes(v)) { bad.push(v); continue; }
      wsRoles.push([id, v]);
    }
    if (bad.length) {
      return res.status(400).json({ success: false, error: `Unknown role: ${bad[0]}. Must be one of ${OPERATOR_ROLES.join(', ')}` });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM operator_workspace_access WHERE operator_email = $1', [email]);
    await client.query('DELETE FROM operator_page_access WHERE operator_email = $1', [email]);
    await client.query('DELETE FROM operator_workspace_roles WHERE operator_email = $1', [email]);
    for (const id of workspaces) await client.query('INSERT INTO operator_workspace_access (operator_email, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, id]);
    for (const p of pages) await client.query('INSERT INTO operator_page_access (operator_email, page) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, p]);
    if (defaultRole) {
      await client.query(
        `INSERT INTO operator_workspace_roles (operator_email, label_id, role, updated_by, updated_at)
         VALUES ($1, NULL, $2, $3, NOW())`, [email, defaultRole, req.user.email]);
    }
    for (const [id, role] of wsRoles) {
      await client.query(
        `INSERT INTO operator_workspace_roles (operator_email, label_id, role, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())`, [email, id, role, req.user.email]);
    }

    // Apply it to the memberships they ALREADY hold. auth.js overlays the live
    // role from the users row on every request, so this takes effect on their
    // very next call rather than whenever they next enter — which is the
    // difference between a demotion and a note about one. token_version is
    // bumped alongside it so their client is not left rendering an authority it
    // no longer has; only the ghost's session ends, not their console session,
    // because those are different user rows.
    // Their home row in the system label is excluded by what it IS, not by
    // comparing against the caller's own label: that row is their console
    // identity, and demoting it would take away the console itself.
    const { rows: ghosts } = await client.query(
      `SELECT u.id, u.label_id, u.role FROM users u JOIN labels l ON l.id = u.label_id
        WHERE LOWER(u.email) = $1 AND u.is_platform_admin = true
          AND (l.is_system = false OR l.is_system IS NULL)`,
      [email]
    );
    let applied = 0;
    for (const g of ghosts) {
      const want = wsRoles.find(([id]) => id === g.label_id)?.[1] || defaultRole || DEFAULT_OPERATOR_ROLE;
      if (g.role === want) continue;
      await client.query('UPDATE users SET role = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2', [want, g.id]);
      applied++;
    }

    await client.query('COMMIT');
    res.json({ success: true, data: { sessions_updated: applied } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Set operator access error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// ── Announcements (operator-authored broadcasts) ───────────────────────────
const ANN_LEVELS = ['info', 'warning', 'critical'];

// GET /api/platform/announcements — all announcements, with dismissal counts.
router.get('/announcements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.name AS author,
              (SELECT COUNT(*)::int FROM announcement_dismissals d WHERE d.announcement_id = a.id) AS dismissals
         FROM announcements a LEFT JOIN users u ON u.id = a.created_by
        ORDER BY a.created_at DESC LIMIT 100`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List announcements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/announcements — broadcast to all or a targeted set.
router.post('/announcements', requirePlatformOwner, async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'A title is required' });
    const level = ANN_LEVELS.includes(req.body.level) ? req.body.level : 'info';
    const targets = Array.isArray(req.body.target_label_ids) && req.body.target_label_ids.length
      ? req.body.target_label_ids.map(n => parseInt(n, 10)).filter(Boolean)
      : null;
    const { rows } = await pool.query(
      `INSERT INTO announcements (title, body, level, target_label_ids, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5, NOW()), $6, $7) RETURNING *`,
      [title, req.body.body || null, level, targets, req.body.starts_at || null, req.body.ends_at || null, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/platform/announcements/:id — toggle active (or edit basics).
router.patch('/announcements/:id', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = [], vals = [];
    if (typeof req.body.active === 'boolean') { sets.push(`active = $${sets.length + 1}`); vals.push(req.body.active); }
    if (typeof req.body.title === 'string' && req.body.title.trim()) { sets.push(`title = $${sets.length + 1}`); vals.push(req.body.title.trim()); }
    if (req.body.body !== undefined) { sets.push(`body = $${sets.length + 1}`); vals.push(req.body.body || null); }
    if (ANN_LEVELS.includes(req.body.level)) { sets.push(`level = $${sets.length + 1}`); vals.push(req.body.level); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    vals.push(id);
    const { rows } = await pool.query(`UPDATE announcements SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Announcement not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/platform/announcements/:id
router.delete('/announcements/:id', requirePlatformOwner, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM announcements WHERE id = $1', [parseInt(req.params.id, 10)]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Announcement not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/analytics — growth over time + top workspaces by activity.
router.get('/analytics', async (req, res) => {
  try {
    const ids = await accessibleLabelIds(req);
    const q = (sql, col) => {
      const params = [];
      return pool.query(sql.replace('/*SCOPE*/', scopeClause(ids, col, params)), params);
    };
    // Growth counts, top workspaces and catalog rankings are all narrowed to
    // the caller's allowlist, and the system (Platform HQ) label is excluded
    // from every one of them — it is not a tenant.
    const [wsByMonth, usersByMonth, topByActivity, topByReleases] = await Promise.all([
      q(`SELECT to_char(date_trunc('month', l.created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM labels l
         WHERE l.created_at > NOW() - INTERVAL '12 months'
           AND (l.is_system = false OR l.is_system IS NULL) /*SCOPE*/
         GROUP BY 1 ORDER BY 1`, 'l.id'),
      q(`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM users
         WHERE (is_platform_admin = false OR is_platform_admin IS NULL)
           AND created_at > NOW() - INTERVAL '12 months' AND label_id IS NOT NULL /*SCOPE*/
         GROUP BY 1 ORDER BY 1`, 'label_id'),
      q(`SELECT l.id, l.name, COUNT(al.id)::int AS events
         FROM labels l LEFT JOIN activity_log al ON al.label_id = l.id AND al.created_at > NOW() - INTERVAL '30 days'
         WHERE (l.is_system = false OR l.is_system IS NULL) /*SCOPE*/
         GROUP BY l.id, l.name ORDER BY events DESC, l.name LIMIT 8`, 'l.id'),
      q(`SELECT l.id, l.name, (SELECT COUNT(*) FROM releases r WHERE r.label_id = l.id)::int AS releases
         FROM labels l WHERE (l.is_system = false OR l.is_system IS NULL) /*SCOPE*/
         ORDER BY releases DESC, l.name LIMIT 8`, 'l.id'),
    ]);
    res.json({
      success: true,
      data: {
        workspacesByMonth: wsByMonth.rows,
        usersByMonth: usersByMonth.rows,
        topByActivity: topByActivity.rows,
        topByReleases: topByReleases.rows,
      },
    });
  } catch (error) {
    console.error('Platform analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces — provision a new label + its owner Superadmin.
// This replaces the old public self-serve signup. The platform admin supplies
// the new owner's name/email and a temporary password to hand off.
router.post('/workspaces', requirePlatformOwner, async (req, res) => {
  const client = await pool.connect();
  try {
    const { labelName, ownerName, ownerEmail } = req.body;
    const ownerOperatorId = req.body.owner_operator_id ? parseInt(req.body.owner_operator_id, 10) : null;
    if (!labelName || !String(labelName).trim()) {
      return res.status(400).json({ success: false, error: 'Label name is required' });
    }

    // Path A — assign an existing console operator as owner (no invite needed).
    if (ownerOperatorId) {
      const { rows: op } = await pool.query('SELECT id, name, email FROM users WHERE id = $1 AND is_platform_admin = TRUE LIMIT 1', [ownerOperatorId]);
      if (!op.length) return res.status(400).json({ success: false, error: 'Selected operator not found' });
      const slug = await uniqueSlug(labelName, pool);
      const labelRes = await pool.query(
        'INSERT INTO labels (name, slug, owner_user_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, name, slug, created_at',
        [labelName.trim(), slug, ownerOperatorId]
      );
      await require('../lib/seedCategories').seedCategoriesForLabel(pool, labelRes.rows[0].id).catch(() => {});
      activityBot.postOperatorEvent({ text: `🏢 New workspace created: *${labelRes.rows[0].name}* — owner ${op[0].name}, by ${req.user.name}`, icon: 'building', link: '/workspaces' });
      return res.status(201).json({ success: true, data: { label: labelRes.rows[0], owner: op[0], assigned_operator: true } });
    }

    // Path B — invite a brand-new owner by name + email.
    if (!ownerName || !ownerEmail) {
      return res.status(400).json({ success: false, error: 'Choose an operator, or enter an owner name and email' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      return res.status(400).json({ success: false, error: 'Please enter a valid owner email' });
    }

    await client.query('BEGIN');

    const slug = await uniqueSlug(labelName, client);
    const labelRes = await client.query(
      'INSERT INTO labels (name, slug, created_at) VALUES ($1, $2, NOW()) RETURNING id, name, slug, created_at',
      [labelName.trim(), slug]
    );
    const label = labelRes.rows[0];
    await require('../lib/seedCategories').seedCategoriesForLabel(client, label.id).catch(() => {});

    // Owner is created WITHOUT a password — they activate via an invite link
    // and set their own (same flow as team invites).
    const token = crypto.randomBytes(32).toString('hex');
    const ownerRes = await client.query(
      `INSERT INTO users (label_id, name, email, role, department, hierarchy_level,
         invite_token, invite_expires, invited_at, created_at)
       VALUES ($1, $2, $3, 'Superadmin', 'Executive', 1, $4, NOW() + ($5 || ' days')::interval, NOW(), NOW())
       RETURNING id, name, email, role`,
      [label.id, ownerName.trim(), ownerEmail.trim().toLowerCase(), token, String(INVITE_DAYS)]
    );

    await client.query('COMMIT');

    // Email the owner their invite (best-effort).
    const link = inviteLink(req, token);
    const msg = inviteEmail({
      inviteeName: ownerName.trim(),
      workspaceName: label.name,
      inviterName: req.user.name,
      link,
      expiresDays: INVITE_DAYS,
    });
    const mail = await sendEmail({ to: ownerRes.rows[0].email, subject: msg.subject, html: msg.html, text: msg.text });

    activityBot.postOperatorEvent({ text: `🏢 New workspace created: *${label.name}* — owner invited (${ownerRes.rows[0].email}), by ${req.user.name}`, icon: 'building', link: '/workspaces' });
    res.status(201).json({
      success: true,
      data: { label, owner: ownerRes.rows[0], invite_link: link, email_sent: mail.sent },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'That owner email already exists in the new workspace' });
    }
    console.error('Create workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/platform/workspaces/:labelId/enter — drop INTO a target workspace
// as the PLATFORM ADMIN THEMSELVES (not as some existing member). We get-or-
// create a Superadmin membership for this operator inside the target label,
// keyed to their own email, and flagged is_platform_admin so it stays hidden
// from the label's own roster. They then hold a scoped session for that label
// with full Superadmin control, and every id-bound page (Settings, audit
// attribution) resolves to *them*. The client stashes the real platform token
// and restores it on exit.
router.post('/workspaces/:labelId/enter', async (req, res) => {
  try {
    const labelId = parseInt(req.params.labelId, 10);
    if (isNaN(labelId)) return res.status(400).json({ success: false, error: 'Invalid workspace' });

    // Admin-tier operators may be restricted to an allowlist of workspaces.
    if (req.user.platform_role !== 'owner') {
      const access = await operatorAccess(req.user.email);
      if (access.workspaces && !access.workspaces.includes(labelId)) {
        return res.status(403).json({ success: false, error: 'You do not have access to this workspace' });
      }
    }

    const labelRes = await pool.query('SELECT id, name, slug, accent_color, logo_r2_key, logo_data FROM labels WHERE id = $1', [labelId]);
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : (label.logo_data || null);
    delete label.logo_r2_key;
    delete label.logo_data;

    // Find this operator's existing membership in the target label, or mint one.
    // lib/operatorGhost owns that rule — the console's cross-workspace My Work
    // mints the same row when filing a task into a workspace never entered, and
    // two copies of an identity rule drift.
    const target = await ensureGhost(labelId, req.user);

    // Audit the cross-tenant entry in the target label's log, attributed to the
    // operator by email.
    pool.query(
      `INSERT INTO activity_log (label_id, user_id, action, detail, method, endpoint, created_at)
       VALUES ($1, $2, $3, $4, 'POST', $5, NOW())`,
      [labelId, target.id, 'Workspace entered by platform admin', req.user.email, req.originalUrl?.split('?')[0] || null]
    ).catch(() => {});

    // Platform-level enter-session audit (attributed to the REAL operator id).
    pool.query(
      `INSERT INTO operator_sessions (operator_id, operator_email, operator_name, label_id, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, req.user.email, req.user.name || null, labelId, req.ip || req.headers['x-forwarded-for'] || null]
    ).catch(() => {});

    const token = signToken(target, '8h');
    res.json({ success: true, data: { token, user: publicUser(target), label } });
  } catch (error) {
    console.error('Enter workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/platform/workspaces/:id — rename and/or recolor a workspace.
router.patch('/workspaces/:id', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = [];
    const values = [];
    if (typeof req.body.name === 'string' && req.body.name.trim()) { fields.push(`name = $${fields.length + 1}`); values.push(req.body.name.trim()); }
    if (req.body.accent_color !== undefined) { fields.push(`accent_color = $${fields.length + 1}`); values.push(req.body.accent_color || null); }
    if (!fields.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE labels SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING id, name, slug, accent_color`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/platform/workspaces/:id/colors — set (or clear) a workspace's brand
// accent and/or its console override, in one place.
//
// Body { accent_color, console_color }, each optional; null or '' clears one.
// `color` is accepted as a legacy alias for console_color so a browser tab
// still running the previous bundle keeps working across the deploy.
//
// requireWorkspaceAccess, NOT requirePlatformOwner like the other workspace
// mutations. The Manage tab that used to be the only way to set an accent is
// owner-gated, which left every admin-tier operator unable to brand a workspace
// they provision and work in every day. Picking a colour is cosmetic and
// reversible; renaming a workspace (still on the owner-only PATCH) is not.
// Both paths, ONE handler — not a redirect into router.handle(), which
// re-enters the router and so re-runs authMiddleware (a second user-row read)
// and the access check for every legacy call.
router.put(['/workspaces/:id(\\d+)/colors', '/workspaces/:id(\\d+)/console-color'], requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Validate, never coerce: a bad value that silently became null would look
    // like the save worked and the palette ignored it.
    const read = (v) => {
      if (v === undefined) return undefined;                 // field absent → leave alone
      if (v === null || String(v).trim() === '') return null; // explicit clear
      const hex = String(v).trim();
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) throw new Error(hex);
      return hex;
    };

    let accent, consoleColor;
    try {
      accent = read(req.body.accent_color);
      consoleColor = read(req.body.console_color !== undefined ? req.body.console_color : req.body.color);
    } catch (bad) {
      return res.status(400).json({ success: false, error: `"${bad.message}" is not a hex colour like #2a78d6` });
    }
    if (accent === undefined && consoleColor === undefined) {
      return res.status(400).json({ success: false, error: 'No colour provided' });
    }

    const sets = [], values = [];
    if (accent !== undefined) { values.push(accent); sets.push(`accent_color = $${values.length}`); }
    if (consoleColor !== undefined) { values.push(consoleColor); sets.push(`console_color = $${values.length}`); }
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE labels SET ${sets.join(', ')}
        WHERE id = $${values.length} AND (is_system = false OR is_system IS NULL)
        RETURNING id, name, accent_color, console_color`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });

    // This file audits operator actions to the Platform HQ activity channel,
    // not via logActivity (which is not imported here and is label-scoped to
    // the operator's own HQ row anyway). Keep to the local convention.
    const parts = [];
    if (accent !== undefined) parts.push(accent ? `brand ${accent}` : 'brand cleared');
    if (consoleColor !== undefined) parts.push(consoleColor ? `console ${consoleColor}` : 'console override cleared');
    activityBot.postOperatorEvent({
      text: `🎨 Colours for *${rows[0].name}* — ${parts.join(', ')} — by ${req.user.name}`,
      icon: 'building', link: '/workspaces',
    });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Workspace colours error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});
// POST /api/platform/workspaces/:id/logo — upload/replace the workspace logo.
router.post('/workspaces/:id/logo', requirePlatformOwner, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ success: false, error: 'Logo must be an image' });
    const id = parseInt(req.params.id, 10);
    const existing = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const oldKey = existing.rows[0].logo_r2_key;

    if (isConfigured()) {
      try {
        const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `label-${id}/branding/logo-${Date.now()}-${safe}`;
        await uploadFile(key, req.file.buffer, req.file.mimetype);
        if (oldKey) deleteFile(oldKey).catch(() => {});
        await pool.query('UPDATE labels SET logo_r2_key = $1, logo_data = NULL WHERE id = $2', [key, id]);
        return res.json({ success: true, data: { logo_url: await getSignedFileUrl(key, 6 * 3600).catch(() => null) } });
      } catch (e) {
        console.error('R2 workspace logo upload failed, falling back to inline:', e.message);
      }
    }
    if (req.file.buffer.length > 512 * 1024) {
      return res.status(400).json({ success: false, error: 'Logo must be under 512 KB (larger files need object storage to be configured).' });
    }
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    if (oldKey) deleteFile(oldKey).catch(() => {});
    await pool.query('UPDATE labels SET logo_data = $1, logo_r2_key = NULL WHERE id = $2', [dataUrl, id]);
    res.json({ success: true, data: { logo_url: dataUrl } });
  } catch (error) {
    console.error('Workspace logo error:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

// DELETE /api/platform/workspaces/:id/logo
router.delete('/workspaces/:id/logo', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows } = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    await pool.query('UPDATE labels SET logo_r2_key = NULL, logo_data = NULL WHERE id = $1', [id]);
    if (rows[0].logo_r2_key) deleteFile(rows[0].logo_r2_key).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('Delete workspace logo error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces/:id/reset-owner — set a new temp password for
// the workspace owner and invalidate their sessions. Returns the hand-off.
router.post('/workspaces/:id/reset-owner', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const newPassword = (req.body.password || '').trim();
    if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Temporary password must be at least 8 characters' });
    const owner = await ownerOf(id);
    if (!owner) return res.status(404).json({ success: false, error: 'Workspace has no owner to reset' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
      [hash, owner.id]
    );
    const label = await pool.query('SELECT name, slug FROM labels WHERE id = $1', [id]);
    res.json({ success: true, data: { owner: { name: owner.name, email: owner.email }, label: label.rows[0], password: newPassword } });
  } catch (error) {
    console.error('Reset owner error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Member & owner management ──────────────────────────────────────────────
// Operators (admin or owner) can staff any workspace from the console.
const MEMBER_ROLES = ['Superadmin', 'Admin', 'Approver', 'User'];
const HIER_FOR = { Superadmin: 1, Admin: 2, Approver: 3, User: 4 };

// A single non-operator member of a label (operator ghost rows are excluded).
async function memberOf(labelId, userId) {
  const { rows } = await pool.query(
    `SELECT id, name, email, role FROM users
      WHERE id = $1 AND label_id = $2 AND (is_platform_admin = false OR is_platform_admin IS NULL)`,
    [userId, labelId]
  );
  return rows[0] || null;
}
async function superadminCount(labelId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users
      WHERE label_id = $1 AND role = 'Superadmin' AND (is_platform_admin = false OR is_platform_admin IS NULL)`,
    [labelId]
  );
  return rows[0].n;
}

// POST /workspaces/:id/members — invite a member (role Superadmin = owner). The
// user activates via an invite link + sets their own password (team-invite flow).
router.post('/workspaces/:id/members', requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const role = MEMBER_ROLES.includes(req.body.role) ? req.body.role : 'User';
    if (!name || !email) return res.status(400).json({ success: false, error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email' });
    const lbl = await pool.query('SELECT id, name FROM labels WHERE id = $1', [id]);
    if (!lbl.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });

    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO users (label_id, name, email, role, department, hierarchy_level,
         invite_token, invite_expires, invited_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' days')::interval, NOW(), NOW())
       RETURNING id, name, email, role`,
      [id, name, email, role, role === 'Superadmin' ? 'Executive' : 'Operations', HIER_FOR[role], token, String(INVITE_DAYS)]
    );
    const link = inviteLink(req, token);
    const msg = inviteEmail({ inviteeName: name, workspaceName: lbl.rows[0].name, inviterName: req.user.name, link, expiresDays: INVITE_DAYS });
    const mail = await sendEmail({ to: email, subject: msg.subject, html: msg.html, text: msg.text });
    res.status(201).json({ success: true, data: { user: rows[0], invite_link: link, email_sent: mail.sent } });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'A user with that email already exists in this workspace' });
    console.error('Invite member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /workspaces/:id/members/:userId — change a member's role.
router.patch('/workspaces/:id/members/:userId', requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const role = req.body.role;
    if (!MEMBER_ROLES.includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });
    const m = await memberOf(id, userId);
    if (!m) return res.status(404).json({ success: false, error: 'Member not found' });
    if (m.role === 'Superadmin' && role !== 'Superadmin' && (await superadminCount(id)) <= 1) {
      return res.status(400).json({ success: false, error: 'Assign another owner before demoting the only Superadmin' });
    }
    await pool.query('UPDATE users SET role = $1, hierarchy_level = $2 WHERE id = $3 AND label_id = $4', [role, HIER_FOR[role], userId, id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Change member role error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces/:id/members/:userId/make-owner — promote a member to owner
// (Superadmin, top of hierarchy) and demote the previous owner to Admin.
router.post('/workspaces/:id/members/:userId/make-owner', requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const m = await memberOf(id, userId);
    if (!m) return res.status(404).json({ success: false, error: 'Member not found' });
    const current = await ownerOf(id);
    // token_version bump: `department` is a JWT claim that Team Work's teamFilter
    // trusts (and unlike `role`, auth middleware does NOT re-read it per request),
    // so changing it here must invalidate the member's live sessions.
    await pool.query("UPDATE users SET role = 'Superadmin', department = 'Executive', hierarchy_level = 1, token_version = token_version + 1 WHERE id = $1 AND label_id = $2", [userId, id]);
    if (current && current.id !== userId && !current.is_platform_admin) {
      await pool.query("UPDATE users SET role = 'Admin', hierarchy_level = 2 WHERE id = $1 AND label_id = $2", [current.id, id]);
    }
    // A member promotion hands ownership to that member — drop any operator pointer.
    await pool.query('UPDATE labels SET owner_user_id = NULL WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Make owner error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces/:id/owner — designate a CONSOLE OPERATOR as the workspace's
// owner (or clear back to the member heuristic). Any operator. body { operator_id }.
router.post('/workspaces/:id/owner', requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const lbl = await pool.query('SELECT id, is_system FROM labels WHERE id = $1', [id]);
    if (!lbl.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    if (lbl.rows[0].is_system) return res.status(400).json({ success: false, error: 'The platform system workspace cannot be reassigned' });

    if (req.body.operator_id == null || req.body.operator_id === '') {
      await pool.query('UPDATE labels SET owner_user_id = NULL WHERE id = $1', [id]);
      return res.json({ success: true, data: await ownerOf(id) });
    }
    const opId = parseInt(req.body.operator_id, 10);
    const { rows: op } = await pool.query('SELECT id FROM users WHERE id = $1 AND is_platform_admin = TRUE', [opId]);
    if (!op.length) return res.status(400).json({ success: false, error: 'Not a platform operator' });
    await pool.query('UPDATE labels SET owner_user_id = $1 WHERE id = $2', [opId, id]);
    res.json({ success: true, data: await ownerOf(id) });
  } catch (error) {
    console.error('Set operator owner error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /workspaces/:id/members/:userId — remove a member (FK-swept).
router.delete('/workspaces/:id/members/:userId', requireWorkspaceAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const m = await memberOf(id, userId);
    if (!m) return res.status(404).json({ success: false, error: 'Member not found' });
    if (m.role === 'Superadmin' && (await superadminCount(id)) <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot remove the only owner — assign another owner first' });
    }
    await deleteUserWithSweep(id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces/:id/suspend  and  /reactivate
router.post('/workspaces/:id/suspend', requirePlatformOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE labels SET status = 'suspended', suspended_at = NOW() WHERE id = $1 RETURNING id, name, status",
      [parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    activityBot.postOperatorEvent({ text: `⛔ Workspace suspended: *${rows[0].name}* — by ${req.user.name}`, icon: 'building', link: '/workspaces' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Suspend workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/workspaces/:id/reactivate', requirePlatformOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE labels SET status = 'active', suspended_at = NULL WHERE id = $1 RETURNING id, name, status",
      [parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    activityBot.postOperatorEvent({ text: `✅ Workspace reactivated: *${rows[0].name}* — by ${req.user.name}`, icon: 'building', link: '/workspaces' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Reactivate workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces/:id/ai-limit — set the monthly AI request cap.
// body { monthly_limit }: a number (0+), -1 for unlimited, or null/'' to use
// the platform default.
router.post('/workspaces/:id/ai-limit', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const raw = req.body.monthly_limit;
    const type = req.body.limit_type === 'tokens' ? 'tokens' : 'requests';
    if (raw == null || raw === '') {
      await pool.query('DELETE FROM ai_limits WHERE label_id = $1', [id]);
      return res.json({ success: true, data: { limit: aiUsage.DEFAULT_LIMIT, type: 'requests' } });
    }
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < -1) return res.status(400).json({ success: false, error: 'Limit must be 0 or more (or -1 for unlimited)' });
    await pool.query(
      `INSERT INTO ai_limits (label_id, monthly_limit, limit_type) VALUES ($1, $2, $3)
       ON CONFLICT (label_id) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit, limit_type = EXCLUDED.limit_type`,
      [id, n, type]
    );
    res.json({ success: true, data: { limit: n, type } });
  } catch (error) {
    console.error('Set AI limit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/platform/workspaces/:id — permanently delete a workspace and all
// its data. Requires the exact workspace name as confirmation in the body.
router.delete('/workspaces/:id', requirePlatformOwner, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const label = await client.query('SELECT name, is_system FROM labels WHERE id = $1', [id]);
    if (!label.rows.length) { return res.status(404).json({ success: false, error: 'Workspace not found' }); }
    if (label.rows[0].is_system) { return res.status(400).json({ success: false, error: 'The platform system workspace cannot be deleted.' }); }
    if ((req.body.confirm || '').trim() !== label.rows[0].name) {
      return res.status(400).json({ success: false, error: 'Type the exact workspace name to confirm deletion' });
    }

    await client.query('BEGIN');
    // Platform operators live in `users` with a home label_id + ON DELETE
    // CASCADE — deleting their home workspace would delete THEM (and kill the
    // session bound to that exact row). So we NEVER let an operator row be
    // cascade-deleted: each operator homed here is MOVED (id preserved, so the
    // session survives) to Platform HQ. Any duplicate of that email already in
    // HQ is removed first to satisfy UNIQUE(label_id, email) — we keep the row
    // that was actually in use here rather than a stale duplicate.
    let target = await client.query(`SELECT id FROM labels WHERE is_system = true ORDER BY id LIMIT 1`);
    if (!target.rows.length) {
      target = await client.query(
        `INSERT INTO labels (name, slug, status, is_system, created_at)
         VALUES ('Platform HQ', 'platform-hq', 'active', true, NOW())
         ON CONFLICT (slug) DO UPDATE SET is_system = true RETURNING id`
      );
    }
    const hqId = target.rows[0].id;
    if (hqId !== id) {
      const ops = await client.query('SELECT id, email FROM users WHERE label_id = $1 AND is_platform_admin = true', [id]);
      for (const op of ops.rows) {
        await client.query('DELETE FROM users WHERE label_id = $1 AND LOWER(email) = LOWER($2) AND id <> $3', [hqId, op.email, op.id]);
        await client.query('UPDATE users SET label_id = $1 WHERE id = $2', [hqId, op.id]);
      }
    }
    // ON DELETE CASCADE on every tenant table removes all of the label's data.
    await client.query('DELETE FROM labels WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Operators (owner-only) ──────────────────────────────────────────────
// Workspace Admins are platform operators: is_platform_admin = true,
// platform_role = 'admin'. Their "home" row lives in the inviting owner's
// label (hidden from that label's roster); on entering any workspace a ghost
// membership is minted. Owners manage them here.

// GET /api/platform/operators — list every operator (owner + workspace admins),
// de-duplicated by email (an operator has one home row + ghost rows). Readable
// by any operator (used by the workspace-owner picker); operator *management*
// mutations remain owner-only.
router.get('/operators', async (req, res) => {
  try {
    const { rows } = await pool.query(
      // Per-operator access summary rides along so the roster is AUDITABLE at a
      // glance: today every admin reads "Workspace Admin" and you must open the
      // modal to learn one reaches 8 workspaces and another just 1. ws_scoped=0
      // means the allowlist is empty = ALL workspaces (the inverse-state rule);
      // default_role is the tier their identity takes on entry; page_scoped>0
      // means some console pages are hidden from them.
      `SELECT DISTINCT ON (LOWER(u.email)) u.id, u.email, u.name, u.platform_role,
              (u.password_hash IS NULL AND u.invite_token IS NOT NULL) AS pending,
              (SELECT COUNT(*)::int FROM operator_workspace_access a WHERE LOWER(a.operator_email) = LOWER(u.email)) AS ws_scoped,
              (SELECT COUNT(*)::int FROM operator_page_access pg WHERE LOWER(pg.operator_email) = LOWER(u.email)) AS page_scoped,
              (SELECT r.role FROM operator_workspace_roles r WHERE LOWER(r.operator_email) = LOWER(u.email) AND r.label_id IS NULL LIMIT 1) AS default_role
       FROM users u
       WHERE u.is_platform_admin = TRUE
       ORDER BY LOWER(u.email), (u.platform_role = 'owner') DESC, u.id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List operators error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/operators — invite a new Workspace Admin operator. Created
// in the owner's home label (hidden from its roster); activates via invite link.
router.post('/operators', requirePlatformOwner, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    if (!name || !email) return res.status(400).json({ success: false, error: 'Name and email are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email' });

    // Block active operators / owners; allow re-inviting a still-pending admin.
    const exists = await pool.query('SELECT password_hash, platform_role FROM users WHERE LOWER(email) = $1 AND is_platform_admin = TRUE ORDER BY (platform_role = $2) DESC LIMIT 1', [email, 'owner']);
    if (exists.rows.length) {
      if (exists.rows[0].platform_role === 'owner') return res.status(400).json({ success: false, error: 'That person is a platform owner' });
      if (exists.rows[0].password_hash) return res.status(400).json({ success: false, error: 'That person is already an operator' });
      // else: pending Workspace Admin — fall through to regenerate + resend.
    }

    const token = crypto.randomBytes(32).toString('hex');
    // Home operators in the permanent "Platform HQ" system label so a tenant
    // workspace deletion can never cascade-delete them. Fall back to the
    // inviter's home only if HQ somehow doesn't exist yet.
    const hq = await pool.query('SELECT id FROM labels WHERE is_system = true ORDER BY id LIMIT 1');
    const homeLabel = hq.rows[0]?.id || req.user.label_id;
    await pool.query(
      `INSERT INTO users (label_id, name, email, role, department, hierarchy_level,
         is_platform_admin, platform_role, invite_token, invite_expires, invited_at, created_at)
       VALUES ($1, $2, $3, 'Admin', 'Platform', 0, TRUE, 'admin', $4, NOW() + ($5 || ' days')::interval, NOW(), NOW())
       ON CONFLICT (label_id, email) DO UPDATE SET
         is_platform_admin = TRUE, platform_role = 'admin', name = EXCLUDED.name,
         invite_token = EXCLUDED.invite_token, invite_expires = EXCLUDED.invite_expires, invited_at = NOW()`,
      [homeLabel, name, email, token, String(INVITE_DAYS)]
    );

    const link = inviteLink(req, token);
    const msg = inviteEmail({ inviteeName: name, workspaceName: 'the Cadence platform', inviterName: req.user.name, link, expiresDays: INVITE_DAYS });
    const mail = await sendEmail({ to: email, subject: "You've been added as a Cadence Workspace Admin", html: msg.html, text: msg.text });

    res.status(201).json({ success: true, data: { email, name, invite_link: link, email_sent: mail.sent, email_error: mail.sent ? null : mail.reason } });
  } catch (error) {
    console.error('Invite operator error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/platform/operators/:email — rename an operator across all of their
// rows (home + per-label ghosts share an email).
router.patch('/operators/:email', requirePlatformOwner, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name cannot be empty' });
    const { rowCount } = await pool.query(
      'UPDATE users SET name = $1 WHERE LOWER(email) = $2 AND is_platform_admin = TRUE',
      [name.slice(0, 120), email]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Operator not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Rename operator error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/platform/operators/:email — revoke a Workspace Admin entirely
// (home row + all ghost rows). Owners can't be revoked here.
router.delete('/operators/:email', requirePlatformOwner, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    if (email === (req.user.email || '').toLowerCase()) {
      return res.status(400).json({ success: false, error: 'You cannot revoke yourself' });
    }
    const { rowCount } = await pool.query(
      "DELETE FROM users WHERE LOWER(email) = $1 AND is_platform_admin = TRUE AND platform_role = 'admin'",
      [email]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Workspace Admin not found (owners cannot be revoked here)' });
    res.json({ success: true });
  } catch (error) {
    console.error('Revoke operator error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { requirePlatformAdmin, requirePlatformOwner } = require('../middleware/tenant');
const { uniqueSlug } = require('../lib/slug');
const { signToken, publicUser } = require('../lib/token');
const { getSignedFileUrl, uploadFile, deleteFile } = require('../lib/r2');
const { sendEmail, inviteEmail } = require('../lib/email');
const { deleteUserWithSweep } = require('../lib/userDelete');
const { PLANS, PLAN, PLAN_KEYS, BILLING_STATUSES, effectiveMrr } = require('../lib/plans');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const INVITE_DAYS = 7;
function inviteLink(req, token) {
  const origin = process.env.FRONTEND_URL || req.headers.origin || `${req.protocol}://${req.get('host')}`;
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
      `SELECT l.id, l.name, l.slug, l.accent_color, l.logo_r2_key,
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
      r.logo_url = r.logo_r2_key ? await getSignedFileUrl(r.logo_r2_key, 6 * 3600).catch(() => null) : null;
      delete r.logo_r2_key;
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
      `SELECT id, name, slug, accent_color, logo_r2_key, COALESCE(status,'active') AS status, suspended_at, created_at,
              COALESCE(plan,'free') AS plan, COALESCE(billing_status,'active') AS billing_status, mrr_override, plan_since, owner_user_id
         FROM labels WHERE id = $1`,
      [id]
    );
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    delete label.logo_r2_key;
    label.mrr = effectiveMrr(label);
    label.seat_limit = PLAN[label.plan]?.seats ?? null;

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
      },
    });
  } catch (error) {
    console.error('Workspace detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/overview — operator home: platform-wide totals, recent
// cross-tenant activity, and the newest workspaces.
router.get('/overview', async (req, res) => {
  try {
    const [totals, recent, newest, billing] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM labels WHERE (is_system = false OR is_system IS NULL))::int AS workspaces,
           (SELECT COUNT(*) FROM labels WHERE COALESCE(status,'active') = 'active' AND (is_system = false OR is_system IS NULL))::int AS active,
           (SELECT COUNT(*) FROM labels WHERE status = 'suspended' AND (is_system = false OR is_system IS NULL))::int AS suspended,
           (SELECT COUNT(*) FROM labels WHERE created_at > NOW() - INTERVAL '30 days' AND (is_system = false OR is_system IS NULL))::int AS new_30d,
           (SELECT COUNT(*) FROM users WHERE is_platform_admin = false OR is_platform_admin IS NULL)::int AS members,
           (SELECT COUNT(*) FROM artists)::int AS artists,
           (SELECT COUNT(*) FROM releases)::int AS releases,
           (SELECT COUNT(*) FROM deals)::int AS deals,
           (SELECT COUNT(*) FROM contracts)::int AS contracts,
           (SELECT COUNT(*) FROM expenses WHERE deleted = false OR deleted IS NULL)::int AS ledger_entries`
      ),
      pool.query(
        `SELECT al.action, al.detail, al.created_at, l.name AS workspace, l.id AS label_id, u.name AS user_name
         FROM activity_log al
         JOIN labels l ON l.id = al.label_id
         LEFT JOIN users u ON u.id = al.user_id AND u.label_id = al.label_id
         ORDER BY al.created_at DESC LIMIT 20`
      ),
      pool.query(
        `SELECT l.id, l.name, l.slug, l.created_at, COALESCE(l.status,'active') AS status,
                (SELECT COUNT(*) FROM users u WHERE u.label_id = l.id AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL))::int AS members
         FROM labels l WHERE (l.is_system = false OR l.is_system IS NULL) ORDER BY l.created_at DESC LIMIT 5`
      ),
      // Billing rows for the MRR rollup (prices resolved in JS via lib/plans).
      pool.query(
        `SELECT COALESCE(plan,'free') AS plan, COALESCE(billing_status,'active') AS billing_status, mrr_override
           FROM labels WHERE (is_system = false OR is_system IS NULL)`
      ),
    ]);
    const totalsRow = totals.rows[0];
    totalsRow.mrr = billing.rows.reduce((a, w) => a + effectiveMrr(w), 0);
    res.json({ success: true, data: { totals: totalsRow, recentActivity: recent.rows, newestWorkspaces: newest.rows } });
  } catch (error) {
    console.error('Platform overview error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/activity — global cross-tenant audit feed. Optional
// ?label_id, ?q (search action/detail), ?limit (default 100, max 300).
router.get('/activity', async (req, res) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.label_id) { params.push(parseInt(req.query.label_id, 10)); where += ` AND al.label_id = $${params.length}`; }
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

// ── Operator permissions ────────────────────────────────────────────────────
// Console pages an admin operator can be restricted from. Overview ('/') and
// Account are always allowed so an operator is never fully locked out;
// Operators is owner-only anyway.
const RESTRICTABLE_PAGES = ['/workspaces', '/analytics', '/billing', '/activity', '/announcements'];

async function operatorAccess(email) {
  const e = (email || '').toLowerCase();
  const [ws, pg] = await Promise.all([
    pool.query('SELECT label_id FROM operator_workspace_access WHERE operator_email = $1', [e]),
    pool.query('SELECT page FROM operator_page_access WHERE operator_email = $1', [e]),
  ]);
  return {
    workspaces: ws.rows.length ? ws.rows.map(r => r.label_id) : null, // null = all
    pages: pg.rows.length ? pg.rows.map(r => r.page) : null,          // null = all
  };
}

// GET /api/platform/my-access — the caller operator's own restrictions. Owners
// are unrestricted. Used by the console shell to filter nav + guard routes.
router.get('/my-access', async (req, res) => {
  try {
    if (req.user.platform_role === 'owner') return res.json({ success: true, data: { workspaces: null, pages: null } });
    res.json({ success: true, data: await operatorAccess(req.user.email) });
  } catch (error) {
    console.error('My-access error:', error);
    res.json({ success: true, data: { workspaces: null, pages: null } }); // fail open
  }
});

// GET /api/platform/operators/:email/access — owner view of one operator's access.
router.get('/operators/:email/access', requirePlatformOwner, async (req, res) => {
  try {
    res.json({ success: true, data: { ...(await operatorAccess(req.params.email)), restrictablePages: RESTRICTABLE_PAGES } });
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
    if (who[0]?.platform_role === 'owner') { client.release(); return res.status(400).json({ success: false, error: 'Owners cannot be restricted' }); }

    const workspaces = Array.isArray(req.body.workspaces) ? req.body.workspaces.map(n => parseInt(n, 10)).filter(Boolean) : [];
    const pages = Array.isArray(req.body.pages) ? req.body.pages.filter(p => RESTRICTABLE_PAGES.includes(p)) : [];

    await client.query('BEGIN');
    await client.query('DELETE FROM operator_workspace_access WHERE operator_email = $1', [email]);
    await client.query('DELETE FROM operator_page_access WHERE operator_email = $1', [email]);
    for (const id of workspaces) await client.query('INSERT INTO operator_workspace_access (operator_email, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, id]);
    for (const p of pages) await client.query('INSERT INTO operator_page_access (operator_email, page) VALUES ($1, $2) ON CONFLICT DO NOTHING', [email, p]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Set operator access error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

// ── Billing & plans ─────────────────────────────────────────────────────────
// GET /api/platform/billing — every workspace's plan + status + MRR, with rollups.
router.get('/billing', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.name, l.slug, COALESCE(l.status,'active') AS status,
              COALESCE(l.plan,'free') AS plan, COALESCE(l.billing_status,'active') AS billing_status,
              l.mrr_override, l.plan_since,
              (SELECT COUNT(*) FROM users u WHERE u.label_id = l.id AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL))::int AS members
         FROM labels l WHERE (l.is_system = false OR l.is_system IS NULL) ORDER BY l.name`
    );
    const workspaces = rows.map(w => ({ ...w, mrr: effectiveMrr(w), seat_limit: PLAN[w.plan]?.seats ?? null }));
    const planMix = Object.fromEntries(PLANS.map(p => [p.key, 0]));
    const statusMix = {};
    let mrr = 0;
    for (const w of workspaces) {
      planMix[w.plan] = (planMix[w.plan] || 0) + 1;
      statusMix[w.billing_status] = (statusMix[w.billing_status] || 0) + 1;
      mrr += w.mrr;
    }
    res.json({ success: true, data: { registry: PLANS, workspaces, totals: { mrr, planMix, statusMix, count: workspaces.length } } });
  } catch (error) {
    console.error('Billing error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces/:id/plan — set plan / status / MRR override.
router.post('/workspaces/:id/plan', requirePlatformOwner, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const plan = PLAN_KEYS.has(req.body.plan) ? req.body.plan : 'free';
    const billing_status = BILLING_STATUSES.includes(req.body.billing_status) ? req.body.billing_status : 'active';
    const mrr = (req.body.mrr_override === '' || req.body.mrr_override == null) ? null : Number(req.body.mrr_override);
    if (mrr != null && (isNaN(mrr) || mrr < 0)) return res.status(400).json({ success: false, error: 'Invalid MRR override' });
    const { rows } = await pool.query(
      `UPDATE labels SET plan = $1, billing_status = $2, mrr_override = $3, plan_since = COALESCE(plan_since, NOW())
        WHERE id = $4 AND (is_system = false OR is_system IS NULL)
        RETURNING id, plan, billing_status, mrr_override`,
      [plan, billing_status, mrr, id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: { ...rows[0], mrr: effectiveMrr(rows[0]) } });
  } catch (error) {
    console.error('Set plan error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
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
    const [wsByMonth, usersByMonth, topByActivity, topByReleases] = await Promise.all([
      pool.query(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM labels WHERE created_at > NOW() - INTERVAL '12 months'
         GROUP BY 1 ORDER BY 1`
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
         FROM users WHERE (is_platform_admin = false OR is_platform_admin IS NULL) AND created_at > NOW() - INTERVAL '12 months'
         GROUP BY 1 ORDER BY 1`
      ),
      pool.query(
        `SELECT l.id, l.name, COUNT(al.id)::int AS events
         FROM labels l LEFT JOIN activity_log al ON al.label_id = l.id AND al.created_at > NOW() - INTERVAL '30 days'
         GROUP BY l.id, l.name ORDER BY events DESC, l.name LIMIT 8`
      ),
      pool.query(
        `SELECT l.id, l.name, (SELECT COUNT(*) FROM releases r WHERE r.label_id = l.id)::int AS releases
         FROM labels l ORDER BY releases DESC, l.name LIMIT 8`
      ),
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
    if (!labelName || !ownerName || !ownerEmail) {
      return res.status(400).json({ success: false, error: 'Label name, owner name, and owner email are required' });
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

    const labelRes = await pool.query('SELECT id, name, slug, accent_color, logo_r2_key FROM labels WHERE id = $1', [labelId]);
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    delete label.logo_r2_key;

    const email = (req.user.email || '').toLowerCase();
    const cols = 'id, label_id, name, email, role, department, hierarchy_level, is_platform_admin, platform_role, token_version';

    // The operator's tier decides their authority inside a workspace: an owner
    // enters as Superadmin (full), a Workspace Admin as Admin (manage data/team,
    // no owner-only powers). The ghost carries the operator's platform_role.
    const opRole = req.user.platform_role === 'owner' ? 'owner' : 'admin';
    const ghostRole = opRole === 'owner' ? 'Superadmin' : 'Admin';

    // Find this operator's existing membership in the target label, or mint one.
    let target;
    const existing = await pool.query(`SELECT ${cols} FROM users WHERE label_id = $1 AND LOWER(email) = $2`, [labelId, email]);
    if (existing.rows.length) {
      target = existing.rows[0];
      // Keep the ghost aligned with the operator's current tier.
      if (target.role !== ghostRole || !target.is_platform_admin || target.platform_role !== opRole) {
        await pool.query('UPDATE users SET role = $1, is_platform_admin = true, platform_role = $2 WHERE id = $3', [ghostRole, opRole, target.id]);
        target.role = ghostRole; target.is_platform_admin = true; target.platform_role = opRole;
      }
    } else {
      // No password_hash → can't be used for a normal password login; this row
      // is only ever assumed via the platform-enter flow.
      const ins = await pool.query(
        `INSERT INTO users (label_id, name, email, role, department, hierarchy_level, is_platform_admin, platform_role, created_at)
         VALUES ($1, $2, $3, $4, 'Platform', 0, true, $5, NOW())
         RETURNING ${cols}`,
        [labelId, req.user.name || 'Platform Admin', email, ghostRole, opRole]
      );
      target = ins.rows[0];
    }

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

    const token = signToken(target, '2h');
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

// POST /api/platform/workspaces/:id/logo — upload/replace the workspace logo.
router.post('/workspaces/:id/logo', requirePlatformOwner, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const id = parseInt(req.params.id, 10);
    const existing = await pool.query('SELECT logo_r2_key FROM labels WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `label-${id}/branding/logo-${Date.now()}-${safe}`;
    await uploadFile(key, req.file.buffer, req.file.mimetype);
    if (existing.rows[0].logo_r2_key) deleteFile(existing.rows[0].logo_r2_key).catch(() => {});
    await pool.query('UPDATE labels SET logo_r2_key = $1 WHERE id = $2', [key, id]);
    const logo_url = await getSignedFileUrl(key, 6 * 3600).catch(() => null);
    res.json({ success: true, data: { logo_url } });
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
    await pool.query('UPDATE labels SET logo_r2_key = NULL WHERE id = $1', [id]);
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
router.post('/workspaces/:id/members', async (req, res) => {
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
router.patch('/workspaces/:id/members/:userId', async (req, res) => {
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
router.post('/workspaces/:id/members/:userId/make-owner', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const m = await memberOf(id, userId);
    if (!m) return res.status(404).json({ success: false, error: 'Member not found' });
    const current = await ownerOf(id);
    await pool.query("UPDATE users SET role = 'Superadmin', department = 'Executive', hierarchy_level = 1 WHERE id = $1 AND label_id = $2", [userId, id]);
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
// owner (or clear back to the member heuristic). Owner-only. body { operator_id }.
router.post('/workspaces/:id/owner', requirePlatformOwner, async (req, res) => {
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
router.delete('/workspaces/:id/members/:userId', async (req, res) => {
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
      "UPDATE labels SET status = 'suspended', suspended_at = NOW() WHERE id = $1 RETURNING id, status",
      [parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Suspend workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/workspaces/:id/reactivate', requirePlatformOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE labels SET status = 'active', suspended_at = NULL WHERE id = $1 RETURNING id, status",
      [parseInt(req.params.id, 10)]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Reactivate workspace error:', error);
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
    if (!label.rows.length) { client.release(); return res.status(404).json({ success: false, error: 'Workspace not found' }); }
    if (label.rows[0].is_system) { client.release(); return res.status(400).json({ success: false, error: 'The platform system workspace cannot be deleted.' }); }
    if ((req.body.confirm || '').trim() !== label.rows[0].name) {
      client.release();
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
// de-duplicated by email (an operator has one home row + ghost rows).
router.get('/operators', requirePlatformOwner, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (LOWER(email)) id, email, name, platform_role,
              (password_hash IS NULL AND invite_token IS NOT NULL) AS pending
       FROM users
       WHERE is_platform_admin = TRUE
       ORDER BY LOWER(email), (platform_role = 'owner') DESC, id ASC`
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

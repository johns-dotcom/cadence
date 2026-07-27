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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const INVITE_DAYS = 7;
function inviteLink(req, token) {
  const origin = process.env.FRONTEND_URL || req.headers.origin || `${req.protocol}://${req.get('host')}`;
  return `${origin.replace(/\/$/, '')}/accept-invite?token=${token}`;
}

// Resolve a label's primary owner (its non-operator Superadmin / most senior).
async function ownerOf(labelId) {
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
              (SELECT json_build_object('name', name, 'email', email)
                 FROM users WHERE label_id = l.id AND (is_platform_admin = false OR is_platform_admin IS NULL)
                 ORDER BY (role = 'Superadmin') DESC, hierarchy_level ASC, id ASC LIMIT 1) AS owner
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
      `SELECT id, name, slug, accent_color, logo_r2_key, COALESCE(status,'active') AS status, suspended_at, created_at FROM labels WHERE id = $1`,
      [id]
    );
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    delete label.logo_r2_key;

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
    const [totals, recent, newest] = await Promise.all([
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
    ]);
    res.json({ success: true, data: { totals: totals.rows[0], recentActivity: recent.rows, newestWorkspaces: newest.rows } });
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
    // CASCADE — deleting their home workspace would delete THEM. Relocate each
    // operator homed here to another workspace BEFORE the cascade. Relocation
    // must respect UNIQUE(label_id, email): pick a target where that email is
    // free. If the same operator already exists in another workspace, the home
    // row here is a duplicate — let the cascade remove it (they keep the other).
    const ops = await client.query('SELECT id, email FROM users WHERE label_id = $1 AND is_platform_admin = true', [id]);
    for (const op of ops.rows) {
      const dupe = await client.query(
        `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND label_id <> $2 LIMIT 1`, [op.email, id]);
      if (dupe.rows.length) continue; // exists elsewhere already — safe to drop this copy
      const target = await client.query(
        `SELECT id FROM labels WHERE id <> $1
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.label_id = labels.id AND LOWER(u.email) = LOWER($2))
         ORDER BY id LIMIT 1`, [id, op.email]);
      if (!target.rows.length) {
        await client.query('ROLLBACK'); client.release();
        return res.status(400).json({ success: false, error: 'Create another workspace before deleting this one so the platform operator account can be moved to safety.' });
      }
      await client.query('UPDATE users SET label_id = $1 WHERE id = $2', [target.rows[0].id, op.id]);
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

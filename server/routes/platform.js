const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/tenant');
const { uniqueSlug } = require('../lib/slug');
const { signToken, publicUser } = require('../lib/token');
const { getSignedFileUrl } = require('../lib/r2');

const router = express.Router();

// Platform routes operate ACROSS tenants and are the only place that's allowed
// to. Every route requires an authenticated platform admin — the SaaS
// operator, a level above any label's Superadmin.
router.use(authMiddleware, requirePlatformAdmin);

// GET /api/platform/workspaces — list every label account on the platform.
router.get('/workspaces', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.id, l.name, l.slug, l.created_at,
              (SELECT COUNT(*) FROM users WHERE label_id = l.id)::int AS member_count
       FROM labels l
       ORDER BY l.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/platform/workspaces — provision a new label + its owner Superadmin.
// This replaces the old public self-serve signup. The platform admin supplies
// the new owner's name/email and a temporary password to hand off.
router.post('/workspaces', async (req, res) => {
  const client = await pool.connect();
  try {
    const { labelName, ownerName, ownerEmail, ownerPassword } = req.body;
    if (!labelName || !ownerName || !ownerEmail || !ownerPassword) {
      return res.status(400).json({ success: false, error: 'Label name, owner name, owner email, and a temporary password are required' });
    }
    if (ownerPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Temporary password must be at least 8 characters' });
    }

    await client.query('BEGIN');

    const slug = await uniqueSlug(labelName, client);
    const labelRes = await client.query(
      'INSERT INTO labels (name, slug, created_at) VALUES ($1, $2, NOW()) RETURNING id, name, slug, created_at',
      [labelName.trim(), slug]
    );
    const label = labelRes.rows[0];

    const passwordHash = await bcrypt.hash(ownerPassword, 10);
    const ownerRes = await client.query(
      `INSERT INTO users (label_id, name, email, password_hash, role, department, hierarchy_level, created_at)
       VALUES ($1, $2, $3, $4, 'Superadmin', 'Executive', 1, NOW())
       RETURNING id, name, email, role`,
      [label.id, ownerName.trim(), ownerEmail.trim().toLowerCase(), passwordHash]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: { label, owner: ownerRes.rows[0] },
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

// POST /api/platform/workspaces/:labelId/enter — issue a short-lived session
// INTO a target workspace so the platform admin can view it exactly as that
// label sees it. We become the label's owner (its primary Superadmin), so all
// the normal tenant scoping applies while "inside" — there's no cross-tenant
// leakage; the platform admin simply holds a scoped session for that label.
// The client stashes the real platform-admin token and restores it on exit
// (same flow as same-label impersonation).
router.post('/workspaces/:labelId/enter', async (req, res) => {
  try {
    const labelId = parseInt(req.params.labelId, 10);
    if (isNaN(labelId)) return res.status(400).json({ success: false, error: 'Invalid workspace' });

    const labelRes = await pool.query('SELECT id, name, slug, accent_color, logo_r2_key FROM labels WHERE id = $1', [labelId]);
    if (!labelRes.rows.length) return res.status(404).json({ success: false, error: 'Workspace not found' });
    const label = labelRes.rows[0];
    label.logo_url = label.logo_r2_key ? await getSignedFileUrl(label.logo_r2_key, 6 * 3600).catch(() => null) : null;
    delete label.logo_r2_key;

    // Pick the label's owner: prefer a Superadmin, then most senior, then oldest.
    const userRes = await pool.query(
      `SELECT id, label_id, name, email, role, department, hierarchy_level, is_platform_admin, token_version
       FROM users WHERE label_id = $1
       ORDER BY (role = 'Superadmin') DESC, hierarchy_level ASC, id ASC
       LIMIT 1`,
      [labelId]
    );
    if (!userRes.rows.length) {
      return res.status(409).json({ success: false, error: 'Workspace has no users to view as' });
    }
    const target = userRes.rows[0];

    // Audit the cross-tenant entry in BOTH the target label's log (so they can
    // see a platform admin viewed their workspace) and is attributable to the
    // platform admin by email.
    pool.query(
      `INSERT INTO activity_log (label_id, user_id, action, detail, method, endpoint, created_at)
       VALUES ($1, $2, $3, $4, 'POST', $5, NOW())`,
      [labelId, target.id, 'Workspace viewed by platform admin', req.user.email, req.originalUrl?.split('?')[0] || null]
    ).catch(() => {});

    const token = signToken(target, '2h');
    res.json({ success: true, data: { token, user: publicUser(target), label } });
  } catch (error) {
    console.error('Enter workspace error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

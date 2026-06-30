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
              (SELECT COUNT(*) FROM users WHERE label_id = l.id AND (is_platform_admin = false OR is_platform_admin IS NULL))::int AS member_count
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
    const cols = 'id, label_id, name, email, role, department, hierarchy_level, is_platform_admin, token_version';

    // Find this operator's existing membership in the target label, or mint one.
    let target;
    const existing = await pool.query(`SELECT ${cols} FROM users WHERE label_id = $1 AND LOWER(email) = $2`, [labelId, email]);
    if (existing.rows.length) {
      target = existing.rows[0];
      // Keep it a platform-admin Superadmin (in case it was changed).
      if (target.role !== 'Superadmin' || !target.is_platform_admin) {
        await pool.query("UPDATE users SET role = 'Superadmin', is_platform_admin = true WHERE id = $1", [target.id]);
        target.role = 'Superadmin'; target.is_platform_admin = true;
      }
    } else {
      // No password_hash → can't be used for a normal password login; this row
      // is only ever assumed via the platform-enter flow.
      const ins = await pool.query(
        `INSERT INTO users (label_id, name, email, role, department, hierarchy_level, is_platform_admin, created_at)
         VALUES ($1, $2, $3, 'Superadmin', 'Platform', 0, true, NOW())
         RETURNING ${cols}`,
        [labelId, req.user.name || 'Platform Admin', email]
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

module.exports = router;

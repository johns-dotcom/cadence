const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { sendEmail, inviteEmail } = require('../lib/email');

const router = express.Router();

const INVITE_DAYS = 7;
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Build the public accept-invite link. Prefer the request's own origin (so it
// works on any deployed domain) and fall back to FRONTEND_URL.
function inviteLink(req, token) {
  const origin = process.env.FRONTEND_URL
    || (req.headers.origin)
    || `${req.protocol}://${req.get('host')}`;
  return `${origin.replace(/\/$/, '')}/accept-invite?token=${token}`;
}

// Every route here is authenticated and tenant-scoped.
router.use(authMiddleware, withTenant);

// GET /api/team — list members of the current label
router.get('/', async (req, res) => {
  try {
    // Hide platform-admin "operator" memberships from the label's own roster.
    const { rows } = await pool.query(
      `SELECT id, name, email, role, department, hierarchy_level, created_at,
              (password_hash IS NULL AND invite_token IS NOT NULL) AS pending
       FROM users WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
       ORDER BY hierarchy_level, name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List team error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/team — invite a member (admin only). The member is created WITHOUT
// a password and emailed an invite link to set their own. The response carries
// the link too, so the UI can show/copy it (and so the flow still works if
// email isn't configured yet).
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, email, role, department, hierarchy_level } = req.body;
    if (!name || !name.trim() || !email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }
    if (!isValidEmail(email.trim())) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO users (label_id, name, email, role, department, hierarchy_level,
         invite_token, invite_expires, invited_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + ($8 || ' days')::interval, NOW(), NOW())
       RETURNING id, name, email, role, department, hierarchy_level`,
      [req.labelId, name.trim(), email.trim().toLowerCase(), role || 'User', department || 'Operations', hierarchy_level || 99, token, String(INVITE_DAYS)]
    );

    // Resolve workspace name for the email body, then send (best-effort).
    const link = inviteLink(req, token);
    const label = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const msg = inviteEmail({
      inviteeName: name.trim(),
      workspaceName: label.rows[0]?.name || 'your workspace',
      inviterName: req.user.name,
      link,
      expiresDays: INVITE_DAYS,
    });
    const mail = await sendEmail({ to: rows[0].email, subject: msg.subject, html: msg.html, text: msg.text });

    await logActivity(req, 'Invited team member', `${name} (${role || 'User'})`);
    res.status(201).json({ success: true, data: { ...rows[0], invite_link: link, email_sent: mail.sent } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'That email already exists in this workspace' });
    }
    console.error('Invite member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/team/:id/resend — regenerate the invite + resend (admin only).
router.post('/:id/resend', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `UPDATE users SET invite_token = $1, invite_expires = NOW() + ($2 || ' days')::interval, invited_at = NOW()
       WHERE id = $3 AND label_id = $4 AND password_hash IS NULL
       RETURNING id, name, email`,
      [token, String(INVITE_DAYS), id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pending invite not found (member may have already activated)' });
    const link = inviteLink(req, token);
    const label = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const msg = inviteEmail({ inviteeName: rows[0].name, workspaceName: label.rows[0]?.name || 'your workspace', inviterName: req.user.name, link, expiresDays: INVITE_DAYS });
    const mail = await sendEmail({ to: rows[0].email, subject: msg.subject, html: msg.html, text: msg.text });
    res.json({ success: true, data: { invite_link: link, email_sent: mail.sent } });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/team/:id — update role/department/name (admin only)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, role, department, hierarchy_level } = req.body;

    // Bump token_version on role change so the affected user's existing
    // sessions pick up (or lose) permissions immediately.
    const bumpRole = role !== undefined;
    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         role = COALESCE($2, role),
         department = COALESCE($3, department),
         hierarchy_level = COALESCE($4, hierarchy_level),
         token_version = token_version + $5
       WHERE id = $6 AND label_id = $7
       RETURNING id, name, email, role, department, hierarchy_level`,
      [name, role, department, hierarchy_level, bumpRole ? 1 : 0, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    await logActivity(req, 'Updated team member', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/team/:id — remove a member (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) {
      return res.status(400).json({ success: false, error: 'You cannot remove yourself' });
    }
    const { rowCount } = await pool.query(
      'DELETE FROM users WHERE id = $1 AND label_id = $2',
      [id, req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'User not found' });
    await logActivity(req, 'Removed team member', `user #${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

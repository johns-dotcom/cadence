const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Helpers ─────────────────────────────────────────────────────────────

// Sign a session JWT. The label_id is the tenant boundary — it's baked into
// every token and re-checked on every request by authMiddleware.
function signToken(user, expiresIn = '8h') {
  return jwt.sign(
    {
      id: user.id,
      label_id: user.label_id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      hierarchy_level: user.hierarchy_level,
      is_platform_admin: !!user.is_platform_admin,
      tv: user.token_version || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

function publicUser(u) {
  return {
    id: u.id,
    label_id: u.label_id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    hierarchy_level: u.hierarchy_level,
    is_platform_admin: !!u.is_platform_admin,
  };
}

function recordLogin(user, req, method) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
  const ua = req.headers['user-agent'] || null;
  pool.query(
    'INSERT INTO user_login_logs (label_id, user_id, ip_address, user_agent) VALUES ($1, $2, $3, $4)',
    [user.label_id, user.id, ip, ua]
  ).catch(() => {});
  pool.query(
    'INSERT INTO activity_log (label_id, user_id, action, detail, ip_address, method, endpoint, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
    [user.label_id, user.id, 'Signed In', method, ip, 'POST', method === 'Google SSO' ? '/api/auth/google' : '/api/auth/login']
  ).catch(() => {});
}

// NOTE: There is intentionally NO public signup endpoint. Workspaces (labels)
// are provisioned only by a platform admin via POST /api/platform/workspaces
// (see routes/platform.js). Normal users can't create a workspace.

// ── POST /api/auth/login ────────────────────────────────────────────────
// Email + password. Because email is unique only within a label, the same
// address can exist in two workspaces — when it does, the caller must pass a
// `workspace` slug to disambiguate.
router.post('/login', async (req, res) => {
  try {
    const { email, password, workspace } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    let result;
    if (workspace) {
      result = await pool.query(
        `SELECT u.* FROM users u JOIN labels l ON l.id = u.label_id
         WHERE u.email = $1 AND l.slug = $2`,
        [email.trim().toLowerCase(), workspace]
      );
    } else {
      result = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (result.rows.length > 1) {
      // Ambiguous — the email exists in multiple workspaces.
      const { rows } = await pool.query(
        `SELECT l.slug, l.name FROM labels l
         JOIN users u ON u.label_id = l.id WHERE u.email = $1 ORDER BY l.name`,
        [email.trim().toLowerCase()]
      );
      return res.status(409).json({
        success: false,
        error: 'This email is registered to multiple workspaces. Please specify one.',
        workspaces: rows,
      });
    }

    const user = result.rows[0];
    const passwordMatch = user.password_hash && await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = signToken(user);
    recordLogin(user, req, 'Email/password login');

    res.json({ success: true, data: { token, user: publicUser(user) } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/auth/google ───────────────────────────────────────────────
// Verify a Google ID token and issue our JWT. The user must already exist in
// some workspace. If the email maps to multiple workspaces, require `workspace`.
router.post('/google', async (req, res) => {
  try {
    const { credential, workspace } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, error: 'Google credential required' });
    }
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({ success: false, error: 'Google OAuth not configured on server' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email } = ticket.getPayload();

    let result;
    if (workspace) {
      result = await pool.query(
        `SELECT u.* FROM users u JOIN labels l ON l.id = u.label_id
         WHERE u.email = $1 AND l.slug = $2`,
        [email.toLowerCase(), workspace]
      );
    } else {
      result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    }

    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, error: 'No account found for this Google account. Contact your workspace admin.' });
    }
    if (result.rows.length > 1) {
      const { rows } = await pool.query(
        `SELECT l.slug, l.name FROM labels l JOIN users u ON u.label_id = l.id
         WHERE u.email = $1 ORDER BY l.name`,
        [email.toLowerCase()]
      );
      return res.status(409).json({ success: false, error: 'This Google account maps to multiple workspaces.', workspaces: rows });
    }

    const user = result.rows[0];
    const token = signToken(user);
    recordLogin(user, req, 'Google SSO');

    res.json({ success: true, data: { token, user: publicUser(user) } });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ success: false, error: 'Google authentication failed' });
  }
});

// ── POST /api/auth/register ─────────────────────────────────────────────
// Admins add users to THEIR OWN label only. label_id comes from the token,
// never the request body — a tenant can't create users in another tenant.
router.post('/register', authMiddleware, async (req, res) => {
  try {
    if (!['Admin', 'Superadmin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only admins can register users' });
    }

    const { name, email, password, role, department } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password required' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (label_id, name, email, password_hash, role, department, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name, email, role, department`,
      [req.user.label_id, name.trim(), email.trim().toLowerCase(), passwordHash, role || 'User', department || 'Operations']
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'That email already exists in this workspace' });
    }
    console.error('Register error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.label_id, u.name, u.email, u.role, u.department, u.hierarchy_level,
              u.is_platform_admin, u.created_at,
              l.name AS label_name, l.slug AS label_slug
       FROM users u JOIN labels l ON l.id = u.label_id
       WHERE u.id = $1 AND u.label_id = $2`,
      [req.user.id, req.user.label_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const permsResult = await pool.query(
      'SELECT page FROM user_page_permissions WHERE user_id = $1 AND label_id = $2 ORDER BY page',
      [req.user.id, req.user.label_id]
    );
    const pagePermissions = permsResult.rows.length > 0 ? permsResult.rows.map(r => r.page) : null;

    res.json({ success: true, data: { ...result.rows[0], pagePermissions } });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/auth/impersonate/:userId ──────────────────────────────────
// Superadmin "view as" — restricted to users WITHIN the same label.
router.post('/impersonate/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin only' });
    }
    const targetId = parseInt(req.params.userId, 10);
    if (isNaN(targetId) || targetId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Invalid target user' });
    }

    const result = await pool.query(
      'SELECT id, label_id, name, email, role, department, hierarchy_level, token_version FROM users WHERE id = $1 AND label_id = $2',
      [targetId, req.user.label_id]
    );
    const target = result.rows[0];
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found in this workspace' });
    }

    const token = signToken(target, '2h');
    res.json({ success: true, data: { token, user: publicUser(target) } });
  } catch (error) {
    console.error('Impersonate error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── GET /api/auth/users ─────────────────────────────────────────────────
// Superadmin only — lists users in their own label for the impersonation picker.
router.get('/users', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin only' });
    }
    const result = await pool.query(
      'SELECT id, name, email, role, department, hierarchy_level FROM users WHERE label_id = $1 ORDER BY hierarchy_level, name',
      [req.user.label_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/auth/logout-all ───────────────────────────────────────────
router.post('/logout-all', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1 AND label_id = $2',
      [req.user.id, req.user.label_id]
    );
    res.json({ success: true, message: 'All sessions invalidated. Please log in again.' });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── POST /api/auth/change-password ──────────────────────────────────────
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, error: 'Current and new password required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1 AND label_id = $2', [req.user.id, req.user.label_id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });

    const match = rows[0].password_hash && await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ success: false, error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2 AND label_id = $3',
      [hash, req.user.id, req.user.label_id]
    );

    res.json({ success: true, message: 'Password changed. All sessions invalidated.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

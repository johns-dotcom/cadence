const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/settings/me — current user's own profile + preferences
router.get('/me', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, department, hierarchy_level, theme
       FROM users WHERE id = $1 AND label_id = $2`,
      [req.user.id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/settings/me — update own display name
router.patch('/me', async (req, res) => {
  try {
    const { name } = req.body;
    const { rows } = await pool.query(
      'UPDATE users SET name = COALESCE($1, name) WHERE id = $2 AND label_id = $3 RETURNING id, name, email, role',
      [name, req.user.id, req.labelId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/settings/theme — persist light/dark preference
router.patch('/theme', async (req, res) => {
  try {
    const { theme } = req.body;
    if (!['light', 'dark'].includes(theme)) {
      return res.status(400).json({ success: false, error: 'Invalid theme' });
    }
    await pool.query('UPDATE users SET theme = $1 WHERE id = $2 AND label_id = $3', [theme, req.user.id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Set theme error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Per-user page permissions (admin-managed) ───────────────────────────
// GET /api/settings/permissions/:userId — list pages a user is restricted to
router.get('/permissions/:userId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT page FROM user_page_permissions WHERE user_id = $1 AND label_id = $2 ORDER BY page',
      [parseInt(req.params.userId, 10), req.labelId]
    );
    res.json({ success: true, data: rows.map(r => r.page) });
  } catch (error) {
    console.error('Get permissions error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/settings/permissions/:userId — replace a user's page allowlist.
// An empty array means "unrestricted" (we clear all rows).
router.put('/permissions/:userId', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.userId, 10);
    const pages = Array.isArray(req.body.pages) ? req.body.pages : [];

    // Confirm the target user is in this label before touching their perms.
    const { rows: u } = await client.query('SELECT 1 FROM users WHERE id = $1 AND label_id = $2', [userId, req.labelId]);
    if (!u.length) return res.status(404).json({ success: false, error: 'User not found' });

    await client.query('BEGIN');
    await client.query('DELETE FROM user_page_permissions WHERE user_id = $1 AND label_id = $2', [userId, req.labelId]);
    for (const page of pages) {
      await client.query(
        'INSERT INTO user_page_permissions (label_id, user_id, page) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.labelId, userId, page]
      );
    }
    // Invalidate the user's sessions so the new permissions take effect.
    await client.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1 AND label_id = $2', [userId, req.labelId]);
    await client.query('COMMIT');

    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Set permissions error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Per-user rep visibility (admin-managed) ─────────────────────────────
// Controls which reps' ledger entries an Approver can see. Empty = all.

// GET /api/settings/visible-reps/:userId
router.get('/visible-reps/:userId', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT rep_name FROM user_visible_reps WHERE user_id = $1 AND label_id = $2 ORDER BY rep_name',
      [parseInt(req.params.userId, 10), req.labelId]
    );
    res.json({ success: true, data: rows.map(r => r.rep_name) });
  } catch (error) {
    console.error('Get visible reps error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/settings/visible-reps/:userId — replace the user's visible-rep set.
router.put('/visible-reps/:userId', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.userId, 10);
    const reps = Array.isArray(req.body.reps) ? req.body.reps : [];
    const { rows: u } = await client.query('SELECT 1 FROM users WHERE id = $1 AND label_id = $2', [userId, req.labelId]);
    if (!u.length) return res.status(404).json({ success: false, error: 'User not found' });
    await client.query('BEGIN');
    await client.query('DELETE FROM user_visible_reps WHERE user_id = $1 AND label_id = $2', [userId, req.labelId]);
    for (const rep of reps) {
      if (!rep || !String(rep).trim()) continue;
      await client.query('INSERT INTO user_visible_reps (label_id, user_id, rep_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.labelId, userId, String(rep).trim()]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Set visible reps error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Permission templates (admin-managed named page-sets) ────────────────

// GET /api/settings/permission-templates — this label's saved templates.
router.get('/permission-templates', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, pages FROM permission_templates WHERE label_id = $1 ORDER BY LOWER(name)',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/settings/permission-templates { name, pages } — upsert by ci-name.
router.post('/permission-templates', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const pages = Array.isArray(req.body.pages) ? req.body.pages : [];
    if (!name) return res.status(400).json({ success: false, error: 'Template name is required' });
    const existing = await pool.query('SELECT id FROM permission_templates WHERE label_id = $1 AND LOWER(name) = LOWER($2)', [req.labelId, name]);
    if (existing.rows.length) {
      await pool.query('UPDATE permission_templates SET pages = $1::jsonb, name = $2 WHERE id = $3', [JSON.stringify(pages), name, existing.rows[0].id]);
    } else {
      await pool.query('INSERT INTO permission_templates (label_id, name, pages, created_by) VALUES ($1,$2,$3::jsonb,$4)', [req.labelId, name, JSON.stringify(pages), req.user.name]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Save template error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/settings/permission-templates/:id
router.delete('/permission-templates/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM permission_templates WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

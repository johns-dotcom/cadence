const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();

// Every route here is authenticated and tenant-scoped.
router.use(authMiddleware, withTenant);

// GET /api/team — list members of the current label
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, department, hierarchy_level, created_at
       FROM users WHERE label_id = $1 ORDER BY hierarchy_level, name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List team error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/team — add a member (admin only)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, department, hierarchy_level } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password required' });
    }
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (label_id, name, email, password_hash, role, department, hierarchy_level, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, name, email, role, department, hierarchy_level`,
      [req.labelId, name.trim(), email.trim().toLowerCase(), hash, role || 'User', department || 'Operations', hierarchy_level || 99]
    );
    await logActivity(req, 'Added team member', `${name} (${role || 'User'})`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'That email already exists in this workspace' });
    }
    console.error('Add member error:', error);
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

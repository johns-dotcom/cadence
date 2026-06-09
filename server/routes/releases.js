const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/releases — release pipeline for the current label
router.get('/', async (req, res) => {
  try {
    const { status, q } = req.query;
    const params = [req.labelId];
    let where = 'r.label_id = $1';
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (r.project_name ILIKE $${params.length} OR a.name ILIKE $${params.length})`; }

    const { rows } = await pool.query(
      `SELECT r.*, a.name AS artist_name
       FROM releases r
       LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       WHERE ${where}
       ORDER BY r.release_date DESC NULLS LAST, r.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List releases error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/releases/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, a.name AS artist_name
       FROM releases r LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
       WHERE r.id = $1 AND r.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases
router.post('/', async (req, res) => {
  try {
    const { artist_id, project_name, release_date, release_type, genre, status } = req.body;
    if (!project_name || !project_name.trim()) {
      return res.status(400).json({ success: false, error: 'Project name is required' });
    }

    // If an artist_id is supplied, verify it belongs to THIS label before
    // linking — never trust a client-supplied foreign key across tenants.
    if (artist_id) {
      const { rows: a } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artist_id, req.labelId]);
      if (!a.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }

    const { rows } = await pool.query(
      `INSERT INTO releases (label_id, artist_id, project_name, release_date, release_type, genre, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'Draft'), NOW(), NOW())
       RETURNING *`,
      [req.labelId, artist_id || null, project_name.trim(), release_date || null, release_type || null, genre || null, status]
    );
    await logActivity(req, 'Created release', project_name.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/releases/:id
router.patch('/:id', async (req, res) => {
  try {
    const { project_name, release_date, release_type, genre, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE releases SET
         project_name = COALESCE($1, project_name),
         release_date = COALESCE($2, release_date),
         release_type = COALESCE($3, release_type),
         genre = COALESCE($4, genre),
         status = COALESCE($5, status),
         updated_at = NOW()
       WHERE id = $6 AND label_id = $7 RETURNING *`,
      [project_name, release_date, release_type, genre, status, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM releases WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Release not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete release error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

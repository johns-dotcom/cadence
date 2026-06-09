const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/artists — roster for the current label
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.genre, a.created_at,
              COUNT(r.id)::int AS total_releases
       FROM artists a
       LEFT JOIN releases r ON r.artist_id = a.id AND r.label_id = a.label_id
       WHERE a.label_id = $1
       GROUP BY a.id
       ORDER BY a.name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List artists error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/artists/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM artists WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artists
router.post('/', async (req, res) => {
  try {
    const { name, genre } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO artists (label_id, name, genre, created_at) VALUES ($1, $2, $3, NOW())
       RETURNING id, name, genre, created_at`,
      [req.labelId, name.trim(), genre || null]
    );
    await logActivity(req, 'Added artist', name.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'An artist with that name already exists' });
    }
    console.error('Create artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/artists/:id
router.patch('/:id', async (req, res) => {
  try {
    const { name, genre } = req.body;
    const { rows } = await pool.query(
      `UPDATE artists SET name = COALESCE($1, name), genre = COALESCE($2, genre)
       WHERE id = $3 AND label_id = $4 RETURNING *`,
      [name, genre, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/artists/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM artists WHERE id = $1 AND label_id = $2',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Artist not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete artist error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

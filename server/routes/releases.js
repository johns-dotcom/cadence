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

// Columns the client is allowed to patch. Anything else in the body is
// ignored — keeps an updatable allowlist instead of trusting arbitrary keys.
const UPDATABLE = [
  'project_name', 'release_date', 'release_type', 'genre', 'status',
  'upc', 'isrc', 'spotify_uri', 'cover_art_url', 'priority', 'notes',
  'producer', 'featured_artists', 'budget_cap',
  'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
  'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
  'pitched_amazon', 'pitched_pandora', 'youtube_video', 'official_thread',
  'musixmatch', 'recoup_setup',
];

// PATCH /api/releases/:id — partial update of any allowed field(s).
router.patch('/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);

    const { rows } = await pool.query(
      `UPDATE releases SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
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

// Confirm a release belongs to the caller's workspace before touching its
// sub-resources.
async function releaseInLabel(id, labelId) {
  const { rows } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length > 0;
}

// ── Comments ─────────────────────────────────────────────────────────────

// GET /api/releases/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.name AS author
       FROM release_comments c LEFT JOIN users u ON u.id = c.user_id AND u.label_id = c.label_id
       WHERE c.label_id = $1 AND c.release_id = $2 ORDER BY c.created_at ASC`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List comments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases/:id/comments
router.post('/:id/comments', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Comment is required' });
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });
    const { rows } = await pool.query(
      `INSERT INTO release_comments (label_id, release_id, user_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at`,
      [req.labelId, id, req.user.id, body]
    );
    res.status(201).json({ success: true, data: { ...rows[0], author: req.user.name } });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id/comments/:commentId
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM release_comments WHERE id = $1 AND release_id = $2 AND label_id = $3',
      [parseInt(req.params.commentId, 10), parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Comment not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Budget line items ────────────────────────────────────────────────────

// GET /api/releases/:id/budget — cap + line items + total.
router.get('/:id/budget', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cap = await pool.query('SELECT budget_cap FROM releases WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cap.rows.length) return res.status(404).json({ success: false, error: 'Release not found' });
    const items = await pool.query('SELECT * FROM release_budget_items WHERE label_id = $1 AND release_id = $2 ORDER BY id', [req.labelId, id]);
    const total = items.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    res.json({ success: true, data: { budget_cap: cap.rows[0].budget_cap, items: items.rows, total } });
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/releases/:id/budget/items
router.post('/:id/budget/items', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await releaseInLabel(id, req.labelId))) return res.status(404).json({ success: false, error: 'Release not found' });
    const { rows } = await pool.query(
      `INSERT INTO release_budget_items (label_id, release_id, category, description, amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.labelId, id, req.body.category || null, req.body.description || null, parseFloat(req.body.amount) || 0]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create budget item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/releases/:id/budget/items/:itemId
router.delete('/:id/budget/items/:itemId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM release_budget_items WHERE id = $1 AND release_id = $2 AND label_id = $3',
      [parseInt(req.params.itemId, 10), parseInt(req.params.id, 10), req.labelId]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete budget item error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

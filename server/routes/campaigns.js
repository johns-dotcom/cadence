const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

const UPDATABLE = [
  'artist_id', 'name', 'platform', 'status', 'planned_budget',
  'actual_spend', 'currency', 'start_date', 'end_date', 'handles', 'notes',
];

// Validate a client-supplied artist_id belongs to this workspace.
async function checkArtist(artistId, labelId) {
  if (!artistId) return true;
  const { rows } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, labelId]);
  return rows.length > 0;
}

// GET /api/campaigns — all campaigns + the artist name, label-scoped.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name FROM campaigns c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.label_id = $1 ORDER BY c.updated_at DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/campaigns
router.post('/', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Campaign name is required' });
    const artistId = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
    if (!(await checkArtist(artistId, req.labelId))) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    const { rows } = await pool.query(
      `INSERT INTO campaigns (label_id, artist_id, name, platform, status, planned_budget, actual_spend, currency, start_date, end_date, handles, notes)
       VALUES ($1,$2,$3,$4,COALESCE($5,'Planned'),$6,$7,COALESCE($8,'USD'),$9,$10,$11,$12) RETURNING *`,
      [
        req.labelId, artistId, name, req.body.platform || null, req.body.status || null,
        parseFloat(req.body.planned_budget) || 0, parseFloat(req.body.actual_spend) || 0,
        req.body.currency || null, req.body.start_date || null, req.body.end_date || null,
        req.body.handles || null, req.body.notes || null,
      ]
    );
    await logActivity(req, 'Added campaign', name);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/campaigns/:id
router.patch('/:id', async (req, res) => {
  try {
    if (req.body.artist_id && !(await checkArtist(parseInt(req.body.artist_id, 10), req.labelId))) {
      return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE campaigns SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM campaigns WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Campaign not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

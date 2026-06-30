const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { buildClearanceXlsx } = require('../lib/clearanceXlsx');

const router = express.Router();
// Clearances carry contractual/royalty detail — Approver+ only, label-scoped.
router.use(authMiddleware, withTenant, requireApprover);

const FIELDS = ['artist_id', 'title', 'project_number', 'product_commitment', 'contractual_members', 'effective_date', 'royalty_rate', 'royalty_account', 'tracks'];

// Validate a client-supplied artist_id belongs to this workspace.
async function checkArtist(artistId, labelId) {
  if (!artistId) return true;
  const { rows } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, labelId]);
  return rows.length > 0;
}

// GET /api/clearances/catalog?artist_id= — releases for autofilling track rows.
router.get('/catalog', async (req, res) => {
  try {
    const artistId = req.query.artist_id ? parseInt(req.query.artist_id, 10) : null;
    if (!artistId) return res.json({ success: true, data: [] });
    const { rows } = await pool.query(
      `SELECT id, project_name, release_date, isrc, producer, featured_artists
       FROM releases WHERE label_id = $1 AND artist_id = $2 ORDER BY release_date DESC NULLS LAST`,
      [req.labelId, artistId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Clearance catalog error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances — list (with artist name + track count).
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name,
              COALESCE(jsonb_array_length(c.tracks), 0) AS track_count
       FROM clearances c LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.label_id = $1 ORDER BY c.updated_at DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List clearances error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name FROM clearances c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Get clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/clearances
router.post('/', async (req, res) => {
  try {
    const artistId = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
    if (!(await checkArtist(artistId, req.labelId))) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    const tracks = Array.isArray(req.body.tracks) ? JSON.stringify(req.body.tracks) : '[]';
    const { rows } = await pool.query(
      `INSERT INTO clearances (label_id, artist_id, title, project_number, product_commitment, contractual_members, effective_date, royalty_rate, royalty_account, tracks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [req.labelId, artistId, req.body.title || null, req.body.project_number || null, req.body.product_commitment || null,
       req.body.contractual_members || null, req.body.effective_date || null, req.body.royalty_rate || null, req.body.royalty_account || null, tracks, req.user.id]
    );
    await logActivity(req, 'Created clearance', req.body.title || `#${rows[0].id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/clearances/:id
router.put('/:id', async (req, res) => {
  try {
    if (req.body.artist_id && !(await checkArtist(parseInt(req.body.artist_id, 10), req.labelId))) {
      return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const keys = Object.keys(req.body).filter(k => FIELDS.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}${k === 'tracks' ? '::jsonb' : ''}`);
    const values = keys.map(k => (k === 'tracks' ? JSON.stringify(req.body[k] || []) : (req.body[k] === '' ? null : req.body[k])));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE clearances SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/clearances/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM clearances WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Clearance not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete clearance error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/clearances/:id/download — regenerate the XLSX from saved data.
router.get('/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, a.name AS artist_name FROM clearances c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       WHERE c.id = $1 AND c.label_id = $2`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Clearance not found' });
    const c = rows[0];
    const buffer = await buildClearanceXlsx(c, c.artist_name);
    const fname = `Clearance-${(c.artist_name || 'artist').replace(/[^a-z0-9]+/gi, '-')}${c.title ? '-' + c.title.replace(/[^a-z0-9]+/gi, '-') : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Clearance download error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

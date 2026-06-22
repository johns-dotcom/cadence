const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
// Legal documents — Approver+ only. Everything scoped to req.labelId.
router.use(authMiddleware, withTenant, requireApprover);

const FIELDS = [
  'effective_date', 'artist_name', 'releasing_label', 'other_label_artist',
  'song_title', 'release_date', 'release_format', 'royalty_percent',
  'contact_email', 'signatory_name', 'signatory_title', 'custom_body',
];

// GET /api/label-waivers — all waivers for this workspace.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM label_waivers WHERE label_id = $1 ORDER BY created_at DESC, id DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List label waivers error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/label-waivers — create.
router.post('/', async (req, res) => {
  try {
    for (const k of ['artist_name', 'releasing_label', 'song_title']) {
      if (!req.body[k] || !String(req.body[k]).trim()) {
        return res.status(400).json({ success: false, error: `${k.replace('_', ' ')} is required` });
      }
    }
    const cols = FIELDS.filter(f => req.body[f] !== undefined);
    const vals = cols.map(c => (req.body[c] === '' ? null : req.body[c]));
    const placeholders = cols.map((_, i) => `$${i + 3}`);
    const { rows } = await pool.query(
      `INSERT INTO label_waivers (label_id, created_by, ${cols.join(', ')})
       VALUES ($1, $2, ${placeholders.join(', ')}) RETURNING *`,
      [req.labelId, req.user.id, ...vals]
    );
    await logActivity(req, 'Created label waiver', `${req.body.artist_name} — ${req.body.song_title}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/label-waivers/:id — update.
router.put('/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => FIELDS.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (req.body[k] === '' ? null : req.body[k]));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE label_waivers SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Waiver not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/label-waivers/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM label_waivers WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Waiver not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete label waiver error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

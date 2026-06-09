const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

const UPDATABLE = [
  'artist_name', 'genre', 'stage', 'ar_rep', 'source', 'deal_type',
  'offer_amount', 'spotify_monthly_listeners', 'last_contact_date',
  'next_followup_date', 'priority', 'notes',
];

// GET /api/deals — full pipeline for the label
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM deals WHERE label_id = $1 ORDER BY updated_at DESC',
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List deals error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/deals
router.post('/', async (req, res) => {
  try {
    const { artist_name } = req.body;
    if (!artist_name || !artist_name.trim()) {
      return res.status(400).json({ success: false, error: 'Artist name is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO deals (label_id, artist_name, genre, stage, ar_rep, source, deal_type,
        offer_amount, spotify_monthly_listeners, last_contact_date, next_followup_date, priority, notes, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,'Scouting'),$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'Medium'),$13,NOW(),NOW())
       RETURNING *`,
      [
        req.labelId, artist_name.trim(), req.body.genre || null, req.body.stage || null,
        req.body.ar_rep || null, req.body.source || null, req.body.deal_type || null,
        req.body.offer_amount || null, req.body.spotify_monthly_listeners || null,
        req.body.last_contact_date || null, req.body.next_followup_date || null,
        req.body.priority || null, req.body.notes || null,
      ]
    );
    await logActivity(req, 'Added deal', artist_name.trim());
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/deals/:id — partial update (used for stage changes + edits)
router.patch('/:id', async (req, res) => {
  try {
    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);

    const { rows } = await pool.query(
      `UPDATE deals SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Deal not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/deals/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM deals WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Deal not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete deal error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

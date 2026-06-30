const express = require('express');
const multer = require('multer');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const claude = require('../lib/claude');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
router.use(authMiddleware, withTenant);

// POST /api/campaigns/parse — AI-extract a campaign + creators from a screenshot
// of a campaign/creator dashboard. Returns extracted data for the create form.
router.post('/parse', upload.single('screenshot'), async (req, res) => {
  try {
    if (!claude.isEnabled()) return res.status(400).json({ success: false, error: 'AI is not configured on the server' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No image provided' });
    const r = await claude.parseMarketing({ buffer: req.file.buffer, mimeType: req.file.mimetype });
    if (!r.ok) return res.status(502).json({ success: false, error: r.error || 'Could not read the screenshot' });
    res.json({ success: true, data: r.data });
  } catch (error) {
    console.error('Marketing parse error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

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

// GET /api/campaigns/:id/expenses — ledger rows linked to this campaign +
// candidate unlinked rows for the same artist (for reconciliation).
router.get('/:id/expenses', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const camp = await pool.query('SELECT artist_id FROM campaigns WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!camp.rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const linked = await pool.query(
      `SELECT id, payee, amount, currency, category, invoice_date FROM expenses
       WHERE label_id = $1 AND campaign_id = $2 AND (deleted = false OR deleted IS NULL) ORDER BY invoice_date DESC NULLS LAST`,
      [req.labelId, id]
    );
    res.json({ success: true, data: { linked: linked.rows } });
  } catch (error) {
    console.error('Campaign expenses error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/campaigns/:id/link { expense_id } — attach a ledger row and refresh
// the campaign's actual_spend from the sum of its linked rows.
router.post('/:id/link', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const expenseId = parseInt(req.body.expense_id, 10);
    const camp = await pool.query('SELECT 1 FROM campaigns WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!camp.rows.length) return res.status(404).json({ success: false, error: 'Campaign not found' });
    const upd = await pool.query('UPDATE expenses SET campaign_id = $1 WHERE id = $2 AND label_id = $3 RETURNING id', [id, expenseId, req.labelId]);
    if (!upd.rows.length) return res.status(404).json({ success: false, error: 'Expense not found' });
    await recomputeSpend(id, req.labelId);
    res.json({ success: true });
  } catch (error) {
    console.error('Campaign link error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/campaigns/:id/unlink { expense_id }
router.post('/:id/unlink', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('UPDATE expenses SET campaign_id = NULL WHERE id = $1 AND campaign_id = $2 AND label_id = $3', [parseInt(req.body.expense_id, 10), id, req.labelId]);
    await recomputeSpend(id, req.labelId);
    res.json({ success: true });
  } catch (error) {
    console.error('Campaign unlink error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

async function recomputeSpend(campaignId, labelId) {
  await pool.query(
    `UPDATE campaigns SET actual_spend = COALESCE((
       SELECT SUM(amount) FROM expenses WHERE label_id = $2 AND campaign_id = $1 AND (deleted = false OR deleted IS NULL)
     ), 0), updated_at = NOW() WHERE id = $1 AND label_id = $2`,
    [campaignId, labelId]
  );
}

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

// Recording budgets — draft → approved → locked, line items by section, with
// actual-to-date pulled from the ledger (matched by the budget's artist).
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

const STATUSES = ['draft', 'approved', 'locked'];

// GET / — budgets with budgeted total + actual-to-date (USD, by artist).
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM recording_budgets WHERE label_id = $1 ORDER BY created_at DESC', [req.labelId]);
    const items = await pool.query('SELECT budget_id, amount FROM recording_budget_items WHERE label_id = $1', [req.labelId]);
    const budgetedById = {};
    items.rows.forEach(i => { budgetedById[i.budget_id] = (budgetedById[i.budget_id] || 0) + Number(i.amount || 0); });
    // Actual-to-date per artist (approved, non-voided ledger spend).
    const spend = await pool.query(
      `SELECT LOWER(artist) AS akey, amount, currency, COALESCE(payment_date, invoice_date, created_at::date) AS d
         FROM expenses WHERE label_id = $1 AND status = 'approved' AND (deleted=false OR deleted IS NULL)
           AND parent_id IS NULL AND (voided=false OR voided IS NULL) AND artist IS NOT NULL`,
      [req.labelId]
    );
    const actualByArtist = {};
    for (const r of spend.rows) actualByArtist[r.akey] = (actualByArtist[r.akey] || 0) + await toUSD(r.amount, r.currency, r.d);
    const round = (n) => Math.round((n || 0) * 100) / 100;
    const data = rows.map(b => {
      const budgeted = round((budgetedById[b.id] || 0) * (1 + Number(b.contingency_pct || 0) / 100));
      const actual = round(actualByArtist[(b.artist || '').toLowerCase()] || 0);
      return { ...b, budgeted, actual };
    });
    res.json({ success: true, data });
  } catch (error) { console.error('Budgets list error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /:id — budget + its line items.
router.get('/:id', async (req, res) => {
  try {
    const b = await pool.query('SELECT * FROM recording_budgets WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!b.rows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    const items = await pool.query('SELECT id, section, description, category, amount FROM recording_budget_items WHERE budget_id = $1 ORDER BY id', [b.rows[0].id]);
    res.json({ success: true, data: { budget: b.rows[0], items: items.rows } });
  } catch (error) { console.error('Budget detail error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.post('/', async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
    const { rows } = await pool.query(
      `INSERT INTO recording_budgets (label_id, title, artist, contingency_pct, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.labelId, title, (req.body.artist || '').trim() || null, Number(req.body.contingency_pct) || 0, (req.body.notes || '').trim() || null, req.user.name]
    );
    await logActivity(req, 'Created recording budget', title);
    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) { console.error('Create budget error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// PATCH /:id — edit header fields (blocked once locked).
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT status FROM recording_budgets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    if (cur.rows[0].status === 'locked') return res.status(400).json({ success: false, error: 'Budget is locked' });
    const { title, artist, contingency_pct, notes } = req.body;
    await pool.query(
      `UPDATE recording_budgets SET title = COALESCE($1,title), artist = COALESCE($2,artist),
         contingency_pct = COALESCE($3,contingency_pct), notes = COALESCE($4,notes) WHERE id = $5 AND label_id = $6`,
      [title ?? null, artist ?? null, contingency_pct ?? null, notes ?? null, id, req.labelId]
    );
    res.json({ success: true });
  } catch (error) { console.error('Update budget error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /:id/status { status } — lifecycle transition with audit stamps.
router.post('/:id/status', async (req, res) => {
  try {
    const status = req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ success: false, error: 'Invalid status' });
    const id = parseInt(req.params.id, 10);
    let q, params;
    if (status === 'approved') { q = `UPDATE recording_budgets SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2 AND label_id=$3 RETURNING id, status`; params = [req.user.name, id, req.labelId]; }
    else if (status === 'locked') { q = `UPDATE recording_budgets SET status='locked', locked_at=NOW() WHERE id=$1 AND label_id=$2 RETURNING id, status`; params = [id, req.labelId]; }
    else { q = `UPDATE recording_budgets SET status='draft' WHERE id=$1 AND label_id=$2 RETURNING id, status`; params = [id, req.labelId]; }
    const { rows } = await pool.query(q, params);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    await logActivity(req, `Recording budget ${status}`, `#${rows[0].id}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) { console.error('Budget status error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.delete('/:id', async (req, res) => {
  try { await pool.query('DELETE FROM recording_budgets WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Line items (blocked once locked).
router.post('/:id/items', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cur = await pool.query('SELECT status FROM recording_budgets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!cur.rows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    if (cur.rows[0].status === 'locked') return res.status(400).json({ success: false, error: 'Budget is locked' });
    const { rows } = await pool.query(
      `INSERT INTO recording_budget_items (label_id, budget_id, section, description, category, amount)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, section, description, category, amount`,
      [req.labelId, id, (req.body.section || 'Other').trim(), (req.body.description || '').trim(), (req.body.category || '').trim() || null, Number(req.body.amount) || 0]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { console.error('Add item error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});
router.delete('/items/:itemId', async (req, res) => {
  try { await pool.query('DELETE FROM recording_budget_items WHERE id = $1 AND label_id = $2', [parseInt(req.params.itemId, 10), req.labelId]); res.json({ success: true }); }
  catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

module.exports = router;

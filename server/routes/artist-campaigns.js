// Artist Campaigns hub — per-artist marketing-spend reconciliation. "Campaign
// spend" = expenses explicitly flagged artist_campaign = TRUE, or (when the
// flag is NULL) auto-detected from a marketing-ish category. Explicitly
// setting artist_campaign = FALSE removes a row ("not campaign").
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');
const { recordMentions } = require('../lib/mentions');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// The campaign predicate (shared across queries). Parent rows only for totals;
// children carry their own slices and are pulled per-artist in the detail.
const CAMPAIGN_WHERE = `(
  e.artist_campaign = TRUE
  OR (e.artist_campaign IS NULL AND e.category IS NOT NULL AND LOWER(e.category) ~ 'market|advertis|promo|influenc|public|social')
)`;

// GET /api/artist-campaigns — per-artist campaign spend index.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.artist, e.amount, e.currency, e.cobrand,
              COALESCE(e.payment_date, e.invoice_date, e.created_at::date) AS d
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'approved' AND (e.deleted = false OR e.deleted IS NULL)
          AND (e.voided = false OR e.voided IS NULL) AND e.parent_id IS NULL
          AND e.artist IS NOT NULL AND e.artist <> '' AND ${CAMPAIGN_WHERE}`,
      [req.labelId]
    );
    const by = {};
    for (const r of rows) {
      const k = r.artist;
      const usd = await toUSD(r.amount, r.currency, r.d);
      by[k] = by[k] || { artist: k, spend: 0, cobrand: 0, count: 0 };
      by[k].spend += usd; by[k].count++;
      if (r.cobrand) by[k].cobrand += usd;
    }
    const round = (n) => Math.round((n || 0) * 100) / 100;
    const data = Object.values(by).map(a => ({ ...a, spend: round(a.spend), cobrand: round(a.cobrand) })).sort((a, b) => b.spend - a.spend);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Artist campaigns index error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/artist-campaigns/review-inbox — entries assigned to the current user.
// MUST be registered before '/:artist' or Express matches it as artist="review-inbox".
router.get('/review-inbox', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.artist, e.song, e.amount, e.currency,
              (SELECT COUNT(*)::int FROM expense_comments c WHERE c.expense_id = e.id) AS comments
         FROM review_assignments ra JOIN expenses e ON e.id = ra.expense_id
        WHERE ra.label_id = $1 AND ra.assignee_id = $2 AND (e.deleted = false OR e.deleted IS NULL)
        ORDER BY ra.created_at DESC`,
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/artist-campaigns/:artist — one artist's campaign entries (song-
// groupable) + category breakdown + cobrand rollup.
router.get('/:artist', async (req, res) => {
  try {
    const artist = req.params.artist;
    const { rows } = await pool.query(
      `SELECT e.id, e.payee, e.song, e.category, e.amount, e.currency, e.cobrand, e.payment_status,
              e.invoice_date, e.payment_date, e.invoice_r2_key IS NOT NULL AS has_invoice, e.created_at
         FROM expenses e
        WHERE e.label_id = $1 AND e.status = 'approved' AND (e.deleted = false OR e.deleted IS NULL)
          AND (e.voided = false OR e.voided IS NULL) AND LOWER(e.artist) = LOWER($2)
          AND e.parent_id IS NULL AND ${CAMPAIGN_WHERE}
        ORDER BY LOWER(COALESCE(e.song,'')), COALESCE(e.payment_date, e.invoice_date, e.created_at::date) DESC`,
      [req.labelId, artist]
    );
    let total = 0, cobrand = 0; const byCat = {}; const entries = [];
    for (const r of rows) {
      const usd = await toUSD(r.amount, r.currency, r.payment_date || r.invoice_date || r.created_at);
      total += usd; if (r.cobrand) cobrand += usd;
      byCat[r.category || 'Uncategorized'] = (byCat[r.category || 'Uncategorized'] || 0) + usd;
      entries.push({ ...r, amount_usd: Math.round(usd * 100) / 100 });
    }
    const round = (n) => Math.round((n || 0) * 100) / 100;
    res.json({ success: true, data: {
      artist, entries,
      categories: Object.entries(byCat).map(([category, total]) => ({ category, total: round(total) })).sort((a, b) => b.total - a.total),
      totals: { spend: round(total), cobrand: round(cobrand) },
    } });
  } catch (error) {
    console.error('Artist campaign detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/artist-campaigns/entries/:id/flags — toggle cobrand / campaign
// inclusion on one expense. { cobrand?: bool, artist_campaign?: bool|null }
router.post('/entries/:id/flags', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const sets = [], vals = [];
    if (req.body.cobrand !== undefined) { sets.push(`cobrand = $${sets.length + 1}`); vals.push(!!req.body.cobrand); }
    if ('artist_campaign' in req.body) { sets.push(`artist_campaign = $${sets.length + 1}`); vals.push(req.body.artist_campaign === null ? null : !!req.body.artist_campaign); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    vals.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE expenses SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND label_id = $${vals.length} RETURNING id, cobrand, artist_campaign`,
      vals
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Campaign flags error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Collaboration: comments + reviewer assignments ────────────────────────

// GET /api/artist-campaigns/entries/:id/comments
router.get('/entries/:id/comments', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, author, body, created_at FROM expense_comments WHERE label_id = $1 AND expense_id = $2 ORDER BY created_at',
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/artist-campaigns/entries/:id/comments { body }
router.post('/entries/:id/comments', async (req, res) => {
  try {
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ success: false, error: 'Comment is empty' });
    const expenseId = parseInt(req.params.id, 10);
    const { rows } = await pool.query(
      'INSERT INTO expense_comments (label_id, expense_id, author, body) VALUES ($1,$2,$3,$4) RETURNING id, author, body, created_at',
      [req.labelId, expenseId, req.user.name, body]
    );
    try { await recordMentions({ labelId: req.labelId, actorId: req.user.id, body, source: 'expense_comment', sourceId: expenseId, link: '/artist-campaigns' }); } catch (e) { /* best-effort */ }
    res.status(201).json({ success: true, data: rows[0] });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// GET /api/artist-campaigns/entries/:id/reviewers → assigned users
router.get('/entries/:id/reviewers', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ra.assignee_id, u.name FROM review_assignments ra JOIN users u ON u.id = ra.assignee_id
        WHERE ra.label_id = $1 AND ra.expense_id = $2 ORDER BY u.name`,
      [req.labelId, parseInt(req.params.id, 10)]
    );
    res.json({ success: true, data: rows });
  } catch { res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// POST /api/artist-campaigns/entries/:id/reviewers { user_ids } — replace set.
router.post('/entries/:id/reviewers', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const ids = Array.isArray(req.body.user_ids) ? req.body.user_ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    await client.query('BEGIN');
    await client.query('DELETE FROM review_assignments WHERE label_id = $1 AND expense_id = $2', [req.labelId, id]);
    for (const uid of ids) {
      await client.query(
        `INSERT INTO review_assignments (label_id, expense_id, assignee_id, assigned_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (label_id, expense_id, assignee_id) DO NOTHING`,
        [req.labelId, id, uid, req.user.name]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally { client.release(); }
});

module.exports = router;

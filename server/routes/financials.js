const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');

const router = express.Router();
// Financials are privileged — approvers and up. Every query is label-scoped.
router.use(authMiddleware, withTenant, requireApprover);

// Map a period keyword to a SQL lower bound (NULL = all time).
function periodStart(period) {
  switch (period) {
    case 'month': return "date_trunc('month', CURRENT_DATE)";
    case 'quarter': return "date_trunc('quarter', CURRENT_DATE)";
    case 'year': return "date_trunc('year', CURRENT_DATE)";
    default: return null;
  }
}

// GET /api/financials/summary?period=month|quarter|year|all — P&L overview.
router.get('/summary', async (req, res) => {
  try {
    const start = periodStart(req.query.period);
    const expClause = start ? `AND COALESCE(invoice_date, created_at::date) >= ${start}` : '';
    const incClause = start ? `AND income_date >= ${start}` : '';

    // Pull raw rows (amount + currency + date) and roll up in USD via FX, so
    // multi-currency ledgers/income aggregate correctly. Excludes split-child
    // and voided rows from totals.
    const [expRows, incRows] = await Promise.all([
      pool.query(
        `SELECT COALESCE(category,'Uncategorized') AS category, amount, currency,
                COALESCE(payment_date, invoice_date, created_at::date) AS fx_date
         FROM expenses
         WHERE label_id = $1 AND status = 'approved' AND (deleted = false OR deleted IS NULL)
           AND parent_id IS NULL AND (voided = false OR voided IS NULL) ${expClause}`,
        [req.labelId]
      ),
      pool.query(
        `SELECT COALESCE(source,'Other') AS source, amount, currency, income_date AS fx_date
         FROM artist_income WHERE label_id = $1 ${incClause}`,
        [req.labelId]
      ),
    ]);

    const byCat = {}; let expenses = 0;
    for (const r of expRows.rows) {
      const usd = await toUSD(r.amount, r.currency, r.fx_date);
      byCat[r.category] = (byCat[r.category] || 0) + usd;
      expenses += usd;
    }
    const bySource = {}; let income = 0;
    for (const r of incRows.rows) {
      const usd = await toUSD(r.amount, r.currency, r.fx_date);
      bySource[r.source] = (bySource[r.source] || 0) + usd;
      income += usd;
    }
    const toSorted = (obj, key) => Object.entries(obj).map(([k, v]) => ({ [key]: k, total: Math.round(v * 100) / 100 })).sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      data: {
        currency: 'USD',
        income: Math.round(income * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
        net: Math.round((income - expenses) * 100) / 100,
        expenseByCategory: toSorted(byCat, 'category'),
        incomeBySource: toSorted(bySource, 'source'),
      },
    });
  } catch (error) {
    console.error('Financials summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments — per-artist recoupable spend vs income.
router.get('/recoupments', async (req, res) => {
  try {
    const [artists, spendRows, incRows] = await Promise.all([
      pool.query('SELECT id, name FROM artists WHERE label_id = $1 ORDER BY name', [req.labelId]),
      pool.query(
        `SELECT LOWER(e.artist) AS akey, e.amount, e.currency,
                COALESCE(e.payment_date, e.invoice_date, e.created_at::date) AS fx_date
         FROM expenses e
         WHERE e.label_id = $1 AND e.recoupable = TRUE AND e.status = 'approved'
           AND (e.deleted = false OR e.deleted IS NULL) AND e.parent_id IS NULL AND (e.voided = false OR e.voided IS NULL)`,
        [req.labelId]
      ),
      pool.query('SELECT artist_id, amount, currency, income_date AS fx_date FROM artist_income WHERE label_id = $1', [req.labelId]),
    ]);

    // Roll up recoupable spend (by artist name) and income (by artist_id) in USD.
    const spendByName = {};
    for (const r of spendRows.rows) {
      if (!r.akey) continue;
      spendByName[r.akey] = (spendByName[r.akey] || 0) + await toUSD(r.amount, r.currency, r.fx_date);
    }
    const incById = {};
    for (const r of incRows.rows) {
      if (!r.artist_id) continue;
      incById[r.artist_id] = (incById[r.artist_id] || 0) + await toUSD(r.amount, r.currency, r.fx_date);
    }

    const round = (n) => Math.round((n || 0) * 100) / 100;
    const data = artists.rows.map(a => {
      const spend = round(spendByName[a.name.toLowerCase()]);
      const income = round(incById[a.id]);
      return { artist_id: a.id, name: a.name, currency: 'USD', recoupable_spend: spend, income, balance: round(income - spend), recouped: income >= spend && spend > 0 };
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Recoupments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Statement month for a date: cutoff day 20 — on day >= 21 it rolls to next
// month (shared rule; a UFR mark stamped on the 22nd lands next month).
function statementMonthFor(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return null;
  let m = d.getMonth(), y = d.getFullYear();
  if (d.getDate() >= 21) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// GET /api/financials/recoupments/:artistId — one artist's recoupable ledger
// entries (for song grouping) + income + totals, in USD.
router.get('/recoupments/:artistId', async (req, res) => {
  try {
    const artistId = parseInt(req.params.artistId, 10);
    const a = await pool.query('SELECT id, name FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
    if (!a.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const name = a.rows[0].name;

    const [spend, income] = await Promise.all([
      pool.query(
        `SELECT id, payee, song, category, amount, currency, invoice_date, payment_date, payment_status,
                ufr, ufr_marked_at, created_at
           FROM expenses
          WHERE label_id = $1 AND recoupable = TRUE AND status = 'approved'
            AND LOWER(artist) = LOWER($2) AND (deleted = false OR deleted IS NULL)
            AND parent_id IS NULL AND (voided = false OR voided IS NULL)
          ORDER BY COALESCE(payment_date, invoice_date, created_at::date) DESC`,
        [req.labelId, name]
      ),
      pool.query('SELECT id, amount, currency, income_date, source FROM artist_income WHERE label_id = $1 AND artist_id = $2 ORDER BY income_date DESC', [req.labelId, artistId]),
    ]);

    let spendUsd = 0;
    const entries = [];
    for (const r of spend.rows) {
      const usd = await toUSD(r.amount, r.currency, r.payment_date || r.invoice_date || r.created_at);
      spendUsd += usd;
      entries.push({ ...r, amount_usd: Math.round(usd * 100) / 100, statement_month: r.ufr ? statementMonthFor(r.ufr_marked_at) : null });
    }
    let incUsd = 0;
    for (const r of income.rows) incUsd += await toUSD(r.amount, r.currency, r.income_date);
    const round = (n) => Math.round((n || 0) * 100) / 100;

    res.json({ success: true, data: {
      artist: { id: artistId, name },
      entries,
      income: income.rows,
      totals: { recoupable_spend: round(spendUsd), income: round(incUsd), balance: round(incUsd - spendUsd), recouped: incUsd >= spendUsd && spendUsd > 0 },
    } });
  } catch (error) {
    console.error('Recoupment detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/:id/ufr { ufr } — toggle the statement mark.
router.post('/recoupments/:id/ufr', async (req, res) => {
  try {
    const on = req.body.ufr !== false;
    const { rows } = await pool.query(
      `UPDATE expenses SET ufr = $1, ufr_marked_at = CASE WHEN $1 THEN NOW() ELSE NULL END
        WHERE id = $2 AND label_id = $3 RETURNING id, ufr, ufr_marked_at`,
      [on, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: { ...rows[0], statement_month: rows[0].ufr ? statementMonthFor(rows[0].ufr_marked_at) : null } });
  } catch (error) {
    console.error('UFR toggle error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/add-expense — add a recoupable expense to an
// artist straight from Recoupments (auto-approved, recoupable, source-stamped).
router.post('/recoupments/add-expense', async (req, res) => {
  try {
    const b = req.body;
    const amount = parseFloat(b.amount);
    if (!b.artist || !amount || amount <= 0) return res.status(400).json({ success: false, error: 'Artist and a valid amount are required' });
    const { rows } = await pool.query(
      `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, song, amount, currency,
         status, payment_status, recoupable, entry_source, created_by, created_at)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, COALESCE($8,'USD'), 'approved', 'Unpaid', TRUE, 'recoupment', $9, NOW())
       RETURNING id`,
      [req.labelId, (b.payee || b.description || 'Recoupable expense').trim(), (b.description || '').trim() || null,
       (b.category || '').trim() || null, b.artist.trim(), (b.song || '').trim() || null, amount, (b.currency || 'USD').trim(), req.user.name]
    );
    await logActivity(req, 'Added recoupable expense', `${b.artist} — ${amount}`);
    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error('Add recoupable expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Artist income entries ────────────────────────────────────────────────

// GET /api/financials/income
router.get('/income', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, a.name AS artist_name FROM artist_income i
       LEFT JOIN artists a ON a.id = i.artist_id AND a.label_id = i.label_id
       WHERE i.label_id = $1 ORDER BY i.income_date DESC, i.id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/income
router.post('/income', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A valid amount is required' });
    let artistId = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
    if (artistId) {
      const owner = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
      if (!owner.rows.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const { rows } = await pool.query(
      `INSERT INTO artist_income (label_id, artist_id, source, description, amount, currency, income_date, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),COALESCE($7,CURRENT_DATE),$8) RETURNING *`,
      [req.labelId, artistId, req.body.source || null, req.body.description || null, amount, req.body.currency || null, req.body.income_date || null, req.user.id]
    );
    await logActivity(req, 'Added income', `${req.body.source || 'income'} — ${amount}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/financials/income/:id
router.delete('/income/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM artist_income WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Income entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

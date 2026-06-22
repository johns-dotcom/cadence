const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

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

    const [expenseByCat, incomeBySource, totals] = await Promise.all([
      pool.query(
        `SELECT COALESCE(category, 'Uncategorized') AS category, SUM(amount)::numeric AS total
         FROM expenses
         WHERE label_id = $1 AND status = 'approved' AND (deleted = false OR deleted IS NULL) ${expClause}
         GROUP BY category ORDER BY total DESC`,
        [req.labelId]
      ),
      pool.query(
        `SELECT COALESCE(source, 'Other') AS source, SUM(amount)::numeric AS total
         FROM artist_income WHERE label_id = $1 ${incClause}
         GROUP BY source ORDER BY total DESC`,
        [req.labelId]
      ),
      pool.query(
        `SELECT
           (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE label_id = $1 AND status='approved' AND (deleted=false OR deleted IS NULL) ${expClause}) AS expenses,
           (SELECT COALESCE(SUM(amount),0) FROM artist_income WHERE label_id = $1 ${incClause}) AS income`,
        [req.labelId]
      ),
    ]);

    const income = Number(totals.rows[0].income || 0);
    const expenses = Number(totals.rows[0].expenses || 0);
    res.json({
      success: true,
      data: {
        income, expenses, net: income - expenses,
        expenseByCategory: expenseByCat.rows.map(r => ({ ...r, total: Number(r.total) })),
        incomeBySource: incomeBySource.rows.map(r => ({ ...r, total: Number(r.total) })),
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
    const { rows } = await pool.query(
      `SELECT a.id AS artist_id, a.name,
              COALESCE(spend.total, 0)::numeric AS recoupable_spend,
              COALESCE(inc.total, 0)::numeric AS income
       FROM artists a
       LEFT JOIN (
         SELECT ar.id AS artist_id, SUM(e.amount) AS total
         FROM artists ar
         JOIN expenses e ON e.label_id = ar.label_id AND LOWER(e.artist) = LOWER(ar.name)
           AND e.recoupable = TRUE AND e.status = 'approved' AND (e.deleted = false OR e.deleted IS NULL)
         WHERE ar.label_id = $1 GROUP BY ar.id
       ) spend ON spend.artist_id = a.id
       LEFT JOIN (
         SELECT artist_id, SUM(amount) AS total FROM artist_income WHERE label_id = $1 GROUP BY artist_id
       ) inc ON inc.artist_id = a.id
       WHERE a.label_id = $1
       ORDER BY a.name`,
      [req.labelId]
    );
    const data = rows.map(r => {
      const spend = Number(r.recoupable_spend);
      const income = Number(r.income);
      return { artist_id: r.artist_id, name: r.name, recoupable_spend: spend, income, balance: income - spend, recouped: income >= spend && spend > 0 };
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Recoupments error:', error);
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

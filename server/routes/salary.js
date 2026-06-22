const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
// Payroll is admin-only. Everything is label-scoped.
router.use(authMiddleware, withTenant, requireAdmin);

// GET /api/salary?month=&year= — roster joined with that month's paid status.
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.department, e.monthly_amount, e.currency, e.active,
              p.paid, p.paid_at, p.amount AS paid_amount
       FROM salary_employees e
       LEFT JOIN salary_payments p ON p.employee_id = e.id AND p.month = $2 AND p.year = $3 AND p.label_id = e.label_id
       WHERE e.label_id = $1 AND e.active = TRUE
       ORDER BY e.department NULLS LAST, e.name`,
      [req.labelId, month, year]
    );
    res.json({ success: true, data: { month, year, employees: rows } });
  } catch (error) {
    console.error('List salary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/salary/history — recent paid/marked actions across the roster.
router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.month, p.year, p.paid, p.amount, p.paid_at, e.name AS employee, u.name AS marked_by
       FROM salary_payments p
       JOIN salary_employees e ON e.id = p.employee_id AND e.label_id = p.label_id
       LEFT JOIN users u ON u.id = p.marked_by AND u.label_id = p.label_id
       WHERE p.label_id = $1 AND p.paid_at IS NOT NULL
       ORDER BY p.paid_at DESC LIMIT 100`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Salary history error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/salary/employees — add to the payroll roster.
router.post('/employees', async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO salary_employees (label_id, name, department, monthly_amount, currency)
       VALUES ($1,$2,$3,$4,COALESCE($5,'USD')) RETURNING *`,
      [req.labelId, name, req.body.department || null, parseFloat(req.body.monthly_amount) || 0, req.body.currency || null]
    );
    await logActivity(req, 'Added employee', name);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/salary/employees/:id — edit roster entry / deactivate.
router.patch('/employees/:id', async (req, res) => {
  try {
    const fields = ['name', 'department', 'monthly_amount', 'currency', 'active'];
    const keys = Object.keys(req.body).filter(k => fields.includes(k));
    if (!keys.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE salary_employees SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/salary/:employeeId/pay — toggle paid status for a month (upsert).
router.put('/:employeeId/pay', async (req, res) => {
  try {
    const employeeId = parseInt(req.params.employeeId, 10);
    const month = parseInt(req.body.month, 10);
    const year = parseInt(req.body.year, 10);
    const paid = !!req.body.paid;
    if (!month || !year) return res.status(400).json({ success: false, error: 'Month and year are required' });
    // Re-validate the employee belongs to this label.
    const emp = await pool.query('SELECT monthly_amount FROM salary_employees WHERE id = $1 AND label_id = $2', [employeeId, req.labelId]);
    if (!emp.rows.length) return res.status(404).json({ success: false, error: 'Employee not found' });
    const { rows } = await pool.query(
      `INSERT INTO salary_payments (label_id, employee_id, month, year, paid, amount, paid_at, marked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employee_id, month, year)
       DO UPDATE SET paid = EXCLUDED.paid, paid_at = EXCLUDED.paid_at, marked_by = EXCLUDED.marked_by
       RETURNING *`,
      [req.labelId, employeeId, month, year, paid, emp.rows[0].monthly_amount, paid ? new Date() : null, req.user.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Salary pay error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { CURRENCIES } = require('../lib/constants');

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
       ORDER BY e.department NULLS LAST, e.monthly_amount DESC NULLS LAST, e.name`,
      [req.labelId, month, year]
    );
    res.json({ success: true, data: { month, year, employees: rows } });
  } catch (error) {
    console.error('List salary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/salary/history?month=&year= — the payroll audit trail.
//
// Reads `salary_payment_history`, NOT `salary_payments`. The payments table holds
// one CURRENT row per (employee, month): un-marking a payment nulls `paid_at`, so
// deriving history from it silently erased the record it was meant to prove and
// could never show an unmark at all. The history table appends both actions.
//
// Scoped to a month when one is given (the page asks per visible month), global
// otherwise.
router.get('/history', async (req, res) => {
  try {
    const month = parseInt(req.query.month, 10);
    const year = parseInt(req.query.year, 10);
    const params = [req.labelId];
    let where = 'h.label_id = $1';
    if (Number.isInteger(month) && Number.isInteger(year)) {
      params.push(month, year);
      where += ` AND h.month = $${params.length - 1} AND h.year = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT h.id, h.month, h.year, h.action, h.amount, h.performed_at,
              e.name AS employee, u.name AS performed_by
       FROM salary_payment_history h
       JOIN salary_employees e ON e.id = h.employee_id AND e.label_id = h.label_id
       LEFT JOIN users u ON u.id = h.performed_by AND u.label_id = h.label_id
       WHERE ${where}
       ORDER BY h.performed_at DESC LIMIT 100`,
      params
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
    // Same rules PATCH enforces, so a row can't be created in a state the editor
    // would refuse to save.
    const amount = req.body.monthly_amount === undefined || req.body.monthly_amount === '' ? 0 : parseFloat(req.body.monthly_amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ success: false, error: 'Monthly amount must be zero or more' });
    }
    if (req.body.currency && !CURRENCIES.includes(req.body.currency)) {
      return res.status(400).json({ success: false, error: 'Invalid currency' });
    }
    const { rows } = await pool.query(
      `INSERT INTO salary_employees (label_id, name, department, monthly_amount, currency)
       VALUES ($1,$2,$3,$4,COALESCE($5,'USD')) RETURNING *`,
      [req.labelId, name, String(req.body.department || '').trim() || null, amount, req.body.currency || null]
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

    // Field validation. Unreachable while there was no edit UI, which is why it
    // was missing; with one, a blank name makes a row unidentifiable on a payroll
    // sheet and a negative amount silently reduces the department subtotal.
    if (keys.includes('name') && !String(req.body.name || '').trim()) {
      return res.status(400).json({ success: false, error: 'Name cannot be blank' });
    }
    if (keys.includes('monthly_amount')) {
      const n = parseFloat(req.body.monthly_amount);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ success: false, error: 'Monthly amount must be zero or more' });
      }
    }
    if (keys.includes('currency') && req.body.currency && !CURRENCIES.includes(req.body.currency)) {
      return res.status(400).json({ success: false, error: 'Invalid currency' });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (
      k === 'name' ? String(req.body.name).trim()
        : k === 'monthly_amount' ? parseFloat(req.body.monthly_amount)
          : k === 'department' ? (String(req.body.department || '').trim() || null)
            : req.body[k]
    ));
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE salary_employees SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Employee not found' });
    await logActivity(req, 'Updated employee', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/salary/employees/:id — SOFT delete (active = false).
// Never a hard delete: salary_payments and salary_payment_history both cascade
// off this row, so removing someone who left in March would erase the record of
// paying them in January.
router.delete('/employees/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'Employee not found' });
    const { rows } = await pool.query(
      'UPDATE salary_employees SET active = FALSE WHERE id = $1 AND label_id = $2 RETURNING id, name',
      [id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Employee not found' });
    await logActivity(req, 'Removed employee', rows[0].name);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete employee error:', error);
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
       DO UPDATE SET paid = EXCLUDED.paid, amount = EXCLUDED.amount,
                     paid_at = EXCLUDED.paid_at, marked_by = EXCLUDED.marked_by
       RETURNING *`,
      // `amount` is re-stamped on every mark: without it, a salary raised in March
      // kept re-marking April at the old figure, so the stored paid amount drifted
      // from the roster it was copied from.
      [req.labelId, employeeId, month, year, paid, emp.rows[0].monthly_amount, paid ? new Date() : null, req.user.id]
    );
    // Append to the audit trail — the payments row above is current-state only.
    await pool.query(
      `INSERT INTO salary_payment_history (label_id, employee_id, month, year, action, amount, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.labelId, employeeId, month, year, paid ? 'marked_paid' : 'marked_unpaid', emp.rows[0].monthly_amount, req.user.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Salary pay error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

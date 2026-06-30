const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { sendEmail, taskAssignmentEmail } = require('../lib/email');

const router = express.Router();
router.use(authMiddleware, withTenant);

const isAdmin = (req) => ['Superadmin', 'Admin'].includes(req.user.role);

// Best-effort email to a newly-assigned member.
async function notifyAssignee(req, assigneeId, task) {
  try {
    const { rows } = await pool.query(
      `SELECT u.name, u.email, l.name AS workspace FROM users u JOIN labels l ON l.id = u.label_id
       WHERE u.id = $1 AND u.label_id = $2`,
      [assigneeId, req.labelId]
    );
    const a = rows[0];
    if (!a?.email) return;
    const origin = process.env.FRONTEND_URL || req.headers.origin || '';
    const msg = taskAssignmentEmail({
      assigneeName: a.name, workspaceName: a.workspace, description: task.description,
      dueDate: task.due_date ? String(task.due_date).slice(0, 10) : null, priority: task.priority,
      assignerName: req.user.name, link: origin ? `${origin.replace(/\/$/, '')}/my-work` : null,
    });
    await sendEmail({ to: a.email, subject: msg.subject, html: msg.html, text: msg.text });
  } catch (_) { /* best-effort */ }
}

// GET /api/tasks — by default the caller's own tasks. Admins can pass
// ?scope=all to see the whole workspace, or ?user_id= to filter.
router.get('/', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = 't.label_id = $1';

    if (isAdmin(req) && req.query.scope === 'all') {
      // no extra filter — whole workspace
    } else if (isAdmin(req) && req.query.user_id) {
      params.push(parseInt(req.query.user_id, 10));
      where += ` AND t.user_id = $${params.length}`;
    } else {
      params.push(req.user.id);
      where += ` AND t.user_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT t.*, u.name AS assignee_name, b.name AS assigner_name, r.project_name AS release_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
       LEFT JOIN users b ON b.id = t.assigned_by AND b.label_id = t.label_id
       LEFT JOIN releases r ON r.id = t.release_id AND r.label_id = t.label_id
       WHERE ${where}
       ORDER BY (t.status = 'Done'), t.due_date NULLS LAST, t.created_at DESC`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List tasks error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/tasks — create a task. Non-admins can only create for themselves;
// admins may assign to any member of the workspace.
router.post('/', async (req, res) => {
  try {
    const { description, priority, status, due_date, release_id } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, error: 'Description is required' });
    }

    let assigneeId = req.user.id;
    if (req.body.user_id && isAdmin(req)) {
      const { rows: u } = await pool.query('SELECT 1 FROM users WHERE id = $1 AND label_id = $2', [req.body.user_id, req.labelId]);
      if (!u.length) return res.status(400).json({ success: false, error: 'Assignee not found in this workspace' });
      assigneeId = parseInt(req.body.user_id, 10);
    }

    if (release_id) {
      const { rows: r } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [release_id, req.labelId]);
      if (!r.length) return res.status(400).json({ success: false, error: 'Release not found in this workspace' });
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (label_id, user_id, assigned_by, description, priority, status, due_date, release_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,'Medium'),COALESCE($6,'To Do'),$7,$8,NOW(),NOW())
       RETURNING *`,
      [req.labelId, assigneeId, req.user.id, description.trim(), priority || null, status || null, due_date || null, release_id || null]
    );
    if (assigneeId !== req.user.id) {
      await logActivity(req, 'Assigned task', description.trim());
      notifyAssignee(req, assigneeId, rows[0]); // best-effort, fire-and-forget
    }
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const UPDATABLE = ['description', 'priority', 'status', 'due_date', 'release_id'];

// PATCH /api/tasks/:id — the assignee or an admin can update.
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: existing } = await pool.query('SELECT user_id FROM tasks WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Task not found' });
    if (existing[0].user_id !== req.user.id && !isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Not your task' });
    }

    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0) return res.status(400).json({ success: false, error: 'No updatable fields provided' });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => req.body[k]);
    values.push(id, req.labelId);

    const { rows } = await pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id — assignee or admin.
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: existing } = await pool.query('SELECT user_id FROM tasks WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Task not found' });
    if (existing[0].user_id !== req.user.id && !isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Not your task' });
    }
    await pool.query('DELETE FROM tasks WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

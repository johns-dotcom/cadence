const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { sendEmail, taskAssignmentEmail } = require('../lib/email');
// TASK_PRIORITIES, not PRIORITIES: tasks carry an 'Urgent' level that releases and
// deals deliberately do not (lib/constants.js).
const { TASK_STATUSES, TASK_PRIORITIES } = require('../lib/constants');

const router = express.Router();
router.use(authMiddleware, withTenant);

const isAdmin = (req) => ['Superadmin', 'Admin'].includes(req.user.role);

const NOTES_MAX = 5000;
const CATEGORY_MAX = 60;

// Trim-and-cap a free-text field. Returns null for blank so the column stays NULL
// rather than holding an empty string (group-by treats NULL as "Uncategorized").
const text = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const isLead = (req) => ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);

// The ONE task projection. Every route that returns a task must use it: the client
// merges server rows over its local copies, and a spread that's missing a key leaves
// the stale value behind — so a bare `RETURNING *` would make a newly created task
// show "Unassigned" and (because canEditTask reads assignee_department) go read-only
// until the next full load.
const TASK_SELECT = `
  SELECT t.*, u.name AS assignee_name, u.department AS assignee_department,
         b.name AS assigner_name, r.project_name AS release_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
    LEFT JOIN users b ON b.id = t.assigned_by AND b.label_id = t.label_id
    LEFT JOIN releases r ON r.id = t.release_id AND r.label_id = t.label_id`;

async function selectTask(labelId, id) {
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id = $1 AND t.label_id = $2`, [id, labelId]);
  return rows[0] || null;
}

async function selectTasks(labelId, ids) {
  if (!ids.length) return [];
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.label_id = $1 AND t.id = ANY($2::int[])`, [labelId, ids]);
  return rows;
}

/**
 * The single source of truth for "whose tasks may I see on Team Work".
 *
 *   Superadmin / Admin → the whole workspace
 *   Approver          → their own users.department
 *   everyone else     → nothing (null; the caller must 403)
 *
 * Returns a SQL fragment to append (possibly '') or null to refuse. Pushes onto
 * `params`, so call it while building the query.
 *
 * Deliberately NOT implemented by widening isAdmin(): that would hand Approvers
 * the entire workspace and defeat department scoping. And deliberately failing
 * closed on a missing department — an Approver with no department gets a 403
 * rather than a bare `department = NULL` comparison, which would match no rows
 * while the UI implied success.
 */
function teamFilter(req, params) {
  if (!isLead(req)) return null;
  if (isAdmin(req)) return '';
  if (!req.user.department) return null;
  params.push(req.user.department);
  return ` AND u.department = $${params.length}`;
}

/**
 * May the caller mutate this task? Own task · admin · or an Approver whose
 * department matches the task OWNER's department.
 *
 * This is a real widening of the old "assignee or admin" rule — a department lead
 * has to be able to rebalance their team's work or /team-work is read-only. The
 * cost is that `department` is now a permission boundary, which is why it is
 * validated and session-invalidating in routes/team.js.
 *
 * One helper for PATCH / DELETE / reorder / reassign so the four cannot drift.
 */
async function canMutateTask(req, taskId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.user_id, t.description, u.department, u.role AS owner_role
       FROM tasks t
       LEFT JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
      WHERE t.id = $1 AND t.label_id = $2`,
    [taskId, req.labelId]
  );
  if (!rows.length) return { ok: false, code: 404, error: 'Task not found' };
  const task = rows[0];
  const own = task.user_id === req.user.id;
  if (own || isAdmin(req)) return { ok: true, task, own };
  // Unassigned tasks have no department to match, so they stay admin-only.
  // An Approver also can't reach DOWNWARD-only: a lead editing or deleting an
  // Admin/Superadmin's task would be a privilege inversion, even same-department.
  if (req.user.role === 'Approver' && req.user.department
      && task.department === req.user.department
      && !['Superadmin', 'Admin'].includes(task.owner_role)) {
    return { ok: true, task, own: false };
  }
  return { ok: false, code: 403, error: 'Not your task' };
}

/**
 * May the caller assign a task TO this user? Admin → anyone in the workspace;
 * Approver → their own department only, so a lead can rebalance within their team
 * but never push work into another department.
 */
async function canAssignTo(req, userId) {
  const { rows } = await pool.query(
    'SELECT id, department FROM users WHERE id = $1 AND label_id = $2',
    [userId, req.labelId]
  );
  if (!rows.length) return { ok: false, code: 400, error: 'Assignee not found in this workspace' };
  if (isAdmin(req)) return { ok: true };
  if (req.user.role === 'Approver' && req.user.department && rows[0].department === req.user.department) {
    return { ok: true };
  }
  return { ok: false, code: 403, error: 'Cannot assign outside your department' };
}

// The widened gate means a lead can now touch work they do not own, so record it.
// Own-task edits are routine and deliberately NOT logged — the trail exists to
// capture the widening, not to narrate everyone's day.
function logCrossUserMutation(req, action, task) {
  if (task.user_id === req.user.id) return;
  // Not awaited — logActivity swallows its own errors by contract.
  logActivity(req, action, `${task.description || `Task #${task.id}`} (owner user #${task.user_id ?? '—'})`);
}

/**
 * Notify a newly-assigned member — or hand the caller a payload to preview first.
 *
 * `notify` in the request body picks the mode, defaulting to the historical
 * fire-and-forget send so every non-UI caller keeps working unchanged:
 *   'preview' → send nothing; return { kind, ctx } for EmailPreviewModal, which
 *               posts it to /api/email/send with the admin's edits applied
 *   'none'    → send nothing, return nothing
 *   (default) → send in the background, return nothing
 *
 * The single SELECT is awaited (it's indexed and tiny); only the SMTP round-trip
 * stays off the response path.
 */
async function notifyAssignee(req, assigneeId, task) {
  try {
    const { rows } = await pool.query(
      `SELECT u.name, u.email, l.name AS workspace FROM users u JOIN labels l ON l.id = u.label_id
       WHERE u.id = $1 AND u.label_id = $2`,
      [assigneeId, req.labelId]
    );
    const a = rows[0];
    if (!a?.email) return null;
    const mode = req.body?.notify;
    if (mode === 'none') return null;

    const origin = process.env.FRONTEND_URL || req.headers.origin || '';
    // Exactly the shape emailDispatch's `task_assigned` template consumes, so the
    // preview the admin edits is the email that gets sent.
    const ctx = {
      to: a.email,
      assigneeName: a.name, workspaceName: a.workspace, description: task.description,
      dueDate: task.due_date ? String(task.due_date).slice(0, 10) : null, priority: task.priority,
      assignerName: req.user.name, link: origin ? `${origin.replace(/\/$/, '')}/my-work` : null,
    };
    if (mode === 'preview') return { kind: 'task_assigned', ctx };

    const msg = taskAssignmentEmail(ctx);
    sendEmail({ to: a.email, subject: msg.subject, html: msg.html, text: msg.text }).catch(() => {});
    return null;
  } catch (_) { return null; /* best-effort */ }
}

// GET /api/tasks — by default the caller's own tasks (/my-work).
//   ?scope=team → Team Work: whole workspace for admins, own department for an
//                 Approver, 403 for anyone else. See teamFilter().
//   ?scope=all  → admins only, whole workspace. Unused by the client now that
//                 /my-work has no scope selector, but kept for debugging.
//   ?user_id=   → admins only, one member.
//
// The ORDER BY is intentionally left alone: the client applies the active view's
// sort, and the other consumers of this shape rely on Done-last ordering.
router.get('/', async (req, res) => {
  try {
    const params = [req.labelId];
    let where = 't.label_id = $1';

    if (req.query.scope === 'team') {
      const frag = teamFilter(req, params);
      if (frag === null) return res.status(403).json({ success: false, error: 'Not a team lead' });
      where += frag;
    } else if (isAdmin(req) && req.query.scope === 'all') {
      // no extra filter — whole workspace
    } else if (isAdmin(req) && req.query.user_id) {
      const uid = parseInt(req.query.user_id, 10);
      if (!Number.isInteger(uid)) return res.status(400).json({ success: false, error: 'Invalid user_id' });
      params.push(uid);
      where += ` AND t.user_id = $${params.length}`;
    } else {
      params.push(req.user.id);
      where += ` AND t.user_id = $${params.length}`;
    }

    // NOTE: an unassigned task (user_id went NULL when its owner was removed) has
    // no department, so it is invisible to a department-scoped Approver and shows
    // only for admins, grouped under "Unassigned". That asymmetry is intended —
    // nobody can attribute an orphan to a team.
    const { rows } = await pool.query(
      `${TASK_SELECT}
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
    const enumErr = badEnum(req.body); // hoisted; shared with PATCH
    if (enumErr) return res.status(400).json({ success: false, error: enumErr });

    // Leads may create work for their team (admins → anyone, Approver → own
    // department, via the same gate reassignment uses). A non-lead's user_id is
    // ignored rather than rejected, preserving the old silent self-assign.
    let assigneeId = req.user.id;
    if (req.body.user_id && isLead(req)) {
      const target = parseInt(req.body.user_id, 10);
      if (!Number.isInteger(target)) return res.status(400).json({ success: false, error: 'Invalid assignee' });
      const allowed = await canAssignTo(req, target);
      if (!allowed.ok) return res.status(allowed.code).json({ success: false, error: allowed.error });
      assigneeId = target;
    }

    if (release_id) {
      const { rows: r } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [release_id, req.labelId]);
      if (!r.length) return res.status(400).json({ success: false, error: 'Release not found in this workspace' });
    }

    // New tasks land at the TOP of the manual order (one global sequence per
    // label, gaps of 1024) so a quick-add stays where you expect after a reload.
    const { rows } = await pool.query(
      `INSERT INTO tasks (label_id, user_id, assigned_by, description, priority, status, due_date,
                          release_id, notes, category, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,'Medium'),COALESCE($6,'To Do'),$7,$8,$9,$10,
               (SELECT COALESCE(MIN(sort_order), 0) - 1024 FROM tasks WHERE label_id = $1),
               NOW(),NOW())
       RETURNING *`,
      [req.labelId, assigneeId, req.user.id, description.trim(), priority || null, status || null,
       due_date || null, release_id || null, text(req.body.notes, NOTES_MAX), text(req.body.category, CATEGORY_MAX)]
    );
    let pendingEmail = null;
    if (assigneeId !== req.user.id) {
      await logActivity(req, 'Assigned task', description.trim());
      pendingEmail = await notifyAssignee(req, assigneeId, rows[0]);
    }
    // `pending_email` is non-null only when the caller asked for notify:'preview'.
    res.status(201).json({ success: true, data: await selectTask(req.labelId, rows[0].id), pending_email: pendingEmail });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Saved views ────────────────────────────────────────────────────────────
// Named per-user view configs (My Work + Team Work), modelled on
// permission_templates. Declared BEFORE /:id so PATCH /views/:id and the literal
// /bulk path below are never swallowed by the wildcard route.
//
// `config` is owned by the client (see client/src/constants/taskViews.js): the
// server only checks it is a plain object of bounded size. Deep validation here
// would mean redeploying the API to ship a new filter.
const VIEW_CONFIG_MAX = 4096;

function badConfig(config) {
  if (config === undefined) return null;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return 'Invalid config';
  if (JSON.stringify(config).length > VIEW_CONFIG_MAX) return 'Config too large';
  return null;
}

// Views are private per user — there is deliberately no admin override.
router.get('/views', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, config, created_at, updated_at FROM task_views WHERE label_id = $1 AND user_id = $2 ORDER BY LOWER(name)',
      [req.labelId, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List task views error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Upsert by case-insensitive name, so re-saving "Today" replaces it instead of
// accumulating near-duplicates.
router.post('/views', async (req, res) => {
  try {
    const name = text(req.body.name, 60);
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    const cfgErr = badConfig(req.body.config);
    if (cfgErr) return res.status(400).json({ success: false, error: cfgErr });

    const { rows } = await pool.query(
      `INSERT INTO task_views (label_id, user_id, name, config, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4::jsonb,'{}'::jsonb),NOW(),NOW())
       ON CONFLICT (label_id, user_id, LOWER(name))
       DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config, updated_at = NOW()
       RETURNING id, name, config, created_at, updated_at`,
      [req.labelId, req.user.id, name, req.body.config ? JSON.stringify(req.body.config) : null]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Save task view error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/views/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'View not found' });
    const cfgErr = badConfig(req.body.config);
    if (cfgErr) return res.status(400).json({ success: false, error: cfgErr });
    const name = req.body.name !== undefined ? text(req.body.name, 60) : null;
    if (req.body.name !== undefined && !name) return res.status(400).json({ success: false, error: 'Name cannot be blank' });

    const { rows } = await pool.query(
      `UPDATE task_views
          SET name = COALESCE($1, name),
              config = COALESCE($2::jsonb, config),
              updated_at = NOW()
        WHERE id = $3 AND label_id = $4 AND user_id = $5
        RETURNING id, name, config, created_at, updated_at`,
      [name, req.body.config ? JSON.stringify(req.body.config) : null, id, req.labelId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'View not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update task view error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/views/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'View not found' });
    const { rowCount } = await pool.query(
      'DELETE FROM task_views WHERE id = $1 AND label_id = $2 AND user_id = $3',
      [id, req.labelId, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'View not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task view error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Bulk field update ──────────────────────────────────────────────────────
// "Mark these 8 Done" as one request. The permission gate lives INSIDE the WHERE
// so it cannot be bypassed and cannot half-fail: out-of-scope ids are silently
// skipped, and the client compares RETURNING * against the ids it sent to report
// "n of m updated" rather than claiming a clean success.
const BULK_FIELDS = ['status', 'priority', 'due_date', 'category'];

router.patch('/bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(n => parseInt(n, 10)).filter(Number.isInteger))]
      : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No task ids provided' });

    const fields = req.body.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    const enumErr = badEnum(fields);
    if (enumErr) return res.status(400).json({ success: false, error: enumErr });

    // Reassignment goes through the same destination gate as single PATCH.
    let reassignTo = null;
    if (fields.user_id !== undefined && fields.user_id !== null && fields.user_id !== '') {
      const target = parseInt(fields.user_id, 10);
      if (!Number.isInteger(target)) return res.status(400).json({ success: false, error: 'Invalid assignee' });
      const allowed = await canAssignTo(req, target);
      if (!allowed.ok) return res.status(allowed.code).json({ success: false, error: allowed.error });
      reassignTo = target;
    }

    const params = [req.labelId, ids];
    const sets = [];
    let hasStatus = false;
    for (const k of BULK_FIELDS) {
      if (fields[k] === undefined) continue;
      params.push(k === 'category' ? text(fields[k], CATEGORY_MAX) : (fields[k] === '' ? null : fields[k]));
      sets.push(`${k} = $${params.length}`);
      if (k === 'status') hasStatus = true;
    }
    if (reassignTo !== null) {
      params.push(reassignTo);
      sets.push(`user_id = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    if (hasStatus) {
      // A SECOND binding of the same value, not a reuse of its placeholder — see the
      // 42P08 note on the single-task PATCH below. This is the identical bug.
      params.push(fields.status);
      sets.push(`completed_at = CASE WHEN $${params.length} = 'Done' THEN COALESCE(t.completed_at, NOW()) ELSE NULL END`);
    }

    // $admin / $self / $dept mirror canMutateTask's three branches in SQL.
    params.push(isAdmin(req));
    const adminIdx = params.length;
    params.push(req.user.id);
    const selfIdx = params.length;
    params.push(req.user.role === 'Approver' && req.user.department ? req.user.department : null);
    const deptIdx = params.length;

    const { rows } = await pool.query(
      `UPDATE tasks t SET ${sets.join(', ')}, updated_at = NOW()
        WHERE t.label_id = $1 AND t.id = ANY($2::int[])
          AND ( $${adminIdx}::boolean
             OR t.user_id = $${selfIdx}
             OR ($${deptIdx}::text IS NOT NULL AND EXISTS (
                  SELECT 1 FROM users u
                   WHERE u.id = t.user_id AND u.label_id = t.label_id AND u.department = $${deptIdx})) )
        RETURNING *`,
      params
    );

    const touchedOthers = rows.filter(r => r.user_id !== req.user.id).length;
    if (touchedOthers) {
      logActivity(req, 'Bulk-edited teammate tasks', `${touchedOthers} task(s)`);
    }
    // Re-select through TASK_SELECT so the client gets the joined display fields.
    const enriched = await selectTasks(req.labelId, rows.map(r => r.id));
    res.json({ success: true, data: enriched, requested: ids.length, updated: enriched.length });
  } catch (error) {
    console.error('Bulk update tasks error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Manual ordering ────────────────────────────────────────────────────────
// Rewrite the whole label's sort_order to evenly spaced multiples of 1024,
// preserving the current order. Runs only when a midpoint is exhausted (roughly
// every 10 consecutive drops into the identical slot) or when a neighbour has
// never been hand-placed. One indexed statement, so atomic without an explicit
// transaction.
async function renormalizeOrder(labelId) {
  await pool.query(
    // ROW_NUMBER() is bigint; cast explicitly rather than leaning on the
    // bigint→int assignment cast.
    `UPDATE tasks t SET sort_order = (s.rn * 1024)::int
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order NULLS LAST, id) AS rn
               FROM tasks WHERE label_id = $1) s
      WHERE t.id = s.id AND t.label_id = $1`,
    [labelId]
  );
}

// PATCH /api/tasks/:id/reorder — body { before_id, after_id }: the ids of the rows
// the card was dropped BETWEEN (before_id = the row above, after_id = the row
// below). Either may be null for top/bottom of the list.
//
// Integer midpoints with an explicit exhaustion branch, NOT float midpoints:
// floats silently lose precision after ~50 drops into the same slot, at which
// point ordering just stops being stable. This fails loudly and recovers.
// And neighbour-based, NOT a whole-list {ordered_ids} rewrite: two people
// reordering different parts of the list both survive.
router.patch('/:id/reorder', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'Task not found' });

    const gate = await canMutateTask(req, id);
    if (!gate.ok) return res.status(gate.code).json({ success: false, error: gate.error });

    const beforeId = parseInt(req.body.before_id, 10);
    const afterId = parseInt(req.body.after_id, 10);

    // A neighbour id from another label, or a deleted one, is treated as absent.
    const neighbour = async (nid) => {
      if (!Number.isInteger(nid) || nid === id) return { exists: false, order: null };
      const { rows } = await pool.query('SELECT sort_order FROM tasks WHERE id = $1 AND label_id = $2', [nid, req.labelId]);
      return rows.length ? { exists: true, order: rows[0].sort_order } : { exists: false, order: null };
    };

    let above = await neighbour(beforeId);
    let below = await neighbour(afterId);
    let renormalized = false;

    // A neighbour that exists but was never hand-placed (sort_order NULL — the
    // state of every pre-existing row) can't anchor a midpoint. Normalise once and
    // everything downstream is plain integer arithmetic.
    if ((above.exists && above.order === null) || (below.exists && below.order === null)) {
      await renormalizeOrder(req.labelId);
      renormalized = true;
      above = await neighbour(beforeId);
      below = await neighbour(afterId);
    }

    let target;
    if (above.order !== null && below.order !== null) {
      const lo = Math.min(above.order, below.order);
      const hi = Math.max(above.order, below.order);
      target = Math.floor((lo + hi) / 2);
      if (target === lo || target === hi) { // gap exhausted
        await renormalizeOrder(req.labelId);
        renormalized = true;
        above = await neighbour(beforeId);
        below = await neighbour(afterId);
        target = Math.floor((Math.min(above.order, below.order) + Math.max(above.order, below.order)) / 2);
      }
    } else if (below.order !== null) {
      target = below.order - 1024;           // dropped at the top
    } else if (above.order !== null) {
      target = above.order + 1024;           // dropped at the bottom
    } else {
      // No usable neighbours (e.g. an empty group): park it at the top.
      const { rows } = await pool.query(
        'SELECT COALESCE(MIN(sort_order), 0) - 1024 AS o FROM tasks WHERE label_id = $1',
        [req.labelId]
      );
      target = rows[0].o;
    }

    await pool.query(
      'UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND label_id = $3',
      [target, id, req.labelId]
    );
    logCrossUserMutation(req, 'Reordered teammate task', gate.task);
    // `renormalized` tells the client its optimistic sort_order values for OTHER
    // rows are now stale and it should refetch once.
    res.json({ success: true, data: await selectTask(req.labelId, id), renormalized });
  } catch (error) {
    console.error('Reorder task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// `completed_at` is deliberately absent — it is derived from the status transition
// below, never taken from the client. `user_id` is absent too: reassignment is a
// privileged operation with its own branch, so it must not ride in on a field patch.
const UPDATABLE = ['description', 'priority', 'status', 'due_date', 'release_id', 'notes', 'category', 'sort_order'];

// Shared by PATCH and POST: reject a bad enum rather than letting a typo'd status
// create a phantom board column that nothing can filter or group.
function badEnum(body) {
  if (body.priority !== undefined && !TASK_PRIORITIES.includes(body.priority)) return 'Invalid priority';
  if (body.status !== undefined && !TASK_STATUSES.includes(body.status)) return 'Invalid status';
  return null;
}

// PATCH /api/tasks/:id — the assignee, an admin, or a lead of the owner's department.
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Without this a non-numeric :id reaches Postgres as NaN and 500s.
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'Task not found' });

    const gate = await canMutateTask(req, id);
    if (!gate.ok) return res.status(gate.code).json({ success: false, error: gate.error });

    const enumErr = badEnum(req.body);
    if (enumErr) return res.status(400).json({ success: false, error: enumErr });

    // POST validates release_id in-tenant; PATCH did not, so a task could be
    // pointed at another workspace's release id.
    if (req.body.release_id) {
      const { rows: r } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [req.body.release_id, req.labelId]);
      if (!r.length) return res.status(400).json({ success: false, error: 'Release not found in this workspace' });
    }

    // Reassignment is its own privileged branch — see UPDATABLE's note on why
    // user_id must never ride in on a plain field patch.
    let reassignTo = null;
    let unassign = false;
    if ('user_id' in req.body) {
      const raw = req.body.user_id;
      if (raw === null || raw === '') {
        // Unassigning takes work OUT of every department, which is exactly what
        // canAssignTo exists to prevent a lead from doing — so admins only.
        if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'Only admins can unassign a task' });
        if (gate.task.user_id !== null) unassign = true;
      } else {
        const target = parseInt(raw, 10);
        if (!Number.isInteger(target)) return res.status(400).json({ success: false, error: 'Invalid assignee' });
        if (target !== gate.task.user_id) {
          const allowed = await canAssignTo(req, target);
          if (!allowed.ok) return res.status(allowed.code).json({ success: false, error: allowed.error });
          reassignTo = target;
        }
      }
    }

    const keys = Object.keys(req.body).filter(k => UPDATABLE.includes(k));
    if (keys.length === 0 && reassignTo === null && !unassign) {
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
    const values = keys.map(k => (
      k === 'notes' ? text(req.body.notes, NOTES_MAX)
        : k === 'category' ? text(req.body.category, CATEGORY_MAX)
          : req.body[k]
    ));

    if (reassignTo !== null) {
      values.push(reassignTo);
      setClauses.push(`user_id = $${values.length}`);
    } else if (unassign) {
      setClauses.push('user_id = NULL'); // no param — keeps the numbering below intact
    }

    // Stamp on the way INTO Done, clear on the way out, and never overwrite an
    // existing stamp.
    //
    // The status value is bound a SECOND time rather than reusing its placeholder.
    // Reuse looks tidier and is broken: Postgres has to deduce ONE type for that
    // parameter from both `status = $n` (character varying, from the column) and
    // `$n = 'Done'` (text, from the literal), refuses, and raises 42P08
    // "inconsistent types deduced for parameter". Every status change on a task —
    // the drawer select, a drag into the Done column, the card's done toggle, the
    // bulk bar — 500'd on it. Casting the parameter does not fix it either; it just
    // constrains the deduction the other way. A separate placeholder, used only
    // against the literal, has one unambiguous type.
    if (keys.includes('status')) {
      values.push(req.body.status);
      setClauses.push(`completed_at = CASE WHEN $${values.length} = 'Done' THEN COALESCE(completed_at, NOW()) ELSE NULL END`);
    }

    values.push(id, req.labelId);

    const { rows } = await pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING *`,
      values
    );

    logCrossUserMutation(req, reassignTo !== null ? 'Reassigned task' : 'Edited teammate task', gate.task);
    let pendingEmail = null;
    if (reassignTo !== null && reassignTo !== req.user.id) {
      pendingEmail = await notifyAssignee(req, reassignTo, rows[0]);
    }

    res.json({ success: true, data: await selectTask(req.labelId, id), pending_email: pendingEmail });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id — assignee or admin.
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'Task not found' });

    const gate = await canMutateTask(req, id);
    if (!gate.ok) return res.status(gate.code).json({ success: false, error: gate.error });

    await pool.query('DELETE FROM tasks WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    logCrossUserMutation(req, 'Deleted teammate task', gate.task);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

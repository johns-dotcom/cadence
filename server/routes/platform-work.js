/**
 * Cross-workspace My Work for the operator console.
 *
 * WHAT MAKES THIS ANSWERABLE. A platform operator is one person with many user
 * rows — one per workspace they have entered, all sharing their email (see
 * lib/operatorGhost). So "every task of mine, everywhere" is simply: tasks whose
 * user_id is any of those ghost ids. No new table, no new column, and the
 * operator's home Platform HQ row falls out as just another workspace.
 *
 * WHY A SEPARATE ROUTER, not a widening of routes/tasks.js. That router is
 * `authMiddleware + withTenant`: every query is pinned to one req.labelId and
 * teamFilter() is the single function deciding whose tasks a caller may read.
 * Teaching either about operators would put a cross-tenant bypass inside the
 * primitive every workspace user goes through. The boundary is crossed here,
 * where the operator allowlist already lives — the same argument that made
 * routes/platform-chat.js its own file.
 *
 * WHAT AN OPERATOR MAY DO. Read and edit their OWN tasks in any workspace they
 * can access; create a task for themselves in one (minting the ghost if they
 * have never entered it). Tasks they delegated to a workspace's own people are
 * READ-ONLY here: editing a member's queue from outside their workspace is a
 * different decision from keeping your own list, and the row links into the
 * workspace instead.
 *
 * WHAT IS NOT AUDITED, and why that is not an omission. Every write this router
 * performs lands on a row the operator owns; nothing here touches a tenant's
 * data or is visible to them (routes/tasks.js excludes ghost tasks from the
 * team roll-up, the same way routes/team.js excludes the ghost from the
 * roster). The one act with a tenant-side consequence — minting a membership in
 * a workspace — writes an activity_log line there, exactly as entering does.
 */
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/tenant');
const { accessibleLabelIds } = require('../lib/operatorAccess');
const { ensureGhost, ghostIds } = require('../lib/operatorGhost');
const { TASK_STATUSES, TASK_PRIORITIES } = require('../lib/constants');
const { isValidDay } = require('../lib/calendarDay');
const { buildAssignmentCtx, sendAssignment } = require('../lib/taskNotify');

const router = express.Router();

// A due date must be a REAL day before it reaches SQL — '2026-02-31' has the
// right shape and Postgres answers 22008, which surfaced as a 500 on what is a
// 400. Same guard the tenant task routes use.
function badDueDate(v) {
  if (v === undefined || v === null || v === '') return null;
  return isValidDay(v) ? null : 'Invalid due date';
}

// No withTenant: cross-tenant by construction, so there is no single labelId to
// pin this to. Every query derives its label from the task and re-checks it.
router.use(authMiddleware, requirePlatformAdmin);

const NOTES_MAX = 5000;
const CATEGORY_MAX = 60;
const DESC_MAX = 2000;
const CAP = 500;

const text = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

// Validate, never coerce: a status the column does not carry is invisible to
// every query in the app that compares it exactly.
function badEnum(body) {
  if (body.status !== undefined && body.status !== null && !TASK_STATUSES.includes(body.status)) {
    return `Status must be one of: ${TASK_STATUSES.join(', ')}`;
  }
  if (body.priority !== undefined && body.priority !== null && !TASK_PRIORITIES.includes(body.priority)) {
    return `Priority must be one of: ${TASK_PRIORITIES.join(', ')}`;
  }
  return null;
}

/**
 * The workspaces this operator may see HERE.
 *
 * Their own home label is always included: an allowlist names tenants, and
 * confining an operator to one tenant must never hide their own platform-level
 * to-do list from them.
 */
async function visibleLabelIds(req) {
  const ids = await accessibleLabelIds(req);
  if (!ids) return null;
  const home = Number(req.user.label_id);
  return Number.isInteger(home) && !ids.includes(home) ? [...ids, home] : ids;
}

// Tasks joined to the one thing a cross-tenant list needs and a tenant list
// never does: which workspace this is. `assignee`/`assigner` resolve inside the
// task's own label, matching routes/tasks.js TASK_SELECT.
const WORK_SELECT = `
  SELECT t.id, t.label_id, t.user_id, t.assigned_by, t.description, t.priority, t.status,
         t.due_date, t.category, t.notes, t.release_id, t.completed_at, t.created_at, t.updated_at,
         l.name AS label_name, COALESCE(l.status, 'active') AS label_status,
         l.is_system AS label_is_system,
         u.name AS assignee_name, b.name AS assigner_name, r.project_name AS release_name
    FROM tasks t
    JOIN labels l ON l.id = t.label_id
    LEFT JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
    LEFT JOIN users b ON b.id = t.assigned_by AND b.label_id = t.label_id
    LEFT JOIN releases r ON r.id = t.release_id AND r.label_id = t.label_id`;

// Open work always; finished work only while it is still recent. An unbounded
// cross-tenant history would grow forever and none of it is actionable — the
// client says so rather than implying these are all the tasks that ever were.
// COALESCE, not a bare completed_at: that column is stamped on the transition
// into Done, so a row finished before it existed (or by any path that did not
// stamp it) carries NULL — and a bare comparison would hide it forever rather
// than for 30 days.
const RECENT_DONE = `(t.status <> 'Done' OR COALESCE(t.completed_at, t.updated_at) > NOW() - INTERVAL '30 days')`;

// GET /api/platform/work — the whole page in one round trip.
router.get('/', async (req, res) => {
  try {
    const ids = await visibleLabelIds(req);
    const ghosts = await ghostIds(req.user.email);
    // An allowlist narrows which of my ghosts count; it never widens them.
    const myIds = ghosts.filter(g => !ids || ids.includes(Number(g.label_id))).map(g => g.id);

    const wsParams = [];
    let wsWhere = '';
    if (ids) { wsParams.push(ids); wsWhere = ` WHERE l.id = ANY($${wsParams.length}::int[])`; }

    const workspacesQ = pool.query(
      `SELECT l.id, l.name, l.accent_color, l.console_color, COALESCE(l.status,'active') AS status,
              COALESCE(l.is_system, false) AS is_system
         FROM labels l${wsWhere} ORDER BY l.id`,
      wsParams
    );

    if (!myIds.length) {
      const ws = await workspacesQ;
      return res.json({
        success: true,
        data: { workspaces: ws.rows, mine: [], delegated: [], scoped: !!ids, capped: false, delegated_capped: false },
      });
    }

    // Mine: assigned to any of my ghosts. Delegated: I created it and somebody
    // ELSE holds it — `<> ALL` rather than a NOT IN so a NULL assignee (the
    // owner left the workspace) still surfaces instead of vanishing.
    const [ws, mine, delegated] = await Promise.all([
      workspacesQ,
      pool.query(
        `${WORK_SELECT} WHERE t.user_id = ANY($1::int[]) AND ${RECENT_DONE}
          ORDER BY (t.status = 'Done'), t.due_date ASC NULLS LAST, t.id DESC LIMIT ${CAP + 1}`,
        [myIds]
      ),
      pool.query(
        `${WORK_SELECT} WHERE t.assigned_by = ANY($1::int[]) AND (t.user_id IS NULL OR t.user_id <> ALL($1::int[]))
           AND ${RECENT_DONE}
          ORDER BY (t.status = 'Done'), t.due_date ASC NULLS LAST, t.id DESC LIMIT ${CAP + 1}`,
        [myIds]
      ),
    ]);

    res.json({
      success: true,
      data: {
        workspaces: ws.rows,
        mine: mine.rows.slice(0, CAP),
        delegated: delegated.rows.slice(0, CAP),
        scoped: !!ids,
        capped: mine.rows.length > CAP,
        delegated_capped: delegated.rows.length > CAP,
      },
    });
  } catch (error) {
    console.error('Platform work list error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/platform/work/workspaces/:id/members — who an operator may hand work
// to inside one workspace.
//
// Platform identities are excluded, matching routes/team.js: the ghost is hidden
// from that workspace's own roster, so offering it here would let an operator
// assign work to a colleague's invisible membership — a task nobody would ever
// see on a roster, in a queue nobody reads.
router.get('/workspaces/:id(\\d+)/members', async (req, res) => {
  try {
    const labelId = parseInt(req.params.id, 10);
    if (!Number.isInteger(labelId)) return res.status(400).json({ success: false, error: 'Invalid workspace' });
    const ids = await visibleLabelIds(req);
    if (ids && !ids.includes(labelId)) return res.status(403).json({ success: false, error: 'You do not have access to this workspace' });
    const { rows } = await pool.query(
      // Same predicate and ordering routes/team.js uses, so this picker lists
      // exactly the people that workspace's own Team page does.
      `SELECT id, name, email, role, department FROM users
        WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
        ORDER BY hierarchy_level, name`,
      [labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Platform work roster error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Resolve an assignee inside `labelId`, or explain the refusal.
 *
 * Validate, never coerce: a user id from another workspace must be a refusal,
 * not a silent self-assign — writing the task to the wrong tenant's person is
 * the one outcome that is worse than an error.
 */
async function resolveAssignee(labelId, raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, id: null };
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id)) return { ok: false, code: 400, error: 'Invalid assignee' };
  const { rows } = await pool.query(
    `SELECT id, name FROM users WHERE id = $1 AND label_id = $2
       AND (is_platform_admin = false OR is_platform_admin IS NULL)`,
    [id, labelId]
  );
  if (!rows.length) return { ok: false, code: 400, error: 'That person is not a member of this workspace' };
  return { ok: true, id, name: rows[0].name };
}

// Assigning into a tenant is the one act here with a consequence for THEM, so it
// is recorded in their own activity feed. (Creating a task for yourself is not:
// it is invisible to the workspace, and logging it would disclose the operator's
// private list to the tenant.)
function auditAssignment(req, labelId, ghostId, endpoint, description, assigneeName) {
  pool.query(
    `INSERT INTO activity_log (label_id, user_id, action, detail, method, endpoint, created_at)
     VALUES ($1, $2, 'Task assigned by platform admin', $3, 'POST', $4, NOW())`,
    [labelId, ghostId, `${description} → ${assigneeName}`, endpoint]
  ).catch(() => {});
}

// POST /api/platform/work/tasks — file a task for myself in one workspace.
router.post('/tasks', async (req, res) => {
  try {
    const labelId = parseInt(req.body.label_id, 10);
    // A NaN reaches Postgres as a type error, so an unguarded bad request
    // becomes a 500 rather than the 400 it is.
    if (!Number.isInteger(labelId)) return res.status(400).json({ success: false, error: 'Choose a workspace' });

    const description = text(req.body.description, DESC_MAX);
    if (!description) return res.status(400).json({ success: false, error: 'Description is required' });

    const enumErr = badEnum(req.body);
    if (enumErr) return res.status(400).json({ success: false, error: enumErr });

    const ids = await visibleLabelIds(req);
    if (ids && !ids.includes(labelId)) {
      return res.status(403).json({ success: false, error: 'You do not have access to this workspace' });
    }
    const { rows: lab } = await pool.query('SELECT id FROM labels WHERE id = $1', [labelId]);
    if (!lab.length) return res.status(404).json({ success: false, error: 'Workspace not found' });

    // Mint the membership if this workspace has never been entered. Same rule
    // the enter flow uses, so the console cannot create an operator identity
    // the rest of the platform does not recognise.
    const before = await pool.query('SELECT 1 FROM users WHERE label_id = $1 AND LOWER(email) = $2',
      [labelId, (req.user.email || '').toLowerCase()]);
    const ghost = await ensureGhost(labelId, req.user);
    if (!before.rows.length) {
      // The one act here with a tenant-side consequence, logged where entering
      // logs it.
      pool.query(
        `INSERT INTO activity_log (label_id, user_id, action, detail, method, endpoint, created_at)
         VALUES ($1, $2, 'Platform admin membership created', $3, 'POST', $4, NOW())`,
        [labelId, ghost.id, req.user.email, req.originalUrl?.split('?')[0] || null]
      ).catch(() => {});
    }

    const dueErr = badDueDate(req.body.due_date);
    if (dueErr) return res.status(400).json({ success: false, error: dueErr });

    // Optional assignee. Absent → the operator's own list, which is what this
    // page was for originally; present → a task in that person's queue, filed by
    // the operator's own identity so it comes back under "Waiting on them".
    const who = await resolveAssignee(labelId, req.body.user_id);
    if (!who.ok) return res.status(who.code).json({ success: false, error: who.error });
    const assigneeId = who.id ?? ghost.id;

    const { rows } = await pool.query(
      `INSERT INTO tasks (label_id, user_id, assigned_by, description, priority, status, due_date,
                          notes, category, sort_order, created_at, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,'Medium'),COALESCE($6,'To Do'),$7,$8,$9,
               (SELECT COALESCE(MIN(sort_order), 0) - 1024 FROM tasks WHERE label_id = $1),
               NOW(),NOW())
       RETURNING id`,
      [labelId, assigneeId, ghost.id, description, req.body.priority || null, req.body.status || null,
       req.body.due_date || null, text(req.body.notes, NOTES_MAX), text(req.body.category, CATEGORY_MAX)]
    );

    const { rows: out } = await pool.query(`${WORK_SELECT} WHERE t.id = $1`, [rows[0].id]);

    if (who.id) {
      auditAssignment(req, labelId, ghost.id, req.originalUrl?.split('?')[0] || null, description, who.name);
      // Tell them. A task that appears in somebody's queue with no word from
      // anyone is how work sits unnoticed; `notify: false` opts out.
      if (req.body.notify !== false && req.body.notify !== 'none') {
        buildAssignmentCtx({
          labelId, assigneeId, task: out[0], assignerName: req.user.name,
          origin: process.env.FRONTEND_URL || req.headers.origin || '',
        }).then(sendAssignment).catch(() => {});
      }
    }
    res.status(201).json({ success: true, data: out[0] });
  } catch (error) {
    console.error('Platform work create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// The fields an operator may change on their own task. `description` included:
// this is their own note to themselves.
//
// `user_id` is deliberately NOT here: reassignment is a different act on a
// different set of rows (see reassignTask below) and folding it into the field
// loop would let it inherit that loop's ownership rule.
const EDITABLE = ['description', 'status', 'priority', 'due_date', 'category', 'notes'];

// Resolve a task id to a row this operator OWNS, inside a workspace they can
// see. Returns null for "not yours / not visible" so every caller answers 404
// rather than disclosing that the id exists somewhere.
async function ownTask(req, id) {
  const ids = await visibleLabelIds(req);
  const ghosts = await ghostIds(req.user.email);
  const myIds = ghosts.filter(g => !ids || ids.includes(Number(g.label_id))).map(g => g.id);
  if (!myIds.length) return null;
  const { rows } = await pool.query(
    'SELECT id, label_id, status FROM tasks WHERE id = $1 AND user_id = ANY($2::int[])', [id, myIds]);
  return rows[0] || null;
}

/**
 * Tasks this operator may HAND ON: their own, plus the ones they delegated.
 *
 * Wider than ownTask on purpose, and only for the assignee. Moving work you
 * created — to somebody else, or back to yourself — is the other half of being
 * able to assign it. Editing the CONTENT of a task a tenant's person now owns
 * stays out of reach: that is their queue, and this is not their workspace.
 */
async function reassignableTask(req, id) {
  const ids = await visibleLabelIds(req);
  const ghosts = await ghostIds(req.user.email);
  const myIds = ghosts.filter(g => !ids || ids.includes(Number(g.label_id))).map(g => g.id);
  if (!myIds.length) return null;
  const { rows } = await pool.query(
    `SELECT id, label_id, description, user_id FROM tasks
      WHERE id = $1 AND (user_id = ANY($2::int[]) OR assigned_by = ANY($2::int[]))`,
    [id, myIds]
  );
  return rows[0] || null;
}

// POST /api/platform/work/tasks/:id/assign — hand a task to somebody in its
// workspace, or take it back (user_id omitted → the operator's own membership).
router.post('/tasks/:id(\\d+)/assign', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid task' });

    const task = await reassignableTask(req, id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const who = await resolveAssignee(task.label_id, req.body.user_id);
    if (!who.ok) return res.status(who.code).json({ success: false, error: who.error });

    // Taking it back means the operator's membership in THAT workspace, minted
    // if this is a workspace they have never opened.
    const ghost = who.id ? null : await ensureGhost(task.label_id, req.user);
    const assigneeId = who.id ?? ghost.id;
    if (assigneeId === task.user_id) {
      return res.json({ success: true, data: (await pool.query(`${WORK_SELECT} WHERE t.id = $1`, [id])).rows[0], unchanged: true });
    }

    await pool.query('UPDATE tasks SET user_id = $1, updated_at = NOW() WHERE id = $2', [assigneeId, id]);
    const { rows } = await pool.query(`${WORK_SELECT} WHERE t.id = $1`, [id]);

    if (who.id) {
      const myGhost = await ensureGhost(task.label_id, req.user);
      auditAssignment(req, task.label_id, myGhost.id, req.originalUrl?.split('?')[0] || null, task.description, who.name);
      if (req.body.notify !== false && req.body.notify !== 'none') {
        buildAssignmentCtx({
          labelId: task.label_id, assigneeId, task: rows[0], assignerName: req.user.name,
          origin: process.env.FRONTEND_URL || req.headers.origin || '',
        }).then(sendAssignment).catch(() => {});
      }
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Platform work assign error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/tasks/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid task' });

    const enumErr = badEnum(req.body);
    if (enumErr) return res.status(400).json({ success: false, error: enumErr });

    const own = await ownTask(req, id);
    if (!own) return res.status(404).json({ success: false, error: 'Task not found' });

    const sets = [];
    const params = [];
    for (const f of EDITABLE) {
      if (req.body[f] === undefined) continue;
      let v = req.body[f];
      if (f === 'description') {
        v = text(v, DESC_MAX);
        if (!v) return res.status(400).json({ success: false, error: 'Description is required' });
      } else if (f === 'notes') v = text(v, NOTES_MAX);
      else if (f === 'category') v = text(v, CATEGORY_MAX);
      else if (f === 'due_date') {
        const dueErr = badDueDate(v);
        if (dueErr) return res.status(400).json({ success: false, error: dueErr });
        v = v || null;
      }
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    if (req.body.status !== undefined) {
      // The status value is bound a SECOND time on purpose. One placeholder
      // facing both a varchar column and a text literal makes Postgres deduce
      // two types for it and raise 42P08 — the trap that silently killed every
      // task status change once already (see CLAUDE.md landmines). Casting
      // constrains the wrong side; binding twice does not.
      params.push(req.body.status);
      sets.push(`completed_at = CASE WHEN $${params.length}::text = 'Done'
                                     THEN COALESCE(completed_at, NOW()) ELSE NULL END`);
    }

    params.push(id);
    await pool.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, params);

    const { rows } = await pool.query(`${WORK_SELECT} WHERE t.id = $1`, [id]);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Platform work update error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/tasks/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid task' });
    const own = await ownTask(req, id);
    if (!own) return res.status(404).json({ success: false, error: 'Task not found' });
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('Platform work delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

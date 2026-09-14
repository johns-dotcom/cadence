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

const router = express.Router();

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

    const { rows } = await pool.query(
      `INSERT INTO tasks (label_id, user_id, assigned_by, description, priority, status, due_date,
                          notes, category, sort_order, created_at, updated_at)
       VALUES ($1,$2,$2,$3,COALESCE($4,'Medium'),COALESCE($5,'To Do'),$6,$7,$8,
               (SELECT COALESCE(MIN(sort_order), 0) - 1024 FROM tasks WHERE label_id = $1),
               NOW(),NOW())
       RETURNING id`,
      [labelId, ghost.id, description, req.body.priority || null, req.body.status || null,
       req.body.due_date || null, text(req.body.notes, NOTES_MAX), text(req.body.category, CATEGORY_MAX)]
    );

    const { rows: out } = await pool.query(`${WORK_SELECT} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json({ success: true, data: out[0] });
  } catch (error) {
    console.error('Platform work create error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// The fields an operator may change on their own task. `description` included:
// this is their own note to themselves. Deliberately no user_id — reassignment
// across a tenant boundary is not this page's job.
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
      else if (f === 'due_date') v = v || null;
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

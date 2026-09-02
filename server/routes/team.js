const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { sendEmail, inviteEmail } = require('../lib/email');
const { checkUserDeletable, deleteUserWithSweep } = require('../lib/userDelete');
const { ROLES, DEPARTMENTS, RELEASE_CHECKLIST_COLUMNS } = require('../lib/constants');

const router = express.Router();

const INVITE_DAYS = 7;
const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const ADMIN_TIER = ['Superadmin', 'Admin'];
const CHECKLIST = RELEASE_CHECKLIST_COLUMNS;
// SELECT fragment producing each checklist boolean COALESCEd to false, plus the
// derived completion % — so a release row that predates a column still counts.
const CHECKLIST_SELECT = CHECKLIST.map(k => `COALESCE(r.${k}, false) AS ${k}`).join(', ');
const COMPLETION_SELECT =
  `ROUND((${CHECKLIST.map(k => `(CASE WHEN COALESCE(r.${k}, false) THEN 1 ELSE 0 END)`).join(' + ')})::numeric * 100 / ${CHECKLIST.length})::int AS completion`;

/**
 * Role-escalation guard for POST / PATCH.
 *
 * DELETE has had these rules since M1 (lib/userDelete.js), but create and edit
 * were plain `requireAdmin` — so an Admin could invite a Superadmin, promote
 * anyone (including themselves via a second account) to Superadmin, edit a
 * Superadmin's department, or demote the last Superadmin and strand the
 * workspace. The UI hid the control; the API did not.
 *
 *   · only a Superadmin may GRANT an admin-tier role
 *   · only a Superadmin may EDIT an existing admin-tier member (any field —
 *     department is a permission boundary, and name/hierarchy are identity)
 *   · the last Superadmin may not be demoted (mirrors userDelete's last-Superadmin
 *     rule; demotion is the same lockout by another route)
 *
 * `current` is the target's stored role, or null when creating.
 */
function checkEscalation(actor, { current = null, newRole = null, superadminCount = 0 }) {
  const actorIsSuper = actor.role === 'Superadmin';
  if (newRole && ADMIN_TIER.includes(newRole) && !actorIsSuper) {
    return { ok: false, status: 403, error: `Only a Superadmin can grant the ${newRole} role` };
  }
  if (current && ADMIN_TIER.includes(current) && !actorIsSuper) {
    return { ok: false, status: 403, error: `Only a Superadmin can edit ${current === 'Admin' ? 'an Admin' : 'a Superadmin'}` };
  }
  if (current === 'Superadmin' && newRole && newRole !== 'Superadmin' && superadminCount <= 1) {
    return { ok: false, status: 400, error: 'Cannot demote the last Superadmin in this workspace' };
  }
  return { ok: true };
}

// A member's department scopes what an Approver sees and may mutate on Team Work
// (routes/tasks.js teamFilter / canMutateTask), so it is a permission boundary and
// must be one of the known values. Left unvalidated, a typo'd "a&r" would create a
// one-person department that no lead could ever see out of.
function badMemberFields({ role, department }) {
  if (role !== undefined && role !== null && !ROLES.includes(role)) return 'Invalid role';
  if (department !== undefined && department !== null && !DEPARTMENTS.includes(department)) return 'Invalid department';
  return null;
}

// Build the public accept-invite link. Uses the configured FRONTEND_URL, else
// the browser Origin — never the raw Host header (attacker-controllable, which
// would let a poisoned request send an invite link pointing at an attacker
// domain with a live invite token).
function inviteLink(req, token) {
  const origin = process.env.FRONTEND_URL || req.headers.origin || '';
  return `${origin.replace(/\/$/, '')}/accept-invite?token=${token}`;
}

// Every route here is authenticated and tenant-scoped.
router.use(authMiddleware, withTenant);

// GET /api/team — list members of the current label, each with an at-a-glance
// task rollup (open / overdue / in-progress / done / done %).
//
// The rollup is computed in SQL, not derived client-side: /team is fetched by
// every task surface AND by the roster page, and only the server can see tasks
// the caller isn't scoped to. "Overdue" is `due_date < CURRENT_DATE` in SQL — one
// rule, matching routes/notifications.js (still server-timezone; a per-user tz is
// the proper fix and is out of scope here).
//
// Additive columns only: existing callers (useTaskData, PermissionsManager,
// EmailPreviewModal) spread the row and are unaffected.
router.get('/', async (req, res) => {
  try {
    // Hide platform-admin "operator" memberships from the label's own roster.
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.department, u.hierarchy_level, u.created_at,
              (u.password_hash IS NULL AND u.invite_token IS NOT NULL) AS pending,
              COALESCE(t.open_tasks, 0)        AS open_tasks,
              COALESCE(t.overdue_tasks, 0)     AS overdue_tasks,
              COALESCE(t.in_progress_tasks, 0) AS in_progress_tasks,
              COALESCE(t.done_tasks, 0)        AS done_tasks,
              COALESCE(t.total_tasks, 0)       AS total_tasks
         FROM users u
         LEFT JOIN (
           SELECT user_id,
                  COUNT(*) FILTER (WHERE status <> 'Done')                                AS open_tasks,
                  COUNT(*) FILTER (WHERE status <> 'Done' AND due_date < CURRENT_DATE)     AS overdue_tasks,
                  COUNT(*) FILTER (WHERE status = 'In Progress')                           AS in_progress_tasks,
                  COUNT(*) FILTER (WHERE status = 'Done')                                  AS done_tasks,
                  COUNT(*)                                                                 AS total_tasks
             FROM tasks WHERE label_id = $1 GROUP BY user_id
         ) t ON t.user_id = u.id
        WHERE u.label_id = $1 AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL)
        ORDER BY u.hierarchy_level, u.name`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List team error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Analytics ──────────────────────────────────────────────────────────────
// Declared BEFORE the wildcard /:id below. /:id is (\\d+)-constrained too, so
// these can't be swallowed either way — belt and braces, matching the
// bank-statements precedent.

// GET /api/team/velocity — per-member release velocity (admin only).
// One query for the releases, folded in JS: the 12-month buckets and the
// on-time rate are per-member derivations of the SAME row set, so computing them
// in SQL would mean three scans that could disagree at a month boundary.
router.get('/velocity', requireAdmin, async (req, res) => {
  try {
    const [{ rows: members }, { rows: releases }] = await Promise.all([
      pool.query(
        `SELECT id, name, department, hierarchy_level FROM users
          WHERE label_id = $1 AND (is_platform_admin = false OR is_platform_admin IS NULL)
          ORDER BY hierarchy_level, name`,
        [req.labelId]
      ),
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.release_type, r.assigned_to,
                a.name AS artist_name, ${COMPLETION_SELECT}
           FROM releases r
           LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1 AND r.assigned_to IS NOT NULL
          ORDER BY r.release_date DESC NULLS LAST`,
        [req.labelId]
      ),
    ]);

    const now = new Date();
    const day30 = new Date(now - 30 * 86400000);
    const day90 = new Date(now - 90 * 86400000);
    // Month buckets as 'YYYY-MM' strings so the comparison is calendar-based and
    // never TZ-shifts a release across a month edge.
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      });
    }

    const velocity = members.map(m => {
      const mine = releases.filter(r => r.assigned_to === m.id).map(r => {
        const d = r.release_date ? new Date(r.release_date) : null;
        return { ...r, _date: d, _past: !!d && d < now, _month: r.release_date ? String(r.release_date).slice(0, 7) : null };
      });
      const past = mine.filter(r => r._past);
      const fully = past.filter(r => r.completion === 100).length;
      return {
        id: m.id, name: m.name, department: m.department,
        total: mine.length,
        completed: mine.filter(r => r.completion === 100).length,
        released: past.length,
        upcoming: mine.length - past.length,
        avgCompletion: mine.length ? Math.round(mine.reduce((s, r) => s + r.completion, 0) / mine.length) : 0,
        last30: past.filter(r => r._date >= day30).length,
        last90: past.filter(r => r._date >= day90).length,
        // null, not 0 — "no shipped releases yet" is not "0% on time".
        onTimeRate: past.length ? Math.round((fully / past.length) * 100) : null,
        monthly: months.map(mo => ({ label: mo.label, count: mine.filter(r => r._month === mo.key).length })),
        recentReleases: past.slice(0, 5).map(r => ({
          id: r.id, project_name: r.project_name, artist_name: r.artist_name,
          release_date: r.release_date, completion: r.completion, release_type: r.release_type,
        })),
      };
    }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

    const active = velocity.filter(v => v.total > 0);
    res.json({
      success: true,
      data: {
        velocity,
        totals: {
          totalReleases: releases.length,
          last30: velocity.reduce((s, v) => s + v.last30, 0),
          last90: velocity.reduce((s, v) => s + v.last90, 0),
          // Averaged over members who actually own releases — dividing by the whole
          // roster would drag the number toward zero every time someone joins.
          avgCompletion: active.length ? Math.round(active.reduce((s, v) => s + v.avgCompletion, 0) / active.length) : 0,
          activeMembers: active.length,
        },
      },
    });
  } catch (error) {
    console.error('Team velocity error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/team/workload — live (unarchived) assigned releases per member, with
// checklist completion and the release date. Team Work's Workload view scores
// people on open tasks alone; a member carrying four releases the week they drop
// is not "available" just because their task list is short.
router.get('/workload', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.project_name, r.release_date, r.release_type, r.priority, r.assigned_to,
              a.name AS artist_name, ${COMPLETION_SELECT}
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
        WHERE r.label_id = $1 AND r.assigned_to IS NOT NULL
          AND (r.archived = false OR r.archived IS NULL)
        ORDER BY r.release_date ASC NULLS LAST`,
      [req.labelId]
    );
    const byMember = {};
    for (const r of rows) (byMember[r.assigned_to] ||= []).push(r);
    res.json({ success: true, data: byMember });
  } catch (error) {
    console.error('Team workload error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/team — invite a member (admin only). The member is created WITHOUT
// a password and emailed an invite link to set their own. The response carries
// the link too, so the UI can show/copy it (and so the flow still works if
// email isn't configured yet).
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, email, role, department, hierarchy_level } = req.body;
    if (!name || !name.trim() || !email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }
    if (!isValidEmail(email.trim())) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }
    const fieldErr = badMemberFields(req.body);
    if (fieldErr) return res.status(400).json({ success: false, error: fieldErr });

    // An Admin could invite a Superadmin, who could then remove them.
    const esc = checkEscalation(req.user, { newRole: role || 'User' });
    if (!esc.ok) return res.status(esc.status).json({ success: false, error: esc.error });

    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO users (label_id, name, email, role, department, hierarchy_level,
         invite_token, invite_expires, invited_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + ($8 || ' days')::interval, NOW(), NOW())
       RETURNING id, name, email, role, department, hierarchy_level`,
      [req.labelId, name.trim(), email.trim().toLowerCase(), role || 'User', department || 'Operations', hierarchy_level || 99, token, String(INVITE_DAYS)]
    );

    // Resolve workspace name for the email body, then send (best-effort).
    const link = inviteLink(req, token);
    const label = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    // `notify: false` means the CLIENT is going to send this through the
    // review-before-send modal (kind `welcome`), the same path vendor
    // decisions and payment confirmations take. The row and the token are
    // created either way — the invite exists, only the email is deferred —
    // and the response still carries invite_link so the modal can render it.
    const notify = req.body.notify !== false;
    const msg = inviteEmail({
      inviteeName: name.trim(),
      workspaceName: label.rows[0]?.name || 'your workspace',
      inviterName: req.user.name,
      link,
      expiresDays: INVITE_DAYS,
    });
    const mail = notify
      ? await sendEmail({ to: rows[0].email, subject: msg.subject, html: msg.html, text: msg.text })
      : { sent: false, reason: 'deferred' };

    await logActivity(req, 'Invited team member', `${name} (${role || 'User'})`);
    res.status(201).json({ success: true, data: { ...rows[0], invite_link: link, workspace_name: label.rows[0]?.name || 'your workspace', inviter_name: req.user.name, expires_days: INVITE_DAYS, deferred: !notify, email_sent: mail.sent, email_error: mail.sent ? null : mail.reason } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, error: 'That email already exists in this workspace' });
    }
    console.error('Invite member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/team/:id/resend — regenerate the invite + resend (admin only).
router.post('/:id/resend', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await pool.query(
      `UPDATE users SET invite_token = $1, invite_expires = NOW() + ($2 || ' days')::interval, invited_at = NOW()
       WHERE id = $3 AND label_id = $4 AND password_hash IS NULL
       RETURNING id, name, email`,
      [token, String(INVITE_DAYS), id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pending invite not found (member may have already activated)' });
    const link = inviteLink(req, token);
    const label = await pool.query('SELECT name FROM labels WHERE id = $1', [req.labelId]);
    const notify = req.body.notify !== false;
    const msg = inviteEmail({ inviteeName: rows[0].name, workspaceName: label.rows[0]?.name || 'your workspace', inviterName: req.user.name, link, expiresDays: INVITE_DAYS });
    const mail = notify
      ? await sendEmail({ to: rows[0].email, subject: msg.subject, html: msg.html, text: msg.text })
      : { sent: false, reason: 'deferred' };
    res.json({ success: true, data: {
      invite_link: link, email: rows[0].email, name: rows[0].name,
      workspace_name: label.rows[0]?.name || 'your workspace', inviter_name: req.user.name,
      expires_days: INVITE_DAYS, deferred: !notify,
      email_sent: mail.sent, email_error: mail.sent ? null : mail.reason,
    } });
  } catch (error) {
    console.error('Resend invite error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/team/:id — update role/department/name (admin only)
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ success: false, error: 'User not found' });
    const { name, role, department, hierarchy_level } = req.body;

    const fieldErr = badMemberFields(req.body);
    if (fieldErr) return res.status(400).json({ success: false, error: fieldErr });

    // Bump token_version so the affected user's sessions pick up (or lose) access
    // immediately. BOTH role and department matter: department is a JWT claim that
    // teamFilter() trusts, so without this a lead moved out of A&R would keep A&R
    // access until their token expired.
    //
    // "Changed" must mean DIFFERS FROM STORED, not merely present-in-body — this
    // endpoint COALESCEs, so the UI resends unchanged fields and a present-in-body
    // test would log everyone out on every save.
    const { rows: before } = await pool.query(
      // Platform operators are filtered out of the roster, so nothing in this UI
      // can reach them — but the endpoint could, and a workspace Admin demoting a
      // platform operator is exactly the lockout the operator hardening exists to
      // prevent. Operator membership is managed in the platform console.
      `SELECT u.role, u.department,
              (SELECT COUNT(*)::int FROM users s WHERE s.label_id = $2 AND s.role = 'Superadmin') AS superadmins
         FROM users u
        WHERE u.id = $1 AND u.label_id = $2
          AND (u.is_platform_admin = false OR u.is_platform_admin IS NULL)`,
      [id, req.labelId]
    );
    if (!before.length) return res.status(404).json({ success: false, error: 'User not found' });
    const roleChanged = role !== undefined && role !== null && role !== before[0].role;
    const deptChanged = department !== undefined && department !== null && department !== before[0].department;

    // Escalation guards. Checked against the STORED role — an Admin may not edit
    // an admin-tier member at all, may not grant an admin-tier role, and nobody
    // may demote the last Superadmin. Runs before the write, not after.
    const esc = checkEscalation(req.user, {
      current: before[0].role,
      newRole: roleChanged ? role : null,
      superadminCount: before[0].superadmins,
    });
    if (!esc.ok) return res.status(esc.status).json({ success: false, error: esc.error });

    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         role = COALESCE($2, role),
         department = COALESCE($3, department),
         hierarchy_level = COALESCE($4, hierarchy_level),
         token_version = token_version + $5
       WHERE id = $6 AND label_id = $7
       RETURNING id, name, email, role, department, hierarchy_level`,
      [name, role, department, hierarchy_level, (roleChanged || deptChanged) ? 1 : 0, id, req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    await logActivity(req, 'Updated team member', rows[0].name);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/team/:id — remove a member (admin only). Guarded (last-Superadmin,
// only-Superadmin-deletes-Admins) + dynamic FK sweep so references clear cleanly.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const guard = await checkUserDeletable(req.labelId, req.user, id);
    if (!guard.ok) return res.status(guard.status).json({ success: false, error: guard.error });
    await deleteUserWithSweep(req.labelId, id);
    await logActivity(req, 'Removed team member', `user #${id} (${guard.target.role})`);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete member error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/team/:id — one member's profile: identity, assigned releases with
// checklist completion, their task list, and their activity trail.
//
// (\\d+)-constrained and declared LAST so it can never swallow /velocity or
// /workload — the named routes above are the reason boom's equivalent carried a
// "must come after" comment.
//
// TASK VISIBILITY reconciles boom's rule with this app's department boundary.
// boom's rule was admin-or-self → everything, everyone else → delegated only.
// Here `department` is a permission boundary (routes/tasks.js teamFilter), so a
// department lead is added as a third full-visibility case — the same widening
// canMutateTask already makes, and without it a lead could edit a teammate's task
// on Team Work but not see it on their profile. Everyone else keeps boom's
// privacy floor: DELEGATED tasks only, so self-added personal notes stay private.
//
// Releases and the activity trail are NOT privacy-filtered: both are workspace
// work-product and are already listed by name on /releases and /activity.
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rows: m } = await pool.query(
      // Same operator exclusion as the roster — nothing links to an operator, and
      // a tenant page must not profile one.
      `SELECT id, name, email, role, department, hierarchy_level, created_at,
              (password_hash IS NULL AND invite_token IS NOT NULL) AS pending
         FROM users WHERE id = $1 AND label_id = $2
           AND (is_platform_admin = false OR is_platform_admin IS NULL)`,
      [id, req.labelId]
    );
    if (!m.length) return res.status(404).json({ success: false, error: 'Member not found' });
    const member = m[0];

    const isAdmin = ADMIN_TIER.includes(req.user.role);
    const isSelf = req.user.id === id;
    const isDeptLead = req.user.role === 'Approver'
      && !!req.user.department
      && req.user.department === member.department
      && !ADMIN_TIER.includes(member.role); // never look downward-only at a superior
    const seesAllTasks = isAdmin || isSelf || isDeptLead;
    // t.user_id is $1, so `assigned_by <> t.user_id` is the "somebody else gave
    // them this" test. NULL assigned_by (a self-added task) fails the first
    // condition and stays hidden.
    const taskFilter = seesAllTasks ? '' : ' AND t.assigned_by IS NOT NULL AND t.assigned_by <> t.user_id';

    const [releases, tasks, activity] = await Promise.all([
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.release_type, r.priority, r.archived,
                a.name AS artist_name, ${CHECKLIST_SELECT}, ${COMPLETION_SELECT}
           FROM releases r
           LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1 AND r.assigned_to = $2
            AND (r.archived = false OR r.archived IS NULL)
          ORDER BY r.release_date ASC NULLS LAST`,
        [req.labelId, id]
      ),
      pool.query(
        `SELECT t.id, t.description, t.status, t.priority, t.due_date, t.category,
                t.release_id, t.notes, t.completed_at, t.created_at, t.assigned_by,
                b.name AS assigned_by_name, r.project_name AS release_name,
                (t.due_date < CURRENT_DATE) AS is_overdue
           FROM tasks t
           LEFT JOIN users b ON b.id = t.assigned_by AND b.label_id = t.label_id
           LEFT JOIN releases r ON r.id = t.release_id AND r.label_id = t.label_id
          WHERE t.label_id = $1 AND t.user_id = $2${taskFilter}
          ORDER BY (t.status = 'Done'), t.due_date ASC NULLS LAST, t.id DESC`,
        [req.labelId, id]
      ),
      pool.query(
        `SELECT al.id, al.action, al.detail, al.created_at
           FROM activity_log al
          WHERE al.label_id = $1 AND al.user_id = $2
          ORDER BY al.created_at DESC LIMIT 30`,
        [req.labelId, id]
      ),
    ]);

    res.json({
      success: true,
      data: {
        ...member,
        releases: releases.rows,
        tasks: tasks.rows,
        activity: activity.rows,
        // Tell the client the list is partial rather than letting it imply the
        // member has three tasks when they have thirty.
        tasks_filtered: !seesAllTasks,
      },
    });
  } catch (error) {
    console.error('Member detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

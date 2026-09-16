/**
 * The operator's per-workspace identity — "the ghost".
 *
 * A platform operator is ONE person with MANY user rows: their home row in the
 * Platform HQ system label, plus one row per workspace they have entered. Every
 * one of those rows carries the same email and `is_platform_admin = true`, and
 * the email is what identifies the human (an id identifies only one workspace's
 * ghost). That is the join key every cross-tenant operator surface needs.
 *
 * WHY THIS FILE EXISTS. The get-or-create lived inline in POST
 * /platform/workspaces/:id/enter. The console's cross-workspace My Work has to
 * mint the same row when an operator files a task into a workspace they have
 * never entered, and a second copy of an IDENTITY rule is how one surface ends
 * up creating a member the other does not recognise — the same argument that
 * moved operatorAccess() out of routes/platform.js.
 *
 * WHAT THE GHOST IS. A full member of the target label (Superadmin for an
 * owner, Admin for a workspace admin) with NO password_hash, so it can never be
 * used for a password login — it is only ever assumed through the platform
 * flow. It is deliberately hidden from the workspace's own roster
 * (routes/team.js filters `is_platform_admin`), which is why no member of that
 * workspace can assign work to an operator: tasks on a ghost are tasks the
 * operator filed for themselves.
 */
const pool = require('../db');
const { workspaceRoleFor } = require('./operatorAccess');

// The projection signToken() needs. Kept here so the enter flow and the console
// mint rows with the same shape.
const GHOST_COLS = 'id, label_id, name, email, role, department, hierarchy_level, is_platform_admin, platform_role, token_version';

// The operator's PLATFORM tier. Their tenant role is a separate question now —
// see workspaceRoleFor in lib/operatorAccess: an owner may hold a workspace
// admin at Approver or User inside one workspace and Admin in another.
function ghostRoleFor(platformRole) {
  return platformRole === 'owner' ? { opRole: 'owner', ghostRole: 'Superadmin' } : { opRole: 'admin', ghostRole: 'Admin' };
}

/**
 * Find this operator's membership in `labelId`, or mint one. Re-aligns an
 * existing ghost with the operator's CURRENT tier, so a demoted operator does
 * not keep Superadmin inside a tenant.
 *
 * `operator` is the req.user of a platform session (id/email/name/platform_role).
 */
async function ensureGhost(labelId, operator) {
  const email = (operator.email || '').toLowerCase();
  const { opRole } = ghostRoleFor(operator.platform_role);
  // What the owner has decided this operator may be in THIS workspace. Applied
  // on every entry, so a change to the setting takes hold the next time they go
  // in — and, because auth.js overlays the live role from the users row on every
  // request, a demotion written to an existing ghost bites immediately.
  const ghostRole = await workspaceRoleFor(operator, labelId);

  const existing = await pool.query(
    `SELECT ${GHOST_COLS} FROM users WHERE label_id = $1 AND LOWER(email) = $2`,
    [labelId, email]
  );
  if (existing.rows.length) {
    const target = existing.rows[0];
    if (target.role !== ghostRole || !target.is_platform_admin || target.platform_role !== opRole) {
      await pool.query('UPDATE users SET role = $1, is_platform_admin = true, platform_role = $2 WHERE id = $3',
        [ghostRole, opRole, target.id]);
      target.role = ghostRole; target.is_platform_admin = true; target.platform_role = opRole;
    }
    return target;
  }

  const ins = await pool.query(
    `INSERT INTO users (label_id, name, email, role, department, hierarchy_level, is_platform_admin, platform_role, created_at)
     VALUES ($1, $2, $3, $4, 'Platform', 0, true, $5, NOW())
     RETURNING ${GHOST_COLS}`,
    [labelId, operator.name || 'Platform Admin', email, ghostRole, opRole]
  );
  return ins.rows[0];
}

/**
 * Every user id this operator holds, across every workspace. The set that makes
 * "my tasks" answerable cross-tenant.
 *
 * Deliberately NOT scoped by the workspace allowlist: callers scope their own
 * query on `tasks.label_id`, which is the column an allowlist is about. Mixing
 * the two here would hide a row from a caller that had already narrowed it.
 */
async function ghostIds(email) {
  const { rows } = await pool.query(
    'SELECT id, label_id FROM users WHERE LOWER(email) = $1 AND is_platform_admin = true',
    [(email || '').toLowerCase()]
  );
  return rows;
}

module.exports = { ensureGhost, ghostIds, ghostRoleFor, GHOST_COLS };

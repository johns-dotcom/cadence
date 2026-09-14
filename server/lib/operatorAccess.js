/**
 * Operator access — the one definition of "which workspaces may this operator
 * see?".
 *
 * Extracted out of routes/platform.js when a second cross-tenant surface
 * (workspace message boards) needed the same answer. Two copies of a
 * visibility rule is how a page ends up showing a workspace another page has
 * blocked, which is precisely the leak the console just finished closing.
 *
 * The model is an ALLOWLIST keyed by operator EMAIL (an operator spans many
 * per-label ghost rows, so an id would not identify them). An operator with
 * ANY rows is confined to that list; no rows at all means unrestricted.
 * Owners are never restricted.
 */
const pool = require('../db');

async function operatorAccess(email) {
  const e = (email || '').toLowerCase();
  const [ws, pg] = await Promise.all([
    pool.query('SELECT label_id FROM operator_workspace_access WHERE operator_email = $1', [e]),
    pool.query('SELECT page FROM operator_page_access WHERE operator_email = $1', [e]),
  ]);
  return {
    workspaces: ws.rows.length ? ws.rows.map(r => r.label_id) : null, // null = all
    pages: pg.rows.length ? pg.rows.map(r => r.page) : null,          // null = all
  };
}

// The workspace ids this operator may SEE, or null for "no restriction".
//
// The allowlist used to gate only /enter and the member mutations, so a
// restricted admin still read counts and audit lines for workspaces they were
// explicitly blocked from. Visibility and reachability are now the same
// answer. Owners are never restricted.
//
// Note operatorAccess() collapses "no rows" to null, so this never returns an
// empty array by accident — an empty allowlist would mean "nothing", and
// conflating that with "everything" is the classic inverse-state bug.
async function accessibleLabelIds(req) {
  if (req.user.platform_role === 'owner') return null;
  const access = await operatorAccess(req.user.email);
  return access.workspaces;
}

// True when this operator may act on one specific workspace. Used where the
// caller already knows the id (a channel's label) rather than building a WHERE.
async function canAccessLabel(req, labelId) {
  const ids = await accessibleLabelIds(req);
  return !ids || ids.includes(Number(labelId));
}

// Append ` AND <col> = ANY($n)` when the operator is restricted, pushing the id
// array onto `params`. A no-op when unrestricted, so callers read the same
// either way. `= ANY(empty)` matches nothing, which is the correct reading of
// an explicitly-empty allowlist.
function scopeClause(ids, col, params) {
  if (!ids) return '';
  params.push(ids);
  return ` AND ${col} = ANY($${params.length}::int[])`;
}

module.exports = { operatorAccess, accessibleLabelIds, canAccessLabel, scopeClause };

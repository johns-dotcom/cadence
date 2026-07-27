// Safe user deletion: guard rails + a DYNAMIC foreign-key sweep so we never
// hand-enumerate referencing tables (they drift). Discovers every FK pointing
// at users.id via information_schema and, in one transaction, nulls the
// nullable references / deletes the NOT-NULL ones, then removes the user.

const pool = require('../db');

// Returns { ok } or { ok:false, status, error } for the guard checks.
// actor = req.user (needs id + role); labelId scopes everything.
async function checkUserDeletable(labelId, actor, targetId) {
  if (targetId === actor.id) return { ok: false, status: 400, error: 'You cannot remove yourself' };
  const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1 AND label_id = $2', [targetId, labelId]);
  if (!rows.length) return { ok: false, status: 404, error: 'User not found' };
  const target = rows[0];

  // Only a Superadmin may delete an Admin or another Superadmin.
  if ((target.role === 'Admin' || target.role === 'Superadmin') && actor.role !== 'Superadmin') {
    return { ok: false, status: 403, error: `Only a Superadmin can delete a ${target.role}` };
  }
  // Never delete the last Superadmin in a workspace.
  if (target.role === 'Superadmin') {
    const { rows: c } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE label_id = $1 AND role = 'Superadmin'`, [labelId]);
    if (c[0].n <= 1) return { ok: false, status: 400, error: 'Cannot delete the last Superadmin in this workspace' };
  }
  return { ok: true, target };
}

// Delete a user, sweeping FK references dynamically inside a transaction.
async function deleteUserWithSweep(labelId, targetId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Every FK column that references users.id.
    const { rows: refs } = await client.query(`
      SELECT tc.table_name, kcu.column_name, col.is_nullable
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        JOIN information_schema.columns col
          ON col.table_name = tc.table_name AND col.column_name = kcu.column_name AND col.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND ccu.table_name = 'users' AND ccu.column_name = 'id'`);

    for (const r of refs) {
      // Identifiers come from the catalog, not user input — safe to interpolate.
      if (r.is_nullable === 'YES') {
        await client.query(`UPDATE "${r.table_name}" SET "${r.column_name}" = NULL WHERE "${r.column_name}" = $1`, [targetId]);
      } else {
        await client.query(`DELETE FROM "${r.table_name}" WHERE "${r.column_name}" = $1`, [targetId]);
      }
    }
    const { rowCount } = await client.query('DELETE FROM users WHERE id = $1 AND label_id = $2', [targetId, labelId]);
    await client.query('COMMIT');
    return { deleted: rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { checkUserDeletable, deleteUserWithSweep };

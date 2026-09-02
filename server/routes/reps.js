const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');

const router = express.Router();
router.use(authMiddleware, withTenant);

// GET /api/reps — the workspace's rep list. Any authenticated member can read
// it (the names populate dropdowns); only admins mutate it. ?all=1 includes
// deactivated reps (for the management screen).
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.all === '1';
    const { rows } = await pool.query(
      `SELECT id, name, email, active FROM reps
       WHERE label_id = $1 ${includeInactive ? '' : 'AND active = TRUE'}
       ORDER BY active DESC, LOWER(name)`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List reps error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/reps — add a rep (admin).
// Re-adding a DEACTIVATED name reactivates it rather than erroring: the rep
// roster is a set of names, and "already exists" for a struck-through row an
// admin can't see in the picker is an answer they can't act on.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Name is required' });
    if (name.length > 120) return res.status(400).json({ success: false, error: 'Name is too long' });

    const existing = await pool.query(
      'SELECT id, name, active FROM reps WHERE label_id = $1 AND LOWER(name) = LOWER($2)',
      [req.labelId, name]
    );
    if (existing.rows.length) {
      const rep = existing.rows[0];
      if (rep.active) return res.status(400).json({ success: false, error: 'That rep already exists' });
      const { rows } = await pool.query(
        'UPDATE reps SET active = TRUE, name = $1 WHERE id = $2 AND label_id = $3 RETURNING id, name, active',
        [name, rep.id, req.labelId]
      );
      await logActivity(req, 'Reactivated rep', name);
      return res.json({ success: true, data: rows[0], reactivated: true });
    }

    const { rows } = await pool.query(
      `INSERT INTO reps (label_id, name) VALUES ($1, $2) RETURNING id, name, active`,
      [req.labelId, name]
    );
    await logActivity(req, 'Added rep', name);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'That rep already exists' });
    console.error('Create rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/reps/:id — rename or (de)activate (admin). Deactivating keeps the
// name on historical records but hides it from new dropdowns.
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const fields = [];
    const values = [];
    if (typeof req.body.name === 'string' && req.body.name.trim()) { fields.push(`name = $${fields.length + 1}`); values.push(req.body.name.trim()); }
    if (typeof req.body.active === 'boolean') { fields.push(`active = $${fields.length + 1}`); values.push(req.body.active); }
    if (!fields.length) return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    values.push(parseInt(req.params.id, 10), req.labelId);
    const { rows } = await pool.query(
      `UPDATE reps SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND label_id = $${values.length} RETURNING id, name, active`,
      values
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Rep not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ success: false, error: 'That rep already exists' });
    console.error('Update rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/reps/:id — remove a rep (admin), but ONLY one that was never used.
//
// `expenses.rep`, `deals.ar_rep` and `user_visible_reps.rep_name` all store the
// NAME as a string, not a foreign key. Deleting a rep who appears on historical
// records doesn't orphan a join — it makes the name unmanageable: it keeps
// showing on old rows while vanishing from the roster, so nobody can reactivate
// it, rename it, or grant visibility on it again. A referenced rep is
// deactivated instead, which is the reversible version of the same intent.
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Invalid rep' });

    const { rows: found } = await pool.query('SELECT id, name FROM reps WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    if (!found.length) return res.status(404).json({ success: false, error: 'Rep not found' });
    const name = found[0].name;

    const { rows: use } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM expenses WHERE label_id = $1 AND LOWER(rep) = LOWER($2))::int AS expenses,
              (SELECT COUNT(*) FROM deals WHERE label_id = $1 AND LOWER(ar_rep) = LOWER($2))::int AS deals,
              (SELECT COUNT(*) FROM user_visible_reps WHERE label_id = $1 AND LOWER(rep_name) = LOWER($2))::int AS visibility`,
      [req.labelId, name]
    );
    const u = use[0] || {};
    const referenced = (u.expenses || 0) + (u.deals || 0) + (u.visibility || 0);
    if (referenced > 0) {
      // Do the reversible thing rather than nothing: the admin's intent was
      // "stop offering this name", and that IS deactivation.
      await pool.query('UPDATE reps SET active = FALSE WHERE id = $1 AND label_id = $2', [id, req.labelId]);
      await logActivity(req, 'Deactivated rep', `${name} (in use on ${referenced} record(s))`);
      return res.status(409).json({
        success: false,
        deactivated: true,
        error: `${name} appears on ${referenced} existing record${referenced === 1 ? '' : 's'}, so the name was deactivated instead of deleted.`,
        usage: u,
      });
    }

    await pool.query('DELETE FROM reps WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await logActivity(req, 'Removed rep', name);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete rep error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

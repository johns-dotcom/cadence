const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');

const router = express.Router();
router.use(authMiddleware, withTenant);

// The workspace's department vocabulary.
//
// Reading is open to any signed-in member: five surfaces render a department
// picker or group by one (Team, Activity, Salary, My Work, the access editor),
// and gating the LIST behind admin would leave a plain User looking at an empty
// dropdown for a field they are expected to filter by.
//
// Writing is admin-only. Note what this table is NOT: `users.department` stays
// a plain VARCHAR and is still the source of truth for who is in what. This is
// the vocabulary, so renaming or deleting a department can never orphan a
// person — see the comment on the table in index.js.

const NAME_MAX = 100;

const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Returns an error sentence, or null. */
function validateName(name) {
  if (!name) return 'A department needs a name';
  if (name.length > NAME_MAX) return `Name must be ${NAME_MAX} characters or fewer`;
  return null;
}

function intOr(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) ? n : fallback;
}

// GET /api/departments — the list, plus how many people are in each.
// The count is what makes a delete decision possible without a second call.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.sort_order, d.default_hierarchy,
              (SELECT COUNT(*)::int FROM users u
                WHERE u.label_id = d.label_id AND u.department = d.name) AS member_count
         FROM label_departments d
        WHERE d.label_id = $1
        ORDER BY d.sort_order, d.name`,
      [req.labelId]
    );

    // Departments people are actually in that the vocabulary has lost — a value
    // typed into the Salary datalist before this table existed, or one deleted
    // while someone still carried it. Surfaced rather than hidden: an admin
    // reading this list should see every value the roster can show them.
    const { rows: orphans } = await pool.query(
      `SELECT u.department AS name, COUNT(*)::int AS member_count
         FROM users u
        WHERE u.label_id = $1
          AND u.department IS NOT NULL AND btrim(u.department) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM label_departments d
             WHERE d.label_id = u.label_id AND d.name = u.department)
        GROUP BY u.department
        ORDER BY u.department`,
      [req.labelId]
    );

    res.json({ success: true, data: rows, unlisted: orphans });
  } catch (error) {
    console.error('List departments error:', error);
    res.status(500).json({ success: false, error: 'Failed to load departments' });
  }
});

// POST /api/departments
router.post('/', requireAdmin, async (req, res) => {
  try {
    const name = clean(req.body.name);
    const bad = validateName(name);
    if (bad) return res.status(400).json({ success: false, error: bad });

    const { rows } = await pool.query(
      `INSERT INTO label_departments (label_id, name, sort_order, default_hierarchy)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (label_id, name) DO NOTHING
       RETURNING id, name, sort_order, default_hierarchy`,
      [req.labelId, name, intOr(req.body.sort_order, 100), intOr(req.body.default_hierarchy, 99)]
    );
    // DO NOTHING returns no row — the name is already in this workspace's list.
    if (!rows.length) {
      return res.status(409).json({ success: false, error: `"${name}" is already a department` });
    }
    res.status(201).json({ success: true, data: { ...rows[0], member_count: 0 } });
  } catch (error) {
    console.error('Create department error:', error);
    res.status(500).json({ success: false, error: 'Failed to create department' });
  }
});

// PATCH /api/departments/:id — rename, reorder, or change the seeded hierarchy.
//
// A rename carries the people with it, in one transaction. The alternative —
// renaming the vocabulary and leaving `users.department` on the old string —
// would empty a department in the UI while every one of its members still
// reported the old value to My Work and Salary.
router.patch('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT name FROM label_departments WHERE id = $1 AND label_id = $2 FOR UPDATE',
      [id, req.labelId]
    );
    if (!cur.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Department not found' });
    }
    const oldName = cur[0].name;

    const fields = [];
    const values = [];
    let renamedTo = null;

    if (req.body.name !== undefined) {
      const name = clean(req.body.name);
      const bad = validateName(name);
      if (bad) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: bad }); }
      if (name !== oldName) {
        const { rows: clash } = await client.query(
          'SELECT 1 FROM label_departments WHERE label_id = $1 AND name = $2 AND id <> $3',
          [req.labelId, name, id]
        );
        if (clash.length) {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, error: `"${name}" is already a department` });
        }
        renamedTo = name;
      }
      values.push(name); fields.push(`name = $${values.length}`);
    }
    if (req.body.sort_order !== undefined) {
      values.push(intOr(req.body.sort_order, 100)); fields.push(`sort_order = $${values.length}`);
    }
    if (req.body.default_hierarchy !== undefined) {
      values.push(intOr(req.body.default_hierarchy, 99)); fields.push(`default_hierarchy = $${values.length}`);
    }
    if (!fields.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'No updatable fields provided' });
    }

    values.push(id, req.labelId);
    const { rows } = await client.query(
      `UPDATE label_departments SET ${fields.join(', ')}
        WHERE id = $${values.length - 1} AND label_id = $${values.length}
        RETURNING id, name, sort_order, default_hierarchy`,
      values
    );

    let moved = 0;
    if (renamedTo) {
      const r = await client.query(
        'UPDATE users SET department = $1 WHERE label_id = $2 AND department = $3',
        [renamedTo, req.labelId, oldName]
      );
      moved = r.rowCount;
    }

    await client.query('COMMIT');
    res.json({ success: true, data: rows[0], moved });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Update department error:', error);
    res.status(500).json({ success: false, error: 'Failed to update department' });
  } finally {
    client.release();
  }
});

// DELETE /api/departments/:id
//
// Refuses while anyone is still in it, and says how many. Deleting the
// vocabulary entry would not remove anyone from the department — it would just
// stop the app naming it, leaving those people in a group no picker offers and
// no admin can find. `?reassign=<name|none>` is the explicit way through.
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT name FROM label_departments WHERE id = $1 AND label_id = $2 FOR UPDATE',
      [id, req.labelId]
    );
    if (!cur.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Department not found' });
    }
    const name = cur[0].name;

    const { rows: [{ count }] } = await client.query(
      'SELECT COUNT(*)::int AS count FROM users WHERE label_id = $1 AND department = $2',
      [req.labelId, name]
    );

    const reassign = req.query.reassign === undefined ? null : String(req.query.reassign);
    if (count > 0 && reassign === null) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `${count} ${count === 1 ? 'person is' : 'people are'} in ${name}. Move them first, or say where they should go.`,
        member_count: count,
      });
    }

    if (count > 0) {
      if (reassign === 'none' || reassign === '') {
        await client.query(
          'UPDATE users SET department = NULL WHERE label_id = $1 AND department = $2',
          [req.labelId, name]
        );
      } else {
        const target = clean(reassign);
        const { rows: ok } = await client.query(
          'SELECT 1 FROM label_departments WHERE label_id = $1 AND name = $2',
          [req.labelId, target]
        );
        if (!ok.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: `"${target}" is not a department in this workspace` });
        }
        await client.query(
          'UPDATE users SET department = $1 WHERE label_id = $2 AND department = $3',
          [target, req.labelId, name]
        );
      }
    }

    await client.query('DELETE FROM label_departments WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await client.query('COMMIT');
    res.json({ success: true, data: { id }, moved: count });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Delete department error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete department' });
  } finally {
    client.release();
  }
});

module.exports = router;

// Per-label category vocabulary — the data-driven replacement for the
// hardcoded EXPENSE_CATEGORIES constant.
//
// GET is open to every workspace member (pickers everywhere need it); writes
// are admin-only. The vendor form is UNAUTHENTICATED and gets categories via
// the vendor-form bootstrap payload in routes/vendor.js, not from here.
//
// Ordering: real usage first (a picker should lead with what this label
// actually books), seed order as the tiebreak, name last. The client renders
// grouped <optgroup>s from `*_groups`, and `*_order` is groups.flatMap(items)
// AND NOTHING ELSE — the review deck's 1-9 hotkeys index into that flat
// order, and two separately-derived orders have already drifted once in the
// reference app ("1 · Recording" in the menu while pressing 1 picked
// something else).

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { SECTION_KEYS, SECTION_LABELS, INCOME_GROUP_LABELS } = require('../lib/seedCategories');

const router = express.Router();
router.use(authMiddleware, withTenant);

const INCOME_GROUP_KEYS = ['earnings', 'recoveries', 'other'];

function shape(rows, kind) {
  const keys = kind === 'income' ? INCOME_GROUP_KEYS : SECTION_KEYS;
  const labels = kind === 'income' ? INCOME_GROUP_LABELS : SECTION_LABELS;
  const buckets = new Map(keys.map((k) => [k, []]));
  const last = keys[keys.length - 1];
  for (const r of rows) {
    const g = buckets.has(r.ui_group) ? r.ui_group : last; // unknown/NULL → LAST group, never dropped
    buckets.get(g).push(r.name);
  }
  const groups = keys
    .map((k) => ({ key: k, label: labels[k] || k, items: buckets.get(k) }))
    .filter((g) => g.items.length);
  return { groups, order: groups.flatMap((g) => g.items) };
}

// GET /api/categories — the live vocabulary, usage-first within seed order.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.kind, c.name, c.ui_group, c.report_section, c.contra_of, c.seeded, c.sort_order,
              COALESCE(u.n, 0) AS usage
         FROM categories c
         LEFT JOIN LATERAL (
           SELECT CASE WHEN c.kind = 'expense' THEN
             (SELECT COUNT(*)::int FROM expenses e
               WHERE e.label_id = c.label_id
                 AND LOWER(TRIM(e.category)) = LOWER(TRIM(c.name))
                 AND e.created_at > NOW() - INTERVAL '12 months')
           ELSE
             (SELECT COUNT(*)::int FROM artist_income i
               WHERE i.label_id = c.label_id
                 AND LOWER(TRIM(i.source)) = LOWER(TRIM(c.name))
                 AND i.created_at > NOW() - INTERVAL '12 months')
           END AS n
         ) u ON TRUE
        WHERE c.label_id = $1 AND c.active = TRUE
        ORDER BY c.kind, COALESCE(u.n, 0) DESC, c.sort_order ASC NULLS LAST, c.name`,
      [req.labelId]
    );
    const expense = rows.filter((r) => r.kind === 'expense');
    const income = rows.filter((r) => r.kind === 'income');
    const eg = shape(expense, 'expense');
    const ig = shape(income, 'income');
    res.json({
      success: true,
      data: {
        expense: eg.order,
        income: ig.order,
        expense_groups: eg.groups,
        income_groups: ig.groups,
        expense_order: eg.order,
        income_order: ig.order,
        // Section metadata for consumers that need it (Reports classify UI).
        meta: rows.map((r) => ({
          kind: r.kind, name: r.name, ui_group: r.ui_group,
          report_section: r.report_section, contra_of: r.contra_of, seeded: r.seeded,
        })),
        custom: rows.filter((r) => !r.seeded).map((r) => ({ kind: r.kind, name: r.name })),
      },
    });
  } catch (err) {
    console.error('categories list error:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
  }
});

// POST /api/categories { kind, name } — create, or reactivate an inactive one.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const kind = req.body.kind === 'income' ? 'income' : 'expense';
    const name = String(req.body.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 64) {
      return res.status(400).json({ success: false, error: 'Category names are 2-64 characters' });
    }
    const existing = await pool.query(
      `SELECT id, name, active FROM categories
        WHERE label_id = $1 AND kind = $2 AND LOWER(TRIM(name)) = LOWER($3)`,
      [req.labelId, kind, name]
    );
    if (existing.rows.length) {
      const row = existing.rows[0];
      if (row.active) {
        return res.status(409).json({ success: false, error: `"${row.name}" already exists` });
      }
      await pool.query(`UPDATE categories SET active = TRUE WHERE id = $1 AND label_id = $2`, [row.id, req.labelId]);
      await logActivity(req, `reactivated category "${row.name}"`, kind);
      return res.json({ success: true, data: { name: row.name, reactivated: true } });
    }
    const maxOrder = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories WHERE label_id = $1 AND kind = $2`,
      [req.labelId, kind]
    );
    await pool.query(
      `INSERT INTO categories (label_id, kind, name, active, seeded, sort_order, ui_group, created_by)
       VALUES ($1, $2, $3, TRUE, FALSE, $4, $5, $6)`,
      [req.labelId, kind, name, maxOrder.rows[0].next, kind === 'income' ? 'other' : 'other', req.user.name]
    );
    await logActivity(req, `added category "${name}"`, kind);
    res.json({ success: true, data: { name } });
  } catch (err) {
    console.error('categories create error:', err);
    res.status(500).json({ success: false, error: 'Failed to add category' });
  }
});

// PATCH /api/categories { kind, name, active, ui_group?, confirm_in_use? }
// Deactivating a category with live rows requires confirm_in_use — the
// reference app once hid "Marketing" while 1,349 live rows carried it, making
// recategorization impossible. Usage is counted FIRST and decides the write.
router.patch('/', requireAdmin, async (req, res) => {
  try {
    const kind = req.body.kind === 'income' ? 'income' : 'expense';
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Category name required' });

    const sets = [];
    const params = [req.labelId, kind, name];
    let p = params.length;

    if (typeof req.body.active === 'boolean') {
      if (req.body.active === false) {
        const usage = kind === 'expense'
          ? await pool.query(
              `SELECT COUNT(*)::int AS n FROM expenses
                WHERE label_id = $1 AND LOWER(TRIM(category)) = LOWER($2)
                  AND (deleted IS NULL OR deleted = FALSE)`,
              [req.labelId, name]
            )
          : await pool.query(
              `SELECT COUNT(*)::int AS n FROM artist_income
                WHERE label_id = $1 AND LOWER(TRIM(source)) = LOWER($2)`,
              [req.labelId, name]
            );
        const n = usage.rows[0].n;
        if (n > 0 && req.body.confirm_in_use !== true) {
          return res.status(400).json({
            success: false,
            error: `"${name}" is on ${n} live ${n === 1 ? 'row' : 'rows'}. Deactivating hides it from pickers but never rewrites those rows — pass confirm_in_use to proceed.`,
            in_use: n,
          });
        }
      }
      sets.push(`active = $${++p}`);
      params.push(req.body.active);
    }
    if (req.body.ui_group !== undefined) {
      const g = String(req.body.ui_group || 'other');
      const valid = kind === 'income' ? INCOME_GROUP_KEYS : SECTION_KEYS;
      if (!valid.includes(g)) return res.status(400).json({ success: false, error: `ui_group must be one of: ${valid.join(', ')}` });
      sets.push(`ui_group = $${++p}`, `section_set = TRUE`);
      params.push(g);
    }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });

    const { rowCount } = await pool.query(
      `UPDATE categories SET ${sets.join(', ')}
        WHERE label_id = $1 AND kind = $2 AND LOWER(TRIM(name)) = LOWER($3)`,
      params
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'No such category' });
    await logActivity(req, `updated category "${name}"`, JSON.stringify(req.body));
    res.json({ success: true });
  } catch (err) {
    console.error('categories patch error:', err);
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
});

module.exports = router;

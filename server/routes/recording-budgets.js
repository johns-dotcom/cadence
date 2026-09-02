// Recording budgets — the label's Recording Budget / Fund / Costs-to-Date
// Excel templates as a first-class document.
//
// A budget is TYPED (budget | fund) and identified by its artist + project,
// not by an invented title. Line items are quantity-driven (amount = qty ×
// unit_price) because that is how the templates read: "10 tracks × $1,500".
// Lifecycle draft → approved → locked; approved still allows line-item edits
// (that is the point of approving before locking), locked freezes everything
// including DELETE.
//
// Costs-to-Date groups planned and actual by LEDGER CATEGORY, not by the six
// template sections, because that is the vocabulary the money is already
// filed under. A line item's category is explicit or defaulted from its
// section; an expense's category is its own, overridable per row via
// expenses.budget_section_override.
const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { rowUsd2 } = require('../lib/usd');
const RB = require('../lib/recordingBudget');
const { round2, lineAmount, budgetTotals, costsSummary } = RB;

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

const TYPES = ['budget', 'fund'];

// Section catalog — keys match the Excel templates. The client renders them in
// this order; this Set is the validation source of truth (a free-text section
// silently defaulting to 'other' is how a typo becomes an invisible line).
const { SECTIONS, SECTION_TO_DEFAULT_CATEGORY } = RB;
const SECTION_SET = new Set(SECTIONS);

const intOf = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const numOr = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// Ledger categories the override dropdown offers, READ FROM THE TABLE — the
// per-label vocabulary, never a constant. Falls open (empty list) on a read
// failure rather than emptying every dropdown with an error.
async function ledgerCategoryLabels(labelId) {
  try {
    const { rows } = await pool.query(
      `SELECT name FROM categories WHERE label_id = $1 AND kind = 'expense' AND active = TRUE
        ORDER BY sort_order ASC NULLS LAST, name ASC`, [labelId]);
    return rows.map(r => r.name);
  } catch (err) {
    console.error('category labels unavailable:', err.message);
    return [];
  }
}

// Is this a category this label offers? Falls OPEN on a read failure —
// refusing every override because a SELECT failed is worse than accepting one
// that is unusual. The table lists options; it never constrains stored data.
async function isKnownCategory(labelId, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM categories WHERE label_id = $1 AND kind = 'expense'
        AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1`, [labelId, v]);
    return rows.length > 0;
  } catch (err) {
    console.error('category validation unavailable — accepting the override:', err.message);
    return true;
  }
}

// Every line-item write touches the parent so `updated_at DESC` floats the
// budget someone is actively working on back to the top of the index.
const touch = (labelId, id, who) => pool.query(
  `UPDATE recording_budgets SET updated_at = NOW(), updated_by = $1 WHERE id = $2 AND label_id = $3`,
  [who || null, id, labelId]);

async function loadBudget(labelId, id) {
  const { rows } = await pool.query('SELECT * FROM recording_budgets WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows[0] || null;
}

// ── GET / — index with rolled-up header stats ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.artist_id, b.release_id, b.artist_name, b.project_title,
              COALESCE(a.name, b.artist_name) AS artist_display,
              r.project_name AS release_display,
              b.type, b.currency, b.advance_amount, b.fund_amount,
              b.proposed_tracks, b.contingency_pct, b.status, b.notes,
              b.created_by, b.approved_by, b.approved_at, b.locked_by, b.locked_at,
              b.created_at, b.updated_at,
              COALESCE((SELECT SUM(li.amount) FROM recording_budget_items li
                         WHERE li.budget_id = b.id AND li.label_id = b.label_id), 0)::float AS sections_subtotal,
              (SELECT COUNT(*) FROM recording_budget_items li
                WHERE li.budget_id = b.id AND li.label_id = b.label_id)::int AS line_item_count
         FROM recording_budgets b
         LEFT JOIN artists a ON a.id = b.artist_id AND a.label_id = b.label_id
         LEFT JOIN releases r ON r.id = b.release_id AND r.label_id = b.label_id
        WHERE b.label_id = $1
        ORDER BY b.updated_at DESC NULLS LAST, b.id DESC`,
      [req.labelId]
    );
    // The SQL already summed the lines; feed it back through budgetTotals as a
    // single pre-summed line so the index and the detail page compute
    // contingency and total through the exact same function.
    const data = rows.map(r => {
      const { section_totals, ...totals } = budgetTotals([{ section: 'other', amount: r.sections_subtotal }], r.contingency_pct);
      return { ...r, ...totals };
    });
    res.json({ success: true, data });
  } catch (error) { console.error('Budgets list error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── GET /:id — full budget, ALL SIX sections always present ────────────────
// The client's grid renders six cards whether or not they hold items; making
// the server always emit them means the client never has to invent a shape.
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const { rows: brows } = await pool.query(
      `SELECT b.*, COALESCE(a.name, b.artist_name) AS artist_display, r.project_name AS release_display
         FROM recording_budgets b
         LEFT JOIN artists a ON a.id = b.artist_id AND a.label_id = b.label_id
         LEFT JOIN releases r ON r.id = b.release_id AND r.label_id = b.label_id
        WHERE b.id = $1 AND b.label_id = $2`, [id, req.labelId]);
    if (!brows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    const { rows: items } = await pool.query(
      `SELECT id, section, description, category, qty, unit_price, amount, notes, sort_order
         FROM recording_budget_items WHERE budget_id = $1 AND label_id = $2
        ORDER BY section, sort_order, id`, [id, req.labelId]);

    const bySection = Object.fromEntries(SECTIONS.map(s => [s, []]));
    for (const it of items) if (bySection[it.section]) bySection[it.section].push(it);
    res.json({ success: true, data: {
      ...brows[0],
      sections: bySection,
      ...budgetTotals(items, brows[0].contingency_pct),
    } });
  } catch (error) { console.error('Budget detail error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── POST / — a blank draft is valid ────────────────────────────────────────
// Every field is optional: "New budget" creates the document and drops you
// into it, where the header grid IS the form. Contingency defaults to 7.5%,
// the label's standard.
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.type || 'budget';
    if (!TYPES.includes(type)) return res.status(400).json({ success: false, error: 'type must be budget or fund' });
    const artistId = await inTenantArtist(req.labelId, b.artist_id);
    const releaseId = await inTenantRelease(req.labelId, b.release_id);
    const { rows } = await pool.query(
      `INSERT INTO recording_budgets
         (label_id, artist_id, release_id, artist_name, project_title, type, currency,
          advance_amount, fund_amount, proposed_tracks, contingency_pct, notes, created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,NOW()) RETURNING *`,
      [req.labelId, artistId, releaseId,
        (b.artist_name || '').trim() || null, (b.project_title || '').trim() || null,
        type, (b.currency || 'USD').toUpperCase().slice(0, 3),
        numOr(b.advance_amount), numOr(b.fund_amount),
        b.proposed_tracks ? intOf(b.proposed_tracks) : null,
        b.contingency_pct === undefined || b.contingency_pct === '' ? 7.5 : numOr(b.contingency_pct, 7.5),
        (b.notes || '').trim() || null, req.user.name]
    );
    await logActivity(req, 'Created recording budget', rows[0].artist_name || rows[0].project_title || `#${rows[0].id}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { console.error('Create budget error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// Client-supplied FKs are re-validated against the label before they are
// stored — an id from another tenant must never land in a row here.
async function inTenantArtist(labelId, v) {
  const id = intOf(v);
  if (!id) return null;
  const { rows } = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length ? id : null;
}
async function inTenantRelease(labelId, v) {
  const id = intOf(v);
  if (!id) return null;
  const { rows } = await pool.query('SELECT 1 FROM releases WHERE id = $1 AND label_id = $2', [id, labelId]);
  return rows.length ? id : null;
}

// ── PUT/PATCH /:id — partial header update ─────────────────────────────────
const HEADER_FIELDS = ['artist_id', 'release_id', 'artist_name', 'project_title', 'type',
  'currency', 'advance_amount', 'fund_amount', 'proposed_tracks', 'contingency_pct', 'notes'];

async function updateHeader(req, res) {
  try {
    const id = intOf(req.params.id);
    const cur = await loadBudget(req.labelId, id);
    if (!cur) return res.status(404).json({ success: false, error: 'Budget not found' });
    if (cur.status === 'locked') return res.status(403).json({ success: false, error: 'Budget is locked — unlock to edit' });
    const body = req.body || {};
    if (body.type !== undefined && !TYPES.includes(body.type)) {
      return res.status(400).json({ success: false, error: 'type must be budget or fund' });
    }
    const sets = [], params = [];
    for (const f of HEADER_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
      let v = body[f] === '' ? null : body[f];
      if (f === 'artist_id') v = await inTenantArtist(req.labelId, v);
      if (f === 'release_id') v = await inTenantRelease(req.labelId, v);
      if (f === 'currency' && v) v = String(v).toUpperCase().slice(0, 3);
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    if (!sets.length) return res.json({ success: true, data: cur });
    params.push(req.user.name);
    sets.push(`updated_by = $${params.length}`, 'updated_at = NOW()');
    params.push(id, req.labelId);
    const { rows } = await pool.query(
      `UPDATE recording_budgets SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND label_id = $${params.length} RETURNING *`,
      params);
    res.json({ success: true, data: rows[0] });
  } catch (error) { console.error('Update budget error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
}
router.put('/:id(\\d+)', updateHeader);
router.patch('/:id(\\d+)', updateHeader);

// ── DELETE /:id — refused on a locked budget ───────────────────────────────
// Without this guard the ONE mutation a frozen budget accepts is destruction.
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const cur = await loadBudget(req.labelId, id);
    if (!cur) return res.status(404).json({ success: false, error: 'Budget not found' });
    if (cur.status === 'locked') return res.status(403).json({ success: false, error: 'Budget is locked — unlock to delete' });
    await pool.query('DELETE FROM recording_budgets WHERE id = $1 AND label_id = $2', [id, req.labelId]);
    await logActivity(req, 'Deleted recording budget', cur.artist_name || cur.project_title || `#${id}`);
    res.json({ success: true });
  } catch (error) { console.error('Delete budget error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── Lifecycle: approve · lock · reopen ─────────────────────────────────────
// Reopen NULLs both stamp pairs. Leaving an approved_by behind on a draft
// makes the audit trail claim an approval that was withdrawn.
const TRANSITIONS = {
  approve: { status: 'approved', sql: `status='approved', approved_by=$1, approved_at=NOW()` },
  lock: { status: 'locked', sql: `status='locked', locked_by=$1, locked_at=NOW()` },
  reopen: { status: 'draft', sql: `status='draft', approved_by=NULL, approved_at=NULL, locked_by=NULL, locked_at=NULL` },
};

async function transition(req, res, verb) {
  try {
    const t = TRANSITIONS[verb];
    if (!t) return res.status(400).json({ success: false, error: 'Invalid transition' });
    const id = intOf(req.params.id);
    const { rows } = await pool.query(
      `UPDATE recording_budgets SET ${t.sql}, updated_by = $1, updated_at = NOW()
        WHERE id = $2 AND label_id = $3 RETURNING *`,
      [req.user.name, id, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Budget not found' });
    await logActivity(req, `Recording budget ${t.status}`, rows[0].artist_name || rows[0].project_title || `#${id}`);
    res.json({ success: true, data: rows[0] });
  } catch (error) { console.error('Budget transition error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
}
router.post('/:id(\\d+)/approve', (req, res) => transition(req, res, 'approve'));
router.post('/:id(\\d+)/lock', (req, res) => transition(req, res, 'lock'));
router.post('/:id(\\d+)/reopen', (req, res) => transition(req, res, 'reopen'));
// Back-compat with the pre-9.5 single-endpoint shape.
router.post('/:id(\\d+)/status', (req, res) => {
  const verb = { approved: 'approve', locked: 'lock', draft: 'reopen' }[req.body?.status];
  if (!verb) return res.status(400).json({ success: false, error: 'Invalid status' });
  return transition(req, res, verb);
});

// ── Line items — qty × unit_price ──────────────────────────────────────────
async function assertEditable(labelId, id) {
  const cur = await loadBudget(labelId, id);
  if (!cur) return { code: 404, error: 'Budget not found' };
  if (cur.status === 'locked') return { code: 403, error: 'Budget is locked' };
  return null;
}

router.post('/:id(\\d+)/line-items', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const bad = await assertEditable(req.labelId, id);
    if (bad) return res.status(bad.code).json({ success: false, error: bad.error });
    const b = req.body || {};
    if (!SECTION_SET.has(b.section)) return res.status(400).json({ success: false, error: 'Invalid section' });
    const qty = numOr(b.qty, 0);
    const unitPrice = numOr(b.unit_price, 0);
    const { rows } = await pool.query(
      `INSERT INTO recording_budget_items
         (label_id, budget_id, section, description, category, qty, unit_price, amount, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.labelId, id, b.section, (b.description || '').trim(), (b.category || '').trim() || null,
        qty, unitPrice, lineAmount(qty, unitPrice), (b.notes || '').trim() || null, intOf(b.sort_order) || 0]);
    await touch(req.labelId, id, req.user.name);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { console.error('Add line item error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.put('/:id(\\d+)/line-items/:itemId(\\d+)', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const itemId = intOf(req.params.itemId);
    const bad = await assertEditable(req.labelId, id);
    if (bad) return res.status(bad.code).json({ success: false, error: bad.error });
    const { rows: cur } = await pool.query(
      'SELECT * FROM recording_budget_items WHERE id = $1 AND budget_id = $2 AND label_id = $3',
      [itemId, id, req.labelId]);
    if (!cur.length) return res.status(404).json({ success: false, error: 'Line item not found' });
    const ex = cur[0], b = req.body || {};
    const has = (f) => Object.prototype.hasOwnProperty.call(b, f);
    const next = {
      section: has('section') ? b.section : ex.section,
      description: has('description') ? String(b.description || '').trim() : ex.description,
      category: has('category') ? (String(b.category || '').trim() || null) : ex.category,
      qty: has('qty') ? numOr(b.qty, 0) : numOr(ex.qty),
      unit_price: has('unit_price') ? numOr(b.unit_price, 0) : numOr(ex.unit_price),
      notes: has('notes') ? (String(b.notes || '').trim() || null) : ex.notes,
      sort_order: has('sort_order') ? (intOf(b.sort_order) || 0) : (ex.sort_order || 0),
    };
    if (!SECTION_SET.has(next.section)) return res.status(400).json({ success: false, error: 'Invalid section' });
    const { rows } = await pool.query(
      `UPDATE recording_budget_items SET section=$1, description=$2, category=$3, qty=$4,
         unit_price=$5, amount=$6, notes=$7, sort_order=$8
        WHERE id = $9 AND budget_id = $10 AND label_id = $11 RETURNING *`,
      [next.section, next.description, next.category, next.qty, next.unit_price,
        lineAmount(next.qty, next.unit_price), next.notes, next.sort_order, itemId, id, req.labelId]);
    await touch(req.labelId, id, req.user.name);
    res.json({ success: true, data: rows[0] });
  } catch (error) { console.error('Edit line item error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

router.delete('/:id(\\d+)/line-items/:itemId(\\d+)', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const bad = await assertEditable(req.labelId, id);
    if (bad) return res.status(bad.code).json({ success: false, error: bad.error });
    await pool.query('DELETE FROM recording_budget_items WHERE id = $1 AND budget_id = $2 AND label_id = $3',
      [intOf(req.params.itemId), id, req.labelId]);
    await touch(req.labelId, id, req.user.name);
    res.json({ success: true });
  } catch (error) { console.error('Delete line item error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── GET /:id/actuals — Costs to Date ───────────────────────────────────────
// Scope: this budget's ARTIST (LOWER(TRIM) equality — the "is this the artist
// asked for" rule, never the bucket key), optionally its release. Every LIVE
// split slice counts once and carries its own artist, so a split that moved
// half an invoice to another artist stops showing up here.
//
// USD conversion goes through lib/usd — the row's locked fx_rate_to_usd always
// wins, and rounding happens AT THE ROW so the by-category slicing and the
// summary total can both tie.
router.get('/:id(\\d+)/actuals', async (req, res) => {
  try {
    const id = intOf(req.params.id);
    const budget = await loadBudget(req.labelId, id);
    if (!budget) return res.status(404).json({ success: false, error: 'Budget not found' });

    let matchName = budget.artist_name;
    if (budget.artist_id) {
      const { rows } = await pool.query('SELECT name FROM artists WHERE id = $1 AND label_id = $2', [budget.artist_id, req.labelId]);
      matchName = rows[0]?.name || matchName;
    }
    const category_labels = await ledgerCategoryLabels(req.labelId);
    const advance = numOr(budget.advance_amount);
    const fund = numOr(budget.fund_amount);
    if (!matchName || !String(matchName).trim()) {
      return res.json({ success: true, data: {
        match_name: null, by_category: {}, all: [], category_labels,
        summary: budget.type === 'fund'
          ? { fund, advance, remainder_after_advance: fund - advance, spent: 0, balance_of_fund: fund - advance }
          : { budget_planned: 0, spent: 0, remaining: 0 },
      } });
    }

    const params = [req.labelId, String(matchName).trim()];
    let releaseClause = '';
    if (budget.release_id) {
      params.push(budget.release_id);
      releaseClause = `AND (COALESCE(e.release_id, r.release_id) = $${params.length} OR COALESCE(e.release_id, r.release_id) IS NULL)`;
    }
    const { rows: expenses } = await pool.query(
      `SELECT e.id, e.parent_id, COALESCE(e.invoice_date, r.invoice_date) AS invoice_date,
              COALESCE(e.payee, r.payee) AS payee, e.artist, e.song, e.category, e.amount,
              COALESCE(e.currency, r.currency, 'USD') AS currency,
              COALESCE(e.fx_rate_to_usd, r.fx_rate_to_usd) AS fx_rate_to_usd,
              COALESCE(e.payment_status, r.payment_status) AS payment_status,
              COALESCE(e.payment_date, r.payment_date) AS payment_date,
              e.budget_section_override AS budget_category_override
         FROM expenses e
         JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id) AND r.label_id = e.label_id
        WHERE e.label_id = $1
          AND r.parent_id IS NULL AND r.status = 'approved'
          AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
          AND LOWER(TRIM(COALESCE(e.artist, r.artist))) = LOWER(TRIM($2))
          ${releaseClause}
        ORDER BY COALESCE(e.payment_date, r.payment_date, e.invoice_date, r.invoice_date, e.created_at::date) DESC`,
      params);

    const { rows: items } = await pool.query(
      'SELECT section, category, amount FROM recording_budget_items WHERE budget_id = $1 AND label_id = $2',
      [id, req.labelId]);

    // The rollup starts empty and grows to hold exactly the categories in play
    // (planned OR spent) — not all 22, and not the six template sections.
    const byCategory = {};
    const ensure = (c) => (byCategory[c] ||= { planned: 0, spent: 0, remaining: 0, count: 0 });
    for (const li of items) {
      const cat = (li.category && li.category.trim()) || SECTION_TO_DEFAULT_CATEGORY[li.section] || 'Other';
      ensure(cat).planned += numOr(li.amount);
    }
    const all = [];
    for (const e of expenses) {
      const usd = await rowUsd2(e);
      // The stored override is trusted as written. Re-validating on READ would
      // silently reclassify a row whose category has since been renamed.
      const resolved = e.budget_category_override || e.category || 'Other';
      const bucket = ensure(resolved);
      bucket.spent += usd;
      bucket.count += 1;
      all.push({ ...e, amount_usd: usd, default_category: e.category || 'Other' });
    }
    for (const c of Object.keys(byCategory)) {
      byCategory[c].planned = round2(byCategory[c].planned);
      byCategory[c].spent = round2(byCategory[c].spent);
      byCategory[c].remaining = round2(byCategory[c].planned - byCategory[c].spent);
    }
    const totalPlanned = round2(Object.values(byCategory).reduce((s, v) => s + v.planned, 0));
    const totalSpent = round2(Object.values(byCategory).reduce((s, v) => s + v.spent, 0));
    const summary = costsSummary(budget.type, {
      fund_amount: fund, advance_amount: advance, planned: totalPlanned, spent: totalSpent });

    res.json({ success: true, data: { match_name: matchName, by_category: byCategory, all, summary, category_labels } });
  } catch (error) { console.error('Budget actuals error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

// ── PUT /expense/:expenseId/section — per-expense budget-category override ──
// The mechanism that makes planned-vs-spent comparable: attribute a matched
// ledger row to a budget category without editing the row's own category on
// /ledger. Empty clears it and reverts to the expense's own category.
router.put('/expense/:expenseId(\\d+)/section', async (req, res) => {
  try {
    const expenseId = intOf(req.params.expenseId);
    const raw = String(req.body?.category ?? req.body?.section ?? '').trim();
    const value = raw === '' ? null : raw;
    if (value && !(await isKnownCategory(req.labelId, value))) {
      return res.status(400).json({ success: false, error: `“${value}” is not a category. Create it first, then set it here.` });
    }
    const { rows } = await pool.query(
      `UPDATE expenses SET budget_section_override = $1 WHERE id = $2 AND label_id = $3
        RETURNING id, budget_section_override AS budget_category_override`,
      [value, expenseId, req.labelId]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Expense not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) { console.error('Budget override error:', error); res.status(500).json({ success: false, error: 'Internal server error' }); }
});

module.exports = router;

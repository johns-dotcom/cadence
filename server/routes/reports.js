// Reports — statement-verified cash-basis P&L, Spend by Artist, Balance
// Sheet, and the Dismissed review list.
//
// Basis (per STATEMENTS_V3_AND_REPORTS_DIRECTIONS.md Part B): LEDGER-mastered
// cash. Expenses = approved + Paid ledger rows bucketed by the FAMILY ROOT's
// payment_date; income = artist_income rows by income_date. Every live slice
// of a split family is summed exactly once — a `parent_id IS NULL` filter
// silently drops children's money (the reference app lost $1,250 to that).
//
// Coverage is bank-derived (matched debit $ / live debit $ per month) and
// bank-wide — never artist-scoped. A month with no bank data is NULL, not
// 100%: "no data" and "fully reconciled" are different claims.
//
// Dismissals and month overrides key on a row FINGERPRINT
// (lib/reportFingerprint.js), because bank-booked ledger rows are recreated
// under new ids when a statement is re-uploaded. Every advisory loader
// (sections / dismissals / overrides) degrades to empty on error — a
// reporting refinement must never take the P&L down.

const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover, requireAdmin } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { usdOf, round2 } = require('../lib/usd');
const { artistBucketKey, artistLabel } = require('../lib/artistKey');
const { fingerprintOfExpense, fingerprintOfIncome, ymd } = require('../lib/reportFingerprint');
const { loadLabelLevelRules, SCOPES: LL_SCOPES, norm: llNorm } = require('../lib/labelLevel');
const { toCents, fromCents, apportion, drawMany } = require('../lib/adAllocate');
const activityBot = require('../lib/activityBot');

const router = express.Router();
router.use(authMiddleware, withTenant, requireApprover);

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_REPORT_MONTHS = 120;
const DRILL_CAP = 500;
// EQUALITY on the name, never substring — a rename must empty the column
// loudly (advOther discloses it) rather than a substring quietly matching.
const ADVANCE_CATEGORIES = new Set(['advance']);
// Fallbacks when the categories table has no rows (fresh label mid-seed).
const FALLBACK_BELOW_EXPENSE = new Set(['advance', 'reimbursements']);
const FALLBACK_BELOW_INCOME = new Set(['drawdown fund', 'reimbursements', 'refund']);

// ── Date helpers ─────────────────────────────────────────────────────────────
// pg returns DATE columns as JS Date objects; String(d).slice(0,7) produces
// "Thu Jan" garbage buckets that silently ZERO the whole report. Branch.
const pad = (n) => String(n).padStart(2, '0');
function ym(d) {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return String(d).slice(0, 7);
}
function monthsBetween(from, to) {
  const out = [];
  let [y, m] = String(from).slice(0, 7).split('-').map(Number);
  const [ey, em] = String(to).slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    if (out.length > MAX_REPORT_MONTHS + 1) break;
  }
  return out;
}
const isValidDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function rangeProblem(from, to) {
  if (!isValidDay(from) || !isValidDay(to)) return 'from and to must be YYYY-MM-DD';
  if (from > to) return 'The range is backwards — from is after to';
  if (monthsBetween(from, to).length > MAX_REPORT_MONTHS) return `Range too large (max ${MAX_REPORT_MONTHS} months)`;
  return null;
}
const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${pad(new Date(y, mo, 0).getDate())}`;
};

// Filter rule (never the bucket key): case-insensitive trimmed equality.
const artistEq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const catKeyOf = (c) => String(c || '').trim().toLowerCase();
const catNameOf = (c) => String(c || '').trim() || 'Uncategorized';
const incomeTypeOf = (r) => String(r.source || '').trim() || 'Other Income';

// ── Advisory loaders (degrade to empty; never 500 the report) ───────────────
async function reportSections(labelId) {
  const sectionOf = { expense: new Map(), income: new Map() };
  const contraOf = new Map(); // lower(income type) -> expense category NAME
  try {
    const { rows } = await pool.query(
      `SELECT kind, name, report_section, contra_of FROM categories WHERE label_id = $1 AND active = TRUE`,
      [labelId]
    );
    for (const r of rows) {
      sectionOf[r.kind]?.set(catKeyOf(r.name), r.report_section || 'operating');
      if (r.kind === 'income' && r.contra_of) contraOf.set(catKeyOf(r.name), r.contra_of);
    }
  } catch (e) { console.warn('reportSections degraded:', e.message); }
  const sectionFor = (kind, name) => {
    const k = catKeyOf(name);
    const hit = sectionOf[kind].get(k);
    if (hit) return hit;
    const fb = kind === 'income' ? FALLBACK_BELOW_INCOME : FALLBACK_BELOW_EXPENSE;
    return fb.has(k) ? 'below_line' : 'operating';
  };
  return { sectionFor, contraOf };
}

async function dismissedSets(labelId) {
  const out = { itemFps: new Set(), categoryCells: new Set(), bsLines: new Set(), bsItems: new Set(), categoryRules: [] };
  try {
    const { rows } = await pool.query(`SELECT * FROM report_dismissals WHERE label_id = $1`, [labelId]);
    for (const r of rows) {
      if (r.scope === 'item' && r.row_fingerprint) out.itemFps.add(r.row_fingerprint);
      else if (r.scope === 'category') { out.categoryCells.add(`${r.cell_kind}|${catKeyOf(r.cell_key)}`); out.categoryRules.push(r); }
      else if (r.scope === 'bs_line') out.bsLines.add(catKeyOf(r.cell_key));
      else if (r.scope === 'bs_item' && r.bs_ref) out.bsItems.add(r.bs_ref);
    }
  } catch (e) { console.warn('dismissedSets degraded:', e.message); }
  return out;
}

async function monthOverrides(labelId) {
  const map = new Map(); // fp -> { target_month, original_month }
  try {
    const { rows } = await pool.query(`SELECT * FROM report_month_overrides WHERE label_id = $1`, [labelId]);
    for (const r of rows) map.set(r.row_fingerprint, r);
  } catch (e) { console.warn('monthOverrides degraded:', e.message); }
  return map;
}

// ── Row sources (ONE code path for pnl + detail + exports) ──────────────────
async function expenseRows(labelId, from, to, extraMonths = []) {
  const { rows } = await pool.query(
    `SELECT e.id, e.parent_id, r.id AS root_id, r.payment_date, e.amount,
            COALESCE(e.currency, r.currency, 'USD') AS currency,
            COALESCE(e.fx_rate_to_usd, r.fx_rate_to_usd) AS fx_rate_to_usd,
            e.category, e.artist, e.payee, e.song, e.invoice_number,
            r.entry_source
       FROM expenses e
       JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
      WHERE e.label_id = $1 AND r.label_id = $1
        AND r.parent_id IS NULL AND r.status = 'approved' AND r.payment_status = 'Paid'
        AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND r.payment_date IS NOT NULL
        AND (r.payment_date BETWEEN $2 AND $3 OR to_char(r.payment_date, 'YYYY-MM') = ANY($4::text[]))`,
    [labelId, from, to, extraMonths]
  );
  return rows;
}

async function incomeRows(labelId, from, to, extraMonths = []) {
  const { rows } = await pool.query(
    `SELECT i.id, i.income_date, i.amount, COALESCE(i.currency, 'USD') AS currency,
            i.source, i.description, i.artist_id, a.name AS artist_name
       FROM artist_income i
       LEFT JOIN artists a ON a.id = i.artist_id AND a.label_id = i.label_id
      WHERE i.label_id = $1
        AND (i.income_date BETWEEN $2 AND $3 OR to_char(i.income_date, 'YYYY-MM') = ANY($4::text[]))`,
    [labelId, from, to, extraMonths]
  );
  return rows;
}

// Months physically outside the range whose rows are overridden INTO it.
function extraFetchMonths(overrides, wanted) {
  const out = new Set();
  for (const o of overrides.values()) {
    if (wanted.has(o.target_month) && !wanted.has(o.original_month)) out.add(o.original_month);
  }
  return [...out];
}

// Annotate a fetched row with fingerprint, reported month and dismissal
// status. Returns null when the row doesn't belong in this report at all.
// `movedOut` collects rows whose override pushed them outside the range.
function placeRow(row, fp, physDate, wanted, overrides, dismissed, cellKind, cellKey, movedOut) {
  const phys = ym(physDate);
  const ov = overrides.get(fp);
  const reported = ov ? ov.target_month : phys;
  if (!wanted.has(reported)) {
    if (wanted.has(phys) && ov) movedOut.push({ ...row, fp, from_month: phys, to_month: reported });
    return null;
  }
  const isDismissed = dismissed.itemFps.has(fp) || dismissed.categoryCells.has(`${cellKind}|${catKeyOf(cellKey)}`);
  return { report_month: reported, moved_from: ov && reported !== phys ? phys : null, dismissed: isDismissed };
}

// ── buildPnl ─────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {Array} [opts.collectLabelLevel]  an array to push the individual rows
 *   the label-level test fired on. Allocate Advertising has to LIST the charges
 *   making up the ad pool, and `/pnl/detail` deliberately drops nothing into a
 *   label-level bucket — so the only alternative would be a second query with
 *   its own idea of what label-level means. Collecting HERE, at the one call
 *   site that makes the decision, is what guarantees the page lists precisely
 *   the money the pool says it holds. Off unless asked for.
 * @param {Set} [opts.collectCountedIds]  every `expenses.id` this report counted
 *   as OPERATING expense. Artist Campaigns' second layer has to state what the
 *   P&L has NOT yet counted, and a predicate reconstructing that condition
 *   ("approved and Paid and dated in range and not dismissed and not moved…")
 *   drifts the moment either side changes. Set MEMBERSHIP cannot drift: the
 *   double-count guard is literally "was this row in the first layer".
 */
async function buildPnl(labelId, from, to, artist, opts = {}) {
  const months = monthsBetween(from, to);
  const wanted = new Set(months);
  const collectLL = Array.isArray(opts.collectLabelLevel) ? opts.collectLabelLevel : null;
  const countedIds = opts.collectCountedIds instanceof Set ? opts.collectCountedIds : null;
  const [{ sectionFor, contraOf }, dismissed, overrides, llRules] = await Promise.all([
    reportSections(labelId), dismissedSets(labelId), monthOverrides(labelId),
    loadLabelLevelRules(pool, labelId),
  ]);
  const extra = extraFetchMonths(overrides, wanted);
  const [eRows, iRows, coverage, artists, categoryUsage] = await Promise.all([
    expenseRows(labelId, from, to, extra),
    incomeRows(labelId, from, to, extra),
    coverageByMonth(labelId, from, to),
    artistsList(labelId),
    catUsage(labelId),
  ]);

  const mkLine = () => ({ series: {}, total: 0 });
  const bump = (bag, line, m, usd) => {
    const b = bag[line] || (bag[line] = mkLine());
    b.series[m] = (b.series[m] || 0) + usd;
    b.total += usd;
  };

  const op = { income: {}, expenses: {} };
  const below = { income: {}, expenses: {} };
  const contra = []; // { income_type, target, total }
  const contraTotals = new Map();
  const byArtist = new Map(); // bucketKey -> { total, by_category, spellings: Map }
  const advByArtist = new Map(); // bucketKey -> total (net)
  let advOther = 0; // below-line expense NOT in ADVANCE_CATEGORIES — disclosed
  const dismissedRows = [];
  const movedOut = [];
  // Spend a RULE says bills the label, not a release — the ad pool. A disclosed
  // SUBSET of the unattributed bucket (see lib/labelLevel.js for why it is not a
  // third bucket the way the reference app has it): a row qualifies only when it
  // already names nobody, so nothing moves and ties_to_pnl is untouched.
  const labelLevel = { cats: {}, total: 0, count: 0 };
  let reassignedCount = 0, reassignedTotal = 0;
  let opExpenseRaw = 0; // UNROUNDED accumulator — ties_to_pnl compares on this

  const noteSpelling = (map, key, raw) => {
    const entry = map.get(key) || { total: 0, by_category: {}, spellings: new Map() };
    const s = String(raw || '').trim();
    if (s) entry.spellings.set(s, (entry.spellings.get(s) || 0) + 1);
    map.set(key, entry);
    return entry;
  };

  for (const r of eRows) {
    if (artist && !artistEq(r.artist, artist)) continue;
    const fp = fingerprintOfExpense({ payment_date: r.payment_date, amount: r.amount, payee: r.payee });
    const cat = catNameOf(r.category);
    const placed = placeRow(r, fp, r.payment_date, wanted, overrides, dismissed, 'expense', cat, movedOut);
    if (!placed) continue;
    const usd = usdOf(r.amount, r.currency, r.fx_rate_to_usd);
    if (placed.dismissed) { dismissedRows.push({ kind: 'expense', cell: cat, month: placed.report_month, usd, row: r, fp }); continue; }
    if (placed.moved_from) { reassignedCount += 1; reassignedTotal += usd; }
    const section = sectionFor('expense', cat);
    if (section === 'below_line') {
      bump(below.expenses, cat, placed.report_month, usd);
      const key = artistBucketKey(r.artist);
      if (ADVANCE_CATEGORIES.has(catKeyOf(cat))) {
        const entry = noteSpelling(advByArtist, key, r.artist);
        entry.total += usd;
      } else advOther += usd;
    } else if (section === 'non_recurring') {
      bump(below.expenses, cat, placed.report_month, usd); // presented below the line, labelled by the client
    } else {
      bump(op.expenses, cat, placed.report_month, usd);
      opExpenseRaw += usd;
      if (countedIds) countedIds.add(r.id);
      const key = artistBucketKey(r.artist);
      const entry = noteSpelling(byArtist, key, r.artist);
      entry.total += usd;
      entry.by_category[cat] = (entry.by_category[cat] || 0) + usd;
      if (key === '' && llRules.has(r.payee, cat)) {
        labelLevel.cats[cat] = (labelLevel.cats[cat] || 0) + usd;
        labelLevel.total += usd;
        labelLevel.count += 1;
        if (collectLL) {
          collectLL.push({
            expense_id: r.id, root_id: r.root_id, parent_id: r.parent_id,
            month: placed.report_month, usd, category: cat,
            payee: r.payee, date: r.payment_date, artist: r.artist,
          });
        }
      }
    }
  }

  for (const r of iRows) {
    if (artist && !artistEq(r.artist_name, artist)) continue;
    const fp = fingerprintOfIncome(r);
    const type = incomeTypeOf(r);
    const placed = placeRow(r, fp, r.income_date, wanted, overrides, dismissed, 'income', type, movedOut);
    if (!placed) continue;
    const usd = usdOf(r.amount, r.currency, null);
    if (placed.dismissed) { dismissedRows.push({ kind: 'income', cell: type, month: placed.report_month, usd, row: r, fp }); continue; }
    if (placed.moved_from) { reassignedCount += 1; reassignedTotal += usd; }
    const target = contraOf.get(catKeyOf(type));
    if (target) {
      // A recovery nets against its expense line rather than counting as revenue.
      bump(op.expenses, target, placed.report_month, -usd);
      contraTotals.set(`${type}→${target}`, (contraTotals.get(`${type}→${target}`) || 0) + usd);
      continue;
    }
    const section = sectionFor('income', type);
    bump(section === 'operating' ? op.income : below.income, type, placed.report_month, usd);
  }
  for (const [key, total] of contraTotals) {
    const [income_type, target] = key.split('→');
    contra.push({ income_type, target, total: round2(total) });
  }

  const sumBag = (bag) => {
    const series = {};
    let total = 0;
    for (const line of Object.values(bag)) {
      total += line.total;
      for (const [m, v] of Object.entries(line.series)) series[m] = (series[m] || 0) + v;
    }
    return { series, total };
  };
  const roundBag = (bag) => {
    const out = {};
    for (const [k, v] of Object.entries(bag)) {
      out[k] = { total: round2(v.total), series: Object.fromEntries(Object.entries(v.series).map(([m, n]) => [m, round2(n)])) };
    }
    return out;
  };

  const incomeTotals = sumBag(op.income);
  const expenseTotals = sumBag(op.expenses);
  const belowIncomeTotals = sumBag(below.income);
  const belowExpenseTotals = sumBag(below.expenses);

  // Spend by Artist — operating expense slice + advances beside it.
  // Row set = UNION of both key sets so an advance-only artist still appears.
  const allKeys = new Set([...byArtist.keys(), ...advByArtist.keys()]);
  let byArtistRawTotal = 0;
  for (const e of byArtist.values()) byArtistRawTotal += e.total;
  const bestSpelling = (entry, key) => {
    let best = null, n = -1;
    for (const [s, c] of (entry?.spellings || new Map())) if (c > n) { best = s; n = c; }
    return key === '' ? 'Not attributed to an artist' : (best || key);
  };
  const artistRows = [...allKeys].map((key) => {
    const spend = byArtist.get(key);
    const adv = advByArtist.get(key);
    return {
      key,
      name: bestSpelling(spend || adv, key),
      total: round2(spend?.total || 0),
      advances: round2(adv?.total || 0),
      total_out: round2((spend?.total || 0) + (adv?.total || 0)),
      by_category: Object.fromEntries(Object.entries(spend?.by_category || {}).map(([c, v]) => [c, round2(v)])),
    };
  }).sort((a, b) => b.total_out - a.total_out);
  // ties_to_pnl on the UNROUNDED accumulators — rounding first hides drift.
  const tiesToPnl = Math.abs(byArtistRawTotal - expenseTotals.total) < 0.005;

  // Dismissed summary — same code path as reported totals, disclosed 3 ways.
  const dSeries = {}, dByCell = {};
  let dTotal = 0;
  for (const d of dismissedRows) {
    dTotal += d.usd;
    dSeries[d.month] = (dSeries[d.month] || 0) + d.usd;
    const cellId = `${d.kind}|${d.cell}`;
    dByCell[cellId] = (dByCell[cellId] || 0) + d.usd;
  }

  const movedOutRows = movedOut.map((r) => ({
    expense_id: r.category !== undefined ? r.id : null,
    income_id: r.category === undefined ? r.id : null,
    date: ymd(r.payment_date || r.income_date),
    payee: r.payee || r.source || null,
    usd: round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd)),
    from_month: r.from_month,
    to_month: r.to_month,
  }));

  return {
    months,
    basis: 'cash',
    artist: artist || null,
    income: roundBag(op.income),
    expenses: roundBag(op.expenses),
    income_totals: { series: Object.fromEntries(Object.entries(incomeTotals.series).map(([m, n]) => [m, round2(n)])), total: round2(incomeTotals.total) },
    expense_totals: { series: Object.fromEntries(Object.entries(expenseTotals.series).map(([m, n]) => [m, round2(n)])), total: round2(expenseTotals.total) },
    net: round2(incomeTotals.total - expenseTotals.total),
    below: {
      income: roundBag(below.income),
      expenses: roundBag(below.expenses),
      income_totals: { series: Object.fromEntries(Object.entries(belowIncomeTotals.series).map(([m, n]) => [m, round2(n)])), total: round2(belowIncomeTotals.total) },
      expense_totals: { series: Object.fromEntries(Object.entries(belowExpenseTotals.series).map(([m, n]) => [m, round2(n)])), total: round2(belowExpenseTotals.total) },
      net: round2(belowIncomeTotals.total - belowExpenseTotals.total),
    },
    contra,
    dismissed: {
      count: dismissedRows.length,
      total: round2(dTotal),
      series: Object.fromEntries(Object.entries(dSeries).map(([m, n]) => [m, round2(n)])),
      by_cell: Object.fromEntries(Object.entries(dByCell).map(([c, n]) => [c, round2(n)])),
      category_count: dismissed.categoryRules.length,
      item_count: dismissed.itemFps.size,
    },
    reassigned: {
      count: reassignedCount,
      total: round2(reassignedTotal),
      moved_out: { count: movedOutRows.length, total: round2(movedOutRows.reduce((s, r) => s + r.usd, 0)), rows: movedOutRows.slice(0, 100) },
    },
    coverage,
    artists,
    category_usage: categoryUsage,
    by_artist: {
      rows: artistRows, total: round2(byArtistRawTotal), ties_to_pnl: tiesToPnl,
      // Disclosed on its own so a coverage figure beside it can mean "of the
      // money that CAN name an artist" without hiding anything.
      label_level: {
        total: round2(labelLevel.total),
        count: labelLevel.count,
        rule_count: llRules.size,
        by_category: Object.fromEntries(Object.entries(labelLevel.cats).map(([c, n]) => [c, round2(n)])),
      },
    },
    advances: {
      total: round2([...advByArtist.values()].reduce((s, e) => s + e.total, 0)),
      other_total: round2(advOther),
    },
  };
}

async function coverageByMonth(labelId, from, to) {
  try {
    const { rows } = await pool.query(
      `SELECT t.txn_date, t.amount, t.currency, (t.matched_expense_id IS NOT NULL) AS covered
         FROM bank_transactions t
         JOIN bank_statements s ON s.id = t.statement_id AND s.status = 'ready'
        WHERE t.label_id = $1 AND t.direction = 'debit' AND t.dismissed = FALSE
          AND t.txn_date BETWEEN $2 AND $3`,
      [labelId, from, to]
    );
    const agg = {};
    for (const r of rows) {
      const m = ym(r.txn_date);
      const usd = usdOf(r.amount, r.currency, null);
      const a = agg[m] || (agg[m] = { live: 0, covered: 0, open_n: 0 });
      a.live += usd;
      if (r.covered) a.covered += usd; else a.open_n += 1;
    }
    const out = {};
    for (const m of monthsBetween(from, to)) {
      const a = agg[m];
      out[m] = a && a.live > 0 ? { pct: Math.round((a.covered / a.live) * 100), open_n: a.open_n } : null;
    }
    return out;
  } catch (e) { console.warn('coverage degraded:', e.message); return {}; }
}

async function artistsList(labelId) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT TRIM(artist) AS name FROM expenses
        WHERE label_id = $1 AND TRIM(COALESCE(artist, '')) <> '' AND status = 'approved'
          AND (deleted IS NULL OR deleted = FALSE)
       UNION
       SELECT DISTINCT a.name FROM artist_income i JOIN artists a ON a.id = i.artist_id
        WHERE i.label_id = $1 AND a.label_id = $1`,
      [labelId]
    );
    const seen = new Map();
    for (const r of rows) {
      const k = String(r.name).toLowerCase();
      if (!seen.has(k)) seen.set(k, r.name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

async function catUsage(labelId) {
  try {
    const { rows } = await pool.query(
      `SELECT TRIM(category) AS cat, COUNT(*)::int AS n FROM expenses
        WHERE label_id = $1 AND status = 'approved' AND (deleted IS NULL OR deleted = FALSE)
          AND created_at > NOW() - INTERVAL '12 months' AND TRIM(COALESCE(category, '')) <> ''
        GROUP BY 1`,
      [labelId]
    );
    return Object.fromEntries(rows.map((r) => [r.cat, r.n]));
  } catch { return {}; }
}

// ── Endpoints ────────────────────────────────────────────────────────────────
router.get('/pnl', async (req, res) => {
  try {
    const { from, to, artist } = req.query;
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    res.json({ success: true, data: await buildPnl(req.labelId, from, to, artist || null) });
  } catch (e) { console.error('pnl error:', e); res.status(500).json({ success: false, error: 'Report failed' }); }
});

// Drill-through: the rows behind one cell. INVARIANT: total === the P&L cell
// (same row source, same filters, same usdOf) — the client renders a drift
// warning if they ever disagree.
router.get('/pnl/detail', async (req, res) => {
  try {
    const { kind, key, month, from, to, artist, drillCategory } = req.query;
    const keys = req.query.keys ? [].concat(req.query.keys) : null;
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    if (!['income', 'expense', 'artist'].includes(kind)) return res.status(400).json({ success: false, error: 'kind must be income|expense|artist' });
    if (month && !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });

    const wanted = new Set(monthsBetween(from, to));
    const [{ sectionFor, contraOf }, dismissed, overrides] = await Promise.all([
      reportSections(req.labelId), dismissedSets(req.labelId), monthOverrides(req.labelId),
    ]);
    const extra = extraFetchMonths(overrides, wanted);
    const movedOut = [];
    const rows = [];
    const recoveries = [];
    let total = 0, dismissedCount = 0, dismissedTotal = 0;
    const allExpenseIds = [];

    const cellMonthOk = (m) => !month || m === month;

    if (kind === 'income') {
      for (const r of await incomeRows(req.labelId, from, to, extra)) {
        if (artist && !artistEq(r.artist_name, artist)) continue;
        const type = incomeTypeOf(r);
        if (catKeyOf(type) !== catKeyOf(key)) continue;
        const fp = fingerprintOfIncome(r);
        const placed = placeRow(r, fp, r.income_date, wanted, overrides, dismissed, 'income', type, movedOut);
        if (!placed || !cellMonthOk(placed.report_month)) continue;
        const usd = round2(usdOf(r.amount, r.currency, null));
        if (placed.dismissed) { dismissedCount += 1; dismissedTotal += usd; continue; }
        total += usd;
        rows.push({
          income_id: r.id, date: ymd(r.income_date), payee: r.source, artist: r.artist_name,
          description: r.description, usd, amount: Number(r.amount), currency: r.currency,
          report_month: placed.report_month, moved_from: placed.moved_from,
        });
      }
    } else {
      const eRowsAll = await expenseRows(req.labelId, from, to, extra);
      const contraTargetsHit = kind === 'expense'
        ? [...contraOf.entries()].filter(([, target]) => catKeyOf(target) === catKeyOf(key)).map(([t]) => t)
        : [];
      for (const r of eRowsAll) {
        if (artist && !artistEq(r.artist, artist)) continue;
        const cat = catNameOf(r.category);
        const section = sectionFor('expense', cat);
        if (kind === 'expense') {
          if (catKeyOf(cat) !== catKeyOf(key)) continue;
        } else {
          // artist cell — operating only, plus the Advances cell when asked.
          const bucket = artistBucketKey(r.artist);
          const inCell = keys ? keys.includes(bucket) : bucket === String(key || '');
          if (!inCell) continue;
          const isAdvance = ADVANCE_CATEGORIES.has(catKeyOf(cat));
          if (drillCategory) {
            if (catKeyOf(cat) !== catKeyOf(drillCategory)) continue;
            if (isAdvance && section !== 'below_line') continue;
          } else if (section !== 'operating') continue;
        }
        const fp = fingerprintOfExpense({ payment_date: r.payment_date, amount: r.amount, payee: r.payee });
        const placed = placeRow(r, fp, r.payment_date, wanted, overrides, dismissed, 'expense', cat, movedOut);
        if (!placed || !cellMonthOk(placed.report_month)) continue;
        const usd = round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd));
        if (placed.dismissed) { dismissedCount += 1; dismissedTotal += usd; continue; }
        total += usd;
        allExpenseIds.push(r.id);
        rows.push({
          expense_id: r.id, date: ymd(r.payment_date), payee: r.payee, artist: artistLabel(r.artist),
          song: r.song, invoice_number: r.invoice_number, category: cat,
          usd, amount: Number(r.amount), currency: r.currency,
          report_month: placed.report_month, moved_from: placed.moved_from,
          split_of: r.parent_id ? r.root_id : null,
          evidence: r.entry_source === 'bank_statement' ? 'invented' : 'invoice',
        });
      }
      // Recoveries netting into this expense cell — listed apart, netted in total.
      if (contraTargetsHit.length) {
        for (const r of await incomeRows(req.labelId, from, to, extra)) {
          const type = incomeTypeOf(r);
          if (!contraTargetsHit.includes(catKeyOf(type))) continue;
          if (artist && !artistEq(r.artist_name, artist)) continue;
          const fp = fingerprintOfIncome(r);
          const placed = placeRow(r, fp, r.income_date, wanted, overrides, dismissed, 'income', type, movedOut);
          if (!placed || !cellMonthOk(placed.report_month) || placed.dismissed) continue;
          const usd = round2(usdOf(r.amount, r.currency, null));
          total -= usd;
          recoveries.push({ income_id: r.id, date: ymd(r.income_date), payee: r.source, usd, amount: Number(r.amount), currency: r.currency });
        }
      }
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    res.json({
      success: true,
      data: {
        rows: rows.slice(0, DRILL_CAP),
        truncated: rows.length > DRILL_CAP ? rows.length : null,
        total: round2(total),
        recoveries,
        dismissed: { count: dismissedCount, total: round2(dismissedTotal) },
        all_expense_ids: allExpenseIds,
      },
    });
  } catch (e) { console.error('pnl detail error:', e); res.status(500).json({ success: false, error: 'Drill failed' }); }
});

router.get('/spend-by-artist', async (req, res) => {
  try {
    const { from, to } = req.query; // deliberately no artist param
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const pnl = await buildPnl(req.labelId, from, to, null);
    res.json({ success: true, data: await shapeSpendByArtist(req.labelId, from, to, pnl) });
  } catch (e) { console.error('spend-by-artist error:', e); res.status(500).json({ success: false, error: 'Report failed' }); }
});

async function shapeSpendByArtist(labelId, from, to, pnl) {
  // The "what this total excludes" bridge back to the ledger figure people
  // will compare against: approved-but-unpaid family totals in range.
  let unpaid = { total: 0, count: 0 };
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.currency, r.fx_rate_to_usd,
              (r.amount + COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_id = r.id AND (k.deleted IS NULL OR k.deleted = FALSE)), 0)) AS family_amount
         FROM expenses r
        WHERE r.label_id = $1 AND r.parent_id IS NULL AND r.status = 'approved'
          AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
          AND r.payment_status IS DISTINCT FROM 'Paid'
          AND r.invoice_date BETWEEN $2 AND $3`,
      [labelId, from, to]
    );
    for (const r of rows) unpaid.total += usdOf(r.family_amount, r.currency, r.fx_rate_to_usd);
    unpaid = { total: round2(unpaid.total), count: rows.length };
  } catch { /* disclosed as zero */ }

  const attributed = pnl.by_artist.rows.filter((r) => r.key !== '');
  const unattributedRow = pnl.by_artist.rows.find((r) => r.key === '') || null;
  const advAttributed = attributed.reduce((s, r) => s + r.advances, 0);
  return {
    rows: pnl.by_artist.rows,
    total: pnl.by_artist.total,
    ties_to_pnl: pnl.by_artist.ties_to_pnl,
    pnl_expense_total: pnl.expense_totals.total,
    coverage: {
      pct: pnl.by_artist.total > 0 ? Math.round((attributed.reduce((s, r) => s + r.total, 0) / pnl.by_artist.total) * 100) : 100,
      attributed: round2(attributed.reduce((s, r) => s + r.total, 0)),
      artists: attributed.filter((r) => r.total > 0).length,
    },
    unattributed: unattributedRow ? { total: unattributedRow.total, advances: unattributedRow.advances } : { total: 0, advances: 0 },
    advances: {
      total: pnl.advances.total,
      attributed_total: round2(advAttributed),
      other_total: pnl.advances.other_total,
    },
    total_out: round2(pnl.by_artist.rows.reduce((s, r) => s + r.total_out, 0)),
    excluded: {
      below_line: pnl.below.expense_totals.total,
      dismissed: { total: pnl.dismissed.total, count: pnl.dismissed.count },
      moved_out: { total: pnl.reassigned.moved_out.total, count: pnl.reassigned.moved_out.count },
      unpaid,
    },
    months: pnl.months,
    month_coverage: pnl.coverage,
    from, to,
  };
}

// ── Balance sheet ────────────────────────────────────────────────────────────
async function buildBalanceSheet(labelId, asOf) {
  const dismissed = await dismissedSets(labelId);

  // Floor: before the first captured statement close, cash is UNKNOWN, not 0.
  const floor = (await pool.query(
    `SELECT MIN(period_end) AS f FROM bank_statements
      WHERE label_id = $1 AND status = 'ready' AND ending_balance IS NOT NULL`,
    [labelId]
  )).rows[0]?.f;
  if (floor && ymd(asOf) < ymd(floor)) {
    const err = new Error(`Cash is unknown before ${ymd(floor)} (the first statement with a captured balance)`);
    err.status = 400;
    throw err;
  }

  const cash = (await pool.query(
    `SELECT DISTINCT ON (account) account, ending_balance::float8 AS balance, period_end, filename, id
       FROM bank_statements
      WHERE label_id = $1 AND status = 'ready' AND ending_balance IS NOT NULL AND period_end <= $2
      ORDER BY account, period_end DESC`,
    [labelId, asOf]
  )).rows.map((r) => ({
    account: r.account, balance: round2(r.balance), as_of: ymd(r.period_end),
    source: r.filename, statement_id: r.id,
    line_key: `cash:${r.account}`,
    excluded: dismissed.bsLines.has(`cash:${r.account}`),
  }));

  // A/R — the OUTBOUND invoices table (never the vendor expenses table).
  const arRows = (await pool.query(
    `SELECT id, invoice_number, bill_to, amount, currency, payment_status, created_at
       FROM invoices
      WHERE label_id = $1 AND payment_status IS DISTINCT FROM 'Paid' AND created_at::date <= $2`,
    [labelId, asOf]
  )).rows.map((r) => ({
    bs_ref: `ar:${r.id}`, id: r.id, number: r.invoice_number, counterparty: r.bill_to,
    usd: round2(usdOf(r.amount, r.currency, null)), amount: Number(r.amount), currency: r.currency,
    date: ymd(r.created_at), excluded: dismissed.bsItems.has(`ar:${r.id}`),
  }));

  // A/P — approved unpaid ledger slices, as-of-aware: a bill paid AFTER asOf
  // was still owed ON asOf.
  const apRows = (await pool.query(
    `SELECT e.id, e.payee, e.category, e.invoice_number, e.amount,
            COALESCE(e.currency, r.currency, 'USD') AS currency,
            COALESCE(e.fx_rate_to_usd, r.fx_rate_to_usd) AS fx_rate_to_usd,
            COALESCE(r.invoice_date, r.created_at::date) AS owed_since
       FROM expenses e
       JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
      WHERE e.label_id = $1 AND r.label_id = $1
        AND r.parent_id IS NULL AND r.status = 'approved'
        AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND COALESCE(r.invoice_date, r.created_at::date) <= $2
        AND (r.payment_status IS DISTINCT FROM 'Paid' OR r.payment_date > $2)`,
    [labelId, asOf]
  )).rows.map((r) => ({
    bs_ref: `ap:${r.id}`, id: r.id, counterparty: r.payee, category: r.category,
    number: r.invoice_number, usd: round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd)),
    amount: Number(r.amount), currency: r.currency, date: ymd(r.owed_since),
    excluded: dismissed.bsItems.has(`ap:${r.id}`),
  }));

  // Drawdowns received = unearned money owed back through recoupment — a
  // FUNDING line, not revenue and not equity padding. Gross, not netted.
  const advRows = (await pool.query(
    `SELECT i.id, i.amount, i.currency, i.income_date, i.description, a.name AS artist_name
       FROM artist_income i LEFT JOIN artists a ON a.id = i.artist_id AND a.label_id = i.label_id
      WHERE i.label_id = $1 AND TRIM(LOWER(COALESCE(i.source, ''))) = 'drawdown fund' AND i.income_date <= $2`,
    [labelId, asOf]
  )).rows.map((r) => ({
    bs_ref: `adv:${r.id}`, id: r.id, counterparty: r.artist_name || r.description || 'Drawdown',
    usd: round2(usdOf(r.amount, r.currency, null)), amount: Number(r.amount), currency: r.currency,
    date: ymd(r.income_date), excluded: dismissed.bsItems.has(`adv:${r.id}`),
  }));

  // Recoupable memo — family-aware (roots + children), counted in NOTHING.
  let memo = { total: 0, count: 0 };
  try {
    const { rows } = await pool.query(
      `SELECT e.amount, COALESCE(e.currency, 'USD') AS currency, e.fx_rate_to_usd
         FROM expenses e JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
        WHERE e.label_id = $1 AND r.label_id = $1 AND r.parent_id IS NULL
          AND r.status = 'approved' AND e.recoupable = TRUE
          AND (e.deleted IS NULL OR e.deleted = FALSE) AND (r.deleted IS NULL OR r.deleted = FALSE)
          AND COALESCE(r.invoice_date, r.created_at::date) <= $2`,
      [labelId, asOf]
    );
    memo = { total: round2(rows.reduce((s, r) => s + usdOf(r.amount, r.currency, r.fx_rate_to_usd), 0)), count: rows.length };
  } catch { /* memo only */ }

  const sum = (rows) => round2(rows.filter((r) => !r.excluded).reduce((s, r) => s + r.usd, 0));
  const excludedTotal = (rows) => round2(rows.filter((r) => r.excluded).reduce((s, r) => s + r.usd, 0));

  const lineExcluded = {
    ar: dismissed.bsLines.has('accounts_receivable'),
    ap: dismissed.bsLines.has('accounts_payable'),
    adv: dismissed.bsLines.has('advances_outstanding'),
  };
  const cashTotal = round2(cash.filter((c) => !c.excluded).reduce((s, c) => s + c.balance, 0));
  const arTotal = lineExcluded.ar ? 0 : sum(arRows);
  const apTotal = lineExcluded.ap ? 0 : sum(apRows);
  const advTotal = lineExcluded.adv ? 0 : sum(advRows);
  const assets = round2(cashTotal + arTotal);
  const liabilities = round2(apTotal + advTotal);

  return {
    as_of: ymd(asOf),
    cash: { accounts: cash, total: cashTotal },
    accounts_receivable: { total: arTotal, count: arRows.filter((r) => !r.excluded).length, rows_available: arRows.length, line_excluded: lineExcluded.ar },
    accounts_payable: { total: apTotal, count: apRows.filter((r) => !r.excluded).length, rows_available: apRows.length, line_excluded: lineExcluded.ap },
    advances_outstanding: { total: advTotal, count: advRows.filter((r) => !r.excluded).length, line_excluded: lineExcluded.adv, note: 'gross received — repayments/recoupment not yet netted' },
    total_assets: assets,
    total_liabilities: liabilities,
    net_assets: round2(assets - liabilities),
    memo: { recoupable: { ...memo, note: 'recoupable artist spend submitted to date — shown for context, counted in nothing' } },
    excluded: {
      item_total: round2(excludedTotal(arRows) + excludedTotal(apRows) + excludedTotal(advRows)),
      item_count: [...arRows, ...apRows, ...advRows].filter((r) => r.excluded).length,
      lines: Object.entries(lineExcluded).filter(([, v]) => v).map(([k]) => k),
    },
    first_close: floor ? ymd(floor) : null,
  };
}

router.get('/balance-sheet', async (req, res) => {
  try {
    const asOf = isValidDay(req.query.as_of) ? req.query.as_of : ymd(new Date());
    res.json({ success: true, data: await buildBalanceSheet(req.labelId, asOf) });
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ success: false, error: e.message });
    console.error('balance sheet error:', e);
    res.status(500).json({ success: false, error: 'Balance sheet failed' });
  }
});

router.get('/balance-sheet/detail', async (req, res) => {
  try {
    const asOf = isValidDay(req.query.as_of) ? req.query.as_of : ymd(new Date());
    const bs = await buildBalanceSheetRows(req.labelId, asOf, req.query.line);
    res.json({ success: true, data: bs });
  } catch (e) { console.error('bs detail error:', e); res.status(500).json({ success: false, error: 'Detail failed' }); }
});

// The row lists behind A/R, A/P and Advances — reuses buildBalanceSheet's
// queries by rebuilding (small data; simpler than threading rows through).
async function buildBalanceSheetRows(labelId, asOf, line) {
  const dismissed = await dismissedSets(labelId);
  if (line === 'ar') {
    const { rows } = await pool.query(
      `SELECT id, invoice_number, bill_to, amount, currency, payment_status, created_at FROM invoices
        WHERE label_id = $1 AND payment_status IS DISTINCT FROM 'Paid' AND created_at::date <= $2 ORDER BY created_at DESC`,
      [labelId, asOf]
    );
    return { rows: rows.map((r) => ({ bs_ref: `ar:${r.id}`, id: r.id, number: r.invoice_number, counterparty: r.bill_to, usd: round2(usdOf(r.amount, r.currency, null)), amount: Number(r.amount), currency: r.currency, date: ymd(r.created_at), excluded: dismissed.bsItems.has(`ar:${r.id}`) })) };
  }
  if (line === 'adv') {
    const { rows } = await pool.query(
      `SELECT i.id, i.amount, i.currency, i.income_date, i.description, a.name AS artist_name
         FROM artist_income i LEFT JOIN artists a ON a.id = i.artist_id AND a.label_id = i.label_id
        WHERE i.label_id = $1 AND TRIM(LOWER(COALESCE(i.source, ''))) = 'drawdown fund' AND i.income_date <= $2 ORDER BY i.income_date DESC`,
      [labelId, asOf]
    );
    return { rows: rows.map((r) => ({ bs_ref: `adv:${r.id}`, id: r.id, counterparty: r.artist_name || r.description || 'Drawdown', usd: round2(usdOf(r.amount, r.currency, null)), amount: Number(r.amount), currency: r.currency, date: ymd(r.income_date), excluded: dismissed.bsItems.has(`adv:${r.id}`) })) };
  }
  // default: ap
  const { rows } = await pool.query(
    `SELECT e.id, e.payee, e.category, e.invoice_number, e.amount,
            COALESCE(e.currency, r.currency, 'USD') AS currency,
            COALESCE(e.fx_rate_to_usd, r.fx_rate_to_usd) AS fx_rate_to_usd,
            COALESCE(r.invoice_date, r.created_at::date) AS owed_since
       FROM expenses e JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
      WHERE e.label_id = $1 AND r.label_id = $1 AND r.parent_id IS NULL AND r.status = 'approved'
        AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND COALESCE(r.invoice_date, r.created_at::date) <= $2
        AND (r.payment_status IS DISTINCT FROM 'Paid' OR r.payment_date > $2)
      ORDER BY owed_since ASC`,
    [labelId, asOf]
  );
  return { rows: rows.map((r) => ({ bs_ref: `ap:${r.id}`, id: r.id, counterparty: r.payee, category: r.category, number: r.invoice_number, usd: round2(usdOf(r.amount, r.currency, r.fx_rate_to_usd)), amount: Number(r.amount), currency: r.currency, date: ymd(r.owed_since), excluded: dismissed.bsItems.has(`ap:${r.id}`) })) };
}

// ── Dismissals ───────────────────────────────────────────────────────────────
router.get('/dismissals', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, e.payee AS e_payee, e.amount AS e_amount, e.currency AS e_currency,
              i.source AS i_source, i.amount AS i_amount, i.currency AS i_currency
         FROM report_dismissals d
         LEFT JOIN expenses e ON e.id = d.expense_id AND e.label_id = d.label_id
         LEFT JOIN artist_income i ON i.id = d.income_id AND i.label_id = d.label_id
        WHERE d.label_id = $1
        ORDER BY d.dismissed_at DESC
        LIMIT 500`,
      [req.labelId]
    );
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, scope: r.scope, cell_kind: r.cell_kind, cell_key: r.cell_key, bs_ref: r.bs_ref,
        reason: r.reason, dismissed_by: r.dismissed_by, dismissed_at: r.dismissed_at,
        row_fingerprint: r.row_fingerprint,
        payee: r.e_payee || r.i_source || null,
        amount: r.e_amount != null ? Number(r.e_amount) : (r.i_amount != null ? Number(r.i_amount) : null),
        currency: r.e_currency || r.i_currency || null,
        // Orphaned = an item dismissal whose display row is gone (statement
        // re-upload). The fingerprint still suppresses a matching row.
        orphaned: r.scope === 'item' && !r.e_payee && !r.i_source,
      })),
    });
  } catch (e) { console.error('dismissals error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.post('/dismiss', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.scope === 'category') {
      if (!['income', 'expense'].includes(b.cell_kind) || !String(b.cell_key || '').trim()) {
        return res.status(400).json({ success: false, error: 'cell_kind and cell_key required' });
      }
      await pool.query(
        `INSERT INTO report_dismissals (label_id, scope, cell_kind, cell_key, reason, dismissed_by)
         VALUES ($1, 'category', $2, $3, $4, $5)
         ON CONFLICT (label_id, cell_kind, LOWER(TRIM(cell_key))) WHERE scope = 'category' DO NOTHING`,
        [req.labelId, b.cell_kind, String(b.cell_key).trim(), b.reason || null, req.user.name]
      );
      await logActivity(req, 'Dismissed report line', `${b.cell_kind} · ${b.cell_key}`);
      activityBot.postEvent(req.labelId, { text: `📊 P&L line *${b.cell_key}* excluded from Reports by ${req.user.name}`, icon: 'bar-chart-3', link: '/reports' });
      return res.json({ success: true });
    }
    if (b.scope === 'bs_line') {
      const valid = ['accounts_receivable', 'accounts_payable', 'advances_outstanding'];
      const key = String(b.cell_key || '');
      if (!valid.includes(key) && !/^cash:[a-z0-9_-]+$/.test(key)) return res.status(400).json({ success: false, error: 'Unknown balance-sheet line' });
      await pool.query(
        `INSERT INTO report_dismissals (label_id, scope, cell_key, reason, dismissed_by)
         VALUES ($1, 'bs_line', $2, $3, $4)
         ON CONFLICT (label_id, LOWER(TRIM(cell_key))) WHERE scope = 'bs_line' DO NOTHING`,
        [req.labelId, key, b.reason || null, req.user.name]
      );
      await logActivity(req, 'Excluded balance-sheet line', key);
      return res.json({ success: true });
    }
    if (b.scope === 'bs_item') {
      const m = /^(ar|ap|adv):(\d+)$/.exec(String(b.bs_ref || ''));
      if (!m) return res.status(400).json({ success: false, error: 'bs_ref must be ar:|ap:|adv:<id>' });
      // Verify the referenced row belongs to this label.
      const table = m[1] === 'ar' ? 'invoices' : m[1] === 'ap' ? 'expenses' : 'artist_income';
      const own = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND label_id = $2`, [Number(m[2]), req.labelId]);
      if (!own.rows.length) return res.status(404).json({ success: false, error: 'No such row' });
      await pool.query(
        `INSERT INTO report_dismissals (label_id, scope, bs_ref, reason, dismissed_by)
         VALUES ($1, 'bs_item', $2, $3, $4)
         ON CONFLICT (label_id, bs_ref) WHERE scope = 'bs_item' DO NOTHING`,
        [req.labelId, b.bs_ref, b.reason || null, req.user.name]
      );
      await logActivity(req, 'Excluded balance-sheet item', b.bs_ref);
      return res.json({ success: true });
    }
    // item scope — by live row id.
    if (b.expense_id) {
      const row = (await pool.query(
        `SELECT e.id, e.payee, e.amount, r.payment_date FROM expenses e
          JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
         WHERE e.id = $1 AND e.label_id = $2`,
        [Number(b.expense_id), req.labelId]
      )).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such expense' });
      const fp = fingerprintOfExpense(row);
      await pool.query(
        `INSERT INTO report_dismissals (label_id, scope, row_fingerprint, expense_id, cell_kind, cell_key, reason, dismissed_by)
         VALUES ($1, 'item', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (label_id, row_fingerprint) WHERE scope = 'item' DO NOTHING`,
        [req.labelId, fp, row.id, b.cell_kind || 'expense', b.cell_key || null, b.reason || null, req.user.name]
      );
      await logActivity(req, 'Dismissed report item', `expense #${row.id} · ${row.payee || ''}`);
      return res.json({ success: true, data: { fingerprint: fp } });
    }
    if (b.income_id) {
      const row = (await pool.query(
        `SELECT id, source, description, amount, income_date FROM artist_income WHERE id = $1 AND label_id = $2`,
        [Number(b.income_id), req.labelId]
      )).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such income row' });
      const fp = fingerprintOfIncome(row);
      await pool.query(
        `INSERT INTO report_dismissals (label_id, scope, row_fingerprint, income_id, cell_kind, cell_key, reason, dismissed_by)
         VALUES ($1, 'item', $2, $3, 'income', $4, $5, $6)
         ON CONFLICT (label_id, row_fingerprint) WHERE scope = 'item' DO NOTHING`,
        [req.labelId, fp, row.id, b.cell_key || null, b.reason || null, req.user.name]
      );
      await logActivity(req, 'Dismissed report item', `income #${row.id}`);
      return res.json({ success: true, data: { fingerprint: fp } });
    }
    res.status(400).json({ success: false, error: 'Nothing to dismiss' });
  } catch (e) { console.error('dismiss error:', e); res.status(500).json({ success: false, error: 'Dismiss failed' }); }
});

router.post('/dismiss/restore', async (req, res) => {
  try {
    const b = req.body || {};
    let result;
    if (b.id) {
      result = await pool.query(`DELETE FROM report_dismissals WHERE id = $1 AND label_id = $2 RETURNING id`, [Number(b.id), req.labelId]);
    } else if (b.scope === 'category') {
      result = await pool.query(
        `DELETE FROM report_dismissals WHERE label_id = $1 AND scope = 'category' AND cell_kind = $2 AND LOWER(TRIM(cell_key)) = LOWER(TRIM($3)) RETURNING id`,
        [req.labelId, b.cell_kind, String(b.cell_key || '')]
      );
    } else if (b.scope === 'bs_line') {
      result = await pool.query(
        `DELETE FROM report_dismissals WHERE label_id = $1 AND scope = 'bs_line' AND LOWER(TRIM(cell_key)) = LOWER(TRIM($2)) RETURNING id`,
        [req.labelId, String(b.cell_key || '')]
      );
    } else if (b.scope === 'bs_item') {
      result = await pool.query(`DELETE FROM report_dismissals WHERE label_id = $1 AND scope = 'bs_item' AND bs_ref = $2 RETURNING id`, [req.labelId, String(b.bs_ref || '')]);
    } else if (b.expense_id) {
      const row = (await pool.query(
        `SELECT e.id, e.payee, e.amount, r.payment_date FROM expenses e JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id) WHERE e.id = $1 AND e.label_id = $2`,
        [Number(b.expense_id), req.labelId]
      )).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such expense' });
      result = await pool.query(`DELETE FROM report_dismissals WHERE label_id = $1 AND scope = 'item' AND row_fingerprint = $2 RETURNING id`, [req.labelId, fingerprintOfExpense(row)]);
    } else if (b.income_id) {
      const row = (await pool.query(`SELECT id, source, description, amount, income_date FROM artist_income WHERE id = $1 AND label_id = $2`, [Number(b.income_id), req.labelId])).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such income row' });
      result = await pool.query(`DELETE FROM report_dismissals WHERE label_id = $1 AND scope = 'item' AND row_fingerprint = $2 RETURNING id`, [req.labelId, fingerprintOfIncome(row)]);
    } else {
      return res.status(400).json({ success: false, error: 'Nothing to restore' });
    }
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'No matching dismissal' });
    await logActivity(req, 'Restored report dismissal', JSON.stringify(b));
    res.json({ success: true, data: { removed: result.rows.length } });
  } catch (e) { console.error('restore error:', e); res.status(500).json({ success: false, error: 'Restore failed' }); }
});

// ── Month reassignment (report-only; the row keeps its real date) ────────────
router.post('/reassign-month', async (req, res) => {
  try {
    const b = req.body || {};
    const target = b.target_month === null || b.target_month === '' ? null : String(b.target_month);
    if (target && !/^\d{4}-\d{2}$/.test(target)) return res.status(400).json({ success: false, error: 'target_month must be YYYY-MM' });

    let fp, original, ids = { expense_id: null, income_id: null };
    if (b.expense_id) {
      const row = (await pool.query(
        `SELECT e.id, e.payee, e.amount, r.payment_date FROM expenses e JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id) WHERE e.id = $1 AND e.label_id = $2`,
        [Number(b.expense_id), req.labelId]
      )).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such expense' });
      fp = fingerprintOfExpense(row); original = ym(row.payment_date); ids.expense_id = row.id;
    } else if (b.income_id) {
      const row = (await pool.query(`SELECT id, source, description, amount, income_date FROM artist_income WHERE id = $1 AND label_id = $2`, [Number(b.income_id), req.labelId])).rows[0];
      if (!row) return res.status(404).json({ success: false, error: 'No such income row' });
      fp = fingerprintOfIncome(row); original = ym(row.income_date); ids.income_id = row.id;
    } else {
      return res.status(400).json({ success: false, error: 'expense_id or income_id required' });
    }

    if (!target || target === original) {
      // Put-it-back is the same control — delete the override, store no no-op.
      await pool.query(`DELETE FROM report_month_overrides WHERE label_id = $1 AND row_fingerprint = $2`, [req.labelId, fp]);
      await logActivity(req, 'Cleared report month override', fp);
      return res.json({ success: true, data: { cleared: true } });
    }
    await pool.query(
      `INSERT INTO report_month_overrides (label_id, row_fingerprint, expense_id, income_id, original_month, target_month, reason, moved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (label_id, row_fingerprint)
       DO UPDATE SET target_month = EXCLUDED.target_month, reason = EXCLUDED.reason, moved_by = EXCLUDED.moved_by, moved_at = NOW()`,
      [req.labelId, fp, ids.expense_id, ids.income_id, original, target, b.reason || null, req.user.name]
    );
    await logActivity(req, 'Reassigned report month', `${fp} · ${original} → ${target}`);
    res.json({ success: true, data: { original_month: original, target_month: target } });
  } catch (e) { console.error('reassign error:', e); res.status(500).json({ success: false, error: 'Reassign failed' }); }
});

// ── Drill actions ────────────────────────────────────────────────────────────
router.post('/recategorize', async (req, res) => {
  try {
    const b = req.body || {};
    const category = String(b.category || '').trim();
    if (!category) return res.status(400).json({ success: false, error: 'category required' });
    if (b.expense_id) {
      const r = await pool.query(
        `UPDATE expenses SET category = $1 WHERE id = $2 AND label_id = $3 RETURNING id, payee, category`,
        [category, Number(b.expense_id), req.labelId]
      );
      if (!r.rows.length) return res.status(404).json({ success: false, error: 'No such expense' });
      await logActivity(req, 'Recategorized from Reports', `expense #${b.expense_id} → ${category}`);
      return res.json({ success: true, data: r.rows[0] });
    }
    if (b.income_id) {
      const r = await pool.query(
        `UPDATE artist_income SET source = $1 WHERE id = $2 AND label_id = $3 RETURNING id, source`,
        [category, Number(b.income_id), req.labelId]
      );
      if (!r.rows.length) return res.status(404).json({ success: false, error: 'No such income row' });
      await logActivity(req, 'Retyped income from Reports', `income #${b.income_id} → ${category}`);
      return res.json({ success: true, data: r.rows[0] });
    }
    res.status(400).json({ success: false, error: 'expense_id or income_id required' });
  } catch (e) { console.error('recategorize error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.post('/set-artist', async (req, res) => {
  try {
    const b = req.body || {};
    const ids = (b.expense_ids ? [].concat(b.expense_ids) : [b.expense_id]).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return res.status(400).json({ success: false, error: 'expense_ids required' });
    if (ids.length > 2000) return res.status(400).json({ success: false, error: 'Too many rows (max 2000)' });
    const artist = String(b.artist || '').trim() || null;
    const r = await pool.query(
      `UPDATE expenses SET artist = $1
        WHERE id = ANY($2::int[]) AND label_id = $3
          AND (deleted IS NULL OR deleted = FALSE) AND (voided IS NULL OR voided = FALSE)
        RETURNING id`,
      [artist, ids, req.labelId]
    );
    await logActivity(req, 'Set artist from Reports', `${r.rows.length} of ${ids.length} rows → ${artist || '(cleared)'}`);
    res.json({ success: true, data: { updated: r.rows.length, requested: ids.length, skipped: ids.length - r.rows.length } });
  } catch (e) { console.error('set-artist error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// ── Vocabulary maintenance (admin) ───────────────────────────────────────────
router.post('/classify', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const kind = b.kind === 'income' ? 'income' : 'expense';
    const section = String(b.section || '');
    if (!['operating', 'below_line', 'non_recurring'].includes(section)) return res.status(400).json({ success: false, error: 'section must be operating|below_line|non_recurring' });
    if (b.contra_of && kind !== 'income') return res.status(400).json({ success: false, error: 'contra_of applies to income lines only' });
    const r = await pool.query(
      `UPDATE categories SET report_section = $1, contra_of = $2, section_set = TRUE
        WHERE label_id = $3 AND kind = $4 AND LOWER(TRIM(name)) = LOWER(TRIM($5)) RETURNING name`,
      [section, b.contra_of || null, req.labelId, kind, String(b.category || '')]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'No such category' });
    await logActivity(req, 'Reclassified report section', `${kind} · ${r.rows[0].name} → ${section}`);
    activityBot.postEvent(req.labelId, { text: `📊 *${r.rows[0].name}* reclassified to ${section.replace('_', ' ')} on Reports by ${req.user.name}`, icon: 'bar-chart-3', link: '/reports' });
    res.json({ success: true });
  } catch (e) { console.error('classify error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// Transactional rename/merge across every place a category name lives.
router.post('/rename-category', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const kind = req.body.kind === 'income' ? 'income' : 'expense';
    const from = String(req.body.from || '').trim();
    const to = String(req.body.to || '').replace(/\s+/g, ' ').trim();
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to required' });
    if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ success: false, error: 'Same name' });

    await client.query('BEGIN');
    const counts = {};
    const run = async (label, sql, params) => {
      try { const r = await client.query(sql, params); counts[label] = r.rowCount; }
      catch (e) { throw new Error(`${label}: ${e.message}`); }
    };
    if (kind === 'expense') {
      await run('expenses', `UPDATE expenses SET category = $1 WHERE label_id = $2 AND LOWER(TRIM(category)) = LOWER($3)`, [to, req.labelId, from]);
      await run('statement_category_rules', `UPDATE statement_category_rules SET category = $1 WHERE label_id = $2 AND LOWER(TRIM(category)) = LOWER($3)`, [to, req.labelId, from]);
      await run('contra_targets', `UPDATE categories SET contra_of = $1 WHERE label_id = $2 AND LOWER(TRIM(contra_of)) = LOWER($3)`, [to, req.labelId, from]);
    } else {
      await run('artist_income', `UPDATE artist_income SET source = $1 WHERE label_id = $2 AND LOWER(TRIM(source)) = LOWER($3)`, [to, req.labelId, from]);
    }
    await run('report_dismissals', `UPDATE report_dismissals SET cell_key = $1 WHERE label_id = $2 AND scope = 'category' AND cell_kind = $3 AND LOWER(TRIM(cell_key)) = LOWER($4)`, [to, req.labelId, kind, from]);

    // Vocabulary row: merge onto an existing target (delete source), else rename.
    const target = await client.query(
      `SELECT id FROM categories WHERE label_id = $1 AND kind = $2 AND LOWER(TRIM(name)) = LOWER($3)`,
      [req.labelId, kind, to]
    );
    const source = await client.query(
      `SELECT id, seeded FROM categories WHERE label_id = $1 AND kind = $2 AND LOWER(TRIM(name)) = LOWER($3)`,
      [req.labelId, kind, from]
    );
    let merged = false;
    if (target.rows.length) {
      merged = true;
      if (source.rows.length) await client.query(`DELETE FROM categories WHERE id = $1 AND label_id = $2`, [source.rows[0].id, req.labelId]);
      await client.query(`UPDATE categories SET active = TRUE WHERE id = $1 AND label_id = $2`, [target.rows[0].id, req.labelId]);
    } else if (source.rows.length) {
      await client.query(`UPDATE categories SET name = $1, section_set = TRUE WHERE id = $2 AND label_id = $3`, [to, source.rows[0].id, req.labelId]);
    } else {
      await client.query(
        `INSERT INTO categories (label_id, kind, name, active, seeded, section_set, created_by) VALUES ($1, $2, $3, TRUE, FALSE, TRUE, $4)
         ON CONFLICT (label_id, kind, LOWER(TRIM(name))) DO NOTHING`,
        [req.labelId, kind, to, req.user.name]
      );
    }
    // Tombstone: a rename away from a SEEDED name must survive the boot seed,
    // or the old name resurrects on the next deploy.
    if (source.rows.length && source.rows[0].seeded) {
      await client.query(
        `INSERT INTO categories (label_id, kind, name, active, seeded, section_set, created_by)
         VALUES ($1, $2, $3, FALSE, TRUE, TRUE, $4)
         ON CONFLICT (label_id, kind, LOWER(TRIM(name))) DO UPDATE SET active = FALSE, section_set = TRUE`,
        [req.labelId, kind, from, req.user.name]
      );
    }
    await client.query('COMMIT');
    await logActivity(req, 'Renamed category', `${kind} · ${from} → ${to} (${JSON.stringify(counts)})`);
    activityBot.postEvent(req.labelId, { text: `📊 Category *${from}* renamed to *${to}* by ${req.user.name}`, icon: 'bar-chart-3', link: '/reports' });
    res.json({ success: true, data: { merged, counts } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('rename-category error:', e);
    res.status(500).json({ success: false, error: e.message || 'Rename failed' });
  } finally {
    client.release();
  }
});

// ── Excel exports ────────────────────────────────────────────────────────────
router.get('/pnl/export', async (req, res) => {
  try {
    const { from, to, artist } = req.query;
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const pnl = await buildPnl(req.labelId, from, to, artist || null);
    const buf = await require('../lib/reportRows').pnlWorkbook(pnl, { from, to, artist });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cadence-pnl-${from}-to-${to}.xlsx"`);
    res.send(buf);
  } catch (e) { console.error('pnl export error:', e); res.status(500).json({ success: false, error: 'Export failed' }); }
});

router.get('/spend-by-artist/export', async (req, res) => {
  try {
    const { from, to } = req.query;
    const topN = Math.max(0, parseInt(req.query.topN, 10) || 0);
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const pnl = await buildPnl(req.labelId, from, to, null);
    const data = await shapeSpendByArtist(req.labelId, from, to, pnl);
    const buf = await require('../lib/reportRows').spendByArtistWorkbook(data, { from, to, topN });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cadence-spend-by-artist-${from}-to-${to}.xlsx"`);
    res.send(buf);
  } catch (e) { console.error('sba export error:', e); res.status(500).json({ success: false, error: 'Export failed' }); }
});

router.get('/balance-sheet/export', async (req, res) => {
  try {
    const asOf = isValidDay(req.query.as_of) ? req.query.as_of : ymd(new Date());
    const bs = await buildBalanceSheet(req.labelId, asOf);
    const buf = await require('../lib/reportRows').balanceSheetWorkbook(bs);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cadence-balance-sheet-${asOf}.xlsx"`);
    res.send(buf);
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ success: false, error: e.message });
    console.error('bs export error:', e);
    res.status(500).json({ success: false, error: 'Export failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Allocate Advertising — the ad pool, charge by charge
// ═══════════════════════════════════════════════════════════════════════════
//
// ── What "unallocated" means, and why it comes from buildPnl ──
// A charge is in the pool because `label_level_spend_rules` says its vendor (or
// its category) bills the label, AND no part of it names an artist. That test
// lives at ONE call site — the operating branch of buildPnl — and this page
// lists exactly the rows it fired on, via `collectLabelLevel`. A second query
// with its own idea of label-level is the shape that puts a drill-through at one
// number against a report saying something else.
//
// Bank is the money, Ads Manager is the basis: only real charges are ever
// apportioned. An import supplies proportions and nothing else, so there is no
// reconciliation remainder to park anywhere.

const AD_MONTH_RE = /^\d{4}-\d{2}$/;

// pg hands back a JS Date for DATE columns, and `String(aDate)` is
// "Tue May 04 2032 …" — so comparing those strings sorts by WEEKDAY NAME. Not
// hypothetical: in the reference app it put the 10th before the 4th and the
// greedy draw then consumed the wrong charge first. Everything below orders on
// this.
const adDay = (d) => {
  if (!d) return '';
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(d).slice(0, 10);
};

/** A family's live members, root first — the one shape every step below reads. */
async function famRows(client, labelId, root) {
  const { rows } = await client.query(
    `SELECT id, parent_id, amount::float8 AS amount, COALESCE(currency,'USD') AS currency,
            fx_rate_to_usd, artist, song, category, campaign_id, payee, payment_date,
            payment_method, entry_source, invoice_date, description,
            status, approved_by, approved_at, payment_status, rep, recoupable
       FROM expenses
      WHERE label_id = $1 AND (id = $2 OR parent_id = $2)
        AND (deleted IS NULL OR deleted = FALSE) AND (voided IS NULL OR voided = FALSE)
      ORDER BY (parent_id IS NULL) DESC, id ASC`,
    [labelId, root]
  );
  return rows;
}

/**
 * Keep the parent's `artist_breakdown` in step with the family. It is the
 * denormalized copy `DELETE /ledger/entries/:id/splits` restores from, which is
 * what makes unsplit work for free. A one-member family is not a split, so the
 * copy is cleared rather than left describing a division that no longer exists.
 */
async function writeAdBreakdown(client, labelId, root, fam) {
  if (fam.length < 2) {
    await client.query('UPDATE expenses SET artist_breakdown = NULL WHERE id = $1 AND label_id = $2', [root, labelId]);
    return;
  }
  const bd = fam.map((m) => ({
    artist: m.artist || null, song: m.song || null,
    amount: round2(Number(m.amount)), campaign_id: m.campaign_id || null,
  }));
  await client.query('UPDATE expenses SET artist_breakdown = $1::jsonb WHERE id = $2 AND label_id = $3',
    [JSON.stringify(bd), root, labelId]);
}

/**
 * One month of the ad pool: its charges, what is already allocated on each, and
 * what is left. Shared by the listing, the dry run and the write, so all three
 * agree about what is available BY CONSTRUCTION.
 */
async function adMonthState(labelId, month) {
  const collected = [];
  const pnl = await buildPnl(labelId, monthStart(month), monthEnd(month), null, { collectLabelLevel: collected });

  // ── charges this page has ALREADY finished ──
  // A fully-allocated charge is by definition no longer label-level: every slice
  // names an artist, so the collector never sees it. Listing only what the
  // collector returns would make a completed charge VANISH and take its
  // allocation out of `allocated_cents` with it, so the page would under-report
  // its own work. "Which charges did we allocate in this month" is a different
  // and purely factual question, not a second opinion about label-level.
  const { rows: doneRoots } = await pool.query(
    `SELECT DISTINCT COALESCE(e.parent_id, e.id) AS root
       FROM expenses e
      WHERE e.label_id = $1 AND e.campaign_id IS NOT NULL
        AND TO_CHAR(e.payment_date, 'YYYY-MM') = $2
        AND (e.deleted IS NULL OR e.deleted = FALSE)
        AND (e.voided IS NULL OR e.voided = FALSE)`,
    [labelId, month]
  );

  const rootIds = [...new Set([
    ...collected.map((x) => x.root_id).filter((x) => x != null),
    ...doneRoots.map((r) => r.root),
  ])];
  // The ledger rows the label-level test actually fired on: the parts still
  // belonging to nobody. This SET, not a re-derived predicate, is what "open"
  // means everywhere below.
  const openIds = new Set(collected.map((x) => x.expense_id).filter((x) => x != null));
  const usdByPart = new Map(collected.map((x) => [x.expense_id, x.usd]));

  let members = [];
  if (rootIds.length) {
    const { rows } = await pool.query(
      `SELECT e.id, e.parent_id, e.amount::float8 AS amount, COALESCE(e.currency,'USD') AS currency,
              e.fx_rate_to_usd, e.artist, e.song, e.category, e.campaign_id, e.payee,
              e.payment_date, e.description, e.entry_source,
              -- A member carrying a document must not be restructured: for the
              -- legacy inline path that blob is the ONLY copy of the file.
              (e.receipt_r2_key IS NOT NULL OR e.receipt_filename IS NOT NULL
                OR e.invoice_r2_key IS NOT NULL OR e.invoice_filename IS NOT NULL) AS has_file,
              c.name AS campaign_name
         FROM expenses e
         LEFT JOIN campaigns c ON c.id = e.campaign_id AND c.label_id = e.label_id
        WHERE e.label_id = $1 AND (e.id = ANY($2::int[]) OR e.parent_id = ANY($2::int[]))
          AND (e.deleted IS NULL OR e.deleted = FALSE)
          AND (e.voided IS NULL OR e.voided = FALSE)
        ORDER BY (e.parent_id IS NULL) DESC, e.id ASC`,
      [labelId, rootIds]
    );
    members = rows;
  }
  const famOf = new Map();
  for (const m of members) {
    const root = m.parent_id || m.id;
    if (!famOf.has(root)) famOf.set(root, []);
    famOf.get(root).push(m);
  }
  const firstPartOf = new Map();
  for (const d of collected) if (d.root_id != null && !firstPartOf.has(d.root_id)) firstPartOf.set(d.root_id, d);

  const charges = [];
  for (const rootId of rootIds) {
    const fam = famOf.get(rootId) || [];
    if (!fam.length) continue;
    const rootRow = fam.find((m) => !m.parent_id) || fam[0];
    const d = firstPartOf.get(rootId) || {
      date: rootRow.payment_date, month, payee: rootRow.payee,
      category: rootRow.category, root_id: rootId,
    };
    const open = fam.filter((m) => openIds.has(m.id));
    const chargeCents = fam.reduce((s, m) => s + toCents(m.amount), 0);
    const openCents = open.reduce((s, m) => s + toCents(m.amount), 0);
    // Every reason a charge cannot be restructured, NAMED rather than filtered
    // out — a page that silently omits a charge is a page whose total nobody can
    // reproduce.
    const blocked = [];
    if (rootRow.parent_id) blocked.push('family root missing');
    if (fam.some((m) => m.has_file)) blocked.push('a slice carries a document');
    if (open.length > 1) blocked.push(`${open.length} unattributed slices — split by hand, needs sorting out first`);
    if (!openCents) blocked.push('nothing unallocated');
    charges.push({
      root_id: rootId,
      date: d.date, month: d.month, payee: d.payee,
      description: rootRow.description, category: d.category,
      currency: rootRow.currency || 'USD',
      charge_cents: chargeCents,
      open_cents: openCents,
      open_expense_id: open.length === 1 ? open[0].id : null,
      // What the P&L scores the open part at. Equal to `open_cents` for a USD
      // charge, and shown beside it rather than assumed: a foreign charge is
      // allocated in its own currency and reported in dollars.
      open_usd: round2(open.reduce((s, m) => s + (usdByPart.get(m.id) || 0), 0)),
      allocations: fam.filter((m) => m.campaign_id).map((m) => ({
        expense_id: m.id, campaign_id: m.campaign_id, campaign_name: m.campaign_name,
        artist: m.artist, song: m.song, cents: toCents(m.amount),
      })),
      // Named by somebody through the Reports drill rather than by this page.
      // Not ours to move, and counted so the arithmetic on the row adds up.
      attributed: fam.filter((m) => !m.campaign_id && String(m.artist || '').trim()).map((m) => ({
        expense_id: m.id, artist: m.artist, song: m.song, cents: toCents(m.amount),
      })),
      allocatable: blocked.length === 0,
      blocked,
    });
  }
  charges.sort((a, b) => adDay(a.date).localeCompare(adDay(b.date)) || a.root_id - b.root_id);

  const ll = pnl.by_artist?.label_level || {};
  return {
    month, charges,
    open_cents: charges.reduce((s, c) => s + c.open_cents, 0),
    allocatable_cents: charges.filter((c) => c.allocatable).reduce((s, c) => s + c.open_cents, 0),
    allocated_cents: charges.reduce((s, c) => s + c.allocations.reduce((t, a) => t + a.cents, 0), 0),
    // The pool as the REPORT states it, so the page can never quietly disagree
    // with the P&L it is drawing from.
    pool_usd: round2(Number(ll.total) || 0),
    open_usd: round2(charges.reduce((s, c) => s + c.open_usd, 0)),
    by_category: ll.by_category || {},
    rule_count: ll.rule_count || 0,
  };
}

// GET /ad-months?from=&to= — how much pool each month holds, so the page can
// open on the OLDEST month with money in it and show the backlog at a glance.
// ONE buildPnl over the whole range, grouped by the month the collector already
// stamps on each row — not a call per month, and not a cheaper query of its own
// (that would be a second idea of what label-level means, and navigation
// drifting from money is how a page starts lying).
router.get('/ad-months', async (req, res) => {
  try {
    const to = isValidDay(req.query.to) ? req.query.to : ymd(new Date());
    const from = isValidDay(req.query.from) ? req.query.from : `${Number(to.slice(0, 4)) - 2}-01-01`;
    const problem = rangeProblem(from, to);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const collected = [];
    await buildPnl(req.labelId, from, to, null, { collectLabelLevel: collected });
    const by = new Map();
    for (const c of collected) {
      if (!by.has(c.month)) by.set(c.month, { month: c.month, usd: 0, charges: 0 });
      const m = by.get(c.month);
      m.usd += c.usd;
      m.charges += 1;
    }
    const months = [...by.values()]
      .map((m) => ({ ...m, usd: round2(m.usd) }))
      .filter((m) => m.charges > 0)
      .sort((a, b) => a.month.localeCompare(b.month));
    res.json({ success: true, data: { from, to, months, total: round2(months.reduce((s, m) => s + m.usd, 0)) } });
  } catch (e) { console.error('ad-months error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

// GET /ad-charges?month=YYYY-MM — the pool, charge by charge, plus the campaigns.
router.get('/ad-charges', async (req, res) => {
  try {
    const month = AD_MONTH_RE.test(String(req.query.month || '')) ? req.query.month : null;
    if (!month) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    const state = await adMonthState(req.labelId, month);

    // Campaigns dated in this month, plus any campaign already holding money
    // from it — a campaign run in June and paid for in July must not disappear
    // from the month whose charges funded it.
    const { rows: campaigns } = await pool.query(
      `SELECT c.id, c.name, c.platform, c.status, c.start_date, c.release_id,
              c.planned_budget::float8 AS planned_budget, c.artist_id,
              a.name AS artist, r.project_name AS song,
              COALESCE(al.cents, 0)::int AS allocated_cents,
              COALESCE(tot.cents, 0)::int AS allocated_cents_all_time
         FROM campaigns c
         LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
         LEFT JOIN releases r ON r.id = c.release_id AND r.label_id = c.label_id
         LEFT JOIN (
           SELECT e.campaign_id, ROUND(SUM(e.amount) * 100)::int AS cents
             FROM expenses e
            WHERE e.label_id = $1 AND e.campaign_id IS NOT NULL
              AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
              AND TO_CHAR(e.payment_date, 'YYYY-MM') = $2
            GROUP BY e.campaign_id) al ON al.campaign_id = c.id
         LEFT JOIN (
           SELECT e.campaign_id, ROUND(SUM(e.amount) * 100)::int AS cents
             FROM expenses e
            WHERE e.label_id = $1 AND e.campaign_id IS NOT NULL
              AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
            GROUP BY e.campaign_id) tot ON tot.campaign_id = c.id
        WHERE c.label_id = $1
          AND (TO_CHAR(c.start_date, 'YYYY-MM') = $2 OR COALESCE(al.cents, 0) > 0)
        ORDER BY a.name NULLS LAST, c.name`,
      [req.labelId, month]
    );
    res.json({ success: true, data: { ...state, campaigns } });
  } catch (e) { console.error('ad-charges error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

/**
 * Resolve the requested allocations against a month, WITHOUT writing.
 * Returns the exact plan a write would perform, so `dry_run` and the apply share
 * one derivation — a preview computed differently from the write is a preview
 * that lies, and this page's whole safety story is that you approve what you see.
 */
async function planAdAllocation(labelId, month, requests) {
  const state = await adMonthState(labelId, month);
  const ids = [...new Set(requests.map((r) => r.campaign_id))];
  const { rows: camps } = await pool.query(
    `SELECT c.id, c.name, c.platform, c.release_id, a.name AS artist, r.project_name AS song
       FROM campaigns c
       LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
       LEFT JOIN releases r ON r.id = c.release_id AND r.label_id = c.label_id
      WHERE c.label_id = $1 AND c.id = ANY($2::int[])`,
    [labelId, ids]
  );
  const campById = new Map(camps.map((c) => [c.id, c]));
  const missing = ids.filter((i) => !campById.has(i));
  if (missing.length) return { error: `Unknown campaign${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
  // A campaign with no artist cannot attribute anything, which is the entire
  // point of allocating. Refused here rather than writing a slice that names
  // nobody and looks allocated.
  const nameless = camps.filter((c) => !String(c.artist || '').trim());
  if (nameless.length) {
    return { error: 'These campaigns have no artist, so allocating to them would attribute nothing: '
      + nameless.map((c) => c.name).join(', ') };
  }

  const allocatable = state.charges.filter((c) => c.allocatable);
  const draw = drawMany(
    allocatable.map((c) => ({ id: c.root_id, remaining_cents: c.open_cents })),
    requests.map((r) => ({ campaign_id: r.campaign_id, cents: r.cents }))
  );

  if (draw.short_total > 0) {
    const blockedCents = state.charges.filter((c) => !c.allocatable).reduce((s, c) => s + c.open_cents, 0);
    return {
      error: `${month} has ${fromCents(state.allocatable_cents).toFixed(2)} of unallocated ad charges`
        + ` — ${fromCents(requests.reduce((s, r) => s + r.cents, 0)).toFixed(2)} would over-allocate it by`
        + ` ${fromCents(draw.short_total).toFixed(2)}.`
        + (blockedCents > 0 ? ` A further ${fromCents(blockedCents).toFixed(2)} is in charges that cannot be restructured.` : '')
        + ' Reduce the amount, or allocate from another month.',
      data: { allocatable: fromCents(state.allocatable_cents), short: fromCents(draw.short_total) },
    };
  }

  // Regroup by charge: one write per family, whatever it was drawn for.
  const byRoot = new Map();
  for (const p of draw.plan) {
    const c = campById.get(p.campaign_id);
    for (const s of p.slices) {
      if (!byRoot.has(s.id)) byRoot.set(s.id, []);
      byRoot.get(s.id).push({
        campaign_id: p.campaign_id, campaign_name: c.name,
        artist: c.artist, song: c.song || null, cents: s.cents,
      });
    }
  }
  const chargeById = new Map(state.charges.map((c) => [c.root_id, c]));
  const per_charge = [...byRoot.entries()].map(([root, slices]) => {
    const c = chargeById.get(root);
    const take = slices.reduce((s, x) => s + x.cents, 0);
    return {
      root_id: root, date: c.date, payee: c.payee, category: c.category,
      charge: fromCents(c.charge_cents), open_before: fromCents(c.open_cents),
      allocating: fromCents(take), open_after: fromCents(c.open_cents - take),
      whole_charge: take === c.open_cents,
      slices: slices.map((x) => ({ ...x, amount: fromCents(x.cents) })),
    };
  }).sort((a, b) => adDay(a.date).localeCompare(adDay(b.date)) || a.root_id - b.root_id);

  return {
    month,
    per_campaign: draw.plan.map((p) => ({
      campaign_id: p.campaign_id, campaign_name: campById.get(p.campaign_id).name,
      artist: campById.get(p.campaign_id).artist, song: campById.get(p.campaign_id).song || null,
      amount: fromCents(p.cents), charges: p.slices.length,
    })),
    per_charge,
    total: fromCents(draw.total),
    open_before: fromCents(state.allocatable_cents),
    open_after: fromCents(state.allocatable_cents - draw.total),
    state, byRoot,
  };
}

// POST /ad-allocate
//   { month, campaign_id, amount, dry_run }                  one campaign
//   { month, allocations: [{campaign_id, amount}], dry_run }  an import
//
// Writes a real split family per charge. The slices carry `entry_source`,
// `recoup_reviewed`, `recoupable` and `campaign_id` EXPLICITLY — see the comment
// on the INSERT, which is why this does not call the shared split writer.
router.post('/ad-allocate', async (req, res) => {
  try {
    const month = AD_MONTH_RE.test(String(req.body.month || '')) ? req.body.month : null;
    if (!month) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });

    const raw = Array.isArray(req.body.allocations) && req.body.allocations.length
      ? req.body.allocations
      : [{ campaign_id: req.body.campaign_id, amount: req.body.amount }];
    // Two rows for one campaign are ONE allocation — otherwise the second would
    // silently draw from what the first left and the campaign would show a total
    // nobody asked for.
    const merged = new Map();
    for (const r of raw) {
      const id = Number(r.campaign_id);
      const cents = toCents(Math.abs(Number(r.amount) || 0));
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, error: 'each allocation needs a campaign_id' });
      if (cents <= 0) return res.status(400).json({ success: false, error: 'each allocation needs an amount greater than zero' });
      merged.set(id, (merged.get(id) || 0) + cents);
    }
    let requests = [...merged.entries()].map(([campaign_id, cents]) => ({ campaign_id, cents }));

    // ── proportional: an Ads Manager export ──
    // The file gives per-campaign SPEND, which will not equal the bank. Rather
    // than allocating the report's figures and parking a difference, its numbers
    // are treated as WEIGHTS and the month's actual charges are divided by them:
    // 100% of the real money is apportioned, so the tie-out holds by
    // construction and there is no remainder to explain.
    if (req.body.proportional) {
      const state = await adMonthState(req.labelId, month);
      if (!state.allocatable_cents) return res.status(400).json({ success: false, error: `${month} has no unallocated ad charges to apportion` });
      const cents = apportion(state.allocatable_cents, requests.map((r) => r.cents));
      requests = requests.map((r, i) => ({ campaign_id: r.campaign_id, cents: cents[i] })).filter((r) => r.cents > 0);
      if (!requests.length) return res.status(400).json({ success: false, error: 'the weights given all resolve to zero — nothing to allocate' });
    }

    const plan = await planAdAllocation(req.labelId, month, requests);
    if (plan.error) return res.status(400).json({ success: false, error: plan.error, data: plan.data || null });

    const publicPlan = {
      month: plan.month, per_campaign: plan.per_campaign, per_charge: plan.per_charge,
      total: plan.total, open_before: plan.open_before, open_after: plan.open_after,
    };
    if (req.body.dry_run) return res.json({ success: true, data: { ...publicPlan, dry_run: true } });

    const client = await pool.connect();
    const written = { charges: 0, slices: 0, expense_ids: [] };
    try {
      await client.query('BEGIN');
      for (const [root, slices] of plan.byRoot) {
        const charge = plan.state.charges.find((c) => c.root_id === root);
        const fam = await famRows(client, req.labelId, root);
        const openRow = fam.find((m) => m.id === charge.open_expense_id);
        if (!openRow) throw new Error(`charge ${root} has no single unallocated slice to draw from`);

        const take = slices.reduce((s, x) => s + x.cents, 0);
        const remainder = toCents(openRow.amount) - take;
        if (remainder < 0) throw new Error(`charge ${root} would be over-allocated`);

        let toInsert = slices;
        if (remainder > 0) {
          await client.query('UPDATE expenses SET amount = $1 WHERE id = $2 AND label_id = $3',
            [fromCents(remainder), openRow.id, req.labelId]);
        } else {
          // Fully allocated: the row cannot be left at zero and cannot be deleted
          // when it is the family root (that would destroy the bank match), so it
          // BECOMES the last slice. One fewer child row, and the charge keeps its
          // identity either way.
          const last = slices[slices.length - 1];
          toInsert = slices.slice(0, -1);
          await client.query(
            `UPDATE expenses
                SET amount = $1, artist = $2, song = $3, campaign_id = $4,
                    recoupable = TRUE, recoup_reviewed = TRUE, recoup_reviewed_at = NOW(),
                    recoup_reviewed_by = $5, artist_campaign = TRUE
              WHERE id = $6 AND label_id = $7`,
            [fromCents(last.cents), last.artist, last.song, last.campaign_id, req.user.name, openRow.id, req.labelId]
          );
          written.expense_ids.push(openRow.id);
        }

        for (const s of toInsert) {
          // ── Why this INSERT is here and not in the shared split writer ──
          // Four columns that writer does not set, each load-bearing:
          //   entry_source     inherited from the root. The shared writer omits
          //                    the column, so children come out NULL and read as
          //                    hand-entered invoices — a slice of a bank-born
          //                    payment leaking onto the recoupment surfaces
          //                    through the hole the gate was built to close.
          //   recoup_reviewed  the gate itself (lib/recoupments.js
          //                    recoupBaseSql). Without it, "marked reviewed and
          //                    recoupable" would write to a column nobody reads.
          //   recoupable       the answer that gate carries.
          //   campaign_id      the basis. A campaign's spend has to be a query.
          // Teaching the shared writer these semantics would change behaviour for
          // the Ledger and Add-Invoice flows, which call it for something else.
          const { rows: [ins] } = await client.query(
            `INSERT INTO expenses
               (label_id, parent_id, invoice_date, payee, description, category, artist, song, amount,
                currency, payment_method, status, approved_by, approved_at,
                payment_status, payment_date, fx_rate_to_usd, rep,
                entry_source, campaign_id,
                recoupable, recoup_reviewed, recoup_reviewed_at, recoup_reviewed_by,
                artist_campaign, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                     TRUE,TRUE,NOW(),$21,TRUE,$21,NOW())
             RETURNING id`,
            [req.labelId, root, openRow.invoice_date, openRow.payee, openRow.description,
              openRow.category, s.artist, s.song, fromCents(s.cents),
              openRow.currency, openRow.payment_method, openRow.status,
              openRow.approved_by, openRow.approved_at,
              openRow.payment_status, openRow.payment_date, openRow.fx_rate_to_usd, openRow.rep,
              openRow.entry_source, s.campaign_id, req.user.name]
          );
          written.slices += 1;
          written.expense_ids.push(ins.id);
        }

        // The family must still add up to the charge. ASSERTED, not assumed: the
        // shared split writer performs no such check, and a cent per charge is
        // exactly the drift that breaks a spend sheet's tie-out.
        const after = await famRows(client, req.labelId, root);
        const sum = after.reduce((s, m) => s + toCents(m.amount), 0);
        if (sum !== charge.charge_cents) {
          throw new Error(`charge ${root}: slices sum to ${fromCents(sum)} but the charge is `
            + `${fromCents(charge.charge_cents)} — refusing to leave the ledger out by `
            + `${fromCents(sum - charge.charge_cents)}`);
        }
        await writeAdBreakdown(client, req.labelId, root, after);
        written.charges += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }

    for (const c of plan.per_campaign) {
      await pool.query(
        `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor)
         VALUES ($1, NULL, 'ad_allocated', $2, $3)`,
        [req.labelId,
          `Allocated ${Number(c.amount).toFixed(2)} of ${month} ad charges to ${c.artist}`
          + (c.song ? ` — ${c.song}` : '') + ` across ${c.charges} charge${c.charges === 1 ? '' : 's'}`
          + ' — ledger slices, marked reviewed and recoupable',
          req.user.name]
      ).catch(() => {});
    }
    await logActivity(req, 'Allocated ad spend', `${month} · ${plan.total} across ${plan.per_campaign.length} campaign(s)`);

    res.json({ success: true, data: { ...publicPlan, written } });
  } catch (e) {
    console.error('ad-allocate error:', e);
    res.status(500).json({ success: false, error: e.message || 'Allocation failed' });
  }
});

// DELETE /ad-allocate/:expenseId — hand ONE slice back to the pool. Per-slice
// rather than per-charge, because that is the grain the mistake is made at.
router.delete('/ad-allocate/:expenseId', async (req, res) => {
  try {
    const id = Number(req.params.expenseId);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ success: false, error: 'bad id' });

    const { rows: [slice] } = await pool.query(
      `SELECT e.id, e.parent_id, e.amount::float8 AS amount, e.artist, e.campaign_id, e.payee, c.name AS campaign_name
         FROM expenses e LEFT JOIN campaigns c ON c.id = e.campaign_id AND c.label_id = e.label_id
        WHERE e.id = $1 AND e.label_id = $2 AND (e.deleted IS NULL OR e.deleted = FALSE)`,
      [id, req.labelId]
    );
    if (!slice) return res.status(404).json({ success: false, error: 'Entry not found' });
    if (!slice.campaign_id) return res.status(400).json({ success: false, error: 'That row is not an ad allocation — nothing to return' });
    const root = slice.parent_id || slice.id;

    const client = await pool.connect();
    let outcome;
    try {
      await client.query('BEGIN');
      const fam = await famRows(client, req.labelId, root);
      const before = fam.reduce((s, m) => s + toCents(m.amount), 0);
      // The row the money goes back to: the family's unallocated slice, if it
      // has one. Identified by carrying neither an artist nor a campaign — the
      // same thing the pool's own test means by "belonging to nobody".
      const open = fam.find((m) => m.id !== id && !m.campaign_id && !String(m.artist || '').trim());

      if (open && slice.parent_id) {
        await client.query('UPDATE expenses SET amount = $1 WHERE id = $2 AND label_id = $3',
          [fromCents(toCents(open.amount) + toCents(slice.amount)), open.id, req.labelId]);
        await client.query('DELETE FROM expenses WHERE id = $1 AND label_id = $2', [id, req.labelId]);
        outcome = 'folded back into the charge';
      } else {
        // No unallocated slice to merge into — or this IS the root, which cannot
        // be deleted without destroying the bank match that points at it. Strip
        // the labels instead: same money, back to belonging to nobody.
        await client.query(
          `UPDATE expenses
              SET artist = NULL, song = NULL, campaign_id = NULL, artist_campaign = NULL,
                  recoup_reviewed = FALSE, recoup_reviewed_at = NULL, recoup_reviewed_by = NULL
            WHERE id = $1 AND label_id = $2`,
          [id, req.labelId]
        );
        outcome = 'returned to the pool in place';
      }

      const after = await famRows(client, req.labelId, root);
      const sum = after.reduce((s, m) => s + toCents(m.amount), 0);
      if (sum !== before) throw new Error(`undo changed the charge total from ${fromCents(before)} to ${fromCents(sum)}`);
      await writeAdBreakdown(client, req.labelId, root, after);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }

    await pool.query(
      `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor) VALUES ($1,$2,'ad_unallocated',$3,$4)`,
      [req.labelId, id,
        `Returned ${Number(slice.amount).toFixed(2)} from ${slice.campaign_name || 'a campaign'}`
        + ` (${slice.artist || 'no artist'}) to the ad pool — ${outcome}`, req.user.name]
    ).catch(() => {});

    res.json({ success: true, data: { expense_id: id, root_id: root, amount: slice.amount, outcome } });
  } catch (e) {
    console.error('ad-unallocate error:', e);
    res.status(500).json({ success: false, error: e.message || 'Undo failed' });
  }
});

// ── Label-level spend rules — the pool's vocabulary ──────────────────────────
// Also the destination of Artist Campaigns' "these vendors bill the label"
// action on the unattributed queue.
router.get('/label-level-rules', async (req, res) => {
  try {
    const rules = await loadLabelLevelRules(pool, req.labelId);
    // Candidates: unattributed campaign-ish spend NOT already covered, so the
    // page can offer the vendors worth ruling instead of an empty box.
    let candidates = [];
    try {
      const to = isValidDay(req.query.to) ? req.query.to : ymd(new Date());
      const from = isValidDay(req.query.from) ? req.query.from : `${Number(to.slice(0, 4)) - 1}-01-01`;
      const { rows } = await pool.query(
        `SELECT TRIM(e.payee) AS payee, COUNT(*)::int AS n,
                SUM(CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd ELSE e.amount END)::float8 AS usd
           FROM expenses e
           JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id) AND r.label_id = e.label_id
          WHERE e.label_id = $1 AND TRIM(COALESCE(e.artist, '')) = ''
            AND r.status = 'approved' AND r.payment_status = 'Paid'
            AND r.payment_date BETWEEN $2 AND $3
            AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
            AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
            AND TRIM(COALESCE(e.payee, '')) <> ''
          GROUP BY 1 ORDER BY 3 DESC LIMIT 40`,
        [req.labelId, from, to]
      );
      candidates = rows
        .filter((r) => !rules.vendors.has(llNorm(r.payee)))
        .map((r) => ({ payee: r.payee, count: r.n, usd: round2(r.usd) }));
    } catch { /* advisory only */ }
    res.json({ success: true, data: { rules: rules.rows, candidates } });
  } catch (e) { console.error('label-level-rules error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.post('/label-level-rules', async (req, res) => {
  try {
    const scope = LL_SCOPES.includes(req.body.scope) ? req.body.scope : null;
    if (!scope) return res.status(400).json({ success: false, error: 'scope must be vendor or category' });
    const keys = (Array.isArray(req.body.rule_keys) ? req.body.rule_keys : [req.body.rule_key])
      .map((k) => String(k || '').trim()).filter(Boolean);
    if (!keys.length) return res.status(400).json({ success: false, error: 'rule_key required' });
    if (keys.length > 200) return res.status(400).json({ success: false, error: 'Too many rules at once (max 200)' });
    let added = 0;
    for (const k of keys) {
      const r = await pool.query(
        `INSERT INTO label_level_spend_rules (label_id, scope, rule_key, reason, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (label_id, scope, LOWER(TRIM(rule_key))) DO NOTHING RETURNING id`,
        [req.labelId, scope, k, req.body.reason || null, req.user.name]
      );
      if (r.rows.length) added += 1;
    }
    await logActivity(req, 'Added label-level spend rule', `${scope}: ${keys.join(', ')}`);
    res.json({ success: true, data: { added, requested: keys.length } });
  } catch (e) { console.error('label-level-rule add error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

router.delete('/label-level-rules/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM label_level_spend_rules WHERE id = $1 AND label_id = $2 RETURNING scope, rule_key`,
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No such rule' });
    await logActivity(req, 'Removed label-level spend rule', `${rows[0].scope}: ${rows[0].rule_key}`);
    res.json({ success: true });
  } catch (e) { console.error('label-level-rule delete error:', e); res.status(500).json({ success: false, error: 'Failed' }); }
});

module.exports = router;
module.exports.buildPnl = buildPnl; // reused by Artist Campaigns (the Settled layer)

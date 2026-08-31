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
async function buildPnl(labelId, from, to, artist) {
  const months = monthsBetween(from, to);
  const wanted = new Set(months);
  const [{ sectionFor, contraOf }, dismissed, overrides] = await Promise.all([
    reportSections(labelId), dismissedSets(labelId), monthOverrides(labelId),
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
      const key = artistBucketKey(r.artist);
      const entry = noteSpelling(byArtist, key, r.artist);
      entry.total += usd;
      entry.by_category[cat] = (entry.by_category[cat] || 0) + usd;
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
    by_artist: { rows: artistRows, total: round2(byArtistRawTotal), ties_to_pnl: tiesToPnl },
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

module.exports = router;
module.exports.buildPnl = buildPnl; // reused by Artist Campaigns later

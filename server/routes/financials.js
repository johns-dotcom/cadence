const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant, requireApprover } = require('../middleware/tenant');
const { logActivity } = require('../middleware/activityLogger');
const { toUSD } = require('../lib/fx');
// Locked-rate-honoring conversion for EXPENSE rows: the fx_rate_to_usd
// stamped at pay time always wins; live/historical rates are the fallback.
// Income rows have no locked rate — plain toUSD by date stays correct there.
const { rowUsd } = require('../lib/usd');
const eUsd = (r, date) => rowUsd({ amount: r.amount, currency: r.currency, fx_rate_to_usd: r.fx_rate_to_usd, payment_date: date });
const { statementMonthFor, statementStampFor } = require('../lib/statementMonth');
const { artistBucketKey, artistKeyOf } = require('../lib/artistKey');
const { bankEvidenceCols, loadAccounts } = require('../lib/bankEvidence');
const {
  recoupBaseSql, recoupReviewedSql, recoupStateOf, recoupCounted,
  isProvableUnclaimed, bestSpelling, normalizePriority,
} = require('../lib/recoupments');
const {
  computeExec, computeMonth, rowsForBucket, execWorkbook, fetchSlices,
  normFilters, isKnownBucket, isDay, todayStr, monthsBetween,
} = require('../lib/financeExec');
const { excludeBankRows } = require('../lib/ledgerSource');
const { loadRecoupmentClassRules, notClassRuledSql, SCOPES } = require('../lib/recoupClass');
const { loadArtistProposals, loadLedgerTwins, attachRecoupContext } = require('../lib/recoupContext');
const { rowUsdOf, sumUsd, groupDoubleClaims, partialFamilies, groupNoDocument } = require('../lib/recoupAudit');

const router = express.Router();
// Financials are privileged — approvers and up. Every query is label-scoped.
router.use(authMiddleware, withTenant, requireApprover);

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// The shared page scratchpads ride the notes table under sentinel artist keys,
// so they need no table of their own. One per surface: the Recoupments index
// and the Planning page (batch context — what this upload covers, what is
// waiting on an invoice, what the next person should know).
const INDEX_NOTE_KEY = '__recoupments_index__';
const PLANNING_NOTE_KEY = '__recoupments_planning__';
const NOTE_SENTINELS = new Set([INDEX_NOTE_KEY, PLANNING_NOTE_KEY]);
// A sentinel is passed through verbatim; anything else is a real artist name
// and normalizes to the app-wide key.
const noteKeyFor = (raw) => (NOTE_SENTINELS.has(String(raw || '')) ? String(raw) : artistKeyOf(raw));

// Money decisions on this page belong in the finance audit trail, not only in
// the general activity feed. Best-effort — an audit write must never fail the
// action it is describing.
const bkAudit = (req, action, expenseId, subject, field, oldValue, newValue, detail) =>
  pool.query(
    `INSERT INTO bk_audit_log (label_id, expense_id, action, detail, actor, field, old_value, new_value, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
    [req.labelId, expenseId, action, `${subject} — ${detail}`, req.user.name, field, oldValue, newValue]
  ).catch(() => {});

// Resolve the requested window: explicit from/to wins, else the legacy period
// keyword (month|quarter|year|all), else all time.
function resolveRange(q) {
  const today = todayStr();
  let from = isDay(q.from) ? q.from : null;
  const to = isDay(q.to) ? q.to : today;
  if (!from) {
    const y = today.slice(0, 4);
    const m = Number(today.slice(5, 7));
    switch (q.period) {
      case 'month': from = `${today.slice(0, 8)}01`; break;
      case 'quarter': from = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`; break;
      case 'year': from = `${y}-01-01`; break;
      default: from = '1900-01-01';
    }
  }
  return { from, to };
}

// GET /api/financials/summary?from&to (or legacy ?period=) — P&L overview.
// Every figure carries the PAID / UNPAID split: this is a commitment view
// (unpaid approved invoices count), and the page must be able to say so with
// numbers, not just prose. Split slices are summed once via the family-root
// join in fetchSlices — a parent_id IS NULL filter drops children's money.
router.get('/summary', async (req, res) => {
  try {
    const { from, to } = resolveRange(req.query);
    const [slices, incRows] = await Promise.all([
      fetchSlices(req.labelId, normFilters(req.query), from),
      pool.query(
        `SELECT COALESCE(source,'Other') AS source, amount, currency, income_date AS fx_date
         FROM artist_income WHERE label_id = $1 AND income_date BETWEEN $2 AND $3`,
        [req.labelId, from, to]
      ),
    ]);

    const byCat = new Map();
    let paid = 0, unpaid = 0;
    const unpaidRoots = new Set();
    for (const s of slices) {
      if (s.cd < from || s.cd > to) continue; // commitment-dated range scope
      const cat = String(s.category || '').trim() || 'Uncategorized';
      if (!byCat.has(cat)) byCat.set(cat, { category: cat, total: 0, paid: 0, unpaid: 0 });
      const c = byCat.get(cat);
      c.total += s.usd;
      if (s.paid) { c.paid += s.usd; paid += s.usd; }
      else { c.unpaid += s.usd; unpaid += s.usd; unpaidRoots.add(s.root_id); }
    }
    const bySource = {}; let income = 0;
    for (const r of incRows.rows) {
      const usd = await toUSD(r.amount, r.currency, r.fx_date);
      bySource[r.source] = (bySource[r.source] || 0) + usd;
      income += usd;
    }

    res.json({
      success: true,
      data: {
        currency: 'USD',
        from, to,
        income: round2(income),
        expenses: round2(paid + unpaid),
        expenses_paid: round2(paid),
        expenses_unpaid: round2(unpaid),
        unpaid_count: unpaidRoots.size,
        net: round2(income - paid - unpaid),
        expenseByCategory: Array.from(byCat.values())
          .map((c) => ({ category: c.category, total: round2(c.total), paid: round2(c.paid), unpaid: round2(c.unpaid) }))
          .sort((a, b) => b.total - a.total),
        incomeBySource: Object.entries(bySource)
          .map(([source, total]) => ({ source, total: round2(total) }))
          .sort((a, b) => b.total - a.total),
      },
    });
  } catch (error) {
    console.error('Financials summary error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/analytics?from&to — monthly trend (paid/unpaid split),
// top vendors, per-artist P&L. Defaults to the trailing 12 months.
//
// Per-artist grouping is by artistBucketKey — NOT an exact-name join onto the
// roster. The old inner-map silently vanished every dollar whose artist
// string didn't exactly match a roster name (whitespace, casing beyond
// lower(), non-roster artists, 'Unassigned'); now every dollar lands in some
// row, including an Unassigned bucket and an "Other artists" rollup, so the
// column ties to total expenses.
router.get('/analytics', async (req, res) => {
  try {
    const today = todayStr();
    const to = isDay(req.query.to) ? req.query.to : today;
    const defFrom = `${monthsBetween(`${to.slice(0, 4) - 1}-${to.slice(5, 7)}-01`, to).slice(-12)[0]}-01`;
    const from = isDay(req.query.from) ? req.query.from : defFrom;
    const months = monthsBetween(from, to);
    const fromDay = `${months[0]}-01`;

    const [artists, slices, inc] = await Promise.all([
      pool.query('SELECT id, name FROM artists WHERE label_id = $1', [req.labelId]),
      fetchSlices(req.labelId, normFilters(req.query), fromDay),
      pool.query(
        `SELECT artist_id, amount, currency, to_char(income_date, 'YYYY-MM-DD') AS d FROM artist_income
          WHERE label_id = $1 AND income_date BETWEEN $2 AND $3`,
        [req.labelId, fromDay, to]
      ),
    ]);

    const series = Object.fromEntries(months.map(m => [m, { month: m, income: 0, expenses: 0, expenses_paid: 0, expenses_unpaid: 0 }]));
    const vendor = new Map();
    const spendByKey = new Map(); // artistBucketKey -> { label, spend, paid, unpaid }
    for (const s of slices) {
      if (s.cd < fromDay || s.cd > to) continue;
      const mk = s.cd.slice(0, 7);
      if (series[mk]) {
        series[mk].expenses += s.usd;
        if (s.paid) series[mk].expenses_paid += s.usd; else series[mk].expenses_unpaid += s.usd;
      }
      const payee = String(s.payee || '').trim();
      if (payee) {
        if (!vendor.has(payee)) vendor.set(payee, { vendor: payee, total: 0, paid: 0, unpaid: 0 });
        const v = vendor.get(payee);
        v.total += s.usd; if (s.paid) v.paid += s.usd; else v.unpaid += s.usd;
      }
      const key = artistBucketKey(s.artist);
      if (!spendByKey.has(key)) spendByKey.set(key, { label: key ? String(s.artist).trim() : 'Unassigned', spend: 0, paid: 0, unpaid: 0 });
      const a = spendByKey.get(key);
      a.spend += s.usd; if (s.paid) a.paid += s.usd; else a.unpaid += s.usd;
    }

    // Roster lookup by bucket key so roster spelling + profile links win.
    const rosterByKey = new Map();
    for (const a of artists.rows) {
      const k = artistBucketKey(a.name);
      if (k && !rosterByKey.has(k)) rosterByKey.set(k, a);
    }
    const incByKey = new Map(); // bucket key ('' = unattributed) -> usd
    const rosterById = new Map(artists.rows.map(a => [a.id, a]));
    for (const r of inc.rows) {
      const usd = await toUSD(r.amount, r.currency, r.d);
      const mk = String(r.d).slice(0, 7);
      if (series[mk]) series[mk].income += usd;
      const key = r.artist_id && rosterById.has(r.artist_id) ? artistBucketKey(rosterById.get(r.artist_id).name) : '';
      incByKey.set(key, (incByKey.get(key) || 0) + usd);
    }

    const monthlySeries = months.map(m => ({
      month: m,
      income: round2(series[m].income),
      expenses: round2(series[m].expenses),
      expenses_paid: round2(series[m].expenses_paid),
      expenses_unpaid: round2(series[m].expenses_unpaid),
      net: round2(series[m].income - series[m].expenses),
    }));
    const topVendors = Array.from(vendor.values())
      .map(v => ({ vendor: v.vendor, total: round2(v.total), paid: round2(v.paid), unpaid: round2(v.unpaid) }))
      .sort((a, b) => b.total - a.total).slice(0, 10);

    const allKeys = new Set([...spendByKey.keys(), ...incByKey.keys()]);
    const rows = Array.from(allKeys).map((key) => {
      const roster = rosterByKey.get(key);
      const sp = spendByKey.get(key) || { label: 'Unassigned', spend: 0, paid: 0, unpaid: 0 };
      const income = incByKey.get(key) || 0;
      return {
        artist_id: roster ? roster.id : null,
        name: roster ? roster.name : (key ? sp.label : 'Unassigned'),
        spend: round2(sp.spend), spend_paid: round2(sp.paid), spend_unpaid: round2(sp.unpaid),
        income: round2(income), net: round2(income - sp.spend),
      };
    }).filter(a => a.spend !== 0 || a.income !== 0).sort((a, b) => b.spend - a.spend);
    // Cap the table but never drop money — the tail rolls into one row.
    const CAP = 30;
    const byArtist = rows.slice(0, CAP);
    if (rows.length > CAP) {
      const rest = rows.slice(CAP);
      byArtist.push(rest.reduce((acc, r) => ({
        artist_id: null, name: `Other artists (${rest.length})`,
        spend: round2(acc.spend + r.spend), spend_paid: round2(acc.spend_paid + r.spend_paid),
        spend_unpaid: round2(acc.spend_unpaid + r.spend_unpaid),
        income: round2(acc.income + r.income), net: round2(acc.net + r.net),
      }), { spend: 0, spend_paid: 0, spend_unpaid: 0, income: 0, net: 0 }));
    }

    const cur = monthlySeries[monthlySeries.length - 1] || { income: 0, expenses: 0, net: 0 };
    const prev = monthlySeries[monthlySeries.length - 2] || { income: 0, expenses: 0, net: 0 };
    res.json({ success: true, data: { from: fromDay, to, monthlySeries, topVendors, byArtist, deltas: { income: round2(cur.income - prev.income), expenses: round2(cur.expenses - prev.expenses), net: round2(cur.net - prev.net) } } });
  } catch (error) {
    console.error('Financials analytics error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Executive dashboard (ported from boom /financials/exec) ────────────────

// GET /api/financials/exec?from&to&artist&category&rep — KPIs (day-matched
// comparisons), weekly cash-out/open-billing/intake, aging + upcoming due,
// 30/60/90 cash forecast, monthly intake cohorts, breakdowns, rep leaderboard,
// category trend. One slice scan; see lib/financeExec.js.
router.get('/exec', async (req, res) => {
  try {
    const data = await computeExec(req.labelId, { from: req.query.from, to: req.query.to, filters: req.query });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Financials exec error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/exec/rows?bucket= — the invoice slices behind one card.
// Buckets: this_week/last_week/mtd/last_mtd/ytd/last_ytd/unpaid, aging_*,
// upcoming_*, month_YYYY-MM. Totals tie to the cards by construction (same
// slice pull + same window predicates).
router.get('/exec/rows', async (req, res) => {
  try {
    const bucket = String(req.query.bucket || '');
    if (!isKnownBucket(bucket)) return res.status(400).json({ success: false, error: 'Unknown bucket' });
    const data = await rowsForBucket(req.labelId, bucket, { filters: req.query });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Financials exec rows error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/month/:month — one month at a glance (YYYY-MM).
// Same intake-cohort anchor as the monthly rollup rows this page is opened
// from, so the page total ties to the number that was clicked. Accepts the
// page's artist/category/rep scope so a filtered rollup drills to a filtered
// month.
router.get('/month/:month', async (req, res) => {
  try {
    const data = await computeMonth(req.labelId, String(req.params.month || ''), { filters: req.query });
    res.json({ success: true, data });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ success: false, error: error.message });
    console.error('Financials month error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/filter-options — distinct artist/category/rep values
// from live approved rows, for the cross-page scope dropdowns.
router.get('/filter-options', async (req, res) => {
  try {
    const base = `FROM expenses WHERE label_id = $1 AND status = 'approved'
      AND (deleted IS NULL OR deleted = FALSE) AND (voided IS NULL OR voided = FALSE)`;
    const [a, c, r] = await Promise.all([
      pool.query(`SELECT DISTINCT TRIM(artist) AS v ${base} AND artist IS NOT NULL AND TRIM(artist) <> '' ORDER BY 1`, [req.labelId]),
      pool.query(`SELECT DISTINCT TRIM(category) AS v ${base} AND category IS NOT NULL AND TRIM(category) <> '' ORDER BY 1`, [req.labelId]),
      pool.query(`SELECT DISTINCT TRIM(rep) AS v ${base} AND rep IS NOT NULL AND TRIM(rep) <> '' ORDER BY 1`, [req.labelId]),
    ]);
    res.json({ success: true, data: { artists: a.rows.map(x => x.v), categories: c.rows.map(x => x.v), reps: r.rows.map(x => x.v) } });
  } catch (error) {
    console.error('Financials filter-options error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/export?from&to&artist&category&rep — multi-sheet .xlsx
// built from the SAME exec payload the page renders (never re-derived).
router.get('/export', async (req, res) => {
  try {
    const data = await computeExec(req.labelId, { from: req.query.from, to: req.query.to, filters: req.query });
    const wb = await execWorkbook(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cadence-financials-${data.range.from}_${data.range.to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Financials export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Recoupments ─────────────────────────────────────────────────────────────
//
// Every surface below reads its row set through `recoupBaseSql` + the bank
// evidence columns, so "recoupable spend" means the same thing on the index,
// the artist page, Planning and the statement tabs. See lib/recoupments.js for
// why the bank-review gate is part of the base predicate rather than a filter.

// One SELECT list for every recoupment feed. `bankEvidenceCols` is appended per
// call because it needs the label's account list.
const RECOUP_COLS = `e.id, e.invoice_date, e.payment_date, e.payee, e.description, e.category,
  e.artist, e.song, e.amount, e.currency, e.fx_rate_to_usd, e.payment_status, e.payment_method,
  e.invoice_number, e.ufr, e.ufr_marked_at, e.recoupment_label, e.cobrand, e.social_handles, e.notes,
  e.entry_source, e.prior_year_tag, e.flagged, e.flag_reason, e.recoupable,
  e.invoice_filename, e.receipt_filename, e.created_at,
  COALESCE(e.payment_date, e.invoice_date, e.created_at::date) AS fx_date`;

// Fetch + USD-convert one recoupment row set. `extra` is appended to the WHERE
// (already-parameterized fragments only — never user text).
async function recoupRows(labelId, extra = '', params = []) {
  const accounts = await loadAccounts(pool, labelId);
  const { rows } = await pool.query(
    `SELECT ${RECOUP_COLS}, ${bankEvidenceCols('e', accounts)}
       FROM expenses e
      WHERE e.label_id = $1 AND ${recoupBaseSql('e')} ${extra}
      ORDER BY COALESCE(e.payment_date, e.invoice_date, e.created_at::date) DESC, e.id DESC`,
    [labelId, ...params]
  );
  const out = [];
  for (const r of rows) {
    out.push({
      ...r,
      amount: Number(r.amount),
      amount_usd: round2(await eUsd(r, r.fx_date)),
      state: recoupStateOf(r),
      statement_month: r.ufr ? statementMonthFor(r.ufr_marked_at) : null,
    });
  }
  return out;
}

// Add a row's native amount into a { CUR: total } map. Currencies are never
// netted into one another — only the USD column is comparable.
const addCur = (map, r) => { const c = (r.currency || 'USD').toUpperCase(); map[c] = round2((map[c] || 0) + Number(r.amount || 0)); };

// The per-bucket telemetry every card, tile and section header reads. One
// function so the index card, the claim band and the stat tiles cannot
// disagree about what "pending" or "unverified" means.
function rollup(rows) {
  const t = {
    items: rows.length, usd: 0, by_currency: {},
    counted_usd: 0, counted_items: 0,
    ufr_usd: 0, ufr_items: 0, pending_usd: 0, pending_items: 0,
    unverified_usd: 0, unverified_items: 0,
    ufr_unverified_usd: 0, ufr_unverified_items: 0,
    provable_usd: 0, provable_items: 0,
    paid_usd: 0, paid_items: 0, unpaid_usd: 0, unpaid_items: 0,
    cobrand_usd: 0,
    states: { verified: 0, awaiting_statement: 0, unverified: 0, unpaid: 0 },
  };
  for (const r of rows) {
    const u = Number(r.amount_usd) || 0;
    t.usd += u; addCur(t.by_currency, r);
    t.states[r.state] = (t.states[r.state] || 0) + 1;
    if (recoupCounted(r)) { t.counted_usd += u; t.counted_items += 1; }
    if (r.ufr) { t.ufr_usd += u; t.ufr_items += 1; } else { t.pending_usd += u; t.pending_items += 1; }
    if (r.state === 'unverified') {
      t.unverified_usd += u; t.unverified_items += 1;
      if (r.ufr) { t.ufr_unverified_usd += u; t.ufr_unverified_items += 1; }
    }
    if (isProvableUnclaimed(r)) { t.provable_usd += u; t.provable_items += 1; }
    if (r.payment_status === 'Paid') { t.paid_usd += u; t.paid_items += 1; } else { t.unpaid_usd += u; t.unpaid_items += 1; }
    if (r.cobrand) t.cobrand_usd += u;
  }
  for (const k of ['usd', 'counted_usd', 'ufr_usd', 'pending_usd', 'unverified_usd', 'ufr_unverified_usd', 'provable_usd', 'paid_usd', 'unpaid_usd', 'cobrand_usd']) t[k] = round2(t[k]);
  return t;
}

// GET /api/financials/recoupments — the index: one bucket per artist the money
// names, plus page-level tiles and the provable-and-unclaimed band.
//
// Built from the EXPENSES, not from the artists table. A roster-driven index
// silently hides every cost whose artist string is a misspelling, a punctuation
// variant, or blank — which is where unattributed recoupable money accumulates.
// Buckets key on `artistBucketKey` (the app-wide normalized key), so
// "LIFE/LINE" and "LIFELINE" are one card and the roster row joins on the same
// key rather than on exact-name equality.
router.get('/recoupments', async (req, res) => {
  try {
    const [rows, artists, incRows, metaRows] = await Promise.all([
      recoupRows(req.labelId, 'AND e.prior_year_tag IS NULL'),
      pool.query('SELECT id, name FROM artists WHERE label_id = $1 ORDER BY name', [req.labelId]),
      pool.query('SELECT artist_id, amount, currency, income_date AS fx_date FROM artist_income WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT artist_key, priority, ready_for_planning, flagged, flag_reason, notes, dismissed FROM artist_meta WHERE label_id = $1', [req.labelId]),
    ]);
    const metaByKey = Object.fromEntries(metaRows.rows.map(m => [m.artist_key, m]));

    // Roster first, so an artist with income but no spend still gets a card.
    const buckets = new Map();
    const bucket = (key) => {
      if (!buckets.has(key)) buckets.set(key, { key, names: [], rows: [], artist_id: null, income: 0 });
      return buckets.get(key);
    };
    for (const a of artists.rows) {
      const k = artistBucketKey(a.name);
      const b = bucket(k);
      b.names.push(a.name);
      if (b.artist_id == null) b.artist_id = a.id;
    }
    for (const r of rows) {
      const b = bucket(artistBucketKey(r.artist));
      b.rows.push(r);
      b.names.push(r.artist);
    }

    // Income is recorded against a roster id; fold it into that artist's bucket.
    const idToKey = new Map(artists.rows.map(a => [a.id, artistBucketKey(a.name)]));
    for (const r of incRows.rows) {
      if (!r.artist_id) continue;
      const k = idToKey.get(r.artist_id);
      if (k === undefined) continue;
      bucket(k).income += await toUSD(r.amount, r.currency, r.fx_date);
    }

    const data = [];
    for (const b of buckets.values()) {
      const t = rollup(b.rows);
      // The unattributed bucket is always "Unassigned" — a placeholder spelling
      // ("TBD", "N/A") is what a row said, not an artist, and showing it as a
      // card title reads like a roster entry.
      const name = b.key === '' ? 'Unassigned' : (bestSpelling(b.names) || b.key);
      const meta = metaByKey[b.key] || {};
      const income = round2(b.income);
      data.push({
        artist_key: b.key, name, artist_id: b.artist_id, unassigned: b.key === '',
        currency: 'USD',
        recoupable_spend: t.usd, income, balance: round2(income - t.usd),
        recouped: income >= t.usd && t.usd > 0,
        priority: meta.priority || null, ready_for_planning: !!meta.ready_for_planning,
        flagged: !!meta.flagged, flag_reason: meta.flag_reason || null,
        notes: meta.notes || null, dismissed: !!meta.dismissed,
        ...t,
      });
    }
    // Cards with neither money nor income are noise on this page.
    const cards = data.filter(a => a.items > 0 || a.income > 0);

    // Provable and unclaimed, biggest artist first — a whole artist is usually
    // one decision. ids ride along so the band's button is one request.
    const provable = rows.filter(isProvableUnclaimed);
    const provByArtist = new Map();
    for (const r of provable) {
      const k = artistBucketKey(r.artist);
      if (!provByArtist.has(k)) provByArtist.set(k, { artist_key: k, name: null, names: [], ids: [], usd: 0 });
      const p = provByArtist.get(k);
      p.names.push(r.artist); p.ids.push(r.id); p.usd += Number(r.amount_usd) || 0;
    }
    const provable_by_artist = [...provByArtist.values()]
      .map(p => ({ artist_key: p.artist_key, name: p.artist_key === '' ? 'Unassigned' : (bestSpelling(p.names) || p.artist_key), ids: p.ids, count: p.ids.length, usd: round2(p.usd) }))
      .sort((a, b) => b.usd - a.usd);

    // How much statement-born spend is still waiting on a yes/no.
    // Class-ruled rows are excluded here too: the tile counts what the queue
    // will actually offer, or the two disagree by exactly the rules.
    const review = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd ELSE e.amount END), 0) AS usd
         FROM expenses e
        WHERE e.label_id = $1 AND e.entry_source = 'bank_statement'
          AND COALESCE(e.recoup_reviewed, FALSE) = FALSE
          AND COALESCE(e.status, 'approved') = 'approved'
          AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
          AND ${notClassRuledSql('e', '$1')}`,
      [req.labelId]
    );

    res.json({ success: true, data: cards, meta: {
      totals: rollup(rows),
      provable_by_artist,
      statement_months: [...new Set(rows.filter(r => r.statement_month).map(r => r.statement_month))].sort().reverse(),
      review_pending: { count: review.rows[0].n, usd: round2(Number(review.rows[0].usd)) },
    } });
  } catch (error) {
    console.error('Recoupments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments/labels — the recoupment-label vocabulary in
// use, for the datalist behind every label editor. Free text with a memory
// beats a fixed enum: labels are upload batches, invented as needed.
router.get('/recoupments/labels', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT recoupment_label AS label, COUNT(*)::int AS n
         FROM expenses
        WHERE label_id = $1 AND recoupment_label IS NOT NULL AND TRIM(recoupment_label) <> ''
        GROUP BY recoupment_label ORDER BY n DESC, label ASC LIMIT 200`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Recoupment labels error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── The bank-review gate ────────────────────────────────────────────────────
// GET /api/financials/recoupments/review — statement-born rows nobody has
// answered. They are OFF the recoupment surfaces until they are answered, so
// this queue is the only place their money is visible.
router.get('/recoupments/review', async (req, res) => {
  try {
    const accounts = await loadAccounts(pool, req.labelId);
    const { rows } = await pool.query(
      `SELECT ${RECOUP_COLS}, ${bankEvidenceCols('e', accounts)}
         FROM expenses e
        WHERE e.label_id = $1 AND e.entry_source = 'bank_statement'
          AND COALESCE(e.recoup_reviewed, FALSE) = FALSE
          AND COALESCE(e.status, 'approved') = 'approved'
          AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
          AND ${notClassRuledSql('e', '$1')}
        ORDER BY (CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd ELSE e.amount END) DESC NULLS LAST, e.id DESC
        LIMIT 500`,
      [req.labelId]
    );
    const out = [];
    for (const r of rows) out.push({ ...r, amount: Number(r.amount), amount_usd: round2(await eUsd(r, r.fx_date)) });
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Recoup review error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/review { ids, recoupable, artist? }
// BOTH answers are decisions and both are recorded — a row leaves the queue
// either way. "No" also clears `recoupable`, so the row stops claiming to be
// recoupable everywhere else. An artist may only ride along with a "yes":
// recoupable means recoupable AGAINST somebody.
router.post('/recoupments/review', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : [req.body.id])
      .map(Number).filter(Number.isFinite).slice(0, 1000);
    if (!ids.length) return res.status(400).json({ success: false, error: 'ids required' });
    if (typeof req.body.recoupable !== 'boolean') return res.status(400).json({ success: false, error: 'recoupable must be true or false' });
    const keep = req.body.recoupable;
    const artist = typeof req.body.artist === 'string' ? req.body.artist.trim().slice(0, 255) : null;
    if (artist && !keep) {
      return res.status(400).json({ success: false, error: 'An artist only means something on a recoupable cost — answer recoupable, or leave the artist off' });
    }
    // Re-read server-side: the caller's list can be stale, and this writes to
    // the ledger. Scoped to bank-born rows so it is never a back door for
    // retyped invoices.
    const { rows: targets } = await pool.query(
      `SELECT id, payee, artist FROM expenses
        WHERE label_id = $1 AND id = ANY($2::int[]) AND entry_source = 'bank_statement'
          AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)`,
      [req.labelId, ids]
    );
    if (!targets.length) return res.status(404).json({ success: false, error: 'No matching bank-born entries' });
    // COALESCE on the artist: bulk-answering must not overwrite the one row
    // somebody already attributed by hand.
    await pool.query(
      `UPDATE expenses
          SET recoup_reviewed = TRUE, recoup_reviewed_at = NOW(), recoup_reviewed_by = $4,
              recoupable = $3,
              artist = CASE WHEN $5::text IS NULL THEN artist
                            ELSE COALESCE(NULLIF(TRIM(artist), ''), $5::text) END
        WHERE label_id = $1 AND id = ANY($2::int[])`,
      [req.labelId, targets.map(t => t.id), keep, req.user.name, artist]
    );
    await bkAudit(req, 'recoup_reviewed', targets.length === 1 ? targets[0].id : null,
      targets.length === 1 ? targets[0].payee : `${targets.length} bank rows`, 'recoupable', null, String(keep),
      `Answered "is this recoupable?" for ${targets.length} statement-born row${targets.length === 1 ? '' : 's'} — ${keep ? 'recoupable' : 'NOT recoupable, cleared'}${artist ? `, artist set to ${artist} where the row had none` : ''}`);
    await logActivity(req, 'Reviewed bank-born recoupment rows', `${targets.length} — ${keep ? 'recoupable' : 'not recoupable'}`);
    res.json({ success: true, data: { reviewed: targets.length, recoupable: keep, artist: artist || null, requested: ids.length, skipped: Math.max(0, ids.length - targets.length) } });
  } catch (error) {
    console.error('Recoup review write error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Notes: artist-level, song-level, and the shared index scratchpad ─────────
// GET /api/financials/recoupments/notes?artist=<name>
// Artist-level notes live on artist_meta (already surfaced on the cards); song
// notes and the index scratchpad live in recoupment_notes. The scratchpad is
// the sentinel artist key '__recoupments_index__' with an empty song key.
router.get('/recoupments/notes', async (req, res) => {
  try {
    const key = noteKeyFor(req.query.artist);
    const { rows } = await pool.query(
      'SELECT song_key, note FROM recoupment_notes WHERE label_id = $1 AND artist_key = $2',
      [req.labelId, key]
    );
    const songs = {};
    let artistNote = '';
    for (const r of rows) { if (r.song_key === '') artistNote = r.note || ''; else songs[r.song_key] = r.note || ''; }
    res.json({ success: true, data: { artistNote, songs } });
  } catch (error) {
    console.error('Recoupment notes error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/notes { artist, song?, note } — upsert; an
// empty note DELETES the row rather than storing whitespace.
router.post('/recoupments/notes', async (req, res) => {
  try {
    const key = noteKeyFor(req.body.artist);
    if (!key) return res.status(400).json({ success: false, error: 'Artist required' });
    const songKey = String(req.body.song || '').trim().toLowerCase();
    const note = String(req.body.note || '').slice(0, 4000).trim();
    if (!note) {
      await pool.query('DELETE FROM recoupment_notes WHERE label_id = $1 AND artist_key = $2 AND song_key = $3', [req.labelId, key, songKey]);
    } else {
      await pool.query(
        `INSERT INTO recoupment_notes (label_id, artist_key, song_key, note, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (label_id, artist_key, song_key) DO UPDATE SET note = $4, updated_by = $5, updated_at = NOW()`,
        [req.labelId, key, songKey, note, req.user.name]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Recoupment notes write error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/song-status { artist, song, finished?,
// ready_for_planning?, flagged?, flag_reason? } — the SAME song_campaign_status
// rows Artist Campaigns writes, keyed the same way, so a song marked finished
// on one page reads finished on the other.
router.post('/recoupments/song-status', async (req, res) => {
  try {
    const key = artistKeyOf(req.body.artist);
    const songKey = String(req.body.song || '').trim().toLowerCase();
    if (!key || !songKey) return res.status(400).json({ success: false, error: 'Artist and song required' });
    const who = req.user.name;
    await pool.query('INSERT INTO song_campaign_status (label_id, artist_key, song_key) VALUES ($1,$2,$3) ON CONFLICT (label_id, artist_key, song_key) DO NOTHING', [req.labelId, key, songKey]);
    const b = req.body;
    if (b.finished !== undefined) await pool.query('UPDATE song_campaign_status SET finished=$1, finished_at=NOW(), finished_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [!!b.finished, who, req.labelId, key, songKey]);
    if (b.ready_for_planning !== undefined) await pool.query('UPDATE song_campaign_status SET ready_for_planning=$1, ready_at=NOW(), ready_by=$2 WHERE label_id=$3 AND artist_key=$4 AND song_key=$5', [!!b.ready_for_planning, who, req.labelId, key, songKey]);
    if (b.flagged !== undefined) await pool.query('UPDATE song_campaign_status SET flagged=$1, flag_reason=$2, flagged_at=NOW(), flagged_by=$3 WHERE label_id=$4 AND artist_key=$5 AND song_key=$6', [!!b.flagged, b.flag_reason || null, who, req.labelId, key, songKey]);
    res.json({ success: true });
  } catch (error) {
    console.error('Recoupment song-status error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments/artist/:key — one artist's page.
//
// `:key` is the normalized artist key from the index (or a raw name — it is
// normalized here either way), NOT a roster id: the surface has to be able to
// open a bucket that has no roster row at all, including the Unassigned one
// (key '-').
router.get('/recoupments/artist/:key', async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.key || '');
    const key = raw === '-' ? '' : artistBucketKey(raw);
    const [all, artists, songStatus, notes] = await Promise.all([
      recoupRows(req.labelId, ''),
      pool.query('SELECT id, name FROM artists WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT song_key, finished, ready_for_planning, flagged, flag_reason, notes FROM song_campaign_status WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKeyOf(raw)]),
      pool.query('SELECT song_key, note FROM recoupment_notes WHERE label_id = $1 AND artist_key = $2', [req.labelId, artistKeyOf(raw)]),
    ]);
    const mine = all.filter(r => artistBucketKey(r.artist) === key);
    const live = mine.filter(r => !r.prior_year_tag);
    const rosterMatch = artists.rows.find(a => artistBucketKey(a.name) === key) || null;
    const name = key === '' ? 'Unassigned'
      : (bestSpelling([...(rosterMatch ? [rosterMatch.name] : []), ...mine.map(r => r.artist)]) || key);

    // Non-recoupable spend for the same artist — the promote-back worklist. It
    // is deliberately a SEPARATE query: `recoupable = FALSE` is outside the
    // shared base predicate, and folding it in would let it leak into totals.
    const accounts = await loadAccounts(pool, req.labelId);
    const nonRecoup = await pool.query(
      `SELECT ${RECOUP_COLS}, ${bankEvidenceCols('e', accounts)}
         FROM expenses e
        WHERE e.label_id = $1 AND COALESCE(e.recoupable, FALSE) = FALSE
          AND COALESCE(e.status, 'approved') = 'approved'
          AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
          AND e.parent_id IS NULL AND ${recoupReviewedSql('e')}
        ORDER BY COALESCE(e.payment_date, e.invoice_date, e.created_at::date) DESC LIMIT 400`,
      [req.labelId]
    );
    const nonRecoupable = [];
    for (const r of nonRecoup.rows) {
      if (artistBucketKey(r.artist) !== key) continue;
      nonRecoupable.push({ ...r, amount: Number(r.amount), amount_usd: round2(await eUsd(r, r.fx_date)), state: recoupStateOf(r) });
    }

    // Income + the deal it is measured against. `contracts.financial_terms` is
    // the per-line deal breakdown; only the recoupable lines are capacity.
    let incUsd = 0;
    let incomeRows = [];
    let deal = null;
    if (rosterMatch) {
      const [inc, contracts] = await Promise.all([
        pool.query('SELECT id, amount, currency, income_date, source FROM artist_income WHERE label_id = $1 AND artist_id = $2 ORDER BY income_date DESC', [req.labelId, rosterMatch.id]),
        pool.query(`SELECT id, type, status, date_signed, expiration_date, advance, financial_terms
                      FROM contracts WHERE label_id = $1 AND artist_id = $2 AND COALESCE(status,'Active') <> 'Expired'
                     ORDER BY date_signed DESC NULLS LAST`, [req.labelId, rosterMatch.id]),
      ]);
      incomeRows = inc.rows;
      for (const r of inc.rows) incUsd += await toUSD(r.amount, r.currency, r.income_date);
      const lines = [];
      let recoupableTotal = 0;
      let total = 0;
      for (const c of contracts.rows) {
        const terms = Array.isArray(c.financial_terms) ? c.financial_terms : [];
        for (const t of terms) {
          const amt = Number(t.amount) || 0;
          if (!amt) continue;
          lines.push({ contract_id: c.id, label: t.label || c.type, amount: amt, recoupable: t.recoupable !== false, note: t.note || null });
          total += amt;
          if (t.recoupable !== false) recoupableTotal += amt;
        }
      }
      if (lines.length || contracts.rows.some(c => c.advance)) {
        deal = { lines, total: round2(total), recoupable_total: round2(recoupableTotal), advance: contracts.rows.map(c => c.advance).find(Boolean) || null };
      }
    }

    const totals = rollup(live);
    res.json({ success: true, data: {
      artist: { key: key || '-', name, artist_id: rosterMatch ? rosterMatch.id : null, unassigned: key === '' },
      entries: live,
      prior_year: mine.filter(r => r.prior_year_tag),
      non_recoupable: nonRecoupable,
      income: incomeRows, deal,
      song_status: Object.fromEntries(songStatus.rows.map(s => [s.song_key, s])),
      song_notes: Object.fromEntries(notes.rows.filter(n => n.song_key !== '').map(n => [n.song_key, n.note])),
      statement_months: [...new Set(live.filter(r => r.statement_month).map(r => r.statement_month))].sort().reverse(),
      totals: { ...totals, recoupable_spend: totals.usd, income: round2(incUsd), balance: round2(incUsd - totals.usd), recouped: incUsd >= totals.usd && totals.usd > 0 },
    } });
  } catch (error) {
    console.error('Recoupment detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments/export?artist=<key> — Excel of one artist (or
// the whole page), grouped the way the screen groups it, with per-group
// subtotals and a grand total.
router.get('/recoupments/export', async (req, res) => {
  try {
    const wantKey = req.query.artist ? (req.query.artist === '-' ? '' : artistBucketKey(req.query.artist)) : null;
    const groupBy = req.query.group_by === 'category' ? 'category' : 'song';
    const rows = (await recoupRows(req.labelId, 'AND e.prior_year_tag IS NULL'))
      .filter(r => wantKey === null || artistBucketKey(r.artist) === wantKey);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Recoupments');
    ws.columns = [
      { header: 'Artist', width: 22 }, { header: groupBy === 'category' ? 'Category' : 'Song', width: 24 },
      { header: 'Date', width: 12 }, { header: 'Payee', width: 28 }, { header: 'Category', width: 20 },
      { header: 'Label', width: 16 }, { header: 'Amount', width: 14 }, { header: 'Cur', width: 7 },
      { header: 'USD', width: 14 }, { header: 'Paid', width: 9 }, { header: 'Bank', width: 20 },
      { header: 'UFR', width: 8 }, { header: 'Statement', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };

    const byArtist = new Map();
    for (const r of rows) {
      const k = artistBucketKey(r.artist);
      if (!byArtist.has(k)) byArtist.set(k, []);
      byArtist.get(k).push(r);
    }
    let grand = 0;
    const STATE_TEXT = { verified: 'On a statement', awaiting_statement: 'Statement not in yet', unverified: 'PAID — NO BANK LINE', unpaid: 'Unpaid' };
    for (const [k, list] of [...byArtist.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const aName = k === '' ? 'Unassigned' : (bestSpelling(list.map(r => r.artist)) || k);
      const head = ws.addRow([aName]);
      head.font = { bold: true, size: 12 };
      const groups = new Map();
      for (const r of list) {
        const g = (groupBy === 'category' ? r.category : r.song) || '—';
        if (!groups.has(g.toLowerCase())) groups.set(g.toLowerCase(), { name: g, items: [] });
        groups.get(g.toLowerCase()).items.push(r);
      }
      for (const g of groups.values()) {
        let sub = 0;
        for (const r of g.items) {
          sub += Number(r.amount_usd) || 0;
          ws.addRow([aName, g.name, String(r.payment_date || r.invoice_date || '').slice(0, 10), r.payee || '',
            r.category || '', r.recoupment_label || '', Number(r.amount) || 0, r.currency || 'USD',
            Number(r.amount_usd) || 0, r.payment_status === 'Paid' ? 'Yes' : 'No',
            STATE_TEXT[r.state] || '', r.ufr ? 'Yes' : 'No', r.statement_month || '']);
        }
        const sr = ws.addRow(['', `${g.name} subtotal`, '', '', '', '', '', '', round2(sub)]);
        sr.font = { bold: true };
        grand += sub;
      }
      ws.addRow([]);
    }
    const gr = ws.addRow(['', 'GRAND TOTAL (USD)', '', '', '', '', '', '', round2(grand)]);
    gr.font = { bold: true, size: 12 };

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="recoupments-${(req.query.artist || 'all')}.xlsx"`);
    res.end(Buffer.from(buf));
  } catch (error) {
    console.error('Recoupment export error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/statements — committed (UFR) recoupable entries grouped
// by statement month (client groups on statement_month). A UFR row with no
// stamp comes back with statement_month null and lands in the client's
// "Unstamped" bucket — it belongs to no statement and must not be filed into
// whichever month the page happens to be opened in.
router.get('/statements', async (req, res) => {
  try {
    const rows = await recoupRows(req.labelId, 'AND e.ufr = TRUE');
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Statements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── UFR: the claim, and the timestamp that decides which statement it lands on
//
// THE TIMESTAMP RULE, restated here because both writers below implement it and
// they must stay identical: stamp on the transition INTO claimed, clear on the
// transition out, and PRESERVE it when the row is already claimed. Re-stamping
// an already-claimed row silently MOVES it from the statement a partner already
// received onto the current one. Moving between statements is a separate,
// explicit action (POST /recoupments/move-month).

// POST /api/financials/recoupments/:id/ufr { ufr } — toggle one row's claim.
router.post('/recoupments/:id(\\d+)/ufr', async (req, res) => {
  try {
    const on = req.body.ufr !== false;
    const { rows } = await pool.query(
      `UPDATE expenses SET ufr = $1,
              ufr_marked_at = CASE WHEN $1 THEN COALESCE(ufr_marked_at, NOW()) ELSE NULL END
        WHERE id = $2 AND label_id = $3
          AND recoupable = TRUE
          AND COALESCE(status, 'approved') = 'approved'
          AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
        RETURNING id, payee, ufr, ufr_marked_at`,
      [on, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No matching recoupable entry' });
    await bkAudit(req, on ? 'ufr_marked' : 'ufr_cleared', rows[0].id, rows[0].payee, 'ufr', null, String(on),
      on ? `Uploaded for recoupment — statement ${statementMonthFor(rows[0].ufr_marked_at) || 'unstamped'}` : 'Removed from recoupment');
    res.json({ success: true, data: { ...rows[0], statement_month: rows[0].ufr ? statementMonthFor(rows[0].ufr_marked_at) : null } });
  } catch (error) {
    console.error('UFR toggle error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/planning — the pool a plan is staged FROM: recoupable
// entries not yet marked UFR, across every artist. Curation itself is the
// client's working set (client/src/lib/recoupmentPlan.js); this endpoint only
// says what is eligible.
//
// No `artist <> ''` filter. Rows with no artist are exactly the ones that go
// missing, and the page plans them under an "(no artist)" card where they can
// be split or attributed — dropping them here made the surface that is supposed
// to catch unclaimed money the one place it could not be seen.
//
// `meta` carries the ready-for-planning markers at BOTH grains (artist_meta and
// song_campaign_status), which exist to answer "what do I stage next" and
// previously led nowhere: they were set on Recoupments/Campaigns and never read.
router.get('/planning', async (req, res) => {
  try {
    const [rows, metaRows, songRows] = await Promise.all([
      recoupRows(req.labelId, `AND (e.ufr = false OR e.ufr IS NULL) AND e.prior_year_tag IS NULL`),
      pool.query('SELECT artist_key, ready_for_planning, flagged, flag_reason, priority, notes FROM artist_meta WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT artist_key, song_key, ready_for_planning, finished FROM song_campaign_status WHERE label_id = $1 AND (ready_for_planning = TRUE OR finished = TRUE)', [req.labelId]),
    ]);
    rows.sort((a, b) => String(a.artist || '').toLowerCase().localeCompare(String(b.artist || '').toLowerCase())
      || String(a.song || '').toLowerCase().localeCompare(String(b.song || '').toLowerCase()));
    res.json({
      success: true,
      data: rows,
      meta: {
        artist_meta: Object.fromEntries(metaRows.rows.map(m => [m.artist_key, m])),
        song_status: songRows.rows,
      },
    });
  } catch (error) {
    console.error('Planning error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/ufr-bulk { ids, ufr? } — claim (or un-claim)
// many costs in one action.
//
// `ufr` defaults to true: Planning's commit button has always posted ids alone
// and that contract is kept. Sending a non-boolean is rejected rather than
// coerced.
router.post('/recoupments/ufr-bulk', async (req, res) => {
  try {
    // Capped: a bulk write of unbounded size is a denial-of-service on a
    // money table, and no real batch is this large.
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 2000);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    if (req.body.ufr !== undefined && typeof req.body.ufr !== 'boolean') {
      return res.status(400).json({ success: false, error: 'ufr must be true or false' });
    }
    const want = req.body.ufr === undefined ? true : req.body.ufr;

    // Re-read the targets server-side under the SAME predicate the surfaces
    // use. A bulk endpoint taking arbitrary ids must not be the way a pending,
    // deleted, voided or non-recoupable row gets claimed.
    const { rows: targets } = await pool.query(
      `SELECT e.id, e.payee, COALESCE(e.ufr, FALSE) AS ufr FROM expenses e
        WHERE e.label_id = $1 AND e.id = ANY($2::int[]) AND ${recoupBaseSql('e')} AND e.prior_year_tag IS NULL`,
      [req.labelId, ids]
    );
    if (!targets.length) return res.status(404).json({ success: false, error: 'No matching recoupable entries' });

    // "claimed 622" and "claimed 4, 618 already were" are different outcomes.
    const changing = targets.filter(t => t.ufr !== want);
    const already = targets.length - changing.length;
    if (changing.length) {
      await pool.query(
        `UPDATE expenses SET ufr = $2,
                ufr_marked_at = CASE
                  WHEN $2 AND COALESCE(ufr, FALSE) = FALSE THEN NOW()
                  WHEN NOT $2 THEN NULL
                  ELSE ufr_marked_at END
          WHERE label_id = $3 AND id = ANY($1::int[])`,
        [changing.map(t => t.id), want, req.labelId]
      );
    }
    await bkAudit(req, want ? 'ufr_bulk_marked' : 'ufr_bulk_cleared',
      changing.length === 1 ? changing[0].id : null,
      `${changing.length} recoupable entr${changing.length === 1 ? 'y' : 'ies'}`, 'ufr', null, String(want),
      `${want ? 'Uploaded for recoupment' : 'Removed from recoupment'} in bulk — ${changing.length} changed${already ? `, ${already} already ${want ? 'claimed' : 'unclaimed'}` : ''}`);
    await logActivity(req, want ? 'Committed recoupment statement' : 'Un-claimed recoupment entries', `${changing.length} entries`);
    res.json({ success: true, data: {
      ufr: want, changed: changing.length, already, requested: ids.length,
      // A gap means rows were not recoupable, or moved under the caller.
      skipped: Math.max(0, ids.length - targets.length),
      // Kept for the Planning page, which reads `committed`.
      committed: changing.length,
    } });
  } catch (error) {
    console.error('UFR bulk error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/move-month { ids, month } — move claimed
// items BETWEEN statements. This is the only writer of `ufr_marked_at` that is
// allowed to overwrite an existing stamp, and it is explicit for that reason.
// Only already-claimed rows are eligible: a move is not a claim.
router.post('/recoupments/move-month', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 2000);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const stamp = statementStampFor(req.body.month);
    if (!stamp) return res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
    const { rows: targets } = await pool.query(
      `SELECT e.id, e.payee, e.ufr_marked_at FROM expenses e
        WHERE e.label_id = $1 AND e.id = ANY($2::int[]) AND e.ufr = TRUE AND ${recoupBaseSql('e')}`,
      [req.labelId, ids]
    );
    // Already in that statement = nothing to do. Reported, not silently counted
    // as a move.
    const moving = targets.filter(t => statementMonthFor(t.ufr_marked_at) !== req.body.month);
    if (moving.length) {
      await pool.query('UPDATE expenses SET ufr_marked_at = $1 WHERE label_id = $2 AND id = ANY($3::int[])',
        [stamp, req.labelId, moving.map(t => t.id)]);
      await bkAudit(req, 'ufr_month_moved', moving.length === 1 ? moving[0].id : null,
        `${moving.length} entr${moving.length === 1 ? 'y' : 'ies'}`, 'ufr_marked_at', null, req.body.month,
        `Moved to the ${req.body.month} statement`);
      await logActivity(req, 'Moved recoupment items between statements', `${moving.length} → ${req.body.month}`);
    }
    res.json({ success: true, data: { moved: moving.length, already: targets.length - moving.length, requested: ids.length, skipped: Math.max(0, ids.length - targets.length), month: req.body.month } });
  } catch (error) {
    console.error('Statement move error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/set-label { ids, label, mark_ufr? } — the
// upload-batch vocabulary. Optionally claims in the same action, because
// "label this batch and upload it" is one decision.
router.post('/recoupments/set-label', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 2000);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const label = req.body.label === null || req.body.label === '' ? null : String(req.body.label).trim().slice(0, 120);
    const { rows: targets } = await pool.query(
      `SELECT e.id FROM expenses e
        WHERE e.label_id = $1 AND e.id = ANY($2::int[]) AND ${recoupBaseSql('e')}`,
      [req.labelId, ids]
    );
    if (!targets.length) return res.status(404).json({ success: false, error: 'No matching recoupable entries' });
    const tids = targets.map(t => t.id);
    if (req.body.mark_ufr) {
      await pool.query(
        `UPDATE expenses SET recoupment_label = $1, ufr = TRUE,
                ufr_marked_at = COALESCE(ufr_marked_at, NOW())
          WHERE label_id = $2 AND id = ANY($3::int[])`, [label, req.labelId, tids]);
    } else {
      await pool.query('UPDATE expenses SET recoupment_label = $1 WHERE label_id = $2 AND id = ANY($3::int[])', [label, req.labelId, tids]);
    }
    await bkAudit(req, 'recoupment_label_set', tids.length === 1 ? tids[0] : null, `${tids.length} entries`,
      'recoupment_label', null, label, `Set recoupment label${req.body.mark_ufr ? ' and uploaded for recoupment' : ''}`);
    res.json({ success: true, data: { updated: tids.length, skipped: Math.max(0, ids.length - tids.length), label } });
  } catch (error) {
    console.error('Set recoupment label error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── The recoupment integrity audit ──────────────────────────────────────────
//
// The Recoupments page answers "what can we recoup". This answers the question
// that page cannot ask about itself: "is anything missing, and is anything
// claimed that shouldn't be?"
//
// Five checks, ONE endpoint. Two are money NOT claimed, three are money claimed
// wrongly, and they are deliberately never summed into a single exposure
// headline — they need opposite actions. Every predicate lives here rather than
// in the page because a predicate about money that lives in two places
// disagrees with itself eventually.
//
// Deliberately NOT included: "claimed with no bank line". That already has a
// tile on the Recoupments index (`ufr_unverified_*` in `rollup`), and one
// condition with two homes is how two homes start disagreeing.

// The categories in which "this row names no artist" is a MISTAKE rather than
// the normal state. Everywhere else in a bank pile a missing artist is
// ordinary — rent, cards, bank fees and label-level ad spend genuinely belong
// to nobody. Here the money IS an artist's by definition, so a row without a
// name is a recoupable cost with nobody to bill.
//
// Read from the per-label `categories` table (`ui_group`), not a hardcoded
// list: cadence lets a workspace rename and add categories, and a hardcoded
// list silently stops covering the ones added next month. 'artist' is
// Advance / Tour-Live / Royalties, 'record' is Recording / Mixing & Mastering /
// Production / Services.
//
// Unlike the reference app, class rules DO apply to this check. They have to:
// `ui_group` is coarser than the reference app's hand-picked list (Royalties
// rides in 'artist'), so without rules a Royalties ruling would silence the
// pile and leave this band flooded by the same rows.
const ADVANCE_UI_GROUPS = ['artist', 'record'];

router.get('/recoupment-audit', async (req, res) => {
  try {
    const accounts = await loadAccounts(pool, req.labelId);
    // `entry_source IS NULL` on every hand-entered row, so bank EXCLUSION must
    // be IS DISTINCT FROM (lib/ledgerSource.js) — a plain `<>` is NULL for
    // those rows and drops every invoice from the claimed-side checks.
    const ALIVE = `(e.deleted IS NULL OR e.deleted = FALSE)
                   AND (e.voided IS NULL OR e.voided = FALSE)
                   AND COALESCE(e.status, 'approved') = 'approved'`;

    const [advRes, pileRes, claimedRes, famRes, rules, artistRes] = await Promise.all([
      // ── 1. Advances waiting for an artist ──
      pool.query(
        `SELECT e.id, e.payee, e.category, e.description, e.amount, e.currency,
                e.fx_rate_to_usd, e.invoice_date, e.payment_date, e.artist,
                ${bankEvidenceCols('e', accounts)}
           FROM expenses e
          WHERE e.label_id = $1
            AND e.entry_source = 'bank_statement'
            AND COALESCE(e.recoup_reviewed, FALSE) = FALSE
            AND COALESCE(TRIM(e.artist), '') = ''
            AND LOWER(TRIM(COALESCE(e.category, ''))) IN (
              SELECT LOWER(TRIM(c.name)) FROM categories c
               WHERE c.label_id = $1 AND c.kind = 'expense' AND c.ui_group = ANY($2::text[]))
            AND ${notClassRuledSql('e', '$1')}
            AND ${ALIVE}
          ORDER BY (CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd ELSE e.amount END) DESC NULLS LAST`,
        [req.labelId, ADVANCE_UI_GROUPS]
      ),

      // ── 2. The bank pile, BY CATEGORY, with what the rules already cover ──
      // Grouped in SQL: the whole point is that this list is too long to ship
      // to a browser and too long to click through one row at a time.
      // `BOOL_OR(NOT notClassRuled)` is how the page can say what a rule did.
      pool.query(
        `SELECT COALESCE(NULLIF(TRIM(e.category), ''), '—') AS category,
                COUNT(*)::int AS n,
                SUM(CASE WHEN e.fx_rate_to_usd > 0 THEN e.amount / e.fx_rate_to_usd ELSE e.amount END)::float8 AS usd,
                BOOL_OR(NOT (${notClassRuledSql('e', '$1')})) AS ruled
           FROM expenses e
          WHERE e.label_id = $1
            AND e.entry_source = 'bank_statement'
            AND COALESCE(e.recoup_reviewed, FALSE) = FALSE
            AND ${ALIVE}
          GROUP BY 1
          ORDER BY 3 DESC NULLS LAST`,
        [req.labelId]
      ),

      // ── 3 + 4. Every CLAIMED row, with whether its FAMILY holds a document ──
      // One query serves both checks: they read the same population and
      // splitting them would let the two disagree.
      //
      // has_doc ORs the PARENT's file columns — a split child's invoice lives
      // on its parent, and checking the row alone once reported 78 missing
      // where 23 were. Both storage paths are ORed (R2 key or inline blob).
      pool.query(
        `SELECT e.id, e.payee, e.artist, e.song, e.category, e.invoice_number,
                e.amount, e.currency, e.fx_rate_to_usd, e.invoice_date,
                e.payment_date, e.ufr_marked_at, e.parent_id, e.recoupment_label,
                (e.invoice_r2_key IS NOT NULL OR e.invoice_filename IS NOT NULL
                  OR e.receipt_r2_key IS NOT NULL OR e.receipt_filename IS NOT NULL
                  OR p.invoice_r2_key IS NOT NULL OR p.invoice_filename IS NOT NULL
                  OR p.receipt_r2_key IS NOT NULL OR p.receipt_filename IS NOT NULL) AS has_doc,
                ${bankEvidenceCols('e', accounts)}
           FROM expenses e
           LEFT JOIN expenses p ON p.id = e.parent_id AND p.label_id = e.label_id
          WHERE e.label_id = $1
            AND e.ufr = TRUE
            AND COALESCE(e.recoupable, FALSE) = TRUE
            AND ${ALIVE}
            AND ${excludeBankRows('e')}`,
        [req.labelId]
      ),

      // ── 5. Split families with part of one payment claimed and part not ──
      // Family-wide on purpose: `recoupBaseSql` is root-only so a family is
      // counted once, which means the slices below the root are exactly the
      // ones no recoupment surface can show you.
      pool.query(
        `SELECT COALESCE(e.parent_id, e.id) AS root_id,
                e.id, e.payee, e.artist, e.song, e.category, e.ufr,
                e.amount, e.currency, e.fx_rate_to_usd, e.invoice_date, e.parent_id
           FROM expenses e
          WHERE e.label_id = $1
            AND COALESCE(e.recoupable, FALSE) = TRUE
            AND ${ALIVE}
            AND ${excludeBankRows('e')}
            AND COALESCE(e.parent_id, e.id) IN (
              SELECT COALESCE(x.parent_id, x.id)
                FROM expenses x
               WHERE x.label_id = $1
                 AND COALESCE(x.recoupable, FALSE) = TRUE
                 AND (x.deleted IS NULL OR x.deleted = FALSE)
                 AND (x.voided IS NULL OR x.voided = FALSE)
                 AND COALESCE(x.status, 'approved') = 'approved'
               GROUP BY 1
              HAVING COUNT(*) > 1
                 AND COUNT(*) FILTER (WHERE x.ufr = TRUE) > 0
                 AND COUNT(*) FILTER (WHERE x.ufr IS DISTINCT FROM TRUE) > 0
            )
          ORDER BY root_id, e.id`,
        [req.labelId]
      ),

      loadRecoupmentClassRules(pool, req.labelId),

      // The artist vocabulary for check 1's picker, so the page is ONE fetch.
      // Most-used spelling first — the same rule `bestSpelling` follows — so
      // the list offers the name the rest of the app already shows. The picker
      // still takes free text: an advance can be the first cost an artist ever
      // has.
      pool.query(
        `SELECT e.artist AS name, COUNT(*)::int AS n
           FROM expenses e
          WHERE e.label_id = $1
            AND COALESCE(TRIM(e.artist), '') <> ''
            AND (e.deleted IS NULL OR e.deleted = FALSE)
            AND (e.voided IS NULL OR e.voided = FALSE)
          GROUP BY e.artist
          ORDER BY n DESC, LOWER(e.artist) ASC
          LIMIT 400`,
        [req.labelId]
      ),
    ]);

    const [proposals, twins] = await Promise.all([
      loadArtistProposals(pool, req.labelId), loadLedgerTwins(pool, req.labelId),
    ]);
    const advances = attachRecoupContext(advRes.rows, { proposals, twins });

    const pileRows = pileRes.rows.map(r => ({
      category: r.category, n: r.n, usd: round2(Number(r.usd) || 0), ruled: r.ruled === true,
    }));
    const pile = {
      by_category: pileRows,
      total_usd: round2(pileRows.reduce((t, r) => t + r.usd, 0)),
      total_items: pileRows.reduce((t, r) => t + r.n, 0),
      covered_usd: round2(pileRows.filter(r => r.ruled).reduce((t, r) => t + r.usd, 0)),
      covered_items: pileRows.filter(r => r.ruled).reduce((t, r) => t + r.n, 0),
      rules: rules.rows,
    };
    pile.remaining_usd = round2(pile.total_usd - pile.covered_usd);
    pile.remaining_items = pile.total_items - pile.covered_items;

    const claimed = claimedRes.rows.map(r => ({ ...r, amount_usd_calc: rowUsdOf(r) }));
    const double_claims = groupDoubleClaims(claimed);
    const no_document = groupNoDocument(claimed.filter(r => r.has_doc !== true));
    const no_document_rows = no_document.flatMap(a => a.list);
    const partial = partialFamilies(famRes.rows.map(r => ({ ...r, amount_usd_calc: rowUsdOf(r) })));

    res.json({ success: true, data: {
      advances,
      pile,
      artist_options: artistRes.rows.map(r => r.name),
      double_claims,
      no_document,
      partial_families: partial,
      totals: {
        advances_usd: sumUsd(advances), advances_items: advances.length,
        pile_usd: pile.remaining_usd, pile_items: pile.remaining_items,
        double_claims_usd: round2(double_claims.reduce((t, g) => t + g.usd, 0)),
        double_claims_groups: double_claims.length,
        double_claims_cross_artist: double_claims.filter(g => g.cross_artist).length,
        no_document_usd: sumUsd(no_document_rows), no_document_items: no_document_rows.length,
        partial_families_usd: round2(partial.reduce((t, f) => t + f.open_usd, 0)),
        partial_families_count: partial.length,
        partial_families_items: partial.reduce((t, f) => t + f.open_ids.length, 0),
      },
    } });
  } catch (error) {
    console.error('Recoupment audit error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Never-recoupable class rules ────────────────────────────────────────────
// A rule writes NOTHING to the ledger and moves no money — the rows it covers
// are already off every recoupment surface — so DELETE is a complete undo.
router.get('/recoupment-class-rules', async (req, res) => {
  try {
    const rules = await loadRecoupmentClassRules(pool, req.labelId);
    res.json({ success: true, data: rules.rows });
  } catch (error) {
    console.error('Class rules error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST { scope:'vendor'|'category', keys:[...] | key, reason? }
// Takes a LIST, because that is how these get made: select the Salary and Rent
// groups in the pile and say "none of this is ever an artist's cost" — two
// rules from one action.
router.post('/recoupment-class-rules', async (req, res) => {
  try {
    const scope = String(req.body.scope || 'category');
    if (!SCOPES.includes(scope)) return res.status(400).json({ success: false, error: "scope must be 'vendor' or 'category'" });
    const keys = [...new Set([
      ...(Array.isArray(req.body.keys) ? req.body.keys : []),
      ...(req.body.key ? [req.body.key] : []),
    ].map(k => String(k || '').trim()).filter(Boolean))].slice(0, 200);
    if (!keys.length) return res.status(400).json({ success: false, error: 'key or keys required' });
    const reason = String(req.body.reason || '').slice(0, 500) || null;

    const made = [];
    for (const key of keys) {
      const { rows } = await pool.query(
        `INSERT INTO recoupment_class_rules (label_id, scope, rule_key, reason, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (label_id, scope, LOWER(TRIM(rule_key)))
           DO UPDATE SET reason = COALESCE(EXCLUDED.reason, recoupment_class_rules.reason)
         RETURNING id, scope, rule_key`,
        [req.labelId, scope, key, reason, req.user.name]
      );
      if (rows[0]) made.push(rows[0]);
    }
    await bkAudit(req, 'recoup_class_rule_added', null, keys.join(', '), 'recoupable', null, scope,
      `Declared never recoupable against an artist (${scope}): ${keys.join(', ')} — removes those rows from the recoupment review queue; nothing written to the ledger${reason ? ` — ${reason}` : ''}`);
    await logActivity(req, 'Declared spend never recoupable', `${scope}: ${keys.join(', ')}`);
    res.json({ success: true, data: { made } });
  } catch (error) {
    console.error('Class rule add error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE — the rows come straight back into the queue.
router.delete('/recoupment-class-rules/:id(\\d+)', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM recoupment_class_rules WHERE id = $1 AND label_id = $2 RETURNING scope, rule_key',
      [parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Rule not found' });
    await bkAudit(req, 'recoup_class_rule_removed', null, rows[0].rule_key, 'recoupable', rows[0].scope, null,
      `No longer a never-recoupable class: ${rows[0].rule_key} — its rows return to the recoupment review queue`);
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Class rule delete error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/claim-family { root_id }
//
// Claim the unclaimed slices of ONE split family — the audit's check-5 fix.
//
// Why this is not `ufr-bulk`: that endpoint re-reads under `recoupBaseSql`,
// which is root-only (`parent_id IS NULL`) so a split family is counted once on
// every surface. That is right for a display predicate and wrong for this
// write, because the rows that need claiming here are precisely the children.
// Rather than loosen the shared predicate — the gate it carries is the reason
// unreviewed bank debits stopped counting as recoupable spend — the family case
// gets its own named writer, scoped to ONE family and to rows that are already
// recoupable, approved and live.
//
// The TIMESTAMP RULE is the same one both other writers implement: stamp on the
// transition INTO claimed, and PRESERVE it on a row already claimed, so a
// statement a partner has already received never silently moves.
router.post('/recoupments/claim-family', async (req, res) => {
  try {
    const rootId = Number(req.body.root_id);
    if (!Number.isFinite(rootId)) return res.status(400).json({ success: false, error: 'root_id required' });
    const { rows: members } = await pool.query(
      `SELECT e.id, e.payee, COALESCE(e.ufr, FALSE) AS ufr, e.parent_id FROM expenses e
        WHERE e.label_id = $1 AND COALESCE(e.parent_id, e.id) = $2
          AND COALESCE(e.recoupable, FALSE) = TRUE
          AND COALESCE(e.status, 'approved') = 'approved'
          AND (e.deleted = false OR e.deleted IS NULL) AND (e.voided = false OR e.voided IS NULL)
          AND ${excludeBankRows('e')}`,
      [req.labelId, rootId]
    );
    if (!members.length) return res.status(404).json({ success: false, error: 'No matching split family' });
    const open = members.filter(m => !m.ufr);
    if (open.length) {
      await pool.query(
        `UPDATE expenses SET ufr = TRUE, ufr_marked_at = COALESCE(ufr_marked_at, NOW())
          WHERE label_id = $1 AND id = ANY($2::int[])`,
        [req.labelId, open.map(m => m.id)]
      );
      await bkAudit(req, 'ufr_family_claimed', rootId, members[0].payee, 'ufr', null, 'true',
        `Claimed the remaining ${open.length} slice${open.length === 1 ? '' : 's'} of split payment #${rootId} — the family is now claimed whole`);
      await logActivity(req, 'Claimed the rest of a split payment', `#${rootId} — ${open.length} slices`);
    }
    res.json({ success: true, data: { root_id: rootId, claimed: open.length, members: members.length } });
  } catch (error) {
    console.error('Claim family error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/add-expense — add a recoupable expense to an
// artist straight from Recoupments (auto-approved, recoupable, source-stamped).
router.post('/recoupments/add-expense', async (req, res) => {
  try {
    const b = req.body;
    const amount = parseFloat(b.amount);
    if (!b.artist || !amount || amount <= 0) return res.status(400).json({ success: false, error: 'Artist and a valid amount are required' });
    const paid = b.paid === true || b.paid === 'true';
    const socials = Array.isArray(b.social_handles)
      ? b.social_handles.filter(s => s && String(s.handle || '').trim()).slice(0, 40) : null;
    const { rows } = await pool.query(
      `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, song, amount, currency,
         status, payment_status, payment_date, paid_by, paid_marked_at, recoupable, entry_source, created_by, created_at,
         recoupment_label, social_handles, notes)
       VALUES ($1, COALESCE($11::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, COALESCE($8,'USD'), 'approved', $10,
               CASE WHEN $10 = 'Paid' THEN CURRENT_DATE ELSE NULL END,
               CASE WHEN $10 = 'Paid' THEN $9 ELSE NULL END,
               CASE WHEN $10 = 'Paid' THEN NOW() ELSE NULL END,
               TRUE, 'recoupment', $9, NOW(), $12, $13, $14)
       RETURNING id`,
      [req.labelId, (b.payee || b.description || 'Recoupable expense').trim(), (b.description || '').trim() || null,
       (b.category || '').trim() || null, b.artist.trim(), (b.song || '').trim() || null, amount, (b.currency || 'USD').trim(), req.user.name,
       paid ? 'Paid' : 'Unpaid', /^\d{4}-\d{2}-\d{2}$/.test(b.invoice_date || '') ? b.invoice_date : null,
       (b.recoupment_label || '').trim() || null, socials ? JSON.stringify(socials) : null, (b.notes || '').trim() || null]
    );
    // Claim at create — the row is being added BECAUSE it is going on this
    // month's statement, so making that a second trip is a step nobody takes.
    if (b.ufr === true || b.ufr === 'true') {
      await pool.query('UPDATE expenses SET ufr = TRUE, ufr_marked_at = NOW() WHERE id = $1 AND label_id = $2', [rows[0].id, req.labelId]);
    }
    if (paid) require('../lib/fxStamp').stampFxRateAsync(rows[0].id);
    await logActivity(req, 'Added recoupable expense', `${b.artist} — ${amount}`);
    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error('Add recoupable expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/artist-meta { artist, priority?,
// ready_for_planning?, notes?, flagged?, flag_reason?, dismissed? } — upsert the
// shared artist_meta row.
//
// Keyed by `artistKeyOf`, the SAME normalized key Artist Campaigns writes. It
// used to key on lower(name), which meant "Life/Line" carried two meta rows —
// one per page — and neither page could see the other's priority.
router.post('/recoupments/artist-meta', async (req, res) => {
  try {
    const artist = String(req.body.artist || '').trim();
    const key = artistKeyOf(artist);
    if (!key) return res.status(400).json({ success: false, error: 'Artist required' });
    const sets = [], vals = [req.labelId, key];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (req.body.priority !== undefined) {
      // Validated, never free text: priority drives the subtabs and their
      // counts, and an unrecognized value creates a band nobody can select.
      const p = normalizePriority(req.body.priority);
      if (p === undefined) return res.status(400).json({ success: false, error: 'priority must be high, medium or low' });
      add('priority', p); sets.push('priority_updated_at = NOW()'); vals.push(req.user.name); sets.push(`priority_updated_by = $${vals.length}`);
    }
    if (req.body.ready_for_planning !== undefined) { add('ready_for_planning', !!req.body.ready_for_planning); sets.push(`ready_at = ${req.body.ready_for_planning ? 'NOW()' : 'NULL'}`); vals.push(req.user.name); sets.push(`ready_by = $${vals.length}`); }
    if (req.body.notes !== undefined) add('notes', req.body.notes || null);
    if (req.body.dismissed !== undefined) { add('dismissed', !!req.body.dismissed); sets.push(`dismissed_at = ${req.body.dismissed ? 'NOW()' : 'NULL'}`); vals.push(req.user.name); sets.push(`dismissed_by = $${vals.length}`); }
    if (req.body.flagged !== undefined) { add('flagged', !!req.body.flagged); add('flag_reason', req.body.flag_reason || null); sets.push(`flagged_at = ${req.body.flagged ? 'NOW()' : 'NULL'}`); vals.push(req.user.name); sets.push(`flagged_by = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    await pool.query(
      `INSERT INTO artist_meta (label_id, artist_key) VALUES ($1, $2)
       ON CONFLICT (label_id, artist_key) DO UPDATE SET ${sets.join(', ')}, updated_at = NOW()`,
      vals
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Recoupment artist-meta error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/prior-year { ids, tag } — tag/untag rows for
// the prior-year subpage. tag = a year label (e.g. "2024") or null to unmark.
// Takes a list, so a whole song or category bucket is one action.
router.post('/recoupments/prior-year', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 2000);
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const tag = req.body.tag ? String(req.body.tag).trim().slice(0, 20) : null;
    const { rowCount } = await pool.query('UPDATE expenses SET prior_year_tag = $1 WHERE label_id = $2 AND id = ANY($3::int[])', [tag, req.labelId, ids]);
    await logActivity(req, tag ? 'Tagged prior-year recoupment' : 'Untagged prior-year recoupment', `${rowCount} entries`);
    res.json({ success: true, data: { affected: rowCount } });
  } catch (error) {
    console.error('Prior-year tag error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments-prior-year — tagged rows grouped by artist
// (per-artist key cards + summary on the client).
router.get('/recoupments-prior-year', async (req, res) => {
  try {
    const rows = await recoupRows(req.labelId, 'AND e.prior_year_tag IS NOT NULL');
    rows.sort((a, b) => String(a.artist || '').toLowerCase().localeCompare(String(b.artist || '').toLowerCase()));
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Prior-year list error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── Artist income entries ────────────────────────────────────────────────

// GET /api/financials/income
router.get('/income', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, a.name AS artist_name FROM artist_income i
       LEFT JOIN artists a ON a.id = i.artist_id AND a.label_id = i.label_id
       WHERE i.label_id = $1 ORDER BY i.income_date DESC, i.id DESC`,
      [req.labelId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('List income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/income
router.post('/income', async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'A valid amount is required' });
    let artistId = req.body.artist_id ? parseInt(req.body.artist_id, 10) : null;
    if (artistId) {
      const owner = await pool.query('SELECT 1 FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
      if (!owner.rows.length) return res.status(400).json({ success: false, error: 'Artist not found in this workspace' });
    }
    const { rows } = await pool.query(
      `INSERT INTO artist_income (label_id, artist_id, source, description, amount, currency, income_date, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'USD'),COALESCE($7,CURRENT_DATE),$8) RETURNING *`,
      [req.labelId, artistId, req.body.source || null, req.body.description || null, amount, req.body.currency || null, req.body.income_date || null, req.user.id]
    );
    await logActivity(req, 'Added income', `${req.body.source || 'income'} — ${amount}`);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Create income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /api/financials/income/:id
router.delete('/income/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM artist_income WHERE id = $1 AND label_id = $2', [parseInt(req.params.id, 10), req.labelId]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Income entry not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete income error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

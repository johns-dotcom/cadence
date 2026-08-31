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
const { statementMonthFor } = require('../lib/statementMonth');
const { artistBucketKey } = require('../lib/artistKey');
const {
  computeExec, rowsForBucket, execWorkbook, fetchSlices,
  normFilters, isKnownBucket, isDay, todayStr, monthsBetween,
} = require('../lib/financeExec');

const router = express.Router();
// Financials are privileged — approvers and up. Every query is label-scoped.
router.use(authMiddleware, withTenant, requireApprover);

const round2 = (n) => Math.round((n || 0) * 100) / 100;

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

// GET /api/financials/recoupments — per-artist recoupable spend vs income.
router.get('/recoupments', async (req, res) => {
  try {
    const [artists, spendRows, incRows, metaRows] = await Promise.all([
      pool.query('SELECT id, name FROM artists WHERE label_id = $1 ORDER BY name', [req.labelId]),
      pool.query(
        `SELECT LOWER(e.artist) AS akey, e.amount, e.currency, e.fx_rate_to_usd,
                COALESCE(e.payment_date, e.invoice_date, e.created_at::date) AS fx_date
         FROM expenses e
         WHERE e.label_id = $1 AND e.recoupable = TRUE AND e.status = 'approved'
           AND (e.deleted = false OR e.deleted IS NULL) AND e.parent_id IS NULL AND (e.voided = false OR e.voided IS NULL)
           AND e.prior_year_tag IS NULL`,
        [req.labelId]
      ),
      pool.query('SELECT artist_id, amount, currency, income_date AS fx_date FROM artist_income WHERE label_id = $1', [req.labelId]),
      pool.query('SELECT artist_key, priority, ready_for_planning, flagged, flag_reason, notes FROM artist_meta WHERE label_id = $1', [req.labelId]),
    ]);
    const metaByKey = {};
    for (const m of metaRows.rows) metaByKey[m.artist_key] = m;

    // Roll up recoupable spend (by artist name) and income (by artist_id) in USD.
    const spendByName = {};
    for (const r of spendRows.rows) {
      if (!r.akey) continue;
      spendByName[r.akey] = (spendByName[r.akey] || 0) + await eUsd(r, r.fx_date);
    }
    const incById = {};
    for (const r of incRows.rows) {
      if (!r.artist_id) continue;
      incById[r.artist_id] = (incById[r.artist_id] || 0) + await toUSD(r.amount, r.currency, r.fx_date);
    }

    const round = (n) => Math.round((n || 0) * 100) / 100;
    const data = artists.rows.map(a => {
      const spend = round(spendByName[a.name.toLowerCase()]);
      const income = round(incById[a.id]);
      const meta = metaByKey[a.name.toLowerCase()] || {};
      return {
        artist_id: a.id, name: a.name, currency: 'USD', recoupable_spend: spend, income, balance: round(income - spend), recouped: income >= spend && spend > 0,
        priority: meta.priority || null, ready_for_planning: !!meta.ready_for_planning, flagged: !!meta.flagged, flag_reason: meta.flag_reason || null, notes: meta.notes || null,
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Recoupments error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/recoupments/:artistId — one artist's recoupable ledger
// entries (for song grouping) + income + totals, in USD.
router.get('/recoupments/:artistId', async (req, res) => {
  try {
    const artistId = parseInt(req.params.artistId, 10);
    const a = await pool.query('SELECT id, name FROM artists WHERE id = $1 AND label_id = $2', [artistId, req.labelId]);
    if (!a.rows.length) return res.status(404).json({ success: false, error: 'Artist not found' });
    const name = a.rows[0].name;

    const [spend, income] = await Promise.all([
      pool.query(
        `SELECT id, payee, song, category, amount, currency, fx_rate_to_usd, invoice_date, payment_date, payment_status,
                ufr, ufr_marked_at, social_handles, created_at
           FROM expenses
          WHERE label_id = $1 AND recoupable = TRUE AND status = 'approved'
            AND LOWER(artist) = LOWER($2) AND (deleted = false OR deleted IS NULL)
            AND parent_id IS NULL AND (voided = false OR voided IS NULL) AND prior_year_tag IS NULL
          ORDER BY COALESCE(payment_date, invoice_date, created_at::date) DESC`,
        [req.labelId, name]
      ),
      pool.query('SELECT id, amount, currency, income_date, source FROM artist_income WHERE label_id = $1 AND artist_id = $2 ORDER BY income_date DESC', [req.labelId, artistId]),
    ]);

    let spendUsd = 0;
    const entries = [];
    for (const r of spend.rows) {
      const usd = await eUsd(r, r.payment_date || r.invoice_date || r.created_at);
      spendUsd += usd;
      entries.push({ ...r, amount_usd: Math.round(usd * 100) / 100, statement_month: r.ufr ? statementMonthFor(r.ufr_marked_at) : null });
    }
    let incUsd = 0;
    for (const r of income.rows) incUsd += await toUSD(r.amount, r.currency, r.income_date);
    const round = (n) => Math.round((n || 0) * 100) / 100;

    res.json({ success: true, data: {
      artist: { id: artistId, name },
      entries,
      income: income.rows,
      totals: { recoupable_spend: round(spendUsd), income: round(incUsd), balance: round(incUsd - spendUsd), recouped: incUsd >= spendUsd && spendUsd > 0 },
    } });
  } catch (error) {
    console.error('Recoupment detail error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/statements — committed (UFR) recoupable entries grouped
// by statement month (client groups on statement_month).
router.get('/statements', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payee, artist, song, amount, currency, ufr_marked_at,
              COALESCE(payment_date, invoice_date, created_at::date) AS fx_date, fx_rate_to_usd
         FROM expenses
        WHERE label_id = $1 AND recoupable = TRUE AND ufr = TRUE
          AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL) AND parent_id IS NULL
        ORDER BY ufr_marked_at DESC`,
      [req.labelId]
    );
    const out = [];
    for (const r of rows) out.push({ ...r, amount_usd: Math.round((await eUsd(r, r.fx_date)) * 100) / 100, statement_month: statementMonthFor(r.ufr_marked_at) });
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Statements error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/:id/ufr { ufr } — toggle the statement mark.
router.post('/recoupments/:id/ufr', async (req, res) => {
  try {
    const on = req.body.ufr !== false;
    const { rows } = await pool.query(
      `UPDATE expenses SET ufr = $1, ufr_marked_at = CASE WHEN $1 THEN NOW() ELSE NULL END
        WHERE id = $2 AND label_id = $3 RETURNING id, ufr, ufr_marked_at`,
      [on, parseInt(req.params.id, 10), req.labelId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Entry not found' });
    res.json({ success: true, data: { ...rows[0], statement_month: rows[0].ufr ? statementMonthFor(rows[0].ufr_marked_at) : null } });
  } catch (error) {
    console.error('UFR toggle error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/financials/planning — recoupable entries not yet marked UFR, across
// all artists, for staged batch statement commits. Grouped client-side.
router.get('/planning', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payee, artist, song, category, amount, currency, fx_rate_to_usd, invoice_date, payment_date, payment_status, created_at
         FROM expenses
        WHERE label_id = $1 AND recoupable = TRUE AND status = 'approved' AND (ufr = false OR ufr IS NULL)
          AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL AND (voided = false OR voided IS NULL)
          AND prior_year_tag IS NULL AND artist IS NOT NULL AND artist <> ''
        ORDER BY LOWER(artist), LOWER(COALESCE(song,'')), COALESCE(payment_date, invoice_date, created_at::date) DESC`,
      [req.labelId]
    );
    const out = [];
    for (const r of rows) out.push({ ...r, amount_usd: Math.round((await eUsd(r, r.payment_date || r.invoice_date || r.created_at)) * 100) / 100 });
    res.json({ success: true, data: out });
  } catch (error) {
    console.error('Planning error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/ufr-bulk { ids } — commit a batch of entries
// to a statement (mark UFR, stamped now).
router.post('/recoupments/ufr-bulk', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, error: 'No entries selected' });
    const { rowCount } = await pool.query(
      `UPDATE expenses SET ufr = TRUE, ufr_marked_at = NOW() WHERE label_id = $1 AND id = ANY($2::int[])`,
      [req.labelId, ids]
    );
    await logActivity(req, 'Committed recoupment statement', `${rowCount} entries`);
    res.json({ success: true, data: { committed: rowCount } });
  } catch (error) {
    console.error('UFR bulk error:', error);
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
    const { rows } = await pool.query(
      `INSERT INTO expenses (label_id, invoice_date, payee, description, category, artist, song, amount, currency,
         status, payment_status, payment_date, paid_by, paid_marked_at, recoupable, entry_source, created_by, created_at)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, COALESCE($8,'USD'), 'approved', $10,
               CASE WHEN $10 = 'Paid' THEN CURRENT_DATE ELSE NULL END,
               CASE WHEN $10 = 'Paid' THEN $9 ELSE NULL END,
               CASE WHEN $10 = 'Paid' THEN NOW() ELSE NULL END,
               TRUE, 'recoupment', $9, NOW())
       RETURNING id`,
      [req.labelId, (b.payee || b.description || 'Recoupable expense').trim(), (b.description || '').trim() || null,
       (b.category || '').trim() || null, b.artist.trim(), (b.song || '').trim() || null, amount, (b.currency || 'USD').trim(), req.user.name,
       paid ? 'Paid' : 'Unpaid']
    );
    if (paid) require('../lib/fxStamp').stampFxRateAsync(rows[0].id);
    await logActivity(req, 'Added recoupable expense', `${b.artist} — ${amount}`);
    res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (error) {
    console.error('Add recoupable expense error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/financials/recoupments/artist-meta { artist, priority?, ready_for_planning?,
// notes?, flagged?, flag_reason? } — upsert the shared artist_meta row (same
// table the campaigns hub uses; keyed by lower(artist name)).
router.post('/recoupments/artist-meta', async (req, res) => {
  try {
    const artist = String(req.body.artist || '').trim();
    if (!artist) return res.status(400).json({ success: false, error: 'Artist required' });
    const key = artist.toLowerCase();
    const sets = [], vals = [req.labelId, key];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (req.body.priority !== undefined) { add('priority', req.body.priority || null); sets.push(`priority_updated_at = NOW()`); vals.push(req.user.name); sets.push(`priority_updated_by = $${vals.length}`); }
    if (req.body.ready_for_planning !== undefined) { add('ready_for_planning', !!req.body.ready_for_planning); sets.push(`ready_at = ${req.body.ready_for_planning ? 'NOW()' : 'NULL'}`); vals.push(req.user.name); sets.push(`ready_by = $${vals.length}`); }
    if (req.body.notes !== undefined) add('notes', req.body.notes || null);
    if (req.body.flagged !== undefined) { add('flagged', !!req.body.flagged); add('flag_reason', req.body.flag_reason || null); sets.push(`flagged_at = ${req.body.flagged ? 'NOW()' : 'NULL'}`); vals.push(req.user.name); sets.push(`flagged_by = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ success: false, error: 'Nothing to update' });
    // Insert-or-update on the unique (label_id, artist_key).
    const insertCols = ['label_id', 'artist_key'];
    const insertVals = ['$1', '$2'];
    await pool.query(
      `INSERT INTO artist_meta (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})
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
router.post('/recoupments/prior-year', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Boolean) : [];
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
    const { rows } = await pool.query(
      `SELECT id, payee, artist, song, category, amount, currency, prior_year_tag, payment_status,
              COALESCE(payment_date, invoice_date, created_at::date) AS fx_date, fx_rate_to_usd
         FROM expenses
        WHERE label_id = $1 AND recoupable = TRUE AND prior_year_tag IS NOT NULL
          AND (deleted = false OR deleted IS NULL) AND parent_id IS NULL AND (voided = false OR voided IS NULL)
        ORDER BY LOWER(artist), fx_date DESC`,
      [req.labelId]
    );
    const out = [];
    for (const r of rows) out.push({ ...r, amount_usd: Math.round((await eUsd(r, r.fx_date)) * 100) / 100 });
    res.json({ success: true, data: out });
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

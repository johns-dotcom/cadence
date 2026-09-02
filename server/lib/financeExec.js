// The executive Financials view (ported from boom-dashboard's /financials/exec
// family) — weekly cash-out vs open-billing, payment aging on an
// INVOICE-ANCHORED due date, 30/60/90 cash forecast, monthly intake cohorts,
// and the drill-through rows behind every card.
//
// Design rules (all load-bearing):
//   * SPLIT SLICES, summed once. In Cadence a split parent keeps only its own
//     slice — `parent_id IS NULL` DROPS the children's money (reports.js
//     learned this the hard way). Every query here joins each live slice to
//     its family root; the root supplies status/dates/payee, the slice
//     supplies amount/artist/category.
//   * ONE slice pull feeds every section AND the drill rows, so a drill total
//     ties to its card by construction, not by parallel window logic.
//   * USD via rowUsd2 (locked fx_rate_to_usd always wins, live-by-date
//     fallback, rounded AT THE ROW) — never the boom 1:1 fallback.
//   * Due dates are invoice-anchored: invoice_date + payment_terms ("Net N" /
//     "Due on receipt", default 30). scheduled_payment_date is submission-
//     anchored and hides genuinely-overdue invoices (boom's aging rationale).
//   * Bank-statement-born rows are real spend (counted in paid/unpaid/aging)
//     but are excluded from the "received" intake series and the forecast's
//     projected rate — a statement upload books weeks of rows at one
//     created_at and would spike any intake-based trend.
//   * Windows anchor to the SERVER's calendar date (multi-tenant — no LA
//     pinning like boom). Deltas are day-matched: MTD compares against the
//     same day-of-month last month, never a partial vs a full window.

const pool = require('../db');
const { rowUsd2 } = require('./usd');
const { artistBucketKey } = require('./artistKey');
const { BANK_SOURCE } = require('./ledgerSource');

// ── Date helpers (all on 'YYYY-MM-DD' strings, arithmetic in UTC) ───────────
const pad = (n) => String(n).padStart(2, '0');
const fmtD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseD = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return fmtD(d); };
const mondayOf = (s) => { const d = parseD(s); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day)); return fmtD(d); };
const daysDiff = (a, b) => Math.round((parseD(a) - parseD(b)) / 86400000); // a - b in days
const monthKeyOf = (s) => String(s || '').slice(0, 7);
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
// Same day-of-month N months back, clamped to the target month's last valid
// day (Mar 31 → Feb 28/29) so KPI deltas never compare partial vs full.
const dayMatchedBack = (s, monthsBack) => {
  const d = parseD(s);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m - monthsBack + 1, 0)).getUTCDate();
  return fmtD(new Date(Date.UTC(y, m - monthsBack, Math.min(day, last))));
};
const monthsBetween = (from, to, cap = 36) => {
  const out = [];
  let [y, m] = monthKeyOf(from).split('-').map(Number);
  const [ey, em] = monthKeyOf(to).split('-').map(Number);
  while ((y < ey || (y === ey && m <= em)) && out.length < cap) {
    out.push(`${y}-${pad(m)}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

function windowsFor(today) {
  const wkStart = mondayOf(today);
  const lastMtdEnd = dayMatchedBack(today, 1);
  return {
    this_week: [wkStart, today],
    // Day-matched: Mon→(today−7) mirrors the partial Mon→today window.
    last_week: [addDays(wkStart, -7), addDays(today, -7)],
    mtd: [`${today.slice(0, 8)}01`, today],
    last_mtd: [`${lastMtdEnd.slice(0, 8)}01`, lastMtdEnd],
    ytd: [`${today.slice(0, 4)}-01-01`, today],
    last_ytd: [`${Number(today.slice(0, 4)) - 1}-01-01`, dayMatchedBack(today, 12)],
  };
}
const inWin = (d, [from, to]) => !!d && d >= from && d <= to;

// ── Filters (the cross-page artist / category / rep scope) ──────────────────
const normFilters = (q = {}) => ({
  artist: String(q.artist || '').trim().slice(0, 120),
  category: String(q.category || '').trim().slice(0, 120),
  rep: String(q.rep || '').trim().slice(0, 120),
});

// Invoice-anchored due date, computed on the family ROOT. DATE + int = DATE.
const DUE_SQL = `(COALESCE(r.invoice_date, r.created_at::date) +
  (CASE WHEN r.payment_terms ~* '^due\\s*on\\s*receipt' THEN 0
        WHEN r.payment_terms ~* '^net\\s*\\d+' THEN (substring(r.payment_terms from '\\d+'))::int
        ELSE 30 END))`;

// ── The one slice pull ───────────────────────────────────────────────────────
// Every live slice of every approved family: unpaid families always (aging /
// pipeline are all-time), paid ones back to `lowerBound` (cheapest superset of
// every window the caller needs). Dates come back as strings via to_char so
// node-postgres timezone parsing can't shift a bucket.
async function fetchSlices(labelId, filters, lowerBound) {
  const params = [labelId, lowerBound];
  let filterSql = '';
  if (filters.artist) { params.push(filters.artist); filterSql += ` AND LOWER(TRIM(COALESCE(NULLIF(TRIM(e.artist),''), r.artist, ''))) = LOWER(TRIM($${params.length}))`; }
  if (filters.category) { params.push(filters.category); filterSql += ` AND LOWER(TRIM(COALESCE(NULLIF(TRIM(e.category),''), r.category, ''))) = LOWER(TRIM($${params.length}))`; }
  if (filters.rep) { params.push(filters.rep); filterSql += ` AND TRIM(COALESCE(NULLIF(TRIM(e.rep),''), r.rep, '')) = TRIM($${params.length})`; }
  const { rows } = await pool.query(
    `SELECT e.id, e.parent_id, r.id AS root_id,
            e.amount, COALESCE(e.currency, r.currency, 'USD') AS currency,
            COALESCE(e.fx_rate_to_usd, r.fx_rate_to_usd) AS fx_rate_to_usd,
            COALESCE(NULLIF(TRIM(e.artist), ''), r.artist) AS artist,
            COALESCE(NULLIF(TRIM(e.category), ''), r.category) AS category,
            COALESCE(NULLIF(TRIM(e.rep), ''), r.rep) AS rep,
            COALESCE(NULLIF(TRIM(e.song), ''), r.song) AS song,
            r.payee, r.invoice_number, r.payment_status, r.entry_source,
            to_char(r.payment_date, 'YYYY-MM-DD') AS paid_on,
            to_char(COALESCE(r.invoice_date, r.created_at::date), 'YYYY-MM-DD') AS invoiced_on,
            to_char(r.created_at::date, 'YYYY-MM-DD') AS received_on,
            to_char(${DUE_SQL}, 'YYYY-MM-DD') AS due_on
       FROM expenses e
       JOIN expenses r ON r.id = COALESCE(e.parent_id, e.id)
      WHERE e.label_id = $1 AND r.label_id = $1
        AND r.parent_id IS NULL AND r.status = 'approved'
        AND (r.deleted IS NULL OR r.deleted = FALSE) AND (r.voided IS NULL OR r.voided = FALSE)
        AND (e.deleted IS NULL OR e.deleted = FALSE) AND (e.voided IS NULL OR e.voided = FALSE)
        AND (r.payment_status IS DISTINCT FROM 'Paid'
             OR r.payment_date IS NULL OR r.payment_date >= $2::date OR r.created_at >= $2::date)
        ${filterSql}`,
    params
  );
  for (const s of rows) {
    s.usd = await rowUsd2({ amount: s.amount, currency: s.currency, fx_rate_to_usd: s.fx_rate_to_usd, payment_date: s.paid_on, invoice_date: s.invoiced_on });
    s.paid = s.payment_status === 'Paid';
    // Commitment date — payment date when paid, invoice date otherwise. The
    // same COALESCE basis the page's range scoping and /summary use.
    s.cd = (s.paid && s.paid_on) || s.invoiced_on;
  }
  return rows;
}

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// ── The exec payload ─────────────────────────────────────────────────────────
async function computeExec(labelId, { from = null, to = null, filters = {} } = {}) {
  const today = todayStr();
  const win = windowsFor(today);
  const rangeFrom = isDay(from) ? from : addDays(today, -182); // default trailing 6 months
  const rangeTo = isDay(to) ? to : today;

  // Weekly chart anchors — snap to whole Mondays, cap at 104 weeks.
  let chartStart = mondayOf(rangeFrom);
  const chartEnd = mondayOf(rangeTo);
  const weekKeys = [];
  for (let w = chartStart; w <= chartEnd; w = addDays(w, 7)) weekKeys.push(w);
  while (weekKeys.length > 104) weekKeys.shift();
  chartStart = weekKeys[0] || chartStart;

  // Monthly intake cohorts across the range (min 1, cap 36 months).
  const monthKeys = monthsBetween(rangeFrom, rangeTo);

  // Lower bound of the pull = the oldest date any section needs.
  const lb = [win.last_ytd[0], chartStart, `${monthKeys[0] || monthKeyOf(rangeFrom)}-01`, rangeFrom]
    .reduce((a, b) => (a < b ? a : b));
  const slices = await fetchSlices(labelId, normFilters(filters), lb);

  const kpi = { this_week: 0, last_week: 0, mtd: 0, last_mtd: 0, ytd: 0, last_ytd: 0, unpaid_total: 0, unpaid_count: 0 };
  const unpaidRoots = new Set();
  const weeks = Object.fromEntries(weekKeys.map((w) => [w, { week_start: w, week_end: addDays(w, 6), paid_usd: 0, unpaid_usd: 0, received_usd: 0, _roots: new Set() }]));
  const AGING_KEYS = ['0-30', '30-60', '60-90', '90+'];
  const aging = Object.fromEntries([...AGING_KEYS, 'not_yet_due'].map((k) => [k, { count: 0, usd: 0, _roots: new Set() }]));
  const upcoming = { in_7: { usd: 0, _roots: new Set() }, in_30: { usd: 0, _roots: new Set() }, in_60: { usd: 0, _roots: new Set() } };
  const committed = { 30: 0, 60: 0, 90: 0 };
  let intake28 = 0;
  const monthsMap = Object.fromEntries(monthKeys.map((m) => [m, { month: m, paid_usd: 0, unpaid_usd: 0, received_usd: 0, _roots: new Set() }]));
  const dims = { artist: new Map(), song: new Map(), category: new Map() };
  const reps = new Map();
  const trend = new Map(); // month -> { category -> usd }
  const trendTotals = new Map();

  const bump = (map, key, label, s) => {
    if (!map.has(key)) map.set(key, { label, paid_usd: 0, unpaid_usd: 0, _roots: new Set() });
    const b = map.get(key);
    if (s.paid) b.paid_usd += s.usd; else b.unpaid_usd += s.usd;
    b._roots.add(s.root_id);
  };

  for (const s of slices) {
    if (s.paid && s.paid_on) {
      for (const k of ['this_week', 'last_week', 'mtd', 'last_mtd', 'ytd', 'last_ytd']) {
        if (inWin(s.paid_on, win[k])) kpi[k] += s.usd;
      }
      const wk = mondayOf(s.paid_on);
      if (weeks[wk]) weeks[wk].paid_usd += s.usd;
    } else if (!s.paid) {
      kpi.unpaid_total += s.usd;
      unpaidRoots.add(s.root_id);
      const wk = mondayOf(s.invoiced_on);
      if (weeks[wk]) weeks[wk].unpaid_usd += s.usd;
      // Aging / upcoming / committed — all off the invoice-anchored due date.
      const overdue = daysDiff(today, s.due_on);
      if (overdue >= 1) {
        const b = overdue <= 30 ? '0-30' : overdue <= 60 ? '30-60' : overdue <= 90 ? '60-90' : '90+';
        aging[b].usd += s.usd; aging[b]._roots.add(s.root_id);
      } else {
        aging.not_yet_due.usd += s.usd; aging.not_yet_due._roots.add(s.root_id);
        const until = -overdue;
        if (until <= 7) { upcoming.in_7.usd += s.usd; upcoming.in_7._roots.add(s.root_id); }
        if (until <= 30) { upcoming.in_30.usd += s.usd; upcoming.in_30._roots.add(s.root_id); }
        if (until <= 60) { upcoming.in_60.usd += s.usd; upcoming.in_60._roots.add(s.root_id); }
      }
      // Committed includes already-overdue — it's cash you owe in the window.
      for (const n of [30, 60, 90]) if (s.due_on <= addDays(today, n)) committed[n] += s.usd;
    }

    // Intake ("received") — excludes bank-born rows; see header comment.
    if (s.entry_source !== BANK_SOURCE) {
      const wk = mondayOf(s.received_on);
      if (weeks[wk]) { weeks[wk].received_usd += s.usd; weeks[wk]._roots.add(s.root_id); }
      if (s.received_on >= addDays(today, -27) && s.received_on <= today) intake28 += s.usd;
    }

    // Monthly intake cohort — complete (bank rows included: the cohort is
    // "entered the books this month"), so paid + unpaid = received by
    // construction on every row.
    const mk = monthKeyOf(s.received_on);
    if (monthsMap[mk]) {
      const m = monthsMap[mk];
      m.received_usd += s.usd; m._roots.add(s.root_id);
      if (s.paid) m.paid_usd += s.usd; else m.unpaid_usd += s.usd;
    }

    // Range-scoped breakdowns + category trend (commitment-dated).
    if (s.cd >= rangeFrom && s.cd <= rangeTo) {
      const aKey = artistBucketKey(s.artist);
      bump(dims.artist, aKey, aKey ? String(s.artist).trim() : 'Unassigned', s);
      const songName = String(s.song || '').trim();
      bump(dims.song, songName.toLowerCase() || '', songName || 'Unassigned', s);
      const catName = String(s.category || '').trim() || 'Uncategorized';
      bump(dims.category, catName.toLowerCase(), catName, s);
      bump(reps, String(s.rep || '').trim().toLowerCase(), String(s.rep || '').trim() || 'Not assigned', s);
      const tm = monthKeyOf(s.cd);
      if (!trend.has(tm)) trend.set(tm, {});
      trend.get(tm)[catName] = (trend.get(tm)[catName] || 0) + s.usd;
      trendTotals.set(catName, (trendTotals.get(catName) || 0) + s.usd);
    }
  }
  kpi.unpaid_count = unpaidRoots.size;
  for (const k of Object.keys(kpi)) kpi[k] = typeof kpi[k] === 'number' ? round2(kpi[k]) : kpi[k];

  const finishDim = (map, limit = 10) =>
    Array.from(map.values())
      .map((b) => ({ label: b.label, paid_usd: round2(b.paid_usd), unpaid_usd: round2(b.unpaid_usd), total_usd: round2(b.paid_usd + b.unpaid_usd), row_count: b._roots.size }))
      .sort((a, b) => b.total_usd - a.total_usd)
      .slice(0, limit);

  // Category trend: top-8 bands + "Other".
  const topCats = Array.from(trendTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  const topSet = new Set(topCats);
  const trendMonths = monthsBetween(rangeFrom, rangeTo).map((month) => {
    const cats = trend.get(month) || {};
    const row = { month };
    for (const c of topCats) row[c] = round2(cats[c] || 0);
    let other = 0;
    for (const [c, v] of Object.entries(cats)) if (!topSet.has(c)) other += v;
    if (other > 0) row.Other = round2(other);
    return row;
  });
  const hasOther = trendMonths.some((r) => r.Other);

  return {
    today,
    kpi,
    weeks: weekKeys.map((w) => {
      const b = weeks[w];
      return { week_start: b.week_start, week_end: b.week_end, paid_usd: round2(b.paid_usd), unpaid_usd: round2(b.unpaid_usd), received_usd: round2(b.received_usd), received_count: b._roots.size };
    }),
    aging: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, { count: v._roots.size, usd: round2(v.usd) }])),
    upcoming: Object.fromEntries(Object.entries(upcoming).map(([k, v]) => [k, { count: v._roots.size, usd: round2(v.usd) }])),
    forecast: {
      weekly_avg_usd: round2(intake28 / 4),
      in_30: { committed: round2(committed[30]), projected: round2((intake28 / 4) * (30 / 7)) },
      in_60: { committed: round2(committed[60]), projected: round2((intake28 / 4) * (60 / 7)) },
      in_90: { committed: round2(committed[90]), projected: round2((intake28 / 4) * (90 / 7)) },
    },
    monthly: monthKeys.map((m) => {
      const b = monthsMap[m];
      return { month: m, paid_usd: round2(b.paid_usd), unpaid_usd: round2(b.unpaid_usd), received_usd: round2(b.received_usd), received_count: b._roots.size };
    }),
    breakdowns: { artist: finishDim(dims.artist), song: finishDim(dims.song), category: finishDim(dims.category) },
    reps: finishDim(reps, 15),
    category_trend: { months: trendMonths, categories: topCats.concat(hasOther ? ['Other'] : []) },
    range: { from: rangeFrom, to: rangeTo },
    filters: { applied: !!(filters.artist || filters.category || filters.rep), ...normFilters(filters) },
  };
}

// ── Drill rows ───────────────────────────────────────────────────────────────
// Same slice pull + same window predicates as computeExec, so the modal's
// footer ties to the card it was opened from. Buckets: KPI windows, unpaid
// pipeline, aging_*, upcoming_*, and month_YYYY-MM (the monthly cohort rows).
const KPI_BUCKETS = new Set(['this_week', 'last_week', 'mtd', 'last_mtd', 'ytd', 'last_ytd']);
const STATIC_BUCKETS = new Set([...KPI_BUCKETS, 'unpaid', 'aging_0_30', 'aging_30_60', 'aging_60_90', 'aging_90_plus', 'upcoming_7', 'upcoming_30', 'upcoming_60']);
const isMonthBucket = (b) => /^month_\d{4}-\d{2}$/.test(String(b || ''));
const isKnownBucket = (b) => STATIC_BUCKETS.has(b) || isMonthBucket(b);

async function rowsForBucket(labelId, bucket, { filters = {} } = {}) {
  const today = todayStr();
  const win = windowsFor(today);
  let lb = today;
  if (KPI_BUCKETS.has(bucket)) lb = win[bucket][0];
  else if (isMonthBucket(bucket)) lb = `${bucket.slice(6)}-01`;
  // unpaid / aging / upcoming: every unpaid row is pulled regardless of lb.
  const slices = await fetchSlices(labelId, normFilters(filters), lb);

  let keep, dateOf, sort;
  if (KPI_BUCKETS.has(bucket)) {
    keep = (s) => s.paid && inWin(s.paid_on, win[bucket]);
    dateOf = (s) => s.paid_on;
    sort = (a, b) => b.usd - a.usd;
  } else if (bucket === 'unpaid') {
    keep = (s) => !s.paid;
    dateOf = (s) => s.invoiced_on;
    sort = (a, b) => b.usd - a.usd;
  } else if (bucket.startsWith('aging_')) {
    const [min, max] = { aging_0_30: [1, 30], aging_30_60: [31, 60], aging_60_90: [61, 90], aging_90_plus: [91, Infinity] }[bucket];
    keep = (s) => { if (s.paid) return false; const od = daysDiff(today, s.due_on); return od >= min && od <= max; };
    dateOf = (s) => s.due_on;
    sort = (a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : b.usd - a.usd);
  } else if (bucket.startsWith('upcoming_')) {
    const days = { upcoming_7: 7, upcoming_30: 30, upcoming_60: 60 }[bucket];
    const cap = addDays(today, days);
    keep = (s) => !s.paid && s.due_on >= today && s.due_on <= cap;
    dateOf = (s) => s.due_on;
    sort = (a, b) => (a.due_on < b.due_on ? -1 : a.due_on > b.due_on ? 1 : b.usd - a.usd);
  } else if (isMonthBucket(bucket)) {
    const m = bucket.slice(6);
    keep = (s) => monthKeyOf(s.received_on) === m;
    dateOf = (s) => s.received_on;
    sort = (a, b) => b.usd - a.usd;
  } else {
    throw Object.assign(new Error('unknown bucket'), { status: 400 });
  }

  const matched = slices.filter(keep);
  const rows = matched
    .map((s) => ({
      expense_id: s.id,
      root_id: s.root_id,
      split_of: s.parent_id ? s.root_id : null,
      date: dateOf(s),
      due_on: s.due_on,
      days_overdue: s.paid ? null : daysDiff(today, s.due_on),
      days_until_due: s.paid ? null : -daysDiff(today, s.due_on),
      payee: s.payee, artist: s.artist, song: s.song, category: s.category,
      invoice_number: s.invoice_number,
      amount: Number(s.amount) || 0, currency: s.currency, usd: s.usd,
      payment_status: s.payment_status || 'Unpaid',
    }))
    .sort(sort);
  const total = round2(rows.reduce((sum, r) => sum + r.usd, 0));
  const capped = rows.slice(0, 200);
  return {
    bucket,
    from: KPI_BUCKETS.has(bucket) ? win[bucket][0] : null,
    to: KPI_BUCKETS.has(bucket) ? win[bucket][1] : null,
    rows: capped,
    total_usd: total,
    row_count: rows.length,
    truncated: rows.length > capped.length ? rows.length : null,
  };
}

// ── Excel export — built from the SAME payload the page renders ──────────────
async function execWorkbook(data) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const MONEY_FMT = '"$"#,##0.00;[Red]("$"#,##0.00)';
  const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  const styleHeader = (row) => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.eachCell((c) => { c.fill = HEADER_FILL; }); };
  const moneyCells = (row, fromCol) => { row.eachCell((c, i) => { if (i >= fromCol) c.numFmt = MONEY_FMT; }); };
  const note = (ws, text) => { const r = ws.addRow([text]); r.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 }; };
  const widths = (ws, list) => list.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  const scope = [data.filters.artist && `artist=${data.filters.artist}`, data.filters.category && `category=${data.filters.category}`, data.filters.rep && `rep=${data.filters.rep}`].filter(Boolean).join(' · ');

  // Overview — KPIs, pipeline, aging, upcoming, forecast.
  const ov = wb.addWorksheet('Overview');
  widths(ov, [34, 16, 16, 12]);
  ov.addRow([`Financials — executive view · ${data.range.from} → ${data.range.to}${scope ? ` · ${scope}` : ''}`]).font = { bold: true, size: 13 };
  note(ov, 'Commitment view: every approved invoice counts, paid or not. USD-equivalent (locked FX honored). Split slices summed once.');
  ov.addRow([]);
  styleHeader(ov.addRow(['Cash out (paid)', 'Current', 'Prior (day-matched)']));
  for (const [label, cur, prior] of [
    ['This week', data.kpi.this_week, data.kpi.last_week],
    ['Month-to-date', data.kpi.mtd, data.kpi.last_mtd],
    ['Year-to-date', data.kpi.ytd, data.kpi.last_ytd],
  ]) moneyCells(ov.addRow([label, cur, prior]), 2);
  moneyCells(ov.addRow(['Unpaid pipeline', data.kpi.unpaid_total, null]), 2);
  ov.addRow([`Unpaid invoices outstanding: ${data.kpi.unpaid_count}`]);
  ov.addRow([]);
  styleHeader(ov.addRow(['Payment aging (invoice-anchored due date)', 'USD', 'Invoices']));
  for (const k of ['0-30', '30-60', '60-90', '90+', 'not_yet_due']) moneyCells(ov.addRow([k === 'not_yet_due' ? 'Not yet due' : `${k} days past due`, data.aging[k].usd, data.aging[k].count]), 2);
  ov.addRow([]);
  styleHeader(ov.addRow(['Upcoming due', 'USD', 'Invoices']));
  for (const [k, label] of [['in_7', 'Next 7 days'], ['in_30', 'Next 30 days'], ['in_60', 'Next 60 days']]) moneyCells(ov.addRow([label, data.upcoming[k].usd, data.upcoming[k].count]), 2);
  ov.addRow([]);
  styleHeader(ov.addRow(['Cash forecast', 'Committed', 'Projected', 'Total']));
  for (const [k, label] of [['in_30', '30 days'], ['in_60', '60 days'], ['in_90', '90 days']]) {
    const f = data.forecast[k];
    moneyCells(ov.addRow([label, f.committed, f.projected, f.committed + f.projected]), 2);
  }
  note(ov, `Projected assumes new invoicing continues at the trailing 4-week rate (~$${data.forecast.weekly_avg_usd}/wk). Planning aid, not a promise.`);

  // Weekly.
  const wk = wb.addWorksheet('Weekly');
  widths(wk, [14, 14, 16, 16, 16, 12]);
  styleHeader(wk.addRow(['Week of', 'Week end', 'Cash out (paid)', 'Open billing', 'Received $', 'Received #']));
  for (const w of data.weeks) moneyCells(wk.addRow([w.week_start, w.week_end, w.paid_usd, w.unpaid_usd, w.received_usd, w.received_count]), 3);
  note(wk, 'Three date bases: paid by payment date, open billing by invoice date, received by submission date — do not sum across columns.');

  // Monthly.
  const mo = wb.addWorksheet('Monthly');
  widths(mo, [12, 16, 16, 16, 12]);
  styleHeader(mo.addRow(['Month', 'Received $', 'Now paid', 'Still open', 'Invoices']));
  for (const m of data.monthly) moneyCells(mo.addRow([m.month, m.received_usd, m.paid_usd, m.unpaid_usd, m.received_count]), 2);
  note(mo, 'Intake cohorts by the month a row entered the books; paid + open = received on every row by construction.');

  // Breakdowns + reps.
  for (const [key, title] of [['artist', 'Top artists'], ['song', 'Top songs'], ['category', 'Top categories']]) {
    const ws = wb.addWorksheet(title);
    widths(ws, [34, 16, 16, 16, 12]);
    styleHeader(ws.addRow([title.replace('Top ', '').replace(/s$/, ''), 'Paid', 'Unpaid', 'Total', 'Invoices']));
    for (const r of data.breakdowns[key]) moneyCells(ws.addRow([r.label, r.paid_usd, r.unpaid_usd, r.total_usd, r.row_count]), 2);
  }
  const rp = wb.addWorksheet('By rep');
  widths(rp, [28, 16, 16, 16, 12]);
  styleHeader(rp.addRow(['Rep', 'Paid', 'Unpaid', 'Total', 'Invoices']));
  for (const r of data.reps) moneyCells(rp.addRow([r.label, r.paid_usd, r.unpaid_usd, r.total_usd, r.row_count]), 2);

  // Category trend cross-tab.
  const tr = wb.addWorksheet('Category trend');
  const cats = data.category_trend.categories;
  widths(tr, [12, ...cats.map(() => 16)]);
  styleHeader(tr.addRow(['Month', ...cats]));
  for (const row of data.category_trend.months) moneyCells(tr.addRow([row.month, ...cats.map((c) => row[c] || 0)]), 2);

  return wb;
}

// ── One month, at a glance ───────────────────────────────────────────────────
// The month page is anchored on the SAME basis as the monthly rollup rows it
// is opened from — the intake cohort (`received_on` = the day the row entered
// the books). Anything else and the page total would contradict the number
// that was clicked, which is the whole reason the rollup drill exists.
//
// Boom's fourth stat card ("Received") is a separate anchor there; under the
// cohort recipe paid + unpaid = received by construction, so that card would
// restate the first one. It is replaced by CASH OUT — money whose payment_date
// falls in this calendar month, a genuinely different set (it includes older
// invoices paid now and excludes this month's invoices paid later). The page
// says so out loud; the two must never be summed.
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const shiftMonth = (ym, delta) => {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

const ARTIST_CAP = 250;   // table is client-searchable; a cap keeps the payload sane
const VENDOR_CAP = 15;
const INVOICE_CAP = 25;

// The aggregation, split out from the pull so the money rules are exercised by
// server/scripts/finance-fixtures.cjs without a database. Slices are the shape
// fetchSlices returns: { root_id, usd (already rounded at the row), paid,
// paid_on, received_on, artist, category, payee, invoice_number, payment_status }.
function foldMonth(slices, month) {
  assertMonth(month);
  const [y, m] = month.split('-').map(Number);
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayMap = new Map();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${pad(d)}`;
    dayMap.set(key, { day: key, paid_usd: 0, unpaid_usd: 0, received_usd: 0, _roots: new Set() });
  }

  const cur = { received_usd: 0, paid_usd: 0, unpaid_usd: 0, cash_out_usd: 0, _roots: new Set(), _cashRoots: new Set(), _artists: new Set(), _vendors: new Set() };
  const prior = { received_usd: 0, paid_usd: 0, unpaid_usd: 0, cash_out_usd: 0, _roots: new Set() };

  const artists = new Map();   // artistBucketKey -> { label, paid, unpaid, roots, cats }
  const cats = new Map();
  const vendors = new Map();
  const families = new Map();  // root_id -> invoice-level aggregate

  for (const s of slices) {
    // Cash out — payment-date basis, computed before the cohort filter below
    // because a row paid this month may have landed in any earlier month.
    if (s.paid && s.paid_on) {
      const pm = monthKeyOf(s.paid_on);
      if (pm === month) { cur.cash_out_usd += s.usd; cur._cashRoots.add(s.root_id); }
      else if (pm === prevMonth) prior.cash_out_usd += s.usd;
    }

    const mk = monthKeyOf(s.received_on);
    if (mk === prevMonth) {
      prior.received_usd += s.usd;
      if (s.paid) prior.paid_usd += s.usd; else prior.unpaid_usd += s.usd;
      prior._roots.add(s.root_id);
      continue;
    }
    if (mk !== month) continue;

    cur.received_usd += s.usd;
    if (s.paid) cur.paid_usd += s.usd; else cur.unpaid_usd += s.usd;
    cur._roots.add(s.root_id);

    const day = dayMap.get(s.received_on);
    if (day) {
      day.received_usd += s.usd;
      if (s.paid) day.paid_usd += s.usd; else day.unpaid_usd += s.usd;
      day._roots.add(s.root_id);
    }

    const catName = String(s.category || '').trim() || 'Uncategorized';

    // Per artist, with the category mix nested — one pull, no lazy second
    // endpoint, so the mix can never disagree with the row it expands from.
    const aKey = artistBucketKey(s.artist);
    if (aKey) cur._artists.add(aKey);
    const aId = aKey || '';
    if (!artists.has(aId)) {
      artists.set(aId, { key: aKey || null, label: aKey ? String(s.artist).trim() : 'Unassigned', paid_usd: 0, unpaid_usd: 0, _roots: new Set(), cats: new Map() });
    }
    const A = artists.get(aId);
    if (s.paid) A.paid_usd += s.usd; else A.unpaid_usd += s.usd;
    A._roots.add(s.root_id);
    if (!A.cats.has(catName)) A.cats.set(catName, { category: catName, paid_usd: 0, unpaid_usd: 0, _roots: new Set() });
    const AC = A.cats.get(catName);
    if (s.paid) AC.paid_usd += s.usd; else AC.unpaid_usd += s.usd;
    AC._roots.add(s.root_id);

    if (!cats.has(catName)) cats.set(catName, { label: catName, paid_usd: 0, unpaid_usd: 0, _roots: new Set() });
    const C = cats.get(catName);
    if (s.paid) C.paid_usd += s.usd; else C.unpaid_usd += s.usd;
    C._roots.add(s.root_id);

    const vName = String(s.payee || '').trim();
    const vKey = vName.toLowerCase();
    if (vName) cur._vendors.add(vKey);
    if (!vendors.has(vKey)) vendors.set(vKey, { label: vName || 'No vendor', paid_usd: 0, unpaid_usd: 0, _roots: new Set() });
    const V = vendors.get(vKey);
    if (s.paid) V.paid_usd += s.usd; else V.unpaid_usd += s.usd;
    V._roots.add(s.root_id);

    // Invoice level — slices of one family summed back to the billed invoice.
    if (!families.has(s.root_id)) {
      families.set(s.root_id, {
        root_id: s.root_id, payee: s.payee || null, invoice_number: s.invoice_number || null,
        date: s.received_on, payment_status: s.payment_status || 'Unpaid',
        usd: 0, _artists: new Set(), _cats: new Set(),
      });
    }
    const F = families.get(s.root_id);
    F.usd += s.usd;
    if (String(s.artist || '').trim()) F._artists.add(String(s.artist).trim());
    F._cats.add(catName);
  }

  const finish = (map, limit) => Array.from(map.values())
    .map((b) => ({ label: b.label, paid_usd: round2(b.paid_usd), unpaid_usd: round2(b.unpaid_usd), total_usd: round2(b.paid_usd + b.unpaid_usd), row_count: b._roots.size }))
    .sort((a, b) => b.total_usd - a.total_usd)
    .slice(0, limit == null ? undefined : limit);

  const artistRows = Array.from(artists.values())
    .map((a) => ({
      key: a.key, label: a.label,
      paid_usd: round2(a.paid_usd), unpaid_usd: round2(a.unpaid_usd),
      total_usd: round2(a.paid_usd + a.unpaid_usd), row_count: a._roots.size,
      categories: Array.from(a.cats.values())
        .map((c) => ({ category: c.category, paid_usd: round2(c.paid_usd), unpaid_usd: round2(c.unpaid_usd), total_usd: round2(c.paid_usd + c.unpaid_usd), row_count: c._roots.size }))
        .sort((x, z) => z.total_usd - x.total_usd),
    }))
    .sort((a, b) => b.total_usd - a.total_usd);

  const topInvoices = Array.from(families.values())
    .map((f) => ({
      root_id: f.root_id, payee: f.payee, invoice_number: f.invoice_number, date: f.date,
      payment_status: f.payment_status, usd: round2(f.usd),
      artist: f._artists.size === 1 ? Array.from(f._artists)[0] : (f._artists.size ? `${f._artists.size} artists` : null),
      category: f._cats.size === 1 ? Array.from(f._cats)[0] : (f._cats.size ? `${f._cats.size} categories` : null),
    }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, INVOICE_CAP);

  const invoiceCount = cur._roots.size;
  return {
    month, prev_month: prevMonth, next_month: nextMonth, today: todayStr(),
    summary: {
      received_usd: round2(cur.received_usd),
      paid_usd: round2(cur.paid_usd),
      unpaid_usd: round2(cur.unpaid_usd),
      cash_out_usd: round2(cur.cash_out_usd),
      invoice_count: invoiceCount,
      cash_out_count: cur._cashRoots.size,
      artist_count: cur._artists.size,
      vendor_count: cur._vendors.size,
      avg_invoice_usd: invoiceCount ? round2(cur.received_usd / invoiceCount) : 0,
    },
    prior: {
      month: prevMonth,
      received_usd: round2(prior.received_usd),
      paid_usd: round2(prior.paid_usd),
      unpaid_usd: round2(prior.unpaid_usd),
      cash_out_usd: round2(prior.cash_out_usd),
      invoice_count: prior._roots.size,
    },
    days: Array.from(dayMap.values()).map((d) => ({ day: d.day, paid_usd: round2(d.paid_usd), unpaid_usd: round2(d.unpaid_usd), received_usd: round2(d.received_usd), received_count: d._roots.size })),
    artists: artistRows.slice(0, ARTIST_CAP),
    artists_truncated: artistRows.length > ARTIST_CAP ? artistRows.length : null,
    categories: finish(cats, null),
    vendors: finish(vendors, VENDOR_CAP),
    vendor_total: vendors.size,
    top_invoices: topInvoices,
    top_invoices_of: families.size,
  };
}

function assertMonth(month) {
  if (!isMonth(month)) throw Object.assign(new Error('month must be YYYY-MM'), { status: 400 });
  const y = Number(String(month).slice(0, 4));
  if (y < 2000 || y > 2100) throw Object.assign(new Error('month out of range'), { status: 400 });
}

async function computeMonth(labelId, month, { filters = {} } = {}) {
  assertMonth(month);
  // The prior month's first day is the oldest date any card on the page needs.
  const slices = await fetchSlices(labelId, normFilters(filters), `${shiftMonth(month, -1)}-01`);
  return {
    ...foldMonth(slices, month),
    filters: { applied: !!(filters.artist || filters.category || filters.rep), ...normFilters(filters) },
  };
}

module.exports = {
  computeExec, computeMonth, foldMonth, rowsForBucket, execWorkbook, fetchSlices,
  normFilters, isKnownBucket, isDay, isMonth, shiftMonth, todayStr, monthsBetween, monthKeyOf,
};

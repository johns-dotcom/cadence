# missing--financials-month-drill — OLD's per-month Financials drill page

## 1. What it is

A **single-month "at a glance" exec subpage** of Financials: stat cards with
prior-month delta chips, a stacked daily-activity chart, a searchable/sortable
per-artist table with expandable category mixes, per-category shares, top
vendors, and the 25 biggest invoices of the month — with prev/next month-hop
navigation.

- Route: `/financials/month/:month` (`:month` = `YYYY-MM`) → the same
  `Financials` component, which branches on `useParams()`:
  `if (routeMonth) return <MonthDetailPage month={routeMonth} />`
  (OLD `client/src/App.jsx:189`, `Financials.jsx:1569-1571`).
- Entry points on the Financials landing: the "Biggest month" / "Smallest
  month" stat links and every bar of the monthly trend list link into the
  drill (`Financials.jsx:1063, 1072, 1110`).
- Permissions: whole financials router behind
  `authMiddleware, requirePagePermission('/financials')`
  (OLD `server/routes/financials.js:13`); route itself is Protected
  (`_audit/00-inventory.md:55` — "one component, two modes").

## 2. OLD anatomy

Client: `MonthDetailPage` in `client/src/pages/Financials.jsx:2039-2573` plus
helpers `MonthStatCard` (`:2006`), `MonthDelta` (`:2020`), `BackLink` (`:2575`).
Server: `GET /api/financials/month/:month` (`financials.js:2907-3129`) and the
reused `GET /financials/exec/subbreakdown` (`financials.js:1443-1527`).

### Client sections (top to bottom)

1. **Back link + month-hop header** — prev/next month `<Link>` pills carrying
   the destination month label as tooltip; H1 = "June 2026"-style label;
   subtitle "N invoices across A artists and V vendors"
   (`Financials.jsx:2183-2222`).
2. **Four stat cards with delta chips vs prior month** (`:2226-2261`): Total
   This Month, Paid (green, % + count), Unpaid (rose, inverted delta polarity
   — up is bad), Received (Intake) (sky — invoices *submitted* that month by
   `created_at`, distinct from the spend anchor). `MonthDelta` suppresses the
   chip when the prior month is $0 to avoid "+∞%" (`:2020`, comment `:2237`).
3. **Daily activity chart** — Recharts stacked bar, one bar per day of the
   month (paid emerald / unpaid rose), custom tooltip with paid/unpaid/total +
   invoice count; x-axis spans the whole month even for dead days
   (`:2265-2312`).
4. **By-artist table** (`:2315-2445`): search box (client-side filter),
   sortable columns via `SortHeader` (Artist / Paid / Unpaid / Total / Rows,
   default `total_usd desc`, `:2048, 2126-2152`); rank #, share bar (% of month
   total), artist name links to `/artist-campaigns/:artist`; footer text shows
   "n of m artists · avg invoice $x".
   **Expandable category-mix row per artist** (`:2053-2064, 2344-2445`):
   clicking a row lazily fetches
   `GET /financials/exec/subbreakdown?dimension=artist&value=<name>&from&to`
   scoped to the month's date bookends (`:2053-2069`), caches per artist,
   resets on month change (`:2065`); renders a stacked color strip + one row
   per category (share %, paid $, "+N owed", row count), folding categories
   under 1% share into a "+N more < 1% · click to show" expander
   (`CATEGORY_MIN_SHARE`, `:2051, 2358-2440`). Same palette/pattern as the
   landing's Top-spend section for visual consistency (`:2376-2381`).
5. **Two-column: By category + Top vendors** (`:2452-2496`): category share
   bars (% of categorized total) and a top-15 vendor list (rank, count, USD).
6. **Top invoices** (`:2499-2560`): largest 25 by USD-equivalent — Date /
   Vendor / Artist / Category / Amount / paid-status pill.
7. Footer caveat: "USD-equivalent throughout. Split children roll into their
   parent." (`:2563-2565`).
8. Loading skeleton + error states with back link (`:2097-2115`).

### Server endpoint — `GET /financials/month/:month` (`financials.js:2913-3129`)

- Validates `YYYY-MM` + sane year/month bounds, else 400 (`:2914-2923`).
- **Anchor date rule**: rows land in a month by
  `COALESCE(payment_date, invoice_date, created_at::date)` — "when did this
  land", same heuristic as the exec view (`:2925-2927, 2940-2946`).
- Base WHERE: `status='approved'`, not deleted, not voided,
  **`parent_id IS NULL`** (split children roll into parents) (`:2940-2947`).
- USD rule: `amount / COALESCE(NULLIF(fx_rate_to_usd,0),1)` on every sum
  (locked FX when present, native otherwise — `:2911-2912`).
- Nine parallel queries (`:2951-3080`): summary (total/paid/unpaid USD +
  counts + distinct artist/vendor counts); per-artist rollup grouped on
  `COALESCE(NULLIF(TRIM(LOWER(artist)),''),'unassigned')`; per-category
  (`'Uncategorized'` fallback); top-15 vendors; top-25 invoices by USD;
  **received/intake** — same filters but anchored on `created_at` shifted to
  `America/Los_Angeles` (`:3013-3025`); prior-month summary + prior-month
  received (delta chips); **daily rollup via `generate_series`** LEFT JOIN so
  zero-activity days still emit rows (`:3055-3080`).
- Response includes `prev_month`/`next_month` + labels computed via JS Date so
  year rollovers need no special-casing (`:3087-3098`), and
  `avg_invoice_usd` (`:3110-3112`).

### Reused endpoint — `GET /financials/exec/subbreakdown` (`financials.js:1443-1527`)

`?dimension=artist|song&value=<name>&from=YYYY-MM-DD&to=YYYY-MM-DD` → per-
category `{ category, paid_usd, unpaid_usd, row_count }` slices for one artist
within the date bookends; the drill passes the month's first/last day
(`Financials.jsx:2043-2048` comment).

## 3. NEW status

**Confirmed absent as a page; partially overlapped by Reports drill-through.**
Verified: NEW `client/src/App.jsx:159` has only `/financials` (AdminRoute) —
no `/financials/month/:month`; repo grep for `financials/month|MonthDetail`
over `client/src` + `server/routes` returns nothing. NEW
`server/routes/financials.js` route list (summary/analytics/recoupments/
statements/planning/income…) has no month endpoint.

Partial overlap: NEW `/reports` P&L has per-cell drill-through
(`server/routes/reports.js:466-521` accepts `month`, `drillCategory` and
returns the underlying rows), so "what made up March × Marketing" is
answerable. What it does NOT give: a month-at-a-glance page — no prior-month
delta cards, no daily-activity shape, no per-artist table with in-place
category mixes, no top-vendors/top-25-invoices for one month, no month-hop
navigation, no intake ("received") framing. NEW Financials has trends/pie/
per-artist P&L over a range (CLAUDE.md M3), but its unit is the range, not a
navigable single month.

## 4. Port requirements

- **Schema**: none — read-only aggregation over `expenses`.
- **Server**: one endpoint `GET /financials/month/:month` in NEW
  `routes/financials.js`, label-scoped (`AND e.label_id = $n` on every query —
  OLD is single-tenant). **Use NEW's USD rule from `lib/usd.js`
  (`rowUsd`/locked-FX-always-wins)** rather than OLD's inline
  `amount / COALESCE(NULLIF(fx_rate_to_usd,0),1)` — OLD divides by the rate,
  NEW's convention multiplies/locks via `usd.js`; adopting OLD's SQL verbatim
  would contradict NEW's Reports math. Mind NEW's voided/deleted column
  equivalents and `parent_id IS NULL` family rule (NEW reports already warn
  "parent_id IS NULL filters DROP MONEY" for split-slice sums — this endpoint
  intentionally counts families-by-root, which is correct for its
  invoice-level framing but must not be fed from live split slices).
  The intake query's hardcoded `America/Los_Angeles` should become a
  label/user setting. A subbreakdown-equivalent per-artist×category slice may
  already be derivable from NEW `reports.js` `buildPnl`/drill internals —
  check before writing a new one.
- **Client**: new `MonthDetail` page (or mode on NEW `Financials.jsx`) +
  `/financials/month/:month` route behind `AdminRoute` like `/financials`.
  Reuse NEW primitives: Recharts already a dep, `ui/` kit, `Skeleton`,
  `formatDate`, `useCategories` names. Link into it from NEW Financials'
  monthly trend chart and from Reports' month column headers.

## 5. Defects

- [P2] Per-month drill page missing — no month-at-a-glance surface (delta-vs-prior stat cards, daily activity chart, per-artist table w/ expandable category mix, top vendors, top-25 invoices, month-hop nav); NEW Reports' cell drill answers narrower questions only — fix: new `/financials/month/:month` page + one aggregate endpoint (MED)

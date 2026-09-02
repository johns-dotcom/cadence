# Financials

OLD: `boom-dashboard/client/src/pages/Financials.jsx` (2,584 lines; overview mode `/financials` — this file covers ONLY that; the `/financials/month/:month` drill mode at OLD :2043-2573 is an **OLD orphan route with no NEW counterpart** and is tracked separately, see `_audit/00-inventory.md:179`) + `boom-dashboard/server/routes/financials.js` (3,130 lines).
NEW: `cadence/client/src/pages/Financials.jsx` (224 lines) + `cadence/server/routes/financials.js` (469 lines).

Design-system diffs are RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported. Scale note up front: OLD's overview is an 8-section executive dashboard fed by a ~740-line `/exec` endpoint with cross-page filters, drill-through rows, and a 14-sheet Excel export; NEW is a compact P&L overview (3 KPI cards, one 12-mo chart, pie, two lists, one table) — roughly a 10:1 feature reduction.

**Basis note (intentional frame):** OLD Financials is a *commitment view* — every approved invoice counts, paid or not, dated `COALESCE(payment_date, invoice_date)` — and says so in an on-page basis disclosure (OLD :1684-1701). NEW Financials also counts all approved rows (paid + unpaid) but never splits or labels paid vs unpaid anywhere. NEW's *cash-basis* reporting lives on `/reports` (built 2026-08-27); the ledger-mastered basis change itself is an intentional divergence — the missing user-facing capabilities below are not.

## 1. Layout & structure

**OLD** (`FinancialsLanding`, :1576-1861): PageHeader (title + subtitle "Executive spend view…") with a **RangePicker** (3m/6m/12m presets + Custom from/to date inputs, persisted to localStorage `financials_range_v2`, :46-125) and an **Export Excel** button (:1669-1679) → **basis disclosure row** ("Commitment view… Unpaid spend is included." + "Cash basis? See Reports →" link + `ReconciledBadge`, :1691-1701) → **4 KPI cards** (This Week / Month-to-Date / Year-to-Date / Unpaid Pipeline; each with %-delta chip vs a day-matched prior window, sub-line, per-card sparkline with a distinct shape, and click→drill modal, :1703-1782) → **cross-page FilterBar** (Artist / Category / Rep selects scoping every section incl. drills, :1788-1792) → **WeeklyChart** (:1795-1799) → **PaymentAgingSection** (aging buckets + upcoming due, :1802-1804) → **CashForecastSection** (:1809-1811) → **MonthlyRollup** (:1814-1820) → **BreakdownSection** "Top spend" (:1826-1834) → **RepLeaderboardSection** (:1837-1839) → **CategoryTrendSection** (:1844-1846) → footnote on USD-equivalence + split handling (:1848-1850) → `KpiDrillModal` (:1852-1858).

**NEW** (:77-222): `ReconciledBadge` row (:79) → PageHeader with Export (client CSV) + "Add income" buttons (:80-89) → 4 period chips (This month/quarter/year/All time, persisted `financials-period`, :91-95) → optional inline add-income form card (:97-106) → 3 KPI cards (Income / Expenses / Net, each with a $-delta vs last month, :109-125) → "Last 12 months" ComposedChart (:128-144) → 2-col grid: category pie + Top vendors list (:146-183) → 2-col grid: Per-artist P&L table + Recent income list (:185-221).

Structural deltas: range picker → fixed period chips (and the chips only scope `/summary`; the chart/vendors/P&L are hard-coded 12-month, NEW server :97,102); the entire filter bar, drill modal, weekly chart, aging, forecast, monthly rollup, breakdown expander, and rep leaderboard tiers are absent; NEW adds an income-entry workflow OLD's page never surfaced (OLD had income POST/DELETE endpoints at server :603-637 but no UI on this page).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Money format | `fmtUsd` 0-decimals + `fmtCompact` $1.2M/$45K in dense spots | `money()` always 2 decimals, no compact form | OLD :16-27 / NEW :20 |
| KPI cards | `text-2xl font-bold` value + %-delta chip + sparkline AreaChart (34px) with gradient fill; clickable (hover border/shadow) | `text-xl font-bold` value + $-delta text; static | OLD :139-177 / NEW :110-124 |
| Period control | segmented `bg-gray-100 rounded-xl p-1` pill group + custom date inputs | flat chip buttons, active = `bg-gray-900 text-white` | OLD :80-122 / NEW :92-94 |
| Chart | weekly ComposedChart 320px: CartesianGrid, grouped bars, 2 lines, ReferenceLine w/ label, custom rich tooltip, external legend row, biggest-week callout | monthly ComposedChart 260px: no grid, no legend, default tooltip | OLD :298-390 / NEW :131-142 |
| Section subtitles | every card carries a `text-[11px]` basis/method subtitle (e.g. "different date bases, don't sum them") | headings only, no basis annotations | OLD :275-277,:746-748 / NEW :129,:149 |
| ReconciledBadge | inline at right of basis row (`ml-auto`) | own row above PageHeader | OLD :1700 / NEW :79 |
| Delta semantics | ↑/↓ + percentage vs day-matched prior | ArrowUp/Down + absolute $ "vs last mo" | OLD :128-137 / NEW :69-74 |

## 3. Copy & content differences

- OLD subtitle: "Executive spend view — paid, unpaid, and intake across every artist / song / category." NEW: "Income, expenses and profit for this workspace" (OLD :1665 / NEW :82) — accurately reflects the narrower scope.
- OLD basis disclosure paragraph + cross-link "Cash basis? See Reports →" (:1691-1699) has no NEW equivalent; NEW users get no statement that unpaid spend is included in "Expenses".
- OLD footnote "USD-equivalent throughout. Split children roll into their parent so a co-brand invoice split N ways doesn't multi-count." (:1848-1850) — no NEW equivalent (NEW excludes children via `parent_id IS NULL`, matching the note's intent but silently).
- OLD KPI sub-lines explain their comparison windows ("vs $X same-day last month", "no prior-year data to compare against", :1746,:1758-1760); NEW's delta says only "vs last mo".

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW

1. **Range picker with custom dates** — 3m/6m/12m presets + arbitrary from/to, persisted, driving `/exec?from&to` and the monthly rollup depth (OLD :46-125, :1629-1643; server :790-791). NEW: 4 fixed period keywords that scope only `/summary` (NEW client :12-17; server :19-26); analytics/vendors/P&L are locked to trailing 12 months (NEW server :97,102).
2. **Cross-page scope FilterBar (artist / category / rep)** + `GET /financials/filter-options` — threads `applyFilters()` through every one of ~12 queries in `/exec`, the sub-breakdown, and the drill rows, so the whole dashboard zooms to one artist/category/rep (OLD client :1441-1496; server :671-691, :1406-1440). NEW has no filtering of any kind.
3. **KPI drill-through modals** + `GET /exec/rows?bucket=` — 14 buckets (this_week/last_week/mtd/last_mtd/ytd/last_ytd/unpaid, aging_0_30…90_plus, upcoming_7/30/60), 200-row capped invoice tables with days-overdue / due-in columns, status pills, total footer guaranteed to match the card (OLD client :1863-2002; server :1535-1732). NEW KPI cards, pie slices, vendor rows and P&L rows are all non-interactive (only artist-name links to profiles, NEW :195).
4. **Weekly spend & intake ComposedChart** — Monday-anchored weekly buckets from `generate_series`, grouped paid (payment_date) vs open-billing (invoice_date) bars, received-$ line (created_at), trailing-4-week MA line, average ReferenceLine, tri-basis custom tooltip with an explicit "don't sum the bars" caveat, totals strip, biggest-week callout (OLD client :185-393; server :793-874). NEW's only chart is monthly income/expenses/net (NEW :128-144) — no weekly granularity, no paid/unpaid split, no intake series, no MA.
5. **Paid vs unpaid split — lost everywhere.** OLD splits every panel (KPI unpaid pipeline, weekly bars, breakdown rows "+$X owed", monthly rollup columns, rep bars, vendor stacks). NEW's expense figures silently blend paid + unpaid with no visual or numeric distinction anywhere on the page (NEW server :43-44 has no payment_status predicate).
6. **Top-spend breakdown with dimension toggle + expandable sub-breakdowns** — By Artist / By Song / By Category segmented switcher; top-10 share-scaled bars with unpaid overlay, rank, %, row counts; artist/song rows expand to a lazy-fetched (`GET /exec/subbreakdown`) category mix rendered as a stacked strip with inline % labels plus a numeric list where <1% categories fold into "+N more · click to show" (OLD client :396-718; server :1442-1527). NEW's nearest analogue is a static Top-vendors name/total list (NEW :169-182) and the per-artist table — no songs dimension at all, no sub-breakdowns, no unpaid, no counts, no share bars.
7. **Payment aging + upcoming due** — 0-30/30-60/60-90/90+ buckets against an *invoice-anchored due date* parsed from `payment_terms` ("Net N" / "Due on receipt", default 30), each bucket a clickable drill; "Nothing past due" green state; upcoming 7/30/60-day cash-call windows, also drillable (OLD client :720-819; server :941-1031). Absent in NEW.
8. **Cash forecast (30/60/90d)** — committed (due in window) + projected (trailing 4-week intake rate × window), mix bars, planning-aid caveat (OLD client :1498-1564; server :1283-1337). Absent in NEW.
9. **Monthly rollup table → month drill** — per-month rows (chronological delta computation, display re-sort by any of 6 sortable columns), paid/unpaid split bar, received column with count chip, "vs prior" delta, dual Difference readings (Received−Approved and Received−Paid, each with explanatory tooltips + a legend paragraph), Peak badge on biggest month, 6-tile summary strip (total paid/unpaid/received, avg/month split received+paid, biggest/smallest month), every row and callout linking to `/financials/month/:month` (OLD client :892-1178; server `/monthly-by-artist` :455-562 incl. the aligned created_at-cohort recipe making Paid+Unpaid=Received by construction). Absent in NEW — and the month drill route itself does not exist in NEW (see scope pointer above).
10. **Spend-by-rep leaderboard** — stacked paid/unpaid bars per `boom_rep`, "Not assigned" highlighted rose as an accountability gap (OLD client :1386-1433; server :1262-1281). Absent in NEW (NEW's `expenses` schema does carry no rep? — `user_visible_reps` exists in NEW per CLAUDE.md, so rep data plausibly exists; RESOLVED 2026-09-02 (Phase 10) — the rep data exists. `expenses` carries a `rep` column and it is populated (sample row: `rep: 'Recovered Admin'`), so the spend-by-rep leaderboard is portable as-is; nothing blocks it whether NEW has a boom_rep-equivalent column populated).
11. **Category composition trend** — stacked AreaChart of monthly category mix, top-8 + "Other" rollup, fixed palette, legend (OLD client :821-889; server :1033-1080). NEW has only a point-in-time category pie for the selected period (NEW :147-167).
12. **Excel export** — OLD `GET /financials/export` builds a styled multi-sheet board packet (sheets at server :2318-2840: Cover, Overview, Cash Forecast, Aging & Upcoming, Weekly, By Vendor, per-dimension Top sheets, By Rep, Payment Velocity, Payment Methods, Recoupment, Monthly, Category Trend, Full Ledger) honoring range + scope filters, with branded headers/banding/total rows (:1734-1837 helpers). NEW's Export is a 3-section client-side CSV (Category/Vendor/Artist-net rows only, NEW client :60-67) — no server export endpoint exists.
13. **Vendor Pareto / payment-velocity histogram / method-mix donut** — nuance: the OLD components exist (`VendorConcentrationSection` :1185-1254, `PaymentVelocitySection` :1259-1311, `PaymentMethodMixSection` :1315-1384) and `/exec` computes their data (server :1135-1260) **but none of the three is mounted anywhere in OLD's JSX** (grep: zero `<VendorConcentrationSection` etc. usages) — the data surfaces only in the export sheets (By Vendor / Payment Velocity / Payment Methods). So NEW is *not* missing on-screen panels here; it is missing the underlying data series + export sheets (folded into defects 12/16).
14. **Basis disclosure row** (OLD :1684-1701) — absent in NEW.
15. **KPI comparison correctness** — OLD compares day-matched windows (Mon→today vs Mon→today−7; MTD vs same-day last month; YTD vs same-period last year, leap-safe `dayMatchedBack`, server :693-738) so delta chips never compare a partial window against a full one. NEW's deltas compare the current *partial* month against the *full* previous month (NEW server :135-137) — the "vs last mo" numbers are structurally misleading for income/expenses/net most of the month.
16. **Recoupment scoreboard data** — `/exec` computes a per-artist recoupment table (spend vs income, % recouped; server :1082-1133, income join documented as deliberately crediting 0) used by the export's Recoupment sheet. NEW covers recoupments on its own `/recoupments` page (different, richer model) — no gap on this page beyond the export sheet.

### Features in NEW not in OLD (this page)

- **Income tracking UI**: Add-income form (source/amount/currency/artist/date), recent-income list with hover delete, income KPI + income bars in the chart, per-artist income + net columns (NEW client :45-58, :97-106, :206-220; server :416-467). OLD's page is spend-only (its income endpoints existed but had no UI here). NEW-side addition, not a defect.
- **Per-artist P&L table** (spend/income/net with artist-profile links, NEW :187-204) — OLD has per-artist *spend* only.
- **FX correctness**: NEW converts per-row via `rowUsd` — locked `fx_rate_to_usd` first, then live/historical rate by date (NEW server :6-11, the 2026-08-27 eUsd sweep); income via `toUSD` by date. OLD divides by `COALESCE(NULLIF(fx_rate_to_usd,0),1)` — i.e. **1:1 native fallback** when no locked rate, an accepted approximation stated in a comment (OLD server :651-653) and a currency-blind `SUM(amount)` in `/summary` (:464-467 TODO note). NEW is strictly more correct; totals will legitimately differ from OLD for unlocked foreign-currency rows. Improvement, not a defect.
- **Voided-row exclusion in `/summary`-equivalent**: both exclude voided in the main paths; OLD's legacy `/summary` (:353-453) doesn't (but nothing in OLD's UI calls it — mock-only, `client/src/mock/mockApi.js:1151`).

### Interaction/UX differences

- OLD persists the full range object incl. custom dates (:51-63); NEW persists only the period key (:21,:25,:36).
- OLD KPI loading = 4 pulse cards, error = explicit "Failed to load financial summary." card (:1706-1707,:1777-1781). NEW swallows every fetch error (`.catch(() => {})`, NEW :34-42) and renders `$0.00` KPIs — a failed load is indistinguishable from an empty workspace; only the chart has a skeleton (:130).
- OLD delete flows: none on page. NEW income delete uses `window.confirm` (:56) instead of `ui/ConfirmDialog` (available per design-system inventory).

## 5. Data layer differences

| Concern | OLD | NEW |
|---|---|---|
| Route gate | `requirePagePermission('/financials')` on every endpoint (server :5-13) | `authMiddleware, withTenant, requireApprover` (NEW server :14-16) — [INT] auth-model divergence |
| Endpoints | `/` (legacy budgets payload), `/summary` (legacy), `/monthly-by-artist`, `/exec`, `/exec/subbreakdown`, `/exec/rows`, `/filter-options`, `/export`, `/month/:month`, budgets PUTs, manual expense + income CRUD | `/summary`, `/analytics`, `/income` CRUD, plus the recoupments family (`/recoupments*`, `/statements`, `/planning`) that OLD serves from elsewhere |
| Spend basis | `COALESCE(payment_date, invoice_date)` (commitment), splits: `parent_id IS NULL` where the parent row carries the family total | same-ish: `COALESCE(payment_date, invoice_date, created_at::date)`, `parent_id IS NULL` — but in NEW's ledger the split **parent keeps only its own slice** (per `_defects-raw.md ## financials` in repo history / reports.js:5-8 comment), see defect 18 below |
| USD | `amount / COALESCE(NULLIF(fx_rate_to_usd,0),1)` — native fallback | `rowUsd` locked-rate-else-live (NEW :6-11) — improvement |
| Artist keying | groups by the expense's own artist string: `COALESCE(NULLIF(TRIM(LOWER(e.artist)),''),'unassigned')`, label = `MAX(e.artist)` (server :880-888) — every dollar appears under some row incl. "unassigned" | `spendByName[r.artist.toLowerCase()]` (no TRIM) then **inner-mapped onto roster `artists` by exact lowercased name** (NEW server :113-133) — see defect 17 |
| Timezone | all KPI/weekly/monthly windows anchored to America/Los_Angeles (server :699-702, :500, :851) | UTC month keys (`getUTCFullYear`, NEW :89,:110) — acceptable for a monthly chart, but month-boundary rows can land one bucket off vs OLD; P3 |

## 6. Tables & forms

- OLD monthly rollup is the page's only table-like structure (sortable, described above). NEW's per-artist P&L table: 4 columns, no sort, no totals row, top-20 cap sorted by spend (NEW server :133).
- NEW add-income form: 6 fields, native selects, no validation beyond amount (client :45-53); artist FK re-validated in-tenant server-side (:440-443) ✓.

## 7. Defects found

- [P0] Executive dashboard depth missing wholesale: weekly spend chart (4), aging + upcoming due (7), cash forecast (8), monthly rollup + month links (9), top-spend dimension toggle + expandable category sub-breakdowns (6), rep leaderboard (10), category trend (11) — each an OLD panel with zero NEW counterpart; see §4 items for exact OLD source spans (HIGH)
- [P0] Paid/unpaid distinction absent from every NEW figure — "Expenses" blends unpaid commitments into what reads as spend, with no basis disclosure on the page (OLD :1684-1701, unpaid split throughout) — fix: NEW client Financials.jsx + server /summary,/analytics split by payment_status (HIGH)
- [P0] No drill-through anywhere: KPI cards/pie/vendors/months un-clickable; `/exec/rows` (14 buckets) + modal missing (OLD :1863-2002; server :1535-1732) (HIGH)
- [P1] Cross-page artist/category/rep filter bar + `/filter-options` missing (OLD :1441-1496; server :671-691,:1406-1440) (HIGH)
- [P1] Range picker: no custom from/to, no 3m/6m/12m; period chips scope only /summary while chart/vendors/P&L are hard-wired 12mo — mixed-period page with no indication (NEW client :12-17,:91-95; NEW server :97,:102) (HIGH)
- [P1] Per-artist P&L drops money: expense rows whose `artist` doesn't exactly match a roster name (or is empty/'Unassigned', or differs by whitespace — NEW lowercases without TRIM) silently vanish from the table; OLD surfaced every dollar incl. an "unassigned" row (NEW server :113-133 vs OLD server :880-888). Spend shown per artist ≠ total expenses, unstated (HIGH)
- [P1] Excel export gutted: 14-sheet styled board packet → 3-section client CSV; no server export endpoint (OLD server :1734-2912; NEW client :60-67) (HIGH)
- [P2] KPI deltas compare partial current month vs full prior month — OLD day-matches every window (NEW server :135-137 vs OLD :693-738) (HIGH)
- [P2] Fetch errors swallowed → zeros render as data; no page-level error state (NEW client :34-42; OLD :1777-1781) (HIGH)
- [P2] Vendor concentration / payment velocity / method mix **data series** absent (OLD computes them in /exec :1135-1260 and exports them; OLD never mounted the three chart components — not an on-screen gap) (HIGH)
- [P2] KPI sparklines missing (distinct per-card shapes, OLD :1710-1775) (HIGH)
- [P3] Compact $ formatting (fmtCompact) absent; all values 2-decimal (OLD :16-27 / NEW :20) (HIGH)
- [P3] UTC month bucketing vs OLD's LA-anchored windows — boundary rows can shift a bucket (NEW server :89,:110; OLD :699-702) (MED)
- [P3] Income delete uses window.confirm instead of ui/ConfirmDialog (NEW client :56) (HIGH)
- [P3] Delta chip renders nothing at exactly 0 change vs OLD hiding only when prior is missing — trivial; and NEW Delta treats 0 as "no delta" hiding a true flat signal (NEW client :70-71) (LOW)
- [INT] Basis change: NEW Financials is a ledger-mastered P&L overview with income; cash-basis depth deliberately relocated to /reports (task brief; reports.js:2-8)
- [INT] Auth: requirePagePermission('/financials') → withTenant + requireApprover (multi-tenant model)
- [INT] FX: native-fallback division → locked-rate-else-live `rowUsd` (correctness improvement; totals legitimately differ)
- [INT] NEW-only income CRUD UI + per-artist income/net + category pie (additions, no OLD counterpart on this page)
- [INT] `/financials/month/:month` month-drill absent — OLD-orphan route tracked in `_audit/00-inventory.md:179`; not re-audited here per scope

# Dashboard
OLD: /Users/johnskead/Desktop/DevProjects/Dashboard/boom-dashboard/client/src/pages/Dashboard.jsx  |  NEW: /Users/johnskead/Desktop/DevProjects/cadence/client/src/pages/Dashboard.jsx
Server: OLD server/routes/dashboard.js (`/stats`, `/notifications`, `/activity`)  |  NEW server/routes/dashboard.js (`/`, `/widgets`)
Children: OLD `components/ReconciledBadge.jsx`, inline `BookkeepingSummaryWidget` (Dashboard.jsx:94-173), `components/Skeleton.jsx`, `hooks/useHotkeys`, `hooks/useReconciledThrough.js`  |  NEW `components/statements/ReconciledBadge.jsx`, `components/PageHeader.jsx`, `components/Skeleton.jsx`, `hooks/useReconciledThrough.js`

## 1. Layout & structure

OLD page order (Dashboard.jsx:405-780), all inside `space-y-8`:
1. Greeting block — time-of-day `h1` + subtitle + inline `ReconciledBadge linkTo` (:407-417)
2. Action-cards row, 4-up grid `sm:grid-cols-2 lg:grid-cols-4` (:420-460): My Tasks link-card, Pending Approvals link-card (admin-only), then 4 stat cards (so admins see 6 cards in a 4-col grid)
3. Latest Releases 14-day horizontal carousel card (conditional, :462-531)
4. Charts row `lg:grid-cols-3` (:534-682): Releases-per-Month bar chart (col-span-2) with filter bar, + Genre donut
5. Second row `lg:grid-cols-2` (:685-775): Upcoming Releases (This Week / Next Week) + Notifications panel
(Bookkeeping widget `BookkeepingSummaryWidget` is defined :94-173 and fed by `useBookkeepingSummary()` :83-92 but is **not rendered in OLD's JSX** — dead code in OLD as of this snapshot; comment :777-779 notes flag rollups moved to /duplicates.)

NEW page order (Dashboard.jsx:45-177), no `space-y-8` wrapper (per-section `mb-6`):
1. `ReconciledBadge` on its own row above the header (:47)
2. `PageHeader` "Welcome, {first}" + label-name subtitle (:48)
3. Owner-configured welcome banner (conditional, :50-54) — NEW-only
4. Pinned quick-links chip row (conditional, :57-68) — NEW-only
5. Stat cards, 5-up `grid-cols-2 lg:grid-cols-5` (:71-78)
6. Task-summary + Bookkeeping widgets row `lg:grid-cols-3` (:81-108), each hideable via `label.settings.dashboard.widgets`
7. Releases-by-month bar + Genre pie row `lg:grid-cols-3` (:111-138)
8. Upcoming (3 wks) + Recent activity row `lg:grid-cols-3` (:141-176)

Structural deltas: NEW has **no Latest Releases carousel and no Notifications panel** (both whole sections). NEW adds welcome banner, pinned links, per-widget visibility toggles (`vis()` :30), and a Recent-activity panel (OLD fetched `/dashboard/activity` :268 but never rendered it). Badge moved from inline-with-subtitle to its own row. Grid gaps: OLD `gap-6` on chart/second rows (:534, :685); NEW `gap-4` everywhere (:71, :82, :112, :142).

## 2. Visual differences

| Element | OLD value | NEW value | Source |
|---|---|---|---|
| Greeting h1 | `text-3xl font-black text-gray-900 tracking-tight`, "Good morning, John." | `text-xl font-bold` via PageHeader, "Welcome, John" | OLD :409-413 / NEW :48 + cadence PageHeader.jsx:5 |
| Section vertical rhythm | `space-y-8` page wrapper | `mb-6` per section, no wrapper | OLD :406 / NEW :46-71 |
| Stat card layout | icon 18 top-left colored (`text-violet-600` etc., `strokeWidth 1.5`), value `text-2xl font-bold`, label below `text-xs text-gray-400` | uppercase label `text-xs font-semibold text-gray-500 tracking-wide` left + gray icon 16 right, value `text-3xl font-bold` | OLD :386-459 / NEW :73-76 |
| Stat card hover | `hover:shadow-md hover:border-gray-300 transition-all` | none | OLD :452 / NEW :73 |
| Stat card padding | `px-5 py-4` | `p-5` | OLD :452 / NEW :73 |
| Card hover (all section cards) | `hover:shadow-md transition-shadow` | none | OLD :464,:536,:639,:687,:744 / NEW throughout |
| Bar chart height | 260 (`ResponsiveContainer height={260}`) | 180 (`div style height:180`) | OLD :609 / NEW :117 |
| Bar fill | `#E52017` + prior-year `#D1D5DB` | `rgb(var(--color-brand-500))`, single series | OLD :625-627 / NEW :119 — accent = RC-2 [INT], missing series = defect |
| Bar radius / size / gap | `radius=[4,4,0,0] barSize=24 barGap=2` | `radius=[3,3,0,0]`, default barSize, no barGap | OLD :610,:625 / NEW :119 |
| Chart axes/grid | CartesianGrid dashed `#f0f0f0` vertical=false; X+Y axes `fontSize 12 fill #9CA3AF`, no axis/tick lines, `allowDecimals={false}` | XAxis only, `fontSize 10, interval={1}` (every other label), no YAxis, no grid | OLD :611-623 / NEW :119 |
| Chart tooltip | `CustomTooltip` card (`bg-card border-rule shadow-elevated`, "this year"/"last year" rows) + `cursor rgba(0,0,0,0.03)` | default Recharts tooltip (unstyled for dark mode) | OLD :180-195,:624 / NEW :119 |
| Chart legend | swatch legend `w-2.5 h-2.5 rounded-sm` for year vs year-1 | none | OLD :539-550 / NEW — |
| Donut geometry | `outerRadius 80 / innerRadius 40`, height 180, no padding | `outerRadius 70 / innerRadius 36, paddingAngle 2`, height 180 | OLD :648-650 / NEW :131 |
| Donut slice labels | in-slice white `%` labels ≥5% (`CustomPieLabel`, fontSize 11, weight 600) | none | OLD :197-208,:654 / NEW :131 |
| Donut palette | `GENRE_COLORS` starting `#E52017` (brand-first) | `PIE` starting `#6366f1` (indigo-first) | OLD :175-178 / NEW :19 — first swatch [INT] per RC-2, rest of order differs |
| Donut legend | 2-col grid below chart: dot + genre + tabular count | none | OLD :666-674 / NEW — |
| Donut tooltip | `formatter (v,n)=>["${v} releases", n]`, styled 12px/rounded | default | OLD :660-663 / NEW :131 |
| Upcoming list rows | dot (`w-1.5 h-1.5` brand-500 this week / gray-300 next week) + "Artist — Project" + right-aligned tabular date | 36px cover-art thumb (or Disc3 placeholder) + project over artist + date | OLD :702-712,:722-732 / NEW :149-153 |
| Section headings | `text-sm font-semibold text-gray-900` | `text-sm font-bold text-ink` | OLD :538 etc. / NEW :85 etc. |
| ReconciledBadge | `text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5`, no icon, full month ("June 2026"), inline next to subtitle | `text-[11px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-2.5 py-1`, Landmark icon 11, short month ("Jun 2026"), own row above header; amber "reopened" variant (NEW-only) | OLD ReconciledBadge.jsx:18-25, Dashboard :415 / NEW ReconciledBadge.jsx:18-26, Dashboard :47 |
| Loading treatment | full-page skeleton: `Skeleton.PageHeader + StatCards(4) + 2 Blocks h-64` | page renders immediately; stat values show `—`; `Skeleton.Block h-40` in chart, `Skeleton.TaskList(5)` in activity only | OLD :356-367 / NEW :75,:116,:163 |
| Error state | centered `text-sm text-red-600` "Failed to load dashboard data" | none (errors swallowed) | OLD :369-374 / NEW :36-38 |
| Task counts | pill on card: `text-[10px] font-bold bg-red-500 text-white rounded-full` "N overdue"; sub-line "· N due today" amber | 3 tap-tiles Open/Due today/Overdue, `text-2xl font-bold`, colored text not pills | OLD :425-433 / NEW :86-90 |

## 3. Copy & content differences

- Greeting: OLD time-of-day "Good morning/afternoon/evening, {first}." (:210-214, :409) → NEW static "Welcome, {first}" (:48). Trailing period also dropped.
- Subtitle: OLD "Here's what's happening at Boom Records." (:411) → NEW "{label.name} · label operations" (:48) — label-name substitution is [INT] branding; the sentence itself is gone.
- Stat labels: OLD "Total Artists / Total Releases / Upcoming / Team Members" (:387-390) → NEW "Artists / Releases / Upcoming / Open deals / My open tasks" (:13-17). "Team Members" removed; "Open deals" and "My open tasks" added.
- OLD "open task{s}" + "N overdue" + "· N due today" (:426-432) → NEW tile labels "Open / Due today / Overdue" (:87).
- OLD "pending approval{s}" card (:446) → NEW "N awaiting approval →" link + "Awaiting approval" tile (:98, :103).
- Chart title: OLD "Releases per Month — {selectedYear}" (:538) → NEW "Releases by month" (:115).
- Filter bar strings "Filters / All Years / All Genres / All Formats / Clear" (:557-599) — absent in NEW.
- Chart empty state "No releases match these filters" (:633) — absent in NEW (zero-filled bars render instead).
- Donut title: OLD "Releases by Genre" (:640) → NEW "Genre mix" (:127); empty state "No genre data available" (:678) → "No releases yet." (:134).
- Upcoming: OLD "Upcoming Releases" + "This Week"/"Next Week" subheads + "View all" link + "No releases in the next two weeks" (:689-739) → NEW "Upcoming (3 wks)" + "Nothing in the next three weeks." (:145, :156); no View-all link.
- Latest Releases strings ("Latest Releases", "Out in the past 14 days", "Open Catalog", sync tooltip, "Updated N"/"All up to date"/"Sync failed") — whole section absent in NEW (OLD :469-484, :335-339).
- Notifications strings ("Notifications", "Clear all", "All clear — no alerts", and server-side messages "N releases dropping this week", "…is X% complete", "…missing UPC, ISRC, Spotify URI", "…contract expires in N days", "…(category) expires in N days", "N overdue tasks need attention", "N distributor requests pending") — all absent in NEW (OLD :746-772; server :156-317).
- NEW-only copy: welcome banner free text (:52), "Quick links" (:59), "Bookkeeping" + "Logged (MTD) / Paid (MTD) / Awaiting approval" (:97-103), "Recent activity" / "No activity yet." (:162,:172), "My tasks" (:85).

## 4. Feature & interaction differences

**Present in OLD, missing in NEW:**
- Notifications panel with severity icon + left-border styling (critical/warning/info), scrollable `max-h-80`, client-side "Clear all" (OLD :393-403, :744-774) and its entire `/dashboard/notifications` computation: this-week count, low-checklist-completion (<50%, critical <25%), missing metadata (UPC/ISRC/Spotify URI, next 30d, LIMIT 5), expiring contracts (60d, approver+), expiring admin docs (60d, admin+, restricted-doc filtering), overdue-task count, pending distributor requests (server :156-317). NEW has a bell (`/api/notifications`) elsewhere but nothing on the dashboard and no equivalents for low-completion/missing-metadata/admin-doc alerts on this page.
- Latest Releases 14-day carousel (OLD :462-531): horizontal scroll of 160px art cards, `spotifyWebUrl()` URI parser (:47-69) gating a hover Spotify badge (`#1DB954` circle, ExternalLink 13) that deep-links to Spotify, else internal `/releases/:id` link; `relativeDateLabel` "Today/Yesterday/N days ago" (:71-80); "Open Catalog" link.
- Sync-artwork loop button (OLD :310-344, :475-482): iterative `POST /releases/sync-artwork {days:14, force:first}` with no-progress guard, spin state, "Updated N" toast text. NEW server only has per-release `POST /releases/:id/sync-artwork` (cadence server/routes/releases.js:15); Catalog.jsx:70 loops per-id client-side — no bulk endpoint, nothing on Dashboard.
- Chart filter bar: Year / Genre / Format selects fed by `availableYears/Genres/Formats`, Clear button, inline spinner while refetching, refetch effect on filter change (OLD :232-261, :553-606). NEW chart is a fixed trailing-12-month view with no controls.
- Prior-year comparison series: server computes same-filters year-1 (`prevYearParams[0] = selectedYear - 1`, OLD server :75-89), gray bars + legend + "this year/last year" tooltip (OLD :539-550, :626-628, :188).
- This Week / Next Week calendar-week bucketing (server `date_trunc('week', …)` OLD server :103-114) with distinct dot colors; NEW uses a rolling 21-day window (NEW server :68).
- `r` hotkey → refetch (OLD :346-348 via `useHotkeys`). NEW Dashboard imports no hotkeys.
- Refetch on `user?.id` change ("view-as" switching, OLD :237-239). NEW fetches once on mount (:34-39). Impact under cadence impersonation CONFIRMED 2026-09-02 (Phase 10) — enter-workspace/impersonation is setState-only: `AuthContext.jsx:97-129` calls setToken/setUser/setLabel with no reload and no `key` change, and `App.jsx` puts no `key` on Layout. The tree does NOT remount, so this stale-data defect is real (cadence may remount the tree on enter-workspace).
- Full-page load skeleton + error screen (OLD :356-375).
- My Tasks / Pending Approvals as top-row **link cards** with count pills; Pending Approvals card is admin-gated client-side via `isAdmin` (OLD :218, :437-448). NEW gates via server `isBkAdmin` (Approver included — wider than OLD's Admin/Superadmin check; NEW server :10, :41).
- Team Members stat (OLD :390; server :15,:138).
- OLD external Bookkeeping widget details: "Pending QB" metric, invoice-count sublabel, "% of logged" sublabel, "Review now →" CTA, "Open Ledger" link, recent-invoices 3-row mini list (OLD :94-173). [Widget not rendered in OLD's current JSX — parity weight reduced; the Flask cross-app fetch itself is [INT], bookkeeping is native in cadence.]

**Present in NEW, missing in OLD:**
- Recent-activity panel rendering `/dashboard` `recentActivity` (NEW :160-174; OLD fetched :268 but never rendered).
- Owner-configurable widget visibility + welcome banner + pinned quick links from `label.settings.dashboard` (NEW :29-32, :50-68) — [INT] per-workspace customization.
- "Open deals" and "My open tasks" headline stats (NEW :16-17; server :26-31).
- ReconciledBadge "reopened" amber state (NEW ReconciledBadge.jsx:21-25).
- Bookkeeping Logged/Paid MTD computed natively with per-date USD conversion (`toUSD`, NEW server :95-111) — [INT] (OLD delegated to external Flask app).

**Behaves differently:**
- ReconciledBadge: OLD optional `linkTo` → `/bk/statements`, plain span elsewhere; NEW always a Link → `/bank-matching` (different data model: `/bank-statements/months` + `open_debits` vs OLD `/statements/months`) — [INT] cadence bank-matching feature, but month label format differs (full vs abbreviated month name).
- Task buckets: OLD computed client-side from `/team/my-work` with local-calendar helpers `isPastLocal/daysUntilLocal` (OLD :283-289); NEW computes in SQL against server `CURRENT_DATE` (NEW server :86-92) — overdue/due-today can flip near midnight for users not in server TZ.
- Upcoming headline count: OLD `release_date > CURRENT_DATE` (server :17-19); NEW `>= CURRENT_DATE AND status != 'Archived'` (NEW server :20) — NEW counts today's releases and excludes archived.
- Genre donut data: OLD excludes null/empty genre (server :92-95); NEW coalesces to 'Unspecified' bucket (NEW server :80-81).
- Chart x-domain: OLD Jan–Dec of a selected year, zero-filled (server :117-127); NEW trailing 12 months labeled `YY-MM` (NEW server :74-76, :104-108).

## 5. Data layer differences

| Concern | OLD | NEW |
|---|---|---|
| Endpoints called by page | `GET /dashboard/stats(?year&genre&format)`, `GET /dashboard/notifications`, `GET /dashboard/activity`, `GET /team/my-work`, `GET /bk/pending-count`, `GET /releases?archived=false&in_catalog=any&date_from=…`, `POST /releases/sync-artwork` (Dashboard.jsx :254, :265-277, :323) | `GET /dashboard`, `GET /dashboard/widgets` (Dashboard.jsx :36-37) |
| Stats shape | `{totalArtists,totalReleases,upcomingReleases,teamMembers,selectedYear,availableYears,availableGenres,availableFormats,releasesByMonth[{month,releases,lastYear}],releasesByGenre,thisWeek,nextWeek}` (server :133-149) | `/`: `{stats:{artists,releases,upcoming,openDeals,myTasks},recentActivity}` (server :44-55); `/widgets`: `{upcomingReleases,releasesByMonth[{month,count}],genres,myTasks:{open,overdue,due_today},isBkAdmin,pendingApprovals,bookkeeping:{loggedMtd,paidMtd,awaitingApproval}}` (server :113-120) |
| Notifications endpoint | `/dashboard/notifications` computed alerts (server :156-317) | **absent** (grep: no `dashboard/notifications` anywhere in cadence) |
| Activity | LIMIT 50, INNER JOIN users (server :321-329) | LIMIT 10, LEFT JOIN users label-matched (server :32-35) — NEW keeps rows for deleted users, [INT] tenancy scoping |
| Tenancy | none (single tenant) | every query `label_id = $1` (server :17-35, :66-101) — [INT] |
| Approvals count | separate `/bk/pending-count`, `.catch → 0` (OLD :270) | inlined in `/widgets` for bk admins, `expenses status='pending' AND NOT deleted` (NEW server :94) |
| Error handling | try/catch → error screen; per-call `.catch` fallbacks for optional data (OLD :263-307) | both `.catch(() => {})` — silent zeros, no user-visible failure (NEW :36-38) |
| Filters | year/genre/format as query params, case-insensitive trim match (server :44-56) | none |
| Prior-year series | yes (server :74-89) | none |
| Bookkeeping source | external Flask app `${BK_URL}/api/dashboard-summary` with cookies (OLD :42, :83-92) | native SQL + `toUSD` FX (NEW server :95-111) — [INT] |
| N+1 note | — | `/widgets` awaits `toUSD` per MTD expense row in a loop (server :110); fine at small volume, CONFIRMED 2026-09-02 (Phase 10) — measured against the seeded workspace (86 expenses): `/api/dashboard/widgets` took 0.66s / 1.14s / 1.53s across three calls. Already slow at trivial volume, so the per-row `await` is a real scaling risk, not a theoretical one at scale |

## 6. Tables & forms (if present)

No tables or forms on either side. Form-adjacent controls: OLD's three filter `<select>`s (:560-591, styled `text-xs border-rule rounded-md px-2.5 py-1.5`, brand focus ring) — absent in NEW (see §4).

## 7. Defects found

1. **P0** — Dashboard Notifications panel (severity-styled alerts, Clear all) and the entire `/dashboard/notifications` computed-alert feed (low completion, missing metadata, expiring contracts/admin docs, overdue tasks, pending requests) are missing — fix: port OLD server/routes/dashboard.js:156-317 into cadence server/routes/dashboard.js (label-scoped) + render panel in cadence client/src/pages/Dashboard.jsx (after :176), per OLD Dashboard.jsx:393-403,744-774. (HIGH)
2. **P0** — Latest Releases 14-day carousel missing entirely: cover-art cards, Spotify hover badge + `spotifyWebUrl` deep link, relative-date labels, "Open Catalog" link — fix: port OLD Dashboard.jsx:47-80,462-531 into cadence Dashboard.jsx (between :78 and :81). (HIGH)
3. **P0** — Releases-per-Month chart lost the Year/Genre/Format filter bar (+Clear, +spinner), prior-year comparison bars, legend, custom tooltip, YAxis/grid, and per-year domain; NEW is a fixed trailing-12-month single series at 180px — fix: cadence client Dashboard.jsx:113-124 + add filterable stats query with prior-year series to cadence server/routes/dashboard.js (port OLD server :10-127). (HIGH)
4. **P0** — Bulk `POST /releases/sync-artwork {days, force}` endpoint + dashboard sync loop missing (NEW has only per-id sync, cadence server/routes/releases.js:15) — fix: cadence server/routes/releases.js (add bulk route per OLD server behavior) + client loop per OLD Dashboard.jsx:310-344. (HIGH; ships with defect 2)
5. **P1** — Genre donut lost in-slice % labels, 2-col count legend, "N releases" tooltip formatter; geometry shrank (80/40 → 70/36 + paddingAngle) and server now injects an 'Unspecified' bucket OLD excluded — fix: cadence Dashboard.jsx:125-136 (port OLD :197-208,:639-681) + cadence server/routes/dashboard.js:80-81 (restore `WHERE genre IS NOT NULL AND genre != ''`). (HIGH)
6. **P1** — This Week / Next Week calendar-week buckets with colored dots and "View all" link replaced by a flat rolling-21-day list (LIMIT 8) — fix: cadence server/routes/dashboard.js:66-71 (add `date_trunc('week')` buckets per OLD server :100-115) + cadence Dashboard.jsx:143-158 (port OLD :687-741). (HIGH)
7. **P1** — "Team Members" headline stat removed — fix: cadence server/routes/dashboard.js:16-31 (add label-scoped users count) + Dashboard.jsx:12-18. (HIGH)
8. **P1** — My Tasks / Pending Approvals top-row action link-cards (red "N overdue" pill, "· N due today", amber approvals pill) demoted to lower widget tiles; approvals no longer a first-row card and NEW's bk gate includes Approver where OLD's card was Admin/Superadmin-only — fix: cadence Dashboard.jsx:71-108 per OLD :420-448; gate per OLD :218. (HIGH)
9. **P1** — All dashboard fetch errors swallowed (`.catch(() => {})`) with no error state; failed load renders zeros/dashes as if real data — fix: cadence Dashboard.jsx:34-39 (add error state per OLD :302-307,:369-375). (HIGH)
10. **P2** — Time-of-day greeting ("Good morning, {first}." at `text-3xl font-black`) replaced by static "Welcome, {first}" at PageHeader's `text-xl font-bold` — fix: cadence Dashboard.jsx:48 (port OLD :210-214,:407-417). (HIGH)
11. **P2** — Full-page load skeleton (PageHeader + StatCards + chart Blocks) missing; NEW paints the shell with `—` placeholders — fix: cadence Dashboard.jsx (add early return per OLD :356-367; NEW's Skeleton kit already has the pieces). (HIGH)
12. **P2** — `r` refresh hotkey missing — fix: cadence Dashboard.jsx (add `useHotkeys([{key:'r',…}])` per OLD :346-348; cadence hooks/useHotkeys.js exists). (HIGH)
13. **P2** — ReconciledBadge visual drift: bordered emerald-50 pill w/ full month name and inline placement → borderless emerald-100 uppercase pill w/ Landmark icon, abbreviated month, own row — fix: cadence client/src/components/statements/ReconciledBadge.jsx:18-26 + Dashboard.jsx:47 (match OLD ReconciledBadge.jsx:18-25 styling/placement; keep NEW's reopened state). (HIGH)
14. **P2** — Bookkeeping widget lost recent-invoices mini list, invoice-count and "% of logged" sublabels, "Review now →" CTA and "Open Ledger" link (OLD :94-173 vs NEW :94-106) — fix: cadence Dashboard.jsx:94-106 + extend `/widgets` bookkeeping payload (server :113-119). (MED — OLD widget wasn't rendered in OLD's current JSX and hit an external app; "Pending QB" omission is [INT], QB scoped out)
15. **P3** — Upcoming headline count off-by-one vs OLD: `>= CURRENT_DATE` (counts today) + `status != 'Archived'` vs OLD `> CURRENT_DATE`, no archive filter — fix: cadence server/routes/dashboard.js:20 if strict parity wanted. (HIGH)
16. **P3** — Overdue/due-today task buckets computed against server `CURRENT_DATE` instead of OLD's local-calendar client helpers — can disagree with My Work near midnight for non-server-TZ users — fix: cadence server/routes/dashboard.js:86-92 or compute client-side per OLD :283-289. (MED)
17. **P3** — No refetch on acting-user switch (OLD refetched on `user?.id` change) — fix: cadence Dashboard.jsx:34-39 dependency array. Impact CONFIRMED 2026-09-02 (Phase 10) — enter-workspace/impersonation is setState-only: `AuthContext.jsx:97-129` calls setToken/setUser/setLabel with no reload and no `key` change, and `App.jsx` puts no `key` on Layout. The tree does NOT remount, so this stale-data defect is real (cadence enter-workspace may remount). (LOW)

Intentional divergences (not defects): brand accent in chart/pie firsts (RC-2); "at Boom Records" → `{label.name}` subtitle; label-scoped queries throughout; native bookkeeping vs Flask BK app (+ `/bk/*` → `/approvals` link targets); ReconciledBadge target `/bk/statements` → `/bank-matching` with reopened state (cadence bank-matching model); welcome banner / pinned links / widget visibility from `label.settings.dashboard`; "Pending QB" metric dropped (QB import scoped out).

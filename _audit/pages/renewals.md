# Renewals

OLD: `boom-dashboard/client/src/pages/Renewals.jsx` (189 lines) + `boom-dashboard/server/routes/contracts.js` GET /renewals (:251-272)
NEW: `cadence/client/src/pages/Renewals.jsx` (81 lines) + `cadence/server/routes/contracts.js` GET /renewals (:57-76)

Design-system-level diffs (Inter font, accent default, control heights, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported. OLD's `border-boom-600` spinner maps to NEW brand under RC-2.

## 1. Layout & structure

**OLD** (:89-187): PageHeader "Contract Renewals" / "Track your contract expiration dates" → 4 stat cards (Total Contracts / Expiring Soon / 90 Days / Active, icon tile + label + value, 1/2/4-col grid :97-109) → 4 filter pills with live counts (All / Expiring Soon / Active / Expired :112-131) → error line → single table card, 8 columns, client-sorted by expiration ascending, in-table empty row (:136-186). Full-page centered spinner while loading (:67-76).

**NEW** (:26-79): PageHeader "Renewals" / "Active contracts expiring soon" with a **window select** (Next 30/60/90/180 days) as the header action (:28-39) → "Loading…" text / empty-state card / single table card, 4 columns, server-ordered (:41-78). No stat cards, no filter pills, no error state.

Structural deltas: the page changed species — OLD is a full portfolio tracker over *every* contract with an expiration date (expired + long-active included); NEW is a lookahead list of Active contracts inside a chosen window. Stat cards, filter pills, Expired/Active views, and 4 of 8 table columns are gone; the window selector is a NEW addition with no OLD counterpart.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Loading | centered spinner (`border-boom-600`) + "Loading renewals..." | bare `text-sm text-gray-400` "Loading…" line | OLD :67-76 / NEW :42 |
| Stat cards | 4 `card px-5 py-4` w/ 10×10 tinted icon tile (gray/red/amber/emerald), `text-2xl` value | none | OLD :97-109 / NEW — |
| Filters | pill buttons, active `bg-gray-900 text-white`, counts in label | none (header `<select>` instead) | OLD :112-131 / NEW :32-38 |
| Status rendering | separate badge column (`badge badge-gray/red/yellow/green`, boom index.css:71-86) + separate color-coded "Days Left" number (`{n}d` / "Expired") | single "Countdown" chip `rounded-full` w/ AlertTriangle icon on **every** row incl. non-urgent ones | OLD :167-178 / NEW :67-70 |
| Band colors | expired grey · <30 red · <90 amber · ≥90 **green** | overdue red · ≤30 red · ≤60 amber · else **gray** — no positive/green state anywhere | OLD :36-57 / NEW :7-13 |
| Table head | `.table-header` on `bg-surface-50` band | ad-hoc `text-xs font-semibold text-gray-400 uppercase` on plain row | OLD :140-149 / NEW :52-57 |
| Empty state | in-table row "No renewals found" | dedicated card w/ RefreshCw 28 icon + emoji line | OLD :152-155 / NEW :44-47 |
| Error state | red centered "Failed to load renewals" | none — fetch errors swallowed (`.catch(() => {})`) | OLD :22-23,133 / NEW :22 |

## 3. Copy & content differences

- Title/subtitle: "Contract Renewals" / "Track your contract expiration dates" → "Renewals" / "Active contracts expiring soon" (OLD :92-93 / NEW :29-30).
- Stat labels gone: "Total Contracts", "Expiring Soon", "90 Days", "Active" (OLD :83-86); filter labels gone: "All (n)" etc. (OLD :114-117).
- Status words gone entirely — "Expired", "Expiring Soon", "90 Days", "Active" badges (OLD :44-50) have no NEW equivalent; countdown chip says "{n}d left" / "{n}d overdue" instead of OLD's bare "{n}d" / "Expired" (NEW :9-12 / OLD :169).
- Column headers: "Days Left" → "Countdown"; "Territory", "Royalty", "Advance", "Status" headers dropped (OLD :141-148 / NEW :53-56).
- Empty state: "No renewals found" → "Nothing expiring in this window. 🎉" (OLD :154 / NEW :46) — emoji is off-register with the rest of the app.
- Loading: "Loading renewals..." → "Loading…" (OLD :72 / NEW :42).
- Missing-artist fallback: NEW renders "—" (LEFT JOIN can yield null artist); OLD's INNER JOIN made artist_name always present (NEW :64 / boom contracts.js:257-258).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Full-portfolio view**: OLD lists every contract with a non-null expiration_date regardless of status or distance (server :255-261), so Expired and comfortably-Active contracts are first-class rows with their own filters and counts. NEW's server hard-filters `status='Active' AND expiration_date <= CURRENT_DATE + N days` (cadence :62-67) — contracts in any other status (e.g. already flipped to Expired/Pending) and Active contracts beyond 180 days are unreachable from this page in any UI state. (RN-2)
- **4 stat cards** with computed counts (Total / Expiring Soon / 90 Days band `30 ≤ d < 90` / Active `d ≥ 30`) (OLD :78-87,97-109) — gone. (RN-3)
- **Filter pills** All/Expiring Soon/Active/Expired with counts, client-side band filtering (OLD :59-65,112-131) — replaced by a 30/60/90/180-day server window select that cannot express "Expired" or "Active beyond window". (RN-3)
- **Status badge + color-coded days-left** as two independent cells (OLD :167-178) — merged into one chip; the ≥90-day green/positive signal no longer exists (NEW gray), and the amber band moved from `<90` to `≤60`. (RN-4)
- **Client sort** ascending by expiration (OLD :158) — NEW relies on server `ORDER BY expiration_date ASC` (cadence :68); net behavior equal.
- **Error surfacing** (OLD :22-23,133) — NEW has none. (RN-7)

### Features in NEW not in OLD
- Lookahead window select (30/60/90/180 days) driving a `?days=` server param (NEW :18,32-38; cadence contracts.js:59) — an addition, but it's the mechanism that removes OLD's full-portfolio semantics (see RN-2).

## 5. Data layer

| Aspect | OLD (boom contracts.js:251-272) | NEW (cadence contracts.js:57-76) |
|---|---|---|
| Scope | all contracts, `expiration_date IS NOT NULL` | + `label_id = $1`, `status = 'Active'`, `expiration_date <= CURRENT_DATE + N days` (N = min(?days‖90, 365)) |
| Join | `JOIN artists` (inner — contracts w/o artist row hidden) | `LEFT JOIN artists … AND a.label_id = c.label_id` (row kept, artist "—") |
| Order | `expiration_date ASC` | same |
| Auth | `authMiddleware` per-route; '/renewals' in the client admin-path list (boom contracts.js:21) | router-level `authMiddleware, withTenant, requireApprover` (cadence :11-15) + client `AdminRoute` (cadence App.jsx:152) + `isApprover` nav gate (Layout.jsx:268) [INT] |
| Date math location | client (`daysUntilLocal`, boom utils.js:491-498 — local-calendar) | client (`urgency()` UTC-parse, NEW :7-13) + server `CURRENT_DATE` window (server TZ) |

## 6. Tables & forms

- Columns: OLD 8 — Artist, Type, Territory, Expires, Days Left, Royalty (`{royalty_split}%`), Advance (`${advance?.toLocaleString()}`), Status (:140-178). NEW 4 — Artist, Type, Expires, Countdown (:52-71). Territory, Royalty, Advance, and the Status badge are dropped even though the query still selects `c.*`. (RN-4)
- Expires cell: OLD `formatDate(renewal.expiration_date)` (:166, shared local-safe helper); NEW `new Date(c.expiration_date).toLocaleDateString()` (:66) — UTC-midnight parse shifts the displayed date a day back in negative-offset timezones. (RN-6)
- No forms on either side.

## 7. Defects found

- **RN-1 P1** — Days-left math regressed to the exact bug OLD fixed: `urgency()` does `Math.ceil((new Date(date) - new Date())/86400000)` — a UTC-midnight parse diffed against wall-clock time — where OLD deliberately uses local-calendar `daysUntilLocal` with the in-code comment "the UTC-midnight parse made a contract expiring tomorrow read '2 days' for most of the day" (cadence Renewals.jsx:8 vs boom Renewals.jsx:30-34, boom utils.js:491-498). NEW's banding therefore shifts a day for most of the day (e.g. a contract expiring today can read "1d left", and band boundaries move with the viewer's TZ/time-of-day).
- **RN-2 P1** — Page scope narrowed from all-contracts tracker to Active-only lookahead: server adds `status='Active'` and `expiration_date <= CURRENT_DATE + N days` (max 180 via the UI, 365 hard cap) — non-Active contracts and Active contracts expiring later than the window are invisible in every UI state, killing OLD's Expired and Active views outright (cadence contracts.js:62-67 vs boom contracts.js:255-261).
- **RN-3 P1** — All 4 stat cards (Total Contracts / Expiring Soon / 90 Days / Active) and the 4 count-bearing filter pills (All / Expiring Soon / Active / Expired) removed; replaced by a 30-180-day window select that can't express Expired or long-Active (boom :78-131 vs cadence :32-38).
- **RN-4 P2** — Table halved: Territory, Royalty (%), Advance ($) and the Status badge column dropped (query still returns them); Days Left + Status merged into one "Countdown" chip (boom :140-178 vs cadence :52-71).
- **RN-5 P2** — Urgency bands changed: OLD grey `<0` / red `<30` / amber `<90` / green `≥90`; NEW red `<0` ("overdue") / red `≤30` / amber `≤60` / gray else — the 90-day amber horizon shrank to 60 and the positive green "Active" state has no NEW equivalent (boom :36-57 vs cadence :7-13).
- **RN-6 P2** — Expires column uses `new Date(x).toLocaleDateString()` instead of the shared `formatDate` — UTC-parse renders the date one day early in negative-offset timezones (the same TZ-shift class the repo already fixed in MyWork) (cadence :66 vs boom :166).
- **RN-7 P3** — Fetch errors silently swallowed (`.catch(() => {})`, no error state — a failed load is indistinguishable from "Nothing expiring"); loading downgraded from centered spinner to a bare text line (cadence :22,42 vs boom :22-23,67-76,133).
- **RN-8 P3** — Countdown chip shows an AlertTriangle on every row, including non-urgent gray ones; OLD reserved alarm iconography for the stat card and used a plain badge + number per row (cadence :69 vs boom :167-178).
- **RN-9 P3** — Empty state copy "Nothing expiring in this window. 🎉" introduces an emoji register absent from OLD ("No renewals found") (cadence :46 vs boom :154).

Intentional divergences: `label_id` scoping + tenant-guarded artist join + router-level `withTenant`/`requireApprover` (cadence contracts.js:11-15,63-65); client `AdminRoute` + `isApprover` nav gating mirroring OLD's admin-path list (cadence App.jsx:152, Layout.jsx:268 vs boom contracts.js:21); INNER→LEFT artist join is a tenancy-hardening side effect (missing artist renders "—").

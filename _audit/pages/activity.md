# Activity

## 1. Files compared (purpose & pairing)

- OLD: `boom-dashboard/client/src/pages/ActivityHistory.jsx` (729) at `/activity` (boom App.jsx:206) + `boom-dashboard/server/routes/activity.js` (161). Table: `activity_log` incl. `entry_id`/`entry_payee` columns (boom index.js:1483-1491).
- NEW: `cadence/client/src/pages/Activity.jsx` (46) at `/activity` (cadence App.jsx:188) + `cadence/server/routes/activity.js` (30). Table: `activity_log` label-scoped, WITHOUT `entry_id`/`entry_payee` (cadence index.js:923-933). Writer: `server/middleware/activityLogger.js:8-18` (~100 call sites across routes, grep-verified).
- Same feature in both: the workspace audit trail. NOT the same page as NEW's `PlatformActivity` (operator console, cadence App.jsx:126) — that is a cross-tenant surface with no OLD counterpart. Design-system deltas covered by RC-1..RC-6 in `_audit/01-design-system.md`.
- NEW is a skeletal stub: OLD's page is a full filterable/paginated audit browser; NEW renders one 100-row table with zero controls.

## 2. Route & permissions

| | OLD | NEW |
|---|---|---|
| Client route | `/activity`, no route guard (boom App.jsx:206); relies on server 403 | `/activity` wrapped in `AdminRoute` (cadence App.jsx:188); nav item admin-only (cadence Layout.jsx:301) |
| Server gate | inline `role !== 'Admin' && !== 'Superadmin'` → 403 (OLD activity.js:10-12, repeated :143-145) | `authMiddleware, withTenant, requireAdmin` (NEW activity.js:7,10) |

Equivalent effective access (Admin/Superadmin). NEW's client-side guard is the corrected form — [INT].

## 3. Server/API diff

| Endpoint | OLD | NEW | Δ |
|---|---|---|---|
| `GET /` params | `user_id, category, from, to, search, methods, department, sort, page, limit` (OLD activity.js:14-25) | `limit` only, capped 500 (NEW activity.js:12) | every filter, sort and page param gone |
| category filter | `CATEGORY_ACTIONS` map → `action IN (...)` for 8 buckets (OLD :47-63) | — | gone |
| method / department filters | method IN-list (:66-73); department via users join (:76-79) | — | gone |
| search | ILIKE-style LOWER LIKE over action + user name + email (:81-84) | — | gone |
| date range | `from >= ::timestamptz`, `to < date + 1 day` (:35-44) | — | gone |
| sort | asc/desc on created_at (:87, :112) | fixed DESC (:19) | gone |
| pagination | LIMIT/OFFSET + parallel COUNT query, returns `total` (:89-127, :129-133) | single LIMIT, no offset, no total (:12,20,23) | history beyond newest 500 unreachable |
| row payload | id, action, detail, ip_address, method, endpoint, **entry_id, entry_payee**, created_at, user id/name/email/**role/department** (:93-114) | id, action, detail, ip_address, method, endpoint, created_at, user_name, user_email (:14-15) | entry context + role/dept dropped |
| `GET /users` | distinct users w/ department for the filter dropdown (:141-159) | absent | gone |
| Tenancy | none (single-tenant) | `WHERE al.label_id = $1`, join constrained `u.label_id = al.label_id` (NEW :17-18) | [INT] |
| Writer | OLD logs w/ entry_id/entry_payee backfill machinery (boom index.js:1490-1536) | `logActivity` writes label_id, user, action, detail, ip, method, endpoint (activityLogger.js:12-16) | no entry_id/entry_payee ever written |

## 4. UI structure diff

- OLD (top→bottom): PageHeader "Activity History" + live `{total} events matching filters` subtitle + Refresh button w/ spinner (ActivityHistory.jsx:365-378) → 9 category pills with per-category icon+color (Activity/LogIn/Music/Users/FileText/TrendingUp/UserCheck/DollarSign/LayoutDashboard; :39-49, :381-400) → filter bar: debounced search input (:437-446), user `<select>` fed by `/activity/users` (:449-458), department `<select>` (:461-470), date-preset segmented control Today/7d/30d/All (:218-223, :473-489), Custom range toggle + two date inputs (:492-520), Newest/Oldest sort toggle (:523-534), Clear-all link (:536-544) → active-filter chip row for methods/department (:548-570) → error banner w/ Retry (:573-578) → table (User w/ avatar initial + clickable dept badge :620-637; Action w/ category icon chip + humanized text + entry_payee subline :641-654; Details w/ parsed diff text :658-665; Time w/ formatted date + Clock-icon timeAgo :668-674) → numbered pagination bar, 7-page window + prev/next (:684-726). Hidden-but-coded HTTP-method pill filter (`hidden` class, :402-432).
- NEW: PageHeader "Activity" (Activity.jsx:15) → plain 4-column table When/User/Action/Detail (:22-41). Nothing else — no filters, no pills, no pagination, no refresh, no error UI, no icons, no avatars.

## 5. Behavior/interactions diff

- Fetch: OLD refetches on every filter change (page reset to 1), debounces search 350ms, silent-refresh mode for pagination/refresh (:266-324). NEW fetches once on mount (:9-11).
- Sort: OLD toggle in toolbar AND on the Time header, plus `s` hotkey via useHotkeys (:245-247, :523-534, :598-609). NEW: none.
- Deep-filter: OLD's department badge in each row sets the department filter on click (:629-635). NEW: none.
- Action rendering: OLD `humanizeAction` maps ~45 raw endpoint/method patterns to plain English and passes through known verb prefixes (:51-119); `getActionDetail` parses JSON detail into `Changed X from "a" to "b"` sentences via FIELD_LABELS, else `field: value` pairs, else entry `#id` (:121-172). NEW prints `r.action` and `r.detail` verbatim (:36-37) — structured/JSON details render as raw text.
- Errors: OLD error state + Retry (:290-291, :573-578). NEW `.catch(() => {})` (:10) — a 500/403 renders as the "No activity recorded yet" empty state.
- Default window: OLD defaults to Last 7d preset (:248); NEW shows newest 100 of all time.
- Deep links to entities: neither side links rows to the underlying record (OLD shows `#id` as text only). No differences found.

## 6. Visual/design diff

- RC-1, RC-2, RC-3, RC-5 apply (OLD page uses `text-[10px]/[11px]` metadata, boom-colored focus rings/spinner/avatar `bg-boom-100 text-boom-700` :622-625; NEW has no equivalents to compare).
- Per-event color language gone entirely: OLD gives every category an icon + tinted chip (:39-49, :643-645) and every department a tinted badge (DEPT_COLORS :208-214); NEW rows are monochrome gray text.
- Loading: OLD centered boom spinner (:582-585); NEW "Loading…" text (:17). Empty state: OLD icon + copy (:586-590); NEW text-only card (:19).
- Time cell: OLD two-line (absolute + relative w/ Clock icon, :667-674); NEW single raw `toLocaleString()` (:34).
- NEW table header `text-gray-400` on RC-3-larger `text-xs` vs OLD `text-gray-500` headers (:594-598) — minor.

## 7. Defect table

| Sev | Defect | Evidence | Conf |
|---|---|---|---|
| P1 | All audit filters gone end-to-end: user, category buckets, date range/presets, text search, department, HTTP method, sort — server accepts only `limit`, client renders no controls; `/activity/users` dropdown endpoint also dropped | NEW server activity.js:10-22 + client Activity.jsx:9-11 vs OLD server activity.js:14-87,141-159 + client ActivityHistory.jsx:380-570 | HIGH |
| P1 | Pagination + total count gone: OLD LIMIT/OFFSET + COUNT + numbered pager; NEW newest-100 (500 hard cap) with no way to page — older history unreachable in-app | NEW activity.js:12,20 + Activity.jsx (no pager) vs OLD activity.js:89-133, ActivityHistory.jsx:684-726 | HIGH |
| P2 | `entry_id`/`entry_payee` never in schema/writer/payload and user `role`/`department` dropped from rows — payee subline, dept badge and entry references impossible | cadence index.js:923-933, activityLogger.js:12-16, activity.js:14-15 vs boom index.js:1490-1491, activity.js:93-114, ActivityHistory.jsx:629-652 | HIGH |
| P2 | `humanizeAction` plain-English mapping (~45 endpoint/method rules) gone — raw action strings shown | Activity.jsx:36 vs ActivityHistory.jsx:51-119 | HIGH |
| P2 | Detail formatting gone: JSON before/after diffs render as raw JSON instead of `Changed amount from "X" to "Y"` sentences (FIELD_LABELS) | Activity.jsx:37 vs ActivityHistory.jsx:121-172 | HIGH |
| P2 | Per-event category icon + color chip system (9 categories, `getCategoryForAction`) gone | Activity.jsx:32-38 vs ActivityHistory.jsx:39-49,174-189,643-645 | HIGH |
| P2 | User cell reduced to bare name: avatar initial + clickable department badge (which deep-filters the feed) gone | Activity.jsx:35 vs ActivityHistory.jsx:620-637 | HIGH |
| P3 | Time column: formatted date + relative `timeAgo` subline → raw `toLocaleString()` | Activity.jsx:34 vs ActivityHistory.jsx:14-35,667-674 | HIGH |
| P3 | Refresh button (spinner, silent refetch) gone | vs ActivityHistory.jsx:266-268,368-377 | HIGH |
| P3 | No error state: fetch failure swallowed and rendered as the "No activity recorded yet" empty state (OLD had banner + Retry) | Activity.jsx:10,18-19 vs ActivityHistory.jsx:573-578 | HIGH |
| P3 | `s` sort-toggle hotkey gone (documented in OLD manual) | vs ActivityHistory.jsx:245-247; boom UserManual.jsx:350 | HIGH |
| P3 | Default view all-time newest-100 vs OLD's Last-7d default window | Activity.jsx:9-11 vs ActivityHistory.jsx:248,257-264 | MED |
| P3 | Header regressions: live "N events matching filters" count subtitle gone; title "Activity History" → "Activity" | Activity.jsx:15 vs ActivityHistory.jsx:365-367; boom Layout.jsx:55 | HIGH |
| P3 | Loading spinner and iconed empty state → plain text | Activity.jsx:17,19 vs ActivityHistory.jsx:582-590 | HIGH |

Intentional divergences:
- [INT] Tenancy: `label_id` scope + label-constrained user join (NEW activity.js:17-18); `logActivity` no-ops without a label (activityLogger.js:10).
- [INT] Client route wrapped in AdminRoute (NEW App.jsx:188) vs OLD's unguarded client route — corrected form, same effective access.

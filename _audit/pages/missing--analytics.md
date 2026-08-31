# missing--analytics — In-workspace usage analytics (OLD `/analytics`)

## 1. What it is
Admin answer to "who's using the app, and where do they spend their time": page views,
active users, logins, mutation counts, per-page and per-person rollups over a picked range.
- Route: `/analytics` → `Analytics` behind `StrictAdminRoute` (Admin/Superadmin, else
  redirect `/`) (OLD `client/src/App.jsx:130-137, :207`); page re-checks and renders
  "Admin access required" for non-admins (OLD `client/src/pages/Analytics.jsx:96-102`).
- Server: `/api/analytics` (OLD `server/routes/analytics.js`, mounted `server/index.js:229`);
  summary reads gated `isAdmin` (analytics.js:20, :41-43); the pageview ping is any-user.

## 2. OLD anatomy

**Data pipeline**
- `page_views(id, user_id FK CASCADE, path, ts)` + ts/path indexes + **180-day sweep on
  boot** (OLD `server/index.js:3164-3178`).
- `POST /analytics/pageview {path}` (analytics.js:23-35): rejects non-`/` or >200-char
  paths; **normalizes numeric segments to `/:id`** so `/releases/123` rolls up (:29);
  ALWAYS answers success — analytics must never break navigation (:32-34).
- Ping source: `Layout.jsx:387-394` — fire-and-forget on `location.pathname` change,
  consecutive-duplicate dedup via `lastViewedPathRef`, skipped when logged out.
- Logins from `user_login_logs` (index.js:1198-1206, written by login endpoints); actions
  from `activity_log`.

**`GET /analytics/summary?days=` (admin)** (analytics.js:38-124) — days clamped 1..365
(:44); six parallel queries: topPages (views + distinct users, LIMIT 15, :46-54), topUsers
(views, `active_days` = distinct days, last_seen, LIMIT 20, LEFT JOIN users w/ 'Deleted
user' fallback, :55-67), logins per user (:68-79), daily series (views + distinct users
per day, :80-89), actions per user from activity_log (:90-99), totals (:100-105).

**Page** (`Analytics.jsx`, 241 lines)
- Range picker pills 7/30/90 days (:12-16, :113-126).
- 4 stat cards (:139-144): Page views · Active users ("viewed at least one page") ·
  Logins ("sessions started") · Actions ("edits, approvals, uploads…") — logins/actions
  summed client-side (:91-92).
- **Daily activity** Recharts AreaChart: views (boom-red gradient) + active-users overlay
  (indigo, no fill) (:147-181); empty state "data starts collecting now" (:151-153).
- **Most-used pages** card: friendly-name map `PATH_LABELS` (~35 paths, keeps labels for
  REMOVED pages so old rows still render named, :19-36; family fallback "X — subpage"
  :37-42); per-row views · N users + proportional bar vs max (min-width 3%) (:185-207).
- **Most active users** table (:210-252): one row per person **merging** topUsers + logins
  + actions by name (:78-89) — Views / Days active / Logins / Actions / Last seen, sorted
  views desc then logins.
- Retention footnote: views kept 180 days; pre-deploy history shows logins+actions only (:255-257).

## 3. NEW status — confirmed absent (CLAUDE.md's own correction is right)
- No `page_views` table, no `pageview` ping, no `/api/analytics` route: repo-wide grep for
  `page_views|pageview` in `cadence/server` + `client/src` → zero hits; `analytics` matches
  only `financials.js:87` (`GET /financials/analytics` — money analytics),
  `ledger.js:1506` (`payment-analytics` — submissions/week), and `platform.js:383`.
- **Boundary**: NEW `GET /api/platform/analytics` (platform.js:382-416) is the operator
  console's CROSS-TENANT growth/top-workspaces feed — a different audience (platform
  operators, not workspace admins) and different question (tenant growth, not page usage).
  It also currently has **no client consumer** — no PlatformAnalytics page exists and no
  fetch of `platform/analytics` anywhere in `client/src` (grep; platform routes in
  App.jsx:122-129 are Overview/Activity/Announcements/Operators/Account) — so even the
  operator surface is server-only today.
- NEW already writes `user_login_logs` (label-scoped, `server/routes/auth.js:36`,
  `server/index.js:937`) and `activity_log` — two of the three data sources exist unread.

## 4. Port requirements
- Schema: `page_views` + `label_id` (add to `TENANT_TABLES` in `server/db.js`), ts index,
  boot sweep — follow OLD index.js:3169-3178 verbatim plus tenancy.
- Server: new `routes/analytics.js` — ping (any user, always-success, `/:id` path
  normalization) + admin summary; every query label-scoped; `user_login_logs` and
  `activity_log` queries already have `label_id` in NEW.
- Client: route ping in NEW `Layout.jsx` (same dedup-ref pattern); `/usage` (or
  `/analytics`) page behind AdminRoute; reuse `Skeleton.StatCards/Block/Table`, Recharts
  (already a dep), `utils/dates.js formatDate`; rebuild `PATH_LABELS` from NEW's route map.
- Retention + the "collects from deploy" footnote should carry over as-is.

## 5. Defects
- [P1] In-workspace usage analytics missing end-to-end — no page_views table, no route ping, no /api/analytics, no admin page (OLD Analytics.jsx 241L + analytics.js + index.js:3164-3178 + Layout.jsx:387-394); CLAUDE.md's M5 claim was already retracted; NEW's login/action sources exist but nothing reads them — fix: new page + route + label-scoped page_views (HIGH)
- [P2] NEW's cross-tenant `GET /api/platform/analytics` (platform.js:382-416) has no client page — the operator-console "Analytics" surface claimed in CLAUDE.md is server-only; adjacent finding, distinct surface — fix: PlatformAnalytics page or delete the dead endpoint (MED)

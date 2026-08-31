# g-notification-bell — notification bell + feed (global shell surface)

OLD: `boom-dashboard/client/src/components/NotificationBell.jsx` (453L) + `server/routes/notifications.js` (398L) + `server/routes/reminders.js`
NEW: `cadence/client/src/components/NotificationBell.jsx` (115L) + `server/routes/notifications.js` (161L) + `client/src/pages/Notifications.jsx` (NEW-only "view all" page)

Route & permissions: global surface — rendered on every authenticated page (OLD Layout.jsx:854 / NEW Layout.jsx:453). Server gating: OLD contracts/renewal alerts approver+ (:42-43), vendor submissions Admin/Superadmin (:248); NEW contracts **Admin-only** (:63), pending approvals approver+ (:74), tasks self-only (:48).

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 1. Layout & structure

**OLD** (:176-451): borderless bell button w/ red count badge → `w-96` dropdown: header row (title + prefs gear + Clear + X, :193-217) → optional preferences panel (6 per-type checkboxes, :219-237) → `max-h-[520px]` scroll of **grouped sections**, each w/ icon+label header: Reminders (w/ per-row Done button) → @Mentions → Smart Alerts (severity-tinted bordered cards) → Upcoming Releases (days-until chip + completion %) → Expiring Contracts (tiered ExpiryBadge) → Vendor Submissions (amount, count in header) → Budget Alerts (% chip) (:239-448).

**NEW** (:60-113): bordered bell button w/ brand count badge → `w-80` dropdown: header row (title + "Clear alerts", :77-80) → `max-h-[60vh]` **flat list** — every item rendered identically (severity-tinted icon tile + title + detail·date), mentions first then computed alerts in server order (:81-109) → footer "View all notifications" → `/notifications` page (:110, NEW-only surface).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Trigger | borderless `p-2`, Bell 18 sw1.75, open state `bg-gray-100` | bordered `p-1.5 border-rule`, Bell 15, no open state | OLD :178-184 / NEW :62-67 |
| Badge | `bg-red-500` min-w-16px, 99+ cap | `bg-brand-600` `text-[9px]`, 99+ cap — alert-red semantic lost (beyond RC-2: OLD's badge is red, not boom) | OLD :185-189 / NEW :68-72 |
| Panel | `w-96 rounded-xl shadow-lg` | `w-80 rounded-xl shadow-modal` tokenized | OLD :193 / NEW :76 |
| Sections | per-kind headers (icon 11 + `text-[10px] font-bold uppercase`), colored per kind (amber Reminders, boom Mentions, amber Zap Smart, violet Inbox Vendor) | none — flat list | OLD :254-425 / NEW :88-107 |
| Smart-alert row | severity card `bg-red-50/orange-50/amber-50 border` + icon-per-type (5-icon map) + severity dot | uniform row w/ 7×7 tinted icon tile (danger red / warning amber / info brand) | OLD :20-38,:308-329 / NEW :9-14,:96-98 |
| Release row | title + artist·date + tiered `{N}d` chip (red ≤3 / orange ≤7 / amber) + orange completion % | title + "Checklist incomplete" + date | OLD :342-361 / NEW server :106 |
| Contract row | artist + type · expires date + ExpiryBadge (red ≤30 / orange ≤60 / amber) | "{artist} {type}" + "Contract expiring" + date | OLD :14-18,:374-386 / NEW server :109 |
| Mention row | "{actor} mentioned you in {room_title}" + quoted snippet, boom-tinted hover | "{actor} mentioned you" + snippet as detail line (no room title — NEW user_mentions has no room_title col) | OLD :284-295 / NEW server :112 |
| Empty state | Bell 24 + "All clear — no pending alerts." | Bell 20 + "You're all caught up." | OLD :244-249 / NEW :82-86 |
| Footer | none | "View all notifications" → /notifications | NEW :110 |

## 3. Copy & content differences

- Header: "Notifications" both; OLD "Clear" w/ CheckCheck icon (:206-211) vs NEW "Clear alerts" (:79).
- OLD smart-alert titles are full sentences with numbers and advice ("X's contract expires in N days and they have M unreleased tracks — consider renewal", :98; "…is N days out with only P% checklist complete — flag to team", :117; "…budget is P% spent with M months left — review spending", :146; rush ":who requested a rush payment for :payee (:amt) — ':reason'", :232; bulk-deal "…looks stalled — P% paid, D/C units received, nothing new in N days", :318). NEW titles are entity names with a fixed detail string ("Checklist incomplete", "Task overdue"/"Task due soon", "Bulk deal stalled (21+ days unpaid)", "Contract expiring", "Vendor submission"/"Awaiting approval", notifications.js:106-110).
- OLD prefs panel copy "Show notifications for" + 6 type labels (:40-47,:221).

## 4. Feature & interaction differences

### Notification kinds computed — enumerated

| Kind | OLD (notifications.js) | NEW (notifications.js) |
|---|---|---|
| Upcoming releases, incomplete checklist | ≤14 days, 14-key checklist, completion % (:10-38) | ≤21 days, 8-col checklist, no % (:9-12,:27-37) |
| Expiring contracts | ≤90d, approver+, own section (:42-57) | ≤60d, **Admin-only**, kind `contract` → `/renewals` (:63-73,:109) |
| Budget alerts (≥80% artist budget) | own section + % chip (:59-78) | — |
| Smart: contract_renewal (expiry × unreleased tracks) | :83-105 | — |
| Smart: release_behind (≤7d & <50%, critical ≤3d) | :107-124 | — (subsumed by the plain release kind, no escalation) |
| Smart: budget_burn (≥80% spent, ≥2mo contract left) | :126-155 | — |
| Smart: task_overdue (ANY user's, w/ assignee name) | :157-182 | `task` — **caller's own only**, due ≤3d or overdue (:44-52,:107) |
| Smart: release_unassigned (≤30d, no owner) | :184-209 | — |
| Smart: payment_rush (critical, everyone) | :211-244 | — (NEW has the rush feature in Payments, no bell alert) |
| Smart: bulk_deal_stalled (delivery-aware: paid>0, under-delivered, 30d since last delivery) | :264-327 | `bulk_deal` — any approved unpaid ≥21d (:53-61,:108) |
| Vendor submissions (vendor_submitted ∧ pending, Admin-only, amounts) | :246-262 | folded into `approval` = ALL pending expenses, approver+, detail varies (:74-81,:110) |
| @Mentions (persisted) | user_mentions `read` bool (:335-345) | user_mentions `read_at` timestamptz, label-scoped (:84-90,:112) |
| Reminders (personal, recurring, Done advances next_due) | :349-358 + reminders.js | — (no reminders table/routes in cadence; grep-verified) |

### Polling / refresh
- Poll: OLD every 5 min (:92); NEW every 2 min (:32). OLD never refetches on open; NEW refetches on open (:47). Socket: NEW refreshes on the `mention` socket event (:37) — NEW-only (chat feature).

### Mark-read semantics
- **Clear-all**: OLD is client-side — a localStorage watermark of the non-mention/non-reminder COUNT (`notif_dismissed_count`), badge = max(0, nonMention − dismissed) + mentions + reminders; per-device, resurfaces when the total climbs past the stale number (:64-66,:104-123). NEW is server-side — `users.notifications_cleared_at` stamped by `POST /notifications/clear`; computed alerts whose row `created_at` predates it are hidden (:23-24,:104,:149-158); cross-device, but an alert whose underlying row is OLD (e.g. a long-pending approval) stays cleared even as its urgency grows.
- **Mentions**: per-item on click both sides; both exempt mentions from clear-all (OLD :143-152, comment :104-108 / NEW :48,:150). API: OLD `POST /notifications/mentions/read {ids:[…]}` bulk, empty = all (:383-396); NEW `{id}` single, omitted = all (:129-147).
- **Reminders**: OLD per-item "Done" → `POST /reminders/:id/done` advances the cadence (:154-167,:251-273). No NEW analog.
- **Per-type preferences**: OLD 6 localStorage toggles behind a gear (smart/releases/contracts/vendor/budget/reminders; merged over defaults so new types default ON) (:40-63,:70-76,:219-237). Absent in NEW.

### Deep links
- Releases: OLD → `/releases` list w/ `state {highlightId, tab:'checklist'}` (:125-128); NEW → `/releases/:id` (server :106) — different but arguably better.
- Contracts: OLD → `/contracts` (:130-133); NEW → `/renewals` (:109).
- Tasks: OLD smart task_overdue → `/team` (:139); NEW → `/my-work` (:107).
- Vendor submissions/approvals: OLD → `/bk/approvals` (:402); NEW → **`/ledger`** (:110) — NEW HAS a dedicated `/approvals` page (its own nav badge, Layout.jsx:280) but the bell sends approvers to the ledger instead.
- Bulk deals: OLD none (row not linked); NEW → `/ledger?focus=:id` (:108). Mentions: OLD `room_path` / NEW `link` — parity.
- Severity: OLD critical/high/medium, sorted severity-first (:329-331); NEW danger/warning/info, no sort — mentions first then insertion order (:116).

## 5. Data layer differences

- Payload: OLD `{total_count, releases, contracts, budget_alerts, smart_alerts, vendor_submissions, mentions, reminders}` (:360-374) — client composes sections. NEW `{count, total_count, items, mentions, smart_alerts, releases, contracts}` — server pre-flattens `items` for the bell and keeps groups for the /notifications page (:114-121).
- OLD queries are unscoped single-tenant; NEW all label-scoped (`req.labelId`) — **[INT]**.
- NEW checklist column set differs (8 cols vs OLD's 14 keys) — release-schema divergence adjudicated in the releases pages, only the alert window (14→21d) counted here.
- OLD mentions carry `room, room_title, room_path` (:338); NEW carries `snippet, link` only (:85-89) — feeds the §2 mention-row anatomy loss.

## 6. Tables & forms (if present)

Only form controls: OLD's preferences checkbox panel (:219-237) — missing in NEW (§7-5).

## 7. Defects found

1. **P1** — Personal reminders absent end-to-end: no reminders table/route/UI in cadence (grep-verified); OLD surfaces due reminders in the bell w/ per-row Done advancing `next_due`, exempt from clear-all (OLD reminders.js; notifications.js:349-358; NotificationBell.jsx:154-167,:251-273) — fix: port reminders.js label-scoped + bell section (+ the statements reminders panel consumer, cf. bank-statements.md). (HIGH)
2. **P1** — Five smart-alert kinds missing: budget ≥80% alerts + budget_burn, contract_renewal (expiry × unreleased tracks), release_behind escalation (critical ≤3d & <50%), release_unassigned, payment_rush (NEW has rush requests in Payments but no bell alert) (OLD notifications.js:59-78,:83-155,:184-244) — fix: cadence server/routes/notifications.js add computed kinds (label-scoped). (HIGH)
3. **P2** — task alerts narrowed to the caller's own tasks; OLD alerts everyone on ANY overdue task with the assignee named (OLD :157-182 / NEW :44-52) — fix: add a team-scope overdue query (respect NEW's department boundary, routes/tasks.js teamFilter). (HIGH)
4. **P2** — Approval alerts deep-link to `/ledger` instead of the dedicated `/approvals` page NEW ships (NEW notifications.js:110 vs Layout.jsx:280 nav badge; OLD → /bk/approvals, NotificationBell.jsx:402); vendor submissions also lose their distinct section/amounts, folded into all-pending `approval` (OLD :246-262,:390-418 / NEW :74-81) — fix: notifications.js:110 link `/approvals`; split vendor_submitted rows into their own kind. (HIGH)
5. **P2** — Per-type notification preferences (gear panel, 6 localStorage toggles, new-types-default-ON merge) missing (OLD NotificationBell.jsx:40-63,:219-237) — fix: cadence NotificationBell.jsx add prefs. (HIGH)
6. **P2** — Contract expiry alerts narrowed Approver→Admin and window 90→60 days (OLD notifications.js:42-57 / NEW :63-73) — fix: notifications.js:63 gate isApprover, INTERVAL '90 days'. (HIGH)
7. **P2** — Dropdown information loss: grouped per-kind sections → flat list; releases lose tiered days-until chip + completion %, contracts lose ExpiryBadge tiers, smart alerts lose sentence-form titles + severity sort, mentions lose room title + quoted snippet styling; panel w-96→w-80 (OLD NotificationBell.jsx:239-448,:329-331 / NEW :81-109) — fix: cadence NotificationBell.jsx render grouped sections + server titles. (HIGH)
8. **P3** — bulk-deal stall logic downgraded: delivery-aware 30-day model (paid>0, under-delivered, last-delivery anchor, paid% in copy) → any approved unpaid ≥21d (OLD notifications.js:264-327 / NEW :53-61) — overlaps missing--bulk-deals' `bulk_deal_stalled` fix line; count once there, tracked here for the bell surface. (HIGH)
9. **P3** — Clear-all semantics changed: client localStorage count-watermark (per-device, count-based resurfacing) → server `notifications_cleared_at` created_at-watermark (cross-device; an old-but-worsening alert stays cleared) (OLD NotificationBell.jsx:64-66,:104-123 / NEW notifications.js:23-24,:104,:149-158) — behavioral deviation; NEW arguably better. (LOW)
10. **P3** — Badge color `bg-red-500` → `bg-brand-600` — the alert-red semantic is lost (OLD's badge is red, not the boom accent, so RC-2 doesn't cover it) (OLD :186 / NEW :69) — fix: NotificationBell.jsx:69 use danger token. (HIGH)
11. **P3** — Cadence drift: poll 5min→2min, release window 14→21d, severity taxonomy critical/high/medium→danger/warning/info w/o sorting, deep-link remaps (releases list+highlight→detail, contracts→/renewals, tasks→/my-work) (OLD NotificationBell.jsx:92,:125-141; notifications.js:27-28,:330-331 / NEW :32; notifications.js:33,:106-116) — fix: only where strict parity wanted. (MED)

Intentional divergences (not defects): all queries label-scoped; mentions `read_at` timestamp + label-scoped mark-read (schema modernization); socket `mention` instant refresh + refetch-on-open (chat/UX additions); "View all notifications" footer + `/notifications` page (NEW-only surface, no OLD analog); mention API `{id}` vs `{ids[]}` shape (same per-item/all semantics).

# Cadence — What Exists (reality map)

Companion to `BUILD_SPEC.md`. **BUILD_SPEC.md = what SHOULD exist. This file = what
DOES exist**, as of the audit on 2026-07-27. Update this file as reality changes; when a
feature reaches spec, move it from a gap table to the "Built" inventory.

Reference app (single-tenant original) lives at
`/Users/johnskead/Desktop/DevProjects/Dashboard/boom-dashboard` — read it when a
behavior is ambiguous.

Overall completion at the 2026-07-27 audit: Foundation ~80% · Finance core ~55% ·
Finance depth ~25% · Label ops ~60% · Cross-cutting ~60% · Mobile ~15%.

## Status — updated 2026-07-27 (post M1–M5 build — spec feature-complete)

**Milestones 1–5 are complete** — the full spec build:

- **M1 Foundation** ✅ — `components/ui/` kit, `Skeleton`, `utils/dates.js` +
  `utils/darkColors.js`; permission templates + presets + `PermissionsManager`;
  user-delete guards + dynamic FK sweep; `vendor_form_token` (+ rotate); dev
  label-scoping assertion; canView parent-grant. (Test users / mock adapter
  intentionally skipped — not needed for Cadence.)
- **M2 Finance core** ✅ — email dispatch + `EmailPreviewModal` + `CcChipInput`;
  dedicated **Approvals** page + `bk_audit_log`; **Payments** (quick filters,
  hold + rush/hold mutex, USD stat cards, split-family cascade, pay-with-proof,
  Send-for-Approval, per-vendor confirmation queue, `vendor_emails`); **Ledger**
  (toggleable persisted columns, rich filters, totals footer, `?focus`, inline
  edit + 20-deep undo, frozen first column); public vendor form **3-step wizard**
  + OG tags.
- **M3 Finance depth** ✅ — **Archive**, **Invoice Search**; **Recoupments** v2
  (drill-down, UFR statement stamping, statement tabs) + **Recoupment Planning**;
  **Financials depth** (trends/pie/top-vendors/per-artist P&L/deltas/CSV);
  **Bulk Upload**; **Artist Campaigns** hub + collaboration (reviewers, comments,
  review inbox); **Recording Budgets**.
  Scoped out: QB import + Ledger matching (not needed), Expense Lookup (covered),
  bulk re-upload (N/A on R2), real-time chat (lighter comment model),
  prior-year/socials (minor).
- **M4 Label ops** ✅ — **Catalog** (year-grouped grid, filters, artwork sync);
  **Dashboard widgets** (`/dashboard/widgets`: task summary, bk widget, releases-
  by-month bar, genre pie, upcoming list) + **My Work** "Waiting on you" rail;
  **Release Tracker** — 7-tab detail (Checklist/Metadata/DSP/Budget/Activity/
  Comments/Details), grouped checklist + completion %, 1–7 tab hotkeys, release
  `assigned_to` owner, DSP notes col, `/releases/:id/activity`; list gets 14-day
  banner, calendar view, filters, progress; **Artist profile** contracts section +
  color-coded devlog; **Deal pipeline** drag-drop + card-detail drawer + `n`
  hotkey (+ `deals.contact`/`links`); **NDA builder** (`/create-nda/:template`,
  3 templates, clause toggles, mandatory-section validation, PDF via jsPDF +
  Word via docx — both lazy-imported; `nda_documents` table + `/api/nda-documents`,
  separate from the `/api/ndas` counterparty tracker); **Contracts** AI clause
  drafting (`/contracts/draft-clause` → `claude.draftClause`) + **Pending→Active**
  promotion.

**Operator lockout hardening** (incident fixes): platform operators live in a
non-deletable **Platform HQ** system label; auth + `/auth/me` resolve operators
by user id (never pinned to a token's `label_id`); workspace-delete MOVES
operators (id preserved) instead of cascading; boot self-heal + break-glass
`RECOVER_ADMIN_*` recovery; client only logs out on real 401s.

- **M5 Collaboration & polish** ✅ — **Usage analytics** (`page_views` route-ping
  from `Layout`, dedup + 180-day sweep; `/usage` page with range picker, stat
  cards, daily area chart, most-used pages, most-active users via
  `/api/analytics`); **Internal requests** (`/requests`, compose→preview→send to
  platform team, `internal_requests` table + email); **Mobile kit**
  (`hooks/useIsMobile`, permission-filtered `BottomNav` + `Fab`, `viewport-fit=
  cover`, safe-area/touch-target CSS; **Ledger + Payments card lists <768px**);
  `hooks/useHotkeys` (Deals `n`, release `1–7`); **persisted @mentions**
  (`user_mentions` table, parsed from release + campaign comments, surfaced in
  the bell + per-item mark-read via `/api/notifications/mentions/read`).

**M6 Messaging (Slack-replacement core)** ✅ — real-time team chat. New deps
`socket.io` (server) + `socket.io-client` (client). `server/lib/realtime.js`
attaches a JWT-authed socket.io server to the same http server (per-user +
per-channel + per-label rooms, presence tracking, typing relay,
`emitToChannel/emitToUser/emitToLabel/addUsersToChannelRoom` helpers).
`server/routes/chat.js` (`/api/chat`) — channels list/create/join, DM
find-or-create, message history/send/edit/delete, emoji reactions, mark-read,
unread count, roster picker; all label-scoped + membership-gated, mutations
broadcast via the realtime helpers. Schema: `chat_channels` (channel|dm),
`chat_members` (last_read_at/muted), `chat_messages` (threads via
`thread_root_id`, soft delete), `chat_reactions`. Client `SocketContext`
(one shared socket, presence Set, `on`/`emit`), `pages/Messages.jsx` (channel +
DM sidebar w/ unread + presence dots, message pane w/ reactions + threads,
composer w/ typing, create-channel/start-DM/browse modals). Nav "Messages" item
(General group) + mobile BottomNav "Chat" tab, both with a live unread badge
(`/api/chat/unread`, refetched on nav + socket `message:new`). Everyone can use
it (`canView` always-allows `/messages`). Dev Vite proxy adds `/socket.io`
(ws:true). **Attachments** ✅ — `chat_attachments` table (R2-or-inline, same as
brand assets); send route is multipart (`upload.array('files',10)`, up to 25 MB,
attachment-only messages allowed); `GET /api/chat/attachments/:id` streams
(membership-gated, `?token=` auth, R2→signed redirect); client renders images
inline + non-images as download chips, with paperclip + drag-drop + paste in
both the main and thread composers. **@mentions** ✅ — reuses `lib/mentions.js`
`recordMentions` (source='chat', link=`/messages/:id`) so chat mentions land in
the existing notification bell + mark-read; `@channel`/`@here`/`@everyone`
notify all channel members; server emits a live `mention` socket event and
`NotificationBell` refreshes on it (no waiting for the 2-min poll); **email
fallback** — mentioned users NOT currently online (per `rt.onlineUsers`) also
get a `chatMentionEmail` (email.js), best-effort, no-op without a provider;
client
highlights @mentions in rendered messages (stronger highlight when it's you)
and offers an `@`-autocomplete popup in the composer (first-name handle if
unique, else flattened full name). **Activity-stream bot** ✅ — `lib/activityBot.js`
`postEvent(labelId,{text,icon,link})` posts a system message (chat_messages
`is_system`+`meta` cols, `user_id` NULL) to a per-workspace `#activity` channel
(auto-created + all members added, ensured on GET /channels) and broadcasts it
live. Wired events: vendor submission → needs-approval (vendor.js), invoice
approved + bulk-approved (ledger.js), deal stage change incl. 🎉 on signed
(deals.js), new release added (releases.js), new teammate joined (auth.js
accept-invite). Client renders bot messages with a violet Zap avatar + "Cadence
· Bot" + `*bold*` + a "View →" deep-link; per-channel **mute** toggle
(`chat_members.muted`, `POST /channels/:id/mute`, excluded from the nav unread
badge) in the channel header. **Object-anchored threads** ✅ — `chat_channels`
gains `entity_type`+`entity_id` (type='object', unique per entity per label);
`POST /api/chat/object-thread {entity_type,entity_id,title}` find-or-creates the
record's thread (entity validated against a whitelist map → its table) + joins
the caller. Reusable `components/ObjectDiscussion.jsx` (imports MessageList /
FileChips / postMessage from Messages.jsx) is an inline live thread — wired into
the **Deals drawer** and the **ledger entry drawer** ("Discussion" tab); trivial
to drop onto releases/artists/campaigns. These threads also appear in Messages
under a **"Threads"** sidebar group (MessageSquare icon). **Operator chat** ✅ —
the whole chat suite is available in the platform console too: scoped to the
Platform HQ (`is_system`) label, so operators chat among themselves with no
tenant leakage. SocketContext now connects for operators; `/chat/users` includes
operators when the caller is a platform admin; PlatformLayout gets a Messages
nav item + live unread badge and `/messages` routes in the platform shell.
Operator `#activity` feed gets platform events via `activityBot.postOperatorEvent`
(→ Platform HQ): workspace created / suspended / reactivated (platform.js).
**Message search** ✅ — `GET /api/chat/search?q=` (ILIKE over `chat_messages`,
membership-gated by join, label-scoped, 40 newest, returns channel context +
dm_peer); sidebar search box (debounced) lists matches across channels/DMs/
threads; clicking loads the window ending at that message (`?before=id+1`) and
highlights it (`msg-<id>` anchor + amber ring). Works in the operator console
too. Follow-ups (not built): external-guest channels, huddles, Slack import.

**Nothing spec-level remains.** Optional polish only: the `/manual` page, deeper
mobile "lighter passes" on secondary pages, AI rate-limit buckets, MIME sniff on
upload. New deps: `jspdf` + `docx` (dynamically imported), `socket.io`(-client).

## Post-spec: task database views + Team Work (2026-08-11)

`/my-work` became a **Notion-style database** and gained a sibling **`/team-work`**.
Both render one shared shell — `components/mywork/TaskSurface.jsx` with a
`surface="mine"|"team"` prop — so the two pages cannot drift. **Zero new deps.**

- **Views**: Board · Table · Calendar · List (+ **Workload**, team only). Group by
  status / priority / due bucket / category / assignee / department; filter chips;
  sort; ~9 toggleable columns. One pipeline in `useTaskView.js`
  (`filter → sort → group`) feeds every view, so group counts, table rows and
  Workload bars are derived from the same array and can't disagree. All of it is
  **client-side by design**: the dataset is one fetch, and `daysUntilLocal` is
  local-calendar so a server-side "overdue" would contradict the board next to it.
- **`components/mywork/`**: `taskFields.js` (pure — descriptors, `dueBucketOf`,
  `matches`/`sortTasks`/`groupTasks`, `groupFieldFor`, `canDropInGroup`),
  `useTaskData` (optimistic patch + exact rollback + 20-deep undo, `z`),
  `useTaskView`, `useTaskDnd`, `TaskSurface`, `TaskToolbar`, `TaskBoard`,
  `TaskTable` (also renders List via `dense`), `TaskCell`, `TaskCalendar`,
  `TaskDrawer`, `WorkloadView`, `TaskCard`, `GroupHeader`, `WaitingOnYou`.
  Presets in `constants/taskViews.js`.
- **Schema**: `tasks` +`notes` +`category` +`sort_order` +`completed_at`, plus its
  first two indexes `(label_id,user_id)` / `(label_id,status)`. New `task_views`
  (per-user named JSONB configs, upsert on `(label_id,user_id,LOWER(name))`,
  modelled on `permission_templates`). `description` stays the title — 5 consumers
  read it as one. `config.surface` is what keeps a team view off the personal page.
- **DnD**: native HTML5, no library, extending the Deals pattern with **intra-group
  reordering** (new to the repo) — drop index from the pointer vs the hovered row's
  midpoint, neighbours read from `group.items`. `PATCH /tasks/:id/reorder`
  `{before_id, after_id}` does integer midpoints on 1024 gaps with a loud
  renormalize branch (floats lose precision silently); `renormalized: true` tells
  the client to refetch once. Requires the Manual sort; disabled <768px (HTML5 drag
  doesn't fire on touch).
- **Team scoping — `department` is now a PERMISSION BOUNDARY, not a label.**
  `teamFilter()` in `routes/tasks.js` is the single source of truth: Superadmin/Admin
  → whole workspace, Approver → own `department`, anyone else → 403. Fails closed on
  a missing department. `?scope=team` is authorized inline (no route middleware —
  see the note in `middleware/tenant.js`). `canMutateTask()` widens the old
  "assignee or admin" rule to include a lead of the owner's department, but **not**
  upward onto an Admin/Superadmin's task; `canAssignTo()` keeps a lead from pushing
  work into another department; unassigning is admin-only. Cross-user mutations hit
  `logActivity`. Consequences: `Team.jsx` can now edit Department inline,
  `DEPARTMENTS` is validated server-side (`lib/constants.js`), and **`token_version`
  bumps on a department change** (`team.js`, `platform.js` make-owner) because
  `department` is a JWT claim that auth middleware does NOT re-read per request.
- **Other endpoints**: `PATCH /tasks/bulk` (gate inside the WHERE; out-of-scope ids
  skipped, count returned so the client can say "n of m"), `/tasks/views` CRUD.
  Every task-returning route goes through the shared `TASK_SELECT` — a bare
  `RETURNING *` would omit `assignee_department` and silently make a just-created
  task read-only, since `canEditTask` reads it.
- **Task threads**: `task` added to `OBJECT_TABLES` (`chat.js`), so `ObjectDiscussion`
  works in the drawer. It is the first entity whose per-ROW visibility is narrower
  than the label, so `/object-thread` gained an explicit task visibility check —
  existence-in-tenant is not sufficient for these.
- **Also fixed**: `MyWork.jsx`'s `new Date(due_date).toLocaleDateString()` TZ shift
  (now `formatDate`); `PATCH /tasks/:id` never re-validated `release_id` in-tenant;
  NaN `:id`/`?user_id` reaching Postgres as `NaN` → 500; `notifications.js` decided
  overdue by comparing a UTC-parsed date against a locally-parsed one (now
  `(due_date < CURRENT_DATE) AS is_overdue` in SQL — one rule, though still server
  timezone, which needs a per-user tz to fix properly); `tasks.csv` in
  `full-export.js` gained `category`/`notes`.
- **Not built**: `pinned` (redundant with drag), multi-value tags (breaks group-by),
  `archived_at` (5 routes would silently over-count), server-side filter/sort,
  a cross-page view engine, subtasks/recurrence, tasks in `search.js`,
  `/team-work` in `BottomNav` (5 slots already full).

### UI defect pass (2026-08-12) — new shared primitives

A follow-up pass on the above. **Three new reusable primitives, usable app-wide:**

- **`hooks/useEscapeStack.js`** — ONE `document` **capture**-phase listener draining a
  LIFO stack of overlay owners. Every other keydown listener in the app is on the
  bubble end (`useHotkeys`, `Layout`'s ⌘K/`g`-nav, `Ledger`, `Approvals`), so
  capture + `stopPropagation` gives Escape to the topmost overlay and guarantees the
  page never sees it. This fixed Escape-in-a-popover clearing a 12-row selection, and
  the drawer + page both firing for one keypress. **Consequence to know: it also
  pre-empts React's synthetic `onKeyDown`, so a React Escape handler on a field
  *inside* a registered overlay will not run — handle it from the overlay's
  `onClose`.** `BottomSheet` now uses it instead of its own listener.
- **`hooks/useFocusTrap.js`** — returns a ref for a dialog panel (which also needs
  `tabIndex={-1}`). Focuses the panel, not its first field; restores focus only
  `if (document.contains(prev))`. Container-`keydown`, **not** a `focusin` sentinel —
  these dialogs open `window.confirm` and OS file pickers, which move focus out of the
  document and back. `aria-modal` + a real trap is the complete fix: no `inert`, no
  `aria-hidden` on the background.
- **`ui/Modal` + `ui/ConfirmDialog`** — portalled, focus-trapped, Escape-stacked,
  scroll-locked. Markup matches the ~35 hand-rolled `fixed inset-0` overlays in
  `pages/`, so they're drop-in replacements for those and for the 34 remaining
  `window.confirm` sites. `mywork/Popover.jsx` (extracted from the toolbar) is the
  anchored equivalent, degrading to `BottomSheet` on mobile.

**Token additions** (`tokens.css` + `tailwind.config.js`), still zero `dark:` variants
anywhere: **`text-brand-ink`** — the accent as *foreground*, since `brand-600` is only
2.6:1 on the dark card; defined as `var()` indirection so `utils/branding.js`'s inline
per-workspace accent still flows through. **`bg-selected`** — opaque multi-select row
tint via `color-mix()` (the repo's first; floor Chrome 111/Safari 16.2/FF 113), opaque
because the table's frozen first cell must paint over the cells sliding under it.
`.btn-secondary` gained the focus ring it never had.

**What was actually broken** (the feature was mouse-only and low-contrast): `TaskCard`
was a `<div onClick>` → now `role="button"` + Enter/Space; the drawer declared
`aria-modal` and did none of the work; the bulk bar's three native `<select>`s fired
`change` on every arrow keypress, so tabbing in and pressing ↓↓↓ applied three
statuses to the whole selection → now menu buttons, plus in-flight disable and
don't-clear-selection-on-failure; the bar sat at `z-50` over `BottomNav`'s `z-30`,
hiding all navigation below 1024px. All metadata was `text-gray-400` (≈2.4:1) and state
words like "Empty" `text-gray-300` (≈1.5:1) → `text-ink-muted`/`ink-faint`; raw
`red/amber/emerald-600` → `text-danger/warning/success`; five `bg-brand-50` fills went
near-white in dark (`text-ink` on them was **1.14:1** — the text was gone) → `bg-brand-500/10`
hover, `/15` state. There was **no filtered-empty state** at all, and the error state
had no Retry. The Workload bar was `open / peak`, so the busiest person was always
full — now absolute against `labels.settings.task_capacity` (default 10, set on
Settings → Team; no migration, `PATCH /api/label` already shallow-merges `settings`),
with an inline-style width replacing an 11-step quantization map.

**Two things a build can't catch, found in review:** `box-shadow` on a `<tr>` is not
painted by Blink/WebKit under `border-collapse: collapse`, so the table's drop-insertion
line never rendered — it now lives on the `<td>`s via a static `CELL_SHADOW` map (and
**not** via `border-separate`, which would silently delete every `divide-y` row
border). And two `!important` background utilities tie on specificity, so `!bg-elev`
beat `!bg-brand-500/15` on stylesheet order and the board's drop-target fill was dead.

**Deliberately not done:** the visual-hierarchy redesign (group labels still outrank
task names; six card paddings; five sub-14px type sizes), keyboard drag-and-drop, and
a `useHotkeys` focused-button guard — that last one would break `ReleaseDetail`'s
click-a-tab-then-press-2 flow, and page hotkeys working while a button holds focus is
standard. Logged for later: in `tokens.css`'s `.dark` block `--color-gray-50` and
`--color-gray-100` are the **same colour**, which is why all 74 `hover:bg-gray-50` and
96 `bg-gray-100` sites app-wide are near-invisible in dark; retuning it needs a
`ui/Badge` neutral-tone re-audit.

---

## Finance depth build (2026-08-27) — five boom-dashboard subsystems ported

Built in one pass from `~/.claude/plans/i-want-to-add-majestic-raven.md` (the
authoritative spec + progress log). All label-scoped, all IF-NOT-EXISTS
migrations. **Not yet deployed at time of writing** — watch the first boot for
migration errors (categories seed, new tables). Pure-function fixtures:
`node server/scripts/finance-fixtures.cjs` (35 assertions, all passing).

**Foundations** — `server/lib/`: `usd.js` (usdOf/rowUsd/rowUsd2 — locked
`fx_rate_to_usd` ALWAYS wins, never silent 1:1; round AT THE ROW),
`artistKey.js` (canonical strip-all key = artist-campaigns' normKey;
placeholder folding; "unknown" is a REAL artist by John's earlier call),
`normalizeBankPayee.js`, `reportFingerprint.js` (dismissals/overrides survive
statement re-uploads), `ledgerSource.js` (IS DISTINCT FROM exclusions;
`movedMatchMethodSql`; OBBBA `reportingThresholdFor`), `bankEvidence.js`
(label-scoped, per-label-account method compatibility, link-aware SETTLES_SQL
behind a boot probe), `seedCategories.js`. **Categories are now DATA**: per-
label `categories` table (kind, ui_group, report_section, contra_of,
section_set) seeded from constants (22 expense / 9 income; order is
load-bearing — deck 1-9 hotkeys index it); `/api/categories` (usage-first
ordering, admin CRUD w/ in-use guard); client `hooks/useCategories` +
`components/CategoryOptions` replaced all 14 hardcoded picker sites; the
public vendor form gets categories via its bootstrap payload. Statement
balances now captured (CSV column, PDF header lines, `POST
/bank-statements/:id/reparse-balance`, manual PATCH).

**Reports** (`/reports`, Approver+) — `routes/reports.js` + `lib/reportRows.js`.
LEDGER-mastered cash basis: every live split slice summed once, family-dated
by root (`parent_id IS NULL` filters DROP MONEY — never add one). Four tabs:
P&L (drill-through on every cell; coverage markers per month from bank data,
null ≠ 100%), Spend by Artist (advances as their own column; `ties_to_pnl`
self-check — client REFUSES to render on mismatch), Balance Sheet (cash from
captured statement balances w/ floor guard; A/R = outbound `invoices` table;
A/P as-of-aware), Dismissed. `report_dismissals` (4 scopes, fingerprint-keyed)
+ `report_month_overrides` (report-only period moves, moved-out-of-range
disclosed). Drill actions: recategorize / set-artist / dismiss / reassign-month.
`rename-category` cascades transactionally + leaves a SEEDED TOMBSTONE
(active=FALSE) so the boot seed can't resurrect the old name. Excel via
exceljs from the same payload as the page. `buildPnl` exported for reuse.

**Matcher v3** (`lib/bankReconcile.js`) — evidence ladder: invoice#/payment_ref
(`refEvidence` w/ the MMDD guard) → email → learned map (raw + `~`-prefixed
descriptor-normalized keys) → alias groups (symmetric Sets) → fuzzy
best-of-aliases. Suggestions scored amount·0.55 + name·0.30 + date·0.15
(evidenceDate = paid ? payment_date : scheduled; 0.5 neutral undated);
calibration held by fixture: exact+name ≥0.90 paid or unpaid, amount-only
≤0.70. One-debit-per-invoice: run-level `used` set, capacity-model 409s
(installments allowed to the family total), `statement_match_rejections`
(fingerprint-keyed "no" that survives re-uploads, recorded on unmatch).
Credits book to `artist_income` (`matched_income_id`, validate-never-coerce
income type). View-time suggestions in `lib/statementSuggest.js` (ordering
load-bearing: uber-eats before Travel, drawdown before distributors).
Swipe review deck: `components/ReviewDeck.jsx` (children-as-FUNCTION) +
`statements/StatementReviewDeck.jsx` (claimed-set 409 self-heal, pointer-
capture guard `closest('button, select, option, a, input')`).

**Bank Matching** (`/bank-matching`, Admin) — `routes/bank-matching.js`. The
work surface: all-statements queue w/ server-computed LIKELY (top ≥0.9,
deduped by target), completion model (matched ≠ booked ≠ open; explained% vs
invoice-backed% — different claims, both shown; `match_method='creator'` is
explained-never-invoice-backed), reverse direction (paid ledger rows the bank
never shows: needs_match / awaiting_statement / missing_statement partition),
multi-invoice attach (`bank_txn_invoice_links` — deliberately NO unique on
expense_id alone), rematch (booked→real invoice via `deleted_by='rematch#id'`
breadcrumb), funding pairs (propose-only, dismisses the BANK leg,
reason='funding'), split-book, duplicate pairs, artist rules (is_overhead =
real null) + no-invoice rules (EQUALITY, never substring). Flags engine
(`lib/statementFlags.js`, 22 checks, fingerprint acks that resurface on
change) + monthly soft close (`statement_months`, ReconciledBadge on
Dashboard/Financials/Reports — renders NOTHING for non-admins) + global txn
search. `GET/DELETE /bank-statements/:id` now `(\\d+)`-constrained — new
single-segment routes break without it.

**Creator Payments** (`/creators`, Approver+) — `routes/creators.js`. A
creator payment IS an expenses row (`entry_source='creator_payment'`,
+`paypal_handle` col). Batch = N SEPARATE rows (PayPal = one statement line
per recipient), all-or-nothing, REQUIRED_FIELDS server-enforced. Directory
counts W9/1099 exposure per creator per CALENDAR YEAR (OBBBA: $600→$2,000
from 2026 — the ledger 1099 report adopted the same rule, an output change).
payment_status+payment_date move TOGETHER; the list patches locally, never
refetches (sorts by payment_date). Convert/unconvert flow for rows born on
campaigns/recoupments (exact source restored from `bk_audit_log`
field/old_value/new_value cols). Creator rows are excluded from /vendors,
/vendor-suggest and /payables; included in 1099/recoupments/campaigns.

**Artist Budgets** (`/artist-budgets`, Approver+) — `routes/artist-budgets.js`.
The budget is SIX SECTION NUMBERS per artist (`artist_budget_sections`,
sections = categories.ui_group); the blur-saved inputs ARE the creation flow;
amount 0 DELETES the row. SPENT ≠ OPEN (unpaid invoices are their own
oldest-first worklist; committed = spent+open; `over_committed` separate from
variance, variance BLANK without a budget). Leaf rows only; rowUsd2 rounded
at the row so both slicings tie. Four bank-evidence states from the shared
`utils/recoupState.js` + `components/BankEvidenceDot.jsx`. Excel = two sheets
from the same `buildSheet`.

**Also**: `routes/financials.js` expense conversions now honor the locked FX
rate (`eUsd` helper; income keeps date-based toUSD — no locked rate there).
`db.js` TENANT_TABLES gained 19 finance tables (several pre-existing ones were
missing). full-export gained categories/report_dismissals/artist_budget_sections.

### Corrections to earlier claims in this file
- **2026-08-31 audit corrections**: the platform console **Analytics page does
  not exist** (the cross-tenant `/api/platform/analytics` endpoint has zero
  client consumers — the "Platform console pages: … Analytics" claim above is
  false). `/manual` **DOES exist** (App.jsx → `components/UserManual.jsx` +
  `server/routes/manual.js` AI-ask) — earlier "missing /manual" notes were
  stale. Mobile BottomNav had **no live unread badge** (the M6 claim above
  overstated it; the badge existed on the desktop nav item only) — **fixed in
  Phase 9**: `Layout` now passes `chatUnread` into `BottomNav` and the Chat tab
  carries the same live count, so the M6 claim is true as of 2026-09-02.

### Build-order Phase 1 (2026-08-31) — runtime + safety valves
- **Local runtime EXISTS now**: `server/.env` points at a throwaway Neon project
  (`cadence-dev-audit` / empty-silence-85456067); NODE_ENV=production only
  because db.js enables SSL solely in production (Neon requires TLS). Break-glass
  `RECOVER_ADMIN_*` created dev@cadence.local as platform owner. Delete the Neon
  project when done — never point this .env at real data.
- **Two fresh-DB migration-ordering bugs fixed in index.js** (found on the first
  clean boot ever — Railway never saw them because its tables pre-exist):
  `labels.owner_user_id REFERENCES users` ALTER ran before `CREATE TABLE users`;
  `payment_installments` proof ALTERs ran before its CREATE. Both moved below
  their CREATEs. The whole finance-build migration chain then ran clean on a
  fresh database (categories seeded 22/9).
- **AR-1 P0 fixed**: `DELETE /artists/:id` is now Superadmin-only, 409s while
  releases reference the artist, and deletes entity_files rows + R2 objects in
  a transaction (verified live: 409 with a release, clean delete after).
- **Approvals Archive built**: new `/approvals/archive` page (AdminRoute) over
  the existing `GET /ledger/archive` — rejected + deleted sections, shared
  search, restore vs back-to-pending semantics with ConfirmDialog; linked from
  the Approvals header. `POST /ledger/entries/:id/restore` now requireAdmin.
- **Live verification**: /api/flags 200 (RC-11 confirmed dead→alive),
  /api/categories 22 expense + 9 income, reports P&L + balance sheet respond,
  bank-matching/creators/artist-budgets all 200 on a fresh tenant.

### Root-cause fix pass (2026-08-31) — from the parity-audit punch list
`_audit/99-punch-list.md` is the authoritative defect register (806 defects vs
boom-dashboard). Fixed in this pass (builds clean, NOT committed):
- **RC-11**: `/api/flags` selected nonexistent `vendors.w9_name` → 42703 → the
  whole /data-quality page 500'd. SELECT now `name` only; `vendor_w9_mismatch`
  stays an always-empty list until a real W9-name source exists (aiScan JSON).
- **RC-8**: `EmailPreviewModal` never rendered — consumers omitted the required
  `open` prop (Approvals.jsx, Payments.jsx). Vendor decisions, payment
  confirmations + mark-sent, and Send-for-Approval emails were silently dead.
- **RC-1**: Inter webfont now actually imported (index.css line 1, weights
  300–800 — same as boom); previously only listed in tailwind fontFamily.
- **RC-5/6**: boom geometry restored on `.btn-*`/`.input`/ui kit — py-2 (was
  2.5), ui/Input fixed h-9, font-medium (was semibold), active: states,
  disabled:50, 150 ms transition-all, input focus border shift + brand-600/20
  ring; cards `rounded-xl` (was 2xl). Cadence's focus-ring a11y additions kept.
- **RC-9 (token half)**: dark `--color-gray-50`/`-100` were BOTH `31 34 44`
  (invisible on card `#1c1f2b`) → now `37 41 54` / `41 45 58` (monotonic under
  gray-200). All 41 `bg-brand-50` + 18 `bg-brand-100` opaque washes swept to
  `bg-brand-500/10`/`/15` — a `.dark` brand override is impossible because
  utils/branding.js writes brand vars as INLINE styles that beat stylesheets.
  Remaining RC-9 per-page work: 213 raw colored tints, Recharts dark tooltips,
  ink-on-wash text pairings.
- **RC-7** (2026-08-31): approval-checklist subsystem ported from boom
  end-to-end (closes APR-1 + DEF-ADDINV-01/-02; the P0s). Schema:
  `expenses.approval_checklist JSONB` (index.js, next to cobrand/artist_campaign)
  — deliberately NOT in the ledger PATCH `EDITABLE` allow-list; written only by
  `server/lib/approvalChecklist.js` (`validateApprovalChecklist` /
  `stampChecklist` / `writeApprovalChecklist`, all label-scoped). The write
  applies the four ANSWERS to their columns: is_bulk_deal, cobrand (+ forces
  `category='Marketing'`), recoupable, artist_campaign — artist_campaign is
  BOOLEAN here (NULL = auto), not boom's TEXT 'Yes'/'No'. **Every approve path
  is gated**: POST `/entries/:id/approve` (validate → write checklist → flip
  status, so the RETURNING row feeds applyBreakdownSplits the DECIDED values),
  POST `/bulk-approve` (per-id `checklists[id]` required — route kept + guarded
  even though the page no longer calls it: an unguarded route IS the bypass),
  and `createEntry` (optional `checklist` in the multipart body, validated
  BEFORE the insert, stored only when the row lands approved — a pending row's
  checklist belongs to the queue approver, not the submitter; response carries
  `checklist_stored`). bkAudit rows include the stamped checklist JSON. Client:
  `client/src/lib/approvalChecklist.js` (rules, cobrand⇒campaign+Marketing
  implication, completeness) + `components/ApprovalChecklistFields.jsx` (4 ticks
  w/ edit-un-ticks pending values, grouped CategoryOptions w/ off-list value
  kept renderable + locked while cobrand, 4 Yes/No pairs nothing-pre-selected,
  context lines) + `components/ApprovalChecklistDeck.jsx` (on cadence's
  ReviewDeck; Skip, complete-before-approve lock, outstanding hint, per-open
  cleared answers, PATCH-on-blur field edits). Approvals page: every entry
  point (row button now "Review", `a`, ⇧A, "Review all/selected") opens the
  deck — no direct flip, no window.confirm; vendor emails queue per approval
  and drain into EmailPreviewModal on deck close. Add Invoice: approver saves
  open a ui/Modal review with the same Fields over the FORM values (edits write
  through + un-tick; artist/song point at split rows while splitting) + a
  blob-URL doc preview; the payload gains `checklist`; non-approvers submit
  straight to pending, unasked. Deviations from boom: no inline side-by-side
  doc panel on the Approvals deck (signed-URL chips open a new tab — cadence's
  file pattern), no socials editor / rush toggle inside the deck (rush lives on
  the card), and boom's per-approve `notes` rider + W9 review deck (APR-10)
  remain unported.
- **RC-10** (2026-08-31): Financials executive depth ported (closes the three
  financials P0s + the P1s in `_audit/pages/financials.md`). New
  `server/lib/financeExec.js` — ONE slice pull (every live split slice joined
  to its family root; `parent_id IS NULL` alone drops children's money) feeds
  `computeExec` AND `rowsForBucket`, so every drill total ties to its card by
  construction; USD via `rowUsd2` (locked FX, never boom's 1:1 fallback); due
  dates are INVOICE-anchored (invoice_date + payment_terms Net-N parse, default
  30 — not scheduled_payment_date); bank-born rows count as spend but are
  excluded from the "received" intake series + the forecast's projected rate
  (a statement upload books weeks of rows at one created_at). Endpoints
  (financials.js): `GET /exec` (day-matched KPIs incl. unpaid pipeline, weekly
  paid/unpaid/received buckets, aging, upcoming 7/30/60, forecast 30/60/90,
  monthly intake cohorts, artist/song/category breakdowns + rep leaderboard,
  category trend, all honoring from/to + artist/category/rep filters),
  `GET /exec/rows?bucket=` (15 buckets incl. `month_YYYY-MM`; slices, capped
  200, full-set total), `GET /filter-options`, `GET /export` (multi-sheet
  exceljs workbook from the SAME exec payload). `/summary` + `/analytics`
  rewritten: slice-join basis, from/to ranges (legacy `period` kept), and the
  **paid/unpaid split on every figure** (totals, categories, vendors, monthly
  series, per-artist). `/analytics` byArtist now groups by `artistBucketKey`
  (fixes the roster-inner-join defect that silently vanished non-roster /
  whitespace-variant / Unassigned money; tail rolls into "Other artists" so
  the column ties to total expenses). Client: rebuilt `pages/Financials.jsx`
  (range picker 3m/6m/12m/custom persisted, basis-disclosure row w/ "Cash
  basis? See Reports →", clickable KPI cards w/ sparklines + day-matched %
  deltas, scope filter bar, page-level error+Retry, ConfirmDialog for income
  delete) + new `components/financials/` (WeeklyChart w/ 4-wk MA + avg
  ReferenceLine + tri-basis tooltip + biggest-week callout, PaymentAging,
  CashForecast, MonthlyRollup sortable w/ Peak badge + summary strip,
  BreakdownSection w/ Artist/Song/Category/Rep toggle + paid/unpaid share
  bars, CategoryTrend stacked area, KpiDrillModal w/ `/ledger?focus=` links).
  `utils/money.js` gains `moneyCompact`. Deviations from boom: monthly-rollup
  "Difference" columns dropped (degenerate — paid+unpaid=received by
  construction under the aligned cohort recipe); `/financials/month/:month`
  drill page NOT built (out of scope per audit — the month drill is a modal
  bucket instead); `/exec/subbreakdown` expandable category mixes skipped
  (drill modal + category toggle cover it); export is 8 sheets, not boom's 14
  (velocity/method/recoupment/full-ledger sheets skipped — recoupments +
  cash-basis detail live on their own pages); windows anchor to the server
  date, not LA. Fixture: scratchpad exec-fixture (14 assertions, all passing —
  split-slice sums, family counts, aging/upcoming/forecast, bank exclusions,
  cohort tie, drill↔card ties).
- NOT yet fixed: RC-3/RC-4 (micro-typography, icon sizes) land per-page
  during rework by design.

### Build-order Phase 2 (2026-08-31) — payment vault + vendor form parity

**Encrypted payment-details vault** (the vendors.md #2 / vendor-submit VS-1 P0):
- `server/lib/paymentCrypto.js` — AES-256-GCM, per-value random IV, `v1:`
  versioned ciphertext. Key from **`PAYMENT_DETAILS_KEY`** (64-hex or base64-32).
  **MUST be set on Railway before deploy** — generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and
  never rotate casually: stored ciphertext under the old key becomes unreadable
  (surfaced as `readable:false`, distinguished from "vendor gave nothing").
  **No key ⇒ degraded capture, never plaintext**: the form still accepts +
  validates details but persists ONLY method + last4 + non-sensitive names with
  `encrypted=FALSE`; full account/routing/IBAN are NEVER written unencrypted.
- `server/lib/paymentFields.js` — pure per-method field specs + validation
  (ABA checksum, IBAN/SWIFT shapes, PayPal), wire split Domestic (ABA+acct) vs
  International (IBAN/SWIFT; acct required only with a bare SWIFT), and
  `comparePaymentDetails` doc-vs-typed verdict (match|mismatch|absent|unscanned).
- `vendor_payment_details` table — **keyed `(label_id, LOWER(vendor_email))`,
  deliberately NOT by name/alias** (a name collision must never pre-fill one
  vendor's bank details into another's form). `updated_from_entry_id` stamps
  which submission last touched the row. In TENANT_TABLES + one-time migration
  moved plaintext `vendors.bank` into the vault (bank name only, encrypted=FALSE;
  no-email rows appended to notes) and **blanked the column**; ledger.js no
  longer selects or PATCHes `bank`.
- **Reveal**: `GET /ledger/vendors/:name/payment-details` is the ONLY decrypt
  site — `requireAdmin`, whitelisted response, and an **audit row PER READ**
  (bk_audit_log + activity_log). Masked summary (method + ••••last4 +
  key_missing) rides the vendor-detail payload for the drawer.
- Entry stamps: `expenses.payment_check` JSONB (verdict + typed/doc last4 +
  `changed_from` {method,last4} when a vendor's details differ from the stored
  row — the invoice-fraud shape) and denormalized `payment_last4`.

**Vendor form parity** (vendor-submit.md §7 — closed VS-1..VS-18, VS-20..VS-22):
`routes/vendor.js` rewritten — payment capture/reuse (`payment-on-file` confirms
without disclosing; `payment_reuse_on_file=true` re-materializes the stored row,
typed always wins), `/roster` (5-min cache) + server-side roster normalization +
`off_roster_artist`, `/validate-w9` pre-submit gate (blocks only DEFINITE
unsigned; falls open), `/lookup` email-gated contact prefill, check-dup advisory
(normalized dup + 30-day/currency similar WITH details), **dup 409 removed**
(VS-2 — advisory + note for the approver instead), doc-missing-number bounced,
Net-30 `payment_terms`/`scheduled_payment_date`, structured `social_handles`
JSONB (explicit "N/A" convention), rep required only when reps exist, song per
row required, canonical-alias `vendor_emails`, 10 MB + extension fileFilter,
multer errors → vendor-readable 400s. `claude.js`: `parseInvoice` takes
categories+roster vocabulary, new `extractPaymentInfo`, `validateW9`.
`VendorSubmit.jsx` rewritten (707 lines): per-method payment panel + "still
correct?" reuse card, RosterPicker (handle-shaped warning, off-roster note),
draft autosave FIXED (meaningful-content gate + paused while resume banner
shows; account/routing/IBAN never in localStorage), debounced W9/dup checks,
ONE AI parse at step 2→3 (was 3 paid calls), prefill-verify banner, named
missing-items checklist, top-level mode toggle, Net-30 success screen +
contact-preserving "Submit another". AP surfaces: **Approvals** card shows a
mismatch/changed_from amber banner + Pay method ••••last4 meta; **Vendors
drawer** payment card (masked → Admin-only Show). Boom's Payments page shows
no last4 — nothing added there. Skipped: VS-19 sandbox/admin-preview (P3,
testing-only). Verified live: encrypt/decrypt round-trip, degraded no-key boot,
reuse-on-file, changed_from firing, audit-per-reveal, vendors.bank blanked.

### Build-order Phase 2 (2026-08-31) — dashboard parity campaign
All 17 rows of `_audit/pages/dashboard.md` §7 closed (4 P0 + 5 P1 + P2/P3;
nothing skipped). Dashboard.jsx rebuilt to boom's layout (space-y-8, greeting
h1, action-card row, gap-6 rows) with cadence-only features kept: welcome
banner, pinned links, widget visibility (`vis()` — two NEW keys
`latest_releases` + `notifications` added to Settings' DASH_WIDGETS), Open
Deals stat, Recent-activity panel, bookkeeping widget (now with boom's
recent-invoices mini list, invoice count, "% of logged", Review now → and Open
Ledger; "Pending QB" stays scoped out).
- **Server (`routes/dashboard.js`)**: new `GET /dashboard/chart?year&genre&
  format` (per-year Jan–Dec domain, same-filters prior-year series, option
  lists, LOWER(TRIM()) matching) and `GET /dashboard/notifications` (computed
  alerts: this-week count, <50%/<25% checklist completion over the 14 cadence
  checklist cols, missing UPC/ISRC/Spotify-URI ≤30d LIMIT 5, expiring
  contracts 60d Approver+ [read-only query — contracts routes untouched],
  expiring `admin_docs` 60d Admin+ w/ Restricted hidden from non-Superadmin,
  overdue tasks, open `internal_requests`). `/widgets` swapped the rolling
  21-day list for `thisWeek`/`nextWeek` calendar-week buckets and dropped
  `upcomingReleases`/`releasesByMonth` (only consumer was Dashboard;
  WaitingOnYou reads `pendingApprovals`, still present). `/` gained
  `teamMembers`; upcoming reverted to boom parity `> CURRENT_DATE`.
- **Bulk artwork sync**: `POST /releases/sync-artwork {days,force,retry}` in
  releases.js — general (Catalog will consume it at CAT-3), label-scoped,
  boom's 2-phase batch (URI lookup then strict search) with 50/100ms pacing,
  `'not_found'` sentinel so permanent misses never re-poll Spotify, transient
  errors left NULL for retry, `remaining` excludes sentinels so the client
  loop terminates. No Spotify keys → `{total:0, disabled:true}` no-op.
  `lib/spotify.js` gained `artworkByRef` (404 = permanent null, non-2xx =
  throw) + `searchArtwork` (boom's strongMatch strict matcher) and a
  case-insensitive/protocol-less `parseRef`. GET /releases gained
  `archived` + `date_from` params. Sentinel guards added at the four
  cover_art_url render sites (Catalog, ArtistProfile, ReleaseDetail, Dash).
- **Client**: Notifications panel (severity icon + left border + color-mix
  wash, Clear all, release deep-links), Latest Releases 14-day carousel
  (spotifyWebUrl parser, hover Spotify badge, relativeDateLabel, Open Catalog,
  sync loop w/ no-progress guard + "Spotify not configured" message), chart
  filter bar + legend + CustomTooltip + YAxis/grid @260px, donut 80/40 w/
  in-slice % labels + 2-col count legend + "N releases" formatter (server
  excludes empty genre again — no more 'Unspecified' bucket), This/Next Week
  buckets + View all, error screen, full-page skeleton, `r` refresh hotkey,
  refetch on `user?.id`, task buckets computed client-side with
  isPastLocal/daysUntilLocal (server counts kept as fallback). ReconciledBadge
  back to boom's bordered emerald-50 pill w/ full month name, inline next to
  the subtitle; amber reopened state kept. RC-3/RC-4 applied on this surface
  (boom's text-[10px]–[13px] + icon sizes). All styling tokens-only
  (ink/elev/divider/semantic + gray CSS vars for chart internals).
- **Deviations**: overdue-task alert counts the VIEWER's tasks only
  (department is a permission boundary — no workspace-wide count);
  "Pending Requests" reads `internal_requests` (cadence's analog of boom's
  distributor requests); admin-doc Restricted filter uses IS DISTINCT FROM so
  NULL-confidentiality docs still alert; My-Tasks/Approvals top-row link cards
  replace the 3-tile "My tasks" widget (vis('tasks') now gates the card);
  Approvals card is Admin/Superadmin like boom even though the bk payload
  serves Approver+.
- Verified live on :3001 (throwaway DB, label 2): all four endpoints 200 with
  seeded fixtures — 7 computed alerts across all severities, filtered chart w/
  prior-year series, week buckets, teamMembers, date_from window, disabled
  sync no-op. `npm run build` clean.

### Build-order Phase 2 (2026-08-31) — contracts parity campaign
All rows of `_audit/pages/contracts.md` §7 closed except CT-11 (skipped —
see below). `Contracts.jsx` rebuilt to boom's two-state page (list ↔ drill-in
detail), keeping the cadence additives (AI clause box, `num_releases` input,
PATCH allow-list, toasts, signed URLs).
- **Schema (`index.js`, all AFTER their CREATEs)**: `contracts.financial_terms
  JSONB DEFAULT '[]'` (CT-4); `royalty_split` restored to NUMERIC(5,2) —
  fresh-DB CREATE changed + a **guarded one-time type migration** (checks
  information_schema; converts free text by leading number, "50/50"→50,
  capped at 100, pure text→NULL) (CT-10); `entity_files` gained `uploaded_by`
  + `file_size`; one-time backfill of legacy single-slot contract files
  (contracts.file_name/r2_key) into entity_files so the multi-file model
  covers old uploads (CT-8). Boot verified clean on the dev DB.
- **Server (`routes/contracts.js`)**: GET `/` gained `?artist/type/status` +
  label-scoped entity_files roll-up subqueries (file_count / latest) + ORDER BY
  expiration ASC NULLS LAST (CT-7, CT-20); new GET `/missing` (3 buckets,
  archived artists/releases excluded), GET `/expiring` (Active ≤90d,
  days_until_expiry) (CT-5/6); POST `/scan` via new `lib/claude.js
  scanContract` (structured-output schema incl. per-field `_confidence`,
  clamped server-side; 503 + `setup_required` without a key) (CT-3); GET
  `/:id/linked` — releases/income by artist_id, ledger by LOWER(TRIM(artist)),
  **leaf rows only** (cadence's split convention, NOT boom's parent_id IS
  NULL) and **USD-converted per row via lib/usd usdOf + round2** (boom summed
  raw amounts) (CT-2); entity_files suite POST/GET/DELETE `/:id/files(/:fileId)`
  + per-file signed-URL GET, legacy file_name/r2_key kept pointed at the
  newest upload (CT-8); PDF-only multer fileFilter on both uploaders with a
  400-shim (CT-13); financial_terms in POST/PATCH via cleanTerms (strips
  `_confidence`, caps 50 rows); DELETE cleans entity_files + R2 and is
  activity-logged (CT-18). All `:id` routes `(\d+)`-constrained. `/renewals`
  untouched (Renewals page consumer); dashboard's read-only expiry query
  untouched.
- **Client**: detail view (CT-1) — Contract Details grid, royalty two-box +
  split bar (brand accent = the label share per RC-2, label name from
  useAuth), notes, LinkedDataPanel (recoupment stacked bar success/warning,
  income offset, releases/income/spend cards, unpaid chip), Financial
  Obligations inline editor, Documents panel (revisions w/ uploader/size/date,
  upload+drop, per-file preview + ConfirmDialog delete). List: Missing +
  Expiring collapsible panels (expiry buckets ≤30 danger / 31–60 warning /
  61–90 neutral — cadence has no third alarm hue), filters card, quick-attach
  card, 8-col table w/ Artist/{Label} split column + Doc preview cell
  (count + Eye 10), inline FilePreviewModal (iframe, multi-file pager,
  Escape-stacked), Skeleton loading (CT-22), distinct error state w/ Retry
  (CT-15), Badge status pills (Expired back to red) (CT-16), formatDate
  everywhere (CT-12), `n` hotkey (CT-19), searchable ArtistSelect combobox
  (CT-23), boom delete confirm w/ file count via ui/ConfirmDialog + busy
  disable (window.confirm gone from the page) (CT-18), hover:bg-elev rows
  (CT-24), RC-3/RC-4 bracket sizes + 10–14px icons, tokens-only styling
  (soft tints use the Badge rgba convention).
- **CT-17 (artist required)**: enforced client-side (Create disabled without
  artist+type, "Unassigned" option removed). Server keeps artist_id optional
  — the Pending Contracts promote flow creates artist-less rows; /missing +
  detail render `(unassigned)` for them.
- **CT-21 (type drift)**: reordered to boom (Recording, Publishing,
  Distribution, Management, Licensing); cadence's 'Producer' kept LAST so
  existing rows stay representable.
- **CT-11 SKIPPED — deliberate**: boom's `syncArtistBudget` upserted an
  `artist_budgets` table cadence doesn't have; the 2026-08-27 Artist Budgets
  subsystem models budgets as user-entered section numbers
  (`artist_budget_sections`) where the blur-saved inputs ARE the creation
  flow. Auto-writing contract advances into it would fight that design —
  needs a product call, not a parity port.
- Verified live on :3001 (label 2): create w/ terms + numeric split, filtered
  list w/ file roll-up, expiring buckets, missing buckets, linked payload
  (releases 4 / during_term 3), PATCH strips `_confidence`, non-PDF upload
  400s, scan 503 + setup_required, delete + 404 after. Legacy row's free-text
  split converted by the migration. `npm run build` clean. NOTE: file uploads
  need R2 (dev box has none — uploadFile throws, same as artists.js).

- **M5 "Usage analytics" was never built** — no `page_views`, no `/usage`, no
  `/api/analytics`. The claim above was false. **Now built for real** — see
  "Phase 8 — activity + settings + analytics" below.
- **M3 "Invoice Search"**: `/invoices` is the outbound invoice CREATOR; the
  search surface now exists at `/invoice-search` (see "Phase 3 — bk-invoices
  port (2026-08-31)").
- **M3 "Archive"**: `GET /ledger/archive` exists server-side with NO client UI.
- **M3 "Bulk Upload"** = the ledger CSV import, not an AI invoice+proof batch
  flow.
- "Scoped out: Ledger matching" under-claimed — a tiered learning bank↔ledger
  matcher lives in `lib/bankReconcile.js` and is now the heart of Bank Matching.

---

## Phase 3 — add-invoice + add-reimbursement parity (2026-08-31)

Closed the remaining §7 rows of `_audit/pages/add-invoice.md` (2 P0 · 16 P1 ·
11 P2 · 7 P3) + `_audit/pages/add-reimbursement.md` (3 P1 · 6 P2 · 6 P3) — one
page serves both modes. The two P0s (checklist review gate client + server)
were already closed by the RC-7 port and were verified, not rebuilt. **Zero new
columns, zero new deps** — every field this pass writes already existed.

- **Server (`routes/ledger.js`)**: `createEntry` now stamps vendor_email/
  address/bank ON THE ROW (not just the vendors upsert), `payment_terms`
  ('Net 30' default) + `scheduled_payment_date` (anchored to SUBMISSION date),
  `paid_by`/`paid_marked_at`/`payment_ref` when born Paid, urgency at create
  (`urgency=rush|hold` or boom's `rush_requested`/`on_hold` booleans — mutex
  400, both dropped when Paid), bulk deal (`is_bulk_deal`+quantity+unit;
  an answered checklist OWNS the flag and qty/unit drop when it's off),
  `social_handles` JSONB (kept even amount-less — Flags' missing_socials reads
  it), artist normalization via `artist_normalization_map` (top-level AND split
  lines). **409 duplicate gate**: `findDuplicateInvoice` (normalized number,
  alias-aware both directions via vendor_aliases canonical/alias, vendor_email
  index, FAMILY-ROOT resolved w/ family amount) unless `force_duplicate`;
  runs BEFORE any R2 write. **Proof → its own `proof_r2_key/proof_filename`**
  (was hijacking the receipt slot — on a reimbursement that column holds the
  claimed receipt). **Multi-receipt**: `receipt_file` maxCount 10; first →
  row columns, extras → `entity_files` ('expense_receipt', label-scoped) +
  `GET /entries/:id/receipts`. Split children now inherit vendor identity,
  payment fields, terms/due, cobrand/artist_campaign/rush/hold, and honor
  per-line `category/description/recoupable` (COALESCE; head slice too).
  Children born Paid get their own FX stamp. `EDITABLE` += bulk qty/unit.
- **Member-reachable helpers** — registered ABOVE `requireApprover` like POST
  /entries (the page is open to any member): `/parse-invoice` (now feeds label
  categories + roster∪ledger artists to the model, post-validates artist
  against the known list, moves @handles to `suggest_socials` w/ `ai_warnings`,
  answers 200 + `ai_status` disabled|error|ok), NEW `/validate-invoice` +
  `/validate-w9` (both FAIL OPEN without AI), NEW `/parse-proof` (date/method/
  ref), NEW `/parse-lines` (line items; **divergence from boom, documented in
  lib/claude.js: amounts are AI-extracted, not PDF-text-deterministic — no pdf
  dep — so the server reports the printed-total tie-out and the client blocks
  save until lines tie**), `/check-dup` (rewritten: alias-aware, family-root,
  exact `match` + same-normalized-different-format `similar` tier), NEW
  `/vendor-w9-status` (alias-aware boolean). `vendor-suggest` (still Approver+)
  now returns email/address/bank (vendors-table overlay) for autofill.
- **Client (`AddLedgerEntry.jsx`, 963 lines)**: parse button open to all
  members and fires parse + validate-invoice + parse-lines together (boom fired
  four); **parsed-value-wins** fill (re-parse can refresh a wrong field;
  `currencyTouched` removed); typed-vs-printed invoice-number mismatch warning
  (client `normInv` mirror); live 500ms dup check + post-parse sweep + rich
  amber banner (family split note, status-aware "Open in Approvals →" vs
  `?focus=` link, pending-not-in-ledger explanation, similar list); 409 →
  window.confirm "Add anyway" → resubmit w/ force_duplicate (checklist
  preserved, NOT re-asked); vendor-suggest chips + exact-match autofill
  (approvers); W9-on-file banner + tile state; W9 auto-validate on attach;
  proof attach sets Paid (approvers) + parse-proof fills date/ref and method
  INSIDE the state updater, proof-remove resets payment fields; editable
  line-items table (tie-out footer, remainder-to-last-line, add/remove,
  discard) — ≥2 usable lines TAKE PRECEDENCE over the artist splitter and
  hide artist/song like splitOn does; urgency segmented control + 500-char
  reason; bulk-deal marker + qty/unit; Ref # in the paid row; vendor email
  required + regex BOTH modes (reimb shows it again); reimb shows optional
  invoice/ref # and dup-checks it; reimb multi-receipt list (count/clear-all/
  per-file remove); reimb date label fixed; non-approver gate (song-or-splits
  + ≥1 social); rep defaults to the current user (injected into options);
  save resets IN PLACE w/ a success banner + ledger/approvals link (no more
  navigate-away); `hooks/useUnsavedWarning` (new) arms beforeunload while
  dirty; split "Add another artist" prefills the remainder. `Dropzone` gained
  accept enforcement on the DROP path (+ error line), label/hint props (were
  silently ignored), `multiple`, and lost its dead `bg-brand-500/10/40` class.
- **Deliberately kept/skipped**: split editor still HARD-BLOCKS unbalanced
  saves (boom warned-only) — cadence's parent-takes-slice-1 family_amount
  model corrupts on unbalanced families, so the block is load-bearing
  (DEF-ADDINV-36/ADDREIMB-12 partially closed: remainder prefill + numbered
  rows done). DEF-ADDINV-31 `autoLinkRelease` SKIPPED: expenses has no
  release_id column and NOTHING in cadence reads one (boom's link powered a
  ledger jump icon + release rollups that don't exist here) — a write-only
  column fails the don't-gold-plate rule; revisit if a release P&L lands.
  Vendor-suggest stays Approver+ (contact/bank autofill is finance-surface
  data; members still get w9-status + parse + dup-check).
- **Also fixed (found live)**: `flags.js` POST /normalization crashed the
  whole process on any 400 — early-return called `client.release()` and the
  `finally` released again; pg-pool throws on double-release OUTSIDE the try.
- Verified: client build clean; `node --check` on ledger/claude/flags; all 35
  finance fixtures pass; live on the throwaway Neon box — checklist 400-before-
  insert, cobrand→Marketing+campaign implication, 409/force_duplicate, dup
  tiers, terms/due stamping, paid stamps, rush-dropped-when-Paid, mutex 400,
  socials JSONB, normalization (top-level + splits), per-line split fields +
  family math (40+60=100), ai_status contract, fail-open validators. File
  uploads 500 on that box (R2 unconfigured) — multi-receipt/proof column paths
  are code-verified + build-verified only. Non-approver pending path unchanged
  (no non-approver user exists in the throwaway workspace).

## Phase 3 — approvals parity (2026-08-31)

Closed the remaining §7 rows of `_audit/pages/approvals.md` (the worst page in
the audit: 1 P0 · 13 P1 · 13 P2 · 18 P3). APR-1..9/15 (checklist deck, RC-7),
APR-14 (payment_check banner, vault campaign) and APR-38 (archive link + page)
had already landed — verified, not rebuilt. **New columns**: `w9_review` JSONB,
`rejected_by`/`rejected_at`, `expenses.release_id` FK. Zero new deps.

- **Annotated queue** — new `GET /ledger/approvals` (the page's fetch): pending
  parents + family_amount, has_invoice/has_w9, alias-aware `w9_entry_id`
  (cross-row W9 chip), read-time **alias silencing** of name discrepancies
  (bidirectional alias graph + whole-word `mentions` for the AI's descriptive
  sentences, `w9_value` handled, summary rewritten when the list empties),
  **stale-amount silencer** (family/breakdown vs document, ±1¢, invoice scans
  only), **unknown_artist/unknown_song** + Levenshtein 1–3 suggestions with
  one-click "Use ‘X’" apply, **possible_duplicates** (normInv across
  vendor_email/vendor_name/payee identities, `?focus` deep links), `usd_equiv`
  (server-side toUSD; null when FX is unconfigured — client hides the suffix).
- **W9 review deck** (APR-10) — the SECOND review: one card per W9 DOCUMENT
  (`GET/POST /ledger/w9-reviews`, alias-aware owner grouping, covers-N-invoices
  list, `no_w9` surfaced), Yes/No **pre-filled from the scan** with
  `prefilled`/`accepted_prefill` recorded (non-boolean → 400), does NOT gate
  approval. Client `components/W9ReviewDeck.jsx` on the ReviewDeck shell
  (Y/N/S/Enter keys); "Review W9s (N)" toolbar button.
- **Approve route**: per-entry **rep-visibility backstop** (`canActOnEntry`, +
  `findInvisibleEntry` on bulk — APR-27), `notes` rider (appended, never
  replacing), **split-before-approve** — payload `artist_breakdown` REPLACES
  the vendor's (file-carrying-child 409 guard, delete + re-apply); pending-child
  approval cascade (single + bulk); **release_id auto-link** by artist+song;
  checklist gate unchanged on every path. Client: SplitEditor stages rows per
  card, deck's `breakdownFor` prop carries them in the approve POST.
- **Reject/restore**: inline panel (multi-line reason, rule-based notify
  pre-check, busy state — no more window.prompt; `r` opens it), reason lands in
  `rejected_reason` AND the `' | Rejected: …'` notes trail, `rejected_by/at`
  stamped (approved_by no longer lied), pending children cascade, restore keeps
  the reason. Archive page prefers rejected_by/rejected_at.
- **Notify is OPT-IN both ends** (APR-30): server auto-sends only on
  `notify === true` (was `!== false` — any caller omitting it silently
  emailed); page toggle defaults OFF; **rep CC** (APR-31) — `/reps` emails flow
  into `ctx.cc` on vendor_approved/vendor_rejected previews.
- **Scan banners**: `isMissingDocClaim` filter, per-discrepancy × (optimistic;
  server single-item JSONB rebuild preserving summary/scanned_at, audited),
  whole-scan Dismiss button, italic summary, `form_type` label, `relativeAgo`
  stamps, rescan warnings surfaced ("Re-scan: <why>"), severity chips on token
  tints. **Rush**: reason prompt + attribution tooltip + fill-state pill +
  server not-Paid 400 + bk_audit entries (set and clear). **Flag-for-review**
  chip (`POST /entries/:id/flag`, optimistic). Off-roster chip. Description
  120-char clamp. File chips w/ real filenames (30-char) + in-app FilePreview
  modal (signed URL → iframe/img). Alias panel (chips + per-alias remove +
  Enter-add + link-payee-as-alias-of-existing-vendor; every change refetches so
  silencing clears immediately). Bulk qty/unit save-on-blur inputs. Edit-in-
  place gains invoice_date/rep/vendor_email(regex)/payment_method/notes +
  `SocialHandlesEditor` (new shared component; `social_handles` added to PATCH
  allow-list w/ JSONB serialization + amount>0 400 guard). Select-all bulk bar.
  "Amount: low" sort (created_at basis restored) + description in search.
  **Recent Activity** panel (`GET /ledger/approval-history`, last 50 from
  bk_audit_log). Hotkeys: focus starts −1, contentEditable + modifier chords
  ignored. Deck gains an optional approval-note input + staged-split notice.
- Verified live on the throwaway Neon box: annotations (dups 14↔15, Ezraa→Ezra
  suggestion, w9_entry_id grouping), checklist 400s (single + bulk), approve w/
  notes + staged breakdown → children inherit vendor_email, W9 review non-bool
  400 + queue drain, reject→notes trail→restore-keeps-reason, rush-on-Paid 400,
  flag, approval-history, PATCH guards. Client build clean; 35 fixtures pass.
  Not exercisable there: scan-dependent paths (AI/R2 unconfigured) — per-
  discrepancy dismiss + missing-doc filter are code/build-verified.

## Phase 3 — payments parity (2026-08-31)

Worked every remaining §7 row of `_audit/pages/payments.md` (30 defects: 10 P1 ·
13 P2 · 7 P3). DEF-PAY-01 (EmailPreviewModal missing its `open` prop) was
already fixed before this pass — verified, not rebuilt. **Zero new columns,
zero new deps.** Ran concurrently with the Approvals campaign in the same tree —
payments edits were kept anchored/regional and both syntax-check together.

- **Server (`routes/ledger.js`)**: `PAID_GRACE_DAYS` 7→14 (boom window) +
  `created_at` fallback in the linger COALESCE so legacy rows don't vanish
  instantly. `/payables` now excludes `bank_statement`/`recoupments`/
  `artist_campaigns`-born rows (money that already left the account — 90% of
  boom's queue before the same fix), and serves `bankEvidenceCols` (per-row
  dot), `inst_paid`/`inst_count` (partial-payment progress) and `usd_equiv`
  (locked-rate-aware, on the FAMILY total). `payment-stats` rebuilt: same
  population as the list (heads only, same exclusions, family totals — split
  children no longer counted as invoices), plus **never-netted per-currency
  `native` captions** per bucket and **Paid This Month** (calendar month;
  window widened just for it). Found+fixed en route: pg DATE columns are JS
  Dates, so the route's old `String(date).slice()` compares were silently
  garbage ("Wed Aug…") — `iso()` helper now. **mark-paid / batch-pay /
  pay-with-proof**: `paid_marked_at` is EDGE-ONLY (re-marking keeps the stamp)
  and Paid **clears rush+hold** across the family. batch-pay is multipart-
  tolerant: `payment_ref` + ONE proof file stored once and linked on every
  selected head (boom's proof-to-all). Rush/hold: Paid guard on hold (rush
  already had one from the approvals pass), 500-char reason caps, bulk routes
  skip Paid rows and answer `{rushed|held, skipped}`. **send-for-approval**:
  counts FAMILIES not slices, Excel grew to 11 cols + bold per-currency TOTAL
  rows, email body gains Totals-by-Artist + per-invoice tables (`tablesHtml`
  through `approvalRequestEmail`), subject override + note. **Confirmations**:
  shared `sendVendorConfirmation(req, ids, override)` — family totals (never
  the parent's slice), invoice+proof ATTACHMENTS, **proof gate** (entry proof /
  legacy receipt / installment proof; 400 naming the offenders unless `force`),
  marks whole families notified, audited; `/entries/:id/send-confirmation`
  upgraded onto it and new `POST /send-vendor-confirmation {ids,…}` sends ONE
  combined email per vendor (bulk_payment_confirmation); legacy per-entry bulk
  route kept for API compat. New `GET /payments-export?filter=` — Excel, rep-
  visibility honored, TOTAL-unpaid rows.
- **Templates**: `paymentConfirmationEmail` renders an invoice table + total
  for the multi-invoice form and an optional note; `approvalRequestEmail`
  accepts `tablesHtml`. `EmailPreviewModal` gained an optional per-item
  `noteField` (additive prop — Approvals unaffected).
- **Client (`Payments.jsx` 491→~1250 lines)**: ONE fetch serves every chip
  again (Paid tab = the same 14-day window the subtitle promises, not all-time
  history); Unpaid chip includes held rows (chip now agrees with the card);
  **Multi-invoice chip** + per-vendor "N open" chips (family-counted from the
  full set, held excluded but tooltip'd, ⚠ on mixed currency/method,
  click-to-isolate). Toolbar: search, **amount grammar** (`500`, `500-1000`,
  `>500`, `<=250`, amber ring on invalid — a typo never wipes the list),
  method/status/rep(+"No rep") filters, 6 sorts (amount sorts compare the
  served USD equivalents), group-by method/status with header rows.
  **Calendar view** (month grid, overdue/due/paid chips, +n more, Today).
  Stat cards: native captions + Paid This Month. Table: **frozen first cell**
  (checkbox+date+payee+amount, opaque bg + edge shadow — shadow on the cell,
  not the row, per the border-collapse landmine), method badges, due-soon
  warning tier, **status-pill popover** (Paid / Partially paid… / Unpaid —
  restoring the page's only un-pay path), BankEvidenceDot, ≈USD row suffix,
  split ▶ expansion (lazy `?parent=` children), confirmation column on the
  main view, inline **row edit** (12 fields, amount>0 guard, diff-PATCH),
  delete→archive, and a **6s undo toast** for pay/unpay/delete. Rush/hold get
  a real modal (context block, capped reason + counter, bulk totals +
  first-3 payees; **Cancel no longer applies the flag** — the old
  `window.prompt(...) ?? ''` did) and badges carry reason+by+date. 10s rush
  grace after paying a rush row. **Installments UI on the page**: Receipt
  action + paid/total progress + full modal (family total / paid / remaining
  w/ overpaid-red, table w/ method badge + mono ref + proof + delete,
  multipart add form). Confirmations: eligibility = paid+email+proof+not-sent
  (bulk reports skips; single resend/no-proof asks first), **grouped by
  vendor** into one combined email, manual "mark sent" + Sent-undo
  (mark-unsent — previously a zero-caller route), CC = saved vendor emails +
  rep toggle + **persisted default-CC list** (localStorage — divergence from
  boom's server-side user pref, noted). **Persistent bottom bar**: always-on
  Filtered-Unpaid + Selected totals (per-currency + ≈USD), Select all /
  Select pending confirmations (N) / Clear + bulk actions incl. paid-pending
  selection. Send-for-approval flows through the preview modal with the note
  field. **Mobile**: search + FilterSheet (amount/method/status/rep/sort) +
  tap-to-open **PaymentSheet** detail drawer (all fields + every action incl.
  proof upload + confirmation controls), bulk bar fixed above BottomNav.
  Escape-stacked modals throughout.
- **Verified live** (throwaway Neon): payables shape (evidence cols,
  inst sums, family_amount, native stats USD+EUR never netted), paid-this-
  month after the Date fix, rush→pay clears the flag, paid rush/hold → 400,
  bulk `{rushed:1, skipped:1}`, edge-only `paid_marked_at` (re-mark keeps the
  stamp), batch-pay ref stamped family-wide, payments-export 200 w/ real
  xlsx, confirmation proof gate 400 naming the invoice, single/bundle/
  approval sends run to the provider boundary (no SMTP on this box),
  bulk-confirmation template renders both invoices + total subject. Client
  build clean; fixtures pass. Deferred: server-rendered contentEditable HTML
  preview + html_override for confirmations (DEF-PAY-20 partial — note field
  + subject/To/CC editing shipped; body editing needs an EPM surface shared
  with Approvals, better done in a dedicated EPM pass).

## Phase 3 — ledger parity (2026-08-31)

Closed the `_audit/pages/ledger.md` §7 register (31 rows) against boom.
Surfaces: `Ledger.jsx` (rewritten, ~1560 lines), `SplitModal.jsx`,
`LedgerEntryDrawer.jsx`, `routes/ledger.js`, `index.js` migrations.

**New expenses columns** (IF-NOT-EXISTS after the CREATE): `in_quickbooks`,
`qb_entry_date`, `recoupment_label` (tone labels), `no_auto_split` (unsplit
guard), `settlement_group_id`. All in the list column set; the first four in
the PATCH allow-list (settlement_group_id writes only via its routes).

**Server** — EDITABLE grew to boom vocab (paid_by / ufr w/ `ufr_marked_at`
stamping / artist_campaign / recoupment_label / release_id validated in-tenant /
QB / bulk_deal_completed); PATCH gained cobrand⇒Marketing forcing (LED-7),
**server-side comma+slash song auto-split** (even cents, remainder-to-FIRST,
children inherit approval+payment stamps, guarded by `no_auto_split` which
unsplit now sets — LED-16) and `autoLinkRelease` on artist/song edits
(response carries `split_parts` / `linked_release` for the toast — LED-18).
`GET /entries` now serves `LEDGER_VIEW_COLS` (scan/checklist JSONB trimmed to
`ai_flags`/`w9_flags` counts), `?limit` (400 on garbage), voided-child-excluded
`family_amount`, `receipt_count`, alias-aware `w9_entry_id`,
`settlement_group_size` (LED-28/27/11); new `GET /entries/:id(\d+)` full row
feeds the drawer's AI-scan tab. New routes: `POST /entries/bulk`
(BULK_FIELDS whitelist {artist,song,category,payment_method,in_quickbooks,
recoupable}, comma-in-bulk-song 400, rep-visibility gate, previous[] one-action
undo payload, autoLink relink count — LED-1); settlement groups POST/DELETE
(same-vendor + roots-only + not-already-grouped, gid = min id, ungroup never
touches bank matches — LED-13); `DELETE /entries/:id/file/:type` + extra-receipt
POST/DELETE via entity_files (LED-11); `POST /entries/:id/split-fee-reimb`
(fee+reimb=total, receipt REQUIRED, is_reimbursement child carries it;
re-split refuses while it exists; unsplit pulls the receipt back — LED-32).
Split is now a **re-split** (replaces children transactionally, validates
against the FAMILY total, refuses on child files/installments, keeps the
ORIGINAL origin snapshot — LED-17). Void/unvoid: requireAdmin, family cascade,
payment_status preserved (LED-27). 1099 counts split slices (dropped
`parent_id IS NULL` — LED-3). Export rework (LED-2/12): CSV = family totals +
child_artists agg, voided excluded, honors q/category/artist/status/
payment_status; plus `GET /export-xlsx` (branded, All/Unpaid/Paid tabs) and
`/export-invoices-zip` + `/export-w9s-zip` (filter-scoped, 300-file cap,
R2-miss degrades to a smaller zip).

**Client** — bulk selection in the frozen first cell (select-all over the
FILTERED set w/ indeterminate, selection re-intersected on read, USD total,
"N below the visible rows" honesty w/ the paint window) + bulk bar (Set
artist/song/category, QB ✓, Not recoupable, One payment, Clear) + bulk undo
regrouping previous[] by held value. Manual FlagButton + reason modal + 4-way
flag filter (flagged/unflagged/AI) — the old ⚠ filter was AI-only (LED-4).
Amount grammar fixed to boom semantics (bare=exact ±0.005, strict >/<,
>=/<=, $/comma strip, amber invalid state — LED-5). Inline edit gained payee/
date/currency/paid-by/date-paid/due-date (back-writes terms='Custom')/terms
select (derives due via TERM_DAYS mirror)/socials popover (SocialHandlesEditor
→ `social_handles`; socialsOf now reads social_handles first and skips the
{origin,splits} snapshot) and YN CHIPS for recoupable/UFR (N/A when not
recoupable)/campaign (3-state)/reimb/cobrand/bulk/QB (LED-8/6). Source buckets:
one `sourceOf` resolver shared by the new Source column badge + tinted filter
(campaign/vendor/expense/reimb/manual — LED-15). Incremental render (150-row
window, IntersectionObserver sentinel, "showing N of M", ?focus cap-stretch —
LED-9). `?focus`: split-child focus fetches the row, expands the parent,
spotlights the child; pending/missing banner points at Approvals/archive; URL
param stripped after the 6s highlight (LED-10). File cells: Remove ✕ w/
confirm, shared-W9 "View (shared)" + bordered Upload-targets-THIS-row, split
children "Open (family)" invoice, dedicated Proof column, reimb-only N/A
receipt gate + "+N more" receipts modal (LED-11). Export menu (Excel/CSV/
Invoices ZIP/W9s ZIP) carrying live filters; hotkeys `c` columns / `x` export
(bubble phase — LED-12/24). Duplicate-invoice banner from `/flags`
invoice_dupes w/ severity chips + per-entry ?focus links + Duplicates-page
link (endpoint is admin-gated; non-admins simply don't see it — LED-14).
Toolbar: Clear-ALL button, QB + UFR-marked advanced filters, normalized-inv#
search (client normInv mirror), 10s-throttled window-focus silent refetch
(LED-21). Sticky table header + sticky TOTAL footer w/ frozen TOTAL cell;
totals magnitude-ordered + ≈USD line (+n unconverted); precise-USD tooltips on
amounts, family-aware amount sort + USD col (LED-20/22/31). Column defaults
expanded to 18; payee/amount always-on and unhideable (LED-23). Delete =
ConfirmDialog w/ payee+amount+family note (LED-26). Paid pill static on
rejected/voided rows (mark-paid requires approved — LED-29). Undo rework:
multi-field patch records, cyclePaid/toggles undoable, undoLast runs OUTSIDE
setState (StrictMode double-fire fixed), split-children patched optimistically
via applyLocal (LED-19). SplitModal: Split evenly (N) cent-exact
(remainder-to-first), breakdown prefill, re-split validates the family total
(LED-30). Mobile: BottomSheet FilterSheet (full filters + sort presets),
100-row Load more, flag dot on cards (LED-25). Per-artist song datalist from
releases+entries (falls back to all songs). Drawer: fetches the full row for
scans, detailed void/unvoid confirm copy, void button admin-only.

**Skipped / N/A**: recoupment-plan deep link (cadence planning is
server-computed `/financials/planning`, no localStorage plan to rehydrate);
duplicate-PAYMENT warning on paid-cycle (bank-half surface per the audit);
per-edit 5s toast-undo (persistent undo bar + `z` covers it); boom's 6-field
frozen block (single frozen first column is the deliberate cadence design —
checkbox+flag moved INTO that cell instead). Rep-visibility/tenancy/
signed-URL divergences remain intentional. Verified: client build clean,
`node --check` on ledger.js + index.js, finance fixtures pass (35),
live smoke on throwaway Neon (list/limit/bulk/settlement/carve/re-split/
void-cascade/1099/exports/approvals/payables all 200).

## Phase 3 — create-invoice + upload-rules (2026-08-31)

Closed `_audit/pages/create-invoice.md` §7 (all 15 rows) and
`_audit/pages/upload-rules.md` §6 (all 13 defect rows; DEF-RUL-11's
separate-page placement stays a panel — an §7 intentional divergence — but its
missing capabilities are closed).

**Create Invoice** — ported the **payment-terms engine** as
`server/lib/payment-terms.js` (Due-on-receipt/Net 15-90/Custom, date-only
UTC arithmetic, `printed()` "June 10, 2026 (Net 30)"); multi-tenant twist:
`businessDay(v, tz)` takes the label's tz from `labels.settings.business_tz`
(default America/Los_Angeles), formatter cached per tz. `routes/invoices.js`
gained `GET /terms` + `GET /due-date` (label-scoped `invoice_id` anchor);
POST/PUT DERIVE `due_by` (dropped from the PUT allow-list — the printed
deadline and the terms can no longer disagree) and every returned row carries
`invoice_date = businessDay(created_at, tz)` so the client does NO date math.
Schema: `invoices` +`payment_terms` +`due_date`, and `created_at` migrated
TIMESTAMP→**TIMESTAMPTZ** via a type-guarded DO block (re-running `AT TIME
ZONE 'UTC'` on an already-tz column would shift values); POST pins `created_at`
to the instant the business day was read from. Client rewrite: terms select +
custom date + live server-computed due string; **jsPDF** selectable-text
download (lazy-imported, deterministic `Label-Invoice#0007-Payee.pdf`,
accent-colored header, both routing lines) replacing the popup+print; shared
`InvoicePreview` used by live preview / **full-document card view** /
**preview modal** (ui/Modal — Eye no longer duplicates Pencil); 3-state
Unpaid→Paid→**Partial** cycle w/ optimistic patch (Badge-recipe token tints);
meta hotkeys ⌘↵/⌘⇧L/⌘P via a local listener (shared `useHotkeys` deliberately
ignores modifiers) incl. the in-flight requestSubmit guard; $0 comp invoices
allowed (validate on line presence, `amount !== ''` filter); `Intl.NumberFormat`
currency w/ unknown-code fallback; Skeleton loading; min="0" amounts;
payee-named edit subtitle; trash hidden at 1 row; in-form running Total.
`invoice_settings` gained **`routing_ach`** (Settings → wire/ACH split; PATCH
/label stores the object whole, no server change). Live-verified: an invoice
raised at 03:14Z prints invoice_date 2026-08-31 (LA) — the after-5pm case.

**Upload Rules** — the safety layer around the four rule tables, ported into
the Bank Matching surface. New `server/lib/uploadRules.js`: label-scoped
`loadInvoiceCensus` (real + waiting-unclaimed per payee), `loadEverInvoiced`,
`loadNoInvoiceRowIds` (row `no_invoice` flag), `bookPatternFor` (provable
descriptor pattern: payee_guess vs longest distinctive token, ≥75% coverage,
≤25% cross-category conflict share, noise list + the LABEL'S OWN NAME tokens
per tenant), `buildRuleSuggestions` (MIN_TIMES≥3 mining, 60% majority guard,
invoice-census split into match/category+pairing/no-invoice/dismiss/artist,
union-deduped clears; human decisions = booked w/ `match_method IS DISTINCT
FROM 'rule'`, machine dismissals 'internal'/'auto' excluded),
`annotateCategoryRules` (per-rule queue_rows/queue_usd/ledger_payees w/
real_invoices + clears). `bank-matching.js`: `GET /rule-suggestions`;
category + dismiss rules got standalone CRUD (`/category-rules` w/
`?annotate=1`, `/dismiss-rules`), POST /category-rules writes **both halves
or neither** (vendor no-invoice pair, rollback on failure); no-invoice POST
now validates scope (400, never coerce), takes a `patterns` batch
all-or-nothing, ≥2-char floor, upsert instead of DO NOTHING; **artist-rule
retro is now reviewed-`entry_ids`-only** (server re-verified, per-row
`autoLinkRelease` — exported from routes/ledger.js — requested/skipped
accounting; the `LIKE '%pattern%'` history sweep is GONE); every rule
create/delete hits `logActivity`. Completion: `ruleHit` tests exp_payee AND
payee_guess (both, not a fallback chain); `category_candidates` now require
the **never-invoiced census** (zero invoicing vendors) and carry n·$·vendor
evidence. `bank-statements.js`: book-with-rule is guarded by an ever-invoiced
check (booking lands, rule refused + named in `rule_skipped`; pairs via
`no_invoice_pattern`); book/dismiss side-effect rules enforce ≥3 chars.
Client: `RulesPanel` (BankMatching) is now the full BkRules surface —
suggestions sections (match-don't-rule w/ "Work these" → sets the page's
needs-invoice filter; BOOK+NO-INV accepts w/ relabels/covers-N-of-M/conflict
confirms; evidence-carrying category-candidate + vendor chips w/ quantified
confirms; dismiss/artist), unified in-force list (all four kinds, creator +
date, feeding-the-queue amber, pair-it action, consequence-naming remove),
error banner + retry (no more `.catch(() => {})` empty-list misread);
BankStatements rule deletes + EntryModal surface confirms/`rule_skipped`.
Skipped: DEF-RUL-11's "dedicated page" placement (INT per §7 — panel-on-work-
surface is cadence's call; the missing capabilities themselves are closed).
Kept contracts: EQUALITY-never-substring, `statement_artist_rules` NULL+
overhead semantics, ingest ordering (rules after auto-match), vault/checklist
untouched. Verified: build clean, node --check, fixtures 35/35, live smoke on
all new endpoints (suggestions/annotate/batch/paired/bad-scope-400).

## Phase 3 — bulk-upload port (2026-08-31)

Boom's `/bk/bulk-upload` (AI batch invoice+proof ingest) ported as **`/bulk-upload`**
(Approver+, Bookkeeping nav, `pages/BulkUpload.jsx`). Five-phase wizard:
two drop zones (invoices required, proofs optional) → sequential AI parse via the
EXISTING `/ledger/parse-invoice` + `/ledger/parse-proof` (one multipart request in
flight — stays clear of MAX_CONCURRENT_UPLOADS) → proof auto-match (payee AND
amount, boom's normalized-substring + |Δ|<0.02 rules) → editable review grid
(include/payee/amount/date/inv#/**dup chip**/one-payment letter/category via
`CategoryOptions grouped`/artist/song/proof match-unmatch/status) → chunked
submit → done screen (per-entry failures "no row was created", settlement-group
results BOTH ways, pending-→-Approvals note).

Server: **`POST /api/ledger/entries/batch`** in `routes/ledger.js` (kept there —
it reuses 8 module-private helpers: storeFile/findDuplicateInvoice/
normalizeArtist/autoLinkRelease/bkAudit + computeDueDate/stampFxRateAsync/
upsertVendor). Multipart `upload.array('files', 40)`, ≤20 entries/request
(client chunks at 8, sequential, one 503 retry — the upload guard asking to
wait); each entry names its documents by per-request index. Per-entry isolation:
dup gate (same alias-aware `findDuplicateInvoice`, per-row `force_duplicate`),
files upload BEFORE the INSERT (failure ⇒ NO row — same invariant as boom's
insert-then-DELETE, residue is an orphan R2 object not a phantom row; insert
failure after upload best-effort deletes the objects), `entry_source=
'bulk_upload'` (safe: all exclusions are IS DISTINCT FROM / NOT IN lists),
Net-30 due date, upsertVendor, autoLinkRelease, `bkAudit 'bulk-upload'`,
one `logActivity` + activity-bot post per batch.

**Deliberate divergences from boom**: rows are created **`status='pending'`** →
the Approvals deck reviews them with its checklist (RC-7; boom created them
approved — no direct-approve-in-grid, so no grid-of-checklists). Proof-matched
rows still land Paid (route is behind requireApprover, same population
createEntry lets mark paid at create) + `stampFxRateAsync`. "One payment"
letters (A–E) resolve CLIENT-side onto the existing
`POST /ledger/settlement-groups` with the created ids (ref-echo maps rows across
chunks) — one grouping mechanism (`settlement_group_id`), no boom
`settlement_group` string column; refused groups reported, never silent. Files
ride multipart as File objects (no base64 → no express.json limit concern).
Review grid ADDS live dup chips (`/ledger/check-dup` exact+similar tiers,
re-checked on payee/inv# blur). `parse-proof` response gained `payee`
(schema always extracted it; auto-match needs it — additive for AddLedgerEntry).

**No schema changes.** Degrades: AI off → `ai_status:'disabled'` banner, blank
rows for manual completion, files still upload; R2 off → per-entry clean failure
(verified live: "File upload failed — …Bucket", zero rows). Wiring: App.jsx
route (AdminRoute), Layout nav + PAGE_LABELS, constants/pages.js Bookkeeping
group + Bookkeeping/AP preset. Verified: build clean, node --check, fixtures
35/35, live batch create/dup-gate/force/settlement-group/Paid-fields/
approvals-queue-pickup on the dev Neon.

## Phase 3 — bk-invoices port (2026-08-31)

Boom's `/bk/invoices` (browse/search-ALL-invoices index) ported as
**`/invoice-search`** (Approver+, Bookkeeping nav, `pages/InvoiceSearch.jsx`) —
named to never collide with `/invoices`, which stays the OUTBOUND invoice
creator. One row per invoice FAMILY (parents only, children folded into the
family total), searchable from any angle: payee / invoice # / description /
artist substring PLUS normalized invoice-number equality ("Invoice #NRM-2" and
"nrm.2" both find "NRM-2").

Server (`routes/ledger.js`, no schema changes):
- **`GET /api/ledger/invoices`** — label-scoped + rep-visibility like the main
  list; params `search`, `from`/`to`, `basis` ∈ invoice_date (default) |
  created_at | payment_date (the range filters on the same column a clicked
  chart bar bucketed by; created_at compared on `::date` so Sunday-evening
  intake lands in its week), `status` ∈ approved (default) | rejected |
  pending. Family `amount`, `split_count`, has_invoice/w9/proof + filenames,
  alias-aware `w9_entry_id`, and rejected_at/by/reason straight off the row
  (boom's bk_audit_log LATERAL unnecessary — cadence stamps rejection columns).
  **Normalized invoice matching stays JS-side** (lib/normalizeInvoiceNum is the
  one definition, never re-expressed in SQL): when it could apply, the query
  also pulls invoice-number-bearing rows in scope as candidates and the filter
  + 200-cap run after; without a search the cap is SQL `LIMIT 200`.
- **`payment-analytics` extended** (Payments.jsx contract preserved — `week`/
  `count`/`amount` unchanged, paramless default still 12 weeks): optional
  `?from/?to` (missing side filled 12w out, 2-year clamp, garbage → default
  window), per-bucket `week_end` + vendor/admin split (counts + USD sums —
  the click-to-filter contract needs week bounds). Amounts are now FAMILY
  totals at the parent's locked rate (`fam` LATERAL), and voided rows are
  excluded (both small output changes to Payments' charts, both corrections).
  **Params are built per series** — the paid bucket doesn't reference tz, and
  an unreferenced $n is a Postgres 42P18 error, not a no-op (hit live).

Client (`InvoiceSearch.jsx`): two weekly Recharts charts (intake by created_at,
outflow by payment_date) fed by ONE analytics fetch so the ranges stay
apples-to-apples; stacked vendor-portal/staff-entered bars; **click-a-bar
filters the list** to that Mon–Sun week on the chart's basis (same-bar click
toggles off, selection dims other weeks, highlight only when the active basis
matches so manual date edits never leave a stale one); range picker chips
4w/12w/26w/52w/Custom persisted to `invoice_search_chart_range_v1` (presets
count `(N-1)*7` back — server week-snap is inclusive, so 12w = 12 bars);
per-chart collapse keys. Toolbar: 300ms-debounced search, from/to (reset basis
to invoice_date), count, table/cards toggle (cards default on mobile), Clear.
Filter banner with "the week of Jun 22" phrasing for exact Mon–Sun spans.
Boom's fetch-generation race guard + first-load-only skeleton (refetches never
unmount the focused search box). File chips: view via signed URL
(`GET /ledger/entries/:id/file/:type`), replace/upload-when-missing (POST same
path), W9 follows the canonical `w9_entry_id || id` cross-entry rule. Rows
click through to **`/ledger?focus=<id>`** (the drawer surface — replaces boom's
inline-only cells; the focus-miss banner routes pending ones to Approvals).
Rejected audit tail: collapsed-by-default, refetched on expand, Rejected
(date + by) / Reason ("no reason recorded" fallback) columns.

Wiring: App.jsx route (AdminRoute), Layout nav + PAGE_LABELS, constants/pages.js
Bookkeeping group + Bookkeeping/AP preset. Verified: build clean, node --check,
fixtures 35/35, live on dev Neon (default/ranged analytics, plain + normalized
search, basis-week filtering, rejected list, family totals on a split).

---

## Phase 4 — bank-statements (2026-09-01) — parity defect pass

Closed the `_audit/pages/bank-statements.md` §7 register (21 of 24 DEF-BST rows
closed; 03/23 partial as noted). Files: `routes/bank-statements.js` (~1,900 ln),
`lib/bankReconcile.js`, `pages/BankStatements.jsx` (~1,100 ln), NEW
`lib/statementPdfText.js` + `lib/statementAudit.js`, plus `index.js`
(migrations + nightly sweep), `notifications.js` (due reminders in the bell),
`db.js` (TENANT_TABLES).

- **Deterministic parser (DEF-BST-11, the L item)** — `lib/statementPdfText.js`:
  boom's layout parsers + reconciliation gates ported VERBATIM (BofA sections vs
  printed totals; PayPal per-currency Activity Summary brackets; net proves,
  gross stores), but text extraction is a **dependency-free zlib-based PDF
  reader** (object scan incl. /ObjStm, page-tree walk, ToUnicode CMaps, Td/Tm
  line+column reconstruction with boom's 4.6/7 thresholds — pdfjs-dist NOT
  added). Account-agnostic: both layouts tried; only a parse that RECONCILES
  wins, else AI fallback. The gate is the safety argument: a bad extraction
  fails arithmetic, never corrupts data. LIMITATION (honest): reads digitally-
  generated unencrypted PDFs whose fonts carry ToUnicode; scans/encrypted → AI.
  Verified live: synthetic statement PDF ingested `parse_method:'rules'` with
  AI unconfigured, balances captured, audit line written.
- **Currency (DEF-BST-12/13)** — PDF prompt v3 (CURRENCY + AMOUNT_USD +
  INDN/TRANSFER payee rules — INDN is OUR account holder, never a 1099 vendor);
  `parsePipeLines` reads v1/v2/v3 tolerant; `parseCsv` reads currency/status/
  type columns (PayPal non-Completed rows never ingest). Detail rows carry
  `usd` (printed amount_usd wins, else cached rates); catTotals/coverage sum
  USD. `extractCsvBalances` accepts "Running Bal.".
- **Ingest (DEF-BST-14/15)** — refactored into `buildIngestCtx`+`ingestOne` so
  /reparse runs the identical pipeline. Within-statement dedupe collapses ONLY
  on a real reference (30 identical same-day $1 fees ingest as 30); refs
  backfilled via `refFromDescription` (TRN/Confirmation#, never ID:/CO ID:).
  `import_summary.reasons` = the matcher's own decline verdicts (`matchTxn`
  gained an optional `why` out-param — purely observational; fixtures 35/35).
- **Re-match lifecycle (DEF-BST-16)** — freshness re-run on detail open (10-min
  per-statement throttle), `POST /rematch-all` (per-statement report, 409-not-
  zero via a per-label busy set), `POST /reset-matching` (auto+manual cleared;
  booked/income/dismissals sacred; `manual_not_recovered` reported), nightly
  per-label pass in index.js via exported `router.runMatcherPass`.
- **Verification machinery (DEF-BST-07/08/09)** — `POST /:id/reparse` strictly
  additive (`lib/statementAudit.js` `diffReparseRows`: identity = date+amount+
  direction+CURRENCY, counts not sets; PDF backgrounds into
  `import_summary.reparse`, CSV sync; rules-verified balances persisted; client
  reports added/already-present/other-statement/only-in-db + the ≥1.5× doubling
  warning). Extras audit: `GET /extras` (portfolio, 429 single-flight) +
  `GET/:id/extras` + `POST /:id/extras/remove` with the missingCount>0
  "relabelled, not duplicated" refusal (the guard that saved 206 real PayPal
  rows in boom) + booked-income block + affected-expense reporting. Misfiled:
  `GET /:id/misfiled` + `POST /:id/misfiled/repair` (reference-repeat detection
  inside one identity group, payee-only rewrite keeping id/date/amount, match
  released only when the payee changes, invented bookings soft-deleted guarded
  on entry_source, `unclear` left alone). All three require the stored file and
  degrade with named reasons when R2 is off (dev).
- **Library (DEF-BST-01/02/04/05/06/21)** — month-grouped "Statements by month"
  card: X/Y-reconciled header, coverage bars (≥95/≥60 tiers), open-count/clear,
  missing-account + overlaps badges, expandable per-statement rows (copy N,
  period, per-stmt bar, matched/debits, extras/misfiled badges, hover
  view-file/re-parse/delete), Mark-reconciled gated on open_debits=0 AND no
  missing account + unlock hint, un-reconcile ✕. List payload gains debits/
  matched/dismissed/open_debits/open_credits/open_value + `overlaps_with`;
  `/months` gains `missing_accounts` — and a REAL bugfix: month_key was
  `String(Date).slice(0,7)` = "Wed Aug" (pg returns DATE as a JS Date), now
  `to_char` in SQL; this also fixes Bank Matching's month strip labels. Batch
  upload (`multiple`, {done,total,phase} line, per-file failure banner,
  parse-poll, single-ready auto-open); page-wide depth-counted drag-drop
  overlay naming the target account; error rows show inline
  `parse failed — {error}` + Delete; `GET /:id/file` streams the original via
  `sendFileSafely` (client opens a blob URL).
- **Sweeps & guards (DEF-BST-17/18/19/20/22/24)** — list sweeps throttled to
  10 min/label, never concurrent; added retro internal unlink+dismiss
  (`INTERNAL_RE.source` via `~*`), orphaned-booking soft-delete, currency
  repair from the description suffix, and a **capacity-aware** over-claim sweep
  replacing rank-1-only (verified live: two installments on one family survive
  a list load; a third 409s). DELETE soft-deletes entries booked FROM the
  statement (entry_source-guarded, audited, `entries_removed` returned) so
  re-upload + re-book can't double-count. Dismiss refuses matched/booked rows
  (bulk skips them in the WHERE and returns the real count); records the deck's
  `rejected_expense_id`; an always-rule sweeps existing open rows immediately
  and `dismissed_reason` names the pattern (`rule: <x>`; column widened to
  VARCHAR(160) in migrations). `paidNoEvidence`: ±3-day pad, FAMILY totals,
  account-method compatibility filter, per-entry `bank_candidates` (one-click
  match chips). Balance backfill: deterministic-first (CSV column / rules
  parse), focused AI last, 2/cycle fire-and-forget + skip-set;
  `reparse-balance` uses the same ladder.
- **Reminders (DEF-BST-10)** — `statement_reminders` table (label+user scoped;
  monthly/weekly/once; day-of-month clamped next_due), CRUD under
  `/bank-statements/reminders`, Done advances from TODAY, due reminders surface
  in the notification bell (`notifications.js` type 'reminder'). Collapsible
  card + default day-5 seed button. Email delivery NOT built (no hourly email
  sweep infra) — bell only, documented.
- **Also fixed (found in review)**: `activityBot` was used but never required
  in bank-statements.js (month reconcile/reopen threw → 500); the 409
  over-capacity message printed "Wed Aug 12" (Date-object slice).
- **DEF-BST-03 partial**: the correct gate ships in THIS page's month library
  and `/months.missing_accounts` makes the fix trivial elsewhere — Bank
  Matching's own strip still gates on open_debits alone (that page belongs to
  the bank-matching campaign). **DEF-BST-23 partial**: per-row `usd`, reversal
  pairing (`reversed_by`/`reversal_of` chips via lib/reversalPairs) and
  `categoryUsage` shipped; `group_proposal` + `vendor_hint` are deck/matching
  consumers judged in the bank-matching audit (pointer).
- **Verified**: fixtures 35/35; client build clean; node --check all touched;
  live on dev Neon over HTTP — CSV + PDF ingest, same-statement dedupe,
  capacity model vs sweep, dismiss guards, immediate rule sweep, reset/rematch,
  reminders + bell, months, paidNoEvidence pad/method-filter.

## Phase 4 — bank-matching (2026-09-01) — parity defect pass

Closed the `_audit/pages/bank-matching.md` §7 register (37 of 42 rows closed,
3 partial, 2 skipped as deliberate) plus the flags-engine checks the finance
build deferred. Files: `pages/BankMatching.jsx` (rewritten, ~1,470 ln),
`components/statements/StatementReviewDeck.jsx` (rewritten),
`StatementFlagsCard.jsx`, `routes/bank-matching.js`, `routes/bank-statements.js`,
`lib/statementFlags.js`, `lib/statementLinks.js`, `lib/fundingPairs.js`, NEW
`lib/groupProposal.js` + `lib/bankVendors.js`, `index.js` (two columns).
**Zero new deps.** Every matcher contract preserved — fixtures 35/35.

- **The completion model was answering about a different set of money than the
  queue underneath it** (§7-8/9/21/37/38/39). `/completion` now narrows its
  BUCKETS to `?statement_id`, not just the left-counts, and reports
  `workspace_total` beside the narrowed total so the card says which set it is
  describing. Five dispositions, not four: `creator` is its own figure again
  (explained, never invoice-backed). Buckets renamed to what they mean —
  `needs_invoice` / `no_invoice_expected` — with `booked_expected` /
  `booked_not_expected` kept as aliases carrying **boom's** meanings (expected =
  still waiting), because NEW had them inverted and any parity consumer would
  have read the opposite of the truth. `by_statement.left` = open PLUS
  created-and-unanswered (the anti-146×-drift definition); `left_all` /
  `left_all_value` drive the header headline; percentages to 0.1%.
- **Three answers, not two** (§7-3). Open rows book from the table (inline
  category + Book), in bulk (bulk bar), and vendor-by-vendor (§7-4 batch view:
  `?view=batch`, groups from the shared bank-vendor aggregation, per-row and
  uniform category, select-all, apply with a progress counter and a per-row
  failure ledger — refused rows are named, never folded into a count).
- **Attribution exists** (§7-1/2). A Category⇄Artist column lens (`?by=artist`),
  `GET /artist-names` (artists table ∪ names the ledger actually carries),
  artist pickable BEFORE booking and editable on booked rows
  (`POST /tx/:id/artist`, refused on real-invoice entries — that belongs to the
  Ledger), click-a-value-to-filter, and a by-construction empty state for the
  artist+open combination.
- **Multi-invoice settlement is reachable** (§7-7, and DEF-BST-23's
  `group_proposal`). NEW `lib/groupProposal.js` searches candidate subsets for a
  vendor whose family totals land on the debit, under two rules that make it
  safe to OFFER: **ambiguity is a refusal** (two different sets that both fit →
  nothing is pre-selected) and **one vendor per set** (alias groups count as one
  vendor; the learned map does not — it is an inference, not a fact). Surfaced
  in `/queue` (budget 40/request, only where no single invoice scores ≥0.85, so
  the page never offers two contradictory answers to one row) and settled
  through the existing `/tx/:id/attach` capacity model via a new AttachModal
  with free ledger search on top.
- **DEF-BST-23's `vendor_hint`** shipped as `lib/bankVendors.js`
  `vendorHintFor` — the ledger vendor a descriptor is KNOWN to mean, with
  provenance in confidence order (a person's override > learned lesson > alias >
  this descriptor's own past matches). Rendered on the row, used to resolve the
  split-book payee, and fed to the funding-pair naming test.
- **DEF-BST-03 closed**: the month strip now gates Mark-reconciled on
  `open_debits === 0` **AND** `missing_accounts.length === 0`, with the unlock
  hint naming which account's statement is missing — a month can read 100%
  coverage while an entire account was never uploaded. The silent 14-month cap
  became a "show all N months" toggle.
- **One-click that files money against the wrong invoice is gone** (§7-26). The
  suggestion ARMS a comparison panel (one row at a time, radio + a deliberate
  "Match X", near-identical warning when two candidates score within a hair,
  per-candidate amount-difference callout). Every consequence-bearing action now
  confirms with copy naming what moves (§7-30) — 14 sites.
- **The prepayment guard stopped being a dead end** (§7-12): row match, attach
  and the deck all catch `prepayment_possible` and offer the retry.
- **"No invoice coming" became an ANSWER** (§7-11). On an open row it BOOKS
  (category required) rather than flagging a row `/completion` still counts as
  unfinished; it is refused on rows matched to a real invoice (a contradiction);
  it carries an already-paid-invoice 409 speed bump with `confirm_new`; the bulk
  gate lives in the WHERE with a named skip reason. Booking goes through a new
  exported `router.bookOpenTxn` with an **atomic claim that rolls back the
  invented entry on a lost race** — otherwise the ledger keeps an entry no bank
  line points at.
- **Reachable-but-uncallable endpoints now have callers**: unrematch (§7-13),
  split-book (§7-14, hardened: 2-6 parts, category REQUIRED per part, payee
  resolved-never-defaulted with an explicit refusal, `payment_method` derived
  from the account, `learnPayee`, fx stamped per slice), funding-pair undo
  (§7-20), unattach.
- **detachTxn restores the booking a rematch displaced** (§7-18,
  `restoreDisplacedBooking`, shared by unmatch / bulk-unmatch / unrematch).
  Without it an unmatched ex-rematch row landed OPEN with its only answer
  soft-deleted — a state nothing in the UI could exit.
- **Rematch panel** (§7-19): greedy assignment now RETURNS the pairs that lose
  it ("N contested" — silently discarding them made the panel look complete),
  exact-cents-then-fee-then-fx tiers with the cross-currency arithmetic shown,
  statement scoping, gap-days + evidence method + document presence, confirm,
  and a per-row undo.
- **Funding pairs** (§7-20): three tiers where the difference is what the
  evidence PROVES — `exact` (arithmetic), `fx` (band **and** the pull names the
  recipient, now including alias/learned/override names), `unproven` (band
  alone). Unproven pairs are returned separately, excluded from the bulk, and
  demand `confirm_unnamed`; `close-all` reports each failure; already-paired
  legs list with a "put it back". Summary counts + the dollars that would
  otherwise count twice.
- **Duplicate merge** (§7-36): ±0.01 amount tolerance (two records of one
  payment routinely differ by a rounded cent), `lock_timeout` beside the
  statement timeout, **moved≥1 verification** (nothing to move → 409 instead of
  archiving a record while proving nothing), and it carries the twin's **UFR
  mark + recoupment label** — cadence has a UFR model, so archiving the row that
  carries it silently changed an artist statement. `recoupable` is deliberately
  NOT carried: it defaults TRUE, so forcing it would overwrite a deliberate no.
- **Also**: flag-for-review (`flagged` column + chip + deck `F`); currency
  correction (`/tx/:id/currency`, refused while matched, clears the stale
  `amount_usd`); vendor override (`vendor_override` column, per-row + bulk,
  `confirm_new` unknown-vendor gate, teaches the matcher); Match-again /
  Reset-matching in the page menu; full bulk bar (book / mark-paid / dismiss /
  restore / unbook / no-invoice / unmatch / vendor); sortable headers with
  confidence-then-amount as the open-pile default; URL mirrors
  statement/filter/q/view/by; persisted direction toggle; lead+more chips with
  `Open` = open **plus** needs-invoice (so the number can honestly reach zero);
  ≈USD sub-amounts, bank-differs / description / dismissed-reason sub-lines,
  "N of M" + "show 200 more" footers; auto-decisions gained a days picker,
  per-payee grouping (with a "matched to N different vendors" warning) and
  ledger links; the ledger-side panel gained a real loading/error state, a
  refresh, cap disclosure, invoice#/no-file/method columns, both exits, and
  **one-click "found in bank?" candidates** (§7-32) computed with the same
  ±fee-tolerance / 7-day / method-compatibility rules the matcher uses.
- **`/ledger-search` stopped hiding partially-settled invoices** (§7-31): it now
  returns `claimed` / `remaining` / `partially_settled` and drops only families
  with no room left — the capacity model allows installments, so hiding them
  made a real invoice unfindable.
- **Review deck** (§7-5/6/33/34/35): 7 card kinds (match / choose / rematch /
  book / income / no-invoice / keep) instead of 2; booked-rows-awaiting-a-
  document are back in the deck; open credits that pair as reversals are OUT (a
  reversal is money returned, never revenue); match-first ordering with skip
  DEMOTION rather than removal; **⌫ undo with a per-kind server inverse** for
  every accept; `F` flag, `N` no-invoice, `S` inline ledger search, `B` force
  book over a match, and a hint line naming every key — a key nobody can see is
  a key nobody uses. Dismiss passes `rejected_expense_id`, so the deck's "no"
  now survives a statement re-upload (§7-42, closing the client half of a fix
  the statements campaign made server-side). Re-review mode (⋯ menu) feeds
  answered rows through, and the `keep` card refuses to offer "book" on a row
  already tied to a real invoice.
- **Flags engine — the four deferred checks**, all with working one-click
  actions: **suspect-currency** (a PayPal USD row ≥$500 whose exact amount
  repeats as a same-day conversion row — the signature of a foreign payment
  parsed as USD); **booked-duplicate** (a debit booked as a new entry while the
  vendor's real invoice sits unclaimed → `unbook-rematch`, which is the existing
  rematch endpoint, breadcrumb and all); **stolen-match** (the same shape, but
  the original is held by an auto-match whose bank name shares nothing with the
  vendor — unmatching the thief is what makes the duplicate fixable, and the
  next pass then offers the fix); **lesson-disagreement / vendor-link** over the
  shared `aggregateBankVendors` grouping, with a new `POST /rules/relink` that
  rewrites what the matcher LEARNS without touching a single existing match.
  3+ groups disagreeing about one ledger vendor COLLAPSE into one card with one
  bulk repoint (a card processor minting a vendor per charge). `vendor-link`
  requires NAME EVIDENCE, never bare co-occurrence — offering a link on the
  strength of a wrong match would cement that error into every future statement.
  `double-booked` gained the one-click unbook it never had. An explicit
  `vendor_override` is exempt from both lesson checks: disagreeing with the
  matches is that person's decision, not a defect.
- **Tokens-only** on every touched surface: the page, the deck and the flags
  card lost their raw `gray-*` / `rose-50` / `amber-50` classes for
  `text-ink`/`ink-muted`/`ink-faint`, `bg-elev`, `bg-selected`,
  `text-success|warning|danger|info` and `bg-danger/10`-style color-mix tints
  (the fixed `-50` shades went near-white in dark).
- **Not closed, deliberately**: ×N identical-row grouping in the table (§7-27
  partial — the cap footer, sub-lines and ≈USD shipped); a document preview
  panel in the deck (§7-35 partial — bank txns carry no document to preview;
  inline search, force-book and the hint line shipped); a dedicated funding-pair
  DECK (§7-20 partial — the panel gained tiers, bulk, undo and summary);
  per-row "funding pair · $X" annotation on open PayPal rows; split-book's
  displaced-booking race restore; the auto-decisions document indicator; sort
  order in the URL.
- **Already closed before this pass** (verified against current code, not
  re-fixed): §7-10 and the server half of §7-42 — the bank-statements campaign
  had already made dismiss refuse matched/booked rows and record
  `rejected_expense_id`; §7-15's server endpoints (`/rematch-all`,
  `/reset-matching`) existed with no caller on this page, which is what this
  pass added.
- **Verified live** on dev Neon over HTTP with AI/R2/email unconfigured:
  completion scoping + narrowed percentages; group proposal → attach → capacity
  409 → unattach; ledger-search `remaining` on a partially-settled invoice;
  no-invoice category gate, paid-candidate 409 and `confirm_new`; bulk
  no-invoice skipping a real-invoice match and a booked row succeeding;
  split-book refusals (no category / 7 parts / sum mismatch) and the good path
  writing `payment_method` + resolved payee across the family; rematch →
  unrematch → rematch → bulk-unmatch restoring the booking; duplicate merge
  carrying the UFR mark and refusing a second merge; funding pairs across all
  three tiers incl. the unproven refusal, confirm, undo and close-all; vendor
  override unknown-vendor gate; currency refusal while matched; months
  `missing_accounts`; and the full stolen-match → unmatch → booked-duplicate →
  one-click-fix chain. Fixtures 35/35, client build clean, `node --check` on
  every touched server file.

## Phase 4 — bank-ledger port (2026-09-01)

Ported OLD's `/bk/bank-ledger` — **the bank half of the ledger with a statement
lens**. `_audit/pages/missing--bank-ledger.md` P1 + P2. No new deps, no new
columns, no migration.

**Placement: a `bank` prop on `Ledger.jsx` at `/bank-ledger`, NOT a tab on
`/bank-matching`.** The punch-list wanted every ledger row seen from the bank's
side — full column set, inline edit, bulk edits, 20-deep undo, splits,
per-currency totals, incremental render. That IS the ledger component; building
it inside BankMatching would be a second copy of ~1,500 lines of money-editing
UI, which is exactly the drift this file keeps warning about. The two surfaces
also ask different questions: `/bank-matching` is a *decision queue* (what
should this line become?), `/bank-ledger` is a *register* (what did the month do,
and does it add up?). And the lens's extra-lines list is defined against **this
page's filtered row set** — it only means anything where the ledger rows are.
Registered exactly like its siblings: `AdminRoute`, Layout Bookkeeping group,
`PAGE_LABELS`. Deliberately NOT in `constants/pages.js` — `/bank-statements` and
`/bank-matching` aren't either; admin surfaces are role-gated, not
permission-matrix-gated, and adding a toggle `AdminRoute` ignores would lie.

**`?source=` — the partition** (`routes/ledger.js`). `sourceClause()` reuses
`lib/ledgerSource.js`: `bank` → `entry_source = 'bank_statement'` (equality —
NULL genuinely is "no"); `invoices` → `excludeBankRows()` i.e. **IS DISTINCT
FROM**, never `<>`, or every hand-entered NULL row drops out and the page
EMPTIES instead of narrowing. `invoices` is the COMPLEMENT of `bank`, never a
second whitelist — that is what makes the halves partition (verified live:
26 = 2 + 24 on both the list and the CSV). **Opt-in**: absent `?source=` behaves
exactly as before, because a dozen callers read `/ledger/entries`. A bad value
is a **400, not ignored** — on the list AND on `/export`, `/export-xlsx`,
`/export-invoices-zip`, `/export-w9s-zip` (shared `exportFilters`, which now
returns null and `exportRows` throws `BadSource`; a null returned into three
call sites is one unchecked site away from `WHERE null`). The export carries the
source so a workbook contains **exactly** the page it came from — that one goes
to the accountant.

**Bank-mode columns** — scoped to `source=bank` rather than added to
`LEDGER_VIEW_COLS` (four pages read that): `bankEvidenceCols()` for
`bank_evidence`/`bank_expected`, plus `no_invoice_expected` = `bool_or` over the
family root's live matched transactions (`bank_transactions.no_invoice`;
`COALESCE(parent_id, id)`, matching how bank_evidence resolves, so a split slice
shows its family's line). Client adds three columns offered **only** on this
half — Statement / Bank line / Inv wanted? — plus a one-click **"Hide what a
bank row never fills"** preset (invoice #, the four document cells, vendor
contact, terms/due, the Y/N markers, Source). Preset, not default: the document
cells are where a late-arriving invoice goes. Separate versioned localStorage key
per half (`ledger-cols:bank:…`) — one key would make hiding a column on one half
rearrange the other.

**`server/lib/statementLens.js` (new, pure, CJS, fixture-held).** Put on the
SERVER, not the client as OLD had it, because `dispositionOf` **already existed
here twice and had drifted**: `bank-matching.js` treated `match_method='created'`
as booked, `bank-statements.js` did not — so a created-from-rule row read
`booked` on one page and `matched` on the other, i.e. an undocumented row
counted as invoice-backed depending on which page you were on. One definition
now; both routes import it; widened to the union (correct direction — a booking
is not a match). Cadence's disposition vocabulary is a shipped contract
(`booked` / `matched` / `toconfirm` / `dismissed` / `open` / `booked-income` /
`open-credit`, switched on by three components) and is **unchanged**; `creator`
is a SUMMARY-ONLY bucket (`lensBucketOf`) so the tie-out can keep creator
payments out of "invoice-backed" without dropping them from two pages' matched
chips. Also `txUsd` (request-time `usd` → stored `amount_usd` → face; ABS, so a
negatively-stored debit can't subtract from the debit total) and
`summariseStatement`: per-direction counts + USD by bucket, and the tie-out
`beginning + credits − debits = ending` against the statement's own printed
balances. **Rounds ONCE at the end** (a TOTAL, not a row — rounding parts first
invents a cent) and compares the ROUNDED drift `=== 0` exactly. `hasBalances`
is false for accounts parsed without them (0/0 PayPal): a check that always
fails for a non-problem trains people to ignore the check.

**`GET /bank-statements/:id/lens`** — deliberately not `GET /:id`, which re-runs
auto-matching on open and carries suggestions, paid-no-evidence candidates and
12-month category usage. A read-only tie-out must not have a side effect. Returns
`{ statement, transactions (slim, each with the server's `disposition` + per-row
`usd`), lens }`. The client therefore **never re-derives** the disposition rule —
its extras list is a set difference over server-decided facts.

**The lens UI** (bank half only): statement picker (`Jun 2026 · BOFA`, ready
statements only), direction picker, the tie-out line (`opened · in · out ·
closed · ✓ ties` / `off by $x`), a per-bucket breakdown of the chosen side, and
an "N credits unanswered" jump. Selecting a statement **also narrows the ledger
rows** (`bank_evidence.statement_id`) — otherwise the header would describe a
month sitting above every month's rows. Below the table: **the lines with no
editable row on this page** — everything except booked-lines-whose-row-is-on-
screen, built against the FILTERED set so a filter-hidden row's line resurfaces
rather than vanishing. Verified live: money-out extras + booked-with-row ==
total money-out lines, on every seeded statement. Those rows are deliberately
NOT ledger rows (no expense id → no inline editors, no bulk checkbox); their
buttons act on the TRANSACTION through endpoints `/bank-matching` already owns
(dismiss / restore / unbook-income), and anything needing a real decision links
out to `/bank-matching?statement=…` rather than growing a second matcher.

**Cross-half `?focus`**: a deep link landing in the wrong half redirects once
(`xhalf=1` caps it at one hop — without a marker an unknown id ping-pongs
forever) and then says "it lives on the other half" instead of dying silently.
Only the NARROWED views can be wrong-half; "All spend" excludes nothing, so a
row missing there is missing for another reason and must not be bounced.

**View switch** All spend / Invoices / Bank items on both routes. "All spend"
stays the default on `/ledger` — it is what the page has always shown, and
narrowing it silently is a change nobody asked for. The invoice-creation CTAs
(Add invoice/reimbursement, vendor link, CSV import) are hidden on the bank half:
they all make an INVOICED row, so filing one from here would look like the button
did nothing.

**Ledger-matching judgment (`missing--ledger-matching.md` P2): not built, and
none of it falls out free here.** That page diffs the ledger against an external
bookkeeper's xlsx — a third dataset cadence never ingests — and nothing on this
surface touches `bank_transactions`' counterpart. Its `lib/vendorMatch.js` is a
tiered *vendor-name* matcher with human-readable reasons; cadence's
`lib/bankReconcile.js` scoring is calibrated for bank *descriptors* and held by
fixtures, so conflating them would decalibrate the shipped matcher. It stays its
own port.

**Verification**: fixtures **55/55** (35 pre-existing + 20 new lens assertions —
disposition order, the created/booked drift, creator-is-summary-only, round-once
at 0.005+0.005, drift reported not swallowed, 0/0 = nothing to tie against,
extras set-difference incl. the filter-hidden-row case); client build clean;
`node --check` on every touched server file; live against the dev workspace —
partition 26 = 2 + 24 on list and CSV, 400 on a bad source across all four export
routes, `bank_evidence` + `no_invoice_expected` populated, `/lens` on three
statements, and `/bank-statements/:id` vs `/lens` dispositions now agree row-for-
row on statements carrying `match_method='created'`.


## Phase 4 — data quality (2026-09-01) — parity defect pass

`_audit/pages/flags-data-quality.md` §7 (1 P0 + 7 P1 + 13 P2 + 7 P3). The P0 was
already closed by the root-cause pass (the `vendors.w9_name` 42703 that 500'd the
whole page); everything else was open. **`server/routes/flags.js` and
`client/src/pages/DataQuality.jsx` are both rewrites.** Zero new deps.

**The two rules the rewrite is built on.** (1) *Two figures, never one.* A check
either says something is WRONG (a decision) or that a field is EMPTY (data
entry). Every category now ships `nature` ('problem'|'completeness') + `group`
(Money→Ledger→Catalog→Artists) + `severity`, so the header's "N need a decision ·
M fields incomplete", the rail, the overview and the body all derive from one
filtered list and cannot disagree. (2) *A placeholder is not a name.*
`namesAnArtist` (lib/artistKey.js) runs BEFORE every artist detector — without it
`likely_typo` offers "n/a" as a 2-edit typo of a real artist, `multi_name` offers
to split a row into "N" and "A", and `variants` elects "n/a" as a canonical
spelling. "unknown" stays a REAL artist name.

**Server — 23 categories where there were 6.** Ported from boom: six catalog /
artist completeness checks (`releases_missing_genre|upc|isrc|spotify`,
`artists_missing_genre|spotify`) with sentinel-value guards ("n/a" in a UPC field
is a missing UPC), released-date gating, and `getCompletenessTotals` supplying
`of_total` denominators **plus the UNCAPPED count** — the item lists LIMIT 500 and
a capped count would report a 900-row gap as 500, i.e. more complete than it is.
Detectors gained `artist_likely_typo` (Levenshtein ≤2 vs roster, with the
suggestion), `artist_placeholder`, and `artist_variants` (canonical = the
roster's EXACT spelling, else most-frequent; matching on the folded key is
circular and elected "zeke bleu" over "Zeke Bleu" — caught in live test).
`artist_multi_normalize` auto-detects collab strings with row count + total spend
+ parsed candidates. Ledger detectors are now scoped to `status='approved'`
(pending vendor submissions and rejected rows fed every flag and doubled the
Approvals queue); `ARTIST_REQUIRED_CATEGORIES` is boom's 10, `missing_song` gained
the reimbursement exclusion and the **child-carries-song exemption** (a split
parent with a blank song is the family container, not a gap), `missing_socials`
gained `cobrand = TRUE`.

**Invoice dupes are four tiers again** (1 same vendor+#+amount / 2a amount
mismatch / 2b blank-# ±7-day union-find chain / 3 cross-vendor, gated on same
amount AND number length ≥ 4 — without both guards "1"/"2"/"3" collide across
every vendor and flood the section). Vendor aliases resolve into one bucket;
`entry_source = 'bank_statement'` rows are excluded via `excludeBankRows`
(lib/ledgerSource.js) because they never had an invoice number and a bank charging
five identical fees in a day is normal. Split slices need no special case here —
cadence splits are parent+child, and the query is already `parent_id IS NULL`.
**Vendor dupes** use NFKD-folded Levenshtein union-find with pairs already linked
in `vendor_aliases` excluded, and carry invoice count / spend / W9 / first+last
invoice, canonical-first. **Release dupes key on `artist_id|name`**, never name
alone — two artists both having an "Intro" is not a duplicate.

**`w9_name` decision: wired, not deleted.** Nothing ever populated a
`vendors.w9_name` column and none exists. The real W9 name lives in
`expenses.w9_scan->>'w9_name'` (lib/aiScan.js), so `vendor_w9_mismatch` reads it
from there, deduped per payee, linking the entry that holds the W9.

**Access is layered, not all-or-nothing.** The router is `authMiddleware +
withTenant` only. Catalog/artist sections serve every role; ledger + vendor +
invoice sections need Approver+; `flagged_transactions` needs Admin+ (matching the
Statements split); every mutation carries `requireAdmin` on the route. `/data-quality`
lost its `AdminRoute` and its `isAdmin` nav gate — the blanket lockout took the whole
inbox from Approvers. Verified live: Approver sees 22 sections, User sees 8, both 403
on merge.

**Mutations.** All three merges take `source_ids` / `source_names` ARRAYS and fold
a whole group in ONE transaction behind ONE confirm — the old shape fired a
confirm and an unawaited POST per non-survivor, racing concurrent transactions
and reloads. `merge-vendors` now records each folded spelling as a
`vendor_aliases` row (that is what makes a merge stick: dup detection skips
aliased pairs, and the dup-check gate + bank matcher both read the table) and
repoints any alias that named the source. `merge-artists` cascades
`deals.artist_name`; `artist_income` is NOT in the cascade because cadence keys it
by `artist_id`, not a name string. New: `rename-artist` (cascades expenses +
deals; the clash check is unconditional — normKey collapses whitespace, so gating
it on "did the name change" skipped exactly the `"Nova  Ray"` → `"Nova Ray"` case
that then 500'd on `artists_label_id_name_key`) and `archive-release`.

**Client — the flat 7-pill strip is a two-pane hub.** Sticky 224px grouped rail
(severity dot, problems-first, disabled-when-empty) + a grouped `<select>` below
`lg`; an Overview with the problem-card grid and an "Incomplete fields" strip
whose progress bars are drawn ONLY when the server supplied `of_total` ("no total
available" otherwise); per-section header with description; a filter box with a
shown/total counter, identifier-skipping deep match, reset-on-section-change and
an input that survives zero matches; show-low + show-dismissed toggles; a re-scan
button; and `?tab=` in the URL. Cards regained their evidence: release artwork /
artist / date / UPC-ISRC-Spotify chips / per-row Archive / multi-reason chips,
artist release+contract counts and inline rename, vendor metadata with per-row
**Leave alone** (fuzzy matching pulls genuine third parties into a group, and
all-or-nothing meant renaming a real vendor or fixing nothing).

**Ledger rows are fixable in place**: the inline editor pre-fills from the server
suggestion (accepting one is a keystroke), Save PATCHes `/ledger/entries/:id` and
auto-dismisses, and the row then sits struck-through for **5 s with Undo** before
being stripped — a fix that vanishes instantly gives no chance to notice it was
wrong. `artist_placeholder` gets a "No artist" action that is deliberately NOT a
mode of the field editor (that one refuses an empty value; here blank is the
ANSWER). Split reuses `components/SplitModal` — so `family_amount` +
`artist_breakdown` joined the flag-row SELECT, or a re-split would validate
against `undefined`.

**Human-flag inboxes now have a home.** `flagged_expenses` +
`flagged_transactions` (`bank_transactions.flagged` arrived with the bank-matching
campaign) are sections, and `LedgerEntryDrawer` gained the **Flag / Flagged
toggle** that fills the first — the marker previously had no writer outside the
campaign review flows.

**Dismissals stayed ONE store.** `data_quality_dismissals` gained a `summary`
column stamped at dismiss time: the key is an id signature and the rows behind it
can be merged away, so a dismissed entry cannot be re-hydrated later — printing
the raw `reldupe:12,15` made a machine identifier the primary copy. `LEGACY_KIND`
maps the pre-rename per-row kinds (`unknown_artist`→`artist_unknown` etc.) so
dismissals made before this pass still suppress their rows (verified live).
`?include_dismissed=1` annotates groups in place with Restore.

**Tokens only** — `bg-red-100/orange-100/amber-100` chips are gone; severity is
`bg-danger|warning|info` and the accent is `bg-brand-500/10` + `text-brand-ink`,
so nothing goes near-white in dark. Dates use `utils/dates.formatDate`, never
`new Date(dateOnly).toLocaleDateString()`.

**Not done, and why.** §7-19's date/method edit-and-recheck popover, "Find it"
search link and checked-account note, and §7-20's ReviewDeck keep/archive flow,
live on **/bank-statements** and **/bank-matching** — surfaces the two bank
campaigns own in this same phase. What was cheap and belongs to the flags family
was done: `StatementFlagsCard` now prints the true paid-no-match total when the
engine's 150-row cap hides the rest. The duplicate-pairs payload already carries
the doc/artist/`gap_days` evidence from the bank-matching campaign. Also skipped:
an in-page invoice PREVIEW — cadence has no `FilePreview`, and the repo removed
`?token=` query-param auth on purpose, so an `<img>`/`<iframe>` src cannot
authenticate; rows show a document marker and deep-link to the ledger instead.
Vendor names are plain text, not links: there is no per-vendor route to deep-link
to and `/vendors` is admin-only, which a non-admin can now reach this card from.

**Verified live** (dev workspace 2, seeded dirty data): every one of the 23
sections fires; cross-artist "Intro" is NOT a duplicate while same-artist "Intro"
and a shared UPC are; a rejected row and a `bank_statement` row stay out of the
dup tiers while the blank-# chain 65→66→67 collapses to one group; a pending
vendor submission's junk artist never reaches the flags; the alias written by a
vendor merge suppresses the pair when the old spelling reappears; a split makes
the parent's `missing_song` flag disappear; dismissals survive rescans in both key
formats. Client build clean, `node --check` on both touched server files,
`server/scripts/finance-fixtures.cjs` 55/55.

## Phase 5 — recoupments (2026-09-01) — parity defect pass

Closed the `_audit/pages/recoupments.md` §7 register (36 rows). The page went from
a 270-line table with an inline expander to an index of per-artist cards plus a
routed, URL-addressable artist page — and, more importantly, from a spend total
nobody could defend to one stated on a **bank basis**.

**The gate (DEF-RECOUP-01, the P1 that mattered).** `recoupable` is
`BOOLEAN DEFAULT TRUE` and `bookDebitAsEntry` writes statement-born rows
approved + Paid without touching it, so every bank debit naming a rostered artist
was landing on that artist's recoupable spend on the strength of a **column
default**. New `expenses.recoup_reviewed / _at / _by`; `lib/recoupments.js`
`recoupBaseSql()` folds the gate INTO the base predicate (not a filter a caller
can forget), and `GET/POST /financials/recoupments/review` is the queue where the
decision — plus the artist, since a recoupable cost is recoupable *against
somebody* — actually gets made. Answering "no" clears `recoupable` too. Verified
live: 52 items with 4 pending → 53 after one yes, queue 3; a "no" leaves the
total at 53. Class rules were not ported in that pass; they arrived with the
audit below, and now filter this queue, its count tile and the pile alike.

**New shared server libs.** `lib/recoupments.js` — `recoupBaseSql` /
`recoupReviewedSql`, the four-state `recoupStateOf` (a character-for-character
mirror of `client/src/utils/recoupState.js`, held by fixture), `recoupCounted`,
`isProvableUnclaimed`, `normalizePriority` (closed vocabulary — an unrecognized
priority is a **400**, not a band nobody can select), `bestSpelling`.
`lib/statementMonth.js` gained `statementStampFor(ym)` (noon UTC on the 1st —
day 1 is ≤20 in every timezone, so the stamp reads back as the month asked for)
and `statementWindowLabel`, and now returns **null for a null stamp** instead of
defaulting to *now* (DEF-RECOUP-33 — that default filed unstamped claims into
whichever month the page happened to be opened in, and made the client's
"Unstamped" bucket unreachable).

**UFR timestamp integrity (DEF-RECOUP-11/12).** `ufr-bulk` was an unscoped
`SET ufr = TRUE, ufr_marked_at = NOW()`: a replayed or stale-client commit
silently MOVED already-claimed items off the statement a partner had received.
Now: re-read server-side under `recoupBaseSql`, capped at 2000, **PRESERVE** on
re-claim, both directions (`ufr` defaults to true so Planning's existing
ids-only POST keeps working; a non-boolean is a 400), rich
`{ufr,changed,already,requested,skipped}` **plus `committed`** because
`RecoupmentPlanning.jsx` reads that field. Single-row `/:id/ufr` got the same
scoping + `COALESCE(ufr_marked_at, NOW())`. Moving between statements is now its
own explicit action — `POST /recoupments/move-month {ids, month}`, the ONLY
writer allowed to overwrite an existing stamp, eligible on claimed rows only,
no-ops reported rather than counted as moves. All of it writes `bk_audit_log`.

**Other new endpoints** (all `label_id`-scoped, all under the existing
router-wide `requireApprover`): `/recoupments/labels` (the upload-batch
vocabulary → datalist), `/recoupments/set-label {ids,label,mark_ufr}`,
`/recoupments/notes` GET+POST (per-song + the shared index scratchpad under the
sentinel key `__recoupments_index__`; empty note DELETES), `/recoupments/song-status`
(the SAME `song_campaign_status` rows Artist Campaigns writes), `/recoupments/export`
(exceljs, groupBy-aware sections, subtotals + grand total), and
`GET /recoupments/artist/:key` which **replaces `/recoupments/:artistId`** — the
surface has to be able to open a bucket with no roster row, including Unassigned
(key `-`).

**Index is expenses-driven, not roster-driven (DEF-RECOUP-22/23).** Buckets key
on `artistBucketKey`, so misspellings, punctuation variants and unattributed rows
all get a card instead of vanishing. Consequence worth knowing: **`artist_meta`
now keys on `artistKeyOf`** — financials used to write `lower(name)` while
artist-campaigns wrote the strip-all key, so "Life/Line" carried a meta row per
page and neither could see the other's priority. A boot migration re-keys the
stragglers and **leaves collisions alone** (the campaigns-canonical row wins).

**Client.** `pages/Recoupments.jsx` rewritten (collapsible stat tiles on a bank
basis w/ the 3-way note; the emerald **claim-the-provable** band w/ Upload-all-N
and per-artist rows behind a ConfirmDialog that states the stamp-decides-the-
statement rule; bank-review band; shared scratchpad; filter bar w/ 4 sort modes
+ ready filter + dismissed partition; priority subtabs that render **only once a
priority exists**, with counts and a No-priority band; artist cards w/ priority
rail + H/M/L + ready + dismiss, bank strip, items-uploaded and $-uploaded bars,
cobrand pill). New `pages/RecoupmentArtist.jsx` (`/recoupments/artist/:key`,
`?statement=` tabs — Total / Pending / Uploaded / one per month with window
tooltips — four tone-coded state sections **unverified first**, song|category
grouping with case-folded keys, best-spelling names, pinned Advance/Marketing and
recoupment-label sub-buckets, per-song Finished/Ready/note, per-row editor modal
+ split + flag + file preview + prior-year + delete-with-undo + UFR month picker,
a bulk bar with per-currency totals / Set label / Set label & mark UFR / Move to
month / Un-claim, the non-recoupable promote panel, and a deal card from
`contracts.financial_terms`). `RecoupmentPlanning` learned `?artist=` so the
artist page's Planning link lands scoped.

**Three new reusable primitives**: `hooks/useCollapsed` (localStorage-persisted
fold memory + Collapse/Expand-all), `hooks/useFocusRefetch` (throttled SILENT
refetch on focus/visibility — finance pages are worked by several admins at once
and a stale screen invites a second claim), `utils/statements.js`
(`statementLabel` / `statementWindowLabel` / `recentStatementMonths` +
token-based `STATE_TONE`). Presentation only — the month RULE stays server-side.

**Schema added** (all IF-NOT-EXISTS, after the expenses CREATE):
`expenses.recoup_reviewed/_at/_by`; `song_campaign_status.ready_for_planning/
ready_at/ready_by`; table `recoupment_notes (label_id, artist_key, song_key,
note, updated_by, updated_at)` + its unique index; the `artist_meta` re-key
UPDATE. `recoupment_label`, `ufr`, `ufr_marked_at`, `entry_source`,
`prior_year_tag`, `social_handles` and `artist_meta.dismissed` **already existed**
(ledger + campaigns campaigns) — only the review columns were missing.
`db.js` TENANT_TABLES and `full-export.js` gained `recoupment_notes`.

**Fixtures: 55 → 71**, all passing. The new 16 hold the day-20/21 cutoff in both
directions incl. the December year roll, null-in-null-out, the move stamp
round-tripping through `statementMonthFor`, junk months refused, the
release-to-release window label, the four states + `recoupCounted` excluding
unverified, `isProvableUnclaimed`, the closed priority vocabulary, the gate being
part of the base predicate, and `bestSpelling`.

**Deliberately not closed** (small residue, all cosmetic or a subsystem of its
own): ~~reference-app `recoupment_class_rules`~~ (BUILT — see the planning +
audit entry below); comment threads on recoupment rows
(the ledger drawer owns those); the secondary-axis (opposite-of-groupBy) bucket
level; the group-rename pencil / breadcrumb suppression; add-expense's release
dropdown + receipt upload; the Complete-on-Campaigns chip. Prior-year still asks
for the year via `window.prompt`, but now takes a whole bucket at a time.

## Phase 5 — planning + recoupments audit (2026-09-01)

Two surfaces: `_audit/pages/recoupments-planning.md` §7 (27 rows) and the
`missing--recoupments-audit.md` port. **Fixtures 71 → 90.**

### (A) Recoupment Planning — the staged plan comes back

The page was a *full-pool browser*: it showed every eligible row and the only
expression of "which of these belong to this month's batch" was a checkbox
selection that `load()` reset. Curation done today evaporated on reload.

**The working set** (`client/src/lib/recoupmentPlan.js`) — `{expenseId: label}`
in localStorage, plus a persisted saved-for-later Set. Client-side ON PURPOSE:
a plan is a DRAFT of a decision, nothing has happened to the ledger, and an
abandoned half-thought persisted server-side reads as shared state to the next
admin. Written by **Add to plan** on the artist page's bulk bar and by the
per-artist Plan link on the index; rehydrated on window focus so a second tab
staging rows shows up here.

**Reconciliation instead of eligibility rules.** `GET /financials/planning` IS
the eligibility rule (`recoupBaseSql` + not-claimed + not-prior-year); anything
staged that is not in the response was claimed/deleted/un-recouped elsewhere and
prunes itself. That prune runs in an EFFECT, never in the `useMemo` that finds
it — it writes to both state and localStorage. The same trick gives **exact
per-item commit failures**: commit, re-read, and whatever is still eligible did
not go through, stays staged, and is named in the banner. No 6-way per-item
worker pool, no trusting a response code.

**Commit** is one request per label bucket (`set-label … mark_ufr:true`) plus one
for the unlabeled bucket (`ufr-bulk`). Unlabeled rows deliberately do NOT go
through `set-label`, which would CLEAR a label the row already carried. Verified
live: a replayed commit reports `changed:0, already:1` and **moves no stamp**.

**Server**: `/financials/planning` lost `AND e.artist <> ''` — 19 artist-less
recoupable rows in the dev workspace were invisible on the one surface meant to
catch unclaimed money — and gained `meta.artist_meta` + `meta.song_status`, the
ready-for-planning markers that were set on Recoupments/Campaigns and read
nowhere. `RECOUP_COLS` gained `invoice_number`. The notes sentinel generalized to
`noteKeyFor()` so Planning gets its own scratchpad key
(`__recoupments_planning__`) alongside the index's.

**Closed** (24 of 27): 01 staged plan · 02 batch labels end-to-end (chips,
portalled anchored menu w/ existing-batch ✓ + New batch + Clear, bulk Move to
batch, By-batch grouping, unlabeled counters, label stamped at commit) · 04
artist cards → `?artist=` drill-down w/ By song / By batch + Recoupments
cross-link · 05 summary strip · 06 page-note scratchpad · 07 per-row UFR
(carrying its batch label — the bulk path stamps it and a per-row button that
dropped it landed the item on the statement unlabeled) + per-row not-recoupable ·
08 cobrand · 09 split (reuses `SplitModal`) · 10 invoice preview · 11 flags at
both grains · 13 soft-delete w/ undo · 14 bulk Set song · 15 plan-wide Done +
failure banner + deferred disclosure + navigate-on-clean · 16 persisted
save-for-later, deferred artists still visible with totals · 17 `?focus=` (scroll
+ expiring spotlight) · 18 Copy list · 19 socials chips · 20 ready markers
(badges on cards and song headers, ready artists PINNED above the money sort) ·
21 fetch failure has its own state + Retry · 22 select-all at page / artist /
section / category grain · 23 collapsible sections via `useCollapsed` · 24
ordering (artists ready-then-USD-desc, songs spend-desc, `(no song)` sunk) · 25
per-currency totals with a ≈USD suffix at every level, artist-less rows planned ·
26 tone (Unpaid reads `danger`, amounts `text-sm font-bold`, commit `bg-success`,
floating bulk pill) · 27 back-to-Recoupments pill.

**Already closed** by the recoupments campaign: **DEF-RPLAN-03** (`ufr-bulk`
re-reads under `recoupBaseSql`, caps at 2000, PRESERVEs stamps, audits) — the
only §7 row that needed nothing. Partially pre-closed: 02's schema + endpoints,
17's `?artist=`, 06's table.

**Not closed — DEF-RPLAN-12 (comment threads).** Deliberate, and the same call
the recoupments campaign made: cadence's comment model is `ObjectDiscussion` on
the ledger entry, and a second per-row comment store with its own bulk-fetch
endpoint would be two homes for one conversation. The row links to the ledger.

### (B) Recoupments audit — `/recoupments/audit`, five integrity checks

Not an audit-trail browser. Five predicates in ONE endpoint
(`GET /financials/recoupment-audit`), because a predicate about money that lives
in two places disagrees with itself eventually. Two find money NOT claimed, one
finds money never judged either way, two find money claimed wrongly — and they
are **never summed into one exposure headline**, since they need opposite
actions. Deliberately excluded: "claimed with no bank line", which already has a
tile on the Recoupments index.

**Every check still bites — none was made structurally impossible by the new
base-predicate gate**, and check 5 is now *more* dangerous than in the reference
app:

1. **Advances waiting for an artist** — bank-born, unanswered, no artist, in a
   category whose `ui_group` is `artist` or `record` (read from the per-label
   `categories` table, not a hardcoded list, so a workspace's own categories stay
   covered). This is a prioritized slice of the existing bank-review queue plus
   the two things that queue does not have: **`artist_proposal`** (an artist the
   payee contains, 4-char floor, longest key first — a convenience on a row a
   human is already reading, never applied for them) and **`ledger_twin`** (an
   invoice-side row at the same payee AND amount — answering "recoupable" there
   claims the same cost twice). Verified live: a $5,000 bank Advance surfaced its
   already-claimed invoice twin, and a `Zeke Bleu Touring LLC` payee proposed
   `Zeke Bleu`. Both computed ONCE per request, never per row.
2. **The bank pile, by category** — with `recoupment_class_rules`. This is the P2
   the port called out: per-row review cannot finish a pile whose long tail is
   card fees. Unlike the reference app, rules DO apply to check 1 as well,
   because `ui_group` is coarser than its hand-picked list (Royalties rides in
   `artist`). Rules also now filter the **existing** `/recoupments/review` queue
   AND the index's `review_pending` tile, so the pile total and the queue length
   are the same number by construction (verified: 3/$1,001 → 1/$100 on both).
3. **Possibly claimed twice** — `payee + normalizeInvoiceNum`, groups > 1,
   cross-artist first. A SENSOR, not a verdict, and the footer says so.
4. **Claimed with no document** — `has_doc` ORs the PARENT's file columns (a
   split child's invoice lives on its parent) and both storage paths; receipts
   count too, since a reimbursement's document IS a receipt. Grouped by artist,
   because the conversation this protects is one artist asking to see what they
   were charged for.
5. **Half a payment claimed** — and in cadence this is reachable by an ordinary
   sequence: **claim an entry, then split it.** `POST /ledger/entries/:id/split`
   gives the PARENT the first slice and inserts children without `ufr`, so the
   parent stays claimed at a smaller amount and the rest of the payment becomes
   unclaimed money that **no recoupment surface can show** — `recoupBaseSql` is
   `parent_id IS NULL` by design so a family counts once. Proved live: claiming
   #73 ($300) then splitting it 150/150 left #85 claimed by nobody and absent
   from `/planning` entirely. The finding names those `hidden_ids` explicitly.

**`POST /recoupments/claim-family {root_id}`** is check 5's fix and is its own
named writer rather than a loosening of `ufr-bulk`: that endpoint re-reads under
`recoupBaseSql`, and the rows needing a claim here are precisely the children.
Family-scoped, recoupable/approved/live only, non-bank, and it implements the
same timestamp rule — stamp on the transition in, **PRESERVE** on a row already
claimed. Verified: root's stamp unchanged, child's newly set.

**New server libs** — `lib/recoupClass.js` (`loadRecoupmentClassRules` /
`rulesFrom` / `notClassRuledSql`; EQUALITY never substring, both sides
lower+trim+collapse-whitespace, label-scoped inside the NOT EXISTS),
`lib/recoupContext.js` (proposals + twins, both pure-indexable),
`lib/recoupAudit.js` (`sumUsd` rounds ONCE at the end — the deliberate contrast
with `lib/usd.js` `rowUsd2`, which rounds AT THE ROW for sheets that slice the
same rows twice — plus `groupDoubleClaims` / `partialFamilies` /
`groupNoDocument`).

**Schema added** (IF-NOT-EXISTS, after `recoupment_notes`): table
`recoupment_class_rules (label_id, scope, rule_key, reason, created_by,
created_at)` + unique `(label_id, scope, LOWER(TRIM(rule_key)))`.
`expenses.recoup_reviewed` already existed. `db.js` TENANT_TABLES and
`full-export.js` both registered.

**Fixtures: 71 → 90.** The 19 new ones hold: a `Salary` rule leaving
`Salary (Felipe)` alone (and the SQL using `=`, not LIKE, and carrying
`rcr.label_id`); vendor rules crossing categories; the proposal's 4-char floor
("3ee" inside "Three Fifteen Media"), longest-key-first, never-onto-a-named-row;
the twin key being payee+amount to the cent; `sumUsd` rounding once (three
half-cents are $0.02, not $0.03) and honoring a locked FX rate; invoice-number
normalization grouping `INV-001` with `001` while a blank number groups nothing;
cross-artist sorting first even when smaller; partial families requiring BOTH a
claim and an open slice, and naming the child slices as hidden.

**Live verification** (dev workspace 2): each check was made to fire by creating
its condition, then cleared by its own remediation — advance answered
recoupable-with-artist moved $2,500 onto Zeke Bleu (12→13 items) and answering
"no" cleared `recoupable`; a class rule dropped pile+queue+tile together and
DELETE restored all three; two spellings of one invoice number grouped
cross-artist and un-claiming one dissolved the group; un-claiming an
undocumented row dropped check 4 by exactly its amount; claim-family closed
check 5 without moving the root's stamp.

**Known, not fixed here**: split families are counted at the root only while the
root holds just its FIRST slice, so a cross-artist split under-attributes on
Recoupments. That is a ledger-model question, not an audit one — the audit now
measures it instead of leaving it silent.

---

## Phase 5 — artist campaigns + ad pool (2026-09-01)

Two coupled deliverables: the `_audit/pages/artist-campaigns.md` §7 register (21 rows)
and the `missing--ad-allocation.md` port that the 2026-08-27 plan deferred. **Fixtures
90 → 115.**

### (A) Artist Campaigns — two layers, and one of them was double-counting

**The headline (DEF-ACAM-01) needed a change of basis, not a port.** The reference app
guards its two layers with `bank_evidence IS NOT NULL`, because ITS P&L is
STATEMENT-mastered: a row is settled exactly when a bank line shows it. Cadence's P&L is
LEDGER-mastered cash (approved + Paid, family-dated by the root), so a paid row with no
bank line is ALREADY in the settled layer. Porting that predicate verbatim double-counts
it — caught on the first live run: Zeke Bleu read $1,200 settled and $1,200 "awaiting",
the same money twice.

So the guard here is **set MEMBERSHIP**: `buildPnl` gained `opts.collectCountedIds`, a Set
of every `expenses.id` it counted as operating expense, and `S.partitionByLayer(rows,
countedIds)` (pure, fixtured) splits the in-scope members into Settled and Committed with
every row on exactly one side. A predicate reconstructing "approved and Paid and dated in
range and not report-dismissed and not month-moved" drifts the first time either side
changes; a set cannot. Live: `double_counted_prevented: 9`, and Settled + Committed now
add up.

Consequence worth knowing — **the Committed sub-buckets are cadence's, not the reference
app's**: unpaid / paid-outside-range. "Paid with no bank line" moved to where it actually
belongs, as a QUALITY statement about the Settled layer (`settled_with_bank_line` /
`settled_awaiting_statement` / `flagged_no_bank_line`), and the card renders it under
Settled. Same information, attached to the layer it describes.

**Scope is now a disclosed per-label category LIST** (DEF-ACAM-05): `categories` rows with
`ui_group = 'campaign'` — the workspace's own "Campaign & promotion" classification, the
same one Artist Budgets sections on — replacing the undisclosed regex
`market|advertis|promo|influenc|public|social`, which swept in any free-text category
containing "public" or "social". Both layers scope on category ALONE, on purpose: the
Settled layer comes from `by_artist.by_category`, which has no per-row dimension, so a
per-row include/exclude would scope the two layers differently and they could not be
added. `expenses.artist_campaign` survives as the MARKER other surfaces read, and is now
kept in step by dismiss / restore / not-a-campaign (DEF-ACAM-19: FALSE on exclusion, NULL
on restore — restoring is not the same as asserting yes).

**New `server/lib/campaignScope.js`** — one definition of scope, the two flag_dismissal
kinds, `songKeyOf`/`NO_SONG_KEY`, `bestOf` (most-used spelling, ties alphabetically), and
`partitionByLayer`. Every consumer discloses the resolved list in `meta.scope`.

**Closed, all 21 non-[INT] rows.** 01 two layers (above) · 02 the catch-up **QUEUE**
(`?view=queue` inside the same route so it inherits the page permission;
`GET /queue` with the PROBLEMS array as the single definition behind chips, filters and
counts; 5 sorts, search, header totals reduced over the SHOWN list, invoice-side
disclaimer, `unlinkable` orphan disclosure, mark-complete) · 03 **attribute-unattributed**
(`UnattributedModal` drills `/reports/pnl/detail?kind=artist&key=&drillCategory=` per
campaign category — the SAME buildPnl the figure came from, so list and number tie by
construction — writes `/reports/set-artist` on **PART ids**, offers vendors → label-level
rule, discloses recoveries and truncation; plus the `unassigned` pseudo-artist page) ·
04 disclosure meta (`campaign_total`, `coverage_pct`, `label_level`, `excluded`,
`recoveries`, `scope.basis`, `ties_to_pnl`) · 06 status universe back to
`IN ('approved','pending')` · 07 `excludeBankRows` on the family ROOT (a split child has
no `entry_source`, so a member-level test lets a bank-born slice through) · 08
**rename-song** as ONE transaction across three places (ledger + `releases.project_name` +
the `song_campaign_status` key move with a collision rule, plus `recoupment_notes`) and a
UI that calls it · 09 export fidelity (per-song section bands w/ release meta and a
Finished/In-progress rail, a **Bank** column, the Invoiced · Unsettled · Unpaid subtitle,
Notes, banding, status tints, autofilter, real date cells, per-currency numFmt, datestamped
filename) · 10 card anatomy (complete-toggle circle, flag button w/ rolled-up song-flag
count + reason modal, reconciled chip, campaign-count line, **three discrete H/M/L
buttons** replacing the native `<select>` the reference app abandoned for touch quirks,
two-layer money rail) · 11 review assignment UI + `/reviewers` + a badge that counts
exactly what the tray renders + open threads rendered · 12 campaign link/unlink UI ·
13 `bulk_deal_items` rollup + evidence links · 14 dismissed tray (`?include_dismissed`,
per-row Restore, undo toast) · 15 the leaf-only `NOT EXISTS` is gone entirely — every
family member carries its own slice · 16 parent socials inherited for display (marked as
inherited) · 17 `__no-song__` slug + display spelling in crumbs and headers · 18
`useFocusRefetch` · 20 songs ordered spend-desc then release-date, group totals labelled
**Invoiced** · 21 the export header takes `labels.accent_color`, not a copied brand red.

**Detail is UNSCOPED with a FLAG, not a filter**: every row for the artist arrives
carrying `in_scope` and `family_source`, and only `counted` rows move the totals — which
is what lets those totals agree with the card while Legal and Recording rows stay visible
for context. Out-of-scope rows are disclosed by count and total.

### (B) Allocate Advertising — `/ad-allocation`, the ad pool

**What it does.** Ad-platform charges carry no artist evidence at all (merchant-id
descriptors repeated on every charge), so nothing can be attributed FROM them. The page
allocates a month's REAL bank charges to **campaigns** — and so to artists — by writing
real ledger split families whose slices are marked `recoup_reviewed` + `recoupable` +
`entry_source` (inherited) + `campaign_id`. Four columns the shared split writer does not
set, each load-bearing; that is why this does not call it. An allocation that wrote to a
side table would be invisible to Recoupments, the spend sheets and the recoupment audit,
which is exactly why a ledger-external ad pool goes unused.

**Math guarantees, all fixtured.** `lib/adAllocate.js` is pure, cents-only:
`apportion` is largest-remainder and sums EXACTLY ($422.00 three ways is not $422.01;
$500 → 166.67/166.67/166.66), deterministic on ties so a dry run cannot disagree with the
write; `drawMany` is greedy oldest-first and SEQUENTIAL, so the sum of all slices can never
exceed the month, and an unfundable request is NAMED rather than trimmed; `familySlices`
puts the unallocated remainder FIRST so the pool row keeps the parent's identity, and
THROWS on over-allocation. The write additionally **asserts the family still sums to the
charge to the cent** before committing, and the per-slice undo asserts the total is
unchanged. Preview and write share `planAdAllocation` — one derivation, so what is
approved is what is written.

**The pool is declared, not guessed.** New `label_level_spend_rules` (vendor|category,
EQUALITY never substring, both sides lower+trim+collapse-whitespace — modelled on
`recoupment_class_rules`) + `lib/labelLevel.js`. `buildPnl` gained `opts.collectLabelLevel`
so the page lists precisely the rows the label-level test fired on; a second query with its
own idea of label-level is how a drill-through starts disagreeing with its report.
**Deliberate divergence from the reference app:** there label-level is a THIRD bucket
beside attributed and unattributed. Cadence's `by_artist.ties_to_pnl` is a shipped contract
the Reports client REFUSES to render on, so here label-level is a disclosed SUBSET of
unattributed — a row qualifies only when it already names nobody. Nothing moves buckets,
`ties_to_pnl` is untouched, and `label_level.total <= unattributed.total` by construction.
Also deliberately NOT unified with `statement_artist_rules.is_overhead`: that answers "do
not GUESS an artist for this bank descriptor" at booking time, a different question. The
rules modal offers unattributed-vendor candidates as suggestions instead.

**Endpoints** (`routes/reports.js`, label-scoped, under the router-wide `requireApprover`):
`GET /ad-months` (ONE buildPnl over the whole range grouped by the collector's stamped
month — not 18 P&Ls and not a cheaper second query), `GET /ad-charges?month`,
`POST /ad-allocate` (`{campaign_id, amount}` or `{allocations[]}` + `proportional` for an
Ads Manager import, `dry_run` for the preview), `DELETE /ad-allocate/:expenseId` (per-slice
undo — the grain the mistake is made at; folds back into the open sibling, or strips the
labels in place when the slice IS the root and deleting it would destroy the bank match),
and `GET/POST/DELETE /label-level-rules`. `adMonthState()` is shared by the listing, the
dry run and the write so all three agree by construction, re-adds fully-allocated charges
the collector no longer sees, orders on `adDay()` (a JS Date stringifies to a WEEKDAY NAME
— that trap once made the greedy draw consume the wrong charge), and names every reason a
charge cannot be restructured rather than filtering it out.

**Client**: `pages/AdAllocation.jsx` + `components/adalloc/{ChargeTable, AllocatePanel,
ImportMapper}.jsx` — month nav opening on the OLDEST month with pool, a backlog bar strip,
a three-number reconciliation line with a rose "listing vs report" warning above 2¢,
campaigns card + inline New campaign, preview→apply, per-slice undo behind `ConfirmDialog`,
and a CSV importer that assumes NO schema (header row is read and pointed at, mapping
remembered per platform, quoted-comma-safe splitter) treating the file's numbers as
WEIGHTS only. Nav: Reports group → "Allocate Ads", Approver+.

### Schema (all IF-NOT-EXISTS)
`label_level_spend_rules (label_id, scope, rule_key, reason, created_by, created_at)` +
unique `(label_id, scope, LOWER(TRIM(rule_key)))`; `campaigns.release_id` (so an
allocation carries a song — added after the `releases` CREATE, per the FK-ordering
landmine); `idx_expenses_campaign`. `expenses.campaign_id` already existed and points at
`campaigns`, which is why the ad pool allocates to that table and not to
`influencer_campaigns` (the per-artist creator campaigns the hub links the other way).
`db.js` TENANT_TABLES and `full-export.js` both registered.

### Live verification (dev workspace 2)
Double-count guard: a row settled AND in scope is counted once —
`double_counted_prevented: 9`, Zeke Bleu $1,200 settled / $3,369.57 committed (was
$4,569.57 with $1,200 duplicated). Allocation: two vendor rules gave a $500 pool;
1:1:1 weights apportioned 166.67 / 166.67 / 166.66 = **$500.00 exactly**; the family
summed to 50,000¢ after the write; `pool_usd === open_usd === 0`; the P&L expense total
was **unchanged** at $7,771.50 with `ties_to_pnl` still true, and $500 moved out of
unattributed onto three artists. Slices verified carrying `entry_source` inherited,
`recoup_reviewed`, `recoupable`, `campaign_id`. Per-slice undo returned $166.67 with the
family total unchanged. `/reports/ad-months` total ($265.67) equals the campaigns index's
`meta.label_level.total` — two surfaces, one derivation. rename-song moved 8 ledger rows +
1 release + the status row (finished and notes preserved). dismiss → `artist_campaign =
false`, restore → NULL. `review-assign` rejected an out-of-workspace user id (1 of 2).

### Not done
Nothing from the §7 register. [INT] rows skipped as marked: tenancy + the Approver floor,
generic error bodies, chat mentions via `recordMentions`, header-auth export blobs, and the
`artist_campaign` boolean mechanism. The legacy `ad_pool_allocations` table was
deliberately NOT ported (the spec says build v2 and skip it). Known and unchanged: split
families are still counted at the root on Recoupments while the root holds only its first
slice — the Artist Campaigns layers do NOT have that bug (every family member carries its
own slice here), but this work did not make the Recoupments ledger-model question
decidable, so it stays as the audit measures it.

---

## Phase 5 — creators + artist budgets (2026-09-01)

The two pages built on 2026-08-27, closed against `_audit/pages/creators.md` §7
(17 rows) and `_audit/pages/artist-budgets.md` §7 (17 rows). **Fixtures 115 → 120.**

### The P2 that mattered — unconvert was laundering undocumented rows

`match_method='creator'` is the disposition that says **explained, never
invoice-backed** (`bank-matching.js` buckets it away from `matched`, which
`invoice_backed_pct` reduces over). Converting a campaign/recoupment row into
Creator Payments relabels its live bank matches to it. Unconvert then reset
**every** such match to `'manual'` **unconditionally** — and `'manual'` IS
invoice-backed. So the round trip *created* a claim: an undocumented row came
back out of Creator Payments asserting a document it never had.

It is not fixable by guessing, because the prior method is real information
(`auto-email` / `auto-alias` / `rematch` / NULL / …). So **convert now audits it**:
one `bk_audit_log` row per bank transaction (`field='match_method'`,
`old_value=<prior>`, `detail='bank_txn:<id>'`), written in the same transaction as
the `entry_source` audit it already wrote. `lib/ledgerSource.js`
`restoreMatchPlan(auditRows)` is the pure reader (fixtured), and unconvert scopes
to rows with `id >` that conversion's `entry_source` audit row, so an older
convert/unconvert cycle cannot supply a stale method. Three rules, all held by
fixture and proved live:

- the audited method comes back **exactly** — `auto-email` → `creator` → `auto-email`;
- a match that carried **NULL** goes back to NULL, never to an invented `'manual'`;
- a match made **after** the conversion has no audit row and **stays `'creator'`** —
  explained-not-invoice-backed over-states nothing, which is the safe direction.

Live (workspace 2, expense #80 with three matches): `invoice_backed_pct`
34.5 → 31.2 → 34.5 across convert/unconvert, `explained_pct` **unchanged at 47.8
throughout** (a creator match is still explained), and the post-convert match
stayed `creator` — `{restored:1, matches_restored:2, matches_left_creator:1}`.
Convert also gained the dry-run detail it was missing (`would_relabel_matches` +
per-row `{id,payee,from}`), reads the txn set **once** from the same predicate the
UPDATE uses, and 404s when nothing is eligible.

### Creators — the rest

Closed: **03** directory regains Socials (first-non-empty-wins) + Last paid + a
sorted artist list — that tab is where the move-in queue's gaps get filled, and it
could not show them · **04** the move-in queue gets its `summary` (convert/review
counts and values, already-matched count) and the **universal-gaps banner**: gaps
shared by *every* mover are hoisted into one line and only the per-row deltas stay
on the row, because those pages never collected contact details and printing that
on all N rows buries the 5 that are missing a song. Plus the Category column,
`already_matched` tag and the amber review tint · **06** the selection re-derives
on reload (a `useState` initializer left ghost ids and the "Move N in" count lied)
· **07** search is a **server** query again (the list is capped at 1000, so
filtering the fetched page quietly searched a subset), `vendor_email` added to the
`?q` fields, and the total is displayed beside it · **09** the W9 test honours
`w9_filename` (it was SELECTed and ignored) · **10** `by_year` accumulates raw and
rounds once — a per-add round can flip $599.995 either way against a threshold ·
**11** `payingId` in-flight guard (a double-click re-stamped `paid_marked_at` and
re-fired the FX stamp) · **12** delete moved to `ConfirmDialog` and names the USD
figure · **13** dry-run detail (above) · **14** "Another creator" carries the
previous row's artist and song forward · **15** batch footer gets the running total
and the first-gap hint · **16** `scan-w9s` excludes creator rows, matching the
`/vendors` exclusion it renders against · **17** `ufr` joins the PUT whitelist,
booleans **validated not coerced** (a string `"false"` through a boolean column
reads TRUE), and claiming **PRESERVES** an existing `ufr_marked_at` — the same rule
`/recoupments/ufr-bulk` implements.

**Skipped, with reasons.** **DEF-CRE-05** (payments queue excludes creator rows) is
a **prior-phase contract**, verified still holding along with the `/vendors` and
`/vendor-suggest` exclusions and the 1099/recoupments/campaigns *inclusions*
(live: Ava Loops at $2,300 appears in the 2026 1099 report under the OBBBA $2,000
threshold and in `/financials/planning`; absent from all three exclusion surfaces).
**DEF-CRE-08** (list total sums row-rounded figures rather than rounding once) is
now *more* clearly right, not less: closing DEF-CRE-07 put that total on screen
**beside the rows it is made of**, so it has to equal what a reader can add up.
Round-at-the-row is the shipped convention (`lib/usd.js`). **DEF-CRE-02** (OLD
page-grants marketing below Approver) needs a `requirePagePermission` middleware
cadence does not have; every finance route in the app sits on `requireApprover`,
and lowering exactly one of them is a hole, not a permission model.

### Artist Budgets — and two date bugs the audit could not see

Closed all 17. Server: per-artist `count`/`open_count` and totals
`with_budget`/`committed`/`open_count` (**04**, **06**); sections gain
`categories[]` **with counts**, `updated_at`/`updated_by_name` (**11**, **12**); a
**globally** oldest-first `open_rows` (**07**) — the client was flat-mapping
sections, so the copy promised an ordering the page did not have. Export (**01**,
**02**, **03**, **17**): a **Note** column carrying the section note *and* the
unplanned / over-committed conditions that otherwise exist only as a colour; the
**OPEN · UNPAID INVOICES** block with per-invoice rows, a thin-ruled STILL TO PAY
and a double-ruled COMMITTED; the four **state-split prose rows** ("Of that spent —
confirmed on a bank statement…"), because the recipient of this file has no legend
and no hover; and the filename is the artist's **display spelling**
(`Zeke Bleu - budget vs actual.xlsx`), taken by the client from
`Content-Disposition` rather than re-derived from the mangled key.

Client: the sheet is **one table** again (**14**) — section, category and expense
rows share columns, so a figure at any depth aligns with the one above it and the
`tfoot` SPENT band is visibly the column's sum; headline gains the over-committed
warning line and the "of what has been spent" state strip. `PayeeLink` (**09**,
new shared component) opens `/vendors?vendor=` **in a new tab** — `Vendors.jsx`
gained that query param as its deep link, since there is no `/vendors/:name` route
— so a side-trip does not cost your place on the sheet. Non-USD rows show the
original amount again (**10**). Index `StateBar` gets its text sublabel back
(**05**): a bar with no numbers can only be hovered, and "how much of this spend is
provable to a partner" was a fact you had to go looking for. Empty sections are
dimmed but still live (**13**) — that input is how a budget gets set at all. The
Age chip is suppressed under 30 days and anchored at **noon UTC**. An unusable
budget **toasts** instead of silently snapping back. Sheet load failure gets a real
error card with Retry and a back-link (**16**) instead of an eternal skeleton.

**The `note` field the audit asked about: neither side had UI for it** — it reached
only the export. It now has an inline per-section input, because a field only an
export can read is a field nobody fills. `PUT` already accepted it; the amount-save
still passes `note` through, so cadence keeps the corrected behaviour (OLD's client
wipes the note on every amount save).

**Two date bugs found while verifying, not in either register.** node-pg returns
`DATE` as a **JS Date**, and `String(aDate)` is `"Sun Jun 01 2025 …"` — a **weekday
name**. The new global `open_rows` sorted on that and ordered the worklist by
*day of week*: a 2025-04-03 invoice sat below five 2025-06-01 ones. The same trap
put `"Thu Apr 03"` into the workbook's date cells. Everything comparing or printing
a date in `artist-budgets.js` now goes through one `isoDay()` helper. (This is the
same trap `lib/adAllocate.js`'s `adDay()` exists for — third sighting.)

Also worth knowing: **`bg-elev/60` emits nothing.** `elev`/`page`/`card` are plain
`var()` tokens, so Tailwind cannot apply an alpha to them — only the *function*
colours (`success`/`warning`/`danger`/`info`) route `/NN` through `color-mix`. The
new code uses the tokens straight. The repo-wide `bg-page/50` on ~every table
`thead` is dead for the same reason; left alone here rather than making two pages
diverge from every other table.

### Files touched
`server/routes/creators.js`, `server/routes/artist-budgets.js`,
`server/routes/ledger.js` (scan-w9s), `server/lib/ledgerSource.js`
(`restoreMatchPlan` + `CREATOR_MATCH_DETAIL`), `server/scripts/finance-fixtures.cjs`
(+5); `client/src/pages/Creators.jsx`, `ArtistBudgets.jsx`, `ArtistBudgetSheet.jsx`,
`Vendors.jsx` (`?vendor=` deep link), new `client/src/components/PayeeLink.jsx`.
**No schema change, no new deps.**

---

## Stack & deploy (as built — matches spec §2 unless noted)

- **Backend**: Node/Express 4, PostgreSQL via `pg` (raw parameterized SQL). JWT in
  `server/lib/token.js` (claims: user_id, label_id, email, role, department,
  hierarchy_level, is_platform_admin, platform_role, tv). Auth middleware
  (`server/middleware/auth.js`) re-reads the user row per request (token_version, user
  active, label status). bcryptjs, multer, jsonwebtoken.
- **Frontend**: React 18 + Vite 5, plain JS, React Router v6, Tailwind v3, Recharts,
  Lucide, Axios w/ JWT interceptor + 401 redirect.
- **Files**: Cloudflare R2. `server/lib/r2.js` exports uploadFile / getSignedFileUrl /
  downloadFile / loadFileBase64 / loadFileBuffer / deleteFile. Key shape
  `label-{id}/ledger/{type}-{ts}_{sanitized}`. NOTE: no MIME sniff on upload (spec §9.4
  gap); auth IS enforced on file GET.
- **Schema**: all tables in `server/index.js` `runMigrations()` at boot via
  `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Deploy**: Railway, push-to-`main`. Push via
  `GIT_SSH_COMMAND="ssh -i ~/.ssh/cadence_deploy -o IdentitiesOnly=yes" git push origin main`.
  Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify before push**: `cd client && npm run build`; `npm run check:tdz` (see below);
  `node --check` changed server files; `node server/scripts/finance-fixtures.cjs` (140 assertions).
  `client/scripts/check-tdz.cjs` is a Babel scope analyzer that fails the build on a
  `const`/`let` READ before its own declaration in the same function scope — a
  ReferenceError at runtime that `vite build` accepts happily. It exists because a
  `useMemo` dependency array referencing a `const` 300 lines below it shipped a
  production crash. Nested-function references are excused (they run later), as is a
  reference on the declaration's own line.
- **Design tokens**: `client/src/styles/tokens.css` (light+dark CSS vars + full gray
  palette + semantic aliases bg-card/text-ink/border-rule/border-divider/bg-overlay).
  NO `getDarkColors(theme)` JS mirror yet; NO `components/ui/` kit; NO `Skeleton`; NO
  shared `formatDate()`/local-calendar helpers. (spec §2 gaps.)

---

## Built inventory — rewritten 2026-09-02 (Phase 10 QA)

**This section replaces the pre-audit "Built inventory" and "Gap map" that stood
here until Phase 10.** Those were written against the 2026-07-27 audit and were
repeatedly proven wrong by later phases — they still called Usage analytics,
`/manual`, the platform Analytics page and the mobile BottomNav "MISSING" long
after each had shipped. A gap map that has to be corrected in a footnote is worse
than no gap map, so the milestone-by-milestone version is gone. **The single
source of truth for what is still open is now `_audit/97-remaining.md`**; the
dated phase entries below and above are the record of how each area got built.

### How to check a claim rather than trust one
Every statement here was re-verified live on 2026-09-02 against a seeded
workspace. Three harnesses exist and should be re-run rather than reasoned about:

| Harness | Proves | Command |
|---|---|---|
| `client/scripts/check-render.mjs` | every route in `App.jsx` module-loads AND server-renders | `node scripts/check-render.mjs <routes.json>` |
| `client/scripts/check-tdz.cjs` | no const/let read before its declaration in the same scope | `npm run check:tdz` |
| `server/scripts/finance-fixtures.cjs` | 164 pure-function money/date assertions | `node server/scripts/finance-fixtures.cjs` |

`npm run build` proves **none** of these. It is a bundler, not an interpreter: it
happily ships a `useMemo` dep referencing a `const` 300 lines below (the `/ledger`
crash) and an undefined JSX component (the `Check` crash in Phase 10 — see below).

### Surface inventory (all verified rendering + responding 2026-09-02)
- **562 server routes** across 47 mounts, all enumerated by introspecting the
  Express routers. Every GET returns 2xx or a deliberate 4xx; no 500s. Every
  write route rejects an empty body with a validation error rather than a crash.
- **84 client routes** in `App.jsx`, all of which module-load and render.
- **Nav integrity**: every `buildNavGroups` entry resolves to a real `<Route>`,
  and every `PAGE_LABELS` key resolves to a real `<Route>`. Nav item counts by
  role: Admin 49 · Approver 42 · User 16.
- Routes deliberately absent from nav: the public/auth pages (`/login`,
  `/accept-invite`, `/reset-password`, `/privacy`, `/eula`), the platform-shell
  pages (`/analytics`, `/announcements`, `/operators`, `/account` — they have
  their own `PlatformLayout` nav), and `/notifications` + `/manual`, which are
  reached from the bell and the header help button respectively.

### Areas, and where their detail lives
Foundation/tenancy, roles/permissions, the finance core (Ledger · Approvals ·
Payments · Vendors · public vendor form · Create Invoice), finance depth
(Reports · Bank Statements · Bank Matching · Recoupments + Planning + Audit ·
Creators · Artist Budgets · Recording Budgets · Artist Campaigns · Ad
Allocation), label ops (Releases · Catalog · Roster · Deals · Contracts +
generation · Legal/NDAs · Clearances · Admin Docs · Salary · Duplicates),
collaboration (Messages/chat + attachments + mentions + activity bot · My Work ·
Team Work · Internal Requests · Notifications · Usage analytics) and the
cross-cutting shell (⌘K search · notification bell · dark mode · mobile shell ·
hotkeys · `components/ui` kit · escape stack · focus trap) are all **built and
live**. Each was brought to boom parity by a dated campaign in this file; read
the campaign entry for that surface for its exact closure count and its
documented skips, and `_audit/pages/<surface>.md` for the row-level register.

---

## Phase 6 — releases + catalog (2026-09-01)

Boom parity for `_audit/pages/releases.md` (30 rows), `release-detail.md` and
`catalog.md` (17 rows). **Zero new deps.**

**The headline: there is now ONE release workspace, mounted two ways.**
`components/ReleaseWorkspace.jsx` owns all 7 tabs (Checklist · Metadata & Links ·
DSP · Budget · Activity · Comments · Details) and renders either **inline inside
an expanded list row** (`variant="inline"`, boom's model) or as the body of
`/releases/:id` (`variant="page"`). The parent owns the release object and takes
server responses through `onPatched(row)`, so an inline edit updates the row
behind the workspace with no refetch. Any future tab lands in both surfaces or
neither — that is the whole point of the split.

- **Catalog membership is a FLAG again** (CAT-1/REL-21): `releases.in_catalog`
  + `catalog_locked`, with a boot backfill (past-dated & unarchived → in, future
  → out) that **skips `catalog_locked` rows**. Boom's backfill silently reverted
  "move back to tracker" on the next boot; the lock column is the fix.
  `PUT /:id/catalog` and `PUT /:id/archive` are NOT-toggles with their own
  endpoints (atomic — two people clicking Archive can't both read `false`), both
  `logActivity` + audit.
- **List scope + params** (REL-03/REL-22): `GET /releases` defaults to the
  PIPELINE — unarchived AND not-cataloged — ordered soonest-first when
  `upcoming=true`, newest-first otherwise. Params: `status, q|search`
  (project·artist·**ISRC·UPC**), `month(YYYY|YYYY-MM)`, `date_from/to`, `artist`,
  `genre`, `priority`, `release_type|type` (all case-insensitive), `upcoming`,
  `archived (true|false|any)`, `in_catalog (true|any)`, `limit`. **Two callers
  had to opt out of the new default**: `Dashboard.jsx` (`in_catalog=any`) and
  `AdAllocation.jsx` (`archived=any&in_catalog=any`) — anything else reading
  `/releases` for a picker must do the same or silently lose rows.
- **`release_audit_log`** (REL-18/REL-28) — per-release history written by PATCH
  (core fields + checklist, old→new), archive, catalog and create. `/:id/audit`
  serves it; `/:id/activity` now merges it with activity_log rows matched on
  **`release #<id>`**, not `ILIKE %project_name%` (which pulled unrelated rows
  and orphaned history on rename).
- **Merge** (REL-05, `flags.js`): still N-way, now **ORs the 14 checklist
  booleans** and reassigns `release_comments` / `release_budget_items` /
  `release_audit_log` before deleting the source — all three CASCADE off
  `releases`, so without the explicit UPDATE the merge destroyed the source's
  discussion, budget and history. Fills 22 columns (was 10) and returns the
  survivor row. A floating select-bar + keep-one modal now lives on the list
  (admin-gated); `/data-quality` is unchanged.
- **Other server**: `DELETE /:id` is `requireAdmin` (was ungated — any member
  could permanently delete); comment delete is author-or-Admin (label scope is
  not authorization when every member is in the label); `PUT /:id/budget/items/
  :itemId`; create requires `release_date` and accepts `artist_name`
  (find-or-create in-tenant), as does PATCH — so a release's artist is editable
  again (REL-19).
- **New columns**: `in_catalog`, `catalog_locked`, `subgenre`, `apple_id`,
  `presave_link`, `presave_analytics`, `ugc_link`, `apple_music_link`,
  `distributor_notes`, `cover_art_status` (+ `release_audit_log` table + index;
  `db.js` TENANT_TABLES; releases.csv in full-export). The boot backfills carry
  `/* no-tenant */` — they are cross-label by construction.
- **List UI**: 7 filters (Year·Month·Genre·Priority·Type·Status·Upcoming/Past)
  in a pipe bar + Archived scope toggle + Clear; 300ms-debounced search that
  **bypasses the filters at ≥2 chars** behind a fetch-generation guard;
  collapsible banner (only `pct < 100`, colour-coded countdown, chip →
  clear-dates + expand + Checklist + scroll); 9 columns incl. merge checkbox,
  Genre, Priority badge, Assigned pill, emerald-at-100% bar and inline Archive;
  "N releases" header; hotkeys `n v j k Enter 1–7`; `Skeleton.PageHeader +
  Table`.
- **Calendar** (REL-06/REL-11): buckets by `parseLocalDate` (the bare
  `new Date('YYYY-MM-DD')` is UTC midnight → wrong day west of UTC), chips
  coloured by completion/priority with a legend, today marker, no chip cap,
  driven by `shown` so filters apply, click jumps to the expanded row.
- **Catalog**: server-side filtering again (`in_catalog=true`, or
  `archived=true&in_catalog=any` for the archived view — CAT-2, so a delayed /
  never-released project is findable); artist typeahead with most-common-spelling
  dedup; 6 time presets incl. 6-mo and Custom range, plus Year+Month drill,
  mutually exclusive with the presets; hotkeys `s` + `1–6`; whole-card click
  carrying `state.from='catalog'` (the detail page's back link reads it);
  Spotify/Apple hover overlay; per-type badge tints; labelled UPC/ISRC; error
  state; live counts + sync status text.
- **CAT-3 was already done** — Phase 2 built the general
  `POST /releases/sync-artwork` (2-phase, `not_found` sentinel, `remaining`,
  `days/force/retry`, 50/100ms pacing, `disabled:true` when Spotify is off).
  Catalog now DRIVES it with boom's ≤30-batch loop, no-progress guard and 500ms
  gaps instead of its own 40-row per-id loop. Nothing was rebuilt.
- **`utils/releases.js`** (new, pure): `progressOf`, `parseLocalDate`,
  `countdownOf`, `priorityToneOf`, `spotifyUrl`, `hasArtwork`. The list, the
  calendar and the workspace share it so they can't disagree about a percentage.
  `constants.js` gained `GENRE_OPTIONS`, `BUDGET_CATEGORIES` (release
  workstreams — deliberately NOT the expense chart), `COVER_ART_STATUSES`,
  `PRIORITY_TONES`.
- **Budget tab** (REL-15/24/27): summary bar (planned / cap / remaining
  over-or-left / 80%-amber 100%-red progress), grouped by the 9 budget
  categories with per-category totals, 2-decimal money, Description input, edit
  route.
- **Checklist** is optimistic again — `flushSync` + rollback + in-flight
  disable (REL-23).

**release-detail rows** (`release-detail.md`, the 18 page-specific RD-N): the
back-link is catalog-aware again (`state.from==='catalog'`, set by the Catalog
card), the header carries priority/type/archived/in-catalog pills + a colour-coded
countdown, completion has the big % + ring with a 100% green state, History merges
audit + activity with humanized field lines, comments return `user_id` so the
client delete gate mirrors the server, Archive is a race-safe server toggle with a
busy state, and loading is a real skeleton. Also fixed: **RD-2** — PATCH now
rejects a blank `project_name` (it's NOT NULL and is how the record is found;
saving an empty Metadata box used to blank it); **RD-9** — stored links render as
actual link chips (Spotify URI via `spotifyUrl`, Apple Music, pre-save, analytics,
UGC), which nothing in the app did before; **RD-17** — Escape on the detail page
confirms before discarding unsaved Metadata edits (`onDirtyChange`).

**Deliberately not done, with reasons:**
- **RD-1 (boom's 4-tab + 296px sidebar detail architecture)** — directly
  contradicts REL-01, which wants the 7-tab workspace to be THE model on both
  surfaces. Re-forking the detail page is the drift the shared component
  exists to prevent. The Details tab does now render core fields read-mode
  with an Edit toggle, which is the part of RD-1 that was really missing.
- **RD-8 (Budget tab vs `recording_budgets`)** — reconciling the release
  budget store with the Recording Budgets feature is a cross-feature money-path
  change, out of scope for a releases pass. `release_budget_items` +
  `releases.budget_cap` remain the release-tab store.
- **RD-18** — no analog needed: cadence computes `artists.total_releases` in
  SQL rather than storing it, so nothing can drift out of sync.
- **REL-04 (checklist key set)** — boom's 14 keys vs cadence's 14 differ by
  name and grouping. Renaming 14 boolean columns is a destructive migration
  that changes every completion % and buys nothing; cadence's set is a
  considered redesign. Left as-is.
- **REL-14 platform rename** — order now matches boom (TIDAL → Pandora →
  Deezer) and the Submitted/Approved colours are swapped to boom's
  (Submitted = info blue, Approved = amber "accepted but not live"). The
  `iHeartRadio` spelling is KEPT: it's the brand's own, and renaming would
  orphan every existing `dsp_submissions` row.
- **Releases keep `release_comments`, not `ObjectDiscussion`** — that store
  predates this phase and already feeds `recordMentions` + the notification
  bell. Adding ObjectDiscussion here would create a *second* comment store for
  the same entity.

---

## Phase 6 — artists + profile + calendar (2026-09-01)

Boom parity for `_audit/pages/artists.md` (22 AR rows), `artist-profile.md`
(24 AP rows) and `calendar.md` (25 C rows). **Zero new deps.**

**Releases-default audit (the flagged risk) — CLEAN, nothing was silently
shrunk.** Neither surface reads `GET /releases`: the artist aggregate queries
the `releases` TABLE on `(label_id, artist_id)` and the calendar feed queries it
on `(label_id, release_date IS NOT NULL)`. Verified live — `GET /releases`
returns 3 (pipeline), `?archived=any&in_catalog=any` returns 6, and the calendar
feed carries all 6 release events; the artist aggregate returns all 3 of Test
Artist's releases. The only `/releases` client callers remain Releases, Catalog,
Dashboard, AdAllocation and ReleaseDetail.

### The security fix worth naming
**AR-2 / AP-4 — contracts were leaking to every workspace member.**
`GET /artists/:id` returned `royalty_split` and `advance` to anyone in the label.
Now gated at BOTH layers, the way boom had it: the server returns `[]` below
Approver and ships `contracts_visible`, and the client hides the tab on
`contracts_visible && canView('/contracts')` — hiding a tab is presentation, not
authorization, so neither layer is load-bearing alone. Verified live: a
role=User token gets `contracts: []`, an Approver and a Superadmin get the row.

### Artists roster — a 95-line grid became the workstation
- **AR-1 was already closed** (Phase 1: Superadmin-only DELETE + 409 while
  releases exist + `entity_files`/R2 cleanup). Re-verified live, not rebuilt.
- **`GET /artists`** gained `?search` (ILIKE), `?page/?limit` + unpaged `total`,
  and the derived **`has_recent_release`** — a release in the past 365 days OR
  any future date, one comparison covering both. That flag is the whole basis of
  the Active-only filter and the Active Roster stat; without it neither can
  exist (AR-5/9/16).
- **`GET /artists/export`** → ExcelJS XLSX. `?genres` (comma, case-insensitive)
  + `?since_days`. `last_release_date` is computed for EVERY row regardless of
  the window, so the reader can see WHY a row qualified. Declared **before**
  `/:id` or Express matches "export" as an id. Client: modal with a 3x2 window
  grid (All/1/3/6/12/24 mo), a genre checkbox list with live counts, and a
  summary-composing download button (AR-3).
- **`POST /artists/sync-images`** reuses the `POST /releases/sync-artwork`
  contract rather than inventing a third loop: `disabled:true` no-op when
  Spotify is off, a `'not_found'` sentinel so permanent misses are never retried
  forever, `remaining` so the client's batch loop terminates, 100ms pacing.
  Link-first — a stored `artists.spotify_url` resolves by ID (exact) via the new
  `spotify.artistById`, name search is only the fallback. Approver-gated: it
  writes every row on the roster (AR-4).
- **Client**: 4 stat cards · genre dropdown with embedded search + per-genre
  counts + check marks · All/Has/No-releases segment · Active-only toggle ·
  4-option sort · 300ms-debounced search with a **fetch-generation guard** and
  an inline spinner (the list stays on screen while refetching instead of
  flipping to "Loading…") · collapsible **Archived** section with optimistic
  archive/restore and exact rollback · genre colour chips (`GENRE_COLORS` +
  `genreTone()` with partial-match fallback) · 2-letter initials · ChevronRight ·
  hover lift · live filter-aware subtitle · skeleton + a real error state with
  Retry (AR-6/7/8/14/15/19/21).

### The rename cascade (AR-10 / AR-11) — one list, three call sites
`artists.name` is a foreign key in string form for four tables. Renaming the
roster row without rewriting them detaches the artist from their own money: the
spend query matches `LOWER(TRIM(artist))`, so fixing a typo used to zero the
Spends tab. New **`server/lib/artistCascade.js`** owns the list
(`expenses.artist`, `deals.artist_name`, `recording_budgets.artist`,
`influencer_campaigns.artist`) and is called by `PATCH /artists/:id`,
`flags.js rename-artist` AND `flags.js merge-artists`, so they cannot drift.
PATCH is now transactional and 409s on a collision ("merge them instead"),
checked **unconditionally** — the two spellings in a duplicate pair usually
differ only in case or whitespace, which the unique index folds, so a
"did the name change" gate skips exactly the case that then 500s.
Merge additionally **reassigns** source `entity_files` to the survivor instead
of deleting them (boom deleted; an orphaned row is an R2 object nothing will
ever clean up). Verified live: rename held 10 expenses / $3,306.67, and a merge
moved the attachment plus all four string references.
**Deliberately NOT cascaded**: `artist_budget_sections.artist_key` (that is the
canonical strip-all key under a UNIQUE constraint — a colliding rename needs
section-by-section merging, which belongs to the artist-budgets surface) and
`statement_artist_rules.artist` (rewriting a learned bank rule changes
reconciliation history). `artist_income` is id-keyed in cadence, so it needs
nothing.

### Archive gets its provenance back (AR-22 / AP-23)
New `artists.archived_at` + `archived_by`, written by a dedicated
**`PATCH /artists/:id/archive`** (boolean-validated, `logActivity`). `archived`
was REMOVED from the generic PATCH allow-list — routing it through the field
PATCH is exactly how the stamps went missing.

### Artist profile
- **AP-1 Spotify tab is live again.** New `GET /artists/:id/spotify` +
  `spotify.artistProfile()` (resolve by stored URL first, else name search;
  top-tracks and 3-page album pagination fanned out in parallel, each degrading
  to an empty list; duplicate editions folded by name). Renders a banded
  **PopularityRing**, followers / tracks-found / releases / monthly-listeners
  cards, genre chips, Open-on-Spotify, top tracks with per-track popularity bars
  and an 18-cover discography. Fetched **lazily on first tab open**, and the
  route returns a *typed renderable state* — `{disabled:true}` with no
  credentials, `{found:false}` with a reason — never a 500. Verified live with
  Spotify unconfigured: clean "isn't configured" card.
- **AP-3 Spends** is a real surface again: Total / Unpaid / Top-category strip,
  then the approved-expense table (Date · Payee · Song · Category · Amount ·
  Status) with Paid/Partial/Unpaid pills, RECOUP + COBRAND badges and a
  `canView('/ledger')`-gated `Ledger →` `?focus=` deep link.
- **AP-12 cross-currency fabrication removed.** The aggregate now groups spend
  by `(category, currency)` and the client renders one string per currency.
  Summing GBP into USD and printing a `$` invents a number nobody can reconcile.
- **AP-11 budget** prefers the artist-level **recording budget** (line items x
  (1 + contingency%), non-draft only) and falls back to `SUM(budget_cap)` —
  `budgetSource` is returned so the card can say which. Three bands, not two:
  >80% amber, >100% red. A bar that only turns red after the money is gone is a
  report, not a warning.
- **AP-13** upcoming is `daysUntilLocal(...) >= 0` — a release dropping today is
  upcoming, and the boundary no longer shifts a day west of UTC.
- Also: per-row release archive with optimistic toggle (AP-7); checklist
  completion bars, which needed the aggregate to select `r.*` instead of 6
  columns (AP-8); Deal History card (AP-9); contract `notes` + file chip +
  the amber "expiring within 60 days" third tone + `expiration_date ASC` order
  (AP-10); header link chips (AP-14); a real Documents panel with
  size · date · uploader, drag-active state, upload spinner, error banner and
  confirm-on-delete — the columns already existed, the route just never wrote
  `file_size`/`uploaded_by` (AP-15); skeleton (AP-16); Back-to-roster (AP-17);
  devlog date input + real `<form>` + server-side `entry_type` whitelist
  (AP-18); live tab counts (AP-19); `'not_found'` sentinel handled everywhere
  (AP-20); `formatDate` throughout (AP-21); `LOWER(TRIM(artist))` (AP-22);
  `ui/Modal` + `ui/ConfirmDialog` replacing the hand-rolled overlay and the
  bare `window.confirm`s, and the dead `PageHeader` import removed (AP-24).
- **AP-5 devlog delete is author-or-admin** at both layers (server 403s, client
  hides the trash). Being in the label is not authorization when every member is
  in the label. `POST /:id/log` now re-reads the row through the list query so
  the returned shape carries `author` and the client can prepend instead of
  refetching.
- **AP-6**: the delete button is now Superadmin-only client-side too, mirroring
  the server gate — a button that always 403s is worse than no button.
- File uploads: 10MB (was 25) + a MIME allow-list (was none) — AR-17.

### Calendar
- **C-7 `safeQuery`**: each of the six sources degrades to an empty bucket
  instead of 500-ing the whole month, and the response carries `degraded: []`
  so the page can say "some sources couldn't load" rather than quietly showing
  a thinner month.
- **C-4 tasks are OWN tasks again** (`t.user_id = $1`). A workspace-wide task
  feed turns every teammate's due dates into your calendar and exposes work
  assigned outside your department, which the task surface itself gates.
  Verified live: role=User sees 0 task events, the admin sees 1.
- **C-3 `dsp_submitted` is back** — `dsp_submissions.submitted_date` was stored
  and never fed, hiding half the distribution timeline. Now two kinds
  (`dsp_live` / `dsp_submitted`) from one query.
- **C-6 Approver** is inside the contract-date gate again: an approver signs off
  on the money those contracts govern and can't do it blind to renewal dates.
- **C-23** `calendar_events.event_type` restored (+ whitelist on POST/PATCH),
  surfaced as the event's subtitle and offered in the add form.
- **C-21** the feed carries `subtitle`/`meta` again (artist, "Assigned to X",
  release_type, priority, DSP status) and dates are normalised server-side from
  the pg Date's LOCAL parts — `toISOString()` shifts the day east of UTC.
- **Client**: sidebar is back (`xl:grid-cols-4`, grid spans 3) with a
  **selected-day panel** (day cells clickable, descriptions visible, explicit
  trash) OR the **Upcoming (14 days)** list with Today/Tomorrow/Nd badges and
  jump-to-day, plus a **Legend** card (C-1/2/14). Month nav moved back inside
  the grid card; **needed-weeks-only** geometry with inert pad cells, so an
  adjacent month's events can never masquerade as this month's (C-18/20).
  Per-type lucide icons (C-12), 5 grouped filter chips (C-13), 3-chip cap
  (C-16), past-day dimming (C-17), live "N events" count (C-15), a header
  **Add event** button with a real date picker (C-5), hotkeys **← → t n**
  (C-8), `Skeleton` + error state with Retry (C-10), `ui/Modal` +
  `ui/ConfirmDialog` (C-11).
- **C-9 fixed**: clicking a manual event chip no longer *deletes* it. Chip click
  navigates (or selects the day); deleting is an explicit trash in the day
  panel. View-click and destroy-click must never be the same gesture.

**Deliberately not done, with reasons:**
- **AR-12 / half of AP-2 — the `artist_links` table.** Cadence stores socials as
  fixed columns on `artists`; adding a parallel many-rows-per-platform table is
  architecture churn, and the one thing it uniquely bought boom (link-first
  Spotify ID lookup) is already served by `artists.spotify_url`. The other half
  of AP-2 WAS built: the Links tab now aggregates **release links** across
  `spotify_uri`/`apple_music_link`/`presave_link`/`presave_analytics`/`ugc_link`
  with a link back to each release — the URLs anyone actually wants.
- **AP-10's embedded per-contract `FilesPanel`** — contract documents live on
  the Contracts surface; the tab shows the filename as a chip that routes there
  rather than forking a second file UI onto the profile.
- **AP-18's 8-type devlog list** — cadence's 7-type set (`constants.js` +
  `lib/constants.js`) is now server-validated and shared; re-adding
  "Follow-up"/"Email" would orphan nothing but split the vocabulary for no gain.
- **C-22 (`releases.status != 'Archived'`, expiring contracts `status =
  'Active'`)** — kept. These are the improvements the audit called plausible;
  reverting them puts dead rows back on a planning surface.
- **C-24's `PATCH /api/calendar/:id`** — kept and now validated, but still has
  no client consumer. It is a legitimate API, not dead weight; an edit UI in
  the day panel is the obvious next step.
- **C-25 chip navigation** — kept (boom's chips were inert); with C-9 fixed the
  semantics are now consistent: chips navigate, trash deletes.

**Verification**: client build clean; `node --check` on every touched server
file; **finance fixtures 120/120**; all 25 new/changed tint classes confirmed
present in the emitted CSS (no `bg-elev/NN`, no `bg-page/NN`, no `/12`, no
`dark:`, no raw grays in the three pages); `no-undef`/`no-unused-vars` lint
clean on all three.

---

## Phase 6 — deals + bulk deals (2026-09-01)

Boom parity for `_audit/pages/deals.md` (20 rows) and the `missing--bulk-deals.md`
P1 port. **Zero new deps.**

### The type collision, resolved by NOT resolving it
`expenses.bulk_deal_completed` is an **INT delivered-COUNT** in cadence (written
by `artist-campaigns.js`, rendered as `n/quantity` in `ArtistCampaignDetail`).
Boom used a same-named **BOOLEAN** as its "move to the Completed archive" flag.
Coercing one into the other reads a delivered-count of 3 as `true` and archives
every partially-delivered deal, so **archiving got its own column:
`bulk_deal_archived BOOLEAN DEFAULT FALSE`**. Nothing in the new code writes
`bulk_deal_completed` — it stays the campaigns' count, and `lib/bulkDeals.js`
reads it only as the *fallback* delivered figure for deals with no checklist
(items win when any exist, which is the precedence ArtistCampaignDetail already
rendered). Proven live: setting the count to 3 leaves `archived=false` and shows
3/5 delivered; archiving and restoring leaves the count at 3 untouched. Two
fixtures pin it.

### `server/lib/bulkDeals.js` (new) — one rule, two readers
The rollup SQL and every derivation live together because the **tracker page**
and the **notification bell** both read them; boom duplicated the JS rule in two
files and they drifted. Money rules, all fixture-held:
**CONTRACTED beats LOGGED** (`bulk_deal_quantity` vs checklist length — the
larger wins, so an unlogged deliverable still counts against the vendor);
**ITEMS beat the MANUAL COUNT**; **INSTALLMENTS beat STATUS** (never summed —
an installment plan on a Paid row would double-count the deal);
**paid is CLAMPED to the family total**. Amounts are **never cross-currency
summed** — the page rolls up per currency. Every derived figure (contracted /
delivered / paid / stalled / paid-ahead / unit_cost / effective_unit_cost) is
computed SERVER-side and shipped down; `BulkDeals.jsx` formats, it does not decide.

### Bulk Deals — the surface
`GET /api/ledger/bulk-deals` (label-scoped in all four scans, incl. the
sub-aggregates) + `/bulk-deals` page (Approver+, nav under Bookkeeping).
Split children come back **attached to their parent** (`splits`,
`family_artists`) rather than as a second round trip — the parent holds the
first slice, so rendering only the children would drop a real artist and a real
slice of the money. Card: payee/artist/N-artists/category/socials chips,
**Stalled Nd** (danger) and **Paid ahead** (warning, suppressed when Stalled
already says it louder), two progress bars (delivered + paid — *the gap between
them IS the exposure*), per-unit cost, Complete at 100%. Expanded: blur-saved
quantity/unit, socials editor (`ui/Modal` + the existing `SocialHandlesEditor`,
saving JSONB `social_handles` through the normal ledger PATCH), read-only split
view, deliverables checklist with platform + link, and **ghost slots** —
contracted-but-unlogged rows as dashed placeholders with a "Log" button, capped
at 25, writing no DB rows until clicked. Completed section with **effective
rate** (total ÷ what actually arrived — the only honest per-unit number on a
deal closed under-delivered) and Restore.

- **Split editing was deliberately NOT rebuilt here.** Splitting rewrites the
  parent's amount and creates child expense rows; a third surface that can
  rewrite a family is a third place for it to go wrong. The section shows the
  family and links to the ledger entry, which owns the endpoints.
- **Schema**: `expenses.bulk_deal_archived`, `bulk_deal_items.platform`,
  `deals.added_date`. No new tables — `bulk_deal_items`/`deals`/`entity_files`
  were already in `db.js` TENANT_TABLES. full-export gained
  `bulk_deal_items.csv` and six more `deals.csv` columns.
- **`bulk_deal_stalled` notification replaced the old rule.** It used to be
  "approved and still unpaid after 21 days" — an accounts-payable nag that fired
  on deals with *no* exposure and stayed silent on the case that costs money
  (paid in full, nothing delivered). Now it runs `deriveDeal` over the same
  rollup, links to `/bulk-deals`, and is `severity: danger`.
- **Bugs found on the way**: `PATCH /ledger/bulk-items/:id` numbered its
  placeholders off `fields.length`, but the `completed` branch pushes a literal
  `completed_at = NOW()` clause with no parameter behind it — so any PATCH
  sending `completed` **alongside a second field** died on a missing `$n`. Now
  numbered off `values.length`. And `POST` auto-position via
  `COALESCE($n,$m)` 42804s (both placeholders untyped); resolved in JS instead.

### Deals pipeline — 18 of 20 rows
**Already closed before this pass**: nothing in the register — the drag-drop,
drawer, `n` hotkey, `contact`/`links` and ObjectDiscussion noted in CLAUDE.md are
the INT-1…INT-8 *additive* divergences, not defects.

- **DEAL_TYPES was the release vocabulary** (`Single/EP/Album/…`) on a page about
  *agreements*. Now boom's six contract shapes (`360 Deal / Master License /
  Single License / Distribution / Publishing / Other`), mirrored in
  `server/lib/constants.js` and **enforced server-side** — a dropdown is a
  convenience, the column is the contract. `withLegacy()` appends a stored
  out-of-list value as an extra `<option>` so an old row renders instead of
  showing blank and being deleted by the next save.
- **Server validation is back** on `stage` / `priority` / `deal_type` for POST
  *and* PATCH, with `undefined` = untouched and `null`/`''` = an intentional
  clear. Without it an API client (or a stale bundle) writes a stage no column
  renders and the card vanishes.
- **Deal documents, end to end** — `entity_files`-backed `POST/GET/DELETE
  /deals/:id/files` + signed-URL GET, a Documents panel in the drawer with
  drag-drop, and the paperclip+count back on the card. DELETE of a deal now
  sweeps its `entity_files` rows **and** the R2 objects (otherwise the objects
  outlive every row that knows their keys). multer rejects are converted to a
  JSON 400 — they were reaching Express's default handler as a 500 HTML page, so
  the client could only say "Upload failed" with no reason.
- **Six columns** (`grid-cols-2 md:3 lg:6`) — a funnel capped at three is two
  half-funnels stacked. Skeleton now matches at `cols={6}`.
- **Stage colour system** (dot + tinted header + count chip hidden at 0) built
  from the semantic palette, not raw hex: Scouting/Passed neutral, Meeting info,
  Offer warning, Negotiation brand, Signed success.
- **Priority is a WORD again**, not an unlabelled 6px dot; **follow-up is amber
  ONLY when overdue** (`isPastLocal`) in short "Follow up: Jun 12" form —
  colouring every follow-up amber makes "overdue" mean nothing.
- **Drag plumbing**: `dragCounters` ref (dragenter/leave fire per child element,
  so a bare leave→clear flickers), `effectAllowed`/`dropEffect`, and
  **`isDifferentStage` gating** so the card's own column is not a drop target and
  the dashed "Drop here" only appears during a real drag (it used to be a
  permanent label on every empty column).
- **Failed save keeps the drawer OPEN** with an inline "Save failed — your edits
  are still here"; it used to `.then(onClose)` through a resolved-false and throw
  the edits away. Inline `Saved ✓` restored.
- **Drawer regained**: Last Contact (the payload always sent it, no input ever
  set it), Spotify Monthly Listeners (column + allow-list existed, no field),
  `$`-prefixed offer, tinted priority select, the **Move Stage pill row**, and
  "Added <date>".
- **Per-card "Next ›"** one-click advance (hidden on Passed) — drag is the
  expressive move, this is the one people make 90% of the time and the only one
  that works on touch.
- **`deals.added_date`** is back and **orders the board**; `updated_at DESC`
  reshuffled every card the moment anyone edited one. `?stage=` filter and
  `DELETE → data.id` restored. A **0 offer survives** save (`x || null` collapsed
  "cleared" and "zero"). Add form regained Cancel/✕, `required`, the
  `Priority: X` labels and "(optional)" on deal type. `window.confirm` →
  `ui/ConfirmDialog`; error state with Retry.

**Deliberately not done**: DEF-DEALS-20 (drawer shell cosmetics) — cadence's
dimmed `bg-overlay` / `max-w-md` / `z-[60]` is the app-wide drawer convention;
reverting one drawer to a transparent `max-w-sm` backdrop is drift, not parity.
DEF-DEALS-18's `border-gray-150` hover tones — that palette does not exist here
and the token equivalents are already applied.

**Verification**: client build clean; `node --check` on all 8 touched server
files; **finance fixtures 140/140** (the prior 120 unchanged + 20 new bulk-deal
money assertions); no `bg-elev/NN`, `bg-page/NN`, `/12`, `dark:` or raw grays in
either page, and every new tint confirmed present in the emitted CSS. Exercised
live on :3001 — vocabulary 400s, stage moves, `?stage=`, 0-offer round trip,
deal-file MIME 400, the bulk-deals rollup, combined bulk-item PATCH, ghost-slot
titles, a split/unsplit family round trip (combined 1200 = parent 700 + child
500), stalled at 60 days with the bell reporting the identical sentence, and
archive silencing it.

---

## Phase 7 — legal documents (2026-09-01)

Parity pass over the three document-generation pages: **Create NDA**, **Label
Waiver**, **Artist Clearance**. Specs: `_audit/pages/create-nda.md` §7,
`label-waiver.md` §7, `artist-clearance.md` §7. No new deps.

**The NDA template registry is now the legal text, not a stand-in.**
`constants/ndaTemplates.js` was rewritten from a 3-template file of ~6-clause
boilerplate into a registry of **five** templates. Two are the real agreements
ported verbatim from the reference app — `full` (15 sections: Confidential
Information + A-exclusions bullet list, Protection A–D, Injunction,
Non-Circumvention 1yr, Non-Solicitation 2yr A–D, Return + 5-day certification,
Relationship, No Warranty, Limited License, Indemnity, Attorney's Fees, Term
2y + 2y survival, General Provisions/CA law, DTSA Whistleblower, Signatories)
and `investment` (corporate counterparty: Purpose preamble, Personnel
definition, §II(E) government-disclosure carve-out, 10-business-day retention,
Other Businesses, 1-year term with the IV/V/VII–XI survival list). The clause
wording is copied character-for-character; only party names, addresses, the
effective date and the signatory line are substituted. **The three original
short templates (`standard`/`mutual`/`corporate`) are kept under their existing
keys** — documents have been generated from them and their clause keys are part
of the stored `data.enabled` payload.

Mechanics restored alongside the text: **gap-free Roman renumbering** (`full`
drops an optional section without leaving a hole) vs **explicit Romans with two
`[intentionally omitted.]` placeholders** (`investment`, whose Term clause
cross-references the numbering); the **3-level `getHeadingLevel` heuristic**
(h1 all-caps title / h2 Roman-or-letter-or-Arabic subsection / body,
false-negative biased) shared by preview + PDF + docx — extended with an Arabic
branch so the short templates' `1. HEADING` lines stay bold; **structured
OWNER/RECIPIENT signature blocks** (`By:/Name:/Title:/Date:`, recipient-signatory
fallback, blank-Title omission, a 240pt same-page guard in the PDF) rendered by
all three renderers instead of an inline body paragraph. The short templates
therefore stopped emitting their inline "IN WITNESS WHEREOF" closing;
`stripLegacyClosing()` drops it **at render time only** from bodies saved
before this change, so nothing is rewritten and nothing double-renders.

- **Dirty-body auto-sync** (the second P1): editing the body no longer freezes
  it. Watched fields diff-substitute into the hand-edited text — word-boundary
  regex (a raw replace turns every "T" into "Tyler Henry" when the user pauses
  mid-name), 400 ms debounce, `prevFormRef` snapshot, flush before save. The
  debounced timer reads the body from a **ref, not the state closure or a
  setState updater** — the closure goes stale between arming and firing, and
  React can invoke an updater twice, which would discard the substitution.
- Clause toggles are re-derived from the SAVED BODY via per-clause `marker`
  regexes, so a clause deleted by hand shows as unchecked; toggling against a
  dirty body confirms and rebuilds in one step instead of refusing.
- Mandatory-section checking inverted back to **non-blocking**: a per-template
  regex list drives an amber warning with an inline Reset, and save proceeds —
  hard-blocking stranded the document.
- Saved rows regained **Preview / PDF / Word** (each rebuilt from that row's own
  template, never the one on screen) + Effective/Owner/Recipient/Created·by
  columns; PDF/docx fidelity restored (helvetica, centered 16pt title, 11pt,
  1in/1440 margins, bullet newlines preserved) with the filename
  `{Workspace}-NDA-{Recipient}-{date}`.
- Required fields enforced in three places (`required` attr, save-time check,
  server 400 via `REQUIRED_BY_TEMPLATE`); PUT can no longer null `custom_body`
  through the generic `'' → null` coercion. Owner/recipient **addresses** and a
  `disclosed_to` field exist again. Dates forced to `en-US` — a browser-locale
  format made the legal text machine-dependent. Unknown `:template` redirects to
  the first template instead of dead-ending on the picker; leaving with unsaved
  edits confirms.

**Label Waiver** — the issued document was granting fewer rights than it should:
the **digital-exploitation (ringtone & mastertones)** and **remixes** bullets are
back (8 → 10), along with "detailed statements **and calculations**", the audit
clause's "books and records **of account** and to copy relevant extracts", and
"via LOD". The **print-popup is gone**: `buildWaiverPDF` is real jsPDF (helvetica,
1in margins, grey header date, heading-aware bold), and its bytes are POSTed
multipart alongside the form so the server files the PDF on the artist's
**Documents tab** — `label_waivers` gained `artist_id` + `file_id`
(FK → `entity_files`, both `ON DELETE SET NULL`), resolved by exact
case-insensitive roster match, replaced in place on update, migrated/dropped when
the artist changes, cleaned up on delete. **R2 unconfigured is a no-op, not a
500** (`isConfigured()` guard) — the waiver still saves. Also: roster `<datalist>`
+ attach hint, `mixtape` format, `effective_date` required both layers,
`royalty_percent` back to free text with the "X%" placeholder (`||` not `??`) and
a server-side numeric `coerce()` since the column is NUMERIC, Created·by column,
"· customized" badge + helper copy, Skeleton, inline error banner, and a
**confirm before the backdrop click discards an in-progress waiver**.

**Artist Clearance** — the chart was missing more than half its fields. Restored
all **9 dropped per-track primary fields** (role, docs_needed, sample_review,
release_date, royalty_comments, royalty_account, advance, recoupable_portion,
agreement_on_file) + `release_id`, and all **6 dropped detail rows** (Musician
Credits, Recorded by, Lyrics, Stems/Masters, Artwork, Credits Approved) with
their original labels — 28 fields per track, not 13. `lib/clearanceXlsx.js` now
emits the **canonical chart layout** rather than an ad-hoc sheet: prefixed header
strings in rows 1-12 column A (including the long-standing "Product Committment"
spelling), the effective date as a **real Date cell**, a primary-column header
row, then one **17-row block per track** — primary row across columns
1,2,3,4,5,6,7,9,11,13,15,17,19 and 16 detail rows with the label in **column C**
and the value in **column D**, blank → `TBD`. Built in code, not cloned from a
bundled `.xlsx`: no binary asset to keep in sync, and the styling is neutral grey
rather than the hardcoded indigo it replaced. Zero tracks emit the scaffold.
Saving generates the chart and files it on the artist's Documents tab
(`clearances.file_id`, same replace/migrate/cleanup rules as the waiver, same R2
degradation). Catalog linking is back: type-to-search `TrackTitleInput` with
EXACT MATCH chip and outside-click close, `release_id` binding + Linked
badge/unlink/auto-unlink-on-edit, manual-value-preserving `applyReleaseToTrack`,
sibling-release exclusion, and the **multi-select bulk picker** (search,
already-added disabled, replace-the-default-blank logic). Sticky Chart-preview
panel restored; track expansion back to a multi-open `Set` with the first open
and a **minimum of one track**. Server: `/catalog` **400s** without `artist_id`
(a silent `[]` reads as "no catalog"), excludes archived releases, restores the
`project_name ASC` tiebreak and `release_type`/`genre`; the list is ordered by
**`created_at DESC, id DESC`** again so rows stop jumping on save; downloads use
the server's `Content-Disposition` name (every export used to save as literal
`clearance.xlsx`).

**Already closed before this pass** (verified, no change): NDA `?token=`-style
tenancy/gating, LW `bodyDirty` model, AC partial-PUT semantics, and
AC-13's `?limit=500` — cadence's `/artists` already defaults to a 1000-row page,
so adding the param would have *lowered* it.

**Partially closed, deliberately**: LW-5 keeps the modal editor (the app-wide
convention) but fixes its real defects — Skeleton loading and no silent discard.
AC-12 restores the "Main artist" qualifier in the form label and the XLSX row but
leaves the column named `royalty_account`; renaming a live column for a label
change is not worth the migration.

**Schema**: `label_waivers.artist_id` / `.file_id`, `clearances.file_id` (all
`ADD COLUMN IF NOT EXISTS`, placed after the `artists` + `entity_files` CREATEs).
`nda_documents` added to `db.js` TENANT_TABLES (it was missing); `nda_documents`,
`label_waivers` and `clearances` added to `full-export`.

**Files touched**: `client/src/constants/ndaTemplates.js` (rewritten),
`client/src/pages/CreateNda.jsx`, `CreateLabelWaiver.jsx`, `ArtistClearance.jsx`,
`server/routes/nda-documents.js`, `label-waivers.js`, `clearances.js`,
`server/lib/clearanceXlsx.js`, `server/routes/full-export.js`, `server/db.js`,
`server/index.js`.

**Verification**: client build clean; `node --check` on all 7 touched server
files; **finance fixtures 140/140**. Every template rendered to PDF + DOCX and
the text extracted back out of the files — `full` = 15/15 sections, 5 pages, all
substitutions present, gap-free Romans with both optional clauses off and
correct toggle re-derivation from the resulting body; `investment` = both
`[intentionally omitted.]` placeholders in position, §II(E), Other Businesses,
the 10-business-day clause and the survival list, plus the recipient-signatory
Name/Title lines. Waiver body verified at 10 bullets with every restored phrase,
and its PDF re-extracted. XLSX round-tripped and every cell dumped to confirm the
row/column map and the Date cell. Exercised live on :3001: required-field 400s on
both layers, blank-body PUT rejected, waiver multipart create with artist
resolution, non-PDF upload rejected, artist migration on/off the roster in both
directions, catalog 400, clearance partial-PATCH keeping tracks, cross-workspace
artist rejected, ordering, 404s, deletes, and a full-export containing the three
new CSVs. R2 and AI unconfigured throughout — no 500s, attachments cleanly
skipped.

## Phase 7 — renewals + admin docs + contract generation (2026-09-01)

Parity closer over `Renewals`, `AdminDocs`, and the one page cadence never had:
boom's **Create Contract** generator. Specs: `_audit/pages/renewals.md` §7,
`admin-docs.md` §7, `missing--contracts-create.md`. No new deps.

**Renewals — the page changed species back.** It was a lookahead list of Active
contracts inside a 30/60/90/180-day window; it is a **portfolio tracker** again.
`GET /contracts/renewals` dropped `status = 'Active'` and the mandatory
`CURRENT_DATE + N days` ceiling — an Expired contract and an Active one two years
out were unreachable from every UI state. `?days=` survives as an *optional*
narrowing for API callers; the page sends none. **`/contracts/expiring` is
untouched** — that is the deliberately narrow 90-day Active feed the dashboard
alerts read, and it keeps its own semantics.

The headline defect was RN-1, the exact regression `utils/dates.js` exists to
prevent: `Math.ceil((new Date(date) - new Date()) / 86400000)` parses the DB date
as **UTC midnight** and diffs it against **wall-clock time**. Now
`daysUntilLocal`, with `formatDate` for the Expires cell. Proven, not asserted —
a harness ran the old and new math side by side across five zones on real
boundary rows (a contract dated today, one dated yesterday). East of UTC the old
math read a contract that expired **yesterday** as `0d` and banded it *Expiring
Soon* instead of **Expired**, and moved the 90-day boundary a day (`+89d` →
`active`); west of UTC `toLocaleDateString` rendered every date **one day early**.
The new math is identical in all five zones. Restored with it: 4 stat cards, the
4 count-bearing filter pills, all 8 columns (Territory / Royalty / Advance and a
Status badge **separate** from the colour-coded days number), the four original
bands — grey `<0` · red `<30` · amber `<90` · **green `>=90`**, the positive state
that had no equivalent — Skeleton loading, an error strip with Retry (a failed
load used to be indistinguishable from "nothing expiring"), and the plain
`No renewals found` empty row. The per-row AlertTriangle is gone; alarm
iconography sits on the stat card only.

**Admin Docs — from a flat card grid back to a document-management surface.**
The router left `lib/fileResource` (still used by `/ndas`): it outgrew the factory
the moment it needed a confidentiality tier and file history.

- **Restricted is a real tier again, not a stored word.** `restrictedClause()`
  hides those rows from non-Superadmins on list/get/expiring/files, and
  `restrictedBlock()` refuses create, edit, delete, and *marking* a document
  Restricted. The form only offers "Restricted" to a Superadmin. Verified live
  from a genuine second Admin account: list hides it, GET 404s, PATCH/DELETE 403,
  and that same Admin can still edit an Internal document.
- **Multi-file attachments** on `entity_files` (`entity_type='admin_doc'`),
  newest-first with uploader / date / size and per-file delete. Upload **ADDS a
  revision** — the single-slot model deleted the prior R2 object, so filing an
  amendment destroyed the original. A boot backfill mirrors legacy
  `admin_docs.file_name/r2_key` rows into `entity_files` (same idempotent
  `filename`-UNIQUE pattern as the contracts backfill). Uploads bump the parent's
  `updated_at`, and the list is ordered by it again, so a touched document floats.
- **Detail view + full metadata editing** — everything but `status` was
  write-once, and `notes` was literally unreachable (in the blank state, no input,
  no edit view). Restored with the tag-chip editor, the notes textarea, Created By,
  the `is_template` flag + Templates tab + badge, search over title/counterparty/
  **tag**, status + confidentiality filters, category tabs with counts, the
  8-column table, and quick-upload (toolbar button + page-wide drag-drop overlay,
  one document per file titled from the filename, `n/m` progress).
- **Expiring is server-computed again**: 60-day window, `days_left` in SQL,
  Archived/status-Expired excluded, top-5 click-through, `+n more`, dismiss,
  red under 14 days. The client version counted Archived docs and was a bare
  number.
- `tags` **TEXT → JSONB**, converted in place and guarded on `data_type` so a
  re-run is a no-op. Landmine worth remembering: an `ALTER … TYPE … USING`
  expression **may not contain a subquery** (`cannot use subquery in transform
  expression`) — the obvious `ARRAY(SELECT btrim(t) FROM unnest(...))` throws, and
  because it throws it **aborts every migration after it**. It is
  `regexp_replace` + `string_to_array` + `array_remove` instead.
  `'msa, vendor ,  , legal'` → `["msa","vendor","legal"]`, `''` → `[]`.
- **Guard mismatch closed**: `AdminRoute` admits Approvers and `/admin-docs` was
  grantable to Users via the Legal preset, while the server is `requireAdmin` —
  those users got a permanently empty vault. New **`StrictAdminRoute`**
  (Admin/Superadmin) on the route, and the path is out of `constants/pages.js`
  and the preset entirely.
- **`lib/blockedExtensions.js`** (new, reusable) restores the dangerous-extension
  blocklist the factory dropped, trailing-dot bypass included — `payload.html`
  and `payload.html.` both rejected. R2 unconfigured now answers **503 with a
  plain message** on upload and on the signed-URL fetch instead of a generic
  500 from the S3 client.
- Dates via `formatDate` throughout, and the badge palette un-inverted: **Draft
  amber, Expired red** (they were swapped — an expired legal document looked
  calmer than an unfinished one). The cadence-only inline status quick-change
  survives, in the table row, now optimistic with exact rollback.

**Create Contract — ported, not reinvented.** `/contracts/create` (AdminRoute),
reached from the nav and a "Draft with AI" action on Contracts. What the port
*needed* was the generation flow itself: the terms form (artist `<datalist>`,
type, royalty, advance, territory, duration, releases, notes), the financial-
obligations repeater, `POST /api/contracts/generate`, and `claude.js`
`generateContract`. What it **reused**: `cleanTerms` (already the contracts
campaign's `financial_terms` sanitiser), `CONTRACT_TYPES`, `useUnsavedWarning`,
the `.card`/`.input` kit, and — instead of boom's `.txt`-only blob — the NDA
builder's document renderers, so the draft exports as **PDF and Word** as well as
text, classified by the same `getHeadingLevel`/`bodyParagraphs` pass. Nothing was
persisted then and nothing is now.

Two tenancy corrections over the original: the reference pull is **label-scoped**
(5 recent Active contracts of the same type, falling back to any 5 Active — both
`WHERE c.label_id = $1`, INNER→LEFT artist join so an unassigned contract still
teaches style), and boom's hardcoded **"Boom Records LLC" is replaced by the
workspace's own `labels.name`**. Verified: the prompt carries the tenant name and
no trace of the reference app's; a label with no contracts falls through both
queries cleanly; label 1 sees none of label 2's rows.

**Schema**: `admin_docs.is_template` (`ADD COLUMN IF NOT EXISTS`), `admin_docs.tags`
TEXT→JSONB (guarded), legacy single-file → `entity_files` backfill. `admin_docs`
was already in `db.js` TENANT_TABLES; it was **not** in full-export and now is.

**Files touched**: `client/src/pages/Renewals.jsx` (rewritten),
`AdminDocs.jsx` (rewritten), `CreateContract.jsx` (new), `Contracts.jsx`,
`App.jsx`, `components/Layout.jsx`, `constants.js`, `constants/pages.js`;
`server/routes/admin-docs.js` (rewritten), `contracts.js`, `full-export.js`,
`server/lib/claude.js`, `lib/blockedExtensions.js` (new), `server/index.js`.

**Verification**: client build clean; `node --check` on all six touched server
files; **finance fixtures 140/140**. Live on :3001 with R2 and AI unconfigured —
renewals returns the full portfolio (Expired + Pending + a 2027 Active row) while
`/expiring` still returns exactly its three; `?days=30` still narrows; the
Restricted matrix exercised from a real second Admin; expiring drops a doc when
it is Archived and returns when it isn't; blank-title 400s on create and patch;
blocked extensions rejected both ways; two file revisions listed, one deleted,
`file_count` tracking; cross-document file ids 404; deleting a document takes its
files; `generate` 400s without artist+type, 503s with AI off, and — run once
against a deliberately bogus key — proves the reference pull, label lookup and
prompt build all execute before a clean 502. A sample draft was rendered through
both export paths and the text extracted back out of the files (7/7 probes in the
PDF, 5/5 plus bold runs in the DOCX). `jspdf` imported by NAMED export
(`default` is the namespace, not the class — confirmed again at runtime).
Full-export ships `admin_docs.csv`.

---

## Phase 8 — team + my work + salary (2026-09-01)

Parity pass over the **people surfaces**: `/team`, a new `/team/:id`, My Work, and
`/salary`. Specs: `_audit/pages/{team,missing--team-member,my-work,salary}.md`.
Zero new deps. One new table (`salary_payment_history`).

### The bug that mattered most (pre-existing, found live)
**Every status change on a task 500'd.** `PATCH /tasks/:id` and `PATCH /tasks/bulk`
both reused the `status` placeholder inside the `completed_at` CASE, so Postgres had
to deduce ONE type for it from `status = $n` (character varying, from the column)
and `$n = 'Done'` (text, from the literal). It refuses: **42P08 "inconsistent types
deduced for parameter"**. Marking a task Done from the drawer, a board drag into
Done, and the whole bulk bar were all dead. Casting the parameter does NOT fix it
(it constrains the deduction the other way) — the value is now **bound a second
time** so the placeholder facing the literal has one unambiguous type.
Sourcemaps can't see this class of bug and neither can a build; only running it does.

### Team (`routes/team.js`, `pages/Team.jsx`)
- **P1 escalation guards** — `POST /team` and `PATCH /:id` were plain `requireAdmin`,
  so an Admin could invite a Superadmin, promote anyone, edit a Superadmin, or demote
  the last one. `checkEscalation()` now enforces the three rules DELETE has had since
  M1 (`lib/userDelete.js`): only a Superadmin grants an admin-tier role, only a
  Superadmin edits an admin-tier member, the last Superadmin can't be demoted. PATCH
  also **excludes platform operators** — nothing linked to them, but the endpoint
  could reach one, which is the lockout the operator hardening exists to prevent.
- **P1 velocity** — `GET /team/velocity` (admin): per-member totals/shipped/upcoming,
  30- and 90-day counts, avg checklist, on-time rate (`null` ≠ 0% — "nothing shipped"
  is not "worst on the team"), 12 month buckets keyed `YYYY-MM` (string compare, so a
  release can't TZ-shift across a month edge). `components/TeamVelocity.jsx` renders 4
  stat cards, a 9-col table with CSS sparklines, and recently-shipped cards.
- **P1 rep-visibility editor** — `GET/PUT /settings/visible-reps/:userId` had shipped
  and the ledger enforced it, but **zero client callers**: restricting someone needed
  a DB write. `components/VisibleRepsManager.jsx` (Settings → Team, under RepsManager).
  Load-bearing: **empty set = SEE EVERY REP**, so a full selection is stored as `[]`
  and the unrestricted state is stated on screen — an admin who ticks nothing has
  granted everything, not revoked it.
- **P2 team visibility** — `/team` left `AdminRoute`. It is the workspace's only
  people directory and gating it meant a plain User could not look a colleague up.
  Read is open (server GET was always auth-only); every mutation stays admin-tier and
  the page hides controls it knows will 403. Nav item ungated (still `canView`-filtered).
- **P2 hierarchy_level** — was orphaned: nothing displayed or set it, everyone landed
  at 99, roster ordering was frozen flat. Now a Seniority select on the invite form and
  inline on each row, with the **EXEC** badge back at `<= 2`.
- **P3 roster rollup** — `GET /team` gains per-member `open/overdue/in_progress/done/
  total_tasks` computed in SQL (only the server can see tasks the caller isn't scoped
  to). Drives a done-% bar + count pills per row, the "N members · M active tasks"
  subtitle, and department tabs. Additive columns — existing `/team` consumers unaffected.
- **P3 identity styling** — avatars (red-tinted when the person has overdue work),
  YOU/EXEC badges, Superadmin back to violet.
- **Skipped**: request-vs-assign `task_type` (P2) — superseded by the documented
  role/department model; reintroducing upward "requests" would fight `canAssignTo`.
  The `@`-mention composer + task hotkeys on /team (P3) relocated to /team-work with
  the rest of the task surface.

### Team member detail (`GET /team/:id` + `pages/TeamMember.jsx`) — the P1 port
`(\d+)`-constrained and declared last, after `/velocity` and `/workload`. Returns the
member, assigned unarchived releases with SQL-computed checklist completion, their
tasks, and 30 activity rows. **[INT] reconciled** as the spec asked: boom's rule was
admin-or-self → everything, everyone else → delegated only. Here `department` is a
permission boundary, so a **lead of that person's department** is added as a third
full-visibility case — the same widening `canMutateTask` already makes, and without it
a lead could edit a teammate's task on Team Work but not see it on their profile. A
lead still never looks at an Admin/Superadmin's tasks. Everyone else keeps boom's
privacy floor (`assigned_by IS NOT NULL AND assigned_by <> user_id`), and the response
carries `tasks_filtered` so the page **says the list is partial** rather than implying
three tasks where there are thirty. Page: profile header, 4 stat tiles, 14-day risk
banner, Releases/Tasks/Activity tabs.

### My Work — judged against "deliberately beyond boom"
Built: **'Urgent' priority** as its own `TASK_PRIORITIES` vocabulary (NOT added to
`PRIORITIES` — releases and deals validate against that list server-side and would
have inherited an option their routes 400); priority colours un-shift with it
(Urgent red / High amber / Medium blue / Low gray — while the scale topped out at
High, an ordinary task read one level louder than it was). **One-click done toggle**
on every card plus hover **Start** and a **one-day snooze** (relative to today, not to
the old due date — snoozing a task 5 days late must not mean "make it 4 days late").
**Waiting-on-you rail** ungated and given content: it showed nothing at all to a plain
User, though overdue counts, unread @mentions and due reminders are nobody's privilege;
now mentions list with actor + snippet + mark-read, reminders tile, and a
**"Reschedule all → today"** rollover through one bulk PATCH. **My Releases** rail +
14-day risk banner (`GET /releases?assigned_to=me|<id>`, new filter; `in_catalog=any`
opts out of the pipeline default). **Greeting + status pills** (pills live in
TaskSurface, not the page, so they read the same array and the same `dueBucketOf` as
the groups below them). **Assignment email preview** — `notify:'preview'` makes the
server PREPARE the `task_assigned` payload instead of sending it, and `EmailPreviewModal`
raises; default stays fire-and-forget so non-UI callers are unchanged. **Release select**
in the drawer (PATCH always accepted `release_id`; no UI could set it). **Notes autosave**
debounced 600ms with the id captured at schedule time. **Manual-sort fallback** now
orders never-dragged rows by due date, matching the server's `sort_order NULLS LAST,
due_date`. **Category tints** hashed from the name (free text, so a fixed map can't
work). **`?new=task`** consumed by TaskSurface; the FAB's "New task" was a plain
navigation that created nothing. **Refetch on acting-user change** (impersonation swaps
the user without unmounting the route).

**Quick-add shorthand** — `!high` / `#A&R` anywhere, dates only in the **trailing run**
of tokens. That scope is the whole safety of the feature: date words are ordinary
English, and a parser that grabbed them anywhere turns "ship the Monday newsletter"
into a task called "ship the newsletter" due next Monday. Verified: that exact string
parses untouched while "call the distributor friday" resolves. What it parsed is echoed
live under the input and the mirrored fields lock — a feature that REWRITES what
somebody typed must never do it invisibly.

**Skipped as superseded**: **pins** (deliberate — they'd fight `sort_order`);
**instant-create** (form-first is the documented quick-add); **@-mention hand-over in
the title** (the spec itself calls it partially superseded — assignment is lead-only
and select-driven now); the **To Do Today tab** as a tab (its live parts — Start,
snooze, rollover, the cross-app strip — were rebuilt where they work in ALL five views
instead of one, which the preset Today/Overdue views already slice).

### Salary
Server: **`salary_payment_history`** (both `marked_paid` and `marked_unpaid`) — history
was derived from `salary_payments`, whose upsert nulls `paid_at`, so **unmarking erased
the record it was meant to prove** and an unmark could never be shown at all; history is
now month-scoped; `amount = EXCLUDED.amount` on re-mark (a raise left the stored paid
figure stale); **`DELETE /employees/:id` soft-deletes** (`salary_payments` and the new
history table both cascade off the row — a hard delete would erase January's payment
because somebody left in March); PATCH/POST field validation (blank name, negative
amount, unknown currency); roster sorts department → amount DESC → name.
Client: stat cards, **department-grouped cards with per-group subtotals**, inline edit,
remove with ConfirmDialog, "This month" reset, paid-date on the row, per-row in-flight
disable (a double-click fired two PUTs), Skeletons, and history rows with **opposite-
coloured action badges** — Paid and Unpaid are opposite facts and one neutral row for
both is worse than none. **Per-currency totals**: employees carry their own currency, so
one summed "$12,400" was a lie the moment two currencies existed; totals are computed
and rendered per currency and `Intl` formats them (EUR/GBP/JPY place and shape their
symbol differently; JPY has no minor unit). Department became a **datalist, not a
select** — payroll employees are not app users, so `DEPARTMENTS` is a suggestion here,
not the permission boundary it is on /team.
Skipped: payment `notes` (no column, no consumer in either app).

### Also
`RELEASE_CHECKLIST_COLUMNS` moved into `lib/constants.js` and `releases.js` now imports
it, so completion has one denominator. `GET /team/workload` (releases-by-assignee with
completion) feeds the Workload bars a second dimension the task payload cannot contain
— someone carrying four releases and two tasks read "available" next to someone with
nine trivial tasks; load = open tasks + releases × 2, boom's own weight.
`db.js` TENANT_TABLES and full-export both gained `salary_payment_history`.

**Verification**: client build clean; `node --check` on every touched server file;
**finance fixtures 140/140**. Live on :3001 against real second/third/fourth users —
an Admin (Alice/Operations), two Approvers in DIFFERENT departments (Mara/Marketing,
Fiona/Finance), two Users, and a Superadmin owner in a separate workspace. Proven, not
reasoned about: the escalation hole existed before the fix (an Admin really did promote
a User to Superadmin and invite a second one) and 403s after; only-Superadmin-edits-
admin-tier; last-Superadmin demote 400s in a workspace with one, succeeds once there
are two; `teamFilter` gives the Marketing lead 3 tasks, the Finance lead 0 and a plain
User a 403; `canMutateTask` lets the Marketing lead edit Milo's task and refuses the
Finance lead; `canAssignTo` refuses cross-department; unassign is admin-only; bulk
reports 0 of 3 for out-of-scope ids. **Member-detail visibility exercised from all five
roles**: self, dept lead and Admin see all 3 tasks (`tasks_filtered:false`); the
other-department Approver and the plain User see only the 2 delegated ones
(`tasks_filtered:true`). Operator and cross-tenant ids 404. `/team/velocity` 403s for an
Approver. Salary: mark → unmark → both rows survive in history, month scoping works,
a raise re-stamps the paid amount, soft delete keeps the history, blank-name and
negative-amount 400. Task status verified end to end after the 42P08 fix (single, bulk,
with-other-fields, stamp set and cleared). `parseQuickAdd` and the manual-sort fallback
exercised as pure functions; deals still reject `Urgent`, proving the vocabularies
stayed separate. Dev server left running.


## Phase 8 — activity + settings + analytics (2026-09-01)

Closing pass over the **workspace-administration surfaces**: `/activity`, `/settings`,
and the in-workspace usage analytics that M5 claimed and never built. Specs:
`_audit/pages/{activity,settings,missing--analytics}.md`. Zero new deps. One new table
(`page_views`), two new `activity_log` columns.

### The bug that mattered most (found live, same family as Phase 8's 42P08)
The page-view ping wrote **nothing**, and said `{"success":true}` while doing it. The
dedup INSERT reused one placeholder in `SELECT $1,$2,$3` and in `WHERE path = $3`, so
Postgres deduced `text` from the bare select list and `character varying` from the
column comparison → **42P08 "inconsistent types deduced for parameter"**. The route
swallows errors by design (analytics must never break navigation), so the only symptom
was an analytics page that stayed empty forever. Every value is now bound TWICE and
cast. **The landmine already in this file was right and still isn't enough on its own:
a swallowed error means the 42P08 never surfaces — only checking that the row landed
does.**

### Activity (`routes/activity.js`, `pages/Activity.jsx`) — a genuine regression, restored
A 729-line audit browser had become a 46-line unfiltered 100-row table, and the server
had dropped every filter, pagination and the `/users` endpoint.
- **P1 filters + `/activity/users`** — user, date range (Today/7d/30d/All + custom),
  free-text search, department, HTTP method, sort, and category buckets, all server-side
  and all label-scoped (the user JOIN is label-constrained so a filter can't reach across
  tenants). **Buckets are ILIKE patterns, not boom's `action IN (...)` list**: boom's ~40
  action strings were a closed set; cadence logs 150+ and gains more every phase, so an
  IN-list would stop matching the moment somebody wrote a new phrase — and would look
  like it worked while hiding events. Search also covers `detail` and `entry_payee`.
- **P1 pagination + total** — LIMIT/OFFSET plus a parallel COUNT over the same JOIN, a
  7-page numbered window, and a live "N events matching filters" subtitle. `ORDER BY
  created_at, id` so two events in the same second can't swap between pages.
- **P2 `entry_id` / `entry_payee`** — added to the schema and the writer. `entry_id` is
  **derived from the endpoint inside `logActivity`** (`/api/ledger/1234/approve` → 1234),
  which is what made it free across ~100 existing call sites without touching one of
  them; `entry_payee` can't be derived, so it's an optional 4th `opts` arg wired into the
  11 ledger sites that already hold a payee (approve/reject/pay/void/rush/hold/split/…).
  Rows also carry the actor's `role` and `department` again.
- **P2 `humanizeAction`** — inverted from boom's. Cadence's log phrases are already
  past-tense English, so a verb-prefix pass-through is the PRIMARY path and the ~27-rule
  endpoint map is the fallback; an unmapped phrase is shown rather than replaced with
  "Activity".
- **P2 detail formatting** — `{field:{from,to}}` renders as `Changed amount from "X" to
  "Y"` via FIELD_LABELS, `{field:value}` as pairs, plain text as-is, else `Entry #id`.
- **P2 category chips + P2 user cell** — 8 categories with icon + tint, avatar initial,
  and a department badge that **deep-filters the feed** on click. Per-row classification
  is a PRECEDENCE-ordered client classifier, deliberately narrower than the server's
  inclusive filter: "Set artist budget" filters under both Artists and Finance but can
  only wear one chip, and it reads as Finance.
- **P3s**: two-line time cell (absolute + relative), Refresh with a silent-refetch
  spinner, an error banner with Retry (the old page swallowed 500s into "No activity
  recorded yet"), the `s` sort hotkey, the Last-7d default window, the "Activity History"
  title, and Skeleton/iconed-empty states. The filtered-empty state offers Clear filters.
- `/activity` moved `AdminRoute` → **`StrictAdminRoute`**: the server is `requireAdmin`,
  so admitting Approvers only ever bought them a 403 banner.
- **Date presets use a local-calendar day string, not `toISOString()`** — a UTC
  conversion after 5pm PT asks for tomorrow and silently drops today's events.

### Settings
- **S1 full export, rebuilt as a STREAM.** `lib/zip.js` gained `createZipStream(out, ts)`
  — a ZIP is [local header + name + data] runs followed by a central directory, so with
  STORE there is no compression state and the format streams natively; only the central
  directory stays in memory, and backpressure is respected. That's what made it safe to
  put the **uploaded documents** back in (invoices, receipts, payment proofs, W9s,
  attachments, one at a time from R2 with the inline base64 fallback — and a `data:` URL
  prefix stripped, since handing that to `Buffer.from(…, 'base64')` yields silent
  garbage, not an error). Row ids prefix every filename because **a ZIP with duplicate
  names loses files silently on extract** and twelve vendors all send "invoice.pdf". Also
  **3 formatted Excel workbooks** (exceljs, already a dep) built from the SAME rows the
  CSVs came from, so the two copies can't disagree. README manifest lists per-section
  counts AND everything that couldn't be retrieved. On mid-stream failure the socket is
  destroyed — headers are already out, and the alternative is a truncated archive that
  looks valid.
- **S2 the permission model's inverse state.** Row-absence means unrestricted
  (`canView` returns true when `pagePermissions` is null), so saving `[]` is the server's
  spelling of "grant everything" — the exact opposite of an admin who has just unticked
  every box. Rather than flip the default (which would lock every existing user out of
  every workspace on deploy), **access level is now an explicit two-way choice on
  screen**, and the restricted branch never sends a bare `[]`: nothing ticked saves the
  `['/']` Dashboard floor, and the button says `Save — Dashboard only` before it's
  pressed. Default-open for a brand-new User is left as the documented model.
- **S3 My Nav**, rebuilt as Settings → Account → **Sidebar**. `utils/navPrefs.js` holds
  the per-user localStorage list plus a custom event — **localStorage's own `storage`
  event only fires in OTHER tabs**, so without it the sidebar in this one keeps the stale
  list until reload. `/settings` is never hideable (hiding the page that owns "Show all"
  leaves no way back). To keep one definition, `Layout.jsx` now exports a pure
  **`buildNavGroups({isAdmin,isApprover,…})`** that both the sidebar and the hide-list
  read; two copies would drift and offer toggles for rows that aren't there. This is a
  view preference, never a permission — everything hidden is still reachable by URL and ⌘K.
- **S4 Permissions Overview** — the no-selection state is a table of every member with
  role, department, page count and Configure. Counts are fetched **sequentially**: a
  roster is tens of people and a parallel burst against the general rate limiter is a
  worse trade than a second of latency on a panel nobody is blocked by.
- **S5 reps** — POST **reactivates** a deactivated name instead of answering "already
  exists" about a struck-through row the admin can't act on; DELETE is now **guarded**:
  `expenses.rep` / `deals.ar_rep` / `user_visible_reps.rep_name` store the NAME, not a
  FK, so deleting a used rep doesn't orphan a join — it makes the name unmanageable
  forever. A referenced rep is **deactivated instead** and the route answers 409 +
  `deactivated:true`, which the client surfaces as a result, not an error.
- **S6 export UX** — a confirm modal that states what's inside (N CSVs / M rows, the
  workbooks, the document count), a confidentiality banner, an include-documents toggle
  (`?files=0` for data-only), a size warning past 200 files, and a "Preparing your
  archive…" state. Backed by `GET /full-export/summary`, which **COUNTs over the same SQL
  rather than running it** — the dialog must not cost as much as the export it's asking
  permission for. The client still uses a blob (downloads carry the Authorization header,
  so an anchor can't authenticate); the multi-GB problem was moved off the server, which
  is the half that was actually unbounded.
- **S7** full-export regated **Superadmin-only**. **S9** only a Superadmin may write an
  admin-tier account's allow-list (+ page-shape and count validation on both the
  permissions PUT and templates). **S10** template names ≤60 chars, `/`-paths, and
  **empty templates refused** — an empty one "applies" nothing, which under the clear-all
  convention reads as grant-everything. **S12** theme now persists: `ThemeContext` paints
  from localStorage first (a server round trip here is a white flash on every dark-mode
  load), then adopts the account's stored value unless the person has already toggled in
  this session. **S13** a Light/Dark picker with an Active badge is back on Settings.
- **S11 — the bank-accounts finding.** The audit said no endpoint and no UI existed. Half
  of that has since changed: `GET/PUT /api/bank-statements/accounts` **does** exist and
  the GET is consumed by the statement-upload picker — but the **PUT had zero callers**,
  so the list was still unmanageable. New `components/BankAccountsManager.jsx` (Settings →
  Finance). The PUT was hardened first, because this is not cosmetic: an account's `key`
  is what `bank_statements.account` stores and what `lib/bankEvidence.js` turns into
  per-account payment-method compatibility SQL. **Removing an in-use key doesn't fail
  loudly — those statements quietly fall through to "any method is compatible", weakening
  every match decision made against them**, so it's now refused with the statement count.
  Duplicate keys are refused too (the second CASE arm is unreachable, an order-dependent
  silent rule), and `methods: []` normalizes to `null` because an empty array would match
  NOTHING while reading as "no restriction".
- **Skipped**: S8's remaining depth is done except preset descriptions as visible prose
  (they're `title` tooltips); **S14** (`n` = add user) is superseded — the Users tab moved
  to `/team` in an earlier phase, so there is no add-user form on Settings to open.

### Usage analytics (the P1 that was never built)
`page_views` (label-scoped, 3 indexes, in `db.js` TENANT_TABLES), `routes/analytics.js`,
a `Layout` route-ping, a 180-day retention sweep at boot + daily, and `/usage`
(StrictAdminRoute: range picker, 4 stat cards, daily area chart, most-used pages with
proportional bars, most-active people merging views + logins + actions by name).
`user_login_logs` and `activity_log` already existed and were read by nothing.
- **Ping hygiene, all three deliberate**: the **pathname only** — `location.search` can
  carry invite tokens and signed-URL signatures and none of that belongs in a table
  admins read; **consecutive-duplicate dedup client-side plus a 30-second per-user+path
  window server-side**, so a remount storm writes one row; and **skipped entirely while
  `impersonating`** — a platform operator inside a tenant, or a Superadmin viewing-as,
  would otherwise appear in that workspace's "most active people" as traffic its own team
  never made. Stated on the page so the number isn't quietly wrong.
- Numeric path segments normalize to `/:id` before insert so families roll up. The route
  **always answers success**, and the admin summary **degrades to an empty payload on
  42P01** rather than 500ing, so a container running ahead of its migration doesn't break
  navigation or the page.
- full-export gained `usage_by_page.csv` as a per-page **rollup, not the raw rows** —
  exporting the raw table would hand out a permanent copy of the per-person browsing
  history that the 180-day retention exists to expire.
- **P2 operator analytics — built, not deleted.** `GET /api/platform/analytics` had zero
  consumers. New `pages/PlatformAnalytics.jsx` + a nav item in `PlatformLayout`: 4 stat
  cards, a 12-month growth bar chart (months **filled**, so a zero-signup month shows as
  a zero bar instead of vanishing and making growth look smooth), and busiest-workspace /
  largest-catalog rankings. It stays a different question from `/usage` — tenant growth,
  never per-person page usage — and says so on the page.

### Verification
Client build clean; `node --check` on all 11 touched server files; **finance fixtures
140/140**. Live on :3001 against the Phase-8 users. Proven, not reasoned about: every
activity filter (category/user/department/method/search/from-to/sort/page) returns
different, correct totals off 300 real rows, `sort=asc` really returns the oldest, a NaN
`user_id` no longer reaches Postgres; `/activity` and `/analytics/summary` 403 for both
an Approver and a plain User while a plain User's ping is accepted and attributed;
`entry_id` derives from the endpoint on a live PATCH and `entry_payee` lands from a live
rush flag and is then findable by search. Pings: `/releases/123` + `/releases/456` roll to
one `/releases/:id`, `?token=SECRET` is stored as a bare path, `no-slash` is dropped, two
rapid pings write ONE row and a third writes a second once the window has passed, and a
200-day-old row is deleted by the boot sweep (log line confirmed). Export: 403 for an
Admin, 200 for the Superadmin, and the streamed 29-entry archive unzips cleanly with
readable workbooks (73-row `ledger` sheet) and a README that discloses the 5 documents R2
couldn't serve in dev. Settings: an Admin is refused an Admin's permissions and the
Superadmin isn't; a non-`/` page string 400s; empty and 61-char templates 400; a rep
round-trips add → deactivate → re-add-reactivates → delete, and a rep matching 3 ledger
rows is deactivated with a 409 instead; bank accounts reject duplicate keys and an empty
list, accept a third account, and refuse to drop `bofa`/`paypal` while 4 statements are
filed under them. Dev server left running.

---
## Standing invariants already honored (keep honoring)
- Every query scoped by `label_id`; client FKs re-validated against the label.
- `useEffect(() => { load() }, [])` — never `useEffect(load, [])` (Promise-as-cleanup crash).
- Integrations degrade gracefully with no API keys.
- New `expenses` column → add to the list-endpoint column set + PATCH allow-list.

## Known landmines (from prior bugs)

Each of these shipped at least once. They are ordered by how silent they are —
the ones at the bottom produce no error at all.

**Postgres / node-pg**
- **`pg` hands a DATE column back as a JS `Date`, not a string.** A `date` column
  serialises to `"2026-09-02T07:00:00.000Z"` — midnight *server-local* rendered as
  UTC. `new Date(that).toLocaleDateString()` in a browser west of the server shows
  the **previous day**. Verified live in Phase 10. Three sightings (MyWork,
  notifications overdue, Legal). Use `utils/dates.js formatDate`, never a bare
  `new Date(...)`, on anything that came from a `date` column.
- **Never reuse one `$n` against both a column and a literal.** `SET col = $1,
  other = CASE WHEN $1 = 'Done' …` makes Postgres deduce two types for `$1` and
  raise 42P08 "inconsistent types deduced for parameter". Casting doesn't help —
  bind the value twice. Three sightings; this silently killed every task status
  change (Phase 8). Same shape bites `INSERT … SELECT $1,$2,$3 WHERE NOT EXISTS
  (… col = $3)`: the bare select list deduces `text`, the comparison deduces the
  column's type.
- **A NaN reaches Postgres as a type error, so a bad request becomes a 500.**
  `parseInt(req.body.x, 10)` on a missing field is `NaN`; `WHERE id = $1` then
  raises 22P02. Guard with `Number.isInteger` and return 400. Phase 10 found six
  more of these after the first was fixed in `tasks.js`; `lib/paymentFamily.js
  familyRoot` is now hardened centrally so every caller inherits the guard.
- **An unknown FK is a 404, not a 500.** Inserting a child row for an id that
  doesn't exist raises a foreign-key violation. `INSERT … SELECT … WHERE
  EXISTS`, then treat `rowCount === 0` as not-found (Phase 10, announcements).
- **`ALTER TYPE … USING` will not accept a subquery.** The expression is
  evaluated per row; it has to be a pure expression over that row's columns.
- **`runMigrations()` is ONE promise chain.** A failure anywhere aborts every
  migration after it, so boot succeeds with a half-built schema. A FK `ALTER`
  must come AFTER its referenced table's `CREATE`.

**Node process safety**
- **A double `client.release()` kills the whole process.** An early `return` that
  releases the client, in a handler that also has `finally { client.release() }`,
  makes pg-pool throw *outside* the try — an unhandled rejection that takes the
  server down for every tenant. It is reachable from ordinary not-found and
  validation paths. Phase 10 found **12 live sites** (including `POST /chat/dm`
  returning an existing DM — the common path). Let the `finally` do it, always.

**Client / build**
- **`vite build` does not execute anything.** It will not catch a `useMemo` dep
  array referencing a `const` declared below it (TDZ — the `/ledger` crash), nor a
  JSX component that was never imported. Phase 10's `Check` bug — one missing name
  in a lucide import in `constants/navConfig.jsx` — white-screened **every page for
  every Approver, Admin and Superadmin**, because `Layout` calls `buildNavGroups`
  on every render. It built clean. Run `check-tdz.cjs` and `check-render.mjs`.
- **Alpha on a `var()`-backed token emits no CSS** under Tailwind's
  `rgb(var()/<alpha-value>)` scheme when the var holds a hex. The semantic status
  colors route `/NN` through `color-mix` in `tailwind.config.js` specifically to
  fix this — and **non-scale opacities emit nothing regardless**, so stick to the
  default opacity steps. Verify a new tint by grepping the built CSS.
- **Two `!important` background utilities tie on specificity**, so the winner is
  stylesheet order — this is how the My Work drop-target fill went dead. The
  `.dark` raw-tint remap layer in `index.css` deliberately uses specificity
  (0,2,0) instead of `!important` for the same reason.
- **`box-shadow` on a `<tr>` is not painted** by Blink/WebKit under
  `border-collapse: collapse`. Put it on the `<td>`s.
- Deployed-bundle sourcemaps + ErrorBoundary are how minified crashes get
  diagnosed. Keep `build.sourcemap` on.

**Verification discipline**
- **When a route swallows errors by design, a 200 proves nothing — verify the row
  landed.** The analytics page-view ping returned 200 while writing nothing for
  weeks, because it caught and discarded a 42P08. Any best-effort/fire-and-forget
  write needs a read-back assertion, not a status-code assertion.
- SMTP host typos surface via the Team-invite error banner.

---

## Build-order Phase 9 (2026-09-02) — global surfaces + app-wide polish

The shell itself, plus the two systemic passes (dark-mode residue, mobile layer)
that no per-page audit owns. Zero new deps.

### ⌘K palette — it can now find a PAGE, a VENDOR and an INVOICE
`components/GlobalSearch.jsx` searched four entity types, none of which is what
people reach for. It is now two halves that deliberately do not wait for each
other: **pages** matched LOCALLY (`lib/pageSearch.js`, pure + assertable) against
the nav vocabulary already in the bundle, rendering on the first keystroke; and
the server half. Because pages paint during the server flight, a query never
flashes "No results" on its way to an answer.

- **`constants/navConfig.jsx` is now THE nav definition** — extracted out of
  Layout, which re-exports `PAGE_LABELS`/`buildNavGroups` so existing importers
  are untouched. Three consumers: the sidebar, Settings' hide-items editor, and
  the palette's page ranking. Every item carries a **`synonyms`** string (48
  tagged), which is the vocabulary people actually type — "w9" reaches Vendors,
  "p&l" reaches Reports, "payroll" reaches Salary. `canView` is applied BEFORE
  ranking, so the cap of six is six pages you can actually open.
- **Server `routes/search.js`**: + vendors (derived from `expenses.payee`,
  alias-aware via `vendor_aliases.canonical`, creator rows excluded, spend-
  ordered) and + leaf-only ledger entries (invoice#/payee/description, split
  parents excluded so the same money isn't offered twice). Both gated on
  Approver — the same tier `routes/ledger.js:108` enforces, asked rather than
  restated. Archived releases no longer leak; artists ordered by derived
  release count; contracts by `expiration_date ASC`.
- Restored from boom: **recents** (last 8, typed, deduped, Clear), **category
  pills**, per-group counts, release type-chip + date, artist avatar + release
  count, contract status badge, deal stage. Artist rows go to `/artists/:id`
  (the profile exists), vendors to `/vendors?vendor=`, entries to
  `/ledger?focus=`. **`/` opens the palette** (Layout).
- Also added a nav row for **Add Reimbursement**: the page existed but was
  reachable only from a button on `/ledger`, which a User without the ledger
  page can never see — so it was unreachable for exactly the people who file
  reimbursements.

### Notification bell — five missing alert kinds, and sections instead of a list
`routes/notifications.js` gained `release_behind` (≤7d and <50% checklist, danger
≤3d), `release_unassigned`, `payment_rush`, `budget_burn` (≥80% of
`artist_budget_sections`, artist-keyed the same canonical way `lib/artistKey.js`
is), `contract_renewal` (expiry × unreleased tracks) and **team overdue tasks**
scoped by the SAME department boundary `routes/tasks.js` `teamFilter` enforces.
Contract alerts widened back to Approver + 90 days. Titles are sentences with
the numbers in them again.

- Releases produce ONE dataset and two outcomes — behind-and-inside-a-week
  escalates, everything else is the plain upcoming row — so a release can never
  appear in two sections at once, which two queries would have allowed.
- Every item carries a **`group`**, so grouping is a property of the alert, not
  of the component: the dropdown and `/notifications` cannot disagree.
- Client: per-kind sections, **per-type preferences** (gear, localStorage,
  merged over defaults so new types default ON) which filter the COUNT as well
  as the list, tiered days-until / % chips, reminder **Done** (advances the
  cadence via `/bank-statements/reminders/:id/done`), severity sort, and the
  badge back to **red** — `bg-red-500`, not `bg-danger`, because that token is
  tuned as a *foreground* and flips pale in dark, where white would vanish on it.
- Approval alerts deep-link to **`/approvals`** (the page NEW ships) instead of
  `/ledger`, and vendor submissions are their own kind again.
- `pages/Notifications.jsx` read `smart_alerts`, which is narrower than "not a
  mention" — it was silently dropping releases/contracts/tasks/budgets from the
  page that promises all of them. Now derives from `items`.

### Dark mode — the RC-9 residue
The token half was already fixed (gray-50/100 split; 0 `bg-brand-50` sites
remain). What was left was raw Tailwind tints and two dead-CSS traps:

- **`tailwind.config.js` `tokenColor()`** — `page/card/elev/sidebar/header/ink/
  rule/divider/selected` are theme-flipped HEX vars, so Tailwind's
  `rgb(var()/<alpha-value>)` trick cannot apply and **`bg-page/50` emitted
  NOTHING**. 66 sites were written that way, including the `bg-page/50` on
  essentially every table `<thead>`. They now route through `color-mix`, the
  same treatment `success/warning/danger/info` already had. Verified in the
  built CSS:
  `.bg-page\/50{background-color:color-mix(in srgb,var(--color-bg-page) 50%,transparent)}`.
- **Consequence to know**: two FROZEN first cells (`Ledger` split rows,
  `Payments` child rows) were `bg-page/40|60` — dead, therefore transparent.
  Making them live made them *translucent*, which is still wrong for a cell that
  must paint over the columns sliding under it. Both are now opaque `bg-elev`
  on the row AND the cell (same reason `--color-bg-selected` is opaque).
- **`.dark` tint compatibility layer** (index.css, ~90 selectors): 14 colour
  families × `bg-50/100`, `border-100/200/300`, `ring-200/300`, and
  `text-600/700/800` pushed to the `-400` tier, plus the `hover:` variants and
  the four alpha-modified classes in use (`bg-amber-50/60` is a DIFFERENT class
  name — the base rules never see it). No `!important` needed:
  `.dark .bg-amber-50` is (0,2,0) vs the utility's (0,1,0), and the `:hover`
  rules land at (0,3,0) so a hover tint still beats its own resting fill
  regardless of source order. Class count 93 across 31 files (was 213/59 at
  audit, 73/29 at phase start) — **0 of them unremapped**; no colour family in
  the codebase falls outside the layer.
- **Recharts** (`utils/chartTheme.js`): `TOOLTIP` + `AXIS_TICK`/`AXIS_TICK_SM`.
  The default `<Tooltip />` is a white box with dark text — a glaring light popup
  in dark — and an axis with no `fill` renders Recharts' default #666 at 2.8:1 on
  the dark page. Neither responds to a class; both are inline/SVG. Applied to
  Usage, PlatformAnalytics, Payments, Financials, InvoiceSearch, CategoryTrend,
  WeeklyChart (Dashboard already had a tokenized CustomTooltip).
- **Scrollbars**: `color-scheme: light|dark` (fixes native widgets and form
  controls too) + a 6px WebKit gutter with dark thumb overrides.
- `Brand.jsx`'s three image-overlay chips were `bg-white/90 text-gray-700` —
  `text-gray-700` is var-backed and flips to a near-WHITE tier in dark, so they
  rendered white-on-white. Now `bg-card/95 text-ink`.

### Mobile shell
Edge-swipe drawer (passive listeners, ≥60px travel, must START within 24px of
the left edge, horizontal must beat vertical 1.5× — otherwise every horizontally
scrolling table opens the nav). Universal **36px touch target** under 768px
(`button, a[role=button], [role=tab], summary`) plus an app-wide mobile layer:
h1 downscale, momentum scroll, press feedback, a 480px form-grid collapse and
print styles. Deals kanban gets horizontal **snap-scroll** on phones (240px
columns) — the first consumer of the `.snap-x-mandatory` helper index.css has
always shipped. FAB open-state dims the page. BottomNav Chat tab carries the
live unread badge the docs already claimed. Approvals toolbar goes full-width
search + two-up filters below 640px.
*Already closed by earlier phases*: FilterSheet on both Ledger and Payments,
Payments card → `PaymentSheet` tap-through, FAB `?new=task` deep link.

### Shell, shortcuts, primitives
- **Impersonation banner restored.** The header Exit pill names the ADMIN you'd
  return to, not whose view you are in — and every destructive action taken from
  there is taken AS them. Header also gains a **Keyboard** button (`?` was the
  only way to discover the modal), a **request quick-compose** carrying
  `?from=<pathname>` (`document.referrer` is EMPTY on a client-side route change,
  which is every navigation inside the app — the page's referrer capture never
  worked), and `aria-label`s.
- **Ledger `z`/`c`/`x`** wired — the Columns and Export buttons had been
  advertising "(c)" and "(x)" in their tooltips with nothing behind them.
- **`constants/shortcuts.js` reconciled against every live handler.** It was
  missing Approvals' j/k/a/r/⇧A, the Releases list keys, Calendar, Catalog,
  Create Invoice's ⌘-combos and five of the bank deck's ten keys — while
  promising a Ledger `z` that did not exist.
- **Toasts** gained `toast(msg, type, { action, duration })` — the action slot is
  what makes toast-undo possible (`duration <= 0` = sticky) — plus an `info`
  variant, per-type durations, entrance animation, max-width,
  `pointer-events-none` on the column (the gap between stacked toasts was
  swallowing clicks) and a mobile offset clear of `BottomNav`. Payments' bespoke
  fixed undo bar is now a toast action.
- **`ui/Modal`** width ladder extended to 3xl/4xl/5xl/6xl — it stopped at
  `max-w-2xl`, which is why the five widest hand-rolled overlays *could not*
  migrate. `backdrop-blur-sm` on Modal + BottomSheet.
- **404**: unknown URLs rendered a silent redirect to the dashboard, which looks
  exactly like "the link worked". `components/NotFound.jsx` now renders INSIDE
  the shell (being lost is when you need the nav most) on both shells.
- `Skeleton.ArtistProfile` added; `ArtistCampaignDetail` uses it.
- **Filter-aware empty states** on Ledger and Payments — "All caught up 🎉" was
  gated on the POST-filter list, so an active quick filter put a celebration over
  rows that were merely hidden.
- **Emails**: team invites (+resend) accept `notify: false` and route through
  EmailPreviewModal (`welcome` kind, previously orphaned) — an invite carries a
  workspace name and a live 7-day credential and was the one email nobody could
  check before it left. Payment-confirmation previews now list the attachments
  the feature route resolves server-side.

### `client/scripts/check-tdz.cjs` — a build cannot catch this
Babel scope analyzer, `npm run check:tdz`, exits non-zero on a genuine hazard:
a `const`/`let` READ before its own declaration in the same function scope. That
is legal syntax, so `vite build` is perfectly happy with it; the ReferenceError
only appears when the module runs. It exists because a `useMemo` dependency array
referencing a `const` 300 lines below it shipped a production crash. References
from inside a NESTED function are excused (that body runs later), as is a
reference on the declaration's own line (destructuring defaults that mention a
sibling, self-referential arrows). Reports are deduped per source position —
Babel visits a binding once per Scopable that resolves to its scope. Added to
"Verify before push".

### Also fixed
`client/src/pages/Ledger.jsx` contained a literal NUL byte (a null-value sentinel
written raw instead of escaped), which made grep, ripgrep and editors treat the
entire 1,979-line file as binary. Now written as an escape sequence instead.

### Deliberately not done (logged)
Sidebar group taxonomy re-shuffle to boom's IA; collapsible sub-groups + tabbed
family rows; Bookkeeping item order; boom-billing copy-address; `external` nav
items. Migrating the remaining ~34 hand-rolled `fixed inset-0` overlays and 52
`window.confirm` sites onto the kit (the width-ladder blocker is gone; the work
is mechanical). Solid colour-coded toast surfaces (the neutral card is deliberate
and dark-safe). Bank deck `p` preview / `↓` dismiss alias.

---

## Phase 9.5 (2026-09-02) — recording budgets + reports + vendors

The three real pages `97-remaining.md` found with no campaign. **Zero new deps.**
Fixtures 140 → **164** (23 new: recording-budget money rules + W9 name matching).

### A · Recording Budgets — 30 of 32 closed

Was a 131-line inline expander over a 124-line router. Now an index + a routed
detail document, ported from the reference app's Budget/Fund/Costs-to-Date
templates. **The budget is a typed document, not a titled list row.**

- **Schema** (`index.js`, all IF-NOT-EXISTS after the CREATE): `recording_budgets`
  gains `artist_id` FK + freeform `artist_name`, `release_id`, `project_title`,
  `type` (budget|fund), `currency`, `advance_amount`, `fund_amount`,
  `proposed_tracks`, `locked_by`, `updated_by/at`; `title` **drops NOT NULL**
  (identity is artist + project — a blank draft has to be creatable so the header
  grid can BE the form). `recording_budget_items` gains `qty`, `unit_price`,
  `notes`, `sort_order`. `expenses.budget_section_override` for costs-to-date
  reclassification. Data migrations run once and idempotently: legacy `title` →
  `project_title`, display-label sections → the six keys, `amount` → `1 × amount`.
  Both tables added to `db.js` TENANT_TABLES + full-export.
- **`lib/recordingBudget.js`** (new, pure, fixture-backed) holds the three money
  rules: a line is `qty × unit_price` **rounded AT THE LINE** (so the six section
  totals and the subtotal always tie); contingency is a % **on top of** the
  subtotal, never inside it; a fund's waterfall takes the advance out FIRST
  (`fund − advance − plan`), and an overrun reports a NEGATIVE balance rather
  than clamping. The route computes nothing itself — index and detail both go
  through `budgetTotals`, so they cannot drift.
- **Router**: routed index + `GET /:id` emitting **all six sections even when
  empty**; blank `POST /` (contingency default 7.5); `PUT/PATCH /:id` allow-list
  with in-tenant FK re-validation; three verb transitions (`approve|lock|reopen`,
  `/status` kept for back-compat) where **reopen NULLs both stamp pairs** — a
  draft carrying an `approved_by` claims an approval that was withdrawn; DELETE
  **403s when locked** (previously the one mutation a frozen budget accepted was
  destruction); line-item POST/PUT/DELETE with `SECTION_SET` validation on both
  create AND update; `touch()` on every item write so `updated_at DESC` floats
  active budgets. All `:id` routes are `(\d+)`-constrained so `/expense/:id/section`
  isn't swallowed.
- **`GET /:id/actuals`** — the real fix to the old "always over budget" row: was
  the artist's ENTIRE all-category all-time approved spend converted with
  date-based `toUSD`. Now scoped to the budget's artist (`LOWER(TRIM)` equality,
  never the bucket key), optionally its release, **every live split slice counted
  once carrying its own artist**, and converted through `lib/usd` `rowUsd2` so the
  locked `fx_rate_to_usd` always wins and rounding happens at the row. Proven
  live: by-category spent, row sum and summary spent all equal 1493.79.
- **Client**: `RecordingBudgets.jsx` (index — 5-card summary over FILTERED rows,
  search + status filter, filtered-empty copy, row anatomy with Fund/Budget chip,
  status chip + icon, "Unnamed artist"/"no project title", N tracks · N line
  items, right-aligned Total + Advance/Fund, error card + Retry) and new
  **`RecordingBudgetDetail.jsx`** at `/recording-budgets/:id` — masthead +
  lifecycle with three distinct ConfirmDialog strings, `readOnly` disabling every
  input, header grid (artist combobox filtering the roster but freeform-capable
  with ↑/↓/Enter/Esc and an explicit "use as freeform" escape; project, release,
  currency, Budget|Fund segmented, `MoneyInput` committing on Enter/blur only,
  fund-only Total Recording Fund, proposed tracks, contingency), fund summary
  panel, and **two tabs** — Planning (sticky running-total strip, six always-
  rendered sections with per-section icon/tint and the templates' own qty/price
  header labels, compact-when-empty chevrons, expand-all, live share bar, inline
  add + click-to-edit rows + per-row delete confirm naming the description,
  bottom total block) and Costs to Date (fund/budget summary, by-category
  planned/spent/remaining/% with overspend tone, ledger expense list with a
  per-row budget-category override select, amber-bordered when overridden).
- **Add-item draft state is per SECTION CARD** — the old single shared `item`
  leaked typed values between budgets.
- **Not done**: DEF-RBUD-31's `created_by`/`approved_by` are still name strings
  (now displayed, at least); no artist-picker "no matches" keyboard-create.

### B · Reports — 19 of 24 closed (both named issues fixed)

- **[P1] Balance sheet no longer counts drawdowns as debt.** `total_liabilities`
  is A/P only; drawdowns move into a **"Funded by"** block (drawdowns + derived
  accumulated deficit + total + the "presentation, not a proof" note), hideable
  via `bs_line:funding` with an inline "Show Funded by" way back. This reverses
  the exact `$5.49M liabilities / meaningless equity` failure the reference app
  documents (John's 2026-08-07 call). Verified live: liabilities === A/P, and
  `drawdowns + accumulated_deficit === net_assets` by construction.
- **[P1] P&L line filter.** `pnlQ` input with a match count, per-section
  "Subtotal of shown" rows derived from the SAME entries the rows render, real
  totals relabelled "(all lines)" while filtering, and per-section no-match rows.
- **[P2, named issue] `non_recurring` is its own labelled section.** It was being
  bumped into `below.expenses` and rendered unlabelled inside "advances &
  pass-through" while the classify UI offered it as a third choice. `buildPnl`
  now emits a `non_recurring` block (income + expenses + totals + net); the client
  renders it with its own net and explanation; **Net Change in Cash is the
  three-section sum**; `reportRows.js` exports it as a third block. Proven live:
  classifying Travel → non_recurring moves the line, `ties_to_pnl` stays true,
  and the cash line equals the three nets.
- **[P2, named issue] `all_expense_ids` is now used.** Past the 500-row render cap
  the drill offers **"Attribute all N"** against the full id list, plus select-all,
  a selected-$ readout, selection **pruned when the filter changes**, bulk month
  move, and eligibility-split copy ("Set artist on 4 of 6" — income rows have no
  artist to set).
- **[P2] BS depth**: A/R + A/P **aging buckets** (current/31-60/61-90/90+),
  per-line **composition** breakdowns built from the same filtered rows so the
  parts sum to the line by construction, and the **undated-paid disclosure**
  (paid bills with no payment date can't be placed in time). All three also in the
  Excel workbook.
- **[P2] BS whole-line exclusion has UI** — hover Ban / Undo2 on every line
  including per-cash-account, so an excluded line is reachable from the sheet
  that shows it (the server + Dismissed-tab restore already existed).
- **[P2] Drill sort** (Date/Name/Amount pills with stated default direction and
  click-to-flip) applied **server-side over the full set before the cap**, so
  "biggest first" isn't the biggest of an arbitrary 500.
- **[P2] "What backs these figures"** evidence aggregate — invoice vs
  bank-invented $ + row counts + a bar, summing to the cell total by construction.
- **[P3s]**: rename toast names the touched tables; the per-line dismissed badge
  is a clickable **+$amount** that jumps to the Dismissed tab (was an inert `◦`);
  the drill's "+$Y dismissed" jumps too; SBA **Top-N lifted to the page so Export
  follows the screen**; **merged-spelling `×N`** chip + tooltip (buildPnl kept the
  spellings instead of discarding them); SBA category columns ordered by
  **artist-attributable** spend with overhead-only columns greyed and last;
  advance-only-artist sentence restored; Dismissed-tab line rules carry a live
  **"$X excluded in range · N rows"** chip (new `dismissed.by_rule`, split from
  `by_cell` so item dismissals don't inflate a rule's claim); `isValidDay` does a
  **real-date** check (`2026-02-31` now 400s instead of reaching SQL); from/to
  `max`/`min` cross-clamps; Financials cross-link; the subtitle no longer says
  "statement-verified" (it overstated a ledger-mastered basis).
- **`buildPnl`'s shipped contracts are untouched**: `collectCountedIds`,
  `collectLabelLevel` and `by_artist.ties_to_pnl` semantics are unchanged, and
  `ties_to_pnl` was re-verified true before and after every change.
- **Not done** (logged): the review deck over drill rows (P1 — the largest single
  item; `components/ReviewDeck.jsx` exists and the drill already returns
  everything it needs); drill-row document buttons / FilePreview (needs
  `withFileFlags`-equivalent plumbing); `classify`/`rename` staying Admin+ rather
  than Approver — treated as deliberate hardening, not reverted.

### C · Vendors — 21 of 27 closed, 1 already-closed

**Already closed by the Phase-2 vault campaign: #2** (encrypted
`vendor_payment_details`, Admin-gated, audit row per READ, masked summary,
key-missing state). Not redone — the drawer's vault card is untouched.

- **[P1 #1] Merges are reversible and recorded.** New `vendor_merge_log`
  (kind, from/into, `expense_ids` + `vendor_name_ids` + `email_ids` JSONB,
  `created_alias`, `undone_at/by`) written by both merge AND rename;
  `GET /vendors/:name/merges` + `POST /vendors/unmerge/:id`; drawer shows
  "Merged into this vendor" with per-merge Unmerge, undone merges staying
  visible, and a `logged_since` disclosure. **Reverses BY ID** — reversing by name
  drags rows that were always the target back out with the ones that arrived.
  Proven live: 7 entries + 1 saved email out and back, totals identical, second
  unmerge refused.
- **[P2 #3] Saved emails survive a rename/merge.** The single UPDATE aborted on
  the first unique-index collision and the swallow-all `.catch` left EVERY address
  stranded under the dead name. `carryVendorEmails` deletes would-collide rows
  first, then moves the rest, and reports both counts in the toast.
- **[P2 #4] `foldVendorRecord`** COALESCEs the source's W9 file / contact /
  notes into the target (target's own values win, notes concatenate) instead of
  `DELETE FROM vendors` discarding them.
- **[P2 #5]** voided rows excluded from `/vendors` and `/vendor-suggest`, matching
  every other aggregate. **[P2 #6]** `invoice_count` counts FAMILIES
  (`FILTER (WHERE parent_id IS NULL)`) and the drawer nests split children under
  their parent. **[P2 #7]** `total_spent_usd` + `currency_count`, rendered as
  "≈USD · N currencies" instead of netting currencies into one `$`.
  **[P2 #16]** `GROUP BY LOWER(payee)` with the most-used spelling as the display
  name — "Acme"/"ACME" were two rows while every mutation route matched `LOWER()`.
  **[P2 #17]** `vendorNameSet()` walks aliases both directions, so saved emails
  and the canonical W9 (`w9_entry_id || id`, alias-aware) follow the vendor.
- **[P2 #13/#14] W9 name-mismatch pipeline.** New `lib/w9NameMatch.js` — lenient
  on FORM (entity suffixes, punctuation, name order, middle initials, `&`/`and`,
  accents) and strict on IDENTITY, because a badge that fires on "Smith, LLC" vs
  "Smith LLC" trains everyone to ignore the one that matters. The list computes
  `w9_mismatch` from the **persisted** `expenses.w9_scan.w9_name` (gated on
  `w9_on_file` so a scan outliving its file can't badge a vendor with no W9), and
  surfaces it as a banner + per-row AlertTriangle + a "Name mismatch" filter.
  Scan-all is now **unscanned-only, capped at 10, 200ms apart**, returning
  `remaining` — it previously rescanned every W9-bearing payee unbounded in one
  request.
- **[P2 #11/#12/#27] Vendor bundle.** The uncalled `GET /ledger/vendor-zip` gets a
  drawer button (busy state, disabled with a reason when there are no invoices,
  JSON-error unwrapping from the blob); the xlsx now writes **`family_amount`** so
  split child slices are no longer omitted from both the rows and the TOTAL; the
  header fill reads the **workspace accent** instead of hardcoded indigo.
- **[P2 #15] List tooling**: search over name/email/**alternate spellings**, W9
  filter (all/on/missing/mismatch), 5 sorts, "N of M" count, Clear, a **1099
  column** using `reportingThresholdFor` (OBBBA $600→$2,000 from 2026 — the same
  rule the ledger's 1099 report adopted), and a per-currency stat strip in the
  drawer where **Total === Paid + Outstanding by construction**.
- **[P3s]**: email format validation + 409 on duplicate + the `label_text` field
  the API always had but the drawer never collected (now shown as a chip badge,
  with an `alias` marker on inherited addresses); noise-alias guard (`LLC`/`Inc`/…
  refused at the door) + an explicit "alias moved here from X" notice instead of a
  silent `ON CONFLICT` re-point; `formatDate` everywhere (dates were TZ-shifting a
  day west of UTC); merge/rename toasts name what moved; merge picker is a
  **debounced `/vendor-suggest` typeahead** instead of a `<select>` over every
  name; W9 upload gets `accept`, a busy state and a drag-over ring; rename now
  also updates `expenses.vendor_name`; drawer invoice rows (and child slices) link
  to `/ledger?focus=`.
- **Kept by design**: creator rows stay excluded from `/vendors` and
  `/vendor-suggest` (prior-phase contract).
- **Not done** (logged, each a surface of its own): #8 the vendor dupe deck
  (scoring endpoint, auto-merge exact tier, swap/custom-name/alias-only, "not
  duplicates" ack, merge-all ≥85 — DataQuality's vendor tab is the partial), #9
  the unified ledger+bank company view and its `?tab=` worklists, #10 bulk
  multi-select merge with a survivor picker, #18 move-ONE-invoice from the vendor
  surface, #15's cards view and the Added-expenses subpage.

### D · `missing--vendors-added-expenses` — SKIPPED

Not started. Its spec warns the port must use cadence's **`'recoupment'`
(SINGULAR)** `entry_source`, and half-building an implicit-vendor + variant
detector is worse than leaving it scheduled. Still open, still P1.

### Gap-map corrections

- "**Recording Budgets** (draft→approved→locked lifecycle, sections,
  costs-to-date) — MISSING" under Milestone 3 is now **built** (this entry).
- Reports' P&L now has three presented sections, not two. Anything reading
  `pnl.below` for "everything below the operating line" must also read
  `pnl.non_recurring` — `reportRows.js` and `PnlTable` were both updated; a new
  consumer that forgets will silently under-report Net Change in Cash.
- `expenses.budget_section_override` is a **report-only** attribution: it never
  touches the row's category on /ledger, and it is trusted as stored on READ
  (re-validating would silently reclassify a row whose category was renamed).

---

## Phase 10 — final QA (2026-09-02)

A verification pass, not a build pass: find what nine phases of campaigns broke
or missed, and make the documentation honest. **Zero new deps.** The premise was
that the `/ledger` TDZ crash two days earlier was not unique — a clean
`npm run build` had shipped it, so more of that class had to exist. It did.

### The two P0s — both shipped, both invisible to `npm run build`

**1. `Check` was used but never imported** (`constants/navConfig.jsx:134`,
introduced in the Phase 9/9.5 commit). Evaluating the nav array reads `Check`,
which is `undefined`, which throws. `Layout.jsx:243` calls `buildNavGroups` on
**every authenticated page**, so this was not a broken page — it was a **white
screen on every page for every Approver, Admin and Superadmin**. Only plain
Users could use the app at all. Verified by role before and after:

```
CRASH Admin/Superadmin :: Check is not defined      →  OK  Admin  49 nav items
CRASH Approver         :: Check is not defined      →  OK  Approver 42 items
OK    User (16 items, unaffected — the item is Approver-gated)
```

Rollup does not error on an unresolved global, so the build was clean. This is
the single most important finding of the phase.

**2. A double `client.release()` kills the entire Node process** — 12 live sites.
An early `return` that releases the pooled client, in a handler that also has
`finally { client.release() }`, makes pg-pool throw *from the finally block* —
outside the try, so the route's own catch never sees it. Node turns that into an
unhandled rejection and exits. One request kills the server **for every tenant**.

The reachable paths were not exotic: `POST /api/chat/dm` returning an
already-existing DM (i.e. opening a DM with anyone you have DM'd before),
`PUT /api/platform/operators/:email/access` on an owner, `POST
/api/artist-campaigns/:artist/rename-song` with no new name, `POST
/api/bank-statements/:id/misfiled/repair` on a missing statement, `DELETE
/api/platform/workspaces/:id` on an unknown id. `routes/flags.js:906` already
carried a comment explaining this exact failure — one site had been fixed and the
pattern never swept. Now swept: `artist-campaigns.js` ×4, `bank-statements.js`
×3, `chat.js` ×1, `platform.js` ×4. All 15 `pool.connect()` sites re-checked for
the inverse bug (a leak) — all release exactly once.

### Proving the routes, rather than asserting them

**Server — 562 routes across 47 mounts.** Enumerated by introspecting the Express
routers' own `.stack` rather than by grepping, so the list cannot drift from what
is actually mounted. Every route hit with a valid token; writes hit with an empty
body (a 500 on `{}` is an unguarded destructure, a 400 is a working guard);
DELETEs aimed at a ghost id so the handler runs without destroying data. Paced
under the 200/min limiter, with 429s retried — an un-retried 429 is an *untested*
route, not a passing one.

| Sweep | Result |
|---|---|
| GET × Superadmin (214) | 185 × 200, 9 × 400, 12+ × 404, 1 × 403 — **0 × 5xx** |
| WRITE × Superadmin (348) | 70 × 200, 4 × 201, 205 × 400, 61 × 404, 2 × 403 — **0 × 5xx, 0 process kills** |
| GET × Approver (214) | 131 × 200, 57 × 403, 9 × 400, 16 × 404 — **0 × 5xx** |
| GET × User (214) | 46 × 200, 159 × 403, 9 × 404 — **0 × 5xx** |

The only remaining 5xx are deliberate: a 502 from `/label/test-email` ("no email
provider configured") and a 503 from the file routes ("file storage is not
configured"). Both are correct degradation, not crashes.

**Client — 84 routes, all actually rendered.** No jsdom, playwright, puppeteer,
vitest or jest exists in the tree, and none was added. But **vite is already a
devDependency and ships an SSR module loader**, and `react-dom/server` ships with
`react-dom` — so `client/scripts/check-render.mjs` uses `vite.ssrLoadModule` to
genuinely execute every page module, then `renderToString` to genuinely run its
render function inside the app's real providers. Auth and Socket are stubbed to a
signed-in Superadmin; without that, `loading` never flips (SSR runs no effects)
and every page would render its spinner and prove nothing.

All 84 render. The harness is self-parsing (it reads `App.jsx`, so it cannot
drift from the route table), wired as `npm run check:render`, and was verified to
have teeth by re-introducing the `Check` bug and confirming it fails with a
precise stack. It also carries a **shell pre-flight** that exercises
`buildNavGroups` per role — without it the `Check` bug reported as "one route
broke" (`/settings`, which imports the builder directly) instead of "the app is
gone for three roles", which is a materially different finding.

**What this does NOT prove, stated plainly:** only the first paint. Effects, data
fetching, event handlers, drag-and-drop, focus behaviour, layout, and every CSS
outcome are out of scope. It is a "does it throw" gate, not a browser. The 6
audit rows that need a real browser are still marked as needing one.

**Nav integrity.** Every `buildNavGroups` entry resolves to a real `<Route>`;
every `PAGE_LABELS` key resolves to a real `<Route>`. No dead nav links. Three
nav entries had no `PAGE_LABEL` (`/messages`, `/bank-statements`,
`/data-quality`) — `Layout.jsx:385` renders that map as the topbar title, so
those three pages showed a blank title and appeared as raw paths in Usage
analytics. Added. The routes that are in no nav are all correct: public/auth
pages, the platform shell's own pages, and `/notifications` + `/manual`, reached
from the bell and the header help button.

### Other defects found and fixed

- **Six NaN-into-Postgres 500s.** `parseInt(req.body.x)` on a missing field is
  `NaN`; `WHERE id = $1` raises 22P02, so a bad request became a crash. Fixed at
  `campaigns/:id/link` + `/unlink`, `bank-matching` funding-pair +
  duplicate-pairs merge/reject, `artist-campaigns` review-assign + not-campaign —
  and centrally in `lib/paymentFamily.js familyRoot`, which every caller already
  treats as returning null for not-found, so one guard fixed all of them.
- **`announcements/:id/dismiss` 500'd on an unknown id** — a raw FK violation.
  Now `INSERT … SELECT … WHERE EXISTS` + a 404.
- **Six unguarded `getSignedFileUrl` calls 500'd with R2 unconfigured**, while
  `admin-docs.js` already had the right `isConfigured()` guard. The pattern had
  been fixed once and never propagated (same shape as the release bug above).
  Now 503 with a real message at all seven sites.
- **`isValidDay` existed twice and had already drifted** — `reports.js` checked
  date realness, `artist-campaigns.js:68` checked only the regex, so `2026-02-31`
  reached SQL. Extracted to `server/lib/calendarDay.js`; both callers share it.
- **`/manual` Close did nothing in a fresh tab** — `navigate(-1)` with an empty
  history. Falls back to `/`.

### The four cosmetic pages (Priority 3)

- **Privacy + EULA**: the auto-updating `new Date().getFullYear()` dateline is
  gone — a live year silently re-dates a legal document every January and claims
  a review that never happened. Fixed constant instead. `/eula` was titled "Terms
  of Service", agreeing with neither its route nor its name. Dead `prose prose-sm`
  classes removed (the typography plugin is not installed). Both now carry an
  explicit placeholder banner. **The real legal text was deliberately not
  written** — that needs product/legal sign-off, not an agent.
- **Login**: `useOneTap` restored; the degraded Google-failure copy and the
  "Use your work Google account" helper restored; session-expired copy fixed.
  The raw `bg-green-50`/`amber-50`/`red-50` status blocks moved to semantic
  tokens. LG-3 (brand vs neutral submit button) left as an intentional divergence.
- **Legal/NDAs**: `notes` and `status` were in the form state and the server's
  field list but **rendered nowhere** — both were dead on every row created here.
  Both now have inputs, and notes render under the counterparty. Dates moved to
  `formatDate` (see the DATE landmine below). `window.confirm` → `ui/ConfirmDialog`.
- **Manual**: Print / Save-as-PDF restored — a button that expands every section
  first (collapsed sections are not in the DOM, so print CSS alone would emit a
  document of headings) plus an `@media print` block that un-fixes the drawer into
  a full-width document. The remaining manual rows are content ports, logged.

### The UNVERIFIED marks — 52 triaged, 44 resolved

`_audit/pages/*.md` carried 52 `UNVERIFIED — needs runtime check` notes written
when cadence had no runtime. Each now carries a dated verdict in place. **None of
them actually needed R2, AI or SMTP credentials** — the two that mentioned
external services were answerable from the database and from source.

Six of them were **REFUTED**, and are cleared rather than deferred. The largest
was `payments.md` DEF-PAY-01, a standing **P1** claiming EmailPreviewModal is
rendered without its required `open` prop and so "can never send" — all four
render sites pass it; the line numbers were stale. The next largest was the
entire dark-mode raw-tint cluster (~10 rows) claiming cadence has no `.dark`
remap layer: `client/src/index.css:154-320` *is* that layer, covering 14 colour
families. Also refuted: `autoLinkRelease` is called from both bank-matching
artist writes; the Calendar and ArtistProfile modals are `ui/Modal` and do close
on Escape; `payment_terms`/`scheduled_payment_date` and `paid_by`/`paid_marked_at`
are all stamped at create (exercised live); and there is no browser-TZ
`isReleased` in `Catalog.jsx` — released-or-not is decided server-side.

Several were **CONFIRMED** and are now known-real rather than suspected: the
Ledger's 9 hand-rolled overlays genuinely have no Escape handling (the one real
remaining Escape gap); `enter-workspace` is setState-only with no remount, so the
Dashboard/My Work stale-data defect is live; `/dashboard/widgets` measured
0.66–1.53s on 86 expenses; a `w9_filename`-without-key row genuinely exists.

The 8 that remain are labelled with what they would take — 6 need a real browser,
1 needs a split fixture, 1 needs the OLD app running. See `_audit/97-remaining.md`.

### Documentation

The pre-audit **"Built inventory" and "Gap map" sections are gone**. They dated
from 2026-07-27 and had been proven wrong repeatedly — still calling Usage
analytics, `/manual`, the platform Analytics page and the mobile BottomNav
"MISSING" long after each shipped. A gap map corrected by footnote is worse than
none. `_audit/97-remaining.md` is now the single source of truth for open work;
the dated phase entries are the build record. **"Known landmines" was rewritten**
into the full list, ordered by how silent each failure is — the pg DATE-as-JS-Date
trap (3 sightings, confirmed live this phase), the 42P08 reused-placeholder trap
(3 sightings, one silent), NaN-into-Postgres, FK-violation-as-500, `ALTER TYPE
USING` not taking a subquery, `runMigrations` being one promise chain, the
double-release process kill, the TDZ/undefined-import class that builds clean,
alpha-on-`var()`-tokens emitting no CSS, `!important` ties resolving by source
order, `box-shadow` on a `<tr>`, and "when a route swallows errors by design, a
200 proves nothing — verify the row landed".

### Verification

`node server/scripts/finance-fixtures.cjs` → **164/164 PASS**, 0 fail.
`node client/scripts/check-tdz.cjs` → **190 files clean**.
`npm run check:render` → **shell clean for all roles; 84/84 routes rendered**.
`cd client && npm run build` → clean; the new `/NN` token classes confirmed
present in the emitted CSS (that check matters — see the alpha landmine).
`node --check` on all 13 changed server files. All four server sweeps re-run
green after the fixes. Dev server left running on :3001.

### Not done, deliberately

The Ledger's 9 overlays were not migrated to `ui/Modal` — the primitives exist,
but each overlay has its own dismissal semantics and that is a campaign, not a QA
fix. Privacy/EULA legal text was not authored. The Legal page's Approver access
was not tightened — that is a policy call with live users behind it, and silently
removing access is not a QA change. The manual's workflow/keyboard/TOC sections
were not ported (content, not defect). All logged in `_audit/97-remaining.md`.

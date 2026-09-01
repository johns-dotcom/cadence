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
  stale. Mobile BottomNav has **no live unread badge** (the M6 claim above
  overstates; badge exists on the desktop nav item only).

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
  `/api/analytics`. The claim above is false; treat as an open gap.
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
- **Verify before push**: `cd client && npm run build`; `node --check` changed server files.
- **Design tokens**: `client/src/styles/tokens.css` (light+dark CSS vars + full gray
  palette + semantic aliases bg-card/text-ink/border-rule/border-divider/bg-overlay).
  NO `getDarkColors(theme)` JS mirror yet; NO `components/ui/` kit; NO `Skeleton`; NO
  shared `formatDate()`/local-calendar helpers. (spec §2 gaps.)

---

## Built inventory (what works today)

### Foundation / tenancy / platform (spec §3, §5) — strong
- Strict multi-tenancy: `label_id` on every tenant table; `withTenant` →
  `req.labelId`; tenant middleware `requireAdmin`/`requireApprover`/`requirePlatformAdmin`/
  `requirePlatformOwner`.
- Platform operators via `users.is_platform_admin` + `platform_role` (owner|admin).
  "Enter workspace" mints a 2h scoped token; acting-operator banner in `Layout.jsx`
  (tracked in AuthContext state, NOT a JWT claim).
- Platform console pages: Workspaces (list/create/suspend/reactivate/edit-branding/
  delete-with-type-name-confirm), Overview (KPIs), Analytics (cross-tenant, 12-mo),
  Activity (cross-tenant audit), Operators (invite/revoke), Account. `platform.js`.
- Auth: no public signup; workspace owner provisioned + emailed a 7-day invite link.
  Suspended labels block non-operator logins.

### Roles / permissions (spec §4) — partial
- Roles Superadmin/Admin/Approver/User; `requireApprover` = the isBkAdmin gate.
- `user_page_permissions` + `canView(path)` client mirror (`AuthContext.jsx`) + AdminRoute
  guards. `user_visible_reps` rep-visibility on ledger. Impersonation (2h, banner, exit).

### Finance core (spec §7.5, §7.9) — the deepest area
- **Ledger** (`Ledger.jsx`, `ledger.js`): master `expenses` table; list w/ status/
  category/artist/search filters; per-entry drawer (`LedgerEntryDrawer.jsx`) with History /
  Installments / Bulk-items / **AI scan** tabs; rush + AI-flag badges on rows.
- **Splits**: parent/child via `parent_id`; split across artists, unsplit. Children hidden
  from main list.
- **Add Invoice / Add Reimbursement** (`AddLedgerEntry.jsx`, mode-driven, own routes):
  AI parse-invoice pre-fill; reimbursement requires receipt; live duplicate-invoice warning
  via `/ledger/check-dup`.
- **Approvals**: NOT a dedicated page — folded into Ledger status filters + drawer.
- **Payments** (`Payments.jsx`): Due/Paid tabs; per-currency totals; batch mark-paid;
  schedule; **rush** (set/clear/bulk); **installments w/ proof upload**; **payment
  confirmations** (per-row + bulk, sent/unsent tracking). FX-stamps on pay.
- **Vendors** (`Vendors.jsx`): list w/ spend + W9-on-file; detail drawer; **rename /
  merge / aliases CRUD**; **batch "Scan all W9s"**. Exact case-insensitive payee match.
- **Public vendor form** (`VendorSubmit.jsx`, `/submit/:slug`): single-page (not 3-step
  wizard); W9-on-file skip; invoice/receipt/W9 gates; AI autofill; per-IP rate limit;
  duplicate check; creates pending expense + R2.
- **Create Invoice (outbound)** (`CreateInvoice.jsx`): label-branded, auto-number, line
  items, currency, remittance block (from `labels.invoice_settings`), PO#, print-to-PDF,
  saved list w/ Table/Cards toggle.
- **Libs**: `claude.js` (parse/scan/W9/marketing, structured JSON schema; NO rate-limit
  buckets), `aiScan.js` (persisted invoice+W9 discrepancy scans), `fx.js` + `fxStamp.js`
  (locked `fx_rate_to_usd`, startup backfill), `normalizeInvoiceNum.js`, `spotify.js`,
  `zip.js`, `email.js` (Resend→SendGrid→SMTP; templates: invite, vendorDecision,
  paymentConfirmation, taskAssignment).

### Label ops (spec §7.1–7.4) — mixed
- **Global search** (`GlobalSearch.jsx`) — DONE (⌘K, min-2, grouped releases/artists/
  contracts/deals).
- **Calendar** — DONE (month grid, 6 event types, per-type filters, manual CRUD; no hotkeys).
- **Deal pipeline** (`Deals.jsx`) — kanban stages + advance button + card detail (button
  advance, not true drag-drop; no mobile snap-scroll).
- **Artist profile** (`ArtistProfile.jsx`) — devlog, Spotify stats, releases tab, links,
  files, archive (no contracts tab; devlog not color-coded).
- **Releases** (`Releases.jsx`, `ReleaseDetail.jsx`, `DspTracker.jsx`, `ReleaseExtras.jsx`)
  — list; add-release; 14-item checklist w/ %; expanded tabs Metadata/DSP(9)/Budget/
  Comments/Details (no Checklist-as-tab grouping Content/Distribution/Pitching, no
  Activity tab, no merge flow, no assignment, no hotkeys, no calendar view).
- **Contracts / Pending / Renewals** — DONE as trackers (no AI clause gen, no Create-contract).
- **NDAs / Legal / Label waivers / Artist clearances** — CRUD + trackers exist; waiver has
  live-preview + print (no template variants, no Word .docx, no jsPDF selectable-text).
- **Duplicates** (`Duplicates.jsx`) — release/artist/vendor merge (no invoice-dupe tiers,
  no ledger artist-flags, no dismissal audit/restore, no normalization bulk-apply).
- **Salary** — DONE (separate roster, per-month toggles + history, admin-gated).

### Cross-cutting (spec §9) — partial
- Notifications: computed bell (`notifications.js`, `NotificationBell.jsx`, polled); NO
  persisted @mentions.
- Audit: `activity_log` + `logActivity`; NO separate `bk_audit_log`. `ledger_history`
  gives per-field entry history.
- Security: helmet (CSP off for SSO), sanitize middleware, auth + general rate limiters.
  Hardening (2026 audit): user files served via `lib/safeFiles.js sendFileSafely`
  (inline only for an image/PDF allowlist, else octet-stream + attachment +
  `nosniff` — kills same-origin SVG/HTML XSS) on chat attachments + `/uploads/:filename`;
  platform member/owner routes gated by `requireWorkspaceAccess` (admin-tier
  operators confined to their `operator_workspace_access` allowlist, matching
  `/enter`); email link builders (invite/mention) no longer fall back to the raw
  Host header (`FRONTEND_URL || req.headers.origin` only). IDOR sweep of all
  ~40 route files found tenant scoping clean. Set `FRONTEND_URL` in prod.
  Second pass: chat attachments now served via **file-scoped expiring signed
  URLs** (`lib/mediaToken.js`, `?exp=&sig=` HMAC over the attachment id) instead
  of the session JWT — the public `/chat/attachments/:id` route sits above the
  auth gate and the sig is the capability (minted only into messages a member
  can see; url added per-attachment in `signAttachments`). Vendor form is now
  **token-only** (`labelBySlug` + `/submit/:token` OG route drop the enumerable
  slug; client links use `vendor_form_token` only). Upload **concurrency guard**
  in index.js caps concurrent multipart requests (`MAX_CONCURRENT_UPLOADS`, def 8)
  to bound multer memoryStorage RAM. (Socket auth already uses the handshake
  `auth` payload, not a URL query, so it wasn't log-exposed.)
  Third pass (residual): dropped the vulnerable `xlsx` package — `/ledger/bulk-zip`
  now parses uploaded spreadsheets with `exceljs` (+ 20k-row cap) so a crafted
  `.xlsx` can't hit SheetJS's prototype-pollution/ReDoS CVEs; removed `?token=`
  query-param session auth entirely (Authorization header only — files use
  signed URLs, socket uses handshake auth); @mention emails throttled per
  recipient (5-min window, in-memory) to stop email-bombing; **CSP enabled** via
  helmet — REPORT-ONLY by default (script-src has no `unsafe-inline`), flip
  `CSP_ENFORCE=true` after confirming the browser console is clean. Still to
  verify OUTSIDE code: R2 bucket must deny public read (rely on signed URLs);
  tighten prod CORS from `origin:true`. Known trade-offs left: no maker-checker
  on approvals (an Approver can self-approve); AI-parsed fields are human-gated
  but not visually flagged; login 409 reveals an email's workspaces.
- Keyboard: global help modal (`?`) + a handful of `g`-nav shortcuts in Layout; NO
  reusable `useHotkeys`, NO per-page hotkeys.

---

## Gap map (mapped to spec §§, ordered by the spec's build milestones)

### Milestone 1 — Foundation gaps (§2, §4, §5)
- **UI kit** `components/ui/` (Button/Card/Input/Select/Textarea/Badge/BottomSheet) — MISSING.
- **Skeleton** loaders (PageHeader/StatCards/Table/Card/Block/KanbanBoard) — MISSING.
- **Date helpers** `formatDate` + local-calendar (`localDateStr/dateOnly/isPastLocal/
  daysUntilLocal`) + `getDarkColors(theme)` JS mirror — MISSING.
- **Permission templates** (`permission_templates` table, presets, apply/save/copy-from-user)
  — MISSING. Parent-grant-covers-subpage in `canView` — not modeled.
- **Test users + mock axios adapter + `testUserGuard`** — MISSING (is_test-ish only).
- **Delete guards**: last-Superadmin protection, only-Superadmin-deletes-Admins, dynamic
  information_schema FK sweep — MISSING.
- **labels.vendor_form_token** (unguessable public token + rotation) — MISSING (uses slug);
  labels also lack `plan`, `settings` JSONB (has `invoice_settings`).
- Dev-mode label-scoping assertion middleware — MISSING.

### Milestone 2 — Finance core gaps (§7.5, §7.9, §8)
- **Ledger**: frozen sticky columns; ~28 persisted toggleable columns; true inline cell
  edit (socials popover, inline file cells); 20-deep undo stack w/ toast-undo; amount-range
  filter `500|500-1000|>500` + QB/recoup/method/flag/bulk/source filters + sorts;
  per-currency totals footer; auto-split on comma songs, carve-off-reimbursement,
  children-own-toggles; `?focus=<id>` deep link + spotlight; hotkeys z/c/x. — MOSTLY MISSING.
- **Dedicated Approvals page** (cards, j/k/a/r, edit-in-place re-runs scans, dismiss-per-
  discrepancy, split-before-approve, notify-vendor preview, bulk approve email queue,
  audit drawer, `bk_audit_log`) — MISSING (currently ledger filters).
- **Payments**: quick filters (Due Soon/Overdue/Rush/Hold/Paid); 5 USD-equiv stat cards;
  family-aware amount sort; calendar view; Send-for-Approval (Excel+PDF email); proof→AI→
  auto-mark-paid; split-family payment cascade; rush/hold mutex (no `on_hold` yet);
  per-vendor confirmation wizard + CC-rep toggle + EmailPreviewModal. — PARTIAL.
- **Vendors**: `vendor_emails` saved-emails (multi/labeled/auto-CC/carried on rename/merge);
  canonical-W9 `w9_entry_id||id` rule; Added-expense-vendors subpage; name-mismatch batch
  surfaced in list. — PARTIAL/MISSING.
- **Public vendor form**: 3-step wizard; up to 4 extra emails; server+client invoice-number
  gate; artist-row splits + live rep list + socials; draft autosave/resume; similar-amount
  warning; served OG tags. — PARTIAL.
- **Email dispatch layer** `emailDispatch.prepareEmail(kind,ctx)` (9 kinds) + **EmailPreviewModal**
  (editable To/CC chip input, attachments, queue mode) + per-label Gmail OAuth — MISSING.

### Milestone 3 — Finance depth (§7.5 depth, §7.6, §7.7)
- **Recoupments** to spec: UFR toggle + `statementMonthFor()` stamping (cutoff day 20),
  statement tabs, priority H/M/L tag+subtabs, ready-for-planning markers, prior-year subpage,
  socials editor w/ running total, notes, add-expense flow. Needs `ufr/ufr_marked_at/
  entry_source/prior_year_tag/social_handles/recoupment_label` columns. — MOSTLY MISSING.
- **Recoupment Planning** page — MISSING.
- **Artist Campaigns** page + `/artist-campaigns` (index cards, per-artist detail, cobrand
  rollups, review inbox, per-page chat rooms, reviewers). Needs `review_assignments,
  expense_comments, campaign_chat_messages, campaign_chat_reads, user_mentions,
  song_campaign_status`, `cobrand`, `artist_breakdown` cols. — MISSING (only basic Campaigns).
- **Bulk Deals**: add quantity/unit/socials/stalled-detection/completed section. — PARTIAL.
- **Financials** depth: artist/month P&L, KPI deltas, multi-chart, pivots, drill-through,
  CSV/Excel. — PARTIAL (basic summary only).
- **Recording Budgets** (draft→approved→locked lifecycle, sections, costs-to-date) — MISSING.
- **Invoices index** — DONE at `/invoice-search` (Phase 3 bk-invoices port,
  2026-08-31). **Expense Lookup**, **Archive**, **Bulk Upload**, **Bulk Re-upload**,
  **QB Import**, **Ledger matching**, **Master-sheet import UI** — MISSING (master-sheet
  import API exists, no UI).

### Milestone 4 — Label ops depth (§7.1–7.4)
- **Dashboard** widgets: latest-releases carousel, pipeline bar chart, genre pie, upcoming
  timeline, notifications panel, my-tasks summary, pending-approvals card, bookkeeping widget.
  — MISSING (basic stat cards + activity only).
- **My Work** command center — DONE and beyond spec (see "Post-spec: task database
  views + Team Work" above). Not carried over from the spec: quick-add shorthand
  parsing (`!high` / `#Finance` / natural dates), pins (superseded by drag-to-top),
  and assigned-releases/contracts rails.
- **Catalog** page — MISSING.
- **Releases**: 7-tab (add Activity + Checklist grouping), merge flow, assignment, hotkeys,
  mobile tab strip. Deal pipeline true drag-drop. Artist roster search/filter + delete gate.
  Contracts AI clause gen + Create-contract + NDA template variants + Word export. — PARTIAL.
- **User manual** `/manual` — MISSING.

### Milestone 5 — Collaboration & polish (§7.6, §9, §10)
- Campaign chat / review inbox / @mentions (persisted `user_mentions`, per-item mark-read).
- **Usage analytics**: `page_views` table + Layout route-ping + in-workspace Analytics page
  (range picker, stat cards, daily chart, most-used pages, active users). — MISSING.
- **Internal requests** feature (§9.9) — MISSING.
- **Mobile kit** (§10): `useIsMobile`, `BottomSheet`, `FilterSheet`, `FAB`, permission-
  filtered BottomNav (<640px, safe-area), edge-swipe sidebar, Ledger+Payments card lists
  <768px, 36px touch targets, `viewport-fit=cover`. — MOSTLY MISSING.
- `useHotkeys` + per-page hotkeys; AI rate-limit buckets; MIME sniff on upload; ≈USD suffixes.

---

## Standing invariants already honored (keep honoring)
- Every query scoped by `label_id`; client FKs re-validated against the label.
- `useEffect(() => { load() }, [])` — never `useEffect(load, [])` (Promise-as-cleanup crash).
- Integrations degrade gracefully with no API keys.
- New `expenses` column → add to the list-endpoint column set + PATCH allow-list.

## Known landmines (from prior bugs)
- Deployed-bundle sourcemaps + ErrorBoundary are how minified crashes get diagnosed.
- SMTP host typos surface via the Team-invite error banner.
- Migration ordering: a FK ALTER must come AFTER its referenced table's CREATE.

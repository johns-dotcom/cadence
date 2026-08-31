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

- **M5 "Usage analytics" was never built** — no `page_views`, no `/usage`, no
  `/api/analytics`. The claim above is false; treat as an open gap.
- **M3 "Invoice Search"**: `/invoices` is the outbound invoice CREATOR; no
  search surface exists.
- **M3 "Archive"**: `GET /ledger/archive` exists server-side with NO client UI.
- **M3 "Bulk Upload"** = the ledger CSV import, not an AI invoice+proof batch
  flow.
- "Scoped out: Ledger matching" under-claimed — a tiered learning bank↔ledger
  matcher lives in `lib/bankReconcile.js` and is now the heart of Bank Matching.

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
- **Invoices index**, **Expense Lookup**, **Archive**, **Bulk Upload**, **Bulk Re-upload**,
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

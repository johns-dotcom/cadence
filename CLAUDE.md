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
`NotificationBell` refreshes on it (no waiting for the 2-min poll); client
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
Follow-ups (not built): external-guest channels, huddles, Slack import, search.

**Nothing spec-level remains.** Optional polish only: the `/manual` page, deeper
mobile "lighter passes" on secondary pages, AI rate-limit buckets, MIME sniff on
upload. New deps: `jspdf` + `docx` (dynamically imported), `socket.io`(-client).

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
- **My Work** command center: "Waiting on you" rail, To Do Today ordering, quick-add
  shorthand parse, bucket grouping, pins, assigned releases/contracts, hotkeys. — PARTIAL.
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

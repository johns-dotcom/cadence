# Cadence — Complete Build Specification

Instructions for Claude. This is the authoritative feature spec for building Cadence, a
multi-tenant SaaS productization of the Boom Records dashboard. It enumerates **every
feature of the reference app**, adapted for workspace isolation. Work top-down through
the milestones (§13), but treat the feature sections as the contract: a milestone isn't
done until its features match this document.

**How to use this document**
- Reference app: `/Users/johnskead/Desktop/DevProjects/Dashboard/boom-dashboard` — when
  a feature's behavior is ambiguous here, read the reference implementation and match it.
- Every feature below is REQUIRED unless marked *(later)*. "Lighter than reference" is a
  bug, not a scoping decision, once its milestone is reached.
- After every change: build the client, `node --check` changed server files, and exercise
  the affected page. There is no test runner; manual verification is the standard.

---

## 1. Product definition

Cadence is **label operations as a product**: a white-labelable command center where each
record label gets a private workspace for artists, releases, contracts, marketing, and —
most heavily — bookkeeping and vendor payments.

Two surfaces:
1. **Label workspace** — what a label's team logs into. Branded per label (logo, accent
   color, own vendor-submission link). All pages in §7.
2. **Platform console** — a neutral operator shell (Workspaces / Overview / Analytics /
   Operators) where platform admins provision and monitor tenants and can enter any
   workspace as themselves. §5.

Non-negotiables:
- **Strict multi-tenancy.** Every tenant-owned table carries `label_id`. Every query is
  scoped. JWTs re-validate role + workspace on each request. Cross-tenant reads are a
  security incident, not a bug.
- **Integration-light.** Claude, Spotify, and FX are fetch-based libraries that degrade
  gracefully when keys are missing. A deploy with zero API keys must boot and work.
- **Finance-first.** The bookkeeping suite is the core product; when trading off polish,
  the money pages win.

## 2. Stack & conventions

- **Backend**: Node/Express 4, PostgreSQL via `pg` (raw parameterized SQL, `$n` — no ORM),
  JWT auth (8h expiry, `token_version` invalidation), bcryptjs (NOT bcrypt — fails on
  Railway), multer `^1.4.4-lts.1`, jsonwebtoken `^9.0.x`.
- **Frontend**: React 18 + Vite 5, plain JS (no TypeScript), React Router v6, Tailwind v3
  (postcss `tailwindcss: {}` — never `@tailwindcss/postcss`), Recharts, Lucide, Axios
  with JWT interceptor + 401 auto-redirect.
- **Files**: Cloudflare R2 (S3-compatible). DB stores object keys only
  (`invoice_r2_key`, `w9_r2_key`, `proof_r2_key`); key shape
  `labels/{label_id}/vendors/{entryId}/{type}/{timestamp}_{sanitized}`. A shared lib
  exports `uploadFile / getSignedFileUrl / loadFileBase64(r2Key, legacyFallback) /
  deleteFile`; readers always pass both sources.
- **Deploy**: Railway (Nixpacks), monorepo `client/` + `server/`, push-to-main deploys,
  Express serves `client/dist` in production.
- **Schema management**: all tables created in `server/index.js` at boot via
  `CREATE TABLE IF NOT EXISTS` plus separate `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  migration lines. No migration framework.
- **Design system**: CSS variables in `styles/tokens.css` for light+dark; Tailwind maps
  semantic aliases (`bg-card`, `text-ink`, `border-rule`, `border-divider`, `bg-overlay`)
  and the whole `gray` palette through the vars, so `text-gray-*` etc. are theme-aware
  natively. Dense finance tables may use inline styles fed by a `getDarkColors(theme)`
  JS mirror — call it INSIDE components (module-level calls freeze the theme). Keep the
  CSS vars and the JS mirror in sync.
- **Loading states**: a shared `Skeleton` component (PageHeader / StatCards / Table /
  Card / Block / KanbanBoard) — never bare spinners.
- **UI kit**: `components/ui/` — Button, Card, Input, Select, Textarea, Badge,
  BottomSheet (mobile drawer). Prefer these in new code.
- **Dates**: a shared `formatDate()`; all overdue/due-today math uses LOCAL-calendar
  helpers (`localDateStr / dateOnly / isPastLocal / daysUntilLocal`) — never
  `new Date('YYYY-MM-DD') < new Date()` (UTC-midnight makes "due today" read overdue).
- **Brand theming per label**: accent color + logo stored on the label row; CSS var
  `--brand` drives buttons/links; vendor form and outbound invoices render the label's
  branding.

## 3. Multi-tenancy architecture

- `labels` table: id, name, slug (subdomain/url key), logo_url, accent_color, plan,
  status (active/suspended), vendor_form_token (unguessable slug for the public form),
  settings JSONB, created_at.
- **Every tenant table** carries `label_id INT NOT NULL REFERENCES labels(id)` with an
  index. This includes users, artists, releases, expenses, contracts, deals, tasks,
  vendors' aliases/emails, chat, audit logs — everything in §6.
- **Scoping enforcement**: a `withLabel(req)` helper returns the validated `label_id`
  from the JWT; every route's SQL includes `label_id = $n`. Add a dev-mode assertion
  middleware that greps outgoing queries for missing label scoping on tenant tables
  *(cheap heuristic, catches regressions)*.
- **JWT claims**: `{ user_id, label_id, role, platform_role?, tv }`. Auth middleware
  re-reads the user row per request: token_version match, user active, label active.
- **Platform operators** carry `platform_role` (`owner` | `admin`) in a separate
  `platform_operators` table; they can mint a scoped workspace token ("enter workspace")
  that carries their identity + the target label_id + an `acting_operator` flag shown in
  the workspace UI banner.
- **Public endpoints** are label-resolved by token/slug, never by numeric id:
  `/submit/:vendorFormToken`, `/health`, `/privacy`, `/eula`, login, Google SSO.
- **Uniqueness is per-label**: vendor alias uniqueness, invoice-number dedupe, artist
  normalization etc. all key on `(label_id, ...)`.

## 4. Roles & permissions (inside a workspace)

- Roles: **Superadmin** (full workspace), **Admin** (most), **Approver** (bookkeeping
  admin — full Approvals/Payments/etc., not admin elsewhere), **User** (allow-list of
  pages). One `isBkAdmin` gate = Admin|Superadmin|Approver, used by all bookkeeping
  admin actions.
- **Page permissions**: `user_page_permissions (label_id, user_id, page)`; NULL rows =
  unrestricted for Admin/Superadmin, default-closed for Users; Approvers fall back to
  the bookkeeping surface (`/bk/*`, `/recoupments*`, `/artist-campaigns`) when no rows
  are configured. `canView(path)` mirrors this on the client and drives nav + route
  guards; parent grants cover carved-out subpages (e.g. `/recoupments` covers
  `/recoupments/planning`).
- **Permission templates**: admin-built named page-sets (`permission_templates`,
  upsert by case-insensitive name, per label) + hardcoded starter presets (Marketing,
  Bookkeeping/AP, A&R, Finance exec, Legal, Full access). Apply menu, save-current-as-
  template button, chip manager with delete. "Copy from user" clones another user's set.
- **Rep visibility**: per-user allow-list of reps (`user_visible_reps`) — Users see only
  their own rep's rows + granted extras on Approvals/Payments.
- **Impersonation**: workspace admins can impersonate a user (original token stashed,
  banner + exit). Platform operators "enter workspace" similarly.
- **Test users**: `users.is_test` — a client mock adapter (axios adapter) serves canned
  data for every endpoint (shape-parity with the real API is a standing rule; drift
  causes white pages), and a server `testUserGuard` inside auth middleware 403s all
  API calls except auth self-service. Superadmins create test users from Settings.
- **Guards**: last-Superadmin cannot be deleted; only Superadmin deletes Admins; user
  deletion clears FK references via a **dynamic information_schema FK sweep** (SET NULL
  nullable / DELETE NOT NULL, in a transaction) — never a hand-enumerated list.

## 5. Platform console

Operator-only shell, visually neutral (not label-branded):
- **Workspaces**: list all labels (name, plan, status, user count, last activity,
  storage/rows), create workspace (name, slug, first Superadmin invite), suspend/
  reactivate, edit branding, rotate vendor_form_token, delete (guarded, types-name-to-
  confirm).
- **Overview**: platform KPIs — tenants, total users, invoices processed 30d, AI calls,
  storage, error-rate summary.
- **Analytics**: cross-tenant usage (page views, active users per label) — same engine
  as the in-workspace analytics (§9.8) aggregated per label.
- **Operators**: manage platform operators (invite, role owner/admin, disable).
- **Enter workspace**: one click drops the operator into that label's dashboard as
  themselves (acting_operator banner, full Superadmin capability, logged).

## 6. Data model overview (tenant tables — all with `label_id`)

users, user_page_permissions, user_login_logs, user_visible_reps, permission_templates,
artists (+ artist_links, artist_devlog, artist_normalization, artist_meta),
releases (+ release_comments, release_budgets, release_budget_line_items, dsp_status),
contracts, pending_contracts, deals, tasks, calendar_events, activity_log,
expenses (the master ledger, 40+ cols), entity_files, bk_audit_log, vendor_aliases,
vendor_emails, boom_reps→`label_reps`, invoices_outbound, salary_employees,
salary_payments (+history), recording_budgets (+items), influencer_campaigns
(+creators), manual_expenses, artist_income, bulk_deal_items, review_assignments,
expense_comments, campaign_chat_messages, campaign_chat_reads, user_mentions,
song_campaign_status, flag_dismissals, flag_group_dismissals, page_views,
label_waivers, artist_clearances, ndas.

Key `expenses` columns to carry over: payee, artist, song, description, category,
amount, currency, fx_rate_to_usd (locked at payment), invoice_date, invoice_number,
payment_status/method/terms/date/ref, paid_by, paid_marked_at, scheduled_payment_date,
status (pending/approved/rejected), approved_by/at, vendor_submitted, vendor_name/
email/address/bank, in_quickbooks, uploaded_to_stem, recoupable, ufr, ufr_marked_at,
artist_campaign, cobrand, is_bulk_deal (+quantity/unit/completed), is_reimbursement,
artist_breakdown JSONB, parent_id (splits), no_auto_split, social_handles JSONB,
notes, boom_rep→label_rep, release_id, flagged/flag_reason/flagged_by/at,
rush_requested (+at/by/reason), on_hold (+at/by/reason), voided (+at/by),
deleted (+deleted_by/deleted_at), confirmation_sent, is_2025_expense→`prior_year_tag`,
entry_source, file keys + filenames + ai_scan/w9_scan JSONB, receipt fields,
recoupment_label, created_at.

**The light-columns rule**: every list endpoint selects an explicit column list that
includes everything EXCEPT the base64 legacy blobs. When a column is added to
`expenses`, it must be added to that constant or it silently vanishes from lists.

## 7. Label workspace — feature spec by page

### 7.1 General
**Dashboard** — stat cards (artists, releases, upcoming, team); latest-releases
carousel (14d, artwork, DSP links); release pipeline bar chart (monthly, year/genre/
format filters, prior-year overlay); genre pie; upcoming timeline (this week/next);
notifications panel (severity-colored, clear-all); my-tasks summary (open/overdue/due
today — local-calendar math); pending-approvals card (bk admins); bookkeeping summary
widget (logged MTD, pending QB, awaiting approval, paid MTD %, recent invoices).

**My Work** — command center. Two-column: main + "Waiting on you" rail (review
assignments, unread @mentions, approvals queue count, statement-cutoff countdown,
stalled bulk deals) — rail renders as a horizontal tile strip ABOVE tasks on mobile.
To Do Today: overdue (days-late stamps) → due today → in progress; snooze / start /
reschedule-all-overdue banner; "plan your day" suggestions with +Today. Quick-add
parses shorthand: `!high` priority, `#Finance` category, natural dates ("tomorrow",
"friday") with live preview. Task list with bucket grouping (category/due/priority),
priority stripes, pins, sort; Done-this-week digest. Releases + contracts assigned to
me. Hotkeys.

**Global search** (`/` or ⌘K) — releases (name/artist/UPC/ISRC), artists, deals,
contracts (permission-gated), min 2 chars, grouped results.

**Calendar** — month grid; event types: release, contract expiry, contract signed,
task, DSP live, DSP submitted, manual events (colored, CRUD); per-type filter toggles;
day popup; hotkeys (←/→, t, n).

**User manual** (`/manual`) — self-documenting: per-page intro + task bullets filtered
by the viewer's LIVE permissions (refetched on focus/storage signal), keyboard-shortcut
groups, cross-page workflow walkthroughs, per-user override blocks, print. Update it
with every feature.

### 7.2 Artists & A&R
**Artist roster** — searchable/filterable grid, genre + signing status, click-through.
Artist deletion superadmin-only with FK sweep; releases block deletion with 409.
**Artist profile** — devlog timeline (meetings/demos/offers/calls/notes, color-coded),
Spotify tab (popularity, followers, monthly listeners, top track — via Spotify lib),
releases tab, contracts tab, links tab (socials/platforms), files panel, archive.
**Deal pipeline** — kanban (Scouting → In talks → Signed/Passed), drag-drop, "n" new
deal, card detail (notes/contacts/links). Mobile: snap-scroll columns.

### 7.3 Releases & catalog
**Release Tracker** — list + calendar views; add-release modal (artist autocomplete,
creates unknown artists); merge flow for duplicates; notification banner; assignment;
14-item checklist grouped Content (YT Video, Content, Marketing Plan, Official Thread) /
Distribution (Uploaded, Recoup Added, Budget) / Pitching (Stem, S4A, Amazon, Pandora,
Marquee, DSP Email, Musixmatch) with completion %; 7-tab expanded row: Checklist,
Metadata (type/date/genre/priority/producer/features/UPC/ISRC/links/presave), DSP
(9 DSPs × status/submitted/live/notes), Budget (per-release line items by category,
auto-capturing linked ledger spend), Activity, Comments, Details (status/archive/
delete). Functional-update checklist toggles (rapid clicks safe) + single delete
confirm. Hotkeys j/k/Enter/1–7/v/n. Mobile: scrollable tab strip.
**Catalog** — released grid grouped by year, artwork, type badges, UPC/ISRC, search +
genre/type/artist/date-preset filters, batch Spotify artwork sync with progress,
archived toggle + unarchive, move-back-to-pipeline, load-more.
**Duplicates & data quality** (`/duplicates`) — release dupes (name/UPC/ISRC/URI) with
merge; artist dupes (normalized + Levenshtein) with merge; vendor dupes; invoice dupes
(4 severity tiers); release issues (missing genre/UPC/ISRC/links); ledger artist flags
(unknown, typo, casing variants, multi-name, missing artist for required categories,
artist↔song mismatch, missing song, missing socials); per-flag + per-group dismissals
with audit + restore; artist-normalization apply (bulk rename across expenses/deals/
income inside a transaction — no swallowed errors — remembered for future auto-collapse).

### 7.4 Contracts & legal
**Contracts** — list with artist/advance/split/expiration, PDF attachments, AI clause
generation; **Pending contracts** — negotiation tracker, counter-signed upload flips to
Active; **Renewals** — expiring soon, urgency colors; **Create contract** — AI-assisted
drafting, inline clause edit, save-as-pending.
**NDAs** (`/create-nda/:template`) — template variants (standard, mutual, corporate-
recipient…) each with field sets, optional-clause toggles derived from the SAVED BODY,
editable body with mandatory-section validation, live preview, saved list; export as
**PDF (jsPDF)** and **Word (.docx via `docx`, dynamically imported)** with identical
formatting + filename convention.
**Label waivers** + **artist clearances** — CRUD record keeping. **Legal** page — the
vault (waivers/clearances/templates).

### 7.5 Bookkeeping (the core)
**Ledger** — master expense table. Frozen columns (Flag/Date/Payee/Artist/Amount/
Currency) rendered inside ONE sticky `<td>` with internal flex (separate sticky cells
gap — do not restructure); ~28 toggleable columns persisted per user; inline edit on
nearly everything (artist/song autocomplete datalists, selects, socials editor popover,
file cells for invoice/W9/proof/receipt with view/replace/remove); paid badge cycles
Unpaid→Paid→Partial in ONE PUT (multi-PUT races the split cascade); 20-deep undo stack
where the toast Undo reverts ITS OWN edit record; filters (search, amount query
`500 | 500-1000 | >500`, QB, recoup, category, artist, paid, method, flag, bulk,
source) + sorts; per-currency totals footer; splits: split across artists/songs with
custom amounts (children inherit campaign/recoup/payment fields, parent keeps own
slice), auto-split on comma-separated songs, carve-off-reimbursement (fee/reimb),
unsplit, split children carry their OWN toggle set; void (excluded from money reports/
1099s/exports); soft-delete with `deleted_by/at` cascading to children; deep links
`?focus=<id>` scroll + amber spotlight; links into Recoupment Planning; admin exports
(Excel/CSV/1099); hotkeys z/c/x. **Mobile: card list + entry bottom-sheet** (paid
cycle, flag, notes edit, file view), filter drawer, load-more, focus-on-card.

**Approvals** — pending vendor submissions as cards; j/k/a/r/Shift+A; edit-in-place
(full field set incl. socials with per-artist tags) that RE-RUNS AI scans on
discrepancy-relevant changes; AI invoice scan + W9 scan discrepancy banners with
dismiss-per-discrepancy + re-scan + "Run scan" for never-scanned; name-mismatch
warnings; flag-for-review; rush toggle; artist-breakdown split-before-approve; alias
panel (add/link to existing vendor); notify-vendor toggle → templated approval/
rejection email with preview; bulk approve with per-vendor email queue; reject with
required reason; recent-activity audit drawer; archive link. Approving lands the row
on the ledger; approval/rejection recorded in bk_audit_log.

**Payment Dashboard** — server-scoped to unpaid + paid-last-14-days (`?scope=all`
escape hatch; export intentionally unscoped). Quick filters All/Unpaid/Due Soon/
Overdue/Rush/Hold/Paid (held rows leave Due Soon/Overdue); 5 stat cards with
USD-equivalent headlines honoring locked fx rates; family-aware amount sort (b−a
descending, dir=+1 for high-to-low); calendar view; row selection (membership-checked
select-all — paid rows are selectable for confirmations) → batch mark-paid modal
(date/method/ref/proof), bulk rush/hold with reasons, **Send for Approval** (Excel
summary + invoice PDFs emailed to named approvers, editable preview, family-expanded
totals); proof upload (tap or drag) → AI extracts date/ref → auto-marks Paid (+ grace
period keeps rush rows visible); split-family payment cascade (any row's payment flip
writes the whole family transactionally); installments (per-family partial payments
with own proofs, remaining balance); rush/hold mutex; inline artist/rep/method edits
with undo toasts; **payment confirmations**: per-row and bulk per-vendor wizard
(EmailPreviewModal queue), CC-the-rep toggle (default OFF), vendor saved emails
auto-CC'd; confirmation_sent tracked per family. **Mobile: cards + payment sheet +
sticky bulk bar** (shared modal tail hoisted so both branches reuse the same flows).

**Vendors** — per-vendor URL pages; list w/ W9 filter, name-mismatch scan (AI batch),
spend totals; detail: stats (total/paid/outstanding), invoice history with expandable
split groups, W9 badge + drop-or-tap upload/replace (canonical W9 = highest-id row;
**cross-entry rule**: every consumer resolves `w9_entry_id || id`), rename (carries
aliases/emails), merge (renames + auto-alias), aliases CRUD, **saved emails** (multi,
labeled, alias-aware canonical storage, auto-CC on confirmations, carried through
rename/merge), ZIP download (invoices+W9+ledger). **Added-expense vendors** subpage —
invoice-less spend per vendor with Watch/High bands, same-amount±7d dupe pairs, name
variants. Vendor detail matches payee with exact case-insensitive equality (never raw
ILIKE — `%`/`_` in names are wildcards).

**Invoices** (documents index) — search by normalized invoice number (strips #/INV-/
leading zeros), vendor, artist; submissions-per-week chart with range presets; inline
preview; rejected-invoices collapsible section. **Expense Lookup** — artist+song
primary search, expanded filters, per-type file chips, CSV/Excel export, per-type ZIP
downloads. **Archive** — rejected + deleted invoices with who/when attribution (from
audit log + `deleted_by/at`), file chips, restore; admin-only.

**Add Invoice / Add Reimbursement** — manual entry; AI parse pre-fill from the PDF;
invoice+proof in one flow; Net-30 default terms (ALL creation paths); reimbursements
require receipt; upload zones stack on mobile. **Bulk Upload** — multi-PDF drop zones,
sequential AI parse, auto-match proofs to invoices by payee+amount, review table with
manual re-match, batch create. **Bulk Re-upload** — repair page for broken blobs.
**Create Invoice** (outbound) — label-branded invoice generator: auto-incremented
number, bill-to, line items (⌘⇧L), currency, label's remittance details, PO#, jsPDF
export, CRUD list. **QB Import** — QuickBooks CSV ingest with column mapping,
invoice#+email dupe detection, straight-to-approved. **Ledger matching** — reconcile
against an external bookkeeper export: vendor-name fuzzy tiers (exact/parenthetical/
suffix/substring/reorder + Jaccard), mismatch categories (amount/paid status/paid
date/missing either side/no invoice #), per-category export.

**Master-sheet import** *(if the label uses one)* — header-row detection with
fixed-map fallback, date-shaped-artist guard, diff preview before writes.

### 7.6 Recoupments & campaigns
**Recoupments** — recoupable rows grouped artist→song/category; UFR toggle per item
(+ statement stamping: cutoff day 20, day ≥21 rolls to next month — ONE shared
`statementMonthFor()` implementation); statement tabs (Pending / Uploaded / Total /
per-month slices); priority H/M/L as a TAG with subtabs (never a sort key — pending
amount stays the sort); ready-for-planning markers (artist + release level, filter,
folder icon); prior-year tag → dedicated subpage with artist key cards + summary +
unmark; add-expense (auto-approved, auto-paid, auto-recoupable, entry_source stamped);
paid toggle on added expenses; socials editor with running $ total vs invoice; page +
per-artist notes; pending-upload default sort; delete added expenses (cascades
app-wide); ledger deep links.

**Recoupment Planning** (first-class page) — staged batch: add items from Recoupments/
Ledger; group by song or label(bucket) with renameable group labels (cancel must not
wipe them); select-all per song/category; selection bar with per-currency + ≈USD
totals; mass-UFR commit; save-for-later deferred artists (excluded from commit);
flags + notes on cards; paid/unpaid pills; focus deep links. Sticky selection bar
clears the mobile nav.

**Artist Campaigns** — campaign spend hub. Index: artist cards (priority tag, spend
totals, flags rollup, ready-for-planning) sorted priority→amount; every ledger row
with campaign=Yes MUST appear (visibility parity is a standing invariant); not-
campaign rows hidden from non-admins, artists with only not-campaign expenses get no
card. Detail (artist → song): stat strip, cobrand rollups INCLUDING split children,
category breakdown bars (include children — they carry their own slices), campaign
links (marketing campaigns), entries tables w/ instant-tooltip icon strips: view/
attach invoice on added expenses, cobrand toggle, bulk-deal toggle, edit artist/song/
category, cross-artist split modal (per-row artist), not-campaign (family cascade),
mark paid, ledger link, flag + **assign reviewers** (multi-user, replace-set,
surfaces in assignees' My Work rail); select-all + bulk-apply bar (cobrand/uncobrand/
bulk/paid/unpaid); "Needs review" inbox (artist→song→item stacks + comment threads);
**per-page chat rooms** (index, artist, song — unique rooms) as slide-over: 8s poll,
@mention autocomplete → bell notifications, edit/delete own messages (soft delete),
unread watermarks, moderators; inline comment threads under notes (separate rooms);
song notes (draft survives refetch mid-typing, saves on blur, updated-by attribution);
finished/ready-for-planning per release; socials editor with family-artist tagging
(union of family + row + existing tags); Excel export. Enter-key comment posts have
an in-flight guard (no double posts).

**Bulk Deals** — expenses with is_bulk_deal; deliverables checklist per deal
(bulk_deal_items) with completion; quantity/unit; socials section (creator handles +
per-deliverable amounts); stalled-deal detection surfacing in notifications; completed
section (archive); artist splits via the same breakdown pattern.

### 7.7 Finance & analytics
**Financials** — P&L by artist/month attributed on `COALESCE(payment_date,
invoice_date)`; KPI cards with prior-month deltas; monthly bar, cumulative area,
category pie, composed chart; group pivots (artist/category/vendor); range presets
persisted; drill-through to ledger rows; per-category CSV + Excel export. Voided rows
excluded everywhere money is summed.
**Recording Budgets** — draft→approved→locked lifecycle; sections (Producers, Studio,
Mixing/Mastering, Musicians, Travel, Other); line items w/ ledger-category mapping;
costs-to-date rollup matched from the ledger; contingency %; audit fields per
transition; list w/ summary stats.
**Marketing** — screenshot → Claude vision parse (campaign, budget, platform, creator
roster with handles/stages/prices/engagement); campaign CRUD; optional auto-linked
marketing expense; links to artist campaigns.
**Salary** — roster separate from users; per-employee-per-month paid toggles; full
toggle history (who/when/action); month/employee filters; admin-only page whose role
gate sits BELOW the hook block (conditional-hook crash otherwise).
**Analytics** (§9.8) and **Activity History** — every mutation logged with human
labels + IP; filterable by user/action/page; single activity view.

### 7.8 Team & settings
**Team** — member list by hierarchy; task CRUD with assignment (@mention picker,
priority, category, due date, email notification w/ preview); assign-vs-request
semantics by hierarchy level; workload + velocity views; member detail with tasks,
releases, overdue pills.
**Settings** — tabs: Users (invite w/ welcome email preview, roles incl. Approver,
rep persona, reset password, delete w/ FK sweep), Permissions (matrix by nav group,
group toggles, search, templates §4, copy-from-user, live-refresh signal to open
manuals), Test Users (superadmin), Archive (superadmin), My Nav (hide pages you don't
use — localStorage), Theme (light/dark/system). Self-service pages (My Nav/Theme)
must not require an admin grant.

### 7.9 Public vendor form
`/submit/:vendorFormToken` — label-branded, no login. 3-step wizard:
1. **Your Info** — name (W9-on-file check w/ alias walk + email-as-shared-secret
   prefill of address/bank/pref — functional setState so the debounce can't clobber
   typing), email + **up to 4 optional extra emails** (validated, deduped, saved to
   vendor_emails, CC'd on confirmations), payment preference, address, bank.
2. **Documents** — invoice upload (AI-validated: **invoice-number gate** — entered
   number must match the document, enforced client AND server via a focused extraction
   call, normalized comparison, fails open on AI error), W9/W8 if not on file,
   receipt REQUIRED for reimbursements (client + server).
3. **Project Info** — artist rows (roster typeahead + off-roster flag re-validated
   server-side, multi-artist splits w/ amounts), song, category, currency, rep (live
   list from public reps endpoint), socials rows, notes; AI parse pre-fills between
   steps 2→3 with a verify banner listing what AI filled.
Cross-cutting: draft autosave + resume banner (localStorage, files excluded, lands on
step 2); duplicate-submission check (normalized invoice # against vendor email OR
name); similar-amount warning (same total ±window); per-IP rate limits (submit 10/hr,
read helpers shared bucket, AI validation 5/min); creates a pending expense + R2
uploads + background discrepancy scans; SPA HTML for this route is served with its own
title/OG tags so shared links unfurl as the vendor form.

## 8. Email system

Per-label Gmail OAuth (or SMTP fallback) — `services/email.js` + a **prepare/send
dispatch layer** (`emailDispatch.prepareEmail(kind, ctx)`) with kinds: welcome,
test_invitation, vendor_approved, vendor_rejected, task_assigned, internal_request,
payment_confirmation, bulk_payment_confirmation, approval_request. EVERY outbound
email flows through **EmailPreviewModal**: rendered HTML preview, editable To/CC
(chip input w/ team autocomplete + default-CC merge)/subject/body, attachments list,
queue mode for per-vendor bulk sends (Send/Skip/Cancel advances). Confirmation CC
resolution: explicit CC wins > rep toggle > vendor saved emails merged (deduped,
minus To).

## 9. Cross-cutting systems

1. **AI (Claude)** — fetch-based lib, no SDK; graceful no-key degradation. Uses:
   invoice parse, proof-of-payment scan (background on ANY proof upload → extracts
   date/ref, marks paid), W9 extraction + cross-check vs form, invoice↔form
   discrepancy scan, focused invoice-number extraction (submission gate), W9
   name-mismatch batch scan, marketing screenshot parse, contract clause generation.
   Field-change triggers re-scan only for scan-relevant fields (server-injected
   changes are excluded). Rate limits: strict bucket (20/15min) for single-shot
   endpoints, roomier bucket (60/15min) for per-file batch loops — never share them.
2. **Spotify** — artwork sync by artist+title, artist stats; per-label credentials
   optional.
3. **FX** — cached live rates; `fx_rate_to_usd` stamped/locked on payment so
   historical USD math never drifts; per-currency totals everywhere with ≈USD
   suffixes; family-aware dedupe when summing splits.
4. **Files** — R2 as §2; MIME sniffing on upload, extension-based on serve;
   Content-Disposition sanitized; every file GET behind auth; has-file checks OR both
   legacy + R2 sources.
5. **Audit** — `activity_log` (all mutations, human labels, IP) + `bk_audit_log`
   (bookkeeping specifics incl. file deletions, exact amounts sent in confirmation
   emails). Deletion attribution everywhere restore exists.
6. **Notifications** — computed bell (releases/contracts/tasks/smart alerts incl.
   stalled bulk deals) + persisted @mentions (per-item mark-read, mention rows must be
   excluded from the clear-all watermark); Layout polls.
7. **Security** — helmet (COOP `unsafe-none` for Google SSO popup), input sanitize
   middleware, secure upload filter, error sanitizer in production, login limiter,
   general limiter, null-password-hash logins return 401, no destructive seed
   endpoints, public vendor read helpers rate-limited (enumeration vector).
8. **Usage analytics** — `page_views` (route-change ping from Layout, fire-and-forget,
   dedupe consecutive, dynamic ids collapsed, 180-day retention); admin Analytics page:
   range picker, stat cards (views/actives/logins/actions), daily chart, most-used
   pages, most-active-users table (joins login logs + activity log). Platform console
   aggregates the same per tenant.
9. **Internal requests** — in-app "request a feature / report a bug" → typed form →
   email preview → sends to the platform team; page-context captured.
10. **Keyboard shortcuts** — global help modal (?), per-page hotkeys as listed; a
    shared `useHotkeys`.

## 10. Mobile (required, not later)

- Viewport `viewport-fit=cover`; BottomNav (<640px: Home / My Work / Releases /
  Finance / More→sidebar, permission-filtered, safe-area padded); FAB (New Task /
  Add Release / Add Invoice, permission-filtered); slide-in sidebar w/ edge swipe.
- Shared kit: `useIsMobile('(max-width:767px)')`, `BottomSheet` (portal drawer,
  85dvh, scroll-lock, safe-area), `FilterSheet`.
- **Ledger + Payments render card lists below 768px** as separate render branches in
  the same components (desktop trees untouched; shared modal tails hoisted): cards →
  detail sheets → quick actions; sticky bulk bars above the nav; ?focus works on
  cards. Approvals/Campaigns/Recoupments/MyWork/Releases get the lighter passes:
  wrapping toolbars, thumb-size primary actions, scrollable tab strips, scroll-wrapped
  tables with min-widths, full-screen chat with safe-area composer, floating buttons
  stacked above nav+FAB. Global CSS: 36px touch targets, inline input widths capped
  at container, charts compress <480px, kanban snap-scroll.

## 11. Hard-won engineering rules (violations caused real bugs)

1. Frozen table columns = ONE sticky cell with internal flex. Never split.
2. Hooks before any conditional return; role gates go BELOW the hook block.
3. Never reference the theme object at module scope.
4. Functional setState for anything a user can trigger twice fast; toast-undo closures
   must capture their own edit record; clear previous toast timers via ref.
5. One PUT per logical flip when the server cascades (split families).
6. `.catch(() => {})` inside a transaction silently aborts it and no-ops the COMMIT.
   Never swallow mid-transaction.
7. Route order: static before param routes (`/vendors/emails` before `/vendors/:payee`,
   `check-similar` before `/submit`, review-feed/chat before `/:artist`). Same for
   mock-adapter matchers.
8. Exact case-insensitive matching for identity lookups; ILIKE only for search boxes
   (and escape user input if ever used for identity).
9. Local-calendar date math everywhere (see §2).
10. Every new expenses column → the light-columns constant + (if editable) the PUT
    allow-list + the mock adapter.
11. Mock adapter shape-parity is a release gate for any endpoint change.
12. Email sending is never automatic-on-upload; it's always an explicit, previewable
    action. Defaults that were chosen deliberately (CC-rep OFF) stay put.
13. Deletes: transactional, FK-swept dynamically, attributed, restorable where soft.
14. Link previews: any public route needs its own served title/OG tags.
15. Analytics/telemetry writes must never fail the request that carries them.
16. Rate limiters: separate buckets for batch-loop endpoints vs single-shot.
17. Vite build + node --check before every push; verify deploys via bundle-marker
    probes; behavioral probes for server changes.

## 12. Branding & white-label details

- Label settings: name, logo (R2), accent color (validated hex), remittance details
  (for outbound invoices), vendor-form welcome text, reply-to email.
- Accent drives: primary buttons, active nav, links, chart primary series, vendor-form
  header, PDF/Word accents where tasteful.
- Vendor form + outbound invoices + confirmation emails carry the label's identity;
  the platform console stays neutral.

## 13. Build order

1. **Foundation** — tenancy core (labels, operators, scoped auth), design tokens +
   UI kit + Layout/nav/permissions, Settings (users/roles/permissions/templates),
   activity log, platform console v1 (workspaces CRUD + enter).
2. **Finance core** — expenses schema, Ledger (full), Add Invoice/Reimbursement,
   Approvals, public vendor form, R2 + AI libs, vendor pages (aliases/emails/merge),
   Payments (full incl. confirmations + approval emails), Archive.
3. **Finance depth** — splits everywhere, recoupments + planning + prior-year,
   financials, QB import, bulk upload/re-upload, lookup, invoices index, outbound
   invoices, ledger matching, duplicates/data-quality, salary.
4. **Label ops** — releases (checklist/tabs/DSP/budgets), catalog, artists + profiles,
   deals, contracts/NDA/waivers/clearances, calendar, team/tasks, marketing,
   recording budgets, bulk deals.
5. **Collaboration & polish** — campaigns hub (chat/review inbox/flags), My Work
   command center, notifications/mentions, search, analytics, manual, mobile kit +
   passes, test users/mock adapter, platform console analytics.

Each milestone: build → verify against this spec → deploy → probe. Keep a CLAUDE.md
in the repo that documents what EXISTS (this file documents what SHOULD exist) and
update both as reality evolves.

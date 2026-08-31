# 00 — Inventory & route mapping

- **OLD / reference:** `/Users/johnskead/Desktop/DevProjects/Dashboard/boom-dashboard` (single-tenant; working tree @ b1c48e2)
- **NEW / clone:** `/Users/johnskead/Desktop/DevProjects/cadence` (multi-tenant; working tree includes the uncommitted 2026-08-27 finance-depth build — Reports, Bank Matching, Creators, Artist Budgets, categories table)
- Audit date: 2026-08-27. Source-only analysis.

## Visual mode: NOT AVAILABLE
Cadence has no `.env` at repo root or `server/` (`ls` verified) — the server requires `DATABASE_URL` (`server/db.js:5`) so the NEW dev server cannot boot locally. Boom has `server/.env` only. Per the ground rules, no time was spent fixing this; all comparisons are source-derived. Anything that needs a rendered browser to verify is marked `UNVERIFIED — needs runtime check` in the page files.

---

## OLD route inventory (boom-dashboard)

Router: `client/src/App.jsx:171-251` (plus pathname early-returns before the auth guard for `/submit`, `/admin/vendor-preview`, `/admin/vendor-lab` — see App.jsx top). Guards: `ProtectedRoute` (token + `canView(path)`), `AdminRoute` (defers to `canView`), `StrictAdminRoute` (raw Superadmin/Admin role check). Nav labels from `client/src/navConfig.jsx` (groups: *(untitled)* / Artists / Releases / Contracts / Bookkeeping / Reports / Team / System).

| Path | Component | Guard | Nav group · label |
|---|---|---|---|
| `/` | `Dashboard` | Protected | (untitled) · Dashboard |
| `/my-work` | `MyWork` | Protected | (untitled) · My Work |
| `/calendar` | `Calendar` | Protected | (untitled) · Calendar |
| `/flags` (+`/duplicates`→redirect) | `Duplicates` | Protected | (untitled) · Flags |
| `/artists`, `/artists/:id` | `Artists`, `ArtistProfile` | Protected | Artists · Roster |
| `/deals` | `DealPipeline` | Protected | Artists · Deal Pipeline |
| `/releases`, `/releases/:id` | `Releases/` (folder), `ReleaseDetail` | Protected | Releases · Release Tracker |
| `/catalog` | `Catalog` | Protected | Releases · Catalog |
| `/contracts` | `Contracts` | AdminRoute | Contracts · Contracts |
| `/contracts/create` | `CreateContract` | AdminRoute | Contracts · Create Contract |
| `/pending-contracts` | `PendingContracts` | AdminRoute | Contracts · Pending |
| `/renewals` | `Renewals` | AdminRoute | Contracts · Renewals |
| `/create-nda`, `/create-nda/:template` | `CreateNDA` + `nda-templates/` | Protected | Contracts · Create NDA |
| `/create-label-waiver` | `CreateLabelWaiver` | Protected | Contracts · Create Label Waiver |
| `/create-artist-clearance` | `ArtistClearance` | Protected | Contracts · Create Artist Clearance |
| `/bk/approvals` | `BkApprovals` | Protected | Bookkeeping · Approvals (badge) |
| `/bk/approvals/archive` | `BkArchive` | Protected | (no nav — linked from Approvals) |
| `/bk/payments` | `BkPayments` | Protected | Bookkeeping · Payments |
| `/bk/ledger` | `BkLedger` | Protected | Bookkeeping · Ledger |
| `/bk/bank-ledger` | `BkLedger bank` | Protected | Bookkeeping · Bank Ledger |
| `/bk/add` | `BkAddInvoice` | Protected | Bookkeeping · Add Invoice |
| `/create-invoice` | `CreateInvoice` | Protected | Bookkeeping · Create Invoice |
| `/bk/vendors` (+`/bk/bank-vendors`→redirect) | `BkVendorsUnified` | Protected | Bookkeeping · Vendors |
| `/bk/vendors/:vendorName` | `BkVendors` | Protected | (detail of Vendors) |
| `/bk/vendors/added-expenses` | `BkVendorsAdded` | Protected | (subpage of Vendors) |
| `/bk/vendor-flags` → redirect `/bk/vendors?tab=duplicates` | — | — | — |
| `/bk/creators` | `BkCreators` | Protected | Bookkeeping · Creator Payments |
| `/bk/statements` | `BkStatements` | Protected | Bookkeeping · Statements |
| `/bk/bank-matching` | `BkBankMatching` | Protected | Bookkeeping · Bank Matching |
| `/bk/rules` | `BkRules` | Protected | Bookkeeping · Upload Rules |
| `/bk/invoices` | `BkInvoices` | Protected | Bookkeeping · Invoices View |
| `/bk/bulk-upload` | `BkBulkUpload` (TabbedShell import) | Protected | Bookkeeping · Import › Invoices |
| `/bk/bulk-reupload` | `BkBulkReupload` (TabbedShell) | Protected | Bookkeeping · Import › Re-upload |
| `/import` | `QBImport` (TabbedShell) | Protected | Bookkeeping · Import › QuickBooks |
| `/import/master-sheet` | `MasterSheetImport` (TabbedShell) | AdminRoute + adminOnly nav | Bookkeeping · Import › Master sheet |
| `/bk/reimburse` | `BkAddReimbursement` | Protected | Bookkeeping · More › Add Reimbursement |
| `/bk/ledger-matching` | `LedgerMatching` | Protected | Bookkeeping · More › Bookkeeper Reconcile |
| `/financials`, `/financials/month/:month` | `Financials` (one component, two modes) | Protected | Reports · Financials |
| `/reports` | `Reports` | Protected | Reports · Reports |
| `/budget`, `/budget/:id` | `Budget`, `BudgetDetail` | Protected | Reports · Recording Budgets |
| `/recoupments`, `/recoupments/:artistName` | `Recoupments` (TabbedShell recoupments) | Protected | Reports · Recoupments › Overview |
| `/recoupments/planning` | `RecoupmentsPlanning` (TabbedShell) | Protected | Reports · Recoupments › Planning |
| `/recoupments/audit` | `RecoupmentsAudit` (TabbedShell) | Protected | Reports · Recoupments › Audit |
| `/recoupments/2025` | `Recoupments2025` | Protected | (routed orphan — deliberately not in nav) |
| `/artist-budgets`, `/artist-budgets/:artistKey` | `ArtistBudgets`, `ArtistBudgetSheet` | Protected | Reports · Artist Budgets |
| `/artist-campaigns` (+`/:artistName`, `/:artistName/:songName`; queue = `?view=queue`) | `ArtistCampaigns` | Protected | Reports · Artist Campaigns |
| `/bk/advertising` | `AdAllocation` | Protected | Reports · Allocate Ads |
| `/salary` | `Salary` | AdminRoute | Reports · Salary |
| `/bk/bulk-deals` | `BkBulkDeals` | Protected | Reports · Bulk Deals |
| `/team`, `/team/:id` | `Team`, `TeamMember` | Protected | Team · Members |
| `/settings` | `Settings` | Protected | Team · Settings |
| `/admin` | `AdminDocs` | StrictAdminRoute | System · Admin Docs |
| `/activity` | `ActivityHistory` | StrictAdmin nav (sysAdminOnly group) | System · Activity |
| `/analytics` | `Analytics` | StrictAdminRoute | System · Analytics |
| `/legal` | `Legal` (WIP placeholder) | role check in component | System · Legal |
| `/manual` | `UserManual` (full page, outside Layout) | own permission refetch | header BookOpen button |
| `/submit` | `VendorSubmit` | PUBLIC (pathname early-return) | sidebar copy-link |
| `/admin/vendor-preview` | `VendorSubmit adminPreview` (WRITES) | pathname + token | System · Vendor Form (external) |
| `/admin/vendor-lab` | `VendorSubmitLab` (sandbox, writes nothing) | pathname + token | System · Vendor Form (sandbox) |
| `/privacy`, `/eula`, `/login` | `Privacy`, `EULA`, `Login` (Google SSO) | public | — |

## NEW route inventory (cadence)

Router: `client/src/App.jsx:112-194`. Guards: `ProtectedRoute` (token only, `App.jsx:73`), `AdminRoute` (**misleadingly named — allows Superadmin/Admin/Approver**, `App.jsx:88`); server re-gates per request (`requireApprover`/`requireAdmin`). Platform-operator sessions render a separate `PlatformLayout` shell (`App.jsx:121-131`). Nav from `components/Layout.jsx:230-301` (groups: *(untitled)* / Catalog / A&R / Contracts & Legal / Bookkeeping / Workspace); labels verified 2026-08-27 including the new finance pages.

| Path | Component | Guard | Nav group · label |
|---|---|---|---|
| `/` | `Dashboard` | Protected | (untitled) · Dashboard |
| `/my-work` | `MyWork` (TaskSurface mine) | Protected | (untitled) · My Work |
| `/team-work` | `TeamWork` (TaskSurface team) | AdminRoute | (untitled) · Team Work |
| `/messages`, `/messages/:channelId` | `Messages` | Protected | (untitled) · Messages (badge) |
| `/calendar` | `Calendar` | Protected | (untitled) · Calendar |
| `/releases`, `/releases/:id` | `Releases`, `ReleaseDetail` | Protected | Catalog · Releases |
| `/catalog` | `Catalog` | Protected | Catalog · Catalog |
| `/artists`, `/artists/:id` | `Artists`, `ArtistProfile` | Protected | Catalog · Roster |
| `/brand` | `Brand` | Protected | Catalog · Brand |
| `/deals` | `Deals` | Protected | A&R · Deal Pipeline |
| `/marketing` | `Campaigns` | Protected | A&R · Marketing |
| `/artist-campaigns` (+`/:artist`, `/:artist/:song`) | `ArtistCampaigns`, `ArtistCampaignDetail` | AdminRoute | A&R · Artist Campaigns |
| `/contracts` | `Contracts` | AdminRoute | Contracts & Legal · Contracts |
| `/pending-contracts` | `PendingContracts` | AdminRoute | Contracts & Legal · Pending |
| `/renewals` | `Renewals` | AdminRoute | Contracts & Legal · Renewals |
| `/legal` | `Legal` (NDA counterparty tracker) | AdminRoute | Contracts & Legal · NDAs |
| `/create-nda`, `/create-nda/:template` | `CreateNda` | AdminRoute | Contracts & Legal · Create NDA |
| `/label-waivers` | `CreateLabelWaiver` | AdminRoute | Contracts & Legal · Label Waivers |
| `/clearances` | `ArtistClearance` | AdminRoute | Contracts & Legal · Clearances |
| `/admin-docs` | `AdminDocs` | AdminRoute (isAdmin nav) | Contracts & Legal · Admin Docs |
| `/add-invoice` | `AddLedgerEntry invoice` | Protected (canView-whitelisted) | Bookkeeping · Add Invoice |
| `/approvals` | `Approvals` | AdminRoute | Bookkeeping · Approvals (badge) |
| `/ledger` (+`/ledger/new-invoice`, `/ledger/new-reimbursement`) | `Ledger`, `AddLedgerEntry` | AdminRoute | Bookkeeping · Ledger |
| `/payments` | `Payments` | AdminRoute | Bookkeeping · Payments |
| `/bank-statements`, `/bank-statements/:id` | `BankStatements` | AdminRoute (isAdmin nav) | Bookkeeping · Bank Statements |
| `/bank-matching` | `BankMatching` *(new 2026-08-27)* | AdminRoute (isAdmin nav) | Bookkeeping · Bank Matching |
| `/vendors` | `Vendors` | AdminRoute | Bookkeeping · Vendors |
| `/creators` | `Creators` *(new)* | AdminRoute | Bookkeeping · Creator Payments |
| `/invoices`, `/invoices/new` | `CreateInvoice` (outbound) | AdminRoute | Bookkeeping · Create Invoice |
| `/financials` | `Financials` | AdminRoute | Bookkeeping · Financials |
| `/reports` | `Reports` *(new)* | AdminRoute | Bookkeeping · Reports |
| `/artist-budgets`, `/artist-budgets/:artistKey` | `ArtistBudgets`, `ArtistBudgetSheet` *(new)* | AdminRoute | Bookkeeping · Artist Budgets |
| `/recording-budgets` | `RecordingBudgets` | AdminRoute | Bookkeeping · Recording Budgets |
| `/recoupments` | `Recoupments` (3 in-page tabs) | AdminRoute | Bookkeeping · Recoupments |
| `/recoupments/planning` | `RecoupmentPlanning` | AdminRoute | Bookkeeping · Recoup. Planning |
| `/salary` | `Salary` | AdminRoute (isAdmin nav) | Bookkeeping · Salary |
| `/data-quality` | `DataQuality` | AdminRoute (isAdmin nav) | Workspace · Data Quality |
| `/team` | `Team` | AdminRoute (isAdmin nav) | Workspace · Team |
| `/activity` | `Activity` | AdminRoute (isAdmin nav) | Workspace · Activity |
| `/requests` | `InternalRequests` | Protected | Workspace · Requests & feedback |
| `/settings` | `Settings` | Protected | Workspace · Settings |
| `/notifications` | `Notifications` | Protected | (bell "view all") |
| `/manual` | `ManualPage` (routed modal) | Protected | header button |
| `/submit/:slug` | `VendorSubmit` (token-resolved) | PUBLIC | copied from Settings |
| `/login`, `/accept-invite`, `/reset-password`, `/privacy`, `/eula` | respective pages | public | — |
| Platform shell: `/` `/messages` `/workspaces` `/activity` `/announcements` `/operators` `/account` | Platform* pages | ProtectedRoute + is_platform_admin | operator console |

---

## Pairing table

Confidence: HIGH = same purpose + near-identical scope · MED = same purpose, materially different implementation/scope · LOW = loose analog only.

| OLD route | NEW route | Match confidence | Notes |
|---|---|---|---|
| `/` | `/` | HIGH | Dashboard widgets vs cadence widget set; OLD has ReconciledBadge (NEW gained it 2026-08-27), sync-artwork, prior-year bars |
| `/my-work` | `/my-work` (+ NEW `/team-work`) | MED | Same job, different architecture: OLD = To-Do-Today curation + notes-style 2-pane; NEW = Notion-style task database |
| `/calendar` | `/calendar` | HIGH | OLD feed includes tasks scoped per-user + contracts admin-gated |
| `/flags` | `/data-quality` | MED | OLD is the global hub (Money/Ledger/Catalog/Artists, 26 categories); NEW covers dupes+ledger flags only — money sections live on `/bank-statements`+`/bank-matching` |
| `/artists` | `/artists` | HIGH | OLD adds export panel, Spotify image sync, active-roster filter, archived section |
| `/artists/:id` | `/artists/:id` | HIGH | OLD has 8 tabs incl. Spotify/Contracts/Documents FilesPanel |
| `/deals` | `/deals` | HIGH | OLD is true drag-drop kanban + detail drawer fields |
| `/releases` | `/releases` | HIGH | OLD is a folder (merge flow, calendar view, notification banner, 7-tab row) |
| `/releases/:id` | `/releases/:id` | HIGH | |
| `/catalog` | `/catalog` | HIGH | OLD adds time presets, artwork sync loop, hover overlays |
| `/contracts` | `/contracts` | MED | OLD adds AI contract SCAN w/ confidence chips, missing/expiring panels, LinkedDataPanel |
| `/contracts/create` | — | — | **OLD orphan** — AI full-contract generation page |
| `/pending-contracts` | `/pending-contracts` | HIGH | |
| `/renewals` | `/renewals` | HIGH | |
| `/create-nda` | `/create-nda` | HIGH | OLD has 2 templates + registry + Word-less (NEW adds docx export) |
| `/create-label-waiver` | `/label-waivers` | HIGH | |
| `/create-artist-clearance` | `/clearances` | HIGH | |
| `/bk/approvals` | `/approvals` | MED | NEW lacks the checklist deck (4 confirmations + 4 written answers), W9 review deck, payment_check banners, possible_duplicates |
| `/bk/approvals/archive` | — | — | **OLD orphan** — NEW has `GET /ledger/archive` server-side, no UI |
| `/bk/payments` | `/payments` | HIGH | NEW lacks settlement groups, multi-invoice chips, bank-evidence dots, calendar view |
| `/bk/ledger` | `/ledger` | MED | NEW lacks selection/bulk bar, carve-off split, source-lens views, 29-col set differs |
| `/bk/bank-ledger` | — (partial: `/bank-matching` queue + statement lens) | — | **OLD orphan** — the bank half of the ledger with statement lens/tie-out |
| `/bk/add` | `/ledger/new-invoice` (+`/add-invoice`) | MED | OLD gates admin saves behind the approval checklist; parse/validate flows differ |
| `/bk/reimburse` | `/ledger/new-reimbursement` | HIGH | |
| `/create-invoice` | `/invoices` | HIGH | OLD has payment-terms engine (`businessDay`, TIMESTAMPTZ) |
| `/bk/vendors` | `/vendors` | MED | OLD unified ledger+bank company view w/ 5 tabs, dupe deck, merge log/unmerge, payment-details vault; NEW is table+drawer |
| `/bk/vendors/:vendorName` | — (drawer on `/vendors`) | MED | detail-as-route vs drawer |
| `/bk/vendors/added-expenses` | — | — | **OLD orphan** — invoice-less vendors dupe surface |
| `/bk/creators` | `/creators` | HIGH | NEW built 2026-08-27 to boom's model |
| `/bk/statements` | `/bank-statements` (+`/:id`) | HIGH | OLD adds extras audit, misfiled repair, re-parse, reminders panel; NEW gained balances/search/flags card 2026-08-27 |
| `/bk/bank-matching` | `/bank-matching` | HIGH | NEW built 2026-08-27; OLD adds batch vendor view, deck-over-queue variants |
| `/bk/rules` | (RulesPanel on `/bank-matching`) | MED | OLD is a dedicated page w/ rule-suggestions + annotate; NEW is a panel |
| `/bk/invoices` | — | — | **OLD orphan** — invoice search/index w/ weekly charts |
| `/bk/bulk-upload` | — (Ledger CSV import only) | — | **OLD orphan** — AI invoice+proof batch flow |
| `/bk/bulk-reupload` | — | — | OLD orphan — **intentional** (blob-repair page; N/A on R2) |
| `/import` (QBImport) | — | — | OLD orphan — **intentional per cadence docs** (QB import scoped out) |
| `/import/master-sheet` | (DataTools component, no route) | MED | NEW has API + component, no routed page |
| `/bk/ledger-matching` | — | — | **OLD orphan** — bookkeeper xlsx diff + handoff ZIP |
| `/financials` | `/financials` | HIGH | OLD adds `/financials/month/:month` drill, exec dashboard depth |
| `/financials/month/:month` | — | — | **OLD orphan** — month drill route |
| `/reports` | `/reports` | HIGH | NEW built 2026-08-27; OLD adds reversal banners, /reports/search, label-level pool, part-aware split editing |
| `/budget`, `/budget/:id` | `/recording-budgets` | MED | OLD: index+detail routes, fund type, sticky totals, costs-to-date tab; NEW: single page |
| `/recoupments` (+`/:artistName`) | `/recoupments` | MED | OLD: bank-evidence 4-state sections, claim-provable band, statement tabs w/ windows, artist ROUTE; NEW: inline expander, no bank evidence |
| `/recoupments/planning` | `/recoupments/planning` | MED | OLD: localStorage plan + labels; NEW: select+commit, no labels |
| `/recoupments/audit` | — | — | **OLD orphan** — five-check audit + class rules |
| `/recoupments/2025` | (prior-year tab on `/recoupments`) | MED | route vs tab |
| `/artist-budgets` (+`/:artistKey`) | `/artist-budgets` (+`/:artistKey`) | HIGH | NEW built 2026-08-27 |
| `/artist-campaigns` (+2, `?view=queue`) | `/artist-campaigns` (+2) | MED | NEW lacks two-layer settled/committed model + queue view + attribute-unattributed |
| `/bk/advertising` | — | — | **OLD orphan** — ad pool allocation |
| `/salary` | `/salary` | HIGH | |
| `/bk/bulk-deals` | — | — | **OLD orphan** — deliverables/stalled tracking page (NEW has columns + drawer items only) |
| `/team` | `/team` | MED | OLD: people/workload/velocity views + per-member expand; NEW: flat roster (+TeamWork Workload covers part) |
| `/team/:id` | — | — | **OLD orphan** — member detail page |
| `/settings` | `/settings` | MED | OLD: Users/Permissions/Test Users/Archive/My Nav/Theme; NEW tab set differs (verify in page pass) |
| `/admin` | `/admin-docs` | HIGH | |
| `/activity` | `/activity` | HIGH | OLD adds humanizeAction table, user/dept filters, pagination |
| `/analytics` | — | — | **OLD orphan** — usage analytics (never built in NEW) |
| `/legal` | `/legal` | LOW | Different things: OLD = WIP placeholder vault; NEW = NDA counterparty tracker |
| `/manual` | `/manual` | MED | OLD: printable permission-aware manual + workflows + user overrides; NEW: routed modal + AI ask |
| `/submit` | `/submit/:slug` | HIGH | Token/slug + branding are intentional; form scope differs (payment coordinates etc.) |
| `/admin/vendor-preview` | — | — | **OLD orphan** — admin preview that writes |
| `/admin/vendor-lab` | — | — | **OLD orphan** — sandbox copy |
| `/login` | `/login` | MED | OLD: Google SSO; NEW: email/password + reset (partly intentional) |
| `/privacy`, `/eula` | `/privacy`, `/eula` | HIGH | |
| — | `/messages` (+`/:channelId`) | — | **NEW orphan — intentional** (chat suite) |
| — | `/team-work` | — | NEW orphan — not tenancy-driven; covered in my-work page file |
| — | `/notifications` | — | NEW orphan (bell "view all" page) |
| — | `/requests` | — | NEW orphan — analog of OLD's header Request modal; covered in topbar surface |
| — | `/announcements`, `/workspaces`, `/operators`, `/account` (platform shell) | — | **NEW orphan — intentional** (multi-tenant console) |
| — | `/brand` | — | NEW orphan — intentional (per-label branding) |
| — | `/marketing` (Campaigns) | — | NEW orphan — no OLD routed analog (OLD marketing.js is API-only) |
| — | `/accept-invite`, `/reset-password` | — | NEW orphan — intentional (invite-based auth) |
| — | `/data-quality` dedicated page | — | paired with `/flags` above |

## Global surfaces (non-route comparisons)

| Surface | OLD source | NEW source |
|---|---|---|
| Sidebar / nav | `navConfig.jsx` + `Layout.jsx` | `Layout.jsx:230-301` |
| Top bar / header (incl. Request modal, ViewAs, manual button, billing copy) | `Layout.jsx` | `Layout.jsx` |
| Global search ⌘K | `GlobalSearch.jsx` + `lib/pageSearch.js` + `routes/search.js` | `GlobalSearch.jsx` + `routes/search.js` |
| Notification bell | `NotificationBell.jsx` + `routes/notifications.js` + reminders | `NotificationBell.jsx` + `routes/notifications.js` |
| Toasts | `context/ToastContext` | `context/ToastContext` |
| Modal/overlay primitives | hand-rolled overlays + ReviewDeck | `components/ui/` (Modal/ConfirmDialog/BottomSheet) + hand-rolled |
| Keyboard shortcuts help | `KeyboardShortcutsHelp.jsx` | `constants/shortcuts.js` + help modal |
| Auth screens | `Login` (Google SSO) | `Login`/`AcceptInvite`/`ResetPassword` |
| Error/404/loading | `ErrorBoundary`, `Skeleton.jsx` | `ErrorBoundary`, `Skeleton.jsx` |
| Empty states | per-page conventions | per-page conventions |
| Mobile shell | `BottomNav`, `FAB`, PullToRefresh, mobile/ components, edge-swipe | `BottomNav`, `Fab`, BottomSheet |
| Theme / dark mode / branding | `ThemeContext` + `.dark` overrides + `darkColors.js` | `ThemeContext` + `tokens.css` + `branding.js` accent |
| Email preview modal | `EmailPreviewModal` + emailDispatch kinds | `EmailPreviewModal` + emailDispatch kinds |

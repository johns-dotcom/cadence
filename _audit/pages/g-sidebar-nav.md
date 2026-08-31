# g-sidebar-nav — sidebar navigation (global shell surface)

OLD: `boom-dashboard/client/src/components/Layout.jsx` (:582-816) + `boom-dashboard/client/src/navConfig.jsx` (NAV_GROUPS :76-243) + `BottomNav.jsx`
NEW: `cadence/client/src/components/Layout.jsx` (:234-417) + `BottomNav.jsx`

Route & permissions: global surface — rendered on every authenticated page. Item-level gating: OLD = `sysAdminOnly` group flag + per-item `adminOnly` + `canView` + personal `nav_hidden_pages` (Layout.jsx:491-544); NEW = inline `isApprover`/`isAdmin` ternaries + `canView` (Layout.jsx:234-309).

Design-system-level diffs (font, accent default, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported here. Nav rows that point at pages missing from NEW entirely (Bank Ledger, Invoices View, the Import family, Bookkeeper Reconcile, Recoupment Audit, Allocate Ads, Bulk Deals, Analytics, Create Contract, Vendor Form sandbox) follow their pages and are adjudicated in `00-inventory.md` + the `missing--*.md` files — not re-counted here.

## 1. Layout & structure

**OLD** (Layout.jsx:582-816): fixed `w-60 bg-sidebar border-r` column (:586) → logo row `h-16 px-5` with "boom." wordmark (:589-596) → scrollable `nav px-3 py-4 space-y-4` rendering NAV_GROUPS with three row kinds — regular link (:701-737), **tabbed family** (one row for a page family, links to first `canView`-able child, badge = sum of children, :613-641), **collapsible sub-group** (chevron disclosure, children indented `ml-5 pl-3 border-l`, state persisted in `localStorage nav_collapsed`, :643-699) — → a utility block INSIDE the nav (Vendor Form copy-link + Boom Billing copy-address, :742-790) → footer with user avatar/name/role + Sign out (:793-815).

**NEW** (Layout.jsx:318-417): same `w-60 bg-sidebar border-r` (:322) → logo row `h-16 px-5` with workspace logo/initials + name + tagline (:325-344) → `nav px-3 py-4 space-y-4` rendering a FLAT items-only model — no tabbed families, no collapsible sub-groups (:347-376) → footer containing Vendor Form copy-link (moved out of the nav, :381-393), user block (:394-404), Sign out (:405-410), and a "Powered by Cadence" line (:412-415).

**Group taxonomy** (OLD navConfig.jsx:76-243 vs NEW Layout.jsx:234-307):

| OLD group | OLD items | NEW group | NEW items |
|---|---|---|---|
| *(untitled)* | Dashboard, My Work, Calendar, **Flags** | *(untitled)* | Dashboard, My Work, *Team Work*†, *Messages*†, Calendar |
| Artists | Roster, Deal Pipeline | Catalog | Releases, Catalog, Roster, *Brand*† |
| Releases | Release Tracker, Catalog | A&R | Deal Pipeline, *Marketing*†, Artist Campaigns |
| Contracts | Contracts, Pending, Renewals, Create Contract, Create NDA, Create Label Waiver, Create Artist Clearance | Contracts & Legal | Contracts, Pending, Renewals, NDAs, Create NDA, Label Waivers, Clearances, Admin Docs |
| Bookkeeping (13 rows incl. Import family + More) | Approvals, Payments, Ledger, Bank Ledger, Add Invoice, Create Invoice, Vendors, Creator Payments, Statements, Bank Matching, Upload Rules, Invoices View, Import▸, More▸(Add Reimbursement, Bookkeeper Reconcile) | Bookkeeping (16 flat rows) | Add Invoice, Approvals, Ledger, Payments, Bank Statements, Bank Matching, Vendors, Creator Payments, Create Invoice, Financials, Reports, Artist Budgets, Recording Budgets, Recoupments, Recoup. Planning, Salary |
| Reports | Financials, Reports, Recording Budgets, Recoupments▸(Overview/Planning/Audit), Artist Budgets, Artist Campaigns, Allocate Ads, Salary, Bulk Deals | — (merged into Bookkeeping) | — |
| Team | Members, Settings | Workspace | Team, Activity, **Data Quality**, *Requests & feedback*†, Settings |
| System (sysAdminOnly) | Admin Docs, Activity, Analytics, Legal, Vendor Form (sandbox, external) | — (dissolved) | — |

† = NEW-only feature items (chat, team tasks, brand kit, marketing, internal requests) — additions, not parity items. **Flags** → **Data Quality** is a demotion (see §7-2). OLD deliberately split Reports from Bookkeeping "so the daily-ops list stays scannable" (navConfig.jsx:180-183); NEW re-merges them into one 16-row group.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Width / logo row / group header / row classes | `w-60`; `h-16 px-5`; group header `px-3 mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-widest`; row `gap-3 px-3 py-2 rounded-lg text-sm font-medium`, icon 17, strokeWidth 2/1.5, active `bg-boom-50 text-boom-700` | identical classes, `brand` for `boom` (RC-2) | OLD :586,:589,:603,:624-631 / NEW :322,:325,:351,:360-365 |
| Badge pill | `ml-auto bg-boom-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full` | identical, `brand-600` | OLD :722 / NEW :368 |
| Logo | `text-lg font-bold` "boom." wordmark | 8×8 workspace logo/initial tile + name + tagline | OLD :590 / NEW :327-337 — **[INT]** branding |
| Child rows (collapsible) | `text-[13px] py-1.5`, icon 15, indented w/ `border-l` guide | no child-row concept | OLD :672-692 / NEW — |
| Collapsed-family hint | closed group w/ active child gets `text-boom-700 bg-boom-50/50` | n/a | OLD :654-663 / NEW — |
| Footer | user block + Sign out only | + Vendor Form button, + "Powered by Cadence" w/ Disc3 11 | OLD :793-815 / NEW :379-416 — powered-by is **[INT]** branding |
| Vendor Form / Boom Billing rows | in-nav bottom block, icon 17, right hint `text-[10px] text-gray-300` "Copy link"/"Copy address", swaps to emerald Check + "Link copied!" | single Vendor Form row in footer, icon 16, right hint `text-xs font-semibold` "Copy link"→"✓ Copied" | OLD :742-790 / NEW :381-393 |

Active-item treatment, icon size (17), hover states, spacing: parity (modulo RC-2). Active match logic is equivalent (`===` or `startsWith`; OLD Layout.jsx:703, NEW :355).

## 3. Copy & content differences

- Label renames on shared pages: "Release Tracker"→"Releases", "Members"→"Team", "Statements"→"Bank Statements", "Create Label Waiver"→"Label Waivers", "Create Artist Clearance"→"Clearances", "Flags"→"Data Quality", "Legal"→"NDAs" (different page — inventory pairs OLD `/legal` LOW), "Recoupments▸Planning"→"Recoup. Planning" (OLD navConfig vs NEW Layout.jsx:234-307).
- OLD carries a `synonyms` string per item feeding the ⌘K page palette (navConfig.jsx:80-240); NEW has no synonyms concept (no page search — see g-global-search).
- NEW footer copy "Powered by Cadence" (:414); OLD none.
- NEW logo tagline default "Label Operations" (:336).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Personal nav hiding ("My Nav")**: OLD filters every group through `nav_hidden_pages` (localStorage, edited on Settings, re-read on route change + storage event, Layout.jsx:414-429,:528-544; editor Settings.jsx:1440-1452). NEW has no equivalent (grep: `nav_hidden_pages`/`hiddenNav` absent from cadence client).
- **Collapsible sub-groups**: chevron disclosure, per-key persistence (`nav_collapsed`, Layout.jsx:443-454,:643-699). Absent in NEW.
- **Tabbed families**: one nav row per page family; links to the first child the user can view ("a person granted Planning but not Overview still has a way in", :613-623); badge sums children (:619); the family row survives if ANY child is viewable (:521). NEW renders Recoupments and Recoup. Planning as two flat rows (:292-293) and has no family concept.
- **Single-source nav config**: OLD extracted NAV_GROUPS to `navConfig.jsx` explicitly because Layout + Settings copies had drifted (navConfig.jsx:49-63); consumed by Settings My Nav, Permissions editor and the ⌘K palette (NAV_PAGES :251-265, tabFamilyFor :274-281). NEW's nav is an inline array in Layout.jsx:234-307 — the drift-prone shape OLD retired.
- **Edge-swipe drawer**: OLD opens the mobile sidebar on a right-swipe from the left 30px and closes on left-swipe (Layout.jsx:397-412). NEW mobile drawer is button-only (backdrop click / X / route change, :314-316,:339-343,:194).
- **External nav items**: OLD supports `external: true` → `<a target="_blank" rel="noopener">` (navConfig.jsx:240, Layout.jsx:728-731). NEW has no external kind (sole OLD consumer is the missing vendor-lab page).
- **In-Layout permission gate**: OLD resolves the current URL to a base path and `<Navigate to="/">` if `!canView` on every render (:557-570). NEW relies on App.jsx route wrappers (AdminRoute etc.) — equivalent coverage, different mechanism; no defect logged.
- **Boom Billing copy-address button** (:766-789): copies the label's remittance block for vendor "bill to" fields. Absent in NEW even though the per-label data exists (`labels.invoice_settings`).
- **Vendor Form link audience**: OLD row is ungated inside the nav (:742-762, any role can copy the public form link); NEW gates it `isApprover && label?.slug` (:381).

### Badges
- Approvals badge: OLD injected into `/bk/approvals` from `GET /bk/pending-count`, fetched for every user, refetched on route change (Layout.jsx:457-464,:508-510; bookkeeping.js:12964). NEW: `GET /ledger/pending-count`, fetched only for approvers, refetched on route change (:217-222,:280). Parity in placement/shape.
- Messages unread badge (NEW-only): `GET /chat/unread` on nav + socket `message:new` (:224-230,:242). No OLD analog (no chat).

### Mobile (both `matchMedia (max-width:1023px)`, backdrop, translate-x drawer, close-on-route: OLD :369-383 / NEW :186-194 — parity)
- **BottomNav**: OLD `sm:hidden` (<640px) tabs Home / My Work / Releases / Finance(→/bk/ledger) + More, canView-filtered (BottomNav.jsx:5-26). NEW `lg:hidden` (<1024px) tabs Home / Chat / Work / Finance(first viewable of ledger/payments/financials/approvals) + More (BottomNav.jsx:12-23). **Releases tab dropped** (replaced by Chat); visibility window widened 640→1024; NEW is mounted only when `isMobile` (Layout.jsx:493) vs OLD always-mounted-CSS-hidden (:913); minor stroke/weight tweaks (19/2.2/1.8 `font-medium` vs 20/2/1.5 `font-semibold`).

## 5. Data layer differences

- OLD badge source `GET /bk/pending-count` (unscoped single-tenant); NEW `GET /ledger/pending-count` label-scoped — **[INT]** tenancy.
- NEW fetches `GET /chat/unread` + `GET /announcements/active` (Layout.jsx:228,:200) — NEW-feature endpoints, no OLD analog.
- OLD posts `POST /analytics/pageview` per route change from the shell (:388-394) — missing in NEW; counted in `missing--analytics.md`, not here.

## 6. Tables & forms (if present)

No tables or forms on this surface.

## 7. Defects found

1. **P2** — Group taxonomy restructured: Reports group merged into a 16-row flat Bookkeeping (OLD split them deliberately, navConfig.jsx:180-183), Artists/Releases groups reshuffled into Catalog/A&R (Roster under "Catalog"; Artist Campaigns moved Reports→A&R), System group dissolved — fix: cadence Layout.jsx:234-307 regroup per OLD navConfig.jsx:76-243. (HIGH)
2. **P2** — Flags demoted: OLD all-users top-group item `/flags` (navConfig.jsx:85) → NEW admin-only "Data Quality" under Workspace (Layout.jsx:302) — non-admins lose the entry entirely; page-scope gap adjudicated in flags-data-quality.md, the nav visibility/placement/rename is this surface's — fix: cadence Layout.jsx:237-244 top group, drop the isAdmin gate (or justify). (HIGH)
3. **P2** — Personal nav customization layer missing: `nav_hidden_pages` filter + storage-event refresh (OLD Layout.jsx:414-429,:528-544; Settings.jsx:1440-1452) — fix: cadence Layout.jsx:308 add hidden-pages filter + Settings "My Nav" editor. (HIGH)
4. **P2** — Add Reimbursement has no nav entry: OLD Bookkeeping▸More row (navConfig.jsx:168); NEW page exists (`/ledger/new-reimbursement`) but is reachable only via a button on Ledger (Ledger.jsx:370), a page Users without `/ledger` never see — fix: cadence Layout.jsx:279 add item. (HIGH)
5. **P2** — Mobile edge-swipe open/close of the drawer missing (OLD Layout.jsx:397-412) — fix: cadence Layout.jsx:186-194 add touch handlers. (HIGH)
6. **P3** — Collapsible sub-groups + tabbed family rows (first-viewable-child link, summed famBadge, `nav_collapsed` persistence, family-survives-if-any-child-viewable) not implemented; Recoupments family renders as two flat rows (OLD Layout.jsx:443-454,:613-699,:521 / NEW :292-293) — fix: port the two container kinds. (HIGH)
7. **P3** — Bookkeeping item order deviates from OLD's frequency order (OLD: Approvals→Payments→Ledger→…, navConfig.jsx:118-178; NEW: Add Invoice first, Payments after Ledger, report pages interleaved, Layout.jsx:277-296) — fix: reorder. (MED)
8. **P3** — Nav definition is an inline Layout array again — the exact drift-prone shape OLD retired into navConfig.jsx (:49-63) with Settings + ⌘K consumers; NEW has no shared module or `synonyms` vocabulary — fix: extract to a navConfig consumed by Layout/Settings/search. (MED)
9. **P3** — BottomNav parity: Releases tab dropped (for Chat), visibility window `sm:hidden`→`lg:hidden` (640→1024px), Finance target `/bk/ledger` fixed → first-viewable fallback (OLD BottomNav.jsx:5-26 / NEW BottomNav.jsx:12-23) — fix: decide 5-tab set incl. Releases or log as accepted. (MED — Chat slot is a NEW-feature trade CLAUDE.md acknowledges)
10. **P3** — Boom Billing copy-address button missing (OLD Layout.jsx:766-789); NEW has per-label remittance data in `labels.invoice_settings` to source it — fix: cadence Layout.jsx footer button reading invoice_settings. (LOW — OLD hardcodes Boom's address; generic feature still absent)
11. **P3** — Vendor Form copy link relocated from the nav body to the footer and gated `isApprover` (OLD ungated, Layout.jsx:742-762 / NEW :381-393) — fix: drop gate or confirm intent. (LOW)
12. **P3** — `external: true` nav-item support (`<a target="_blank">`) absent (OLD navConfig.jsx:240, Layout.jsx:728-731) — fix: only needed when a vendor-lab-style page ports. (LOW)

Intentional divergences (not defects): workspace logo/initials/name/tagline replacing the "boom." wordmark + "Powered by Cadence" footer (multi-tenant branding, NEW :325-344,:412-415); NEW-feature nav items Messages (+live unread badge), Team Work, Brand, Marketing, Requests & feedback; badge endpoint moved to label-scoped `/ledger/pending-count` and gated to approvers; announcements/chat fetches in the shell.

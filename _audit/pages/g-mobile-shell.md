# g-mobile-shell — BottomNav, FAB, sheets, breakpoints, mobile CSS (global surface)

OLD: `boom-dashboard/client/src/components/BottomNav.jsx` (56L) + `FAB.jsx` (70L+) + `ui/BottomSheet.jsx` + `components/mobile/` (FilterSheet, LedgerCard, LedgerEntrySheet, PaymentCard, PaymentSheet) + `hooks/useIsMobile.js` + ~160 lines of global mobile CSS (`index.css:131-302`) + Layout edge-swipe (`Layout.jsx:397-412`).
NEW: `cadence/client/src/components/BottomNav.jsx` (36L) + `Fab.jsx` (49L) + `ui/BottomSheet.jsx` + `hooks/useIsMobile.js` + 14 lines of mobile CSS (`index.css:69-83`) + inline card branches in Ledger.jsx/Payments.jsx + mobile handling in `components/mywork/`.

Route & permissions: global surface. Both BottomNav/FAB permission-filter via `canView` (OLD BottomNav.jsx:22, FAB.jsx:26 / NEW BottomNav.jsx:12-18, Fab.jsx:13-17).

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md` (incl. the Layout content-padding release point `sm:pb-8` vs `lg:pb-8`, already noted there).

## 1. Layout & structure

**Chrome breakpoints.** Both collapse the sidebar at 1023px (OLD Layout.jsx:370 / NEW Layout.jsx:187) and both switch dense pages to cards at 767px (OLD hooks/useIsMobile.js default + doc comment "tablets keep the full editing tables" / NEW hooks/useIsMobile.js:6). But the bottom chrome differs: OLD shows BottomNav + FAB **only <640px** (`sm:hidden`, BottomNav.jsx:26, FAB.jsx:34; mounted unconditionally, Layout.jsx:913-914); NEW shows them **<1024px** (`lg:hidden` + mounted only when `isMobile` — the 1023px query — Layout.jsx:493-494, BottomNav.jsx:23, Fab.jsx:24). OLD tablets (640-1023px) get hamburger-only chrome; NEW tablets get the phone chrome.

**Sidebar on mobile**: both are an overlay + `-translate-x-full` slide (OLD Layout.jsx:575-585 / NEW Layout.jsx:314-321), closed on route change (NEW :194; OLD equivalent). OLD adds **edge-swipe**: touchstart <30px from the left edge + 60px right drag opens; 60px left drag closes (Layout.jsx:397-412). NEW has zero touch handlers in Layout — swipe gone.

**Viewport meta**: identical `width=device-width, initial-scale=1.0, viewport-fit=cover` (OLD index.html:8 / NEW index.html:8).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| BottomNav tabs | Home / My Work / Releases / Finance(→`/bk/ledger`) + More | Home / Chat / Work / Finance(first of `/ledger`,`/payments`,`/financials`,`/approvals` the user may view) + More — **Releases tab dropped, Chat added** | OLD BottomNav.jsx:5-10 / NEW :12-18 |
| BottomNav surface | `bg-white border-gray-200` (raw colors), h-14, inline `env(safe-area-inset-bottom)` | `bg-card border-rule` h-14 `.safe-bottom` | OLD :26-29 / NEW :23 |
| Tab anatomy | icon 20, stroke 2/1.5, 10px semibold, active `text-boom-600` | icon 19, stroke 2.2/1.8, 10px medium, active `text-brand-600` (RC-2) | OLD :41-42 / NEW :26-27 |
| FAB button | 56px, `bg-boom-600`, opens → `bg-gray-900 rotate-45`, `active:scale-90` | 56px, `bg-brand-600`, opens → same circle w/ X, `active:scale-95` | OLD FAB.jsx:61-68 / NEW Fab.jsx:40-46 |
| FAB actions | pill w/ colored 28px icon circle (blue/violet/emerald), `bg-white shadow-lg` | flat pill `bg-card border-rule shadow-modal`, brand-tinted icon 16 | OLD :42-56 / NEW :29-36 |
| FAB backdrop | `bg-black/20` | transparent (`fixed inset-0 -z-10`, no dim) | OLD :41 / NEW :27 |
| FAB position | `bottom-20 right-4` + safe-area margin | `right-4`, `bottom: calc(3.5rem + safe-area + 1rem)` | OLD :34-35 / NEW :24 |
| BottomSheet | portalled, `rounded-t-2xl max-h-[85dvh]`, sheet-up anim, safe-area padding, grab handle | visually identical; Escape via useEscapeStack instead of a local listener | OLD ui/BottomSheet.jsx:31-40 / NEW :24-45 |

## 3. Copy & content differences

- FAB labels: "New Task / Add Release / Add Invoice" (OLD FAB.jsx:23-25) → "New task / Add release / Add invoice" (NEW Fab.jsx:14-16).
- BottomNav labels: "My Work" → "Work"; "Releases" label gone; "Chat" added (OLD :7-9 / NEW :15-17).
- NEW BottomNav's own doc comment claims "Home / My Work / Releases / Finance / More" (BottomNav.jsx:5-6) — the code renders no Releases tab; comment drift. Likewise CLAUDE.md's claim that the mobile Chat tab carries a live unread badge is false: neither BottomNav.jsx nor its mount (Layout.jsx:493) passes any badge — the unread badge exists only in the sidebar nav (Layout.jsx:242,:367-368).

## 4. Feature & interaction differences

### Bottom chrome

- **Releases tab dropped from BottomNav** (OLD :8) — mobile users reach Releases only through More→sidebar or the FAB's "Add release". Chat replacing it is an [INT]-adjacent product change (messaging is NEW-only), but the slot loss is real.
- **Finance tab fallback** — NEW resolves the first visible bookkeeping page (:12) vs OLD's fixed `/bk/ledger` gated by canView (:22). NEW improvement, keep.
- **FAB "New Task" deep-link lost**: OLD navigates to `/my-work?new=task` and MyWork opens the add-task form on mount (FAB.jsx:23, MyWork.jsx:275-281). NEW navigates to bare `/my-work` (Fab.jsx:14) and no `?new` handling exists in TaskSurface/MyWork (grep verified) — the action is a plain nav pretending to be a create action.
- **FAB backdrop dim lost** (OLD :41 `bg-black/20` / NEW :27 transparent) — open state is less legible over busy pages.

### Edge-swipe sidebar

- OLD Layout.jsx:397-412; NEW absent (no touchstart/touchend anywhere in cadence Layout.jsx or components — grep verified).

### Sheets

- OLD `components/mobile/FilterSheet.jsx` (BottomSheet wrapper w/ active-count title, Clear all + Done footer, FilterField labeled rows) used by Ledger + Payments mobile branches (BkLedger.jsx:28,:2936-3026; BkPayments.jsx:19,:3008-3044) with a sticky "Filters (n)" toolbar button (BkLedger mobile branch :2873-2891 rel; BkPayments :2908-2918 rel). NEW has **no FilterSheet** — mobile Ledger/Payments render the full desktop filter toolbar wrapped.
- OLD detail sheets: `LedgerEntrySheet` (BkLedger.jsx:3029), `PaymentSheet` (BkPayments.jsx:3047) — purpose-built bottom-sheet detail w/ actions. NEW: Ledger card tap opens the desktop right-side drawer (`w-full max-w-md h-full`, LedgerEntryDrawer.jsx:110-111) — functional but not sheet-form; **Payments cards have no detail surface at all** (Payments.jsx:270-300s — checkbox + quick actions only, no tap-through).
- OLD `FlagButton` uses BottomSheet on mobile; NEW's mywork `Popover` degrades to BottomSheet (Popover.jsx:24) and TaskToolbar/TaskSurface use sheets (:381-426) — NEW-only additions, keep.

### Card layouts <768px — full enumeration

| Page | OLD | NEW |
|---|---|---|
| Ledger | ✓ full mobile branch: LedgerCard list, sticky search+Filters(count)+Undo toolbar, FilterSheet (10 filters), LedgerEntrySheet (BkLedger.jsx:2821-3030) | ✓ inline card list + quick actions + sticky per-currency totals card above BottomNav (Ledger.jsx:430-470) — no filter sheet, drawer for detail |
| Payments | ✓ full mobile branch: stat cards, PaymentCard, FilterSheet (5 filters), PaymentSheet (BkPayments.jsx:2843-3050) | ✓ inline card list w/ bulk-select + quick actions (Payments.jsx:270-300s) — no filter sheet, no detail sheet |
| Approvals | ✓ inline responsive pass — padding/toolbar/full-width controls via `isMobileView` (BkApprovals.jsx:131,:726-784,:1943-2060) | ✗ — no mobile handling in Approvals.jsx |
| My Work / Team Work | (OLD MyWork predates the rework) | ✓ NEW-only: dnd disabled <768px, calendar falls back to bucket list, popovers→sheets (TaskSurface.jsx:152,:321,:330) — keep |
| Everything else | app-wide CSS shims (§ below) | nothing |

### The global mobile CSS layer (OLD index.css:131-302 vs NEW :69-83)

OLD ships an app-wide `@media (max-width:768px)` + `480px` + coarse-pointer layer NEW almost entirely lacks:

| Shim | OLD | NEW |
|---|---|---|
| Touch press feedback (`scale(0.97)` on active, coarse-pointer-scoped) | :136-145 | ✗ |
| **`button, a { min-height: 36px }`** — universal touch targets | :192 | only `.btn-primary/.btn-secondary/.input` get `min-height:40px` (:79-80); raw icon buttons (the majority) get nothing |
| Grid collapse (`grid-cols-2..6` → 1col; stat grids → 2×2; 480px → 1col) | :152-163,:280-289 | ✗ |
| Table shrink (12px font, 8px padding) + scroll-edge mask gradient | :166-173 | ✗ |
| h1/text-3xl downscale | :176,:291-292 | ✗ |
| Input `max-width:100%` vs inline-styled 260px toolbars | :180-189 | partial — only `date`/`number` inputs (:82) |
| Card padding reduction, task-row bump, campaign icon-strip widening | :195-207 | ✗ |
| Modal width caps (`max-w-* → calc(100vw-2rem)`) for hand-rolled dialogs | :213-218 | ✗ (kit Modal is fine; the ~21 hand-rolled overlays aren't) |
| Deal kanban → horizontal snap-scroll w/ 240px columns | :246-260 | ✗ — NEW Deals stacks `grid-cols-1 md:2 xl:3` (Deals.jsx:108); NEW's `.snap-x-mandatory` utility (:74-75) has **zero consumers** (grep verified) |
| Recharts min-width scroll floor (400px, released <480px) | :241-243,:277-278 | ✗ |
| Payments 5-col stat grid → 2×2 | :263-265 | ✗ |
| Print styles (hide chrome, card borders) | :305-313 | ✗ |

Not counted: OLD `PullToRefresh.jsx` + `LongPressMenu.jsx` + `.ptr-*` CSS (index.css:113-129) have **zero consumers in OLD** (grep verified) — dead code, no parity obligation.

## 5. Data layer differences

None — mobile shell is pure client chrome. NEW's Finance-tab fallback makes one extra `canView` sweep (client-side). No endpoints involved.

## 6. Tables & forms (if present)

Covered per-page (ledger.md, payments.md); this surface owns only the card/table switch mechanics (§4).

## 7. Defects found

1. **P2** — Edge-swipe sidebar gone: open from left-edge swipe, close on left drag (OLD Layout.jsx:397-412; NEW Layout.jsx has no touch handlers) — fix: port the two listeners into cadence Layout.jsx around :194. (HIGH)
2. **P2** — Global touch-target rule lost: OLD `button, a { min-height:36px }` under 768px (index.css:192) vs NEW covering only `.btn-primary/.btn-secondary/.input` (index.css:79-80) — every raw icon button (row actions, nav chevrons, chips) is a sub-36px target on phones — fix: add the universal rule (or the coarse-pointer variant) to cadence index.css:78. (HIGH)
3. **P2** — Mobile FilterSheet pattern gone on Ledger + Payments: sticky "Filters (n)" button + bottom-sheet with labeled fields + Clear all/Done (OLD components/mobile/FilterSheet.jsx; BkLedger.jsx:2936-3026; BkPayments.jsx:3008-3044) — NEW mobile branches keep the desktop filter toolbar — fix: port FilterSheet (ui/BottomSheet already exists) into Ledger.jsx:430 / Payments.jsx:270 branches. (HIGH)
4. **P2** — Payments mobile cards have no detail surface: OLD card tap opens PaymentSheet w/ full record + actions (BkPayments.jsx:2926,:3047); NEW cards expose only checkbox + 2-3 quick actions (Payments.jsx:270-300s) — fix: tap-through to a sheet or the entry drawer. (HIGH)
5. **P2** — App-wide mobile CSS layer missing: grid collapse, table shrink + scroll mask, modal width caps, h1 downscale, input max-width, card padding, press feedback, print styles (OLD index.css:131-302 vs NEW :69-83) — every non-carded page (Dashboard, Financials, Reports, Vendors, Settings…) renders desktop layouts squeezed onto phones — fix: port the 768px/480px/coarse-pointer blocks, adapted to NEW tokens. (HIGH; per-page visual outcomes UNVERIFIED — needs runtime check)
6. **P3** — Releases tab dropped from BottomNav (OLD BottomNav.jsx:8 / NEW :13-18 — slot given to Chat) — fix: either a 5th tab is impossible (More is fixed), so decide Releases-vs-Chat deliberately; also fix the stale comment BottomNav.jsx:5-6. (MED — Chat is a NEW-only feature, but OLD-is-truth)
7. **P3** — FAB "New task" lost its deep-link: `/my-work?new=task` auto-opened the form (OLD FAB.jsx:23, MyWork.jsx:275-281); NEW navigates bare (Fab.jsx:14) with no `?new` handling — fix: add `?new=task` param handling in TaskSurface and pass it from Fab. (HIGH)
8. **P3** — Approvals lost its mobile pass: toolbar wrap, full-width search, tap-sized action buttons (OLD BkApprovals.jsx:131,:726-784,:1943-2060; NEW Approvals.jsx has no isMobile use) — fix: responsive pass or card branch. (HIGH)
9. **P3** — Deal kanban mobile snap-scroll lost (OLD index.css:246-260 flex + snap + 240px cols; NEW stacks to one column, Deals.jsx:108) and NEW's own `.snap-x-mandatory` helper (index.css:74-75) is consumer-less — fix: apply the helper to the Deals board. (MED)
10. **P3** — FAB open-state backdrop dim dropped (`bg-black/20` OLD FAB.jsx:41 / transparent NEW Fab.jsx:27). (HIGH)
11. **P3** — Bottom chrome breakpoint widened 640→1024px: OLD tablets get desktop-style chrome (BottomNav.jsx:26 `sm:hidden`); NEW gives tablets phone chrome (BottomNav.jsx:23 `lg:hidden`, Layout.jsx:493) — NEW is self-consistent (content padding `pb-20 lg:pb-8` matches), so possibly deliberate. (LOW confidence — deviation logged per OLD-is-truth)

Intentional divergences (not defects): Chat tab existence (messaging is NEW-only), Finance-tab permission fallback (BottomNav.jsx:12), tokenized surfaces (`bg-card/border-rule` — NEW is the corrected form per 01-design-system §Layout), BottomSheet Escape via the shared escape stack, and the mywork mobile suite (Popover→sheet, dnd-off, calendar fallback) which has no OLD counterpart.

# g-modal-overlay-primitives — overlay/dialog anatomy (global surface)

OLD: no kit — 39 hand-rolled `fixed inset-0` overlays across pages/components (grep), ad-hoc Escape keydowns in 34 files, scroll lock only in `ui/BottomSheet.jsx:21-25`, `aria-modal` only on BottomSheet (:32).
NEW: `cadence/client/src/components/ui/Modal.jsx` (59L) + `ui/ConfirmDialog.jsx` (43L) + `hooks/useEscapeStack.js` + `hooks/useFocusTrap.js` — plus 21 page-level and ~17 component-level `fixed inset-0` sites still hand-rolled.

Route & permissions: global surface — no permission dimension.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`. Architecture verdict (NEW ahead: portal, focus trap, Escape stack, scroll lock) is already adjudicated there (§Shared UI primitives) — this pass compares **rendered anatomy** and NEW's internal consistency only.

## 1. Layout & structure

**OLD** hand-rolled pattern (modal exemplar `Duplicates.jsx` split dialog): backdrop `fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6` with `onClick`-to-close guarded by save-in-flight; panel `bg-card rounded-2xl shadow-2xl w-full max-w-* p-6` + `stopPropagation`; `h3` title + muted subline; no X button, no portal, no focus management, page scrolls behind. Backdrop census (39 sites): `bg-black/40 …` ×10, `bg-overlay` variants ×8 (3 of them `items-start pt-8 overflow-y-auto` tall-form scrollers), `bg-black/30` ×2 (+1 pointer-events-none), `bg-black/60` ×3, `backdrop-blur-sm` ×3 (PendingContracts.jsx:76, Settings.jsx:1841, Releases/AddReleaseModal.jsx:40), bare click-catcher `fixed inset-0 z-50` ×2 (RecoupmentsPlanning.jsx:1708, LongPressMenu.jsx:55), one z-[85]/z-[100] outlier each.

**NEW** kit: `Modal` portals to body — backdrop `fixed inset-0 z-[60] bg-overlay flex items-center justify-center p-4` with click-to-close (Modal.jsx:35); panel `.card w-full max-w-{sm|md|lg|2xl} max-h-[90vh] overflow-y-auto p-5` + `role=dialog aria-modal aria-labelledby` + focus trap + body scroll lock (:16,:21-30,:36-43); optional title row (`h2 font-bold` + X 18 `aria-label="Close"`, :45-52) and footer slot `flex justify-end gap-2 mt-5` (:54). `ConfirmDialog` = Modal size-sm with Cancel/Confirm Buttons, initial focus deliberately on **Cancel**, `busy` in-flight state (ConfirmDialog.jsx:16-36).

**NEW hand-rolled remainder** (not on the kit): pages — Ledger ×4, ArtistCampaignDetail ×4, Payments ×2, CreateLabelWaiver ×2, BankStatements ×2, Vendors/PlatformOperators/Messages/Deals/Creators/Calendar/ArtistProfile ×1 each (21 sites); components — DrillModal ×2, WorkspaceDrawer, UserManual, SplitModal, ReviewDeck, PlatformLayout, TaskDrawer, Popover, LedgerEntryDrawer, Layout (sidebar backdrop — legit), KeyboardShortcutsHelp, GlobalSearch, Fab, EmailPreviewModal, CampaignChat (grep census). Kit adopters: only `pages/Payments.jsx`, `mywork/TaskSurface|TaskDrawer|TaskToolbar`, `reports/PnlTable.jsx` (grep Modal/ConfirmDialog imports).

## 2. Visual differences

| Element | OLD (dominant hand-rolled) | NEW (kit Modal) | Source |
|---|---|---|---|
| Backdrop tint | `bg-black/40` most common (×10); mixes of /30, /60, `bg-overlay`; 3 dialogs add `backdrop-blur-sm` | uniform `bg-overlay` = rgba(24,24,27,.5) light / rgba(0,0,0,.6) dark; **no blur anywhere** (grep: 0) | OLD census above / NEW Modal.jsx:35, tokens.css:28,:103 |
| Backdrop padding | `p-6` dominant | `p-4` | OLD Duplicates exemplar / NEW :35 |
| Panel | `bg-card rounded-2xl shadow-2xl p-6` | `.card` (= rounded-2xl shadow) `p-5` | OLD exemplar / NEW :43 |
| Panel radius | rounded-2xl ×22, xl ×5, lg ×3 (hand-rolled census) | `.card` rounded-2xl — parity with OLD's dominant | RC-6 applies to Card, not here |
| Width ladder | max-w-md ×7, 3xl ×6, 2xl ×4, xl ×3, 4xl ×3, lg ×2, sm ×1 | kit ladder sm/md/lg/**2xl max** (Modal.jsx:16); hand-rolled NEW sites go to 4xl ×4, 5xl ×1 | grep census both |
| Height | usually unconstrained; 3 tall forms use `items-start + page overflow-y-auto` | `max-h-[90vh] overflow-y-auto` (panel scrolls internally) | NEW :43 |
| Title row | ad-hoc `h3` sizes, often no close X | standardized `h2 font-bold` + X 18 top-right | OLD exemplar / NEW :45-52 |
| Footer | ad-hoc per dialog | standardized right-aligned `gap-2 mt-5` slot | NEW :54 |
| Confirm dialog | `window.confirm()` native chrome (116 sites) | styled ConfirmDialog, focus-on-Cancel, busy label "Working…" | OLD grep / NEW ConfirmDialog.jsx:8-34 |

## 3. Copy & content differences

ConfirmDialog defaults: title "Are you sure?", confirm "Delete", cancel "Cancel", busy "Working…" (ConfirmDialog.jsx:13-14,:34) — OLD equivalents were per-site `window.confirm('…?')` strings. No other global copy on this surface.

## 4. Feature & interaction differences

- **Escape**: OLD — ad-hoc `key === 'Escape'` keydowns in 34 files, no coordination (drawer + page can both fire — the incident NEW's stack fixed, per cadence CLAUDE.md). NEW kit — LIFO capture-phase `useEscapeStack` (consumers: Modal, BottomSheet, TaskDrawer, Popover, ReviewDeck, TaskToolbar). **But NEW's hand-rolled overlays mostly handle no Escape at all**: grep "Escape" = 0 in 8 of 11 overlay-bearing pages sampled (ArtistCampaignDetail, Payments, CreateLabelWaiver, BankStatements, Vendors, Creators, Calendar + ArtistProfile; Ledger/Deals/Messages have 1 hit each) — those dialogs close only via backdrop click/buttons, a regression vs OLD's ad-hoc-but-present coverage.
- **Click-outside**: both sides close on backdrop click with `stopPropagation` on the panel (OLD ~37/39 sites have onClick on/adjacent to the backdrop — approximate line-window grep; NEW Modal.jsx:35,:42 and hand-rolled sites e.g. Vendors.jsx:75, EmailPreviewModal.jsx:63 via absolute backdrop child). Parity.
- **Scroll lock**: OLD only BottomSheet (ui/BottomSheet.jsx:21-25) — every hand-rolled OLD modal lets the page scroll behind. NEW locks in Modal/BottomSheet/TaskDrawer (grep `body.style.overflow`); NEW hand-rolled sites don't — same class of gap as OLD, no regression.
- **Focus**: OLD has zero focus management (grep aria-modal → BottomSheet only, and it declared without trapping). NEW kit traps + restores (`useFocusTrap`, Modal.jsx:21,:37-41); NEW hand-rolled sites have none.
- **Stacking**: OLD near-uniform `z-50` (outliers z-[70]/[85]/[100]). NEW spans z-30 (Layout backdrop) / z-50 / z-[60] kit / z-[65] / z-[70] / z-[75] / z-[80] across hand-rolled sites (backdrop census) — an implicit ladder with two hand-rolled `z-50` dialogs that would stack **under** a kit Modal (z-[60]) if ever concurrent.
- **NEW-only kept**: ConfirmDialog focus-on-Cancel rationale (:8-10), `busy` in-flight disable, aria labelling, portal escape from overflow contexts.

## 5. Data layer differences

None — pure client surface.

## 6. Tables & forms (if present)

Not applicable (dialog chrome only; per-dialog forms are covered in per-page passes).

## 7. Defects found

1. **P2** — Kit adoption gap (internal inconsistency): 21 page sites + ~16 non-ui component sites still hand-roll `fixed inset-0` overlays with no Escape (0 grep hits in 8 of 11 overlay-bearing pages), no focus trap, no scroll lock, no portal — while the drop-in kit exists (Modal.jsx:7-14 says so itself); part-blocker: kit width ladder tops out at `max-w-2xl` (Modal.jsx:16) so the 5 hand-rolled 4xl/5xl dialogs *can't* migrate — fix: extend WIDTHS w/ 3xl/4xl/5xl + migrate sites (start: Ledger.jsx ×4, ArtistCampaignDetail.jsx ×4). (HIGH)
2. **P3** — 37 `window.confirm` sites remain despite ConfirmDialog shipping with only 3 adopters (TaskDrawer, TaskToolbar, PnlTable) — native blocking chrome, unstylable, no busy state (grep census; worst: WorkspaceDrawer.jsx ×3, PendingContracts.jsx ×2, Ledger.jsx ×2) — fix: mechanical swap to ui/ConfirmDialog. (MED — OLD has 116, so not a parity regression; filed as internal inconsistency)
3. **P3** — `backdrop-blur-sm` dropped app-wide: OLD blurs behind 3 dialogs (PendingContracts.jsx:76, Settings.jsx:1841, Releases/AddReleaseModal.jsx:40); NEW has zero backdrop-blur (grep) — fix: add to the NEW equivalents or accept standardization and log. (HIGH that it differs; P3 cosmetic)
4. **P3** — Backdrop dim drift: OLD's most common dialog dims at `bg-black/40` (×10) with /30 and /60 variants; NEW standardizes everything to `bg-overlay` ≈ 50% (Modal.jsx:35 + hand-rolled census) — every common dialog is ~10% darker behind than OLD's dominant form — fix: none recommended (NEW's uniformity is the corrected form, cf. 01-design-system Layout-shell note); recorded per OLD-is-truth. (LOW)
5. **P3** — Anatomy drift on the standardized dialog: backdrop padding p-6→p-4, panel padding p-6→p-5, title h3→h2 + always-present X, forced `max-h-[90vh]` internal scroll vs OLD's occasional page-scroll tall forms (OLD Duplicates exemplar / NEW Modal.jsx:35-54) — fix: only if pixel parity is the goal. (MED)
6. **P3** — NEW z-index ladder is implicit and inconsistent across hand-rolled sites (z-50…z-[80] census) vs OLD's near-uniform z-50; two NEW z-50 dialogs would stack under a kit Modal (z-[60]) if concurrent — fix: fold into defect-1 migration. (LOW — no concrete concurrent pair identified; STILL UNVERIFIED — needs a browser AND a concrete concurrent pair, which the audit itself never identified. Left open as written)

Intentional divergences / kept: the kit itself (portal, useEscapeStack LIFO capture, useFocusTrap, scroll lock, aria) — architecturally ahead, per 01-design-system.md; ConfirmDialog's focus-on-Cancel + busy state are NEW-only improvements to keep.

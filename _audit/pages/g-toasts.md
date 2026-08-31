# g-toasts — toast / notification-feedback system (global surface)

OLD: `boom-dashboard/client/src/context/ToastContext.jsx` (68L, mounted main.jsx:30) **plus** a second, richer local toast system hand-rolled inside 5 finance pages (`BkLedger.jsx` `showToast` :1733-1739 et al.), **plus** ~217 raw `alert()` call sites.
NEW: `cadence/client/src/context/ToastContext.jsx` (48L, mounted main.jsx:34) — the single app-wide system.

Route & permissions: global surface — provider wraps the whole tree on both sides; no permission dimension.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md` (RC-6 radius does not apply — both toast cards are `rounded-xl`).

## 1. Layout & structure

**OLD** has **three parallel feedback systems**:
1. Global `ToastContext` — container `fixed bottom-6 right-6 z-[999] flex flex-col gap-2 pointer-events-none` (ToastContext.jsx:39); solid color-coded cards `min-w-[280px] max-w-[400px] rounded-xl shadow-lg` with white text + white icon at `opacity-80` + X dismiss (:44-56). Consumers: only 5 pages (`RecoupmentsAudit`, `BkPayments`, `Recoupments`, `ArtistCampaigns`, `ArtistBudgetSheet` — grep `useToast`), 26 bare `toast()` + 63 `toast.error()` calls.
2. Local `showToast(msg, isError, undoFn)` state machines in `BkLedger`/`BkApprovals`/`BkBulkDeals`/`BkAddInvoice`/`BkAddReimbursement` (grep `setToast|showToast`): BkLedger renders it twice — mobile `fixed left-3 right-3 bottom-20 sm:bottom-6 z-[80]` with `marginBottom: env(safe-area-inset-bottom)` (:3046-3061) and desktop inline-style `fixed bottom-24/right-24 z-999` (:4974-4981); inline **Undo button** when `undoFn` present (`bg-white/20 text-white text-[12px] font-bold`, :3052-3058); background `#dc2626` error / `#111` undo / `#16a34a` success (:3049).
3. ~217 `alert()` and ~116 `confirm()` call sites across pages/components (grep) — the *dominant* feedback path in OLD by volume.

**NEW** has exactly one system: `ToastContext` container `fixed bottom-6 right-6 z-[100] flex flex-col gap-2` (ToastContext.jsx:24); neutral card `bg-card border border-rule shadow-modal rounded-xl px-4 py-3 min-w-[260px]` with colored status icon + X dismiss (:28-36). 58 consumer files, 461 `toast()` calls, **0 `alert()`** (37 `window.confirm` remain — see g-modal-overlay-primitives).

## 2. Visual differences

| Element | OLD (global context) | NEW | Source |
|---|---|---|---|
| Card surface | solid per-type: `bg-emerald-600` / `bg-red-600` / `bg-gray-800`, white text | always `bg-card border-rule shadow-modal`, `text-ink`; only the icon is colored (`text-success`/`text-danger`) | OLD :6-10,:46 / NEW :28-33 |
| Icon | CheckCircle2/AlertCircle/Info 16, white `opacity-80` | CheckCircle2/AlertTriangle 16, colored | OLD :2,:48 / NEW :2,:30-32 |
| Text | `text-sm font-medium` white | `text-sm text-ink` (no weight) | OLD :49 / NEW :33 |
| Width | `min-w-[280px] max-w-[400px]` | `min-w-[260px]`, **no max-width** — long messages stretch arbitrarily | OLD :46 / NEW :28 |
| Entrance | `animate-slide-in` 0.25s ease-out (index.css:315-320) | none — pops in | OLD :46 / NEW :28 |
| z-index | `z-[999]` | `z-[100]` (still above Modal `z-[60]` / BottomSheet `z-[70]` — safe) | OLD :39 / NEW :24 |
| Container events | `pointer-events-none` + per-toast `pointer-events-auto` | none declared | OLD :39,:46 / NEW :24 |
| Dismiss X | `opacity-60 hover:opacity-100 transition-opacity`, X 14 | `text-gray-400 hover:text-gray-600`, X 14 | OLD :50-55 / NEW :34-36 |
| Undo toast (OLD local system) | black `#111` bar w/ white `Undo` pill button, mobile full-width above BottomNav + safe-area | no action-capable toast exists | OLD BkLedger.jsx:3046-3061 / — |

Position parity: both anchor `bottom-6 right-6`, newest at the bottom of a `gap-2` column, unbounded stack, no dedup — same on both sides.

## 3. Copy & content differences

Toast copy is per-call-site (out of scope for a global pass). Structural copy: OLD undo toasts label the button "Undo" (BkLedger.jsx:3057); NEW's ledger substitute reads "Edited {label}" + "Undo (z)" (Ledger.jsx:549-550) and TaskSurface's reads "· press z to undo (n)" (TaskSurface.jsx:472).

## 4. Feature & interaction differences

- **API shape**: OLD provider value is the callable `toast(msg)` with `.success/.error/.info` methods (ToastContext.jsx:29-32); NEW value is `{ toast }` with `toast(msg, type)` (:15-22). Internal-only; no rendered impact, but any code ported from OLD calling `toast.error()` would throw in NEW.
- **Variants**: OLD success/error/**info** (gray-800) with unknown types falling back to info style (:41); NEW renders error vs everything-else-as-success (:30-32) — no info/neutral variant. (`toast.info` has zero OLD call sites — latent capability only.)
- **Durations**: OLD 3000ms success/info, 5000ms error, and `duration <= 0` yields a **persistent** toast (:15-22,:31); NEW hardcodes 4000ms for everything, no duration parameter, no persistent option (:18).
- **Undo-action toasts**: OLD's finance-page system takes `undoFn` → renders an Undo button, extends the window to 5000ms (vs 2800ms), and **clears the prior timer** so a follow-up toast can't cut an open Undo window short (BkLedger.jsx:1733-1739; the revert deliberately bypasses the stale-closure `handleUndo`, :1742-1761). NEW has no action slot on any toast; NEW Ledger replaces the pattern with a *persistent* bottom-LEFT bar shown while `undoStack` is non-empty (Ledger.jsx:547-552) — different position (collides visually with nothing but reads as chrome, not feedback), no timed window (arguably safer), and NEW mywork surfaces expose undo only as a footer hint + `z` hotkey (TaskSurface.jsx:218,:472).
- **Mobile**: OLD's ledger toast moves to `bottom-20` full-width + safe-area inset so it clears the mobile BottomNav (BkLedger.jsx:3048-3049); NEW toasts stay `bottom-6 right-6` at `z-[100]` and will sit **on top of** NEW's own BottomNav (`z-30`, BottomNav.jsx:23) with no safe-area handling.
- **Consolidation**: NEW routed *all* feedback through the one context — 0 `alert()` vs OLD's ~217; OLD's global context reached only 5 pages while everything else alert()ed. **[INT-adjacent improvement, not a defect]** — but it raises the stakes on the NEW context's missing capabilities above, since it is now the only channel.

## 5. Data layer differences

None — pure client surfaces, no endpoints. ID generation differs (OLD `Date.now()+Math.random()` :16; NEW module counter :6,:16) — no rendered impact.

## 6. Tables & forms (if present)

None on either side.

## 7. Defects found

1. **P2** — Undo-action toasts lost: no action/button slot in NEW's ToastContext, so OLD's toast-undo pattern (Undo button, 5s window, timer-clear guard, black variant — BkLedger.jsx:1733-1739,:3046-3061,:4974-4981) is unportable; NEW Ledger/TaskSurface fall back to static bars/hints (Ledger.jsx:547-552, TaskSurface.jsx:472) — fix: add `toast(msg, type, { action, duration })` to cadence ToastContext.jsx:15. (HIGH)
2. **P2** — Toast visual identity diverges: solid color-coded card w/ white text + slide-in animation + max-w-[400px] → neutral bg-card w/ colored icon, no animation, no max-width (OLD ToastContext.jsx:6-10,:46-49 + index.css:315-320 / NEW :28-33) — glance-readable severity color and entrance motion both gone, long messages stretch unbounded — fix: cadence ToastContext.jsx:28 restore per-type surfaces (or keep the card style deliberately and log), add `animate-slide-in` + max-width. (MED — plausibly a deliberate restyle, but not tenancy-caused)
3. **P3** — Duration/variant API loss: fixed 4000ms for all types vs 3000/5000/persistent-on-`duration<=0`; `info` variant dropped and unknown types render a success check (OLD :15-31 / NEW :15-19,:30-32) — fix: cadence ToastContext.jsx:15 accept duration + info style. (HIGH)
4. **P3** — Mobile: NEW toasts overlay the BottomNav (`bottom-6` at `z-[100]` over BottomNav `z-30`, no safe-area inset) where OLD's mobile toast lifts to `bottom-20` + `env(safe-area-inset-bottom)` (OLD BkLedger.jsx:3048-3049 / NEW ToastContext.jsx:24, BottomNav.jsx:23) — fix: ToastContext.jsx:24 responsive bottom offset + safe-bottom. (HIGH)
5. **P3** — Container drops `pointer-events-none` (OLD :39,:46 / NEW :24) — the empty flex column region is content-sized so exposure is minimal, but clicks in the gap between stacked toasts are swallowed — fix: ToastContext.jsx:24. (LOW)

Intentional/improvement (not defects): single unified system — 58 files/461 calls, 0 `alert()` vs OLD's three parallel systems and ~217 `alert()` sites; NEW's `z-[100]` still clears every NEW overlay. NEW's persistent undo bar is a defensible alternative to a timed toast window but is logged in defect 1 as the capability gap.

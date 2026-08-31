# g-keyboard-shortcuts — hotkey system, help modal, per-page bindings (global surface)

OLD: `boom-dashboard/client/src/hooks/useHotkeys.js` (66L) + `components/KeyboardShortcutsHelp.jsx` (192L, self-contained groups array) + 12 `useHotkeys([...])` page call sites + 6 raw-keydown deck/queue handlers.
NEW: `cadence/client/src/hooks/useHotkeys.js` (33L) + `constants/shortcuts.js` (64L registry) + `components/KeyboardShortcutsHelp.jsx` (37L, reads the registry) + 4 `useHotkeys({...})` sites (Deals, ReleaseDetail, TaskSurface, + registry) + 3 raw-keydown sites (Layout, Ledger, Approvals, StatementReviewDeck).

Route & permissions: global surface — `?` help + search shortcut live in the shell (OLD Layout.jsx:434 / NEW Layout.jsx:167-184); everything else is per-page.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md` (help-modal chrome: RC-6 radius applies to NEW's `rounded-2xl` panel).

## 1. Layout & structure

**OLD hook** (`useHotkeys.js`): array of `{ key, meta?, shift?, handler }`. Supports **meta (⌘/Ctrl) and shift combos** — meta shortcuts fire even while typing in a field (:19-21 comment, :40-44); non-meta suppressed in inputs (:52); unintended Shift+letter blocked (:48). **NEW hook** (`useHotkeys.js:15-31`): plain `{ key: handler }` map, **bails on any meta/ctrl/alt** (:24) and on inputs (:23), case-sensitive `e.key` match. Consequence: NEW's hook **cannot express OLD's ⌘-combos** (Create Invoice's ⌘Enter/⌘⇧L/⌘P have no porting path without a raw listener) — the limitation is documented in TaskSurface.jsx:213-214.

**Help modal**: OLD is a hardcoded inline-styled overlay with its own `SHORTCUT_GROUPS` (KeyboardShortcutsHelp.jsx:28-119) that can (and does) drift from the wired keys. NEW reads a single shared registry `constants/shortcuts.js` consumed by both the modal (:2,:16) and the in-app manual — architecturally better (registry comment :1-3), but the registry itself has gaps (§7 defect 8).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Help panel | inline-styled, `width:640`, `maxHeight:80vh`, sticky header + "ESC" pill button | tokenized `max-w-sm bg-card rounded-2xl shadow-modal p-5 max-h-[85vh]`, X icon 18 | OLD KeyboardShortcutsHelp.jsx:140-162 / NEW :9-13 |
| Group block | boxed list `#fafafa` + row dividers, 10px uppercase heading | unboxed `space-y-2` rows, 11px uppercase heading | OLD :164-186 / NEW :15-29 |
| Kbd chip | hardcoded `#f3f4f6` + `boxShadow: 0 1px 0`, 11px/700, ⌘-vs-Ctrl per `navigator.platform`, arrow/Enter glyph map | `bg-gray-100 border-rule rounded px-1.5`, 11px/semibold, keys stored as display strings (`'⌘'`,`'→'`) | OLD :3-26 / NEW :25 + shortcuts.js:8-25 |
| Overlay z | `zIndex: 9999` | `z-[70]` | OLD :135 / NEW :9 |

## 3. Copy & content differences

- Title: "Keyboard Shortcuts" (OLD :152) → "Keyboard shortcuts" (NEW :12).
- OLD groups: Global / Releases / Ledger / Deal Pipeline / Approvals / Create Invoice / Calendar / Catalog / Other Pages (:28-119). NEW groups: Global / Bank review deck / My Work / Ledger / Deal pipeline / Release detail (shortcuts.js:4-61). Six OLD groups have no NEW counterpart because the bindings are gone (§4).
- Neither side documents its deck keys fully: OLD's modal omits every deck/queue handler (bank-matching deck, reports deck, duplicates deck, vendor-dupe deck, vendor-flags queue); NEW's registry documents its one deck but omits the wired Approvals keys (defect 8).

## 4. Feature & interaction differences — full binding enumeration

Legend: ✓ = present, ✗ = absent, (t) = the action's UI target exists in NEW, only the key is unwired.

### Global shell

| Binding | OLD | NEW | Source |
|---|---|---|---|
| `?` toggle help | ✓ Layout.jsx:434 (skips INPUT/TEXTAREA/SELECT) | ✓ Layout.jsx:174 | parity |
| `⌘K` search | ✓ focuses inline header input, GlobalSearch.jsx:93-97 | ✓ toggles search modal, Layout.jsx:172 | parity (container differs — g-global-search defect 3) |
| `/` focus search | ✓ GlobalSearch.jsx:99-105 | ✗ | already logged as g-global-search defect 6 |
| `Esc` close search/overlays | ✓ GlobalSearch.jsx:106-109 + per-modal handlers | ✓ per-overlay via useEscapeStack (capture-phase LIFO) | NEW architecture ahead |
| `g` then `d/r/a/c/w` nav sequences | ✗ | ✓ Layout.jsx:175-180 (800ms window) | **[INT]** NEW-only addition, keep |

### Pages

| Page · binding | OLD | NEW | Source |
|---|---|---|---|
| Releases list `n` new release | ✓ Releases/index.jsx:150 | ✗ | NEW Releases.jsx has zero hotkeys |
| Releases list `v` toggle list/calendar | ✓ :151 | ✗ (t — toggle exists Releases.jsx:35,:147) | |
| Releases list `j`/`k` row focus | ✓ :152-153 | ✗ | NEW has no focused-row concept on the list |
| Releases list `Enter` expand/collapse | ✓ :154-159 | ✗ | NEW uses a separate detail route, no inline expand |
| Release tabs `1-7` | ✓ on expanded row, :160-164 | ✓ ReleaseDetail.jsx:38-42 (+ NEW-only `Esc` → back to list) | relocated parity |
| Ledger `z` undo | ✓ BkLedger.jsx:1425 | ✓ Ledger.jsx:216-224 | parity |
| Ledger `c` toggle columns panel | ✓ :1426 | ✗ (t — persisted column toggles exist, Ledger.jsx:151) | |
| Ledger `x` export | ✓ :1427-1433 (Excel of current lens) | ✗ (t — Export button exists, Ledger.jsx:270,:365) | |
| Approvals `j`/`k`/`a`/`r` | ✓ BkApprovals.jsx:200-203 | ✓ Approvals.jsx:131-134 (+ scrollIntoView :140) | parity; NEW only preventDefaults ⇧A |
| Approvals `⇧A` bulk approve | ✓ :204-212 → opens ApprovalChecklistDeck (deliberately replaces confirm, comment :205-208) | ✓ Approvals.jsx:130 → `window.confirm` (:64-67) | key parity; checklist-deck downgrade belongs to approvals.md |
| Deals `n` new deal | ✓ DealPipeline.jsx:84 | ✓ Deals.jsx:35 (+ NEW-only `Esc` closes drawer/form :36) | parity |
| Calendar `←`/`→` month | ✓ Calendar.jsx:124-125 | ✗ | |
| Calendar `t` today | ✓ :126 | ✗ | |
| Calendar `n` new event | ✓ :127 | ✗ (t — add-event form exists) | |
| Create Invoice `⌘Enter` submit | ✓ CreateInvoice.jsx:259 | ✗ | NEW hook can't express meta (§1) |
| Create Invoice `⌘⇧L` add line item | ✓ :260 | ✗ | |
| Create Invoice `⌘P` print/PDF | ✓ :261-264 | ✗ | |
| Catalog `s` sync artwork | ✓ Catalog.jsx:76 | ✗ (t — sync exists) | |
| Catalog `1-6` time presets | ✓ :77 (TIME_PRESETS ×6, :74) | ✗ | |
| Dashboard `r` refresh | ✓ Dashboard.jsx:347 | ✗ | |
| Team tasks `n` + `1-3` view modes | ✓ Team.jsx:53-54 (people/workload/velocity) | superseded — TaskSurface.jsx:215-236: `n`,`f`,`z`,`g`,`1-5`,`Esc` on /my-work + /team-work | **[INT]-adjacent**: NEW suite is richer; OLD Team's task views were reworked into TaskSurface by design (CLAUDE.md 2026-08-11) |
| Settings `n` add user | ✓ Settings.jsx:629 | ✗ | |
| Contracts `n` new contract | ✓ Contracts.jsx:130 | ✗ (t — new-contract modal exists) | |
| Activity History `s` toggle sort | ✓ ActivityHistory.jsx:246 | ✗ | |

### Review decks / queues (raw keydown)

| Deck · binding | OLD | NEW | Source |
|---|---|---|---|
| Bank/statement deck `→` accept · `←` skip · `1-9` category · `Esc` close | ✓ BkBankMatching.jsx:1711-1712,:1719-1724,:1718 | ✓ StatementReviewDeck.jsx:125-131 + Esc via ReviewDeck.jsx:15 (useEscapeStack) | parity |
| Bank deck `Backspace` step back/undo | ✓ :1713 | ✗ | NEW deck has no back-step |
| Bank deck `f` flag | ✓ :1714 | ✗ | |
| Bank deck `d`/`↓` dismiss | ✓ :1715 (both keys) | `d` only, StatementReviewDeck.jsx:127 | |
| Bank deck `n` book-no-invoice | ✓ :1716 | ✗ | |
| Bank deck `p` toggle preview | ✓ :1717 | ✗ | |
| Reports review deck `Esc`/`→`/`Enter`/`←`/`Backspace`/`f`/`d`/`p`/`1-9` | ✓ Reports.jsx:855-871 (with the typing guard, comment :857-862) | ✗ — NEW Reports.jsx has no deck/keydown at all | keys travel with the missing deck — cross-ref reports.md |
| Duplicates merge deck `Esc`/`Enter` merge/`n` reject/`←` skip/`p` preview | ✓ Duplicates.jsx:1485-1497 | ✗ — no deck on NEW DataQuality.jsx | cross-ref flags-data-quality.md |
| Vendor dupe deck `→` merge/`←` skip/`Backspace` back/`d` not-dupes/`Esc`/`1-2` pick winner | ✓ VendorDupeDeck.jsx:128-146 | ✗ — component absent | cross-ref vendors.md |
| Vendor flags queue `↓/j`·`↑/k` cursor, `→` merge, `s` swap, `c` custom name, `a` alias-only, `d/n` not-dupes | ✓ BkVendorFlags.jsx:136-143 | ✗ | cross-ref flags-data-quality.md |

### Hook semantics drift

- OLD blocks accidental `Shift+letter` firing lowercase bindings (useHotkeys.js:48); NEW matches `e.key` case-sensitively so `Shift+n` produces `'N'` and simply misses — equivalent outcome, different mechanism.
- OLD's non-meta input guard checks `document.activeElement` (:3-8); NEW checks `e.target` (:22-23) — equivalent.
- NEW `useHotkeys` takes a deps array (re-binds); OLD uses a ref and never re-binds — equivalent via `ref.current`.

## 5. Data layer differences

None — no persistence on either side (no endpoint, no localStorage). OLD's `x` export hotkey embeds the JWT in a `?token=` URL (BkLedger.jsx:1428-1432); NEW removed query-param token auth entirely (CLAUDE.md security pass 3), so a ported `x` must reuse the blob-download `exportCsv` (Ledger.jsx:270) — **[INT]** constraint, not a defect.

## 6. Tables & forms (if present)

No tables/forms beyond the help modal rows (§2).

## 7. Defects found

1. **P2** — Releases list hotkeys gone: `n` new release, `v` list/calendar toggle, `j`/`k` row focus, `Enter` expand (OLD Releases/index.jsx:149-165) — fix: cadence Releases.jsx add useHotkeys for n/v (targets exist :35,:147); j/k/Enter need a focused-row model or should navigate to detail. (HIGH)
2. **P2** — Ledger `c` (columns panel) + `x` (export) unwired though both targets exist (OLD BkLedger.jsx:1426-1433 / NEW Ledger.jsx:151,:270,:365 targets, :216-224 handler has only z) — fix: extend Ledger.jsx:220 handler + registry. (HIGH)
3. **P2** — Calendar hotkeys gone: `←`/`→` month, `t` today, `n` new event (OLD Calendar.jsx:123-128) — fix: cadence Calendar.jsx add useHotkeys. (HIGH)
4. **P2** — Create Invoice ⌘Enter submit / ⌘⇧L add line / ⌘P print gone (OLD CreateInvoice.jsx:258-265); NEW's useHotkeys architecturally cannot express meta combos (useHotkeys.js:24) — fix: raw keydown listener in CreateInvoice.jsx or extend the hook with OLD's meta/shift support (OLD useHotkeys.js:40-48). (HIGH)
5. **P2** — Bank review deck lost `Backspace` step-back, `f` flag, `n` book-no-invoice, `p` preview, `↓` dismiss alias (OLD BkBankMatching.jsx:1713-1717 / NEW StatementReviewDeck.jsx:120-135) — keys are tied to deck capabilities (back-stack, flag, no-invoice, preview) — fix: StatementReviewDeck.jsx with the features; count jointly with bank-matching.md. (MED — feature scope overlaps that audit)
6. **P3** — Single-key page hotkeys dropped on five minor pages: Catalog `s`+`1-6` (OLD Catalog.jsx:75-78), Dashboard `r` (Dashboard.jsx:346-348), Settings `n` (Settings.jsx:628-630), Contracts `n` (Contracts.jsx:129-131), Activity `s` (ActivityHistory.jsx:245-247) — fix: one useHotkeys line each in the NEW counterparts. (HIGH)
7. **P3** — Deck keyboard suites absent with their surfaces: Reports deck (OLD Reports.jsx:853-874), Duplicates deck (Duplicates.jsx:1485-1497), VendorDupeDeck (:128-146), VendorFlags queue (BkVendorFlags.jsx:136-143) — counted with reports.md / flags-data-quality.md / vendors.md; listed here so the binding inventory is complete. (HIGH the keys are absent; the fix belongs to those pages)
8. **P3** — NEW help registry omits the wired Approvals keys (`j/k/a/r/⇧A`, Approvals.jsx:126-138) — violates the registry's own same-commit rule (shortcuts.js:1-3); users can't discover them — fix: add an Approvals group to constants/shortcuts.js. (HIGH)
9. **P3** — `/` focus-search shortcut missing — dup of g-global-search defect 6, not re-counted here (OLD GlobalSearch.jsx:99-105). (HIGH)

Intentional divergences (not defects): `g`-nav sequences (Layout.jsx:175-180), Deals/ReleaseDetail `Esc` bindings, TaskSurface hotkey suite (n/f/z/g/1-5/Esc — supersedes OLD Team.jsx:52-55 by design), registry-driven help modal + manual (single source of truth), Esc handled via the capture-phase escape stack, and the `x`-export token-URL pattern being unportable post security hardening.

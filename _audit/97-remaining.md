# 97 — Remaining work (updated 2026-09-02, after phases 9 + 9.5)

Reconciliation of the 977-row register in `99-punch-list.md` against the
campaigns actually run in build-order phases 1–9. Written to stop the punch
list being read as current — most of it is closed.

## Entries with no campaign yet

| Entry | Rows | P0 | P1 | P2 | P3 | Note |
|---|---|---|---|---|---|---|
| reports | 24 | 0 | 3 | 7 | 14 | Built 2026-08-27, audited, never given a campaign |
| recording-budgets | 32 | 0 | 2 | 12 | 18 | Never scheduled in any phase — my build order missed it |
| vendors | 25 | 0 | 2 | 14 | 9 | Only the payment-details rows were done (Phase 2); the rest is open |
| g-mobile-shell | 11 | 0 | 0 | 5 | 6 | Omitted from the Phase 9 brief by mistake; added to the running agent |
| legal | 5 | 0 | 0 | 0 | 5 | Small; boom side is a placeholder, cadence is ahead |
| login | 4 | 0 | 0 | 0 | 4 | Small, cosmetic only |
| manual | 5 | 0 | 0 | 2 | 3 | Small; the page exists (CLAUDE.md claim was stale) |
| privacy-eula | 4 | 0 | 0 | 1 | 3 | Small, cosmetic only |
| missing--vendors-added-expenses | 1 | 0 | 1 | 0 | 0 | P1 port, never assigned to a phase |
| missing--financials-month-drill | 1 | 0 | 0 | 1 | 0 | P2 port; Reports cell drill partially covers |
| missing--ledger-matching | 1 | 0 | 0 | 1 | 0 | P2 port; deliberately deferred (external bookkeeper xlsx) |
| missing--vendor-preview-lab | 1 | 0 | 0 | 1 | 0 | P2 port; write-nothing sandbox |
| **TOTAL** | **114** | **0** | **8** | **44** | **62** | |

## What this means

- **No P0s remain unaddressed.** All 14 were closed in the root-cause pass and
  phases 1–8 (the last three were financials' exec-depth cluster, closed by RC-10).
- The open work is concentrated in **three real pages** — Reports, Recording
  Budgets and the rest of Vendors — plus small cosmetic pages and four ports,
  two of which are deliberate deferrals.
- Everything else in the register belongs to a page a campaign has already
  worked. Per-campaign closure rates are in the dated CLAUDE.md entries;
  they ran between 21/24 and 45/45, with every skip reasoned in place.

## Suggested Phase 9.5 (before the Phase 10 QA pass)

1. **Reports** (24 rows) and **Recording Budgets** (32 rows) — the two real
   pages with no campaign. Recording Budgets is the larger gap: cadence has a
   131-line page against boom's index + detail with a lifecycle, fund maths and
   a two-tab planning sheet.
2. **Vendors** remainder (~25 rows) — the payment vault closed the security
   half in Phase 2; the list/merge/alias/W9 surface is untouched.
3. **`missing--vendors-added-expenses`** (P1 port).
4. The four small pages (legal, login, manual, privacy-eula ≈ 18 rows, all
   cosmetic) can fold into the Phase 10 QA pass rather than needing a campaign.

## Not counted here

Deliberate skips inside completed campaigns (each documented at its
CLAUDE.md entry), the 176 intentional-divergence notes, and defects found
*during* the phases that were never in the register — the task-status 500,
the privilege escalation, the five recoupment money bugs, the artist-rename
cascade, the analytics ping writing nothing, and the /ledger TDZ crash.


---

## Update — after Phase 9 and 9.5

Phase 9 closed the global surfaces (including `g-mobile-shell`, added mid-flight).
Phase 9.5 closed the three pages this document flagged:

| Entry | Result |
|---|---|
| recording-budgets | 30/32 (both P1s; `-31` partial — audit stamps are name strings, not user FKs) |
| reports | 19/24 (both named build defects fixed) |
| vendors | 21/27 + 1 verified already-closed by the Phase-2 vault |
| g-mobile-shell | worked in Phase 9 |

### Genuinely still open

| Item | Severity | Note |
|---|---|---|
| `missing--vendors-added-expenses` | P1 | Port never started (deliberately not half-built) |
| Reports: review deck over drill rows | P1-ish | `ReviewDeck.jsx` exists and the drill payload is already deck-shaped |
| Vendors: dupe deck, unified ledger+bank view, bulk multi-select merge, move-one-invoice, cards view + Added-expenses subpage | P2 | Each is its own surface |
| Reports: drill-row document buttons / FilePreview | P2 | |
| `missing--financials-month-drill`, `missing--ledger-matching`, `missing--vendor-preview-lab` | P2 | Two are deliberate deferrals |
| legal, login, manual, privacy-eula (~18 rows) | P3 | Cosmetic; fold into the Phase 10 QA pass |

### Contract note for future work

Reports' P&L now presents **three** sections. Anything reading `pnl.below` as
"everything below the operating line" must also read `pnl.non_recurring` or it
will silently under-report Net Change in Cash. Both current consumers
(`lib/reportRows.js`, `components/reports/PnlTable.jsx`) were updated.

---

## Update — after Phase 10 (final QA), 2026-09-02

Phase 10 was a verification pass, not a build pass. It enumerated all 562 server
routes and all 84 client routes and exercised them; it resolved 44 of the 52
`UNVERIFIED` marks in `_audit/pages/`; and it closed the four cosmetic pages.
**Six of the audit's standing claims were REFUTED** — see "Corrections" below;
those rows are cleared, not deferred.

### Newly found and FIXED in Phase 10

| Finding | Sev | Note |
|---|---|---|
| `Check` used but never imported in `constants/navConfig.jsx` | **P0** | `buildNavGroups` throws → `Layout` throws → **white screen on every page for every Approver, Admin and Superadmin**. Shipped in the Phase 9/9.5 commit; `npm run build` passed clean. |
| Double `client.release()` at 12 sites | **P0** | pg-pool throws *outside* the try → unhandled rejection → **the whole Node process exits**, for all tenants. Reachable from ordinary not-found/validation paths, including `POST /chat/dm` returning an existing DM. |
| 6 × NaN-into-Postgres 500s | P2 | `campaigns/:id/link`+`/unlink`, `bank-matching` funding-pair + duplicate-pairs merge/reject, `artist-campaigns` review-assign + not-campaign. `lib/paymentFamily.js familyRoot` hardened centrally. |
| `announcements/:id/dismiss` FK violation → 500 | P3 | Unknown id now 404s. |
| 6 × unguarded `getSignedFileUrl` → 500 when R2 is down | P2 | Now 503 with the message `admin-docs.js` already used. Matters in a real R2 outage, not just here. |
| `isValidDay` regex-only in `artist-campaigns.js` | P3 | `2026-02-31` reached SQL. Both copies now share `server/lib/calendarDay.js`. |
| 3 nav entries had no `PAGE_LABEL` | P3 | `/messages`, `/bank-statements`, `/data-quality` rendered a blank topbar title and showed as raw paths in Usage. |
| `/manual` Close was a no-op in a fresh tab | P3 | `navigate(-1)` with an empty history; now falls back to `/`. |

### Genuinely still open — carried forward

| Item | Sev | Note |
|---|---|---|
| Ledger overlays have no Escape / focus trap | P2 | 9 hand-rolled `fixed inset-0` sites: `SplitModal.jsx:53` and `Ledger.jsx` `EditEntryModal:1956`, `QuickExpenseModal:1873`, `CarveReimbModal:1814`, `ReceiptsModal:1716`, plus inline overlays at `:1485`, `:1505`, `:1547`, `:1562`. The `ui/Modal` + `useEscapeStack` primitives already exist — this is a migration, not a build, but it is 9 surfaces and each has its own dismissal semantics. |
| No refetch on acting-user switch | P3 | **Now confirmed real**: enter-workspace is setState-only (`AuthContext.jsx:97-129`), no remount, no `key`. Dashboard and `useTaskData` keep stale data after switching workspace. |
| `/api/dashboard/widgets` per-row `await toUSD` | P2 | **Measured**: 0.66–1.53s on 86 expenses. Already slow at trivial volume. |
| Creators directory W9 test ignores `w9_filename` | P4 | **Confirmed with data** — 1 such row exists in the seeded workspace. |
| Bank statement detail reachable for non-`ready` statements | P3 | `BankStatements.jsx:46` has no status gate; Delete at `:896` is unconditional. The gate is only on the list's click handler. |
| Duplicate-merge drops the twin's UFR mark | P3 | Confirmed relevant — cadence does model UFR. |
| Manual: common workflows, keyboard reference, live permission refresh, TOC/cover | P2/P3 | Content ports, not defects. Print/Save-as-PDF WAS restored in Phase 10. |
| Privacy + EULA real legal text | P2 | Deliberately **not** written by an agent — needs product/legal sign-off. Both pages now carry an explicit placeholder banner and a fixed (non-auto-updating) dateline so they cannot masquerade as reviewed documents. |
| Legal page: Approver access, and the waivers/clearances hub | P3 | Access tightening is a policy call with live users behind it; not changed silently. |
| `missing--vendors-added-expenses`, Reports review deck + drill doc buttons, Vendors dupe deck / unified view / bulk merge / cards, `missing--financials-month-drill`, `missing--ledger-matching`, `missing--vendor-preview-lab` | P1–P2 | Unchanged from the Phase 9.5 list above. |
| Lowercase `payment_status:'paid'` silently normalises to `Unpaid` on create | P4 | Input-tolerance nit; the client always sends `Paid`. |

### Corrections — audit claims REFUTED in Phase 10

These were wrong and should not be worked:

1. **`payments.md` DEF-PAY-01 (P1) — EmailPreviewModal "can never send".** False. All
   four render sites pass `open`: `Payments.jsx:675`, `Approvals.jsx:643`,
   `Team.jsx:396`, `mywork/TaskSurface.jsx:636`. The cited line numbers were stale.
2. **The whole dark-mode raw-tint cluster** (≈10 rows across calendar, contracts,
   approvals, legal, artist-profile, pending-contracts, flags, artists,
   g-theme-dark-mode). `client/src/index.css:154-320` is exactly the `.dark` remap
   layer those rows say is missing, covering 14 colour families at `-50`/`-100`.
3. **`upload-rules.md` DEF-RUL-07 — retro rows skip `autoLinkRelease`.** False; both
   `UPDATE expenses SET artist` sites in `bank-matching.js` call it.
4. **`calendar.md` C-11 / `artist-profile.md` AP-24 — "Escape doesn't close".** Both
   are `ui/Modal`, which is on the escape stack. (The Ledger overlays, above, are the
   real gap.)
5. **`add-invoice.md` DEF-ADDINV-29 / -35.** Both refuted live: `payment_terms` +
   `scheduled_payment_date` and `paid_by` + `paid_marked_at` are all stamped at create.
6. **`catalog.md` browser-TZ `isReleased`.** There is no `isReleased` in `client/src`;
   released-or-not is decided server-side.

### The 8 `UNVERIFIED` marks that remain, and why

All 52 marks were triaged; 44 now carry a dated verdict. The 8 left are labelled
in place with what they would actually take:

- **needs a browser** (6): `deals.md:39,88` drag-hover flicker;
  `g-modal-overlay-primitives.md:60` concurrent z-index stacking (the audit never
  identified a concrete pair); `g-mobile-shell.md:101` per-page mobile layout;
  `reports.md:103` P&L grid compression at wide ranges; `calendar.md:55` whether a
  first tap reveals an `opacity-0 group-hover` control on iOS.
- **needs a fixture** (1): `reports.md:53` part-aware split editing — no seeded split
  family carries divergent per-child categories.
- **needs the OLD app running** (1): `artist-campaigns.md:64` — the NEW behaviour is
  settled; the claim is about boom's, which source alone did not settle.

Note that **none** of the 52 needed R2, Anthropic or SMTP credentials. The two that
mentioned external services were red herrings — both were answerable from the DB and
from source.

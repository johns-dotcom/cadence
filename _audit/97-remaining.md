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
| ~~`missing--vendors-added-expenses`~~ | ~~P1~~ | **CLOSED 2026-09-02** — ported (`/vendors/added-expenses`); uses cadence's singular `'recoupment'` |
| ~~Reports: review deck over drill rows~~ | ~~P1-ish~~ | **CLOSED 2026-09-02** — `components/reports/DrillReviewDeck.jsx`; snapshot-scoped money progress, per-card undo of all four actions, cap/filter truncation disclosed |
| ~~Vendors: dupe deck, unified ledger+bank view, bulk multi-select merge, move-one-invoice, cards view + Added-expenses subpage~~ | ~~P2~~ | **ALL CLOSED 2026-09-02** — see the dated CLAUDE.md entry |
| ~~Reports: drill-row document buttons / FilePreview~~ | ~~P2~~ | **CLOSED 2026-09-02** — `components/reports/DrillDocs.jsx` + `server/lib/drillDocs.js`; signed URLs, family-not-slice resolution, 503-degrades |
| ~~`missing--financials-month-drill`, `missing--ledger-matching`, `missing--vendor-preview-lab`~~ | ~~P2~~ | **ALL CLOSED 2026-09-02** — the last three ports; see the close-out section at the end of this file |
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
| ~~Ledger overlays have no Escape / focus trap~~ | ~~P2~~ | **CLOSED 2026-09-02** — all 9 on `ui/Modal`; `fixed inset-0` count in `Ledger.jsx` + `SplitModal.jsx` is now zero. Each kept its own dismissal semantics via the new `hooks/useDiscardGuard`. Old note: | 9 hand-rolled `fixed inset-0` sites: `SplitModal.jsx:53` and `Ledger.jsx` `EditEntryModal:1956`, `QuickExpenseModal:1873`, `CarveReimbModal:1814`, `ReceiptsModal:1716`, plus inline overlays at `:1485`, `:1505`, `:1547`, `:1562`. The `ui/Modal` + `useEscapeStack` primitives already exist — this is a migration, not a build, but it is 9 surfaces and each has its own dismissal semantics. |
| ~~No refetch on acting-user switch~~ | ~~P3~~ | **CLOSED 2026-09-02** — `AuthContext.sessionEpoch` + `<Routes key>`, plus the two module caches a remount cannot clear. Old note: | **Now confirmed real**: enter-workspace is setState-only (`AuthContext.jsx:97-129`), no remount, no `key`. Dashboard and `useTaskData` keep stale data after switching workspace. |
| ~~`/api/dashboard/widgets` per-row `await toUSD`~~ | ~~P2~~ | **CLOSED 2026-09-02** — root cause was a pg `Date` reaching `String(d).slice(0,10)`, i.e. a silent fallback-rate money bug app-wide, not just latency. 0.69s → 0.17s. Old note: | **Measured**: 0.66–1.53s on 86 expenses. Already slow at trivial volume. |
| ~~Creators directory W9 test ignores `w9_filename`~~ | ~~P4~~ | **REFUTED 2026-09-02** — `creators.js:113` already reads it, and the cited row is not a creator row. Old note: | **Confirmed with data** — 1 such row exists in the seeded workspace. |
| ~~Bank statement detail reachable for non-`ready` statements~~ | ~~P3~~ | **CLOSED 2026-09-02** — `StatementNotReady` + a 15-minute server-side delete guard. Old note: | `BankStatements.jsx:46` has no status gate; Delete at `:896` is unconditional. The gate is only on the list's click handler. |
| ~~Duplicate-merge drops the twin's UFR mark~~ | ~~P3~~ | **REFUTED 2026-09-02** — `bank-matching.js:870-886` carries `ufr` + `ufr_marked_at` in-transaction. Old note: | Confirmed relevant — cadence does model UFR. |
| Manual: common workflows, keyboard reference, live permission refresh, TOC/cover | P2/P3 | Content ports, not defects. Print/Save-as-PDF WAS restored in Phase 10. |
| Privacy + EULA real legal text | P2 | Deliberately **not** written by an agent — needs product/legal sign-off. Both pages now carry an explicit placeholder banner and a fixed (non-auto-updating) dateline so they cannot masquerade as reviewed documents. |
| Legal page: Approver access, and the waivers/clearances hub | P3 | Access tightening is a policy call with live users behind it; not changed silently. |
| ~~Reports review deck + drill doc buttons, `missing--financials-month-drill`, `missing--ledger-matching`, `missing--vendor-preview-lab`~~ | ~~P2~~ | **ALL CLOSED 2026-09-02.** The two Reports items closed earlier that day; the three ports closed in the final pass below. |
| ~~Lowercase `payment_status:'paid'` silently normalises to `Unpaid` on create~~ | ~~P4~~ | **CLOSED 2026-09-02** — `lib/constants.canonicalPaymentStatus`, on create AND on PATCH (which had no validation at all). Old note: | Input-tolerance nit; the client always sends `Paid`. |

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


---

## Update — Vendors close-out, 2026-09-02

The last P1 port and the five Vendors sub-surfaces are done; full detail in the
dated CLAUDE.md entry.

| Item | Result |
|---|---|
| `missing--vendors-added-expenses` (P1) | **Closed now** — `/vendors/added-expenses` + `GET /ledger/vendors/added-expenses`, singular `'recoupment'`, `artistKey` bucketing, 7-day dupe pairs, name variants, USD spend bands |
| vendors #8 dupe review deck | **Closed now** — scored pairs, merge/swap/custom-name/alias-only/not-duplicates, persisted ack, ReviewDeck + merge-all-at-90% |
| vendors #9 unified ledger+bank + worklists | **Closed now** — `?tab=bank`, Bank−invoiced with wire-fee tolerance, needs-matching / needs-artist / to-attach, unlinked-payee queue |
| vendors #10 bulk multi-select merge | **Closed now** — checkboxes, floating bar, W9-first survivor picker, per-merge failure collection |
| vendors #15 cards view + Added-expenses subpage | **Closed now** |
| vendors #18 move-one-invoice | **Closed now** — moves the whole split family |
| vendors #1 merge log / unmerge, #2 payment vault, #3 email carry, #13 W9 mismatch, #17 alias-aware reads | **Verified already closed** (Phase 2 + 9.5) — re-read against current code, not assumed |

### Found during the work, not in the register

- `GET /ledger/vendors` converted foreign currency at 1:1 when no rate was
  locked — **fixed** (grouped by locked rate, converted through `lib/usd.js`).
- `tailwind.config.js` compiled every unmodified token utility (`bg-card`,
  `text-ink`, `border-rule`, `bg-selected`, …) to `color-mix(… NaN% …)`, which
  browsers drop — **53 dead rules app-wide, fixed**. A clean `npm run build`
  never saw it; only `dist/assets/*.css` shows it.
- Vendor merges stranded three name-keyed references, including the learned bank
  lesson, which re-created the merged-away vendor on the next statement upload —
  **fixed** (`lib/vendorCascade.js`, reversal recorded in `vendor_merge_log`).
- **Still open (not changed):** `routes/ledger.js` excludes `'recoupments'`
  plural at 3 Payments sites while the data is `'recoupment'` singular, so
  recoupment-born rows sit in a queue the code intends to exclude them from.
  Fixing it removes live rows from Payments — a product call.


---

## Update — Reports close-out, 2026-09-02

The two Reports items this document carried forward are done; full detail in the
dated CLAUDE.md entry.

| Item | Result |
|---|---|
| Reports: review deck over drill rows (P1) | **Closed** — `DrillReviewDeck.jsx` over the drill's own filtered/sorted snapshot; recategorize · set-artist · reassign-month · dismiss; `→ ← ⌫ D P 1-9 Esc`; per-card undo that replays real server inverses in reverse order; `poolSize` truncation disclosed on the card and in the done panel; two optional props added to the shared `ReviewDeck` shell |
| Reports: drill-row document buttons / FilePreview (P2) | **Closed** — `components/reports/DrillDocs.jsx` (`DocButton` / `DocPreview` / `InlineDoc`) + `server/lib/drillDocs.js`; signed R2 URLs only, resolves each document to the entry that HOLDS it (root for a split slice), 503-degrades with R2 down |

### Found during the work, not in the register

- Undoing a category on a row whose category was **NULL** would have written the
  literal display string `"Uncategorized"` — a label the vocabulary does not
  contain. `/reports/recategorize` gained an opt-in `clear: true` (an empty
  category still 400s without it) so the inverse restores NULL exactly.
- The deck's card staging, synced by a `useEffect`, showed the PREVIOUS card's
  picker values and a bogus `Will apply: …` line on every card's first paint.
  Caught by SSR-rendering the deck; staging is now derived at render.

### Still genuinely open on Reports

Nothing. Non-goals recorded in the CLAUDE.md entry: no bank-txn `F` flag (drill
rows are ledger rows, not bank transactions), no swipe-drag, and the
"no invoice · attach" deep link into the vendor attach picker still needs a
per-payment attach route that does not exist yet.


---

## Update — the last three ports, 2026-09-02

`missing--financials-month-drill`, `missing--vendor-preview-lab` and
`missing--ledger-matching` are the final entries in this document that had no
campaign. All three are now closed: two built, one built in a reduced,
cadence-native form with the boom-specific half declined in writing.

| Port | Verdict |
|---|---|
| `missing--financials-month-drill` | **Built** — `/financials/month/:month` + `GET /api/financials/month/:month` |
| `missing--vendor-preview-lab` | **Built** — `/vendor-lab` + a `?sandbox=1` write-nothing branch on the public submit endpoint, client generated by `client/scripts/sync-vendor-lab.mjs` |
| `missing--ledger-matching` | **Built, minus one endpoint** — `/ledger-matching` (Bookkeeper Reconcile) + 4 endpoints. `bk-style-export` **declined**, reasoning below |

### Was the month drill already covered? — checked before building

The audit said Reports' cell drill and the RC-10 `month_YYYY-MM` bucket
"partially cover" it. Verified against the code, and the honest answer is that
they cover the *rows* and none of the *shape*:

- `MonthlyRollup` gives one line per month plus a MoM delta on **received only**,
  and its drill is a flat invoice list (`financeExec.rowsForBucket`, capped 200).
- Reports' P&L drill answers "what made up March × Marketing" — one cell, on the
  **cash basis**, which is a different basis from the page you clicked from.
- `BreakdownSection` can be scoped to a single month via the custom range, but it
  is commitment-dated, top-10, and has **no vendor dimension at all** — there is
  no per-month top-vendors surface anywhere in cadence.

So the genuine gaps were: month-hop navigation, the daily shape of a month,
a per-artist table with an in-place category mix, top vendors for one month,
biggest invoices for one month, and prior-month deltas on more than one measure.
Those, and only those, were built.

**One deliberate divergence from boom.** Boom's fourth stat card is "Received
(intake)" as a second anchor. Under cadence's cohort recipe paid + open =
received by construction, so that card would restate the first. It is replaced by
**Cash out** — money whose `payment_date` falls in the calendar month, a
genuinely different set of rows. The page says out loud that the two bases must
not be summed. Same reasoning `MonthlyRollup` already used to drop boom's two
degenerate "Difference" columns.

### `bk-style-export` — declined, with reasoning

Four of boom's five endpoints ported cleanly. The fifth, `POST /bk/bk-style-export`,
re-opens the uploaded workbook **as a styling template** and rewrites the data
rows on each `<year>` and `PAID <year>` tab plus a `SUM` totals tab, by name.

That is not a capability, it is one accounting firm's file layout compiled into
a product that serves many labels. Every tenant's bookkeeper has a different
workbook; for all of them but boom's the endpoint would either write into the
wrong tabs or silently no-op. There is no generic version of it that is not
"upload a template and map its columns", which is a different feature nobody has
asked for.

What replaces it: the **handoff bundle** (`POST /ledger-matching/handoff`) sends
the bookkeeper a report plus every invoice, W9 and payment proof behind the
ledger rows in the diff, in a vendor-first folder layout, with a chase list of
vendors missing a W9. That is the deliverable the BK Excel existed to support.

### Why a new matcher rather than reusing `bankReconcile`

`lib/vendorMatch.js` is new and deliberately separate. `bankReconcile`'s name
scoring is calibrated for bank DESCRIPTORS, is held by fixtures against a shipped
automation ladder, and feeds `amount·0.55 + name·0.30 + date·0.15`. This compares
two humans' typed vendor names: legal suffixes, parenthetical asides, reordered
words — and it has to return a *reason*, because the report shows the bookkeeper
why two spellings were treated as one vendor. Folding them together would mean
retuning a matcher that is live on money in order to satisfy a report. Unicode
folding is still shared (`lib/nameMatch.js` `foldKey`) so that has one definition.

### Found during the work, not in the register

- **`ws.actualRowCount` is a COUNT, not a maximum row number.** Using it as the
  upper bound of a row loop drops exactly as many trailing data rows as there are
  blank rows above them, silently. Real bookkeeper workbooks open with a title
  block containing a blank row, so this loses live data with no error anywhere.
  Caught on the first end-to-end run (15 rows parsed where 16 existed); fixed to
  `ws.rowCount` in all three scan sites and held by a fixture.
- **A one-cent amount tolerance is not one cent in floating point.**
  `Math.abs(100.01 - 100) > 0.01` is TRUE, so every genuine one-cent rounding
  difference was being reported as a disagreement. The gap is now rounded to
  cents before comparison. Caught by a fixture written before the run.
- **Raw substring containment matches strangers.** "Neo" is inside "Neon Media
  Group"; a plain `includes` calls that the same vendor, and boom's length floor
  fixes it only by also refusing "IBM" inside "IBM Global Services". Containment
  is now word-boundary, which separates the two correctly.
- **`notes` was declared below the R2 writes in `vendor.js`.** The sandbox branch
  reads it, so it had to move above — a straight insertion would have been a TDZ
  `ReferenceError` on every sandbox run. (This is the server-side twin of what
  `check-tdz.cjs` guards on the client.)

### Deliberate non-goals

- **No link from Reports' month column headers into the month page.** Reports is
  cash basis; the month page is the intake cohort. A link between them invites
  exactly the basis confusion the app works to prevent. The entry point is the
  monthly-rollup drill, which shares the month page's anchor exactly.
- **Nothing about the reconcile is persisted.** No table, no saved diff. A stored
  diff of a workbook we do not control is stale the moment either side edits a
  row, and a stale reconciliation is worse than none.
- **The sandbox keeps the public per-IP rate limiter.** It costs an admin 15 dry
  runs an hour, and removing it would weaken a guard on an endpoint that spends
  AI calls. Not weakened, by choice.
- **Vendor lab is a generated copy, not a `sandbox` prop.** Re-weighed as the
  spec asked; boom's position holds and is now enforced mechanically (see below).

---

## Update — small-defects batch + two deployment fixes, 2026-09-02

The "genuinely still open" table in the Phase-10 section above is now struck
through. **Five of its seven rows were fixed; two were REFUTED** (the code
already did the right thing in HEAD — the register was stale, not the code).
Full detail in the dated CLAUDE.md entry.

| Item | Result |
|---|---|
| Ledger's 9 hand-rolled overlays | **Fixed** — all on `ui/Modal` + `useEscapeStack`; per-overlay dismissal semantics preserved, not unified (`hooks/useDiscardGuard`) |
| No refetch on workspace switch | **Fixed** — `sessionEpoch` + `<Routes key>`; also the two module-level caches (`useCategories`, `useReconciledThrough`) whose reset functions had never been called by anything |
| `/api/dashboard/widgets` slow | **Fixed, and it was a money bug** — see below. 0.69s → 0.17s steady |
| Bank statement detail ungated | **Fixed** — client `StatementNotReady` + server 409 while parsing (15-min bounded so a wedged parse can't strand an undeletable row) |
| Lowercase `payment_status` | **Fixed** — canonicalized on create AND PATCH; unknown values 400 |
| Duplicate-merge drops UFR | **REFUTED** — already carried, `bank-matching.js:870-886` |
| Creators W9 ignores `w9_filename` | **REFUTED** — already read, `creators.js:113`; the cited row isn't a creator row |

### Two deployment fixes John asked for by name

- **Stale-tab detector.** `GET /api/version` publishes the built main bundle
  filename (Vite content-hashed, mtime-cached); `components/UpdateBanner.jsx`
  baselines the first value it sees and offers a dismissible reload when a later
  one differs. Poll + focus, floored at 60s. No build-time constant.
- **`/assets/*` 404s** instead of falling through to `index.html` with a
  JavaScript content-type.

### Found while working — NOT in the register

- **`fx.js` converted every unstamped foreign row at the FALLBACK table rate.**
  node-pg returns DATE as a JS `Date`; `String(date).slice(0,10)` made it
  `"Tue Sep 01"`, which misses the cache, 404s at frankfurter, and silently uses
  the hardcoded table — and, because a failed fetch is never cached, re-fetches
  per row per request (~270ms each). Fixed centrally with `fx.dateKey()`, which
  repairs **every** caller (`financials` ×4, `ledger` ×3, `creators`,
  `artist-budgets`, `reports`, `dashboard`), and fixture-held.
- **`PATCH /ledger/entries/:id` never validated `payment_status`.** Worse than
  the create-path nit that was registered: the raw value was written and then
  cascaded across the whole split family.
- **`autoFocus` is a no-op inside `ui/Modal`** — `useFocusTrap` focuses the panel
  from a `useEffect`, which runs after React applies `autoFocus`. Anything
  migrated onto Modal loses its autofocus silently unless a parent effect
  re-claims it.
- **`ui/Modal`'s `WIDTHS` ladder has no `max-w-xl` rung** (`lg` → `max-w-2xl`).

### Still open (unchanged, and one new note)

- legal / login / manual / privacy-eula content items — P3, cosmetic.
- `routes/ledger.js` excludes `'recoupments'` plural at 3 Payments sites while
  the data is `'recoupment'` singular — still a product call.
- **NEW:** four W9-on-file tests outside creators are still `w9_r2_key IS NOT
  NULL` only — the ledger **1099 report** (`ledger.js:444`), the vendors W9
  column (`:2216`), `flags.js:230`, and the dup-pair scorer. Widening them to
  include `w9_filename` (as `creators.js` does) would flip a vendor from MISSING
  to ✓ on a tax report. Deliberately not changed silently; expense #61 (Yuki
  Studio) is such a row today.

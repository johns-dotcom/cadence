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

# 98 — Recommended build order

Sequencing for everything in `99-punch-list.md` that isn't already fixed. Written 2026-08-31,
after the root-cause pass (RC-1/5/6/8/9-tokens/11/12 fixed; RC-7 approval checklist ported;
RC-10 financials exec depth in flight). Working totals: **977 defects — 14 P0 · 198 P1 ·
339 P2 · 426 P3** (P0s: 11 of 14 closed or in flight after the RC pass).

## Principles

1. **Money integrity and dead flows before parity polish.** A page that lies about totals or
   silently drops an email outranks any visual gap.
2. **One page-campaign = one deployable unit.** When a page's P1s are fixed, fold in its P2/P3
   list and its RC-3/RC-4 typography+icon parity in the same pass — never a separate polish tour.
3. **Shared primitives before their consumers.** The artwork-sync batch, the encrypted
   payment-details vault, and the `recoup_reviewed` schema each unblock two+ campaigns.
4. **Deploy checkpoints between phases.** The tree already carries the uncommitted finance build +
   RC fixes; commit/push per phase once the first boot is verified, so regressions bisect cleanly.
5. **Sizes are relative**: S ≈ half a day, M ≈ 1–3 days, L ≈ a week of focused work.

## Phase table

| # | Phase | Contents (P0/P1 load) | Size |
|---|---|---|---|
| 0 | Done / in flight | RC pass · RC-7 checklist · RC-10 exec depth | — |
| 1 | Runtime + safety valves | local .env runtime · artists delete gate (P0) · archive restore gate + UI | S–M |
| 2 | Remaining P0 clusters | dashboard widgets (4 P0+5 P1) · contracts detail (1 P0+9 P1) · payment-details vault (1 P0 + vendors P2) | L |
| 3 | Invoice lifecycle | add-invoice 16 · approvals 13 · payments 10 · ledger 7 · reimbursement 3 · create-invoice 2 · upload-rules 2 · ports: bulk-upload, bk-invoices | XL (the heaviest phase) |
| 4 | Bank & reconciliation | bank-statements 10 · bank-matching 7 · flags 7 · ports: bank-ledger, ledger-matching | L |
| 5 | Artist money | recoupments 7 · planning 3 · ports: recoupments-audit → ad-allocation · campaigns two-layer | L |
| 6 | Catalog & releases | releases 7 · catalog 5 · calendar 5 · artist-profile 6 · deals 4 · artists residual 8 · release-detail 1 · port: bulk-deals | L |
| 7 | Legal & docs | create-nda 4 · artist-clearance 5 · renewals 3 · label-waiver 2 · admin-docs 3 · port: contracts-create | M |
| 8 | People & internal | team 4 · my-work 4 · salary 2 · activity 2 · settings 1 · ports: team-member, analytics | M |
| 9 | Global surfaces | search 2 · bell 2 · shortcuts · mobile shell · dark residue · toasts · empty states · email-preview P2s | M–L |
| 10 | Final QA | side-by-side runtime pass vs boom · UNVERIFIED sweep · doc updates | M |

## Phase 1 — Runtime + safety valves (do immediately)

- **Stand up a local runtime** (.env with DATABASE_URL — a throwaway Postgres is enough). The
  whole audit ran statically; this converts every `UNVERIFIED — needs runtime check` into a
  yes/no, live-verifies the RC-8 email revival and RC-11 page revival, and catches migration
  errors from the finance build before Railway does. Highest information-per-hour item on this list.
- **artists P0**: `DELETE /artists/:id` lost the Superadmin gate + has-releases 409 + cleanup —
  any member can delete an artist, releases orphan, R2 files leak (`server/routes/artists.js:220-232`).
- **missing--approvals-archive**: gate the restore endpoint (P2, currently ungated) and hang a
  thin Archive UI off the already-existing `GET /ledger/archive`.

## Phase 2 — Remaining P0 clusters

- **Dashboard** (4 P0 + 5 P1): notifications/alerts feed, latest-releases carousel, chart filter
  bar + prior-year comparison, and the **batch artwork-sync endpoint — build it once here; catalog's
  CAT-3 (phase 6) consumes the same server batch.**
- **Contracts** (1 P0 + 9 P1): rows are currently unclickable — restore the detail view (details
  grid, royalty split bar, notes, documents), then the P1 list.
- **Payment-details vault** (vendor-submit P0 + vendors' plain-text bank details): one encrypted
  store (`vendor_payment_details`), captured on the public form (ACH/Wire/PayPal + doc-vs-typed
  check + last4), reused on file, surfaced to AP. Shared by vendor-submit, Vendors, and Payments —
  design it once. This is also the audit's biggest **security** finding.

## Phase 3 — Invoice lifecycle (heaviest, highest daily-use payoff)

Work the pipeline in submission order so each fix feeds the next surface:
1. **add-invoice (16 P1)** — checklist gate landed with RC-7; remaining: wizard structure,
   auto-split on comma songs, carve-off reimbursement, dup-gate parity, AI-flag surfacing.
2. **approvals (13 P1)** — deck exists now; port the W9 review deck, notes rider, dismiss-per-
   discrepancy, split-before-approve, edit-in-place re-scans.
3. **payments (10 P1)** — family-total confirmation emails + attachments, per-currency stat
   captions, 14-day paid linger, calendar view, per-vendor confirmation wizard parity.
4. **ledger (7 P1)** — column set, filters, inline-edit gaps vs boom.
5. Small closers: add-reimbursement (3), create-invoice (2), upload-rules (2).
6. **Ports while context is hot**: `missing--bulk-upload` (AI batch ingest naturally extends
   add-invoice) and `missing--bk-invoices` (index/search over what phases 3.1-3.4 produce).

## Phase 4 — Bank & reconciliation

1. **bank-statements (10 P1)** — month-grouped library, coverage badges + overlap warnings,
   re-parse, extras audit, misfiled repair; the **deterministic parser** is the L item — schedule
   it last in the phase so the quick wins ship first.
2. **bank-matching (7 P1)** and **flags residual (7 P1)** — the deferred checks (suspect-currency,
   stolen-match, relink actions, booked-duplicate one-click).
3. **Ports**: `missing--bank-ledger` (the `?source=` partition + statement-lens tie-out),
   then `missing--ledger-matching` (P2) only if the bookkeeper-xlsx workflow is still wanted.

## Phase 5 — Artist money

Order matters here — each step feeds the next:
1. **recoupments (7 P1)** then **recoupments-planning (3 P1)**.
2. **Port `missing--recoupments-audit`** — brings the `recoup_reviewed` + `recoupment_class_rules`
   schema the ad pool depends on.
3. **Port `missing--ad-allocation`** (P2, deliberately deferred in the 2026-08-27 build — now
   unblocked by step 2).
4. **artist-campaigns two-layer model** (settled vs committed layers, queue view, unattributed
   flow — the 3 P2s that are really one architectural gap).
5. Fold creators (17 P3) and artist-budgets (17 P3) cosmetic lists into whichever of the above
   touches them.

## Phase 6 — Catalog & releases

- **releases (7 P1)** — the inline 7-tab expanded-row workspace is the L item; filters and
  Upcoming-default are quick.
- **catalog (5 P1)** — membership model (`in_catalog` flag), archived-view logic, artist filter;
  artwork sync arrives from phase 2.
- **calendar (5 P1)**, **artist-profile (6 P1)**, **deals (4 P1)**, artists residual (8 P1),
  release-detail (1 P1). Port `missing--bulk-deals` here (watch the `bulk_deal_completed`
  INT-vs-BOOLEAN collision the audit flagged).

## Phase 7 — Legal & docs

- **create-nda (4 P1)** — the legal template text was replaced with generic boilerplate; restore
  boom's executed 15-section standard + invest variants, and the dirty-body field auto-sync.
- **artist-clearance (5 P1)**, **renewals (3 P1** — includes the UTC date-parse quick win**)**,
  label-waiver (2), admin-docs (3). Port `missing--contracts-create` (P2) if wanted.

## Phase 8 — People & internal

team (4 P1) · `missing--team-member` detail page · my-work (4 P1) · salary (2) · activity (2 —
the 729-line filterable audit browser regression) · settings (1) · `missing--analytics`
(page_views + in-workspace usage page; standalone, any time).

## Phase 9 — Global surfaces & app-wide polish

global-search entity coverage (2 P1) · notification-bell kinds (2 P1) · sidebar/topbar P2s ·
keyboard shortcuts (5 P2 — Releases list keys, Ledger c/x, Calendar) · mobile shell (5 P2 —
edge-swipe, FilterSheet, touch-target CSS layer) · **RC-9 residue**: 213 raw colored tints,
Recharts dark tooltips/ticks, ink-on-wash text pairings · toasts (2 P2) · empty states ·
email-preview P2s (invite/task-assignment kinds, attachments).

## Phase 10 — Final QA

Side-by-side runtime pass against boom on every page (the visual mode the audit couldn't run),
burn down remaining `UNVERIFIED` marks, re-run the fixture suite, update CLAUDE.md and the
`_audit/` gap tables to the new reality.

## Quick wins to slot into any idle hour

| Item | Where | Why it's tiny |
|---|---|---|
| Renewals UTC date-parse bug | pages/renewals.md | The exact bug boom's `daysUntilLocal` documents; swap the parse |
| Paid-linger 7d → 14d + `created_at` fallback | `server/routes/ledger.js` (DEF-PAY-04) | Two constants |
| Confirmation email family total | `Payments.jsx:183` + `ledger.js:1573-1590` (DEF-PAY-02) | Send familyTotal, not the slice |
| Payments stat-card captions | DEF-PAY-03 | Copy + per-currency captions |
| Dashboard `ReconciledBadge` etc. already done | — | (listed to avoid re-doing) |
| `bulk-approve` route stays checklist-gated | — | Landed with RC-7; don't re-open |

## Standing rules for every campaign

- Cite the page's `_audit/pages/<slug>.md` in the PR; check items off its §7 table.
- Apply RC-3 (bracket type sizes) + RC-4 (icon sizes) to every surface you touch — that is the
  plan for those two root causes; there is no separate sweep.
- New expenses columns → list-endpoint column set + PATCH allow-list decision, per CLAUDE.md.
- `node --check` touched server files + `npm run build` before every checkpoint; push only on John's go.

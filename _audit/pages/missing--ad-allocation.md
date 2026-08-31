# missing--ad-allocation — OLD's Allocate Advertising (ad-pool → artist attribution)

## 1. What it is

The surface that puts an artist's name on ad-platform spend. Measured problem:
495 of 499 `Advertisements` ledger rows ($291,299) named no artist and no song —
Facebook/TikTok bank descriptors are merchant ids with nothing to attribute
from (`AdAllocation.jsx:1-8`). The page allocates a month's real bank charges
to **campaigns** (and so to artists), writing REAL ledger split families whose
slices are marked reviewed + recoupable — visible to Recoupments, spend sheets
and the recoupment audit (`AdAllocation.jsx:18-20`).

- Route: `/bk/advertising` → `<AdAllocation />` (OLD `App.jsx:237`); nav
  "Reports · Allocate Ads" (`_audit/00-inventory.md:64`). Protected client
  route; all server endpoints gate on `isBkAdmin` → 403
  (`reports.js:2589, 2735, 2949, 3035`).
- It superseded a **legacy mechanism that still exists in OLD**:
  `ad_pool_allocations` (`server/index.js:1862-1874`;
  GET/POST/DELETE `/reports/ad-pool`, `reports.js:3033, 3085, 3136`) — a
  ledger-external "assign $X of the pool to an artist" table. Header comment:
  it was NEVER used ($267,674 of pool, zero allocations in six months) because
  the guess was unfalsifiable and the write was invisible to recoupments
  (`AdAllocation.jsx:10-16`). The v2 page fixed both; the port should build v2
  and skip the legacy table.
- Core stance: "Bank is the money, Ads Manager is the basis" — only real
  charges are apportioned; an export supplies proportions only, so there is no
  reconciliation remainder to park (`AdAllocation.jsx:22-24`). The page derives
  no money of its own — three endpoints (`:26-29`).

## 2. OLD anatomy

Client: `client/src/pages/AdAllocation.jsx` (425 lines) +
`components/adalloc/` — `ChargeTable.jsx` (93), `AllocatePanel.jsx` (110),
`ImportMapper.jsx` (228). Server: `routes/reports.js:2389-3018` +
`lib/ad-allocate.js` (pure cents arithmetic).

### Page (AdAllocation.jsx)

1. **Month navigation** — `GET /reports/ad-months` once; opens on the OLDEST
   month holding pool (backlog worked oldest-first, `:68-81`); header
   prev/next arrows + month `<select>` showing $ per month (`:191-207`);
   **backlog strip** — one mini-bar per month, height ∝ unallocated USD,
   tooltip "$ unallocated over n charges" (`:210-233`).
2. **Reconciliation line** (`:246-267`): "$X unallocated · $Y needs sorting
   out by hand · $Z allocated · n charges" — three numbers that add up to the
   month, plus a rose "listing $A vs report $B" warning whenever the charge
   listing disagrees with the P&L's pool figure by >2¢ (`:262-266`).
3. **Campaigns card** (`:269-308`): campaigns dated in the month (or already
   holding its money): artist (rose "no artist"), song, name, platform,
   planned budget, allocated-this-month cents. Actions: **New campaign**
   (inline form → existing `POST /marketing/campaigns`; releases fetched once
   and filtered client-side because `GET /releases` ignores an artist_id param
   — `:376-424`, esp. `:387-393`; dated `{month}-15`) and **Import CSV**.
4. **Allocate panel** (`AllocatePanel.jsx`) — the one-campaign flow: pick
   campaign, type what it cost ("the unit anybody actually knows",
   `AllocatePanel.jsx:1-5`); refuses artistless campaigns (`:47`); Preview →
   `POST /reports/ad-allocate {month, campaign_id, amount, dry_run:true}` →
   per-charge plan; Apply re-sends the same body without `dry_run`
   (`AdAllocation.jsx:114-148`). Success flash reports slices written "marked
   reviewed and recoupable" + a "See it on Recoupments" link (`:135-137,
   236-242`), then refreshes both the month and the strip.
5. **Import mapper** (`ImportMapper.jsx`) — Ads Manager CSV for PROPORTIONS
   only: no assumed schema — header row is read and the user points at the
   campaign/spend columns; mapping remembered per platform; quoted-comma-safe
   CSV splitter (`ImportMapper.jsx:1-45`). Produces
   `{allocations:[{campaign_id, amount}], proportional:true}` → same
   preview/apply cycle, with a per-campaign preview table (`AdAllocation.jsx:
   320-353`).
6. **Charge table** (`ChargeTable.jsx`) — "what the bank paid": per charge
   root, date/payee/description, open vs allocated slices, lock chip with the
   blocked reason(s) (`:49-50`), each allocation slice showing campaign/
   artist/song with a per-slice **Undo** → `DELETE /reports/ad-allocate/:expenseId`
   (window.confirm, `AdAllocation.jsx:150-163`); `attributed` slices (named by
   someone via the Reports drill, not this page) listed separately — counted
   so the arithmetic adds up but not undoable here (`reports.js:2524-2528`).
   Preview highlights the charge rows the plan would touch (`:366-368`).

### Server

**`adMonthState(month)`** (`reports.js:2411-2551`) — the shared derivation
(listing, dry-run and write all read it "so all three agree by construction"):
runs `buildPnl` with a `collectLabelLevel` collector; debits only (credits are
refunds — reported, not allocatable); re-adds **fully-allocated charges** the
collector no longer sees (completed work must not vanish from
`allocated_cents`, `:2418-2433`); loads whole families; per charge computes
`charge_cents/open_cents/open_usd`, allocations, attributed, and
`allocatable` with human-readable `blocked` reasons (multiple open slices,
document-carrying members that must not be restructured — legacy receipt blobs
are the only copy, `:2450-2456, 2496-2501`). Charges sort oldest-first via
`adDay()` — a Date-vs-string trap that once sorted by weekday name and made
the greedy draw consume the wrong charge (`:2391-2404`). Returns
`open_cents/allocatable_cents/allocated_cents` plus `pool_usd` from the P&L so
the page can never quietly disagree with the report (`:2545-2549`).

**`GET /reports/ad-months`** (`:2559-2583`) — ONE buildPnl over the whole
range grouped by stamped month, not 18 P&Ls and not a cheaper second query
("navigation drifting from money is how a page starts lying", `:2552-2558`).

**`GET /reports/ad-charges?month`** (`:2587-2633`) — `adMonthState` + the
month's campaigns (dated in-month OR already holding its money — "a campaign
run in June and paid for in July must not disappear", `:2596-2625`).

**`POST /reports/ad-allocate`** (`:2726-2902`) — body either
`{campaign_id, amount}` or `{allocations:[…]}`; duplicate campaign rows merged
(`:2743-2755`); `proportional:true` treats the amounts as WEIGHTS and
apportions 100% of `allocatable_cents` across them (`:2760-2778`).
`planAdAllocation` (`:2635-2724`) validates campaigns exist AND have an artist
("allocating to them would attribute nothing"), greedy-draws oldest-first via
`drawMany`, refuses over-allocation with exact numbers, and returns the SAME
plan for dry_run and write ("a preview computed differently from the write is
a preview that lies"). The write, in one transaction per request
(`:2790-2884`): shrinks the open slice by the drawn cents (or, when fully
allocated, the open row BECOMES the last slice — a root cannot be deleted or
left at zero, `:2803-2823`); inserts child slices with **four columns the
shared split writer does not write** — `entry_source` (inherited; NULL
children read as hand-entered invoices, the documented 88-row/$55,470 leak),
`recoup_reviewed` (the `withoutUnreviewedBankRows` gate), `recoupable`, and
`campaign_id` (`:2824-2861`); **asserts the family still sums to the charge
exactly** — the shared writer performs no such check and a cent per charge is
exactly what broke the spend sheets' tie-out (`:2863-2871`); keeps the
parent's denormalized `artist_breakdown` in step (`writeBreakdown`,
`:2920-2939`); logs one `bk_audit_log 'ad_allocated'` row per campaign
(`:2887-2895`).

**`DELETE /reports/ad-allocate/:expenseId`** (`:2941-3018`) — per-slice undo
(the grain the mistake is made at): folds the slice back into the family's
open row and deletes it, or — when there is no open sibling or the slice IS
the root (deleting it would destroy the bank match) — strips
artist/song/campaign_id and clears the review columns in place; asserts the
family total is unchanged.

**`lib/ad-allocate.js`** — pure, DB-free, fixture-tested: `toCents/fromCents`;
`apportion` (largest-remainder, deterministic ties, sums EXACTLY — built
because the shared split endpoint never checks slices sum to the parent, and
$140.67×3 = $422.01; and because independently-rounded shares shipped a
$781,522.61-vs-.62 production drift, `ad-allocate.js:1-27`); `drawMany`
(greedy oldest-first draw across charges).

## 3. NEW status

**Confirmed absent — a deliberate scope deferral, not an oversight.** Verified:
repo grep for `ad_pool|ad-allocate|adalloc|apportion|AdAllocation|ad-months|
ad-charges` over NEW `client/src` + `server` returns zero hits. The 2026-08-27
build plan (`~/.claude/plans/i-want-to-add-majestic-raven.md:79,148`) lists
"ad pool" among "Not ported … confirm out of scope". Consequence in NEW today:
statement-born ad spend can be split/assigned by hand via Bank Matching's
split-book and artist rules, but there is no campaign-based, tie-out-guaranteed
apportionment surface, no Ads-Manager-import path, and label-level ad spend
stays unattributed in Reports' Spend-by-Artist.

## 4. Port requirements

- **Schema**: none new if porting v2 only (skip `ad_pool_allocations`). NEW
  already has `influencer_campaigns` **with `label_id`**
  (`server/routes/artist-campaigns.js:61`) — note NEW's shape differs from
  OLD's (`planned_amount`/`expense_id` vs OLD's `total_budget`/
  `campaign_date`); the month-of-campaign query needs mapping onto NEW's
  campaign model (or NEW's separate `campaigns` table,
  `routes/campaigns.js:44` — pick one deliberately). `expenses.recoup_reviewed`
  does not exist in NEW (see missing--recoupments-audit — shared dependency).
- **Server**: port `lib/ad-allocate.js` verbatim (pure; add to
  `finance-fixtures.cjs`). New endpoints in NEW `routes/reports.js`,
  label-scoped, `requireApprover`+. NEW's `buildPnl(labelId, from, to, artist)`
  (`reports.js:188`) lacks OLD's `collectLabelLevel` collector option — that
  hook must be added (or an equivalent row-collector) since `adMonthState`'s
  whole correctness story is deriving the pool from the SAME P&L rows.
  Family-sum assertion + `artist_breakdown` maintenance must match NEW's split
  conventions (NEW just fixed family_amount double-counting on applied
  allocations — commit 82fa2b0 — so tie-out semantics are live territory).
- **Client**: port page + the three `adalloc/` components; NEW already has
  `PageHeader`, `Skeleton`, `ui/` kit, `ConfirmDialog` (replace
  `window.confirm`), Dropzone for the CSV. Route Approver+ (matches OLD's
  isBkAdmin).

## 5. Defects

- [P2] Ad-pool allocation surface missing — label-level ad-platform spend (OLD measured $291k unattributed) cannot be campaign-allocated to artists; no apportionment engine, no Ads-Manager import, slices never reach recoupment surfaces as reviewed+recoupable — **deliberately deferred in the 2026-08-27 build plan** (plan lines 79/148), a scope call, not tenancy — fix: new page + ad-months/ad-charges/ad-allocate endpoints + port lib/ad-allocate.js (HIGH)

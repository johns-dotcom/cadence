# missing--recoupments-audit — OLD's Recoupment Audit (five-check integrity surface)

## 1. What it is

Not an audit-trail *browser* — a five-check **integrity audit of the recoupment
ledger** answering the question the Recoupments page cannot ask about itself:
"is anything missing, and is anything claimed that shouldn't be?"
(`RecoupmentsAudit.jsx:1-24`). Two checks find money NOT claimed (advances
missing an artist, half-claimed split payments), one finds money never judged
either way (the bank pile), two find money claimed wrongly (possible double
claims, claims with no document). Each check ships with inline remediation
actions.

- Route: `/recoupments/audit` → `<TabbedShell family="recoupments">
  <RecoupmentsAudit />` (OLD `App.jsx:233`); nav "Reports · Recoupments › Audit"
  (`_audit/00-inventory.md:60`). Client route Protected; **every server
  endpoint is Admin-gated** (`bookkeeping.js:9522, 9195, 9302, 9335` — isAdmin
  → 403).
- Design rule stated in the header comment: the page derives NO money of its
  own — all five predicates live in ONE endpoint
  (`GET /bk/recoupment-audit`) because "a predicate about money that lives in
  two places disagrees with itself eventually" (`RecoupmentsAudit.jsx:17-20`,
  `bookkeeping.js:9500-9519`). It deliberately EXCLUDES "claimed with no bank
  line" — that chip already lives on the Recoupments page
  (`RecoupmentsAudit.jsx:22-24`).

## 2. OLD anatomy

Client: `client/src/pages/RecoupmentsAudit.jsx` (692 lines). Server:
`server/routes/bookkeeping.js` `GET /recoupment-audit` (`:9520-9735`) plus
action endpoints `POST /recoup-review` (`:9334`), `POST /entries/ufr-bulk`
(`:9193`), `GET/POST/DELETE /recoupment-class-rules` (`:9425, 9441, 9480`),
and helpers `lib/recoup-context.js` (`loadArtistProposals:43`,
`loadLedgerTwins:95`, `attachRecoupContext:136`) and `lib/recoupment-class.js`
(`loadRecoupmentClassRules:65`, `notClassRuledSql:109`).

### Page layout

- **Header** — back-to-Recoupments link + "Recheck" refresh
  (`RecoupmentsAudit.jsx:110-125`); one fetch of `/bk/recoupment-audit`
  (`:83-92`).
- **Arithmetic sentence card** (`:139-163`) — "\$X looks claimable and is not
  claimed · \$Y is claimed and needs a second look · \$Z of bank spend has
  never been judged". Deliberately NOT summed into one exposure headline —
  "money not claimed and money claimed wrongly … need opposite actions"
  (`:102-106`).
- **Five stat tiles as the section selector** (`CHECKS`, `:57-73`; grid
  `:166-203`): each shows a Not claimed/Claimed/Unanswered kicker, compact USD
  (exact on hover, `:44-51`), count with the right noun (items/groups/
  payments), the double tile flags "N across two artists"; zero tiles dim to
  "nothing found". Active check's blurb repeats under the grid (`:205-207`).

### Check 1 — Advances waiting for an artist (`Advances`, `:248-355`)

Bank-verified rows in Advance / Recording / Tour/Live / `Artist Expense - %`
(prefix on purpose — `bookkeeping.js:9405-9412`) with no artist and never
reviewed. Per row: `BankEvidenceDot`, `PayeeLink`, category, paid date,
foreign-currency native amount, server-computed USD (`amount_usd_calc` via
`usdOf` — never face value or zero, `:53-55`). Two derived safety fields from
the server (`bookkeeping.js:9287-9300`):
- **`artist_proposal`** — artist name contained in the payee, pre-filled into
  a `datalist`-backed picker but never auto-applied ("from the payee — check
  it", `RecoupmentsAudit.jsx:328-336`).
- **`ledger_twin`** — invoice-side rows at the same payee+amount, rendered as
  a rose warning with links: "Match the bank line to it on Bank Matching …
  or the same cost is claimed twice" (`:296-321`).
Actions: **Recoupable** (requires an artist name; posts
`POST /bk/recoup-review {ids, recoupable:true, artist}`) or **Not recoupable**
(records the decision AND clears `recoupable` — "no" is an answer too,
`bookkeeping.js:9329-9333`) (`:253-273, 337-350`).

### Check 2 — The bank pile (`Pile`, `:358-499`)

Statement-born spend never judged recoupable, **grouped by category in SQL**
(1,919 rows would otherwise ship to the browser — `bookkeeping.js:9552-9567`).
Checkbox multi-select of open categories with a live "n selected · rows ·
USD" tally → **"Never recoupable"** posts
`POST /bk/recoupment-class-rules {scope:'category', keys:[…]}` (`:381-393`).
Existing rules render as chips with per-rule delete (complete undo — a rule
"writes nothing to the ledger", `:394-403, 441-471; bookkeeping.js:9414-9424`),
plus coverage stats (rules covering n rows / $) and the footnote that rules
match **exactly** — "a rule on 'Salary' does not cover 'Salary (Felipe)'"
(`:472-490`). Table: `recoupment_class_rules` (scope vendor|category, unique
`(scope, rule_key)`, `server/index.js:2063-2074`).

### Check 3 — Possibly claimed twice (`DoubleClaims`, `:502-568`)

Claimed rows grouped by `(payee lower, normalizeInvoiceNum)`; groups >1 are "a
SENSOR, not a verdict" (`bookkeeping.js:9663-9684`). Cross-artist groups get a
rose left border + "charged to A and B" and sort first. Per member: evidence
dot, id, artist/song, date, USD, **Unclaim** (`POST /bk/entries/ufr-bulk
{ids:[id], ufr:false}`). Footer explicitly resists over-correcting: "Two
deliverables billed on one invoice number are legitimate" (`:557-561`).

### Check 4 — Claimed with no document (`NoDocument`, `:571-641`)

Claimed rows whose **family** holds no invoice file — has_doc ORs the parent's
file columns and both storage paths (R2 key or legacy base64), because a split
child's document lives on its parent ("once reported 78 missing where 23
were", `bookkeeping.js:9568-9589`). Grouped **by artist** — "the conversation
this protects: one artist asking to see what they were charged for"
(`:576-588`). Per row: claimed date (`ufr_marked_at`), **Attach** (opens the
vendor page in a new tab — fix is one click from the finding) and **Unclaim**
(`:614-630`).

### Check 5 — Half a payment claimed (`PartialFamilies`, `:644-692`)

Split families (root = `COALESCE(parent_id,id)`) where recoupable members are
part claimed / part not — only recoupable members count, since an unclaimed
non-recoupable slice is correct, not incomplete (`bookkeeping.js:9591-9615`).
Per family: member list with claimed/not-claimed dots, claimed vs open USD,
**"Claim the other N slices"** (`ufr-bulk {ids: open_ids, ufr:true}`), link to
the artist's Recoupments page, and the caveat "Claiming stamps each slice with
today's date, so they land on this month's statement" (`:664-690`) — the
ufr-bulk endpoint preserves `ufr_marked_at` on already-Yes rows precisely so
statements don't silently move (`bookkeeping.js:9178-9192`).

### Server aggregate (`GET /bk/recoupment-audit`, `bookkeeping.js:9520-9735`)

Six parallel queries + assembly: advances (entry_source='bank_statement',
`recoup_reviewed=FALSE`, blank artist, advance-category SQL); pile by category
with `BOOL_OR(NOT notClassRuledSql)` so the page can say what a rule covers;
one shared claimed-rows query serving checks 3+4 ("splitting them would let
the two disagree"); partial families via a HAVING mixed-ufr subquery; class
rules; and a 400-name most-used-spelling artist vocabulary so the page is ONE
fetch (`:9620-9630`). The ALIVE predicate notes `entry_source IS NULL` on
1,201 hand-entered rows, so bank exclusion must be `IS DISTINCT FROM`-style
(`:9525-9528`). USD summed then rounded ONCE at the end (`:9638-9641`).

## 3. NEW status

**Confirmed absent.** Verified: NEW `client/src/App.jsx:161-162` has only
`/recoupments` and `/recoupments/planning`; repo grep for
`recoupment-audit|recoupment_class_rules|class-rules|recoup_reviewed|
recoup-review` over `client/src` + `server` returns nothing. NEW has
Recoupments v2 (drill-down, UFR statement stamping, statement tabs) + Planning
(CLAUDE.md M3) and a bulk claim path, but no integrity checks: nothing surfaces
artistless advances, the unjudged bank pile, double claims, undocumented
claims, or part-claimed families. NEW's swipe **ReviewDeck** covers statement
categorization review, not recoupability review; NEW has no
`recoup_reviewed` column and no class-rules table at all.

## 4. Port requirements

- **Schema**: `recoupment_class_rules` **+ `label_id`** (unique becomes
  `(label_id, scope, rule_key)`); `expenses.recoup_reviewed` boolean (OLD
  backfills it for pre-existing Yes rows — `server/index.js:2075+`). NEW's
  `ufr` is boolean and `recoupable` already exists (`financials.js:247`), so
  OLD's `ufr = 'Yes'` text comparisons become `ufr = TRUE`.
- **Server**: port the aggregate endpoint + `recoup-review` + class-rules CRUD
  into a NEW route (label-scoped throughout); NEW already has the needed
  primitives — `lib/usd.js` (usdOf), `lib/bankEvidence.js` (bankEvidenceCols
  equivalent), `lib/ledgerSource.js` (`excludeBankRows` — the IS DISTINCT FROM
  rule OLD's ALIVE comment insists on), `lib/normalizeInvoiceNum.js`,
  `lib/artistKey.js` (for grouping/vocabulary). Port `lib/recoup-context.js`
  (artist proposals + ledger twins) and `lib/recoupment-class.js` — both pure
  enough for `finance-fixtures.cjs`-style assertions (OLD asserts the
  2026-08-20 production figures). A ufr-bulk endpoint must replicate NEW's
  stamping rule (`statementMonthFor` on `ufr_marked_at`): stamp on transition
  into claimed, clear on transition out, preserve when already claimed.
  Advance-category matching should key off NEW's `categories` table
  (`ui_group`/`kind`) rather than OLD's hardcoded list + `Artist Expense - %`
  prefix.
- **Client**: one page `/recoupments/audit` behind `AdminRoute`, linked from
  Recoupments (NEW already has the tab pattern via Recoupments' statement
  tabs). Reuse `BankEvidenceDot`, `utils/recoupState.js`, `ui/` kit, toasts,
  `Skeleton`.

## 5. Defects

- [P1] Recoupment integrity audit missing — no surface catches artistless bank advances (OLD measured $391,958.60), the never-judged bank pile ($3.0M), double-claimed invoices (incl. cross-artist), claims with no document, or part-claimed split families; NEW recoupments can claim money but cannot check itself — fix: new `/recoupments/audit` page + one aggregate endpoint + `recoupment_class_rules`/`recoup_reviewed` schema (HIGH)
- [P2] No class-rules concept in NEW — without never-recoupable rules the review queue is unfinishable (OLD: 8 rules removed $2.07M of Royalties/Salary/Rent noise, bookkeeping.js:9414-9421) — fix: `recoupment_class_rules` table + CRUD, exact-match keys (MED)

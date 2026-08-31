# missing--bank-ledger — OLD's Bank Ledger (the bank half of the ledger, with statement lens)

## 1. What it is

The **bank half of the ledger**: the same full `BkLedger` component rendered with
a `bank` prop — `/bk/bank-ledger` → `<BkLedger bank />` (OLD `App.jsx:219`;
routing comment `App.jsx:213-218`: rows here "were created by booking a bank
debit, and every invoice control — approve, mark paid, W9, invoice file — is
inert on them"). It lists expenses with `entry_source = 'bank_statement'`
(measured at 2,326 of 3,692 rows / 62% / $3.64M, `BkLedger.jsx:129-133`) as
first-class, editable, bulk-operable ledger rows, and overlays a per-statement
**lens** that proves a month adds up. Protected route, same visibility rules as
the ledger; page in OLD's pageAccess registry (`bookkeeping.js:56`).

Distinct from `/bk/ledger-matching` (`LedgerMatching.jsx`, OLD `App.jsx:244`) —
that is a separate orphan (bookkeeper xlsx diff + handoff ZIP, per
`_audit/00-inventory.md:177`) and is NOT covered here.

## 2. OLD anatomy

All in `client/src/pages/BkLedger.jsx` (5,607 lines, shared with `/bk/ledger`)
plus `client/src/lib/statementLens.js` and server `routes/bookkeeping.js`.

**The two-half partition**
- Data fetch: `GET /bk/entries?status=approved&deleted=false&include_voided=true
  &view=ledger&source=bank|invoices` (`BkLedger.jsx:1723`).
- Server `source` param (`bookkeeping.js:767-778`): `bank` →
  `entry_source = 'bank_statement'`; `invoices` → `IS DISTINCT FROM
  'bank_statement'` (complement, never a second whitelist — 1,316 invoice rows
  have NULL entry_source); any other value is a 400, not ignored. Same contract
  on `GET /bk/export?source=` (`bookkeeping.js:8282-8287`) so the Excel export
  contains exactly the page.
- Client mirrors it: `LEDGER_VIEWS` all/invoices/bank (`BkLedger.jsx:290-303`)
  with `isBankRow = isBankStatementRow` from utils.js — one shared predicate
  (`:272-288`); `SOURCE_BUCKETS` gives every row a Source badge
  (recoupments/campaign/bank/vendor/admin, priority-ordered, `:224-266`).

**Bank-mode column model**
- Same ~28 toggleable columns as the invoiced half, per John 2026-08-20 ("more
  similar to the normal ledger", `:135-137`), PLUS three bank-only columns
  offered only here: **Statement**, **Bank line**, **Inv wanted?**
  (`BANK_ONLY_COLS`, `:119-123`), all reading `bank_evidence` which resolves
  split children through `COALESCE(parent_id, id)` (`:115-118`).
- `BANK_MODE_HIDDEN` one-click preset hiding the 16 structurally-empty columns
  (Inv #/Inv/W9/Proof/Receipt/Email/Address/Bank/Socials/Terms/Due Date/Reimb?/
  Cobrand?/Bulk Deal?/Campaign?/Source), kept because it's measured on 1,972
  live rows (`:149-155`, rationale `:139-148`).
- Separate, **versioned** localStorage key per half:
  `bk_bank_ledger_hidden_cols_v2` vs `bk_ledger_hidden_cols` (`:156-174`).
- "Inv wanted?" is fed server-side only when `source=bank`: `no_invoice_expected`
  = `bool_or` over the family root's matched `bank_transactions`
  (`bookkeeping.js:813-829`).

**The statement lens** (bank half only, `:1440-1460`)
- Statement dropdown from `GET /statements` (labels rendered as "Jun 2026 ·
  BofA" via `stmtOptionLabel`, `:176-190`); selecting one fetches
  `GET /statements/:id` per-statement (0.44s/703KB vs the 5.5MB `/statements/all`,
  `:1449-1460`).
- Filter to one statement's rows via `bank_evidence.statement_id` (`:2115-2117`).
- Pure rules in `lib/statementLens.js`:
  - `dispositionOf(t)` (`statementLens.js:30-44`): every bank line is exactly one
    of **dismissed / booked (match_method='created') / creator / matched /
    income / open**, checked in that order (a dismissed line can carry a stale
    matched_expense_id; a booking is not a match).
  - `summariseStatement` (`:80-129`): per-direction (money in/out) counts + USD
    by disposition, and the **tie-out** `beginning + credits − debits = ending`
    against the statement's own printed balances; `hasBalances=false` for
    accounts without them (live PayPal); rounds ONCE at the end and compares
    drift `=== 0` exactly.
  - `extraTransactions` (`:142-160`): the lines with **no editable row on this
    page** — everything except booked-lines-whose-row-is-on-screen, including
    the whole credit side; built against the FILTERED row set so a
    filter-hidden row's line resurfaces rather than vanishing (`BkLedger.jsx:2219-2229`).
- `ExtraTxRow` (`:939-1039`+): read-only row, deliberately NOT a ledger row (no
  inline editors, no bulk checkbox — there is no expense id; `:945-948`);
  disposition chip + contextual copy ("settled by an invoice · open it on the
  ledger →" for matched; income type · artist for income; dismissed reason;
  amber "nothing decided yet" for open); credits get a green left border and
  `+`; buttons act on the TRANSACTION: dismiss/undismiss, book income/unbook,
  match (`:956-957`).

**Cross-half focus routing**
- `?focus=<id>` deep links from ~10 pages; if the row isn't in this half the
  page redirects once to the other half with an `xhalf=1` one-hop marker, and
  reports "in neither" explicitly instead of a silent dead end
  (`BkLedger.jsx:1484-1512`).

**Everything else the invoiced ledger has works here**: 20-deep undo, bulk
column edits via `POST /bk/entries/bulk`, settlement groups
(`POST/DELETE /bk/settlement-groups`, `:2300-2351`), select-all over the
filtered set (`:2239-2264`), per-currency totals, infinite render window.

## 3. NEW status

**Absent as a surface; partially covered by `/bank-matching`.** Verified: NEW
`client/src/App.jsx` has no `/bank-ledger` route (grep `bank` → only
`/bank-statements`, `/bank-matching`, `/creators`, App.jsx:164-166); NEW
`server/routes/ledger.js` has zero `bank_statement` references and no `source`
param — and NEW's `lib/ledgerSource.js:19` exports `excludeBankRows()` for other
surfaces, but the ledger list itself doesn't partition.

What NEW's `/bank-matching` DOES cover: matching/booking workflows —
all-statements queue, LIKELY suggestions, completion model with
explained% vs invoice-backed% (`bank-matching.js:154-171`), reverse direction,
multi-invoice attach, rematch, funding pairs, split-book, rules, flags, monthly
soft close, global txn search (per CLAUDE.md 2026-08-27 build; disposition
vocabulary matched/booked/creator carried over).

What OLD has that NEW's bank-matching does NOT:
1. **Bank-booked rows as a browsable/editable LEDGER** — full column set, inline
   edit, bulk edits, undo, totals, source badges. In NEW, statement-born
   expenses just sit in `/ledger` mixed with invoices, with no bank/invoices
   view switch, no Source column, and no bank-only columns.
2. **The statement lens tie-out on the ledger** — `beginning + credits − debits
   = ending` with exact-cent drift, per-disposition USD summary per direction,
   and the extra-lines list guaranteeing every statement line appears somewhere
   on a page claiming to account for the month. NEW captures statement balances
   and has `statement_months` soft-close, but no month-accounting view joined
   to editable ledger rows.
3. **`source=` partition on the entries list + export** so an export contains
   exactly the page.
4. **Cross-half `?focus` redirect** (moot until the halves exist, but every NEW
   deep-link today lands bank-booked rows in the mixed ledger).

## 4. Port requirements

- **Schema**: none new — NEW already has `entry_source='bank_statement'` rows,
  `bank_transactions`-equivalents, statement balances, `bank_txn_invoice_links`,
  settlement analog. `no_invoice_expected` on bank transactions needs verifying
  in NEW's statement schema (`UNVERIFIED — needs runtime check`).
- **Server**: add `?source=bank|invoices` (reuse `lib/ledgerSource.js`
  `excludeBankRows` / `BANK_SOURCE` — the IS DISTINCT FROM rule is already
  codified there) to the ledger list + any export; add the `no_invoice_expected`
  bool_or column scoped to source=bank; per-statement detail endpoint exists
  (`/bank-statements/:id`, `(\d+)`-constrained).
- **Client**: a `bank` prop/route on NEW `Ledger.jsx` (mirroring OLD's one-
  component-two-routes); port `lib/statementLens.js` nearly verbatim (pure,
  fixture-testable — same style as NEW's `finance-fixtures.cjs`); reuse NEW's
  `lib/bankEvidence.js` + `BankEvidenceDot`/`utils/recoupState.js` for evidence
  cells; `ui/Modal`, `useCategories` for the book/match actions; ExtraTxRow
  actions map onto existing `/bank-matching` endpoints (dismiss, book income,
  match) rather than new ones.

## 5. Defects

- [P1] Bank half of the ledger missing — statement-born spend (62% of OLD's ledger by row count) has no dedicated browsable/editable surface in NEW, no bank/invoices partition on `/ledger`, and no `source=` contract on list/export — fix: `bank` mode on Ledger + `?source=` param reusing lib/ledgerSource (HIGH)
- [P2] Statement-lens month tie-out absent — `beginning + credits − debits = ending` with per-disposition USD and an extra-lines list; NEW's bank-matching shows completion % but no month-accounting view over ledger rows — fix: port lib/statementLens.js + lens UI (MED)
- [INT] OLD's `/bk/ledger-matching` (bookkeeper xlsx diff) is a separate orphan, intentionally not part of this entry; NEW deliberately rebuilt matching as `/bank-matching` rather than porting the bank ledger wholesale — the gap above is the ledger/lens surface, not the matcher.

# Statements v3 + Reports — build directions

Two parts. **Part A** is the delta on top of STATEMENTS_V2_DIRECTIONS.md —
build v2 first if you haven't; everything here assumes it. **Part B** is the
complete Reports feature (P&L + Balance Sheet), which no prior doc covers.
All of this exists in Boom production (`server/routes/statements.js`,
`server/routes/reports.js`, `client/src/pages/BkStatements.jsx`,
`client/src/pages/Reports.jsx`) — port semantics, not line-by-line code.
Same standing rules: label-scope every table and query, Admin/Superadmin
only, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations, update the
mock adapter if one exists.

The **Verification checklist** items at the end of each part reflect real
bugs Boom shipped and caught — run them, don't skip them.

---

# Part A — Statements v3 (delta on v2)

## A1. New categories

- Expense lists (every location): add `Royalties`, `Reimbursements`
  (between Salary and Advance — order matters, the deck's 1-9 hotkeys index
  the list).
- Income list: add `Reimbursements` (between Drawdown Fund and Refund).
- No auto-suggestion pattern for Royalties: royalty wires are addressed to
  artist names, which no regex recognizes. The learned payee map and
  "always book X as Y" rules cover repeat payees instead.

## A2. Date-paid as soft evidence in matching

Banks settle 1–3 business days after the ledger's paid date (up to 5
calendar days over a weekend, 7 with a holiday). Four changes:

1. **Suggestion score reweighted:** `amount·0.55 + name·0.30 + date·0.15`.
   Date component: `evidenceDate = paid ? payment_date : scheduled_payment_date`
   (yes — scheduled dates count for unpaid invoices); dateScore =
   `max(0, 1 − days/7)` when a date exists, **0.5 neutral** when not (never
   penalize undated candidates). Calibration you must preserve: exact
   amount + perfect name stays ≥90 whether paid or unpaid (93–100), so
   auto-accept still works; amount-only tops out at 70, below every
   automation threshold.
2. **Exact-tier tiebreak:** multiple exact-amount candidates and no name
   winner → take the one whose evidenceDate is within 3 days of the bank
   date, IF the runner-up is 3+ days farther. Method `auto-date`. Requires
   a non-empty bank payee.
3. **Nameless single-candidate allowance:** an exact-amount match with no
   payee text was previously refused outright (the currency-conversion
   lesson); an evidenceDate within 3 days now counts as the missing
   evidence.
4. **Candidate window for Paid rows: ±5 → ±7 days.**

## A3. Matcher evidence upgrades (biggest recall win)

### refEvidence — invoice/reference numbers in the wire text

The strongest signal a bank row can carry. Checked FIRST in nameEvidence,
returns score 1.0, method `auto-ref`:

- **Payment reference:** ledger `payment_ref` (Boom fills it from
  proof-of-payment AI scans and bank confirm-paid writes) found as a
  substring (≥4 chars) of `txn.reference + ' ' + txn.description`.
- **Invoice number:** normalize with the SAME canonical normalizer the
  duplicate-invoice detection uses (strip `invoice|inv|no.|#` prefixes,
  separators, leading zeros — `#003` ≡ `INV-003` ≡ `003`). Then:
  - Token scan (only when normalized length ≥ 2): split the wire text on
    `[\s,;:|]+`, normalize each token, compare. **MMDD guard:** skip pure
    4-digit tokens that parse as a valid month+day — card descriptors
    embed the charge date ("PURCHASE **0227** FACEBK") and invoice "227"
    must NOT match it.
  - Prefixed regex (any length, catches short invoice numbers like "003"
    that normalize to one digit): `(?:invoice|inv|no\.?|#)[\s\-.:_/]*0*<inv>\b`,
    case-insensitive, regex-escaped.
- `FAMILY_SQL` (the candidate query) must now select `payment_ref` and
  `scheduled_payment_date`.

### Vendor aliases as name evidence

Load `vendor_aliases` into symmetric groups (alias ↔ primary → one shared
Set, so lookups from either name find the group). In nameEvidence:
- bank name ∈ ledger payee's alias group → score 0.95, reason `alias`
- fuzzy vendorsMatch runs against the ledger payee AND every alias in its
  group; best score wins (reason `alias-fuzzy`)
- the learned-map hit also matches if the learned ledger name is an alias
  of the candidate's payee.

### Descriptor-normalized learned map

Card descriptors vary per charge ("FACEBK \*7LJZ4FDFP2 650-5434000" /
"FACEBK \*R3FA8FDGP2…") so an exact-string payee map re-learns every
charge. Add `normalizeBankPayee`:

```
lowercase → replace [*#] with space → split on whitespace →
drop tokens that are (length ≥ 4 AND contain ≥ 2 digits) — count digits,
  NOT /\d{2}/ adjacency (codes like "7ljz4fdfp2" have scattered digits) →
drop pure digit runs of 4+ → rejoin
```

"FACEBK \*7LJZ4FDFP2 650-5434000" → `facebk`; "UBER \*EATS 8005928996" →
`uber eats`; "T-MOBILE STORE # 9106" → `t-mobile store`. Build the payee
map with BOTH raw keys and normalized keys (normalized key only when ≥3
chars); lookup tries raw first, then normalized. Learning still stores the
raw string.

### Evidence priority order (final)

reference/invoice# (1.0, `auto-ref`) → email (1.0, `auto-email`) →
learned map raw-or-normalized (1.0, `auto-learned`) → alias exact (0.95,
`auto-alias`) → fuzzy best-of payee+aliases. Derive the method string from
the reason in ONE helper (`methodOf`) used by every tier.

## A4. One-debit-per-invoice: deck self-healing

v2 added the 409 guard; the deck needs to cooperate. Real bug: suggestions
are computed when the deck opens, so two duplicate rows both carried the
same 100% suggestion — accepting the first claimed the invoice, the second
swipe dead-ended on the 409 alert.

1. Deck state gains `claimed: new Set()`. Every successful match-accept
   adds the invoice id.
2. `deckPrimary(item)` picks the first suggestion with score ≥85 **not in
   claimed** (falls through to book-as-category when all are claimed).
3. On a 409 from a match-accept: don't alert — add the target to
   `claimed`, re-render (`setDeck(d => ({...d}))`), reset the card's
   category select. The card visibly flips to its fallback action.

## A5. Global search bar

`GET /statements/search?q=` (min 2 chars) — searches EVERY transaction in
EVERY statement: `payee_guess`, `description`, `payee_email`, `reference`,
matched ledger payee (LEFT JOIN), all ILIKE with like-escaping; plus exact
amount when the query parses as a number after stripping `$,`. Returns 50
newest with statement filename/account + disposition fields.

Client: input above the statement list, debounced 300ms, results dropdown
(date · best payee · statement file · status · signed amount, credits
+blue). Click → open that statement with the mini-ledger search pre-set to
the query and the right chip (`credits` for credits, `dismissed` for
dismissed, else `all`).

## A6. Flags v2 — from report to worklist

v2 shipped read-only flags. Upgrade every flag to
`{ severity, type, title, detail, fingerprint, statement_id?, q?, action? }`:

- **fingerprint** — stable identity: `datedrift:<txnId>`,
  `balance:<stmtId>`, `rt:<creditId>:<debitId>`,
  `dupes:<sorted pair ids>`, `nobank:<stmtId>:<n>:<roundedTotal>` etc.
  When the underlying set changes, the fingerprint changes and the flag
  resurfaces even if acknowledged. That's the point.
- **Acks table** `statement_flag_acks(id, label_id, fingerprint UNIQUE per
  label, created_by, created_at)`. `POST /flags/ack {fingerprint}` /
  `DELETE /flags/ack`. GET /flags splits results into
  `{ flags: active, acked }` — **response shape change**, update client +
  mock defensively (`Array.isArray(d) ? d : d.flags`).
- **Actions:** `{kind:'unmatch', txn_id}` on the four matched-pair checks;
  `{kind:'dismiss-pair', txn_ids:[credit,debit]}` on round-trips. Client
  renders View (jump via statement_id + q, same machinery as global
  search), Unmatch, Dismiss both, and OK (ack) buttons per row; acked
  section collapsible with Un-ignore.
- **Page-top chip** next to the page title: flag count, red if any error
  else amber, scrolls to the section (`scroll-mt` on the card).
- **Refresh on action:** fetchDetail calls fetchFlags — fixing something
  clears its flag immediately.

New checks beyond v2's nine:

| Check | Sev | Rule |
|---|---|---|
| Double-booked spend | error | two `created` txns, different statements, same lower(payee)+amount, txn_date within 3d — the ledger carries the charge twice |
| Missing ending balance | warn | statement has no ending_balance while other statements of the SAME account do (it silently opted out of balance continuity) |
| Stale coverage | warn | period ended >7d ago, ≥20 open debits, <60% of debit dollars matched |
| No bank proof | warn | Paid ledger families whose payment_date falls inside a covered statement period (±3d, account method-compatible) that NO txn anywhere matches. **Aggregate per statement** — one flag saying "23 paid entries, $84,120, first few payees…", not 23 flags. Assign each family to the first covering statement so overlapping uploads don't double-flag. Detail text names the three explanations: wrong date / paid from an account with no statement / never actually paid. |

## A7. Part A verification checklist

- Evidence harness against the REAL source functions (eval the file slice;
  note `const`/`function` declarations don't escape eval — rebind onto
  globalThis): "WIRE PMT DET: INV 003" + invoice `#003` → invoice# hit;
  "PURCHASE 0227 FACEBK" + invoice `227` → NO hit (MMDD guard);
  "payment 00123" + `INV-123` → hit; payment_ref substring → hit;
  "FACEBK *R3FA8FDGP2 650-…" hits a map learned from a DIFFERENT Facebook
  descriptor; "Edward Marange" ↔ "Eddie Marange" via alias; scheduled-date
  evidenceDate for unpaid rows.
- Score calibration: exact+name+unpaid ≥90; exact+name+paid-3d-off ≥90;
  exact+no-name+same-day ≤70.
- Deck: accept a card, verify a later card sharing the same top suggestion
  flips to book-as-category instead of 409ing; force a 409 (match in a
  second tab) and verify the card self-heals without an alert.
- Flags: ack → moves to acknowledged; un-ack → returns; fix a flagged
  match → flag clears on the next action without a manual refresh.
- Global search: text hits across multiple statements; `$1,250.00`-style
  amount query; click-through lands filtered.

---

# Part B — Reports (P&L + Balance Sheet)

New page + new route file. Uses ExcelJS (already a cadence dep if the
campaigns exports were ported; add it if not). Gate: bookkeeping-admin
roles. Register page/route/nav/permissions/mock per cadence's
add-a-page checklist.

## B1. Shared helpers (route file top)

- `usdOf(amount, currency, lockedRate)` — locked fx rate first
  (`amount / locked`), else live cached ECB rate (`amount / rate`), 1:1
  ONLY for USD. Never silently 1:1 a foreign currency.
- `ym(d)` — **pg returns DATE columns as JS Date objects.**
  `String(d).slice(0,7)` produces "Thu Jan" garbage buckets that silently
  zero the whole report (Boom shipped this). Branch:
  `d instanceof Date ? \`${getFullYear()}-${pad(getMonth()+1)}\` : String(d).slice(0,7)`.
- `monthsBetween(from, to)` — inclusive YYYY-MM list.
- Below-the-line sets:
  `BELOW_LINE_INCOME = {'Drawdown Fund','Reimbursements','Refund'}`,
  `BELOW_LINE_EXPENSE = {'Advance','Reimbursements'}`. A drawdown is an
  advance received (liability, not revenue); reimbursements wash;
  refunds reverse spend. Keeping them above the line makes a $700k
  drawdown month read as a record month.

## B2. buildPnl(from, to, artist) — cash basis

- **Income:** income rows by `income_date`, bucketed by `income_type`
  (null → 'Other Income'), split operating vs below-line by the sets.
- **Expenses:** ledger rows `payment_status='Paid'` bucketed by
  `payment_date` — cash basis so the report reconciles 1:1 against bank
  statements. Approved + not deleted + not voided. **Sum ALL rows** —
  split parents keep only their own slice, children carry theirs; a
  `parent_id IS NULL` filter or a "skip children" loop silently drops
  money (Boom lost $1,250 to exactly that in another report). USD via
  usdOf per row. Category null/blank → 'Uncategorized'. Split operating
  vs below-line.
- **Artist filter (optional param):** expenses
  `LOWER(TRIM(artist)) = LOWER(TRIM($n))`; income the same on the income
  table's artist-name column. Case-insensitive is the house rule.
- **Coverage per month** (bank-wide, NOT artist-scoped): from
  bank_transactions grouped by `date_trunc('month', txn_date)` —
  `pct = matched debit $ / live debit $` (100 if no debits),
  `open_n` count. Only emit months inside the range. A month with
  unmatched debits has invisible expenses; the client marks it.
- **Artists list** for the dropdown: DISTINCT TRIM'd names from expenses
  UNION income, dedupe case-insensitively keeping the first spelling,
  sorted.
- Response: `{ months, income, expenses, income_totals, expense_totals,
  net, below: {income, expenses, income_totals, expense_totals, net},
  coverage, artists, artist, basis:'cash' }` — every `*_totals` is
  `{series: {ym: n}, total}`; `net` is operating only.

## B3. pnlDetail — the drill-down

`GET /reports/pnl/detail?kind=income|expense&key=<cat/type>&month=YYYY-MM&from&to&artist`
— month optional (absent = whole range; compute month bounds as
`month-01` … last day via `new Date(y, m, 0).getDate()`).

- expense: same WHERE as buildPnl's expense query + category match
  (`'Uncategorized'` → `category IS NULL OR TRIM(category)=''`, else
  `TRIM(category)=TRIM($n)`), rows with id/date/payee/artist/song/
  invoice_number/usd/original amount+currency, ordered by date.
- income: `income_type` match (`'Other Income'` → NULL-or-equal), same
  shape.
- Return `{rows, total}`. **Invariant: total must equal the P&L cell** —
  same filters, same usdOf. Probe-assert this, it's the whole point.

## B4. buildBalanceSheet(asOf)

- **Cash** = `DISTINCT ON (account)` latest ready statement with
  `ending_balance IS NOT NULL AND period_end <= asOf`, per account. This
  is why statements parse ending balances.
- **A/R** = unpaid OUTBOUND invoices (cadence's own outbound-invoices
  table — Boom's is `boom_invoices`, NOT the vendor `invoices` table;
  Boom 500'd on that name mixup) issued ≤ asOf, USD per row.
- **A/P** = approved unpaid ledger entries, `invoice_date ≤ asOf` (or
  null), USD per row.
- **Advances outstanding** = `SUM(income where income_type='Drawdown Fund'
  AND income_date <= asOf)` — drawdowns received are unearned money owed
  back through recoupment: a liability line, not equity padding.
- Equity = Assets − Liabilities (plug), where Liabilities = A/P + advances.

## B5. Client page

Two tabs (P&L / Balance Sheet), date-range + artist select + Run + Export
Excel toolbar.

**P&L table:** month columns + Total, sticky first column, sections:
Income lines → Total Income → Expenses lines → Total Expenses →
**Net Income (operating)** (color-coded) → when any below-line data:
"Below the line — advances & pass-through" section (income lines, expense
lines rendered with a − prefix, Below-line net in gray) →
**Net Change in Cash** = operating net + below net (color-coded).

- **Drill-down:** every category/type cell with a value (month cells AND
  the row total) is clickable → modal listing the entries (date, payee,
  artist·song·inv sub-line, USD with original-currency note), header
  shows the cell total, backdrop/X closes. Respect the artist filter.
- **Coverage markers in month headers:** amber warning triangle when
  `coverage[m].pct < 85` (title tooltip: "62% of bank debits reconciled —
  14 open; expenses likely missing from this column"); small gray dot
  when the month has no coverage entry ("No bank statement data — expenses
  unverified").
- Artist select fires an immediate refetch on change (pass the new value
  explicitly — state hasn't committed yet).

**Balance Sheet:** simple card — Cash per account (with as-of + source
statement), A/R (count), Total Assets; A/P (count), Advances outstanding
(only when count > 0), Total Liabilities; Equity color-coded. Empty-cash
amber note telling the user to upload statements with balances.

## B6. Excel exports

`/reports/pnl/export` and `/reports/balance-sheet/export` — styled
workbooks (bold colored headers, `"$"#,##0.00;[Red]("$"#,##0.00)` money
format, frozen panes on the P&L). P&L export mirrors the page exactly:
operating sections, Net Income (operating), below-line section, Net Change
in Cash; artist scoping in the title. BS export includes the advances line
when present.

## B7. Part B verification checklist

- **P&L non-zero:** the ym() Date-object bug produces an all-zeros report
  that otherwise looks fine — assert a known month has real numbers.
- **Drill = cell:** fetch the P&L, pick a category, fetch its detail for
  the full range, assert `abs(detail.total − sum(line.series)) < 1`.
- **Split families:** carve a fee/reimb split (or any parent+children),
  confirm the P&L month total includes ALL slices exactly once.
- **Below-line:** book a Drawdown Fund credit — operating net unchanged,
  below-line and Net Change in Cash move; balance sheet grows an
  Advances liability of the same amount.
- **Artist filter:** filtered expense total < unfiltered; drill rows all
  carry that artist; income filtered too.
- **Balance sheet:** correct outbound-invoices table name (500 otherwise);
  as-of in the past excludes newer statements/entries.
- **Foreign currency:** a EUR expense with locked fx shows its locked USD
  value; without locked fx it uses the live rate, never 1:1.

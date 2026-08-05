# Statements v2 — build directions

Boom's statements page kept evolving after BUILD_DIRECTIONS_2.md was written.
This doc is the complete delta: everything below exists in Boom production
(`boom-dashboard/server/routes/statements.js` + `client/src/pages/BkStatements.jsx`)
and should be ported into cadence's `bank-statements.js` + statements page.
Same rules as before: every table/query is label-scoped, Admin/Superadmin only.
Read the whole doc before coding — several items have ordering gotchas that
produced real bugs in Boom.

## 1. Schema additions

- `bank_statements` + `ending_balance NUMERIC` — the closing balance printed
  on the statement. Parsed from PDFs (see §3) and from a CSV balance column
  when one exists. Powers the balance-continuity flag (§9) and, if/when
  cadence builds a balance sheet, the Cash section.
- `bank_transactions` + `payee_email TEXT` — banks (PayPal especially) mash
  "Name / email@x.com" into one field; store the email separately.
- `bank_transactions` + `matched_income_id INT` — credits book as income
  rows (§5), symmetric with `matched_expense_id`.
- Remember cadence's migration rule: add to CREATE TABLE **and** an
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` line.

## 2. Payee/email split (ingest + retroactive)

At insert time, pull an email out of the payee with
`/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`, store it in
`payee_email`, and strip it (plus leftover ` /|,-` punctuation) from
`payee_guess`. Run the same regex as an **idempotent retroactive UPDATE** in
the statements list handler so pre-existing rows migrate themselves:

```sql
UPDATE bank_transactions SET
  payee_email = LOWER(substring(payee_guess from '<EMAIL_RE>')),
  payee_guess = btrim(regexp_replace(payee_guess, '<EMAIL_RE>', '', 'g'), ' /|,-')
WHERE payee_email IS NULL AND payee_guess ~ '<EMAIL_RE>'
```

Render: payee name as the row title, email as a small mono sub-line —
the row should look like the statement does. Hide generic payees like
"General Payment" as titles; fall back to description.

## 3. PDF prompt additions

Two changes to the pipe-delimited parse format:
- First output line: `ENDING_BALANCE|<number>` (or `ENDING_BALANCE|` when
  the document doesn't print one).
- Per-txn line gains an EMAIL field:
  `DATE|DIRECTION|AMOUNT|PAYEE|EMAIL|REFERENCE|DESCRIPTION`.

## 4. Matcher: email tier first

`nameEvidence()` gains a top tier: if `txn.payee_email` equals the ledger
family's `vendor_email` (case-insensitive), that's score 1.0, method
`auto-email` — checked BEFORE the learned payee map, which is before fuzzy.
An email match is the strongest evidence a bank has.

## 5. Credits are income (Money in)

Debits reconcile to expenses; credits book to the income table (cadence's
equivalent of Boom's `artist_income`: artist nullable, `income_type`,
`income_date`, `created_by`).

- Income categories: `Streaming / Distribution`, `Sync Licensing`,
  `Publishing`, `Merch`, `Performance`, `Drawdown Fund`, `Refund`,
  `Other Income`. (Order matters — the deck's 1-9 hotkeys index into it.)
- `POST /txns/:id/book-income {income_type}` — inserts an income row with
  the bank date + payee, sets `matched_income_id`. `unbook-income`
  hard-deletes the created income row and reopens the credit.
- Disposition for credits: `open-credit` / `booked-income` (+dismissed).
  Filter chip "Money in" with count. Inline income-type select books
  immediately, like Categorize does for debits.
- **suggestIncomeType** (view-time): `refund|reversal of payment` → Refund;
  then `drawdown|\badvance\b` → **Drawdown Fund** (MUST come before the
  distributor rule — a "STEM ADVANCE" wire is a drawdown, not royalties;
  note `\badvance\b` word boundary so "Advanced Audio LLC" doesn't match);
  then distributor names (`distrokid|tunecore|cd ?baby|believe|stem\b|
  too ?lost|symphonic|vydia|united masters|distribution`) →
  Streaming / Distribution.

## 6. Expense category lists + view-time suggestions

Add to EVERY expense-category list in cadence (find them all — Boom had 5
locations and a missed one silently drops the option): `Travel`,
`Meals & Entertainment`, `Software / Subscriptions`, `Bank Fees`, `Salary`
(before `Advance`, `Other`).

**CATEGORY_SUGGESTIONS** — computed at GET-detail time for open debits,
never stored (so pattern fixes retroactively apply to every statement).
Port Boom's list verbatim; the ordering gotchas are load-bearing:

1. `/uber\s*\*?\s*eats|ubereats/i` → Meals & Entertainment. **FIRST**, so
   card-descriptor variants ("UBER *EATS", "UBEREATS 800…") never fall
   through to Travel.
2. Travel: `/\buber\b(?!\s*\*?\s*eats)|\blyft\b|\btaxi\b|rideshare|\bparking\b|\bshell oil|\bchevron\b|\bexxon\b|\barco\b|gas station/i`
   — note the asterisk-tolerant negative lookahead on uber.
3. Travel (air/hotel): airlines, `\bhotel\b`, marriott, hilton, airbnb,
   amtrak, hertz, enterprise rent.
4. Bank Fees, generic `<bank word> fee`:
   `/\b(wire|transfer|ach|atm|withdrawal|deposit|account|card|check|statement|analysis|annual|monthly|maintenance|service|servicing|processing|transaction|conversion|currency|bank|paypal|overdraft|late payment|stop payment|returned? item|nsf) fees?\b|service charge|overdraft|nsf\b|insufficient funds|foreign transaction|intl? transaction/i`
   — covers "External transfer fee - Next Day" style phrasings while
   leaving vendor fees ("producer fee", "mixing fee") unsuggested.
5. Bank Fees, two-signal fallback: a **function** entry, not a regex —
   `hay` contains `\bfees?\b|\bcharge\b` AND names a bank/processor
   (bank of america, wells fargo, chase, jpmorgan, citi, capital one, pnc,
   td bank, us bank, hsbc, paypal, venmo, stripe, square, wise, mercury).
   Support both shapes: `find(s => s.re ? s.re.test(hay) : s.test(hay))`.
6. Meals: doordash, grubhub, postmates, restaurant, cafe, starbucks,
   chipotle, etc.
7. Software / Subscriptions: adobe, dropbox, slack, zoom, notion, figma,
   canva, apple.com/bill, openai, anthropic, github, aws, vercel, splice,
   izotope, waves audio, native instruments, etc.
8. Services: fedex, ups store, usps, dhl.
9. Salary: `/\bgusto\b|\badp\b|paychex|justworks|rippling|\bdeel\b|trinet|payroll|\bsalary\b/i`.

Haystack = `payee_guess + ' ' + description`. The suggestion pre-fills the
Categorize select and the deck; nothing books without a confirm.

## 7. Swipe review deck (Tinder-style triage)

Full-screen overlay reviewing every open item one card at a time:

- **Deck contents:** all open debits + open credits (not dismissed, not
  matched). Sort: pre-tagged rows (has suggested category/income type)
  first, then rows with a ≥85% match suggestion, then the rest.
- **Primary action per card** (`deckPrimary`): if top match suggestion
  score ≥ 85 → "match to <invoice>"; else debit → "book as <category>"
  / credit → "book as <income type>", select pre-filled from the
  suggestion (fallback 'Other' / 'Other Income'). The select is editable
  on the card — "SWIPE RIGHT TO BOOK AS (SUGGESTED)".
- **Gestures/keys:** swipe right or `→` = accept (runs primary action);
  left or `←` = skip; `D` = dismiss; `1-9` = pick category from the list;
  `Esc` = close. Progress "n of N" + a Done—close bar; closing shows
  quick stats (matched/booked/dismissed/skipped) and refetches.
- **THE POINTER-CAPTURE BUG (Boom shipped it):** the card's
  `onPointerDown` calls `setPointerCapture` for drag — which swallows
  every child click, so buttons/selects go dead for mouse users. Guard:
  `if (e.target.closest('button, select, option, a')) return` before
  capturing. Accept/skip threshold: |dx| > 120px; animate with the drag.
- Keyboard listener must no-op when focus is in an INPUT/TEXTAREA.

## 8. One bank debit per invoice family (enforced)

A second txn claiming the same invoice is a duplicate charge or a
mis-match. Four layers (Boom's auto-matcher already had the first):

1. **Auto-match:** `used` set seeded from ALL existing claims
   (`SELECT DISTINCT matched_expense_id ...`) + `used.add()` per match in
   the run. Verify cadence's matcher does both.
2. **Manual match endpoint 409s** when the family root is already claimed
   by another live (non-dismissed) txn — error message names the holding
   debit's amount/date and says "unmatch that one first".
3. **Retroactive dedupe sweep** (idempotent, in the list handler): for each
   `matched_expense_id` claimed by >1 live txns, keep the strongest —
   `ORDER BY (method='created') DESC, (method='manual') DESC,
   match_score DESC NULLS LAST, matched_at ASC` — and reopen the rest via
   ROW_NUMBER() OVER (PARTITION BY matched_expense_id). **Never unlink
   `created` rows** (their ledger entry was created FROM the txn; outer
   guard `match_method IS DISTINCT FROM 'created'`).
4. **Client "likely" set dedupes:** if two open rows share the same top
   suggestion, only the higher-scoring one counts (the other would 409).
   Bulk accept collects per-row errors and alerts a summary instead of
   swallowing failures.

Trade-off to document in the UI/manual: an invoice genuinely paid in two
installments can't have both debits matched until installment support lands.

## 9. "Likely" filter chip

`isLikely(t) = disp === 'open' && top suggestion score ≥ 90`, then deduped
per §8.4. Chip sits between Open and To confirm; its count, the
"Accept N likely" button count, and what actually succeeds are all the SAME
computed array — one predicate, zero drift. Clicking filters the table to
those rows; search/sort apply within.

## 10. Flags — cross-statement integrity checks

`GET /statements/flags` (label-scoped, admin) returns
`[{severity: 'error'|'warn', type, title, detail}]`, errors sorted first.
Rendered as a card at the BOTTOM of the statements page: red rows for
errors, amber for warnings, refresh button, explicit "No issues detected"
empty state. Client refetches when a statement opens/closes. The checks:

| Check | Severity | Rule |
|---|---|---|
| Balance continuity | error | For consecutive same-account statements (gap ≤ 5d): prior `ending_balance` + Σcredits − Σdebits = this `ending_balance` (±$0.05). Mismatch = the parse missed/misread rows — the strongest catch-all for bad parses. Skip if either statement has foreign-currency rows. |
| Cross-statement duplicates | error | Same account+date+amount+direction+payee in two different statements, both live. Self-join `b.id > a.id`, LIMIT, aggregate into one flag with examples. |
| Broken ledger link | error | A live match whose family root no longer resolves via FAMILY_SQL (deleted/voided/unapproved). |
| Missing month | warn | >5-day gap between consecutive same-account periods. |
| Out-of-period dates | warn | Txns dated outside `period_start−3 .. period_end+3` — misparsed dates. |
| Amount drift | warn | Matched pair where \|bank − family_total\| > max($35, 1%). Only manual matches can exceed it — flags suspect matches. |
| Currency mismatch | warn | Matched pair with different currencies. |
| Payment-date drift | warn | Ledger paid date vs bank date > 14 days apart. |
| Internal round-trips | warn | Same-amount credit+debit within 3 days on one account, both open, ≥ $100 — internal movement the noise list missed; nudge to dismiss both sides. |

All queries read-only; the endpoint mutates nothing. Money/date formatting
in `detail` strings — write for a human ("off by $1,250.00", "37 days
apart"), the card is the explanation.

## 11. Verification checklist

- Regex suggestion tests: run the actual pattern arrays (eval the source
  slice, don't retype them) against descriptor fixtures — "UBER *EATS" →
  Meals, "UBER *TRIP" → Travel, "External transfer fee - Next Day" →
  Bank Fees, "Producer fee" → null, "STEM ADVANCE" → Drawdown Fund,
  "Advanced Audio LLC" → null, "GUSTO PAYROLL" → Salary.
- Deck: verify buttons work with a MOUSE (the pointer-capture bug),
  keyboard keys, and drag on touch.
- Match a txn, then try matching a second txn to the same invoice → 409
  with a readable message.
- Upload two overlapping statements → duplicates flag fires; delete one →
  flag clears on refresh.
- If cadence has a test-user mock adapter, add matchers for the new
  endpoints (flags, book-income, unbook-income) with correct shapes.

# missing--vendors-added-expenses — OLD's Added-Expense Vendors subpage

## 1. What it is

The invoice-less side of the vendor world: payees created implicitly by expenses
added through the **Recoupments / Artist Campaigns add modals**. Those rows have
no invoice number, so nothing structural prevents double entry or a creator's
total quietly climbing — this subpage aggregates them per normalized payee,
flags likely duplicate entries and spelling-variant groups, and color-codes
totals (page header comment, OLD `client/src/pages/BkVendorsAdded.jsx:12-21`).

- Route: `/bk/vendors/added-expenses` → `BkVendorsAdded.jsx` (OLD `App.jsx:226`,
  import as `BkVendorsAdded`). Protected (standard auth); no extra role gate on
  the endpoint.
- Reached from `/bk/vendors` ("All vendors" back-link, `BkVendorsAdded.jsx:69-74`).

## 2. OLD anatomy

Client — `client/src/pages/BkVendorsAdded.jsx` (224 lines):

- **Summary strip** (`:84-107`): Vendors count · Items count · Total ≈USD
  (client-side `totalsToUsd(totals, fxRates)` via `FxRatesContext`, `:50-54`) ·
  Possible duplicates count (amber when >0).
- **Possible duplicate entries card** (`:110-141`): one row per pair — payee,
  `amount × 2` in currency, both dates/artists/songs "vs" each other, and two
  `?focus=<id>` deep links into `/bk/ledger` for review/delete.
- **Name variants card** (`:144-168`): groups where one normalized key has 2+
  raw spellings; each spelling links to `/bk/vendors/:spelling` with copy
  pointing at Merge Vendor / rename to consolidate totals.
- **Vendor table** (`:171-217`): rows sorted by USD desc, click-through to
  `/bk/vendors/:payee`. Columns: Vendor/creator (+"+N spellings" chip) · Items ·
  Artists (first 3 + overflow) · Last activity · Total (per-currency string) ·
  ≈USD · **Level band** — fixed thresholds OK / Watch ≥$1,000 / High ≥$5,000
  USD-equivalent (`bandFor`, `:30-35`), documented in a footnote (`:218-222`).
- Skeleton loading state; empty state "No added expenses on file yet."

Server — `GET /api/bk/vendors/added-expenses`
(`server/routes/bookkeeping.js:5256-5335`):

- Source query: `expenses WHERE entry_source IN ('recoupments',
  'artist_campaigns')`, not deleted, not voided; `spent_date =
  COALESCE(invoice_date, created_at::date)` (`:5258-5267`).
- **Normalization**: `normKey = lowercase, strip all non-alphanumerics`
  (`:5270`) — buckets spelling variants together; per-bucket it tracks spelling
  frequency (display name = most-common spelling, `:5313-5315`), per-currency
  totals, artist set, last_date (`:5271-5286`).
- **Duplicate pairs** (`:5288-5311`): pairwise within a payee bucket — same
  amount, same currency, dates within 7 days; capped at 100 pairs; each pair
  carries both row ids/artists/songs/dates.
- **nameVariants** (`:5317-5322`): buckets with 2+ raw spellings.
- Returns `{ vendors, dupePairs, nameVariants }`.

## 3. NEW status

**Absent.** Verified: no route in NEW `client/src/App.jsx` (grep
`added-expense` → nothing; vendors surface is only `/vendors` at App.jsx:184),
and `grep -rn "added-expenses" server/routes/` in NEW returns nothing.

Partial adjacency, not coverage:
- NEW `/creators` (App.jsx:166, `routes/creators.js`) is a directory of
  `entry_source='creator_payment'` rows with W9/1099 exposure — a *different*
  population (deliberate creator payments) than OLD's implicitly-created
  recoupment/campaign payees; NEW even has a convert/unconvert flow for rows
  born on campaigns/recoupments, which presumes those rows exist un-surfaced.
- NEW `/vendors` has rename/merge/aliases (covers the *remediation* the
  name-variants card points at) but no invoice-less aggregation, no dupe-pair
  detection, no spend bands.
- NEW ledger's `check-dup` warns on duplicate *invoice numbers* — useless for
  these rows, which have none (the exact gap this page exists to fill).

## 4. Port requirements

- **No schema** — NEW `expenses` already carries `entry_source` (values include
  `'artist_campaigns'`, `'recoupment'` per `lib/ledgerSource.js:4-6`; NOTE the
  spelling difference: OLD filters `'recoupments'` plural, NEW's documented
  value is `'recoupment'` singular — the port must use NEW's vocabulary or it
  silently returns nothing).
- Endpoint: label-scoped `GET /api/ledger/vendors/added-expenses` (or under
  /vendors) reimplementing bucket/dupe/variant logic; reuse NEW
  `lib/artistKey.js`'s canonical strip-all key — it IS OLD's normKey
  (CLAUDE.md: "canonical strip-all key = artist-campaigns' normKey"), so don't
  write a second normalizer. USD via NEW's `lib/usd.js` rowUsd (locked
  `fx_rate_to_usd` always wins) server-side, rather than OLD's client-side
  fx-context conversion.
- Client: subpage linked from `/vendors`; reuse `?focus=` deep links (NEW ledger
  supports `?focus`), Skeleton, `formatDate`. Dupe-pair rows could optionally
  reuse the ReviewDeck pattern, but OLD is a flat list — flat is fine.
- Decide interplay with `/creators`: rows converted to creator payments leave
  this population by entry_source; that's correct and self-consistent.

## 5. Defects

- [P1] Entire surface missing — invoice-less (recoupment/campaign-born) payee aggregation with duplicate-entry and spelling-variant detection has no NEW counterpart; double-payments in these flows are currently invisible — fix: new subpage + endpoint reusing artistKey/usd libs (HIGH)

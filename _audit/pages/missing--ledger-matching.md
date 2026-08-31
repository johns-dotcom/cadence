# missing--ledger-matching — OLD's Bookkeeper Reconcile (ledger ↔ external bookkeeper xlsx diff)

## 1. What it is

The **ledger-side matching workbench**: upload the external bookkeeper's weekly
"OUTSTANDING INVOICES SUMMARY" xlsx, diff every row against the Boom ledger by
normalized invoice # + tiered fuzzy vendor name, and produce (a) an on-screen
categorized discrepancy report and (b) three bookkeeper deliverables — a
multi-sheet Excel report, a "BK Excel" that mirrors the bookkeeper's own
workbook layout populated with Boom data, and a full handoff ZIP with every
invoice/W9/proof file.

- Route: `/bk/ledger-matching` → `<LedgerMatching />` (OLD `client/src/App.jsx:244`),
  Protected; nav "Bookkeeping · More › Bookkeeper Reconcile" (`_audit/00-inventory.md:54`).
- Page title is "Bookkeeper Reconcile"; the page explicitly disambiguates itself
  from bank matching with an inline link "Looking for bank statement ↔ ledger
  matching? That's the review deck on Statements" (`LedgerMatching.jsx:354-359`).
- Server side is **Admin-gated** — every endpoint starts
  `if (!isAdmin(req.user)) return 403` (`bookkeeping.js:10790, 11700, 11734, 12242`).

Boundary note: this is NOT the bank ledger. `_audit/pages/missing--bank-ledger.md`
covers `/bk/bank-ledger` (statement-born rows as an editable ledger + statement
lens) and explicitly excludes this page; the reverse holds here — nothing below
touches `bank_transactions`.

## 2. OLD anatomy

Client: `client/src/pages/LedgerMatching.jsx` (638 lines). Server: five
endpoints in `server/routes/bookkeeping.js` plus the shared fuzzy matcher
`server/lib/vendorMatch.js` (157 lines, also used by the bank-statement
matcher — `bookkeeping.js:10765-10767`).

### Page flow (client)

1. **Drop zone** — `.xlsx`/`.xls` only, client-validated by extension, "max
   10 MB" copy (`LedgerMatching.jsx:181-190, 384-392`); picked-file card with
   size + remove (`:394-407`).
2. **Requirements card** — plain-English contract: each sheet needs a header
   row with Vendor + Invoice # (Amount / Paid Date / Artist / Description
   picked up too); invoice #s compared after stripping `#`/`INV-`/leading
   zeros; tiered fuzzy vendor match; Summary/Totals tabs auto-skipped
   (`:362-374`).
3. **"Match & flag differences"** button → `POST /bk/ledger-diff` multipart
   (`:192-211`); on success auto-opens the first non-empty discrepancy
   category (`:204-205`).
4. **Summary tiles** — one clickable count tile per category, disabled at 0
   (`:481-502`). Eight categories, order = tab order, "matched" (clean rows)
   hidden by default by landing on discrepancies first (`CATEGORIES`, `:12-21`):
   amount_mismatch, paid_status_mismatch, paid_date_mismatch,
   missing_from_dashboard ("Missing on Boom"), missing_from_bookkeeper,
   vendor_name_variation, no_invoice_num, matched.
5. **Workbook header context line** — rows parsed, sheets processed, inferred
   sheet years, dashboard rows considered, WEEK ENDING snapshot date, skipped
   sheets w/ reasons (`:505-516`).
6. **Diff table** — columns Sheet (+row #), Bookkeeper side (vendor, invoice #,
   amount, artist, paid date/amount), Dashboard side (payee + entry id,
   invoice #, `family_amount ?? amount`, artist, payment status/date), Notes
   (`:561-624`). Two chip systems:
   - **ConfidenceChip** per row (`:35-72`) — plain-English label per
     `vendor_match_reason` tier (Identical / Aside differs / Suffix differs /
     Shorter name / Partial match / Reordered w/ Jaccard score in tooltip),
     colors mirrored 1:1 with the workbook's `diffConfidenceMeta`
     (`bookkeeping.js:11201-11213`).
   - **IssueTags** (`:78-122`) — parses the prose `issues[]` into compact
     colored tags (AMOUNT / PAID STATUS / PAID DATE / VENDOR / MISSING ON BK /
     MISSING ON BOOM / NO INVOICE #), full prose kept in the tag's title.
7. **Per-category Excel export** — "Export Excel (n)" posts the filtered rows
   to `/bk/ledger-diff-export` and streams one styled tab (`:142-159, 322-337,
   527-540`).
8. **"Send this to the bookkeeper" action bar** (`:424-478`), three builds with
   mutual in-flight disables:
   - **Bookkeeper handoff (.zip)** → `POST /bk/ledger-diff-handoff` (`:289-314`).
   - **Full Excel report** → `POST /bk/ledger-diff-report` (`:216-241`).
   - **BK Excel** → `POST /bk/bk-style-export`, re-uploading the source xlsx as
     a styling template + only `sheet_years` and `week_ending` fields (the full
     diff would blow multer's 1MB field limit — `:248-284`, esp. `:253-259`).
   All blob handlers detect a JSON-typed blob and surface the server error
   (`:148-152, 221-225` et al).

### Server endpoints

**`POST /bk/ledger-diff`** (`bookkeeping.js:10788-11148`) — the matcher:
- ExcelJS parse with `cellText` flattening formula/richText/hyperlink cell
  variants and `cellAmount` stripping currency symbols + accounting parens
  (`:10799-10824`).
- **Header-row autodetect** — scans first 20 rows, scores keyword hits
  (vendor/payee/invoice/amount/date/artist/…), needs score ≥ 2; tuned for the
  bookkeeper template where the header sits at row 6 under a title block
  (`detectHeaderRow`, `:10828-10847`).
- **Column autodetect** by fuzzy header name (vendor/payee_name/invoice/amount/
  artist/description/invoice_date/due_date), plus a sub-header scan one row
  down for the two-column "PAID → DATE + AMOUNT" block (`findColumns`,
  `:10850-10877`); the data start skips the sub-header row when present
  (`:10933-10940`).
- **WEEK ENDING extraction** from the workbook's title block (`:10892-10896+`),
  and Summary/Totals sheet skipping (surfaced in `sheets_skipped`).
- **Dashboard pull** (`:10962-10981`): all non-deleted, non-rejected family
  roots (`parent_id IS NULL`) with an invoice #, computing `family_amount` =
  parent + live children so split invoices compare at full billed amount;
  indexed by `normalizeInvoiceNum` (`"#11" ≡ "INV-11" ≡ "11"`, zero/empty keys
  dropped, `:10982-10988`).
- **Matching** (`:10989-11084`): per bookkeeper row, candidates by normalized
  invoice #; best vendor via `vendorsMatch` tried against both the sheet's
  VENDOR and PAYEE NAME columns; **an invoice-# hit with a non-matching vendor
  is treated as a coincidental collision** — routed to missing_from_dashboard
  with an explanatory note and the dashboard row left unclaimed (`:11024-11040`).
  Issues collected: vendor variation (score < 1.0), amount mismatch on
  `family_amount` at ±$0.01, paid-status mismatch (sheet paid = has paid_date
  or paid_amount > 0 vs dashboard `payment_status='paid'`), paid-date mismatch
  only when both agree paid, with both sides run through a `ymd()` normalizer
  (Date-object vs string safety, `:10879-10890, 11055-11062`). One bucket per
  row, strongest signal wins: amount > paid-status > paid-date > vendor
  variation > clean (`:11063-11071`).
- **Reverse direction** (`:11085-11122`): unclaimed dashboard rows become
  missing_from_bookkeeper, noise-capped two ways — a **sheet-year filter**
  (years parsed from tab names; rows outside the span skipped; falls open when
  no year inferrable) and a **week-ending cap** (invoice_date after the
  snapshot date is excluded — the bookkeeper hasn't seen it yet).
- Returns `{ summary: { bookkeeper_rows, dashboard_rows, sheets_processed,
  sheets_skipped, sheet_years, week_ending, counts{8} }, diffs[] }`
  (`:11123-11145`).

**Workbook machinery** (shared): `DIFF_CATEGORIES` with per-category action
notes + priority (`:11156`), `diffRowDollarDelta` ($ at stake per row, defined
per category — delta for amount mismatches, full amount for missing rows,
`:11217-11234`), `diffTopVendors` top-8 by $ at stake (`:11236-11246`),
`DIFF_COLUMNS` (`:11265`), `writeDiffSheet` (branded title, action note,
BOOKKEEPER | DASHBOARD banner, red-flagged disputed cells via
`disputedCellKeys`, subtotal — `:11331+`), `buildDiffWorkbook` (`:11501-11693`):
Summary cover tab (counts, $ at stake, top vendors, **match-confidence legend**
with the same chip colors, `:11640-11676`) + one tab per non-empty category,
frozen panes + auto-filter + landscape print setup (`:11678-11692`).

**`POST /bk/ledger-diff-report`** (`:11695-11712`) — `{ diff }` (50mb JSON
limit) → `buildDiffWorkbook` → streamed xlsx.

**`POST /bk/ledger-diff-handoff`** (`:11715-11971`) — archiver ZIP, vendor-first
layout documented at `:11717-11731`: `00 - START HERE - Reconciliation
Report.xlsx`, `00 - README.txt` (generated summary + per-category counts +
"reply to johns@…" instructions, `:11908-11965`), `01 - Invoices/<Vendor>/
<invoice#> — <date>.<ext>` + `_VENDOR_SUMMARY.txt`, `02 - W9s and W8s/` (most
recent per vendor + `_MISSING.txt` chase list), `03 - Proof of Payment/`.
Only dashboard-side rows contribute files; bookkeeper-only rows are workbook-only
(`:11751-11756`).

**`POST /bk/ledger-diff-export`** (`:11974-12022`) — one-category styled xlsx
from the client's filtered rows, same `writeDiffSheet`.

**`POST /bk/bk-style-export`** (`:12234-12353`) — loads the re-uploaded BK xlsx
as a **styling template** (theme/fonts/fills/widths/frozen panes preserved),
pulls every family-root row in the workbook's year span (year via Postgres
`EXTRACT` on `COALESCE(invoice_date, created_at)` to dodge TZ quirks, sorted
payee-then-date to match the bookkeeper's clustering), then rewrites the data
rows on each `<year>` / `PAID <year>` tab and the SUM totals tab
(`:12269-12352`).

## 3. NEW status

**Confirmed absent.** Verified: NEW `client/src/App.jsx` has no
ledger-matching/reconcile route — the only matching surface is
`/bank-matching` (App.jsx:35,165); repo-wide grep for
`ledger-diff|LedgerMatching|bk-style|vendorsMatch` over `client/src` + `server`
returns only an unrelated `handoff` variable in
`client/src/components/WorkspaceDrawer.jsx`. There is no `lib/vendorMatch.js`
in NEW's server lib.

Non-overlap with NEW's `/bank-matching`: that reconciles **bank statement
lines ↔ ledger**; this page reconciles the **ledger ↔ an external bookkeeper's
spreadsheet** — a third dataset NEW never ingests. No NEW surface parses an
outside party's workbook, diffs it, or produces bookkeeper deliverables.

## 4. Port requirements

- **Schema**: none — the diff is computed in-memory per upload; nothing is
  persisted in OLD either.
- **Server**: new route file (or section) with the five endpoints, label-scoped
  (`WHERE label_id = req.labelId` on the dashboard pull — OLD is single-tenant
  and has none). Reuse NEW's `lib/normalizeInvoiceNum.js`, `lib/zip.js`
  (archiver), `exceljs` (already a dep — used by `/ledger/bulk-zip` and
  Reports), `lib/usd.js` for any USD display, and R2 `loadFileBuffer` for
  handoff file pulls (OLD reads local uploads). **Port
  `lib/vendorMatch.js` wholesale** — pure, fixture-testable
  (`finance-fixtures.cjs` style); NEW's `bankReconcile.js` fuzzy name scoring
  is calibrated for bank descriptors, not vendor-name tiers with reasons, so
  don't conflate them. Mind NEW's upload concurrency guard + 20k-row cap
  conventions from `/ledger/bulk-zip`.
- **Client**: one page (`pages/LedgerMatching.jsx` port) — Tailwind tokens
  instead of OLD's `getDarkColors(theme)` inline styles; NEW has no
  `utils/darkColors.js` in active use for new pages. Reuse `ui/` kit + toast
  patterns. Route behind `AdminRoute` (matches OLD's server-side isAdmin gate).
- **Watch-outs**: multer field-size limit is why BK Excel re-uploads the source
  file with only `sheet_years`/`week_ending` (`LedgerMatching.jsx:253-259`) —
  keep that shape; blob-vs-JSON error sniffing on all three download handlers;
  the handoff README hardcodes `johns@boomrecords.co` — must become per-label.

## 5. Defects

- [P2] Bookkeeper Reconcile absent — no way to diff the ledger against an external bookkeeper's xlsx (8-category diff, fuzzy vendor tiers, week-ending snapshot cap) or produce the bookkeeper deliverables (multi-sheet report, BK-style Excel, invoice/W9/proof handoff ZIP) — fix: new `/ledger-matching` page + 5 endpoints, port `lib/vendorMatch.js` (HIGH)

# missing--bk-invoices — OLD's Invoices View (browse/search all approved invoices)

## 1. What it is

The bookkeeping **Invoices index**: a search/browse surface over all APPROVED
invoices with weekly submitted/paid charts that double as click-to-filter
controls, table/cards views, per-row file chips with upload/replace, and a
collapsed rejected-invoices audit tail. Distinct from NEW's `/invoices`, which
is the **outbound invoice CREATOR** (branded invoices the label sends out).

- Route: `/bk/invoices` → `BkInvoices.jsx` (OLD `App.jsx:241`, import `:58`).
  Protected route; the list endpoint itself has no admin gate, but both chart
  endpoints are admin-gated (`bookkeeping.js:6147`, `:6224`).

## 2. OLD anatomy

Client — `client/src/pages/BkInvoices.jsx` (668 lines):

- **Two weekly charts** (`:328-351`, shared `SubmissionsPerWeekChart` component):
  "Invoices submitted per week" (`/bk/payments/submissions-per-week`, bucketed
  by created_at) and "Invoices paid per week" (`/bk/payments/paid-per-week`, by
  payment_date), both Mon–Sun LA-time, USD-equivalent amounts, independent
  collapse state per localStorage key.
- **Chart range picker** (`:118-163`, `:268-326`): preset chips 4w/12w/26w/52w +
  Custom from/to; persisted to localStorage (`bk_invoices_chart_range_v1`);
  presets anchor "today" in LA time (`:149-162`, N-1 weeks back so 12w renders
  12 bars, not 13).
- **Click-a-bar filters the list** (`:239-251`): sets from/to to that Mon–Sun
  week AND sets `dateBasis` to the chart's column (`created_at` for submissions,
  `payment_date` for paid); same-bar second click toggles the filter off;
  selected-week highlight only when the basis matches (`:253-258`).
- **Toolbar** (`:354-396`): debounced search (300ms, `:199-203`) over
  payee/description/invoice#/artist; from/to date pickers (reset basis to
  invoice_date); result count; **table/cards view toggle**; Clear button.
- **Filter summary banner** (`:407-487`): verb keyed to basis ("Invoices paid /
  submitted / dated"), "the week of Jun 22" phrasing for exact Mon–Sun spans,
  match count, "· selected from chart", Clear filter.
- **Table view** (`:520-556`): Date · Payee · Invoice # · Amount (currency) ·
  Category · Status badge · Files. **Cards view** (`:495-518`): payee, status,
  big amount, date/#/category, file links.
- **File chips** (`FileLink`, `:40-86`): view via FilePreview overlay, replace
  (↻), or upload-when-missing (`POST /bk/entries/:id/file/:type`); W9 follows
  the canonical `w9_entry_id || id` cross-entry rule (`:513`, `:549`).
- **Rejected invoices subsection** (`:558-663`): collapsed-by-default audit
  tail (`/bk/invoices?status=rejected`, refetched on expand); columns add
  Artist, Rejected (date + by-name), Reason ("no reason recorded" fallback).
- Race guard on refetches (fetch generation counter, `:165-197`) and
  first-load-only full spinner so typing doesn't unmount the search box.

Server — `GET /api/bk/invoices` (`server/routes/bookkeeping.js:8178-8265`):

- Params: `search` (ILIKE payee/invoice_number/description/artist), `from`/`to`,
  `basis` ∈ invoice_date (default) | created_at | payment_date — the range
  filters on the same column a clicked chart bucketed by (`:8180-8187`);
  `status` ∈ approved (default) | rejected | pending (`:8188-8195`).
- Always excludes deleted/voided and **child splits** (`parent_id IS NULL`);
  amount = family total (parent + live children, `:8232`); has_invoice/has_w9/
  has_proof booleans + filenames; `split_count`; alias-aware `w9_entry_id`
  subquery (`:8237-8249`); `status=rejected` adds a LATERAL join to
  `bk_audit_log` for rejected_at/by/reason (`:8216-8227`). `LIMIT 200`, newest
  invoice_date first.
- Charts: `/bk/payments/submissions-per-week` (`:6145-6210`) and
  `/bk/payments/paid-per-week` (`:6220-6280`) — generate_series week spine,
  vendor vs admin split (by `vendor_submitted`), counts + USD sums
  (`amount * COALESCE(fx_rate_to_usd,1)`), from/to via `resolveChartRange`,
  ±7-day slop on the window, admin-gated.

## 3. NEW status

**Absent as a surface; charts data partially exists.** Verified: NEW
`client/src/App.jsx` grep `invoice` → `/invoices` + `/invoices/new` are
`CreateInvoice` (outbound creator, App.jsx:185-186) and `/add-invoice` /
`/ledger/new-invoice` are entry forms; no invoices index/search route. NEW has
no `/bk/invoices`-shaped endpoint (`routes/invoices.js` is the outbound-invoice
table; grep `submissions-per-week` in NEW → nothing by that name).

Partial overlap:
- NEW `GET /api/ledger/payment-analytics` (`server/routes/ledger.js:1502-1541`)
  computes submissions-per-week + paid-per-week (12 fixed weeks, label-tz
  anchored) — consumed by `Payments.jsx:60` as display-only charts. No range
  picker, no vendor/admin split, no click-to-filter.
- NEW `/ledger` search/filters can approximate ad-hoc lookup, but the ledger is
  all statuses/sources mixed, has no family-total invoice framing, no
  chart-driven week filtering, and no rejected audit tail (that's the archive
  gap, see missing--approvals-archive).

## 4. Port requirements

- **No schema** — everything reads `expenses` (+ `bk_audit_log` for rejection
  attribution, which NEW stores as `rejected_reason`/`approved_by` on the row —
  simpler; the LATERAL join is unnecessary in NEW).
- Endpoint: label-scoped `GET /api/ledger/invoices` with search/from/to/basis/
  status params and family-total amount; or extend the existing ledger list
  with a `view=invoices` contract. Extend `payment-analytics` with from/to
  range + vendor/admin split + week_start/week_end per bucket (the click-to-
  filter contract needs week bounds in the payload).
- Client: new page; reuse NEW's Recharts patterns, Skeleton, `formatDate`,
  card/table toggle (Payments/CreateInvoice already have a Table/Cards toggle
  pattern), `useCategories` for the category column, signed-URL file access
  (NOT OLD's `?token=` URLs — removed in NEW), and the Ledger drawer via
  `?focus=` links instead of OLD's inline upload-only cells if preferred.

## 5. Defects

- [P1] Invoices index/search surface missing — no way to browse/search approved invoices as invoices (family totals, files, week-of-intake/outflow charts with click-to-filter); NEW's `/invoices` is the unrelated outbound creator — fix: new page + list endpoint; extend payment-analytics with range/split/week-bounds (HIGH)

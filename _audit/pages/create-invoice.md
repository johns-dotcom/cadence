# Create Invoice (outbound A/R)

OLD: `boom-dashboard/client/src/pages/CreateInvoice.jsx` (918) + `server/routes/invoices.js` (188) + `server/lib/payment-terms.js` (135)
NEW: `cadence/client/src/pages/CreateInvoice.jsx` (343) + `server/routes/invoices.js` (98)

Token-level diffs (font, accent, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported per element.

## 1. Layout & structure

Both pages: two-column create-form + live-preview grid, then a "Saved Invoices (n)" section with a Table/Cards toggle.

- OLD: no page header; grid is `grid-cols-1 xl:grid-cols-2 gap-8` (OLD :558); form card is `bg-card rounded-lg border shadow-sm p-6` (:560); saved section renders **only when invoices exist** (:723).
- NEW: `PageHeader` "Create invoice / Issue an invoice from this workspace" (NEW :193); grid is `lg:grid-cols-2 gap-6` (:195) — splits earlier (1024px vs 1280px); `.card p-6` / preview `.card p-7` (RC-6 radius); saved section always renders, with an empty-state card (:292).
- OLD form field order: Bill To → Address → **Payment Terms row (select + optional date input + live server-computed due string)** → Line Items (+currency) → running Total → submit. NEW: Bill To → Address → Line Items (+currency) → **Purchase order + free-text "Due by"** 2-col row → submit. The Payment Terms block (OLD :611-641) has no NEW counterpart; NEW's PO field has no OLD form counterpart (OLD always saves PO 'N/A' from this page, :546).
- OLD card view: each card is a header strip + a full **compact `InvoicePreview` document** (:877-879). NEW card view: summary tiles (number/status/bill-to/amount/date + action row), no document render (:320-338).
- OLD has a Preview modal overlay (:888-915). NEW has none.
- OLD loading = `Skeleton.Block` ×2 (:529-536). NEW = literal "Loading…" text (:290).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Form heading | `text-lg font-semibold` "New Invoice" (:562) | `text-base font-bold` "New invoice" (:199) | both files |
| Field labels | sentence-case `text-sm font-medium text-gray-700` (:583) | `.label` uppercase 12px tracking-wide (RC) (:203) | |
| Inputs | raw `border-gray-300 py-2` + boom focus ring (:589) | `.input` py-2.5 brand ring (RC-5) (:204) | |
| Submit button | full-width `bg-gray-900 text-white` w/ `Loader` spinner while saving (:705-712) | `.btn-primary` (brand color) w/ static Plus icon + "Saving…" text (:233) | |
| View toggle | segmented pill `bg-gray-100 p-0.5`, active = white card + shadow (:727-746) | bordered group, active = `bg-gray-900 text-white` (:283-286) | |
| Status badge | rectangular `rounded text-xs font-bold`; Paid `green-100/800`, Unpaid `red-100/800`, **Partial `yellow-100/800`** (:161-165) | pill `rounded-full font-medium`; Paid `emerald-100/700` + Check icon, Unpaid `red-100/600`; no Partial (:307) | |
| Preview title | `text-[44px] font-black` INVOICE (:115 area, preview :70) | `text-4xl font-extrabold` (:243) | |
| Preview logo | hardcoded `BoomLogo` SVG `#E52017` (:97-103) | `label.logo_url` img or label name in `text-brand-600` (:240-242) | [INT] branding |
| Payable block | sectioned with `mt-4 pt-4 border-t` dividers, same text size as body (:140-159) | `space-y-2`, `text-[12px]`, bold inline labels, no dividers (:24-49) | |
| "Bill To" label | "Bill To:" with colon (:124) | "Bill To" no colon (:249) | |
| Table head | `bg-gray-50` band, `text-xs uppercase` (:754) | no band, `text-[10px] uppercase` (:296) | |
| Table Invoice # | `font-semibold text-gray-900` (:768) | `font-mono text-gray-600` (:302) | |
| Table Bill To | full multi-line value (:771) | first line only (:303) | |
| Action icons | wrapped `p-1.5 hover:bg-gray-100 rounded-md`, size 14 (:797-824) | bare `px-1.5` color-only hover, sizes 14/15 (RC-4) (:309-312) | |
| Loading state | Skeleton blocks (:532-533) | "Loading…" text (:290) | |

## 3. Copy & content differences

- OLD subtitle under form heading: "Invoice #0007 will be created" / "Editing invoice for {payee}" (:575-579). NEW: same create line; edit line is "Editing #0007" (:200) — loses the payee name.
- OLD cancel affordance: text link "Cancel edit" in the card header (:571). NEW: `.btn-secondary` "Cancel" next to submit (:234).
- OLD due line copy in form: "Due June 10, 2026 (Net 30)" / "Due upon receipt" / inline amber error (:637-639). NEW: none (free-text field).
- NEW-only copy: PageHeader title/subtitle (:193); empty state "No invoices yet — create your first one above." (:292); settings hint "Set your company & bank details in Settings → Invoice details." (:20); toast strings (:107-122); delete confirm "Delete this invoice?" (:131). OLD has no toasts (errors silently swallowed) and no delete confirm.
- PDF filename: OLD `Boom.Records-Invoice#0007-Payee.pdf` (:524-525). NEW print window title `Invoice #0007` (:159) — browser decides the filename.

## 4. Feature & interaction differences

### Present in OLD, missing in NEW
- **Payment-terms engine (the date engine).** OLD: `lib/payment-terms.js` single authority — TERMS Due-on-receipt/Net 15/30/45/60/90/Custom, `businessDay()` pinned to America/Los_Angeles, `resolveDue()` validating custom < invoice-date, `printed()` "June 10, 2026 (Net 30)". Client computes **no dates**: `GET /invoices/terms` fills the dropdown (OLD client :180-184), `GET /invoices/due-date` (with `invoice_id` when editing so re-terming anchors on the issue date) drives the live preview (:198-207); POST recomputes server-side and rejects caller-supplied `due_by` (OLD server :107-120); PUT derives `due_by` and blocks it from the allow-list (:137-161). NEW: no lib, no /terms, no /due-date; `due_by` is a **free-text input** stored verbatim (NEW client :229, server :56, PUT allow-list :71 includes `due_by`) — exactly the "printed deadline and terms can disagree, and neither is checked" state OLD's refactor removed. `payment_terms`/`due_date` columns don't exist in NEW's schema (cadence server/index.js:850-867).
- **Real PDF download (jsPDF).** OLD renders selectable-text A4 via jsPDF and auto-saves with a deterministic filename (:366-527). NEW opens a popup + `window.print()` (:136-183) — popup-blocker dependent (it even toasts about it, :181), no auto-download, raster-or-user-dependent output. jsPDF is already a cadence dependency (NDA builder), so this is not a dependency constraint.
- **Preview modal.** OLD Eye button opens an overlay with the full InvoicePreview + Download/Close (:805-810, :888-915). NEW's Eye button exists but just calls `editInvoice(inv)` — identical to the Pencil next to it (:310).
- **Partial payment status.** OLD cycles Unpaid → Paid → Partial (:166, :346-353). NEW toggles Paid/Unpaid only (:126-129).
- **Hotkeys**: ⌘↵ submit, ⌘⇧L add line item, ⌘P download preview/latest (:213-220), incl. the in-flight guard `if (creating) return` because requestSubmit bypasses the disabled button (:304-306). NEW has none.
- **Card view = full document.** OLD renders `InvoicePreview compact` per saved invoice (:877-879); NEW cards are metadata tiles.
- **$0 line items.** OLD filters on `li.amount !== ''` so comp/no-charge lines survive (:307-309) and an all-$0 invoice can be saved. NEW requires `total > 0` (:108) — a comp invoice is rejected.
- **Optimistic status update**: OLD patches state in place on cycle (:351); NEW refetches everything (`load()`, :128).
- Running **Total** line inside the form (:699-703) — NEW shows total only in the preview pane.
- Live-preview date comes from the server (`due.invoice_date`, :551) — NEW prints `longDate(Date.now())` client-side (:272).

### Present in NEW, missing in OLD
- Purchase-order form field (:228) — OLD stores PO but this page always sends 'N/A'.
- "Download / print PDF" button under the live preview (:274) — OLD can only download saved invoices (⌘P / row buttons).
- Delete confirmation dialog (:131); toasts for save/delete/status failures (OLD swallows errors silently — NEW is the better behavior, not a defect).
- Empty-state card when no invoices (:292).
- `logActivity('Created invoice', …)` (NEW server :60) — OLD logs nothing.
- POST validation 400 for missing bill_to/amount (NEW server :40-42).
- `requireApprover` route gate + label scoping + per-label `UNIQUE(label_id, invoice_number)` with 409 on collision (NEW server :8, :63) — [INT] multi-tenancy/permissions.

### Behaves differently
- **Numbering**: OLD global MAX+1 (OLD server :84-93); NEW per-label MAX+1 with unique-constraint retry (NEW server :24-49). [INT].
- **Editing scroll/entry**: both scroll to top; OLD keeps a "Cancel edit" header link, NEW a Cancel button.
- **Currency rendering**: OLD `Intl.NumberFormat` currency style with unknown-code fallback (OLD :32-44) — CAD→CA$, JPY→¥1,000 (0 decimals). NEW hand-rolled symbol map (:10-12) — CAD/AUD/MXN indistinguishable from USD "$", JPY forced to 2 decimals.
- **Description column**: OLD full description; NEW `inv.description || '—'`; OLD table shows full bill_to, NEW first line.

## 5. Data layer differences

- Table: `boom_invoices` → `invoices` + `label_id` + `UNIQUE(label_id, invoice_number)` — [INT].
- **Missing columns**: `payment_terms`, `due_date` (OLD uses both; NEW schema cadence server/index.js:850-867 has neither).
- **`created_at TIMESTAMPTZ` → `TIMESTAMP`** (OLD index.js:2956 with an explicit comment block :2960-2962 explaining exactly why TIMESTAMP-without-zone was a bug it migrated away from; NEW index.js:863). NEW also lets the column default to NOW() instead of pinning the instant the date was read from (OLD server :117 `raisedAt` passed as $13, :124-126).
- **`invoice_date` derived field**: OLD attaches `invoice_date = businessDay(created_at)` to every row it returns (`withInvoiceDate`, OLD server :39, :77, :128, :172) so client renders the company-timezone day. NEW returns raw rows; client renders `new Date(created_at).toLocaleDateString(...)` (NEW :15, :177, :306, :330) — the reader-timezone bug OLD documents at length (payment-terms.js:52-64: "an invoice raised after 5pm printed the previous day").
- OLD endpoints NEW lacks: `GET /invoices/terms` (OLD server :43-45), `GET /invoices/due-date` (:49-69).
- PUT allow-lists: OLD excludes `due_by` (derived, :140); NEW includes it (:71). NEW stringifies `line_items` server-side on PUT (:75); OLD expects the client to stringify on PUT (OLD client :321) — internally consistent on each side.
- Funds-payable data: OLD hardcoded `BOOM_INFO` const (client :9-26) → NEW `labels.invoice_settings` via `GET /label` (NEW :71-75) — **[INT] mechanism swap**. Field-by-field parity check: company/address/contact/phone/email/EIN/bank name/bank address/account name/type/SWIFT/routing/account are all present (`PayableTo` :24-49, print HTML :141-157). OLD prints **two routing numbers** (WIRE + ACH as separate stacked lines, :111-112 / PDF :466-468); NEW has a single `routing` field — the second routing line is a missing FIELD, a defect per the audit rule.

## 6. Tables & forms

- Saved-invoices table: identical column set (Invoice # / Bill To / Description / Amount / Date / Status / Actions) in both; NEW adds none, drops none. Row differences per §2.
- Form fields: OLD {bill_to*, bill_to_address, payment_terms, due_date(custom), currency, lineItems[desc, amount≥0 step .01]} — bill_to `required` attr, submit blocked without valid items. NEW {bill_to*, bill_to_address, currency, lines[], purchase_order, due_by free-text} — validated by toast (:107-108), no HTML `required`, no `min="0"` on amount (negative amounts accepted; OLD had `min="0"` :674).
- OLD line-item delete button renders only when >1 rows (:680); NEW always renders but no-ops at 1 row (:221) — dead-looking control.

## 7. Defects found

| # | P | Defect | Fix | Conf |
|---|---|---|---|---|
| 1 | **P1** | Entire payment-terms/due-date engine missing: no terms vocabulary (Net 15/30/45/60/90/Custom), no server-computed due date, `due_by` is free text stored verbatim and writable via PUT; printed deadline and terms can silently disagree | Port `lib/payment-terms.js` (multi-tenant: keep BUSINESS_TZ per-label in `labels.settings`), add `/terms` + `/due-date` routes, derive `due_by` on POST/PUT, add `payment_terms`/`due_date` columns — cadence server/routes/invoices.js:37-85, server/index.js:850 | HIGH |
| 2 | **P1** | Client-side date math / reader-timezone rendering: `longDate(created_at)` + `toLocaleDateString` (cadence CreateInvoice.jsx:15,177,272,306,330) reproduces the documented after-5pm-prints-yesterday bug; live preview prints `Date.now()` | Attach `invoice_date = businessDay(created_at)` server-side (OLD invoices.js:39) and format from string parts client-side (OLD client :70-94) | HIGH |
| 3 | **P2** | `created_at` is `TIMESTAMP` (no zone) defaulting to NOW() — the exact type OLD migrated off with a warning comment (boom index.js:2960); instant not pinned at insert | `TIMESTAMPTZ` + pass `raisedAt` explicitly — cadence server/index.js:863, routes/invoices.js:51-59 | HIGH |
| 4 | **P2** | PDF is popup + `window.print()` instead of jsPDF selectable-text auto-download with deterministic filename; blocked popups kill it | Port OLD `handleDownload` (jsPDF already a dep) — cadence CreateInvoice.jsx:136-183 | HIGH |
| 5 | **P2** | Eye "Preview" button just opens edit mode — duplicate of Pencil; preview modal missing | Port OLD preview overlay (:888-915) or use NEW `ui/Modal` — cadence CreateInvoice.jsx:310 | HIGH |
| 6 | **P2** | `Partial` payment status missing (OLD 3-state cycle w/ yellow badge) | Add Partial to toggle cycle + badge map — cadence CreateInvoice.jsx:126-129,:307 | HIGH |
| 7 | **P2** | Second routing number (ACH vs WIRE) not representable — `invoice_settings` has one `routing` field; OLD prints both stacked | Add `routing_ach` (or make routing multi-line) in Settings + PayableTo + print HTML — cadence CreateInvoice.jsx:45,155; Settings.jsx invoice block | HIGH |
| 8 | **P2** | Hotkeys ⌘↵ / ⌘⇧L / ⌘P missing (repo has `useHotkeys`) | Port OLD :213-220 incl. in-flight submit guard — cadence CreateInvoice.jsx:105 | HIGH |
| 9 | **P2** | Card view lost the full compact invoice document render | Render shared preview component per card — cadence CreateInvoice.jsx:320-338 | MED |
| 10 | **P3** | $0 (comp) invoices rejected (`total <= 0` gate); OLD deliberately preserved `amount !== ''` zero lines | Validate on line presence, not total — cadence CreateInvoice.jsx:84,108 | HIGH |
| 11 | **P3** | Currency formatting: symbol map renders CAD/AUD/MXN as bare "$", JPY with 2 decimals; OLD used Intl with fallback | Use `Intl.NumberFormat` (OLD :32-44) — cadence CreateInvoice.jsx:10-12 | HIGH |
| 12 | **P3** | Loading state is text, not Skeleton (repo has `components/Skeleton`) | Use Skeleton.Block ×2 — cadence CreateInvoice.jsx:290 | HIGH |
| 13 | **P3** | Amount input lacks `min="0"`; negative line items accepted | Add min=0 — cadence CreateInvoice.jsx:220 | HIGH |
| 14 | **P3** | Edit subtitle drops payee name ("Editing #0007" vs "Editing invoice for X") | cadence CreateInvoice.jsx:200 | HIGH |
| 15 | **P3** | Line-item trash button renders as enabled but no-ops when only one row (OLD hides it) | Hide/disable at 1 row — cadence CreateInvoice.jsx:221 | HIGH |

**Intentional divergences**: per-label numbering + UNIQUE + 409 (multi-tenancy); `requireApprover` gate; `BOOM_INFO` → `labels.invoice_settings` mechanism (fields audited above — only the ACH routing line is missing); logo/brand color from label branding (RC-2); logActivity/toasts/delete-confirm/empty-state are NEW-only improvements, not defects.

# missing--bulk-upload — AI bulk invoice + proof upload (OLD `/bk/bulk-upload`)

## 1. What it is
Batch ingest surface: drop N invoice files + M proof-of-payment files, AI-parse them all,
auto-match proofs to invoices, review/edit in a grid, then create N approved ledger entries
in one call — files uploaded to R2 per entry. **Distinct from any CSV/data import**: the
input is the invoice PDFs/images themselves, not rows.
- Route: `/bk/bulk-upload` → `BkBulkUpload` inside `TabbedShell family="import"` (OLD `client/src/App.jsx:243`, import at :60).
- Permissions: Protected route client-side; server batch endpoint requires admin (`isAdmin(req.user)`, OLD `server/routes/bookkeeping.js:1315`).

## 2. OLD anatomy (`client/src/pages/BkBulkUpload.jsx`, 686 lines)
Five-phase wizard, `phase: upload | parsing | review | submitting | done` (:55).

**Phase upload** (:323-413)
- Two side-by-side drop zones: **Invoices** (required) and **Proofs of Payment** (optional),
  drag-drop or click-to-pick, `multiple`, accept `.pdf/.jpg/.jpeg/.png` (filename-regex filter :66-68).
- Per-file list rows with remove buttons (:347-359, :383-395). Footer count + **Parse & Match**
  button disabled until ≥1 invoice (:404-410).

**Phase parsing** (:90-198, spinner UI :416-431)
- Sequential loop with live progress `current/total` + filename label (:109, :137).
- Each invoice: `fileToBase64` (:19-26) then `POST /bk/parse` multipart (:121-124). **File-read and
  AI-parse are separate try/catches** so a rate-limited/failed parse keeps the b64 — the file still
  uploads, user fills fields by hand (comment :97-104). Each proof: same pattern via `POST /bk/parse-proof` (:146-150).
- **Auto-match proofs→invoices** (:159-195): first proof where `payeesMatch` (normalized
  equality-or-substring, :29-34) AND `amountsMatch` (|Δ| < 0.02, :36-39). Matched → entry becomes
  `payment_status:'Paid'` + inherits proof's `payment_date`/`reference_number` (:190-192).

**Phase review** (:434-582)
- Summary line: n ready · n matched with proofs · n unmatched proofs (:436-444).
- Editable table, one row per invoice, columns (:449-464): include-checkbox, Payee (text), Amount
  (number), Date (date), Invoice # (text), **One payment** (letter select A–E, :496-505 — invoices
  sharing a letter are declared as settled by ONE bank transfer; see server grouping below), Category
  (select fed by live `useCategories()` context :48), Artist (text), Song (text), Proof (matched chip
  w/ unmatch ✕, or "Match proof..." select over remaining unmatched proofs :518-543 — manual match
  via `matchProof` :206-221 / `unmatchProof` :223-228), Status badge Paid/Unpaid (:544-552).
- Excluded rows tinted red; footer: selected count + summed USD total + "Add N to Ledger" (:559-580); Back resets parse state (:560-565).

**Phase submitting/done** (:585-683)
- Single `POST /bk/entries/batch` with all included entries incl. `invoice_data`/`proof_data` base64,
  filenames, `settlement_label` (:239-260).
- Done screen reports: created count; **per-entry failures** (payee/filename/error, "rolled back — no
  ledger entries were created for them", :611-638); **settlement-group results both ways** — groups
  that took ("a bank line totalling them exactly will settle all of them") and groups REFUSED with
  the reason (:643-667). Buttons: Upload More / View Ledger.

**Server — `POST /api/bk/entries/batch`** (`server/routes/bookkeeping.js:1305-1493`)
- Admin-gated (:1315). Per-entry isolation: each invoice its own try/catch (:1355-1448); on any
  failure after INSERT (R2 upload, key UPDATE) the row is **DELETEd** so no ledger row exists whose
  invoice can't be viewed (:1441-1444); failures accumulated and returned (:1447, :1484-1485).
- Per entry: artist normalization via `applyArtistNormalization` (:1345); duplicate-invoice guard
  same as single POST, skippable with `force_duplicate` (:1360-1365); INSERT as
  `status='approved'` + approved_by/at = uploader (:1368-1389); paid entries default
  `payment_date = todayLA()` (:1385); due date = NOW + Net 30 unless `scheduled_payment_date` (:1352);
  base64 → `sniffMime` → R2 keys `vendors/{id}/invoice|proof/{ts}_{name}` (:1394-1416); loud log if a
  declared file produced no key (:1421-1423); `autoLinkRelease(newId, artist, song)` (:1426);
  `logBkAction 'expense_added'` (:1428).
- **Settlement groups** (:1451-1478): labels resolved AFTER inserts (ids don't exist client-side);
  <2 members → reported error; validated through the shared `validateGroup` from lib/settlement-groups
  (same vendor, 2+, none settled) then `UPDATE expenses SET settlement_group = <newGroupKey()>`
  (:1468-1472) + audit per member (:1473-1476). Refusals returned as `group_errors` — never silent (:1461-1462).
- Response: `{data, count, failed, failedCount, groups, group_errors}` (:1480-1488).

**Server — parse endpoints**
- `POST /bk/parse` (:4265-…): builds prompt with the live artist roster (top 250 by name length,
  :4278-4282 — so AI prefers roster names over social handles) and the label's live category
  vocabulary most-used-first (`categoryVocabulary`, :4287, :4303-4308); returns
  invoice_date/payee/amount/invoice_number/category/payment_method/artist/song/description/currency (:4289-4301).
- `POST /bk/parse-proof` (:4767-4797): AI extracts payment_date/payment_method/amount/
  reference_number/payee from a proof; parse failure degrades to `{}` (:4790-4792).

## 3. NEW status — **confirmed absent** (naming overlap only)
- No page/route: `client/src/pages/` has no bulk-upload page; `client/src/App.jsx` has no bulk route
  (grep `BulkUpload|bulk` → 0 hits). `grep -rn settlement_group` across NEW server+client → 0 hits
  (the "one payment" concept doesn't exist in cadence at all).
- What CLAUDE.md calls "Bulk Upload" in NEW is `POST /api/import/master-sheet`
  (`server/routes/import.js:17`) — pre-parsed CSV/XLSX **data rows** (artists/releases/expenses/income), no files, no AI.
- `POST /api/ledger/bulk-zip` (`server/routes/ledger.js:1972-1974`) is the **reverse direction**:
  upload a spreadsheet of vendor+invoice# and get back a ZIP of already-stored invoice files + W9s.
  Zero overlap with ingest beyond the word "bulk".
- NEW *does* have the single-file building block: `POST /api/ledger/parse-invoice`
  (`server/routes/ledger.js:1231-1237` → `claude.parseInvoice`, `server/lib/claude.js:198`), used by
  `AddLedgerEntry.jsx:70` — one invoice at a time, no proof parsing, no batching, no auto-match.

## 4. Port requirements
- **Schema**: `expenses.settlement_group` column (text key) — NEW has nothing equivalent; NEW's
  `bank_txn_invoice_links` (multi-invoice attach in bank-matching) covers the *statement side* of
  many-invoices-one-payment but there is no upload-time declaration. A ported flow could either add
  the column + a `lib/settlement-groups` port, or map the "one payment" letters onto planned
  `bank_txn_invoice_links` groupings.
- **Endpoints**: `POST /api/ledger/entries/batch` (label-scoped, requireAdmin, per-entry rollback,
  dup-guard reusing `/ledger/check-dup` logic at `ledger.js:1330-1333`, R2 upload via `lib/r2.js`);
  `POST /api/ledger/parse-proof` (new — `claude.js` needs a `parseProof` sibling of `parseInvoice`);
  extend `parse-invoice` prompt with roster + live category vocabulary (NEW has `categories` table +
  usage-first ordering in `/api/categories` to feed it).
- **Client**: new page (nav under Bookkeeping/Import); reuse `useCategories` hook +
  `CategoryOptions`, `ui/` kit, `useIsMobile`. Review grid is a plain editable table — no new primitives needed.
- Mind NEW's `MAX_CONCURRENT_UPLOADS` guard (index.js) — batch sends base64 in ONE JSON body, which
  bypasses multer but can hit body-size limits; check express `json({limit})` before porting as-is.

## 5. Defects
- [P1] OLD's AI batch invoice+proof ingest flow (`/bk/bulk-upload`: parse-all, proof auto-match,
  review grid, one-payment grouping, per-entry-rollback batch endpoint) has no NEW counterpart —
  NEW's "bulk upload" is the master-sheet data import and `bulk-zip` is file *retrieval* — fix: new
  page + `/ledger/entries/batch` + `/ledger/parse-proof` routes (HIGH)

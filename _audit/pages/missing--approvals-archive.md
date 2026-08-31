# missing--approvals-archive — OLD's Approvals Archive (rejected + deleted browser)

## 1. What it is

Admin-only browser for the two "gone" buckets — **rejected** invoices and
**soft-deleted** invoices — with restore actions for both. Nothing is ever
hard-deleted through the UI; this page is where operators recover a mis-deleted
invoice, re-read a rejection reason, or audit who rejected/deleted what
(header comment, OLD `client/src/pages/BkArchive.jsx:1-10`).

- Route: `/bk/approvals/archive` → `BkArchive.jsx` (OLD `App.jsx:223`, import `:43`).
- Reached via "View archive" on the Approvals page header (`BkArchive.jsx:1-3`).
- **Admin/Superadmin only** — client gate renders a ShieldAlert "Admins only"
  card for others (`BkArchive.jsx:222-224`, `:301-320`), paired with the server
  gate on `GET /bk/entries?deleted=true` (bookkeeping.js:708-712).

## 2. OLD anatomy

Client — `client/src/pages/BkArchive.jsx` (368 lines):

- **Two collapsible sections** (`ArchiveSection`, `:135-215`), each a table with
  count badge (shows `filtered/total` while searching):
  - **Rejected invoices** (`:340-351`) — fed by `GET /bk/invoices?status=rejected`
    (`:230-238`).
  - **Deleted invoices** (`:352-363`) — fed by `GET /bk/entries?status=all&deleted=true`
    (`:239-249`; `status=all` so a row that was Pending when deleted still shows).
- **Shared search box** (`:322-330`) filtering BOTH sections client-side over
  payee/artist/song/invoice_number/description/reject_reason/rejected_by/deleted_by
  (`:137-144`).
- **Columns** (`:172-181`): Date · Payee (+#invoice_number) · Artist · Song ·
  Amount (currency-aware `fmtMoney`) · Rejection|Deletion attribution
  (`rejected_by_name · rejected_at — reject_reason` or `deleted_by · deleted_at`,
  `:66-86`) · Files · restore action.
- **File chips** (`:29-40`, `:88-107`): Invoice / W9 / Proof / Receipt open in the
  shared `FilePreview` overlay; W9 follows the cross-entry canonical rule
  `w9_entry_id || id`.
- **Two distinct restore semantics** (deliberate, `:109-114`):
  - Deleted → **"Restore"** → `POST /bk/entries/:id/restore` → back to the ledger
    as it was (`:251-263`).
  - Rejected → **"Back to Pending"** → `POST /bk/entries/:id/unreject` → back to
    Approvals as *pending* ("a rejection was a decision; undoing it should
    restore the question, not answer it the other way"); success banner reports
    `children_restored` split rows + "Go to Approvals →" link (`:265-284`, `:331-339`).

Server — `server/routes/bookkeeping.js`:

- `GET /entries` `deleted=true` branch: admin-gated 403 (`:708-712`), single
  `(e.deleted = $1)` predicate so the same endpoint feeds ledger and archive (`:713-714`).
- `POST /entries/:id/restore` (`:2149-2168`): un-deletes the row + child splits,
  then `relinkBankRowsForFamily()` re-matches remembered bank statement rows and
  restores `bank_txn_invoice_links`; logs `expense_restored` to `bk_audit_log`
  with a "N bank rows re-matched, M links restored" detail; returns those counts.
- `POST /entries/:id/unreject` (`:3726-3752`): admin + `userCanActOnEntry`
  visibility check; 400 unless status is exactly `rejected`; sets parent AND
  rejected children back to `pending`; logs `expense_unrejected`
  (field=status, old=rejected, new=pending); returns `children_restored`.
- Rejection attribution rides on `GET /bk/invoices?status=rejected` via a LATERAL
  join to `bk_audit_log` (`action='expense_rejected'`, latest by ts) producing
  `rejected_at / rejected_by_name / reject_reason` (`:8216-8227`).

## 3. NEW status

**Server half exists, UI absent** (matches the CLAUDE.md correction). Verified:
no archive route in NEW `client/src/App.jsx` (grep `archive`), and grepping NEW
`client/src` for `/ledger/archive` finds zero callers. NEW server:

- `GET /api/ledger/archive` (`server/routes/ledger.js:1064-1082`, requireAdmin):
  one combined list of `deleted = true OR status = 'rejected'` rows with
  `rejected_reason/deleted_by/deleted_at` and has_invoice/has_w9/has_receipt
  booleans. No caller anywhere in the client.
- `POST /api/ledger/entries/:id/restore` (`ledger.js:1043-1062`): family-wide
  un-delete that ALSO flips `rejected → pending` in the same UPDATE — i.e. NEW
  merged OLD's restore + unreject into one endpoint. Notably it is **not
  admin-gated** (no requireAdmin, unlike OLD's unreject) and restores by family
  root regardless of which id was passed.

So a rejected-but-not-deleted row in NEW can only be revived by whoever finds it
(status filter on Ledger), with no reason-audit surface.

## 4. Port requirements

- **No new schema** — `deleted/deleted_by/deleted_at/rejected_reason` already on
  NEW `expenses`; NEW `bk_audit_log` exists for attribution.
- Endpoints: `GET /ledger/archive` already returns everything a page needs
  except **who rejected** (`approved_by` doubles as decider) and **split-children
  counts** — extend the SELECT if parity on attribution copy is wanted.
- Client: one new page (nav from Approvals header), two collapsible sections +
  shared search. Reusable NEW primitives: `ui/Modal`/`ConfirmDialog` for restore
  confirmation, Skeleton loaders, `formatDate` from `utils/dates.js`, the
  Ledger's file-chip/preview pattern (files now via signed URLs — do NOT copy
  OLD's `?token=` query-param URLs; that auth mode was removed in NEW).
- Decide whether to split NEW's combined restore back into restore vs unreject
  (OLD's two-semantic model) or keep one endpoint and label the button by row
  state; either way the rejected path should land on `pending`, which NEW's
  UPDATE already does.

## 5. Defects

- [P1] Archive UI missing — rejected/deleted invoices are unrecoverable and unauditable from the client even though `GET /ledger/archive` exists server-side — fix: new `/ledger/archive` page + restore/unreject actions (HIGH)
- [P2] NEW `POST /ledger/entries/:id/restore` (ledger.js:1043) is not admin-gated, but it revives deleted/rejected financial history — OLD gates deleted listing + unreject to Admin/Superadmin (bookkeeping.js:710, :3728) — fix: add requireAdmin (MED)

# Add Reimbursement — parity audit

## 1. Files compared

| Side | Client | Server |
|---|---|---|
| OLD (truth) | `boom-dashboard/client/src/pages/BkAddReimbursement.jsx` (666 lines) + `hooks/useUnsavedWarning`, contexts (Categories/BoomReps/Auth) | `boom-dashboard/server/routes/bookkeeping.js`: same POST `/entries` (:943, called with `is_reimbursement: true`), `/parse` (:4265), `/parse-proof` (:4769), `/check-dup` (:4625), `/entries/:id/receipts` (:4695), `/entries/:id/file/:type` (:2823) |
| NEW | `cadence/client/src/pages/AddLedgerEntry.jsx` (309 lines, `mode="reimbursement"`, same component as Add Invoice with `isReimb` branches) | `cadence/server/routes/ledger.js` `createEntry` (:164-246) with `is_reimbursement` flag |

Routes: OLD `/bk/reimburse` (`boom App.jsx:221`, page-permission-gated). NEW `/ledger/new-reimbursement` (`cadence App.jsx:182`, AdminRoute) — there is no member-facing reimbursement route; members reach the mode by ticking "This is a reimbursement" on `/add-invoice` (`AddLedgerEntry.jsx:188-191`).

## 2. Summary

NEW folds the reimbursement page into `AddLedgerEntry` as a live mode toggle, keeping invoice-upload + explicit Parse, proof upload, splits, and pending routing for non-approvers. Unlike OLD (where reimbursements never passed the checklist either), there is no checklist regression specific to this page — the P0s live in the add-invoice report. The mode-specific damage is what the `isReimb` branches HIDE: **vendor email** (OLD required + validated) and **Invoice #** (OLD optional field with a live duplicate warning) are removed from the DOM, and `checkDup` early-returns for reimbursements, so a double-submitted reimbursement is undetectable. OLD's **multi-receipt** upload (N files into `entity_files`) collapses to a single `receipt_file` column slot. Shared component gaps (parse-proof extraction, approver-only parse, social_handles never persisted, no unsaved warning, no payment_ref) hit this page identically. One notable inversion: NEW **requires** the receipt client-side where OLD treated it as optional — spec-aligned, kept as an intentional divergence (though the server does not enforce it). Totals: **15 defects (3 P1 · 6 P2 · 6 P3), 6 intentional divergences.**

## 3. Layout & visual parity

RC-1/RC-2/RC-5/RC-6 apply as everywhere. Same shells as the add-invoice report (§3); mode-specific deltas only:

| Element | OLD | NEW | Δ |
|---|---|---|---|
| Header | `"Add Reimbursement" / "Submit receipts and reimbursement requests"` (`BkAddReimbursement.jsx:273`) | `"Add reimbursement"` + role-dependent subtitle (`AddLedgerEntry.jsx:159`) | INT-2 |
| Primary upload | invoice dropzone `p-8` w/ green filled state + paired "Parse Invoice with AI" / "Remove" buttons (:294-337) | shared `Dropzone` + approver-only parse panel (:163-185) | parse gating → DEF-ADDREIMB-07 |
| Receipts tile | dashed tile, `multiple` input, "N receipts" count + "Clear all" (:339-364) | single `Dropzone` labeled "Receipt (required)" (:196) | DEF-ADDREIMB-03; required = INT-1 |
| Proof tile | filled state + scanning pulse + Remove that resets status/date/ref (:366-394, :385) | `Dropzone` "Auto-marks as paid" (:198) | DEF-ADDREIMB-04/09 |
| Date label | `Date *` / `Paid To *` (:401,407) | `Invoice date *` / `Pay to *` (:203-204) | "Invoice date" label is wrong for a receipt-dated reimbursement — cosmetic, folded into DEF-ADDREIMB-11 note |
| Vendor Email | visible, required (:413-418) | removed from DOM in reimb mode (:231 `{!isReimb && …}`) | DEF-ADDREIMB-01 |
| Invoice # | visible + amber dup warning (:440-453) | removed from DOM (:213 `{!isReimb && …}`) | DEF-ADDREIMB-02 |
| Socials | full editor w/ platform select + per-handle artist tag on splits, `*` for non-admins (:554-627) | platform/handle/$ rows, always optional, no artist tag (:238-253) | DEF-ADDREIMB-05/14 |
| Split editor | gray `bg-gray-50` panel, warn-only balance line (:493-535) | bordered SplitRow cards + hard balance block (:126-128,258-269) | DEF-ADDREIMB-12 |

## 4. Interaction & behavior parity

- **Parse reuse** — OLD reuses `/bk/parse` on the invoice file (or any chosen receipt via `parseFile`/`receiptFiles[0]` fallback, :118-146) filling 10 fields parsed-wins; NEW reuses `scanInvoice` on `invoice_file` only, typed-wins, approver-only (:62-91,170). Receipts themselves are never parseable in NEW (OLD could parse a receipt when no invoice file was chosen). Folded into DEF-ADDREIMB-07/13.
- **Proof reuse** — OLD `handleProofUpload` identical to the invoice page: auto-Paid + `/bk/parse-proof` fills date (toast), method inside-the-updater, ref (:148-174); Remove resets `payment_status/date/ref` (:385). NEW: file state only; approver-created rows go Paid server-side; no extraction; clear doesn't reset anything (`Dropzone.jsx:16`). DEF-ADDREIMB-04/09.
- **check-dup reuse** — OLD debounced 500ms on payee+invoice_number with the amber inline warning (:77-86,444-453). NEW `checkDup` **returns early when `isReimb`** (:53) and the field is hidden anyway — reimbursements have zero duplicate protection (server has no gate either, `ledger.js:164-246`). DEF-ADDREIMB-02.
- **Validation** — OLD (:180-196): payee+amount+date required; **vendor_email required + regex**; non-admins ≥1 social handle. Receipt NOT required (contrary to folklore — no receipt gate exists in :178-268, and POST `/bk/entries` has none). NEW (:112-116): payee ("Enter who to pay."), amount>0, date, **receipt required** (`!files.receipt_file` throw, :116); invoice # skipped for reimb; email/socials never required. DEF-ADDREIMB-01/05; receipt gate = INT-1.
- **Save payload** — OLD posts JSON `{...form, amount: float, is_reimbursement: true}` + `social_handles` + `artist_breakdown` (splits, first-artist fallback :223-231), then uploads each receipt to `/entries/:id/receipts` (entity_files) and invoice/proof to `/file/:type` (:232-249). NEW: one multipart with `is_reimbursement: 'true'` (:144) and the four single-file slots (:146); splits identical to invoice mode. DEF-ADDREIMB-03/06.
- **Reset** — OLD resets in place + green "Reimbursement saved successfully!" banner (:251-264,286-291); NEW toasts "Reimbursement added" (or "Submitted for approval") and navigates away (:149-151). DEF-ADDREIMB-10 (shared pattern).
- **Mode toggle (NEW-only)** — ticking/unticking "This is a reimbursement" mid-form swaps W9↔Receipt slots and shows/hides email + invoice # while preserving typed values (:28,188-199). Additive (INT-3); note a hidden stale `invoice_number` typed in invoice mode is still submitted from state when saving as a reimbursement (`Object.entries(form)` :142 — only artist/song are blanked) — benign but worth knowing.
- **Unsaved warning** — OLD arms `beforeunload` (:67); NEW none (grep). DEF-ADDREIMB-08.

## 5. Server/API & data parity

The create path is the shared POST handler in both repos — see the add-invoice report §5 for the full table. Reimbursement-mode specifics:

| Aspect | OLD | NEW | Δ |
|---|---|---|---|
| Receipt storage | N receipts → `entity_files` `expense_receipt/:id` rows (:4695-4713); invoice/proof → per-type columns | single `receipt_r2_key` column; proof falls into the receipt slot only when it's free (`ledger.js:176-181`) | DEF-ADDREIMB-03; proof-displacement quirk noted there |
| Receipt requirement | none (client or server) | client-only throw (:116); `createEntry` accepts receipt-less reimbursements via direct API | INT-1 (spec-aligned) w/ server-gap note |
| is_reimbursement | boolean through JSON (:1136 insert) | `'true'` string coerced (:208) | parity |
| Dup gate | same 409 + `force_duplicate` applies to reimbursements when invoice_number present (:1069-1082) | none | counted once as DEF-ADDINV-19; mode impact in DEF-ADDREIMB-02 |
| social_handles | stored (:1040-1054) | never written | DEF-ADDREIMB-06 (= DEF-ADDINV-26) |
| Recoupable/terms/normalization/release-link | as add-invoice §5 | as add-invoice §5 | counted once under DEF-ADDINV-05/29/30/31 |

## 6. Intentional divergences (not defects)

1. **INT-1 Receipt required (client)** — NEW blocks save without a receipt (`AddLedgerEntry.jsx:116,196`); OLD treated receipts as optional. Matches BUILD_SPEC ("reimbursement requires receipt") so kept off the defect list; NOTE the server does not enforce it (`ledger.js:164-246`), so the gate is bypassable by direct API call.
2. **INT-2 Single component / pending routing / role subtitle** — same as add-invoice INT-2 (`App.jsx:180-182`; `AddLedgerEntry.jsx:23,159`).
3. **INT-3 Live mode toggle** — reimbursement is a checkbox on the shared form rather than a separate page; separate admin route still exists (`App.jsx:182`).
4. **INT-4 Approver-gated "Mark as already paid"** (client :219-230; server `ledger.js:183-191`) — auth hardening; OLD let any bk-granted user create Paid reimbursements.
5. **INT-5 Tenancy / atomic multipart / toasts / brand kit** — as add-invoice INT-1/3/5/7.
6. **INT-6 Additive fields in reimb mode** — Mailing address + Bank name shown (OLD reimb page had neither, :232-233 NEW); Currency list 4→12.

## 7. Defect register

| ID | Sev | Where (NEW) | Defect | OLD reference |
|---|---|---|---|---|
| DEF-ADDREIMB-01 | P1 | `AddLedgerEntry.jsx:231` (`!isReimb`), `:112-116` | Vendor email removed in reimbursement mode (OLD required + regex-validated) — reimbursement rows carry no payee contact for decision/payment emails | `BkAddReimbursement.jsx:184-192,413-418` |
| DEF-ADDREIMB-02 | P1 | `AddLedgerEntry.jsx:213` (`!isReimb`), `:53` | Invoice # field removed AND `checkDup` early-returns for reimbursements — no reference number recordable, zero duplicate detection client or server for reimbursements | `BkAddReimbursement.jsx:77-86,440-453` |
| DEF-ADDREIMB-03 | P1 | `AddLedgerEntry.jsx:44,196`; `ledger.js:170-181` | Multi-receipt upload gone: OLD accepted N receipts into `entity_files` w/ count + "Clear all"; NEW has one `receipt_file` column slot (and an attached proof silently occupies it when no receipt was chosen — but NEW requires a receipt, so only via direct API) | `BkAddReimbursement.jsx:95-116,241-246,339-364`; `bookkeeping.js:4695-4713` |
| DEF-ADDREIMB-04 | P2 | no NEW endpoint; `AddLedgerEntry.jsx:198` | `/parse-proof` extraction gone (payment date toast, method-inside-updater, ref) + client no longer auto-marks Paid on proof; "Auto-marks as paid" hint false for non-approvers (shared w/ DEF-ADDINV-12) | `BkAddReimbursement.jsx:148-174` |
| DEF-ADDREIMB-05 | P2 | `AddLedgerEntry.jsx:112-116,240` | Non-admin ≥1-social-handle requirement gone (socials always optional) | `BkAddReimbursement.jsx:193-196,558-561` |
| DEF-ADDREIMB-06 | P2 | `AddLedgerEntry.jsx:131-134`; `ledger.js:164-246` | `social_handles` JSONB never persisted for reimbursed creators; amount-less handles discarded (shared w/ DEF-ADDINV-26; feeds NEW `flags.js:174` missing_socials) | `BkAddReimbursement.jsx:209-222` |
| DEF-ADDREIMB-07 | P2 | `ledger.js:84,1233`; `AddLedgerEntry.jsx:170` | AI parse approver-only — OLD let any bk-granted user parse; OLD could also parse a receipt when no invoice file existed (`parseFile`/`receiptFiles[0]` fallback), NEW parses `invoice_file` only | `BkAddReimbursement.jsx:118-146,325-337` |
| DEF-ADDREIMB-08 | P2 | grep: no beforeunload in cadence client | `useUnsavedWarning` gone | `BkAddReimbursement.jsx:67` |
| DEF-ADDREIMB-09 | P2 | `AddLedgerEntry.jsx:219-230`; `Dropzone.jsx:16` | Ref # (`payment_ref`) input missing; proof-remove no longer resets payment_status/date/ref | `BkAddReimbursement.jsx:385,645-651` |
| DEF-ADDREIMB-10 | P3 | `AddLedgerEntry.jsx:149-151` | Save navigates away — reset-in-place multi-entry flow + persistent success banner gone | `BkAddReimbursement.jsx:251-264,286-291` |
| DEF-ADDREIMB-11 | P3 | `AddLedgerEntry.jsx:38-49,203,218` | Rep not defaulted / current-user not offered; `Date *` relabeled `Invoice date *` (misleading for receipt-dated spend) | `BkAddReimbursement.jsx:401,477-484` |
| DEF-ADDREIMB-12 | P3 | `AddLedgerEntry.jsx:126-128` | Split editor hard-blocks unbalanced totals that OLD saved with a warning; no remainder prefill | `BkAddReimbursement.jsx:493-535` |
| DEF-ADDREIMB-13 | P3 | `AddLedgerEntry.jsx:73-83` | Parse fill precedence inverted (typed-wins vs OLD parsed-wins) — shared w/ DEF-ADDINV-14 | `BkAddReimbursement.jsx:128-140` |
| DEF-ADDREIMB-14 | P3 | `AddLedgerEntry.jsx:238-253` | Per-handle artist tag on socials for split reimbursements gone (untagged-shared-family-wide semantics unrepresentable) | `BkAddReimbursement.jsx:591-604` |
| DEF-ADDREIMB-15 | P3 | `Dropzone.jsx:11-15` | pdf/jpg/png allowlist + error message gone; drop path unfiltered (shared w/ DEF-ADDINV-33) | `BkAddReimbursement.jsx:95-102` |

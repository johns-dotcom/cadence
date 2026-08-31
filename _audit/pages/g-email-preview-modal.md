# g-email-preview-modal — EmailPreviewModal + emailDispatch layer (global surface)

OLD: `boom-dashboard/client/src/components/EmailPreviewModal.jsx` (373L) + `CcChipInput.jsx` (191L) + `server/services/emailDispatch.js` (403L) + `server/routes/email.js` (preview/send), consumed at 8 sites (Layout, BkApprovals, BkPayments ×2, MyWork, Team, Settings ×2).
NEW: `cadence/client/src/components/EmailPreviewModal.jsx` (96L) + `CcChipInput.jsx` (~60L) + `server/lib/emailDispatch.js` (93L) + `server/routes/email.js` (54L), consumed at 2 sites (Approvals.jsx:309, Payments.jsx:395) + CcChipInput reused on the public vendor form (VendorSubmit.jsx:249).

Route & permissions: global surface. Server: OLD gates preview/send to bookkeeping users, welcome/test-invitation additionally admin (boom email.js:18); NEW gates the whole router `requireApprover` (cadence email.js:14) and hardens ctx (`safeCtx` strips client attachments + injects the true workspace name/labelId, :18-24) — **[INT]** tenancy/security.

CLAUDE.md M2 claims this exists — **verified: the components and dispatch layer are real, but the modal is dead at runtime** (defect 1), so the claim is false in effect.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 1. Layout & structure

**OLD modal** (:36-47 props): two drive modes — pre-rendered (`initialHtml/To/Cc/Subject` from a route's `pending_email` payload) or lazy (`previewKind`+`previewContext` → POST /api/email/preview) (:10-16); editable To, CC chips, Subject, optional **"Personal Note" textarea that live re-renders the server template** (:29-31,:119-138), an **inline-editable preview iframe** whose hand-edits ship as `html_override` (:140+,:17-18), attachment labels row (:293-296), Skip button for queue flows (:344-351), title/subtitle/sendLabel/skipLabel overrides, `team` roster + `defaultCcEmails` prefill. Queueing lives in the consumers (BkApprovals `pending_email` queue "N more queued" :2130-2140; BkPayments per-vendor `confirmQueue` :2372-2398).

**NEW modal** (:14-96): lazy mode only (always fetches /email/preview, :35), editable To/CC(chips)/Subject (:73-75), attachment chips (:76-80), read-only iframe (:84), **queue mode internalized** — `items=[{kind, ctx, label, onItemSent, onCustomSend}]` with Send→next / Skip→next (:12-13,:43,:89), `onCustomSend` escape hatch for attachment-bearing routes since the generic /email/send strips attachments (:49-52 + cadence email.js:1-4).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Chrome | inline-styled via `getDarkColors` (dark-aware JS palette) | tokenized `card max-w-lg`, z-[80] | OLD :44-47 / NEW :62-64 |
| Header | title + optional subtitle ("N more queued · Entry #id") | "Review email · i of n — label" | OLD :2130-2140 / NEW :66-68 |
| Preview | iframe, inline-editable (cursor shows it) | iframe read-only, `bg-white` (correct for email canvas), skeleton while loading | OLD :140+ / NEW :83-84 |
| Buttons | Send / Skip-label / Cancel, busy states | Send / Skip (queue) / Cancel, busy state | OLD :344-360 / NEW :88-92 |
| CC field | custom autocomplete dropdown (191L component) | chips + native `<datalist>` suggestions; invalid emails flagged red | OLD CcChipInput.jsx / NEW :26-45 |

## 3. Copy & content differences

Email kinds:

| Kind | OLD (emailDispatch.js cases :118-240) | NEW (TEMPLATES :29-38) |
|---|---|---|
| welcome | ✓ (previewed from Settings.jsx:766) | ✓ defined — **no consumer**; invites send direct (team.js:91,:119) |
| test_invitation | ✓ | ✗ — **[INT]** test users deliberately skipped in Cadence |
| vendor_approved / vendor_rejected | ✓ | ✓ (Approvals.jsx:49,:59,:71) |
| payment_confirmation | ✓ w/ server-merged vendor CC + invoice/proof attachments | ✓ (Payments.jsx buildConfirmItems :176-189 — client-fetched CC, **no attachments**) |
| bulk_payment_confirmation | ✓ true bulk — one email per vendor, family-rooted invoice table (`loadFamilyRoots` :25-53) | ⚠ aliased to the single template; "queued client-side" = N separate emails (:34) |
| task_assigned | ✓ (previewed from MyWork.jsx:1684, Team.jsx:932) | ✓ defined — **no consumer**; assignment sends direct (tasks.js:152) |
| internal_request | ✓ (previewed from Layout.jsx:247) | ✓ defined — **no consumer**; sends direct (internal-requests.js:54) behind the page's own static preview pane (InternalRequests.jsx:23-76) |
| approval_request | ✗ | ✓ **NEW-only** (Send-for-Approval, ledger.js:716) |

So both sides ship 8 kinds (the spec's "9" over-counts OLD); the sets differ by test_invitation ↔ approval_request.

## 4. Feature & interaction differences

### THE defect: the NEW modal never renders

`EmailPreviewModal` requires an `open` prop (:14) and bails `if (!open || !cur) return null` (:41); the preview fetch is also gated on `open` (:32-33). **Both consumers mount it without `open`**: `{emailItems && <EmailPreviewModal items={emailItems} …/>}` (Approvals.jsx:309, Payments.jsx:395). `open` is `undefined` → the modal always returns null. Consequences, all silent:

- Approve/reject **deliberately suppress the server email** (`notify: false`, Approvals.jsx:47,:58) and hand it to the modal → **vendor decision emails are never sent** on the Approvals page (single + bulk, :49,:59,:71). No toast either — the success toast sits on the `else` branch (:50,:60).
- Payment confirmations (single + bulk) never send, and `onItemSent` → `/mark-sent` never fires, so `confirmation_sent` tracking never updates (Payments.jsx:176-196).
- Send-for-Approval never reaches its `onCustomSend` → `/ledger/send-for-approval` (Payments.jsx:141-146) — the attachment-bearing server route (ledger.js:716) is unreachable from the UI.

Meanwhile the drawer/other ledger flows still email because ledger.js defaults `notify !== false` (:432,:457) and auto-sends confirmations on pay-with-proof / mark-paid (:499,:1582,:1604) **without any preview** — direct `notifyVendor` (:47-58).

### Flows that lost their preview entirely (vs OLD)

| Flow | OLD | NEW |
|---|---|---|
| Welcome / invite | previewed (Settings.jsx:766; kind welcome) | direct send on invite + resend (team.js:91,:119) |
| Task assignment | previewed (MyWork.jsx:1684; Team.jsx:932) | direct send (tasks.js:152) |
| Internal request | previewed w/ editable To/CC (Layout.jsx:247) | page-local static preview, fixed platform-inbox recipient, direct send (InternalRequests.jsx:23-76; internal-requests.js:54) — recipient fixity is **[INT]** (platform model) |
| Vendor decision / payment confirmation via ledger drawer & auto-paid paths | previewed or explicitly queued | direct `notifyVendor` best-effort (ledger.js:432,:457,:499,:1582,:1604) |
| Password reset / chat mention / operator invites | n/a in OLD | direct (auth.js:445, chat.js:502, platform.js:487,:728,:993) — transactional, **[INT]** |

### Modal capability diffs

- **Inline-editable HTML body + `html_override`** (OLD :140+, send :130) — NEW iframe is read-only and send posts only `{to, cc, subject}` (:52); the server still honors `html_override` (emailDispatch.js:88) so only the client affordance is missing.
- **Personal Note field with live template re-render** (OLD :29-31,:119-138) — absent in NEW (`approval_request` even has a `note` slot in ctx, hardcoded `''`, Payments.jsx:144-145).
- **Pre-rendered payload mode** (OLD :10-13) — absent; NEW always re-fetches (fine given safeCtx, but bulk-approve re-renders N previews serially as the queue advances).
- **Attachments on payment confirmations**: OLD attaches invoice+proof per expense (`loadExpenseAttachments` emailDispatch.js:83-100, wired :339-368) and merges saved vendor CC server-side (`mergeVendorCc`); NEW confirmations carry no attachments (ctx has none; generic route strips them by design, email.js:20) — CC merge survives client-side via `/ledger/vendors/:payee/emails` + CC-rep toggle (Payments.jsx:176-183 — parity kept).
- **Bulk consolidation**: OLD bulk_payment_confirmation sends ONE email per vendor listing all family-rooted invoices (loadFamilyRoots :25-53); NEW queues one email per row (:34 comment) — a vendor paid on 6 invoices gets 6 emails.
- NEW-only keeps: `safeCtx` server hardening, tenant identity/accent/reply-to on every template (emailDispatch.js:14-26,:45-48), queue internalized in the modal, invalid-CC red flagging.

## 5. Data layer differences

- Endpoints identical in shape: `POST /api/email/preview` + `POST /api/email/send` (OLD email.js:23,:47 / NEW :27,:40). NEW validates `kind ∈ KINDS`, strips attachments/label/labelId from client ctx, injects tenant identity, logs "Sent email" to activity (:30,:18-24,:46).
- OLD prepare does DB lookups per kind (family roots, rep email :103-113, vendor CC merge); NEW keeps dispatch DB-agnostic — callers resolve context (:6-8) — architecture divergence, acceptable, but it is what dropped attachments/consolidation from confirmations (§4).
- Sends: both fall through Resend→SendGrid→SMTP in lib/email.js; NEW adds per-label from-identity + reply-to (email.js:86-93,:20-24) — **[INT]** multi-tenant.

## 6. Tables & forms (if present)

The modal's form fields are §4's subject matter; no tables.

## 7. Defects found

1. **P1** — EmailPreviewModal never renders: requires `open` (EmailPreviewModal.jsx:14,:32,:41) but both consumers omit it (Approvals.jsx:309, Payments.jsx:395). Because approve/reject pass `notify:false` expecting the modal to carry the email (Approvals.jsx:47,:58), vendor approval/rejection emails, payment confirmations (+ `/mark-sent` tracking), and the entire Send-for-Approval flow are silently dead — fix: pass `open` (one-line: `<EmailPreviewModal open items=…>`) or drop the `open` prop in favor of the mount gate. (HIGH — static evidence conclusive; runtime confirm trivial)
2. **P2** — Welcome/invite emails send with no preview: OLD previews the welcome kind (Settings.jsx:766); NEW team invite + resend fire directly (team.js:91,:119) and the dispatch `welcome` kind has zero consumers — fix: wrap invite in EmailPreviewModal via /email/preview or accept and log. (HIGH)
3. **P2** — Task-assignment emails send with no preview and the `task_assigned` kind is orphaned (OLD MyWork.jsx:1684, Team.jsx:932 / NEW tasks.js:152 direct) — fix: optional preview from TaskDrawer assign flow. (HIGH)
4. **P2** — Payment confirmations lost their invoice/proof attachments: OLD attaches per expense (emailDispatch.js:83-100,:339-368); NEW ctx carries none and the generic route strips attachments by design (cadence email.js:2-4,:20) — fix: a feature route (like send-for-approval, ledger.js:716) that resolves attachments server-side + `onCustomSend`. (HIGH)
5. **P3** — Bulk confirmation consolidation lost: one-per-vendor family-rooted invoice table (OLD loadFamilyRoots emailDispatch.js:25-53 + bulk builder :226-262,:368+) vs N separate per-row emails (NEW emailDispatch.js:34, Payments.jsx:176-196) — fix: real bulk template + per-vendor grouping in buildConfirmItems. (HIGH)
6. **P3** — Modal capability losses: inline-editable body (`html_override` client affordance — server already supports it, cadence emailDispatch.js:88), Personal-Note live re-render (the `note` ctx slot is hardcoded `''`, Payments.jsx:144), pre-rendered payload mode, title/subtitle/sendLabel; CcChipInput autocomplete downgraded to native datalist (OLD EmailPreviewModal.jsx:10-31,:119-160,:344-351; CcChipInput.jsx 191L vs NEW ~60L) — fix: incremental ports onto the NEW modal. (MED)
7. **P3** — Preview-less direct sends on ledger auto-paths where OLD queued previews: pay-with-proof + mark-paid confirmations and drawer approve/reject default `notify !== false` (ledger.js:432,:457,:499,:1582,:1604) — fix: route through the (repaired) modal or an explicit notify toggle in those UIs. (MED)

Intentional divergences (not defects): `test_invitation` kind dropped (test users out of scope by John's call), `approval_request` kind added, `safeCtx` attachment-stripping + tenant-identity injection (security/tenancy), per-label from/reply-to/accent on all templates (branding), transactional direct sends with no OLD counterpart (password reset auth.js:445, chat mentions chat.js:502, operator invites platform.js), fixed platform-inbox recipient on internal requests, CcChipInput reuse on the public vendor form (VendorSubmit.jsx:249).

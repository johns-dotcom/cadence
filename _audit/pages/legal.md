# Legal

## 1. Files compared (purpose & pairing)

- OLD: `boom-dashboard/client/src/pages/Legal.jsx` (37) at `/legal` (boom App.jsx:208). **A placeholder**: "Work in progress" badge + "Document storage coming soon" empty card — no data, no server calls. OLD's `/api/ndas` (boom server/routes/ndas.js, 112) is unrelated to this page: it stores the `boom_ndas` rows created by the **CreateNDA builder** (boom pages/CreateNDA.jsx + nda-templates/) — full CRUD w/ `template_id`/`template_data` (ndas.js:21-100).
- NEW: `cadence/client/src/pages/Legal.jsx` (88) at `/legal` (cadence App.jsx:153) — a working **NDA counterparty register** over `/api/ndas` (cadence server/routes/ndas.js:1-9), a `fileResourceRouter` instance (`server/lib/fileResource.js`) on the `ndas` table with an optional R2 document per row. The builder moved to `/api/nda-documents` (cadence CLAUDE.md, M4) — the two concerns OLD mixed are split.
- Net: NEW implements what OLD's placeholder promised. Deviations below are mostly forward-completion, not regressions. Design-system deltas covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 2. Route & permissions

| | OLD | NEW |
|---|---|---|
| Client route | `/legal`, no route guard (boom App.jsx:208); page self-gates: non-Admin/Superadmin renders "Not authorized" (OLD Legal.jsx:7-16) | `/legal` wrapped in `AdminRoute` = **Approver-or-above** (cadence App.jsx:153 + comment :137-138); nav item "NDAs" shown to Approvers+ (cadence Layout.jsx:269) |
| Server gate | n/a for the page (no API); OLD `/api/ndas` was auth-only, any role (boom ndas.js:6) | `requireApprover` via fileResourceRouter default gate (fileResource.js:23,27; ndas.js passes no `gate`) |

OLD intended Legal for Admin/Superadmin only (OLD Legal.jsx:13; boom UserManual.jsx:336 "admin-only"); NEW admits Approvers — logged P3 LOW below.

## 3. Server/API diff

OLD has no server surface for this page, so the table below describes NEW's API with OLD-builder contrast where meaningful.

| Endpoint (NEW `/api/ndas`) | Behavior | OLD counterpart |
|---|---|---|
| `GET /` | list, label-scoped, `created_at DESC` (fileResource.js:30-38) | boom ndas.js:9-18 listed builder docs, unscoped |
| `POST /` | requires `counterparty`; fields counterparty/status/effective_date/expiration_date/notes/file_name/r2_key; logs "Added ndas" (fileResource.js:54-73; ndas.js:7-8) | boom builder POST required effective_date/owner/recipient (ndas.js:31-33) — different record shape by design |
| `PATCH /:id` | allow-list partial update, label-anchored (fileResource.js:76-94) | boom PUT allow-list (ndas.js:70-100) |
| `POST /:id/file` | upload/replace one R2 document, old key deleted (fileResource.js:97-117) | none — OLD builder stored no files |
| `GET /:id/file` | 1h signed URL (fileResource.js:41-51) | none |
| `DELETE /:id` | row + R2 file (fileResource.js:120-131) | boom ndas.js:103-110 (no label scope) |

All NEW queries anchored to `req.labelId`; files namespaced `label-{id}/ndas/…` (fileResource.js:32,43,104) — [INT].

## 4. UI structure diff

- OLD: WIP badge (Legal.jsx:21-23) → PageHeader "Legal / NDAs and miscellaneous legal documents" (:25-28) → empty-state card, Scale icon, "Document storage coming soon … NDAs, contractor agreements, and other legal records" (:30-34). Nothing else existed.
- NEW: PageHeader "NDAs / Non-disclosure agreements" + Add NDA button (Legal.jsx:34-38) → toggleable inline create form: Counterparty, Effective, Expires (:40-47) → table Counterparty / Effective / Expires / Status (colored `<select>` pill: Active emerald, Expired amber, Terminated red :8-9,72-77) / Document (`FileAttach` upload/view chip :78) / hover-reveal delete (:79) → Shield-icon empty state (:52).
- No list search, filters, expiry warnings, or pagination in NEW — no OLD baseline to regress from; not counted as defects.

## 5. Behavior/interactions diff

OLD page had zero interactions, so these are NEW-internal findings:
- Create validates counterparty client-side with toast; reloads list on success (NEW Legal.jsx:23-28).
- `BLANK` form state carries `status` and `notes` (:10) but the form renders no inputs for either (:41-46) — notes can never be entered or seen anywhere in the UI even though the server accepts it (ndas.js:8); status is settable only after creation via the row pill.
- Status change PATCHes then reloads (:29); failure toasts and the controlled select snaps back — sound.
- Delete uses `window.confirm` (:30) although the repo now ships `ui/ConfirmDialog` (01-design-system.md, Shared UI primitives) — consistency gap.
- Dates render via `new Date(dateOnly).toLocaleDateString()` (:70-71) — the UTC-parse off-by-one-day class this repo already fixed in MyWork (cadence CLAUDE.md "Also fixed"). If the API returns date-only strings, west-of-UTC users see the prior day. CONFIRMED AND FIXED 2026-09-02 (Phase 10) — `ndas.effective_date`/`expiration_date` are Postgres `date` columns, and `pg` hands a DATE back as a JS Date that serialises to `2026-09-02T07:00:00.000Z` (midnight SERVER-local as UTC). Any reader west of the server's zone renders the prior day. Legal.jsx now uses `formatDate` whether pg returns these columns as timestamps or date strings here.

## 6. Visual/design diff

- RC-1, RC-2, RC-5, RC-6 apply. OLD page was a stub, so no page-level visual baseline exists.
- OLD's amber "Work in progress" badge and Scale-icon placeholder are correctly absent.
- NEW status pills use raw `emerald/amber/red-100/700` utilities (Legal.jsx:9) rather than the semantic `success/warning/danger` tokens — dark-mode rendering of raw tints REFUTED 2026-09-02 (Phase 10) — premise is inverted: `client/src/index.css:154-320` carries a bounded `.dark` remap layer covering red/rose/amber/orange/yellow/emerald/green/teal/sky/blue/indigo/violet/purple/pink at `-50`/`-100`, plus their `border-`/`ring-`/`hover:` variants, and pushes `-600/-700/-800` text to the `-400` tier. Specificity (0,2,0) beats the utility's (0,1,0), so no `!important` is needed. Raw tints DO remap in dark. (The pills were moved to `success`/`warning`/`danger` tokens anyway in Phase 10) (01-design-system.md, Dark strategy row).
- NEW table header row `text-[10px] uppercase bg-page/50` (:57) is denser than most NEW tables — closer to OLD's RC-3 density; fine.

## 7. Defect table

| Sev | Defect | Evidence | Conf |
|---|---|---|---|
| P3 | Access widened: OLD gated Legal to Admin/Superadmin; NEW's AdminRoute + requireApprover admit Approvers to the NDA register | cadence App.jsx:153, fileResource.js:27 vs OLD Legal.jsx:7-16; boom UserManual.jsx:336 | LOW |
| P3 | OLD's stated intent — a hub where "waivers and clearances created from the Contracts pages surface here" plus contractor agreements — not realized: NEW page is NDAs only, no aggregation of /label-waivers or /clearances records | cadence Legal.jsx:35-36 vs OLD Legal.jsx:33; boom UserManual.jsx:333-338 | LOW |
| P3 | `notes` (and initial `status`) exist in form state and the server field list but the create form renders no inputs, and notes are displayed nowhere — dead field | cadence Legal.jsx:10,41-46 + server/routes/ndas.js:8 | HIGH |
| P3 | Effective/Expires rendered with UTC-parsed `new Date().toLocaleDateString()` — known TZ off-by-one class, repo standard is `formatDate` | cadence Legal.jsx:70-71 (cf. cadence CLAUDE.md MyWork fix) | MED |
| P3 | Delete uses `window.confirm` instead of the repo's `ui/ConfirmDialog` primitive | cadence Legal.jsx:30 | HIGH |

Intentional divergences:
- [INT] NEW implements the feature OLD's placeholder only promised (register + statuses + attached signed document) — forward-completion, page purpose preserved.
- [INT] `/api/ndas` repurposed from builder-document storage to a tenancy-scoped counterparty tracker; the builder lives at `/api/nda-documents` (cadence CLAUDE.md M4) — deliberate split, no data-shape parity expected.
- [INT] Tenancy/auth: label_id scoping, label-namespaced R2 keys, signed-URL file access, logActivity on create/upload (fileResource.js:30-117).
- [INT] Nav label "Legal" → "NDAs" (cadence Layout.jsx:40,269) — matches the narrowed page content.

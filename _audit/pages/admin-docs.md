# Admin Docs

OLD: `boom-dashboard/client/src/pages/AdminDocs.jsx` (606 lines: list + detail view + DocForm + quick-upload) + `boom-dashboard/server/routes/admin-docs.js` (290 lines: CRUD + expiring + entity_files multi-attachment endpoints).
NEW: `cadence/client/src/pages/AdminDocs.jsx` (104 lines: card grid + inline create form) + `cadence/server/routes/admin-docs.js` (13-line config for the shared `server/lib/fileResource.js` factory, 136 lines) + `client/src/components/FileAttach.jsx` (single-file widget).

Pairing per `_audit/00-inventory.md`: OLD `/admin` → NEW `/admin-docs`, HIGH confidence (inventory :69,:104,:194). Design-system diffs are RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported.

## 1. Purpose & pairing

Both are the company document vault (Legal / NDAs / Compliance / HR / Financial / IP / Internal Policies / Templates — identical CATEGORIES list, OLD AdminDocs.jsx:10-13 / NEW AdminDocs.jsx:8; identical STATUSES and CONFIDENTIALITY vocab, OLD :14-15 / NEW :9-10). OLD is a full document-management surface: filterable/searchable table, per-doc detail page with editable metadata + multi-file attachments, expiring-soon workflow, Restricted tier. NEW is a flat card grid with create + status change + one attached file per doc. Neither side has an e-sign or acknowledgment flow — no differences found there.

## 2. Route / permissions

| | OLD | NEW |
|---|---|---|
| Route | `/admin`, StrictAdminRoute, nav "System · Admin Docs" (inventory :69) | `/admin-docs`, AdminRoute — **admits Approvers** (cadence App.jsx:93-96,158), nav "Contracts & Legal · Admin Docs" isAdmin-only |
| Server gate | `requireAdmin` (Admin/Superadmin) on the whole router (OLD admin-docs.js:40-44) | factory `gate: 'admin'` → `requireAdmin` (NEW admin-docs.js:8, fileResource.js:27) |
| Restricted tier | rows with `confidentiality='Restricted'` hidden from non-Superadmins on list/expiring/get (`restrictedClause`, OLD admin-docs.js:47,58,79,96); Superadmin-only to create (:115-117), edit (:151-156), or delete (:202-204) a Restricted doc; client hides the Restricted option from non-Superadmins (OLD AdminDocs.jsx:554-561) | **none** — `confidentiality` is an ordinary stored column (NEW admin-docs.js:10); every Admin sees, creates, edits, deletes Restricted docs, and the form offers "Restricted" to any admin (NEW AdminDocs.jsx:10,59) |
| Grantability | not in permission matrix (System page) | `/admin-docs` is a grantable page for Users (constants/pages.js:28) and in the Legal preset (:60) — but the server 403s non-admins, so a granted User/Approver sees a permanently empty vault (loads swallow errors, NEW AdminDocs.jsx:25) |

## 3. Server / API diff

| Endpoint | OLD (admin-docs.js) | NEW (fileResource.js via admin-docs.js config) | Δ |
|---|---|---|---|
| GET / | `d.* + created_by_name + file_count` subquery, `ORDER BY updated_at DESC` (:50-66) | `SELECT *`, `ORDER BY created_at DESC` (factory default, fileResource.js:25,30-38) | no creator name, no file count, activity no longer floats to top |
| GET /expiring | 60-day window, excludes Archived/Expired, computes `days_left`, restricted-filtered (:69-87) | — (client computes 90-day count, NEW AdminDocs.jsx:14,39) | endpoint gone |
| GET /:id | single doc + created_by_name (:90-105) | — (no detail view) | gone |
| POST / | title required; Restricted guard; tags jsonb; is_template; created_by (:108-140) | generic insert of whitelisted fields + label_id + created_by (:55-75); title required | Restricted guard + is_template gone |
| PUT/PATCH /:id | PUT, COALESCE partial, Restricted guards both directions, bumps updated_at (:143-192) | PATCH, partial, tenant-scoped, no Restricted guard (:78-97) | guard gone |
| DELETE /:id | Restricted guard; deletes all entity_files rows + best-effort R2 cleanup (:195-221) | deletes row + its single r2_key (:121-134) | guard gone |
| Files | multi-file: GET/POST/DELETE `/:id/files(/:fileId)` on `entity_files` (uploader, mime, size, label), doc updated_at bump on upload (:226-288); upload blocklist of dangerous extensions incl. trailing-dot bypass fix (:11-30) | single slot: POST `/:id/file` replaces (deletes prior R2 object, :100-118); GET `/:id/file` returns 1h signed URL (:41-52); **no fileFilter on multer** (:9) | one file per doc; type filter dropped (risk mitigated by off-origin signed-URL serving) |
| Column names | `date_signed` | `signed_date` | internal rename |
| Tags | jsonb array | free string ("comma, separated" placeholder, NEW AdminDocs.jsx:63) | untyped |

[INT]: label_id anchoring on every query, `label-<id>/admin-docs/` R2 namespace, signed-URL download instead of same-origin streaming, logActivity on create/upload (fileResource.js:14-16,69,113) — multi-tenancy/auth architecture.

## 4. UI structure diff

**OLD list view** (AdminDocs.jsx:300-502): PageHeader with two actions (quick "Upload File" with progress `n/m`, "New Document") → dismissible error strip → **expiring banner** (count, top-5 clickable doc links with days-left, red ≤14 days, "+n more", dismiss X, :353-381) → inline New-Document card using the full `DocForm` (title*, category*, counterparty, status, confidentiality, date signed, expiration, tag chip editor, notes textarea, is_template checkbox, :514-606) → filter row: **search input** (title/counterparty/tag) + **status select** + **confidentiality select** (:404-424) → **category tab strip with per-tab counts** incl. a Templates tab driven by `is_template` (:427-447) → 8-column table (Title w/ Lock+Template icons, Category, Counterparty, Date Signed, Expires, Status badge, Confidentiality, Files count) with Skeleton loading and icon empty state (:449-500). Full-page **drag-drop overlay** — every dropped file becomes its own document titled from the filename (:50-181,313-322).

**OLD detail view** (:205-296): back link, h1 + Restricted/Template badges, Edit/Delete (with confirm naming the doc and warning about attached files, :128-139), metadata grid (Status, Confidentiality, Counterparty, Date Signed, Expires, **Created By**, tag chips, notes), edit-in-place via DocForm, and a **Files card** hosting `FilesPanel` (multi-file list w/ uploader names, upload, per-file delete, :287-293).

**NEW** (AdminDocs.jsx:41-103): PageHeader + single "Add document" toggle → non-dismissible expiring count banner (:49-53) → inline create form (title, category, confidentiality, counterparty, signed, expires, tags text — **no status select, no notes input, no template flag**, :56-65) → category pill row, no counts (:68-73) → responsive 3-col card grid: title, category(+" · Restricted" text), hover-reveal delete, expiry line, **inline status `<select>` styled as a badge** (quick status change — NEW-only convenience), single `FileAttach` slot (:80-99). "Loading…" text instead of skeletons (:76). No detail view, no edit mode, no search, no status/confidentiality filters, no quick-upload, no drag-drop, no table.

## 5. Behavior / interactions diff

- **Metadata is write-once**: after creation nothing but `status` can be changed from the NEW UI (setStatus is the only PATCH caller, NEW AdminDocs.jsx:34); OLD edits every field in place (:97-127). The server PATCH accepts all fields — client-only gap.
- **Notes are unreachable**: `BLANK` carries `notes: ''` (NEW :12) but the form renders no notes input and there is no edit view — the column can never be populated or read from the UI. OLD had a notes textarea + display (:275-280,593-597).
- **Expiring logic**: OLD = server SQL, 60 days, `status NOT IN ('Archived','Expired')`, per-doc `days_left`, click-through, dismissible (server :69-87, client :353-381). NEW = client `(new Date(d) - new Date())/86400000 <= 90` with no status check (NEW :14) — an Archived or already-status-Expired doc still counts; banner is a bare count with no links and no dismiss (:49-53).
- **Quick upload**: OLD drops N files anywhere → N documents with title = filename sans extension, per-file error surfacing, progress counter, input reset (:145-181). NEW has nothing equivalent; a file can only be attached after manually creating a doc.
- **Delete**: OLD confirm quotes the title and warns "also removes any attached files" (:130); NEW generic "Delete this document?" (:35).
- **File replace semantics**: NEW upload silently deletes the previous R2 object (fileResource.js:109) — with only one slot, uploading an amendment destroys the original. OLD keeps every version as a separate entity_files row.
- **Dates**: OLD renders via shared `formatDate` (:483-484); NEW uses `new Date(iso).toLocaleDateString()` on a date-only string (:90) and the same UTC-parse in `soonExpiring` (:14) — the classic off-by-one-day TZ shift cadence already fixed in MyWork.
- **List ordering**: OLD updated_at DESC and file uploads bump updated_at so touched docs surface (:59,263-264); NEW orders by created_at (fileResource.js:25) even though its upload also bumps updated_at — the bump is invisible.
- Create validation: OLD requires title AND category client-side (:184-187); NEW title only, category defaults 'Legal' (:12,30).

## 6. Visual / design diff

Beyond RC-1..RC-6: table → card grid is the dominant change (§4). OLD status badges are tinted pills with borders (emerald/red/gray/amber, :486-491); NEW repurposes a native `<select>` as the badge (`text-[10px] rounded-full`, :92-95) — Draft maps to gray and Expired to amber (OLD: Draft amber, Expired red — STATUS_STYLE inversion, NEW :11 vs OLD :487-490). Lock icon marks Restricted rows in OLD's title cell (:477) vs plain " · Restricted" text (NEW :86). Purple template ShieldCheck badge gone (OLD :478,224-228). Empty state icon FileText → Lock (OLD :455 / NEW :78). Skeleton.Block loaders → text (OLD :452 / NEW :76). Category tabs (underline, counts) → pill buttons `bg-gray-900` active (OLD :427-447 / NEW :68-73).

## 7. Defect table

| # | Sev | Confidence | Defect |
|---|---|---|---|
| A1 | P1 | HIGH | Restricted-confidentiality tier is decorative: no visibility filtering, no Superadmin-only create/edit/delete, form offers Restricted to any admin (OLD admin-docs.js:47,115-117,151-156,202-204 vs fileResource.js — no guard anywhere; NEW AdminDocs.jsx:59) |
| A2 | P1 | HIGH | Multi-file attachments → single slot; upload REPLACES and deletes the prior file from R2; uploader/date/size list gone (OLD admin-docs.js:226-288, AdminDocs.jsx:287-293 vs fileResource.js:100-118, FileAttach) |
| A3 | P1 | HIGH | No detail view and no metadata editing — only `status` is mutable post-create; server PATCH supports all fields but nothing calls it (OLD AdminDocs.jsx:97-127,205-296 vs NEW :34) |
| A4 | P2 | HIGH | Search (title/counterparty/tag) + status filter + confidentiality filter all gone; only category pills remain (OLD AdminDocs.jsx:79-92,404-424 vs NEW :37-38,68-73) |
| A5 | P2 | HIGH | Quick-upload gone: page-wide drag-drop + Upload File button creating one titled doc per file with progress (OLD AdminDocs.jsx:50-181,305-343) |
| A6 | P2 | HIGH | Notes field unreachable: in BLANK state but no input and no edit mode ever renders it (NEW AdminDocs.jsx:12,56-65 vs OLD :593-597,275-280) |
| A7 | P2 | HIGH | Expiring workflow degraded: 60-day server window excluding Archived/Expired + days_left + clickable top-5 + dismiss + ≤14-day red → client 90-day count that also counts Archived/status-Expired docs, no links, no dismiss (OLD admin-docs.js:69-87, AdminDocs.jsx:353-381 vs NEW :14,39,49-53) |
| A8 | P3 | HIGH | `is_template` flag + Templates tab + purple badge replaced by a plain 'Templates' category value (OLD AdminDocs.jsx:82,224-228,437-443,598-603 vs NEW :8) |
| A9 | P3 | HIGH | Tag system: jsonb array + chip editor + chip display + tag search → raw comma string, never displayed (OLD AdminDocs.jsx:574-591,265-274 vs NEW :63) |
| A10 | P3 | HIGH | List column loss (counterparty, signed date, expires, confidentiality, file count, creator all undisplayed) + ordering flipped updated_at→created_at so touched docs no longer surface (OLD admin-docs.js:59, AdminDocs.jsx:459-498 vs NEW :80-99, fileResource.js:25) |
| A11 | P3 | MED | Guard mismatch: AdminRoute admits Approvers and `/admin-docs` is grantable to Users (Legal preset), but server is admin-gated — those users get a silently empty vault (App.jsx:158, constants/pages.js:28,60, NEW AdminDocs.jsx:25) |
| A12 | P3 | MED | Upload dangerous-extension blocklist dropped (OLD admin-docs.js:11-30 vs fileResource.js:9 — bare multer); mitigated by off-origin signed-URL serving |
| A13 | P3 | MED | Date display + expiring math use UTC-parsed `new Date()` on date-only strings — off-by-one-day TZ shift; OLD used shared formatDate (NEW AdminDocs.jsx:14,90 vs OLD :483-484); also Draft/Expired badge colors swapped (NEW :11 vs OLD :487-490) |

Intentional divergences: route `/admin` → `/admin-docs` + nav move System → Contracts & Legal (multi-tenant IA) · label_id scoping, `label-<id>/…` R2 keys, signed-URL file downloads, logActivity (tenancy/auth architecture) · NEW-only inline status quick-change select on cards.

# Contracts

OLD: `boom-dashboard/client/src/pages/Contracts.jsx` (1,690 lines) + `server/routes/contracts.js` (870 lines, 15 handlers).
NEW: `cadence/client/src/pages/Contracts.jsx` (183 lines) + `server/routes/contracts.js` (200 lines, 8 handlers).

Verdict up front: **the page was rebuilt as a minimal tracker, not cloned.** OLD is a full contract
workbench — missing/expiring intelligence panels, filters, a drill-in detail view with linked
financial roll-ups and inline-editable financial obligations, multi-file document management with
inline PDF preview, and an AI scan-to-autofill create flow. NEW keeps only: flat list table,
collapsible create form (plus an additive AI clause-drafting box), single-file upload/open, delete.
Roughly 85% of OLD's surface is absent. The data model also shrank (no `financial_terms` JSONB, no
`entity_files` multi-file attachments, `royalty_split` numeric→VARCHAR free text), which makes
several OLD features unrepresentable, not merely unbuilt.

## 1. Layout & structure

| Region | OLD | NEW |
|---|---|---|
| Page states | Two full states: list view ↔ detail view swap (`if (selectedContract)` boom :461-673) | Single list state only; rows are not clickable (cadence :156) |
| Header | PageHeader "Contracts / Manage your artist contracts" + dark "New Contract" button (boom :677-689) | PageHeader "Contracts / Artist agreements and documents" + `.btn-primary` "Add contract" (cadence :102-106) |
| New Contract form | Collapsible card w/ AI scan drop zone at top, 2-col grid, split-bar widget, Financial Obligations editor (boom :696-1043) | Collapsible 3-col grid form + AI clause box + notes (cadence :109-133) |
| Missing Contracts panel | Collapsible card, 3 buckets (boom :1045-1139) | **absent** |
| Expiring panel | Collapsible card, 90-day window, color buckets (boom :1141-1186) | **absent** |
| Filters card | search + type + status (boom :1188-1202) | **absent** |
| Quick-attach card | contract select + drop zone (boom :1204-1270) | **absent** (per-row Upload label only, cadence :166-169) |
| Inline preview | FilePreview overlay, single+multi modes (boom :1273-1284) | **absent** (opens signed URL in new tab, cadence :87-93) |
| Table | 8 cols incl. Artist/Boom split + Doc preview + delete (boom :1286-1402) | 7 cols: Artist/Type/Signed/Expires/Status/Document/delete (cadence :148-180) |
| Detail view | Back link, h1, Contract Details card, LinkedDataPanel, Financial Obligations card, Documents (FilesPanel) (boom :461-673) | **absent** |

## 2. Visual differences

- Status badges: OLD token badge classes `badge badge-green/red/yellow` (Active green, Expired/Terminated red, else yellow — boom :430-435); NEW hard-coded `bg-emerald-100/amber-100/gray-100/red-100` pills (cadence :14-19) — Expired remapped red→gray; raw palette utilities violate NEW's own var-backed dark convention (dark rendering `UNVERIFIED — needs runtime check`). RC-2 covers accent hue.
- OLD table uses `table-header`/`table-cell` component classes + `bg-surface-50` thead (boom :1289-1299); NEW ad-hoc `px-4 py-3 text-xs uppercase` th + `hover:bg-gray-50` rows (cadence :150-156) — the `hover:bg-gray-50` near-invisible-in-dark landmine documented in the design-system file.
- OLD loading = `Skeleton.PageHeader` + `Skeleton.Table rows=6` (boom :447-453); NEW = bare text "Loading…" (cadence :137).
- OLD row Doc cell: boom-red `File` icon + count + tiny `Eye` (boom :1377-1385); NEW: text link "Open" w/ `Download` 13 or "Upload" label (cadence :163-169). RC-3/RC-4 apply (OLD `text-[10px] font-bold` count chip, size-10 Eye).
- OLD New Contract/Create buttons are `bg-gray-900` dark buttons (boom :682-686, :1037-1040); NEW uses `.btn-primary` brand (RC-2, taller per RC-5).
- OLD empty table state = in-table row "No contracts found" (boom :1303-1306); NEW = card w/ FileText icon "No contracts yet." (cadence :139) — but NEW's empty state also replaces the error state (§4).

## 3. Copy & content differences

- Subtitle: "Manage your artist contracts" → "Artist agreements and documents".
- Button: "New Contract" → "Add contract"; "Create Contract" → "Add contract" (submit).
- Delete confirm: OLD `Delete the {type} contract for {artist}? This will also delete N attached file(s). This cannot be undone.` (boom :63-69) → NEW `Delete this contract?` (cadence :93).
- OLD scan copy entirely gone: "Scan contract PDF to auto-fill", "Reading contract…", "Contract scanned — fields auto-filled", "PDF will be saved on Create", "N fields to review", `Couldn't auto-match artist "X" — please select manually below.`, "Contract created, but attaching the scanned PDF failed: … Re-attach the file from the contract's Documents panel.", "Scanning requires ANTHROPIC_API_KEY in your Railway environment variables." (boom :704-822, :264-272, :321-326).
- CONTRACT_TYPES: OLD `Recording, Publishing, Distribution, Management, Licensing` (boom :162); NEW adds **Producer** and reorders (Distribution before Publishing) (`cadence client/src/constants.js:56`). CONTRACT_STATUSES identical `Active, Pending, Expired, Terminated` (boom :163; cadence constants.js:58).
- NEW-only copy: AI clause box ("Draft a clause with AI", "Generated clauses are appended to Notes for review…", cadence :127-136).

## 4. Feature & interaction differences

### Features in OLD missing in NEW
1. **Missing Contracts panel** — 3 collapsible buckets: artists w/ releases but no contract (red, release counts), contracts w/ no uploaded document (amber, click→detail), expired w/ no active replacement (gray) + total-issues header count (boom :1045-1139, server `/missing` boom contracts.js:193-250). No NEW endpoint or UI.
2. **Expiring panel** — active contracts expiring ≤90 days, `getExpiryBucket` ≤30 red / 31-60 orange / 61-90 amber, `{days}d` chip, click→detail (boom :368-373, :1141-1186; server `/expiring` w/ `days_until_expiry` boom contracts.js:275-296). No NEW endpoint (`/renewals` exists but serves the Renewals page) or UI.
3. **Filters** — client search-by-artist + server-driven type/status selects (refetch on change, boom :168-172, :375-381, :1188-1202; server `?artist/type/status` params boom contracts.js:103-142). NEW list takes no params (cadence contracts.js:41-56) and has no filter UI.
4. **Detail view** — entire drill-in: Contract Details grid (type/status/territory/releases/signed/expiration/advance/notes), royalty-split Artist-vs-label two-box + proportional split bar (boom :461-544). Rows not clickable in NEW.
5. **LinkedDataPanel** — recoupment progress (Advance / Uploaded-for-recoupment / Pending / Income stats, emerald+amber stacked exposure bar, income-offset line), Releases (lifetime + during-term + recent-5 linking to `/releases/:id`), Income by type, Spend top-6 category bars + unpaid warning chip (boom :549-553, :1408-1645; server `/:id/linked` boom contracts.js:408-538). No NEW endpoint or component.
6. **Financial Obligations** — `financial_terms[]` JSONB: read list w/ recoupable pills + smart amount formatting, inline edit mode (add/patch/remove rows, save via PUT) on both detail (boom :88-127, :556-663) and create form (boom :953-1032). NEW has no column (schema `cadence server/index.js:446-464`), no UI, and `financial_terms` is absent from POST/PATCH (cadence contracts.js:19-22, :100-129).
7. **Multi-file documents (FilesPanel + entity_files)** — upload revisions, list w/ uploader name, per-file delete (boom :666-673; server `POST/GET/DELETE /:id/files` + legacy `/:id/upload`, boom contracts.js:666-786). NEW is a single-file replace model on the contract row (`file_name`/`r2_key`, `POST /:id/file` deletes the previous object — cadence contracts.js:158-185); no revision history, and no way to replace a file from the UI once one exists (Upload label renders only when `!c.file_name`, cadence :163-169).
8. **Inline PDF preview** — per-row preview button: single-file → FilePreview `url` mode; multi-file → fetch `GET /:id/files` and FilePreview `files` pager w/ count badge + per-row loading state + legacy `file_path` fallback (boom :1324-1387, :1273-1284). NEW opens the signed URL in a new tab via an extra `GET /:id` round-trip (cadence :87-93).
9. **AI contract scan** (separate from #5 per audit rules) — `POST /contracts/scan`: PDF-only drop/click zone w/ drag states + spinner; Claude extraction w/ per-field `_confidence` map (server clamps to high/medium/low, boom contracts.js:297-403); fuzzy artist match w/ "select manually" fallback (boom :215-231, :264-266); green applied-banner w/ detected-fields summary + "N fields to review" counter (boom :705-757); `ConfChip` amber "AI guess"/rose "low confidence" pills next to each autofilled field, cleared on user edit (boom :150-160, :1647-1675); per-term `_confidence` chips on obligation rows (boom :975-996); scanned File held and uploaded AFTER create via `POST /:id/files` w/ dedicated "Contract created, but attaching…" failure alert (boom :139-143, :277-330); `setup_required` → ANTHROPIC_API_KEY copy (boom :266-272). Nothing in NEW (the clause-drafter is unrelated).
10. **`n` hotkey** opens the new-contract form (boom :129-131); NEW imports no hotkeys (`useHotkeys` hook exists in cadence).
11. **SearchableSelect artist picker** (type-to-search, roster fetched w/ `limit=500`, boom :178-186, :832-840) → native `<select>` (cadence :112-115). NEW's artists route is unpaginated so no truncation, but no search affordance.
12. **Required-fields gating** — OLD requires artist + type, Create disabled otherwise (boom :277-278, :1037); NEW allows artist-less "Unassigned" contracts (cadence :64, server cadence contracts.js:103-106) — data-model widening.
13. **Delete UX** — detailed confirm incl. attached-file count, `deletingId` in-flight disable, missing-panel refresh after delete (boom :60-85, :1389-1398); NEW generic confirm, no in-flight state (cadence :92-98).
14. **Royalty-split widget** — numeric % input inside Artist box, computed label share box, animated split bar, clamping 0-100 (boom :863-909; also read-only variant in detail :504-531 and Artist/Boom table column :1297, :1315-1323). NEW: free-text input "e.g. 50/50" (cadence :117), column type VARCHAR (cadence index.js:455) — the computation is unrepresentable.
15. **Artist-budget sync** — `syncArtistBudget()` upserts `artist_budgets` from active contracts' advances + dollar obligations on create/update/delete (boom contracts.js:29-93, :180, :596, :660). No NEW equivalent (no `artist_budgets` table in cadence).

### Features in NEW not in OLD (additive)
- **AI clause drafting** — `POST /contracts/draft-clause` (503 when unconfigured) + form box appending `KIND\nclause` to Notes (cadence :34-46, :127-136; server :26-39; `server/lib/claude.js:187-195`). Documented M4 feature.
- `num_releases` is enterable on the create form (cadence :121) — OLD showed it in detail but had no form input (boom BLANK_CONTRACT :13).
- Per-row drag-drop upload via `dropTarget` (cadence :166), toasts instead of `alert()`, `logActivity` on create/upload, signed-URL file access, `PATCH /:id` allow-list endpoint (cadence contracts.js:131-156 — OLD used blanket-COALESCE PUT, boom contracts.js:567-607).

### Interaction/UX differences
- OLD refetches on filter change via `useEffect([typeFilter, statusFilter])` (boom :168-172); NEW single fetch on mount.
- OLD list ordered by `expiration_date ASC` (renewal urgency first, boom contracts.js:144); NEW `created_at DESC` (cadence contracts.js:48).
- NEW upload accepts any MIME type (multer has no fileFilter, cadence contracts.js:17); OLD enforced PDF-only server-side on both multer instances (boom contracts.js:81-98) and client-side (boom :409-412).

## 5. Data layer differences

| Endpoint | OLD | NEW |
|---|---|---|
| GET `/` | `?artist/type/status` filters; per-row `file_count`, `latest_file_id/filename/original_name` subqueries; ORDER BY expiration ASC (boom contracts.js:101-157) | no params, `c.* + artist_name`, ORDER BY created_at DESC (cadence :41-56) |
| POST `/` | requires artist_id+type; writes `financial_terms` JSONB; fires `syncArtistBudget` (boom :159-192) | requires type only; artist optional but tenant-validated; no financial_terms; `logActivity` (cadence :100-129) |
| GET `/missing` | 3-bucket shape `{noContract, noFile, expiredUnreplaced}` (boom :193-250) | **missing** |
| GET `/renewals` | all contracts w/ expiration, unfiltered (boom :252-273) | Active + `?days` (≤365, default 90) window (cadence :58-77) — different consumer (Renewals page), shape changed |
| GET `/expiring` | Active, 0-90 days, computed `days_until_expiry` (boom :275-296) | **missing** |
| POST `/scan` | Claude PDF extraction + `_confidence` clamping + `setup_required` flag (boom :297-403) | **missing** |
| GET `/:id/linked` | `{releases:{total,during_term,recent}, expenses:{count,total,recoupable_*,ufr_*,unpaid_*,by_category}, income:{total,during_term,by_type}}`, pg-numeric→number coercion (boom :408-538) | **missing** |
| GET `/:id` | contract + artist_name (boom :540-564) | + signed `file_url` (1h) when `r2_key` set (cadence :79-98) — intentional R2 shape |
| PUT `/:id` | COALESCE full update incl. financial_terms; budget sync (boom :567-607) | replaced by PATCH allow-list of 10 scalar fields (cadence :19-22, :131-156) |
| DELETE `/:id` | snapshots entity_files, deletes rows, best-effort R2+disk cleanup, budget re-sync (boom :614-662) | single r2_key cleanup, no activity log (cadence :187-200) |
| POST `/:id/upload`, POST/GET/DELETE `/:id/files` | legacy + entity_files suite (boom :666-786) | **missing** — replaced by single-slot POST `/:id/file` (cadence :158-185) |
| POST `/generate` | full AI contract draft from same-type reference contracts (boom :788-868; consumer is OLD `CreateContract.jsx:54` — parity belongs to that page's audit) | replaced by `/draft-clause` (clause-level, no reference-contract context) |

Schema: NEW `contracts` drops `financial_terms` and `file_path`, adds `label_id`/`file_name`/`r2_key`/`updated_at`; `royalty_split`/`advance`/`num_releases` typed VARCHAR(100) (cadence index.js:446-465) vs OLD numeric usage (arithmetic `100 - royalty_split`, `parseFloat(advance)`).
Auth: OLD `requirePagePermission('/contracts', …)` — per-user page grants for non-admin roles (boom contracts.js:12-22); NEW blanket `requireApprover` (cadence :13-15) — stricter, flagged intentional (same call as pending-contracts audit).

## 6. Tables & forms

- List table: OLD 8 columns — Artist, Type, Status, Signed, Expires, **Artist / Boom** (split `X% / Y%` w/ boom-red label share, :1315-1323), Doc (preview + count), delete. NEW 7 — split column gone, Status moved after Expires, Doc = Open/Upload text.
- Dates: OLD `formatDate()` util everywhere (boom :1313-1314); NEW `new Date(d).toLocaleDateString()` (cadence :159-160) — the documented UTC-parse TZ day-shift landmine; `utils/dates.js formatDate` exists in cadence and is unused here.
- Create form: OLD 2-col w/ required markers, ConfChips, split-bar widget, financial obligations sub-editor, scan zone; NEW 3-col plain inputs (types/statuses from shared constants), no required marker beyond server-side type check, royalty free-text, no obligations.
- Error handling: OLD `setError` + rendered error line (boom :335, :1272); NEW `load()` swallows via `.catch(() => {})` (cadence :52) so a failed fetch renders the "No contracts yet." empty state.

## 7. Defects found

| # | Sev | Defect | Evidence | Conf |
|---|---|---|---|---|
| CT-1 | P0 | Contract detail view removed entirely — rows unclickable; Contract Details grid, royalty two-box + split bar, notes block, Documents section all unreachable | boom :461-673 vs cadence :156 | HIGH |
| CT-2 | P1 | LinkedDataPanel + `GET /:id/linked` missing (recoupment stacked bar, income offset, releases lifetime/during-term/recent-5, income by type, top-6 spend bars, unpaid chip) | boom :1408-1645, boom contracts.js:408-538 | HIGH |
| CT-3 | P1 | AI contract scan flow + `POST /contracts/scan` missing (drop zone, `_confidence`/ConfChip, fuzzy artist match + manual-fallback copy, post-create file attach + "Contract created, but attaching…" recovery, ANTHROPIC_API_KEY setup error) | boom :139-160, :194-332, :704-822, :1647-1675; boom contracts.js:297-403 | HIGH |
| CT-4 | P1 | `financial_terms` obligations dropped end-to-end (schema column, POST/PATCH, view list, inline editor on detail + create form) — OLD data unrepresentable | boom :88-127, :556-663, :953-1032; cadence index.js:446-464, contracts.js:19-22 | HIGH |
| CT-5 | P1 | Missing Contracts panel + `GET /missing` (3 buckets, collapsible, counts, click-through) missing | boom :1045-1139, boom contracts.js:193-250 | HIGH |
| CT-6 | P1 | Expiring panel + `GET /expiring` (90-day, ≤30/31-60/61-90 color buckets, days chip) missing | boom :368-373, :1141-1186, boom contracts.js:275-296 | HIGH |
| CT-7 | P1 | Filters missing: artist search + type + status (client UI and server `?artist/type/status` params) | boom :1188-1202, boom contracts.js:103-142 vs cadence contracts.js:41-56 | HIGH |
| CT-8 | P1 | Multi-file document model gutted: entity_files revisions + FilesPanel + `POST/GET/DELETE /:id/files` + `/:id/upload` → single-slot replace that deletes the prior R2 object; no revision history and no UI path to replace an existing file | boom :666-673, boom contracts.js:666-786 vs cadence contracts.js:158-185, cadence :163-169 | HIGH |
| CT-9 | P1 | Inline PDF preview missing: FilePreview single-`url` + multi-`files` pager, per-row file-count badge, per-row files fetch, legacy fallback → new-tab open of one signed URL | boom :1273-1284, :1324-1387 vs cadence :87-93 | HIGH |
| CT-10 | P1 | Royalty split demoted numeric→VARCHAR free text: artist/label two-box widget, live split bar, clamping, computed label share, and the table's Artist/Boom column all unrepresentable | boom :504-531, :863-909, :1297, :1315-1323 vs cadence :117, cadence index.js:455 | HIGH |
| CT-11 | P2 | `syncArtistBudget` contract→artist_budgets rollup (create/update/delete) has no NEW equivalent | boom contracts.js:29-93, :180, :596, :660 | HIGH |
| CT-12 | P2 | Date cells `new Date().toLocaleDateString()` — documented TZ day-shift landmine; `utils/dates formatDate` unused | cadence :159-160 vs boom :1313-1314 | HIGH |
| CT-13 | P2 | Upload accepts any MIME (no multer fileFilter, no client PDF check); OLD enforced PDF-only both sides | cadence contracts.js:17 vs boom contracts.js:81-98, boom :409-412 | HIGH |
| CT-14 | P2 | Quick-attach two-step card (contract select → drop/browse zone w/ drag + uploading states) missing | boom :1204-1270 | HIGH |
| CT-15 | P2 | Load errors swallowed (`.catch(() => {})`) — failure renders as "No contracts yet." empty state; OLD had a distinct error line | cadence :52, :139 vs boom :335, :1272 | HIGH |
| CT-16 | P2 | Status pills: raw `emerald/amber/red/gray-100` utilities (dark-mode risk per NEW's own convention — `UNVERIFIED — needs runtime check`) and Expired remapped red→gray | cadence :14-19 vs boom :430-435 | MED |
| CT-17 | P2 | Artist optional / "Unassigned" allowed; OLD required artist+type with disabled Create — widens the data model and every OLD panel assumed an artist join | cadence :64, :112-115, contracts.js:103-106 vs boom :277-278, :1037 | HIGH |
| CT-18 | P3 | Delete confirm downgraded (no artist/type/file-count/"cannot be undone"), no in-flight `deletingId` disable, delete not activity-logged | cadence :92-98, contracts.js:187-200 vs boom :60-85, :1389-1398 | HIGH |
| CT-19 | P3 | `n` hotkey (open new-contract form) missing; cadence `useHotkeys` exists unused here | boom :129-131 | HIGH |
| CT-20 | P3 | List sort `expiration_date ASC` → `created_at DESC` (renewal-urgency ordering lost) | boom contracts.js:144 vs cadence contracts.js:48 | HIGH |
| CT-21 | P3 | CONTRACT_TYPES drift: 'Producer' added, Distribution/Publishing reordered | cadence constants.js:56 vs boom :162 | HIGH |
| CT-22 | P3 | Loading state bare "Loading…" text vs Skeleton.PageHeader + Skeleton.Table | cadence :137 vs boom :447-453 | HIGH |
| CT-23 | P3 | SearchableSelect artist picker → native select (no type-to-search) | boom :832-840 vs cadence :112-115 | HIGH |
| CT-24 | P3 | Row hover `hover:bg-gray-50` (documented near-invisible-in-dark utility) vs OLD `hover:bg-surface-50` token | cadence :156 vs boom :1309 | MED |

**Intentional divergences:** `label_id` scoping + `withTenant` + tenant re-validation of `artist_id` (cadence contracts.js:11, :103-106); `requireApprover` replacing OLD's `requirePagePermission` per-user grants (stricter; same ruling as pending-contracts audit); R2 signed-URL file access + tenant-namespaced keys replacing `/uploads` disk paths (cadence contracts.js:92-95, :170-172); `logActivity` on create/upload; generic error bodies replacing OLD `err.message` leakage; RC-2 brand accent replacing boom red (split boxes, buttons, chips); toasts replacing `alert()`. **Additive (documented M4):** `/draft-clause` + clause box; `num_releases` form input; PATCH allow-list endpoint; per-row drag-drop upload. OLD `POST /contracts/generate` parity is charged to the Create Contract page audit (consumer `boom CreateContract.jsx:54`).

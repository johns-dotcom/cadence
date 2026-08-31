# Label Waiver

OLD: `boom-dashboard/client/src/pages/CreateLabelWaiver.jsx` (603 lines) + `boom-dashboard/server/routes/label-waivers.js` (271 lines, table `boom_label_waivers`, multipart w/ R2 attach)
NEW: `cadence/client/src/pages/CreateLabelWaiver.jsx` (254 lines) + `cadence/server/routes/label-waivers.js` (88 lines, table `label_waivers`, index.js :1373-1393, JSON only)

Design-system diffs covered by RC-1, RC-2, RC-5, RC-6 in `_audit/01-design-system.md`. Route moved `/create-label-waiver` → `/label-waivers` (boom App.jsx:203 / cadence App.jsx:154).

## 1. Layout & structure

**OLD** (:329-602): always-on 2-col `xl:grid-cols-2` page — form card ("New Label Waiver"/"Edit Waiver #id" + Cancel-edit, contextual subtitle) with Effective Date; Boom Artist (roster `<datalist>` + attach-hint) + Releasing Label; Other Label's Artist + Song Title; Release Date + Format select + Royalty %; Signatory Name + Title + Contact Email (3-col); Body textarea rows=16 w/ "· customized" badge + Reset-to-template + helper copy; error banner; full-width gray-900 submit + footer note | `LabelWaiverPreview` card (bg-gray-50 "LIVE PREVIEW" header bar, date line, heading-aware paragraphs). Below: "Saved Waivers (N)" table (:536-581) + read-only preview modal w/ Download PDF (:583-600). Skeleton on load (:320-327).

**NEW** (:139-252): list-first page — PageHeader ("Label Waivers" + "New waiver" btn-primary) → empty-state card or saved table → **modal editor** (`fixed inset-0 z-[60]`, max-w-5xl, form column | live-preview column, Cancel/Save footer, :182-230) → separate read-only preview modal w/ Printer "PDF" button (:233-251).

Structural deltas: inline builder page → list + modal editor; skeleton gone; editing no longer scrolls (modal); preview relocated inside the modal; form field order regrouped (dates paired first, artist/label/other-artist/song each full-width, contact email full-width).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page top | no PageHeader — straight into the form/preview grid | PageHeader w/ title/subtitle/action | OLD :330 / NEW :141-145 |
| Editor chassis | in-page card | overlay modal `rounded-2xl shadow-modal` (RC-6), two panes split by `border-r`, preview pane `bg-page/40` | NEW :183-228 |
| Preview header | card header bar `bg-gray-50` "Live Preview" uppercase | in-pane kicker text `text-[11px] tracking-widest` | OLD :91-94 / NEW :221 |
| Body textarea | rows 16, `text-[12px] font-mono` | rows 8, `text-xs font-mono` | OLD :500-505 / NEW :210-212 |
| Submit | full-width gray-900 w/ Loader/Pencil/Plus icons | `btn-primary` "Create waiver"/"Save changes" (RC-2) | OLD :517-524 / NEW :216 |
| Saved table | uppercase `text-xs` th on bg-gray-50; cols Effective/Boom Artist/Song/Label/Created(·by)/Actions; Eye/Download/Pencil/Trash icons | `text-[10px]` th on bg-page/50; cols Artist/Releasing label/Song/Effective + actions (FileSignature/Printer/Pencil/Trash) | OLD :540-576 / NEW :151-177 |
| Empty state | none (table hidden when empty) | card w/ FileSignature icon "No waivers yet." | NEW :147-148 |
| Labels | `text-sm font-medium text-gray-700` | `.label` uppercase 12px | throughout |
| Modal print header | — (PDF has no title line) | print HTML injects `<h1>{label} — Label Waiver</h1>` above the date | NEW :130 |

## 3. Copy & content differences

Body template (buildBodyText both sides — OLD :45-77 / NEW :19-50):
- Party naming: "Boom.Records LLC" → `label?.name` fallback "This label" — **intentional substitution**; "Co-Primary artist" → "Co-Primary Artist" (capital A).
- **Missing bullets** (NEW has 8 of OLD's 10): OLD's "• {label} shall have the right to digital exploitation (including ringtone & mastertones) of the recording with mutual written approval…" (:65) and "• {label} shall have the right to remixes of the recording with mutual approval…" (:66) do not exist in NEW.
- Accounting bullet: "detailed statements **and calculations**" → "detailed statements"; "Copies of statements shall be sent to {contact}" kept (OLD :59 / NEW :34).
- Audit bullet condensed: "Upon giving not less than four weeks prior notice and no more than once in each calendar year … inspect {label}'s books and records **of account and to copy relevant extracts to verify the accuracy of payments made to Boom.Records LLC**. Such inspection may be commenced no later than three years after the date of each statement." → "Upon not less than four weeks' notice and no more than once per calendar year, {lbl} may inspect {co}'s books and records to verify payments. Inspection may commence no later than three years after each statement." (OLD :60 / NEW :35) — copy-extracts right dropped.
- Courtesy credit: "…appears courtesy of Boom Records."" → "…appears courtesy of {lbl}."" (intentional) with a colon added after "follows".
- Name/likeness + no-synch + no-other-manner + subject-to-artist-approval + conflict clauses: lightly reworded but substantively present (OLD :62,67-70 / NEW :37,40-43).
- LABEL WAIVER REQUEST block: royalty line drops the trailing "**via LOD**" (OLD :74 / NEW :47).
- Signature: OLD always `{name}, {title}`; NEW omits the comma+title when blank (OLD :72 / NEW :45).
- Validation message: "Effective date, Boom artist, releasing label, and song title are required." → "Artist, releasing label and song are required" (effective date no longer mentioned/required).
- Delete confirm: "Delete this label waiver record? This does not revoke any already-issued copies." → "Delete this waiver?" (OLD :241 / NEW :110).
- Helper copy gone: datalist hint "Pick a name from the roster so the saved PDF attaches to the artist's Documents tab.", body helper ("Form-field changes auto-update the body until you start typing here…"), footer "Saving stores the form values; download the PDF from the list below…" (OLD :380-382,507-509,525-527).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Save-time PDF generation + artist Documents attach**: OLD builds the jsPDF client-side at save and POSTs multipart (`file` + `payload` JSON, :213-227); server resolves `boom_artist` → artists by exact case-insensitive name (:43-50), uploads to R2 `entity_files/artist/{id}/…` labeled "Label Waiver" (:56-91), replaces the file in place on update, migrates/drops it when the artist changes (:164-229), and deletes it with the row (:251-269). NEW: plain JSON CRUD; `label_waivers` has no artist_id/file_id (index.js:1373-1393); nothing reaches any Documents tab.
- **Artist roster datalist**: `/artists?limit=500` → `<datalist>` on Boom Artist (:141,152-156,371-379); NEW `artist_name` is a bare text input, no roster fetch (:195).
- **jsPDF download**: `buildWaiverPDF` (letter, helvetica, gray header date, heading-aware bold pass, pagination) + canonical filename `Boom.Records-LabelWaiver-{artist}-{song}-{date}.pdf` shared with the attach path (:252-318). NEW `printWaiver` opens a popup with serif (Georgia) HTML + `window.print()` — filename left to the print dialog, popup blockers surface a toast, and an extra `{label} — Label Waiver` h1 is injected that the OLD document never had (:115-137).
- **Skeleton + inline error banner**: gone; NEW list fetch errors swallowed (`.catch(() => {})`, :73).
- **Field requirements**: effective_date required client+server in OLD (:207, server :118-123); NEW requires only artist/label/song in both layers (:96-98, server :34-38).
- **"· customized" badge**: OLD flags a dirty body next to the label (:489); NEW shows only the conditional Reset link (:208).

### Features in NEW not in OLD
- Empty-state card; toasts; PageHeader; modal editor (incl. click-outside close — which also discards an in-progress form with no confirm); `number`-typed royalty input.

### Interaction differences
- bodyDirty model is equivalent (rebuild-until-dirty; saved body loads dirty): OLD mutates `form.custom_body` on each field change until dirty (:161-177); NEW derives `bodyText = bodyDirty ? form.custom_body : buildBodyText(form, label?.name)` (:77) — same observable behavior, and both persist the current body on save.
- OLD Reset rebuilds into the form; NEW Reset clears custom_body and falls back to the derived build (:93) — equivalent.
- OLD startEdit scrolls to top of the inline form; NEW opens the modal.
- Royalty placeholder: OLD `|| 'X'` renders "X%" when blank; NEW `?? 'X'` lets `''` through → renders a bare "%" (OLD :52 / NEW :27).

## 5. Data layer

| Concern | OLD | NEW |
|---|---|---|
| Table | `boom_label_waivers` + `artist_id`, `file_id` (entity_files FK), created_by = user *name* | `label_waivers` (label_id, created_by = user *id*, same 12 form columns, no artist/file linkage) |
| POST | multipart `upload.single('file')` (10MB, secureFileFilter) + `payload` JSON w/ JSON-only fallback; artist lookup + attach (label-waivers.js:109-157) | JSON; dynamic column INSERT from FIELDS allow-list (:32-53) |
| PUT | multipart; allow-listed columns + recomputed artist_id/file_id w/ 3-way file migration logic (:164-247) | allow-listed columns, `''→null`, label-scoped + 404 (:56-74) |
| DELETE | cleans up entity_files + R2 first (:251-269) | label-scoped delete + 404 (:77-86) |
| Auth | authMiddleware only | + withTenant + requireApprover (:9); AdminRoute + isApprover nav — **Intentional divergence** |
| Activity log | none | `logActivity('Created label waiver', …)` on POST only |
| Errors | `err.message` leaked | generic bodies — Intentional |

## 6. Tables & forms

| Control | OLD | NEW |
|---|---|---|
| boom_artist / artist_name | text + datalist(roster), required, placeholder "The Boom-signed artist featured" | bare text "Artist (yours)", no placeholder |
| Format select | single / EP / album / **mixtape** | single / EP / album (`RELEASE_FORMATS`, :8) |
| Royalty % | text, placeholder "e.g. 25" | `type=number step=0.01`, no placeholder |
| Contact email | `type=email`, default jesse@boomrecords.co | plain input, default `user?.email` (intentional) |
| Signatory defaults | Jesse Allen / COO (BOOM_DEFAULTS :11-15) | `user?.name` / '' (intentional substitution; title default lost) |
| Saved table | Effective / Boom Artist / Song / Label / Created(+by) / actions incl. Eye preview + Download | Artist / Releasing label / Song / Effective / actions (preview icon = FileSignature, print, edit, delete); Created column + created_by gone |
| Body textarea | rows 16 | rows 8 |

## 7. Defects found

- LW-1 P1 — Two granted-rights bullets missing from the waiver body: "digital exploitation (including ringtone & mastertones)… with mutual written approval" and "remixes… with mutual approval" — the issued legal document grants fewer enumerated rights than OLD's (boom CreateLabelWaiver.jsx:65-66 vs cadence CreateLabelWaiver.jsx:33-47).
- LW-2 P1 — PDF-attach pipeline gone: OLD ships the generated PDF multipart on save; server exact-matches boom_artist → artists, stores it on the artist's Documents tab via entity_files/R2 ("Label Waiver" label), replaces in place on update, migrates/deletes on artist change and row delete. NEW is JSON-only with no artist_id/file_id columns — waivers never reach the artist profile (boom :213-227, boom label-waivers.js:43-91,109-269 vs cadence :95-108, cadence label-waivers.js:32-53, index.js:1373-1393).
- LW-3 P2 — Real jsPDF download replaced by a print-popup: loses the deterministic `Boom.Records-LabelWaiver-{artist}-{song}-{date}.pdf` filename (no label-name equivalent substituted), switches helvetica→Georgia serif, requires popups, and injects a "`{label} — Label Waiver`" h1 absent from the OLD document (boom :252-318 vs cadence :115-137).
- LW-4 P2 — Artist roster `<datalist>` (+ its attach-hint helper text, `/artists?limit=500` fetch) dropped; artist name is now free text w/ no autocomplete (boom :141,152-156,367-383 vs cadence :195).
- LW-5 P2 — Page restructured from always-visible form+preview builder to list-first + modal editor; skeleton loading gone; clicking the overlay backdrop discards an in-progress waiver without confirmation (boom :320-534 vs cadence :139-230,183).
- LW-6 P3 — Legal copy condensed: "detailed statements **and calculations**"; audit clause loses "books and records **of account**" + the right "to copy relevant extracts"; request block drops "via LOD" (boom :59-60,74 vs cadence :34-35,47).
- LW-7 P3 — Release format "mixtape" option removed (boom :437-442 vs cadence :8).
- LW-8 P3 — effective_date no longer required client- or server-side (boom :207, boom label-waivers.js:118-123 vs cadence :96-98, cadence label-waivers.js:34-38).
- LW-9 P3 — Blank royalty renders "%" instead of the "X%" placeholder (`??` lets '' through vs OLD `||`); input became number-typed and lost "e.g. 25" (boom :52,446-452 vs cadence :27,200).
- LW-10 P3 — Saved table drops the Created date + created_by display; NEW stores created_by as a user id and never joins/shows it (boom :547,558, boom label-waivers.js:149 vs cadence :151-177, cadence label-waivers.js:45).
- LW-11 P3 — "· customized" dirty badge, reset-button tooltip, and both helper-copy blocks (auto-update explanation, save/download note) gone (boom :487-509,525-527 vs cadence :206-212).
- LW-12 P3 — Delete confirm softened, dropping the "does not revoke already-issued copies" caveat (boom :241 vs cadence :110).

Intentional divergences: granting party + courtesy-credit line derived from `label?.name` instead of hardcoded "Boom.Records LLC"/"Boom Records" (cadence :19-21,36); signatory/contact defaults from the logged-in user instead of Jesse Allen / COO / jesse@boomrecords.co (cadence :58-63); `boom_artist` → `artist_name` column rename; label_id scoping + withTenant + requireApprover + logActivity + generic error bodies (cadence label-waivers.js:8-9,47,51); route `/create-label-waiver` → `/label-waivers` + AdminRoute/isApprover gating (cadence App.jsx:154, Layout.jsx:271).

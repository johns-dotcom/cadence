# Artist Clearance

OLD: `boom-dashboard/client/src/pages/ArtistClearance.jsx` (643 lines: SUB_FIELDS :11-28, BLANK_TRACK :30-36, applyReleaseToTrack :42-53, page :71-560, PreviewRow :562-569, TrackTitleInput :576-643) + `boom-dashboard/server/routes/clearances.js` (454 lines: template constants :26-73, buildClearanceWorkbook :75-183, generateAndAttach :195-240, routes :242-454, renders from `server/templates/artist-clearance.xlsx`)
NEW: `cadence/client/src/pages/ArtistClearance.jsx` (155 lines) + `cadence/server/routes/clearances.js` (150 lines) + `cadence/server/lib/clearanceXlsx.js` (70 lines, exceljs from scratch — no template file)

Design-system-level diffs (Inter font, accent default, control heights, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported. OLD `focus:ring-boom-500` rings map to NEW brand rings under RC-2.

## 1. Layout & structure

**OLD** (:229-560): no PageHeader — a 3-column `xl:grid-cols-3` grid: form card spans 2 cols (title "New Artist Clearance Chart" / "Edit clearance #N" + Cancel-edit link + explainer paragraph about the XLSX auto-attaching to the artist's Documents tab :233-249) → 4 stacked 2-col field pairs (Artist*+Effective date, Project #+Title, Product commitment+Contractual members, Main artist royalty account+Artist royalty rate :252-311) → Tracks section: header w/ count + "From catalog (N)" emerald button + "Blank track" boom button (:314-337) → collapsible bulk catalog picker panel (:333-383) → per-track cards (grey header row: expand chevron, Music icon, #N, TrackTitleInput autocomplete w/ Linked badge, remove; expanded body: 11 top-row fields in 2/3-col grid + bordered "Track details (blank → TBD in the chart)" section w/ 16 SUB_FIELDS in 2-col grid :384-460) → error banner → full-width dark submit button + footnote about Documents-tab upload (:464-478). Third column = sticky "Chart preview" side panel (7 PreviewRows + numbered track list :483-521). Below the grid: "Saved clearances (N)" heading + table (:525-558).

**NEW** (:76-154): PageHeader "Clearances" / "Per-track rights & credit charts — exported to Excel" (:78) → single form card: 3-col grid of 8 header fields (:82-91) → Tracks header w/ count + "Blank track" text-link (:94-97) → "From catalog:" single-click chip row (:98-103) → per-track accordion rows (chevron, Music, "N.", inline title input, remove; open body = Credit + 12 TRACK_FIELDS in 2-col grid :104-125) → right-aligned Cancel/Save buttons (:129-132) → saved-list table card (:136-152). No side panel, no bulk picker, no explainer copy, no error banner (toasts instead), no saved-list heading.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page frame | 2/3 form + 1/3 sticky preview grid, `space-y-8` | single-column stack, PageHeader added | OLD :230-231,483 / NEW :77-79 |
| Form card | `bg-card rounded-lg border shadow-sm p-6`, `text-lg font-semibold` title | `.card p-5` (RC-6 rounder), `text-sm font-bold` title | OLD :232-236 / NEW :81-82 |
| Field labels | `text-sm font-medium text-gray-700 mb-1` sentence case | `.label` (uppercase 12px tracking-wide) | OLD :254 / NEW :84 |
| Add-track buttons | two bordered tinted pills — emerald "From catalog (N)" + boom "Blank track", 12px icons | single text link `text-brand-600 hover:underline`, 13px icon; no catalog button (chips instead) | OLD :320-336 / NEW :96 |
| Track card header | `bg-gray-50 border-b` band, `#N` bold tabular, title input transparent/borderless | plain row (no band), "N." plain, title input `.input !py-1` boxed | OLD :390-417 / NEW :106-112 |
| Track body inputs | dense `px-2 py-1 text-xs` w/ `text-[10px]` uppercase micro-labels (RC-3) | `.input !py-1.5` w/ `.label` | OLD :430-436 / NEW :115-119 |
| Sub-fields section | separated by `border-t` + "Track details (blank → TBD in the chart)" caption, `placeholder="TBD"` on every input | no separation, no caption, no TBD placeholders — sub/top fields merged into one grid | OLD :442-457 / NEW :115-119 |
| Linked-release badge | emerald `Link2` "Linked" chip on the track header | none (no linking concept) | OLD :419-424 / NEW — |
| Submit | full-width `bg-gray-900` button w/ Loader/Pencil/Plus icon + footnote | right-aligned `btn-primary` "Saving…" text only | OLD :469-477 / NEW :129-131 |
| Saved-list date | `toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})` | bare `toLocaleDateString()` | OLD :538-540 / NEW :146 |
| Saved-list actions | Edit / Download / Delete, 14px, hover `bg-gray-100` pads | FileSpreadsheet(15, hover emerald) / Pencil / Trash, no hover pad, order Download-first | OLD :542-554 / NEW :147-150 |
| Loading | `Skeleton.Block h-24 + h-64` | none — page renders empty then pops in | OLD :224 / NEW — |

## 3. Copy & content differences

- Page title: none (OLD) vs PageHeader "Clearances" + subtitle "Per-track rights & credit charts — exported to Excel" (NEW :78). Form title "New Artist Clearance Chart"/"Edit clearance #N" → "New clearance"/"Edit clearance" (OLD :234-235 / NEW :82).
- OLD explainer "Saving generates an XLSX using the canonical clearance template and attaches it to the artist's **Documents** tab automatically." (:246-249) and footnote "The generated XLSX is uploaded to the artist's **Documents** tab. Updates replace the same file." (:475-477) — both gone (the behavior itself is gone, see AC-4).
- Header field label "Main artist royalty account" → "Royalty account" (OLD :288 / NEW :91); artist placeholder "— pick an artist —" → "— select —" (OLD :258 / NEW :84).
- Sub-field labels renamed: "Clean or Explicit" → "Explicit", "Samples / AI?" → "Samples / AI", "Writers (full names)" → "Writers" (OLD :14-15,21 / NEW :9-12).
- Track title placeholder "Track title — type to search catalog…" → "Track title" (OLD :603 / NEW :110).
- "Track details (blank → TBD in the chart)" caption + `placeholder="TBD"` gone (OLD :445-452 / NEW —); NEW adds empty-tracks line "No tracks yet — add a blank track or pick from the catalog." (:126) — OLD has no equivalent (always ≥1 track).
- Delete confirm: "Delete this clearance + remove the file from the artist's Documents tab?" → "Delete this clearance?" (OLD :199 / NEW :66).
- Validation "Pick an artist" kept, but as toast instead of inline error banner (OLD :185,463 / NEW :54); NEW adds success toasts "Clearance saved/updated" (:60).
- "Saved clearances (N)" heading gone (OLD :527 / NEW —); "Actions" column header dropped (OLD :534 / NEW :140).
- XLSX in-file strings: OLD template header "Artist Name: …", "Document List", "Contractual Members: …", "Project #: …", "Title: …", "Product Committment: …" (sic), "Main Artist Royalty Account: …", "Artist Royalty Rate: …" (server :87-95); sub-labels with trailing colons "ISRC:", "Samples/AI [yes/no]:" etc. (server :37-54). NEW: banner "ARTIST CLEARANCE CHART", bare labels "Artist"/"Title"/…/"Royalty account", "Track N", "No tracks added." (clearanceXlsx.js:40-66).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Per-track top-row fields gutted**: OLD tracks carry `role, credit, docs_needed, sample_review, release_date, royalty_comments, royalty_rate, royalty_account, advance, recoupable_portion, agreement_on_file` + `release_id` FK (BLANK_TRACK :30-36, inputs :429-438). NEW keeps only `credit, royalty_rate, agreement_on_file` — `role, docs_needed, sample_review, release_date, royalty_comments, royalty_account, advance, recoupable_portion, release_id` have no input, no storage, no XLSX cell (NEW :14, clearanceXlsx.js:7-13). (AC-1)
- **SUB_FIELDS 16 → 10**: `musician_credits, recorded_by, lyrics, stems_masters, artwork, credits_approved` dropped from the form and the workbook (OLD :11-28, server :37-54 / NEW :8-13, clearanceXlsx.js:7-13). (AC-2)
- **Title autocomplete + release binding**: OLD's TrackTitleInput filters the artist catalog live as you type (8 suggestions, EXACT MATCH chip, outside-click close :576-643), picking binds `release_id` + fills title/release_date/isrc/produced_by/credit-from-featured_artists while preserving manual values (`applyReleaseToTrack` :42-53), editing the title auto-unlinks (:606-611), sibling-used releases excluded (`excludeIds` :398), Linked badge + explicit Unlink (:419-424). NEW: plain input; catalog chips create a *new* track prefilled with only `title/isrc/produced_by` (`addFromCatalog` :39) — no release_date (field gone), no featured_artists→credit, no link state, and the same release can be added repeatedly. (AC-5)
- **Bulk catalog picker**: OLD searchable multi-select panel w/ checkboxes, already-added rows disabled + "· already added", "{n} selected" + "Add N tracks" button, and replace-the-default-blank-track logic (:137-155,333-383). NEW: none. (AC-6)
- **Chart preview side panel**: sticky card mirroring 7 header values + numbered track list ("untitled" italics) (:483-521). NEW: none. (AC-7)
- **Track expansion model**: OLD `expanded` Set — multiple tracks open at once, first open by default, form always seeded with 1 blank track, removeTrack refuses to drop the last one (:81,124-127,144,66-68). NEW single-index accordion (`openTrack`), opening one closes the other, form starts with 0 tracks, no minimum (:24,36-38). (AC-8)
- **Loading/error surfaces**: OLD Skeleton blocks on load (:224) + persistent red error banner (:463-465); NEW no loading state and errors only as transient toasts (:28,61). (AC-13)
- Artists fetch: OLD `/artists?limit=500` (:94); NEW `/artists` unbounded default (:28) — roster completeness RESOLVED 2026-09-02 (Phase 10) — `/artists` is not unbounded: `artists.js:56` clamps to `Math.min(1000, Math.max(1, parseInt(limit) || 1000))`. Default AND cap are 1000, so the real (narrower) risk is silent truncation above 1000 artists (depends on NEW /artists default limit).

### Features in NEW not in OLD
- Success toasts on save/update (NEW :60).
- `PUT` accepts partial payloads (dynamic SET, NEW server :98-112) — OLD PUT always rewrote every column (server :366-381). No client-visible effect today (client sends full form).

## 5. Data layer

| Aspect | OLD (`server/routes/clearances.js`) | NEW (`server/routes/clearances.js` + `lib/clearanceXlsx.js`) |
|---|---|---|
| Table | `artist_clearances` (+`file_id`→entity_files, `created_by` = user *name*) | `clearances` (+`label_id`, `created_by` = user id; no `file_id`) |
| Header columns | …, `main_artist_royalty_account`, `artist_royalty_rate` (:317-320) | …, `royalty_account`, `royalty_rate` (:13) — renamed, "main artist" qualifier lost |
| Auth | `authMiddleware` only (:22) — any signed-in user | `authMiddleware, withTenant, requireApprover` (:10) — Approver+ only [INT] |
| GET / | joins artist + entity_files (file name), `ORDER BY created_at DESC, id DESC` (:263-272) | joins artist (label-scoped), `track_count` computed, `ORDER BY updated_at DESC` (:41-47) — rows jump to top on edit (AC-11) |
| GET /catalog | 400 without artist_id; filters `archived=false OR NULL`; `ORDER BY release_date DESC NULLS LAST, project_name ASC`; also returns `release_type, genre` (:242-259) | 200 `[]` without artist_id; **no archived filter**; no secondary sort; drops release_type/genre (:22-36) (AC-10) |
| POST/PUT side-effects | generate XLSX from template → upload to R2 `entity_files/artist/{id}/…` → insert/update `entity_files` row (label 'Artist Clearance Chart'), replacing the old R2 object in place; artist change migrates the file to the new artist (:195-240,299-311,343-364) | none — save is a plain row write (:73-113) (AC-4) |
| DELETE | deletes the entity_files row + R2 object too (:389-414) | row delete only (:116-125) |
| GET /:id/download | rebuilds workbook from saved data via the bundled template; filename `Clearance-{artist}[-{title}]-{YYYY-MM-DD}.xlsx` (:418-453,186-190) | rebuilds via exceljs-from-scratch; filename `Clearance-{artist}[-{title}].xlsx` — no date part (:128-146) |
| XLSX structure | template `server/templates/artist-clearance.xlsx` cloned: header rows 1-12 with baked prefix labels, effective date written as a real `Date` cell (row 3), 17-row track blocks from row 15, primary values across cols 1-19 per `PRIMARY_COLS` (13 cells), 16 sub-rows label col C / value col D, per-cell font/fill/border/alignment/numFmt cloned from the template block, blank sub-values → 'TBD', zero-tracks block-clear keeping scaffold labels (:26-183) | ad-hoc sheet: 4 fixed columns, hardcoded indigo `FF4F46E5` banner + `FFEEF2FF` track headers (not workspace brand — cf. RC-2), meta label/value rows (blank → 'TBD' even for header fields, unlike OLD), per-track 2-col label/value pairs of only 12 fields, Credit row skipped when blank (clearanceXlsx.js:19-67) (AC-3) |
| Tenancy | none (single tenant) | `label_id` on every query, `checkArtist` FK re-validation, `logActivity` on create [INT] |
| Errors | `err.message` leaked in 500 bodies | generic 'Internal server error' [INT] |

## 6. Tables & forms

- Header form: OLD 4×2 paired grid, Artist `required` + `*` in label (:255-257); NEW 3-col grid, no `required` attr (validation only via toast on save), field order differs (Effective date moved next to Project # row) (NEW :83-91).
- Track top-row grid: OLD `grid-cols-2 md:grid-cols-3` of 11 fields (:428-439); NEW `sm:grid-cols-2` of Credit (full-width) + 12 mixed fields (:115-120). NEW interleaves what OLD separates into "primary row" vs "track details", and `royalty_rate`/`agreement_on_file` (OLD primary-row fields) render inside the same grid as sub-fields.
- Saved table: OLD 5 cols w/ "Actions" header, track count from `(c.tracks||[]).length` (:530-537); NEW 5 cols (blank action header), count from SQL `track_count`, `bg-page/50` head band, `text-[10px]` headers (NEW :138-145).
- Download flow: OLD names the file `c.file_filename ||` a constructed slug (:210-214); NEW hardcodes `a.download = 'clearance.xlsx'` — every export saves under the same generic name, server Content-Disposition ignored (NEW :71) (AC-9).

## 7. Defects found

- **AC-1 P1** — 9 of 12 per-track top-row fields dropped: `role, docs_needed, sample_review, release_date, royalty_comments, royalty_account, advance, recoupable_portion` have no input/storage/XLSX cell, and the `release_id` catalog FK is gone (boom ArtistClearance.jsx:30-36,428-439 vs cadence ArtistClearance.jsx:14, clearanceXlsx.js:7-13).
- **AC-2 P1** — 6 of 16 SUB_FIELDS detail rows missing: Musician Credits, Recorded by, Lyrics, Stems / Masters?, Artwork?, Credits Approved? (boom :11-28, boom clearances.js:37-54 vs cadence :8-13, clearanceXlsx.js:7-13); surviving labels renamed ("Clean or Explicit"→"Explicit", "Samples / AI?"→"Samples / AI", "Writers (full names)"→"Writers").
- **AC-3 P1** — Canonical XLSX template abandoned: OLD renders into `server/templates/artist-clearance.xlsx` (header prefix strings rows 1-12, real Date cell, 17-row track blocks, 13-column primary row, col-C/col-D sub-rows, cloned styling, zero-track scaffold clear); NEW emits a from-scratch exceljs sheet with a hardcoded indigo banner, label/value meta rows (TBD even on header fields), and 12-field 2-col pairs — the exported chart is structurally a different document (boom clearances.js:26-183 vs cadence clearanceXlsx.js:19-67).
- **AC-4 P1** — Documents-tab attach pipeline gone: OLD uploads the generated XLSX to R2 + `entity_files` ('Artist Clearance Chart') on every save, replaces in place, migrates on artist change, and cleans up on delete; NEW never persists a file — clearances no longer surface on the artist profile (boom clearances.js:195-240,299-311,343-364,389-414 vs cadence clearances.js:73-125).
- **AC-5 P1** — Catalog linking degraded: TrackTitleInput type-to-search autocomplete (EXACT MATCH chip, outside-click close), release_id binding w/ Linked badge/unlink/auto-unlink-on-edit, manual-value-preserving `applyReleaseToTrack` (incl. release_date + featured_artists→credit), and sibling-release exclusion all gone; NEW chips only prefill title/isrc/produced_by into a new track and allow duplicate adds of the same release (boom :42-53,398,419-424,576-643 vs cadence :39,98-103).
- **AC-6 P2** — Bulk multi-select catalog picker (search filter, checkboxes, already-added rows disabled, "Add N tracks", replace-default-blank logic) removed (boom :137-155,333-383 vs cadence —).
- **AC-7 P2** — Sticky "Chart preview" side panel (7 PreviewRows + numbered track list) removed (boom :483-521 vs cadence —).
- **AC-8 P3** — Track UX model changed: multi-open Set expansion w/ first-open default and an enforced minimum of one track → single-open accordion starting with zero tracks (boom :66-68,81,124-127 vs cadence :24,36-38).
- **AC-9 P3** — Every download saves as literal `clearance.xlsx`: client hardcodes `a.download`, discarding both OLD's stored/constructed filename and NEW's own server Content-Disposition; server name also drops OLD's date suffix (boom :210-214, boom clearances.js:186-190 vs cadence :71, cadence clearances.js:139).
- **AC-10 P3** — `/catalog` no longer excludes archived releases, drops the `project_name ASC` tiebreak and `release_type/genre` columns, and returns 200 `[]` instead of 400 when artist_id is missing (boom clearances.js:246-254 vs cadence clearances.js:24-31).
- **AC-11 P3** — Saved list ordered by `updated_at DESC` instead of `created_at DESC, id DESC` — rows jump to the top on every edit (boom clearances.js:270 vs cadence clearances.js:45).
- **AC-12 P3** — `main_artist_royalty_account` demoted to `royalty_account` ("Main artist" qualifier lost in label, column, and XLSX row) (boom :288, boom clearances.js:94 vs cadence :91, clearanceXlsx.js:47).
- **AC-13 P3** — Skeleton loading state and persistent inline error banner gone (no loading UI at all; errors are transient toasts); artist fetch drops `?limit=500` (boom :94,224,463-465 vs cadence :27-28,61).
- **AC-14 P3** — Delete confirm and both Documents-tab helper copy blocks dropped (consequence of AC-4, but the softened confirm no longer warns about anything) (boom :199,246-249,475-477 vs cadence :66).

Intentional divergences: `label_id` scoping + `withTenant` + `requireApprover` gate (OLD allowed any authed user) + `checkArtist` in-tenant FK validation + `logActivity` + generic 500 bodies (cadence clearances.js:10,15-19,84,90); `created_by` stores user id instead of display name (cadence clearances.js:81); table rename `artist_clearances`→`clearances`; `wb.creator='Cadence'` (clearanceXlsx.js:18); PageHeader branding-neutral title.

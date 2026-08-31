# Release detail

OLD: `boom-dashboard/client/src/pages/ReleaseDetail.jsx` (863 ln, routed `/releases/:id`, boom `App.jsx:178`) + `boom-dashboard/server/routes/releases.js` (GET/PUT `/:id`, PUT `/:id/checklist`, PUT `/:id/metadata`, PUT `/:id/archive`, GET `/:id/audit`, GET `/:id/activity`, `/:id/comments` CRUD, `/:id/budget-items` CRUD).
NEW: `cadence/client/src/pages/ReleaseDetail.jsx` (269 ln) + `cadence/client/src/components/DspTracker.jsx` + `cadence/client/src/components/ReleaseExtras.jsx` + `cadence/server/routes/releases.js` (306 ln) + `cadence/server/routes/dsp.js`. NEW tree includes the uncommitted 2026-08-27 build.

Token-level diffs are covered by `_audit/01-design-system.md` (RC-1..RC-6) and not re-reported. Heavy overlap with the earlier `releases` pass exists because boom ALSO embeds a 7-tab workspace in its list page; defects already logged there are cross-referenced by REL-xx id, not re-counted.

## 1. Layout & structure

- **OLD**: breadcrumb row → header (title + pills left, big completion block right) → **two-column body** `grid gridTemplateColumns: '1fr 296px'` (`boom ReleaseDetail.jsx:365`). Left column: 4-tab strip (Checklist / Comments (N) / Budget / History, `:369-386`). Right column: permanently visible sidebar card stack — Edit/Save/Cancel controls (`:596-627`), **Details** card (`:630-688`), **Metadata** card (empty-hidden, `:691-729`), **Links** card (empty-hidden, `:732-772`), **Notes** card (General + Distributor, `:775-818`), **Actions** card (archive, `:821-836`). Each card: `rounded-2xl p-4` with `text-[10px]` uppercase tracked header.
- **NEW**: single column `max-w-4xl` (`cadence ReleaseDetail.jsx:105`) — back button (`:106-108`) → header (56px artwork thumb + title + one-line meta + Sync-artwork button, `:110-131`) → full-width completion bar (`:134-139`) → **7-tab strip** Checklist / Metadata / DSP / Budget / Activity / Comments / Details with number hints doubling as 1–7 hotkeys (`:14,:38-41,:142-153`). No sidebar; everything OLD showed at-a-glance (details, metadata, links, notes) is behind the Metadata/Details tabs, edit-only.
- OLD fetches release + comments + activity + budget in parallel on mount (`:83-88`); NEW fetches only the release (`:29-34`) — tab contents lazy-load inside `ReleaseExtras`/`DspTracker`/`ActivityTab` when mounted.
- Honest tab-architecture comparison: OLD's 4 tabs + always-on sidebar keep identity/metadata/links visible while working the checklist; NEW's 7 tabs add real capability (DSP grid, editable budget, status/owner) but demote all read-mode context to forms — there is **no read-only presentation of any metadata field anywhere** on the NEW page (`:167-201` is inputs only).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page top | `Breadcrumb` (Releases › artist › project, 11px chevrons) | `← Releases` text button | boom `:293-297` vs cad `:106-108` |
| Title row | `text-2xl font-bold` + priority pill (red-50/amber-50/gray-100 `rounded-full text-[11px]`) + type pill + Archived `rounded-full` pill | `text-xl font-bold truncate` + square `rounded` `text-[10px]` Archived tag only; no priority/type pills | boom `:303-316` vs cad `:117-119` |
| Artwork | none | 56px `rounded-lg` cover thumb (or gray placeholder) | cad `:112-114` (additive) |
| Sub-head | artist as bold `<Link>`; date turns `text-red-500 font-semibold` when ≤7d + `(Nd)/(Today)/(Nd ago)` suffix; "assigned to {name}" links to `/team` | one gray line `artist · date · owned by {name}`, no links, no urgency styling | boom `:318-346` vs cad `:121-125` |
| Completion | right-aligned `text-2xl` % (emerald at 100), `w-24 h-1` bar (emerald at 100), `text-[10px]` "N of 14 done" | full-width `h-2` bar always `bg-brand-600`, `text-xs` "d/t · p%" | boom `:349-361` vs cad `:133-139` |
| Tab strip | `text-xs` tabs, boom-red active underline, hairline `#e8e8e8` | `text-sm` tabs, brand underline, `text-[10px] text-gray-300` number hints | boom `:369-386` vs cad `:142-153` |
| Checklist group header | `text-[10px] font-bold uppercase tracking-wider` outside the card | `text-sm font-bold` inside the card | boom `:397` vs cad `:161` |
| Checklist row | card-list rows `px-4 py-3`, hairline separators, **emerald circular** 20px check (`strokeWidth 3`), done rows lose hover | flat rows `px-2 py-2 rounded-lg`, 16px **brand square** check, hover kept on done rows | boom `:400-420` vs cad `:170-178` |
| Comment row | avatar initial circle 28px + bold name + relative time (`just now/5m/2h/3d ago`, title=full) | `text-[11px]` "author · {full toLocaleString()}", no avatar | boom `:440-461` vs cad ReleaseExtras `:69-75` |
| Comment composer | text input + 36px square boom-red icon-button (Send 13) | `.input !py-1.5` + `.btn-primary !py-1.5` Send 13 | boom `:475-490` vs cad RE `:79-82` |
| Budget rows | boxed `rounded-xl` rows: description primary, category `text-[10px]` sublabel, 2-dp amounts | single line "category · description", 0-dp amounts, hover-reveal delete | boom `:515-524` vs cad RE `:47-53` |
| Budget total | separate Total row that flips `bg-red-50 border-red-200 text-red-600` when over cap, "$X / $cap" | inline "Planned $X / $cap" text turning red, no row | boom `:526-542` vs cad RE `:44` |
| Activity feed | vertical timeline: 1px spine + 14px dots colored by source (boom-red = audit, gray = activity), relative time `text-[10px]` | flat `divide-y` list, right-aligned `toLocaleDateString()` only | boom `:560-586` vs cad `:257-267` |
| Archive control | full-width amber-tinted button w/ per-state tooltip + "Working…" busy label, inside Actions card | plain `.btn-secondary` pair (Archive/Unarchive + red Delete) in Details tab | boom `:821-836` vs cad `:236-244` |
| Loading state | centered boom-red spinner `py-24` | `text-sm text-gray-400` "Loading…" line | boom `:264-268` vs cad `:92` |

## 3. Copy & content differences

- Tab labels: OLD `Checklist / Comments (N) / Budget / History` — live comment count in the label (`boom :372`) and the audit feed is called **History**; NEW `Checklist / Metadata / DSP / Budget / Activity / Comments / Details` — no count, feed renamed **Activity** (`cad :14`).
- "assigned to {name}" (boom `:339`) → "owned by {name}" (cad `:124`).
- "N of 14 done" (boom `:360`) → "13/14 · 93%" format (cad `:137`).
- Empty states: OLD "No comments yet" / "No budget items" / "No activity yet" centered `text-gray-300 py-10`; NEW "No comments yet." / "No line items yet." / "No recorded activity for this release yet." (cad RE `:54,:77`, cad `:256`).
- Archive helper: OLD tooltip copy ("Archive this release — useful for delayed or never-released projects. You can unarchive later." / "Move this release back into the active pipeline / catalog.", boom `:826`) → NEW static caption "Archiving keeps the release in the catalog but out of active pipelines." (cad `:237`).
- Checklist item labels: OLD terse ("YT Video", "S4A Pitch", "Marquee"…) vs NEW sentence-case descriptions ("YouTube video ready", "Pitched to Spotify"…) — the item SETS differ too (REL-04).
- Not-found state: OLD "Release not found" + "← Back to releases" button (boom `:270-277`); NEW same words as card + Link (cad `:93-98`). Equivalent.

## 4. Feature & interaction differences

### Present in OLD, missing in NEW
- **Catalog-aware breadcrumb**: `location.state?.from === 'catalog'` routes the "Releases" crumb to `/catalog` (boom `:44,:293-297`); NEW back button is hard-wired to `/releases` and ignores `location.state` entirely (cad `:106`) — and cadence Catalog links pass no state anyway (CAT-9).
- **Artist links**: crumb → `/artists/:artist_id`, sub-head artist → `/artists` (boom `:295,:319`); NEW artist name is plain text (cad `:122`).
- **Sidebar Edit/Save/Cancel dual-write flow**: one Edit toggles every sidebar card into inline inputs; Save fires `PUT /:id` (core) + `PUT /:id/metadata` (meta/links/notes) **in parallel** then re-fetches (boom `:216-260`); Cancel discards the draft. NEW has per-tab implicit editing with one "Save details" button (cad `:65-82,:199`) and no cancel/revert.
- **Blank-title guard**: OLD trims `project_name` to `null` so the server COALESCE keeps the current name (boom `:221-223`, boom releases.js:601); NEW `saveMeta` sends `project_name` verbatim and `PATCH` writes it verbatim (cad `:68`, cad releases.js:144-152) — a cleared field permanently blanks the release name.
- **Artist rename/reassign** from the page (find-or-create by name, boom releases.js:577-593) — REL-19.
- **Priority/type pills, date urgency styling, countdown suffix** (boom `:283-334`).
- **Big completion % + emerald 100% treatment** (boom `:349-361`).
- **Merged History timeline**: client merges `GET /:id/audit` + `GET /:id/activity`, humanizes audit rows (`Checked "yt_video"`, `Changed genre from "a" to "b"`, boom `:109-138`), colors dots by source, relative timestamps (boom `:560-586`). NEW has activity only; no audit table/route, and `PATCH /:id` writes no logs — REL-18/REL-28.
- **Comment features**: relative timestamps, avatar initials, delete gated to author-or-`hierarchy_level<=2` on the client (boom `:463-470`) and author-or-Admin on the server (boom releases.js:1167-1181) — server side is REL-17.
- **Links card** with `toSpotifyUrl()` URI→URL conversion (boom `:856-863,:751-768`) + Apple Music / Pre-save / UGC chips: NEW never renders `spotify_uri` as a clickable link anywhere (text input only, cad `:196`); the other three fields don't exist (REL-16).
- **Notes card** with separate General + Distributor notes (boom `:775-818`); NEW has one `notes` textarea (cad `:197`), `distributor_notes` gone (REL-16).
- **Cover-art status select** (Pending/In Progress/Done, boom `:663-668`) and **subgenre**, **apple_id** fields — REL-16.
- **Archive tooltip + busy state + dedicated audited endpoint** (`PUT /:id/archive` + `logActivity`, boom releases.js:902-921); NEW archives via unlogged `PATCH` (cad `:239`) — log gap is REL-18.
- **Read-only budget vs recording budget**: see §5 — OLD's Budget tab shows the release's *recording budget*; NEW shows a disconnected side table.

### Present in NEW, missing in OLD
- **DSP tab** — 9-platform submission grid (status/submitted/live/notes upserts, `DspTracker.jsx`, `dsp.js`). Additive (documented M4); color/order diffs vs boom's list-page DSP grid are REL-14.
- **Details tab**: `status` select (Draft/Scheduled/Released/Archived — OLD has no status column; nearest OLD analog is `in_catalog`/`archived`, REL-21) + admin-gated **owner** select (cad `:216-233`); OLD showed assignee read-only here and set it via PUT.
- **Sync artwork** button + cover thumbnail (cad `:55-63,:112-114,:129`).
- **Editable budget**: add/delete line items + inline cap editing from the page (`ReleaseExtras.jsx:30-59`); OLD page was display-only (its item CRUD endpoints served other pages).
- **Hotkeys**: 1–7 tab jump, Escape → back (cad `:37-41`), input-guarded (`useHotkeys.js:23`).
- **Delete release** button on the page (cad `:242`) — ungated server-side, REL-07.
- Toast feedback via ToastContext (OLD used `alert()` on failure, boom `:77,:256`).

### Behaves differently
- **Checklist toggle**: OLD optimistic flip, then `PUT /:id/checklist` sending **all 14 keys**, rollback on failure, server writes `release_audit_log` + `logActivity` per toggle (boom `:148-160`, boom releases.js:670-716). NEW `patch({[key]: !v})` — single key via generic PATCH, **not optimistic** (paints after response), no rollback needed but no in-flight guard, and nothing is logged (cad `:84,:43-52`) — REL-18/REL-23.
- **Field clearing**: OLD core PUT uses COALESCE (cannot clear core fields), metadata PUT maps `''`→NULL per sent key; NEW PATCH writes whatever arrives for any allow-listed key — clearing works everywhere but so does blanking the title (RD-2).
- **Escape**: NEW Escape (outside inputs) navigates to `/releases` with no dirty-check — unsaved Metadata-tab edits are silently discarded on one keypress; OLD had no Escape binding and its Cancel was explicit (cad `:40` vs boom `:211-214`).
- **Comment submit**: OLD `<form onSubmit>` (Enter native); NEW input `onKeyDown` Enter + button — same net effect; NEW caps thread height `max-h-64 overflow-y-auto` (RE `:67`), OLD unbounded.
- **Archive**: OLD server-side toggle (`SET archived = NOT COALESCE(archived,false)`) — race-safe; NEW client-computed `patch({ archived: !release.archived })` (cad `:239`) — two stale tabs can fight.
- **Activity matching**: OLD `detail LIKE '%release #<id>%'` limit 50; NEW `detail ILIKE '%<project_name>%'` limit 40 — rename breaks history, cross-entity false hits (REL-28).

## 5. Data layer differences

- **Endpoint consolidation**: OLD five write endpoints (`PUT /:id`, `PUT /:id/checklist`, `PUT /:id/metadata`, `PUT /:id/archive`, `PUT /:id/assign`) → NEW single `PATCH /:id` with a 27-key allow-list (cad releases.js:120-159). Consequences: no per-field audit hooks, no COALESCE safety, archive/assign lose their `logActivity` calls.
- **Audit**: OLD `release_audit_log` table + `GET /:id/audit` (boom releases.js:653-664,:698-711,:1108-1118); NEW has neither (REL-18).
- **GET /:id shape**: OLD `JOIN artists` (INNER) + `assigned_to_id`/`assigned_to_name`; NEW `LEFT JOIN` + `assignee_name` and label-scoped (cad releases.js:62-78). NEW tolerates artist-less releases (its schema allows them); consumer renames accordingly.
- **Comments**: OLD column `text`, response includes `user_id/user_name/user_role/user_department` (client uses `user_id` for delete gating); NEW column `body`, response only `id, body, created_at, author` (cad releases.js:208-221) — **no `user_id`**, so a client-side author gate is impossible even if wanted; server DELETE checks label only (REL-17).
- **Budget source divergence**: OLD `/:id/budget-items` reads/writes the release's **recording budget** — `recording_budgets WHERE release_id = :id` (cap = `total_amount_override`), items in `recording_budget_line_items` with `ensureReleaseBudget` auto-create + `section='other'` (boom releases.js:990-1105). NEW `/:id/budget` uses a standalone `release_budget_items` table + `releases.budget_cap` (cad releases.js:260-304), and cadence `recording_budgets` has **no `release_id` at all** (recording-budgets.js:56) — the Budget tab and the Recording Budgets feature are permanently disconnected stores that can never agree (RD-8). Also no item-edit route (REL-27).
- **Rename side-effects**: OLD PUT fires `relinkExpensesForRelease` (fire-and-forget) and recounts `artists.total_releases` on rename/artist change (boom releases.js:645-652); NEW PATCH does neither. Caveat: cadence's expense model has no `release_id` linkage, so the relink concept has no direct NEW equivalent — logged P3 for the record.
- **Activity feed**: id-token match limit 50 → name-ILIKE match limit 40, label-scoped (REL-28).
- Checklist columns are a different 14-key set end-to-end (REL-04) — OLD data (`yt_video`, `stem_pitch`, `s4a_pitch`, `marquee`, `budget`, `recoup_added`, `uploaded`, `content`, `dsp_email`) has no migration target for 9 of 14 keys.

## 6. Tables & forms

- **Edit form fields** — OLD sidebar edit exposes 19 fields (Title, Artist, Date, Type, Genre-select, Subgenre, Priority, Cover Art, UPC, ISRC, Apple ID, Producer, Features, Spotify, Apple Music, Pre-save, UGC, Notes, Distributor notes; boom `:634-799`). NEW Metadata tab exposes 11 (Project name, Type, Priority, Date, Genre-freetext, Producer, Featured artists, UPC, ISRC, Spotify URI, Notes; cad `:184-197`). Dropped: Artist, Subgenre, Cover Art status, Apple ID, Apple Music, Pre-save, UGC, Distributor notes (REL-16/REL-19).
- **Option vocab**: Genre `GENRE_OPTIONS` select (9 values, boom `:9`) → free text; Type `single|EP|album` → `Single|EP|Album|Compilation|Mixtape` (cad constants.js:15); Priority `standard|priority|high priority` → `High|Medium|Low` w/ `''`=Standard (REL-20) — existing OLD-vocab data matches nothing in NEW selects and silently displays as the placeholder.
- **Sidebar view tables**: OLD read-mode rows hide empty fields (`filter(row => row.value)`, boom `:680,:720`) and render metadata values `font-mono break-all` — no NEW equivalent (no read mode).
- **Budget form**: NEW adds category select (per-label categories via `CategoryOptions`) + amount + Add; `description` exists in state/POST but has **no input** (REL-24); required-amount validation client-side only (RE `:31`); server coerces bad amounts to 0 (cad releases.js:282). OLD page had no form (read-only).
- **DSP grid** (NEW-only on this page): select + two date inputs write-through per change, notes on blur-diff, optimistic w/ rollback toast (DspTracker `:26-36`).
- **Comment form**: parity except gating (above).

## 7. Defects found

Cross-referenced, already logged in `## releases`: REL-04 (checklist item set), REL-07 (ungated delete), REL-14 (DSP colors/platform), REL-15 (budget summary/categories/0-dp), REL-16 (metadata fields), REL-17 (comment-delete auth), REL-18 (no audit/no logging), REL-19 (artist immutable), REL-20 (priority vocab), REL-21 (in_catalog/status), REL-23 (non-optimistic checklist), REL-24 (dead description field), REL-27 (no item-edit route), REL-28 (activity matching), REL-29/REL-30 (progress ring / tab badge). New, page-specific:

| # | Sev | Defect | Fix location | Conf |
|---|---|---|---|---|
| RD-1 | P1 | Page architecture: 4-tab column + permanent 296px sidebar (Details/Metadata/Links/Notes/Actions cards, empty-row hiding, Edit/Save/Cancel dual-write `PUT /:id` ∥ `PUT /:id/metadata` + re-fetch) replaced by single-column 7-tab form pages — no read-mode presentation of any metadata/link/note field remains | cadence `client/src/pages/ReleaseDetail.jsx:105-247` (OLD `:365-838,:216-260`) | HIGH |
| RD-2 | P2 | Blank-title regression: OLD trimmed title→null + server COALESCE kept the name; NEW `saveMeta` sends `project_name` verbatim and PATCH writes it — a release name can be blanked to `''` | cadence `ReleaseDetail.jsx:68` + `server/routes/releases.js:144-152` (OLD `:221-223`, boom releases.js:601) | HIGH |
| RD-3 | P2 | Breadcrumb gone: catalog-aware root (`state.from==='catalog'`→`/catalog`) + artist crumb linking `/artists/:artist_id`; NEW hard-wired `← Releases`, `location.state` ignored, artist un-linked | cadence `ReleaseDetail.jsx:106-108,122` (OLD `:44,:293-297,:319`) | HIGH |
| RD-4 | P2 | Header identity pills dropped: priority pill (red/amber/gray by value), type pill, rounded-full Archived pill → lone square Archived tag; priority/type only visible inside edit selects | cadence `ReleaseDetail.jsx:117-119` (OLD `:32-36,:302-316`) | HIGH |
| RD-5 | P2 | Release-date urgency treatment gone: red+semibold ≤7d, `(Nd)`/`(Today)`/`(Nd ago)` countdown suffix → plain gray `· date` | cadence `ReleaseDetail.jsx:121-125` (OLD `:283-287,:322-334`) | HIGH |
| RD-6 | P2 | Completion block downgraded: `text-2xl` % + emerald-at-100 (number and bar) + "N of 14 done" → always-brand h-2 bar + "d/t · p%"; no 100% state change | cadence `ReleaseDetail.jsx:133-139` (OLD `:349-361`) | HIGH |
| RD-7 | P2 | History timeline UI lost: merged audit+activity feed, humanized checklist/field-change lines, source-colored dots on a timeline spine, relative timestamps → flat activity-only list w/ date-only stamps (server gaps = REL-18/REL-28; this is the residual client presentation) | cadence `ReleaseDetail.jsx:252-269` (OLD `:109-138,:560-586`) | HIGH |
| RD-8 | P2 | Budget tab reads a disconnected store: OLD showed the release's recording budget (`recording_budgets.release_id`→`recording_budget_line_items`, cap = `total_amount_override`, `ensureReleaseBudget`); NEW uses standalone `release_budget_items` + `releases.budget_cap`, and cadence `recording_budgets` has no `release_id` — the Budget tab and the Recording Budgets feature can never agree | cadence `server/routes/releases.js:260-304`, `server/routes/recording-budgets.js:56` (OLD releases.js:990-1105) | HIGH |
| RD-9 | P2 | Links card + `toSpotifyUrl()` rendering gone: `spotify_uri` never rendered as a clickable link anywhere in NEW (text input only); Apple Music / Pre-save / UGC chips had no target fields (fields = REL-16) | cadence `ReleaseDetail.jsx:196` (OLD `:732-772,:856-863`) | HIGH |
| RD-10 | P3 | Comments presentation: avatar initials, relative timestamps (`5m/2h/3d ago` w/ full-time title), bold author, author-or-hierarchy client delete gate, live "Comments (N)" tab count → `author · toLocaleString()` 11px line, delete shown to all, plain tab label; NEW comment API omits `user_id` so a client gate is impossible | cadence `components/ReleaseExtras.jsx:68-75` + `server/routes/releases.js:211` (OLD `:372,:440-470`) | HIGH |
| RD-11 | P3 | "assigned to {name}" `/team` link → plain "owned by {name}" text | cadence `ReleaseDetail.jsx:124` (OLD `:335-345`) | HIGH |
| RD-12 | P3 | Budget rows/total presentation: description-primary boxed rows w/ category sublabel + dedicated over-cap Total row flipping red bg/border → "category · description" one-liners + inline "Planned $X / $cap" red text | cadence `components/ReleaseExtras.jsx:44-53` (OLD `:503-542`) | HIGH |
| RD-13 | P3 | Archive control: per-state explanatory tooltip, amber styling, "Working…" busy state, race-safe server toggle → plain one-click client-computed PATCH, no tooltip/busy state (log gap = REL-18) | cadence `ReleaseDetail.jsx:236-244` (OLD `:70-81,:820-836`, boom releases.js:902-921) | HIGH |
| RD-14 | P3 | Notes: General + Distributor dual cards/textareas → single `notes` field (distributor_notes drop = REL-16; this logs the surviving field's collapsed UI) | cadence `ReleaseDetail.jsx:197` (OLD `:775-818`) | HIGH |
| RD-15 | P3 | Loading spinner → bare "Loading…" text line | cadence `ReleaseDetail.jsx:92` (OLD `:264-268`) | HIGH |
| RD-16 | P3 | Checklist row anatomy: 20px emerald circular check (strokeWidth 3), card-list rows w/ hairline separators, uppercase [10px] group headers outside the card, done-row hover suppression → 16px brand square, flat hover rows, sentence-case in-card headers | cadence `ReleaseDetail.jsx:157-181` (OLD `:395-421`) | HIGH |
| RD-17 | P3 | Additive-hazard: Escape hotkey navigates to `/releases` with no dirty-check — one keypress (outside an input) silently discards unsaved Metadata-tab edits; OLD had explicit Cancel only | cadence `ReleaseDetail.jsx:40` | HIGH |
| RD-18 | P3 | Rename side-effects dropped: OLD PUT fired `relinkExpensesForRelease` + recounted `artists.total_releases`; NEW PATCH does neither (caveat: cadence expenses carry no `release_id`, so relink has no direct NEW analog — parity note) | cadence `server/routes/releases.js:131-159` (OLD releases.js:645-652) | MEDIUM |

**Intentional divergences (not defects):** `label_id` scoping + `withTenant` + in-tenant re-validation of `assigned_to`/release sub-resources throughout (cadence releases.js:11,139-142,178-181, dsp.js:13-16); RC-2 brand accent replacing boom-red on checks, bars, active tab, links; role-name admin gate `['Superadmin','Admin','Approver']` for owner select + team fetch (cadence ReleaseDetail.jsx:21,35,227) per Cadence auth model; per-tenant Spotify artwork sync with `spotify.isEnabled()` graceful degrade (cadence releases.js:15-34). **Additive (documented M4, not counted):** DSP tab, Details tab status+owner, sync-artwork, cover thumbnail, 1–7 hotkeys, editable budget items, toasts.

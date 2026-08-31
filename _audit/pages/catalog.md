# Catalog

OLD: `boom-dashboard/client/src/pages/Catalog.jsx` (586 lines, incl. `CatalogCard` + `spotifyUrl` helper) + `boom-dashboard/server/routes/releases.js` (in_catalog migration/backfill :8-23, batch `POST /sync-artwork` :46-160, `GET /` list filters :440-534, `PUT /:id/catalog` :880-899, `PUT /:id/archive` :901-916)
NEW: `cadence/client/src/pages/Catalog.jsx` (128 lines) + `cadence/server/routes/releases.js` (per-release `POST /:id/sync-artwork` :13-35, `GET /` :37-60, PATCH allowlist w/ `archived` :120-128)

Design-system-level diffs (font, accent default, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported here. OLD's `focus:ring-boom-400` rings map to NEW brand rings under RC-2.

## 1. Layout & structure

**OLD** (Catalog.jsx:255-481): PageHeader — title toggles "Catalog"/"Archived Releases", live subtitle "{N} [archived ]release(s)", actions = sync-status text span + "View archived"/"Back to catalog" toggle + "Sync Artwork" button (:258-295) → two filter rows: row 1 = search (clearable) + Artist typeahead-datalist (clearable) + Genre select + Type select + conditional Clear + right-aligned "{N} releases" count (:300-360); row 2 = time area — Custom shows from/to date inputs, otherwise Year + Month bordered selects, each mode with its own Clear (:362-416) → error line → skeleton grid / distinct empty state / year-grouped timeline: per-year header (uppercase year, hairline, pluralized count) + 2/3/4/5-col card grid, then "Load More (N remaining)" or "Showing all N releases" (:419-478). Time presets live only as hotkeys 1-6 + `handlePreset` (:74-78,128-134) — no visible preset pill row; presets and Year/Month are mutually exclusive (:128-146).

**NEW** (Catalog.jsx:74-127): PageHeader — static title "Catalog", static subtitle "Your released back-catalog", single "Sync artwork" action (:76-77) → ONE filter row: search (no clear) + Genre select + Type select + 4-preset segmented pill group + Active/Archived toggle button (:79-90) → skeleton grid / single-line empty card / year groups: "{year} · {n}" heading + 2/4/6-col grid, "Load more (N)" (:92-124). No second filter row, no Year/Month selects, no custom range, no error state, no "Showing all" tail.

Structural deltas: Artist filter, row-1 Clear + live count, entire row-2 date machinery, sync status text, archived-mode header retitle, and card hover overlay are gone; NEW adds a visible preset pill group (OLD's presets were hotkey/handler-only) and moves archive action from an artwork overlay to a hover icon beside the card text.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Header actions | status text span (red on error) + 2 bordered `rounded-xl` buttons, RefreshCw spins while syncing | one `btn-secondary` w/ Sparkles icon (no spinner animation) | OLD :262-294 / NEW :77 |
| Archived toggle | amber tint when active (`bg-amber-50 border-amber-200 text-amber-700`), Archive 13px, explicit labels | dark fill when active (`bg-gray-900 text-white`), labels "Active"/"Archived" | OLD :273-284 / NEW :89 |
| Search field | 200px-min flex, pl-8, clear X button when non-empty | same min width, `.input !pl-9` (RC-5 taller), no clear button | OLD :302-316 / NEW :80-83 |
| Time controls | bordered Year/Month select wrappers, `border-boom-400` when active; Custom = two date inputs + "to" | segmented pill group `bg-gray-100 rounded-xl p-0.5`, active pill `bg-card shadow-sm` | OLD :364-415 / NEW :86-88 |
| Year header | `text-xs font-bold text-gray-400 uppercase tracking-widest` + `flex-1 h-px bg-gray-100` divider + right count "{n} release(s)" | `text-sm font-bold text-ink` "{year} · {n}", no divider, no pluralized word | OLD :445-449 / NEW :100 |
| Card grid | `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4`, sections `space-y-10` | `grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4`, sections `space-y-6` | OLD :442,450 / NEW :97,101 |
| Card chassis | one clickable card: `bg-card rounded-2xl border border-divider hover:shadow-md`, info block `p-3` inside | borderless: artwork tile `rounded-xl ring-1 ring-black/5` + bare text below (`mt-1.5`) | OLD :498-503,563 / NEW :104-110 |
| Artwork placeholder | Music2 32 on `bg-gradient-to-br from-gray-100 to-gray-200` | Music 28 on flat `bg-gray-100` | OLD :505,515 / NEW :107 |
| Type badge | per-type tints: single `bg-blue-100 text-blue-700`, EP purple, album emerald; capitalized; `text-[10px] font-bold rounded-full px-2` top-2 left-2 | uniform `bg-black/60 text-white uppercase text-[9px] rounded px-1.5` top-1.5 left-1.5 | OLD :47-51,517-521 / NEW :108 |
| Hover affordance | full `bg-black/40` overlay w/ 2-3 white/20 round icon buttons (Spotify/Apple/move-back) | single `opacity-0 group-hover:opacity-100` gray icon right of text | OLD :523-559 / NEW :116 |
| Card text | title `text-xs font-semibold text-gray-900` + artist `text-xs text-gray-500` on own line + date/genre `text-[10px]` row + `border-t border-gray-50` mono UPC/ISRC block | title `text-sm font-medium` + "artist · date" `text-[11px] text-gray-400` + single mono id `text-[10px] text-gray-300` (≈1.5:1 contrast, cf. RC-3 note) | OLD :563-581 / NEW :112-114 |
| Skeleton | 10 × `Block h-64 rounded-2xl` in the 5-col grid | 12 × `Block h-44` in the 6-col grid | OLD :422-427 / NEW :92-93 |
| Empty state | open-centered `py-24`, Disc3 40, bold line + gray sub-line | `card p-10`, Disc3 28, single `text-sm` line | OLD :428-439 / NEW :94-95 |
| Load more | bordered button "Load More (N remaining)", then "Showing all N releases" footer | `btn-secondary` "Load more (N)", no footer | OLD :465-477 / NEW :123 |

## 3. Copy & content differences

- Title/subtitle: "Catalog"/"Archived Releases" + live "{N} [archived ]release{s}" → always "Catalog" + static "Your released back-catalog" (OLD :259-260 / NEW :76).
- Archived toggle: "View archived" / "Back to catalog" (+ tooltips "View archived releases (delayed or never-released)" / "Return to the catalog view") → "Active" / "Archived", no tooltips (OLD :275-283 / NEW :89).
- Sync button: "Sync Artwork" / "Syncing…" + tooltip "Fetch cover art from Spotify for all catalog releases" → "Sync artwork" / "Syncing…", no tooltip (OLD :289-292 / NEW :77).
- Sync feedback strings gone: "✓ {n} artworks synced · {m} remaining", "{m} releases without artwork (no Spotify match found)", "All artwork up to date", error passthrough (OLD :264-270) → toasts "Synced artwork for {ok} of {n}", "All shown releases already have artwork" (NEW :68,71).
- Search placeholder: "Search artist, title, UPC, ISRC…" → "Search title, artist, UPC, ISRC…" (OLD :306 / NEW :82).
- Select zero-options: "All Artists" / "All Genres" / "All Types" (Types capitalized: Single/EP/Album) → "All genres" / "All types" (raw stored casing) (OLD :325,343,349 / NEW :84-85).
- Preset labels: All Time / This Year / 6 Mo / 12 Mo / 2 Yrs / Custom (OLD :38-45) → All time / Last 12 mo / Last 24 mo / This year (NEW :10-15) — order also differs, so surviving hotkey muscle-memory 1-6 would misfire even if hotkeys existed.
- Empty states: catalog "No releases in the catalog yet" + 'Mark releases as "Released" from the Release Tracker to add them here.'; archived "No archived releases" + "Archive delayed or never-released projects from the Release Tracker or their detail page." (OLD :431-438) → "No released catalog matches. Releases appear here once their date has passed." / "Nothing archived." (NEW :95).
- Year bucket for undated rows: "Unknown" → "Undated" (OLD :244 / NEW :16).
- Card ids: "UPC {upc}" and "ISRC {isrc}" labeled lines → single unlabeled `{upc || isrc}` (OLD :578-579 / NEW :114).
- Confirm: "Move this release back to the tracker?" → no equivalent (OLD :186); failure alerts "Failed to update release"/"Failed to unarchive release" → toast "Failed" (OLD :192,205 / NEW :64).
- Error state "Failed to load catalog" → none (OLD :121,420 / NEW :31).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Explicit catalog membership + "Move back to tracker"**: OLD catalog = `in_catalog=true` rows (flag set by Mark-as-Released, plus a startup backfill moving past-dated unarchived releases in and future-dated ones out, OLD server :8-23); the card overlay's RotateCcw action (window.confirm → `PUT /:id/catalog` → optimistic removal, spinner via `movingId`, OLD :185-196,549-558; server :880-899 w/ logActivity). NEW infers membership purely from `release_date <= now` client-side (`isReleased`, NEW :17,48) — no flag, no toggle endpoint, no way to pull a release back to the pipeline from this page, and a release auto-appears at date-pass even if never actually released. Date compare is `new Date(release_date) <= new Date()` in browser TZ vs OLD's SQL `CURRENT_DATE` — same-day releases may flip at a different moment (`UNVERIFIED — needs runtime check`).
- **Archived view scope**: OLD `archived=true&in_catalog=any` pulls archived releases across catalog AND pipeline (OLD :88-92, server :452-461) — matching its copy about "delayed or never-released" projects. NEW's archived view still requires `isReleased(r)` first (NEW :47-49), so an archived release whose date is future/absent (the delayed/never-released case) is invisible in BOTH views.
- **Batch artwork sync**: OLD = server batch `POST /releases/sync-artwork` (phase 1: URI'd rows LIMIT 500 via `getArtworkUrl`; phase 2: strict artist+title search LIMIT 200; permanent-miss sentinel `cover_art_url='not_found'` so the loop terminates; transient errors left NULL for retry; 50/100ms pacing; returns `{updated, remaining, total, searched, search_found}`; `retry`/`force`/`days` params — OLD server :46-160) driven by a client loop of ≤30 batches with a no-progress guard, 500ms gaps, cumulative status text, refetch on success, auto-clear 8s success / 6s error (OLD :156-183). NEW = per-release `POST /releases/:id/sync-artwork` (NEW server :13-35) looped client-side over the first **40** currently-*shown* rows missing art (NEW :66-72): only the filtered subset is swept, no continuation past 40, no `not_found` sentinel (permanent misses re-attempted and 404 every run), no remaining count, no retry/force modes, no pacing.
- **Artist filter**: typeahead input + `<datalist>` built by case-insensitive dedup keeping the most common spelling, substring match, clear X (OLD :215-224,226-227,318-338) — absent in NEW.
- **Time filtering depth**: OLD 6 presets incl. "6 Mo" and "Custom" from/to date inputs (:38-45,96-117,364-385), plus Year (current−10) + Month selects with auto-set-current-year when month chosen alone (:141-146), preset↔year-month mutual exclusivity (:128-146) and per-mode Clear (:148-154,380-384,409-413). NEW: 4 client-side presets only (:10-15,37-43); no 6-month window, no custom range, no year/month drill, no Clear.
- **Hotkeys**: `s` → sync, `1`-`6` → presets via `useHotkeys` (OLD :74-78). NEW registers none (hook exists in cadence but is not imported here).
- **Card hover overlay links**: Spotify (URI→URL conversion via `spotifyUrl`, OLD :10-18,525-535) and Apple Music (:537-547) external links, `stopPropagation`, white/20 round buttons — absent; NEW card exposes no external links.
- **Row-1 Clear + live count**: conditional Clear resetting search/artist/genre/type (OLD :352-357) and right-aligned "{N} releases" (:359) — absent.
- **Deep-link state**: OLD navigates with `state: { from: 'catalog' }` (:493-495) which ReleaseDetail uses for its back-to-catalog affordance (`boom ReleaseDetail.jsx:44`); NEW plain `<Link>` (:104), and only the artwork is clickable — the title/artist text is dead space.
- **`not_found` sentinel handling**: OLD hides art when `cover_art_url === 'not_found'` and `onError`-hides broken imgs (:506-512); NEW renders any truthy value as `<img>` with no error handler (:105-106) — a migrated `not_found` row shows a broken image.
- **Per-card busy state**: OLD disables + spins the acting card's button via `movingId` (:551-557); NEW archive button has no in-flight state (:116).

### Features in NEW not in OLD
- Visible preset pill group (OLD's presets were hotkey/handler-only with no on-screen control — NEW :86-88 is arguably a UI improvement, retained options aside).
- Genre/Type options derived live from data (`useMemo` de-dup, NEW :34-35) instead of OLD's hardcoded lists — but the derivation scans ALL releases incl. unreleased/archived, so phantom options appear.
- Toast feedback (`useToast`) replacing `alert()`.

### Interaction & behavior differences
- Filtering is fully client-side in NEW (one unfiltered `GET /releases`, NEW :31); OLD sent genre/release_type/date_from/date_to/month/in_catalog/archived to the server per change (OLD :85-126) and re-fetched on each. OLD's genre match was case-insensitive SQL (`LOWER(r.genre)=LOWER($n)`, OLD server :500-503); NEW's is case-sensitive strict equality (:51).
- Pagination reset: OLD resets `visibleCount` to 60 on every server-filter change AND on search/artist change (OLD :80-83,212); NEW never resets `limit`, so after Load More a new search keeps the inflated window.
- Archive toggle: OLD confirm-gated move-back (catalog mode) / one-click unarchive (archived mode) via dedicated PUT toggles with `logActivity` (server :893,914); NEW one-click `PATCH {archived: !r.archived}` both ways — no confirm, and NEW's PATCH logs no activity (cadence releases.js:131-160; already REL-18).
- Year sort: numeric `b - a` (OLD :249) vs `String localeCompare` desc (NEW :61) — equivalent for 4-digit years; 'Undated' sorts after digits in NEW, OLD's 'Unknown' order under numeric-minus is NaN-dependent (`UNVERIFIED — needs runtime check`).
- Load error: OLD sets an error banner (:121,420); NEW swallows it (`.catch(() => {})`, :31) and shows the empty-state copy — a down API reads as an empty catalog.

## 5. Data layer

| Concern | OLD | NEW |
|---|---|---|
| List fetch | `GET /releases` with `in_catalog=true` (or `archived=true&in_catalog=any`), `genre`, `release_type`, `date_from/date_to` or `month=YYYY[-MM]` (OLD :90-119; server :440-534) | bare `GET /releases` — server supports only `status`/`q` (NEW :31; server :37-60); everything filtered client-side |
| Catalog membership | `releases.in_catalog` boolean + startup backfill by date (server :8-23) | none — computed `release_date <= now` in client (:17) |
| Move to/from catalog | `PUT /releases/:id/catalog` NOT-toggle + logActivity (server :880-899) | endpoint absent |
| Archive | `PUT /releases/:id/archive` NOT-toggle + logActivity (server :901-916) | `PATCH /releases/:id {archived}` via UPDATABLE allowlist (server :127), no activity log |
| Artwork sync | batch `POST /sync-artwork` — 2 phases, `not_found` sentinel, `remaining` count, `retry/force/days`, pacing (server :46-160) | per-id `POST /:id/sync-artwork` — single lookup via `spotify.coverArt`, 404 on miss, no sentinel/remaining (server :13-35) |
| Sort | `release_date DESC` (or ASC for upcoming) (server :525-527) | `release_date DESC NULLS LAST, created_at DESC` (server :51) |
| Tenancy | none (single-tenant) | `label_id` scoping + `withTenant` on every query (server :11,20-23,42-53) — **Intentional divergence** |
| Spotify config | requires env keys, errors surface | `spotify.isEnabled()` graceful 400 (server :17) — Intentional pattern |

## 6. Tables & forms

No tables on either side. Forms = filter controls only:

| Control | OLD | NEW |
|---|---|---|
| Search input | clearable, pl-8, ring-boom-400 | not clearable, `.input` |
| Artist | text input + datalist, clearable | — |
| Genre select | fixed 10-option list (`GENRE_OPTIONS`, OLD :20) incl. duplicate spellings ('Hip Hop/Rap', 'Hip-Hop/Rap') | data-derived distinct values (NEW :34,84) |
| Type select | fixed `single/EP/album`, capitalized labels, lowercase values matched case-insensitively server-side (OLD :21,349) | data-derived raw values, strict match (NEW :35,85) |
| Year select | current year − 10, bordered wrapper highlights when set (OLD :251-253,389-397) | — |
| Month select | 12 named months, auto-sets year (OLD :23-36,399-407,141-146) | — |
| Custom range | two `type=date` inputs + "to" (OLD :367-379) | — |
| Date presets | hotkeys 1-6 only | 4 visible pills |

## 7. Defects found

- CAT-1 P1 — Catalog membership model replaced: `in_catalog` flag + backfill + `PUT /:id/catalog` → client-side date inference; "Move back to tracker" confirm action gone; unreleased-but-dated projects auto-enter the catalog (cadence Catalog.jsx:17,48-49,64 vs boom Catalog.jsx:88-92,185-196,549-558; boom releases.js:8-23,880-899). Companion of REL-21.
- CAT-2 P1 — Archived view requires `isReleased` first, so archived delayed/never-released (future- or un-dated) releases are invisible in both views; OLD pulled `archived=true&in_catalog=any` across catalog+pipeline (cadence Catalog.jsx:47-49 vs boom Catalog.jsx:88-92, boom releases.js:452-461).
- CAT-3 P1 — Batch artwork sync gutted: 2-phase server batch (URI 500 + strict search 200, `not_found` sentinel, remaining count, retry/force/days, 50/100ms pacing) + client ≤30-batch loop w/ no-progress guard + 500ms gaps + status text (8s/6s auto-clear) → client loop over first 40 currently-filtered missing rows against a per-id endpoint; permanent misses retried forever, unfiltered/beyond-40 rows never swept, no remaining/status detail (cadence Catalog.jsx:66-72, cadence releases.js:13-35 vs boom Catalog.jsx:156-183,262-272, boom releases.js:46-160).
- CAT-4 P1 — Artist filter missing: typeahead + datalist w/ case-insensitive dedup keeping most-common spelling + clear X + substring match (boom Catalog.jsx:215-224,318-338; absent in cadence).
- CAT-5 P1 — Time filtering: 6 presets → 4 (no "6 Mo", no "Custom" from/to range); Year+Month selects w/ auto-set-current-year + preset mutual-exclusivity + Clear gone; preset order/labels changed (boom Catalog.jsx:38-45,96-154,362-416 vs cadence Catalog.jsx:10-15,37-43,86-88).
- CAT-6 P2 — Hotkeys `s` (sync) + `1`-`6` (presets) missing; NEW imports no useHotkeys though the hook exists (boom Catalog.jsx:74-78).
- CAT-7 P2 — Hover overlay external links gone: Spotify (URI→URL via `spotifyUrl`) + Apple Music on black/40 overlay (boom Catalog.jsx:10-18,523-548; cadence card :103-117 has none).
- CAT-8 P2 — Type badge tints lost: single blue-100/700, EP purple, album emerald, capitalized rounded-full [10px] → uniform black/60 white uppercase [9px] (boom Catalog.jsx:47-51,517-521 vs cadence :108).
- CAT-9 P2 — Card: whole-card click w/ `state {from:'catalog'}` (feeds ReleaseDetail back-link, boom ReleaseDetail.jsx:44) → artwork-only Link, no state; genre dropped from card; labeled mono "UPC …"+"ISRC …" lines → single unlabeled id at text-gray-300; no `cover_art_url==='not_found'` guard and no img onError hide (boom Catalog.jsx:493-495,506-512,563-581 vs cadence :104-114).
- CAT-10 P2 — Archive/move actions lose confirm + busy state: OLD confirm on move-back, `movingId` disable/spin, dedicated PUT toggles w/ logActivity → one-click PATCH both directions, no confirm, no in-flight state, no activity log (boom Catalog.jsx:185-209,549-558, boom releases.js:893,914 vs cadence Catalog.jsx:64,116; log gap overlaps REL-18).
- CAT-11 P2 — Load failure swallowed: `.catch(() => {})` renders the empty-state copy; OLD showed "Failed to load catalog" (cadence Catalog.jsx:31 vs boom :121,420).
- CAT-12 P2 — Header feedback stripped: live "{N} [archived ]release(s)" subtitle, archived-mode retitle, sync-status text variants (synced/remaining/no-match/up-to-date, auto-clear), row-1 "{N} releases" counter and Clear button all gone (boom Catalog.jsx:258-295,352-359 vs cadence :76-77).
- CAT-13 P2 — Genre/Type option sets + matching: fixed `GENRE_OPTIONS`(10)/`TYPE_OPTIONS`(3, capitalized) w/ case-insensitive server match → data-derived options (scanning unreleased+archived rows too) w/ case-sensitive strict equality; "All Genres/Types" → "All genres/types" (boom Catalog.jsx:20-21,341-350, boom releases.js:500-511 vs cadence :34-35,51-52,84-85).
- CAT-14 P3 — Search: clear X button missing; placeholder word order changed (boom Catalog.jsx:306,311-315 vs cadence :82).
- CAT-15 P3 — Pagination: "Load More (N remaining)" → "Load more (N)"; "Showing all N releases" footer gone; limit not reset on filter/search change (boom Catalog.jsx:80-83,212,465-477 vs cadence :29,123).
- CAT-16 P3 — Timeline/grid chrome: year header (uppercase tracking-widest + hairline + pluralized count) → "YYYY · N"; grid 2/3/4/5 → 2/4/6; `space-y-10` → `-6`; skeleton 10×h-64 → 12×h-44; placeholder Music2 32/gradient → Music 28/flat; "Unknown" → "Undated" bucket (boom Catalog.jsx:243-249,422-450,505-515 vs cadence :16,58-62,92-107).
- CAT-17 P3 — Empty states reduced: distinct two-line centered `py-24` copy per mode → single-line boxed card; catalog copy rewritten to describe the new auto-date model (consequence of CAT-1) (boom Catalog.jsx:428-439 vs cadence :94-95).

Intentional divergences: `label_id` scoping + `withTenant` on all NEW queries (cadence releases.js:11,20-23); `spotify.isEnabled()` graceful degrade (cadence releases.js:17); RC-2 brand accent/focus rings replacing `boom-400` rings throughout the filter row.

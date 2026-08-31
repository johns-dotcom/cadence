# Artists roster

OLD: `boom-dashboard/client/src/pages/Artists.jsx` (1,131 lines) + `boom-dashboard/server/routes/artists.js` (1,352 lines)
NEW: `cadence/client/src/pages/Artists.jsx` (95 lines) + `cadence/server/routes/artists.js` (306 lines)

Design-system-level diffs (font, accent default, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported here.

**Scale of the gap up front:** NEW's roster page is a 95-line minimal grid. OLD's is a 1,131-line workstation (export, bulk Spotify sync, stat cards, 4-part filter toolbar, sort, debounced server search, archived section with restore). Roughly 85% of the OLD page's surface has no NEW equivalent. One OLD block is dead code and NOT counted against NEW: the inline 5-tab artist panel (OLD :519-741, tabs Releases/Contracts/Deals/Links/Files + `LinksTab` CRUD :70-221) is unreachable — `setSelectedArtist` is only ever called with `null` (OLD :309, :531); card clicks navigate to `/artists/:id` instead (OLD :419-421, :1080). Both apps route detail to the profile page, so tab-level parity belongs to the `artist-profile` pass.

## 1. Layout & structure

**OLD** (Artists.jsx:754-1065): PageHeader (title "Roster" + live filtered-count subtitle + actions: Export popover / Spotify-sync icon button + status text / 264px debounced search box with inline spinner) → 4 stat cards (`grid-cols-2 md:grid-cols-4`, :881-918) → filter toolbar (genre dropdown w/ embedded search + counts :923-974; segmented All/Has Releases/No Releases :977-991; Active-only toggle :996-1008; sort select :1013-1026) → artist card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`, :1035) → collapsible "Archived" section (border-top header + count, own grid, :1044-1063). Full-page spinner pre-data (:743-752).

**NEW** (Artists.jsx:39-95): PageHeader (title "Roster" + static subtitle + one "Add artist" button, :41-49) → optional inline add-artist form card (:51-63) → card grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, :73) or empty-state card (:68-71). Nothing else — no stats, no toolbar, no search, no archived section, no export, no sync.

Structural deltas: entire stats row, filter toolbar, export popover, sync control, search box, and archived section absent in NEW. NEW adds a create-artist form OLD's roster never had (OLD's `POST /artists` existed but had no UI on this page).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Header subtitle | live: "N artists · {genre} · {release filter} · Active only" | static "Your label's artists" | OLD :759 / NEW :43 |
| Header actions | Export chip-button + sync icon + syncMsg + search input | single `.btn-primary` Add artist (RC-5 height) | OLD :760-877 / NEW :44-48 |
| Card grid breakpoints | `md:grid-cols-2 lg:grid-cols-3`, gap-3 | `sm:grid-cols-2 lg:grid-cols-3`, gap-4 — 2-up starts at 640px not 768px | OLD :1035 / NEW :73 |
| Card container | `<button>` `border-gray-100 rounded-xl px-4 py-3.5 pr-12 hover:border-gray-300 hover:shadow-md hover:-translate-y-0.5` | `<Link>` `.card` (RC-6 rounded-2xl) `p-4 hover:border-brand-300`, no shadow/lift | OLD :1078-1083 / NEW :75 |
| Avatar | `w-11 h-11` + `ring-1 ring-gray-200/60` hover-darkening; fallback = 2-letter initials (`artistInitials`, first letters of first two words) | `w-10 h-10`, no ring; fallback = single `charAt(0)` on `bg-brand-100` | OLD :1086-1093, :223-225 / NEW :76-81 |
| Genre display | colored chip via 36-entry `GENRE_COLORS` map + partial-match fallback (`text-[10px] font-semibold px-1.5 rounded-full`) | plain `text-xs text-gray-400` prefix text, no chip, no color coding | OLD :10-45, :1101-1105 / NEW :85-87 |
| Release count | separate `text-[11px] tabular-nums` element (RC-3) | inline in same gray text line | OLD :1106-1108 / NEW :86 |
| Nav affordance | `ChevronRight` size 14, slides right on hover | none | OLD :1111 / NEW — |
| Archive affordance | hover-revealed Archive icon top-right; archived cards `opacity-60` + always-visible "Restore" | none | OLD :1117-1128 / NEW — |
| Loading state | centered spinner + "Loading artists..." (+ inline spinner in search box while refetching) | `text-sm text-gray-400` "Loading…" line | OLD :743-752, :871-875 / NEW :65-66 |
| Empty state | "No artists found" centered text (filtered-aware) | icon card: Disc3 28 + "No artists yet." | OLD :1032-1033 / NEW :67-71 |
| Error state | red centered "Failed to load artists" | none — errors swallowed | OLD :1029, :297-299 / NEW :19 |

## 3. Copy & content differences

- Subtitle: OLD composes the live count with active filters (:759); NEW "Your label's artists" (:43).
- Empty state: OLD "No artists found" (means "your filters/search matched nothing"); NEW "No artists yet." (only-state, since there are no filters).
- OLD tooltips carry behavior documentation: Export "Export roster to Excel (alphabetical by name)" (:764), sync "Sync profile images from Spotify" (:856), Active-only long-form explanation (:998-1000), archive/restore explanations (:1125). NEW has no tooltips.
- Sync feedback: OLD "Updated {n}/{total}" transient status text (:408); NEW n/a.
- NEW-only copy: form labels Name/Genre, "Optional" placeholder, toasts "Artist added" / server error passthrough (:29-33).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW

1. **Export dropdown (whole feature)** — OLD :761-852: popover with a 3×2 release-window grid (All time / 1 mo=30d / 3 mo=90d / 6 mo=180d / 12 mo=365d / 24 mo=730d, :781-801), genre multi-select checkbox list with "All genres"/"Select all" (:805-828), a summary-composing download button ("Download 3 genres · past 12 mo", :829-849), XLSX blob download with computed filename `roster-{genres|all}{-lastNd}-{date}.xlsx` (:382-392). Server `GET /artists/export` (OLD server :86-177) builds an ExcelJS workbook (Artist/Genre/Total Releases/**Last Release Date**/Date Added columns, boom-red header row `FFE52017`) — `last_release_date` computed per row regardless of window "so the bookkeeper sees WHY each row qualified" (:117-124). NEW: no client control, no endpoint.
2. **Spotify image sync (bulk)** — OLD header RefreshCw button + transient result message (:853-861, :402-417); server `POST /artists/sync-images` (OLD server :977-1082) loops all artists, prefers the stored `artist_links` Spotify URL for a direct ID lookup before falling back to name search (:1013-1035), and spaces calls 100ms apart to respect Spotify rate limits (:1073-1074). NEW has only per-artist `POST /:id/sync-spotify` (NEW server :15-37) — no roster-wide sync, no link-based direct lookup (no `artist_links` table), no pacing concern.
3. **Search** — OLD 300ms-debounced header search hitting server `?search=` ILIKE (client :271-279, :862-876; server :34-37). NEW: no search UI, and the list endpoint accepts no search param (NEW server :50-68).
4. **Stat cards** — Total Artists / Genres / Total Releases / Active Roster (OLD :881-918, derived :447-456). Active Roster depends on the server-stamped `has_recent_release` flag. NEW: none.
5. **Filter toolbar** — all four controls gone: genre dropdown with its own autofocused search input, per-genre counts, and check-marked active row (OLD :923-974, counts :438-445); segmented All/Has Releases/No Releases (:977-991, :467-471); Active-only toggle (release in past 365d OR any upcoming — server EXISTS subquery, :996-1008, :473-475, server :52-59); sort dropdown with 4 options defaulting `name-asc` (:1013-1026, :477-483). NEW renders the server's name-ASC order only.
6. **Archived section** — OLD renders archived artists in a collapsible section (default-expanded, auto-expands on archive so the card visibly moves, :321-346, :1044-1063) with per-card Restore; archive is a hover action on every active card with optimistic move + alert-and-refetch rollback (:321-342, :1117-1128). NEW server *supports* `?include_archived=1` (NEW server :52) but **no client anywhere passes it** (grep verified) — archived artists simply vanish from the roster; un-archiving is only reachable by finding the artist through global search (`server/routes/search.js:31-33` doesn't exclude archived) and using the profile-header toggle (`ArtistProfile.jsx:84,197`).
7. **Roster-page delete** — OLD exposes Superadmin-only delete in the (dead) panel with a guard-explaining confirm (:305-314, :552-560); NEW roster has no delete (profile page has it, `ArtistProfile.jsx:120`). Endpoint regression covered in §5/AR-1.

### Features in NEW not in OLD

- **Inline add-artist form** on the roster (NEW :23-37, :51-63): name+genre, toast feedback, server duplicate-name 400 surfaced. OLD's roster had no create UI at all. Improvement, not a defect.
- **Toast context** for feedback (NEW :9) vs OLD's `alert()`s.

### Interaction/UX differences

- Card click: both navigate to `/artists/:id`; OLD via `<button>`+navigate (:1078-1080), NEW via `<Link>` (:75) — NEW gets native middle-click/cmd-click for free (minor improvement).
- OLD keeps the previous list on screen while refetching (inline search spinner); NEW flips the whole page to "Loading…" on every `load()` (:17-20).
- NEW fetch errors are silently discarded (`.catch(() => {})`, :19) — a failed load renders the "No artists yet." empty state, indistinguishable from a genuinely empty roster.

## 5. Data layer differences

| Endpoint | OLD (`server/routes/artists.js`) | NEW (`server/routes/artists.js`) |
|---|---|---|
| `GET /` | `?search,page,limit(50)` → `{data, total}`; rows = `a.*` (incl. stored `total_releases`) + derived `has_recent_release` (:26-77) | no params but `include_archived=1`; → `{data}` (no total); rows = 6 columns + `COUNT(releases)` computed `total_releases`; archived excluded by default (:50-68) |
| `GET /export` | XLSX export w/ `genres` + `since_days` (:86-177) | **absent** |
| `GET /duplicates` | normalize + length-scaled Levenshtein (1/2/3) + union-find groups, incl. `contract_count` for canonical pick (:183-262) | absent here — equivalent lives in `flags.js:79-96` (fixed threshold ≤2, no contract_count); parity owned by the flags-data-quality pass |
| `PATCH /:id/name` | admin-gated rename that **cascades** `expenses.artist`, `deals.artist_name`, `artist_income.artist_name` and 409s on collision with another artist ("use merge instead") (:268-336) | **absent** — NEW renames via generic `PATCH /:id` (:138-158): no cascade, no collision redirect (only the unique-index 23505). Renaming detaches the artist's ledger spend — NEW's own `GET /:id` spend query matches `LOWER(artist) = LOWER($name)` (:96-102), so the Spends tab zeroes out after any rename |
| `POST /merge` | admin-gated; reassigns releases/contracts/artist_links/artist_budget_items/artist_income + recording_budgets, deletes source `entity_files`, cascades `expenses.artist`/`deals.artist_name`/`artist_income.artist_name` strings, recounts `total_releases` (:339-411) | moved to `POST /flags/merge-artists` (`flags.js:244-270`): covers releases/contracts/artist_income/campaigns/artist_dev_log/expenses but **not `deals.artist_name`** (column exists, `index.js:423`), **not `entity_files`** (orphan rows leak), **not `recording_budgets.artist_id`** (`index.js:449` FK SET-NULLs on source delete → budgets silently detach) |
| `GET /:id` | artist + releases (w/ `assigned_to_name`), contracts (**role-gated**: admin/superadmin/approver only, :437-441), deals (by name), links, files, budget, income, expenses + totals (:424-532) | artist + releases (no assignee name), contracts (**no role gate** — royalty_split/advance visible to every member, :87-92,:109), spendByCategory/spendTotal/budgetTotal (:71-114). No deals/links/income. Leaf-only spend query avoids split double-count (:93-103) — improvement |
| `POST /:id/links`, `PUT/DELETE …/:linkId` | `artist_links` CRUD: arbitrary platform (14 presets), multiple links per platform, optional label (:534-583; table :413-421) | **absent** — replaced by fixed single-URL profile columns (`PROFILE_FIELDS`, NEW :42-47). Multi-links, labels, Linktree/DistroKid/Tidal/etc. unrepresentable |
| `PATCH /:id/archive` | dedicated endpoint stamping `archived_at`/`archived_by` (:897-926) | folded into `PATCH /:id` boolean only — no stamps (`archived` in PROFILE_FIELDS :46; schema has no archived_at/by, `index.js:416`) |
| `DELETE /:id` | **Superadmin-only** (:929-933); 409 if the artist has releases (:938-948); transaction deletes `entity_files` + dynamic FK sweep (:950-967) | any authenticated member (router gate is auth+tenant only, :11, :220-232); no release guard — `releases.artist_id` is `ON DELETE SET NULL` (`index.js:380`) so catalog rows silently orphan; `entity_files` rows + R2 objects never cleaned |
| `POST /sync-images` | bulk, link-first lookup, 100ms pacing (:977-1082) | absent (per-artist `POST /:id/sync-spotify` only, :15-37) |
| `GET /:id/spotify` | full Spotify profile builder (:1123-1222) | absent from this route (`lib/spotify.js` powers the profile page — parity owned by artist-profile pass) |
| devlog | `GET/POST/DELETE /:id/devlog`; POST validates `entry_type` whitelist (:1287-1289); DELETE author-or-admin gate (:1327-1350) | renamed `/:id/log` (table `artist_dev_log`, `note` not `summary`); POST accepts any `entry_type` string (:195); DELETE has **no authorization check** — any member deletes anyone's entry (:205-217) |
| files | multer 10MB + `secureFileFilter` (:19-23); metadata incl. `file_size`, `uploaded_by_name`, `label` (:610-629) | multer 25MB, **no fileFilter** (:39); metadata only `id, original_name, mime_type, created_at` (:237-249); R2 signed-URL GET (:274-287) |
| budget | `GET /:id/budget`, `POST /:id/budget/expenses` (:669-895) | moved to `routes/artist-budgets.js` (name-keyed sheets) — parity owned by the artist-budgets pass |
| `POST /` | no trim, `RETURNING *` (:1224-1249) | trims, `logActivity`, returns 4 cols (:117-135) — parity fine |

Semantics note: OLD `total_releases` is a stored counter (recounted on merge :404-407); NEW computes `COUNT(r.id)` live including archived releases (:55-57) — NEW can't drift, but counts archived releases where OLD's `has_recent_release` logic excluded them.

## 6. Tables & forms (if present)

No tables on either side. Forms: NEW's add-artist inline form (:51-63) uses `.label`/`.input`/`.btn-primary` classes (RC-5 heights) — no OLD counterpart to compare. OLD's export/genre popovers use hand-rolled `bg-white border-gray-200` dropdowns with checkbox lists (:771-850, :937-972); no NEW counterpart exists.

## 7. Defects found

| # | Sev | Defect | Fix location | Conf |
|---|---|---|---|---|
| AR-1 | P0 | `DELETE /artists/:id` lost the Superadmin gate AND the has-releases 409 guard AND cleanup — any member can delete an artist; releases silently orphan via `ON DELETE SET NULL`; `entity_files` rows + R2 objects leak (OLD :929-967 had all three) | cadence `server/routes/artists.js:220-232` (+ `server/index.js:380`) | HIGH |
| AR-2 | P1 | `GET /artists/:id` contracts no longer role-gated — OLD hid contracts (royalty_split, advance) from non-admin/approver users (:437-441); NEW returns them to every member | cadence `server/routes/artists.js:87-92,109` | HIGH |
| AR-3 | P1 | Export feature missing end-to-end: release-window grid (All-time/1/3/6/12/24 mo), genre multi-select, XLSX with `last_release_date` column, computed filename | cadence client `Artists.jsx` + server `artists.js` (OLD client :375-400,:761-852; OLD server :86-177) | HIGH |
| AR-4 | P1 | Bulk Spotify image sync missing — header button + `POST /artists/sync-images` (link-first ID lookup, 100ms rate-limit pacing, updated/total report); NEW only syncs one artist at a time from the profile | cadence client `Artists.jsx` + server `artists.js` (OLD client :402-417,:853-861; OLD server :977-1082) | HIGH |
| AR-5 | P1 | Roster search missing — no client search box (OLD debounced 300ms :271-279,:862-876) and no server `?search` param (OLD :34-37) | cadence `client/src/pages/Artists.jsx` + `server/routes/artists.js:50-68` | HIGH |
| AR-6 | P1 | Filter/sort toolbar missing entirely: genre dropdown w/ embedded search + per-genre counts, All/Has Releases/No Releases segment, Active-only toggle, 4-option sort (default name-asc) | cadence `client/src/pages/Artists.jsx` (OLD :438-484,:922-1026) | HIGH |
| AR-7 | P1 | Stat cards row missing (Total Artists / Genres / Total Releases / Active Roster) | cadence `client/src/pages/Artists.jsx` (OLD :447-456,:881-918) | HIGH |
| AR-8 | P1 | Archived flow unreachable from the roster: no archived section, no per-card archive/restore, `?include_archived=1` has zero client consumers — an archived artist disappears and can only be restored via global-search → profile toggle | cadence `client/src/pages/Artists.jsx` (OLD :321-346,:1044-1063,:1117-1128; NEW server :52) | HIGH |
| AR-9 | P1 | `has_recent_release` derived flag dropped from the list endpoint — the Active-only filter and Active Roster stat cannot be rebuilt without it | cadence `server/routes/artists.js:50-68` (OLD :44-66) | HIGH |
| AR-10 | P1 | Rename cascade lost: NEW `PATCH /:id` renames without updating `expenses.artist` / `deals.artist_name` / `artist_income.artist_name` and without OLD's collision→merge 409 — a rename silently zeroes the artist's own Spends tab (NEW `GET /:id` matches spend by name, :96-102) | cadence `server/routes/artists.js:138-158` (OLD :268-336) | HIGH |
| AR-11 | P2 | Merge cascade gaps in the relocated `POST /flags/merge-artists`: `deals.artist_name` not updated (column exists, `index.js:423`), source `entity_files` never cleaned, `recording_budgets.artist_id` SET-NULLs on source delete | cadence `server/routes/flags.js:244-270` (OLD `artists.js:339-411`) | HIGH |
| AR-12 | P2 | `artist_links` CRUD removed (14 platforms, multi-link per platform, custom labels; OLD server :534-583 + LinksTab :70-221) — replaced by fixed single-URL profile columns; also removes the data that made OLD's image sync do direct-ID lookups | cadence `server/routes/artists.js:42-47` | HIGH |
| AR-13 | P2 | Devlog authorization lost: DELETE `/:id/log/:logId` has no author-or-admin gate (OLD :1327-1350) and POST no longer validates `entry_type` against the whitelist (OLD :1287-1289) | cadence `server/routes/artists.js:184-217` | HIGH |
| AR-14 | P2 | Card chrome parity: 36-genre color-chip map → plain gray text; 2-letter initials → single letter; ChevronRight, hover lift/shadow, avatar ring, `pr-12` archive slot all gone; avatar w-11→w-10 | cadence `client/src/pages/Artists.jsx:74-89` (OLD :10-45,:223-225,:1073-1131) | HIGH |
| AR-15 | P2 | Fetch errors swallowed (`.catch(() => {})`) — failed load renders as the empty state; OLD had a red error banner; loading spinner (page + inline search) reduced to a text line | cadence `client/src/pages/Artists.jsx:19,65-66` (OLD :297-299,:743-752,:871-875,:1029) | HIGH |
| AR-16 | P3 | List API shape: `?page/limit` + `{data,total}` dropped (OLD :28-73; client tracked page/totalPages at limit 1000 — no pager UI rendered, so impact is API-parity only) | cadence `server/routes/artists.js:50-68` | HIGH |
| AR-17 | P3 | Artist file upload guard regressed: OLD 10MB + `secureFileFilter`; NEW 25MB with no fileFilter (repo-wide MIME-sniff gap, but this route *had* a filter in OLD) | cadence `server/routes/artists.js:39` (OLD :19-23) | HIGH |
| AR-18 | P3 | Files metadata payload drops `file_size`, `uploaded_by`/`uploaded_by_name`, `label` | cadence `server/routes/artists.js:237-249` (OLD :610-629) | HIGH |
| AR-19 | P3 | PageHeader subtitle static vs OLD's live "{N} artists · {active filters}" summary | cadence `client/src/pages/Artists.jsx:43` (OLD :759) | HIGH |
| AR-20 | P3 | `GET /:id` payload gaps beyond AR-2: releases rows lose `assigned_to_name`; deals/links/income/expense-rows/totalIncome/totalExpenses absent; contracts ordered `date_signed DESC` vs OLD `expiration_date ASC` (files/budget intentionally moved to own endpoints) | cadence `server/routes/artists.js:71-114` (OLD :424-532) | HIGH |
| AR-21 | P3 | Card grid 2-up breakpoint md(768)→sm(640); gap-3→gap-4 | cadence `client/src/pages/Artists.jsx:73` (OLD :1035) | HIGH |
| AR-22 | P3 | Archive lost its audit stamps: OLD `PATCH /:id/archive` set `archived_at`/`archived_by`; NEW flips the boolean via generic PATCH with no stamps (columns don't exist) | cadence `server/routes/artists.js:46,138-158` + `server/index.js:416` (OLD :897-926) | HIGH |

**Intentional divergences (not defects):** `label_id` scoping on every query + `withTenant` router middleware (NEW server :11 and throughout); per-label unique artist name w/ 23505 handling (both sides); `{success,data}` envelope (both); generic "Internal server error" bodies replacing OLD's `err.message` leakage (e.g. NEW :66 vs OLD :974); `logActivity` on create/merge (NEW :126, flags.js:264); brand accent replacing boom red incl. XLSX header color if rebuilt (RC-2); merge/duplicates relocated to the flags surface (architecture — only the cascade gaps in AR-11 are defects); budget endpoints relocated to `routes/artist-budgets.js`; computed live `total_releases` replacing OLD's drift-prone stored counter (NEW :55-57).

**NEW-only additions (not defects):** inline add-artist form with toasts (NEW client :23-37,:51-63); per-artist `POST /:id/sync-spotify` filling followers/popularity/genre (NEW server :15-37); leaf-only spend aggregation avoiding split double-count (NEW server :93-103); `<Link>` cards giving native cmd-click.

**Dead code note (OLD):** the inline 5-tab panel + LinksTab UI (OLD :70-221,:519-741) is unreachable (`setSelectedArtist` never receives an artist) — not charged to NEW here; Links/Deals/Files tab parity is assessed on the artist-profile pass.

**UNVERIFIED — needs runtime check:** dark-mode rendering of NEW's `bg-brand-100`/`text-brand-700` avatar fallback and `bg-gray-100` image placeholder (no `.dark` overrides on this page); whether global search surfaces archived artists in practice (source shows no `archived` filter, `search.js:31-33`).

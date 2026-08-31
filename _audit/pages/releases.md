# Releases list — forensic page diff

OLD: `boom-dashboard/client/src/pages/Releases/` (index.jsx 1,331 ln + constants.js + AddReleaseModal.jsx + CalendarView.jsx + MergeFlow.jsx + NotificationBanner.jsx) + `boom-dashboard/server/routes/releases.js` (1,183 ln) + `server/routes/dsp.js`.
NEW: `cadence/client/src/pages/Releases.jsx` (223 ln) + `pages/ReleaseDetail.jsx` (269 ln) + `components/DspTracker.jsx` + `components/ReleaseExtras.jsx` + `client/src/constants.js` + `cadence/server/routes/releases.js` (306 ln) + `server/routes/dsp.js` + `server/routes/flags.js` (merge). NEW tree includes the uncommitted 2026-08-27 build.

Token-level diffs are covered by `_audit/01-design-system.md` (RC-1..RC-6) and are not re-reported per element.

---

## 1. Scope & architecture

The single biggest structural difference: **OLD is one page** — the list expands each row inline into a 7-tab workspace (`boom Releases/index.jsx:686-1306`); **NEW splits it** into a thin list (`cadence Releases.jsx`) that row-click **navigates away** to `/releases/:id` (`Releases.jsx:201`), where the 7 tabs live (`ReleaseDetail.jsx:14`). Everything OLD did "in place" (banner jump-chips expanding a row, calendar chips expanding a row, j/k/Enter row expansion, per-row tab memory `expandedTab` map `index.jsx:67-69`) has no equivalent because there is no expanded row. NEW's merge moved off-page entirely to `/data-quality` (`Releases.jsx:105`, `flags.js:274`). Detail-page overlap with the separate `release-detail` audit slug is intentional here since OLD's tabs belong to THIS page.

## 2. Intentional divergences (not defects)

- Every NEW query is `label_id`-scoped and re-validates client FKs in-tenant (`cadence server/routes/releases.js:22,90,142`, `dsp.js:13-16`, `flags.js` all merges) — multi-tenancy, per rules.
- Accent: OLD boom-red checklist pills/progress/rings vs NEW `brand-*` indigo (`ReleaseDetail.jsx:135,171`; `Releases.jsx:208`) — RC-2 branding.
- Admin checks by role name `['Superadmin','Admin','Approver']` (`ReleaseDetail.jsx:21`) instead of OLD `hierarchy_level <= 2` (`boom releases.js:277-281,927-931`) — Cadence auth model. (Where NEW *dropped* the check entirely it is a defect — see REL-07/REL-17.)
- Artwork sync: OLD batch sweep endpoint `POST /releases/sync-artwork` over up to 700 rows with `not_found` sentinel (`boom releases.js:49-161`); NEW per-release `POST /:id/sync-artwork` with graceful `spotify.isEnabled()` degrade (`cadence releases.js:15-35`). Per-tenant scoping rationale; batch sync exists on NEW Catalog per CLAUDE.md.
- Merge is admin-gated in both (OLD `releases.js:277-281`; NEW `flags.js:9` router-level).

## 3. Missing in NEW (OLD features absent)

1. **Filter suite** — OLD has Year (2027→2021), Month, Genre (9 options `constants.js:24`), Priority (`standard|priority|high priority`), Type (`single|EP|album`) selects in a pipe-separated bar plus an **Archived** toggle button (`index.jsx:548-581`) and an implicit Upcoming/Past dimension defaulting to `Upcoming` (`index.jsx:43,220-221`). NEW has only a Status select + text search (`Releases.jsx:143-144`). No year/month, genre, priority, type, archived toggle, upcoming/past.
2. **Merge in-list flow** — OLD per-row rose checkbox column (`index.jsx:631-639`), floating "N selected / Merge into one…" bar and keep-one radio modal (`MergeFlow.jsx:44-114`), N-way `POST /releases/merge`. NEW list has none; only a `Duplicates` link to `/data-quality` (`Releases.jsx:105`), pairwise-only merges there.
3. **Hotkeys on the list** — OLD `n` (add), `v` (view toggle), `j/k` row focus with `scrollIntoView`, `Enter` expand, `1-7` tab jump (`index.jsx:149-164`). NEW list page registers zero hotkeys (no `useHotkeys` import in `Releases.jsx`); only detail has `1-7` + `Escape` (`ReleaseDetail.jsx:38-41`).
4. **Banner behaviors** — OLD banner is collapsible (Show/Hide, `NotificationBanner.jsx:15-31`), lists only releases with **checklist < 100%** (`index.jsx:266-269`), unlimited chips, each chip shows countdown with the `daysUntil` color classes (`constants.js:60-66`) and **jump-to**: clears Year/Month, forces list view, expands the row, sets its tab to Checklist, then scrolls to it (`index.jsx:130-137,174-184`). NEW banner is fixed-open, includes fully-prepped releases (no `pct < 100` filter, `Releases.jsx:73-78`), caps at 6 chips (`:117`), chips are plain `<Link>`s to detail with uncolored `days`/`pct` text.
5. **Table columns** — OLD: merge checkbox, Artist (first, bold), Project (real `<Link>`), Date, Format, Genre, **Priority badge** (only when `priority !== 'standard'` AND `release_date >= today`, red/yellow via `getPriorityBadge`, `index.jsx:651-655`, `constants.js:74-77`), Assigned pill, Completion bar (emerald at 100% else boom) **+ inline Archive button per row** (`index.jsx:662-683`). NEW: Project, Artist, Type, Date, Owner, Progress (always brand-500), Status (`Releases.jsx:192-215`). Missing: checkbox col, Genre col, Priority col + its display rules, inline archive, 100%-green progress state; Project is not an anchor (row `onClick` only — no cmd+click/middle-click).
6. **"N releases" count header** above the table (`index.jsx:597-599`) — absent.
7. **Calendar view fidelity** — OLD: bordered day grid `min-h-[80px]`, today = red-tinted cell + red day circle (`CalendarView.jsx:73-83`), chip color rules — emerald `pct===100`, red `high priority`, amber `priority`, gray standard (`CalendarView.jsx:92-100`) — **legend footer** naming those four states (`:113-120`), chips labeled `artist — project`, all releases shown, chip click jumps to the list row. NEW: floating cells, no today marker, no legend, all chips brand-tinted regardless of priority/completion, project-name-only, 3-chip cap with `+n` (`Releases.jsx:166-178`), click navigates to detail.
8. **Add Release fields** — OLD modal collects Artist (free-text + datalist, find-or-create server-side), Project, Date (required), Type, Genre, Priority, UPC, ISRC, Producer, Featured Artists, Notes (`AddReleaseModal.jsx:52-105`; `boom releases.js:773-828`). NEW inline card collects only project/artist(select of existing)/date/type/status (`Releases.jsx:128-137`): no genre/priority/UPC/ISRC/producer/featured/notes at create, no create-artist-by-name, date not required.
9. **Expanded-row header** — light header with project link, artist, priority badge, `release_type · genre · date · countdown` meta line, big `NN%` + `n of 14`, and the **SVG progress ring** (`index.jsx:704-737`). NEW header is artwork thumb + title + meta; completion is a linear bar with `n/m · pct%` (`ReleaseDetail.jsx:133-138`); no ring, no countdown, no priority badge.
10. **Checklist tab badge** `doneCnt/14` on the tab strip (`index.jsx:690-698,753-757`) — NEW tabs show hotkey number hints instead (`ReleaseDetail.jsx:148`).
11. **Metadata fields** — OLD edits 11 text fields + Cover Art Status select + 2 textareas: `upc, isrc, apple_id, spotify_uri, presave_link, presave_analytics, ugc_link, apple_music_link, producer, featured_artists, subgenre, cover_art_status, distributor_notes, notes` (`index.jsx:811-854`). NEW Metadata tab (`ReleaseDetail.jsx:184-201`) drops **apple_id, presave_link, presave_analytics, ugc_link, apple_music_link, subgenre, distributor_notes, cover_art_status** (server allowlist lacks them too, `cadence releases.js:120-128`).
12. **Budget tab depth** — OLD: summary bar (Total Spent / Budget Cap / Remaining "over|left" / progress bar with >80% amber, >100% red thresholds, `index.jsx:1031-1063`), items **grouped by the 9 BUDGET_CATEGORIES with per-category hairline totals** (`index.jsx:1074-1106`, `constants.js:38`), add form with Category+Description+Amount, 2-decimal money. NEW (`ReleaseExtras.jsx` budget panel): flat list, `Planned $X / $Y` single line, no grouping/summary/progress, categories come from the **expense** category list (`CategoryOptions`, `ReleaseExtras.jsx:57`) not the 9 release budget categories, money rounded to 0 decimals (`:36`), and the add form renders **no Description input** even though state and server support it (`:56-60`).
13. **Details tab actions** — OLD: Assigned To select (all users, spinner), inline core-field edit block (artist find-or-create/project/date/format/genre/priority, `index.jsx:1214-1267`), **Mark as Released** → `PUT /:id/catalog` (`index.jsx:1273-1279`, `boom releases.js:881-899`), Archive, Delete gated `hierarchy_level <= 2` with a confirm naming the project (`index.jsx:442-451,1287-1295`). NEW: Status + Owner selects, Archive, Delete visible to everyone with generic confirm (`ReleaseDetail.jsx:86-89,242`); no catalog concept, no artist reassignment anywhere (see REL-19).
14. **Release audit trail** — OLD `release_audit_log` writes on core-field and checklist changes plus `GET /:id/audit` (`boom releases.js:626-641,706-711,1107-1118`). NEW has no equivalent table/endpoint.
15. **Fetch-generation race guard + quiet refetch** — OLD `fetchGenRef` drops stale responses and `hasLoadedOnce` suppresses the skeleton on refetch (`index.jsx:29-37,209-236`). NEW fetches once so the guard is moot, but any future server filtering re-inherits the race.

## 4. Behavioral differences (present in both, behaves differently)

1. **Default list scope** — OLD defaults to *upcoming, non-archived, non-cataloged*, ordered soonest-first (`index.jsx:43`; `boom releases.js:452-462,509-516`). NEW returns **every** release (archived rows included — `archived` is a separate boolean from status and is never filtered, `cadence releases.js:37-56`, `Releases.jsx:63-69`), ordered `release_date DESC`. An archived-but-status-Draft release shows in NEW's pipeline; a past release never leaves it.
2. **Search** — OLD: 300ms debounce (`index.jsx:193-197`), ≥2 chars triggers a server refetch that **bypasses all filters** (`index.jsx:201-207,209-224`), then client-filters over artist/project/**ISRC/UPC** (`index.jsx:256-263`). NEW: instant client filter over `project_name + artist_name` only (`Releases.jsx:63-69`) — ISRC/UPC not searchable, and search is intersected with the status filter rather than bypassing it.
3. **Checklist model** — key lists differ entirely. OLD 14 keys / groups Content(4) `yt_video,content,marketing_plan,official_thread` · Distribution(3) `uploaded,recoup_added,budget` · Pitching(7) `stem_pitch,s4a_pitch,amazon_pitch,pandora,marquee,dsp_email,musixmatch` (`boom constants.js:5-21`; server allowlist `boom releases.js:675-679`). NEW 14 keys / Content(5) `cover_art_received,content_ready,marketing_plan,youtube_video,official_thread` · Distribution(2) `audio_uploaded,recoup_setup` · Pitching(7) `pitched_spotify,pitched_apple,pitched_amazon,pitched_pandora,dsp_email_sent,lyrics_submitted,musixmatch` (`cadence constants.js:25-49`). NEW drops OLD's **Budget, Marquee, Stem Pitch, S4A Pitch** items and adds Cover art received, Pitched Apple, Pitched Spotify, Lyrics submitted. Completion %s are not comparable across apps.
4. **Checklist toggle mechanics** — OLD is optimistic with `flushSync` (fresh value even under rapid toggles), rollback on failure, and per-release disable while saving (`index.jsx:271-298`). NEW awaits `PATCH` then replaces state (`ReleaseDetail.jsx:84,43-51`) — no optimistic paint, no in-flight disable, so two rapid toggles both read stale state and the second response can revert the first.
5. **Priority model** — OLD `standard|priority|high priority` with badge-display rules; NEW `PRIORITIES = ['High','Medium','Low']` (`cadence constants.js:21`), editable on Metadata but rendered nowhere on the list or calendar.
6. **DSP tab** — OLD lazy card grid keyed `dsp_name`, per-card spinner (`index.jsx:867-908`); NEW table keyed `platform` with optimistic update + rollback and an added Notes column (`DspTracker.jsx`). Wire shape changed `dsp_name`→`platform` (`cadence dsp.js:22-37` vs `boom dsp.js:19-35`). Platform list: OLD `'iHeart Radio'`, order `…TIDAL, Pandora, Deezer…` (`boom dsp.js:7-10`); NEW `'iHeartRadio'`, `…TIDAL, Deezer, Pandora…` (`cadence lib/constants.js:16-19`). **Status colors swapped**: OLD Submitted=blue / Approved=amber (`boom constants.js:30-36`); NEW Submitted=amber / Approved=blue (`DspTracker.jsx:9-15`).
7. **Comments** — OLD `text` column, avatar rows, Cmd+Enter posts a textarea, delete only for author or `hierarchy_level <= 2` client-side (`index.jsx:967-974`) and author-or-Admin server-side (`boom releases.js:1167-1181`). NEW `body` column, single-line input with plain Enter, delete button shown to everyone (`ReleaseExtras.jsx:72`) and the server DELETE checks only label scope (`cadence releases.js:243-256`) — any member can delete anyone's comment.
8. **Activity feed matching** — OLD matches `detail LIKE '%release #<id>%'` (`boom releases.js:862-878`), precise per-release because every logger writes `release #id`. NEW matches `detail ILIKE '%<project_name>%'` (`cadence releases.js:186-206`) — fuzzy: short/common titles pull unrelated rows, renames orphan history. NEW also displays date-only vs OLD's date+time (`ReleaseDetail.jsx:259` vs `index.jsx:931`).
9. **Merge semantics** — OLD `POST /releases/merge` handles N sources at once: COALESCEs 20 metadata columns (`boom releases.js:255-261`), **ORs the 14 checklist booleans** (`:263-267,322-325`), reassigns 9 child tables + legacy/recording budgets + dsp uniqueness handling, recounts `artists.total_releases`, returns the merged row (`:269-436`). NEW `POST /flags/merge-releases` is pairwise, fills only 10 blanks (`flags.js:287`), folds only `dsp_submissions` + `tasks` (`:295-301`), then deletes the source — **source checklist flags, release_comments, and release_budget_items are lost** (neither reassigned nor mentioned; comments/items either cascade-delete or orphan), and no merged row is returned (client refetches).
10. **Create** — OLD requires `project_name` + `release_date` and an artist (find-or-create by name) and updates `artists.total_releases` (`boom releases.js:777-807`); NEW requires only `project_name`, allows artist-less releases (list uses LEFT JOIN so they render as "—"), posts an `#activity` bot event (`cadence releases.js:81-117`) — NEW-only addition.
11. **Delete** — OLD server gates on `hierarchy_level <= 2` and resyncs `total_releases` (`boom releases.js:922-950`); NEW DELETE has **no role gate at all** (`cadence releases.js:162-174`) — any workspace member can permanently delete a release; OLD's client also hid the button below hierarchy 3, NEW shows it to everyone (`ReleaseDetail.jsx:242`).
12. **Activity logging coverage** — OLD logs checklist toggles (both `activity_log` + `release_audit_log`), assignment, archive, catalog, delete, merge. NEW logs create and DSP updates only; the generic `PATCH /:id` writes no log (`cadence releases.js:131-160`) — so checklist toggles, archive, status, priority and owner changes are invisible, which in turn starves NEW's own Activity tab.

## 5. Visual & design deltas (beyond RC-1..RC-6)

- List/Calendar toggle: OLD segmented control, active = `bg-gray-900 text-white` (`index.jsx:524-531`); NEW gray-100 pill, active = white card + shadow (`Releases.jsx:145-148`).
- Checklist items: OLD tactile pill buttons in a `grid-cols-2 md:grid-cols-4`, checked = solid red fill + white ring-circle check (`index.jsx:778-799`); NEW vertical rows with square checkbox + strikethrough label inside per-group cards (`ReleaseDetail.jsx:156-180`). Density and affordance differ substantially.
- Banner palette: OLD orange-50/orange-100 with white chips; NEW amber-50/amber-200 with text links (`NotificationBanner.jsx:14` vs `Releases.jsx:112`).
- Progress bar: OLD `h-1` w-16, emerald at 100%; NEW `h-1.5` w-16, always brand (`index.jsx:663-667` vs `Releases.jsx:207-209`).
- Loading state: OLD `Skeleton.PageHeader + Skeleton.Table rows=8 cols=8` (`index.jsx:508-515`); NEW a single `Skeleton.Block h-64` (`Releases.jsx:151`).
- Table header: OLD `text-[11px] … bg-gray-50/50` head row (RC-3 micro-type); NEW `text-xs`, no head fill (`Releases.jsx:191-194`).
- OLD renders each release as a nested `<tbody>` inside the outer `<tbody>` (`index.jsx:615,626`) — invalid HTML that browsers repair; NEW's flat rows are the corrected form (not a defect).

## 6. Server/API contract differences

| Concern | OLD | NEW |
|---|---|---|
| List params | `month(YYYY|YYYY-MM), date_from, date_to, artist, search(4-field), genre, priority, release_type, upcoming, archived, in_catalog, limit` (`boom releases.js:439-534`) | `status, q(title/artist)` only (`cadence releases.js:37-60`) |
| Default exclusions | archived + in_catalog excluded | none |
| Ordering | upcoming→ASC, else DESC | always DESC NULLS LAST |
| Artist join | INNER (artist required) | LEFT (artist optional) |
| Update | `PUT /:id` (core, find-or-create artist, audit log, expense relink) + `PUT /:id/metadata` + `PUT /:id/checklist` (partial, per-toggle logs) + `PUT /:id/assign` + `PUT /:id/archive` + `PUT /:id/catalog` | single `PATCH /:id` allowlist (`:120-160`), no logging, no artist change (`artist_id` not in UPDATABLE), archive via boolean field |
| Budget | `GET/POST/PUT/DELETE /:id/budget-items` backed by consolidated `recording_budgets`/`recording_budget_line_items`, `{items, budget_cap}` shape, category required (`boom releases.js:959-1103`) | `GET /:id/budget` `{budget_cap, items, total}` + `POST/DELETE /:id/budget/items` on its own `release_budget_items` table; **no item-update (PUT) route**; category optional, amount coerced `parseFloat||0` (`cadence releases.js:260-305`) |
| Comments | `text` col, joined role/department, author-or-admin delete | `body` col, author name only, unauthenticated-role delete (label-scope only) |
| Merge | `POST /releases/merge` N-way (see §4.9) | `POST /flags/merge-releases` pairwise (see §4.9) |
| Duplicates | `GET /releases/duplicates` 4 signals + sentinel guard + reason-merging (`boom releases.js:163-251`) | lives on `/flags` (out of this page's scope; see flags-data-quality pass) |
| Audit | `GET /:id/audit` (`release_audit_log`) | absent |
| Expense relink | create/rename fire `relinkExpensesForRelease` (`boom releases.js:649-653,812-814`) | absent |
| Artwork | batch `POST /sync-artwork` (2-phase, sentinel) | per-release `POST /:id/sync-artwork` |

## 7. Defect summary

| ID | Sev | One-line |
|---|---|---|
| REL-01 | P1 | Inline expanded-row 7-tab workspace replaced by navigation to a detail route; all in-place expand flows (banner/calendar/keyboard) gone |
| REL-02 | P1 | Filter bar reduced to Status+search — Year/Month/Genre/Priority/Type/Upcoming-Past/Archived toggle all missing |
| REL-03 | P1 | Default scope regression: archived rows shown, no catalog exclusion, past-first DESC instead of upcoming-ASC |
| REL-04 | P1 | Checklist item set & grouping mismatch (drops Budget/Marquee/Stem Pitch/S4A; groups 4/3/7 → 5/2/7; all keys renamed) |
| REL-05 | P1 | Merge downgraded: pairwise only, loses checklist flags, comments, budget items; no expense/artist-count handling |
| REL-06 | P1 | Calendar buckets dates with UTC `new Date(release_date)` — off-by-one day west of UTC (OLD explicitly fixed via `parseLocalDate`) |
| REL-07 | P1 | `DELETE /releases/:id` has no admin gate (OLD hierarchy≤2) and the button is shown to every role |
| REL-08 | P2 | Search misses ISRC/UPC and no longer bypasses filters (no debounce/generation architecture) |
| REL-09 | P2 | Banner: not collapsible, includes 100%-complete releases, capped at 6 chips, no countdown color rules, no jump-to-checklist |
| REL-10 | P2 | Table drops merge-checkbox, Genre, Priority-badge (and its future-date rule), inline Archive, emerald-at-100% bar; Project not an anchor |
| REL-11 | P2 | Calendar: no priority/completion chip colors, no legend, no today marker, 3-chip cap, ignores active filters (uses `releases` not `shown`) |
| REL-12 | P2 | Create form lost Genre/Priority/UPC/ISRC/Producer/Featured/Notes, artist find-or-create, and required release_date |
| REL-13 | P2 | List hotkeys n/v/j/k/Enter/1-7 all absent |
| REL-14 | P2 | DSP Submitted/Approved badge colors swapped vs OLD; platform renamed `iHeart Radio`→`iHeartRadio` (order also differs) |
| REL-15 | P2 | Budget tab: summary bar/thresholds, 9-category grouping + per-category totals gone; wrong category list (expense categories); 0-decimal money |
| REL-16 | P2 | Metadata tab missing 8 fields (apple_id, presave_link, presave_analytics, ugc_link, apple_music_link, subgenre, distributor_notes, cover_art_status) |
| REL-17 | P2 | Comment delete: server drops author-or-admin authorization; client shows delete to all members |
| REL-18 | P2 | `PATCH /:id` writes no activity/audit logs (checklist/archive/status/owner changes untracked); `release_audit_log` + `/audit` endpoint absent |
| REL-19 | P2 | Release's artist is immutable after creation (`artist_id` not in PATCH allowlist; no artist field on any tab) |
| REL-20 | P2 | Priority model changed to High/Medium/Low and is rendered nowhere on list/calendar |
| REL-21 | P2 | Mark as Released / `in_catalog` toggle endpoint gone (status select is a lossy stand-in) |
| REL-22 | P2 | List endpoint lost month/date-range/artist/search/genre/priority/type/upcoming/archived/in_catalog/limit params |
| REL-23 | P3 | Checklist toggle non-optimistic, no in-flight guard (rapid-toggle race) vs OLD flushSync+rollback |
| REL-24 | P3 | Budget add-item form renders no Description input though state+server accept it |
| REL-25 | P3 | "N releases" count header missing |
| REL-26 | P3 | Loading skeleton is a generic block vs PageHeader+8×8 Table |
| REL-27 | P3 | Budget item PUT (edit-in-place) route absent |
| REL-28 | P3 | Activity matching by `ILIKE %project_name%` (cross-entity false positives, breaks on rename) vs `%release #id%`; date-only timestamps |
| REL-29 | P3 | Expanded header SVG progress ring + colored countdown label missing |
| REL-30 | P3 | Checklist tab n/14 badge missing from tab strip |

**Totals: 30 defects — 7×P1, 15×P2, 8×P3. Intentional divergences: 5** (tenant scoping/FK re-validation; RC-2 accent; role-name admin checks; per-tenant artwork sync; merge admin gate parity via router-level guard).

# g-global-search — ⌘K workspace search (global shell surface)

OLD: `boom-dashboard/client/src/components/GlobalSearch.jsx` (482L) + `client/src/lib/pageSearch.js` + `server/routes/search.js` (176L)
NEW: `cadence/client/src/components/GlobalSearch.jsx` (126L) + `server/routes/search.js` (66L)

Route & permissions: global surface — rendered on every authenticated page (OLD mounted inside the header, Layout.jsx:853; NEW mounted as a modal at the shell root, Layout.jsx:490). Server: OLD gates contracts to admin/superadmin/approver (search.js:46-47) and vendors/entries behind a fail-closed "holds any /bk/ page" check (:17-32,:55); NEW gates contracts to the same trio (search.js:18,:35) — the other gates have nothing to guard (those entities aren't searched).

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 1. Layout & structure

**OLD**: a **persistent inline search input** in the header (`max-w-md`, :203-229) with an **anchored dropdown** under it (`max-h-[480px]`, :232-479) containing: category filter pills row (All/Pages/Vendors/Ledger/Releases/Artists/Contracts/Deals, :236-250) → Recent searches block w/ Clear (:253-274) → server-half spinner (:277-282) → grouped results in fixed order Pages → Vendors → Ledger → Releases → Artists → Contracts → Deals (:290-469), pages rendered locally *while the server half is still in flight* (:292-294,:137-144).

**NEW**: a **centered modal palette** (`fixed inset-0 pt-[12vh] bg-overlay`, panel `max-w-xl rounded-2xl`, :66-70) opened from the header Search button or ⌘K (Layout.jsx:172,:437-445): input row w/ `esc` kbd (:71-82) → single scroll area (`max-h-[50vh]`, :84) with grouped results in order Releases → Artists → Contracts → Deals (:8-13,:92-121). No pills, no recent block, no page results.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Trigger | always-visible input w/ Search 15, ⌘K kbd chip, X-to-clear | header button (Search 14 + "Search" + kbd) opening the modal | OLD :203-229 / NEW Layout.jsx:437-445 |
| Container | anchored dropdown `rounded-xl shadow-lg` under the input | centered overlay modal `rounded-2xl shadow-modal` (RC-6) | OLD :233 / NEW :66-70 |
| Group header | icon 11 + `text-[10px] font-bold uppercase tracking-wider` + result count | `text-[10px] font-semibold uppercase tracking-widest`, no icon, no count | OLD :366-370 / NEW :98 |
| Row | `px-3 py-2 hover:bg-boom-50`, per-type anatomy (see §4) | `px-4 py-2` w/ leading icon 15, primary + `text-[11px]` secondary, active row `bg-brand-50` + CornerDownLeft 13 | OLD :371-464 / NEW :104-116 |
| Release row | name + inline artist + release_type chip + date | name / artist sublabel only | OLD :377-386 / NEW :9 |
| Artist row | avatar circle w/ initial + "N releases" right meta | Disc3 icon + genre sublabel | OLD :406-412 / NEW :10 |
| Contract row | artist + type + green/gray status badge | type / artist, no status badge (status fetched, unused) | OLD :432-438 / NEW :11, server :37 |
| Deal row | artist + genre + stage right meta | artist / stage (genre fetched, unused) | OLD :458-462 / NEW :12, server :46 |
| Loading | spinner + "Searching…" (server half only; pages already rendered) | text-only centered "Searching…" replacing all content | OLD :277-282 / NEW :85 |
| Icons | Music/Users/FileText/TrendingUp + Building2/Receipt/CornerDownRight | Music/**Disc3**/FileText/TrendingUp (artists icon changed) | OLD :2 / NEW :3 |

## 3. Copy & content differences

- Placeholder: "Search..." (:210) → "Search releases, artists, contracts, deals…" (:78).
- Idle state: OLD focused-empty "Search releases, artists, contracts, and deals" (:475) or the Recent list; NEW "Type at least 2 characters to search." (:90).
- No-results: `No results for "{q}"` (:286) → `No results for "{q}".` typographic quotes (:87).
- OLD-only strings: "Recent" / "Clear" (:258-260), category pill labels (:18-27), "N invoices" vendor meta (:330-332).

## 4. Feature & interaction differences

### Entities searched (the core gap)

| Entity | OLD | NEW |
|---|---|---|
| **Pages** | local palette over NAV_PAGES label+path+`synonyms`, canView-filtered BEFORE ranking, top 6, instant (GlobalSearch :117-120,:295-313; pageSearch.js:21-49) — added because the old entity-only palette "was inert" for 88% of usage (pageSearch.js:7-15) | — |
| **Vendors** | derived from approved expenses, alias-aware (`vendor_aliases` hit resolves to primary), creator rows excluded, spend-ordered, bookkeeping-gated fail-closed (search.js:103-136) → `/bk/vendors/:payee` | — |
| **Ledger entries** | invoice# / payee / description, leaf-rows-only (split parents excluded), bookkeeping-gated (search.js:138-156) → `/bk/ledger?q=…` | — |
| Releases | LIKE over name/artist/upc/isrc, `archived=false`, 8 (search.js:59-73) | ILIKE same fields, **no archived filter**, 8 (search.js:21-29) |
| Artists | ordered `total_releases DESC`, 6 (:75-81) | ordered `name`, 6, returns genre (:30-34) |
| Contracts | approver+, ordered `expiration_date ASC`, 6 (:83-93) | approver+, ordered `updated_at DESC`, 6 (:35-44) |
| Deals | 6, returns ar_rep (:94-101) | 6, returns genre (:45-49) |

### Interaction
- **Recent searches**: OLD persists the last 8 selections (typed by kind, dedup-keyed on id/path/payee, Clear button, click re-navigates without a query) (:29-34,:146-168,:187-196,:252-274). Absent in NEW.
- **Category filter pills** (8, filter the rendered groups client-side, :18-27,:122-132,:236-250). Absent in NEW.
- **`/` focus shortcut** (skips when typing in a field, :98-105). NEW has only ⌘K (Layout.jsx:172).
- **Escape**: OLD closes dropdown + blurs (:106-109); NEW closes the modal (input-level :56 + the shell's useEscapeStack-free window listener via Layout ⌘K toggle) — parity in effect.
- **Keyboard result navigation**: **NEW-only addition** — ArrowUp/Down + Enter + mouseEnter-sets-active + active-row Return glyph (:19,:55-59,:106,:115). OLD is mouse-only (`onMouseDown` rows) with no active-row concept.
- **Navigation targets**: releases → `/releases/:id` both (OLD :174 / NEW :9). Artists: OLD → `/artists/:id` profile (:175); NEW → `/artists` **list** (:10) despite the profile route existing (00-inventory.md pairs `/artists/:id` HIGH). Contracts → `/contracts`, deals → `/deals` both (:176-177 / :11-12).
- Debounce 300ms (:65) → 220ms (:45); min chars 2 on both (client :52/:38, server :39/:14); OLD renders page hits during server flight so a page query never flashes "No results" (:136-144) — moot in NEW (no page hits).
- OLD keeps the query and dropdown per-render session and clears on select (:164-166); NEW resets query/results every open (:27-32).

## 5. Data layer differences

- Endpoint shape: both `GET /api/search?q=`. OLD returns `{releases, artists, contracts, deals, vendors, entries}` (search.js:159-169); NEW returns the first four only (:51-59).
- OLD's bookkeeping gate queries `user_page_permissions` and **fails closed** on DB error (:17-32); no NEW analog needed until vendors/entries port — the port must reuse NEW's permission model (canView server mirror) rather than restating it.
- OLD `LIKE LOWER(...)` w/ raw `upc/isrc LIKE` (case-sensitive, :68-69); NEW `ILIKE` everywhere (:26) — negligible.
- NEW label-scopes every query to `req.labelId` and scopes the artist JOIN by label (:24-26) — **[INT]** tenancy.
- NEW returns `genre`/`status` fields the client never renders (:31,:37,:46).

## 6. Tables & forms (if present)

No tables; the only form control is the search input on each side (§2 row 1).

## 7. Defects found

1. **P1** — Page-palette search missing: NAV_PAGES + synonyms local matching, canView-before-ranking, top-6, instant-while-server-in-flight (OLD GlobalSearch.jsx:117-144,:295-313 + pageSearch.js:21-49 + navConfig synonyms) — OLD added it because the entity-only palette "was inert" for most usage — fix: port pageSearch.js + a synonyms-bearing navConfig (see g-sidebar-nav defect 8) into cadence GlobalSearch.jsx. (HIGH)
2. **P1** — Vendors + ledger-entry search missing client and server: alias-aware creator-excluded vendor groups → vendor page, leaf-only invoice#/payee/description entries → `/ledger?q=`, both behind a fail-closed bookkeeping gate (OLD search.js:17-32,:103-156; GlobalSearch.jsx:315-361,:181-184) — fix: cadence server/routes/search.js + GlobalSearch.jsx GROUPS; gate on approver/canView. (HIGH)
3. **P2** — Palette architecture: persistent header input w/ anchored dropdown → button-opened centered modal; the always-visible affordance and type-without-clicking entry are lost (OLD GlobalSearch.jsx:202-233 / NEW :62-83 + Layout.jsx:437-445) — fix: restore inline header input, or accept modal and log. (MED — modal-palette is a defensible pattern; deviation per OLD-is-truth)
4. **P2** — Recent searches (last 8, typed, dedup, Clear, click-to-renavigate) missing (OLD :29-34,:146-168,:187-196,:252-274) — fix: cadence GlobalSearch.jsx localStorage recents. (HIGH)
5. **P2** — Category filter pills missing (8 pills filtering rendered groups, OLD :18-27,:122-132,:236-250) — fix: cadence GlobalSearch.jsx:84 add pill row. (HIGH)
6. **P2** — `/` focus shortcut missing (OLD :98-105; NEW Layout.jsx:167-184 handles only ⌘K/?/g) — fix: cadence Layout.jsx:172 add `/` → open palette. (HIGH)
7. **P2** — Archived releases leak into results: OLD filters `archived=false` (search.js:64); NEW has no status filter (search.js:21-29) though NEW's own notifications route excludes `status = 'Archived'` (notifications.js:32) — fix: cadence server/routes/search.js:26 add `AND r.status != 'Archived'`. (HIGH)
8. **P2** — Artist result navigates to the `/artists` list instead of the `/artists/:id` profile that exists (OLD GlobalSearch.jsx:175 / NEW :10) — fix: `to: r => '/artists/' + r.id`. (HIGH)
9. **P3** — Result-row anatomy losses: release type-chip + date, artist avatar + "N releases" (server no longer returns total_releases, NEW search.js:31), contract status badge and deal genre fetched-but-unrendered (OLD :377-464 vs NEW :8-13,:104-116) — fix: extend GROUPS renderers + server selects. (HIGH)
10. **P3** — Server ordering deviates: artists `total_releases DESC`→`name`, contracts `expiration_date ASC`→`updated_at DESC` (OLD search.js:79,:89 / NEW :32,:41) — fix: match OLD ordering. (MED)
11. **P3** — Minor interaction drift: debounce 300→220ms, per-group counts dropped, spinner→text loading that hides already-fetched groups, focused-empty hint replaced by min-chars copy (OLD :65,:277-282,:369,:475 / NEW :45,:85-90) — fix: cosmetic pass. (MED)

Intentional divergences (not defects): every query label-scoped + label-scoped artist JOIN (tenancy); ILIKE normalization. NEW-only additions kept: ArrowUp/Down/Enter keyboard navigation w/ active row + mouseEnter tracking (OLD is mouse-only) and per-open state reset.

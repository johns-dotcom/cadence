# 99 — Punch list

Forensic parity audit of **cadence** (NEW) against **boom-dashboard** (OLD, source of truth).
Audit window 2026-08-27 → 2026-08-30. 71 entries: 44 paired pages, 14 OLD-only features,
13 global surfaces. Evidence: `pages/<slug>.md` (7-section per-page files), `_defects-raw.md`
(one-line register), `01-design-system.md` (token/RC analysis), `00-inventory.md` (pairing).

**Totals: 977 defects — 14 P0 · 198 P1 · 339 P2 · 426 P3 — plus 176 intentional divergences.**
(Corrected 2026-08-31: the first tally missed 171 defects logged in early-format blocks — payments, bank-statements, releases, catalog, deals, create-nda, label-waiver, artist-clearance, renewals, pending-contracts.)
Visual/runtime verification was unavailable (cadence has no local .env → server can't boot);
claims that needed a running app are marked `UNVERIFIED — needs runtime check` in the page files.

## Root causes — fix these first (highest leverage)

Systemic causes behind hundreds of the line items below. RC-1..RC-6 are from
`01-design-system.md`; RC-7+ emerged from the per-page passes.

| # | Root cause | Blast radius | Fix |
|---|---|---|---|
| RC-1 | **Inter webfont never loaded** — tailwind lists it, nothing imports it; every glyph renders in the system font | Every page | One `@import`/`<link>` in `client/index.html` or index.css (P0-leverage) |
| RC-5 | Buttons/inputs `py-2.5` vs OLD `py-2` (+ OLD ui/Input fixed `h-9`) | Every form & toolbar ~4px taller | `client/src/index.css:21-44` + ui kit |
| RC-3 | OLD's dense micro-typography (`text-[10px]`–`[13px]`, ~1,800 uses) replaced by sparser `text-xs`+ | Meta lines, chips, tables app-wide | Restore bracket sizes as pages are reworked |
| RC-4 | Icons average ~2px larger than OLD (13/14/12/11 vs 15/13/14/16) | Toolbars/rows density | Per-page during rework |
| RC-6 | Cards `rounded-2xl` vs OLD `rounded-xl` | Every card | `index.css:17` + ui/Card |
| RC-2 | Accent indigo vs boom red | Everything branded | **Intentional** (runtime branding) — no action |
| RC-7 | **Approval checklist subsystem absent end-to-end** (no client deck/fields, no server validate/write, no `approval_checklist` column) — approve is a bare status UPDATE | 3 P0s + a dozen P1s across approvals / add-invoice / ledger | Port boom's checklist lib + gate (see pages/approvals.md, pages/add-invoice.md) |
| RC-8 | **EmailPreviewModal never renders** — consumers omit the required `open` prop; vendor decisions, payment confirmations + mark-sent, Send-for-Approval all silently send nothing | 1 P1 + 3 P2, four money-flow email paths dead | Pass `open` at each call site (pages/g-email-preview-modal.md) — near one-line fixes |
| RC-9 | **Dark mode gray collision** — `--color-gray-50` == `--color-gray-100` == `#1f222c` on card `#1c1f2b`; 74 `hover:bg-gray-50` + 107 `bg-gray-100` sites near-invisible; 58 `bg-brand-50` washes + 213 raw colored tints have no dark remap; Recharts tooltips/ticks default-white | All dark-mode usage | Retune `tokens.css` `.dark` grays (needs the ui/Badge neutral re-audit noted in CLAUDE.md) |
| RC-10 | **Financials lost its executive depth** — paid/unpaid distinction blended in every figure, zero drill-through, weekly-spend/aging/cash-forecast charts gone | 3 P0s + most of financials.md | Port `/exec` endpoints + KpiDrillModal (pages/financials.md) |
| RC-11 | `GET /api/flags` selects nonexistent `vendors.w9_name` → 42703 → **the whole /data-quality page 500s** | 1 P0, page dead | `server/routes/flags.js:48` — one-line fix |
| RC-12 | **CLAUDE.md reality drift** — features claimed built that aren't (usage analytics anywhere incl. platform console; EmailPreviewModal at runtime) and vice-versa (/manual exists) | Planning risk, not user-facing | Corrections appended in this audit; update CLAUDE.md |

## Reading order for a fix campaign

1. RC-11 (one line, revives a dead page) → RC-8 (a few lines, revives 4 email flows) → RC-1 (one line, app-wide look).
2. The 14 P0s below (three clusters: approval-checklist RC-7, financials RC-10, dashboard widgets).
3. RC-9 dark retune + RC-5 padding — global visual parity.
4. P1s by page, worst-first: add-invoice(16) → approvals(13) → payments/bank-statements(10 ea) → artists/contracts(9 ea) → releases/bank-matching/ledger/recoupments/flags(7 ea).
5. Missing-feature ports (each `pages/missing--*.md` is a build-ready port spec).

## All P0 defects — broken or absent core flows (14)

- **dashboard** — Notifications panel + /dashboard/notifications computed-alert feed (severity styling, Clear all, low-completion/missing-metadata/contract/admin-doc/overdue/pending-request alerts) missing — fix: cadence server/routes/dashboard.js (port OLD :156-317) + client/src/pages/Dashboard.jsx after :176 (HIGH)
- **dashboard** — Latest Releases 14-day carousel (art cards, Spotify hover badge + spotifyWebUrl deep link, relative dates, Open Catalog link) missing — fix: cadence client/src/pages/Dashboard.jsx between :78 and :81 (port OLD :47-80,462-531) (HIGH)
- **dashboard** — Releases-per-Month chart lost Year/Genre/Format filter bar, prior-year comparison bars, legend, custom tooltip, YAxis/grid, per-year domain, 260px height — fix: cadence client Dashboard.jsx:113-124 + server/routes/dashboard.js (port OLD server :10-127) (HIGH)
- **dashboard** — Bulk POST /releases/sync-artwork {days,force} + dashboard sync loop missing (only per-id sync at cadence server/routes/releases.js:15) — fix: cadence server/routes/releases.js + Dashboard.jsx per OLD :310-344 (HIGH)
- **flags-data-quality** — GET /api/flags selects nonexistent vendors.w9_name → 42703 → 500 on every request → entire /data-quality page dead (client toasts + renders null) — fix: cadence server/routes/flags.js:48 (+ vendor_w9_mismatch block :113-119) vs vendors DDL server/index.js:832-845; nothing populates w9_name anywhere (HIGH)
- **artists** — DELETE /artists/:id lost Superadmin gate + has-releases 409 guard + cleanup — any member deletes; releases orphan via ON DELETE SET NULL; entity_files/R2 leak — fix: cadence server/routes/artists.js:220-232 (+ server/index.js:380) (HIGH)
- **contracts** — CT-1 Contract detail view removed entirely — rows unclickable; Contract Details grid, royalty two-box + split bar, notes, Documents section unreachable (boom Contracts.jsx:461-673 vs cadence Contracts.jsx:156) (HIGH)
- **approvals** — APR-1 Approval checklist absent end-to-end — no deck/fields/lib client-side, no validateApprovalChecklist server gate, no writeApprovalChecklist, no approval_checklist column; approve is a bare status UPDATE reachable from every entry point and by raw API (cadence ledger.js:420-442,1011-1041; Approvals.jsx:45-53,135 vs boom bookkeeping.js:101-187,3543-3544,3844-3853; ApprovalChecklistDeck/Fields + lib/approvalChecklist.js) (HIGH)
- **add-invoice** — Approval checklist review gate gone — approver Save files straight to approved with no ReviewDeck/ApprovalChecklistFields step (doc preview, cleared-per-open answers, complete-before-save lock) — fix: cadence client/src/pages/AddLedgerEntry.jsx:109-154 (port OLD BkAddInvoice.jsx:481-488,1786-1893 + lib/approvalChecklist.js) (HIGH)
- **add-invoice** — Server checklist contract absent — POST /ledger/entries accepts no checklist, no validate-BEFORE-insert, no approval_checklist storage/stamp, no checklist_stored flag — fix: cadence server/routes/ledger.js:164-246 (port OLD bookkeeping.js:104-190,996-1002,1245-1305) (HIGH)
- **financials** — Executive dashboard depth missing wholesale — weekly spend ComposedChart (paid/unpaid/received, 4wk MA, avg refline, biggest-week), payment aging + upcoming due (invoice-anchored due dates), cash forecast 30/60/90, monthly rollup (sortable, dual Difference readings, month links), top-spend dimension toggle + expandable /exec/subbreakdown category mixes, rep leaderboard, category composition trend — each an OLD panel with zero NEW counterpart — fix: port OLD Financials.jsx:185-1564 + server /exec (financials.js:654-1399) (HIGH)
- **financials** — Paid/unpaid distinction absent from every NEW figure; "Expenses" blends unpaid commitments with no on-page basis disclosure — OLD splits everywhere + basis row :1684-1701 — fix: cadence server /summary,/analytics split by payment_status + client disclosure (HIGH)
- **financials** — No drill-through anywhere (KPIs/pie/vendors/months un-clickable); OLD KpiDrillModal + /exec/rows w/ 14 buckets — OLD client :1863-2002, server :1535-1732 (HIGH)
- **vendor-submit** — Payment-details subsystem missing (ACH/Wire/PayPal capture, encrypted vendor_payment_details store, reuse-on-file, doc-vs-typed payment_check + last4) — NEW records only a method string; AP can't pay from a submission — fix: cadence server/routes/vendor.js:173,185 + client VendorSubmit.jsx step 1 (OLD vendor-submit.js:64-65,656-679,872-911,1044,1184-1240; OLD client :1200-1258) (HIGH)

## All P1 defects — major feature gaps (198)

### dashboard (5)
- Genre donut lost in-slice % labels, count legend, "N releases" tooltip; geometry shrank; server injects 'Unspecified' bucket OLD excluded — fix: cadence Dashboard.jsx:125-136 + server/routes/dashboard.js:80-81 (HIGH)
- This Week/Next Week calendar-week buckets w/ colored dots + View all replaced by flat 21-day list — fix: cadence server/routes/dashboard.js:66-71 + Dashboard.jsx:143-158 (HIGH)
- "Team Members" headline stat removed — fix: cadence server/routes/dashboard.js:16-31 + Dashboard.jsx:12-18 (HIGH)
- My Tasks / Pending Approvals top-row action link-cards (overdue pill, due-today sub-line, amber pill) demoted to lower widgets; bk gate widened to Approver — fix: cadence Dashboard.jsx:71-108 per OLD :420-448 (HIGH)
- Fetch errors swallowed (.catch(() => {})), no error screen — failed load renders zeros as data — fix: cadence Dashboard.jsx:34-39 per OLD :369-375 (HIGH)

### my-work (4)
- 'Urgent' priority level dropped (4→3 levels; server 400s it) — fix: server/lib/constants.js:27 + client/src/constants.js:21 + components/mywork/taskFields.js:20-22 (HIGH)
- To Do Today triage lost: In-progress section, Start, snooze-to-tomorrow, "Reschedule all → today" rollover, Plan-your-day suggestions, "Also today" strip (reviews/mentions/statement-cutoff) — fix: client components/mywork/TaskSurface.jsx new Today module per OLD MyWork.jsx:1230-1461,726-771 (HIGH)
- My Releases tab missing (completion bars, days-until, HIGH badge, self-assign panel + search, unassign, 4-key sort) — fix: client pages/MyWork.jsx + releases slice (per OLD MyWork.jsx:1464-1601, team.js:256-335) (HIGH)
- Waiting-on-you rail gutted + gated to Approver+: mentions list w/ snippets, statement-cutoff countdown, stalled bulk deals, review rows, all-clear card gone; non-approvers get nothing — fix: components/mywork/WaitingOnYou.jsx per OLD components/MyWorkRail.jsx (HIGH)

### calendar (5)
- Selected-day sidebar panel removed (day cells unclickable; manual-event descriptions unviewable; no in-context delete) — fix: cadence client/src/pages/Calendar.jsx:108-138 (HIGH)
- "Upcoming (14 days)" panel removed (Today/Tomorrow/Nd distances, jump-to-day) — fix: cadence client/src/pages/Calendar.jsx (OLD :157-164,:326-357) (HIGH)
- dsp_submitted events dropped from feed — only live_date queried though dsp_submissions.submitted_date exists — fix: cadence server/routes/calendar.js:50-55 (HIGH)
- Task events widened from own-tasks (OLD t.user_id=$1) to ALL workspace tasks for every user — fix: cadence server/routes/calendar.js:24-27 (HIGH)
- No visible Add Event entry point — header button + date-choosable form replaced by opacity-0 group-hover per-cell +; unusable on touch, date not choosable — fix: cadence client/src/pages/Calendar.jsx:76-84,117-119 (HIGH)

### flags-data-quality (7)
- All 6 catalog/artist completeness checks missing (releases genre/UPC/ISRC/Spotify, artists genre/Spotify) + of_total denominators + uncapped counts — fix: port OLD server/routes/flags.js:542-662,1494-1500 + list sections OLD Duplicates.jsx:2702-2744 (HIGH)
- Overview view + two headline figures ("N need a decision · M fields incomplete", problem cards, completeness progress strip) missing — fix: cadence DataQuality.jsx per OLD Duplicates.jsx:626-648,830-845,1232-1332 (HIGH)
- Grouped nav lost: Money→Ledger→Catalog→Artists sticky rail (severity dots, problems-first, disabled-empty) + mobile <select> optgroups → 7 flat pills — fix: DataQuality.jsx:55-61 per OLD Duplicates.jsx:643-648,862-877,1181-1223 (HIGH)
- Ledger-flag fix machinery absent: apply-from-suggestion, inline editors, 5s pending fade + Undo, clear-placeholder, split modal (leftover-cents seed + balance meter), per-row/view-all invoice previews — NEW rows deep-link + dismiss only (DataQuality.jsx:110-116) — fix: port OLD Duplicates.jsx:503-617,1045-1135,2748-2998 (HIGH)
- Detectors missing: artist_likely_typo (Levenshtein + suggestion), artist_placeholder (namesAnArtist guard — its absence makes NEW's unknown_artist re-flag "n/a" junk), ledger-internal artist_variants w/ canonical election — fix: cadence flags.js:156-175 per OLD flags.js:824-956 (HIGH)
- Multi-artist normalization auto-detection gone (grouped strings w/ row count + spend, candidate radios, roster typeahead) — NEW manual pattern/base form only (DataQuality.jsx:122-137) — fix: port OLD server flags.js:709-743 + Duplicates.jsx:2290-2435 (HIGH)
- Human-flag inboxes homeless: no ledger flag button/inbox (expenses.flagged only written by campaign flows, artist-campaigns.js:133-140) and flagged_transactions impossible (no flagged col on bank_transactions, index.js:1535-1560) — fix: flag toggle in Ledger drawer + Flagged tab per OLD Duplicates.jsx:1673-1752 + OLD flags.js:1426-1488 (HIGH)

### artists (9)
- GET /artists/:id contracts no longer role-gated — royalty_split/advance visible to every member (OLD admin/superadmin/approver only) — fix: cadence server/routes/artists.js:87-92,109 (HIGH)
- Export feature missing end-to-end (release-window grid All-time/1/3/6/12/24mo + genre multi-select + XLSX w/ last_release_date) — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js (OLD client :375-400,:761-852; server :86-177) (HIGH)
- Bulk Spotify image sync missing (button + POST /artists/sync-images, link-first lookup, 100ms pacing) — only per-artist profile sync exists — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js (OLD client :402-417,:853-861; server :977-1082) (HIGH)
- Roster search missing — no client box, no server ?search param — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js:50-68 (OLD client :271-279,:862-876; server :34-37) (HIGH)
- Filter/sort toolbar missing: genre dropdown w/ own search + counts, All/Has/No Releases segment, Active-only toggle, 4-option sort — fix: cadence client/src/pages/Artists.jsx (OLD :438-484,:922-1026) (HIGH)
- Stat cards row missing (Total Artists/Genres/Total Releases/Active Roster) — fix: cadence client/src/pages/Artists.jsx (OLD :447-456,:881-918) (HIGH)
- Archived flow unreachable from roster: no archived section/restore, ?include_archived=1 has zero consumers — archived artists vanish (restore only via global search → profile) — fix: cadence client/src/pages/Artists.jsx (OLD :321-346,:1044-1063,:1117-1128) (HIGH)
- has_recent_release derived flag dropped from list endpoint (blocks Active-only + Active stat) — fix: cadence server/routes/artists.js:50-68 (OLD :44-66) (HIGH)
- Rename cascade lost: PATCH /:id doesn't update expenses.artist/deals.artist_name/artist_income.artist_name, no collision→merge 409; rename zeroes the artist's own Spends (name-matched, NEW :96-102) — fix: cadence server/routes/artists.js:138-158 (OLD :268-336) (HIGH)

### artist-profile (6)
- Spotify tab gutted: live GET /:id/spotify surface (PopularityRing, followers/tracks/releases/markets cards, genre chips, Open-on-Spotify, Top Tracks w/ popularity bars, discography grid, loading/error/null states) → 3 static stored-stat cards; endpoint absent in NEW — fix: cadence client/src/pages/ArtistProfile.jsx:243-256 + server/routes/artists.js (OLD client :60-246, server :1123-1222) (HIGH)
- Links tab: artist_links CRUD (14-platform add form, labels, delete; POST/PUT/DELETE endpoints) + Release Links aggregation across 5 URL fields gone — NEW is read-only chips over 7 artist columns; server endpoints absent — fix: cadence client/src/pages/ArtistProfile.jsx:272-280 + server/routes/artists.js (OLD client :684-818, server :534-582) (HIGH)
- Spends tab: approved-expense table (status/Recoup/Cobrand pills, canView-gated "Ledger →" ?focus deep-link) + Total/Unpaid/Top-category summary strip gone; aggregate returns no expense rows — fix: cadence client/src/pages/ArtistProfile.jsx:264-269, server/routes/artists.js:80-109 (OLD client :877-978) (HIGH)
- Contracts permission regression: OLD gates the tab by canView('/contracts') AND server returns [] below approver; NEW shows tab to everyone and serves contract rows (advance/royalty) to any label user — fix: cadence client/src/pages/ArtistProfile.jsx:144,310, server/routes/artists.js:87-92 (OLD client :518, server :436-451) (HIGH)
- Devlog delete authorization dropped: author-or-admin (server 403 + hidden trash) → unconditional server delete, trash shown to all, no confirm — fix: cadence server/routes/artists.js:205-217, client/src/pages/ArtistProfile.jsx:114-117,298 (OLD server :1327-1350) (HIGH)
- Artist delete guards dropped while adding a delete button to this page: OLD Superadmin-only + 409-if-releases + TX'd entity_files purge + FK sweep → NEW any-user bare DELETE; releases FK SET NULL orphans the catalog; artist entity_files rows/R2 objects leak — fix: cadence server/routes/artists.js:220-232, client :118-122,198 (OLD server :928-975; FK server/index.js:380) (HIGH)

### deals (4)
- DEF-DEALS-01 — DEAL_TYPES vocabulary replaced wholesale — NEW `constants.js:54` `Single/EP/Album/Multi-release/Distribution/Licensing` vs OLD `360 Deal/Master License/Single License/Distribution/Publishing/Other` (`DealPipeline.jsx:13`, OLD `deals.js:48`); OLD-valued rows render a blank select.
- DEF-DEALS-02 — Kanban caps at 3 columns (`Deals.jsx:108` `grid-cols-1 md:2 xl:3`) vs OLD 2/3/6 (`DealPipeline.jsx:292`) — 6-stage funnel never one row.
- DEF-DEALS-03 — Server dropped priority/deal_type value validation on POST+PATCH (`cadence deals.js:32-94`; OLD `deals.js:47-63,94-99`) — arbitrary strings persist.
- DEF-DEALS-04 — Deal file attachments removed end-to-end: no `/deals/:id/files` routes, no FilesPanel Documents in drawer, no paperclip+count on cards (OLD `deals.js:167-237`, `DealPipeline.jsx:358-362,560-568`).

### releases (7)
- REL-01 — Inline expanded-row 7-tab workspace (boom `Releases/index.jsx:686-1306`) replaced by navigation to `/releases/:id` (`Releases.jsx:201`); banner jump-chips, calendar-chip expand, per-row tab memory, and row-expand-in-place all gone.
- REL-02 — Filters reduced to Status+search (`Releases.jsx:143-144`); OLD Year/Month/Genre/Priority/Type selects + Archived toggle + Upcoming default (`index.jsx:43,548-581`) missing.
- REL-03 — Default scope regression: NEW list returns everything incl. `archived` rows, no catalog exclusion, always `release_date DESC` (`cadence releases.js:37-56`); OLD defaulted upcoming-ASC, excluded archived + in_catalog (`boom releases.js:452-462,509-516`).
- REL-04 — CHECKLIST mismatch: OLD 14 keys grouped Content(4)/Distribution(3)/Pitching(7) incl. `budget`,`marquee`,`stem_pitch`,`s4a_pitch` (`boom constants.js:5-21`); NEW 14 different keys grouped 5/2/7 (`cadence constants.js:25-49`) — items dropped/renamed, completion % not comparable.
- REL-05 — Merge: OLD N-way `/releases/merge` coalesces 20 cols, ORs 14 checklist flags, reassigns 9 child tables + budgets, recounts artists (`boom releases.js:253-436`); NEW pairwise `/flags/merge-releases` fills 10 blanks, folds only dsp+tasks — source checklist flags, comments, budget items lost (`flags.js:274-309`); no in-list multi-select/floating bar/keep-one modal (`MergeFlow.jsx`).
- REL-06 — Calendar uses UTC `new Date(r.release_date)` for day bucketing (`Releases.jsx:87`) — off-by-one west of UTC; OLD used `parseLocalDate` explicitly to fix this (`boom constants.js:53-58`, `CalendarView.jsx:25`).
- REL-07 — `DELETE /releases/:id` has no role gate (`cadence releases.js:162-174`) vs OLD hierarchy≤2 (`boom releases.js:927-931`); delete button shown to all roles (`ReleaseDetail.jsx:242` vs `index.jsx:1287`).

### release-detail (1)
- Architecture: 4-tab column + permanent 296px sidebar (Details/Metadata/Links/Notes/Actions read-mode cards, Edit/Save/Cancel dual-write PUT /:id ∥ PUT /:id/metadata + re-fetch) → single-column 7-tab form pages; zero read-mode presentation of any metadata/link/note field remains — fix: cadence client/src/pages/ReleaseDetail.jsx:105-247 (boom :365-838,:216-260) (HIGH)

### catalog (5)
- CAT-1 — Catalog membership model replaced: `in_catalog` flag + backfill + `PUT /:id/catalog` → client-side date inference; "Move back to tracker" confirm action gone; unreleased-but-dated projects auto-enter the catalog (cadence Catalog.jsx:17,48-49,64 vs boom Catalog.jsx:88-92,185-196,549-558; boom releases.js:8-23,880-899). Companion of REL-21.
- CAT-2 — Archived view requires `isReleased` first, so archived delayed/never-released (future- or un-dated) releases are invisible in both views; OLD pulled `archived=true&in_catalog=any` across catalog+pipeline (cadence Catalog.jsx:47-49 vs boom Catalog.jsx:88-92, boom releases.js:452-461).
- CAT-3 — Batch artwork sync gutted: 2-phase server batch (URI 500 + strict search 200, `not_found` sentinel, remaining count, retry/force/days, 50/100ms pacing) + client ≤30-batch loop w/ no-progress guard + 500ms gaps + status text (8s/6s auto-clear) → client loop over first 40 currently-filtered missing rows against a per-id endpoint; permanent misses retried forever, unfiltered/beyond-40 rows never swept, no remaining/status detail (cadence Catalog.jsx:66-72, cadence releases.js:13-35 vs boom Catalog.jsx:156-183,262-272, boom releases.js:46-160).
- CAT-4 — Artist filter missing: typeahead + datalist w/ case-insensitive dedup keeping most-common spelling + clear X + substring match (boom Catalog.jsx:215-224,318-338; absent in cadence).
- CAT-5 — Time filtering: 6 presets → 4 (no "6 Mo", no "Custom" from/to range); Year+Month selects w/ auto-set-current-year + preset mutual-exclusivity + Clear gone; preset order/labels changed (boom Catalog.jsx:38-45,96-154,362-416 vs cadence Catalog.jsx:10-15,37-43,86-88).

### contracts (9)
- CT-2 LinkedDataPanel + GET /:id/linked missing — recoupment emerald/amber stacked exposure bar + income-offset line, releases lifetime/during-term/recent-5, income by type, top-6 spend bars, unpaid chip (boom Contracts.jsx:1408-1645, boom contracts.js:408-538) (HIGH)
- CT-3 AI contract scan flow + POST /contracts/scan missing — PDF drop zone, _confidence map + ConfChip per field, fuzzy artist match + manual-fallback message, scanned File uploaded after create via /:id/files, "Contract created, but attaching…" recovery copy, ANTHROPIC_API_KEY setup error (boom Contracts.jsx:139-160,194-332,704-822,1647-1675; boom contracts.js:297-403) (HIGH)
- CT-4 financial_terms obligations dropped end-to-end — no schema column, no POST/PATCH field, no view list or inline editor (detail + create form); OLD data unrepresentable (boom Contracts.jsx:88-127,556-663,953-1032 vs cadence index.js:446-464, cadence contracts.js:19-22) (HIGH)
- CT-5 Missing Contracts panel + GET /missing gone — 3 collapsible buckets (noContract/noFile/expiredUnreplaced) w/ counts + click-through (boom Contracts.jsx:1045-1139, boom contracts.js:193-250) (HIGH)
- CT-6 Expiring panel + GET /expiring gone — 90-day window, ≤30/31-60/61-90 color buckets, days_until_expiry chips (boom Contracts.jsx:368-373,1141-1186, boom contracts.js:275-296) (HIGH)
- CT-7 Filters gone: artist search + type + status selects, and server ?artist/type/status params (boom Contracts.jsx:1188-1202, boom contracts.js:103-142 vs cadence contracts.js:41-56) (HIGH)
- CT-8 Multi-file document model gutted: entity_files revisions + FilesPanel + POST/GET/DELETE /:id/files + /:id/upload → single-slot POST /:id/file that deletes the prior R2 object; no revision history, no UI path to replace an existing file (boom Contracts.jsx:666-673, boom contracts.js:666-786 vs cadence contracts.js:158-185, cadence Contracts.jsx:163-169) (HIGH)
- CT-9 Inline PDF preview gone: FilePreview single-url + multi-files pager, per-row count badge + per-row files fetch + legacy fallback → new-tab open of one signed URL (boom Contracts.jsx:1273-1284,1324-1387 vs cadence Contracts.jsx:87-93) (HIGH)
- CT-10 royalty_split numeric→VARCHAR free text — artist/label two-box widget, live split bar, clamping, computed label share, and the table's Artist/Boom column all unrepresentable (boom Contracts.jsx:504-531,863-909,1297,1315-1323 vs cadence Contracts.jsx:117, cadence index.js:455) (HIGH)

### renewals (3)
- RN-1 — Days-left math regressed to the exact UTC-parse bug OLD fixed: Math.ceil((new Date(date)-new Date())/86400000) vs OLD's local-calendar daysUntilLocal (commented "expiring tomorrow read '2 days'") — banding shifts a day for most of the day (cadence Renewals.jsx:8 vs boom Renewals.jsx:30-34, boom utils.js:491-498).
- RN-2 — Scope narrowed from all-contracts tracker to Active-only lookahead: server adds status='Active' + expiration_date <= CURRENT_DATE + N days (UI max 180) — non-Active contracts and Active ones beyond the window unreachable in any UI state (cadence contracts.js:62-67 vs boom contracts.js:255-261).
- RN-3 — All 4 stat cards (Total Contracts/Expiring Soon/90 Days/Active) and 4 count-bearing filter pills (All/Expiring Soon/Active/Expired) removed; replaced by a 30-180d window select that can't express Expired or long-Active (boom :78-131 vs cadence :32-38).

### create-nda (4)
- NDA-1 — Legal template content replaced wholesale: OLD `standard` = the executed Boom 15-section NDA (Confidential Information w/ A-exclusions bullet list, Protection A–D, Injunction, Non-Circumvention 1yr, Non-Solicitation 2yr A–D, Return w/ 5-day certification, Relationship, No Warranty, Limited License, Indemnity, Attorney's Fees, Term 2y + 2y survival, General Provisions/CA law, Whistleblower Protection (DTSA), Signatories) and `invest` = corporate-counterparty variant (Purpose preamble, Personnel definition, §II(E) government-disclosure carve-out, 10-business-day retention/certification, no-further-obligation §V, Other Businesses §VIII, explicit Romans w/ IX/XII "[intentionally omitted.]", 1-year term, §§IV,V,VII–XI survive); NEW ships 3 short generic templates sharing ~6 boilerplate sections — none of the OLD text exists anywhere in cadence (boom standard.js:13-112, invest.js:39-125 vs cadence ndaTemplates.js:44-162).
- NDA-2 — Dirty-body auto-sync gone: OLD diff-substitutes changed watched fields into a hand-edited body (word-boundary regex escaping, 400ms debounce, flush-on-save, prevFormRef snapshots, effective-date formatted substitution); NEW freezes the body at first manual edit — later field changes silently diverge from the document (boom CreateNDA.jsx:171-229,344-352 vs cadence CreateNda.jsx:50-53).
- NDA-3 — No export/preview from saved rows: Preview modal + per-row Download PDF + Word (each rebuilt from the row's OWN template + template_data, incl. legacy no-body reconstruction) → Open/Delete only (boom :884-918,929-969,419-424 vs cadence :215-247).
- NDA-4 — Signature blocks dropped from all three renderers: structured OWNER/RECIPIENT By/Name/Title/Date blocks (recipient_signatory fallback, blank-Title omission, same-page PDF guard) → one inline "IN WITNESS WHEREOF" body paragraph with a literal "Name / Title" recipient placeholder (boom shared.js:105-133, CreateNDA.jsx:79-84,471-487,536-552 vs cadence ndaTemplates.js:159).

### label-waiver (2)
- LW-1 — Two granted-rights bullets missing from the waiver body: "digital exploitation (including ringtone & mastertones)… with mutual written approval" and "remixes… with mutual approval" — the issued legal document grants fewer enumerated rights than OLD's (boom CreateLabelWaiver.jsx:65-66 vs cadence CreateLabelWaiver.jsx:33-47).
- LW-2 — PDF-attach pipeline gone: OLD ships the generated PDF multipart on save; server exact-matches boom_artist → artists, stores it on the artist's Documents tab via entity_files/R2 ("Label Waiver" label), replaces in place on update, migrates/deletes on artist change and row delete. NEW is JSON-only with no artist_id/file_id columns — waivers never reach the artist profile (boom :213-227, boom label-waivers.js:43-91,109-269 vs cadence :95-108, cadence label-waivers.js:32-53, index.js:1373-1393).

### artist-clearance (5)
- AC-1 — 9 of 12 per-track top-row fields dropped (role, docs_needed, sample_review, release_date, royalty_comments, royalty_account, advance, recoupable_portion + release_id FK) — no input, storage, or XLSX cell (boom ArtistClearance.jsx:30-36,428-439 vs cadence ArtistClearance.jsx:14, clearanceXlsx.js:7-13).
- AC-2 — 6 of 16 SUB_FIELDS rows missing (Musician Credits, Recorded by, Lyrics, Stems / Masters?, Artwork?, Credits Approved?); surviving labels renamed ("Clean or Explicit"→"Explicit", "Samples / AI?"→"Samples / AI", "Writers (full names)"→"Writers") (boom :11-28, boom clearances.js:37-54 vs cadence :8-13, clearanceXlsx.js:7-13).
- AC-3 — Canonical XLSX template abandoned: OLD renders into server/templates/artist-clearance.xlsx (prefix-labeled header rows 1-12, real Date cell, 17-row track blocks from row 15, 13-col primary row, col-C/D sub-rows, cloned styling); NEW emits a from-scratch exceljs sheet w/ hardcoded indigo banner + 12-field label/value pairs — structurally a different document (boom clearances.js:26-183 vs cadence clearanceXlsx.js:19-67).
- AC-4 — Documents-tab attach pipeline gone: OLD uploads the generated XLSX to R2 + entity_files ('Artist Clearance Chart') on every save, replaces in place, migrates on artist change, cleans up on delete; NEW never persists a file (boom clearances.js:195-240,299-311,343-364,389-414 vs cadence clearances.js:73-125).
- AC-5 — Catalog linking degraded: TrackTitleInput autocomplete (EXACT MATCH chip), release_id binding w/ Linked badge/unlink/auto-unlink, manual-value-preserving applyReleaseToTrack (incl. release_date + featured_artists→credit), sibling-release exclusion all gone; NEW chips prefill only title/isrc/produced_by and allow duplicate adds (boom :42-53,398,419-424,576-643 vs cadence :39,98-103).

### approvals (13)
- APR-2 "Correct artist?" confirmation missing (boom approvalChecklist.js:24-29; ApprovalChecklistFields.jsx:96-133) (HIGH)
- APR-3 "Correct song?" confirmation missing (same) (HIGH)
- APR-4 "Correct amount?" confirmation missing incl. deck amount>0 save guard (boom ApprovalChecklistDeck.jsx:100) (HIGH)
- APR-5 "Correct category?" confirmation missing — grouped optgroup select + off-list stored value kept renderable + disabled-while-cobrand (boom Fields:60-91); NEW inline select flat, blanks on off-list values (Approvals.jsx:247) (HIGH)
- APR-6 "Bulk deal?" written answer missing — is_bulk_deal never a recorded decision at approval; "Marked bulk on the form" context line gone (boom Fields:164-172; bookkeeping.js:165) (HIGH)
- APR-7 "On cobrand?" written answer missing AND cobrand⇒category='Marketing' forcing absent everywhere in NEW (chip PATCH + server both; boom BkApprovals.jsx:294-311, bookkeeping.js:167); category-tick re-arm implication gone (approvalChecklist.js:62-69) (HIGH)
- APR-8 "Recoupable?" answer missing — recoupable never written at approval; DEFAULT-TRUE "nobody looked == yes" asymmetry reopened (boom bookkeeping.js:168-177; Fields:181-186) (HIGH)
- APR-9 "Campaign?" answer missing — cadence artist_campaign column (index.js:546) never written by any approve path; cobrand-implies-campaign (forced true, disabled buttons, contradiction refused) gone (boom approvalChecklist.js:83-95; bookkeeping.js:118-135) (HIGH)
- APR-10 W9 review deck missing end-to-end: per-DOCUMENT queue (alias-aware w9_entry_id/w9OwnersFor), signed_and_dated Y/N with non-boolean 400, prefill-from-scan + prefilled/accepted_prefill record, covers-N list, scan panel, no_w9 surfacing, w9_review column, "Review W9s N" button (boom bookkeeping.js:3400-3524; W9ReviewDeck.jsx; BkApprovals.jsx:817-830) (HIGH)
- APR-11 Split-before-approve breakdown EDITOR missing — OLD editable artist/song/amount rows travel in approve payload; NEW Split panel is read-only vendor allocation (boom BkApprovals.jsx:232-262,1811-1837; Deck:216-218 vs Approvals.jsx:263-280) (HIGH)
- APR-12 possible_duplicates queue annotation + amber banner missing (normalized inv# across vendor identities, ?focus links, leading-zeros caveat); NEW /check-dup serves add-forms only (boom bookkeeping.js:3339-3388; BkApprovals.jsx:1514-1544 vs ledger.js:1333-1352) (HIGH)
- APR-13 unknown_artist/unknown_song Levenshtein suggestions + one-click "Use X" apply (song apply writes release_id) missing from queue (boom bookkeeping.js:3212-3336; BkApprovals.jsx:452-478,1399-1462) (HIGH)
- APR-14 payment_check fraud banner missing (form-vs-invoice last4 mismatch + changed-bank-details warning) — payment_check absent from NEW entirely (boom BkApprovals.jsx:1481-1512) (HIGH)

### payments (10)
- DEF-PAY-01 — **EmailPreviewModal never opens** — rendered without its required `open` prop (`Payments.jsx:395`, also `Approvals.jsx:309`) and `EmailPreviewModal.jsx:14,41` returns null when `!open`; Send-for-Approval + single/bulk payment confirmations on this page open nothing and cannot send. Code-certain; click-through `UNVERIFIED — needs runtime check`.
- DEF-PAY-02 — Confirmation email states the parent slice, not the family total — ctx `amount: r.amount` (`Payments.jsx:183`; server analog `ledger.js:1573-1590`); OLD emailed familyTotal + attached invoice/proof (`bookkeeping.js:7393-7422,7540-7570`). No attachments in NEW confirmations.
- DEF-PAY-03 — Stat cards USD-only single figure — OLD per-currency native captions (never netted, `fmtTotals`) + USD headline (`BkPayments.jsx:69-132,3011-3051`); NEW `Payments.jsx:199-206`. "Paid This Month" → "Paid recently (7d)"; "Total entries" semantics changed.
- DEF-PAY-04 — Paid-linger window 7 days vs OLD 14 (`ledger.js:70,525-533` vs `bookkeeping.js:6013-6021`); NEW also dropped the `created_at` fallback for legacy rows.
- DEF-PAY-05 — Multi-invoice quick filter + per-vendor "N OPEN" chips missing — family-counted from the FULL set, held-excluded (held carried to tooltip), mixed-currency/method ⚠ "cannot be sent as one transfer", click-to-isolate via search (`BkPayments.jsx:44,1247-1281,3392-3421`).
- DEF-PAY-06 — Batch Payment modal gutted: no Payment Reference, no ONE-proof-uploaded-to-all, "— Same as invoice —" label lost (COALESCE behavior exists unlabeled) (`Payments.jsx:429-449`, `ledger.js:580-603`; OLD `BkPayments.jsx:1104-1156,1996-2089`).
- DEF-PAY-07 — Installments/partial UI unreachable from Payments: status pill inert — no Paid/"Partially Paid…"/Unpaid popover (also removes the page's only un-pay path), no Mark-partial link, no paid/total progress, no modal (`Payments.jsx:361-363`; OLD `BkPayments.jsx:3586-3681,3788-3810,2450-2662`). Server parity exists (`ledger.js:1794-1877`) but only the Ledger drawer uses it.
- DEF-PAY-08 — Calendar view missing (toggle + month grid + legend + day chips, `BkPayments.jsx:2995-3007,3054-3141`).
- DEF-PAY-09 — Toolbar missing wholesale: search, amount grammar `500|500-1000|>500|<=250` w/ amber invalid state, Method/Status/Rep(+No rep) filters, Group by Method/Status, 6 sorts incl. family-aware USD amount comparator (`BkPayments.jsx:52,1276-1358,3153-3249`; NEW has only 7 chips + CSV, `Payments.jsx:214-219`).
- DEF-PAY-10 — Bulk confirmations don't bundle multi-invoice vendors into one email — one item per row (`Payments.jsx:175-197`; `ledger.js:1594-1616`); OLD grouped by vendor_email → `bulk_payment_confirmation` per-vendor queue (`BkPayments.jsx:664-743`; `bookkeeping.js:7648-7838`). NEW's dispatch kind exists (`emailDispatch.js:34`) but is never used with grouped ids.

### ledger (7)
- LED-1 Bulk selection + bulk edit missing end-to-end — checkbox col, renderable-set select-all + "M below the visible rows", Set artist/song/category panels (datalists, comma-in-song refusal), QB ✓, Not recoupable, one-undo previous[] regroup; server POST /bk/entries/bulk (BULK_FIELDS whitelist artist/song/category/payment_method/in_quickbooks/recoupable; amount/payment_status/status refused; changed/already/skipped/relinked accounting + autoLinkRelease per row) has no NEW analog client or server (boom BkLedger.jsx:2239-2298,3566-3714; bookkeeping.js:8937-9070) (HIGH)
- LED-2 CSV export understates split invoices — exports parent slice `amount` w/ children excluded (parent_id IS NULL), includes voided rows, honors no filters; OLD exported family_amount + child_artists, excluded voided, carried ?source (cadence ledger.js:1639-1662 vs boom bookkeeping.js:8322-8355) (HIGH)
- LED-4 Manual flag-for-review absent from ledger — FlagButton col, flagged/unflagged filter (amber tint), reason popover, POST /flag; NEW ⚠ filter = AI scans only; expenses.flagged written by Artist Campaigns is invisible here (boom BkLedger.jsx:1838-1865,3206-3218,3883-3892; bookkeeping.js:1967-1998 vs cadence Ledger.jsx:323; index.js:659-663) (HIGH)
- LED-5 Amount-filter semantics wrong — bare "500" matches ≥500 (OLD exact ±0.005), ">"/"<" collapse to ≥/≤, $/commas not stripped, no invalid-input amber border/tooltip (cadence Ledger.jsx:27-35,382 vs boom utils.js:247-280; BkLedger.jsx:3100-3115) (HIGH)
- LED-6 Editable-field vocabulary shrunk — in_quickbooks absent from NEW entirely (col/filter/bulk/schema-use); ufr, artist_campaign (3-state), social_handles, recoupment_label (Tone Labels), release_id, paid_by, payment_date, bulk_deal_quantity/unit/completed, ufr_marked_at dropped from PATCH allow-list and/or read-only (boom bookkeeping.js:1528-1544; BkLedger.jsx:4480-4590 vs cadence ledger.js:94-100; Ledger.jsx:180-185) (HIGH)
- LED-8 Inline-edit coverage halved — payee/date/currency/paid-by/date-paid not inline; SocialsCell popover (platform/handle/$/per-artist tag on split families) → read-only cell reading artist_breakdown (post-split snapshot unparseable; social_handles never read); Terms→due-date write + due-date→'Custom' back-write gone; YN chips → text links (boom BkLedger.jsx:481-652,3893-4605 vs cadence Ledger.jsx:37-53,152-196,607-618) (HIGH)
- LED-12 Export menu reduced to one CSV — Excel workbook, Invoices ZIP, W9s ZIP, Files ZIP (artist/category/search-scoped w/ honest "which filters apply" label) all missing; NEW vendor-zip/bulk-zip unreachable from ledger (boom BkLedger.jsx:3315-3391 vs cadence Ledger.jsx:364-366) (HIGH)

### add-invoice (16)
- Checklist answer bulk_deal never asked — is_bulk_deal stays default FALSE = "nobody looked" — fix: cadence server/routes/ledger.js:164-246 + AddLedgerEntry.jsx (HIGH)
- Checklist answer cobrand never asked; no cobrand form checkbox; cobrand→category='Marketing' forcing rule absent at create — fix: cadence server/routes/ledger.js:164-246 + AddLedgerEntry.jsx (OLD client :1772-1789, server :1010-1021) (HIGH)
- Checklist answer recoupable never asked — hardcoded default TRUE recreates the untracked-recoupable failure — fix: cadence server/routes/ledger.js:210 (HIGH)
- Checklist answer campaign never asked — artist_campaign column (index.js:546) never written at create nor cascaded to children — fix: cadence server/routes/ledger.js:164-246 (HIGH)
- The 4 checklist CONFIRMATIONS (artist/song/amount/category) w/ edit-in-place write-through + answerCobrand re-arm missing — fix: cadence client (OLD approvalChecklist.js:24-31,63-69; BkAddInvoice.jsx:1823-1852) (HIGH)
- /validate-invoice document gate gone (is-it-an-invoice/billed-to checks, red issues banner, green pass chip) — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD bookkeeping.js:3941-3991; client :786-843) (HIGH)
- /extract-invoice-number + typed-vs-printed normalized mismatch warning gone — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :4072-4118; client :845-861) (HIGH)
- /parse-lines line-item flow gone end-to-end (deterministic amounts + tie-out, editable per-line category/artist/recoupable, remainder helper); NEW splits can't carry per-line category/description/recoupable — fix: cadence server/routes/ledger.js:335-352,397-407 + AddLedgerEntry.jsx (OLD :4120-4263; client :1436-1533,548-576) (HIGH)
- /validate-w9 auto-validation on W9 attach gone (claude.validateW9 exists in lib but unrouted/uncalled) — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :3997-4070; client :393-407,1057-1093) (HIGH)
- /parse-proof gone — proof no longer extracts payment_date/method/ref, client doesn't set Paid, "Auto-marks as paid" hint false for non-approvers, proof-remove doesn't reset payment fields — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx:198 (OLD :4769-4797; client :391-431,1010) (HIGH)
- suggest-vendor gone: exact-match autofill of vendor_email/address/bank + "Did you mean?" chips (NEW /ledger/vendor-suggest exists at :830 but page never calls it) — fix: cadence client/src/pages/AddLedgerEntry.jsx (OLD :4455-4482; client :152-186,1113-1129) (HIGH)
- vendor-w9-status "W9 already on file — Preview" banner + W9 tile already-on-file state gone — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :4490-4517; client :176-186,975-979,1131-1150) (HIGH)
- Duplicate UX degraded: debounced-live + post-parse sweep → onBlur only; entry-linked banners (Open in Approvals / ?focus= routing, pending explanation), similar tier, amber tint gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:52-56,235 (OLD :189-199,318-343,753-806,1213-1253) (HIGH)
- Server 409 duplicate gate + force_duplicate "Add anyway" bypass gone — exact dups insert freely — fix: cadence server/routes/ledger.js:164-246 (OLD :1069-1082,4571-4623; client :646-668) (HIGH)
- Vendor email no longer required nor format-validated (nor parse-filled) — fix: cadence client/src/pages/AddLedgerEntry.jsx:112-116,231 (OLD :455-462) (HIGH)
- Non-admin gate gone: song + ≥1 social handle no longer required for non-admin submitters — fix: cadence client/src/pages/AddLedgerEntry.jsx:112-116 (OLD :463-473) (HIGH)

### add-reimbursement (3)
- Vendor email removed in reimbursement mode (OLD required + regex) — reimbursement rows carry no payee contact — fix: cadence client/src/pages/AddLedgerEntry.jsx:231,112-116 (OLD BkAddReimbursement.jsx:184-192,413-418) (HIGH)
- Invoice # field removed AND checkDup early-returns when isReimb — no reference recordable, zero dup detection for reimbursements client or server — fix: cadence client/src/pages/AddLedgerEntry.jsx:53,213 (OLD :77-86,440-453) (HIGH)
- Multi-receipt upload (N files → entity_files, count + Clear all) collapsed to single receipt_file column slot; proof can displace the receipt slot via direct API — fix: cadence client AddLedgerEntry.jsx:44,196 + server/routes/ledger.js:170-181 (OLD client :95-116,241-246,339-364; server :4695-4713) (HIGH)

### create-invoice (2)
- Payment-terms/due-date engine missing — no Net 15/30/45/60/90/Custom vocabulary, no server-computed due date; `due_by` is free text stored verbatim and PUT-writable, so printed deadline and terms can silently disagree — fix: port boom lib/payment-terms.js + /terms + /due-date, derive due_by on write; cadence server/routes/invoices.js:37-85, server/index.js:850 (HIGH)
- Client-side date math / reader-TZ rendering — `new Date(created_at).toLocaleDateString`/`longDate` reproduces the documented after-5pm-prints-yesterday bug; live preview prints Date.now() — fix: server-attached `invoice_date = businessDay(created_at)` + string-part formatting; cadence client/src/pages/CreateInvoice.jsx:15,177,272,306,330 (HIGH)

### vendors (2)
- Merges irreversible/unrecorded — no vendor_merge_log, no merges list, no Unmerge; deleting the alias chip erases the only trace (boom bookkeeping.js:5785-5868) — fix: port mergeVendors logging + /merges + /unmerge + drawer history; cadence server/routes/ledger.js:887-907 (HIGH)
- Payment/bank details regression — plain-text vendors.bank readable+editable by any Approver, no encryption, no audit-on-read (OLD encrypted vault, Admin-only, audit per read, boom :5881-5924) — fix: cadence ledger.js:776,797-810; Vendors.jsx:109 (HIGH)

### bank-statements (10)
- DEF-BST-01 — **Library not month-grouped** — flat created_at list (`BankStatements.jsx:92-108`); OLD "Statements by month" card: X/Y reconciled header, month rows w/ coverage bar + open/"clear", expandable per-statement rows w/ "copy N", per-statement coverage + matched/debits, open_value/open_credits (`BkStatements.jsx:806-1133`; `statements.js:1671-1717`).
- DEF-BST-02 — Coverage badges + overlap warnings missing — no "No {account} statement covers this month" badge, no `overlaps_with` computation/badge (`bank-statements.js:238-243`; OLD `BkStatements.jsx:847,858-869`, `statements.js:1718-1727`). Flags engine's paypal-uncovered/gap ≠ the library badges (pointer).
- DEF-BST-04 — Batch upload missing — single file (no `multiple`), no {done,total,phase} progress, no per-file failure banner, no post-upload parse polling per file, no auto-open of a single ready upload (`BankStatements.jsx:56-67,85`; OLD `BkStatements.jsx:442-498,698,712-728`).
- DEF-BST-07 — **Re-parse missing** — OLD strictly-additive transaction re-parse (identity diff, insert-missing-only, never deletes, automatch+rules over added rows, only_in_database reported, background + import_summary.reparse, doubling-signature warning, rules-verified balance persist) (`statements.js:4816-4995`; `BkStatements.jsx:500-598`); NEW has balance-only `reparse-balance` (`bank-statements.js:375-410`) — recovery from a short AI parse is delete+re-upload, destroying matches.
- DEF-BST-08 — **Extras audit missing** — statement-proves-N/app-holds-M balance-proof audit, group tables, removal w/ missingCount>0 refusal ("relabelled, not duplicated" guard that saved 206 real rows), booked-income block, affected-expense report, 429 single-flight, header chip + ✓ matches badges (`statements.js:4997-5160,5547-5614`; `BkStatements.jsx:158-206,664-682,929-970,1062-1117`).
- DEF-BST-09 — **Misfiled repair missing** — reference-repeat detection (invisible to count audits by construction), payee-only rewrite keeping id/date/amount, match released only on payee change, invented-booking unbook guarded on entry_source, unclear left alone, "N misfiled · $V" badge (`statements.js:5169-5354`; `BkStatements.jsx:107-156,939-945,998-1061`).
- DEF-BST-11 — **Deterministic parse pipeline missing** — no rules parser, no reconciliation gate against printed balances/section totals, no pdfjs-dist path, and no audit recording which path ran / parse outcome (NEW logs upload before parsing, `bank-statements.js:272`) (`statements.js:883-913,1026-1029`; `lib/statement-pdf.js:28-48`).
- DEF-BST-12 — **PDF parse captures no currency** — 7-field prompt (no CURRENCY/AMOUNT_USD), parsePipeLines all-USD (`bank-statements.js:37-47`; `bankReconcile.js:186-220`) — recreates the ¥237,858-as-$237,858 class OLD repaired at four sites (`statements.js:817-845,1497-1597`); INDN/TRANSFER payee rules also dropped (people's names become vendors).
- DEF-BST-14 — **Within-statement dedupe collapses real transactions** — description-equality fallback includes the same statement's rows, so N identical same-day charges import as 1 (OLD's extras case: 30 real $1.00 fees/day; OLD dedupes within a statement only on a real reference + backfills refs) (`bank-statements.js:99-107` vs `statements.js:227-265`).
- DEF-BST-16 — **Matching never re-runs** — no detail-open freshness pass, no nightly sweep, no additive /rematch-all (409-not-zero, per-statement report), no /reset-matching (auto+manual clear, manual_not_recovered accounting); nothing on either NEW surface (`statements.js:4788-4795,5638-5821`; boom `index.js:2410`). Invoices approved after ingest are manual-only forever.

### bank-matching (7)
- Dimension lens absent (Category⇄Artist column toggle; chips/filter/column/sort follow; click-value filters; artist-bucket canonicalization; by-construction empty state) (boom BkBankMatching.jsx:79,2495-2570,2899-2917,2952-3040) — fix: cadence BankMatching.jsx table (HIGH)
- Artist attribution absent from entire surface — no ArtistSelect pre-book on open rows, no editable artist on booked rows, none in deck/split, no artist-names roster (boom :199-217,1012-1060,3076-3100,4155-4210) — fix: cadence BankMatching.jsx + StatementReviewDeck.jsx (HIGH)
- Open rows can't be BOOKED from the queue table (no inline category book / create-entry form / bulk book) — "three honest answers" reduced to two outside the deck (boom :1028-1060,3607-3646,960-990) — fix: cadence BankMatching.jsx:235-267 (HIGH)
- Batch view (vendor-clustered clearing: proposals, select-all, uniform category, apply/dismiss + progress) absent; NEW vendor chips only write no-invoice rules on a different pile (boom :494-575,4636-4746) — fix: cadence BankMatching.jsx:520-532 (HIGH)
- Deck has NO undo — OLD ⌫ history w/ per-kind inverses incl. unrematch, rebook restore, no-invoice+unbook, reopen (boom :1240-1321) — fix: cadence StatementReviewDeck.jsx (HIGH)
- Deck card types 9→2: rematch/rebook/choose/keep/reversal cards gone; booked-w/-invoice-waiting rows never enter; weak candidates fall through to book instead of asking which invoice (boom :1090-1155,2003-2027,3958-4290) — fix: cadence StatementReviewDeck.jsx:71-76; BankMatching.jsx:133 (HIGH)
- Multi-invoice attach unreachable — /tx/:id/attach + capacity + allow_prepayment has zero client callers; no group_proposal offers, no InvoiceAttachPicker (cadence bank-matching.js:224-236, statementLinks.js:28-95; boom :713-775,3201-3236,4090) — fix: wire attach into queue + deck (HIGH)

### upload-rules (2)
- Rule-suggestions engine absent (mining, invoice-census match/category/no-invoice/dismiss/artist split, bookPatternFor provable-pattern gate, clears/conflicts/also-matches/covers-N-of-M; boom statements.js:7216-7477, BkRules.jsx:278-421) — fix: port /rule-suggestions into cadence bank-matching.js + RulesPanel section (HIGH)
- annotate=1 leak reporting absent — no per-BOOK-rule queue_rows/queue_usd/ledger_payees(real_invoices, clears), no feeding-the-queue amber, no pair-it action (boom statements.js:10245-10307; BkRules.jsx:445-466); unpaired rules feed the needs-invoice queue invisibly — fix: annotate cadence category-rules + surface in RulesPanel (HIGH)

### financials (4)
- Cross-page artist/category/rep FilterBar + /filter-options missing — OLD client :1441-1496, server :671-691,:1406-1440 (HIGH)
- Range picker gutted: no custom from/to or 3m/6m/12m; period chips scope only /summary while chart/vendors/P&L are hard-wired 12mo (silent mixed-period page) — NEW client Financials.jsx:12-17,:91-95; NEW server :97,:102 (HIGH)
- Per-artist P&L silently drops money: LOWER(artist) (no TRIM) inner-mapped onto roster names — non-roster/blank/whitespace-variant artists vanish; OLD groups by expense artist string incl. 'unassigned' row — NEW server financials.js:113-133 vs OLD :880-888 (HIGH)
- Excel export gutted: OLD 14-sheet styled board packet (Cover…Full Ledger, scope-filter aware, server :1734-2912) → 3-section client CSV (NEW client :60-67), no server endpoint (HIGH)

### reports (3)
- Review deck over drill cells missing entirely (→/←/⌫ full undo incl. dismiss-restore, F flag, D dismiss, 1-9 usage-ranked category hotkeys, P doc panel, money progress, done summary) — OLD Reports.jsx:639-875,:2826-2976; NEW ReviewDeck component exists but unused on /reports (HIGH)
- P&L line filter (pnlQ) missing: no input, no "Subtotal of shown" rows, no "(all lines)" relabel, no no-match rows — OLD :935-1033,:1239-1248,:1470-1483 (HIGH)
- Balance sheet counts drawdowns as LIABILITIES (total_liabilities = A/P + advances), reversing OLD's documented funding re-class (John 2026-08-07); Funded-by block + accumulated deficit + funding-hide missing — NEW server/routes/reports.js:736-738 + BalanceSheetCard.jsx:83-94 vs OLD server :1907-1985,:2003-2018 (HIGH)

### recording-budgets (2)
- Budget|Fund type model gone entirely: no type/fund_amount, no Type segmented control, no fund summary panel (Recording Fund Available / Total LP Budget / Balance Due on Delivery / Contingency), no fund costs summary — fix: schema index.js:751-766 + page (HIGH)
- qty × unit_price line-item model gone (amount-only rows, no computed totals, no per-section qty/price header labels: #Tracks/Price Per Unit, Days/Rate Per Day, #Tracks/Day Rate, Quantity/Estimated Cost…) — fix: schema index.js:769-777; recording-budgets.js:111-115 (HIGH)

### recoupments (7)
- Unreviewed bank-born rows counted as recoupable: `bookDebitAsEntry` creates approved+Paid `entry_source='bank_statement'` rows inheriting `recoupable DEFAULT TRUE`; recoupment/planning queries have no `recoup_reviewed` gate (column absent repo-wide), no review queue, no class rules — recreates the documented $3.1M unvetted-spend failure — fix: `financials.js:150-156,203-209,283-291`; `bank-statements.js:170-176`; `index.js:487` (HIGH)
- No bank-evidence join → detail has no four state sections (rose Unverified first / Verified / Awaiting w/ honest-silence copy / Unpaid) and no `recoupState` anywhere, though `utils/recoupState.js` + `lib/bankEvidence.js` exist and serve other pages — fix: `Recoupments.jsx:198-216`; `financials.js:203-206` (HIGH)
- Claim-the-provable band gone: no `provableUnclaimed` (verified ∧ unclaimed), no Upload-all-N bulk claim w/ stamp-decides-statement confirm, no per-artist emerald unclaimed rows, no "Most provable, unclaimed" sort — fix: index view (absent) (HIGH)
- Stat cards gone: Recoupable·bank-basis (3-way note), Uploaded (no-bank-line sub-link), Pending Upload (provable-now note), Paid/Unpaid click-to-filter tiles, USD headline + native tooltip + item counts, collapsible bar w/ inline headline — fix: page top (absent) (HIGH)
- `recoupment_label` (upload-batch vocabulary) absent end-to-end: no column, no chips/editor/datalist, no label filter incl. `__none__`, no label sub-buckets, no Set-Label bulk actions — fix: schema + page (HIGH)
- Per-artist statement tabs gone: OLD's URL-backed `?statement=` strip (Pending / Uploaded / Total / per-month w/ counts, tone-coding, bookmarkable) replaced by one global Statements tab grouping all artists by month; no pending/uploaded/total views, no per-tab scoping of rows/selection — fix: `Recoupments.jsx:100-125` (HIGH)
- `ufr-bulk` unscoped + PRESERVE violated: no recoupable/status/deleted/voided/prior-year re-check, no 2000 cap, unconditionally restamps already-UFR rows to NOW() (silently moves committed items between statements on replay/stale client), claim-only (no `ufr:false`), response `{committed}` vs OLD's `{ufr,changed,already,requested,skipped}`, no `bk_audit_log` write (table exists, `db.js:31`) — fix: `financials.js:302-316` (HIGH)

### recoupments-planning (3)
- Staged-plan model gone: no "Add to plan" on Recoupments, no localStorage working set / eligibility auto-prune / focus rehydrate / Reset plan — page shows the entire eligible pool and curation lives in a selection that resets every load — fix: RecoupmentPlanning.jsx:24 + NEW Recoupments.jsx (HIGH)
- Upload-batch labels absent end-to-end: no recoupment_label column, no label chips/menu, no Move-to-label, no group-by-label, no unlabeled counters; commit stamps no label so statements can't group by batch — fix: schema + financials.js:306-309 (HIGH)
- POST /recoupments/ufr-bulk re-checks nothing (recoupable/status/deleted/voided/parent/prior-year), uncapped, unconditionally restamps already-UFR rows (stale commit moves rows between statement months), no per-item audit (same root as DEF-RECOUP-11) — fix: financials.js:302-316 (HIGH)

### salary (2)
- Roster edit UI missing — server PATCH /salary/employees/:id has zero client callers; names/amounts uncorrectable in-app — fix: client/src/pages/Salary.jsx (add edit; OLD Salary.jsx:87-135) (HIGH)
- Remove-from-payroll missing — no DELETE route, no UI; PATCH active:false unreachable — fix: server/routes/salary.js + client/src/pages/Salary.jsx (OLD salary.js:144-152) (HIGH)

### team (4)
- No server-side privilege-escalation guards: Admin can invite/promote to Superadmin, edit Superadmins, demote the last Superadmin via POST /team + PATCH /team/:id (client-side hiding only; OLD settings.js:62-64,159-175 enforced) — fix: server/routes/team.js:57-105,127-160 (HIGH)
- Velocity analytics (per-member release velocity: stat cards, 12-mo trend table, on-time rate, recent releases) gone with no counterpart — fix: no NEW route/view (OLD team.js:105-213, Team.jsx:560-715) (HIGH)
- Per-user rep-visibility editor unreachable: /settings/visible-reps/:userId endpoints + ledger enforcement live, zero client callers; RepsManager only manages the label rep roster — fix: client (no UI; server settings.js:108-146, ledger.js:108) (HIGH)
- /team/:id member detail page missing (releases+tasks+activity; GET /team/:id, /:id/tasks) — see dedicated missing--team-member entry — fix: no NEW counterpart (OLD TeamMember.jsx, team.js:338-431) (HIGH)

### settings (1)
- Full export lost every file attachment (invoices/proofs/W9s/receipts/contracts/admin-doc vault) + formatted Excel workbooks; NEW ZIP = 15 CSVs + README — fix: server/routes/full-export.js:14-61 (OLD full-export.js:547-594,313-380) (HIGH)

### admin-docs (3)
- Restricted-confidentiality tier is decorative: no visibility filtering for non-Superadmins, no Superadmin-only create/edit/delete guards, form offers Restricted to any admin — fix: server/lib/fileResource.js (add guards) + client/src/pages/AdminDocs.jsx:59 (OLD admin-docs.js:47,115-117,151-156,202-204) (HIGH)
- Multi-file attachments → single slot; new upload silently deletes the previous file from R2; uploader/date/size listing gone — fix: server/lib/fileResource.js:100-118 + components/FileAttach.jsx (OLD admin-docs.js:226-288) (HIGH)
- No detail view / metadata editing — only status is mutable post-create; server PATCH supports all fields but nothing calls it — fix: client/src/pages/AdminDocs.jsx:34 (OLD AdminDocs.jsx:97-127,205-296) (HIGH)

### activity (2)
- All audit filters gone end-to-end (user/category/date-range+presets/search/department/method/sort) + the /activity/users dropdown endpoint — fix: server/routes/activity.js:10-22 + client/src/pages/Activity.jsx (OLD activity.js:14-87,141-159; OLD ActivityHistory.jsx:380-570) (HIGH)
- Pagination + total count gone — newest-100 (500 cap) only, older history unreachable — fix: server/routes/activity.js:12,20 + client/src/pages/Activity.jsx (OLD activity.js:89-133; OLD ActivityHistory.jsx:684-726) (HIGH)

### vendor-submit (5)
- Duplicate invoice# hard-409 at submit re-introduces the false-positive lockout OLD deliberately removed (normalizeInvoiceNum collapses 001/1/INV-/#) — fix: cadence server/routes/vendor.js:211-220 (OLD rationale vendor-submit.js:973-986) (HIGH)
- Draft resume broken: unconditional autosave clobbers the stored draft with the blank form on load before Resume is clicked; untouched visits also create a false "saved draft" banner — fix: cadence client/src/pages/VendorSubmit.jsx:61,65-78 (OLD guards :490-497) (HIGH)
- payment_terms 'Net 30' + scheduled_payment_date NOW()+30d not written — vendor submissions land unscheduled — fix: cadence server/routes/vendor.js:244-262 (OLD vendor-submit.js:1184,1193) (HIGH)
- Artist roster integration missing: no /roster endpoint, no RosterPicker, no off_roster flag, no server-side artist normalization — free-text artists fragment recoupment/report keys — fix: cadence server/routes/vendor.js + client VendorSubmit.jsx:352 (OLD vendor-submit.js:514-533,774,1088-1106; client :105-253) (HIGH)
- Pre-submit AI validation gone (/validate-invoice payment-info blocker + /validate-w9 signed/dated gate + step-2 issue lists) — fix: cadence server/routes/vendor.js (OLD vendor-submit.js:224-361; client :438-471,1651-1737) (HIGH)

### missing--approvals-archive (1)
- Archive UI missing — rejected/deleted invoices unrecoverable and unauditable from the client even though `GET /ledger/archive` exists server-side (ledger.js:1066, zero client callers) — fix: new archive page + restore/unreject actions (HIGH)

### missing--bank-ledger (1)
- Bank half of the ledger missing — statement-born spend (62% of OLD's rows) has no browsable/editable surface, no bank/invoices partition on `/ledger`, no `?source=` contract on list/export — fix: `bank` mode on Ledger reusing lib/ledgerSource (HIGH)

### missing--vendors-added-expenses (1)
- Entire surface missing — invoice-less (recoupment/campaign-born) payee aggregation with duplicate-entry + spelling-variant detection (OLD BkVendorsAdded.jsx + bookkeeping.js:5256); double-payments in these flows are invisible in NEW — fix: new subpage + endpoint reusing lib/artistKey + lib/usd; NOTE NEW's entry_source value is 'recoupment' (singular) per lib/ledgerSource.js:5 (HIGH)

### missing--bk-invoices (1)
- Invoices index/search surface missing — family-total invoice browsing with click-to-filter weekly submitted/paid charts (OLD BkInvoices.jsx + bookkeeping.js:8178); NEW `/invoices` is the unrelated outbound creator, `payment-analytics` (ledger.js:1502) is display-only on Payments — fix: new page + list endpoint; extend payment-analytics with range/vendor-admin split/week bounds (HIGH)

### missing--bulk-upload (1)
- OLD's AI batch invoice+proof ingest flow (`/bk/bulk-upload`: parse-all, proof auto-match, review grid, one-payment grouping, per-entry-rollback batch endpoint) has no NEW counterpart — NEW's "bulk upload" is the master-sheet data import and `bulk-zip` is file *retrieval* — fix: new page + `/ledger/entries/batch` + `/ledger/parse-proof` routes (HIGH)

### missing--recoupments-audit (1)
- Recoupment integrity audit missing — OLD `/recoupments/audit` (RecoupmentsAudit.jsx + bookkeeping.js:9520 GET /bk/recoupment-audit, all five predicates in ONE endpoint): artistless bank advances ($391,958.60 measured), never-judged bank pile ($3.0M), double-claimed invoices incl. cross-artist, claims with no document (family-aware has_doc), part-claimed split families — each with inline remediation (recoup-review, ufr-bulk, class rules); NEW recoupments can claim money but cannot check itself — fix: new page + aggregate endpoint + `recoupment_class_rules`/`recoup_reviewed` schema (HIGH)

### missing--bulk-deals (1)
- Bulk-deals tracker page missing — NEW has is_bulk_deal + label-scoped bulk_deal_items + a bare LedgerEntryDrawer checklist tab, but no surface for contracted-vs-delivered / paid-vs-delivered progress, stalled (30d) + paid-ahead (≥25pt) risk badges, per-unit economics, ghost slots, socials editor, completed archive (OLD BkBulkDeals.jsx 1002L + bookkeeping.js:13035-13159) — fix: new page + `GET /ledger/bulk-deals` rollup endpoint + `platform` col on bulk_deal_items + `bulk_deal_stalled` notification (HIGH)

### missing--team-member (1)
- `/team/:id` member detail page missing — per-person profile (avatar/role/EXEC badges, 4 stat tiles, 14-day incomplete-release alert) + Releases tab (assigned releases w/ checklist completion + days-until), Tasks tab (delegated-only visibility rule for non-privileged viewers, team.js:348-357), Activity tab (last 30 activity_log) (OLD TeamMember.jsx + team.js:338-431); NEW team.js has no detail GET and no client route — fix: new page + label-scoped `GET /team/:id` (HIGH; dup of team.md §7 P1 row — count once)

### missing--analytics (1)
- In-workspace usage analytics missing end-to-end — OLD `/analytics` (StrictAdminRoute) gave admins page-view/active-user/login/action stat cards, daily area chart, most-used-pages bars w/ friendly-name map, merged per-user activity table over 7/30/90d (Analytics.jsx + analytics.js + page_views table w/ /:id path normalization, 180-day sweep, Layout route-ping w/ dedup); NEW has NO page_views/pageview/`/api/analytics` (grep-verified — CLAUDE.md's retraction confirmed) while user_login_logs (auth.js:36) + activity_log sit unread — fix: new page + routes/analytics.js + label-scoped page_views table (HIGH)

### g-global-search (2)
- Page-palette search missing (NAV_PAGES+synonyms local match, canView-before-rank, top 6, renders during server flight) (OLD GlobalSearch.jsx:117-144,:295-313 + lib/pageSearch.js:21-49) — fix: port pageSearch + synonyms navConfig into cadence GlobalSearch.jsx (HIGH)
- Vendors + ledger-entry search missing client+server (alias-aware vendors → vendor page; leaf-only invoice#/payee/description entries → /ledger?q=; fail-closed bk gate) (OLD server/routes/search.js:17-32,:103-156; GlobalSearch.jsx:315-361) — fix: cadence server/routes/search.js + GROUPS (HIGH)

### g-notification-bell (2)
- Personal reminders absent end-to-end (no table/routes/UI; OLD reminders.js + notifications.js:349-358 + NotificationBell.jsx:154-167,:251-273 Done-advances-cadence, clear-all-exempt) — fix: port reminders label-scoped + bell section (HIGH)
- Five smart-alert kinds missing: budget ≥80% + budget_burn, contract_renewal (expiry × unreleased), release_behind escalation, release_unassigned, payment_rush (OLD notifications.js:59-78,:83-155,:184-244) — fix: cadence server/routes/notifications.js (HIGH)

### g-email-preview-modal (1)
- EmailPreviewModal never renders: requires `open` (EmailPreviewModal.jsx:14,:41) but both consumers omit it (Approvals.jsx:309, Payments.jsx:395); approve/reject pass notify:false expecting the modal (Approvals.jsx:47,:58) → vendor decision emails, payment confirmations + /mark-sent, and Send-for-Approval all silently dead — fix: pass open (HIGH)

## P2 / P3 — behavior & cosmetic divergences (by page)

Full text in each `pages/<slug>.md` §7 and `_defects-raw.md`. P4/P5 lines from a few agent passes are normalized into P3 here.

| Page | P2 | P3 | File |
|---|---|---|---|
| dashboard | 5 | 3 | pages/dashboard.md |
| my-work | 6 | 9 | pages/my-work.md |
| calendar | 6 | 14 | pages/calendar.md |
| flags-data-quality | 13 | 7 | pages/flags-data-quality.md |
| artists | 5 | 7 | pages/artists.md |
| artist-profile | 9 | 9 | pages/artist-profile.md |
| deals | 10 | 6 | pages/deals.md |
| releases | 15 | 8 | pages/releases.md |
| release-detail | 8 | 9 | pages/release-detail.md |
| catalog | 8 | 4 | pages/catalog.md |
| contracts | 7 | 7 | pages/contracts.md |
| renewals | 3 | 3 | pages/renewals.md |
| create-nda | 7 | 4 | pages/create-nda.md |
| label-waiver | 3 | 7 | pages/label-waiver.md |
| artist-clearance | 2 | 7 | pages/artist-clearance.md |
| approvals | 13 | 18 | pages/approvals.md |
| payments | 13 | 7 | pages/payments.md |
| ledger | 13 | 11 | pages/ledger.md |
| add-invoice | 11 | 7 | pages/add-invoice.md |
| add-reimbursement | 6 | 6 | pages/add-reimbursement.md |
| create-invoice | 7 | 6 | pages/create-invoice.md |
| vendors | 16 | 9 | pages/vendors.md |
| creators | 1 | 16 | pages/creators.md |
| bank-statements | 9 | 5 | pages/bank-statements.md |
| bank-matching | 14 | 21 | pages/bank-matching.md |
| upload-rules | 5 | 6 | pages/upload-rules.md |
| financials | 4 | 3 | pages/financials.md |
| reports | 7 | 14 | pages/reports.md |
| recording-budgets | 12 | 18 | pages/recording-budgets.md |
| recoupments | 13 | 16 | pages/recoupments.md |
| recoupments-planning | 5 | 19 | pages/recoupments-planning.md |
| artist-budgets | 0 | 17 | pages/artist-budgets.md |
| artist-campaigns | 3 | 18 | pages/artist-campaigns.md |
| salary | 4 | 9 | pages/salary.md |
| team | 4 | 4 | pages/team.md |
| settings | 6 | 7 | pages/settings.md |
| admin-docs | 4 | 6 | pages/admin-docs.md |
| activity | 5 | 7 | pages/activity.md |
| legal | 0 | 5 | pages/legal.md |
| manual | 2 | 3 | pages/manual.md |
| vendor-submit | 9 | 7 | pages/vendor-submit.md |
| login | 0 | 4 | pages/login.md |
| privacy-eula | 1 | 3 | pages/privacy-eula.md |
| missing--contracts-create | 1 | 0 | pages/missing--contracts-create.md |
| missing--approvals-archive | 1 | 0 | pages/missing--approvals-archive.md |
| missing--bank-ledger | 1 | 0 | pages/missing--bank-ledger.md |
| missing--ledger-matching | 1 | 0 | pages/missing--ledger-matching.md |
| missing--financials-month-drill | 1 | 0 | pages/missing--financials-month-drill.md |
| missing--recoupments-audit | 1 | 0 | pages/missing--recoupments-audit.md |
| missing--ad-allocation | 1 | 0 | pages/missing--ad-allocation.md |
| missing--vendor-preview-lab | 1 | 0 | pages/missing--vendor-preview-lab.md |
| g-sidebar-nav | 5 | 7 | pages/g-sidebar-nav.md |
| g-topbar-header | 1 | 5 | pages/g-topbar-header.md |
| g-global-search | 6 | 3 | pages/g-global-search.md |
| g-notification-bell | 5 | 4 | pages/g-notification-bell.md |
| g-toasts | 2 | 3 | pages/g-toasts.md |
| g-modal-overlay-primitives | 1 | 5 | pages/g-modal-overlay-primitives.md |
| g-keyboard-shortcuts | 5 | 4 | pages/g-keyboard-shortcuts.md |
| g-error-404-loading | 0 | 4 | pages/g-error-404-loading.md |
| g-empty-states | 0 | 4 | pages/g-empty-states.md |
| g-mobile-shell | 5 | 6 | pages/g-mobile-shell.md |
| g-theme-dark-mode | 4 | 2 | pages/g-theme-dark-mode.md |
| g-email-preview-modal | 3 | 3 | pages/g-email-preview-modal.md |

## Missing features (OLD-only surfaces, port specs in pages/missing--*.md)

| Feature | Severity | One-line status |
|---|---|---|
| Bulk AI invoice+proof upload (`/bk/bulk-upload`) | P1 | Parse-all, proof auto-match, review grid, one-payment grouping, rollback — NEW has only CSV import + bulk-zip |
| Approvals archive UI | P1 | `GET /ledger/archive` exists server-side, no client; restore endpoint also ungated (P2) |
| Bank↔Ledger page (`/bank-ledger`) | P1 | `?source=` partition + statement-lens tie-out beyond /bank-matching's scope |
| Ledger-side matching workbench (`/bk/ledger-matching`) | P2 | Bookkeeper-xlsx reconcile + 5 endpoints + lib/vendorMatch.js |
| Added-expense vendors subpage | P1 | Implicit vendors + dupe/variant detection; port must use NEW's `'recoupment'` (singular) entry_source |
| BK invoices index/search | P1 | Browse/search all invoices — NEW's /invoices is the outbound creator only |
| Financials month drill (`/financials/:month`) | P2 | Month-at-a-glance page; partial overlap with Reports cell drill |
| Recoupments audit | P1 | Five-check integrity surface + `recoupment_class_rules`/`recoup_reviewed` schema (P2 for class-rules concept) |
| Ad-pool allocation | P2 | Deliberately deferred in the 2026-08-27 build plan — still a gap |
| Bulk deals tracker | P1 | Full tracker page; NEW has only the is_bulk_deal flag + drawer checklist; watch the completed-column type collision |
| Team member detail (`/team/:id`) | P1 | Per-member profile page |
| In-workspace usage analytics | P1 | Absent end-to-end (page_views/ping/API); platform endpoint has zero client consumers (P2) |
| Vendor form preview lab | P2 | No write-nothing sandbox; admins must use the live form |
| Contract create flow | P2 | NEW has only AI draft-clause |
| User manual | — | **Exists** (CLAUDE.md claim of absence was stale) — real diffs logged in pages/manual.md |

## Intentional divergence register (176)

Multi-tenancy / auth / branding / security-hardening divergences — no action. Highlights per page; full lines in `_defects-raw.md`.

- **dashboard**: Chart/pie accent colors brand-var vs #E52017 (RC-2, runtime branding) · Subtitle "at Boom Records" → {label.name} · label operations (branding) · All queries label_id-scoped; activity LEFT JOIN label-matched (tenancy) · Bookkeeping widget native SQL + toUSD vs external Flask BK app; /bk/* links → /approvals · (+3 more)
- **my-work**: Hierarchy assign-down/request-up + task_type replaced by role/department model (canMutateTask/canAssignTo, unassign admin-only) — documented post-spec · Server permission gates where OLD PUT /team/tasks/:id had none (auth hardening) — tasks.js:542-549 · label_id scoping + in-tenant release/assignee validation (tenancy) — tasks.js:32-47,226-228,556-559 · /team-work new page, Approver+ route gate + server teamFilter dept scoping — App.jsx:93-98,139; tasks.js:67-73 · (+2 more)
- **calendar**: label_id scoping on all feed queries + tenancy-checked DELETE w/ 404 (vs OLD unscoped delete) — server/routes/calendar.js:13-56,128-140 · withTenant router middleware — server/routes/calendar.js:8 · Generic "Internal server error" bodies replace err.message leakage — server/routes/calendar.js:81 · logActivity on event create — server/routes/calendar.js:97 · (+2 more)
- **flags-data-quality**: Every query label-scoped; merge FKs re-validated in-tenant (flags.js:251-252,281-282) · Admin gating on merge/normalize mutations (matches OLD admin checks; read lockout reported separately as P2) · Generic 'Internal server error' bodies replace OLD err.message leakage · Brand tokens replace boom-* accents (RC-2); toasts replace alert() · (+3 more)
- **artists**: label_id scoping + withTenant throughout — server/routes/artists.js:11 · generic error bodies replace err.message leakage; logActivity on create/merge — artists.js:66,126; flags.js:264 · merge/duplicates relocated to flags surface; budget endpoints to artist-budgets.js (architecture; only cascade gaps are defects) · computed live total_releases replaces OLD's drift-prone stored counter — artists.js:55-57 · (+1 more)
- **artist-profile**: label_id scoping + withTenant on every query/route; artist-ownership re-validation before log/file writes — server/routes/artists.js:11,171,190-191,25 · brand-* accent replaces boom-* (RC-2) incl. avatar/bar tints · File GET via 1h signed R2 URL instead of direct getFileUrl href (cadence file-serving hardening) — server/routes/artists.js:273-287 · Leaf-rows-only spend dedupe (NOT EXISTS children) — carries the family_amount double-count fix (commit 82fa2b0); improvement over OLD's sum-everything · (+1 more)
- **release-detail**: label_id scoping + withTenant + in-tenant re-validation of assigned_to/release sub-resources (cadence releases.js:11,139-142,178-181; dsp.js:13-16) · RC-2 brand accent replacing boom-red on checks/bars/active tab/links throughout the page · Role-name admin gate ['Superadmin','Admin','Approver'] for owner select + team fetch (cadence ReleaseDetail.jsx:21,35,227) — Cadence auth model · Per-tenant Spotify artwork sync w/ spotify.isEnabled() graceful degrade (cadence releases.js:15-34); additive M4 features (DSP tab, status/owner Detai
- **contracts**: label_id scoping + withTenant + in-tenant artist_id re-validation (cadence contracts.js:11,103-106) · requireApprover replaces OLD requirePagePermission per-user grants (stricter auth model; same ruling as pending-contracts) (cadence contracts.js:13-15 · R2 signed-URL file access + tenant-namespaced keys replace /uploads disk paths (cadence contracts.js:92-95,170-172) · logActivity on create/upload; generic error bodies replace OLD err.message leakage; toasts replace alert(); RC-2 brand accent replaces boom red · (+1 more)
- **approvals**: label_id scoping + withTenant + router-level requireApprover + AdminRoute client gate · RC-2 brand tokens replace boom red + getDarkColors inline styles · Toasts + Skeleton.Card replace inline banners/spinner · Signed-URL file GETs replace ?token= URLs (documented hardening) · (+6 more)
- **ledger**: label_id tenancy + withTenant + requireApprover router gate; visibleReps rep-visibility on reads · RC-2 brand tokens + Tailwind replacing boom-red inline styles/getDarkColors · Signed-URL file GETs replace ?token= URLs (documented hardening) · Per-label:user column persistence key (vs OLD global localStorage key) · (+5 more)
- **add-invoice**: Tenancy: label_id everywhere, withTenant, per-label vendors upsert, tenant-namespaced R2 keys — server/routes/ledger.js:63,86-91,216-221 · Open-to-all-members create + pending routing w/ role-dependent subtitle + "Submitted for approval" toast (documented Cadence design) — App.jsx:180; le · Atomic multipart create (files ride the INSERT) vs OLD post-create uploads w/ swallowed failures — ledger.js:74-81 · Approver-gated "Mark as already paid" (OLD let any bk user create Paid rows) — AddLedgerEntry.jsx:219-230; ledger.js:183-191 · (+5 more)
- **add-reimbursement**: Receipt REQUIRED client-side (OLD optional; matches BUILD_SPEC) — server does NOT enforce, bypassable via direct API — AddLedgerEntry.jsx:116,196; led · Reimbursement is a live mode toggle on the shared component; admin route /ledger/new-reimbursement kept — App.jsx:182; AddLedgerEntry.jsx:28,188-191 · No member-facing reimbursement route — members reach the mode via the checkbox on /add-invoice · Approver-gated Mark-as-paid; tenancy/multipart/toasts/brand as add-invoice · (+2 more)
- **create-invoice**: Per-label invoice numbering + UNIQUE(label_id,invoice_number) + 409 retry; requireApprover gate; BOOM_INFO → labels.invoice_settings mechanism (all fi
- **vendors**: Label scoping + requireApprover router gate + AdminRoute page guard; vendors table + upsertVendor mechanism swap (regressions itemized above); logActi
- **creators**: label_id scoping + logActivity + activity-bot batch event; OBBBA year-dependent 1099 threshold shared with 1099 report (ledgerSource.js:38-41); W9 sha
- **bank-matching**: label_id scoping everywhere + requireAdmin router gate (≈ isStrictAdmin); logActivity instead of bk_audit_log; ONE /queue fetch over all statements ab
- **upload-rules**: Label-scoped rule tables + per-label unique indexes; requireAdmin router gate ≈ isStrictAdmin; ingest applies category rules only AFTER auto-match fai
- **financials**: Basis change: ledger-mastered P&L overview w/ income; cash depth relocated to /reports (reports.js:2-8) · Auth: requirePagePermission('/financials') → withTenant+requireApprover (tenancy) · FX: OLD locked-rate-else-1:1 native fallback → NEW rowUsd locked-else-live (correctness improvement; totals legitimately differ) — NEW server :6-11 vs · NEW-only income CRUD UI + per-artist income/net + category pie (additions) · (+1 more)
- **reports**: LEDGER-mastered basis replaces bank-mastered engine (bankRows/dedupe/txnParts, Unorganized lines, unverified section/drill, per-txn ids) — deliberate  · Reversal-pair machinery (banner w/ credit_total + still-marked-paid + statements-deck link, total exclusion, search tags, SBA excludes line) — recorde · /reports/search line-item search — recorded cut, _audit/00-inventory.md:180 · Label-level pool + ad allocation (+/bk/advertising routes, coverage-denominator split) — recorded cut, _audit/00-inventory.md:188,:180 · (+4 more)
- **recording-budgets**: Tenancy + gating: label_id everywhere + FK'd tables, requireApprover router gate, AdminRoute + Approver-only nav (OLD router was auth-only) · logActivity audit lines on create/status (OLD budgets router no-op'd its logger) · NEW chrome: toasts, Skeleton loader, PiggyBank empty state · Per-line-item ledger category picker from the per-label categories table (surfaces OLD's hidden line-item category column as UI)
- **recoupments-planning**: Tenancy + gating: label_id scoping, requireApprover router gate, AdminRoute + Approver-only nav item · USD conversion moved server-side onto locked fx_rate_to_usd (eUsd) replacing client FxRatesContext — cadence FX model, more correct · NEW chrome: toasts, Skeleton loader, shared formatDate · RC-2 accent (boom red → runtime brand)
- **artist-budgets**: label_id tenancy on every query + router-level requireApprover (OLD: inline isBkAdmin per route) · Export downloaded via Authorization-header blob (query-token auth removed app-wide); generic 'Failed' error bodies · wb.creator 'Boom Records' dropped (branding); shared utils/money + recoupState + BankEvidenceDot primitives replace page-local clones
- **artist-campaigns**: Ad-pool line + allocation modal deferred by the 2026-08-27 build plan (/reports/ad-pool flow) · Tenancy + requireApprover gate replacing OLD's grantable page permission (plain Users lose grantability) · Generic 'Internal server error' bodies; export via Authorization-header blob (no ?token=) · Chat mentions via shared recordMentions/user_mentions bell instead of bespoke mention payload + room deep-links · (+1 more)
- **salary**: label_id scoping + in-tenant employee re-validation (salary.js:22,100-101) · requireAdmin replaces requirePagePermission('/salary') grantable gate (effective UI access unchanged) · marked_by user-FK replaces paid_by name string · per-employee currency column/picker (NEW capability; its totals bug is the P2 above)
- **team**: Invite-link onboarding (passwordless create, 7-day token, resend, pending badge, copy fallback, email-sent/error surfacing) replaces admin-set passwor · token_version bump on real role/department change + sign-out warning toast (department is a trusted JWT claim) · Department constrained to DEPARTMENTS enum server-side (permission boundary in NEW) · Platform operators hidden from roster; invite links never built from the Host header · (+1 more)
- **settings**: Users tab (user CRUD + welcome-email preview) restructured onto /team invite-based flow (auth model; gaps counted in ## team) · Test Users tab + mocked-data guard dropped — multi-tenant demo workspaces supersede; documented deliberate in cadence CLAUDE.md · NEW-only sections: Account profile/password, workspace identity/branding (name/tagline/welcome/logo/accent), home-dashboard widgets + pinned links, ou · Permission save bumps target token_version (session refresh) replacing OLD's localStorage refresh beacon · (+2 more)
- **admin-docs**: Route /admin → /admin-docs + nav move System → Contracts & Legal (multi-tenant IA) · label_id scoping, label-namespaced R2 keys, signed-URL downloads, logActivity on create/upload (tenancy/auth architecture) · NEW-only inline status quick-change select on cards
- **activity**: label_id scoping + label-constrained user join (server/routes/activity.js:17-18) · Client route wrapped in AdminRoute (App.jsx:188) vs OLD's unguarded route — corrected form, same effective access
- **legal**: NEW implements the register OLD's placeholder only promised (list/status/attached signed doc) — forward-completion · /api/ndas repurposed builder-storage → tenant-scoped counterparty tracker; builder split to /api/nda-documents (cadence CLAUDE.md M4) · Tenancy/auth: label scoping, label-namespaced R2 keys, signed-URL file access, logActivity (server/lib/fileResource.js:30-117) · Nav label "Legal" → "NDAs" (Layout.jsx:40,269) matching narrowed content
- **manual**: Stale-doc correction: cadence CLAUDE.md still lists /manual as missing — it shipped (App.jsx:172, components/UserManual.jsx, server/routes/manual.js) · Content rewritten for Cadence, 34→27 sections (product/branding divergence; boom-only pages have no NEW equivalent) · Per-user USER_OVERRIDES (named-employee guidance) dropped — single-tenant content (OLD UserManual.jsx:466-489) · NEW-only: manual search, AI /api/manual/ask (key-gated 503 fallback), department "Start here", role-filtered tips · (+1 more)
- **vendor-submit**: Token-only public URL /submit/:token (slug not accepted) + per-label bootstrap (name/branding/reps/live categories) — cadence server/routes/vendor.js: · Per-label OG unfurl at /submit/:token — cadence server/index.js:250-261 (OLD static /submit, index.js:351-369) · Categories from per-label categories table in bootstrap payload vs OLD constants/context — cadence server/routes/vendor.js:57-60 · activity_log insert + activity-bot #activity event on submission — cadence server/routes/vendor.js:312-323 · (+2 more)
- **login**: /login route + token redirect — cadence client/src/App.jsx:112 · 409 multi-workspace picker (select + retry) — cadence server/routes/auth.js:82-85,147 + client Login.jsx:95-100 · Suspended-workspace 403 messaging on login/google/accept-invite — cadence server/routes/auth.js:95,152,309 · Forgot/reset-password flow (routes + ResetPassword.jsx) — cadence server/routes/auth.js:404-488 · (+2 more)
- **privacy-eula**: Boom entity name/address/contact/CA governing-law text can't carry to multi-tenant product; tokenized card shell + back-to-login link — cadence client
- **missing--bank-ledger**: OLD `/bk/ledger-matching` (bookkeeper xlsx diff) is a separate orphan, not this entry; NEW deliberately rebuilt matching as `/bank-matching` — the gap
- **missing--ledger-matching**: Reconciles ledger ↔ external bookkeeper spreadsheet — a third dataset NEW never ingests; distinct from both NEW `/bank-matching` (statement↔ledger) an
- **missing--financials-month-drill**: On port, use NEW lib/usd.js (locked-FX-wins) instead of OLD's inline `amount / COALESCE(NULLIF(fx_rate_to_usd,0),1)` divide-by-rate SQL, and label-sco
- **missing--recoupments-audit**: Not a statement-stamping audit-trail browser — it's a five-check integrity surface; the stamping rule it depends on (preserve `ufr_marked_at` on alrea
- **missing--ad-allocation**: Port v2 only — OLD's legacy `ad_pool_allocations` table + /ad-pool endpoints were never used ($267,674 pool, zero allocations in 6 months) and v2 exis
- **missing--bulk-deals**: Semantics collision: NEW `bulk_deal_completed` is INT count patched by artist-campaigns (artist-campaigns.js:361-363, index.js:665) while OLD's is a B
- **missing--team-member**: Port must reconcile OLD's admin-or-self task-visibility rule with NEW's department-as-permission-boundary (`teamFilter()` in routes/tasks.js), and dec
- **missing--analytics**: Boundary: NEW `GET /api/platform/analytics` (platform.js:382-416) is the cross-tenant OPERATOR growth feed, not this surface — and it currently has ze
- **missing--vendor-preview-lab**: Do not resurrect OLD's deleted `/admin/vendor-preview` (admin-only REAL-writing form, removed 2026-08-27 as a foot-gun; its path redirects to the lab,
- **g-sidebar-nav**: Workspace logo/name/tagline + "Powered by Cadence" footer (branding); Messages/Team Work/Brand/Marketing/Requests nav items + chat-unread badge are NE
- **g-topbar-header**: Demo-mode is_test banner dropped (test users scoped out); platform announcements banner stack + dismiss (NEW :196-202,:466-481); ViewAs empty state; p
- **g-global-search**: Label-scoped queries + ILIKE (tenancy); NEW-only keyboard navigation (arrows/Enter/active row) is an addition to keep.
- **g-notification-bell**: Label-scoping throughout; read_at schema; socket mention refresh + refetch-on-open; "View all" footer + /notifications page are NEW additions; {id} vs
- **g-toasts**: NEW unified all feedback into one context: 58 files/461 calls, 0 alert() vs OLD's 3 parallel systems + ~217 alert()/116 confirm() sites — improvement,
- **g-modal-overlay-primitives**: Kit architecture (portal/focus trap/Escape stack/scroll lock/aria) + ConfirmDialog focus-on-Cancel & busy state — NEW-only improvements, keep.
- **g-keyboard-shortcuts**: g-nav sequences (Layout.jsx:175-180), Deals/ReleaseDetail Esc, TaskSurface n/f/z/g/1-5 suite, registry-driven help + manual, escape-stack Esc, x-expor
- **g-error-404-loading**: NEW-only kept: ErrorBoundary root + per-route keyed + sourcemap logging + hard-reload (main.jsx:35, Layout.jsx:483, PlatformLayout.jsx:132); vite:prel
- **g-empty-states**: NEW standardized icon-card empty block on the 5 majors; Releases + TaskSurface truly-vs-filtered split w/ Clear-filters CTA (TaskSurface.jsx:293-311);
- **g-mobile-shell**: Chat tab (NEW-only messaging), Finance-tab canView fallback, tokenized surfaces, escape-stack BottomSheet, mywork mobile suite; OLD PullToRefresh/Long
- **g-theme-dark-mode**: Tokens-only dark architecture (0 dark: variants vs 39; no !important layer — deliberate), identical dark palette values OLD↔NEW, brand-ink 600→400 fli
- **g-email-preview-modal**: test_invitation dropped (test users out of scope) / approval_request added; safeCtx attachment-strip + tenant identity injection; per-label from/reply

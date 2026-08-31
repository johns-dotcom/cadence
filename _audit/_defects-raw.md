## calendar
- [P1] Selected-day sidebar panel removed (day cells unclickable; manual-event descriptions unviewable; no in-context delete) — fix: cadence client/src/pages/Calendar.jsx:108-138 (HIGH)
- [P1] "Upcoming (14 days)" panel removed (Today/Tomorrow/Nd distances, jump-to-day) — fix: cadence client/src/pages/Calendar.jsx (OLD :157-164,:326-357) (HIGH)
- [P1] dsp_submitted events dropped from feed — only live_date queried though dsp_submissions.submitted_date exists — fix: cadence server/routes/calendar.js:50-55 (HIGH)
- [P1] Task events widened from own-tasks (OLD t.user_id=$1) to ALL workspace tasks for every user — fix: cadence server/routes/calendar.js:24-27 (HIGH)
- [P1] No visible Add Event entry point — header button + date-choosable form replaced by opacity-0 group-hover per-cell +; unusable on touch, date not choosable — fix: cadence client/src/pages/Calendar.jsx:76-84,117-119 (HIGH)
- [P2] Approver role lost contract events — gate narrowed to Superadmin/Admin (OLD included approver) — fix: cadence server/routes/calendar.js:15 (HIGH)
- [P2] safeQuery per-source degradation dropped — one failing source query 500s the whole feed — fix: cadence server/routes/calendar.js:16-56,79-82 (HIGH)
- [P2] Hotkeys ←/→/t/n missing (useHotkeys hook exists in NEW, unused here) — fix: cadence client/src/pages/Calendar.jsx (OLD :123-128) (HIGH)
- [P2] Clicking a manual event chip immediately triggers delete confirm — destroy is the only interaction — fix: cadence client/src/pages/Calendar.jsx:68 (HIGH)
- [P2] No loading skeleton; fetch errors swallowed (.catch(() => {})) — empty grid indistinguishable from failed load — fix: cadence client/src/pages/Calendar.jsx:30 (HIGH)
- [P2] Add-event modal hand-rolled, not ui/Modal — no focus trap/escape stack; Escape doesn't close — fix: cadence client/src/pages/Calendar.jsx:142-159 (MED)
- [P3] Per-type event icons (Music/FileText/CheckSquare/Disc3/Calendar) absent — fix: cadence client/src/pages/Calendar.jsx:10-17 (HIGH)
- [P3] Filter model 5 grouped chips → 6 flat chips w/ different labels (Expiring/Signed/DSP live) — fix: cadence client/src/pages/Calendar.jsx:10-17,89-98 (HIGH)
- [P3] Legend card removed (merged into filter chips) — fix: cadence client/src/pages/Calendar.jsx (OLD :360-371) (HIGH)
- [P3] Live "{N} events" header count replaced by static subtitle — fix: cadence client/src/pages/Calendar.jsx:74 (HIGH)
- [P3] Per-day chip cap 3→4 before "+N more" — fix: cadence client/src/pages/Calendar.jsx:122,133 (HIGH)
- [P3] Past-day numbers no longer dimmed text-gray-300 — fix: cadence client/src/pages/Calendar.jsx:116 (HIGH)
- [P3] Grid geometry: fixed 42-cell 6-week grid w/ adjacent-month days vs needed-weeks-only + inert pads; min-h 104 vs 100; day circle w-5 vs w-6 — fix: cadence client/src/pages/Calendar.jsx:45-50,114-116 (HIGH)
- [P3] Type→color remap beyond RC-2 (dsp purple→blue, manual gray→violet); chip border-box→dot+tint; raw bg-*-50 with no dark remap — fix: cadence client/src/pages/Calendar.jsx:11-16,127 (HIGH; dark rendering UNVERIFIED)
- [P3] Month nav relocated to PageHeader; month label moved to filter row; centered fixed-width label lost — fix: cadence client/src/pages/Calendar.jsx:76-88 (HIGH)
- [P3] Feed drops subtitle/meta (artist, assignee, release_type, priority); title composition differs per type — fix: cadence server/routes/calendar.js:58-76 (HIGH)
- [P3] NEW-only feed filters vs OLD: releases status != 'Archived'; expiring contracts status = 'Active' — fix: cadence server/routes/calendar.js:21,45 (HIGH)
- [P3] calendar_events.event_type column dropped; POST rejects it; kind hardcoded 'event' — fix: cadence server/index.js:1411-1420 + server/routes/calendar.js:74-76,88-96 (HIGH)
- [P3] Dead code: unused Trash2 import (client :3); PATCH /api/calendar/:id has no client consumer (server :106-125); unused hardcoded color 'violet' (client :60) (HIGH)
- [P3] Event chips navigate on click (link) — behavior OLD lacks; makes chip-click semantics kind-dependent w/ delete-on-click — fix: cadence client/src/pages/Calendar.jsx:68,123-131 (HIGH)
- [INT] label_id scoping on all feed queries + tenancy-checked DELETE w/ 404 (vs OLD unscoped delete) — server/routes/calendar.js:13-56,128-140
- [INT] withTenant router middleware — server/routes/calendar.js:8
- [INT] Generic "Internal server error" bodies replace err.message leakage — server/routes/calendar.js:81
- [INT] logActivity on event create — server/routes/calendar.js:97
- [INT] {success,data} response envelope (client matched) — server/routes/calendar.js:78
- [INT] brand accent replaces boom red (RC-2) — client/src/pages/Calendar.jsx:11,116
## dashboard
- [P0] Notifications panel + /dashboard/notifications computed-alert feed (severity styling, Clear all, low-completion/missing-metadata/contract/admin-doc/overdue/pending-request alerts) missing — fix: cadence server/routes/dashboard.js (port OLD :156-317) + client/src/pages/Dashboard.jsx after :176 (HIGH)
- [P0] Latest Releases 14-day carousel (art cards, Spotify hover badge + spotifyWebUrl deep link, relative dates, Open Catalog link) missing — fix: cadence client/src/pages/Dashboard.jsx between :78 and :81 (port OLD :47-80,462-531) (HIGH)
- [P0] Releases-per-Month chart lost Year/Genre/Format filter bar, prior-year comparison bars, legend, custom tooltip, YAxis/grid, per-year domain, 260px height — fix: cadence client Dashboard.jsx:113-124 + server/routes/dashboard.js (port OLD server :10-127) (HIGH)
- [P0] Bulk POST /releases/sync-artwork {days,force} + dashboard sync loop missing (only per-id sync at cadence server/routes/releases.js:15) — fix: cadence server/routes/releases.js + Dashboard.jsx per OLD :310-344 (HIGH)
- [P1] Genre donut lost in-slice % labels, count legend, "N releases" tooltip; geometry shrank; server injects 'Unspecified' bucket OLD excluded — fix: cadence Dashboard.jsx:125-136 + server/routes/dashboard.js:80-81 (HIGH)
- [P1] This Week/Next Week calendar-week buckets w/ colored dots + View all replaced by flat 21-day list — fix: cadence server/routes/dashboard.js:66-71 + Dashboard.jsx:143-158 (HIGH)
- [P1] "Team Members" headline stat removed — fix: cadence server/routes/dashboard.js:16-31 + Dashboard.jsx:12-18 (HIGH)
- [P1] My Tasks / Pending Approvals top-row action link-cards (overdue pill, due-today sub-line, amber pill) demoted to lower widgets; bk gate widened to Approver — fix: cadence Dashboard.jsx:71-108 per OLD :420-448 (HIGH)
- [P1] Fetch errors swallowed (.catch(() => {})), no error screen — failed load renders zeros as data — fix: cadence Dashboard.jsx:34-39 per OLD :369-375 (HIGH)
- [P2] Time-of-day greeting ("Good morning, {first}." text-3xl font-black) replaced by static "Welcome, {first}" text-xl — fix: cadence Dashboard.jsx:48 per OLD :210-214,407-417 (HIGH)
- [P2] Full-page load skeleton (PageHeader + StatCards + chart blocks) missing; shell paints with em-dashes — fix: cadence Dashboard.jsx early return per OLD :356-367 (HIGH)
- [P2] `r` refresh hotkey missing — fix: cadence Dashboard.jsx add useHotkeys per OLD :346-348 (HIGH)
- [P2] ReconciledBadge drift: bordered emerald-50 pill, full month name, inline placement → borderless emerald-100 uppercase + icon, short month, own row — fix: cadence components/statements/ReconciledBadge.jsx:18-26 + Dashboard.jsx:47 (HIGH)
- [P2] Bookkeeping widget lost recent-invoices list, invoice-count and "% of logged" sublabels, Review-now CTA, Open Ledger link — fix: cadence Dashboard.jsx:94-106 + server /widgets payload :113-119 (MED)
- [P3] Upcoming stat counts today (>= CURRENT_DATE) and excludes Archived vs OLD > CURRENT_DATE unfiltered — fix: cadence server/routes/dashboard.js:20 (HIGH)
- [P3] Overdue/due-today buckets use server CURRENT_DATE vs OLD local-calendar client helpers (midnight TZ drift) — fix: cadence server/routes/dashboard.js:86-92 or client-side per OLD :283-289 (MED)
- [P3] No refetch on acting-user switch (OLD deps [user?.id]) — fix: cadence Dashboard.jsx:34-39; impact UNVERIFIED — needs runtime check (LOW)
- [INT] Chart/pie accent colors brand-var vs #E52017 (RC-2, runtime branding)
- [INT] Subtitle "at Boom Records" → {label.name} · label operations (branding)
- [INT] All queries label_id-scoped; activity LEFT JOIN label-matched (tenancy)
- [INT] Bookkeeping widget native SQL + toUSD vs external Flask BK app; /bk/* links → /approvals
- [INT] ReconciledBadge target /bk/statements → /bank-matching + reopened state (cadence bank-matching model)
- [INT] Welcome banner, pinned quick links, per-widget visibility from label.settings.dashboard (per-workspace customization)
- [INT] "Pending QB" metric dropped (QB import scoped out per project decision)
## deals

Page: Deal Pipeline — OLD `boom-dashboard/client/src/pages/DealPipeline.jsx` + `server/routes/deals.js` vs NEW `cadence/client/src/pages/Deals.jsx` + `server/routes/deals.js`. Detail: `_audit/pages/deals.md`. Stages identical; RC-1/2/5/6 apply.

- DEF-DEALS-01 · P1 · DEAL_TYPES vocabulary replaced wholesale — NEW `constants.js:54` `Single/EP/Album/Multi-release/Distribution/Licensing` vs OLD `360 Deal/Master License/Single License/Distribution/Publishing/Other` (`DealPipeline.jsx:13`, OLD `deals.js:48`); OLD-valued rows render a blank select.
- DEF-DEALS-02 · P1 · Kanban caps at 3 columns (`Deals.jsx:108` `grid-cols-1 md:2 xl:3`) vs OLD 2/3/6 (`DealPipeline.jsx:292`) — 6-stage funnel never one row.
- DEF-DEALS-03 · P1 · Server dropped priority/deal_type value validation on POST+PATCH (`cadence deals.js:32-94`; OLD `deals.js:47-63,94-99`) — arbitrary strings persist.
- DEF-DEALS-04 · P1 · Deal file attachments removed end-to-end: no `/deals/:id/files` routes, no FilesPanel Documents in drawer, no paperclip+count on cards (OLD `deals.js:167-237`, `DealPipeline.jsx:358-362,560-568`).
- DEF-DEALS-05 · P2 · Per-card "Next ›" one-click stage advance missing (OLD `DealPipeline.jsx:371-381`).
- DEF-DEALS-06 · P2 · Follow-up date always amber + long format (`Deals.jsx:139`); OLD amber only when overdue via LOCAL-date compare, short "Follow up: Jun 12" (`DealPipeline.jsx:32-49,351-355`).
- DEF-DEALS-07 · P2 · Priority tonal text pill → unlabeled 6px dot (`Deals.jsx:12,134`; OLD `:23-27,347-349`).
- DEF-DEALS-08 · P2 · Stage color system lost: colored dots, per-stage tinted headers, styled count chip hidden-at-0 (`Deals.jsx:117-120`; OLD `:51-67,313-322`).
- DEF-DEALS-09 · P2 · "Drop here" permanently rendered on every empty column; OLD dashed hint only during drag over a different-stage column; NEW drop highlight also fires on the card's own stage (`Deals.jsx:112-115,145`; OLD `:294-306,387-391`).
- DEF-DEALS-10 · P2 · Drag plumbing lost dragCounters ref, isDifferentStage gating, effectAllowed/dropEffect (`Deals.jsx:112-127`; OLD `:136,196-231`); child-hover flicker UNVERIFIED — needs runtime check.
- DEF-DEALS-11 · P2 · Drawer closes and discards edits on FAILED save — `patchDeal` swallows the error and `.then(onClose)` still runs (`Deals.jsx:61,164-169`); OLD stayed open w/ inline "Save failed" (`:433-440`).
- DEF-DEALS-12 · P2 · Drawer missing Last Contact input (payload still sends `last_contact_date`, `Deals.jsx:167`) and missing Spotify Monthly Listeners field entirely (OLD `:467-475,503-524`).
- DEF-DEALS-13 · P2 · `added_date` column dropped (`cadence index.js:420-437`) — drawer "Added <date>" impossible; list order changed to `updated_at DESC` (`cadence deals.js:21`) so columns reshuffle after edits (OLD `added_date DESC`).
- DEF-DEALS-14 · P2 · Drawer lost Move Stage pill row + inline Saved ✓ status (`Deals.jsx:181-189,206-209`; OLD `:527-559`).
- DEF-DEALS-15 · P3 · API parity: `GET ?stage=` filter and `DELETE` `data.id` response dropped (`cadence deals.js:18-29,97-106`; OLD `:24-31,157-160`) — client-unused.
- DEF-DEALS-16 · P3 · `offer_amount || null` nulls a legitimate 0 offer on drawer save (`Deals.jsx:166`; OLD preserved 0, `:110-117`).
- DEF-DEALS-17 · P3 · Add form: no Cancel/✕, Artist lost `required` (empty submit silent no-op, `Deals.jsx:43`), option label wording diffs (OLD `:255-287`).
- DEF-DEALS-18 · P3 · Card cosmetics: hover grip handle gone, genre/rep merged one line showing `—` when empty, delete ✕→Trash2, no min-h-[16rem] columns (`Deals.jsx:129-141`; OLD `:302,333-369`).
- DEF-DEALS-19 · P3 · Loading skeleton shows 6 kanban columns, live board maxes at 3 (`Deals.jsx:104` + `Skeleton.jsx:71`).
- DEF-DEALS-20 · P3 · Drawer shell: dimmed bg-overlay backdrop, max-w-md, z-[60] vs OLD transparent, max-w-sm, z-50 (`Deals.jsx:172-173`; OLD `:399-400`).

Intentional/additive (8): tenancy scoping (`withTenant`/label_id/parseInt guards); `contact`+`links` fields (documented M4); ObjectDiscussion embed (M6 object threads); logActivity + activity-bot stage announcements; toasts replacing alert(); Escape hotkey; empty-pipeline state card; brand-accent hover/drop tints per RC-2.
## releases

Full report: `_audit/pages/releases.md`. OLD = boom `pages/Releases/` folder + `server/routes/releases.js`+`dsp.js`; NEW = cadence `pages/Releases.jsx` + `pages/ReleaseDetail.jsx` + `components/DspTracker.jsx`/`ReleaseExtras.jsx` + `server/routes/releases.js`+`dsp.js`+`flags.js`.

- REL-01 P1 — Inline expanded-row 7-tab workspace (boom `Releases/index.jsx:686-1306`) replaced by navigation to `/releases/:id` (`Releases.jsx:201`); banner jump-chips, calendar-chip expand, per-row tab memory, and row-expand-in-place all gone.
- REL-02 P1 — Filters reduced to Status+search (`Releases.jsx:143-144`); OLD Year/Month/Genre/Priority/Type selects + Archived toggle + Upcoming default (`index.jsx:43,548-581`) missing.
- REL-03 P1 — Default scope regression: NEW list returns everything incl. `archived` rows, no catalog exclusion, always `release_date DESC` (`cadence releases.js:37-56`); OLD defaulted upcoming-ASC, excluded archived + in_catalog (`boom releases.js:452-462,509-516`).
- REL-04 P1 — CHECKLIST mismatch: OLD 14 keys grouped Content(4)/Distribution(3)/Pitching(7) incl. `budget`,`marquee`,`stem_pitch`,`s4a_pitch` (`boom constants.js:5-21`); NEW 14 different keys grouped 5/2/7 (`cadence constants.js:25-49`) — items dropped/renamed, completion % not comparable.
- REL-05 P1 — Merge: OLD N-way `/releases/merge` coalesces 20 cols, ORs 14 checklist flags, reassigns 9 child tables + budgets, recounts artists (`boom releases.js:253-436`); NEW pairwise `/flags/merge-releases` fills 10 blanks, folds only dsp+tasks — source checklist flags, comments, budget items lost (`flags.js:274-309`); no in-list multi-select/floating bar/keep-one modal (`MergeFlow.jsx`).
- REL-06 P1 — Calendar uses UTC `new Date(r.release_date)` for day bucketing (`Releases.jsx:87`) — off-by-one west of UTC; OLD used `parseLocalDate` explicitly to fix this (`boom constants.js:53-58`, `CalendarView.jsx:25`).
- REL-07 P1 — `DELETE /releases/:id` has no role gate (`cadence releases.js:162-174`) vs OLD hierarchy≤2 (`boom releases.js:927-931`); delete button shown to all roles (`ReleaseDetail.jsx:242` vs `index.jsx:1287`).
- REL-08 P2 — Search covers only title+artist (`Releases.jsx:63-69`); OLD also ISRC/UPC and bypassed server filters at ≥2 chars w/ 300ms debounce + fetch-generation guard (`index.jsx:193-236,256-263`).
- REL-09 P2 — Banner: fixed-open, includes 100%-complete releases (no `pct<100` filter, `Releases.jsx:73-78`), 6-chip cap, chips lack countdown color classes and jump-to-checklist behavior (`NotificationBanner.jsx`, `index.jsx:130-137,266-269`).
- REL-10 P2 — Table drops merge checkbox, Genre col, Priority badge + future-date rule (`index.jsx:651-655`), inline Archive button (`index.jsx:668-682`), emerald-at-100% bar; Project cell not an anchor (`Releases.jsx:192-215`).
- REL-11 P2 — Calendar chips: no complete/high/priority/standard color rules or legend or today marker (`CalendarView.jsx:73-120`), 3-chip/day cap, and calendar ignores active filters (`Releases.jsx:85` uses `releases` not `shown`).
- REL-12 P2 — Create form lost Genre/Priority/UPC/ISRC/Producer/Featured/Notes, artist find-or-create-by-name, and required release_date (`Releases.jsx:128-137` vs `AddReleaseModal.jsx:52-105`, `boom releases.js:777-807`).
- REL-13 P2 — List hotkeys n/v/j/k/Enter/1-7 absent (`index.jsx:149-164`; no useHotkeys in `Releases.jsx`).
- REL-14 P2 — DSP Submitted/Approved badge colors swapped (`DspTracker.jsx:9-15` vs `boom constants.js:30-36`); platform renamed `iHeart Radio`→`iHeartRadio` + order change (`cadence lib/constants.js:16-19` vs `boom dsp.js:7-10`); wire field `dsp_name`→`platform`.
- REL-15 P2 — Budget tab: no Total/Cap/Remaining summary bar w/ 80%/100% thresholds, no 9-category grouping + per-category totals (`index.jsx:1031-1106`); categories come from expense list via CategoryOptions (`ReleaseExtras.jsx:57`) not `BUDGET_CATEGORIES` (`boom constants.js:38`); money 0-decimals (`ReleaseExtras.jsx:36`).
- REL-16 P2 — Metadata tab missing apple_id, presave_link, presave_analytics, ugc_link, apple_music_link, subgenre, distributor_notes, cover_art_status (`ReleaseDetail.jsx:184-201`, allowlist `cadence releases.js:120-128` vs `index.jsx:811-840`, `boom releases.js:728-733`).
- REL-17 P2 — Comment delete authorization dropped: NEW server checks label only (`cadence releases.js:243-256`) vs OLD author-or-admin (`boom releases.js:1167-1181`); client shows delete to everyone (`ReleaseExtras.jsx:72` vs `index.jsx:967-974`).
- REL-18 P2 — `PATCH /:id` logs nothing (`cadence releases.js:131-160`): checklist/archive/status/owner changes untracked; `release_audit_log` + `GET /:id/audit` absent (`boom releases.js:698-711,1107-1118`).
- REL-19 P2 — Artist immutable after creation: `artist_id` not in PATCH UPDATABLE and no UI field; OLD PUT find-or-creates artist by name (`boom releases.js:577-593`).
- REL-20 P2 — Priority model `standard|priority|high priority` + red/yellow badges → `High|Medium|Low` (`cadence constants.js:21`), rendered nowhere on list/calendar.
- REL-21 P2 — Mark as Released / `PUT /:id/catalog` in_catalog toggle missing (`index.jsx:1273-1279`, `boom releases.js:881-899`); status select is the lossy stand-in.
- REL-22 P2 — List endpoint params month/date_from/date_to/artist/search/genre/priority/release_type/upcoming/archived/in_catalog/limit gone (`boom releases.js:439-534` vs `cadence releases.js:37-60`).
- REL-23 P3 — Checklist toggle non-optimistic, no in-flight disable → rapid-toggle race (`ReleaseDetail.jsx:84,43-51` vs flushSync+rollback `index.jsx:271-298`).
- REL-24 P3 — Budget add-item form has no Description input though state + POST accept it (`ReleaseExtras.jsx:56-60`).
- REL-25 P3 — "N releases" count header missing (`index.jsx:597-599`).
- REL-26 P3 — Skeleton: generic `Block h-64` (`Releases.jsx:151`) vs `PageHeader + Table rows=8 cols=8` (`index.jsx:508-515`).
- REL-27 P3 — No budget-item edit route (OLD `PUT /:id/budget-items/:itemId`, `boom releases.js:1058-1084`).
- REL-28 P3 — Activity matched by `ILIKE %project_name%` (cross-entity false hits, breaks on rename; `cadence releases.js:186-206`) vs `%release #id%` (`boom releases.js:862-878`); date-only display.
- REL-29 P3 — Expanded header SVG progress ring + colored countdown label missing (`index.jsx:718-736` vs `ReleaseDetail.jsx:133-138`).
- REL-30 P3 — Checklist tab n/14 badge missing from tab strip (`index.jsx:690-698` vs `ReleaseDetail.jsx:148`).

Intentional (5): label_id scoping + in-tenant FK re-validation throughout NEW routes; RC-2 brand accent on pills/bars/rings; role-name admin checks (`ReleaseDetail.jsx:21`) replacing hierarchy_level; per-tenant per-release artwork sync w/ isEnabled degrade (`cadence releases.js:15-35`); merge admin gate moved to router-level requireAdmin (`flags.js:9`).

## artist-profile
- [P1] Spotify tab gutted: live GET /:id/spotify surface (PopularityRing, followers/tracks/releases/markets cards, genre chips, Open-on-Spotify, Top Tracks w/ popularity bars, discography grid, loading/error/null states) → 3 static stored-stat cards; endpoint absent in NEW — fix: cadence client/src/pages/ArtistProfile.jsx:243-256 + server/routes/artists.js (OLD client :60-246, server :1123-1222) (HIGH)
- [P1] Links tab: artist_links CRUD (14-platform add form, labels, delete; POST/PUT/DELETE endpoints) + Release Links aggregation across 5 URL fields gone — NEW is read-only chips over 7 artist columns; server endpoints absent — fix: cadence client/src/pages/ArtistProfile.jsx:272-280 + server/routes/artists.js (OLD client :684-818, server :534-582) (HIGH)
- [P1] Spends tab: approved-expense table (status/Recoup/Cobrand pills, canView-gated "Ledger →" ?focus deep-link) + Total/Unpaid/Top-category summary strip gone; aggregate returns no expense rows — fix: cadence client/src/pages/ArtistProfile.jsx:264-269, server/routes/artists.js:80-109 (OLD client :877-978) (HIGH)
- [P1] Contracts permission regression: OLD gates the tab by canView('/contracts') AND server returns [] below approver; NEW shows tab to everyone and serves contract rows (advance/royalty) to any label user — fix: cadence client/src/pages/ArtistProfile.jsx:144,310, server/routes/artists.js:87-92 (OLD client :518, server :436-451) (HIGH)
- [P1] Devlog delete authorization dropped: author-or-admin (server 403 + hidden trash) → unconditional server delete, trash shown to all, no confirm — fix: cadence server/routes/artists.js:205-217, client/src/pages/ArtistProfile.jsx:114-117,298 (OLD server :1327-1350) (HIGH)
- [P1] Artist delete guards dropped while adding a delete button to this page: OLD Superadmin-only + 409-if-releases + TX'd entity_files purge + FK sweep → NEW any-user bare DELETE; releases FK SET NULL orphans the catalog; artist entity_files rows/R2 objects leak — fix: cadence server/routes/artists.js:220-232, client :118-122,198 (OLD server :928-975; FK server/index.js:380) (HIGH)
- [P2] Per-row release archive/unarchive (PUT /releases/:id/archive, amber toggle, Archived badge + opacity, "Released" chip) gone from Releases tab — fix: cadence client/src/pages/ArtistProfile.jsx:148-159,259-261 (OLD :393-406,820-875) (HIGH)
- [P2] Checklist completion % bars gone (Overview + Releases rows); aggregate selects only 6 release columns so checklist keys unavailable — fix: cadence server/routes/artists.js:82-85, client :148-159 (OLD client :31,49-52,624-635,848-852) (HIGH)
- [P2] Overview "Deal History" card gone; deals not queried in aggregate — fix: cadence server/routes/artists.js:80-105, client :229-240 (OLD client :664-680, server :453-455) (HIGH)
- [P2] Contracts tab: per-contract FilesPanel embed (view/download the document) gone; notes gone; amber pending band gone; order expiration ASC → date_signed DESC — fix: cadence client/src/pages/ArtistProfile.jsx:310-330, server :88-91 (OLD client :991-1036) (HIGH)
- [P2] Budget bar: 3-band emerald/amber(>80%)/red → brand/rose(>100%) only; source changed from artist-level recording budget (override/lines+contingency+advance) to SUM(releases.budget_cap) — fix: cadence client/src/pages/ArtistProfile.jsx:209-219, server/routes/artists.js:104,108 (OLD client :578-592, server :472-489) (HIGH)
- [P2] Cross-currency spend fabrication reintroduced: OLD buckets category totals per currency (explicit fix comment); NEW sums all currencies and renders as $ — fix: cadence server/routes/artists.js:95-103, client :47,161-173 (OLD :481-498) (HIGH)
- [P2] Upcoming classification TZ bug reintroduced: daysUntilLocal>=0 → `new Date(release_date) > new Date()` (today's release counts as past); utils/dates.js:42 helper exists unused — fix: cadence client/src/pages/ArtistProfile.jsx:130 (OLD :473-476) (HIGH)
- [P2] Header artist-links chip row gone — fix: cadence client/src/pages/ArtistProfile.jsx:181-200 (OLD :552-562) (HIGH)
- [P2] Documents tab downgraded from FilesPanel: no size/date/uploader metadata (INSERT records neither file_size nor uploaded_by), no drag-active state, no upload spinner/error, no delete confirm, tab count (onCountChange) lost — fix: cadence client/src/pages/ArtistProfile.jsx:333-350,145, server/routes/artists.js:237-271 (OLD client :1042-1058 + FilesPanel.jsx, server :584-629) (HIGH)
- [P3] Loading = "Loading…" text vs Skeleton.ArtistProfile (NEW Skeleton kit has no ArtistProfile block, unused here) — fix: cadence client/src/pages/ArtistProfile.jsx:124 (OLD :455-457) (HIGH)
- [P3] Not-found state lost "Back to roster" link — fix: cadence client/src/pages/ArtistProfile.jsx:125 (OLD :459-466) (HIGH)
- [P3] Devlog: type set 8→7 (Follow-up/Email dropped, Milestone added); server entry_type validation dropped (any string accepted); date input removed (log_date not user-settable); not a real <form> (no Enter-submit/required/saving-disable); pill badge → dot — fix: cadence client/src/pages/ArtistProfile.jsx:15-23,285-291, client/src/constants.js:101, server/routes/artists.js:195 (OLD client :12-29,300-329, server :1287-1292) (HIGH)
- [P3] Tab labels: Spends + Documents counts gone; Links(n) counts only social columns vs artist_links + release-link fields; Spotify tab glyph gone — fix: cadence client/src/pages/ArtistProfile.jsx:137-146 (OLD :503-523,599-603) (HIGH)
- [P3] 'not_found' sentinel unhandled on image_url/cover_art_url → broken <img> for legacy rows — fix: cadence client/src/pages/ArtistProfile.jsx:182-183,150-151 (OLD :534-539,834-839) (MED; data presence UNVERIFIED — needs runtime check)
- [P3] Raw toLocaleDateString on release/devlog dates (UTC day-shift); formatDate imported but only used for contracts — fix: cadence client/src/pages/ArtistProfile.jsx:155,298 (OLD :343,629,846) (HIGH)
- [P3] Spend match LOWER(artist) without TRIM (OLD LOWER(TRIM())) — padded artist names drop out of spend/budget math — fix: cadence server/routes/artists.js:98 (OLD :499-500) (HIGH)
- [P3] Archive toggle loses audit stamps: OLD PATCH /:id/archive sets archived_at/archived_by; NEW routes archived through generic PATCH, no stamps — fix: cadence server/routes/artists.js:42-47,138-158 (OLD :897-927) (HIGH)
- [P3] NEW-only edit modal hand-rolled fixed inset-0, not ui/Modal (no focus trap/escape stack; Escape doesn't close); dead PageHeader import — fix: cadence client/src/pages/ArtistProfile.jsx:353-378,8 (MED; Escape UNVERIFIED — needs runtime check)
- [INT] label_id scoping + withTenant on every query/route; artist-ownership re-validation before log/file writes — server/routes/artists.js:11,171,190-191,256-257
- [INT] brand-* accent replaces boom-* (RC-2) incl. avatar/bar tints
- [INT] File GET via 1h signed R2 URL instead of direct getFileUrl href (cadence file-serving hardening) — server/routes/artists.js:273-287
- [INT] Leaf-rows-only spend dedupe (NOT EXISTS children) — carries the family_amount double-count fix (commit 82fa2b0); improvement over OLD's sum-everything — server/routes/artists.js:100
- [INT] Toast feedback via ToastContext replaces console.error/alert

## artists
- [P0] DELETE /artists/:id lost Superadmin gate + has-releases 409 guard + cleanup — any member deletes; releases orphan via ON DELETE SET NULL; entity_files/R2 leak — fix: cadence server/routes/artists.js:220-232 (+ server/index.js:380) (HIGH)
- [P1] GET /artists/:id contracts no longer role-gated — royalty_split/advance visible to every member (OLD admin/superadmin/approver only) — fix: cadence server/routes/artists.js:87-92,109 (HIGH)
- [P1] Export feature missing end-to-end (release-window grid All-time/1/3/6/12/24mo + genre multi-select + XLSX w/ last_release_date) — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js (OLD client :375-400,:761-852; server :86-177) (HIGH)
- [P1] Bulk Spotify image sync missing (button + POST /artists/sync-images, link-first lookup, 100ms pacing) — only per-artist profile sync exists — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js (OLD client :402-417,:853-861; server :977-1082) (HIGH)
- [P1] Roster search missing — no client box, no server ?search param — fix: cadence client/src/pages/Artists.jsx + server/routes/artists.js:50-68 (OLD client :271-279,:862-876; server :34-37) (HIGH)
- [P1] Filter/sort toolbar missing: genre dropdown w/ own search + counts, All/Has/No Releases segment, Active-only toggle, 4-option sort — fix: cadence client/src/pages/Artists.jsx (OLD :438-484,:922-1026) (HIGH)
- [P1] Stat cards row missing (Total Artists/Genres/Total Releases/Active Roster) — fix: cadence client/src/pages/Artists.jsx (OLD :447-456,:881-918) (HIGH)
- [P1] Archived flow unreachable from roster: no archived section/restore, ?include_archived=1 has zero consumers — archived artists vanish (restore only via global search → profile) — fix: cadence client/src/pages/Artists.jsx (OLD :321-346,:1044-1063,:1117-1128) (HIGH)
- [P1] has_recent_release derived flag dropped from list endpoint (blocks Active-only + Active stat) — fix: cadence server/routes/artists.js:50-68 (OLD :44-66) (HIGH)
- [P1] Rename cascade lost: PATCH /:id doesn't update expenses.artist/deals.artist_name/artist_income.artist_name, no collision→merge 409; rename zeroes the artist's own Spends (name-matched, NEW :96-102) — fix: cadence server/routes/artists.js:138-158 (OLD :268-336) (HIGH)
- [P2] Merge cascade gaps in relocated /flags/merge-artists: deals.artist_name not updated, source entity_files not cleaned, recording_budgets.artist_id SET-NULLs — fix: cadence server/routes/flags.js:244-270 (OLD artists.js:339-411) (HIGH)
- [P2] artist_links CRUD removed (14 platforms, multi-link, labels) → fixed single-URL columns; also removes sync's direct-ID lookup source — fix: cadence server/routes/artists.js:42-47 (OLD :534-583) (HIGH)
- [P2] Devlog authz lost: log DELETE has no author-or-admin gate; POST entry_type whitelist dropped — fix: cadence server/routes/artists.js:184-217 (OLD :1287-1289,:1327-1350) (HIGH)
- [P2] Card chrome: 36-genre color-chip map → plain gray text; 2-letter initials → charAt(0); chevron/hover-lift/ring gone; avatar w-11→w-10 — fix: cadence client/src/pages/Artists.jsx:74-89 (OLD :10-45,:223-225,:1073-1131) (HIGH)
- [P2] Fetch errors swallowed (.catch(() => {})) — failed load renders as empty state; spinner → text line — fix: cadence client/src/pages/Artists.jsx:19,65-66 (OLD :297-299,:743-752,:1029) (HIGH)
- [P3] List API shape: ?page/limit + {data,total} dropped (OLD client had no pager UI at limit 1000 — API parity only) — fix: cadence server/routes/artists.js:50-68 (HIGH)
- [P3] Artist file upload guard regressed: 10MB+secureFileFilter → 25MB no fileFilter — fix: cadence server/routes/artists.js:39 (OLD :19-23) (HIGH)
- [P3] Files metadata drops file_size/uploaded_by_name/label — fix: cadence server/routes/artists.js:237-249 (OLD :610-629) (HIGH)
- [P3] PageHeader subtitle static vs live "{N} artists · filters" — fix: cadence client/src/pages/Artists.jsx:43 (OLD :759) (HIGH)
- [P3] GET /:id payload gaps: releases lose assigned_to_name; deals/links/income/expense rows/totals absent; contracts order date_signed DESC vs expiration ASC — fix: cadence server/routes/artists.js:71-114 (OLD :424-532) (HIGH)
- [P3] Card grid 2-up breakpoint md→sm; gap-3→gap-4 — fix: cadence client/src/pages/Artists.jsx:73 (OLD :1035) (HIGH)
- [P3] Archive lost audit stamps (archived_at/archived_by) — generic PATCH boolean only, columns absent — fix: cadence server/routes/artists.js:46,138-158 + server/index.js:416 (OLD :897-926) (HIGH)
- [INT] label_id scoping + withTenant throughout — server/routes/artists.js:11
- [INT] generic error bodies replace err.message leakage; logActivity on create/merge — artists.js:66,126; flags.js:264
- [INT] merge/duplicates relocated to flags surface; budget endpoints to artist-budgets.js (architecture; only cascade gaps are defects)
- [INT] computed live total_releases replaces OLD's drift-prone stored counter — artists.js:55-57
- [INT] brand accent replaces boom red incl. any rebuilt XLSX header (RC-2)
- [ADD] inline add-artist form + toasts (client :23-37,:51-63); per-artist POST /:id/sync-spotify (server :15-37); leaf-only spend dedup (server :93-103) — NEW-only, not defects
## my-work
- [P1] 'Urgent' priority level dropped (4→3 levels; server 400s it) — fix: server/lib/constants.js:27 + client/src/constants.js:21 + components/mywork/taskFields.js:20-22 (HIGH)
- [P1] To Do Today triage lost: In-progress section, Start, snooze-to-tomorrow, "Reschedule all → today" rollover, Plan-your-day suggestions, "Also today" strip (reviews/mentions/statement-cutoff) — fix: client components/mywork/TaskSurface.jsx new Today module per OLD MyWork.jsx:1230-1461,726-771 (HIGH)
- [P1] My Releases tab missing (completion bars, days-until, HIGH badge, self-assign panel + search, unassign, 4-key sort) — fix: client pages/MyWork.jsx + releases slice (per OLD MyWork.jsx:1464-1601, team.js:256-335) (HIGH)
- [P1] Waiting-on-you rail gutted + gated to Approver+: mentions list w/ snippets, statement-cutoff countdown, stalled bulk deals, review rows, all-clear card gone; non-approvers get nothing — fix: components/mywork/WaitingOnYou.jsx per OLD components/MyWorkRail.jsx (HIGH)
- [P2] Upcoming 14-day release-deadline alert missing from My Work — fix: client pages/MyWork.jsx per OLD MyWork.jsx:1077-1105 (HIGH)
- [P2] Time-of-day greeting + overdue/due-today/in-progress pills → static PageHeader — fix: client pages/MyWork.jsx:14 per OLD :31-35,1034-1064 (HIGH)
- [P2] Assignment email auto-sent with no EmailPreviewModal (OLD returned pending_email; editable To/CC + Skip) — fix: server/routes/tasks.js:243,618 + client useTaskData/TaskSurface per OLD team.js:477-496, MyWork.jsx:1683-1700 (HIGH)
- [P2] No one-click mark-done control (OLD status circle on every row + detail) — fix: components/mywork/TaskCard.jsx add toggle per OLD TaskList.jsx:90-98 (HIGH)
- [P2] Task↔release link not editable anywhere in NEW UI (readonly column; server PATCH accepts release_id) — fix: components/mywork/TaskDrawer.jsx add release select per OLD TaskDetail.jsx:219-231 (HIGH)
- [P2] @-mention-in-title hand-over flow missing (roster autocomplete, Enter picks, mention stripped) — fix: components/mywork/TaskDrawer.jsx:119 per OLD TaskDetail.jsx:84-166 (MED)
- [P3] Manual-sort fallback is id/creation order; OLD fell back to due-date asc for never-dragged tasks — fix: components/mywork/taskFields.js:147-172 (HIGH)
- [P3] Pin-to-top removed (OLD localStorage pins + pin-first sort; cadence CLAUDE.md logs as deliberate) — fix: useTaskView/taskFields pinned set per OLD MyWork.jsx:342-352 (HIGH)
- [P3] Category color system dropped (7 fixed hues → free-text monochrome) — fix: components/mywork/taskFields.js map per OLD MyWork.jsx:38-47 (MED)
- [P3] Priority stripe remapped High amber→red, Medium blue→amber (fallout of Urgent removal) — fix: taskFields.js:20-22 with Urgent restore (HIGH)
- [P3] Instant-create ("New Task" made a row and opened it) replaced by form-first — fix: TaskSurface.jsx:160-184 optional create-then-open per OLD MyWork.jsx:559-597 (HIGH)
- [P3] Notes autosave (600ms debounced, id-captured, retrying) downgraded to blur/manual save — fix: components/mywork/TaskDrawer.jsx:33-44 per OLD useAutosave.js (MED)
- [P3] FAB "New task" deep link ?new=task no longer opens the add form — fix: components/Fab.jsx:14 + TaskSurface param handling per OLD MyWork.jsx:279-289 (HIGH)
- [P3] No task refetch on acting-user switch (OLD deps [user?.id]) — fix: components/mywork/useTaskData.js:57-66; UNVERIFIED — needs runtime check (LOW)
- [P3] Quick-add shorthand parsing (!high/#cat/natural dates) absent — informational: already dead code in OLD (MyWork.jsx:467-486) and logged in cadence CLAUDE.md as not carried over (LOW)
- [INT] Hierarchy assign-down/request-up + task_type replaced by role/department model (canMutateTask/canAssignTo, unassign admin-only) — documented post-spec auth redesign, server/routes/tasks.js:86-125
- [INT] Server permission gates where OLD PUT /team/tasks/:id had none (auth hardening) — tasks.js:542-549
- [INT] label_id scoping + in-tenant release/assignee validation (tenancy) — tasks.js:32-47,226-228,556-559
- [INT] /team-work new page, Approver+ route gate + server teamFilter dept scoping — App.jsx:93-98,139; tasks.js:67-73
- [INT] Task email branded via lib/email.js vs Boom-red Gmail-OAuth template (branding; preview loss logged as P2 above) — tasks.js:137-154
- [INT] Brand accent vs boom red on all controls (RC-2)
## flags-data-quality
- [P0] GET /api/flags selects nonexistent vendors.w9_name → 42703 → 500 on every request → entire /data-quality page dead (client toasts + renders null) — fix: cadence server/routes/flags.js:48 (+ vendor_w9_mismatch block :113-119) vs vendors DDL server/index.js:832-845; nothing populates w9_name anywhere (HIGH)
- [P1] All 6 catalog/artist completeness checks missing (releases genre/UPC/ISRC/Spotify, artists genre/Spotify) + of_total denominators + uncapped counts — fix: port OLD server/routes/flags.js:542-662,1494-1500 + list sections OLD Duplicates.jsx:2702-2744 (HIGH)
- [P1] Overview view + two headline figures ("N need a decision · M fields incomplete", problem cards, completeness progress strip) missing — fix: cadence DataQuality.jsx per OLD Duplicates.jsx:626-648,830-845,1232-1332 (HIGH)
- [P1] Grouped nav lost: Money→Ledger→Catalog→Artists sticky rail (severity dots, problems-first, disabled-empty) + mobile <select> optgroups → 7 flat pills — fix: DataQuality.jsx:55-61 per OLD Duplicates.jsx:643-648,862-877,1181-1223 (HIGH)
- [P1] Ledger-flag fix machinery absent: apply-from-suggestion, inline editors, 5s pending fade + Undo, clear-placeholder, split modal (leftover-cents seed + balance meter), per-row/view-all invoice previews — NEW rows deep-link + dismiss only (DataQuality.jsx:110-116) — fix: port OLD Duplicates.jsx:503-617,1045-1135,2748-2998 (HIGH)
- [P1] Detectors missing: artist_likely_typo (Levenshtein + suggestion), artist_placeholder (namesAnArtist guard — its absence makes NEW's unknown_artist re-flag "n/a" junk), ledger-internal artist_variants w/ canonical election — fix: cadence flags.js:156-175 per OLD flags.js:824-956 (HIGH)
- [P1] Multi-artist normalization auto-detection gone (grouped strings w/ row count + spend, candidate radios, roster typeahead) — NEW manual pattern/base form only (DataQuality.jsx:122-137) — fix: port OLD server flags.js:709-743 + Duplicates.jsx:2290-2435 (HIGH)
- [P1] Human-flag inboxes homeless: no ledger flag button/inbox (expenses.flagged only written by campaign flows, artist-campaigns.js:133-140) and flagged_transactions impossible (no flagged col on bank_transactions, index.js:1535-1560) — fix: flag toggle in Ledger drawer + Flagged tab per OLD Duplicates.jsx:1673-1752 + OLD flags.js:1426-1488 (HIGH)
- [P2] Whole page + API admin-only (cadence flags.js:10, App.jsx:170, Layout.jsx:302) vs OLD canView page + section role gates (catalog all roles, ledger flags Approver+, bank Admin+, OLD flags.js:1423-1425) — Approvers lose the inbox; fix: split read access, keep merges admin-only (HIGH)
- [P2] No status scoping: pending + rejected expenses feed all detectors (cadence flags.js:44-47) vs OLD approved-only ledger detectors + rejected-excluded invoice dupes (OLD flags.js:306,719,782) (HIGH)
- [P2] Invoice-dupe divergence: Tier 2b (blank-# vendor+amount ±7d chain) missing; cross-vendor tier lacks same-amount + length≥4 guards and ships items:[] (cadence flags.js:121-149 vs OLD flags.js:371-478); no vendor-alias resolution, split-slice or bank-source exclusions (OLD :309-395) (HIGH)
- [P2] Vendor dupes shallow: exact norm-key variants only — no Levenshtein union-find, no vendor_aliases exclusion, no invoice-count/W9/last-invoice metadata, no leave-alone checkboxes, no vendor links (cadence flags.js:104-112, DataQuality.jsx:79-91 vs OLD flags.js:183-268, Duplicates.jsx:2437-2578) (HIGH)
- [P2] merge-vendors records no vendor_aliases (cadence flags.js:312-331) though table exists (index.js:578) and repo writes/consumes aliases (ledger.js:872-921, bank-statements.js:835-838) — resolved pairs don't auto-canonicalize future submissions (HIGH)
- [P2] merge-artists misses deals.artist_name cascade (cadence flags.js:255-261; column proven live by :227) — deals keep the deleted artist's name (HIGH)
- [P2] Release dupes keyed on name alone (cadence flags.js:62) vs OLD artist+name (OLD flags.js:60) — cross-artist same-title false positives (HIGH)
- [P2] Dupe cards lost evidence/actions: artwork, artist, dates, ID chips, entity links, per-row Archive, multi-reason chips, artist release/contract counts, inline artist rename (DataQuality.jsx:63-77 vs OLD Duplicates.jsx:2000-2277,749-779) (HIGH)
- [P2] In-section search (ListSearch w/ shown/total, survives zero match w/ Clear, reset per tab) missing (OLD Duplicates.jsx:650-696,954-977) (HIGH)
- [P2] Dismissed view context loss: raw flag_key strings, no inline greyed groups + restore-in-place, no who/when hydration, note field has no UI (DataQuality.jsx:139-148 vs OLD flags.js:1202-1218, Duplicates.jsx:2019-2046,3001-3043) (MED)
- [P2] paid-no-match at /bank-statements lacks OLD's inline date/method edit-and-recheck, "Find it" search link, checked-account note, true-total when capped (StatementFlagsCard.jsx vs OLD Duplicates.jsx:299-314,1765-1861; counts.paid_no_match computed but never shown, statementFlags.js:421) (HIGH)
- [P2] duplicate_payments at /bank-matching lost the ReviewDeck (side-by-side compare, doc checkmarks + preview aside, ⏎/N/←/P keys, tallies, match_method/gap_days context, 40-row scan table); payload omits evidence fields (bank-matching.js:495-508, BankMatching.jsx:401-424 vs OLD Duplicates.jsx:1453-1667); merge semantics at parity (HIGH)
- [P2] Detector scope narrowed: artist-required 6 cats vs 10, missing_song 3 cats + no reimbursement exclusion + no child-carries-song exemption (split parents falsely flagged), missing_socials drops cobrand rows (cadence flags.js:13-15,169-175 vs OLD flags.js:682-686,964-999,1047) (HIGH)
- [P3] No per-category severity model / show-low toggle (OLD Duplicates.jsx:158,622-648) (MED)
- [P3] Active tab not URL-persisted — not bookmarkable, resets on reload (DataQuality.jsx:20 vs OLD Duplicates.jsx:250-256) (HIGH)
- [P3] No re-scan/refresh control (OLD Duplicates.jsx:846-855) (HIGH)
- [P3] Unknown-kind forward-compat rendering rule lost — hard-coded TABS drops new server sections (DataQuality.jsx:46-49 vs OLD Duplicates.jsx:93-97) (MED)
- [P3] Raw red/orange/amber chip utilities (DataQuality.jsx:10,95) against NEW's var-backed-only dark convention — dark rendering UNVERIFIED — needs runtime check (MED)
- [P3] MergePicker/VendorMerge fire N−1 stacked confirms + unawaited concurrent merges + reload races (DataQuality.jsx:177,189 vs OLD single-confirm flows Duplicates.jsx:717-724,793-802) (HIGH)
- [P3] Invoice-dupe dates via new Date().toLocaleDateString() — documented TZ-shift landmine; use utils/dates formatDate (DataQuality.jsx:97) (HIGH)
- [INT] Every query label-scoped; merge FKs re-validated in-tenant (flags.js:251-252,281-282)
- [INT] Admin gating on merge/normalize mutations (matches OLD admin checks; read lockout reported separately as P2)
- [INT] Generic 'Internal server error' bodies replace OLD err.message leakage
- [INT] Brand tokens replace boom-* accents (RC-2); toasts replace alert()
- [INT] Unified label-scoped data_quality_dismissals flag_key store replaces OLD's flag_dismissals + flag_group_dismissals + acks trio (equivalent stickiness)
- [INT] Bank-flag machinery relocated to /bank-statements (StatementFlagsCard w/ one-click unmatch/dismiss-pair/unbook-income/mark-unpaid/alias — exceeds OLD's deep-link rows) + /bank-matching (queue, duplicate-pairs, unmatched-ledger); parity judged there, residual gaps filed as P2s
- [INT] Merge endpoints consolidated into flags router; transactional field-union release merge + DSP fold + task reassignment (flags.js:274-309) improves on OLD delegation

## catalog
(reconstructed from pages/catalog.md §7 after agent was killed pre-append)
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

## pending-contracts
(reconstructed from pages/pending-contracts.md §7 after agent was killed pre-append)
## 7. Defects found

| # | Sev | Defect | Fix location | Conf |
|---|---|---|---|---|
| PC-1 | P0 | Page rebuilt on an incompatible data model — all 9 deal-term fields (`legal_name`, `email`, `address`, `cash`, `split`, `years`, `options`, `back_signs`, `futures`) dropped end-to-end (UI, route, schema); OLD's artist-signing-pipeline records cannot exist in NEW and there is no migration path | cadence `client/src/pages/PendingContracts.jsx` + `server/routes/pending-contracts.js` + `server/index.js:1244-1256` (OLD client :23-26,:83-102; OLD server :58-106; OLD schema `index.js:1162-1179`) | HIGH |
| PC-2 | P1 | No edit flow — OLD's add/edit ContractModal (:38-115) has no NEW equivalent; after create only `status` is mutable from the UI even though PATCH accepts 6 fields | cadence `client/src/pages/PendingContracts.jsx:62-107` | HIGH |
| PC-3 | P1 | Status vocabulary changed: `Declined` removed, `In Review` invented; pill colors remapped (Sent emerald→amber, Signed blue→emerald) and the dot+ring StatusBadge anatomy replaced by a bare select | cadence `client/src/pages/PendingContracts.jsx:9-13,96-99` (OLD :6-21) | HIGH |
| PC-4 | P1 | Search missing (OLD searched artist_name/legal_name/email/back_signs, :223-229,:275-281) | cadence `client/src/pages/PendingContracts.jsx` | HIGH |
| PC-5 | P1 | Stat cards row missing (Total/Sent/Not Sent/Signed, text-3xl tinted values) | cadence `client/src/pages/PendingContracts.jsx` (OLD :260-272) | HIGH |
| PC-6 | P1 | Status-filter segmented control with live per-status counts (incl. Declined) missing | cadence `client/src/pages/PendingContracts.jsx` (OLD :234-240,:282-291) | HIGH |
| PC-7 | P2 | Expandable row detail missing: chevron expand, empty-hiding `Field` renderer, Options/Futures/Email/Back Signs/Address/Notes grid, deal-term pills (slate/rose/sky/emerald), "Move to:" quick-status buttons, in-row Remove | cadence `client/src/pages/PendingContracts.jsx:91-107` (OLD :117-201) | HIGH |
| PC-8 | P2 | Due-date cell TZ day-shift: `new Date(due_date).toLocaleDateString()` renders the prior day west of UTC; `utils/dates.js formatDate` exists and is unused | cadence `client/src/pages/PendingContracts.jsx:94` | HIGH |
| PC-9 | P2 | Fetch errors swallowed (`.catch(() => {})`) — a failed load renders as the empty state; OLD logged and kept states distinct | cadence `client/src/pages/PendingContracts.jsx:23` (OLD :212-218) | HIGH |
| PC-10 | P3 | Refresh button missing (OLD :249-251) | cadence `client/src/pages/PendingContracts.jsx:56-60` | HIGH |
| PC-11 | P3 | "{filtered} of {total} artists" footer + live "{N} artists in pipeline" subtitle → static subtitle, no counts anywhere | cadence `client/src/pages/PendingContracts.jsx:58` (OLD :247,:318) | HIGH |
| PC-12 | P3 | `notes` is a dead field — present in form state (:14) and the server allow-list but has no input; unenterable from the UI | cadence `client/src/pages/PendingContracts.jsx:63-70` | HIGH |
| PC-13 | P3 | API parity: `GET /:id` dropped; list `?status`/`?search` params dropped (no NEW consumer — parity only) | cadence `server/routes/pending-contracts.js` (OLD :20-55) | HIGH |
| PC-14 | P3 | Loading spinner → bare text line; empty-state icon FileText→FileClock, copy changed | cadence `client/src/pages/PendingContracts.jsx:74,76` (OLD :295-303) | HIGH |

**Intentional divergences (not defects):** `label_id` scoping + `withTenant` + `created_by` + `logActivity` (`server/routes/pending-contracts.js:8,32-36`); `requireApprover` replacing OLD's page-permission gate (stricter auth model — plain Users with an explicit page grant lose access; flagging as intentional per the contracts-surface comment in `cadence server/routes/contracts.js:13-15`); 47-row Boom seed dataset not carried over (tenant PII — correctly excluded; OLD itself had already removed the unauthenticated `/seed` endpoint); brand accent replaces boom red (RC-2). **Additive:** Promote-to-Active flow (documented M4), Type/sent_date/due_date fields, toasts.

## contracts
- [P0] CT-1 Contract detail view removed entirely — rows unclickable; Contract Details grid, royalty two-box + split bar, notes, Documents section unreachable (boom Contracts.jsx:461-673 vs cadence Contracts.jsx:156) (HIGH)
- [P1] CT-2 LinkedDataPanel + GET /:id/linked missing — recoupment emerald/amber stacked exposure bar + income-offset line, releases lifetime/during-term/recent-5, income by type, top-6 spend bars, unpaid chip (boom Contracts.jsx:1408-1645, boom contracts.js:408-538) (HIGH)
- [P1] CT-3 AI contract scan flow + POST /contracts/scan missing — PDF drop zone, _confidence map + ConfChip per field, fuzzy artist match + manual-fallback message, scanned File uploaded after create via /:id/files, "Contract created, but attaching…" recovery copy, ANTHROPIC_API_KEY setup error (boom Contracts.jsx:139-160,194-332,704-822,1647-1675; boom contracts.js:297-403) (HIGH)
- [P1] CT-4 financial_terms obligations dropped end-to-end — no schema column, no POST/PATCH field, no view list or inline editor (detail + create form); OLD data unrepresentable (boom Contracts.jsx:88-127,556-663,953-1032 vs cadence index.js:446-464, cadence contracts.js:19-22) (HIGH)
- [P1] CT-5 Missing Contracts panel + GET /missing gone — 3 collapsible buckets (noContract/noFile/expiredUnreplaced) w/ counts + click-through (boom Contracts.jsx:1045-1139, boom contracts.js:193-250) (HIGH)
- [P1] CT-6 Expiring panel + GET /expiring gone — 90-day window, ≤30/31-60/61-90 color buckets, days_until_expiry chips (boom Contracts.jsx:368-373,1141-1186, boom contracts.js:275-296) (HIGH)
- [P1] CT-7 Filters gone: artist search + type + status selects, and server ?artist/type/status params (boom Contracts.jsx:1188-1202, boom contracts.js:103-142 vs cadence contracts.js:41-56) (HIGH)
- [P1] CT-8 Multi-file document model gutted: entity_files revisions + FilesPanel + POST/GET/DELETE /:id/files + /:id/upload → single-slot POST /:id/file that deletes the prior R2 object; no revision history, no UI path to replace an existing file (boom Contracts.jsx:666-673, boom contracts.js:666-786 vs cadence contracts.js:158-185, cadence Contracts.jsx:163-169) (HIGH)
- [P1] CT-9 Inline PDF preview gone: FilePreview single-url + multi-files pager, per-row count badge + per-row files fetch + legacy fallback → new-tab open of one signed URL (boom Contracts.jsx:1273-1284,1324-1387 vs cadence Contracts.jsx:87-93) (HIGH)
- [P1] CT-10 royalty_split numeric→VARCHAR free text — artist/label two-box widget, live split bar, clamping, computed label share, and the table's Artist/Boom column all unrepresentable (boom Contracts.jsx:504-531,863-909,1297,1315-1323 vs cadence Contracts.jsx:117, cadence index.js:455) (HIGH)
- [P2] CT-11 syncArtistBudget contract→artist_budgets rollup on create/update/delete has no NEW equivalent (boom contracts.js:29-93,180,596,660) (HIGH)
- [P2] CT-12 Date cells new Date().toLocaleDateString() TZ day-shift; utils/dates formatDate unused (cadence Contracts.jsx:159-160 vs boom :1313-1314) (HIGH)
- [P2] CT-13 Upload accepts any MIME — no multer fileFilter, no client PDF check; OLD enforced PDF-only both sides (cadence contracts.js:17 vs boom contracts.js:81-98, boom Contracts.jsx:409-412) (HIGH)
- [P2] CT-14 Quick-attach two-step card (contract select → drop/browse zone) missing (boom Contracts.jsx:1204-1270) (HIGH)
- [P2] CT-15 Load errors swallowed (.catch(() => {})) — failure renders as "No contracts yet." empty state (cadence Contracts.jsx:52,139 vs boom :335,1272) (HIGH)
- [P2] CT-16 Status pills raw emerald/amber/red/gray-100 utilities (dark rendering UNVERIFIED — needs runtime check); Expired remapped red→gray (cadence Contracts.jsx:14-19 vs boom :430-435) (MED)
- [P2] CT-17 Artist optional/"Unassigned" allowed vs OLD required artist+type w/ disabled Create — data-model widening (cadence Contracts.jsx:64,112-115, cadence contracts.js:103-106 vs boom :277-278,1037) (HIGH)
- [P3] CT-18 Delete confirm downgraded (no artist/type/file-count/"cannot be undone"), no in-flight disable, delete not activity-logged (cadence Contracts.jsx:92-98, contracts.js:187-200 vs boom :60-85,1389-1398) (HIGH)
- [P3] CT-19 `n` hotkey (open new-contract form) missing; useHotkeys exists in cadence, unused here (boom Contracts.jsx:129-131) (HIGH)
- [P3] CT-20 List sort expiration_date ASC → created_at DESC — renewal-urgency ordering lost (boom contracts.js:144 vs cadence contracts.js:48) (HIGH)
- [P3] CT-21 CONTRACT_TYPES drift: 'Producer' added, Distribution/Publishing reordered (cadence constants.js:56 vs boom Contracts.jsx:162) (HIGH)
- [P3] CT-22 Loading bare "Loading…" text vs Skeleton.PageHeader + Skeleton.Table (cadence Contracts.jsx:137 vs boom :447-453) (HIGH)
- [P3] CT-23 SearchableSelect artist picker → native select, no type-to-search (boom Contracts.jsx:832-840 vs cadence :112-115) (HIGH)
- [P3] CT-24 Row hover hover:bg-gray-50 (documented near-invisible-in-dark utility) vs OLD hover:bg-surface-50 token (cadence Contracts.jsx:156 vs boom :1309) (MED)
- [INT] label_id scoping + withTenant + in-tenant artist_id re-validation (cadence contracts.js:11,103-106)
- [INT] requireApprover replaces OLD requirePagePermission per-user grants (stricter auth model; same ruling as pending-contracts) (cadence contracts.js:13-15 vs boom contracts.js:12-22)
- [INT] R2 signed-URL file access + tenant-namespaced keys replace /uploads disk paths (cadence contracts.js:92-95,170-172)
- [INT] logActivity on create/upload; generic error bodies replace OLD err.message leakage; toasts replace alert(); RC-2 brand accent replaces boom red
- [INT] Additive (documented M4): POST /draft-clause + clause-drafting box appending to Notes; num_releases form input; PATCH allow-list endpoint; per-row dropTarget upload. OLD POST /contracts/generate parity charged to the Create Contract page audit (consumer boom CreateContract.jsx:54)

## release-detail

Full report: `_audit/pages/release-detail.md`. OLD = boom standalone `pages/ReleaseDetail.jsx` (863 ln) + `server/routes/releases.js` detail handlers; NEW = cadence `pages/ReleaseDetail.jsx` + `components/DspTracker.jsx`/`ReleaseExtras.jsx` + `server/routes/releases.js`/`dsp.js`. Already logged under `## releases` and not re-counted here: REL-04, REL-07, REL-14..REL-21, REL-23, REL-24, REL-27..REL-30.

- [P1] Architecture: 4-tab column + permanent 296px sidebar (Details/Metadata/Links/Notes/Actions read-mode cards, Edit/Save/Cancel dual-write PUT /:id ∥ PUT /:id/metadata + re-fetch) → single-column 7-tab form pages; zero read-mode presentation of any metadata/link/note field remains — fix: cadence client/src/pages/ReleaseDetail.jsx:105-247 (boom :365-838,:216-260) (HIGH)
- [P2] Blank-title regression: OLD trimmed title→null + server COALESCE kept the name; NEW saveMeta sends project_name verbatim and PATCH writes it — release name blankable to '' — fix: cadence ReleaseDetail.jsx:68 + server/routes/releases.js:144-152 (boom :221-223, boom releases.js:601) (HIGH)
- [P2] Breadcrumb gone: catalog-aware root (state.from==='catalog'→/catalog) + artist crumb → /artists/:artist_id; NEW hard-wired "← Releases", location.state ignored, artist un-linked — fix: cadence ReleaseDetail.jsx:106-108,122 (boom :44,:293-297,:319) (HIGH)
- [P2] Header pills dropped: priority (red/amber/gray) + type + rounded-full Archived pills → lone square Archived tag; priority/type only visible inside edit selects — fix: cadence ReleaseDetail.jsx:117-119 (boom :32-36,:302-316) (HIGH)
- [P2] Date urgency gone: red+semibold when ≤7d + (Nd)/(Today)/(Nd ago) countdown suffix → plain gray "· date" — fix: cadence ReleaseDetail.jsx:121-125 (boom :283-287,:322-334) (HIGH)
- [P2] Completion block downgraded: text-2xl % + emerald-at-100 number/bar + "N of 14 done" → always-brand h-2 bar + "d/t · p%" — fix: cadence ReleaseDetail.jsx:133-139 (boom :349-361) (HIGH)
- [P2] History timeline UI lost: merged audit+activity, humanized checklist/field-change lines, source-colored dots on timeline spine, relative timestamps → flat activity-only list w/ date-only stamps (server gaps = REL-18/REL-28) — fix: cadence ReleaseDetail.jsx:252-269 (boom :109-138,:560-586) (HIGH)
- [P2] Budget tab reads a disconnected store: OLD = release's recording budget (recording_budgets.release_id → recording_budget_line_items, cap = total_amount_override, ensureReleaseBudget); NEW = standalone release_budget_items + releases.budget_cap, and cadence recording_budgets has no release_id — Budget tab and Recording Budgets feature can never agree — fix: cadence server/routes/releases.js:260-304 + server/routes/recording-budgets.js:56 (boom releases.js:990-1105) (HIGH)
- [P2] Links card + toSpotifyUrl() gone: spotify_uri never rendered as a clickable link anywhere in NEW (text input only); Apple Music/Pre-save/UGC chips lost with their fields (fields = REL-16) — fix: cadence ReleaseDetail.jsx:196 (boom :732-772,:856-863) (HIGH)
- [P3] Comments presentation: avatar initials, relative timestamps, bold author, author-or-hierarchy client delete gate, live "Comments (N)" tab count → "author · toLocaleString()" 11px, delete shown to all, plain label; NEW comment API omits user_id so a client gate is impossible — fix: cadence components/ReleaseExtras.jsx:68-75 + server/routes/releases.js:211 (boom :372,:440-470) (HIGH)
- [P3] "assigned to {name}" /team link → plain "owned by {name}" text — fix: cadence ReleaseDetail.jsx:124 (boom :335-345) (HIGH)
- [P3] Budget rows/total: description-primary boxed rows w/ category sublabel + over-cap Total row flipping red bg/border → "category · description" one-liners + inline "Planned $X / $cap" red text — fix: cadence components/ReleaseExtras.jsx:44-53 (boom :503-542) (HIGH)
- [P3] Archive control: per-state tooltip, amber styling, "Working…" busy state, race-safe server-side toggle → one-click client-computed PATCH, no tooltip/busy (log gap = REL-18) — fix: cadence ReleaseDetail.jsx:236-244 (boom :70-81,:820-836, boom releases.js:902-921) (HIGH)
- [P3] Notes: General + Distributor dual cards/textareas → single notes field (distributor_notes drop = REL-16) — fix: cadence ReleaseDetail.jsx:197 (boom :775-818) (HIGH)
- [P3] Loading spinner → bare "Loading…" text — fix: cadence ReleaseDetail.jsx:92 (boom :264-268) (HIGH)
- [P3] Checklist row anatomy: 20px emerald circular check (strokeWidth 3), card-list rows w/ hairline separators, uppercase [10px] group headers outside the card, done-row hover suppression → 16px brand square, flat hover rows, in-card sentence-case headers — fix: cadence ReleaseDetail.jsx:157-181 (boom :395-421) (HIGH)
- [P3] Additive-hazard: Escape hotkey navigates to /releases with no dirty-check — one keypress outside an input silently discards unsaved Metadata-tab edits — fix: cadence ReleaseDetail.jsx:40 (HIGH)
- [P3] Rename side-effects dropped: OLD PUT fired relinkExpensesForRelease + recounted artists.total_releases; NEW PATCH does neither (caveat: cadence expenses carry no release_id — parity note) — fix: cadence server/routes/releases.js:131-159 (boom releases.js:645-652) (MEDIUM)
- [INT] label_id scoping + withTenant + in-tenant re-validation of assigned_to/release sub-resources (cadence releases.js:11,139-142,178-181; dsp.js:13-16)
- [INT] RC-2 brand accent replacing boom-red on checks/bars/active tab/links throughout the page
- [INT] Role-name admin gate ['Superadmin','Admin','Approver'] for owner select + team fetch (cadence ReleaseDetail.jsx:21,35,227) — Cadence auth model
- [INT] Per-tenant Spotify artwork sync w/ spotify.isEnabled() graceful degrade (cadence releases.js:15-34); additive M4 features (DSP tab, status/owner Details tab, hotkeys, editable budget, toasts) not counted as defects

## approvals
- [P0] APR-1 Approval checklist absent end-to-end — no deck/fields/lib client-side, no validateApprovalChecklist server gate, no writeApprovalChecklist, no approval_checklist column; approve is a bare status UPDATE reachable from every entry point and by raw API (cadence ledger.js:420-442,1011-1041; Approvals.jsx:45-53,135 vs boom bookkeeping.js:101-187,3543-3544,3844-3853; ApprovalChecklistDeck/Fields + lib/approvalChecklist.js) (HIGH)
- [P1] APR-2 "Correct artist?" confirmation missing (boom approvalChecklist.js:24-29; ApprovalChecklistFields.jsx:96-133) (HIGH)
- [P1] APR-3 "Correct song?" confirmation missing (same) (HIGH)
- [P1] APR-4 "Correct amount?" confirmation missing incl. deck amount>0 save guard (boom ApprovalChecklistDeck.jsx:100) (HIGH)
- [P1] APR-5 "Correct category?" confirmation missing — grouped optgroup select + off-list stored value kept renderable + disabled-while-cobrand (boom Fields:60-91); NEW inline select flat, blanks on off-list values (Approvals.jsx:247) (HIGH)
- [P1] APR-6 "Bulk deal?" written answer missing — is_bulk_deal never a recorded decision at approval; "Marked bulk on the form" context line gone (boom Fields:164-172; bookkeeping.js:165) (HIGH)
- [P1] APR-7 "On cobrand?" written answer missing AND cobrand⇒category='Marketing' forcing absent everywhere in NEW (chip PATCH + server both; boom BkApprovals.jsx:294-311, bookkeeping.js:167); category-tick re-arm implication gone (approvalChecklist.js:62-69) (HIGH)
- [P1] APR-8 "Recoupable?" answer missing — recoupable never written at approval; DEFAULT-TRUE "nobody looked == yes" asymmetry reopened (boom bookkeeping.js:168-177; Fields:181-186) (HIGH)
- [P1] APR-9 "Campaign?" answer missing — cadence artist_campaign column (index.js:546) never written by any approve path; cobrand-implies-campaign (forced true, disabled buttons, contradiction refused) gone (boom approvalChecklist.js:83-95; bookkeeping.js:118-135) (HIGH)
- [P1] APR-10 W9 review deck missing end-to-end: per-DOCUMENT queue (alias-aware w9_entry_id/w9OwnersFor), signed_and_dated Y/N with non-boolean 400, prefill-from-scan + prefilled/accepted_prefill record, covers-N list, scan panel, no_w9 surfacing, w9_review column, "Review W9s N" button (boom bookkeeping.js:3400-3524; W9ReviewDeck.jsx; BkApprovals.jsx:817-830) (HIGH)
- [P1] APR-11 Split-before-approve breakdown EDITOR missing — OLD editable artist/song/amount rows travel in approve payload; NEW Split panel is read-only vendor allocation (boom BkApprovals.jsx:232-262,1811-1837; Deck:216-218 vs Approvals.jsx:263-280) (HIGH)
- [P1] APR-12 possible_duplicates queue annotation + amber banner missing (normalized inv# across vendor identities, ?focus links, leading-zeros caveat); NEW /check-dup serves add-forms only (boom bookkeeping.js:3339-3388; BkApprovals.jsx:1514-1544 vs ledger.js:1333-1352) (HIGH)
- [P1] APR-13 unknown_artist/unknown_song Levenshtein suggestions + one-click "Use X" apply (song apply writes release_id) missing from queue (boom bookkeeping.js:3212-3336; BkApprovals.jsx:452-478,1399-1462) (HIGH)
- [P1] APR-14 payment_check fraud banner missing (form-vs-invoice last4 mismatch + changed-bank-details warning) — payment_check absent from NEW entirely (boom BkApprovals.jsx:1481-1512) (HIGH)
- [P2] APR-15 Deck mechanics lost: pending-not-stored values, edit-on-blur PUT + un-tick, nothing-pre-selected rule, outstanding hint, Skip, inline doc preview (P), post-close email queue (boom Deck:73-108,228-252,367-373; BkApprovals.jsx:547-552) (HIGH)
- [P2] APR-16 Read-time alias silencing of name discrepancies missing (bidirectional alias graph, whole-word mentions, w9_value handling, summary rewrite; alias add re-silences immediately) (boom bookkeeping.js:3145-3310) (HIGH)
- [P2] APR-17 Stale-amount discrepancy silencer (family/breakdown total vs document ±1¢) missing (boom bookkeeping.js:3198-3296) (HIGH)
- [P2] APR-18 isMissingDocClaim synthetic-discrepancy filter missing (boom BkApprovals.jsx:40-49,1552,1651 vs Approvals.jsx:222-236) (HIGH)
- [P2] APR-19 Per-discrepancy Dismiss missing — NEW dismiss-scan only NULLs whole columns and Approvals UI has no dismiss control at all (boom bookkeeping.js:1905-1950; BkApprovals.jsx:333-357 vs ledger.js:1292-1307) (HIGH)
- [P2] APR-21 Edit-in-place halved: invoice_date, rep, vendor_email (validated), payment_method, notes, socials rows missing; amount>0/email guards missing; notes approve-rider gone (boom BkApprovals.jsx:607-712,995-1133 vs Approvals.jsx:93-101,283-295) (HIGH)
- [P2] APR-22 Reject flow degraded: inline autoFocus textarea + notify checkbox (pre-checked for vendor-submitted-with-email) + Cancel/Confirm/busy → single-line window.prompt (boom BkApprovals.jsx:560-604,1839-1889 vs Approvals.jsx:54-63) (HIGH)
- [P2] APR-23 Recent Activity panel + GET /approval-history missing (cross-queue last-50 feed); NEW per-entry trail only (boom bookkeeping.js:7975-7986; BkApprovals.jsx:790-878 vs Approvals.jsx:288,314-323) (HIGH)
- [P2] APR-24 Approve-split children don't inherit vendor_email/vendor_name/payment stamps/payment_terms/scheduled date; no receipt-child destruction guard; existing split short-circuits instead of replace (boom bookkeeping.js:3578-3630 vs ledger.js:366-416) (HIGH)
- [P2] APR-25 Approve no longer auto-links release_id by artist+song (boom bookkeeping.js:3672-3682) (HIGH)
- [P2] APR-26 Reject: no cascade to pending children; reason not appended to notes trail; rejecter stamped into approved_by/approved_at; restore NULLs rejected_reason where OLD unreject preserved it (boom bookkeeping.js:3726-3786 vs ledger.js:445-458,1044-1057) (HIGH)
- [P2] APR-27 Per-entry rep-visibility not enforced on mutations — OLD userCanActOnEntry/findInvisibleEntry on approve/reject/rush/bulk; NEW filters the list GET only, so a rep-restricted Approver can act on hidden entries by id (boom bookkeeping.js:3537-3539,3758-3760,3827-3835,6874-6876 vs ledger.js:420-463,1011-1041,1357-1391) (HIGH)
- [P2] APR-28 Rush parity: reason prompt, by/at attribution + tooltip, fill-state header pill, server not-Paid guard, bk_audit_log entry all lost (family cascade additive) (boom BkApprovals.jsx:420-450,1175-1210; bookkeeping.js:6869-6916 vs Approvals.jsx:91,296; ledger.js:1357-1391) (HIGH)
- [P3] APR-29 Bulk-approve drift: no per-id checklists (route bypass), no child cascade, server-prepared pending_emails/notify_ids → client-side row filtering (boom bookkeeping.js:3814-3903 vs ledger.js:1011-1041) (HIGH)
- [P3] APR-30 Notify defaults flipped (OLD opt-in → NEW opt-out whenever vendor_email); server auto-sends without preview when notify omitted by any caller (ledger.js:432,457) (HIGH)
- [P3] APR-31 Rep CC lost — OLD prepared vendor emails with cc_rep:true; NEW client-built ctx has no rep (boom bookkeeping.js:3692,3794,3891 vs Approvals.jsx:48,59) (HIGH)
- [P3] APR-32 Alias panel degraded to prompt add-only — chip list w/ remove + link-payee-as-alias-of-vendor + refetch-to-resilence gone; NEW GET/DELETE alias routes have no Approvals UI (boom BkApprovals.jsx:273-322,1891-1939 vs Approvals.jsx:102-107) (HIGH)
- [P3] APR-33 FlagButton (flag-for-review w/ reason popover + audit) missing from cards (boom BkApprovals.jsx:389-418,1207-1221) (HIGH)
- [P3] APR-34 Off-roster chip (off_roster_artist) missing (boom BkApprovals.jsx:1268-1290) (HIGH)
- [P3] APR-35 ≈USD suffix + precise-USD title for non-USD amounts missing (usdSuffixForEntry/FxRates) (boom BkApprovals.jsx:1367-1380) (HIGH)
- [P3] APR-36 File chips lose real filenames + in-app FilePreview modal (boom BkApprovals.jsx:76-104,2091-2097 vs Approvals.jsx:77-80,257-260) (HIGH)
- [P3] APR-37 Description 120-char clamp + more/less missing (boom BkApprovals.jsx:1787-1801 vs Approvals.jsx:254) (HIGH)
- [P3] APR-38 Archive link missing; NEW GET /ledger/archive has no client consumer anywhere — rejected/deleted invoices unreachable from UI (boom BkApprovals.jsx:734-760) (HIGH)
- [P3] APR-39 Name-mismatch banner → tiny Flag icon, no longer gated on vendor_submitted (boom BkApprovals.jsx:919-921,1386-1397 vs Approvals.jsx:141,199) (HIGH)
- [P3] APR-40 Bulk-deal qty/unit inline inputs (bulk_deal_quantity/unit, save-on-blur) missing (boom BkApprovals.jsx:1324-1366) (HIGH)
- [P3] APR-41 Scan-banner metadata lost: relativeAgo stamps, summary line, W8/W9 form_type label, rescan warnings surfaced, admin-gated buttons; NEW SEV chips use raw red/amber-100 utilities — dark rendering UNVERIFIED — needs runtime check (boom BkApprovals.jsx:359-387,481-493,1553-1742 vs Approvals.jsx:10,81-92,218-239) (HIGH)
- [P3] APR-42 Hotkeys: a/⇧A approve instantly (client face of APR-1); window.confirm replaces the deck-as-prompt; no contentEditable/meta guard; focus starts 0 not −1 (boom BkApprovals.jsx:199-211; useHotkeys.js:3-48 vs Approvals.jsx:126-148) (HIGH)
- [P3] APR-43 Sort/search reduced: "Amount: low" gone; sort basis created_at→invoice_date-first; description no longer searched (boom BkApprovals.jsx:27,495-511 vs Approvals.jsx:109-124) (HIGH)
- [P3] APR-44 Bulk-selection bar w/ select-all checkbox missing (boom BkApprovals.jsx:515-525,880-905 vs Approvals.jsx:166-172) (HIGH)
- [P3] APR-45 Cross-row W9 resolution (w9_entry_id alias subquery) + has_invoice/has_w9 blob-or-key fallbacks missing — vendor's W9 filed elsewhere shows no chip (boom bookkeeping.js:3107-3122 vs Approvals.jsx:219,258) (HIGH)
- [P3] APR-46 Family amount not rendered — NEW returns family_amount but card/sort read en.amount; OLD queue SELECT rolled children into amount (boom bookkeeping.js:3104-3106 vs ledger.js:137; Approvals.jsx:119,211) (MED)
- [INT] label_id scoping + withTenant + router-level requireApprover + AdminRoute client gate
- [INT] RC-2 brand tokens replace boom red + getDarkColors inline styles
- [INT] Toasts + Skeleton.Card replace inline banners/spinner
- [INT] Signed-URL file GETs replace ?token= URLs (documented hardening)
- [INT] Client-side /email/preview + /email/send {kind,ctx} replaces server pending_email payloads (queue mode preserved; behavioral deltas filed as APR-30/31)
- [INT] Activity-bot posts on approve/bulk-approve (additive)
- [INT] Rush cascades split family (additive)
- [INT] Receipt file chip (additive)
- [INT] Pending-count nav badge (additive)
- [INT] Generic 'Internal server error' bodies replace err.message leakage
## payments

Page: Payment Dashboard — OLD `boom-dashboard/client/src/pages/BkPayments.jsx` (4,200 ln) + `server/routes/bookkeeping.js` payment handlers vs NEW `cadence/client/src/pages/Payments.jsx` (491 ln) + `server/routes/ledger.js`. Detail: `_audit/pages/payments.md`. RC-1/2/5/6 apply (OLD page is inline-styled via getDarkColors; NEW tokenized = corrected form, not counted).

- DEF-PAY-01 · P1 · **EmailPreviewModal never opens** — rendered without its required `open` prop (`Payments.jsx:395`, also `Approvals.jsx:309`) and `EmailPreviewModal.jsx:14,41` returns null when `!open`; Send-for-Approval + single/bulk payment confirmations on this page open nothing and cannot send. Code-certain; click-through `UNVERIFIED — needs runtime check`.
- DEF-PAY-02 · P1 · Confirmation email states the parent slice, not the family total — ctx `amount: r.amount` (`Payments.jsx:183`; server analog `ledger.js:1573-1590`); OLD emailed familyTotal + attached invoice/proof (`bookkeeping.js:7393-7422,7540-7570`). No attachments in NEW confirmations.
- DEF-PAY-03 · P1 · Stat cards USD-only single figure — OLD per-currency native captions (never netted, `fmtTotals`) + USD headline (`BkPayments.jsx:69-132,3011-3051`); NEW `Payments.jsx:199-206`. "Paid This Month" → "Paid recently (7d)"; "Total entries" semantics changed.
- DEF-PAY-04 · P1 · Paid-linger window 7 days vs OLD 14 (`ledger.js:70,525-533` vs `bookkeeping.js:6013-6021`); NEW also dropped the `created_at` fallback for legacy rows.
- DEF-PAY-05 · P1 · Multi-invoice quick filter + per-vendor "N OPEN" chips missing — family-counted from the FULL set, held-excluded (held carried to tooltip), mixed-currency/method ⚠ "cannot be sent as one transfer", click-to-isolate via search (`BkPayments.jsx:44,1247-1281,3392-3421`).
- DEF-PAY-06 · P1 · Batch Payment modal gutted: no Payment Reference, no ONE-proof-uploaded-to-all, "— Same as invoice —" label lost (COALESCE behavior exists unlabeled) (`Payments.jsx:429-449`, `ledger.js:580-603`; OLD `BkPayments.jsx:1104-1156,1996-2089`).
- DEF-PAY-07 · P1 · Installments/partial UI unreachable from Payments: status pill inert — no Paid/"Partially Paid…"/Unpaid popover (also removes the page's only un-pay path), no Mark-partial link, no paid/total progress, no modal (`Payments.jsx:361-363`; OLD `BkPayments.jsx:3586-3681,3788-3810,2450-2662`). Server parity exists (`ledger.js:1794-1877`) but only the Ledger drawer uses it.
- DEF-PAY-08 · P1 · Calendar view missing (toggle + month grid + legend + day chips, `BkPayments.jsx:2995-3007,3054-3141`).
- DEF-PAY-09 · P1 · Toolbar missing wholesale: search, amount grammar `500|500-1000|>500|<=250` w/ amber invalid state, Method/Status/Rep(+No rep) filters, Group by Method/Status, 6 sorts incl. family-aware USD amount comparator (`BkPayments.jsx:52,1276-1358,3153-3249`; NEW has only 7 chips + CSV, `Payments.jsx:214-219`).
- DEF-PAY-10 · P1 · Bulk confirmations don't bundle multi-invoice vendors into one email — one item per row (`Payments.jsx:175-197`; `ledger.js:1594-1616`); OLD grouped by vendor_email → `bulk_payment_confirmation` per-vendor queue (`BkPayments.jsx:664-743`; `bookkeeping.js:7648-7838`). NEW's dispatch kind exists (`emailDispatch.js:34`) but is never used with grouped ids.
- DEF-PAY-11 · P2 · Queue scope excludes only `creator_payment` (`ledger.js:533`); OLD excluded `recoupments/artist_campaigns/bank_statement` (90% noise rationale, `bookkeeping.js:5993-6010`) — cadence writes `bank_statement` rows that can flood the queue/paid-grace set.
- DEF-PAY-12 · P2 · `payment-stats` (`ledger.js:1469-1493`) has no entry_source exclusion and no `parent_id IS NULL` — cards count split children as invoices and include rows the list hides; cards ≠ table.
- DEF-PAY-13 · P2 · Rush/hold never auto-cleared on Paid (stale badges persist; OLD cleared in PUT, `bookkeeping.js:6752-6807`); NEW rush/hold routes lack Paid-guard and already-flagged skip/`skipped`/`invisible` accounting (`ledger.js:481-505,1357-1466`); `paid_marked_at` resets on re-mark.
- DEF-PAY-14 · P2 · Rush/hold reasons via `window.prompt`; **Cancel still applies the flag** (`?? ''`, `Payments.jsx:157,164,169`); 500-char cap lost client+server (OLD `:1672`, `bookkeeping.js:6871`); branded modals w/ invoice summary + bulk totals/payee preview gone (`BkPayments.jsx:1634-1994`).
- DEF-PAY-15 · P2 · Split expansion impossible: `/payables` serves family heads only (`ledger.js:532`) — ▶ disclosure, ↳ child rows, out-of-window child surfacing + tooltip copy all gone (`BkPayments.jsx:1361-1377,1475-1485,3357-3435`); NEW shows Split badge + "family total" subtext only (`Payments.jsx:348,354`).
- DEF-PAY-16 · P2 · BankEvidenceDot per row missing (OLD `:3613`, cols `bookkeeping.js:6073`); NEW component exists but unused here; no `?bank=unverified` analog retained (OLD documented-no-caller, `:6011-6014,6047`).
- DEF-PAY-17 · P2 · Rows read-only: pencil full-row edit, inline artist/rep editors w/ optimistic rollback, delete+restore, and the whole 6s undo-toast system gone (`BkPayments.jsx:305-316,1016-1222,3506-3573,3949-3989,2668-2695`).
- DEF-PAY-18 · P2 · Excel export gone (server `?filter=` export w/ rep-block + TOTAL row, `bookkeeping.js:6279-6373`; button `BkPayments.jsx:2977-2994`); NEW client CSV only (`Payments.jsx:96-110`).
- DEF-PAY-19 · P2 · Send-for-Approval capability: email `count` counts family SLICES not invoices (`ledger.js:695-737`); no Totals-by-Artist / per-invoice detail tables; 6-col Excel w/o per-currency TOTAL rows/due/method/reimb; no regenerable message, default subject, [TEST] mode, or html_override (`bookkeeping.js:6383-6737`; `BkPayments.jsx:1509-1611,2091-2226`). Recipient free-form = intentional (multi-tenant).
- DEF-PAY-20 · P2 · Confirmation editing depth lost: contentEditable HTML preview + Reset + html_override, personal note, live re-render, persisted default-CC (`pay_dash_cc_default`) + "Save as default" (`BkPayments.jsx:346-355,518-655,2292-2447`; NEW `EmailPreviewModal.jsx:14-66` = To/CC/Subject only).
- DEF-PAY-21 · P2 · Persistent bottom bar gone: always-on Filtered-Unpaid + Selected totals (family-deduped + ≈USD via `familyUsdSuffix`), Select All (N), Select Pending Confirmations (N) (`BkPayments.jsx:1447-1463,4006-4196`); NEW bar only while selected, paid rows unselectable on main view (`Payments.jsx:248-264`).
- DEF-PAY-23 · P2 · Mobile regression: no search, no FilterSheet (amount/method/status/rep/sort), no PaymentSheet detail drawer, no sticky bulk bar above BottomNav (`BkPayments.jsx:2702-2934`; NEW `Payments.jsx:270-315`).
- DEF-PAY-30 · P2 · Table presentation: frozen sticky 4-in-1 first cell + edge shadow gone (`BkPayments.jsx:178-188,3258-3292`); Method column + colored method badges gone from unpaid view; due-soon orange tier gone; Confirmation column absent on main view (`Payments.jsx:317-389`).
- DEF-PAY-22 · P3 · Manual "Mark Sent" + Sent-Undo (mark-unsent) UI missing; `/mark-unsent` has zero client callers; `mark-unsent-bulk` dropped (`BkPayments.jsx:3876-3947`; `bookkeeping.js:7857-7959`; `ledger.js:1628`).
- DEF-PAY-24 · P3 · Per-row ≈USD suffix under non-USD amounts (locked-rate aware) missing (`BkPayments.jsx:3447-3477`).
- DEF-PAY-25 · P3 · 10s rush grace after pay gone (`BkPayments.jsx:238-268,1287-1289`; NEW drops rush rows from the filter instantly, `Payments.jsx:67-70`).
- DEF-PAY-26 · P3 · Unpaid chip excludes held rows (`Payments.jsx:68`) while the Total-unpaid card includes them — chip/card mismatch; OLD Unpaid = all not-Paid (`BkPayments.jsx:1278`).
- DEF-PAY-27 · P3 · Rush/Hold tooltips reason-only — requester + date dropped (`Payments.jsx:345-347`; OLD `:3725-3763`).
- DEF-PAY-28 · P3 · Paid tab fetches all-time paid history vs subtitle's "last 7 days" (`Payments.jsx:52-53,212`; `ledger.js:113-141`); OLD Paid chip filtered the 14-day-scoped set.
- DEF-PAY-29 · P3 · Confirmation eligibility loosened: OLD required Paid + proof + not-already-sent w/ refetch-and-skip reporting (`BkPayments.jsx:664-694`; `bookkeeping.js:7554-7556`); NEW gates on vendor_email only, free re-send (`Payments.jsx:188-196`).

Kept/parity worth noting: split-family pay cascade + per-row FX stamping, rush⇔hold mutex (NEW even cascades flags family-wide), drag-drop proof → AI date/ref extraction → family paid (intentional routing, commit d264edf), family_amount selection totals, Split badge, vendor_emails auto-CC, CC-rep default OFF.
Intentional/additive (9): tenancy scoping; free-form per-label approval recipients; per-label email branding via emailDispatch; `rep`/`/reps` vocabulary; 'No bank match' chip absent on both (OLD removed it); on-page WeeklyTrend 12-week charts; ScheduleModal (terms→due-date derivation); signed-URL file previews replacing `?token=`; proof-drop-marks-paid routing through pay-with-proof.

Totals: 30 defects — 10 P1 · 13 P2 · 7 P3; 9 intentional.

## ledger
- [P1] LED-1 Bulk selection + bulk edit missing end-to-end — checkbox col, renderable-set select-all + "M below the visible rows", Set artist/song/category panels (datalists, comma-in-song refusal), QB ✓, Not recoupable, one-undo previous[] regroup; server POST /bk/entries/bulk (BULK_FIELDS whitelist artist/song/category/payment_method/in_quickbooks/recoupable; amount/payment_status/status refused; changed/already/skipped/relinked accounting + autoLinkRelease per row) has no NEW analog client or server (boom BkLedger.jsx:2239-2298,3566-3714; bookkeeping.js:8937-9070) (HIGH)
- [P1] LED-2 CSV export understates split invoices — exports parent slice `amount` w/ children excluded (parent_id IS NULL), includes voided rows, honors no filters; OLD exported family_amount + child_artists, excluded voided, carried ?source (cadence ledger.js:1639-1662 vs boom bookkeeping.js:8322-8355) (HIGH)
- [P1] LED-4 Manual flag-for-review absent from ledger — FlagButton col, flagged/unflagged filter (amber tint), reason popover, POST /flag; NEW ⚠ filter = AI scans only; expenses.flagged written by Artist Campaigns is invisible here (boom BkLedger.jsx:1838-1865,3206-3218,3883-3892; bookkeeping.js:1967-1998 vs cadence Ledger.jsx:323; index.js:659-663) (HIGH)
- [P1] LED-5 Amount-filter semantics wrong — bare "500" matches ≥500 (OLD exact ±0.005), ">"/"<" collapse to ≥/≤, $/commas not stripped, no invalid-input amber border/tooltip (cadence Ledger.jsx:27-35,382 vs boom utils.js:247-280; BkLedger.jsx:3100-3115) (HIGH)
- [P1] LED-6 Editable-field vocabulary shrunk — in_quickbooks absent from NEW entirely (col/filter/bulk/schema-use); ufr, artist_campaign (3-state), social_handles, recoupment_label (Tone Labels), release_id, paid_by, payment_date, bulk_deal_quantity/unit/completed, ufr_marked_at dropped from PATCH allow-list and/or read-only (boom bookkeeping.js:1528-1544; BkLedger.jsx:4480-4590 vs cadence ledger.js:94-100; Ledger.jsx:180-185) (HIGH)
- [P1] LED-8 Inline-edit coverage halved — payee/date/currency/paid-by/date-paid not inline; SocialsCell popover (platform/handle/$/per-artist tag on split families) → read-only cell reading artist_breakdown (post-split snapshot unparseable; social_handles never read); Terms→due-date write + due-date→'Custom' back-write gone; YN chips → text links (boom BkLedger.jsx:481-652,3893-4605 vs cadence Ledger.jsx:37-53,152-196,607-618) (HIGH)
- [P1] LED-12 Export menu reduced to one CSV — Excel workbook, Invoices ZIP, W9s ZIP, Files ZIP (artist/category/search-scoped w/ honest "which filters apply" label) all missing; NEW vendor-zip/bulk-zip unreachable from ledger (boom BkLedger.jsx:3315-3391 vs cadence Ledger.jsx:364-366) (HIGH)
- [P2] LED-3 1099 report understates split vendors — parent_id IS NULL + SUM(e.amount) counts only the parent slice toward the ≥$600 threshold; children counted nowhere (cadence ledger.js:1883-1898) (HIGH)
- [P2] LED-9 Incremental render gone — 150-row paint window + IntersectionObserver sentinel + "showing N of M — scroll for more" + focus cap-stretch vs NEW painting every filtered row (boom BkLedger.jsx:2062-2204,2370-2383,4853-4863 vs cadence Ledger.jsx:490) (HIGH)
- [P2] LED-10 ?focus degraded — split-child focus impossible (children not in main list, no parent expand), active search not cleared, no retry loop, URL param never stripped, 3.5s highlight vs persistent rail, no missing-row banner w/ Approvals pointer (boom BkLedger.jsx:1462-1552,3554-3563 vs cadence Ledger.jsx:226-232) (HIGH)
- [P2] LED-11 File-cell suite lost — file DELETE route + Remove ✕, shared-W9 w9_entry_id alias resolution w/ Upload-not-Replace rule, split-child invoice gating to parent, dedicated Proof column + AI-rescan-on-proof, multi-file ReceiptCell (entity_files count/add/pick-remove), reimb-only N/A gate (boom BkLedger.jsx:381-473,654-809,4391-4463; bookkeeping.js:3035,4695-4766 vs cadence Ledger.jsx:192-195,640-674; ledger.js:969-1008) (HIGH)
- [P2] LED-13 Settlement groups ("One payment") missing — bulk button, ONE PAYMENT · N INVOICES chip + ungroup-not-unmatch, POST/DELETE /bk/settlement-groups validation + orphan-group cleanup (consumer bank-matcher also absent — shared-half caveat) (boom BkLedger.jsx:2300-2364,4115-4142; bookkeeping.js:9091-9192) (HIGH)
- [P2] LED-14 DuplicateInvoicesFlag banner missing — live duplicate_invoices groups w/ reason chips + Duplicates link never surfaced on ledger; NEW dup check is add-time only (boom BkLedger.jsx:816-936 vs cadence ledger.js:1333-1352) (HIGH)
- [P2] LED-15 Source buckets gone — 5-bucket priority resolver shared by column badge + tinted filter select + dark palettes + born-on-page border stripes; NEW filter = vendor/manual, no Source column (boom BkLedger.jsx:201-270,3219-3232,3859-3863,4700-4745 vs cadence Ledger.jsx:81,321-322,386) (HIGH)
- [P2] LED-16 Comma auto-split narrowed + unguarded — client-only (modal/import/API writes never split), comma-only (slash dropped), no no_auto_split flag so an unsplit comma-in-title re-splits on the next inline edit (boom bookkeeping.js:1755-1841,2500-2507 vs cadence Ledger.jsx:120-131; ledger.js:247-304,1156-1194) (HIGH)
- [P2] LED-18 Release linkage lost — autoLinkRelease on song/artist edits (+ "linked to release" toast, red song, release link), artist→/artists/:id hyperlink, per-artist song datalists (releases+entries, most-common-spelling) (boom BkLedger.jsx:1594-1695,1772-1787,3938-3963,4091-4108; bookkeeping.js:1845-1849 vs cadence Ledger.jsx:155,213,614) (HIGH)
- [P2] LED-21 Toolbar/behavior bundle — QB filter, all-filters Clear, window-focus silent refetch (10s throttle), invoice-number-normalized search (normalizeInvoiceNum 2-char key), recoupment-plan row deep-link all missing (boom BkLedger.jsx:1560-1573,2087-2096,3193-3313,4774-4784 vs cadence Ledger.jsx:208-213,316,415) (HIGH)
- [P2] LED-25 Mobile pass missing — FilterSheet (full filter set + sort), 100-row Load more, LedgerEntrySheet (notes/flag/files), header currency totals; NEW shows unadapted desktop filter bar + renders all rows (boom BkLedger.jsx:2821-3074 vs cadence Ledger.jsx:376-424,430-469) (HIGH)
- [P2] LED-27 Void drift — no child cascade (children stay unvoided; family_amount also counts voided children), payment_status reset to Unpaid (paid state lost on unvoid), admin gate → Approver, detailed confirm copy lost (cadence ledger.js:137,1666-1695 vs boom bookkeeping.js:2173-2217; BkLedger.jsx:1988-2010) (HIGH)
- [P2] LED-32 Fee/reimbursement carve-off missing — modal (fee+reimb=total, receipt required, multipart) + POST /entries/:id/split-fee-reimb + receipt-child guards on split/unsplit (boom BkLedger.jsx:1981-2042,5226-5308; bookkeeping.js:2327-2433,2481-2506) (HIGH)
- [P3] LED-17 Re-split refused (409 "unsplit first") where OLD replaced children transactionally (receipt-child guard); per-child edits lost on the round-trip (cadence ledger.js:1104-1105 vs boom bookkeeping.js:2243-2321) (HIGH)
- [P3] LED-19 Undo semantics — no per-edit toast Undo (5s exact-record revertEdit + timer-clear fix), paid-cycle/mark-paid not undoable; NEW undoLast PATCHes inside a setState updater (StrictMode double-fire risk) (boom BkLedger.jsx:1733-1805,2444-2460 vs cadence Ledger.jsx:137-145,234-241) (HIGH)
- [P3] LED-20 Table presentation — frozen block = 6 fields in one <td> (FW widths, TOTAL-row spanning) vs NEW single first column; vertically-sticky header lost; parent border/tints/count pill/"Multi" collapsed labels reduced (boom BkLedger.jsx:2737-2760,3727-3752,3808-3936,4913-4931 vs cadence Ledger.jsx:477-541) (HIGH)
- [P3] LED-22 Totals footer — USD-equivalent line + magnitude-ordered currencies + frozen TOTAL cell lost (NEW excluding voided from totals is an improvement, noted) (boom BkLedger.jsx:2396-2403,4909-4931 vs cadence Ledger.jsx:347-353,535-541) (HIGH)
- [P3] LED-23 Column defaults inverted — OLD 16 toggleables ON + 7 always-on identity cols; NEW 9 of 38 on, and Payee/Amount can be hidden entirely (boom BkLedger.jsx:70-125 vs cadence Ledger.jsx:198) (HIGH)
- [P3] LED-24 Hotkeys c (columns) + x (export) missing; z parity (boom BkLedger.jsx:1424-1434 vs cadence Ledger.jsx:216-224) (HIGH)
- [P3] LED-26 Delete confirm modal (payee + amount) → bare window.confirm (boom BkLedger.jsx:5035-5054 vs cadence Ledger.jsx:244) (HIGH)
- [P3] LED-28 List payload regression pattern — SELECT e.* incl. ai_scan/w9_scan JSONB per row, no ?view trimming, no ?limit; the exact shape OLD's 14.5s incident forced it to fix (cadence ledger.js:134-140 vs boom bookkeeping.js:403-427,780-800) (MED)
- [P3] LED-29 Paid-pill cycle 404s on rejected rows (mark-paid requires approved; NEW lists rejected under status chips); no duplicate-payment warning surfaced (shared-half) (cadence Ledger.jsx:234-241,420; ledger.js:489-495) (MED)
- [P3] LED-30 Split modal — "Split evenly (N)" cent-exact divider + existing-breakdown prefill + per-artist song datalist missing (NEW's sum enforcement is an improvement) (boom BkLedger.jsx:1916-1925,5094-5182 vs cadence SplitModal.jsx:12-24) (HIGH)
- [P3] LED-31 ≈USD affordances — per-amount precise-USD tooltips + collapsed-family USD title lost; NEW ≈USD column off by default, unlocked-rate only (boom BkLedger.jsx:3968-4023 vs cadence Ledger.jsx:160-167) (HIGH)
- [XREF] LED-7 cobrand⇒category='Marketing' forcing absent on ledger PATCH + toggle — already counted as APR-7 (boom bookkeeping.js:1556-1563; BkLedger.jsx:4562-4578 vs cadence ledger.js:247-304)
- [INT] label_id tenancy + withTenant + requireApprover router gate; visibleReps rep-visibility on reads
- [INT] RC-2 brand tokens + Tailwind replacing boom-red inline styles/getDarkColors
- [INT] Signed-URL file GETs replace ?token= URLs (documented hardening)
- [INT] Per-label:user column persistence key (vs OLD global localStorage key)
- [INT] Pending entries excluded from ledger (dedicated Approvals page per spec M2)
- [INT] Generic 'Internal server error' bodies replace err.message leakage
- [INT] Additive NEW features: drawer (History/Installments/Bulk items/AI scan/Discussion/campaign link), quick-add expense, EditEntryModal, CSV import, 1099 modal, ≈USD column, rejected-status view, split snapshot + sum enforcement + unsplit safety guards, activity-bot posts
- [INT] Split-family payment inheritance broader in NEW (entry_source/cobrand/is_bulk_deal/fx/scheduled/terms/vendor_email copied to children)
- [INT] Bank-half machinery (statement lens, BankEvidenceDot, match/unbook popovers, BulkVendorPanel, ExtraTxRow, LedgerViewSwitch) deferred to the separate bank-ledger audit
## add-invoice
- [P0] Approval checklist review gate gone — approver Save files straight to approved with no ReviewDeck/ApprovalChecklistFields step (doc preview, cleared-per-open answers, complete-before-save lock) — fix: cadence client/src/pages/AddLedgerEntry.jsx:109-154 (port OLD BkAddInvoice.jsx:481-488,1786-1893 + lib/approvalChecklist.js) (HIGH)
- [P0] Server checklist contract absent — POST /ledger/entries accepts no checklist, no validate-BEFORE-insert, no approval_checklist storage/stamp, no checklist_stored flag — fix: cadence server/routes/ledger.js:164-246 (port OLD bookkeeping.js:104-190,996-1002,1245-1305) (HIGH)
- [P1] Checklist answer bulk_deal never asked — is_bulk_deal stays default FALSE = "nobody looked" — fix: cadence server/routes/ledger.js:164-246 + AddLedgerEntry.jsx (HIGH)
- [P1] Checklist answer cobrand never asked; no cobrand form checkbox; cobrand→category='Marketing' forcing rule absent at create — fix: cadence server/routes/ledger.js:164-246 + AddLedgerEntry.jsx (OLD client :1772-1789, server :1010-1021) (HIGH)
- [P1] Checklist answer recoupable never asked — hardcoded default TRUE recreates the untracked-recoupable failure — fix: cadence server/routes/ledger.js:210 (HIGH)
- [P1] Checklist answer campaign never asked — artist_campaign column (index.js:546) never written at create nor cascaded to children — fix: cadence server/routes/ledger.js:164-246 (HIGH)
- [P1] The 4 checklist CONFIRMATIONS (artist/song/amount/category) w/ edit-in-place write-through + answerCobrand re-arm missing — fix: cadence client (OLD approvalChecklist.js:24-31,63-69; BkAddInvoice.jsx:1823-1852) (HIGH)
- [P1] /validate-invoice document gate gone (is-it-an-invoice/billed-to checks, red issues banner, green pass chip) — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD bookkeeping.js:3941-3991; client :786-843) (HIGH)
- [P1] /extract-invoice-number + typed-vs-printed normalized mismatch warning gone — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :4072-4118; client :845-861) (HIGH)
- [P1] /parse-lines line-item flow gone end-to-end (deterministic amounts + tie-out, editable per-line category/artist/recoupable, remainder helper); NEW splits can't carry per-line category/description/recoupable — fix: cadence server/routes/ledger.js:335-352,397-407 + AddLedgerEntry.jsx (OLD :4120-4263; client :1436-1533,548-576) (HIGH)
- [P1] /validate-w9 auto-validation on W9 attach gone (claude.validateW9 exists in lib but unrouted/uncalled) — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :3997-4070; client :393-407,1057-1093) (HIGH)
- [P1] /parse-proof gone — proof no longer extracts payment_date/method/ref, client doesn't set Paid, "Auto-marks as paid" hint false for non-approvers, proof-remove doesn't reset payment fields — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx:198 (OLD :4769-4797; client :391-431,1010) (HIGH)
- [P1] suggest-vendor gone: exact-match autofill of vendor_email/address/bank + "Did you mean?" chips (NEW /ledger/vendor-suggest exists at :830 but page never calls it) — fix: cadence client/src/pages/AddLedgerEntry.jsx (OLD :4455-4482; client :152-186,1113-1129) (HIGH)
- [P1] vendor-w9-status "W9 already on file — Preview" banner + W9 tile already-on-file state gone — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx (OLD :4490-4517; client :176-186,975-979,1131-1150) (HIGH)
- [P1] Duplicate UX degraded: debounced-live + post-parse sweep → onBlur only; entry-linked banners (Open in Approvals / ?focus= routing, pending explanation), similar tier, amber tint gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:52-56,235 (OLD :189-199,318-343,753-806,1213-1253) (HIGH)
- [P1] Server 409 duplicate gate + force_duplicate "Add anyway" bypass gone — exact dups insert freely — fix: cadence server/routes/ledger.js:164-246 (OLD :1069-1082,4571-4623; client :646-668) (HIGH)
- [P1] Vendor email no longer required nor format-validated (nor parse-filled) — fix: cadence client/src/pages/AddLedgerEntry.jsx:112-116,231 (OLD :455-462) (HIGH)
- [P1] Non-admin gate gone: song + ≥1 social handle no longer required for non-admin submitters — fix: cadence client/src/pages/AddLedgerEntry.jsx:112-116 (OLD :463-473) (HIGH)
- [P2] Parse narrower: no artist/song/vendor_email extraction, no roster context / handle-swap validation / ai_warnings / suggest_socials, no weighted category vocabulary, no ai_status/0-fields toast diagnosis — fix: cadence server/lib/claude.js:170-203 + routes/ledger.js:1233-1244 (OLD :4265-4453) (HIGH)
- [P2] Parse + check-dup below requireApprover — non-approver members lose AI parse and get silent 403→null dup checks — fix: cadence server/routes/ledger.js:84,1233,1333 (HIGH)
- [P2] check-dup weaker: no vendor_aliases union, no vendor_name match, no similar-format tier — fix: cadence server/routes/ledger.js:1333-1352 (OLD :4625-4693) (HIGH)
- [P2] Tri-state urgency (Rush/Hold + reason, non-Paid-gated, mutex) not capturable at create — fix: cadence client AddLedgerEntry.jsx + server/routes/ledger.js:164-246 (OLD client :1675-1770; server :1023-1035) (HIGH)
- [P2] Bulk-deal marker + quantity + unit form fields at entry gone — fix: cadence client/src/pages/AddLedgerEntry.jsx (OLD :877-940; server :1104-1110) (HIGH)
- [P2] Ref # (payment_ref) input missing from Mark-as-Paid row — fix: cadence client/src/pages/AddLedgerEntry.jsx:219-230 (OLD :1656-1668) (HIGH)
- [P2] social_handles JSONB never persisted: amount-less handles discarded, platform + per-handle artist tag dropped; NEW flags.js:174 missing_socials will flag rows this page creates — fix: cadence client AddLedgerEntry.jsx:131-134 + server/routes/ledger.js:164-246 (OLD client :528-545,1327-1408; server :1040-1054) (HIGH)
- [P2] Rep not defaulted to current user; current user not injected into rep options — fix: cadence client/src/pages/AddLedgerEntry.jsx:38-49,218 (OLD :36-41,113-118) (HIGH)
- [P2] useUnsavedWarning/beforeunload gone (dirty form lost silently) — fix: cadence client/src/pages/AddLedgerEntry.jsx (OLD :124) (HIGH)
- [P2] payment_terms (Net 30) + scheduled_payment_date=computeDueDate(now,terms) not stamped at create — fix: cadence server/routes/ledger.js:191-214 (OLD :1090-1101) (HIGH; Payments impact UNVERIFIED — needs runtime check)
- [P2] Artist normalization not applied at create despite artist_normalization_map existing in NEW — fix: cadence server/routes/ledger.js:164-246 (OLD :1038) (HIGH)
- [P3] Parse fill precedence inverted (typed-wins vs OLD parsed-wins) — re-parse can't refresh a wrong field — fix: cadence client/src/pages/AddLedgerEntry.jsx:73-83 (OLD :299-313) (HIGH)
- [P3] autoLinkRelease(artist,song) on create gone — fix: cadence server/routes/ledger.js:164-246 (OLD :1296) (HIGH)
- [P3] Split children inherit less (vendor_email/vendor_name/bank, payment_date/paid_by, terms, due date, cobrand not copied) — fix: cadence server/routes/ledger.js:397-407 (OLD :1200-1243) (HIGH)
- [P3] pdf/jpg/png allowlist + error gone; Dropzone drop path accepts any type regardless of accept — fix: cadence client/src/components/Dropzone.jsx:11-15 (OLD :210-241) (HIGH)
- [P3] Save navigates away — reset-in-place rapid multi-entry + persistent success/error banners gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:149-151 (OLD :562-599,682-707) (HIGH)
- [P3] paid_by / paid_marked_at not stamped when created Paid — fix: cadence server/routes/ledger.js:183-215 (OLD :1097-1105,1141) (HIGH; Payments 7-day linger interaction UNVERIFIED — needs runtime check)
- [P3] Split editor: remainder-prefilled Add-artist, numbered rows, balance footer gone; NEW hard-blocks unbalanced saves OLD allowed w/ warning — fix: cadence client/src/pages/AddLedgerEntry.jsx:100,126-128 (OLD :1534-1620,583-599) (HIGH)
- [INT] Tenancy: label_id everywhere, withTenant, per-label vendors upsert, tenant-namespaced R2 keys — server/routes/ledger.js:63,86-91,216-221
- [INT] Open-to-all-members create + pending routing w/ role-dependent subtitle + "Submitted for approval" toast (documented Cadence design) — App.jsx:180; ledger.js:78-84,183
- [INT] Atomic multipart create (files ride the INSERT) vs OLD post-create uploads w/ swallowed failures — ledger.js:74-81
- [INT] Approver-gated "Mark as already paid" (OLD let any bk user create Paid rows) — AddLedgerEntry.jsx:219-230; ledger.js:183-191
- [INT] Brand accent + ui kit per RC-2/RC-5/RC-6; toast system replaces inline banners — AddLedgerEntry.jsx throughout
- [INT] Currency list 4→12 (constants.js:13); PAYMENT_METHODS identical
- [INT] Socials-with-amounts materialize as real Marketing child rows (NEW allocation model, commit 82fa2b0) — ledger.js:335-352,397-407
- [INT] Explicit Parse button framing (AI-quota copy) — AddLedgerEntry.jsx:16-22,170-184
- [INT] Parent-takes-first-slice split family model matches OLD — ledger.js:353-419
## add-reimbursement
- [P1] Vendor email removed in reimbursement mode (OLD required + regex) — reimbursement rows carry no payee contact — fix: cadence client/src/pages/AddLedgerEntry.jsx:231,112-116 (OLD BkAddReimbursement.jsx:184-192,413-418) (HIGH)
- [P1] Invoice # field removed AND checkDup early-returns when isReimb — no reference recordable, zero dup detection for reimbursements client or server — fix: cadence client/src/pages/AddLedgerEntry.jsx:53,213 (OLD :77-86,440-453) (HIGH)
- [P1] Multi-receipt upload (N files → entity_files, count + Clear all) collapsed to single receipt_file column slot; proof can displace the receipt slot via direct API — fix: cadence client AddLedgerEntry.jsx:44,196 + server/routes/ledger.js:170-181 (OLD client :95-116,241-246,339-364; server :4695-4713) (HIGH)
- [P2] /parse-proof extraction gone + client no longer auto-marks Paid on proof; hint false for non-approvers (shared w/ add-invoice) — fix: cadence server/routes/ledger.js + AddLedgerEntry.jsx:198 (OLD :148-174) (HIGH)
- [P2] Non-admin ≥1-social-handle requirement gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:112-116 (OLD :193-196) (HIGH)
- [P2] social_handles JSONB never persisted for reimbursed creators (shared w/ add-invoice) — fix: cadence client AddLedgerEntry.jsx:131-134 + server/routes/ledger.js:164-246 (OLD :209-222) (HIGH)
- [P2] AI parse approver-only; OLD could also parse a receipt when no invoice file chosen (parseFile/receiptFiles[0] fallback) — fix: cadence server/routes/ledger.js:84,1233 + AddLedgerEntry.jsx:170 (OLD :118-146) (HIGH)
- [P2] useUnsavedWarning gone — fix: cadence client/src/pages/AddLedgerEntry.jsx (OLD :67) (HIGH)
- [P2] payment_ref input missing; proof-remove no longer resets payment_status/date/ref — fix: cadence client AddLedgerEntry.jsx:219-230 + components/Dropzone.jsx:16 (OLD :385,645-651) (HIGH)
- [P3] Save navigates away; reset-in-place multi-entry + persistent success banner gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:149-151 (OLD :251-264,286-291) (HIGH)
- [P3] Rep not defaulted/current-user not offered; "Date *" relabeled "Invoice date *" (misleading for receipt-dated spend) — fix: cadence client/src/pages/AddLedgerEntry.jsx:38-49,203,218 (OLD :401,477-484) (HIGH)
- [P3] Split editor hard-blocks unbalanced totals OLD saved w/ warning; no remainder prefill — fix: cadence client/src/pages/AddLedgerEntry.jsx:126-128 (OLD :493-535) (HIGH)
- [P3] Parse fill precedence inverted (typed-wins vs OLD parsed-wins) — fix: cadence client/src/pages/AddLedgerEntry.jsx:73-83 (OLD :128-140) (HIGH)
- [P3] Per-handle artist tag on socials for split reimbursements gone — fix: cadence client/src/pages/AddLedgerEntry.jsx:238-253 (OLD :591-604) (HIGH)
- [P3] pdf/jpg/png allowlist + error gone (shared w/ add-invoice) — fix: cadence client/src/components/Dropzone.jsx:11-15 (OLD :95-102) (HIGH)
- [INT] Receipt REQUIRED client-side (OLD optional; matches BUILD_SPEC) — server does NOT enforce, bypassable via direct API — AddLedgerEntry.jsx:116,196; ledger.js:164-246
- [INT] Reimbursement is a live mode toggle on the shared component; admin route /ledger/new-reimbursement kept — App.jsx:182; AddLedgerEntry.jsx:28,188-191
- [INT] No member-facing reimbursement route — members reach the mode via the checkbox on /add-invoice
- [INT] Approver-gated Mark-as-paid; tenancy/multipart/toasts/brand as add-invoice
- [INT] Mailing address + Bank name shown in reimb mode (OLD reimb page had neither) — AddLedgerEntry.jsx:232-233
- [INT] Currency list 4→12 — constants.js:13

## add-invoice
(reconstructed from pages/add-invoice.md §7 after agent was killed pre-append)
## 7. Defect register

| ID | Sev | Where (NEW) | Defect | OLD reference |
|---|---|---|---|---|
| DEF-ADDINV-01 | P0 | `AddLedgerEntry.jsx:109-154` | Approval review gate gone: approver Save files straight to `approved` with no ReviewDeck/ApprovalChecklistFields step, no doc-beside-questions preview, no complete-before-save lock, no cleared-per-open answers | `BkAddInvoice.jsx:481-488,1786-1893`; `lib/approvalChecklist.js` |
| DEF-ADDINV-02 | P0 | `ledger.js:164-246` | Server checklist contract absent: no `checklist` accepted, no validate-BEFORE-insert, no `approval_checklist` storage/stamp (`by`/`at`), no `checklist_stored` response flag; grep: zero checklist references in cadence | `bookkeeping.js:104-139,161-190,996-1002,1245-1305` |
| DEF-ADDINV-03 | P1 | `ledger.js:164-246` | Checklist answer **bulk_deal** never asked — `is_bulk_deal` (col exists, `index.js:527`) stays default FALSE, indistinguishable from "nobody looked" | `approvalChecklist.js:35-40`; `bookkeeping.js:119-139,1104-1110` |
| DEF-ADDINV-04 | P1 | `ledger.js:164-246`; `AddLedgerEntry.jsx` (no control) | Checklist answer **cobrand** never asked; no cobrand checkbox on the form; cobrand→`category='Marketing'` forcing rule absent at create | OLD client :1772-1789; server :1010-1021 |
| DEF-ADDINV-05 | P1 | `ledger.js:210` | Checklist answer **recoupable** never asked — silently defaults TRUE, recreating the untracked-recoupable failure the checklist closed | `bookkeeping.js:1055-1067,161-190` |
| DEF-ADDINV-06 | P1 | `ledger.js:164-246` | Checklist answer **campaign** never asked — `artist_campaign` col exists (`index.js:546`) but is never written at create, nor cascaded to split children | `bookkeeping.js:1264-1283` |
| DEF-ADDINV-07 | P1 | `AddLedgerEntry.jsx` | The 4 CONFIRMATIONS (artist/song/amount/category) w/ edit-in-place write-through + cobrand re-arm (`answerCobrand`) missing | `approvalChecklist.js:24-31,63-69`; `BkAddInvoice.jsx:1823-1852` |
| DEF-ADDINV-08 | P1 | no NEW endpoint/UI | `/validate-invoice` document gate gone: no is-it-an-invoice / billed-to / has-number checks, no red issues banner or green pass chip | `bookkeeping.js:3941-3991`; client :786-843 |
| DEF-ADDINV-09 | P1 | no NEW endpoint/UI | `/extract-invoice-number` + typed-vs-printed normalized mismatch warning gone | `bookkeeping.js:4072-4118`; client :845-861 |
| DEF-ADDINV-10 | P1 | no NEW equivalent; `ledger.js:335-352,397-407` | `/parse-lines` line-item flow gone end-to-end: deterministic amounts + printed-total tie-out, editable per-line category/artist/recoupable table, remainder helper, lines-over-splitter precedence; NEW splits cannot carry per-line category/description/recoupable | `bookkeeping.js:4120-4263`; client :265-283,548-576,1436-1533 |
| DEF-ADDINV-11 | P1 | no NEW route; page never calls `claude.validateW9` | `/validate-w9` auto-validation on attach gone (spinner → issues / "looks complete · signed · dated") | `bookkeeping.js:3997-4070`; client :393-407,1057-1093 |
| DEF-ADDINV-12 | P1 | `AddLedgerEntry.jsx:198`; `ledger.js:183-191` | `/parse-proof` gone: proof no longer extracts payment_date/method(reference→payment_ref) (OLD applied method INSIDE the state updater to avoid clobbering); client doesn't set Paid; "Auto-marks as paid" hint is false for non-approvers; proof-remove doesn't reset payment fields | `bookkeeping.js:4769-4797`; client :391-431,1010 |
| DEF-ADDINV-13 | P2 | `claude.js:170-203`; `ledger.js:1233-1244` | Parse narrower: no artist/song/vendor_email extraction, no roster context, no handle-vs-artist swap validation / `ai_warnings` / `suggest_socials`, no weighted live category vocabulary, no 0-fields/`ai_status` toast diagnosis | `bookkeeping.js:4265-4453`; client :288-375 |
| DEF-ADDINV-14 | P3 | `AddLedgerEntry.jsx:73-83` | Parse fill precedence inverted (typed-wins vs OLD parsed-wins) — re-parse cannot refresh a wrong field | `BkAddInvoice.jsx:299-313` |
| DEF-ADDINV-15 | P2 | `ledger.js:84,1233,1333`; `AddLedgerEntry.jsx:170` | Parse + check-dup sit below `requireApprover` — non-approver members (the page's target users) lose AI parse entirely and get silent 403→null dup checks | `bookkeeping.js:40-61` (auth + page grant only) |
| DEF-ADDINV-16 | P1 | page never calls `/ledger/vendor-suggest` (:830) | suggest-vendor gone: exact-match autofill of blank vendor_email/address/bank + "Did you mean?" chips w/ invoice counts | `bookkeeping.js:4455-4482`; client :152-186,1113-1129 |
| DEF-ADDINV-17 | P1 | no NEW endpoint/UI | vendor-w9-status gone: "W9 already on file — Preview" banner + W9 tile "Already on file / Only upload if updated" state (alias-aware lookup) | `bookkeeping.js:4490-4517`; client :176-186,975-979,1131-1150 |
| DEF-ADDINV-18 | P1 | `AddLedgerEntry.jsx:52-56,235` | Duplicate UX degraded: debounced-live + post-parse sweep → onBlur only; entry-linked banners (amount/status/date, "Open in Approvals" vs `?focus=` routing, pending-not-in-ledger explanation), similar-invoice tier, amber field tint all gone | client :189-199,318-343,753-806,1213-1253 |
| DEF-ADDINV-19 | P1 | `ledger.js:164-246` | Server 409 duplicate gate + `force_duplicate` "Add anyway" confirm bypass gone — exact dups insert freely | `bookkeeping.js:1069-1082,4571-4623`; client :516-519,646-668 |
| DEF-ADDINV-20 | P2 | `ledger.js:1333-1352` | check-dup weaker: no vendor_aliases union, no vendor_name match, no `similar` (same-normalized-different-format) reporting tier | `bookkeeping.js:4625-4693` |
| DEF-ADDINV-21 | P1 | `AddLedgerEntry.jsx:112-116,231` | Vendor email no longer required nor format-validated (and not parse-filled) — rows land with no reachable payee contact | client :455-462,1290-1300 |
| DEF-ADDINV-22 | P1 | `AddLedgerEntry.jsx:112-116` | Non-admin gate gone: song (splits count) + ≥1 social handle no longer required for non-admin submitters | client :463-473 |
| DEF-ADDINV-23 | P2 | `AddLedgerEntry.jsx` (absent); `ledger.js:164-246` | Tri-state urgency (Normal/Rush/Hold + ≤500-char reason, only-when-not-Paid, server mutex) not capturable at create | client :498-508,1675-1770; server :1023-1035,1171-1177 |
| DEF-ADDINV-24 | P2 | `AddLedgerEntry.jsx` (absent) | Bulk-deal marker + quantity + unit form fields at entry gone (with off-toggle clearing) | client :877-940; server :1104-1110 |
| DEF-ADDINV-25 | P2 | `AddLedgerEntry.jsx:219-230` | Ref # (`payment_ref`) input missing from the Mark-as-Paid row | client :1656-1668 |
| DEF-ADDINV-26 | P2 | `AddLedgerEntry.jsx:131-134`; `ledger.js:164-246` | `social_handles` JSONB never persisted: amount-less handles silently discarded, platform + per-handle artist tag dropped — NEW's own `flags.js:174` (missing_socials) will flag rows this page creates | client :528-545,1327-1408; server :1040-1054 |
| DEF-ADDINV-27 | P2 | `AddLedgerEntry.jsx:38-49,218` | Rep not defaulted to the current user, and the current user isn't injected into options when absent from the rep list | client :36-41,113-118 |
| DEF-ADDINV-28 | P2 | grep: no beforeunload in cadence client | `useUnsavedWarning` gone — dirty form lost on nav/close without prompt | client :124 |
| DEF-ADDINV-29 | P2 | `ledger.js:191-214` | `payment_terms` (Net 30) + `scheduled_payment_date = computeDueDate(now, terms)` not stamped at create — impact on Payments due-date views `UNVERIFIED — needs runtime check` | `bookkeeping.js:1090-1101` |
| DEF-ADDINV-30 | P2 | `ledger.js:164-246` | Artist normalization not applied at create (map + flags UI exist in NEW; `flags.js:49,222`) — raw multi-artist strings land in the ledger | `bookkeeping.js:1038` |
| DEF-ADDINV-31 | P3 | `ledger.js:164-246` | `autoLinkRelease(artist, song)` on create gone | `bookkeeping.js:1296` |
| DEF-ADDINV-32 | P3 | `ledger.js:397-407` | Split children inherit less: vendor_email/vendor_name/bank, payment_date/paid_by, payment_terms, scheduled_payment_date, cobrand not copied | `bookkeeping.js:1200-1243` |
| DEF-ADDINV-33 | P3 | `Dropzone.jsx:11-15` | pdf/jpg/png allowlist + "Only PDF, JPG, and PNG" error gone; drop path accepts any file type regardless of `accept` | client :210-241 |
| DEF-ADDINV-34 | P3 | `AddLedgerEntry.jsx:149-151` | Save navigates away — OLD's reset-in-place rapid multi-entry flow + persistent success/error banners gone | client :562-599,682-707 |
| DEF-ADDINV-35 | P3 | `ledger.js:183-215` | `paid_by` / `paid_marked_at` not stamped when created Paid (FX + payment_date only) — Payments 7-day linger interaction `UNVERIFIED — needs runtime check` | `bookkeeping.js:1097-1105,1141` |
| DEF-ADDINV-36 | P3 | `AddLedgerEntry.jsx:100,126-128` | Split editor: remainder-prefilled "Add artist" + numbered rows + balanced footer styling gone; NEW hard-blocks unbalanced saves that OLD allowed with a warning | client :1534-1620,583-599 |

## add-reimbursement
(reconstructed from pages/add-reimbursement.md §7 after agent was killed pre-append)
## 7. Defect register

| ID | Sev | Where (NEW) | Defect | OLD reference |
|---|---|---|---|---|
| DEF-ADDREIMB-01 | P1 | `AddLedgerEntry.jsx:231` (`!isReimb`), `:112-116` | Vendor email removed in reimbursement mode (OLD required + regex-validated) — reimbursement rows carry no payee contact for decision/payment emails | `BkAddReimbursement.jsx:184-192,413-418` |
| DEF-ADDREIMB-02 | P1 | `AddLedgerEntry.jsx:213` (`!isReimb`), `:53` | Invoice # field removed AND `checkDup` early-returns for reimbursements — no reference number recordable, zero duplicate detection client or server for reimbursements | `BkAddReimbursement.jsx:77-86,440-453` |
| DEF-ADDREIMB-03 | P1 | `AddLedgerEntry.jsx:44,196`; `ledger.js:170-181` | Multi-receipt upload gone: OLD accepted N receipts into `entity_files` w/ count + "Clear all"; NEW has one `receipt_file` column slot (and an attached proof silently occupies it when no receipt was chosen — but NEW requires a receipt, so only via direct API) | `BkAddReimbursement.jsx:95-116,241-246,339-364`; `bookkeeping.js:4695-4713` |
| DEF-ADDREIMB-04 | P2 | no NEW endpoint; `AddLedgerEntry.jsx:198` | `/parse-proof` extraction gone (payment date toast, method-inside-updater, ref) + client no longer auto-marks Paid on proof; "Auto-marks as paid" hint false for non-approvers (shared w/ DEF-ADDINV-12) | `BkAddReimbursement.jsx:148-174` |
| DEF-ADDREIMB-05 | P2 | `AddLedgerEntry.jsx:112-116,240` | Non-admin ≥1-social-handle requirement gone (socials always optional) | `BkAddReimbursement.jsx:193-196,558-561` |
| DEF-ADDREIMB-06 | P2 | `AddLedgerEntry.jsx:131-134`; `ledger.js:164-246` | `social_handles` JSONB never persisted for reimbursed creators; amount-less handles discarded (shared w/ DEF-ADDINV-26; feeds NEW `flags.js:174` missing_socials) | `BkAddReimbursement.jsx:209-222` |
| DEF-ADDREIMB-07 | P2 | `ledger.js:84,1233`; `AddLedgerEntry.jsx:170` | AI parse approver-only — OLD let any bk-granted user parse; OLD could also parse a receipt when no invoice file existed (`parseFile`/`receiptFiles[0]` fallback), NEW parses `invoice_file` only | `BkAddReimbursement.jsx:118-146,325-337` |
| DEF-ADDREIMB-08 | P2 | grep: no beforeunload in cadence client | `useUnsavedWarning` gone | `BkAddReimbursement.jsx:67` |
| DEF-ADDREIMB-09 | P2 | `AddLedgerEntry.jsx:219-230`; `Dropzone.jsx:16` | Ref # (`payment_ref`) input missing; proof-remove no longer resets payment_status/date/ref | `BkAddReimbursement.jsx:385,645-651` |
| DEF-ADDREIMB-10 | P3 | `AddLedgerEntry.jsx:149-151` | Save navigates away — reset-in-place multi-entry flow + persistent success banner gone | `BkAddReimbursement.jsx:251-264,286-291` |
| DEF-ADDREIMB-11 | P3 | `AddLedgerEntry.jsx:38-49,203,218` | Rep not defaulted / current-user not offered; `Date *` relabeled `Invoice date *` (misleading for receipt-dated spend) | `BkAddReimbursement.jsx:401,477-484` |
| DEF-ADDREIMB-12 | P3 | `AddLedgerEntry.jsx:126-128` | Split editor hard-blocks unbalanced totals that OLD saved with a warning; no remainder prefill | `BkAddReimbursement.jsx:493-535` |
| DEF-ADDREIMB-13 | P3 | `AddLedgerEntry.jsx:73-83` | Parse fill precedence inverted (typed-wins vs OLD parsed-wins) — shared w/ DEF-ADDINV-14 | `BkAddReimbursement.jsx:128-140` |
| DEF-ADDREIMB-14 | P3 | `AddLedgerEntry.jsx:238-253` | Per-handle artist tag on socials for split reimbursements gone (untagged-shared-family-wide semantics unrepresentable) | `BkAddReimbursement.jsx:591-604` |
| DEF-ADDREIMB-15 | P3 | `Dropzone.jsx:11-15` | pdf/jpg/png allowlist + error message gone; drop path unfiltered (shared w/ DEF-ADDINV-33) | `BkAddReimbursement.jsx:95-102` |

## create-nda
(reconstructed from pages/create-nda.md §7 after agent was killed pre-append)
## 7. Defects found

- NDA-1 P1 — Legal template content replaced wholesale: OLD `standard` = the executed Boom 15-section NDA (Confidential Information w/ A-exclusions bullet list, Protection A–D, Injunction, Non-Circumvention 1yr, Non-Solicitation 2yr A–D, Return w/ 5-day certification, Relationship, No Warranty, Limited License, Indemnity, Attorney's Fees, Term 2y + 2y survival, General Provisions/CA law, Whistleblower Protection (DTSA), Signatories) and `invest` = corporate-counterparty variant (Purpose preamble, Personnel definition, §II(E) government-disclosure carve-out, 10-business-day retention/certification, no-further-obligation §V, Other Businesses §VIII, explicit Romans w/ IX/XII "[intentionally omitted.]", 1-year term, §§IV,V,VII–XI survive); NEW ships 3 short generic templates sharing ~6 boilerplate sections — none of the OLD text exists anywhere in cadence (boom standard.js:13-112, invest.js:39-125 vs cadence ndaTemplates.js:44-162).
- NDA-2 P1 — Dirty-body auto-sync gone: OLD diff-substitutes changed watched fields into a hand-edited body (word-boundary regex escaping, 400ms debounce, flush-on-save, prevFormRef snapshots, effective-date formatted substitution); NEW freezes the body at first manual edit — later field changes silently diverge from the document (boom CreateNDA.jsx:171-229,344-352 vs cadence CreateNda.jsx:50-53).
- NDA-3 P1 — No export/preview from saved rows: Preview modal + per-row Download PDF + Word (each rebuilt from the row's OWN template + template_data, incl. legacy no-body reconstruction) → Open/Delete only (boom :884-918,929-969,419-424 vs cadence :215-247).
- NDA-4 P1 — Signature blocks dropped from all three renderers: structured OWNER/RECIPIENT By/Name/Title/Date blocks (recipient_signatory fallback, blank-Title omission, same-page PDF guard) → one inline "IN WITNESS WHEREOF" body paragraph with a literal "Name / Title" recipient placeholder (boom shared.js:105-133, CreateNDA.jsx:79-84,471-487,536-552 vs cadence ndaTemplates.js:159).
- NDA-5 P2 — Clause toggles not derived from the saved body: OLD marker-regex re-derivation on load (hand-deleted section unchecks itself; legacy NULL column `!== false` semantics); NEW trusts `data.enabled`, so checkboxes can contradict the stored document (boom :280-309, standard.js:124-137 vs cadence :60).
- NDA-6 P2 — Mandatory-section model inverted: per-template regex list + non-blocking amber warning while editing w/ inline Reset → single global 4-heading `includes()` list that hard-blocks save with no in-editor warning (boom :246-251,797-808, standard.js:146-149, invest.js:163-167 vs cadence :66-69, ndaTemplates.js:165-167).
- NDA-7 P2 — Heading engine + numbering reduced: getHeadingLevel h1/h2/body heuristic (all-caps title centering; Roman + single-letter subsections; false-negative bias) and gap-free Roman renumbering/explicit-Roman placeholders → `/^\d+\.\s+[A-Z]/` bold-or-not and Arabic numbering; all-caps titles and A./B. subsections render as plain body in preview/PDF/docx (boom shared.js:51-62, standard.js:100-110, invest.js:115-123 vs cadence CreateNda.jsx:11, ndaTemplates.js:156).
- NDA-8 P2 — Template switching lost its guards: dirty-body/editing `window.confirm`s + first-template fallback for unknown ids → unguarded Link navigation (edits silently lost) + picker page on bad ids (boom :139-147,586-602, index.js:34-36 vs cadence :20,125-141,147).
- NDA-9 P2 — Required fields unenforced: OLD client check + input `required` + server 400 on effective_date/owner/recipient; NEW asterisk-only (`f.required` never wired to an attribute or save check) and server requires only template+body — fully blank NDAs save (boom :336-339,654-694, ndas.js:31-33 vs cadence :161-166,66-79, nda-documents.js:33-36).
- NDA-10 P2 — Export fidelity + filenames: helvetica/16pt-centered-title/11pt/1in/bullet-preserving PDF and mirrored docx (helvetica, 32/22 half-points, 1440 margins) → times/14pt-left-docTitle PDF, default-styled docx; filename `Boom.Records-NDA-{Recipient}-{date}` (prefix from the row's own template) → `{docTitle}` with no label-name/recipient/date equivalent — the branding substitution was dropped, not adapted (boom :396-495,503-571 vs cadence :86-122).
- NDA-11 P2 — Owner/recipient address fields + `disclosed_to` have no NEW equivalent; OLD prefilled the owner address from BOOM_DEFAULTS and a per-label address substitute was never added (boom shared.js:9-14,70-73, ndas.js:24-29 vs cadence ndaTemplates.js:77-121).
- NDA-12 P3 — Page affordances: load Skeleton, "Edit NDA #id"/Cancel-edit header + contextual subtitle, "· customized" body badge, body helper copy, reset tooltip, scroll-to-top on edit all gone; list fetch errors swallowed (`.catch(() => {})`) (boom :574-580,631-649,810-834,328 vs cadence :30-31,145-195).
- NDA-13 P3 — Saved-list data narrowed: Effective/Owner/Recipient/Created·by columns → Title/Template/Created; created_by stored as user id and never displayed (boom :866-881, ndas.js:58 vs cadence :221-243, nda-documents.js:40).
- NDA-14 P3 — Toggle-while-dirty: OLD confirm-then-rebuild applies the toggle in one step; NEW disables checkboxes + error-toned toast until manual reset (boom :258-267 vs cadence :53,174-180).
- NDA-15 P3 — Body dates locale-dependent: OLD forces `en-US` long dates; NEW `toLocaleDateString(undefined, …)` renders per-browser (boom shared.js:26-32 vs cadence ndaTemplates.js:8-12). Actual rendering per locale `UNVERIFIED — needs runtime check`.

Intentional divergences: label_id scoping + withTenant + requireApprover + logActivity + generic error bodies (nda-documents.js:10,20,25-26,42); `AdminRoute` + `isApprover` nav gating (cadence App.jsx:155-156, Layout.jsx:270); owner party defaulting to `label?.name` + signatory to `user?.name` in place of BOOM_DEFAULTS constants (CreateNda.jsx:44); "Boom.Records" naming stripped from template labels/descriptions/filenames (the *naming*, not the clause text).

## label-waiver
(reconstructed from pages/label-waiver.md §7 after agent was killed pre-append)
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

## artist-clearance
- AC-1 P1 — 9 of 12 per-track top-row fields dropped (role, docs_needed, sample_review, release_date, royalty_comments, royalty_account, advance, recoupable_portion + release_id FK) — no input, storage, or XLSX cell (boom ArtistClearance.jsx:30-36,428-439 vs cadence ArtistClearance.jsx:14, clearanceXlsx.js:7-13).
- AC-2 P1 — 6 of 16 SUB_FIELDS rows missing (Musician Credits, Recorded by, Lyrics, Stems / Masters?, Artwork?, Credits Approved?); surviving labels renamed ("Clean or Explicit"→"Explicit", "Samples / AI?"→"Samples / AI", "Writers (full names)"→"Writers") (boom :11-28, boom clearances.js:37-54 vs cadence :8-13, clearanceXlsx.js:7-13).
- AC-3 P1 — Canonical XLSX template abandoned: OLD renders into server/templates/artist-clearance.xlsx (prefix-labeled header rows 1-12, real Date cell, 17-row track blocks from row 15, 13-col primary row, col-C/D sub-rows, cloned styling); NEW emits a from-scratch exceljs sheet w/ hardcoded indigo banner + 12-field label/value pairs — structurally a different document (boom clearances.js:26-183 vs cadence clearanceXlsx.js:19-67).
- AC-4 P1 — Documents-tab attach pipeline gone: OLD uploads the generated XLSX to R2 + entity_files ('Artist Clearance Chart') on every save, replaces in place, migrates on artist change, cleans up on delete; NEW never persists a file (boom clearances.js:195-240,299-311,343-364,389-414 vs cadence clearances.js:73-125).
- AC-5 P1 — Catalog linking degraded: TrackTitleInput autocomplete (EXACT MATCH chip), release_id binding w/ Linked badge/unlink/auto-unlink, manual-value-preserving applyReleaseToTrack (incl. release_date + featured_artists→credit), sibling-release exclusion all gone; NEW chips prefill only title/isrc/produced_by and allow duplicate adds (boom :42-53,398,419-424,576-643 vs cadence :39,98-103).
- AC-6 P2 — Bulk multi-select catalog picker (search, checkboxes, already-added disabled, "Add N tracks", replace-default-blank) removed (boom :137-155,333-383).
- AC-7 P2 — Sticky "Chart preview" side panel (7 PreviewRows + numbered track list) removed (boom :483-521).
- AC-8 P3 — Track UX: multi-open Set expansion w/ enforced min-1 track → single-open accordion starting at zero tracks (boom :66-68,81,124-127 vs cadence :24,36-38).
- AC-9 P3 — Every download saves as literal clearance.xlsx (client hardcodes a.download, ignoring Content-Disposition); server name drops OLD's date suffix (boom :210-214, boom clearances.js:186-190 vs cadence :71, cadence clearances.js:139).
- AC-10 P3 — /catalog no longer excludes archived releases, drops project_name ASC tiebreak + release_type/genre cols, returns 200 [] instead of 400 sans artist_id (boom clearances.js:246-254 vs cadence clearances.js:24-31).
- AC-11 P3 — Saved list ordered by updated_at DESC vs created_at DESC,id DESC — rows jump on edit (boom clearances.js:270 vs cadence clearances.js:45).
- AC-12 P3 — main_artist_royalty_account demoted to royalty_account ("Main artist" qualifier lost in label/column/XLSX) (boom :288, boom clearances.js:94 vs cadence :91, clearanceXlsx.js:47).
- AC-13 P3 — Skeleton loading + persistent inline error banner gone (no loading UI; transient toasts only); artist fetch drops ?limit=500 (boom :94,224,463-465 vs cadence :27-28,61).
- AC-14 P3 — Delete confirm + both Documents-tab helper copy blocks dropped (softened confirm warns of nothing) (boom :199,246-249,475-477 vs cadence :66).
[INT] label_id scoping + withTenant + requireApprover (OLD any authed user) + checkArtist FK validation + logActivity + generic 500 bodies (cadence clearances.js:10,15-19,84,90); created_by user id vs display name (:81); table rename artist_clearances→clearances; wb.creator 'Cadence' (clearanceXlsx.js:18).

## renewals
- RN-1 P1 — Days-left math regressed to the exact UTC-parse bug OLD fixed: Math.ceil((new Date(date)-new Date())/86400000) vs OLD's local-calendar daysUntilLocal (commented "expiring tomorrow read '2 days'") — banding shifts a day for most of the day (cadence Renewals.jsx:8 vs boom Renewals.jsx:30-34, boom utils.js:491-498).
- RN-2 P1 — Scope narrowed from all-contracts tracker to Active-only lookahead: server adds status='Active' + expiration_date <= CURRENT_DATE + N days (UI max 180) — non-Active contracts and Active ones beyond the window unreachable in any UI state (cadence contracts.js:62-67 vs boom contracts.js:255-261).
- RN-3 P1 — All 4 stat cards (Total Contracts/Expiring Soon/90 Days/Active) and 4 count-bearing filter pills (All/Expiring Soon/Active/Expired) removed; replaced by a 30-180d window select that can't express Expired or long-Active (boom :78-131 vs cadence :32-38).
- RN-4 P2 — Table halved: Territory, Royalty %, Advance $, and Status badge columns dropped (query still returns them); Days Left + Status merged into one "Countdown" chip (boom :140-178 vs cadence :52-71).
- RN-5 P2 — Urgency bands changed: grey <0 / red <30 / amber <90 / green ≥90 → red overdue / red ≤30 / amber ≤60 / gray else — amber horizon 90→60, green "Active" state gone (boom :36-57 vs cadence :7-13).
- RN-6 P2 — Expires column uses new Date(x).toLocaleDateString() instead of shared formatDate — UTC-parse renders the date a day early in negative-offset TZs (cadence :66 vs boom :166).
- RN-7 P3 — Fetch errors silently swallowed (.catch(() => {}), no error state — failure indistinguishable from empty); spinner downgraded to bare "Loading…" text (cadence :22,42 vs boom :22-23,67-76,133).
- RN-8 P3 — AlertTriangle rendered on every countdown chip incl. non-urgent gray rows (cadence :69 vs boom :167-178).
- RN-9 P3 — Empty state "Nothing expiring in this window. 🎉" introduces emoji register absent from OLD ("No renewals found") (cadence :46 vs boom :154).
[INT] label_id scoping + tenant-guarded artist join + withTenant/requireApprover (cadence contracts.js:11-15,63-65); AdminRoute + isApprover nav gating mirroring OLD's admin-path list (cadence App.jsx:152, Layout.jsx:268 vs boom contracts.js:21); INNER→LEFT artist join as tenancy-hardening side effect.

## create-invoice
- [P1] Payment-terms/due-date engine missing — no Net 15/30/45/60/90/Custom vocabulary, no server-computed due date; `due_by` is free text stored verbatim and PUT-writable, so printed deadline and terms can silently disagree — fix: port boom lib/payment-terms.js + /terms + /due-date, derive due_by on write; cadence server/routes/invoices.js:37-85, server/index.js:850 (HIGH)
- [P1] Client-side date math / reader-TZ rendering — `new Date(created_at).toLocaleDateString`/`longDate` reproduces the documented after-5pm-prints-yesterday bug; live preview prints Date.now() — fix: server-attached `invoice_date = businessDay(created_at)` + string-part formatting; cadence client/src/pages/CreateInvoice.jsx:15,177,272,306,330 (HIGH)
- [P2] `created_at` is TIMESTAMP (no zone) DEFAULT NOW() — the exact type OLD migrated off (boom index.js:2960 comment); instant not pinned at insert — fix: TIMESTAMPTZ + pass raisedAt; cadence server/index.js:863, routes/invoices.js:51-59 (HIGH)
- [P2] PDF is popup+window.print() instead of jsPDF selectable-text auto-download w/ deterministic filename (jsPDF already a dep) — fix: port boom handleDownload; cadence CreateInvoice.jsx:136-183 (HIGH)
- [P2] Eye "Preview" button just opens edit mode (duplicate of Pencil); preview modal missing — fix: port preview overlay / use ui/Modal; cadence CreateInvoice.jsx:310 (HIGH)
- [P2] `Partial` payment status missing (OLD Unpaid→Paid→Partial cycle + yellow badge) — fix: cadence CreateInvoice.jsx:126-129,307 (HIGH)
- [P2] Second routing number (WIRE vs ACH) not representable — invoice_settings has one `routing`; OLD prints both stacked — fix: add routing_ach across Settings/PayableTo/print; cadence CreateInvoice.jsx:45,155 (HIGH)
- [P2] Hotkeys ⌘↵ / ⌘⇧L / ⌘P missing incl. in-flight submit guard — fix: port boom :213-220 via useHotkeys; cadence CreateInvoice.jsx:105 (HIGH)
- [P2] Card view lost the full compact invoice-document render (OLD InvoicePreview compact per card) — fix: cadence CreateInvoice.jsx:320-338 (MED)
- [P3] $0 (comp) invoices rejected by `total <= 0` gate (OLD preserved amount !== '' zero lines) — fix: cadence CreateInvoice.jsx:84,108 (HIGH)
- [P3] Hand-rolled currency symbols: CAD/AUD/MXN render as bare "$", JPY forced 2 decimals (OLD Intl.NumberFormat w/ fallback) — fix: cadence CreateInvoice.jsx:10-12 (HIGH)
- [P3] Loading state is text, not Skeleton — fix: cadence CreateInvoice.jsx:290 (HIGH)
- [P3] Amount input lacks min="0"; negative line items accepted — fix: cadence CreateInvoice.jsx:220 (HIGH)
- [P3] Edit subtitle drops payee name ("Editing #0007" vs "Editing invoice for X") — fix: cadence CreateInvoice.jsx:200 (HIGH)
- [P3] Line-item trash renders enabled but no-ops at 1 row (OLD hides it) — fix: cadence CreateInvoice.jsx:221 (HIGH)
- [INT] Per-label invoice numbering + UNIQUE(label_id,invoice_number) + 409 retry; requireApprover gate; BOOM_INFO → labels.invoice_settings mechanism (all fields present except ACH routing, flagged above); logo/brand from label branding (RC-2); toasts/delete-confirm/empty-state/logActivity are NEW-only improvements.

## vendors
- [P1] Merges irreversible/unrecorded — no vendor_merge_log, no merges list, no Unmerge; deleting the alias chip erases the only trace (boom bookkeeping.js:5785-5868) — fix: port mergeVendors logging + /merges + /unmerge + drawer history; cadence server/routes/ledger.js:887-907 (HIGH)
- [P1] Payment/bank details regression — plain-text vendors.bank readable+editable by any Approver, no encryption, no audit-on-read (OLD encrypted vault, Admin-only, audit per read, boom :5881-5924) — fix: cadence ledger.js:776,797-810; Vendors.jsx:109 (HIGH)
- [P2] Merge/rename strands ALL saved emails on any collision (single UPDATE + swallow catch; OLD pre-deletes collisions) — fix: cadence ledger.js:877,900 (HIGH)
- [P2] Merge/rename DELETEs source vendors row — W9 file/contact/notes lost when target has none — fix: coalesce fields into target first; cadence ledger.js:867,894 (HIGH)
- [P2] Voided entries counted in vendor spend/suggest (filter present everywhere else in the file) — fix: cadence ledger.js:755,838 (HIGH)
- [P2] invoice_count counts split children (OLD counts families, parent_id IS NULL); drawer lists children flat with no family grouping — fix: cadence ledger.js:748,783-789 (HIGH)
- [P2] Mixed-currency total_spent summed into one "$" number; no total_spent_usd/currency_count (OLD boom :5072-5073) — fix: cadence ledger.js:749; Vendors.jsx:274-275 (HIGH)
- [P2] Vendor dupe surface missing: no /vendor-duplicates scoring, auto-merge exact tier, review deck w/ undo, swap direction, custom-name merge, alias-only, persistent "Not duplicates" ack, merge-all ≥85 (boom BkVendorFlags + :5514-5669); DataQuality vendor tab covers a fraction — fix: port to cadence Vendors (HIGH)
- [P2] Unified one-row-per-company bank view missing (Bank−invoiced delta, Needs matching/Needs artist/To attach worklists, unlinked-payees link queue; boom :4882 + BkVendorsUnified) despite NEW having bank-statement pages — fix: port /vendors/unified (HIGH)
- [P2] Bulk merge (multi-select → survivor picker sorted W9-first) missing (boom BkVendors:1321-1355,4405-4498) (HIGH)
- [P2] vendor-zip endpoint has NO client caller — dead feature (OLD "Download bundle" header button) — fix: add UI; cadence ledger.js:1932; Vendors.jsx (HIGH)
- [P2] ZIP xlsx omits split-child slices (roots-only + raw amount under carve-out splits; OLD family_amount) — fix: cadence ledger.js:1917-1925,1936-1941 (HIGH)
- [P2] W9 name-mismatch pipeline missing — scan transient; no persisted w9_scan, no w9_mismatch badge/banner/"Name Mismatch" filter (boom :5094-5127) — fix: persist + surface in /vendors (HIGH)
- [P2] Scan-all-W9s unbounded + rescans everything each click (OLD unscanned-only, cap 10, 200ms throttle, remaining count); never scans drawer-uploaded vendors.w9_r2_key though button shows for them — fix: cadence ledger.js:941-961; Vendors.jsx:221 (HIGH)
- [P2] List tooling absent: search, W9 filter, 6 sorts, cards view, vendor count, 1099 ≥$2k signal, Added-expenses subpage — fix: port toolbar; cadence Vendors.jsx:216-287 (HIGH)
- [P2] Case-sensitive GROUP BY payee can split "Acme"/"ACME" into two rows while mutations match LOWER(); no auto-merge tier to collapse them — fix: cadence ledger.js:758 (MED)
- [P2] Email/W9 lookups not alias-aware (OLD walks aliases both directions) — an alias's saved emails/W9 vanish from the canonical vendor — fix: cadence ledger.js:776-788,1546 (HIGH)
- [P2] Move-one-invoice affordance missing from the vendor surface (hover "move" + typeahead; payee is PATCH-editable but no UI) — fix: cadence Vendors.jsx drawer rows (HIGH)
- [P3] Email add: no format validation, silent duplicate no-op, label_text in API but never collected/shown — fix: cadence ledger.js:1552-1557; Vendors.jsx:136-147 (HIGH)
- [P3] No noise-alias guard ("Inc"/"LLC" accepted); ON CONFLICT silently re-points an existing alias (OLD refuses + reports reassignment) — fix: cadence ledger.js:916-926 (HIGH)
- [P3] Drawer/list dates via new Date(...).toLocaleDateString() — DATE shifts a day west of UTC (OLD slices the string) — fix: cadence Vendors.jsx:179,276 (HIGH)
- [P3] Merge toast lacks moved-counts though server returns them ("Vendors merged" vs OLD's "{merged} entries, {relinked} bank links") — fix: cadence Vendors.jsx:57 (HIGH)
- [P3] Merge picker is a bare <select> over all vendor names; /vendor-suggest typeahead exists unused — fix: cadence Vendors.jsx:164-167 (HIGH)
- [P3] W9 upload input: no accept filter, no busy state, no drag-over affordance — fix: cadence Vendors.jsx:97-100 (HIGH)
- [P3] Rename doesn't also rename expenses.vendor_name (OLD renames both) — fix: cadence ledger.js:857-879 (MED)
- [P3] Drawer invoice rows don't deep-link to the ledger entry (?focus= exists) — fix: cadence Vendors.jsx:177-182 (HIGH)
- [P3] ZIP xlsx header hardcodes indigo FF4F46E5 instead of workspace accent — fix: cadence ledger.js:1914 (HIGH)
- [INT] Label scoping + requireApprover router gate + AdminRoute page guard; vendors table + upsertVendor mechanism swap (regressions itemized above); logActivity replacing logBkAction; toasts replacing alert(); per-label case-insensitive alias uniqueness (improvement over OLD's case-sensitive UNIQUE(alias)); creator_payment row exclusion retained (2026-08-27).

## creators
- [P2] Unconvert resets bank match_method 'creator'→'manual', which lands in the invoice-backed bucket (bank-matching.js:153-155,172) — undocumented row counts as invoice-backed after unconvert; OLD never touches the match (boom creators.js:653-677) — fix: cadence server/routes/creators.js:393-396 (HIGH)
- [P3] Access narrowed to Approver+ (requireApprover + Approver-only nav); OLD page-grants marketing to enter payments (boom creators.js:40-42) — fix: cadence creators.js:24; Layout.jsx:286 (MED, possibly intended)
- [P3] Directory lost Socials column (social_handles never selected) + last_payment — fix: cadence creators.js:104-107; Creators.jsx:174-196 (HIGH)
- [P3] Move-in summary gone: no server summary (convert/review counts+values, already_matched), no info card, no universal-gaps collapsed banner; already_matched computed but never rendered — fix: cadence creators.js:325; Creators.jsx:220-236 (HIGH)
- [P3] Payments queue excludes creator rows — Unpaid creator payment invisible on /payments; OLD's queue includes them (boom bookkeeping.js:6010) — fix: cadence ledger.js:533 (MED)
- [P3] Move-in selection stale after convert (useState-initializer Set never re-derived on reload; OLD rebuilds picked per load) — fix: cadence Creators.jsx:211 (HIGH)
- [P3] Search demoted to client-side over 1000-row cap; server total never displayed (OLD shows filtered USD total beside search) — fix: cadence Creators.jsx:77-85,118-121 (HIGH)
- [P4] List total sums row-rounded values; OLD sums raw then rounds once ($0.01 tie-out war story, boom creators.js:126-128) — fix: cadence creators.js:90-93 (MED)
- [P4] Directory W9 test ignores w9_filename though selected (OLD checks both, boom :146) — fix: cadence creators.js:119,135 (MED)
- [P4] Directory by_year rounds every accumulation step vs once per year (boom :182) — fix: cadence creators.js:133 (MED)
- [P4] Mark-paid has no in-flight guard (OLD payingId disable) — fix: cadence Creators.jsx:60-70 (HIGH)
- [P4] Delete confirm names original-currency amount, OLD names USD-calc (boom :172) — fix: cadence Creators.jsx:72 (HIGH)
- [P4] Convert dry-run lacks would_relabel_matches + row detail (boom :612-616) — fix: cadence creators.js:339 (HIGH)
- [P4] "Another creator" drops previous-row artist/song carry-forward (boom :580-587) — fix: cadence Creators.jsx:299 (HIGH)
- [P4] Batch footer lost running total + first-gap hint (boom :593-607) — fix: cadence Creators.jsx:294-303 (HIGH)
- [P4] scan-w9s vendor sweep doesn't exclude creator rows (OLD /w9s does, boom bookkeeping.js:8012) — fix: cadence ledger.js:941-945 (MED)
- [P4] PUT whitelist omits ufr (OLD includes) — fix: cadence creators.js:237-238 (MED)
- [INT] label_id scoping + logActivity + activity-bot batch event; OBBBA year-dependent 1099 threshold shared with 1099 report (ledgerSource.js:38-41); W9 shared cross-payee via email; convert categories data-driven from per-label categories ui_group='campaign'; SOURCE_PAGES 'recoupment' spelling; fx stamped-on-Paid model (fx_rate_to_usd not body-settable); convert transactional + FOR UPDATE + batch cap 100; 1099 report includes creators by design.

## upload-rules
- [P1] Rule-suggestions engine absent (mining, invoice-census match/category/no-invoice/dismiss/artist split, bookPatternFor provable-pattern gate, clears/conflicts/also-matches/covers-N-of-M; boom statements.js:7216-7477, BkRules.jsx:278-421) — fix: port /rule-suggestions into cadence bank-matching.js + RulesPanel section (HIGH)
- [P1] annotate=1 leak reporting absent — no per-BOOK-rule queue_rows/queue_usd/ledger_payees(real_invoices, clears), no feeding-the-queue amber, no pair-it action (boom statements.js:10245-10307; BkRules.jsx:445-466); unpaired rules feed the needs-invoice queue invisibly — fix: annotate cadence category-rules + surface in RulesPanel (HIGH)
- [P2] "Match, don't rule" protection absent — no invoice-census check or double-recorded warning before writing a category rule for an invoicing vendor (boom statements.js:7351-7371) — fix: guard cadence bank-statements.js:618-621 (HIGH)
- [P2] Category rule writes one half only — no paired no-invoice write / both-halves rollback (boom statements.js:8628-8663); rule-booked rows land in the needs-invoice queue by construction — fix: paired write in bank-matching.js:611-622 or book flow (HIGH)
- [P2] category_candidates lost the never-invoiced evidence test + $value/vendor-count + confirm (OLD requires zero ever-invoiced vendors in category, boom statements.js:8549-8572) — one un-confirmed click writes the rule — fix: cadence bank-matching.js:151,177; BankMatching.jsx:508-518 (HIGH)
- [P2] Artist retro-apply sweeps history by SUBSTRING ('TONE' ⊂ 'Tone Pay, Inc' misattribution OLD refuses — reviewed entry_ids only, boom statements.js:8858-8895), retro defaults ON, no requested/skipped accounting — fix: cadence bank-matching.js:587-596; BankMatching.jsx:461 (HIGH)
- [P2] Retro-attributed rows skip release auto-linking (OLD autoLinkRelease per row, boom :8892) — fix: cadence bank-matching.js:588-596 (MED, UNVERIFIED whether cadence has an equivalent)
- [P3] No standalone create for category/dismiss rules (side-effect-of-row-action only) and those writers have no ≥3-char pattern floor — short payee mints an over-broad substring rule — fix: cadence bank-statements.js:618-621,654-656 (HIGH)
- [P3] POST no-invoice-rules: no patterns batch (OLD all-or-nothing multi-write for pairing), scope silently coerced, no length floor, ON CONFLICT DO NOTHING silent no-op — fix: cadence bank-matching.js:611-622 (HIGH)
- [P3] No audit records or delete confirms on any rule CRUD (OLD audits all four kinds + consequence-naming confirms) — fix: cadence bank-matching.js:574-626; BankStatements.jsx:189 (HIGH)
- [P3] In-force list fragmented: category/dismiss rules visible only inside one statement's detail when non-empty; no created-by/date metadata; no unified view or teaching frame — fix: consolidate into RulesPanel, cadence BankMatching.jsx:458-537 (HIGH)
- [P3] Completion ruleHit tests exp_payee||payee_guess fallback instead of OLD's both-by-equality (boom statements.js:7300-7308) — vendor rules clear fewer rows than accepted answers promise — fix: cadence bank-matching.js:123-128 (HIGH)
- [P4] RulesPanel loads swallow errors (.catch(()=>{})) — outage renders as "no rules exist" (OLD banner + retry) — fix: cadence BankMatching.jsx:462-465 (HIGH)
- [INT] Label-scoped rule tables + per-label unique indexes; requireAdmin router gate ≈ isStrictAdmin; ingest applies category rules only AFTER auto-match fails + rule-booked rows stay rematch-eligible (softens OLD's booking trap structurally); row-level no_invoice flag + per-txn/bulk endpoints additive; match_method='rule' provenance; rules embedded in the Bank Matching surface instead of a dedicated setup page (placement choice — missing capabilities itemized separately).

## bank-statements

Page: Bank Statements (library + per-statement mini-ledger) — OLD `boom-dashboard/client/src/pages/BkStatements.jsx` (1,408 ln) + `server/routes/statements.js` (10,367 ln, read selectively) vs NEW `cadence/client/src/pages/BankStatements.jsx` (523 ln) + `server/routes/bank-statements.js` + `server/lib/bankReconcile.js`. Detail: `_audit/pages/bank-statements.md`. RC-1/2/3/5/6 apply. Matching surface / flags engine / monthly-close workflow judged in their own audits (pointers noted); IA is inverted — OLD's mini-ledger lives on Bank Matching, NEW's lives on this page.

- DEF-BST-01 · P1 · **Library not month-grouped** — flat created_at list (`BankStatements.jsx:92-108`); OLD "Statements by month" card: X/Y reconciled header, month rows w/ coverage bar + open/"clear", expandable per-statement rows w/ "copy N", per-statement coverage + matched/debits, open_value/open_credits (`BkStatements.jsx:806-1133`; `statements.js:1671-1717`).
- DEF-BST-02 · P1 · Coverage badges + overlap warnings missing — no "No {account} statement covers this month" badge, no `overlaps_with` computation/badge (`bank-statements.js:238-243`; OLD `BkStatements.jsx:847,858-869`, `statements.js:1718-1727`). Flags engine's paypal-uncovered/gap ≠ the library badges (pointer).
- DEF-BST-03 · P3 · Month reconcile gate (on /bank-matching, pointer) lost the missing-account condition — NEW enables reconcile on open_debits===0 alone (`BankMatching.jsx:174`); OLD also required both accounts covered + unlock hint (`BkStatements.jsx:848,892-897,1121-1125`).
- DEF-BST-04 · P1 · Batch upload missing — single file (no `multiple`), no {done,total,phase} progress, no per-file failure banner, no post-upload parse polling per file, no auto-open of a single ready upload (`BankStatements.jsx:56-67,85`; OLD `BkStatements.jsx:442-498,698,712-728`).
- DEF-BST-05 · P2 · Page-wide drag-drop + full-screen drop overlay gone — NEW drop zone is the Upload button, first file only (`BankStatements.jsx:82-84`, `utils/drop.js`; OLD `BkStatements.jsx:626-636,702-710`).
- DEF-BST-06 · P2 · **View-original-file impossible** — no `/file` endpoint at all; `r2_key` stored (:258) but unreachable; extras/misfiled-style "open the statement to check" verification depends on it (OLD `statements.js:5617-5637`; `BkStatements.jsx:974-977`).
- DEF-BST-07 · P1 · **Re-parse missing** — OLD strictly-additive transaction re-parse (identity diff, insert-missing-only, never deletes, automatch+rules over added rows, only_in_database reported, background + import_summary.reparse, doubling-signature warning, rules-verified balance persist) (`statements.js:4816-4995`; `BkStatements.jsx:500-598`); NEW has balance-only `reparse-balance` (`bank-statements.js:375-410`) — recovery from a short AI parse is delete+re-upload, destroying matches.
- DEF-BST-08 · P1 · **Extras audit missing** — statement-proves-N/app-holds-M balance-proof audit, group tables, removal w/ missingCount>0 refusal ("relabelled, not duplicated" guard that saved 206 real rows), booked-income block, affected-expense report, 429 single-flight, header chip + ✓ matches badges (`statements.js:4997-5160,5547-5614`; `BkStatements.jsx:158-206,664-682,929-970,1062-1117`).
- DEF-BST-09 · P1 · **Misfiled repair missing** — reference-repeat detection (invisible to count audits by construction), payee-only rewrite keeping id/date/amount, match released only on payee change, invented-booking unbook guarded on entry_source, unclear left alone, "N misfiled · $V" badge (`statements.js:5169-5354`; `BkStatements.jsx:107-156,939-945,998-1061`).
- DEF-BST-10 · P2 · Reminders panel missing — monthly-cadence reminders (day-of-month, next-due, On/Off, bell+email, seeded day-5 default); no reminders feature anywhere in cadence (`BkStatements.jsx:1359-1405,375-392`; boom `routes/reminders.js`).
- DEF-BST-11 · P1 · **Deterministic parse pipeline missing** — no rules parser, no reconciliation gate against printed balances/section totals, no pdfjs-dist path, and no audit recording which path ran / parse outcome (NEW logs upload before parsing, `bank-statements.js:272`) (`statements.js:883-913,1026-1029`; `lib/statement-pdf.js:28-48`).
- DEF-BST-12 · P1 · **PDF parse captures no currency** — 7-field prompt (no CURRENCY/AMOUNT_USD), parsePipeLines all-USD (`bank-statements.js:37-47`; `bankReconcile.js:186-220`) — recreates the ¥237,858-as-$237,858 class OLD repaired at four sites (`statements.js:817-845,1497-1597`); INDN/TRANSFER payee rules also dropped (people's names become vendors).
- DEF-BST-13 · P2 · CSV parser regressions — no currency column, no PayPal status!==Completed skip (pending/denied ingest as money) (`bankReconcile.js:347-397`; OLD `statements.js:158,179-186`).
- DEF-BST-14 · P1 · **Within-statement dedupe collapses real transactions** — description-equality fallback includes the same statement's rows, so N identical same-day charges import as 1 (OLD's extras case: 30 real $1.00 fees/day; OLD dedupes within a statement only on a real reference + backfills refs) (`bank-statements.js:99-107` vs `statements.js:227-265`).
- DEF-BST-15 · P2 · import_summary lacks the `reasons` why-unmatched histogram — unrecoverable after ingest (`bank-statements.js:76,146-152`; OLD `statements.js:1024,6303-6305`).
- DEF-BST-16 · P1 · **Matching never re-runs** — no detail-open freshness pass, no nightly sweep, no additive /rematch-all (409-not-zero, per-statement report), no /reset-matching (auto+manual clear, manual_not_recovered accounting); nothing on either NEW surface (`statements.js:4788-4795,5638-5821`; boom `index.js:2410`). Invoices approved after ingest are manual-only forever.
- DEF-BST-17 · P2 · Delete cascade diverges — OLD soft-deletes entries created from the statement's txns (prevents re-upload double-count) + audit line; NEW leaves invented bookings live/unlinked, no orphan sweep, no audit (`bank-statements.js:436-444` vs `statements.js:5823-5870,1506-1533`).
- DEF-BST-18 · P2 · Retro sweeps run on EVERY list GET, unthrottled (OLD 10-min/process after the 2026-08-04 pool-starvation outage); retro internal unlink+dismiss, orphaned-booking, vendor-consolidation sweeps absent (`bank-statements.js:202-237`; `statements.js:1105-1112,1414-1626`).
- DEF-BST-19 · P2 · Over-claim sweep contradicts the capacity model — rank-1-only sweep reopens legitimate installments the match endpoint just allowed (`bank-statements.js:221-237` vs `:514-535`); OLD's sweep summed claims against family capacity (`statements.js:1627-1668`).
- DEF-BST-20 · P2 · Dismiss guards lost — OLD refuses dismissing matched/booked rows and records deck rejections; NEW nulls match+booked unconditionally (orphans a created expense; bulk same hole), always-rule from raw payee w/ no ≥3-char floor, no immediate retro sweep, no audit, dismissed_reason collapses to 'auto' (`bank-statements.js:648-660,744-746` vs `statements.js:6864-6913,795-810`).
- DEF-BST-21 · P3 · Errored/parsing statements undeletable from the UI (row unclickable, Delete only in detail) and parse error tooltip-only vs OLD inline "parse failed — {error}" + Delete on processing rows (`BankStatements.jsx:94,103,249`; `BkStatements.jsx:830-841,916-917`).
- DEF-BST-22 · P3 · paidNoEvidence weaker — strict BETWEEN (no ±3d pad), parent-slice amount for split families, no account/method-compat filter, no bank_candidates reverse scoring (`bank-statements.js:353-366`; OLD `statements.js:4539-4583`).
- DEF-BST-23 · P3 · Detail row enrichment lost — per-row usd (NEW catTotals/coverage sum raw amounts across currencies, masked only by DEF-BST-12), reversal pairing chips, category_usage deck ordering, group_proposal, vendor_hint (`bank-statements.js:335-344`; OLD `statements.js:4186-4260,4433-4608`); deck/matching consumers judged in bank-matching audit (pointer).
- DEF-BST-24 · P3 · Automatic ending-balance backfill lost — OLD re-reads stored PDFs 2/cycle fire-and-forget; NEW is manual prompt per statement (`statements.js:1105-1155`; `BankStatements.jsx:229-246`).

[INT] INT-1 tenancy scoping + router-level requireAdmin; INT-2 per-label configurable accounts (labels.bank_accounts + PUT /accounts) replacing hardcoded BofA/PayPal; INT-3 IA inversion — mini-ledger/deck/money-in/rules hosted on /bank-statements/:id (OLD moved them to Bank Matching), MatchModal shared across both surfaces; INT-4 manual balance editor + reparse-balance endpoint (additive); INT-5 activity-bot events on month reconcile/reopen; INT-6 view-time statementSuggest suggestions (retroactive by design) replacing the learned-category map for inline "★ suggested"; INT-7 search hits deep-link to statement detail w/ ?q&chip instead of forwarding to Bank Matching.

Parity kept: ingest order (dedupe→internal→dismiss-rules→match→category-rules), MAX-2 parse queue + 25-min stale flip, payee/email retro split, capacity model + prepayment guard + fingerprint rejections, bank-born-entry match refusal, transactional unbook/unbook-income, income-type reject-never-coerce, global search field-for-field, learnPayee, artist rules w/ is_overhead.

Totals: 24 defects — 10 P1 · 9 P2 · 5 P3; 7 intentional.

## bank-matching
- [P1] Dimension lens absent (Category⇄Artist column toggle; chips/filter/column/sort follow; click-value filters; artist-bucket canonicalization; by-construction empty state) (boom BkBankMatching.jsx:79,2495-2570,2899-2917,2952-3040) — fix: cadence BankMatching.jsx table (HIGH)
- [P1] Artist attribution absent from entire surface — no ArtistSelect pre-book on open rows, no editable artist on booked rows, none in deck/split, no artist-names roster (boom :199-217,1012-1060,3076-3100,4155-4210) — fix: cadence BankMatching.jsx + StatementReviewDeck.jsx (HIGH)
- [P1] Open rows can't be BOOKED from the queue table (no inline category book / create-entry form / bulk book) — "three honest answers" reduced to two outside the deck (boom :1028-1060,3607-3646,960-990) — fix: cadence BankMatching.jsx:235-267 (HIGH)
- [P1] Batch view (vendor-clustered clearing: proposals, select-all, uniform category, apply/dismiss + progress) absent; NEW vendor chips only write no-invoice rules on a different pile (boom :494-575,4636-4746) — fix: cadence BankMatching.jsx:520-532 (HIGH)
- [P1] Deck has NO undo — OLD ⌫ history w/ per-kind inverses incl. unrematch, rebook restore, no-invoice+unbook, reopen (boom :1240-1321) — fix: cadence StatementReviewDeck.jsx (HIGH)
- [P1] Deck card types 9→2: rematch/rebook/choose/keep/reversal cards gone; booked-w/-invoice-waiting rows never enter; weak candidates fall through to book instead of asking which invoice (boom :1090-1155,2003-2027,3958-4290) — fix: cadence StatementReviewDeck.jsx:71-76; BankMatching.jsx:133 (HIGH)
- [P1] Multi-invoice attach unreachable — /tx/:id/attach + capacity + allow_prepayment has zero client callers; no group_proposal offers, no InvoiceAttachPicker (cadence bank-matching.js:224-236, statementLinks.js:28-95; boom :713-775,3201-3236,4090) — fix: wire attach into queue + deck (HIGH)
- [P2] Completion card never scopes to the selected statement (buckets always workspace-wide; NEW's own comment claims narrowing the code doesn't do) — OLD-documented mixed-denominator bug reintroduced — fix: cadence bank-matching.js:110-121,165 (HIGH)
- [P2] by_statement.left counts fully-open rows only, excluding booked-needs-invoice — reintroduces the 146× selector-vs-chip drift OLD fixed (boom statements.js:8514-8530) — fix: cadence bank-matching.js:156-158 (HIGH)
- [P2] Dismiss force-unlinks matched/booked rows (matched_expense_id=NULL, booked=FALSE) without deleting the created entry → orphaned ledger entry keeps counting while its bank line is dismissed; OLD refuses (boom statements.js:6868-6877) — fix: cadence bank-statements.js:648-659,745-747 (HIGH)
- [P2] no-invoice = bare flag write: open rows not booked (stay unanswered per /completion), no paid-invoice 409 speed bump/confirm_new, no category capture, no audit; bulk stamps rows matched to REAL invoices (boom applyNoInvoice statements.js:10137-10195) — fix: cadence bank-matching.js:627-641 (HIGH)
- [P2] Prepayment guard is a UI dead end — /match returns prepayment_possible but suggestion-accept + MatchModal only toast; no confirm-retry w/ allow_prepayment (boom postMatch :713-760) — fix: cadence BankMatching.jsx:101-104,239; BankStatements.jsx MatchModal (HIGH)
- [P2] Unrematch has no client caller — rematch irreversible from UI (cadence bank-matching.js:346-367; boom deckBack :1246-1257) — fix: undo on RematchPanel/deck (HIGH)
- [P2] Split-book has no client caller; server drops 6-part cap, required category per part, payee resolution/refusal ('Bank debit' fallback), payment_method, learnPayee, race restore (boom statements.js:9502-9631) — fix: cadence bank-matching.js:436-487 + deck UI (HIGH)
- [P2] "Match again" additive rematch-all + "Reset matching" absent — matcher only runs at upload, never re-runnable (boom :469-492,639-683; statements.js:5718-5822) — fix: cadence bank-matching.js (HIGH)
- [P2] Bulk actions reduced to no-invoice+unmatch; bulk book / book-to-suggested / dismiss / restore / unbook / Mark-N-Paid absent from client (server /txns/bulk partially exists unused) (boom :777-1010,2789-2868; statements.js:10325) — fix: cadence BankMatching.jsx:208-215 (HIGH)
- [P2] Vendor override absent: per-row/bulk move-line-to-vendor w/ confirm_new gate, booked-entry co-move, vendor-page links w/ CHANNEL_ONLY guard (boom statements.js:2874-2970,8266-8360; page :317-322) — fix: port to cadence (HIGH)
- [P2] detachTxn never restores a displaced booking — unmatching an ex-rematch/attach row lands it OPEN with its entry soft-deleted (the dead-end OLD's detachTxn restores, boom :8171-8203) — fix: cadence statementLinks.js:98-107 (HIGH)
- [P2] Rematch: contested pairs silently discarded (OLD returns+renders them), cross-currency invoices excluded (same-currency gate vs OLD fx band w/ shown arithmetic), no statement scoping, no gap/evidence/doc, no confirm (boom statements.js:7496-7729) — fix: cadence bank-matching.js:291-311; BankMatching.jsx:344-364 (HIGH)
- [P2] Funding pairs: no deck, no unproven tier (confirm_unnamed), no close-all-provable bulk + failure ledger, no undo surface (server branch uncalled), no fxSummary, no per-row PayPal-twin annotation, naming test lacks alias/learned-link context + vendor-override deference (boom statements.js:3069-3292,9220; page :293-425,3040-3055,4493-4600) — fix: cadence fundingPairs.js + BankMatching.jsx:369-398 (HIGH)
- [P2] Headline "N left to match · $X" (left_all/left_all_value) + "All statements — N left" absent — fix: cadence bank-matching.js:166-179; BankMatching.jsx:148 (HIGH)
- [P3] URL state: only ?statement mirrored; ?filter/?q read-once never written; ?view/?by gone (boom :53-79,271-279,445-462) — fix: cadence BankMatching.jsx:46-52,146-147 (HIGH)
- [P3] Direction toggle (localStorage, full-page ledger→statement) absent; inline panel never refreshes after actions, silently vanishes on error, 50-row silent cap, rows drop invoice#/no-file/method + both exits (Find-the-line / Correct) (boom :256-262; UnmatchedLedgerPanel.jsx:75-181) — fix: cadence BankMatching.jsx:299-336 (HIGH)
- [P3] Chips: Suggested/Flagged/Reversals queues absent; no lead/more split; Open chip excludes needs-invoice rows (OLD Open = open+needs-invoice) (boom :2434-2500) — fix: cadence BankMatching.jsx:23-27,75-99 (HIGH)
- [P3] No sorting — no column headers, no auto-confidence sort on open filter w/ amount tie-break (boom :2543-2575,2609-2620) — fix: cadence BankMatching.jsx / bank-matching.js:63 (HIGH)
- [P3] Candidate comparison absent (openCand one-at-a-time, candidateDiff highlighting, near-identical warning, arm-then-confirm); top suggestion matches on single click — the side-effect click OLD removed after wrong-invoice incidents (boom :81-84,3172-3560) — fix: cadence BankMatching.jsx:236-244 (HIGH)
- [P3] Table reporting: ×N identical grouping, cap footer w/ "N still need an answer", "N of M lines" footer, description/bank-differs/file sub-lines, ≈USD sub-amount, dismissed_reason chip, import-summary line — absent; 400-row silent cap (boom :3040-3070,3652-3788) — fix: cadence BankMatching.jsx:98,218-281 (HIGH)
- [P3] Flag-for-review marker absent everywhere (row toggle, chip, deck F key, filter; no /flag endpoint) (boom :1540-1560,3239; statements.js:6720) — fix: port (HIGH)
- [P3] Currency correction absent (no /currency endpoint, no deck select) (boom :1563-1586; statements.js:6741) — fix: port (HIGH)
- [P3] No confirms on destructive actions: unmatch single/bulk, unbook, unbook-income, dismiss, rematch, accept-N-likely (OLD lists pairs) — fix: cadence BankMatching.jsx:101-131,344-347 (HIGH)
- [P3] MatchModal ledger-search hides partially-settled invoices (NOT EXISTS any matched txn) though the capacity model allows installments; OLD shows `remaining` "$N left" — fix: cadence bank-statements.js:479 (HIGH)
- [P3] Ledger-side "Found in bank" one-click candidates absent (paid-no-match band, boom :3792-3826) — needs_match rows link out only — fix: cadence BankMatching.jsx:321-328 (HIGH)
- [P3] Re-review deck over filtered rows (keep/reopen semantics over booked/matched/dismissed) absent (boom :1182-1190,2085-2092) (HIGH)
- [P3] Deck membership/order: no match-first ranking or session skip-demotion; open credits included w/o reversal guard — reversal-looking credit gets one-swipe income prefill OLD refuses (boom :1064-1069,1198-1210,2003-2027) — fix: cadence StatementReviewDeck.jsx:31-36,67 (HIGH; suggestIncomeType reversal-awareness UNVERIFIED — needs runtime check)
- [P3] Deck: no document preview panel (P), no inline ledger search, no unbook-from-card, no force-book toggle, no hint line (D/1-9 undiscoverable) (boom :1156-1180,1588-1620,4298-4400) — fix: cadence StatementReviewDeck.jsx (HIGH)
- [P3] Duplicate-merge: no carryEntryState (recoupment/UFR marks die with twin), no lock_timeout, no moved≥1 check, exact-amount join (no ±0.01), row lacks gap/doc-presence/artist compare (boom statements.js:9837-9958) — fix: cadence bank-matching.js:521-553 (MED; UFR-carry relevance UNVERIFIED vs cadence recoupments schema)
- [P4] Completion API bucket names semantically INVERTED vs OLD (NEW booked_expected=answered, booked_not_expected=needs-invoice) — internally consistent, parity trap — fix: cadence bank-matching.js:144 (HIGH)
- [P4] creator disposition folded into booked_expected — no 5th bucket/figure on the card (boom :8503-8511,8586) — fix: cadence bank-matching.js:155 (HIGH)
- [P4] Percentages whole-% vs OLD 0.1% (boom :8532) — fix: cadence bank-matching.js:171-172 (HIGH)
- [P4] Auto-decisions: no per-payee grouping/vendor_count, no ledger ?focus link, no doc indicator, days fixed 30 (boom statements.js:6968-6999) — fix: cadence BankMatching.jsx:433-455 (HIGH)
- [P4] Deck 1-9 not usage-sorted (OLD deck.cats snapshot); months strip caps 14 silently; unmatched-ledger LIMIT 400 unreported (boom :1191-1196) — fix: cadence StatementReviewDeck.jsx:48-49; BankMatching.jsx:167; bank-matching.js:198 (HIGH)
- [P4] Dismiss loses rejection memory — OLD deck dismiss sends rejected_expense_id so the matcher never re-proposes the pairing (boom :1649-1657; statements.js:6884-6891) — fix: cadence bank-statements.js:648-659 (HIGH)
- [INT] label_id scoping everywhere + requireAdmin router gate (≈ isStrictAdmin); logActivity instead of bk_audit_log; ONE /queue fetch over all statements absorbs OLD's global-search panel; 200-row suggestion budget disclosed via suggestions_capped footnote; funding pairs propose-only (safer than OLD's auto-sweep) + additive same-currency tier w/ flat-fee grace; rematch restore via deleted_by breadcrumb (sturdier than OLD's notes match); dup-merge repoints bank_txn_invoice_links (closes an OLD gap) + R2-only doc carry (cadence is R2-native); book-income validates live vocabulary + atomic claim; unmatch records fingerprint rejections (parity); deck pointer-capture bail + 409 claimed-set self-heal are deliberate OLD-bug fixes; months strip lives on this page w/ zero-open reconcile gate + activity-bot events; shared STATUS chip vocabulary with the statements page.
## financials
- [P0] Executive dashboard depth missing wholesale — weekly spend ComposedChart (paid/unpaid/received, 4wk MA, avg refline, biggest-week), payment aging + upcoming due (invoice-anchored due dates), cash forecast 30/60/90, monthly rollup (sortable, dual Difference readings, month links), top-spend dimension toggle + expandable /exec/subbreakdown category mixes, rep leaderboard, category composition trend — each an OLD panel with zero NEW counterpart — fix: port OLD Financials.jsx:185-1564 + server /exec (financials.js:654-1399) (HIGH)
- [P0] Paid/unpaid distinction absent from every NEW figure; "Expenses" blends unpaid commitments with no on-page basis disclosure — OLD splits everywhere + basis row :1684-1701 — fix: cadence server /summary,/analytics split by payment_status + client disclosure (HIGH)
- [P0] No drill-through anywhere (KPIs/pie/vendors/months un-clickable); OLD KpiDrillModal + /exec/rows w/ 14 buckets — OLD client :1863-2002, server :1535-1732 (HIGH)
- [P1] Cross-page artist/category/rep FilterBar + /filter-options missing — OLD client :1441-1496, server :671-691,:1406-1440 (HIGH)
- [P1] Range picker gutted: no custom from/to or 3m/6m/12m; period chips scope only /summary while chart/vendors/P&L are hard-wired 12mo (silent mixed-period page) — NEW client Financials.jsx:12-17,:91-95; NEW server :97,:102 (HIGH)
- [P1] Per-artist P&L silently drops money: LOWER(artist) (no TRIM) inner-mapped onto roster names — non-roster/blank/whitespace-variant artists vanish; OLD groups by expense artist string incl. 'unassigned' row — NEW server financials.js:113-133 vs OLD :880-888 (HIGH)
- [P1] Excel export gutted: OLD 14-sheet styled board packet (Cover…Full Ledger, scope-filter aware, server :1734-2912) → 3-section client CSV (NEW client :60-67), no server endpoint (HIGH)
- [P2] KPI deltas compare partial current month vs FULL prior month; OLD day-matches every window (leap-safe) — NEW server :135-137 vs OLD :693-738 (HIGH)
- [P2] All fetch errors swallowed (.catch(()=>{})); zeros render as data; no error state — NEW client :34-42 vs OLD :1777-1781 (HIGH)
- [P2] Vendor-concentration / payment-velocity / method-mix DATA series absent (OLD computes in /exec :1135-1260 + exports them; note: OLD never mounted the three chart components — not an on-screen gap) (HIGH)
- [P2] KPI sparklines (distinct per-card shapes) missing — OLD :1710-1775 (HIGH)
- [P3] fmtCompact ($1.2M/$45K) absent; everything 2-decimal — OLD :16-27 / NEW :20 (HIGH)
- [P3] UTC month bucketing vs OLD LA-anchored windows (boundary rows shift a bucket) — NEW server :89,:110 vs OLD :699-702 (MED)
- [P3] Income delete via window.confirm instead of ui/ConfirmDialog — NEW client :56 (HIGH)
- [INT] Basis change: ledger-mastered P&L overview w/ income; cash depth relocated to /reports (reports.js:2-8)
- [INT] Auth: requirePagePermission('/financials') → withTenant+requireApprover (tenancy)
- [INT] FX: OLD locked-rate-else-1:1 native fallback → NEW rowUsd locked-else-live (correctness improvement; totals legitimately differ) — NEW server :6-11 vs OLD :651-653
- [INT] NEW-only income CRUD UI + per-artist income/net + category pie (additions)
- [INT] /financials/month/:month drill absent — OLD orphan tracked at _audit/00-inventory.md:179 (own file; not deep-dived here)
## reports
- [P1] Review deck over drill cells missing entirely (→/←/⌫ full undo incl. dismiss-restore, F flag, D dismiss, 1-9 usage-ranked category hotkeys, P doc panel, money progress, done summary) — OLD Reports.jsx:639-875,:2826-2976; NEW ReviewDeck component exists but unused on /reports (HIGH)
- [P1] P&L line filter (pnlQ) missing: no input, no "Subtotal of shown" rows, no "(all lines)" relabel, no no-match rows — OLD :935-1033,:1239-1248,:1470-1483 (HIGH)
- [P1] Balance sheet counts drawdowns as LIABILITIES (total_liabilities = A/P + advances), reversing OLD's documented funding re-class (John 2026-08-07); Funded-by block + accumulated deficit + funding-hide missing — NEW server/routes/reports.js:736-738 + BalanceSheetCard.jsx:83-94 vs OLD server :1907-1985,:2003-2018 (HIGH)
- [P2] BS depth missing: A/R+A/P aging buckets, per-line composition breakdowns, undated-paid disclosure — OLD server :1803-1905 (HIGH)
- [P2] BS whole-line exclusions have no UI (server bs_line scope + cash:* supported; no line Ban control; excluded cash accounts unreachable from the sheet) — OLD client :311-345,:1706-1711 (HIGH)
- [P2] Drill rows expose no documents (DocButton/FilePreview/attach-picker link); only Ledger ?focus — OLD :53-71,:2649-2671, server withFileFlags :1672 (HIGH)
- [P2] Drill sort pills (Date/Name/Amount, default-dir + flip) missing — OLD :456-469,:2400-2436 (HIGH)
- [P2] Bulk month reassign + "Attribute all N" past the 500-row cap missing; NEW server returns all_expense_ids (reports.js:566) client never reads — OLD :618-637,:2463-2489,:2552-2565 (HIGH)
- [P2] Non-recurring classify option renders unlabelled inside "Below the line — advances & pass-through" (server comment says "labelled by the client"; client never does) — NEW reports.js:247-248 + PnlTable.jsx:179-187 vs OLD :1517-1536 (HIGH)
- [P2] "What backs these figures" evidence aggregate missing (per-row evidence exists, no rollup) — OLD :1574-1665; NEW reports.js:538 (HIGH)
- [P3] Dismissed-tab category rules lack "$X excluded in range · N txns" chip — OLD :2262-2271 (HIGH)
- [P3] Rename toast drops the touched-table counts the server returns — OLD :383-394 / NEW PnlTable.jsx:113 (HIGH)
- [P3] Per-line dismissed badge = unclickable ◦ on Total cell, no amount/jump — OLD :1057-1067 / NEW PnlTable.jsx:24,:76 (HIGH)
- [P3] Drill "+$Y dismissed" is inert text, not a jump to Dismissed tab — OLD :2370-2376 / NEW DrillModal.jsx:93 (HIGH)
- [P3] SBA export ignores on-screen Top-N (client never sends topN; server accepts it) — NEW Reports.jsx:94 vs OLD :83-86,:884 (HIGH)
- [P3] Merged-spelling ×N disclosure dropped (buildPnl collects spellings, payload discards) — NEW reports.js:222-228,:311-326 vs OLD :2033-2039 (HIGH)
- [P3] SBA frozen region reduced: 4 fixed-width sticky columns + both-axis sticky headers + 70vh scroll → 1 sticky column, no sticky header (NEW's stated one-sticky-cell rule, PnlTable.jsx:1-3) — OLD :1956-2027 (HIGH)
- [P3] Drill-bulk polish: no select-all, no selected-$ readout, selection not pruned on filter change, no "Attribute N of M" eligibility copy — OLD :476-483,:2448-2462,:2490-2543 (MED)
- [P3] SBA category columns ordered by grand total incl. overhead vs artist-spend-first w/ grayed overhead-only cols — OLD :1949-1954,:2022-2024 (MED)
- [P3] SBA advances paragraph reduced (advance-only-artist count + attributed-advances sentences gone) — OLD :1897-1917 / NEW SpendByArtist.jsx:53,:141-147 (MED)
- [P3] isValidDay regex-only: 2026-02-31 reaches SQL (OLD round-trips the date :111-116) — NEW reports.js:63 (MED)
- [P3] classify/rename narrowed to Admin+ (Approver excluded vs OLD isBkAdmin) — NEW reports.js:1060,:1080 vs OLD :3478,:3541 (MED, possibly deliberate)
- [P3] from/to inputs lack max/min cross-clamps; Financials basis cross-link row missing — OLD :1227-1229,:1093-1102 (MED)
- [P3] Subtitle "statement-verified" overstates ledger-mastered basis (coverage only warns) — NEW Reports.jsx:104 vs reports.js:4-12 (MED)
- [INT] LEDGER-mastered basis replaces bank-mastered engine (bankRows/dedupe/txnParts, Unorganized lines, unverified section/drill, per-txn ids) — deliberate adaptation, NEW reports.js:4-18
- [INT] Reversal-pair machinery (banner w/ credit_total + still-marked-paid + statements-deck link, total exclusion, search tags, SBA excludes line) — recorded cut, _audit/00-inventory.md:180; consequence: refunded-but-Paid rows silently inflate NEW's P&L
- [INT] /reports/search line-item search — recorded cut, _audit/00-inventory.md:180
- [INT] Label-level pool + ad allocation (+/bk/advertising routes, coverage-denominator split) — recorded cut, _audit/00-inventory.md:188,:180
- [INT] Google Sheets export (long-lived sheet, both tabs, shared row model) — known intentional cut
- [INT] Fingerprint-keyed dismissals/month overrides (survive statement re-upload) — durability improvement
- [INT] Counted vs hidden-only dismissal chip — meaningless under NEW basis
- [INT] isBkAdmin per-endpoint → requireApprover router + label scoping (tenancy)

## recoupments
(reconstructed from pages/recoupments.md §7 after agent was killed pre-append)
- [P1] Unreviewed bank-born rows counted as recoupable: `bookDebitAsEntry` creates approved+Paid `entry_source='bank_statement'` rows inheriting `recoupable DEFAULT TRUE`; recoupment/planning queries have no `recoup_reviewed` gate (column absent repo-wide), no review queue, no class rules — recreates the documented $3.1M unvetted-spend failure — fix: `financials.js:150-156,203-209,283-291`; `bank-statements.js:170-176`; `index.js:487` (HIGH)
- [P1] No bank-evidence join → detail has no four state sections (rose Unverified first / Verified / Awaiting w/ honest-silence copy / Unpaid) and no `recoupState` anywhere, though `utils/recoupState.js` + `lib/bankEvidence.js` exist and serve other pages — fix: `Recoupments.jsx:198-216`; `financials.js:203-206` (HIGH)
- [P1] Claim-the-provable band gone: no `provableUnclaimed` (verified ∧ unclaimed), no Upload-all-N bulk claim w/ stamp-decides-statement confirm, no per-artist emerald unclaimed rows, no "Most provable, unclaimed" sort — fix: index view (absent) (HIGH)
- [P2] Unverified surfacing gone: no rose "N with no bank line" chips (card + section header), no `filterUfr='unverified'` option, no `BankEvidenceDot` on UFR'd rows, no clickable stat-note drill-in — fix: rows/filters (absent) (HIGH)
- [P1] Stat cards gone: Recoupable·bank-basis (3-way note), Uploaded (no-bank-line sub-link), Pending Upload (provable-now note), Paid/Unpaid click-to-filter tiles, USD headline + native tooltip + item counts, collapsible bar w/ inline headline — fix: page top (absent) (HIGH)
- [P2] Mixed-currency rendering gone: `money()` hardcodes `$`, only pre-converted `amount_usd` shown; no per-currency totals (`fmtTotals` "$X + €Y"), no `fmtTotalsCompact` cap-at-2 + "N more", no native amount + ≈USD suffix on rows — fix: `Recoupments.jsx:12` + all figures (HIGH)
- [P1] `recoupment_label` (upload-batch vocabulary) absent end-to-end: no column, no chips/editor/datalist, no label filter incl. `__none__`, no label sub-buckets, no Set-Label bulk actions — fix: schema + page (HIGH)
- [P1] Per-artist statement tabs gone: OLD's URL-backed `?statement=` strip (Pending / Uploaded / Total / per-month w/ counts, tone-coding, bookmarkable) replaced by one global Statements tab grouping all artists by month; no pending/uploaded/total views, no per-tab scoping of rows/selection — fix: `Recoupments.jsx:100-125` (HIGH)
- [P4] `statementWindowLabel` tooltips gone — nothing explains a month covers "May 21 – Jun 20" (users must know the 21/20 rule) — fix: statements tab (HIGH)
- [P2] Move-between-statements gone: no per-item month picker on the UFR date, no bulk Move-to-month, no noon-UTC day-1 stamp, no-op guard, eligibility filter, undo + rollback; `ufr_marked_at` not writable anywhere in NEW — fix: no endpoint/UI (HIGH)
- [P1] `ufr-bulk` unscoped + PRESERVE violated: no recoupable/status/deleted/voided/prior-year re-check, no 2000 cap, unconditionally restamps already-UFR rows to NOW() (silently moves committed items between statements on replay/stale client), claim-only (no `ufr:false`), response `{committed}` vs OLD's `{ufr,changed,already,requested,skipped}`, no `bk_audit_log` write (table exists, `db.js:31`) — fix: `financials.js:302-316` (HIGH)
- [P2] Single UFR toggle endpoint unscoped (WHERE label_id only — stamps pending/deleted/voided/non-recoupable rows) and restamps `ufr_marked_at` on repeated `ufr:true`; latent via current UI but an open contract — fix: `financials.js:262-275` (HIGH)
- [P2] Filter bar gone: search (payee/artist/song/description/category/label **+ socials handles w/ parent fall-through**), artist dropdown, UFR Yes/No, payment Paid/Unpaid, recoupable Yes/No/All (promote workflow), label filter, Clear, collapse memory, Active chip — fix: `Recoupments.jsx:83-96` (HIGH)
- [P2] Multi-select + bulk bar gone: per-tab Select-all (scoped to visible statement tab), section/label indeterminate checkboxes, floating bar w/ per-currency totals, Set Label, Set Label & Mark UFR, Add to plan, Move to month, Clear — fix: detail rows (HIGH)
- [P2] Inline metadata editing gone: payee rename, category/song chips + single/group editors w/ breadcrumb suppression, group rename pencil (bulk case-cleanup), notes modal + preview chip, socials chips + editor (parent-inherited, artist-filtered, child read-only) — fix: detail rows (HIGH)
- [P2] State toggles gone: recoupable toggle (incl. promote-from-non-recoupable), cobrand toggle (w/ category=Marketing force + undo-restores-category), Paid/Unpaid flip on added-expense rows — fix: detail rows (HIGH)
- [P2] Row tools gone: Split-across-artists modal, FlagButton (expense flag + reason), CommentThreadButton threads, invoice FilePreview w/ split-parent fallback, soft-delete w/ undo-restore — fix: detail rows (HIGH)
- [P3] 10s undo-toast system absent — no mutation on NEW is reversible (OLD funnels every write through `showUndo` w/ exact-state rollback) — fix: page-wide (HIGH)
- [P2] Dismissal workflow gone: no dismiss/restore control, no partitioned collapsible Dismissed section — cadence `artist_meta.dismissed` column exists unused — fix: index (HIGH)
- [P2] Index ordering + planning filter gone: sort modes (unverified default / provable / pending / total), ready-for-planning filter (all/ready/not) — fix: index (HIGH)
- [P2] Artist detail not routed: inline expander replaces `/recoupments/:artistName` subpage — not bookmarkable/shareable, no back-link header, no Collapse-all, no per-artist Planning deep link, single artist open at a time — fix: `App.jsx:161` (HIGH)
- [P2] Index is artists-table-driven: recoupable expenses whose artist string doesn't exactly match a roster name (misspellings, punctuation variants, unassigned) appear nowhere — OLD renders every entry incl. an Unassigned card — fix: `financials.js:148-181` (HIGH)
- [P3] Exact `LOWER()` artist matching — no `normalizeArtistKey` punctuation-aware collapsing ("LIFE/LINE" ≠ "LIFELINE"); cadence `lib/artistKey.js` exists but unused by financials — fix: `financials.js:170,207-209` (HIGH)
- [P3] Grouping degraded: raw case-sensitive `e.song` keys split spelling variants; no best-spelling display; no groupBy Category mode; no secondary-axis buckets; no `__na__` sink ordering; no pinned Advance/Marketing — fix: `Recoupments.jsx:72-76` (HIGH)
- [P3] Shared index-page note (sentinel `__recoupments_index__` in recoupment_notes, 4000-char, saves-on-blur) absent — fix: index (HIGH)
- [P3] Per-song notes absent (inline amber editor + always-visible note row under song headers); only artist-level notes survive (via artist_meta) — fix: detail (HIGH)
- [P3] Song Finished + song-level Ready-for-planning badges gone — `song_campaign_status` exists in cadence (used by Artist Campaigns) but Recoupments never reads it — fix: detail song headers (HIGH)
- [P3] Excel export gone (`/export-recoupments`: per-artist workbook, groupBy-aware sections, subtotals + grand total, payment-filter aware) — fix: no endpoint (HIGH)
- [P3] Add-expense thinner: no description field, no release dropdown (detail), no socials rows, no UFR-at-create, no receipt upload, no undo-delete of the fresh row — fix: `financials.js:320-346`; client `:184-196` (HIGH)
- [P3] Non-recoupable panel gone (collapsed per-artist localStorage panel listing non-recoupable items w/ full row tools + "Mark recoupable" promote) — with recoupable toggles also gone (-16), a wrongly-flagged row can't be fixed from this page at all — fix: detail (HIGH)
- [P3] Deal summary card + Remaining-vs-Deal tile gone (contract-parsed advance/total, per-line breakdown, spent-USD vs deal capacity) — fix: detail (absent) (HIGH)
- [P3] Card telemetry gone: items-uploaded + $-uploaded (paid-basis) progress bars, cobrand subtotal pill, Complete-on-Campaigns chip, best-spelling display names, ChevronRight affordance styling — fix: index rows (HIGH)
- [P4] `statementMonthFor` defaults NULL to `new Date()` — a UFR row with a missing `ufr_marked_at` buckets into the CURRENT month on /statements instead of an Unstamped group (client's `'Unstamped'` key can never fire) — fix: `statementMonth.js:6`; `financials.js:253` (HIGH)
- [P4] Prior-year tagging is per-item `window.prompt` only — no bucket/group-level tag/untag, no visible tag state on live rows beyond the button — fix: `Recoupments.jsx:210` (HIGH)
- [P4] Priority subtabs always render (OLD hides until a priority exists), no per-band counts, no "No priority" band; server accepts any priority string (OLD validates high/medium/low) — fix: `Recoupments.jsx:90-96`; `financials.js:358` (HIGH)
- [P4] Freshness/persistence gone: no throttled silent refetch on focus/visibility (multi-admin drift), no localStorage collapse memory, no Collapse/Expand-all — fix: page-wide (HIGH)

## recoupments-planning

- [P1] Staged-plan model gone: no "Add to plan" on Recoupments, no localStorage working set / eligibility auto-prune / focus rehydrate / Reset plan — page shows the entire eligible pool and curation lives in a selection that resets every load — fix: RecoupmentPlanning.jsx:24 + NEW Recoupments.jsx (HIGH)
- [P1] Upload-batch labels absent end-to-end: no recoupment_label column, no label chips/menu, no Move-to-label, no group-by-label, no unlabeled counters; commit stamps no label so statements can't group by batch — fix: schema + financials.js:306-309 (HIGH)
- [P1] POST /recoupments/ufr-bulk re-checks nothing (recoupable/status/deleted/voided/parent/prior-year), uncapped, unconditionally restamps already-UFR rows (stale commit moves rows between statement months), no per-item audit (same root as DEF-RECOUP-11) — fix: financials.js:302-316 (HIGH)
- [P2] Artist-cards → drill-down IA gone: no cards grid, no ?artist= URL-backed detail, no By song / By label modes, no Recoupments-page cross-link — fix: RecoupmentPlanning.jsx:66-100 (HIGH)
- [P2] Summary strip gone (In plan / Groups + N unlabeled / Total per-currency / Total USD, artist-scoped when drilled) — fix: page header (HIGH)
- [P3] Planning page-note scratchpad gone (recoupment_notes sentinel, 4000-char, saves on blur) — fix: page (HIGH)
- [P2] Per-row Recoup toggle + per-row UFR toggle (label-carrying) gone — single items can't be claimed/un-recouped here — fix: row actions (HIGH)
- [P3] Cobrand toggle chip gone (optimistic, forces category=Marketing, rollback restores prior category) — fix: row actions (HIGH)
- [P2] Split-across-artists modal gone (min-2 rows, leftover-cents seeding, allocated/remaining math) — fix: row actions (HIGH)
- [P3] Invoice FilePreview gone (own-file-first, split-parent fallback) — only a ledger ?focus jump remains — fix: RecoupmentPlanning.jsx:93 (HIGH)
- [P3] Flags gone at both grains: artist FlagButton (shared artist_meta.flagged) + per-expense flag w/ inline reason strip — fix: cards + rows (HIGH)
- [P3] Comment threads gone (CommentThreadButton + inline strips bulk-fetched via GET /bk/comments?ids=) — fix: rows (HIGH)
- [P3] Soft-delete gone (confirm, cascades to split children, restore-from-Ledger) — fix: rows (HIGH)
- [P3] Bulk "Set song…" gone — fix: bulk bar (HIGH)
- [P2] Commit workflow degraded: no plan-wide Done (selection-only), no per-item failure banner w/ retry-staging, no deferred-count disclosure, no navigate-back; generic Failed toast — fix: RecoupmentPlanning.jsx:48-55 (HIGH)
- [P3] Save-for-later not persisted (in-memory vs localStorage recoupment_plan_deferred) and deferred artists' items hidden entirely (OLD keeps them visible in a bottom section w/ totals) — fix: RecoupmentPlanning.jsx:21,26,76 (HIGH)
- [P3] ?focus= deep-link (auto-select artist, scroll, amber spotlight) gone — fix: page (HIGH)
- [P4] Copy-list clipboard export gone (grouped outline w/ totals) — fix: header (HIGH)
- [P3] Socials chips gone (@platform handle · $amount, +N overflow, parent fallback) — fix: rows (HIGH)
- [P3] Ready-for-planning markers never reach this surface: page ignores artist_meta.ready_for_planning (no badge/sort/filter); song-level marker absent from the flow — fix: RecoupmentPlanning.jsx (absent); NEW Recoupments.jsx:154,175 (HIGH)
- [P3] Fetch failure swallowed (catch(() => {})) → renders "Nothing to plan" empty state as if success; no retry — fix: RecoupmentPlanning.jsx:24,63-64 (HIGH)
- [P3] Select-all affordances reduced to the song checkbox: no page/artist/category select-all, no row-click toggle — fix: RecoupmentPlanning.jsx:82,88 (HIGH)
- [P4] Collapsible song/category sections gone — long artists render fully expanded — fix: groups (HIGH)
- [P4] Ordering: artists alphabetical (server order) vs staged-USD desc; songs alphabetical vs spend desc w/ (no song) sunk — fix: financials.js:288 (HIGH)
- [P4] Song subtotals USD-only (no per-currency breakdown at group level); server also drops artist-less rows (artist <> '') OLD plans under "(no artist)" — fix: RecoupmentPlanning.jsx:78,84; financials.js:287 (HIGH)
- [P4] Visual hierarchy flattened: Unpaid pill red→gray, amount font-black boom→text-xs medium, emerald commit→btn-primary, dark floating bulk pill→full-width bar, bold song headers→11px uppercase strips — fix: RecoupmentPlanning.jsx:84,91-92,106,114 (HIGH)
- [P4] Detached from the Recoupments family: no Back-to-Recoupments pill, no TabbedShell membership — fix: App.jsx:162 (HIGH)
- [INT] Tenancy + gating: label_id scoping, requireApprover router gate, AdminRoute + Approver-only nav item
- [INT] USD conversion moved server-side onto locked fx_rate_to_usd (eUsd) replacing client FxRatesContext — cadence FX model, more correct
- [INT] NEW chrome: toasts, Skeleton loader, shared formatDate
- [INT] RC-2 accent (boom red → runtime brand)

## recording-budgets

- [P2] Routed index + detail split gone — no /recording-budgets/:id, budgets not bookmarkable, inline expander one-at-a-time — fix: App.jsx:173; RecordingBudgets.jsx:26 (HIGH)
- [P3] New-budget flow inverted: OLD one-click blank draft → navigate to detail (all optional); NEW inline form requiring a title (field OLD's model doesn't have) — fix: RecordingBudgets.jsx:28-32; recording-budgets.js:53-54 (HIGH)
- [P2] 5-card summary strip gone (Total budgeted / Advances / Draft / Approved / Locked) — fix: index (HIGH)
- [P3] Search + status filter toolbar gone (w/ filtered-empty state) — fix: index (HIGH)
- [P4] Row anatomy: Fund/Budget type chip, status-chip icons, locked slate→amber, "Unnamed artist" placeholder, "N tracks · N line items" meta, Total + Advance/Fund amounts — fix: RecordingBudgets.jsx:71-80 (HIGH)
- [P1] Budget|Fund type model gone entirely: no type/fund_amount, no Type segmented control, no fund summary panel (Recording Fund Available / Total LP Budget / Balance Due on Delivery / Contingency), no fund costs summary — fix: schema index.js:751-766 + page (HIGH)
- [P2] advance_amount gone: Advances card, row column, Total Project Costs (Budget + Advances), less-Execution-Advance math all unrepresentable — fix: schema + page (HIGH)
- [P2] Artist roster combobox gone (artist_id FK vs freeform artist_name, type-to-filter, keyboard nav, freeform escape) — plain string captured once at create — fix: RecordingBudgets.jsx:52 (HIGH)
- [P3] Release link gone (release_id select + release-scoped actuals) — fix: schema + header (HIGH)
- [P3] Per-budget currency gone (5-option select; all figures in budget currency) — NEW hardcodes $ — fix: RecordingBudgets.jsx:9 (HIGH)
- [P3] Proposed # Tracks field gone — fix: schema + header (HIGH)
- [P2] Header uneditable after create: PATCH /:id exists but client never calls it; no blur-save fields; notes never exposed — fix: RecordingBudgets.jsx (no edit UI) (HIGH)
- [P2] Locked is a client dead-end: no Unlock/reopen control renders when locked (OLD: Unlock) — fix: RecordingBudgets.jsx:87-91 (HIGH)
- [P2] Locked budgets deletable: Trash2 renders at every status and server DELETE has no locked guard (OLD 403 + draft-only client delete) — fix: recording-budgets.js:99-102; RecordingBudgets.jsx:93 (HIGH)
- [P3] No confirm on any lifecycle transition (OLD: three distinct confirm strings for approve/lock/reopen) — fix: RecordingBudgets.jsx:33 (HIGH)
- [P1] qty × unit_price line-item model gone (amount-only rows, no computed totals, no per-section qty/price header labels: #Tracks/Price Per Unit, Days/Rate Per Day, #Tracks/Day Rate, Quantity/Estimated Cost…) — fix: schema index.js:769-777; recording-budgets.js:111-115 (HIGH)
- [P2] Two-tab detail (Planning | Costs to Date) gone — no costs tab; actual spend is one number on the collapsed row — fix: RecordingBudgets.jsx:79 (HIGH)
- [P2] Costs-to-date By-category table gone (planned/spent/remaining/% w/ overspend tones, categories-in-play only) — fix: absent tab (HIGH)
- [P2] Ledger-expense list + per-row budget-category override gone: no PUT /budgets/expense/:id/section, no expenses.budget_section_override column (grep zero), no override select UI — fix: absent endpoint/column (HIGH)
- [P2] Actual-to-date mis-scoped: whole-artist all-category all-time spend (LOWER, no TRIM, no release scope) shown red/green against a recording-only plan — fix: recording-budgets.js:23-30 (HIGH)
- [P2] Actuals ignore the locked FX rate — toUSD(date) instead of amount / fx_rate_to_usd, violating cadence's lib/usd.js locked-rate invariant (financials.js was fixed via eUsd; this router wasn't) — fix: recording-budgets.js:8,30 (HIGH)
- [P3] Sticky running-total strip gone (Sections subtotal / Contingency / TOTAL BUDGET / Expand-all) — fix: detail (HIGH)
- [P3] Section-card anatomy gone: all-six-always-rendered, per-section icon+tint, compact-when-empty chevrons + "nothing here yet", header Add-row CTA, live share bar — sections render only if populated — fix: RecordingBudgets.jsx:42,96-98 (HIGH)
- [P3] Inline per-row edit gone — no line-item PUT endpoint; rows delete-only (OLD click-to-edit w/ save/cancel + amount recompute) — fix: recording-budgets.js (no PUT) (HIGH)
- [P3] Bottom total block gone (Miscellaneous/Contingency line, ruled TOTAL BUDGET, Total Project Costs) — fix: RecordingBudgets.jsx:119 (HIGH)
- [P3] Server accepts any section string (defaults 'Other'); OLD 400s non-catalog sections — fix: recording-budgets.js:114 (HIGH)
- [P3] Fetch errors swallowed (catch(() => {}) list + detail) → "No budgets yet." rendered on failure; no error card, no retry — fix: RecordingBudgets.jsx:23,25 (HIGH)
- [P4] Line-item delete has no confirm (OLD names the description) — fix: RecordingBudgets.jsx:40 (HIGH)
- [P4] Contingency default 0 vs OLD 7.5% at create — fix: recording-budgets.js:58 (HIGH)
- [P4] List ordered created_at DESC with no updated_at; OLD orders updated_at DESC and touches parent on item writes — fix: recording-budgets.js:18 (HIGH)
- [P4] Audit stamps degraded: by-names stored as strings never displayed, no locked_by/updated_by, reopen leaves approved/locked stamps stale (OLD nulls them) — fix: recording-budgets.js:58,89-91 (HIGH)
- [P4] Single shared add-item form state leaks typed values between budgets; section stored as raw display label — fix: RecordingBudgets.jsx:21,112-116 (HIGH)
- [INT] Tenancy + gating: label_id everywhere + FK'd tables, requireApprover router gate, AdminRoute + Approver-only nav (OLD router was auth-only)
- [INT] logActivity audit lines on create/status (OLD budgets router no-op'd its logger)
- [INT] NEW chrome: toasts, Skeleton loader, PiggyBank empty state
- [INT] Per-line-item ledger category picker from the per-label categories table (surfaces OLD's hidden line-item category column as UI)

## artist-budgets
- [P3] Export missing the four state-split prose rows ("Of that spent — confirmed on a bank statement…") — fix: server/routes/artist-budgets.js:263-268 (HIGH)
- [P3] Export missing OPEN·UNPAID INVOICES block: per-invoice rows + STILL TO PAY total + separate double-ruled COMMITTED row w/ over-budget note — fix: server/routes/artist-budgets.js:251-265 (HIGH)
- [P4] Export missing the Note column (section note / "unplanned" / "over-committed once open invoices are paid" annotations) — fix: server/routes/artist-budgets.js:251-256 (HIGH)
- [P4] Index rows lost "· N paid items" + Open-cell "N unpaid invoices" tooltip; server omits per-artist count/open_count — fix: server/routes/artist-budgets.js:183-189 + client/src/pages/ArtistBudgets.jsx:85-90 (HIGH)
- [P4] Index StateBar lost its text sublabel ("$X confirmed · $Y unconfirmed · $Z no bank line") — amounts hover-only — fix: client/src/pages/ArtistBudgets.jsx:96-103 (HIGH)
- [P4] Index summary band reduced: budgeted total, open-invoice count, "N with no budget set yet" dropped; totals omit with_budget/committed/open_count — fix: client/src/pages/ArtistBudgets.jsx:62 + server routes :196-201 (HIGH)
- [P4] Open worklist not globally oldest-first (flatMap keeps section order) while copy says "Oldest first" — fix: client/src/pages/ArtistBudgetSheet.jsx:139 (HIGH)
- [P4] Open worklist header lost invoice count + amber running total + STILL TO PAY footer row — fix: client/src/pages/ArtistBudgetSheet.jsx:134-156 (HIGH)
- [P4] PayeeLink (vendor page, new tab, keeps review position) replaced by same-tab /ledger?focus link — fix: client/src/pages/ArtistBudgetSheet.jsx:120,144 (HIGH)
- [P4] Non-USD rows no longer show "(amount CUR)" original beside USD; moneyOrig imported unused — fix: client/src/pages/ArtistBudgetSheet.jsx:13,123 (HIGH)
- [P4] Sheet load failure leaves an eternal skeleton (toast only) — no error card / retry / back-link — fix: client/src/pages/ArtistBudgetSheet.jsx:54,67 (HIGH)
- [P5] Budget input lost "Set by {name}" provenance tooltip + saving spinner; updated_by stored as name string, never returned/shown; boxed input vs OLD inline sheet-cell — fix: client/src/pages/ArtistBudgetSheet.jsx:36-44 + server routes :95-98,226-231 (HIGH)
- [P5] Category rollup lost per-category counts + indented column-aligned rows (inline chips instead) — fix: client/src/pages/ArtistBudgetSheet.jsx:109-113 (HIGH)
- [P5] Small-behavior cluster: empty sections not dimmed; age chip shown <30d (OLD suppresses) w/ >30/>90 thresholds + no UTC-noon anchor; invalid budget input reverts silently (no toast); open rows show section not category, drop song — fix: client/src/pages/ArtistBudgetSheet.jsx:29,92-107,140-146 (MED)
- [P5] Sheet tabular anatomy lost: single aligned table + SPENT tfoot band → card stack; headline "of what has been spent" state strip + over-committed warning line gone — fix: client/src/pages/ArtistBudgetSheet.jsx:82-131 (HIGH)
- [P5] Footer explainer dropped the load-bearing rule "Expenses land in a section by their category — nothing is assigned by hand" — fix: client/src/pages/ArtistBudgetSheet.jsx:159-161 (HIGH)
- [P5] Export filename uses mangled artist_key not display spelling — fix: server/routes/artist-budgets.js:288 (HIGH)
- [INT] label_id tenancy on every query + router-level requireApprover (OLD: inline isBkAdmin per route)
- [INT] Export downloaded via Authorization-header blob (query-token auth removed app-wide); generic 'Failed' error bodies
- [INT] wb.creator 'Boom Records' dropped (branding); shared utils/money + recoupState + BankEvidenceDot primitives replace page-local clones

## artist-campaigns
- [P2] Two-layer Settled/Committed model missing: no buildPnl by_artist bank-basis layer, no bank-evidence guard, no date range, no unpaid/awaiting/flagged-no-bank-line split, no basis labeling — "actual" is the invoice-side sum OLD documents as the pre-fix bug — fix: server/routes/artist-campaigns.js:56-107,442-479 (HIGH)
- [P2] Catch-up QUEUE view (?view=queue) missing entirely: GET /queue, PROBLEMS one-definition chips/filters/counts, 5 sorts, shown-list header totals, invoice-basis disclaimer, unlinkable disclosure, mark-finished — fix: no counterpart in cadence (HIGH)
- [P2] Attribute-unattributed flow missing: unattributed spend structurally invisible (artist <> '' in VISIBLE), no "names no artist" disclosure, no reports-drill queue modal w/ reimbursements-net line, no set-artist on PART ids, no vendors→label-level rule, no unassigned detail page — fix: server/routes/artist-campaigns.js:37,171 (HIGH)
- [P3] Disclosure meta gone: meta.excluded ($ + count of dismissed/not-campaign), campaign_total, coverage_pct, scope/basis line — exclusions now move totals silently — fix: server/routes/artist-campaigns.js:107 (HIGH)
- [P3] Scope divergence: fixed disclosed category list + per-row in_scope flag-not-filter → undisclosed regex auto-detect ('market|advertis|promo|influenc|public|social'); artist's out-of-scope rows no longer listed; free-text categories matching the regex silently join totals — fix: server/routes/artist-campaigns.js:30-33,445-448 (HIGH/MED)
- [P3] Status universe narrowed: e.status = 'approved' drops pending AND NULL-status rows (OLD counted pending vendor invoices as committed) — fix: server/routes/artist-campaigns.js:36 (HIGH)
- [P3] Statement-born families not excluded — no entry_source IS DISTINCT FROM 'bank_statement' root-test despite lib/ledgerSource.excludeBankRows existing — fix: server/routes/artist-campaigns.js:35-40 (MED)
- [P3] rename-song degraded: no transaction, no releases.project_name cascade, no song_campaign_status key move (finished/notes orphan) — and zero client callers — fix: server/routes/artist-campaigns.js:375-392 (HIGH)
- [P4] Export fidelity: Bank column/bankState words gone, per-song section bands (release meta + Finished rail) gone, "Invoiced · Unsettled · Unpaid" subtitle gone, Notes col gone, banding/status tints/autofilter/date cells/per-currency numFmt gone, filename undated — fix: server/routes/artist-campaigns.js:395-438 (HIGH)
- [P4] Index card losses: complete-toggle circle, FlagButton w/ rolled-up song-flag count + reason editor, "reconciled" chip, campaign-count meta; priority H/M/L buttons regressed to the native <select> OLD abandoned for touch quirks — fix: client/src/pages/ArtistCampaigns.jsx:80-104 (HIGH)
- [P4] Review assignment UI missing (POST /review-assign orphaned); inbox badge counts flaggedArtists it never renders; openThreads fetched, unused — fix: client/src/pages/ArtistCampaigns.jsx:44,51-74 + server :155-173 (HIGH)
- [P4] Campaign link/unlink UI missing — POST /link orphaned; index "unlinked" chip has no resolving action — fix: server/routes/artist-campaigns.js:274-281 (HIGH)
- [P4] Bulk-deal delivery reduced to a static chip — no bulk_deal_items rollup (delivered/total) or evidence links — fix: server/routes/artist-campaigns.js:43-51 + client detail :176 (HIGH)
- [P4] Detail dismissed tray missing: ?include_dismissed, dismissed_count, per-row Restore, dismiss undo toast — /restore orphaned; dismissed rows unrecoverable from the page — fix: client/src/pages/ArtistCampaignDetail.jsx:53 + server :244-249 (HIGH)
- [P5] Leaf-only NOT EXISTS lacks deleted/voided guard on children (soft-deleted children hide the whole family); NEW's own artist-budgets SQL has the guard — fix: server/routes/artist-campaigns.js:39 (MED — needs runtime check on unsplit delete mode)
- [P5] Split-child socials no longer inherit parent's for display (parent_social_handles dropped) — fix: server/routes/artist-campaigns.js:43-51 (HIGH)
- [P5] "(no song)" subpage unlinkable (no __no-song__ slug); song subpage crumb/title shows lowercased key not display spelling — fix: client/src/pages/ArtistCampaignDetail.jsx:73-74,84,147 (HIGH)
- [P5] Focus-refetch (30s throttle) multi-user freshness dropped — fix: client/src/pages/ArtistCampaignDetail.jsx (HIGH)
- [P5] dismiss/restore/not-campaign no longer sync a marker onto the ledger row (OLD kept expenses.artist_campaign Yes/No in step) — fix: server/routes/artist-campaigns.js:235-271 (MED)
- [P5] Song groups alphabetical instead of spend-desc-then-release-date; group totals unlabeled (no "Invoiced") — fix: client/src/pages/ArtistCampaignDetail.jsx:73,150 (HIGH)
- [P5] Export header hardcodes Boom red FFDC2626 in a runtime-branded multi-tenant product — fix: server/routes/artist-campaigns.js:415 (HIGH)
- [INT] Ad-pool line + allocation modal deferred by the 2026-08-27 build plan (/reports/ad-pool flow)
- [INT] Tenancy + requireApprover gate replacing OLD's grantable page permission (plain Users lose grantability)
- [INT] Generic 'Internal server error' bodies; export via Authorization-header blob (no ?token=)
- [INT] Chat mentions via shared recordMentions/user_mentions bell instead of bespoke mention payload + room deep-links
- [INT] artist_campaign as boolean TRUE/NULL/FALSE per-row override replacing OLD's 'Yes'/'No' text column (mechanism only; scope regex is the P3 above)

## salary
- [P1] Roster edit UI missing — server PATCH /salary/employees/:id has zero client callers; names/amounts uncorrectable in-app — fix: client/src/pages/Salary.jsx (add edit; OLD Salary.jsx:87-135) (HIGH)
- [P1] Remove-from-payroll missing — no DELETE route, no UI; PATCH active:false unreachable — fix: server/routes/salary.js + client/src/pages/Salary.jsx (OLD salary.js:144-152) (HIGH)
- [P2] Department grouping w/ per-dept "n/m paid" + subtotal headers flattened to one table — fix: client/src/pages/Salary.jsx:105-133 (HIGH)
- [P2] 4 summary stat cards (Total/Paid Out/Remaining/Employees x/y) reduced to one inline line — fix: client/src/pages/Salary.jsx:72 (HIGH)
- [P2] History regressed to paid-snapshot: no salary_payment_history table, no marked_unpaid rows, not month-scoped, and unmarking paid nulls paid_at so the record vanishes — fix: server/routes/salary.js:34-49,106 (HIGH)
- [P2] Mixed-currency totals: totalDue/totalPaid sum monthly_amount across currencies and render as USD — fix: client/src/pages/Salary.jsx:50-51,72 (HIGH)
- [P3] Upsert DO UPDATE omits amount — stale paid_amount after a raise (OLD set amount=EXCLUDED.amount) — fix: server/routes/salary.js:106 (HIGH)
- [P3] Paid date + "by {name}" metadata no longer shown on rows — fix: client/src/pages/Salary.jsx:123-126 (HIGH)
- [P3] "This Month" reset button missing — fix: client/src/pages/Salary.jsx:67-73 (HIGH)
- [P3] Unpaid rows lose red Unpaid state (gray "Mark paid") + per-row in-flight spinner/disable dropped — fix: client/src/pages/Salary.jsx:46-49,123-126 (HIGH)
- [P3] Skeleton loaders replaced by "Loading…" text — fix: client/src/pages/Salary.jsx:102 (HIGH)
- [P3] Roster sort amount-DESC → department/name — fix: server/routes/salary.js:23 (HIGH)
- [P3] Payment notes capability dropped (no column; OLD API preserved notes) — fix: server/index.js:1202-1214 (LOW)
- [P3] Department free-text → fixed DEPARTMENTS select for non-user payroll rows — fix: client/src/pages/Salary.jsx:78 (LOW)
- [P3] PATCH /employees/:id lacks OLD's empty-name/negative-amount validation — fix: server/routes/salary.js:73-77 (MED)
- [INT] label_id scoping + in-tenant employee re-validation (salary.js:22,100-101)
- [INT] requireAdmin replaces requirePagePermission('/salary') grantable gate (effective UI access unchanged)
- [INT] marked_by user-FK replaces paid_by name string
- [INT] per-employee currency column/picker (NEW capability; its totals bug is the P2 above)

## team
- [P1] No server-side privilege-escalation guards: Admin can invite/promote to Superadmin, edit Superadmins, demote the last Superadmin via POST /team + PATCH /team/:id (client-side hiding only; OLD settings.js:62-64,159-175 enforced) — fix: server/routes/team.js:57-105,127-160 (HIGH)
- [P1] Velocity analytics (per-member release velocity: stat cards, 12-mo trend table, on-time rate, recent releases) gone with no counterpart — fix: no NEW route/view (OLD team.js:105-213, Team.jsx:560-715) (HIGH)
- [P1] Per-user rep-visibility editor unreachable: /settings/visible-reps/:userId endpoints + ledger enforcement live, zero client callers; RepsManager only manages the label rep roster — fix: client (no UI; server settings.js:108-146, ledger.js:108) (HIGH)
- [P1] /team/:id member detail page missing (releases+tasks+activity; GET /team/:id, /:id/tasks) — see dedicated missing--team-member entry — fix: no NEW counterpart (OLD TeamMember.jsx, team.js:338-431) (HIGH)
- [P2] Workload lost the release dimension: OLD capacity score blended releases w/ completion chips + days-until; NEW WorkloadView is task-count vs task_capacity only — fix: components/mywork/WorkloadView (OLD team.js:214-253, Team.jsx:399-558) (HIGH)
- [P2] Request-vs-assign hierarchy semantics dropped (task_type='request' upward, violet REQUEST UI, request-aware delete rights); NEW just 403s upward assignment — fix: server/routes/tasks.js (OLD team.js:432-467) (HIGH)
- [P2] Team visibility narrowed: OLD /team open to all users; NEW /team AdminRoute + /team-work Approver+ — plain Users have no people directory — fix: client/src/App.jsx:139,187 (LOW — possibly deliberate privacy stance)
- [P2] hierarchy_level orphaned: no UI displays/sets it, invitees default 99, roster still ordered by it — fix: client/src/pages/Team.jsx (form) + server/routes/team.js:66 (HIGH)
- [P3] Task-assignment email fire-and-forget — OLD returned pending_email for EmailPreviewModal (editable To/CC, skip) — fix: server/routes/tasks.js:140-153 (HIGH)
- [P3] Per-person task rollups gone from any roster (done-% bar, req/overdue/active/todo pills, active-task subtitle, dept tabs) — fix: no NEW rollup row (OLD Team.jsx:242-245,383-397,717-929) (HIGH)
- [P3] @-mention quick-task composer + n/1-2-3 hotkeys on the team surface — NEW quick-add is a plain assignee select — fix: components/mywork/TaskSurface.jsx:384-412 (OLD Team.jsx:48-128,291-378) (HIGH)
- [P3] Member-row identity styling: avatars + YOU/EXEC badges absent; Superadmin tone violet→brand — fix: client/src/pages/Team.jsx:9-14,146-156 (HIGH)
- [INT] Invite-link onboarding (passwordless create, 7-day token, resend, pending badge, copy fallback, email-sent/error surfacing) replaces admin-set password + welcome email
- [INT] token_version bump on real role/department change + sign-out warning toast (department is a trusted JWT claim)
- [INT] Department constrained to DEPARTMENTS enum server-side (permission boundary in NEW)
- [INT] Platform operators hidden from roster; invite links never built from the Host header
- [INT] Email/password editing absent from PATCH — invite/accept flow owns credentials

## settings
- [P1] Full export lost every file attachment (invoices/proofs/W9s/receipts/contracts/admin-doc vault) + formatted Excel workbooks; NEW ZIP = 15 CSVs + README — fix: server/routes/full-export.js:14-61 (OLD full-export.js:547-594,313-380) (HIGH)
- [P2] Permission model flipped default-CLOSED → default-OPEN: no rows/empty = unrestricted, so "Save (0 pages)" grants full access and new Users see everything (OLD null=locked-down, Settings.jsx:993-1013) — fix: client/src/context/AuthContext.jsx:155-163 + server/routes/settings.js:72-105 + components/PermissionsManager.jsx:42-45 (HIGH)
- [P2] My Nav tab (per-user nav show/hide, localStorage nav_hidden_pages, "N of M shown", reset) has no NEW counterpart; constants/pages.js:2-3 comment still claims it exists — fix: no NEW mechanism (OLD Settings.jsx:1437-1511) (HIGH)
- [P2] Permissions Overview table (all users w/ role/dept/per-user page counts + Configure links) gone; no-selection state renders nothing — fix: components/PermissionsManager.jsx:109 (OLD Settings.jsx:1039-1096) (HIGH)
- [P2] Reps hard DELETE exposed + duplicate re-add errors instead of reactivating, vs OLD's deliberate soft-deactivate-only model protecting historical name references — fix: server/routes/reps.js DELETE + POST 23505 branch, components/RepsManager.jsx:29-32 (OLD settings.js:472-475,500-504) (MED)
- [P2] Export UX: whole ZIP buffered in browser (axios blob) and in server memory — the exact pattern OLD's comment forbids for multi-GB archives; confirm modal, contents summary, size warning, preparing state all gone — fix: components/DataTools.jsx:15-24 + server/routes/full-export.js:52-55 (OLD Settings.jsx:1748-1876) (MED)
- [P2] Full-export gate widened Superadmin-only → Admin; nothing on NEW /settings is Superadmin-only anymore — fix: server/routes/full-export.js:10 (OLD full-export.js:215-217) (LOW)
- [P3] Permissions editor depth dropped: page search, group collapse, "n of m" group counts, per-group Select all/Clear, preset descriptions, template created-by/counts tooltips, Saved indicator, updated-vs-created feedback, template-delete confirm — fix: components/PermissionsManager.jsx (OLD Settings.jsx:1119-1338) (HIGH)
- [P3] PUT /settings/permissions dropped OLD's Superadmin-only-for-Admin-targets guard — fix: server/routes/settings.js:74-105 (OLD settings.js:372-378) (MED)
- [P3] Permission-template POST validation reduced: empty pages array and >60-char names accepted — fix: server/routes/settings.js:158-161 (OLD settings.js:302-307) (MED)
- [P3] labels.bank_accounts (feeds bankEvidence method compatibility) has no write endpoint and no Settings UI — per-label configurability unreachable — fix: no writer (server/lib/bankEvidence.js:110-114, server/index.js:1591) (LOW)
- [P3] PATCH /api/settings/theme + users.theme orphaned — zero client callers; theme stays per-device localStorage — fix: server/routes/settings.js:41-54, client/src/context/ThemeContext.jsx:6-13 (LOW)
- [P3] Theme picker removed from Settings (header toggle only); no appearance section — fix: client/src/pages/Settings.jsx (OLD Settings.jsx:1515-1558; NEW Layout.jsx:455-462) (LOW)
- [P3] `n` hotkey (add user) gone with the Users tab; NEW Settings registers no hotkeys — fix: client/src/pages/Settings.jsx (OLD Settings.jsx:628-630) (LOW)
- [INT] Users tab (user CRUD + welcome-email preview) restructured onto /team invite-based flow (auth model; gaps counted in ## team)
- [INT] Test Users tab + mocked-data guard dropped — multi-tenant demo workspaces supersede; documented deliberate in cadence CLAUDE.md
- [INT] NEW-only sections: Account profile/password, workspace identity/branding (name/tagline/welcome/logo/accent), home-dashboard widgets + pinned links, outbound email reply-to + test-send, vendor form link + rotation, invoice remittance block, workload target, master-sheet import (multi-tenancy/branding)
- [INT] Permission save bumps target token_version (session refresh) replacing OLD's localStorage refresh beacon
- [INT] Header-auth-only downloads replace OLD's `?token=` query URLs (security hardening)
- [INT] Rep-visibility server half re-shaped per-user GET/PUT (its missing UI is already logged as P1 under ## team — not re-counted here)

## admin-docs
- [P1] Restricted-confidentiality tier is decorative: no visibility filtering for non-Superadmins, no Superadmin-only create/edit/delete guards, form offers Restricted to any admin — fix: server/lib/fileResource.js (add guards) + client/src/pages/AdminDocs.jsx:59 (OLD admin-docs.js:47,115-117,151-156,202-204) (HIGH)
- [P1] Multi-file attachments → single slot; new upload silently deletes the previous file from R2; uploader/date/size listing gone — fix: server/lib/fileResource.js:100-118 + components/FileAttach.jsx (OLD admin-docs.js:226-288) (HIGH)
- [P1] No detail view / metadata editing — only status is mutable post-create; server PATCH supports all fields but nothing calls it — fix: client/src/pages/AdminDocs.jsx:34 (OLD AdminDocs.jsx:97-127,205-296) (HIGH)
- [P2] Search (title/counterparty/tag) + status filter + confidentiality filter gone; category pills only — fix: client/src/pages/AdminDocs.jsx:37-38,68-73 (OLD AdminDocs.jsx:79-92,404-424) (HIGH)
- [P2] Quick-upload gone: page-wide drag-drop + Upload File button creating one titled doc per file with progress — fix: client/src/pages/AdminDocs.jsx (OLD AdminDocs.jsx:50-181,305-343) (HIGH)
- [P2] Notes field unreachable — in form state but no input rendered and no edit mode exists — fix: client/src/pages/AdminDocs.jsx:12,56-65 (OLD AdminDocs.jsx:593-597) (HIGH)
- [P2] Expiring workflow degraded: 60-day server window excluding Archived/Expired + days_left + clickable list + dismiss → client 90-day count-only banner that also counts Archived/Expired docs — fix: client/src/pages/AdminDocs.jsx:14,39,49-53 (OLD admin-docs.js:69-87, AdminDocs.jsx:353-381) (HIGH)
- [P3] is_template flag + Templates tab + purple badge replaced by a plain 'Templates' category value — fix: client/src/pages/AdminDocs.jsx:8 + server/routes/admin-docs.js:10 (OLD AdminDocs.jsx:82,437-443,598-603) (HIGH)
- [P3] Tags: jsonb array + chip editor/display/search → raw comma string never displayed — fix: client/src/pages/AdminDocs.jsx:63 (OLD AdminDocs.jsx:574-591,265-274) (HIGH)
- [P3] List display loss (counterparty, signed date, expires-column, confidentiality, file count, creator) + ordering flipped updated_at→created_at so touched docs no longer surface — fix: client/src/pages/AdminDocs.jsx:80-99 + server/lib/fileResource.js:25 (OLD admin-docs.js:59, AdminDocs.jsx:459-498) (HIGH)
- [P3] Guard mismatch: AdminRoute admits Approvers and /admin-docs is User-grantable (Legal preset) but server is admin-gated — silently empty vault for those users — fix: client/src/App.jsx:158 or constants/pages.js:28,60 vs server/routes/admin-docs.js:8 (MED)
- [P3] Upload dangerous-extension blocklist dropped (bare multer); mitigated by off-origin signed-URL serving — fix: server/lib/fileResource.js:9 (OLD admin-docs.js:11-30) (MED)
- [P3] UTC-parsed `new Date()` on date-only expiry strings (off-by-one-day TZ, the known MyWork bug class) + Draft/Expired badge colors swapped — fix: client/src/pages/AdminDocs.jsx:11,14,90 (OLD AdminDocs.jsx:483-490) (MED)
- [INT] Route /admin → /admin-docs + nav move System → Contracts & Legal (multi-tenant IA)
- [INT] label_id scoping, label-namespaced R2 keys, signed-URL downloads, logActivity on create/upload (tenancy/auth architecture)
- [INT] NEW-only inline status quick-change select on cards

## activity
- [P1] All audit filters gone end-to-end (user/category/date-range+presets/search/department/method/sort) + the /activity/users dropdown endpoint — fix: server/routes/activity.js:10-22 + client/src/pages/Activity.jsx (OLD activity.js:14-87,141-159; OLD ActivityHistory.jsx:380-570) (HIGH)
- [P1] Pagination + total count gone — newest-100 (500 cap) only, older history unreachable — fix: server/routes/activity.js:12,20 + client/src/pages/Activity.jsx (OLD activity.js:89-133; OLD ActivityHistory.jsx:684-726) (HIGH)
- [P2] entry_id/entry_payee never in schema/writer/payload + user role/department dropped from rows — payee subline, dept badge, entry refs impossible — fix: server/index.js:923-933 + middleware/activityLogger.js:12-16 + routes/activity.js:14-15 (OLD index.js:1490-1491, activity.js:93-114) (HIGH)
- [P2] humanizeAction plain-English mapping (~45 endpoint/method rules) gone — raw action strings rendered — fix: client/src/pages/Activity.jsx:36 (OLD ActivityHistory.jsx:51-119) (HIGH)
- [P2] Detail JSON diff formatting gone — structured details render as raw JSON instead of Changed-X-from-to sentences (FIELD_LABELS) — fix: client/src/pages/Activity.jsx:37 (OLD ActivityHistory.jsx:121-172) (HIGH)
- [P2] Per-event category icon + color chip system (9 categories) gone — monochrome feed — fix: client/src/pages/Activity.jsx:32-38 (OLD ActivityHistory.jsx:39-49,174-189,643-645) (HIGH)
- [P2] User cell: avatar initial + clickable department badge (deep-filters the feed) gone — fix: client/src/pages/Activity.jsx:35 (OLD ActivityHistory.jsx:620-637) (HIGH)
- [P3] Time column lost formatted date + relative timeAgo subline → raw toLocaleString — fix: client/src/pages/Activity.jsx:34 (OLD ActivityHistory.jsx:14-35,667-674) (HIGH)
- [P3] Refresh button (silent refetch + spinner) gone — fix: client/src/pages/Activity.jsx (OLD ActivityHistory.jsx:368-377) (HIGH)
- [P3] Errors swallowed → fetch failure renders as "No activity recorded yet"; OLD had error banner + Retry — fix: client/src/pages/Activity.jsx:10,18-19 (OLD ActivityHistory.jsx:573-578) (HIGH)
- [P3] `s` sort-toggle hotkey gone — fix: client/src/pages/Activity.jsx (OLD ActivityHistory.jsx:245-247) (HIGH)
- [P3] Default window all-time newest-100 vs OLD Last-7d preset — fix: client/src/pages/Activity.jsx:9-11 (OLD ActivityHistory.jsx:248,257-264) (MED)
- [P3] Live "N events matching filters" subtitle gone; title "Activity History"→"Activity" — fix: client/src/pages/Activity.jsx:15 (OLD ActivityHistory.jsx:365-367) (HIGH)
- [P3] Loading spinner + iconed empty state → plain text — fix: client/src/pages/Activity.jsx:17,19 (OLD ActivityHistory.jsx:582-590) (HIGH)
- [INT] label_id scoping + label-constrained user join (server/routes/activity.js:17-18)
- [INT] Client route wrapped in AdminRoute (App.jsx:188) vs OLD's unguarded route — corrected form, same effective access

## legal
- [P3] Access widened Admin/Superadmin → Approver+ (AdminRoute + requireApprover) vs OLD's admin-only Legal intent — fix: client/src/App.jsx:153 + server/lib/fileResource.js:27 (OLD Legal.jsx:7-16) (LOW)
- [P3] OLD's hub intent (waivers/clearances/contractor agreements surfacing here) not realized — page is NDAs only, no aggregation — fix: client/src/pages/Legal.jsx:35-36 (OLD Legal.jsx:33; boom UserManual.jsx:333-338) (LOW)
- [P3] notes (and initial status) in form state + server field list but no inputs rendered; notes displayed nowhere — dead field — fix: client/src/pages/Legal.jsx:10,41-46 (HIGH)
- [P3] Effective/Expires use UTC-parsed new Date().toLocaleDateString() — known TZ off-by-one class; repo standard is formatDate — fix: client/src/pages/Legal.jsx:70-71 (MED)
- [P3] Delete uses window.confirm instead of ui/ConfirmDialog — fix: client/src/pages/Legal.jsx:30 (HIGH)
- [INT] NEW implements the register OLD's placeholder only promised (list/status/attached signed doc) — forward-completion
- [INT] /api/ndas repurposed builder-storage → tenant-scoped counterparty tracker; builder split to /api/nda-documents (cadence CLAUDE.md M4)
- [INT] Tenancy/auth: label scoping, label-namespaced R2 keys, signed-URL file access, logActivity (server/lib/fileResource.js:30-117)
- [INT] Nav label "Legal" → "NDAs" (Layout.jsx:40,269) matching narrowed content

## manual
- [P2] Print / Save-as-PDF handout capability gone (OLD print-formatted doc w/ @page + page-break CSS + Printer button; NEW drawer has no export) — fix: client/src/components/UserManual.jsx (OLD UserManual.jsx:604-666) (HIGH)
- [P2] "Common workflows" section gone — 6 permission-filtered cross-page procedures — fix: client/src/constants/manual.js (OLD UserManual.jsx:398-462,741-758) (HIGH)
- [P3] Keyboard-shortcuts reference section gone (footer only points at ?; consolidated/printable reference lost) — fix: client/src/components/UserManual.jsx:162 (OLD UserManual.jsx:366-395,760-786) (HIGH)
- [P3] Live permission refetch (mount/focus/cross-tab + Refresh button) dropped — renders from AuthContext snapshot — fix: client/src/components/UserManual.jsx:10,20-23 (OLD UserManual.jsx:503-543) (MED)
- [P3] Document furniture gone: cover w/ generated date, Contents/TOC w/ group counts, per-article route chip, colophon — fix: client/src/components/UserManual.jsx:93-99 (OLD UserManual.jsx:668-712,788-791) (HIGH)
- [INT] Stale-doc correction: cadence CLAUDE.md still lists /manual as missing — it shipped (App.jsx:172, components/UserManual.jsx, server/routes/manual.js)
- [INT] Content rewritten for Cadence, 34→27 sections (product/branding divergence; boom-only pages have no NEW equivalent)
- [INT] Per-user USER_OVERRIDES (named-employee guidance) dropped — single-tenant content (OLD UserManual.jsx:466-489)
- [INT] NEW-only: manual search, AI /api/manual/ask (key-gated 503 fallback), department "Start here", role-filtered tips
- [INT] Delivery: standalone printable tab → in-app drawer + routed page

## vendor-submit
- [P0] Payment-details subsystem missing (ACH/Wire/PayPal capture, encrypted vendor_payment_details store, reuse-on-file, doc-vs-typed payment_check + last4) — NEW records only a method string; AP can't pay from a submission — fix: cadence server/routes/vendor.js:173,185 + client VendorSubmit.jsx step 1 (OLD vendor-submit.js:64-65,656-679,872-911,1044,1184-1240; OLD client :1200-1258) (HIGH)
- [P1] Duplicate invoice# hard-409 at submit re-introduces the false-positive lockout OLD deliberately removed (normalizeInvoiceNum collapses 001/1/INV-/#) — fix: cadence server/routes/vendor.js:211-220 (OLD rationale vendor-submit.js:973-986) (HIGH)
- [P1] Draft resume broken: unconditional autosave clobbers the stored draft with the blank form on load before Resume is clicked; untouched visits also create a false "saved draft" banner — fix: cadence client/src/pages/VendorSubmit.jsx:61,65-78 (OLD guards :490-497) (HIGH)
- [P1] payment_terms 'Net 30' + scheduled_payment_date NOW()+30d not written — vendor submissions land unscheduled — fix: cadence server/routes/vendor.js:244-262 (OLD vendor-submit.js:1184,1193) (HIGH)
- [P1] Artist roster integration missing: no /roster endpoint, no RosterPicker, no off_roster flag, no server-side artist normalization — free-text artists fragment recoupment/report keys — fix: cadence server/routes/vendor.js + client VendorSubmit.jsx:352 (OLD vendor-submit.js:514-533,774,1088-1106; client :105-253) (HIGH)
- [P1] Pre-submit AI validation gone (/validate-invoice payment-info blocker + /validate-w9 signed/dated gate + step-2 issue lists) — fix: cadence server/routes/vendor.js (OLD vendor-submit.js:224-361; client :438-471,1651-1737) (HIGH)
- [P2] Server accepts an invoice document containing NO invoice number (OLD rejects w/ re-upload instruction) — fix: cadence server/routes/vendor.js:152,226-227 (OLD :1005-1009) (HIGH)
- [P2] Submit requireds relaxed: song-per-row, rep, and social handles (incl. "N/A" explicit-answer convention) all optional — fix: cadence server/routes/vendor.js:178-189 + client :167-181 (OLD client :877-907; server :815-871) (HIGH)
- [P2] Similar-amount check degraded: no 30-day window, no currency match, boolean w/ generic copy vs OLD's detailed match banner — fix: cadence server/routes/vendor.js:131-138 + client :136-137 (OLD vendor-submit.js:720-762) (HIGH)
- [P2] Returning-vendor contact prefill gone (email-gated /lookup address/bank/method autofill) — fix: cadence server/routes/vendor.js:100-116 (OLD :535-589) (HIGH)
- [P2] AI parse degraded: no roster/per-label category vocabulary in prompt, no ai_warnings, no suggest_socials, no prefill-verify banner — fix: cadence server/routes/vendor.js:77-90 + client :94-130 (OLD server :362-513; client :1344-1382) (HIGH)
- [P2] Public upload hardening regressed: 25MB (vs 10MB) and no secureFileFilter — fix: cadence server/routes/vendor.js:18 (OLD :27-32) (HIGH)
- [P2] Socials stored as text appended to notes instead of structured social_handles JSONB — fix: cadence server/routes/vendor.js:276-284 (OLD :1184,1193) (MED)
- [P2] Success screen drops Net-30 terms disclosure + computed date + "Submit Another" contact-preserving reset — fix: cadence client/src/pages/VendorSubmit.jsx:204-210 (OLD :254-297,993-1005) (HIGH)
- [P2] Reimbursement mode demoted from top-level toggle (mode headline + info banners) to a select inside step 2; invoice-requirements guidance banner gone — fix: cadence client/src/pages/VendorSubmit.jsx:259-261 (OLD :1058-1085) (MED)
- [P3] Triple AI parse per submission (file pick + step gate + server submit) vs OLD's two — fix: cadence client/src/pages/VendorSubmit.jsx:107-130,160-162 + server vendor.js:224-230 (HIGH)
- [P3] Dup/W9 checks not live: dup once at step transition (result shown a step later), W9 on blur only vs debounced-as-you-type — fix: cadence client/src/pages/VendorSubmit.jsx:81-85,132-139,164 (OLD :561-641) (HIGH)
- [P3] Submit-time W9-on-file re-check doesn't walk aliases though the step-2 w9-status check does — alias vendors pass step 2 then 400 — fix: cadence server/routes/vendor.js:199-206 vs :106-113 (MED)
- [P3] No sandbox (?sandbox=1 dry-run) or ?admin_preview=1 testing surface — fix: cadence (OLD vendor-submit.js:46-49,1131-1168; client :1009-1048) (HIGH)
- [P3] vendor_emails saved under raw name, not canonical alias — fix: cadence server/routes/vendor.js:295-304 (OLD :1282-1298) (MED)
- [P3] Handle-shaped-artist inline warning absent — fix: cadence client/src/pages/VendorSubmit.jsx:352 (OLD :1398-1452) (LOW)
- [P3] Dead near-duplicate autofill/autofillFrom functions (differ only in amount precedence) — fix: cadence client/src/pages/VendorSubmit.jsx:87-130 (HIGH)
- [INT] Token-only public URL /submit/:token (slug not accepted) + per-label bootstrap (name/branding/reps/live categories) — cadence server/routes/vendor.js:39-73
- [INT] Per-label OG unfurl at /submit/:token — cadence server/index.js:250-261 (OLD static /submit, index.js:351-369)
- [INT] Categories from per-label categories table in bootstrap payload vs OLD constants/context — cadence server/routes/vendor.js:57-60
- [INT] activity_log insert + activity-bot #activity event on submission — cadence server/routes/vendor.js:312-323
- [INT] Submit rate limit 15/hr/IP (OLD limited only AI endpoints, 5/min) — cadence server/routes/vendor.js:25-31,159
- [INT] Invalid-link not-found card + "Powered by Cadence" footer — cadence client/src/pages/VendorSubmit.jsx:202,328

## login
- [P3] Google One Tap (useOneTap) dropped from GoogleLogin — fix: cadence client/src/pages/Login.jsx:78 (OLD Login.jsx:68) (HIGH)
- [P3] Google-failure copy degraded + "Use your … Google account" helper line removed — fix: cadence client/src/pages/Login.jsx:78 (OLD :28,61-63) (HIGH)
- [P3] Submit button re-colored from OLD's deliberate neutral bg-gray-900 to brand primary — fix: cadence client/src/pages/Login.jsx:102 (OLD :100) (MED)
- [P3] Expired-banner copy drift ("has expired" → "expired") — fix: cadence client/src/pages/Login.jsx:138 (OLD :108) (LOW)
- [INT] /login route + token redirect — cadence client/src/App.jsx:112
- [INT] 409 multi-workspace picker (select + retry) — cadence server/routes/auth.js:82-85,147 + client Login.jsx:95-100
- [INT] Suspended-workspace 403 messaging on login/google/accept-invite — cadence server/routes/auth.js:95,152,309
- [INT] Forgot/reset-password flow (routes + ResetPassword.jsx) — cadence server/routes/auth.js:404-488
- [INT] Invite-acceptance screen + endpoints — cadence server/routes/auth.js:275-334 + client AcceptInvite.jsx
- [INT] Cadence logo/wordmark/tagline/footer (RC-2 branding); Google block hidden without VITE_GOOGLE_CLIENT_ID — cadence client/src/pages/Login.jsx:12,63-69,148-150

## privacy-eula
- [P2] Legal pages are self-described placeholders — no actual privacy policy or terms shipped (OLD has full 9-section policy + 12-section EULA incl. AI-processing disclosure) — fix: cadence client/src/pages/Privacy.jsx:11-12 + EULA.jsx:11 (OLD Privacy.jsx:7-77, EULA.jsx:7-65) (HIGH)
- [P3] Dynamic "Last updated: {new Date().getFullYear()}" misrepresents freshness and renders as a bare year — fix: cadence client/src/pages/Privacy.jsx:9 + EULA.jsx:9 (HIGH)
- [P3] /eula page titled "Terms of Service" — mismatches path/route and OLD's EULA framing — fix: cadence client/src/pages/EULA.jsx:8 (OLD EULA.jsx:4) (MED)
- [P3] Dead prose/prose-sm classes (typography plugin not installed; plugins []) — fix: cadence client/src/pages/Privacy.jsx:10 + EULA.jsx:10 (HIGH)
- [INT] Boom entity name/address/contact/CA governing-law text can't carry to multi-tenant product; tokenized card shell + back-to-login link — cadence client/src/pages/Privacy.jsx:5-7

## missing--contracts-create
- [P2] Entire surface missing — AI full-contract generation page (`/contracts/create`); NEW has only single-clause drafting (`server/routes/contracts.js:26`) — fix: new page + `POST /contracts/generate` (label-scoped references, label-name substitution) (MED — OLD itself flagged it "Work in progress")

## missing--approvals-archive
- [P1] Archive UI missing — rejected/deleted invoices unrecoverable and unauditable from the client even though `GET /ledger/archive` exists server-side (ledger.js:1066, zero client callers) — fix: new archive page + restore/unreject actions (HIGH)
- [P2] NEW `POST /ledger/entries/:id/restore` (ledger.js:1043) is not admin-gated but revives deleted/rejected financial history — OLD gates deleted listing + unreject to Admin/Superadmin (OLD bookkeeping.js:710, :3728) — fix: add requireAdmin (MED)

## missing--bank-ledger
- [P1] Bank half of the ledger missing — statement-born spend (62% of OLD's rows) has no browsable/editable surface, no bank/invoices partition on `/ledger`, no `?source=` contract on list/export — fix: `bank` mode on Ledger reusing lib/ledgerSource (HIGH)
- [P2] Statement-lens month tie-out absent — `beginning + credits − debits = ending` per-disposition summary + extra-lines list (OLD lib/statementLens.js); NEW bank-matching shows completion % only — fix: port statementLens + lens UI (MED)
- [INT] OLD `/bk/ledger-matching` (bookkeeper xlsx diff) is a separate orphan, not this entry; NEW deliberately rebuilt matching as `/bank-matching` — the gap is the ledger/lens surface, not the matcher.

## missing--vendors-added-expenses
- [P1] Entire surface missing — invoice-less (recoupment/campaign-born) payee aggregation with duplicate-entry + spelling-variant detection (OLD BkVendorsAdded.jsx + bookkeeping.js:5256); double-payments in these flows are invisible in NEW — fix: new subpage + endpoint reusing lib/artistKey + lib/usd; NOTE NEW's entry_source value is 'recoupment' (singular) per lib/ledgerSource.js:5 (HIGH)

## missing--bk-invoices
- [P1] Invoices index/search surface missing — family-total invoice browsing with click-to-filter weekly submitted/paid charts (OLD BkInvoices.jsx + bookkeeping.js:8178); NEW `/invoices` is the unrelated outbound creator, `payment-analytics` (ledger.js:1502) is display-only on Payments — fix: new page + list endpoint; extend payment-analytics with range/vendor-admin split/week bounds (HIGH)

## missing--bulk-upload
(reconstructed from pages/missing--bulk-upload.md §Defects after agent was killed pre-append)
- [P1] OLD's AI batch invoice+proof ingest flow (`/bk/bulk-upload`: parse-all, proof auto-match, review grid, one-payment grouping, per-entry-rollback batch endpoint) has no NEW counterpart — NEW's "bulk upload" is the master-sheet data import and `bulk-zip` is file *retrieval* — fix: new page + `/ledger/entries/batch` + `/ledger/parse-proof` routes (HIGH)

## missing--ledger-matching
- [P2] Bookkeeper Reconcile absent — no way to diff the ledger against an external bookkeeper's xlsx (8-category diff, tiered fuzzy vendor match w/ confidence reasons, week-ending snapshot cap, family_amount comparison) or produce the deliverables (multi-sheet Excel report, BK-style Excel mirroring the bookkeeper's own workbook, invoice/W9/proof handoff ZIP) (OLD LedgerMatching.jsx + bookkeeping.js:10788/11695/11715/11974/12234 + lib/vendorMatch.js) — fix: new `/ledger-matching` admin page + 5 endpoints, port lib/vendorMatch.js (HIGH)
- [INT] Reconciles ledger ↔ external bookkeeper spreadsheet — a third dataset NEW never ingests; distinct from both NEW `/bank-matching` (statement↔ledger) and the missing--bank-ledger entry (bank half of the ledger). Handoff README hardcodes johns@boomrecords.co — must become per-label on port.

## missing--financials-month-drill
- [P2] Per-month financials drill page missing — OLD `/financials/month/:month` (Financials.jsx:2039 MonthDetailPage + financials.js:2913 aggregate endpoint): delta-vs-prior stat cards incl. intake, generate_series daily activity chart, per-artist table w/ lazy category-mix expansion via exec/subbreakdown, top vendors, top-25 invoices, prev/next month-hop; NEW has only range-based /financials + Reports cell drill (reports.js:466) — fix: new page + `GET /financials/month/:month` endpoint (MED)
- [INT] On port, use NEW lib/usd.js (locked-FX-wins) instead of OLD's inline `amount / COALESCE(NULLIF(fx_rate_to_usd,0),1)` divide-by-rate SQL, and label-scope every query; OLD's intake query hardcodes America/Los_Angeles.

## missing--recoupments-audit
- [P1] Recoupment integrity audit missing — OLD `/recoupments/audit` (RecoupmentsAudit.jsx + bookkeeping.js:9520 GET /bk/recoupment-audit, all five predicates in ONE endpoint): artistless bank advances ($391,958.60 measured), never-judged bank pile ($3.0M), double-claimed invoices incl. cross-artist, claims with no document (family-aware has_doc), part-claimed split families — each with inline remediation (recoup-review, ufr-bulk, class rules); NEW recoupments can claim money but cannot check itself — fix: new page + aggregate endpoint + `recoupment_class_rules`/`recoup_reviewed` schema (HIGH)
- [P2] No never-recoupable class-rules concept in NEW — review queue unfinishable without them (OLD: 8 rules removed $2.07M of Royalties/Salary/Rent noise, bookkeeping.js:9414-9421); rules are exact-match, ledger-untouched, delete = complete undo — fix: `recoupment_class_rules` (+label_id) + CRUD (MED)
- [INT] Not a statement-stamping audit-trail browser — it's a five-check integrity surface; the stamping rule it depends on (preserve `ufr_marked_at` on already-claimed rows) already exists in NEW's statementMonthFor flow and any ported ufr-bulk must honor it. NEW's `ufr` is boolean vs OLD's 'Yes' text; advance categories should key off NEW's categories table, not OLD's hardcoded list.

## missing--ad-allocation
- [P2] Ad-pool allocation surface missing — OLD `/bk/advertising` (AdAllocation.jsx + reports.js:2411-3018 + pure lib/ad-allocate.js): campaign-based apportionment of real bank ad charges (largest-remainder cents math, exact family tie-out asserted, oldest-first greedy draw, dry-run = write derivation), Ads Manager CSV as weights-only import, per-slice undo, slices written reviewed+recoupable so they reach recoupment surfaces; deliberately deferred in the 2026-08-27 build plan (majestic-raven plan:79/148) — scope call, not tenancy — fix: new page + ad-months/ad-charges/ad-allocate endpoints + port lib/ad-allocate.js (HIGH)
- [INT] Port v2 only — OLD's legacy `ad_pool_allocations` table + /ad-pool endpoints were never used ($267,674 pool, zero allocations in 6 months) and v2 exists because of it; NEW's buildPnl lacks OLD's collectLabelLevel hook (needed for adMonthState); depends on `recoup_reviewed` column shared with missing--recoupments-audit; NEW influencer_campaigns schema differs (planned_amount/expense_id vs total_budget/campaign_date).

## missing--bulk-deals
- [P1] Bulk-deals tracker page missing — NEW has is_bulk_deal + label-scoped bulk_deal_items + a bare LedgerEntryDrawer checklist tab, but no surface for contracted-vs-delivered / paid-vs-delivered progress, stalled (30d) + paid-ahead (≥25pt) risk badges, per-unit economics, ghost slots, socials editor, completed archive (OLD BkBulkDeals.jsx 1002L + bookkeeping.js:13035-13159) — fix: new page + `GET /ledger/bulk-deals` rollup endpoint + `platform` col on bulk_deal_items + `bulk_deal_stalled` notification (HIGH)
- [INT] Semantics collision: NEW `bulk_deal_completed` is INT count patched by artist-campaigns (artist-campaigns.js:361-363, index.js:665) while OLD's is a BOOLEAN archive flag the page's Complete/Restore flow depends on — port needs a separate archived boolean, not a repurpose; NEW bulk_deal_items has `url` (no `platform`) vs OLD `video_url`+`platform`; creators batch already stamps is_bulk_deal per row (creators.js:171-179) so batches surface in the tracker for free.

## missing--team-member
- [P1] `/team/:id` member detail page missing — per-person profile (avatar/role/EXEC badges, 4 stat tiles, 14-day incomplete-release alert) + Releases tab (assigned releases w/ checklist completion + days-until), Tasks tab (delegated-only visibility rule for non-privileged viewers, team.js:348-357), Activity tab (last 30 activity_log) (OLD TeamMember.jsx + team.js:338-431); NEW team.js has no detail GET and no client route — fix: new page + label-scoped `GET /team/:id` (HIGH; dup of team.md §7 P1 row — count once)
- [INT] Port must reconcile OLD's admin-or-self task-visibility rule with NEW's department-as-permission-boundary (`teamFilter()` in routes/tasks.js), and decide the page gate alongside team.md's P2 "team visibility narrowed" call; NEW already stores everything needed (releases.assigned_to, tasks.assigned_by, activity_log).

## missing--analytics
- [P1] In-workspace usage analytics missing end-to-end — OLD `/analytics` (StrictAdminRoute) gave admins page-view/active-user/login/action stat cards, daily area chart, most-used-pages bars w/ friendly-name map, merged per-user activity table over 7/30/90d (Analytics.jsx + analytics.js + page_views table w/ /:id path normalization, 180-day sweep, Layout route-ping w/ dedup); NEW has NO page_views/pageview/`/api/analytics` (grep-verified — CLAUDE.md's retraction confirmed) while user_login_logs (auth.js:36) + activity_log sit unread — fix: new page + routes/analytics.js + label-scoped page_views table (HIGH)
- [INT] Boundary: NEW `GET /api/platform/analytics` (platform.js:382-416) is the cross-tenant OPERATOR growth feed, not this surface — and it currently has zero client consumers (no PlatformAnalytics page in App.jsx:122-129) — the in-workspace port must be label-scoped and must not reuse it. NEW already logs the other two data sources; a port shows logins/actions history from day one, views only from deploy.

## missing--vendor-preview-lab
- [P2] Vendor-form sandbox missing — OLD `/admin/vendor-lab` is a GENERATED copy of VendorSubmit (4 anchored deltas via client/scripts/sync-vendor-lab.mjs, output post-condition proves it can only post `?sandbox=1`) hitting a write-nothing server branch that runs every live validation (dup check, invoice-number anti-spoof, off-roster test) then returns would_create + not_exercised with masked payment last4, auth-before-multer so anonymous callers can't burn AI or buffer 10MB (vendor-submit.js:34-48, :1111-1170); NEW has no preview/sandbox at all (grep: only zip.js comment) — admins must submit through the live `/submit/:token` form, which writes — fix: sandbox branch in routes/vendor.js + admin lab page + port sync script (MED)
- [INT] Do not resurrect OLD's deleted `/admin/vendor-preview` (admin-only REAL-writing form, removed 2026-08-27 as a foot-gun; its path redirects to the lab, App.jsx:143-151); OLD's copy-not-variant-prop stance is deliberate — a variant prop puts sandbox experiments one prop-check away from the public route; port the generation script and add its `--check` to the verify-before-push step.

## g-sidebar-nav
- [P2] Group taxonomy restructured — Reports merged into 16-row Bookkeeping (OLD split deliberate, navConfig.jsx:180-183), Artists/Releases→Catalog/A&R reshuffle, Artist Campaigns Reports→A&R, System dissolved — fix: cadence client/src/components/Layout.jsx:234-307 per OLD navConfig.jsx:76-243 (HIGH)
- [P2] Flags demoted: all-users top-group /flags (navConfig.jsx:85) → admin-only "Data Quality" under Workspace (Layout.jsx:302); non-admins lose the entry — fix: Layout.jsx:237-244 (HIGH)
- [P2] Personal "My Nav" hidden-pages layer missing (OLD Layout.jsx:414-429,:528-544 + Settings.jsx:1440-1452; grep: no nav_hidden_pages in cadence) — fix: Layout.jsx:308 filter + Settings editor (HIGH)
- [P2] Add Reimbursement absent from nav — only entry is a button on Ledger (Ledger.jsx:370) which non-ledger users never see (OLD navConfig.jsx:168) — fix: Layout.jsx:279 (HIGH)
- [P2] Mobile edge-swipe drawer open/close missing (OLD Layout.jsx:397-412) — fix: cadence Layout.jsx:186-194 (HIGH)
- [P3] Collapsible sub-groups + tabbed family rows (first-viewable-child link, summed badge, nav_collapsed persistence) not implemented; Recoupments = two flat rows (OLD Layout.jsx:613-699,:443-454 / NEW :292-293) (HIGH)
- [P3] Bookkeeping order deviates from OLD frequency order (navConfig.jsx:118-178 vs Layout.jsx:277-296) (MED)
- [P3] Nav is an inline Layout array again — drift-prone shape OLD retired into navConfig.jsx (:49-63); no shared module, no synonyms vocabulary — fix: extract navConfig (MED)
- [P3] BottomNav: Releases tab dropped for Chat; sm:hidden→lg:hidden (640→1024px) (OLD BottomNav.jsx:5-26 / NEW :12-23) (MED)
- [P3] Boom Billing copy-address footer button missing (OLD Layout.jsx:766-789; NEW labels.invoice_settings could source it) (LOW)
- [P3] Vendor Form copy link moved to footer + isApprover-gated (OLD ungated in nav, Layout.jsx:742-762 / NEW :381-393) (LOW)
- [P3] external:true nav-item support absent (OLD navConfig.jsx:240, Layout.jsx:728-731) (LOW)
- [INT] Workspace logo/name/tagline + "Powered by Cadence" footer (branding); Messages/Team Work/Brand/Marketing/Requests nav items + chat-unread badge are NEW features; badge endpoint label-scoped /ledger/pending-count, approver-gated.

## g-topbar-header
- [P2] Impersonation "Viewing as {name} ({role} · {dept})" banner removed — only the Exit pill remains (OLD Layout.jsx:820-834 / NEW Layout.jsx:421-425,:455) — fix: cadence Layout.jsx:426 restore banner (HIGH)
- [P3] Keyboard-shortcuts header button missing; ? hotkey is the only entry to the modal (OLD :857-866 / NEW :174,:491) — fix: Layout.jsx:446 (HIGH)
- [P3] Header Request quick-compose (button + RequestModal + EmailPreviewModal, current-page context, impersonation-suppressed) removed; /requests nav page covers capability not affordance (OLD :887-900,:100-264) — fix: header button → requests composer (MED)
- [P3] Manual opens in-app modal vs new-tab /manual page (OLD :869 / NEW :447,:492; content in manual.md) (LOW)
- [P3] Theme toggle lost aria-label (OLD :882 / NEW :456-462) — fix: Layout.jsx:458 (HIGH)
- [P3] Control order/composition changed (search-input·bell·viewAs·shortcuts·manual·theme·request → title·search-btn·manual·bell·viewAs·theme) (OLD :843-901 / NEW :428-463) (LOW)
- [INT] Demo-mode is_test banner dropped (test users scoped out); platform announcements banner stack + dismiss (NEW :196-202,:466-481); ViewAs empty state; page-title h1 + g-nav hotkeys + ErrorBoundary are NEW additions. Search-trigger defect counted under g-global-search; pageview ping under missing--analytics.

## g-global-search
- [P1] Page-palette search missing (NAV_PAGES+synonyms local match, canView-before-rank, top 6, renders during server flight) (OLD GlobalSearch.jsx:117-144,:295-313 + lib/pageSearch.js:21-49) — fix: port pageSearch + synonyms navConfig into cadence GlobalSearch.jsx (HIGH)
- [P1] Vendors + ledger-entry search missing client+server (alias-aware vendors → vendor page; leaf-only invoice#/payee/description entries → /ledger?q=; fail-closed bk gate) (OLD server/routes/search.js:17-32,:103-156; GlobalSearch.jsx:315-361) — fix: cadence server/routes/search.js + GROUPS (HIGH)
- [P2] Persistent header input w/ anchored dropdown → button-opened centered modal; always-visible type-to-search affordance lost (OLD GlobalSearch.jsx:202-233 / NEW :62-83 + Layout.jsx:437-445) (MED)
- [P2] Recent searches (8, typed, dedup, Clear) missing (OLD :29-34,:146-168,:252-274) (HIGH)
- [P2] Category filter pills missing (OLD :18-27,:122-132,:236-250) (HIGH)
- [P2] `/` focus shortcut missing (OLD :98-105 / NEW Layout.jsx:172 ⌘K only) — fix: Layout.jsx:172 (HIGH)
- [P2] Archived releases leak into results — no status filter (OLD search.js:64 archived=false / NEW search.js:21-29; cf. NEW notifications.js:32) — fix: search.js:26 add r.status != 'Archived' (HIGH)
- [P2] Artist hit navigates to /artists list not /artists/:id profile (OLD :175 / NEW :10) (HIGH)
- [P3] Row anatomy losses: release type-chip+date, artist avatar+total_releases, contract status badge, deal genre (OLD :377-464 / NEW :8-13,:104-116 + server selects) (HIGH)
- [P3] Ordering drift: artists total_releases DESC→name, contracts expiration ASC→updated_at DESC (OLD search.js:79,:89 / NEW :32,:41) (MED)
- [P3] Debounce 300→220ms, group counts dropped, loading text hides fetched groups, empty-state copy (MED)
- [INT] Label-scoped queries + ILIKE (tenancy); NEW-only keyboard navigation (arrows/Enter/active row) is an addition to keep.

## g-notification-bell
- [P1] Personal reminders absent end-to-end (no table/routes/UI; OLD reminders.js + notifications.js:349-358 + NotificationBell.jsx:154-167,:251-273 Done-advances-cadence, clear-all-exempt) — fix: port reminders label-scoped + bell section (HIGH)
- [P1] Five smart-alert kinds missing: budget ≥80% + budget_burn, contract_renewal (expiry × unreleased), release_behind escalation, release_unassigned, payment_rush (OLD notifications.js:59-78,:83-155,:184-244) — fix: cadence server/routes/notifications.js (HIGH)
- [P2] Task alerts narrowed to caller's own; OLD alerts on ANY user's overdue task w/ assignee name (OLD :157-182 / NEW notifications.js:44-52) — respect teamFilter on port (HIGH)
- [P2] Approval alerts deep-link to /ledger though /approvals exists (NEW notifications.js:110 vs Layout.jsx:280; OLD → /bk/approvals NotificationBell.jsx:402); vendor submissions folded into all-pending kind, amounts/section lost (OLD :246-262,:390-418 / NEW :74-81) (HIGH)
- [P2] Per-type notification preferences (gear, 6 toggles, default-ON merge) missing (OLD NotificationBell.jsx:40-63,:219-237) (HIGH)
- [P2] Contract expiry alerts narrowed Approver→Admin, 90→60d window (OLD notifications.js:42-57 / NEW :63-73) — fix: notifications.js:63 (HIGH)
- [P2] Dropdown info loss: grouped sections→flat list; days-until tiers, completion %, ExpiryBadge, sentence titles, severity sort, mention room-title all gone; w-96→w-80 (OLD NotificationBell.jsx:239-448 / NEW :81-109) (HIGH)
- [P3] bulk-deal stall logic downgraded: delivery-aware 30d model → any unpaid ≥21d (OLD notifications.js:264-327 / NEW :53-61) — counted with missing--bulk-deals' bulk_deal_stalled fix (HIGH)
- [P3] Clear-all: client count-watermark → server created_at watermark; old-but-worsening alerts stay cleared (OLD NotificationBell.jsx:104-123 / NEW notifications.js:23-24,:149-158; NEW arguably better) (LOW)
- [P3] Badge red-500 → brand-600 — alert-red semantic lost, not an RC-2 case (OLD :186 / NEW :69) — fix: danger token (HIGH)
- [P3] Poll 5→2min, release window 14→21d, severity taxonomy + sort dropped, deep-link remaps (releases/contracts/tasks) (MED)
- [INT] Label-scoping throughout; read_at schema; socket mention refresh + refetch-on-open; "View all" footer + /notifications page are NEW additions; {id} vs {ids[]} mark-read shape.

## g-toasts
- [P2] Undo-action toasts lost — no action slot in NEW ToastContext, OLD's toast-undo (Undo btn, 5s window, timer-clear guard) unportable (OLD BkLedger.jsx:1733-1739,:3046-3061 / NEW Ledger.jsx:547-552 static bar) — fix: cadence ToastContext.jsx:15 add {action,duration} opts (HIGH)
- [P2] Toast visual identity: solid color-coded + slide-in + max-w-[400px] → neutral bg-card, colored icon only, no animation, no max-width (OLD ToastContext.jsx:6-10,:46 + index.css:315-320 / NEW ToastContext.jsx:28-33) — fix: ToastContext.jsx:28 (MED)
- [P3] Duration/variant loss: fixed 4000ms vs 3000/5000/persistent; info variant dropped, unknown types render success icon (OLD :15-31 / NEW :15-19,:30-32) — fix: ToastContext.jsx:15 (HIGH)
- [P3] Mobile toasts overlay BottomNav, no safe-area (OLD BkLedger.jsx:3048-3049 bottom-20+safe-area / NEW ToastContext.jsx:24 bottom-6 z-[100] over BottomNav z-30) — fix: ToastContext.jsx:24 (HIGH)
- [P3] Container drops pointer-events-none — clicks between stacked toasts swallowed (OLD :39,:46 / NEW :24) (LOW)
- [INT] NEW unified all feedback into one context: 58 files/461 calls, 0 alert() vs OLD's 3 parallel systems + ~217 alert()/116 confirm() sites — improvement, kept.

## g-modal-overlay-primitives
- [P2] Kit adoption gap: 21 page + ~16 component sites still hand-roll fixed inset-0 overlays (no Escape in 8/11 sampled pages, no trap/lock/portal) while ui/Modal is drop-in; kit width ladder caps at max-w-2xl blocking the 4xl/5xl dialogs — fix: extend Modal.jsx:16 WIDTHS + migrate (start Ledger.jsx ×4, ArtistCampaignDetail.jsx ×4) (HIGH)
- [P3] 37 window.confirm sites remain vs ConfirmDialog w/ only 3 adopters (WorkspaceDrawer.jsx ×3, PendingContracts.jsx ×2, Ledger.jsx ×2 …) — fix: swap to ui/ConfirmDialog (MED)
- [P3] backdrop-blur-sm dropped: OLD PendingContracts.jsx:76, Settings.jsx:1841, Releases/AddReleaseModal.jsx:40 blur; NEW zero — fix: NEW equivalents (HIGH)
- [P3] Backdrop dim drift: OLD dominant bg-black/40 (×10) → NEW uniform bg-overlay ~50% (Modal.jsx:35) — uniformity likely the corrected form (LOW)
- [P3] Dialog anatomy drift: backdrop p-6→p-4, panel p-6→p-5, h3→h2+always-X, forced max-h-[90vh] internal scroll (OLD Duplicates exemplar / NEW Modal.jsx:35-54) (MED)
- [P3] NEW implicit z ladder z-50…z-[80] across hand-rolled sites; two z-50 dialogs would stack under kit Modal z-[60] if concurrent (LOW; UNVERIFIED — needs runtime check)
- [INT] Kit architecture (portal/focus trap/Escape stack/scroll lock/aria) + ConfirmDialog focus-on-Cancel & busy state — NEW-only improvements, keep.

## g-error-404-loading
- [P3] Detail-page loading regressed to bare gray "Loading…" text (ArtistProfile.jsx:124, ReleaseDetail.jsx:92, ArtistCampaignDetail.jsx:62; ~25 sites) vs OLD spinner+caption/skeletons (OLD ArtistProfile.jsx:94-100) — fix: Skeleton.PageHeader/Block per NEW's own BankStatements.jsx:208 convention (HIGH)
- [P3] Skeleton.ArtistProfile composite dropped from kit (OLD Skeleton.jsx:128-151 / NEW :88) — fix: port + use at ArtistProfile.jsx:124 (HIGH)
- [P3] In-button busy spinners mostly dropped: OLD 157 animate-spin sites/51 Loader files → NEW 6; busy = label swap only — fix: Loader2 spin in Button busy path (MED)
- [P3] path="*" silently redirects to dashboard, no not-found feedback (NEW App.jsx:130,:194; OLD has no catch-all at all — blank shell) — fix: minimal NotFound card (LOW)
- [INT] NEW-only kept: ErrorBoundary root + per-route keyed + sourcemap logging + hard-reload (main.jsx:35, Layout.jsx:483, PlatformLayout.jsx:132); vite:preloadError one-shot reload (main.jsx:20-27); Retry-banner pattern on 5 surfaces vs OLD 2.

## g-empty-states
- [P3] Ledger collapses truly-empty vs filtered-empty into "No entries match." (Ledger.jsx:429) vs OLD filter-aware copy (BkLedger.jsx:2905,:3720) — fix: branch raw vs filtered like Releases.jsx:154/:186 (HIGH)
- [P3] Payments "All caught up. 🎉" gates on post-filter shown — active quick filter/search reads as caught-up (Payments.jsx:268-269) vs OLD "No payments match the current filters." (BkPayments.jsx:2923) — fix: branch raw vs filtered (HIGH)
- [P3] Calendar empty copy gone ("No events this day"/"Nothing upcoming", OLD Calendar.jsx:298,:330; NEW zero empty strings) — subsumed by missing day-panel/upcoming rail, see calendar.md (LOW)
- [P3] Dashboard chart filtered-empty "No releases match these filters" lost (OLD Dashboard.jsx:630-635 / NEW Dashboard.jsx:134,:156) — cross-ref dashboard.md (MED)
- [INT] NEW standardized icon-card empty block on the 5 majors; Releases + TaskSurface truly-vs-filtered split w/ Clear-filters CTA (TaskSurface.jsx:293-311); Deals `n` CTA; Messages empties (no OLD counterpart) — improvements, keep.

## g-keyboard-shortcuts
- [P2] Releases list hotkeys gone: n new / v view toggle / j-k focus / Enter expand (OLD Releases/index.jsx:149-165; NEW Releases.jsx zero hotkeys, toggle target :35,:147) — fix: Releases.jsx useHotkeys (HIGH)
- [P2] Ledger c columns-panel + x export unwired though both targets exist (OLD BkLedger.jsx:1426-1433 / NEW Ledger.jsx:151,:270,:365; handler :216-224 has only z) — fix: Ledger.jsx:220 + shortcuts.js (HIGH)
- [P2] Calendar ←/→ month, t today, n new event gone (OLD Calendar.jsx:123-128) — fix: cadence Calendar.jsx useHotkeys (HIGH)
- [P2] Create Invoice ⌘Enter/⌘⇧L/⌘P gone; NEW useHotkeys bails on all meta so combos are inexpressible (OLD CreateInvoice.jsx:258-265 / NEW useHotkeys.js:24) — fix: raw listener or port OLD meta/shift support (useHotkeys.js:40-48) (HIGH)
- [P2] Bank deck lost Backspace back, f flag, n no-invoice, p preview, ↓ dismiss (OLD BkBankMatching.jsx:1713-1717 / NEW StatementReviewDeck.jsx:120-135) — fix: deck features + keys; count with bank-matching.md (MED)
- [P3] Minor-page hotkeys dropped: Catalog s+1-6 (Catalog.jsx:75-78), Dashboard r (:346), Settings n (:628), Contracts n (:129), Activity s (ActivityHistory.jsx:245) — fix: one useHotkeys each (HIGH)
- [P3] Deck suites absent with surfaces: Reports deck (Reports.jsx:853-874), Duplicates deck (:1485-1497), VendorDupeDeck (:128-146), VendorFlags queue (BkVendorFlags.jsx:136-143) — counted with reports/flags-data-quality/vendors audits (HIGH)
- [P3] Help registry omits wired Approvals j/k/a/r/⇧A (Approvals.jsx:126-138 vs shortcuts.js) — fix: add Approvals group to constants/shortcuts.js (HIGH)
- [P3] "/" focus-search — dup of g-global-search #6, not re-counted (HIGH)
- [INT] g-nav sequences (Layout.jsx:175-180), Deals/ReleaseDetail Esc, TaskSurface n/f/z/g/1-5 suite, registry-driven help + manual, escape-stack Esc, x-export token URL unportable post-hardening.

## g-mobile-shell
- [P2] Edge-swipe sidebar gone (OLD Layout.jsx:397-412; NEW Layout has no touch handlers) — fix: port listeners into cadence Layout.jsx ~:194 (HIGH)
- [P2] Universal touch-target rule lost: OLD button,a{min-height:36px}@768 (index.css:192) vs NEW only .btn-*/.input 40px (index.css:79-80) — raw icon buttons sub-36px — fix: index.css:78 (HIGH)
- [P2] Mobile FilterSheet pattern gone on Ledger+Payments (OLD mobile/FilterSheet.jsx; BkLedger.jsx:2936-3026, BkPayments.jsx:3008-3044) — fix: port sheet into Ledger.jsx:430 / Payments.jsx:270 branches (HIGH)
- [P2] Payments mobile cards have no detail tap-through (OLD PaymentSheet BkPayments.jsx:2926,:3047 / NEW Payments.jsx:270+ quick actions only) — fix: sheet or drawer on tap (HIGH)
- [P2] App-wide mobile CSS layer missing: grid collapse, table shrink+mask, modal caps, h1 downscale, press feedback, print (OLD index.css:131-302 / NEW :69-83) — non-carded pages render desktop layouts on phones — fix: port 768/480/coarse blocks (HIGH; outcomes UNVERIFIED — needs runtime check)
- [P3] Releases tab dropped from BottomNav for Chat (OLD BottomNav.jsx:8 / NEW :13-18) + stale comment NEW BottomNav.jsx:5-6; CLAUDE.md's "Chat tab unread badge" claim is false (no badge prop, Layout.jsx:493) (MED)
- [P3] FAB "New task" deep-link lost: /my-work?new=task auto-open (OLD FAB.jsx:23, MyWork.jsx:275-281 / NEW Fab.jsx:14, no ?new handling) — fix: TaskSurface param (HIGH)
- [P3] Approvals mobile pass gone (OLD BkApprovals.jsx:131,:726-784,:1943-2060 / NEW none) (HIGH)
- [P3] Deal kanban snap-scroll lost; NEW .snap-x-mandatory (index.css:74) has zero consumers (OLD index.css:246-260 / NEW Deals.jsx:108 stacks) — fix: apply helper to Deals board (MED)
- [P3] FAB backdrop dim dropped (OLD FAB.jsx:41 bg-black/20 / NEW Fab.jsx:27 transparent) (HIGH)
- [P3] Bottom chrome breakpoint 640→1024px: NEW tablets get phone chrome (OLD BottomNav.jsx:26 sm:hidden / NEW :23 lg:hidden) — NEW self-consistent, possibly deliberate (LOW)
- [INT] Chat tab (NEW-only messaging), Finance-tab canView fallback, tokenized surfaces, escape-stack BottomSheet, mywork mobile suite; OLD PullToRefresh/LongPressMenu dead in OLD (zero consumers) — no parity obligation.

## g-theme-dark-mode
- [P2] Dark gray-50==gray-100 (#1f222c on card #1c1f2b, tokens.css:105-106 vs :80) kills 74 hover:bg-gray-50 + 107 bg-gray-100 sites; OLD compensates via .dark hover:bg-gray-100→#2a2e3c (boom index.css:363) — fix: split tiers in tokens.css:105-106 (HIGH)
- [P2] 58 bg-brand-50/100 sites near-white in dark; 3 bulk bars w/ ink text ≈1.14:1 (Payments.jsx:249, BankMatching.jsx:209, BankStatements.jsx:290) — fix: bg-brand-500/10 pattern from mywork pass (HIGH)
- [P2] 213 raw colored -50/-100 tint sites in 59 files, no dark remap (only gray/brand var-backed) vs OLD alpha-wash layer (boom index.css:388-440) — fix: var-backed status tints or minimal .dark remap; per-site impact UNVERIFIED — needs runtime check (MED)
- [P2] Recharts dark: default white Tooltip + unset tick fills (Dashboard.jsx:119,:131, Financials.jsx:136,:154, Payments.jsx:484) vs OLD tokenized CustomTooltip + #9CA3AF ticks (boom Dashboard.jsx:180-193,:616-624) — fix: shared bg-card tooltip + var tick fill (HIGH)
- [P3] Settings Theme tab missing (OLD Settings.jsx:1515-1558; NEW header pill only, Layout.jsx:456-461) (HIGH)
- [P3] Dark scrollbar absent (OLD index.css:538-540) — counted with 01-design-system scrollbar P2; include .dark variants in that fix (HIGH)
- [INT] Tokens-only dark architecture (0 dark: variants vs 39; no !important layer — deliberate), identical dark palette values OLD↔NEW, brand-ink 600→400 flip + heavier bg-selected, FOUC guard parity (both main.jsx) + accent pre-apply, no prefers-color-scheme default on either side, localStorage 'theme' parity, PlatformLayout toggle (operator-only surface).

## g-email-preview-modal
- [P1] EmailPreviewModal never renders: requires `open` (EmailPreviewModal.jsx:14,:41) but both consumers omit it (Approvals.jsx:309, Payments.jsx:395); approve/reject pass notify:false expecting the modal (Approvals.jsx:47,:58) → vendor decision emails, payment confirmations + /mark-sent, and Send-for-Approval all silently dead — fix: pass open (HIGH)
- [P2] Invite/welcome emails send with no preview; dispatch 'welcome' kind orphaned (OLD Settings.jsx:766 / NEW team.js:91,:119 direct) (HIGH)
- [P2] Task-assignment emails direct-send, 'task_assigned' kind orphaned (OLD MyWork.jsx:1684, Team.jsx:932 / NEW tasks.js:152) (HIGH)
- [P2] Payment confirmations lost invoice/proof attachments (OLD emailDispatch.js:83-100,:339-368; NEW ctx none + generic route strips, email.js:20) — fix: attachment-bearing feature route + onCustomSend like ledger.js:716 (HIGH)
- [P3] Bulk confirmations: one-per-vendor family-rooted table (OLD loadFamilyRoots :25-53) → N separate per-row emails (NEW emailDispatch.js:34, Payments.jsx:176-196) (HIGH)
- [P3] Modal losses: editable-body html_override client affordance (server supports it, emailDispatch.js:88), Personal-Note live re-render (note slot hardcoded '', Payments.jsx:144), pre-rendered mode, title/subtitle; CcChipInput autocomplete → native datalist (MED)
- [P3] Ledger auto-paths send preview-less (pay-with-proof/mark-paid/drawer notify default, ledger.js:432,:457,:499,:1582,:1604) (MED)
- [INT] test_invitation dropped (test users out of scope) / approval_request added; safeCtx attachment-strip + tenant identity injection; per-label from/reply-to/accent; transactional direct sends (password reset, chat mention, operator invites); fixed platform inbox for internal requests; CcChipInput on public vendor form.

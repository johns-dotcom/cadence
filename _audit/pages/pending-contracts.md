# Pending Contracts

OLD: `boom-dashboard/client/src/pages/PendingContracts.jsx` (333 lines) + `boom-dashboard/server/routes/pending-contracts.js` (120 lines) + seed data `boom-dashboard/server/data/pending-contracts.js` (47 rows, auto-seeded by `server/index.js:1181-1195`) + one-time script `server/seed-pending.js`
NEW: `cadence/client/src/pages/PendingContracts.jsx` (115 lines) + `cadence/server/routes/pending-contracts.js` (77 lines)

Design-system-level diffs (font, accent default, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported here. RC-1 (Inter), RC-2 (boom red → brand accent on the Add button), RC-5 (taller inputs), RC-6 (rounder cards) all apply.

**Scale of the gap up front:** this is not a thinned-down port — it is a **different feature wearing the same page name**. OLD tracks *artist signing negotiations*: a 12-field deal-terms record per artist (legal name, address, cash/marketing, split, term, options, back signs, futures, email, notes) rendered as expandable rows with a full add/edit modal, search, stat cards, and a status-filter segment. NEW tracks *generic contracts awaiting signature*: a 6-field row (counterparty, type, status, sent_date, due_date, notes) in a flat table with an inline create form and a status dropdown. None of OLD's deal-term fields exist anywhere in NEW (client, route, or schema — grep verified: `cash|back_signs|futures|legal_name` have zero hits in cadence). OLD records cannot be represented in NEW's schema.

## 1. Layout & structure

**OLD** (`PendingContracts.jsx:242-331`): centered `max-w-5xl px-6 py-8` page → PageHeader (title + live "{N} artists in pipeline" subtitle + refresh icon-button + "Add Artist" boom button, :245-257) → 4 stat cards (`grid-cols-4`, Total/Sent/Not Sent/Signed, text-3xl values, :260-272) → search box + segmented status filter with per-status counts (All/Sent/Not Sent/Signed/Declined, :275-292) → vertical stack (`space-y-2`) of expandable `ArtistRow` cards (:305-315) → "{filtered} of {total} artists" footer (:318) → add/edit `ContractModal` overlays (:320-330).

**NEW** (`PendingContracts.jsx:54-113`): PageHeader (title + static subtitle + one "Add" btn-primary, :56-60) → optional inline create-form card (`grid-cols-2 sm:grid-cols-3`, :62-71) → flat table in a card (Counterparty/Type/Due/Status/actions, :78-111) or empty-state card (:76). No stats, no search, no filter, no expandable detail, no footer count, no modal.

Structural deltas: stat cards row, search+filter bar, expandable row detail, count footer, and the add/edit modal are all absent in NEW. NEW adds a signed-row "Activate" promote action OLD never had (:102-104, documented M4 Pending→Active promotion).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page width | own `max-w-5xl mx-auto px-6 py-8` container | none (Layout's max-w-7xl) | OLD :243 / NEW :55 |
| Status badge | dot+pill: `px-2.5 py-1 rounded-full text-xs ring-1` + 1.5px dot; Sent emerald / Not Sent gray / Signed blue / Declined red | borderless `<select>` styled as pill, `text-[10px] font-semibold`; Not Sent gray / **Sent amber** / In Review blue / **Signed emerald** | OLD :6-21 / NEW :10-13,96-99 |
| Stat cards | 4-up `rounded-xl border p-4`, `text-3xl font-bold`, values tinted gray-900/emerald-600/amber-500/blue-600 | absent | OLD :260-272 |
| Row anatomy | expandable card: chevron (rotates 180°), 176px artist column w/ legal-name subline, deal-term pill row (split slate / years rose / futures sky / cash emerald `text-xs rounded-md`), badge + hover edit pencil | plain `<tr>` w/ hover:bg-gray-50, 5 cells | OLD :137-169 / NEW :91-107 |
| Add button | `bg-boom` + Plus icon, "Add Artist" | `.btn-primary` + Plus size 16, "Add" | OLD :252-255 / NEW :59 (RC-2/RC-5) |
| Refresh button | bordered icon button, RefreshCw w-4 | absent | OLD :249-251 |
| Loading state | centered `RefreshCw animate-spin` + "Loading…" py-24 | bare `text-sm text-gray-400` "Loading…" line | OLD :295-298 / NEW :74 |
| Empty state | FileText w-8 opacity-50 + "No artists found", py-24, no card | card p-10 w/ FileClock size 26 + "No pending contracts." | OLD :299-303 / NEW :76 |
| Status-pill colors in dark | OLD relies on `.dark .badge-*`-style overrides for its raw tints (index.css:483-486 pattern) | NEW uses raw `bg-amber-100/red-... -100` utilities with no dark override | dark rendering `UNVERIFIED — needs runtime check` |
| Modal | `fixed inset-0 bg-overlay backdrop-blur-sm`, `max-w-xl rounded-2xl` two-column form | no modal at all (inline form card) | OLD :76-113 / NEW :62-71 |

## 3. Copy & content differences

| Item | OLD | NEW |
|---|---|---|
| Subtitle | `"{N} artists in pipeline"` (live count, :247) | `"Agreements awaiting signature"` (static, :58) |
| Primary action | "Add Artist" (:254) | "Add" (:59) |
| Status vocabulary | Sent / Not Sent / Signed / **Declined** (:6-11) | Not Sent / Sent / **In Review** / Signed (:9) |
| Delete confirm | `Remove {artist_name}?` (:123) | `Delete this pending contract?` (:36) |
| Quick-status label | "Move to:" + pill buttons (:185-191) | none (select handles it) |
| Footer | `{filtered} of {total} artists` (:318) | none |
| Empty state | "No artists found" (:302) | "No pending contracts." (:76) |
| Form placeholders | "Stage name", "Full legal name", "manager@email.com", "Full address", "e.g. 20k marketing", "e.g. 50/50", "e.g. perp or 10 years", "e.g. first rights, matching rights", "Back catalog tracks", "e.g. 5 futures, album", "Additional notes" (:84-101) | none — bare labeled inputs (:64-68) |
| Required-field error | "Artist name is required" inline red text (:46,104) | toast "Counterparty is required" (:28) |

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **The entire deal-terms record**: `legal_name` ("Legal Name / Company"), `email`, `address`, `cash` ("Cash / Marketing"), `split`, `years` ("Term / Years"), `options`, `back_signs` (textarea), `futures` — no NEW equivalent in UI, route, or schema (OLD :23-26,:84-101; NEW schema `cadence server/index.js:1244-1256`).
- **ContractModal add/edit** (:38-115) — NEW has create-only inline form; **no edit affordance at all**: once a row exists, only `status` can be changed from the UI (:96-99). PATCH supports 6 fields (`cadence server/routes/pending-contracts.js:10`) but nothing in the client calls it for anything except status.
- **ArtistRow expandable detail** (:117-201): chevron expand, `Field` renderer that hides empty fields (:28-36), Options/Futures/Email/Back Signs/Address/Notes grid, "Move to:" quick-status pill row excluding the current status (:184-192), per-row Remove with in-flight disable (:193-196).
- **Search** across artist_name / legal_name / email / back_signs (:223-229) — no search input in NEW.
- **Status filter segment** with live per-status counts incl. Declined (:234-240,:282-291).
- **Stat cards** Total/Sent/Not Sent/Signed (:260-272).
- **Refresh button** (:249-251).
- **"Declined" status** — dropped from the vocabulary; a legacy row imported with status `Declined` would render with the Not-Sent fallback style (NEW :97) and its status is not selectable.
- **Optimistic local state updates** — OLD splices the saved/deleted/updated row into state (:311-312,:322,:327); NEW refetches the whole list after every mutation (:29,33,37).

### Features in NEW not in OLD
- **Promote to active contract** ("Activate" on Signed rows): creates a real `contracts` row (`type`, `status:'Active'`, `date_signed: localDateStr()`, counterparty+notes folded into notes) then deletes the pending row (:40-52,:102-104). Documented post-spec M4 feature — additive, not a defect.
- **Type select** fed by `CONTRACT_TYPES` (`constants.js:56`) and **sent_date/due_date date fields** (:65-68) — NEW-only concepts.
- Toast feedback on all mutations (:28-37) and `logActivity` on create (`server/routes/pending-contracts.js:36`).

### Interaction/UX differences
- Status change: OLD = expand row → "Move to:" buttons (or edit modal); NEW = always-visible select per row. Different affordance; NEW's is one-click but unstyled per-option.
- Create: OLD modal validates then closes on success only, error shown inline and modal stays open (:45-57,:104); NEW inline form; on failure a toast fires and the form stays (parity-adequate).
- Row click: OLD toggles detail; NEW rows are inert (nothing to expand).
- Fetch errors: OLD `console.error` w/ loading cleared (:217); NEW `.catch(() => {})` — silently renders the empty state (:23).

## 5. Data layer differences

| Aspect | OLD (`server/routes/pending-contracts.js`) | NEW (`cadence server/routes/pending-contracts.js`) | Δ |
|---|---|---|---|
| Gate | `requirePagePermission('/contracts','/pending-contracts','/renewals','/contracts/create')` — admin/Approver pass; plain Users pass with an explicit page grant (:11-14) | `requireApprover` — plain Users blocked outright even with page permission (:8) | stricter; auth-model divergence, treated as intentional |
| Tenancy | none (single-tenant) | `withTenant` + `label_id` on every query (:8,16,34,54,68) | intentional |
| GET / | `?status=` + `?search=` (ILIKE artist_name/legal_name) SQL filters, `ORDER BY created_at DESC` (:20-43) | no query params, same ordering (:13-24) | params dropped (OLD client filtered client-side, so no NEW consumer lost — API parity only) |
| GET /:id | present (:46-55) | **absent** | dropped |
| Create | 12 deal-term columns, requires `artist_name` (:58-75) | 6 columns + `created_by`, requires trimmed `counterparty`, `logActivity` (:27-42) | different record type |
| Update | `PUT` full-replace, COALESCE only on artist_name/status — **clears omitted fields** (:78-106) | `PATCH` dynamic allow-list (`UPDATABLE`, :10,45-63), `''→null`, 404 on cross-tenant | verb + semantics changed; client matches its own API |
| Delete | plain delete (:109-118) | tenant-scoped delete (:66-75) | parity |
| Schema | `artist_name NOT NULL, legal_name, address, cash, split, years, options, back_signs, futures, status DEF 'Not Sent', email, notes` (`boom server/index.js:1162-1179`) | `label_id NOT NULL, counterparty NOT NULL, type, status DEF 'Not Sent', sent_date, due_date, notes, created_by` + label index (`cadence server/index.js:1244-1258`) | incompatible shapes |
| Seed data | 47-row real-deal dataset auto-seeded when empty (`server/data/pending-contracts.js`; `index.js:1181-1195`) + rerunnable `seed-pending.js`; the old unauthenticated `/seed` endpoint was already removed in OLD (route comment :16-18) | none | intentional — seeding Boom's counterparty PII into every tenant would be a data leak |

## 6. Tables & forms

**OLD form (ContractModal, :83-102)** — 2-col grid: Artist Name* (wide) · Legal Name / Company · Email · Address textarea (wide) · Cash / Marketing · Split · Term / Years · Status select · Options (wide) · Back Signs textarea rows=3 (wide) · Futures · Notes textarea (wide). Save button "Saving…/Save/Add" with disable; inline error line.
**NEW form (:63-70)** — 3-col grid: Counterparty · Type select (CONTRACT_TYPES + "—") · Status select · Sent date · Due date · Save. **`notes` exists in `BLANK` (:14) and in the server allow-list but has no input — dead field, unenterable from the UI.**

**OLD list** is not a table (stacked expandable cards). **NEW table (:79-110)**: Counterparty / Type / Due / Status / (actions). Due renders via `new Date(r.due_date).toLocaleDateString()` (:94) — UTC-midnight parse shifts the day west of UTC; NEW's own `utils/dates.js formatDate` (:7-21) exists to prevent exactly this and is unused here.

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

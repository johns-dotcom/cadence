# Calendar

OLD: `boom-dashboard/client/src/pages/Calendar.jsx` + `boom-dashboard/server/routes/calendar.js`
NEW: `cadence/client/src/pages/Calendar.jsx` + `cadence/server/routes/calendar.js`

Design-system-level diffs (font, accent default, paddings, radii) are covered by RC-1..RC-6 in `_audit/01-design-system.md` and not re-reported here.

## 1. Layout & structure

**OLD** (Calendar.jsx:175-375): page = header row (title + "N events" count + Add Event button) → optional inline Add-Event form card (:191-210) → filter chip row (:213-225) → `grid grid-cols-1 xl:grid-cols-4` with the month grid card spanning 3 cols (:229-285) and a right sidebar column (:288-372) containing EITHER the selected-day event list OR the "Upcoming (14 days)" list, plus a separate Legend card (:360-371). Month nav (prev/next/Today) lives INSIDE the grid card's header bar (:231-238). Grid renders only as many week rows as the month needs (:99-112); leading/trailing slots are inert `bg-gray-50/50` nulls (:251). Skeleton state while loading (:166-173).

**NEW** (Calendar.jsx:70-161): page = `PageHeader` (title + static subtitle; Today + prev/next chevrons in the `action` slot, :72-84) → one combined legend/filter row that also holds the month label (:87-99) → a single full-width month-grid card (:102-139) → an add-event modal (:142-159). Always a fixed 42-cell (6-week) grid with adjacent-month days rendered dimmed (:45-50, :114). **No sidebar at all** — no selected-day panel, no Upcoming panel, no Legend card. No loading state (grid renders empty until fetch resolves).

Structural deltas: sidebar column removed entirely; month nav relocated from the grid card into the page header; Add Event moved from a header-button + inline form to a hover-revealed per-cell `+` opening a modal; month label moved from between the chevrons into the filter row.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page title | `text-2xl font-black` + live "{N} events" subtitle | `text-xl font-bold tracking-tight` + static subtitle (PageHeader) | OLD :180-181 / NEW :5 (PageHeader.jsx), Calendar.jsx:73-74 |
| Add Event button | header-level `bg-boom-600` pill w/ Plus 13 | none at header level; per-cell `opacity-0 group-hover:opacity-100` Plus 13 | OLD :184-186 / NEW :117-119 |
| Filter chips | `text-xs font-semibold px-3 py-1.5`; inactive = `bg-gray-50 text-gray-300` + dot `opacity-30` | `text-xs font-medium px-2.5 py-1`; inactive = `text-gray-400 opacity-60` (whole chip dimmed), no bg swap | OLD :216-222 / NEW :93-96 |
| Month label | `text-sm font-bold w-36 text-center` between chevrons | `text-base font-semibold min-w-[150px]` at left of filter row | OLD :234 / NEW :88 |
| Chevrons | size 18, standalone p-1 hover:bg-gray-100 | size 16, joined pair in a bordered pill | OLD :233-235 / NEW :78-81 |
| Today button | text link inside grid header | `.btn-secondary` in PageHeader (RC-5 height) | OLD :237 / NEW :77 |
| Day-header row | `text-[10px] font-bold tracking-wider` | `text-[10px] font-semibold tracking-widest` + px-2 | OLD :243 / NEW :105 |
| Day cell | `min-h-[100px]`, whole cell is a `<button>`, `border-r border-gray-50`, hover:bg-gray-50, selected = `bg-boom-50` | `min-h-[104px]` non-interactive `<div>`, `border-b border-r border-divider` | OLD :258-262 / NEW :114 |
| Day number | `w-6 h-6 text-xs font-bold` circle; today = filled boom-600; **past days `text-gray-300`** | `w-5 h-5 text-xs font-medium`; today = filled brand-600; no past-day dimming; out-of-month = gray-300 | OLD :263-266 / NEW :116 |
| Out-of-month slots | empty `bg-gray-50/50` cells | real adjacent-month days on `bg-page/50` with events shown | OLD :251 / NEW :114 |
| Event chip | `bg+border` tinted box (`bg-blue-50 border-blue-200` etc.), text-[10px] font-medium, no dot | `bg` tint + leading color dot, text-[10px] font-medium, `hover:brightness-95`, clickable | OLD :271-273 / NEW :123-131 |
| Chips per day before "+N more" | 3 | 4 | OLD :268,276 / NEW :122,133 |
| Type colors | release=blue, deadline/task=amber, expiry=red, signed=emerald, dsp_live=purple, dsp_submitted=indigo, manual=gray | release=brand, task=amber, expiry=red, signed=emerald, dsp=blue, event=violet | OLD :8-16 / NEW :11-16. release blue→brand is RC-2-adjacent; dsp purple→blue and manual gray→violet are plain remaps |
| Event icons | per-type lucide icons (Music/FileText/CheckSquare/Disc3/CalendarIcon) rendered in sidebar cards | none anywhere | OLD :18-26, :303-307, :335-343 / NEW — |
| Legend card | separate card, dot + label per group | merged into filter chips | OLD :360-371 / NEW :87-99 |
| Grid card radius | `card` (rounded-xl in OLD system) | `rounded-xl` explicit (avoids RC-6's rounded-2xl `.card`) | NEW :102 |
| Loading | `Skeleton.PageHeader` + `Skeleton.Block h-96` | none | OLD :166-173 / NEW — |
| Dark-mode chip tints | OLD's raw `bg-*-50` washes are re-mapped by its `.dark !important` layer (01-design-system §Tokens row "Dark strategy") | NEW uses raw `bg-amber-50`/`bg-red-50`/... with no dark remap | NEW :11-16. Dark appearance REFUTED 2026-09-02 (Phase 10) — premise is inverted: `client/src/index.css:154-320` carries a bounded `.dark` remap layer covering red/rose/amber/orange/yellow/emerald/green/teal/sky/blue/indigo/violet/purple/pink at `-50`/`-100`, plus their `border-`/`ring-`/`hover:` variants, and pushes `-600/-700/-800` text to the `-400` tier. Specificity (0,2,0) beats the utility's (0,1,0), so no `!important` is needed. Raw tints DO remap in dark |

## 3. Copy & content differences

- Subtitle: OLD "{N} events" (live count, :181) → NEW "Releases, tasks, contract dates and events for this workspace" (:74).
- Filter labels: OLD "Releases / Tasks / Contracts / DSP / Events" (:41-47) → NEW "Releases / Tasks / Expiring / Signed / DSP live / Events" (:11-16). "Contracts" split into two chips; "DSP live" (with the dsp_submitted feed dropped, see §5).
- Event titles (server-composed): OLD release title = project name w/ artist as subtitle (:82-85 server); NEW = "Artist — Project" folded into title (server :60). OLD contract = "Artist — contract expires/signed" (:91,:98); NEW = "Expires: Artist Type" / "Signed: Artist Type" (:66,:69). OLD DSP = "Project — live on DSP" / "Project — submitted to DSP" (:109,:116); NEW = "Platform live: Project" (:72).
- Subtitle/meta lines (artist, "Assigned to X", release_type, priority) exist in OLD's payload (:83,:125-126 server) and sidebar (:310-311); NEW sends neither.
- Sidebar copy gone with the sidebar: "Upcoming (14 days)", "Nothing upcoming", "No events this day", weekday-long date heading, "Today/Tomorrow/Nd" badges (OLD :293-349).
- Add form: OLD placeholder "Description (optional)", buttons "Add"/"Cancel" (:202-206); NEW modal heading "New event · {date}", placeholder "Notes (optional)", button "Add event" (:146-155); NEW toasts "Title is required" / "Event added" (:58-61) where OLD validated silently (:134).
- Delete confirm: identical "Delete this event?" both sides (OLD :148 / NEW :65).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Selected-day panel**: OLD clicking any day cell selects it (toggle, :259) and the sidebar lists that day's events with icon, title, subtitle, meta and a per-event Trash2 delete for manual events (:289-325). NEW day cells are not clickable; no equivalent surface. The `description` of a manual event is consequently **unviewable** in NEW (only a `title` tooltip on the chip, :126).
- **Upcoming (14 days) panel**: OLD lists the next-14-days events (local-date windowed, :157-164) with "Today/Tomorrow/Nd" distance badges; clicking one jumps month + selects the day (:339-341). Absent in NEW.
- **Hotkeys ← → t n**: OLD wires prevMonth/nextMonth/goToday/openAddForm via `useHotkeys` (:123-128). NEW has none, though `cadence/client/src/hooks/useHotkeys.js` exists.
- **Header Add Event entry point + free date choice**: OLD's form has a user-pickable date input (:198-199). NEW's only trigger is the hover-revealed per-cell `+` (:117), which (a) fixes the date to that cell and (b) is `opacity-0` until `group-hover` — no reliable affordance on touch devices, where hover doesn't exist. STILL UNVERIFIED — needs a real touch device. Whether a first tap reveals an `opacity-0 group-hover` control on iOS cannot be established from source or from an SSR render whether a first tap reveals it on iOS, but there is no visible fallback either way.
- **Delete affordance**: OLD = explicit trash icon in the sidebar card (:313-318). NEW = clicking a manual event chip itself fires the delete confirm (`onEventClick`, :68) — view-click and destroy-click are the same gesture.
- **Legend** as a distinct card (:360-371) — merged into the filter chips in NEW.
- **Loading skeleton** (:166-173) — none in NEW; fetch errors are swallowed (`.catch(() => {})`, NEW :30) with no error state (OLD at least console.errors, :69).
- **Filter grouping**: OLD collapses 7 types into 5 groups — contract_expiry+contract_signed → "Contracts", dsp_live+dsp_submitted → "DSP" (:41-47, grouping logic :88). NEW has 6 flat kinds, contracts split into two chips (:10-17).

### Features in NEW not in OLD
- **Event chips navigate to source** (`link` → `/releases/:id`, `/my-work`, `/contracts`, `/renewals`; server :60-72, client :68,:127). OLD chips are inert.
- **`PATCH /api/calendar/:id`** edit endpoint (NEW server :106-125) — no client consumer; dead surface.
- **Per-cell quick-add** (date pre-filled from the hovered cell).
- **Adjacent-month days rendered with events** in the fixed 42-cell grid (:45-50).
- **Toast feedback** on add success/failure (:58-62).

### Interaction/UX differences
- Month state: OLD `month`/`year` ints (:57-58) vs NEW a `cursor` Date (:24) — equivalent.
- OLD "+N more" appears after 3 chips, NEW after 4 (OLD :268 / NEW :122).
- NEW modal closes on overlay click (:143); Enter in title submits (:150). OLD inline form submits via native form (:193). NEW modal is hand-rolled `fixed inset-0` — does not use NEW's `ui/Modal` (no focus trap / escape stack), and Escape does not close it. REFUTED 2026-09-02 (Phase 10) — the add-event modal is `Calendar.jsx:384` `<Modal open={!!addFor} …>`, so it is focus-trapped and on the escape stack via `ui/Modal.jsx:29`. Escape DOES close it (no keydown handler found in :142-159).
- NEW `Trash2` is imported but never rendered (:3) — dead import.

## 5. Data layer differences

- **Feed shape**: OLD `GET /api/calendar` → `{ events: [...] }`, items `{id, type, title, subtitle, date, meta, sourceId, deletable, color}` (old server :78-140). NEW → `{ success, data: [...] }`, items `{kind, id, title, date, link, eventId?, description?, color?}` (new server :58-78). `subtitle`/`meta`/`deletable` dropped; `link` added.
- **Sources — OLD union** (server :32-76, each wrapped in `safeQuery` :7-14 so one failed table degrades to an empty bucket): releases (all with a date), contracts (admin-gated: admin/superadmin/**approver**, :29-30; both expiry and signed dates), DSP (**both** `live_date` and `submitted_date` → two event types, :105-120), tasks (`t.user_id = $1` — **own tasks only** — and `status != 'Done'`, :61-70), manual `calendar_events` (:71-75). OLD normalizes dates server-side via `d()` → `toISOString().split('T')[0]` (:16-22).
- **Sources — NEW union** (server :16-56, all label-scoped — intentional): releases (adds `status != 'Archived'`, :21), tasks (`label_id` only — **no user filter** — and `status != 'Done'`, :24-27), manual events (:29-32), contracts signed / expiring split into two admin-gated queries (`['Superadmin','Admin']` only — **Approver excluded**, :15; expiring adds `c.status = 'Active'`, :45), DSP **live only** (:50-55) even though NEW's `dsp_submissions` has `submitted_date` (cadence server/index.js:1147). No `safeQuery` — any single failing query 500s the entire feed (:79-82).
- **Known OLD gap — deals**: OLD's feed queries no deals dates; NEW likewise has none. Matching the gap is **not a defect** (per audit rules).
- **Date serialization**: OLD converts to `YYYY-MM-DD` on the server via UTC `toISOString` (:16-22); NEW ships pg `DATE` objects through `res.json` (Date→toJSON→UTC ISO) and slices client-side (NEW client :38). Same UTC-shift characteristic on both sides — parity, no diff.
- **Schema**: NEW `calendar_events` adds `label_id` (intentional) but **drops `event_type`** (cadence index.js:1411-1420 vs boom index.js:951-960); OLD's feed passes `e.event_type || 'manual'` through (:132) and its POST accepts `event_type` (:150-156). NEW's POST accepts only title/event_date/description/color (:88-96).
- **Mutations**: POST — NEW trims title, 201 + `{success,data}`, `logActivity` (:86-103); OLD returns the raw row, no activity log (:148-163). DELETE — OLD deletes by id with **no ownership/tenancy check** (:166-173, single-tenant); NEW scopes to `label_id` + 404s (:128-140) — intentional. NEW adds PATCH (:106-125), no OLD equivalent, no client consumer.
- **Error bodies**: OLD leaks `err.message` (:143); NEW returns generic "Internal server error" (:81) — intentional hardening.

## 6. Tables & forms

No tables on either side.

**Add Event form:**

| Field | OLD (inline card, :193-208) | NEW (modal, :142-159) |
|---|---|---|
| Title | text input, required, autoFocus | text input, required (toast-validated), autoFocus, Enter submits |
| Date | native `type="date"` input, required, user-choosable | **absent** — fixed to the clicked cell (`addFor`) |
| Description | single-line text input, "Description (optional)" | 3-row textarea, "Notes (optional)" |
| Color | in state, never editable, sent `''` (:61,:137) | hardcoded `'violet'` (:60); unused by rendering either side |
| event_type | not sent (server defaults 'manual') | not sent; column doesn't exist in NEW |
| Buttons | "Add" (boom-600) / "Cancel" (text) | "Add event" (btn-primary w/ Plus 15) / "Cancel" (btn-secondary) |

Field inputs: OLD hand-rolled `border-rule … focus:ring-boom-500 py-2`; NEW `.input` class (RC-5 py-2.5).

## 7. Defects found

| # | Sev | Defect | Fix location | Conf |
|---|---|---|---|---|
| C-1 | P1 | Selected-day sidebar panel removed — day cells not clickable, no per-day event list, manual-event descriptions unviewable, no in-context delete affordance | cadence `client/src/pages/Calendar.jsx:108-138` (OLD ref :287-358) | HIGH |
| C-2 | P1 | "Upcoming (14 days)" panel removed (incl. Today/Tomorrow/Nd distances and jump-to-day) | cadence `client/src/pages/Calendar.jsx` (OLD ref :157-164, :326-357) | HIGH |
| C-3 | P1 | `dsp_submitted` events dropped from the feed — NEW queries only `live_date` though `dsp_submissions.submitted_date` exists | cadence `server/routes/calendar.js:50-55` (schema `server/index.js:1147`) | HIGH |
| C-4 | P1 | Task events widened from **own tasks** (`t.user_id = $1`, old :68) to **all workspace tasks** — every user now sees everyone's due dates on the calendar | cadence `server/routes/calendar.js:24-27` | HIGH |
| C-5 | P1 | No visible Add Event entry point — header button + date-choosable form replaced by an `opacity-0 group-hover` per-cell `+`; unusable/undiscoverable on touch, and date is not user-choosable | cadence `client/src/pages/Calendar.jsx:76-84,117-119` (OLD ref :184-210) | HIGH |
| C-6 | P2 | Approver role lost contract events — OLD gate is admin/superadmin/**approver** (old :29-30); NEW is `['Superadmin','Admin']` only | cadence `server/routes/calendar.js:15` | HIGH |
| C-7 | P2 | `safeQuery` per-source degradation dropped — any one failing source query 500s the whole feed instead of an empty bucket | cadence `server/routes/calendar.js:16-56,79-82` (OLD ref :7-14) | HIGH |
| C-8 | P2 | Hotkeys ←/→/t/n missing (prev/next month, today, new event) despite `hooks/useHotkeys.js` existing in NEW | cadence `client/src/pages/Calendar.jsx` (OLD ref :123-128) | HIGH |
| C-9 | P2 | Clicking a manual event chip immediately opens the delete confirm (`onEventClick` :68) — destroy is the only interaction; OLD used an explicit trash icon | cadence `client/src/pages/Calendar.jsx:68` (OLD ref :313-318) | HIGH |
| C-10 | P2 | No loading skeleton and fetch errors swallowed silently (`.catch(() => {})`) — empty grid is indistinguishable from a failed load | cadence `client/src/pages/Calendar.jsx:30` (OLD ref :166-173) | HIGH |
| C-11 | P2 | Add-event modal is hand-rolled, not `ui/Modal` — no focus trap, not on the escape stack, Escape doesn't close | cadence `client/src/pages/Calendar.jsx:142-159` | MED (Escape behavior REFUTED 2026-09-02 (Phase 10) — it IS `ui/Modal` (`Calendar.jsx:384`); focus trap and escape stack both apply) |
| C-12 | P3 | Per-type event icons (Music/FileText/CheckSquare/Disc3/Calendar) absent everywhere in NEW | cadence `client/src/pages/Calendar.jsx:10-17` (OLD ref :18-26) | HIGH |
| C-13 | P3 | Filter model: OLD 5 grouped chips (Contracts, DSP collapsed) → NEW 6 flat chips w/ different labels ("Expiring"/"Signed"/"DSP live") | cadence `client/src/pages/Calendar.jsx:10-17,89-98` (OLD ref :41-47,86-91) | HIGH |
| C-14 | P3 | Legend card removed (merged into filter chips) | cadence `client/src/pages/Calendar.jsx` (OLD ref :360-371) | HIGH |
| C-15 | P3 | Live "{N} events" header count replaced by a static subtitle | cadence `client/src/pages/Calendar.jsx:74` (OLD ref :181) | HIGH |
| C-16 | P3 | Per-day chip cap 3→4 before "+N more" | cadence `client/src/pages/Calendar.jsx:122,133` (OLD ref :268,276) | HIGH |
| C-17 | P3 | Past-day numbers no longer dimmed (`text-gray-300`); only out-of-month days are dimmed | cadence `client/src/pages/Calendar.jsx:116` (OLD ref :255,263-266) | HIGH |
| C-18 | P3 | Grid geometry: fixed 42 cells w/ adjacent-month days vs OLD's needed-weeks-only grid with inert pad cells; min-h 104 vs 100; day number circle w-5 vs w-6 | cadence `client/src/pages/Calendar.jsx:45-50,114-116` (OLD ref :99-112,251-266) | HIGH |
| C-19 | P3 | Type→color remap beyond RC-2: dsp purple→blue, manual gray→violet; chip anatomy border-box→dot+tint; raw `bg-*-50` tints w/ no dark remap (OLD has a `.dark !important` layer) | cadence `client/src/pages/Calendar.jsx:11-16,127` (OLD ref :8-16,271) | HIGH (dark rendering REFUTED 2026-09-02 (Phase 10) — premise is inverted: `client/src/index.css:154-320` carries a bounded `.dark` remap layer covering red/rose/amber/orange/yellow/emerald/green/teal/sky/blue/indigo/violet/purple/pink at `-50`/`-100`, plus their `border-`/`ring-`/`hover:` variants, and pushes `-600/-700/-800` text to the `-400` tier. Specificity (0,2,0) beats the utility's (0,1,0), so no `!important` is needed. Raw tints DO remap in dark) |
| C-20 | P3 | Month nav relocated to PageHeader; month label moved into the filter row; centered fixed-width label lost | cadence `client/src/pages/Calendar.jsx:76-88` (OLD ref :231-238) | HIGH |
| C-21 | P3 | Feed drops `subtitle`/`meta` (artist, "Assigned to X", release_type, priority); event title composition differs throughout | cadence `server/routes/calendar.js:58-76` (OLD ref :80-136) | HIGH |
| C-22 | P3 | NEW adds unrequested feed filters vs OLD: releases `status != 'Archived'`, expiring contracts `status = 'Active'` — plausible improvements but behavior deviations | cadence `server/routes/calendar.js:21,45` | HIGH |
| C-23 | P3 | `calendar_events.event_type` column dropped; POST no longer accepts `event_type`; feed hardcodes kind `'event'` | cadence `server/index.js:1411-1420`, `server/routes/calendar.js:74-76,88-96` (OLD ref index.js:955, calendar.js:132,150) | HIGH |
| C-24 | P3 | Dead code: `Trash2` imported unused (client :3); `PATCH /api/calendar/:id` has no client consumer (server :106-125); hardcoded unused `color:'violet'` (client :60) | cadence client/server as cited | HIGH |
| C-25 | P3 | Event chips navigate on click (`link`) — behavior OLD doesn't have; combined with C-9 it makes chip-click semantics kind-dependent | cadence `client/src/pages/Calendar.jsx:68,123-131`, `server/routes/calendar.js:60-72` | HIGH |

**Intentional divergences (not defects):** label_id scoping on every query + tenancy-checked DELETE/404 (new server :13-56,128-140 vs OLD's unscoped delete :166-173); `withTenant` router-level middleware (:8); generic "Internal server error" bodies instead of `err.message` (:81 vs OLD :143); `logActivity` on create (:97); `{success,data}` response envelope (client matched); brand-500/600 accent replacing boom (RC-2).

**Known-gap parity (not a defect):** neither side surfaces deal dates in the feed — OLD's known missing-deals gap is matched, not fixed.

# Deals / Deal Pipeline — parity audit

## 1. Files compared

| Side | Client | Server |
|---|---|---|
| OLD (truth) | `boom-dashboard/client/src/pages/DealPipeline.jsx` (575 lines) | `boom-dashboard/server/routes/deals.js` (239 lines, incl. 3 file routes) |
| NEW | `cadence/client/src/pages/Deals.jsx` (213 lines, incl. `DealDrawer`) | `cadence/server/routes/deals.js` (108 lines) |
| Shared deps | OLD: `utils.js formatDate`, `hooks/useHotkeys` (array API), `components/FilesPanel`, `components/Skeleton`, `ui/{Button,Input,Select}` | NEW: `constants.js` (`DEAL_STAGES/DEAL_TYPES/PRIORITIES`), `utils/dates.js formatDate`, `hooks/useHotkeys` (map API), `components/ObjectDiscussion`, `components/Skeleton`, `ToastContext` |

Route: `/deals` in both (OLD `App.jsx` Protected; NEW `cadence client/src/App.jsx:149`). Stage list is **identical** in name and order: `Scouting, Meeting, Offer, Negotiation, Signed, Passed` (OLD `DealPipeline.jsx:11`; NEW `constants.js:52`).

## 2. Summary

NEW is a true-drag-drop rewrite that keeps the stage vocabulary and the `n` hotkey but sheds most of OLD's kanban visual system and about half the drawer. Four P1s: the **DEAL_TYPES vocabulary is a different list entirely**, the board renders at most **3 columns instead of 6**, the server **dropped priority/deal_type value validation**, and **deal file attachments are gone end-to-end** (routes + panel + card paperclip). The drawer gained `contact`/`links` and an embedded ObjectDiscussion (documented post-spec additions) but lost the Last Contact editor, Spotify Monthly editor, Move Stage pills, inline Saved ✓/failed status, and closes-on-failed-save. Card anatomy lost the priority pill, stage color coding, overdue-aware follow-up tinting, grip affordance, and the "Next ›" advance button. Totals: **20 defects (4 P1 · 9 P2 · 7 P3), 8 intentional/additive divergences.**

## 3. Layout & visual parity

RC-1 (Inter never loaded), RC-2 (brand accent vs boom red), RC-5 (taller inputs/buttons), RC-6 (`rounded-2xl` cards) all apply on this page and are not re-counted here.

| Element | OLD | NEW | Δ |
|---|---|---|---|
| Board grid | `grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3` (`DealPipeline.jsx:292`) | `grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` (`Deals.jsx:108`) | **DEF-DEALS-02** — funnel never shows 6-across |
| Column | `rounded-xl border bg-card p-3 min-h-[16rem]` (:302) | `bg-elev border rounded-2xl p-3`, cards area `min-h-[40px]` (:115,121) | RC-6 + lost tall empty columns; surface bg-card→bg-elev |
| Column header | color dot (`STAGE_DOT`, :51-58,314) + per-stage tinted `text-[11px] font-bold uppercase tracking-wider` title (`STAGE_HEADER`, :60-67,315) + count chip `text-[10px] bg-gray-100 rounded px-1.5 tabular-nums` hidden when 0 (:318-322) | plain `text-xs font-bold text-ink uppercase` + bare `text-xs text-gray-400` count always shown (:117-120) | **DEF-DEALS-08**; RC-3 (bracket sizes → text-xs) |
| Card | `p-2.5 rounded-lg border-gray-150 hover:border-gray-300 hover:shadow-sm`, grab cursor, hover grip `GripVertical size={12}` (:333-339) | `card p-3 hover:border-brand-300`, no grip (:129) | **DEF-DEALS-18** (grip, tones); RC-2/RC-6 |
| Priority on card | uppercase `text-[9px]` tonal pill red/amber/gray (`PRIORITY_PILL_TONE` :23-27,347-349) | unlabeled 1.5×1.5 dot (`PRIORITY_DOT` :12,134) | **DEF-DEALS-07** |
| Follow-up on card | `Follow up: Jun 12` short format, `text-[10px]`, **amber only when overdue by LOCAL-date compare** else gray-400 (:32-49,351-355) | `Follow up Aug 27, 2026`, `text-[11px] text-amber-600` **always** (:139) | **DEF-DEALS-06** |
| File count | paperclip + count `text-[10px]` fed by `FilesPanel onCountChange` (:358-362) | absent | part of **DEF-DEALS-04** |
| Delete affordance | hover `X size={12}` → red (:364-369) | hover `Trash2 size={13}` → text-danger (:141) | **DEF-DEALS-18** / RC-4 |
| Drop hint | dashed `border-2 border-dashed` "Drop here" only while dragging over an empty **different-stage** column (:387-391) | static `Drop here` text permanently on every empty column (:145) | **DEF-DEALS-09** |
| Drop highlight | `border-gray-400 bg-gray-50 ring-1 ring-gray-300`, gated `isDifferentStage` (:294-306) | `border-brand-400 bg-brand-50/40`, fires on the card's own stage too (:112-115) | **DEF-DEALS-09/10**; RC-2 |
| Skeleton | `Skeleton.PageHeader` + `Skeleton.KanbanBoard cols={6} cards={2}` matching the live 6-col board (:233-240) | `<Skeleton.KanbanBoard />` defaults 6 cols (`Skeleton.jsx:71`) while the live board maxes at 3 | **DEF-DEALS-19** |
| Drawer shell | `max-w-sm`, transparent backdrop, `z-50` (:399-400) | `max-w-md`, dimmed `bg-overlay`, `z-[60]` (:172-173) | **DEF-DEALS-20** (cosmetic) |
| Empty pipeline | 6 empty columns | dedicated empty-state card w/ `n` kbd hint (:105-106) | additive (INT-7) |

## 4. Interaction & behavior parity

- **Drag & drop** — both are native HTML5 with optimistic + functional `setDeals` updates (OLD `:220-231`; NEW `:64-69,114`). NEW drops OLD's `dragCounters` ref enter/leave bookkeeping (`OLD :136,207-218`), `effectAllowed/dropEffect` (`OLD :198,219`), and the rAF `opacity 0.4` inline treatment (`OLD :199`; NEW uses class `opacity-40` — visually equivalent). NEW's `onDragLeave` clears highlight when crossing child cards, re-set only by continuous `dragOver` → possible flicker `UNVERIFIED — needs runtime check`. Folded into **DEF-DEALS-10**.
- **"Next ›" advance button** — OLD every card advances one stage inline, hidden on `Passed` (`:371-381`). NEW has no advance button; stage moves are drag or the drawer select only. **DEF-DEALS-05**. (CLAUDE.md described NEW as "drag-drop + card-detail drawer" — the drag replaced button-advance intentionally, but the per-card one-click advance is still lost function.)
- **`n` hotkey** — both open the add form (OLD `DealPipeline.jsx:83-85`; NEW `:34-37`, guarded while drawer open). NEW adds `Escape` to close drawer/form (additive, INT-6). Hook APIs differ (array of `{key,handler}` vs map) — implementation only, no defect.
- **Add form** — OLD: placeholder-styled 2-col grid — Artist (`required` attr), Genre, Stage select, A&R Rep, Source, Priority select labeled `Priority: X`, Deal Type select "(optional)", Notes textarea, **Cancel + Add Deal** buttons, plus header ✕ (`:255-287`). NEW: labeled 3-col grid adds **Offer amount + Next follow-up** (additive), loses the Cancel/✕ close controls, loses `required` — empty-artist submit is a silent no-op (`:43`), options rendered without explicit `value` (fine). **DEF-DEALS-17**.
- **Drawer editing** — OLD is read-mostly (Source/Notes/Added display) with a 6-field editable Details grid: tinted Priority select (`PRIORITY_SELECT_TONE` `:17-21,446-453`), Deal Type, Last Contact, Next Follow-up, **$-prefixed Offer** (`:487-501`), **comma-formatted Spotify Monthly** (`:503-524`), Save w/ inline `Saved ✓` / `Save failed` (`:433-440,527-536`), **Move Stage pill row** (`:539-559`), FilesPanel Documents (`:560-568`). NEW makes every field an input but: **no Last Contact input although the save payload sends `d.last_contact_date`** (`:167` — the field can never be edited, only re-sent), **no Spotify Monthly field at all** (column + server allow-list exist), no tinting/$ prefix/comma format, no inline save status, no Move Stage pills, no Documents. **DEF-DEALS-10..14**.
- **Failed save UX** — NEW `save()` = `onSave(...).then(() => onClose())`; `patchDeal` catches and resolves `false` (`:54-62,164-169`), so the drawer **closes and discards edits on failure** (a toast fires, but state is gone). OLD kept the drawer open with "Save failed" (`:438-440`). **DEF-DEALS-11**.
- **Stage-change persistence** — both fire-and-forget without rollback on error (OLD `:184-193`; NEW `:64-69`) — parity, no defect.
- **Delete** — both `window.confirm`. NEW also offers delete from the drawer (additive). NEW `remove()` refetches (`load()`) vs OLD local filter — parity-equivalent.

## 5. Server/API & data parity

| Aspect | OLD (`server/routes/deals.js`) | NEW (`server/routes/deals.js`) | Δ |
|---|---|---|---|
| List | `GET /` `?stage=` filter, `ORDER BY added_date DESC` (:22-45) | no `?stage`, `ORDER BY updated_at DESC`, label-scoped (:18-29) | **DEF-DEALS-13/15** |
| Create | requires `artist_name` **and** `stage`; validates `priority` ∈ PRIORITIES and `deal_type` ∈ DEAL_TYPES (:51-63); stamps `added_date CURRENT_DATE` | requires trimmed `artist_name` only; stage defaults `'Scouting'`; **no value validation of priority/deal_type/stage**; no `added_date` (:32-57) | **DEF-DEALS-03**; stage-default is benign |
| Update | `PUT /:id`, fixed 12-column COALESCE with `''→null` normalizer + `::date/::integer/::numeric` casts, re-validates priority/deal_type (:85-146) | `PATCH /:id`, dynamic SET from `UPDATABLE` key allow-list (:11-15,60-94) — column-injection-safe, but **any string value accepted** for priority/deal_type/stage | **DEF-DEALS-03**. Verb change is fine (client matches) |
| Delete | returns `data:{id}` (:149-165) | returns `{success:true}` only (:97-106) | folded into **DEF-DEALS-15** (client unused) |
| Files | `POST/GET/DELETE /:id/files` on `entity_files` + R2 (:167-237) | **absent**; `entity_files` used only by `routes/artists.js` in NEW (grep) | **DEF-DEALS-04** |
| Schema | `added_date DATE DEFAULT CURRENT_DATE` (`boom server/seed.js:128`) | no `added_date`; adds `label_id`, `contact`, `links` (`cadence server/index.js:420-442`) | **DEF-DEALS-13** + INT-1/INT-2 |
| Audit | none | `logActivity('Added deal')` (:51) + activity-bot post on genuine stage moves w/ 🎉 on signed (:66-88) | additive, INT-4 |
| DEAL_TYPES | `['360 Deal','Master License','Single License','Distribution','Publishing','Other']` (OLD server:48 = OLD client `DealPipeline.jsx:13`) | client `['Single','EP','Album','Multi-release','Distribution','Licensing']` (`constants.js:54`); server has no list | **DEF-DEALS-01** |
| Object thread | n/a | `deal` in chat `OBJECT_TABLES` (`cadence routes/chat.js:278`), drawer embeds `ObjectDiscussion` (`Deals.jsx:204`) | additive, INT-3 |

PRIORITIES identical (`High/Medium/Low` — OLD `:12`, NEW `constants.js:21`).

## 6. Intentional divergences (not defects)

1. **INT-1 Tenancy**: `withTenant`, `label_id` on every query, `parseInt` id guards (`cadence deals.js:9,68,74,99`).
2. **INT-2 `contact` + `links` fields** (schema `index.js:441-442`, drawer `Deals.jsx:190-202` w/ link-chip rendering) — documented post-spec M4 addition.
3. **INT-3 ObjectDiscussion embed** in the drawer (`Deals.jsx:204`) — documented M6 object-anchored threads.
4. **INT-4 Activity logging + activity-bot stage announcements** (`cadence deals.js:51,82-88`) — cross-cutting NEW infrastructure.
5. **INT-5 Toast feedback** replacing OLD's `alert()`s (`Deals.jsx:47-50,61`) — NEW-wide pattern.
6. **INT-6 `Escape` hotkey** closes drawer/form (`Deals.jsx:36`).
7. **INT-7 Empty-pipeline state card** (`Deals.jsx:105-106`).
8. **INT-8 Brand accent** on hover/drop tints per RC-2 (multi-tenant branding), e.g. `hover:border-brand-300`, `bg-brand-50/40`.

## 7. Defect register

| ID | Sev | Where (NEW) | Defect | OLD reference |
|---|---|---|---|---|
| DEF-DEALS-01 | P1 | `client/src/constants.js:54` | DEAL_TYPES is a different vocabulary (`Single/EP/Album/Multi-release/Distribution/Licensing`) — OLD's six deal types (`360 Deal/Master License/Single License/Distribution/Publishing/Other`) can't be selected, and OLD-valued rows render a blank select | `DealPipeline.jsx:13`, OLD `deals.js:48` |
| DEF-DEALS-02 | P1 | `Deals.jsx:108` | Kanban caps at `xl:grid-cols-3` — the 6-stage funnel never renders in one row (OLD `2/3/6` responsive) | `DealPipeline.jsx:292` |
| DEF-DEALS-03 | P1 | `server/routes/deals.js:32-94` | Server dropped `priority`/`deal_type` value validation on create + update — arbitrary strings persist (OLD 400s) | OLD `deals.js:47-63,94-99` |
| DEF-DEALS-04 | P1 | `server/routes/deals.js` (routes absent), `Deals.jsx` (no FilesPanel) | Deal document attachments removed end-to-end: no `/deals/:id/files` API, no Documents panel in drawer, no paperclip+count on cards | OLD `deals.js:167-237`, `DealPipeline.jsx:358-362,560-568` |
| DEF-DEALS-05 | P2 | `Deals.jsx:122-144` | Per-card "Next ›" one-click stage advance missing (hidden on Passed in OLD) | `DealPipeline.jsx:371-381` |
| DEF-DEALS-06 | P2 | `Deals.jsx:139` | Follow-up date always amber and long-format ("Follow up Aug 27, 2026") — OLD amber **only when overdue** (local-date compare) else gray, short "Follow up: Jun 12" | `DealPipeline.jsx:32-49,351-355` |
| DEF-DEALS-07 | P2 | `Deals.jsx:12,134` | Priority pill (uppercase tonal text chip) replaced by an unlabeled 6px dot — priority unreadable, Low ≈ generic gray | `DealPipeline.jsx:23-27,347-349` |
| DEF-DEALS-08 | P2 | `Deals.jsx:117-120` | Stage color system gone: no colored stage dots, no per-stage tinted headers, count chip → bare gray text always shown (OLD hidden at 0) | `DealPipeline.jsx:51-67,313-322` |
| DEF-DEALS-09 | P2 | `Deals.jsx:145,112-115` | "Drop here" is a permanent static label on every empty column; OLD shows a dashed drop zone only during a drag over a *different-stage* column; NEW highlight also fires on the card's own column | `DealPipeline.jsx:294-306,387-391` |
| DEF-DEALS-10 | P2 | `Deals.jsx:112-114,126-127` | Drag plumbing lost `dragCounters` enter/leave ref, `isDifferentStage` gating, `effectAllowed/dropEffect` — child-element hover flicker `UNVERIFIED — needs runtime check` | `DealPipeline.jsx:136,196-231` |
| DEF-DEALS-11 | P2 | `Deals.jsx:61,164-169` | Drawer closes and discards edits on failed save (`patchDeal` resolves `false`, `.then(onClose)` still runs); OLD stays open with inline "Save failed" | `DealPipeline.jsx:433-440` |
| DEF-DEALS-12 | P2 | `Deals.jsx:167,178-189` | Drawer has **no Last Contact input** though its save payload sends `last_contact_date`, and **no Spotify Monthly Listeners field** at all (column + server allow-list exist) | `DealPipeline.jsx:467-475,503-524` |
| DEF-DEALS-13 | P2 | `server/index.js:420-437`, `server/routes/deals.js:21` | `added_date` column dropped → drawer "Added <date>" line impossible; list order changed to `updated_at DESC` so cards reshuffle after every edit | OLD `seed.js:128`, `deals.js:33`, `DealPipeline.jsx:425-427` |
| DEF-DEALS-14 | P2 | `Deals.jsx:181-189,206-209` | Drawer lost the Move Stage pill row (active pill dark) and the inline `Saved ✓` status pattern — save is a bottom button + toast, stage only via select | `DealPipeline.jsx:527-559` |
| DEF-DEALS-15 | P3 | `server/routes/deals.js:18-29,97-106` | API parity: `GET ?stage=` filter dropped; `DELETE` no longer returns `data.id` (both unused by clients) | OLD `deals.js:24-31,157-160` |
| DEF-DEALS-16 | P3 | `Deals.jsx:166` | `offer_amount: d.offer_amount || null` — a 0 offer is nulled on save (OLD preserved 0 via explicit ''-check + Number) | `DealPipeline.jsx:110-117` |
| DEF-DEALS-17 | P3 | `Deals.jsx:41-52,87-100` | Add form: no Cancel/✕ controls, Artist lost `required` (empty submit is a silent no-op), Priority options lost the `Priority:` prefix, Deal Type lost "(optional)" wording | `DealPipeline.jsx:255-287` |
| DEF-DEALS-18 | P3 | `Deals.jsx:129-141` | Card cosmetics: hover grip handle gone, genre/rep merged to one `·`-joined line showing `—` when empty (OLD hides), delete ✕→Trash2, no `min-h-[16rem]` columns | `DealPipeline.jsx:333-369,302` |
| DEF-DEALS-19 | P3 | `Deals.jsx:104`, `components/Skeleton.jsx:71` | Loading skeleton renders a 6-column board while the loaded board maxes at 3 columns | `DealPipeline.jsx:233-240` |
| DEF-DEALS-20 | P3 | `Deals.jsx:172-173` | Drawer shell: dimmed `bg-overlay` backdrop, `max-w-md`, `z-[60]` vs OLD transparent backdrop, `max-w-sm`, `z-50` | `DealPipeline.jsx:399-400` |

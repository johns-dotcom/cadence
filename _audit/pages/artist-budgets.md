# Artist Budgets — parity audit

Design-token deltas covered by RC-1..RC-6 in `_audit/01-design-system.md`; not re-reported per element. NEW's artist-budgets was built fresh 2026-08-27 to OLD's model — this pass audits residual gaps.

## 1. Files compared (purpose & pairing)

| Side | Client | Server |
|---|---|---|
| OLD (truth) | `boom-dashboard/client/src/pages/ArtistBudgets.jsx` (214 lines — index w/ StateBar) + `ArtistBudgetSheet.jsx` (442 lines — sheet w/ Figure, Age, BudgetInput) | `boom-dashboard/server/routes/artist-budgets.js` (558 lines): GET `/` (:148), GET `/:artistKey` (:350), PUT `/:artistKey/:section` (:365), GET `/:artistKey/export` (:412); shared `buildSheet()` (:230) + `SHEET_ROWS_SQL` (:121). Table `artist_budget_sections` |
| NEW | `cadence/client/src/pages/ArtistBudgets.jsx` (113 lines) + `ArtistBudgetSheet.jsx` (164 lines) | `cadence/server/routes/artist-budgets.js` (293 lines): same four routes (:152/:207/:215/:241), shared `buildSheet()` (:78) + `sheetRows()` (:51). Table `artist_budget_sections` (+`label_id`) |

Same feature, same shape: budget = six section numbers per artist; blur-saved inputs ARE the creation flow; amount 0 deletes the row; SPENT ≠ OPEN; leaf rows only; round at the row; bank-evidence four-state vocabulary shared with Recoupments. The core model ported faithfully — residual gaps are mostly in the index band, the open worklist, and the Excel export's disclosure rows.

## 2. Route & permissions

- OLD: `/artist-budgets` + `/artist-budgets/:artistKey` (boom App.jsx:234-235); server gates every route inline with `isBkAdmin` = Admin/Superadmin/Approver (artist-budgets.js:150, :352, :367, :414).
- NEW: same two client routes behind `AdminRoute` (cadence App.jsx:167-168); nav item Approver+ (Layout.jsx:290); server router-level `authMiddleware, withTenant, requireApprover` (artist-budgets.js:29) — same effective tier. Tenancy (`label_id` on every query) = **intentional divergence**.
- NEW constrains `:artistKey([a-z0-9]+)` (routes :207/:215/:241) — safe, since `artistBucketKey` output is `[a-z0-9]*` by construction (cadence `server/lib/artistKey.js:16`). No defect.

## 3. Server/API diff

| Concern | OLD | NEW | Δ |
|---|---|---|---|
| Row universe | `SHEET_ROWS_SQL`: approved, not deleted/voided, artist non-blank, leaf-only NOT EXISTS (boom :121-136) | identical predicate + `label_id` (cadence :51-68) | parity |
| USD | `rowUsd` = `r2(usdOf(amount, currency, fx_rate_to_usd))` — locked rate wins, rounded at the row (boom :79) | `await rowUsd2(r)` from `lib/usd.js`, same contract (cadence :108, :175) | parity |
| Section mapping | `loadSectionOf()` from `bk_categories.ui_group`, degrades to last section (boom :93-107) | same from per-label `categories`, degrades to `'other'` (cadence :39-49) | parity |
| Four states | verified / awaiting / unverified / unpaid, mirrored to client recoupState (boom :180-184) | `stateOf()` identical ladder (cadence :71-75) | parity |
| Index payload (per artist) | budget, spent, open, committed, variance, has_budget, over_committed, verified/awaiting/unverified/unpaid, **count, open_count**, best spelling (boom :187-202) | same minus **count/open_count** (cadence :177-190) | DEF-AB-04 |
| Index payload (totals) | artists, **with_budget**, budget, spent, open, **committed, open_count** (boom :206-214) | artists, spent, open, budget only (cadence :196-201) | DEF-AB-06 |
| Sheet payload | `sections[]` (budget, note, **updated_at, updated_by_name**, spent/open/committed/variance/over_committed/unplanned, `categories[]` w/ **count**), flat `rows` + `open_rows` (globally oldest-first, boom :251-347) | `sections[]` (budget, note, states, spent/open/committed/variance/over_committed/unplanned, `by_category` **map without counts**, `items[]`, `open_items[]` per section); no updated_by_name (cadence :100-147) | DEF-AB-11/12; open rows per-section not global (feeds DEF-AB-07) |
| Variance semantics | `variance = budget − spent`, blank client-side without budget; over_committed = separate flag vs committed (boom :317-322) | `variance: budget > 0 ? round2(budget − spent) : null` — same rule, null server-side (cadence :141-143) | parity |
| PUT section | validates section ∈ six keys, amount ≥ 0; **0 + no note DELETES**; upsert stamps `updated_by` (user **id**) + `updated_at`; note ≤ 500 chars (boom :365-403) | same validation + delete rule; stamps `updated_by = req.user.name` (a **string**, never resolved/displayed); + `logActivity` (cadence :215-236) | parity on behavior; provenance display lost → DEF-AB-11. NEW client also *preserves* the note on amount-save (`note: section.note`, sheet client :32) where OLD's client silently wipes it (OLD saveSection sends `{ amount }` only, boom sheet :86; server nulls absent note, boom :379/:394) — NEW is the corrected form, not a defect |
| Export | same `buildSheet` as the page; 2 sheets (boom :412-555) | same `buildSheet`, 2 sheets (cadence :241-291) | structure parity; disclosure rows lost → DEF-AB-01/02/03 |
| Error bodies | `err.message` returned (boom :219 etc.) | generic `'Failed'` (cadence :204 etc.) | **intentional divergence** (info-leak hardening) — but the sheet client then swallows even that (see §5) |

## 4. UI structure diff

### Index (`ArtistBudgets.jsx`)

| Element | OLD | NEW | Δ |
|---|---|---|---|
| Summary band | Card: "**N** artists · **$X** spent · **$Y** in open invoices (**count**) · against **$Z** budgeted · **M** with no budget set yet" (boom :76-93) | PageHeader subtitle: "N artists · $X spent · $Y in open invoices" — budget total, open count, no-budget count all dropped (cadence :62) | DEF-AB-06 |
| Toolbar | search + "Only artists with a budget" checkbox + 6-option sort select (boom :95-120) | same three controls, same 6 sorts, same variance-sorts-last rule (cadence :64-73, :36-45) | parity |
| Columns | Artist (+"· N paid items" + over-committed chip) / Budget / Spent / Open (tooltip: "N unpaid invoices") / Variance / "Of what was spent" StateBar (boom :125-171) | Artist (+over-committed chip) / Budget / Spent / Open / **Committed** (NEW-only, a fine addition) / Variance / Bank (cadence :77-104) | per-row item count + open tooltip gone (DEF-AB-04) |
| StateBar | segmented bar (zero parts filtered) **+ text sublabel** "$X confirmed · $Y unconfirmed · $Z no bank line" + tooltip (boom :190-213) | bar + tooltip only, no sublabel (cadence :96-103) | DEF-AB-05 |
| Empty state | "No artist matches." (boom :174-177) | "No artists…" + onlyBudgeted hint (cadence :81) | parity+ |
| Error state | inline rose banner (boom :67-71) | full card + **Retry** (cadence :48-55) | NEW better |

### Sheet (`ArtistBudgetSheet.jsx`)

| Element | OLD | NEW | Δ |
|---|---|---|---|
| Figures row | Budget / Spent / Open (only when > 0) / Committed (rose when over) / Variance (— without budget) as `Figure` blocks; over-committed warning line; "of what has been spent" state-split strip w/ per-state tooltips + AlertTriangle on unverified (boom :148-183) | 5 stat cards Budget/Spent/Open/Committed/Variance, same color rules + sublabels (cadence :82-88); **no over-committed warning line, no state-split strip at the top** (the states only appear per-item and in the footer prose) | DEF-AB-14 (headline state-split strip lost) |
| Six sections | table rows; empty sections rendered **dimmed** (text-gray-300, input still live, boom :204-217); section row w/ unplanned + over-committed chips, budget input, spent (+ "+$open" subline), variance, "N paid items" expander (boom :218-262) | card rows, all six uniform; same chips/figures/expander + "+$X open" chip (cadence :92-107) | parity on data; dimming lost (DEF-AB-13) |
| Category rollup | always-visible **indented rows** under section: category / actual / **count** (boom :263-274) | inline chip line "Cat: $X" without counts (cadence :109-113) | DEF-AB-12 |
| Expanded item rows | BankEvidenceDot + **PayeeLink** (vendor page, new tab, keeps your place) + song · date · USD **+ "(amount CUR)" original for non-USD** · state word w/ tooltip (boom :275-301) | BankEvidenceDot + payee as `/ledger?focus=` same-tab link · date · song-or-category · state **chip** · USD only (cadence :116-125) | DEF-AB-09, DEF-AB-10 |
| Totals band | `tfoot` SPENT row: budget / spent / variance / count, bold over double rule (boom :306-317) | none — totals live only in the top figure strip | folded into DEF-AB-14 |
| Open worklist | own card: header "Open · unpaid invoices · N invoices · still to pay" + **big amber total**; rows payee+song / **category** / date + Age chip (hidden < 30d, amber ≥ 30, rose ≥ 90) / USD; tfoot **STILL TO PAY** row + **Committed — spent plus open** row (boom :330-380) | card when `t.open > 0`: prose subhead; rows date / payee / **section label** (not category, no song) / age chip (always shown, gray < 30) / USD; Committed line only — no count, no amber total, no STILL TO PAY row (cadence :134-156) | DEF-AB-07/08; detail loss folded into DEF-AB-13 |
| Budget input | borderless inline input (transparent until hover/focus), saving spinner, tooltip "Set by {name}" (boom :423-441) | standard boxed `.input`, no spinner, no provenance tooltip (cadence :36-44) | DEF-AB-11 |
| Per-section note | no UI in OLD either (schema + export only) | no UI; schema has `note` | **parity** — neither side has note UI |
| Footer explainer | "Expenses land in a section by their category — nothing is assigned by hand. A section you have not budgeted still shows its spend, marked unplanned. Spent is money that has left the bank; open invoices are counted separately…" (boom :382-387) | different prose: three state chips + "The sheet reports — it does not block an invoice for being over budget." (cadence :159-161); index page carries the spent/open sentence instead (index :110) | DEF-AB-15 (copy drift; the "nothing is assigned by hand" rule is no longer stated anywhere on the sheet) |

## 5. Behavior/interactions diff

- **Blur-save discipline — parity.** Both save on blur only when the number changed (boom sheet :76-92; cadence sheet :27-35), Enter blurs, zero deletes. NEW resets the draft on refetch via `useEffect [section.budget]` (cadence :26); OLD keeps a drafts map keyed by section — equivalent outcomes.
- **Open worklist ordering (DEF-AB-07).** OLD sorts `open_rows` globally oldest-first ("the oldest is the one most likely to be a surprise", boom :333-336). NEW's copy claims "Oldest first — it is a worklist" (cadence sheet :137) but renders `sections.flatMap(open_items)` (:139) — ordered by *section, then* date. Within a section it's oldest-first (routes :134); across the page it is not what the copy promises.
- **Invalid input handling.** OLD toasts "A budget is zero or more" and leaves the draft (boom :78-80); NEW silently reverts the field to the saved value (cadence :29) — no feedback. Minor, folded into DEF-AB-13.
- **Sheet load failure.** NEW's sheet `load()` catches everything into a toast and leaves the skeleton up forever (cadence sheet :54, :67 — `if (!sheet)` renders Skeleton.Block with no retry/back-link); OLD renders an error card with an "← All sheets" escape (boom :108-117). DEF-AB-16.
- **Export transport.** OLD `window.open(…/export?token=)` (boom :132-139); NEW axios blob + object-URL download (cadence sheet :57-65) — **intentional divergence** (cadence removed `?token=` query auth app-wide in the security pass).
- **Age arithmetic.** OLD anchors at `T12:00:00Z` to dodge TZ edges (boom :397); NEW `new Date(slice(0,10))` — ISO date-only parses UTC-midnight, so a UTC-negative viewer can be a day off. Folded into DEF-AB-13.
- **Note preservation** — NEW improvement, see §3 table (OLD's client wipes a section note on every amount save).
- **Per-row async USD** — NEW awaits `rowUsd2` inside per-row loops (routes :108, :175). Same totals; potential N-row latency vs OLD's sync `rowUsd`. `UNVERIFIED — needs runtime check` (depends on whether rowUsd2 resolves without I/O when the locked rate is present).

## 6. Visual/design diff

RC-1/RC-2/RC-3/RC-5/RC-6 apply page-wide. Beyond those:

- Money formats: OLD index whole-dollar (`maximumFractionDigits: 0`, boom index :20-22) and sheet cents; NEW `money()` always cents (cadence `utils/money.js:5-8`) — index reads denser in OLD. Part of RC-3 texture, noted once here.
- OLD chips are bare uppercase colored text (`text-rose-600`, no pill, boom index :144-148); NEW wraps them in tinted pills (`bg-rose-100 text-rose-700 rounded`, cadence index :86). Same words, heavier weight in NEW.
- OLD state words in expanded rows are plain colored text w/ tooltip (boom :295-297); NEW tinted chips (cadence :122). Same vocabulary.
- OLD sheet is one continuous `table` (section header rows + category rows + item rows share columns, everything tabular); NEW is a card stack with flex rows — figures no longer column-align across sections. Folded into DEF-AB-14.
- OLD budget input is invisible-until-hover (reads as a sheet cell); NEW is a visible boxed input (reads as a form). Part of DEF-AB-11's row.
- Export cosmetics: OLD filename "`{Artist} - budget vs actual.xlsx`" + `wb.creator = 'Boom Records'` (boom :544, :425); NEW "`artist-budget-{key}.xlsx`", no creator (cadence :288) — creator = branding (**intentional**), filename using the mangled key instead of the display name is DEF-AB-17 (P5).

## 7. Defect table

| ID | P | What | Where (NEW) | OLD proof | Conf |
|---|---|---|---|---|---|
| DEF-AB-01 | P3 | Export missing the four state-split prose rows ("Of that spent — confirmed on a bank statement…", the external-recipient disclosure) | server/routes/artist-budgets.js:263-268 (rows end at the note) | boom routes :504-507 | HIGH |
| DEF-AB-02 | P3 | Export missing the OPEN · UNPAID INVOICES block (per-invoice rows + STILL TO PAY total + separate double-ruled COMMITTED row with its over-budget note) — summary sheet shows Open/Committed as bare columns only | server/routes/artist-budgets.js:251-265 | boom routes :474-501 | HIGH |
| DEF-AB-03 | P4 | Export missing the Note column: per-section `note`, "unplanned — no budget set", "over-committed once open invoices are paid" annotations never reach the workbook | server/routes/artist-budgets.js:251-256 | boom routes :434, :448-451 | HIGH |
| DEF-AB-04 | P4 | Index rows lost "· N paid items" and the Open cell's "N unpaid invoices" tooltip — server omits per-artist `count`/`open_count` | server/routes/artist-budgets.js:183-189; client ArtistBudgets.jsx:85-90 | boom routes :161-179, index :142, :157-158 | HIGH |
| DEF-AB-05 | P4 | Index StateBar lost its text sublabel ("$X confirmed · $Y unconfirmed · $Z no bank line") — amounts now hover-only | client ArtistBudgets.jsx:96-103 | boom index :207-211 | HIGH |
| DEF-AB-06 | P4 | Index summary band reduced: budgeted total, open-invoice count, and "N with no budget set yet" dropped; server totals omit `with_budget`/`committed`/`open_count` | client ArtistBudgets.jsx:62; server routes :196-201 | boom index :76-93, routes :206-214 | HIGH |
| DEF-AB-07 | P4 | Open worklist not globally oldest-first — flatMap preserves section order while the adjacent copy says "Oldest first" | client ArtistBudgetSheet.jsx:137-139 | boom routes :333-336 | HIGH |
| DEF-AB-08 | P4 | Open worklist header lost the invoice count + amber running total, and the STILL TO PAY footer row (only the Committed line survives) | client ArtistBudgetSheet.jsx:134-156 | boom sheet :332-343, :363-377 | HIGH |
| DEF-AB-09 | P4 | PayeeLink (vendor page, new tab, `stopPropagation`, keeps review position) replaced with a same-tab `/ledger?focus=` link — a side-trip now costs your place on the sheet | client ArtistBudgetSheet.jsx:120, :144 | boom sheet :282, :349 + components/PayeeLink.jsx | HIGH |
| DEF-AB-10 | P4 | Non-USD rows no longer show the original amount "(1,000 EUR)" next to USD; `moneyOrig` imported but unused | client ArtistBudgetSheet.jsx:13, :123 | boom sheet :291-293 | HIGH |
| DEF-AB-11 | P5 | Budget input lost provenance ("Set by {name}" tooltip) + saving spinner; server stores `updated_by = req.user.name` string and never returns `updated_by_name`; boxed input instead of inline sheet-cell styling | client ArtistBudgetSheet.jsx:36-44; server routes :95-98, :226-231 | boom sheet :423-441, routes :234-235 | HIGH |
| DEF-AB-12 | P5 | Category rollup lost per-category counts and the indented-row (column-aligned) presentation | client ArtistBudgetSheet.jsx:109-113 | boom sheet :263-274 | HIGH |
| DEF-AB-13 | P5 | Small-behavior cluster: empty sections not dimmed; age chip rendered under 30 days (OLD suppresses as noise) w/ >30/>90 vs ≥30/≥90 thresholds and no UTC-noon anchor; invalid budget input reverts silently instead of toasting; open rows show section not category, and drop song | client ArtistBudgetSheet.jsx:92-107, :140-146, :29 | boom sheet :204-217, :395-408, :78-80, :350-352 | MED |
| DEF-AB-14 | P5 | Sheet's tabular anatomy lost: single aligned table w/ SPENT tfoot band → card stack; headline "of what has been spent" state strip + over-committed warning line under the figures gone | client ArtistBudgetSheet.jsx:82-131 | boom sheet :148-183, :186-318 | HIGH |
| DEF-AB-15 | P5 | Footer explainer no longer states the load-bearing rule "Expenses land in a section by their category — nothing is assigned by hand" | client ArtistBudgetSheet.jsx:159-161 | boom sheet :382-387 | HIGH |
| DEF-AB-16 | P4 | Sheet load failure leaves an eternal skeleton (toast only) — no error card, no retry, no back-link | client ArtistBudgetSheet.jsx:54, :67 | boom sheet :108-117 | HIGH |
| DEF-AB-17 | P5 | Export filename uses the mangled `artist_key` ("artist-budget-jerri.xlsx") instead of the display spelling | server routes :288 | boom routes :544-548 | HIGH |

**Intentional divergences:** label_id tenancy on every query + router-level `requireApprover`; export download via Authorization-header blob (query-token auth removed app-wide); generic `'Failed'` error bodies (info-leak hardening); `wb.creator 'Boom Records'` dropped (branding); shared `utils/money`/`recoupState`/`BankEvidenceDot` primitives instead of page-local ones.

**NEW-better notes (no action):** index gained a Committed column and a real error card w/ Retry; amount-save preserves the section note (OLD wipes it); PUT logs to the activity trail.

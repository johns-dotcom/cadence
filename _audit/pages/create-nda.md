# Create NDA

OLD: `boom-dashboard/client/src/pages/CreateNDA.jsx` (972 lines) + `client/src/pages/nda-templates/` (index.js registry :20-50, shared.js :9-133, standard.js :13-155, invest.js :39-174) + `boom-dashboard/server/routes/ndas.js` (112 lines, table `boom_ndas`, index.js :3016-3046)
NEW: `cadence/client/src/pages/CreateNda.jsx` (247 lines) + `cadence/client/src/constants/ndaTemplates.js` (167 lines) + `cadence/server/routes/nda-documents.js` (83 lines, table `nda_documents`, index.js :1283-1295). NEW's `/api/ndas` counterparty tracker is out of scope here (legal page audit).

Design-system-level diffs (Inter font, accent default, control heights, radii) are covered by RC-1, RC-2, RC-5, RC-6 in `_audit/01-design-system.md` and not re-reported. OLD's `focus:ring-boom-500` rings map to NEW brand rings under RC-2.

## 1. Layout & structure

**OLD** (CreateNDA.jsx:604-971): tab strip (one tab per registered template, rendered ONLY when >1 template, :609-627) → 2-col `xl:grid-cols-2` grid: form card ("New NDA"/"Edit NDA #id" + Cancel-edit link, :630-853) with Effective Date, Owner Name/Address, Recipient Name/Address, Signatory Name/Title, template `extraFields` (generic renderer w/ textarea/fullWidth/description support, :733-765), Optional Clauses checkboxes w/ per-clause descriptions + "no clauses" italic note (:770-795), missing-mandatory amber warning w/ inline Reset link (:797-808), Body textarea rows=18 w/ "· customized" badge + "Reset to template" + heading-syntax helper copy (:810-834), save error, full-width gray-900 submit, footer helper | live `NDAPreview` (:855-857). Below: "Saved NDAs (N)" table (:861-927) + preview modal for a saved row w/ Download PDF / Download Word / Close (:930-969). `/create-nda` with no/unknown `:template` lands on the FIRST registry template — never a blank state (index.js:34-36).

**NEW** (CreateNda.jsx:124-212): `/create-nda` with no/invalid `:template` renders a **template picker** — PageHeader + 3 template cards + SavedList (:125-141). With a template: "← Templates" back link + PageHeader (title/desc/`New` action when editing) → `lg:grid-cols-2`: left column of three stacked cards (Document title + fields grid :157-168; "Optional clauses" card w/ ShieldCheck :170-181; "Document body" card rows=12 :183-189) + Save/PDF/Word button row (:191-195) | right sticky preview card (:199-207). SavedList table below (:210).

Structural deltas: tab strip → picker page + back-link; single form card → 3 cards + external button row; saved-row preview modal gone; NEW adds a Document-title field OLD doesn't have; NEW export buttons act on the live editor state, OLD's act on saved rows.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Template chooser | underline tab strip, active `border-boom-500 text-boom-700`, title=description tooltip | card grid w/ 40px brand-100 icon tile, hover border-brand-300 | OLD :609-627 / NEW :129-137 |
| Form labels | `text-sm font-medium text-gray-700` sentence case | `.label` uppercase 12px tracking-wide (NEW-only class per design-system §Global CSS) | OLD :653 / NEW :158 |
| Body textarea | rows 18, `text-[12px] font-mono` | rows 12, `text-xs font-mono` | OLD :824-829 / NEW :188 |
| Submit | full-width `bg-gray-900` w/ Loader/Pencil/Plus icon states | inline `btn-primary` w/ Save icon (RC-2 accent) | OLD :841-848 / NEW :192 |
| Preview container | plain card, `px-10 py-8 max-h-[640px]` scroll | sticky `top-4 max-h-[calc(100vh-3rem)]`, `p-7`, "LIVE PREVIEW" kicker | OLD :53-54 / NEW :200-201 |
| Preview title | h1 from the body's own first line: `text-2xl font-black tracking-tight text-center` | separate `{title \|\| tpl.name} NDA` header `text-base font-bold` left-aligned; body's own all-caps line (if any) renders as plain body | OLD :57-63 / NEW :202-204 |
| Preview headings | Roman/letter sections `text-[13px] font-bold` | `1. HEADING` lines bold via `isHeadingLine`; A./B. subsections + all-caps lines NOT bolded | OLD :64-69 / NEW :11,204 |
| Signature block in preview | structured OWNER/RECIPIENT blocks w/ bold party lines | none (inline closing paragraph in body only) | OLD :79-84 / NEW — |
| Optional clauses | checkbox + label + `text-[11px]` description; boom-600 accent | checkbox + label only, `p-2 rounded-lg hover:bg-gray-50`, 50% opacity + disabled while dirty | OLD :774-793 / NEW :173-178 |
| Saved table | uppercase th on `bg-gray-50`, 5 icon actions incl. text-glyph "W" for Word | `text-[10px]` th on `bg-page/50`, text "Open" link + trash | OLD :866-919 / NEW :222-241 |
| Editing state | "Edit NDA #id" heading + "Cancel edit" + contextual subtitle | subtitle "Editing a saved NDA" + `New` button in PageHeader | OLD :631-649 / NEW :148-151 |
| Loading | `Skeleton.Block` h-24 + h-64 | none | OLD :574-580 / NEW — |

## 3. Copy & content differences

- **Template names/descriptions**: "Standard NDA" ("Boom.Records default mutual-confidentiality NDA…") + "Invest" ("Confidentiality NDA for corporate counterparties evaluating a potential investment…") → "Standard (one-way)", "Mutual", "Corporate recipient" with new descriptions (boom standard.js:116-117, invest.js:129-130 / cadence ndaTemplates.js:75-76,91-92,107-108). The Boom-specific naming is intentional to drop; the *legal text* is not (see NDA-1).
- **Document body text**: entirely different agreements. OLD standard preamble names the disclosure purpose ("development of artists, marketing plans, business development and overall company strategy") and 15 titled sections; NEW is a ~6-section generic NDA ("CONFIDENTIAL INFORMATION / OBLIGATIONS OF RECEIVING PARTY / EXCLUSIONS / …optional… / TERM / GOVERNING LAW"). Owner/Recipient vocabulary → Disclosing/Receiving Party. Governing law CA hardcoded in OLD General Provisions vs a form field in NEW (defensible, but the surrounding clause is gone).
- **Optional clause copy**: OLD "Include Non-Circumvention — 1-year restriction on doing business with Owner's contacts" / "Include Non-Solicitation — 2-year restriction on soliciting employees, clients, and artists" (+ full A–D section bodies) → NEW "Non-solicitation" (single sentence, 1-year, employees only), plus new "Return of materials / No publicity / Injunctive relief / Residuals / Standard exclusions / Binds affiliates" (cadence ndaTemplates.js:16-42,125-130).
- Form guidance: "Fill in the recipient details; Owner / signatory default to Boom Records.", body helper ("Section headers … render bold in the PDF. The signature block is added automatically at the end — don't include it here."), footer "Saving stores the form values; download the PDF from the list below…" — all absent in NEW.
- Missing-sections warning: "Saved body is missing standard sections. Not present: … saved against an older template." (OLD :801-805) → toast "Missing required section(s): …" that blocks save (NEW :69).
- Confirms: "Delete this NDA record? This does not revoke any already-issued copies." → "Delete this NDA?" (OLD :386 / NEW :82); template-switch confirms ("Switch to X? Your customized body will be replaced…") → none.
- Filename: `Boom.Records-NDA-{Recipient}-{YYYY-MM-DD}.pdf/.docx` → `{docTitle}.pdf/.docx` (OLD :489-495,563-569 / NEW :86,108,120).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Legal template content** — see NDA-1 (the headline defect): neither the Boom standard 15-section body nor the invest corporate variant (Purpose preamble, Personnel/II(E) government carve-out, Other Businesses, explicit Roman numbering with `IX./XII. [intentionally omitted.]` placeholders, 1-year term w/ survival list) was ported.
- **Dirty-body auto-sync**: OLD watches BASE_BODY_FIELDS + effective_date + template extras (`watchedSig`, :201-206); clean body → full rebuild per field change (:210-215); dirty body → debounced (400ms) word-boundary find/replace of the changed field's old value throughout the edited body, w/ `prevFormRef` snapshot and flush-before-save (:171-195,219-229,344-352). NEW: body freezes at first hand edit; field changes never reach it again until "Reset to template" discards all edits (CreateNda.jsx:50-53).
- **Roman sequential renumbering**: optional sections excluded without leaving numbering gaps (`ROMAN[i]` incremented only for included sections, standard.js:100-110); invest keeps explicit Romans so omissions hold position (invest.js:115-123). NEW numbers Arabic `1..N` at build time (ndaTemplates.js:156) — fine for its own text but the mechanism (and placeholders) is gone.
- **getHeadingLevel** 3-level heuristic biased to false negatives (all-caps h1 ≤80 chars no period; `^([IVXLCDM]{1,5}|[A-Z])\.` h2 w/ length + dot-count guards, shared.js:51-62) shared by preview + PDF + docx → NEW `isHeadingLine = /^\d+\.\s+[A-Z]/` (CreateNda.jsx:11); no h1 detection, no letter-subsection bolding, so a pasted OLD-style body renders unstyled.
- **Signature blocks**: `renderSignatureFor` structured OWNER/RECIPIENT payload (By/Name/Title/Date lines; `recipient_signatory_name/title` extras w/ fallback-to-recipient + blank-Title omission; per-template override hook) consumed by preview (:79-84), PDF (keep-both-blocks-on-one-page 240pt guard, :471-487), and docx (:536-552). NEW: a flat "IN WITNESS WHEREOF…" string inside the body (ndaTemplates.js:159) — no By:/Date: rule lines, recipient side is always "Name / Title" placeholder.
- **Mandatory-section check semantics**: OLD warns non-blockingly while EDITING a loaded row (per-template `mandatorySections` regexes; invest checks PROTECTION/OTHER BUSINESSES/SIGNATORIES) with an inline reset (:246-251,797-808); NEW hard-blocks save against one global 4-heading list (:66-69, ndaTemplates.js:165-167) and shows nothing while typing.
- **Clause toggles derived from the saved body**: OLD startEdit re-derives each toggle via the clause `marker` regex over `custom_body` (DB column fallback for legacy rows, `!== false` NULL semantics) so checkboxes never lie (:280-309); NEW trusts `data.enabled` JSONB (:60).
- **Legacy no-body reconstruction**: OLD rebuilds `custom_body` from the row's own template + `template_data` on edit, download, and preview (:319,419-424,943-945); NEW has no fallback (server enforces body on POST, but a PUT that empty-strings it nulls the column — nda-documents.js:56).
- **Saved-row exports + preview**: OLD list has Preview (modal w/ Download PDF/Word), Download PDF, "W" docx per row, each built from that row's template; NEW list has Open + Delete only — export requires loading the row into the editor first (:884-918,929-969 / NEW :236-239).
- **Template-switch guards**: OLD `switchTemplate` confirms when editing or dirty and resets state; URL-driven with a back/forward reset effect guarded by `editing` (:139-147,586-602). NEW's back-link/picker `Link`s navigate with zero dirty-warning; unknown `:template` shows the picker rather than falling back to the first template.
- **Required fields**: OLD blocks save client-side (effective_date/owner/recipient, :336-339) + server 400 (ndas.js:31-33) + `required` attrs on inputs; NEW's `f.required` renders only a red asterisk (:163; no `required` attr, no save-time check) and the server requires only template + custom_body (nda-documents.js:33-36).
- **Address/disclosed-to fields**: owner_address + recipient_address (BASE_FIELDS, shared.js:70-73) and the `disclosed_to` column (ndas.js:26) have no NEW equivalent; NEW templates carry no address at all.
- **jsPDF/docx fidelity**: OLD helvetica, centered 16pt title from the body, 11pt body w/ bold section headers, gray body ink, bullet single-newline preservation, 1in margins; docx mirrors it (half-point 32/22, helvetica default, 1440 margins, TextRun `break` bullets) (:396-495,503-571). NEW: times, 14pt left docTitle, uniform paragraphs; docx uses default HEADING_1 + plain runs (:89-122).

### Features in NEW not in OLD
- Template picker landing page + deep-link `location.state.open` from the picker into a saved doc (:33-39,138).
- Document-title field (drives filename + preview header + saved-list Title).
- Toasts (`useToast`) replacing inline error banners; `PageHeader` chrome.
- Server: label scoping, Approver gate, `logActivity`, 404-checked update/delete (see [INT]).

### Interaction differences
- Toggle-while-dirty: OLD `window.confirm` → rebuild + apply toggle in one step (:258-267); NEW disables checkboxes and toasts "Toggle affects the template — reset to apply" (as an *error* tone) until manual reset (:53,175-180).
- Reset affordance: OLD "Reset to template" always visible w/ explanatory tooltip; NEW link appears only while dirty (:186) plus a second reset inside the clauses card note (:180).
- Save success: OLD keeps you on the page w/ fresh blank + refetch; NEW `startNew()` + toast (equivalent), but OLD's editing flow scrolls to top on edit (:328) — NEW doesn't.
- Date rendering: OLD forces `en-US` long dates in the body (shared.js:26-32); NEW uses the browser locale (`toLocaleDateString(undefined, …)`, ndaTemplates.js:8-12) — same saved form can produce different document text per machine.

## 5. Data layer

| Concern | OLD | NEW |
|---|---|---|
| Table | `boom_ndas` — structured columns: effective_date, owner_name/address, recipient_name/address, disclosed_to, signatory_name/title, custom_body, include_non_circumvention/solicitation booleans, template_id (regex-whitelisted, default 'standard'), template_data JSONB, created_by=user *name* (index.js:3016-3046) | `nda_documents` — label_id, created_by=user *id*, template, title, `data` JSONB `{form, enabled}`, custom_body (index.js:1283-1295) |
| Create | POST /ndas — 400 without effective_date/owner/recipient; `!== false` boolean coercion for clause flags (ndas.js:21-67) | POST /nda-documents — 400 without template or custom_body only (nda-documents.js:31-48) |
| Update | PUT allow-list of 13 columns; template_id shape re-validated; `::jsonb` cast; no tenant/owner scope, no 404→ *(404 exists :95)* | PUT allow-list of 4; `'' → null` coercion (can null custom_body); label-scoped + 404 (nda-documents.js:51-69) |
| Delete | unscoped by id (ndas.js:103-110) | label-scoped + 404 (nda-documents.js:72-81) |
| Auth | authMiddleware only — any logged-in user | + withTenant + requireApprover (nda-documents.js:10); client route `AdminRoute` + nav `isApprover` (App.jsx:155-156, Layout.jsx:270) — **Intentional divergence** |
| Activity log | none | `logActivity('Created NDA', …)` on POST only (not PUT/DELETE) |
| Ordering | created_at DESC, id DESC | same |

## 6. Tables & forms

| Control | OLD | NEW |
|---|---|---|
| Fields | BASE_FIELDS (7: date + owner pair + recipient pair + signatory pair) + template extraFields (invest: recipient_signatory_name/title w/ description text) | per-template `fields` array (8-9): date, parties, purpose, term_years, governing_law, signatory pair (+recipient_company/signatory on corporate); no addresses, no extras engine (textarea/fullWidth/description unsupported) |
| Defaults | BOOM_DEFAULTS owner name/address + John Skead / Managing Member; standard defaults clause toggles true | `disclosing_party: label?.name`, `signatory_name: user?.name`, `term_years: '2'`; enabled: exclusions/return/injunctive (CreateNda.jsx:44-45) — party/signatory substitution intentional |
| Field layout | date full row; pairs in md:grid-cols-2 | grid-cols-2 w/ hardcoded key list deciding half-width (:162) |
| Saved table cols | Effective (long date) / Owner / Recipient / Created (+ `· created_by`) / 5 actions | Title / Template / Created (`formatDate`) / Open + Delete |
| Validation UI | inline red banner (saveError) + amber mandatory warning | toasts only |

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
- NDA-15 P3 — Body dates locale-dependent: OLD forces `en-US` long dates; NEW `toLocaleDateString(undefined, …)` renders per-browser (boom shared.js:26-32 vs cadence ndaTemplates.js:8-12). Actual rendering per locale CONFIRMED by source 2026-09-02 (Phase 10) — `ndaTemplates.js:8-12` passes `undefined` as the locale, so the rendered date follows each reader's browser. Exact per-locale strings still need a browser, but the divergence from OLD's forced `en-US` is certain.

Intentional divergences: label_id scoping + withTenant + requireApprover + logActivity + generic error bodies (nda-documents.js:10,20,25-26,42); `AdminRoute` + `isApprover` nav gating (cadence App.jsx:155-156, Layout.jsx:270); owner party defaulting to `label?.name` + signatory to `user?.name` in place of BOOM_DEFAULTS constants (CreateNda.jsx:44); "Boom.Records" naming stripped from template labels/descriptions/filenames (the *naming*, not the clause text).

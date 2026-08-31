# missing--contracts-create — OLD's Create Contract (AI full-contract generation)

## 1. What it is

AI-drafted full contract generator: a form of deal terms on the left, a generated
contract document on the right, referencing the label's existing contracts of the
same type for style/terms. Distinct from the `/contracts` tracker (which stores
contracts) — this page CREATES a draft text document.

- Route: `/contracts/create` → `CreateContract.jsx`, **AdminRoute**-gated
  (OLD `client/src/App.jsx:186`, import at `:19`).
- Reached via Breadcrumb from Contracts (`CreateContract.jsx:86-89`).
- Carries a visible **"Work in progress"** amber badge (`CreateContract.jsx:81-84`)
  — OLD itself considered it unfinished.

## 2. OLD anatomy

Client — `client/src/pages/CreateContract.jsx` (238 lines):

- **Form state** (`:17-27`): `artist_name, type, royalty_split (default '80'),
  advance, territory (default 'Worldwide'), num_releases (free text, e.g. "3
  singles + 1 album"), duration_years (default '1'), notes, financial_terms[]`.
- **Constants** (`:8-9`): `CONTRACT_TYPES = Recording | Publishing | Distribution
  | Management | Licensing`; `TERRITORIES = Worldwide | North America | United
  States | Europe | United Kingdom | Asia | Latin America`.
- **Artist input** = free-text `<input list>` + `<datalist>` fed by
  `GET /artists?limit=500` (`:31-33`, `:103-116`) — typed names allowed, not FK-bound.
- **Financial Obligations repeater** (`:36-47`, `:166-190`): rows of
  `{label, amount (free text "$50,000 or 15%"), recoupable (checkbox, default
  true), note}`; Add/Remove per row; empty state says "AI will use standard terms".
- **Unsaved-changes warning**: `useUnsavedWarning(!!artist_name || !!advance ||
  !!notes)` (`:29`).
- **Generate** (`:49-61`): `POST /contracts/generate` with the whole form;
  disabled unless `artist_name && type`; loading state with "Reading existing
  contracts for reference" copy (`:222-227`).
- **Output pane** (`:213-233`): renders `data.text` in a `<pre>` (min-height
  600px); **Copy** to clipboard w/ 2s "Copied" flip (`:63-67`) and **Download**
  as `.txt` blob named `${type}_Contract_${artist}.txt` (`:69-75`). No save-to-DB,
  no PDF/Word — plain text only.

Server — `server/routes/contracts.js:787-869` `POST /api/contracts/generate`
(authMiddleware):

- 503 without `ANTHROPIC_API_KEY` (`:790-792`); 400 without artist+type (`:796-798`).
- **Reference pull** (`:800-824`): 5 most-recent **Active** contracts of the SAME
  type (`LOWER(c.type)` match, join `artists`), falling back to any 5 recent
  Active contracts when none match. Serialized into the prompt as one line per
  reference: royalty/advance/territory/releases + `financial_terms` JSON (`:826-828`).
- **Prompt** (`:830-857`): "music industry contract attorney drafting for Boom
  Records LLC" — hardcoded label name — with an 8-section required outline
  (parties, term/territory, obligations by type, financial terms, rights,
  termination, general provisions, signature blocks).
- `callClaude({ prompt, maxTokens: 4096 })`, returns raw text as
  `{ data: { text } }` (`:859-864`). No persistence, no audit log.

## 3. NEW status

**Absent — partial adjacent capability only.** Verified: NEW `client/src/App.jsx`
has no `/contracts/create` route and no CreateContract import (only `/contracts`
tracker at `App.jsx:150`; grep for `contract` across routes). NEW's only contract
AI is `POST /api/contracts/draft-clause` (`server/routes/contracts.js:24-26`) —
single-CLAUSE drafting inside the tracker, not full-document generation with
reference contracts, a terms form, or copy/download output.

## 4. Port requirements

- **No schema needed** — OLD is stateless (generates text, persists nothing).
- Endpoint: `POST /api/contracts/generate` in NEW `server/routes/contracts.js`,
  reusing NEW's `lib/claude.js` call pattern (degrade gracefully w/o key, as
  draft-clause already does). Reference query must be **label-scoped**
  (`WHERE c.label_id = $labelId`) — OLD is single-tenant and has no scope.
  Replace hardcoded "Boom Records LLC" with the label's name from `labels`.
- Page: `/contracts/create` behind AdminRoute; artist datalist from NEW
  `/api/artists`; NEW `ui/` kit (Card/Input/Select/Textarea/Button) replaces
  OLD's `input-base` classes; `useUnsavedWarning` has no NEW counterpart —
  either port the hook or accept the gap.
- Optional uplift a port should consider: NEW already lazy-imports `jspdf` +
  `docx` for the NDA builder — the same pattern would give PDF/Word download
  instead of OLD's `.txt` blob.

## 5. Defects

- [P2] Entire surface missing — AI full-contract generation page (`/contracts/create`); NEW has only single-clause drafting — fix: new page + `POST /contracts/generate` (label-scoped references, label-name substitution) (MED — OLD itself flagged it "Work in progress")

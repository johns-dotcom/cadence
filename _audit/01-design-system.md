# 01 — Design system comparison

OLD: `boom-dashboard/client` · NEW: `cadence/client`. Per-page passes must reference this file instead of re-reporting these token-level diffs.

## Verdict up front — the systemic root causes

| # | Root cause | Effect | Evidence |
|---|---|---|---|
| RC-1 | **NEW never loads the Inter webfont.** OLD imports it (`boom .../index.css:1` Google Fonts @import, weights 300–800); NEW's tailwind config lists `Inter` first in `fontFamily.sans` (`cadence client/tailwind.config.js:10`) but no `@import`, no `<link>` in `client/index.html`, no self-hosted files (grep verified). Every glyph in NEW renders in the system UI font. | App-wide typography difference on every page — letterforms, metrics, weights | P0, HIGH confidence |
| RC-2 | **Accent color**: OLD = hardcoded Boom red `#E52017` (`boom tailwind.config.js` `boom` scale + `--color-brand` in its tokens.css); NEW = runtime-brandable CSS-var scale defaulting to indigo `#4F46E5` (`cadence tokens.css:36-47`, `utils/branding.js`). | Every primary button, active nav item, focus ring, link, chart accent | **Intentional divergence** (multi-tenant branding) — but the *default* palette differs, so out-of-box the apps look unrelated |
| RC-3 | **Micro-typography density**: OLD uses bracket sizes heavily — `text-[11px]`×691, `text-[10px]`×682, `text-[12px]`×245, `text-[13px]`×196 (grep across pages+components); NEW: `[11px]`×242, `[10px]`×181, `[13px]`×9, `[12px]`×0-ish. OLD is a denser UI with more sub-12px metadata text. | Meta lines, chips, table sublabels read larger/sparser in NEW | P1 pattern, HIGH |
| RC-4 | **Icon sizing**: OLD modal sizes 13/14/12/11 (289/207/198/144 uses); NEW 15/13/14/16 (162/134/125/71). NEW icons average ~2px larger. | Denser toolbars/rows in OLD | P2 pattern, HIGH |
| RC-5 | **Button/input paddings**: OLD `.btn-primary`/`.btn-secondary`/`.input-base` use `py-2`; NEW `.btn-primary`/`.btn-secondary`/`.input` use `py-2.5` (OLD `index.css:44-63`; NEW `index.css:21-44`). OLD `ui/Input` is fixed `h-9`; NEW has no fixed height. | Every button and field is ~4px taller in NEW | P1 pattern, HIGH |
| RC-6 | **Card radius**: OLD `ui/Card` = `rounded-xl` (0.75rem); NEW `.card` class + `ui/Card` = `rounded-2xl` (1rem) (`cadence index.css:17`). | Every card corner in NEW is rounder | P2 pattern, HIGH |

## Tailwind config

| Item | OLD | NEW | Note |
|---|---|---|---|
| darkMode | `'class'` | `'class'` | same |
| fontFamily.sans | Inter-first stack | identical string | but see RC-1 — NEW never loads Inter |
| Accent palette | `boom` 50–950 hardcoded hex + `brand/brand-hover/brand-active/brand-muted` CSS vars | `brand` 50–950 via `rgb(var(--color-brand-N))` + `brand.ink` | RC-2; NEW lacks OLD's `brand-muted` alias |
| gray palette | var-backed triplets (identical mechanism) | identical | shared DNA |
| surface scale | `surface.0/50/100/200` | identical | |
| Semantic aliases | page/card/elev/sidebar/header, ink/-muted/-faint, rule/-light/divider, **row/row-hover, input-bg/-border/-text, th-bg/th-text**, success/warning/danger/info, **alert/alert-bg/alert-bd, diff/diff-bg/diff-bd**, overlay | page/card/elev/sidebar/header, **selected**, ink triple, rule triple, success/warning/danger/info, overlay | OLD-only: row*, input*, th*, alert*, diff* (used by tables/inputs/flag UIs). NEW-only: `bg-selected` |
| boxShadow ext | xs/card/elevated/modal — identical values | identical | |
| borderRadius ext | xl 0.75rem / 2xl 1rem — identical | identical | |
| plugins | `[]` | `[]` | |
| breakpoints | defaults (no extension) | defaults | responsive split differs in practice: OLD sidebar breakpoint 1023px + mobile cards <768px; NEW same convention |

## Tokens (styles/tokens.css)

| Token | OLD | NEW | Δ |
|---|---|---|---|
| --color-bg-page | `#f4f4f4` | `#f4f4f5` | 1-step hue drift; BUT OLD `body` actually uses `bg-surface-50` = **#F9FAFB** (`index.css:10`) while NEW body uses `bg-page` = #f4f4f5 → **real page background differs** (lighter in OLD) |
| --color-bg-card / elev / sidebar / header | #ffffff / #fafafa / #ffffff / #ffffff | identical | |
| --color-border | `#e2e2e2` | `#e4e4e7` | slight |
| --color-text | `#111111` | `#18181b` | slight; OLD body also sets `text-gray-900` (#111827-equivalent via vars) |
| --color-text-muted | `#777777` | `#71717a` | slight |
| --color-text-faint | #9ca3af | #a1a1aa | slight |
| success/warning/danger/info | #059669/#d97706/#dc2626/#2563eb | identical | |
| OLD-only vars | --color-row, --color-row-hover, --color-input-bg/-border/-text, --color-th-bg/-text, --color-brand(+hover/active/muted), --color-focus-ring, rose/diff sets | — | consumers: tables (th-bg), ui/Input, focus rings |
| NEW-only vars | --color-brand-50…950 triplets, --color-brand-ink (dark-flips to 400), --color-bg-selected (opaque color-mix) | — | intentional (runtime branding) + selection tint |
| Dark strategy | tokens **plus** a 200-line legacy `.dark … !important` override layer for raw utilities (`index.css:338-540`: bg-white, hover:bg-*-50 variants, boom-tinted washes) | tokens only (`tokens.css .dark` block); raw-utility pages rely on the var-backed gray palette | NEW pages using raw `bg-white` would break in dark — NEW avoided raw colors instead. Dark parity `UNVERIFIED — needs runtime check` |

## Global CSS

- OLD `@layer base`: `body { font-sans antialiased text-gray-900 bg-surface-50 }` + **custom 6px scrollbar** (`index.css:13-27`). NEW: `html { font-family }`, `body { bg-page text-ink antialiased }`, **no scrollbar styling** — NEW shows default scrollbars (P2).
- OLD component classes: `.input-base`, `.select-base`, `.btn-primary`, `.btn-secondary` (+ badge classes further down). NEW: `.card`, `.btn-primary`, `.btn-secondary`, `.input`, `.label`.
  - `.btn-primary`: OLD `font-medium … py-2 … hover:bg-boom-700 active:bg-boom-800 transition-all duration-150 disabled:opacity-50`; NEW `font-semibold … py-2.5 … hover:bg-brand-700` (no active state) `transition-colors disabled:opacity-40`. Weight, height, active state, disabled opacity, transition scope all differ.
  - `.btn-secondary`: OLD `text-gray-700 bg-card … hover:bg-gray-50 active:bg-gray-100`, **no focus ring**; NEW `text-gray-600` (no bg) `hover:bg-gray-50 hover:text-gray-900 focus-visible:ring-2 ring-brand-400`, no active state.
  - Inputs: OLD `.input-base` `py-2`, `focus:ring-boom-600/20 focus:border-boom-500`, `transition-all duration-150`, `placeholder:text-gray-400`; NEW `.input` `py-2.5`, `focus:ring-brand-400` (opaque ring, no border shift), no transition.
  - `.label` exists only in NEW (uppercase 12px tracking-wide); OLD labels are ad-hoc per page.
- NEW-only: `.skeleton-shimmer` keyframes (+dark variant), `.animate-sheet-up`, `.safe-bottom/.safe-top`, mobile `min-height:40px` for buttons/inputs under 768px (OLD achieves touch targets differently — per-page).

## Shared UI primitives (components/ui/)

| Primitive | OLD | NEW | Differences |
|---|---|---|---|
| Button | variants primary/secondary/ghost/danger; `font-medium`; ring `var(--color-focus-ring)`; secondary/ghost hover `bg-row-hover`; disabled 50 | same variants; `font-semibold`; ring `brand-400`; hover `bg-gray-50`; disabled 40; primary uses 600/700/800 scale vs OLD brand vars | weight, ring color source, hover surface, disabled opacity |
| Input | fixed `h-9`, `bg-input-bg text-input-text border-input-border`, `placeholder:text-ink-faint`, `focus:border-brand` + ring var | no fixed height (`py-2.5`), `bg-card text-ink border-rule`, `placeholder:text-gray-400`, ring `brand-400`, **no focus border shift** | height, token family, placeholder token, focus treatment |
| Card | `rounded-xl`, header/footer slots | `rounded-2xl`, same slots | radius (RC-6); slot padding comparison `UNVERIFIED` (read both fully in a page pass if it matters) |
| Badge | tones success/warning/danger/info/neutral; neutral = `bg-rule-light` | same tones; neutral = `bg-gray-100`; danger/info tint alphas 0.1 vs 0.10 (equal) | neutral tone surface differs in dark (rule-light var vs gray-100 var) |
| Select / Textarea | present | present (NEW Select draws its own SVG caret + `appearance-none`) | caret rendering differs — OLD `UNVERIFIED` whether native caret |
| BottomSheet | present | present (`useEscapeStack`, 85dvh, sheet-up animation) | behavior parity `UNVERIFIED` |
| Modal / ConfirmDialog | **absent from kit** — OLD uses ~35 hand-rolled `fixed inset-0` overlays per page | present (portalled, focus-trapped, escape-stacked, scroll-locked) | NEW is architecturally ahead; visual parity of individual dialogs checked per page |
| Showcase | present (component gallery) | absent | dev-only surface |
| ReviewDeck | OLD `components/ReviewDeck.jsx` (deck shell + DeckButton, used by 5 flows) | NEW `components/ReviewDeck.jsx` (added 2026-08-27; simpler: progress bar + done panel, no DeckButton primitive) | NEW deck lacks OLD's DeckButton tone/size/hover-label primitive and per-flow variants |

## Icon library

Both use `lucide-react`, sized via `size={n}` props. Distribution differs (RC-4). No default-size wrapper on either side.

## Layout shell

| Metric | OLD (`Layout.jsx`) | NEW (`Layout.jsx`) |
|---|---|---|
| Sidebar width | `w-60` (:586) | `w-60` (:322) — same |
| Logo row | `h-16 px-5 border-b` (:589) | identical (:325) |
| Header | `h-14 px-4 lg:px-6 border-b bg-header` (:843) | identical (:428) |
| Content | `max-w-7xl mx-auto px-4 py-6 pb-20 sm:px-6 sm:py-8 sm:pb-8` (:903) | `… pb-20 lg:pb-8` (:482) — bottom padding released at `lg` instead of `sm` (mobile BottomNav clearance kept longer in NEW; matches NEW's 1023px mobile shell) |
| Legacy colors | OLD dropdown at :324 still uses raw `bg-white border-gray-200 shadow-lg` | NEW tokenized `bg-card border-rule shadow-modal` (:117) — NEW is the *corrected* form; not a defect |

## Typography scale in practice
See RC-3 histogram. Additional note: OLD uses `text-[9px]`×47 (dense uppercase chips); NEW ×9. Per-page passes should flag rows/chips where OLD uses a bracket size and NEW substituted `text-xs`.

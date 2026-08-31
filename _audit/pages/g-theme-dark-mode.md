# g-theme-dark-mode — toggle, persistence, dark rendering end-to-end (global surface)

OLD: `boom-dashboard/client/src/context/ThemeContext.jsx` + `main.jsx:11-16` pre-render guard + `styles/tokens.css` dark block + a **97-selector `.dark … !important` override layer** (`index.css:334-540`) + `utils/darkColors.js` JS mirror (9 inline-styled page consumers) + 39 `dark:` utility sites.
NEW: `cadence/client/src/context/ThemeContext.jsx` + `main.jsx:12-15` guard + `styles/tokens.css:78-117` dark block — tokens ONLY: zero `dark:` variants, zero override layer, no JS mirror (grep verified).

Route & permissions: global surface — theme is per-browser (localStorage), not per-user/server.

Mechanism-level token diffs are RC-covered in `_audit/01-design-system.md` (Tokens table "Dark strategy" row); this pass focuses on OUTCOMES.

## 1. Layout & structure (the mechanism, briefly)

Identical skeleton on both sides: `localStorage.getItem('theme') || 'light'` (OLD ThemeContext.jsx:6 / NEW :6), `.dark` class on `<html>` (OLD :10-15 / NEW :8-12), pre-render guard in main.jsx so reloads don't flash (OLD main.jsx:11-16 / NEW main.jsx:12-15 — NEW also pre-applies the brand accent). **Neither side defaults to `prefers-color-scheme`** — parity, not a defect. Neither has an index.html inline script; both guards run in the module graph before first paint — parity.

Where they part: OLD paints dark through three cooperating layers — (1) the var-backed token palette, (2) the 97-selector `.dark !important` compatibility layer for raw Tailwind utilities (index.css:334-540: `.bg-white`→#1c1f2b :359, hover brighteners :363-371, amber/orange/red/rose/boom/blue/emerald tint remaps to 0.06-0.12 alpha :388-440, text pushed to the -400 tier, ring-*-200 chip outlines, element-level inputs, dark scrollbar :538-540), and (3) `getDarkColors()` for inline-styled pages (darkColors.js:10-40, mirrors tokens exactly). NEW keeps only layer (1) and instead *avoided* raw colors in most new code — but not everywhere (§4).

## 2. Visual differences

- **Dark palette values are identical** OLD↔NEW: page #131520, card #1c1f2b, elev #232734, border #2e3340, text #e0e2e8, muted #8a8f9f, faint #555b6e, statuses 34d399/fbbf24/fca5a5/60a5fa (OLD tokens.css:95+ / NEW tokens.css:79-103). Same repaint lineage — no drift in the base theme.
- Toggle button: visually equivalent header pill w/ Sun/Moon 13 (OLD Layout.jsx:879-886 / NEW Layout.jsx:456-461; NEW also in PlatformLayout.jsx:126-128 — operator console, [INT]).
- NEW-only dark refinements: `--color-brand-ink` flips 600→400 (tokens.css:53,:88 — brand-600 is 2.6:1 on the dark card), `--color-bg-selected` mixes heavier in dark (:91), skeleton-shimmer dark variant (index.css per 01-design-system). Improvements, keep.

## 3. Copy & content differences

- OLD Settings has a **Theme tab** — Light/Dark cards w/ icon, desc, Active chip (Settings.jsx:1515-1558; tab registered :1896). NEW Settings has no appearance section (grep "Theme|Appearance" — only accent-color branding at :104-115); the header pill is NEW's only in-tenant toggle.
- `<meta name="theme-color">`: OLD #E52017 / NEW #4F46E5 (index.html:7 both) — RC-2 branding, [INT]; static (doesn't flip with dark) on both sides — parity.

## 4. Feature & interaction differences — dark OUTCOMES in NEW

### 4a. The collapsed gray tier (verified)

`cadence tokens.css:105-106`: in `.dark`, `--color-gray-50: 31 34 44` and `--color-gray-100: 31 34 44` — **the same color**, #1f222c, against card #1c1f2b (:80) — a 3/channel delta, imperceptible. Grep counts today: **74 `hover:bg-gray-50`** and **107 `bg-gray-100`** sites in pages+components. Every hover affordance and resting gray fill built on those utilities is near-invisible in dark. OLD's palette collapses the same two tiers (boom tokens.css:149-150, annotated as mirroring the legacy rules :140-141) **but OLD compensates**: `.dark .hover\:bg-gray-100:hover { background: #2a2e3c !important }` (index.css:363) keeps the hover tier visibly brighter than rest. NEW has no compensation anywhere. (CLAUDE.md itself logs this as a known issue awaiting a Badge re-audit.)

### 4b. Raw colored tints with no dark remap

NEW contains **213 literal Tailwind `-50`/`-100` tint sites across 59 files** (bg/border/ring on red/rose/amber/orange/emerald/sky/blue/violet/indigo…, grep verified; top: `bg-amber-100`×33, `bg-emerald-100`×28, `bg-amber-50`×23, `bg-emerald-50`×21, `bg-red-50/100`×36). Only gray + brand are var-backed in NEW's tailwind config, so all of these render their light-theme pastels on dark cards (e.g. the Ledger mobile expense card `bg-sky-50/70 border-sky-200`, Ledger.jsx:439; every status pill/badge tint). OLD remaps every one of these families in the dark layer to low-alpha washes and pushes `-600/-700` text to the `-400` tier "so dollar amounts and pill text stay legible without visually screaming" (index.css:388-440). Chips stay *legible* in NEW (dark text on light chip) but the dark theme reads patchwork. `UNVERIFIED — needs runtime check` for which specific sites are worst; the class inventory is verified.

### 4c. brand-50 washes (the 1.14:1 failure class)

The brand scale is deliberately identical across themes (tokens.css:30-34), so `bg-brand-50` = #eef2ff (near-white) in dark. The 2026-08-12 pass fixed five mywork sites after measuring `text-ink` on it at **1.14:1**, but **58 `bg-brand-50/100` sites remain** (grep), including three bulk-action bars styled `bg-brand-50 border-brand-200` with default ink text: Payments.jsx:249, BankMatching.jsx:209, BankStatements.jsx:290 — in dark these are near-white bars with near-white text. Calendar event chips (Calendar.jsx:11-17) and Releases calendar pills (Releases.jsx:173) pair `text-brand-700` with it — legible but light-boxed.

### 4d. Charts (Recharts)

OLD themes its charts: tokenized `CustomTooltip` on `bg-card border-rule` (Dashboard.jsx:180-193), explicit axis tick fills `#9CA3AF` readable on both themes (:616,:621), bordered `contentStyle` (:662). NEW uses **default `<Tooltip />`** — white box, light border, dark text — in dark mode a glaring light popup (Dashboard.jsx:119,:131; Financials.jsx:136,:154; Payments.jsx:484 sets contentStyle radius/size but no background) and default tick fill (#666 on #131520 ≈ 2.8:1) with no `fill` specified (Dashboard.jsx:119 `tick={{ fontSize: 10 }}`). Series colors DO use brand vars (`rgb(var(--color-brand-500))`) — that part is theme-safe.

### 4e. Scrollbars

OLD: 6px styled scrollbar light (index.css:13-27) + dark track/thumb overrides (:538-540). NEW: no scrollbar CSS at all — default (light-styled in some browsers) scrollbars in dark. Already logged as P2 in 01-design-system Global CSS; the dark half is part of the same fix.

### 4f. Inline-styled surfaces / JS mirror

OLD ships `getDarkColors()` for its 9 inline-styled bookkeeping pages (darkColors.js:1-8 doc). NEW has no mirror — by design its pages are className-styled with tokens, and the few inline styles found are theme-neutral (drag shadows, widths) or deliberate (Brand.jsx image-overlay `bg-white/90` chips :139-141; EmailPreviewModal iframe forced white :84 — an email canvas, correct in both themes). No defect, provided future inline-styled ports use tokens.

## 5. Data layer differences

None — theme never touches the server on either side. Same localStorage key `theme`, same values `light|dark`, so a boom→cadence browser migration would even carry the preference over.

## 6. Tables & forms (if present)

N/A — covered per-page; the systemic dark issues above (4a-4c) are what per-page passes should reference instead of re-reporting.

## 7. Defects found

1. **P2** — Dark gray tiers collapsed with no hover compensation: `--color-gray-50` == `--color-gray-100` == #1f222c on card #1c1f2b (tokens.css:105-106 vs :80) kills 74 `hover:bg-gray-50` + 107 `bg-gray-100` sites; OLD keeps the affordance alive via `.dark .hover\:bg-gray-100:hover{#2a2e3c}` (boom index.css:363) — fix: split the two tiers in tokens.css:105-106 (e.g. 50→#232734-adjacent) or add the hover-brightener; CLAUDE.md notes a Badge neutral-tone re-audit rides on this. (HIGH)
2. **P2** — 58 `bg-brand-50/100` sites render near-white in dark (brand scale theme-stable by design, tokens.css:30-34), incl. three bulk bars with ink-on-brand-50 text ≈1.14:1: Payments.jsx:249, BankMatching.jsx:209, BankStatements.jsx:290 — fix: `bg-brand-500/10-15` pattern the mywork pass already established. (HIGH for the three bars; MED for the chip sites)
3. **P2** — 213 raw colored `-50/-100` tint sites across 59 files have no dark remap (NEW has no override layer and only gray/brand are var-backed) vs OLD's alpha-wash + -400-text dark layer (boom index.css:388-440) — fix: either extend tokens/tailwind with var-backed status-tint utilities or port a minimal `.dark` remap block; per-site severity `UNVERIFIED — needs runtime check`. (HIGH that the classes render light tints; MED on user impact)
4. **P2** — Recharts dark: default white `<Tooltip />` and unset tick fills in dark (Dashboard.jsx:119,:131; Financials.jsx:136,:154; Payments.jsx:484) vs OLD's tokenized CustomTooltip + explicit tick fills (boom Dashboard.jsx:180-193,:616-624) — fix: shared tooltip component on `bg-card` + `tick={{ fill: 'var(--color-text-faint)' }}`. (HIGH)
5. **P3** — Settings Theme tab missing (OLD Settings.jsx:1515-1558; NEW has only the header pill, Layout.jsx:456-461) — fix: add an Appearance section to cadence Settings.jsx. (HIGH)
6. **P3** — Dark scrollbar styling absent (OLD index.css:538-540; NEW none) — counted with 01-design-system's scrollbar P2; the fix should include the `.dark` variants. (HIGH)

Intentional divergences (not defects): tokens-only architecture itself (NEW deliberately dropped the `!important` layer and `dark:` variants — 0 vs OLD's 39 — and mostly avoided raw colors; the defects above are where "mostly" leaks), `--color-brand-ink` 600→400 flip + heavier `bg-selected` mix in dark (NEW-only improvements), PlatformLayout toggle (operator console is NEW-only), theme-color meta hue (RC-2 branding), accent pre-apply in the FOUC guard (multi-tenant branding).

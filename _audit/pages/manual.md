# Manual

## 1. Files compared (purpose & pairing)

- OLD: `boom-dashboard/client/src/pages/UserManual.jsx` (790) at `/manual` (boom App.jsx:174, OUTSIDE the Layout shell), opened in a new tab from the header book button (boom Layout.jsx:869 `window.open('/manual','_blank')`). A **printable, permission-personalized document**: cover, TOC, ~34 per-page articles, 6 cross-page workflows, keyboard-shortcut reference. No server route.
- NEW: `cadence/client/src/components/UserManual.jsx` (167) — a slide-over drawer mounted in Layout (cadence Layout.jsx:447-452,492) AND routed at `/manual` via a `ManualPage` wrapper (cadence App.jsx:87-90,172). Content in `client/src/constants/manual.js` (194: 27 sections, `buildManual` at :181-193). NEW adds a server route: `POST /api/manual/ask` — AI help scoped to the user's accessible pages (cadence server/routes/manual.js:11-36).
- **The task brief's premise is disproven: NEW's `/manual` EXISTS.** Cadence CLAUDE.md's "Optional polish only: the `/manual` page" / "User manual /manual — MISSING" claims are stale and should be corrected in that file. There is no "entire page missing" P1.
- Design-system deltas covered by RC-1..RC-6 in `_audit/01-design-system.md` (note: OLD's manual is deliberately OUTSIDE the app shell with its own inline styles + system font stack, UserManual.jsx:600, so RC-1/RC-2 apply differently here — OLD's manual itself never used Inter either).

## 2. Route & permissions

| | OLD | NEW |
|---|---|---|
| Client route | `/manual` before the Layout wrapper — full standalone page, any logged-in user (boom App.jsx:174); logged-out visitors get a login link (UserManual.jsx:590-596) | `/manual` inside the Layout shell rendering the drawer with `open` forced, close = `navigate(-1)` (cadence App.jsx:87-90,172); plus the header BookOpen button opens it in place (Layout.jsx:447-452) |
| Content gating | live-refetched permissions: `/auth/me` on mount/window-focus/`boom_permissions_updated` storage signal + manual Refresh button; default-CLOSED canView mirror for null perms incl. Approver bk-surface fallback (UserManual.jsx:503-543,545-566) | AuthContext `canView` snapshot + role/department (components/UserManual.jsx:10,20-23; constants/manual.js:181-186) |
| Server | none | `/api/manual/ask` auth + withTenant, 503 without an AI key, 500-char question cap, system prompt confines answers to the user's page list (manual.js:11-31) |

## 3. Server/API diff

- OLD: no API — the manual is fully client-composed. No differences to diff except NEW's addition:
- NEW `POST /manual/ask` [INT/NEW-only]: role/department/pages taken from the request body (self-reported), not re-derived server-side — a user could name pages they can't access to steer answers. Harmless (help text only, no data access; answers come from the model, not tenant data) — noted, not counted.

## 4. UI structure diff

- OLD (document order): sticky action bar — Close, "Boom.Records Dashboard — User Manual" + permission Refresh button, red **Save as PDF** print button (UserManual.jsx:622-666) → cover block: brand kicker, "User Manual", "Prepared for {name} · {role} · {department}", generated date (:668-680) → intro paragraph (:683-690) → **Contents** list w/ per-group page counts (:693-712) → grouped page articles (General/Artists/Releases/Contracts/Finance…/Team/Admin), each: title + monospace route path chip, intro sentence, 3–7 task bullets (:715-741), optional per-user override callout box (:744-767 region) → **Common workflows** — 6 numbered cross-page procedures, shown only if the user can view every required page (:398-462,741-758) → **Keyboard shortcuts** — grouped kbd tables mirroring the `?` modal, permission-filtered (:366-395,760-786) → footer colophon (:788-791). Full print stylesheet: `@page` margins, page-break rules, no-print bar (:604-620).
- NEW (drawer order): header "Your manual · Tailored for {first} · {role} · {dept}" + close (components/UserManual.jsx:93-102) → **Ask about your workspace** AI box (:105-120) → **search input** filtering title/summary/steps (:25-29,122-126) → **"Start here for {department}"** — up to 4 department-matched section cards (:136-148; constants/manual.js:186-187) → grouped accordion sections (Getting started / Artists & releases / Marketing / Finance / Contracts & legal / Workspace), each: title, summary, numbered steps, role-filtered 💡 tips (:56-87,151-156) → footer "Showing the N areas you can access · press ? for shortcuts" (:161-163).
- Coverage: OLD 34 articles vs NEW 27 sections (constants/manual.js:15-179); NEW omits the route-path chip per article. Content prose is Cadence-specific throughout — [INT].

## 5. Behavior/interactions diff

- Personalization: both filter to `canView`-visible pages (OLD :545-566,570-585; NEW manual.js:181-186). OLD additionally live-refetches permissions (mount/focus/cross-tab) so a just-saved grant updates an already-open tab (:503-543); NEW trusts the login-time AuthContext snapshot.
- OLD per-user `USER_OVERRIDES` (name-keyed extra guidance, e.g. bradley's ingestion runbook, :466-489) — [INT] dropped: single-tenant personal content, not portable to multi-tenant.
- OLD print → PDF via `window.print()` with full print CSS (:604-666). NEW: no print/export path at all; the drawer's `max-w-md` column (components/UserManual.jsx:91) can't produce a handout.
- NEW-only: text search with match list + "No help topics match" (:26-29,128-132); click-to-open + smooth-scroll section deep link (:32-36); AI Q&A w/ loading/error/graceful-503 states (:38-52,105-120).
- NEW `/manual` visited directly in a fresh tab: `navigate(-1)` has no history to pop, so Close appears to do nothing — minor; `UNVERIFIED — needs runtime check`.

## 6. Visual/design diff

- Deliberately different genres: OLD = print-styled letter document (white article card, `maxWidth: 820`, boom-red `#E52017` rules/headings — RC-2's hardcoded accent, inline styles throughout); NEW = in-app drawer using the token system (`bg-card`, `border-rule`, `brand-*` step chips, amber tip boxes).
- NEW section typography sits in RC-3's sparser register (`text-[13px]` body, `text-[11px]` meta) — actually one of the few NEW pages matching OLD's density.
- OLD kbd styling (:770-781) has no NEW equivalent (section absent).

## 7. Defect table

| Sev | Defect | Evidence | Conf |
|---|---|---|---|
| P2 | Print / Save-as-PDF handout capability gone: OLD was a print-formatted document (print CSS, @page, page-break rules, Printer button); NEW drawer has no export path | components/UserManual.jsx:89-166 (nothing) vs OLD UserManual.jsx:604-666 | HIGH |
| P2 | "Common workflows" section gone — 6 cross-page numbered procedures (vendor invoice→payment, recoupment cutoff, review flow, etc.), permission-filtered via `requires.every(canView)`; NEW sections are per-page only | constants/manual.js:15-179 (no workflow entries) vs OLD UserManual.jsx:398-462,741-758 | HIGH |
| P3 | Keyboard-shortcuts reference section gone (permission-filtered kbd tables); NEW only footnotes "press ?" — mitigated by the existing ? modal but the printable/consolidated reference is lost | components/UserManual.jsx:162 vs OLD UserManual.jsx:366-395,760-786 | HIGH |
| P3 | Live permission refresh dropped: OLD refetched /auth/me on mount/focus/cross-tab signal + Refresh button so open manuals track permission edits; NEW renders from the AuthContext snapshot | components/UserManual.jsx:10,20-23 vs OLD UserManual.jsx:503-543 | MED |
| P3 | Document furniture gone: cover block w/ generated date, Contents/TOC with per-group counts, per-article monospace route chip, footer colophon (NEW keeps only the name/role/dept header line) | components/UserManual.jsx:93-99 vs OLD UserManual.jsx:668-712,721-724,788-791 | HIGH |

Intentional divergences:
- [INT] Stale-doc correction, not an app defect: cadence CLAUDE.md still lists `/manual` as missing/optional — it shipped (cadence App.jsx:172; components/UserManual.jsx; server/routes/manual.js).
- [INT] Content rewritten for Cadence's routes/features and reduced 34→27 sections (branding/product divergence; boom-specific pages like /bk/*, QB Import, Bulk Re-upload have no NEW equivalents to document).
- [INT] Per-user USER_OVERRIDES (named-employee guidance) dropped — single-tenant personal content (OLD UserManual.jsx:466-489).
- [INT] NEW-only enhancements: manual search, AI "Ask about your workspace" (`/api/manual/ask`, key-gated 503 fallback), department-based "Start here" recommendations, role-filtered tips (components/UserManual.jsx:25-52,105-148; constants/manual.js:181-193).
- [INT] Delivery surface: standalone printable tab → in-app drawer + routed page (dual access via header button and /manual).

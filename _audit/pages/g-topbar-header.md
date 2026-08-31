# g-topbar-header — top header bar (global shell surface)

OLD: `boom-dashboard/client/src/components/Layout.jsx` (:818-901 banners + header; RequestModal :100-264; ViewAsDropdown :266-355)
NEW: `cadence/client/src/components/Layout.jsx` (:419-463 header; announcements :466-481; ViewAsDropdown :69-151)

Route & permissions: global surface — rendered on every authenticated page. ViewAs dropdown is Superadmin-only on both sides (OLD :306 / NEW :102).

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md` (header geometry `h-14 px-4 lg:px-6 border-b bg-header` is identical — 01-design-system.md:80). The global search TRIGGER change is described here but its defect is counted once under `g-global-search.md`.

## 1. Layout & structure

**OLD** (:843-901), left→right: [mobile hamburger] → **persistent GlobalSearch input** (inline, `max-w-md`, fills the left) → NotificationBell → ViewAs (hidden <sm) → Keyboard-shortcuts button (hidden <sm) → Manual button (opens `/manual` in a new tab, hidden <sm) → Theme toggle → **Request button** (hidden while impersonating, opens RequestModal). **No page title.** Above the header, two conditional full-width banners: amber impersonation banner (:820-834) and violet demo-mode banner for `is_test` users (:836-841).

**NEW** (:428-463), left→right: [mobile hamburger] → **`h1` page title** from PAGE_LABELS (:434) → spacer → **Search button** (icon + "Search" + `⌘K` kbd, opens the modal palette, :437-445) → Manual button (opens the in-app UserManual modal, :446-452) → NotificationBell (:453) → ViewAs (`block` while impersonating, else hidden <sm, :455) → Theme toggle (:456-462). No banners above the header — the impersonation banner was deliberately removed (comment :421-425); instead a dismissible **platform-announcements banner stack** renders inside `<main>` (:466-481).

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Header bar | `h-14 gap-3 px-4 lg:px-6 border-b bg-header` | identical | OLD :843 / NEW :428 |
| Left slot | search input `w-full max-w-md pl-9 py-2 bg-gray-50 border rounded-lg` | `h1 text-sm font-semibold text-ink` page title | OLD :203-214 (GlobalSearch) / NEW :434 |
| Bell trigger | borderless `p-2 rounded-lg`, Bell 18 strokeWidth 1.75 | bordered `p-1.5 border-rule`, Bell 15 | OLD NotificationBell.jsx:178-184 / NEW NotificationBell.jsx:62-67 |
| Button family | `text-xs font-semibold px-3 py-1.5 rounded-lg border-gray-200`, icons 13 | same recipe on `border-rule`; search button `px-2.5 text-xs font-medium` w/ icon 14 + kbd chip; manual `p-1.5` icon 15 | OLD :857-899 / NEW :437-462 |
| Impersonation state | full-width `bg-amber-400` banner (Eye 13, "Viewing as **{name}** ({role} · {dept}) — this is their exact view", Exit w/ X 12) PLUS header Exit button | header "Exit — back to {admin}" button only (amber pill) | OLD :820-834,:293-303 / NEW :91-100,:421-425 |
| Demo-mode banner | violet `bg-violet-600` bar w/ "Demo Mode" chip for `user.is_test` | none | OLD :836-841 / NEW — **[INT]** test users scoped out of Cadence |
| Announcements | none | per-level tinted bars (critical red / warning amber / info brand) w/ Megaphone 15 + dismiss X | NEW :466-481 — **[INT]** platform feature |
| Hamburger | `p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100`, Menu 20 | `p-1.5 text-gray-500 hover:bg-gray-100`, Menu 20 | OLD :845-852 / NEW :429-433 — parity |

ViewAs dropdown internals are near-identical (w-56 panel, "View dashboard as…" header, avatar rows w/ role · department; OLD :308-353 / NEW :104-149); NEW adds an empty state "No other members yet." (:142-144) and tokenized panel colors (01-design-system.md:82).

## 3. Copy & content differences

- OLD header carries no page title; NEW titles every route from PAGE_LABELS (:23-66) — several labels differ from OLD's map for shared pages (OLD "Artist Roster"/"Release Tracker"/"Activity History" :40,:43,:55 vs NEW "Roster"/"Releases"/"Activity" :48,:45,:62), only visible in NEW since OLD never displays them.
- Search affordance copy: OLD placeholder "Search..." + ⌘K kbd inside the field (GlobalSearch :210,:224-226); NEW button "Search" + `⌘K` kbd + title "Search (⌘K)" (:439-444).
- Impersonation copy: OLD banner sentence w/ role + department (:825); NEW only "Exit — back to {name}" (:97).
- Request flow copy (Send a Request, 4 request types w/ descriptions, "Submitting as…", :93-98,:136-241) has no header analog in NEW — relocated to the `/requests` page.
- Theme toggle: identical icons (Sun/Moon 13) + title strings; OLD adds `aria-label` (:882), NEW has title only (:458).

## 4. Feature & interaction differences

### Features in OLD missing/changed in NEW
- **Impersonation banner** removed (deliberate per NEW comment :421-425): OLD pairs the header Exit button with a persistent full-width amber banner naming the impersonated user, role and department (:820-834). NEW compensates by force-showing the Exit button on mobile (`impersonating ? 'block' : 'hidden sm:block'`, :455 — OLD hides ViewAs entirely <sm while impersonating, :855, leaving mobile with only the banner's Exit). Net: NEW mobile keeps an exit OLD lacked, but loses the who/role/department context everywhere.
- **Keyboard-shortcuts header button** (:857-866, toggles KeyboardShortcutsHelp) gone; the `?` hotkey remains on both sides (OLD :431-438 / NEW :174) and both mount the same modal (OLD :910 / NEW :491) — the discoverable affordance is what's lost.
- **Request button + RequestModal** (:887-900,:100-264 — type-card picker, submitting-as block, EmailPreviewModal handoff, suppressed while impersonating) removed from the header; NEW's analog is the nav-level `/requests` page (Layout.jsx:303). Header quick-compose from any page is lost.
- **Manual**: same BookOpen trigger position, but OLD opens the printable `/manual` page in a new tab (:869); NEW opens an in-app modal (`UserManual`, :447,:492) — page-level differences adjudicated in `manual.md`.
- **Search trigger**: persistent inline input (focusable via ⌘K and `/`) → compact button opening a modal (defect counted in g-global-search).

### NEW-only additions (not defects)
- Page title `h1` (:434) — OLD's header has no title/breadcrumb at all.
- `g`-prefixed quick-nav hotkeys `g d/r/a/c/w` + ⌘K handled at the Layout level (:167-184); OLD's Layout handles only `?` (search shortcuts live inside GlobalSearch).
- Announcements banner stack + dismiss endpoint (:196-202,:466-481) — **[INT]** platform feature.
- `ErrorBoundary` around the outlet keyed by pathname (:483).

### Content column
Both `max-w-7xl mx-auto px-4 py-6 sm:px-6 sm:py-8`; bottom padding released at `lg` in NEW vs `sm` in OLD (01-design-system.md:81 — matches NEW's 1023px mobile shell; not re-counted).

## 5. Data layer differences

- OLD shell posts `POST /analytics/pageview` on every route change w/ dedup (:388-394) — absent in NEW; already counted in `missing--analytics.md`.
- NEW shell fetches `GET /announcements/active` + `POST /announcements/:id/dismiss` (:196-202) — **[INT]** platform feature.
- ViewAs both load `GET /auth/users` lazily on open (OLD :281-291 / NEW :82-89) — parity.

## 6. Tables & forms (if present)

Only form on this surface is OLD's RequestModal (type cards + subject input + details textarea + gray-900 submit, :177-243) — removed from the header (see §4/§7-3).

## 7. Defects found

1. **P2** — Impersonation "Viewing as" banner removed: no persistent indicator of whose view/role/department is active while impersonating — only the header Exit pill's name survives (OLD Layout.jsx:820-834 / NEW :421-425,:455) — fix: cadence Layout.jsx:426 restore the amber banner (keep NEW's force-shown mobile Exit). (HIGH)
2. **P3** — Keyboard-shortcuts header button missing; `?` is now the only way to discover the shortcuts modal (OLD :857-866 / NEW :174,:491) — fix: cadence Layout.jsx:446 add the Keyboard button. (HIGH)
3. **P3** — Header Request quick-compose removed (button + RequestModal + EmailPreviewModal handoff + impersonation suppression, OLD :887-900,:100-264); NEW's `/requests` nav page covers the capability but not the from-any-page affordance w/ current-page context — fix: header button opening the requests composer prefilled with PAGE_LABELS[pathname]. (MED)
4. **P3** — Manual opens an in-app modal instead of the printable `/manual` page in a new tab (OLD :869 / NEW :447,:492) — trigger parity, behavior differs; page content adjudicated in manual.md — fix: window.open('/manual') or keep modal + add "open full page". (LOW)
5. **P3** — Theme toggle lost its `aria-label` (OLD :882 / NEW :456-462); bell/search/manual buttons on both sides also lack aria-labels, so NEW regresses only the one OLD had — fix: cadence Layout.jsx:458. (HIGH)
6. **P3** — Control composition/order changed: OLD search-input · bell · viewAs · shortcuts · manual · theme · request → NEW title · search-button · manual · bell · viewAs · theme; bell moved from leftmost-control to fourth; header gains a title OLD never had (OLD :843-901 / NEW :428-463) — fix: only if strict parity wanted; the title is arguably an improvement. (LOW)

Intentional divergences (not defects): demo-mode `is_test` banner dropped (test users deliberately not ported, CLAUDE.md M1); platform announcements banner stack + dismiss (multi-tenant platform feature); ViewAs "No other members yet." empty state; tokenized dropdown surfaces (01-design-system.md:82); label-scoped everything. Cross-refs: search-trigger architecture defect counted in g-global-search; `/analytics/pageview` shell ping counted in missing--analytics.

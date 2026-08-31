# g-error-404-loading — error boundaries, 404/catch-all, loading states (global surface)

OLD: no ErrorBoundary anywhere (grep `componentDidCatch|getDerivedStateFromError` = 0); no `path="*"` catch-all (App.jsx routes end :250-253); `components/Skeleton.jsx` (152L, 27 consumer files) + heavy spinner culture (157 `animate-spin` sites, 51 files importing Loader/Loader2).
NEW: `components/ErrorBoundary.jsx` (54L) mounted at root (main.jsx:35) **and** per-route keyed in both shells (Layout.jsx:483, PlatformLayout.jsx:132); `path="*"` redirects (App.jsx:130,:194); `components/Skeleton.jsx` (89L, 30 consumer files); 6 `animate-spin` sites; codified error-banner-with-Retry on 5 surfaces.

Route & permissions: global surface — no permission dimension.

Design-system diffs covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 1. Layout & structure

- **Crash handling**: OLD — a render-time throw white-screens the page (no boundary; corroborated by cadence CLAUDE.md's "landmines" note that sourcemaps + ErrorBoundary are how minified crashes get diagnosed — the boundary only ever existed in NEW). NEW — three-layer boundary: root wrap (main.jsx:35-37), per-route boundary keyed on `location.pathname` so navigating away resets it (Layout.jsx:483-485, PlatformLayout.jsx:132-140). Fallback card: "Something went wrong" + red message `<pre>`, current pathname, collapsible "Where this happened" stack, Reload (hard reload — also clears stale-chunk crashes, ErrorBoundary.jsx:23-25) + "Go to dashboard" buttons (:30-49).
- **Stale-deploy chunks**: NEW-only `vite:preloadError` listener does a one-shot sessionStorage-guarded reload (main.jsx:20-27). OLD has no equivalent (and no React.lazy/Suspense on either side — grep).
- **404 / catch-all**: neither side has a NotFound page. OLD: an unknown URL matches nothing inside `<Routes>` — the Layout shell renders with an **empty content area** (App.jsx:250-253, no `path="*"`). NEW: `path="*"` → `<Navigate to="/" replace />` inside the shell (App.jsx:130) and token-aware `/` vs `/login` at the outer level (:194) — silent redirect, no "page not found" feedback.
- **Loading**: both sides share the same `Skeleton` API DNA (`skeleton-shimmer` base, Line/Block/Circle/Card/Table/TableRow/PageHeader/StatCards/TaskList/KanbanBoard — OLD Skeleton.jsx:15-151 / NEW :10-89). OLD additionally ships `Skeleton.ArtistProfile` (:128-149). Page-level convention: OLD mixes `if (loading)` skeletons (ArtistBudgetSheet.jsx:107), centered `Loader animate-spin` + caption (ArtistProfile.jsx:94-100 "Fetching Spotify data..."), and bare text (24 "Loading..." sites); NEW mixes skeletons (BankStatements.jsx:208, DataQuality.jsx:43, Notifications.jsx:32) and bare gray text (25 "Loading…" sites: ArtistProfile.jsx:124, ReleaseDetail.jsx:92, ArtistCampaignDetail.jsx:62 …).
- **API-error banners w/ Retry**: OLD has 2 real sites (ArtistCampaignsQueue.jsx:114 "Try again", Reports.jsx:2194 "Retry"). NEW codifies a pattern — centered card, danger text, `btn-secondary` + RefreshCw 14 "Retry" — on 5 surfaces (Creators.jsx:92, Reports.jsx:149, ArtistBudgets.jsx:53, reports/DismissedTab.jsx:40, mywork/TaskSurface.jsx:283). Everywhere else, both sides surface load failures via toast/alert or not at all — parity.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Crash fallback | none — blank/white | centered card max-w-md: title, red message pre, pathname, stack details, Reload + dashboard buttons | NEW ErrorBoundary.jsx:30-49 |
| Unknown URL | Layout shell w/ empty content | instant redirect to `/` (or `/login`) | OLD App.jsx:250-253 / NEW :130,:194 |
| Skeleton shimmer | `.skeleton-shimmer` 1.5s ease-in-out (index.css:102-109) | same class (index.css `.skeleton-shimmer` + dark variant, per 01-design-system §Global CSS) | parity |
| Detail-page loading | centered Loader 24 spinner + caption (ArtistProfile.jsx:94-100) | bare `text-sm text-gray-400` "Loading…" line (ArtistProfile.jsx:124) | regression on ported pages |
| Busy buttons | Loader/Loader2 `animate-spin` in-button (157 sites / 51 files) | label swap only ("Working…", ConfirmDialog.jsx:34); only 6 spinner sites remain (AddLedgerEntry.jsx:177, Contracts.jsx:127, VendorSubmit.jsx:203, FileAttach.jsx:40, Layout.jsx:123, UserManual.jsx:115) | motion affordance mostly dropped |
| Error banner | ad-hoc underline "Retry"/"Try again" links | standardized card + btn-secondary RefreshCw Retry | OLD :114/:2194 / NEW 5 sites above |

## 3. Copy & content differences

- NEW crash copy: "Something went wrong" / "This page hit an unexpected error. The details are in your browser console." / "Where this happened" / "Reload" / "Go to dashboard" (ErrorBoundary.jsx:32-46). No OLD counterpart.
- Loading text: OLD "Loading..." (three dots) and per-page captions ("Fetching Spotify data..."); NEW uniform "Loading…" (ellipsis char).

## 4. Feature & interaction differences

- NEW per-route boundary keyed on pathname means one crashed page never takes down the shell, and navigation self-heals (Layout.jsx:483) — no OLD analog.
- NEW ErrorBoundary logs the real stack to console for sourcemapped prod debugging (ErrorBoundary.jsx:16-21).
- NEW `vite:preloadError` one-shot reload (main.jsx:22-27) + boundary's hard-reload button both address the deploy-stale-chunk crash class. OLD tabs crash until manual reload.
- OLD's blank-shell 404 lets the user see the URL was wrong; NEW's silent redirect-to-dashboard swallows the mistake with zero feedback (a mistyped/stale deep link lands on the dashboard unexplained).
- Neither side has route-level Suspense fallbacks (no React.lazy in either App.jsx — grep; NEW's jspdf/docx dynamic imports are in-page actions, not routes).

## 5. Data layer differences

None — pure client surface.

## 6. Tables & forms (if present)

Not applicable. (Skeleton.Table/TableRow anatomy is identical between sides — diff shows formatting-only changes plus NEW's JIT-safe GRID/COLS maps, NEW Skeleton.jsx:7-8.)

## 7. Defects found

1. **P3** — Detail-page loading regressed to bare gray text on ported pages: NEW ArtistProfile.jsx:124, ReleaseDetail.jsx:92, ArtistCampaignDetail.jsx:62 (`<p className="text-sm text-gray-400">Loading…</p>`) vs OLD's centered spinner + caption (ArtistProfile.jsx:94-100) / skeletons; ~25 bare-text sites in NEW — fix: `Skeleton.PageHeader` + `Skeleton.Block` per NEW's own convention (BankStatements.jsx:208). (HIGH for the three cited; MED as a pattern)
2. **P3** — `Skeleton.ArtistProfile` composite variant dropped from the kit (OLD Skeleton.jsx:128-149,:151 vs NEW :88 export map) — fix: port the variant and use it at ArtistProfile.jsx:124. (HIGH)
3. **P3** — In-flight button spinners mostly dropped: OLD 157 `animate-spin` sites / 51 Loader-importing files vs NEW 6; NEW busy buttons rely on label swaps alone — fix: add Loader2 spin to Button's busy path or per-site. (MED)
4. **P3** — Unknown URLs silently redirect to the dashboard with no "not found" feedback (NEW App.jsx:130,:194); OLD's blank shell is worse UX but at least signals a bad route — neither has a 404 page — fix: minimal NotFound card (title + "back to dashboard") at `path="*"`. (LOW — OLD offers nothing to restore; filed for completeness)

Intentional divergences / NEW-only improvements (keep): ErrorBoundary — root + per-route keyed + sourcemapped console logging + hard-reload recovery (ErrorBoundary.jsx, main.jsx:35, Layout.jsx:483, PlatformLayout.jsx:132); `vite:preloadError` one-shot reload (main.jsx:20-27); standardized error-banner-with-Retry pattern now on 5 surfaces vs OLD's 2 ad-hoc links.

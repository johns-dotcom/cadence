# Settings

OLD: `boom-dashboard/client/src/pages/Settings.jsx` (1937 lines; tabs Users / Permissions / Test Users / Archive / My Nav / Theme) + `boom-dashboard/server/routes/settings.js` (663 lines: users CRUD, permission templates, page permissions, visible-reps, boom_reps CRUD, test-users) + `boom-dashboard/server/routes/full-export.js` (Archive tab backend).
NEW: `cadence/client/src/pages/Settings.jsx` (464 lines; tabs Account / Workspace / Finance / Team / Data) + components `PermissionsManager.jsx` (162), `RepsManager.jsx` (62), `DataTools.jsx` (78) + `cadence/server/routes/settings.js` (192), `routes/labels.js` (GET/PATCH `/api/label`, logo, test-email, vendor-form-token rotate), `routes/reps.js`, `routes/full-export.js`.

Design-system diffs are RC-1..RC-6 in `_audit/01-design-system.md` and are not re-reported.

Structural note: OLD's Users tab (user CRUD + welcome-email preview) moved wholesale to NEW's `/team` page — those gaps are audited in `_audit/pages/team.md` / the `## team` block of `_defects-raw.md` and are NOT re-counted here. This file covers what remains addressed to `/settings`.

## 1. Purpose & pairing

Same route both sides (`/settings`). OLD is the admin center: user accounts, per-user page permissions + rep visibility, demo accounts, the full-archive export, plus two self-service tabs (My Nav, Theme). NEW is a profile + workspace-configuration page: self-service account (name, password), then admin-only Workspace (branding/identity/dashboard), Finance (outbound email, vendor form link, invoice remittance), Team (workload target, PermissionsManager, RepsManager), Data (export + master-sheet import). Pairing confidence HIGH; large intentional restructure around multi-tenancy.

## 2. Route / permissions

| | OLD | NEW |
|---|---|---|
| Route | `/settings`, Protected (OLD App.jsx:210) | `/settings`, ProtectedRoute (cadence App.jsx:190) |
| Default tab | `users` for Admin/Superadmin else `mynav` (OLD Settings.jsx:1884) | always `account` (NEW Settings.jsx:28) |
| Tab gating | Users+Permissions Admin+; Test Users+Archive Superadmin-only (OLD Settings.jsx:1886-1897) | Workspace/Finance/Team/Data all `isAdmin` = Superadmin/Admin (NEW Settings.jsx:27-36) — nothing Superadmin-only remains; Approver sees only Account |
| Server gate | `/api/settings/*` adminOnly (OLD settings.js:17-22); test-users superadminOnly (:538-543); full-export Superadmin (OLD full-export.js:215-217) | `/api/settings/me|theme` any member, permissions/templates/visible-reps `requireAdmin` (NEW settings.js:7,58,74,153); `/api/full-export` `requireAdmin` (NEW full-export.js:10) — export gate widened Superadmin→Admin |
| Hotkeys | `n` opens Add User (OLD Settings.jsx:628-630) | none |

## 3. Server / API diff

| Endpoint | OLD | NEW | Δ |
|---|---|---|---|
| Users CRUD | GET/POST/PUT/DELETE `/settings/users` w/ role-tier ordering, boom_rep semantics, last-Superadmin + FK-sweep delete guards (OLD settings.js:30-277) | moved to `/api/team` (see team audit) | INT restructure |
| Own profile | — (no self-service profile in OLD) | GET/PATCH `/settings/me` (NEW settings.js:10-38); POST `/auth/change-password` | NEW-only, INT (invite/password auth model) |
| Theme persist | — (localStorage only, OLD ThemeContext.jsx:6-16) | PATCH `/settings/theme` + `users.theme` column (NEW settings.js:41-54) — **zero client callers** (grep `settings/theme` over client = none); NEW ThemeContext is also localStorage-only (cadence ThemeContext.jsx:6-13) | orphaned endpoint |
| Permissions get | returns `null` when no rows = unrestricted (OLD settings.js:349-363) | always returns array; empty = unrestricted (NEW settings.js:58-69, PUT comment :72-73) | semantic flip, see §5 |
| Permissions put | delete+insert; Superadmin-only for Admin targets (OLD settings.js:367-396) | delete+insert in a txn, tenant re-validation, **bumps token_version** so sessions refresh (NEW settings.js:74-105); no target-role guard | NEW adds session refresh [INT-adjacent improvement]; drops role guard |
| Permission templates | GET/POST(upsert ci-name, validates name ≤60 + pages non-empty `/`-paths ≤100)/DELETE (OLD settings.js:285-343) | same trio, label-scoped; validation only "name required" — empty `pages` array accepted (NEW settings.js:155-192) | parity minus validation |
| Visible reps | global map GET + single add POST + single remove DELETE, allow-list semantics documented per-role (OLD settings.js:398-465) | per-user GET/PUT replace-set (NEW settings.js:109-149) — **no client caller anywhere** (RepsManager manages the roster, not visibility) | UI unreachable — logged as P1 in the `## team` block; not re-counted here |
| Reps CRUD | `/settings/reps` name-keyed, soft-deactivate ONLY — comment explicitly forbids hard delete because expenses/users reference the name string (OLD settings.js:467-530); POST reactivates on conflict (:500-504) | `/api/reps` id-keyed: GET(?all=1)/POST/PATCH/**DELETE** (NEW reps.js) — hard delete exists and RepsManager exposes it; POST on duplicate errors instead of reactivating (reps.js 23505 branch) | P2/P3 below |
| Test users | full CRUD + mocked-data guard + invitation email preview (OLD settings.js:532-661) | none | INT (see §7) |
| Full export | Superadmin; streams via archiver, disables socket timeouts, `?token=` anchor download; ledger/vendors/etc as **formatted Excel workbooks** + **every invoice/proof/W9/receipt/contract/admin-doc file from R2 in named folders** + manifest with per-section record/file counts (OLD full-export.js:6-19,215-229,241-248,266,313-314,349-380,547-594) | requireAdmin; 15 CSVs + README.txt, built in memory and `res.send()` (NEW full-export.js:14-61); client buffers the blob via axios (DataTools.jsx:17-24) | P1/P2 below |
| Label config | — (single-tenant; branding hardcoded) | GET/PATCH `/api/label` (name, accent, invoice_settings, shallow-merged settings), `/label/logo`, `/label/test-email`, `/label/vendor-form-token/rotate` (labels.js:22-186) | INT (multi-tenancy/branding) |
| Bank accounts | account/method compatibility hardcoded paypal-vs-other (OLD lib/bank-evidence.js:54-55,123) | per-label `labels.bank_accounts` JSONB read by `bankEvidence.loadAccounts` (cadence lib/bankEvidence.js:110-114; migration index.js:1591) — **no endpoint or UI writes it** (grep: only the migration + readers) | configurability unreachable |

## 4. UI structure diff

- **Tabs**: OLD Users / Permissions / [Test Users / Archive] / My Nav / Theme, icon + underline style (OLD Settings.jsx:1886-1926). NEW Account / Workspace / Finance / Team / Data, text-only underline tabs (NEW Settings.jsx:29-37,205-212), page constrained to `max-w-2xl` (:201) vs OLD full-width.
- **Gone from NEW `/settings` with no counterpart anywhere**:
  - **My Nav tab** — per-user show/hide of nav items the user can access, localStorage `nav_hidden_pages`, live "N of M pages shown", "Show all" reset (OLD Settings.jsx:1437-1511). No `nav_hidden` mechanism exists in NEW (grep over client = zero hits). NEW's own `constants/pages.js:2-3` comment still claims `/settings` hosts "My Nav / Theme" — stale.
  - **Theme tab** — two-card Light/Dark picker with Active badge (OLD Settings.jsx:1515-1558). NEW theme control is a small header toggle button in Layout (cadence Layout.jsx:455-462) — feature survives, section does not; and neither side persists it server-side despite NEW having the endpoint (§3).
  - **Test Users tab** (OLD Settings.jsx:1561-1742) — see §7 [INT].
  - **Archive tab presentation** — hero card with numbered "What you'll get" sections, several-GB warning banner, confirm modal with confidentiality copy, timed "Preparing your archive…" state (OLD Settings.jsx:1748-1876). NEW = one `card` with two buttons and a caption (DataTools.jsx:69-77).
  - **Rep-visibility editor** (own-rep chip + allow chips + "+ Allow a rep…" + sees-nothing warning, OLD Settings.jsx:1341-1428) — server half exists in NEW, zero UI (counted in team block).
- **Permissions editor** (OLD PermissionsTab :789-1433 vs NEW PermissionsManager):
  - OLD no-selection state renders a **Permissions Overview table** — every user with role badge, department, "N pages / Unrestricted / Full access" count (prefetched per user) and a Configure link (:1039-1096). NEW shows nothing until a member is picked (PermissionsManager.jsx:75-78,109).
  - OLD selected state: "Apply template…" select with **Your templates optgroup + starter presets with description tooltips** (:1119-1154), Save as template, Copy from user, Select all (:1155-1186), custom-template chips with counts + created-by tooltip (:1192-1213), **search box filtering page labels** (:1219-1228), per-group collapsible headers with "· n of m" count + per-group Select all / Clear (:1246-1283), button-style checkboxes (:1286-1308), no-match state (:1314-1323), Saved indicator w/ 3s timeout (:1334-1338). NEW: preset/template/copy selects (PermissionsManager.jsx:80-106), group header toggles all-in-group (:117-125), plain check rows, `Save (N pages)` + Save as template (:139-143), template chips (:147-158). No overview, no search, no collapse, no per-group counts, no descriptions, no saved indicator (toast instead).
  - OLD filters the selectable users by role (Superadmins excluded; Admins excluded for non-Superadmin callers, :828-830) with an explanatory footnote (:1032-1036); NEW lists everyone from `/team` and shows an amber "unrestricted" banner for Admin-tier picks (PermissionsManager.jsx:20,111-115).
- **Reps panel**: OLD BoomRepsPanel — pill chips (emerald active / gray struck-through), On/Off toggle inside the chip, created-by tooltip, Enter-to-add (OLD Settings.jsx:127-243). NEW RepsManager — row list with check/x icon toggle and a hover-reveal hard-delete trash (RepsManager.jsx:44-59).
- **NEW-only sections** (no OLD counterpart): Profile + Change password (Settings.jsx:216-244); Workspace identity (label name, tagline, welcome message, logo upload/initials, accent presets + custom picker w/ live preview) (:247-338); Home-dashboard widget toggles + pinned links (:340-368); Outbound email reply-to + send-test (:372-385); Vendor form link copy/rotate (:387-395); Invoice details / remittance block (:397-427); Workload target task_capacity (:432-454); master-sheet CSV import (DataTools.jsx:27-66). All [INT] multi-tenancy/branding except as noted in §7.
- Sections that exist on NEITHER side: notification preferences, integrations/API keys, danger zone (workspace delete lives in the platform console). No differences found.

## 5. Behavior / interactions diff

- **Permission default flipped (default-CLOSED → default-OPEN)**: OLD — a User with no permission rows sees only the base whitelist; UserModal warns "No page rows … a User then sees only the Dashboard" (OLD Settings.jsx:268-276,491-509), and the save path deliberately writes the EXPLICIT full list for "unrestricted" because null locks Users out (:993-1013). NEW — no rows ⇒ `pagePermissions === null` ⇒ `canView` returns true for everything (cadence AuthContext.jsx:155-163); server PUT treats `[]` as "unrestricted (we clear all rows)" (NEW settings.js:72-73); PermissionsManager sends `[]` when everything is checked (PermissionsManager.jsx:42-45). Consequence: **unchecking every box and pressing "Save (0 pages)" grants full access** — the exact inverse of the visible state — and a freshly created User is unrestricted until an admin intervenes.
- **Rep hard delete**: OLD refuses to delete reps ("removing the row would orphan historical data", OLD settings.js:472-475); NEW RepsManager's trash calls `DELETE /reps/:id` after a `window.confirm` (RepsManager.jsx:29-32) — historical `expenses.rep` strings lose their roster row and the name vanishes from `?all=1` management view.
- **Rep re-add**: OLD POST reactivates a deactivated rep idempotently (`ON CONFLICT … SET active=TRUE`, OLD settings.js:500-504); NEW POST returns "That rep already exists" (reps.js 23505 branch) — the admin must find the struck-through row and toggle it instead.
- **Export flow**: OLD confirm-modal → hidden-anchor navigation so the browser streams a multi-GB ZIP straight to disk, with an explicit comment that the axios-blob approach "would buffer the whole archive in JS memory" (OLD Settings.jsx:1753-1770). NEW does exactly that buffered-blob approach (DataTools.jsx:17-24) and the server also builds the ZIP in memory (NEW full-export.js:52-55) — tolerable only because NEW dropped all file attachments (§3). OLD used `?token=` in the URL; NEW's header-auth requirement is why the anchor pattern was abandoned [INT security].
- **Permissions save feedback**: OLD sets a localStorage `boom_permissions_updated` beacon so open UserManual tabs live-refetch (OLD Settings.jsx:1005) and shows an inline Saved check; NEW bumps the target's `token_version` so their sessions refresh server-side (NEW settings.js:96) and toasts — different mechanisms, NEW's is stronger for the target user, but nothing refreshes another admin's open tab.
- OLD template save/delete use `window.prompt`/`confirm`/`alert` with updated-vs-created feedback (OLD Settings.jsx:924-948); NEW prompt + toast, no updated/created distinction, template delete has **no confirm** (PermissionsManager.jsx:51-57).
- Theme selection identical persistence (localStorage + `documentElement.classList`, OLD ThemeContext.jsx:8-16 / NEW ThemeContext.jsx:8-13); interaction moved from a Settings tab to a header toggle.

## 6. Visual / design diff

Beyond RC-1..RC-6: OLD tabs carry icons w/ active strokeWidth shift (OLD Settings.jsx:1908-1924), NEW text-only (NEW Settings.jsx:206-211). OLD uses raw `#E52017` accentColor on native checkboxes (:500,527,1499) → NEW brand-tokened check squares (RC-2 [INT]). OLD role badges purple/boom/amber/gray (:716-726) have no NEW settings-side equivalent (roster moved). OLD page-permission checkboxes are bordered button-cards with boom-tinted checked state (:1289-1307); NEW is a plain checklist. OLD Archive tab hero band `bg-gradient-to-br from-boom-50` w/ 12×12 icon tile (:1784-1793); NEW plain card. NEW `max-w-2xl` column vs OLD full-width tables.

## 7. Defect table

| # | Sev | Confidence | Defect |
|---|---|---|---|
| S1 | P1 | HIGH | Full export lost every file attachment (invoices, proofs, W9s, receipts, contracts, admin-doc vault) and the formatted Excel workbooks; NEW ZIP = 15 CSVs + README (OLD full-export.js:6,547-594,313-380 vs NEW full-export.js:14-61) |
| S2 | P2 | HIGH | Permission model flipped default-CLOSED → default-OPEN; "Save (0 pages)" = grant everything; new Users unrestricted by default (AuthContext.jsx:155-163, NEW settings.js:72-73, PermissionsManager.jsx:42-45) |
| S3 | P2 | HIGH | My Nav tab (per-user nav show/hide + reset, localStorage) has no NEW counterpart; `constants/pages.js:2-3` comment still claims it exists (OLD Settings.jsx:1437-1511) |
| S4 | P2 | HIGH | Permissions Overview table (all users w/ per-user page counts + Configure) gone — no-selection state is empty (OLD Settings.jsx:1039-1096 vs PermissionsManager.jsx:109) |
| S5 | P2 | MED | Reps: hard DELETE exposed + no reactivate-on-re-add, versus OLD's deliberate soft-deactivate-only model protecting historical name references (OLD settings.js:472-475,500-504 vs reps.js DELETE, RepsManager.jsx:29-32) |
| S6 | P2 | MED | Export experience: buffered blob client+server (multi-GB-unsafe pattern OLD explicitly avoided), no confirm modal, no contents summary, no size warning, no preparing state (OLD Settings.jsx:1748-1876 vs DataTools.jsx:15-77, NEW full-export.js:52-55) |
| S7 | P2 | LOW | Full-export gate widened Superadmin-only → Admin (OLD full-export.js:215-217 vs NEW full-export.js:10); likewise nothing on NEW `/settings` is Superadmin-only anymore |
| S8 | P3 | HIGH | Permissions editor depth: page search, group collapse, "· n of m" counts, per-group Select all/Clear, preset descriptions, custom-template counts/created-by, saved indicator, updated-vs-created feedback, template-delete confirm all dropped (OLD Settings.jsx:1119-1338 vs PermissionsManager.jsx) |
| S9 | P3 | MED | Server PUT /settings/permissions dropped OLD's "only Superadmin may set permissions for Admin accounts" guard (OLD settings.js:372-378 vs NEW settings.js:74-105); mitigated by rows not binding Admin roles |
| S10 | P3 | MED | Permission-template POST validation reduced — empty pages array and >60-char names accepted (OLD settings.js:302-307 vs NEW settings.js:158-161) |
| S11 | P3 | LOW | `labels.bank_accounts` (feeds bankEvidence method compatibility) has no write endpoint and no Settings UI — per-label configurability unreachable (lib/bankEvidence.js:110-114, index.js:1591) |
| S12 | P3 | LOW | PATCH /api/settings/theme + users.theme orphaned — no client caller; theme still localStorage-only per device (NEW settings.js:41-54, ThemeContext.jsx:6-13) |
| S13 | P3 | LOW | Theme picker removed from Settings (moved to header toggle); Settings has no appearance section (OLD Settings.jsx:1515-1558 vs Layout.jsx:455-462) |
| S14 | P3 | LOW | `n` hotkey (add user) gone with the Users tab; no hotkeys on NEW Settings (OLD Settings.jsx:628-630) |

Intentional divergences: Users tab → `/team` invite-based management (auth model; gaps counted in team block) · Test Users + mock-data guard dropped (multi-tenant demo workspaces supersede; documented as deliberate in cadence CLAUDE.md) · NEW-only Account (profile/password), Workspace branding (name/tagline/welcome/logo/accent), Home-dashboard widgets/pins, Outbound email reply-to + test, Vendor form link + rotation, Invoice remittance block, Workload target, master-sheet import (multi-tenancy/branding) · token_version bump on permission save replacing the localStorage refresh beacon · header-auth-only downloads replacing `?token=` URLs.

Cross-referenced, not re-counted: per-user rep-visibility editor unreachable (P1 in `## team`); privilege-escalation and user-CRUD gaps (team block).

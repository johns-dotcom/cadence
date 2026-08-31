# Salary

## 1. Files compared (purpose & pairing)

- OLD: `boom-dashboard/client/src/pages/Salary.jsx` (381) + `boom-dashboard/server/routes/salary.js` (156, mounted `/api/salary`, boom index.js:294). Tables: `salary_employees`, `salary_payments`, `salary_payment_history` (boom index.js:2760+).
- NEW: `cadence/client/src/pages/Salary.jsx` (136) + `cadence/server/routes/salary.js` (117, mounted `/api/salary`, cadence server/index.js:205). Tables: `salary_employees`, `salary_payments` (cadence server/index.js:1189-1216) — **no history table**; NEW adds `currency` and `marked_by INT FK→users`.
- Same feature in both: standalone payroll roster (NOT tied to the users table), month-picker paid/unpaid toggling. Design-system deltas covered by RC-1..RC-6 in `_audit/01-design-system.md`.

## 2. Route & permissions

| | OLD | NEW |
|---|---|---|
| Client route | `/salary`, no route guard; page self-gates with an after-hooks `isAdmin` check rendering "Admin access required" (OLD Salary.jsx:96-102, hook-count comment :19-23) | `/salary` wrapped in `AdminRoute` (cadence App.jsx:163); nav item admin-only (cadence Layout.jsx:294) |
| Server gate | `requirePagePermission('/salary')` — Admin/Superadmin/Approver pass; plain Users only with an explicit page grant (OLD salary.js:7-14) | `authMiddleware, withTenant, requireAdmin` — hard admin-only (NEW salary.js:9) |

Effective UI access was admin-only in both (OLD's client gate blocked Approvers too). But OLD's server let an Approver or an explicitly-granted User call the API; NEW forecloses that grantability. [INT] — tenancy/auth model — with the note that per-page grantability for /salary is lost.

## 3. Server/API diff

| Endpoint | OLD | NEW | Δ |
|---|---|---|---|
| `GET /` | roster + month join; `ORDER BY monthly_amount DESC NULLS LAST, name` (OLD salary.js:18-37, :30); returns `paid_by` (name string), `notes` | same shape, label-scoped; `ORDER BY department NULLS LAST, name` (NEW salary.js:12-31, :23); adds `currency`, `active`; drops `paid_by`/`notes` from the row | sort changed; row loses paid-by |
| toggle paid | `PUT /:employeeId` — upsert; `DO UPDATE` sets `paid, amount=EXCLUDED.amount, paid_at, paid_by (name), notes COALESCE-preserved` (OLD :40-74, :55-60); writes `salary_payment_history` (`marked_paid`/`marked_unpaid`, performed_by, performed_at) (:65-68) | `PUT /:employeeId/pay` — upsert; `DO UPDATE` sets only `paid, paid_at, marked_by` — **not `amount`** (NEW :92-115, :106); re-validates employee in-tenant (:100-101); **no history insert** | history table dropped; amount goes stale on re-mark; notes gone |
| history | `GET /history?month=&year=` — month-scoped audit from `salary_payment_history`, both actions, LIMIT 50 (OLD :92-105) | `GET /history` — global, derived from `salary_payments WHERE paid_at IS NOT NULL`, LIMIT 100 (NEW :34-49) | see defects: unmark ERASES the record (upsert nulls `paid_at`), unpaid actions never recorded, no month scope |
| add employee | `POST /employees` (OLD :77-89) | `POST /employees` + `logActivity('Added employee')` + 201 (NEW :52-68) | parity (+ currency, + activity log) |
| edit employee | `PUT /employees/:id` — presence-checked field patch, empty-name 400, negative-amount 400 (OLD :111-141) | `PATCH /employees/:id` — allow-list patch incl. `active` (NEW :70-91); **no client caller** | server parity-ish (NEW lacks empty-name/negative-amount validation — passes raw body values); UI missing |
| remove | `DELETE /employees/:id` → `active=false` soft delete (OLD :144-152) | none — deactivation only via the unused `PATCH active:false` | route + UI missing |
| Ledger integration | none — salary payments never create `expenses` rows | none | No differences found |
| Exports | none | none | No differences found |

## 4. UI structure diff

- OLD: PageHeader (month chevrons + **This Month** reset :193-199 + History toggle :200-209) → save-error banner (:178-183) → **4 stat cards** Total Payroll / Paid Out / Remaining / Employees x/y paid (:213-231) → optional history card with green/red Paid/Unpaid action badges + "performed_by · date time" (:234-254) → **department-grouped cards**, each with a header strip (dept name, "n/m paid", dept subtotal :285-300) and rows (name, amount, paid-date + "by {paid_by}" :315-319, Paid/Unpaid toggle w/ per-row spinner :321-337, pencil edit :339, trash remove :342) → inline **Add Employee** card / full-width dashed add button (:355-375).
- NEW: PageHeader (History + Add employee buttons :58-63) → month chevrons + single inline total "Paid $X of $Y" (:67-73) → optional add form (grid, dept `<select>` from `DEPARTMENTS`, currency `<select>` :76-84) → optional history card (employee · Mon YYYY, marked_by · date :89-100) → **flat 4-column table** Employee / Department / Monthly / "{Mon} status" with a Paid / "Mark paid" pill (:105-133).
- Missing in NEW: stat cards, department grouping + subtotals, This Month reset, per-row edit + remove, paid-date/paid-by metadata, per-row in-flight spinner, Skeleton loaders (OLD :259-263 vs NEW "Loading…" :102).
- NEW-only: per-employee currency, toast feedback, `DEPARTMENTS`/`CURRENCIES` constant selects (OLD dept was free text :360).

## 5. Behavior/interactions diff

- Toggle paid: OLD optimistic local patch + per-row `saving` disable/spinner (:63-77); NEW awaits then full `load()` refetch, no in-flight guard — double-click issues two PUTs (idempotent upsert, so cosmetic) and the whole table re-renders (:46-49).
- Edit: OLD trusts the server row back, preserves join-only fields, shows a dismissible save-error banner, disables while saving (:104-135). NEW: no edit interaction at all.
- Remove: OLD `window.confirm` → soft delete → local filter (:151-157). NEW: none.
- History: OLD lazy-fetches per current month on toggle and refetches per month (:52-60); NEW fetches once, global, and caches until hidden (:22-27) — switching months does not change it.
- Add: OLD requires name client-side only (:138); NEW toasts on missing name and on server error (:38-48). Parity+.
- Month math (Dec/Jan rollover) identical (OLD :79-85, NEW :34-35).
- Error handling on load: both swallow silently (OLD console.error :44, NEW `.catch(() => {})` :30) — no error state in either. No differences found.

## 6. Visual/design diff

- RC-1/RC-2/RC-5/RC-6 apply. Page-specific:
- Paid state: OLD emerald pill w/ Check, unpaid = **red** `bg-red-50 text-red-600` "Unpaid" pill w/ X icon (state-labeled, :321-337); NEW unpaid = gray `bg-gray-100` "Mark paid" (action-labeled, :123-126). Unpaid rows lose their at-a-glance alarm color.
- OLD stat numbers `text-xl font-black`, 10px bold uppercase card labels (:214-230); NEW has no cards.
- OLD month label `text-sm font-bold min-w-[140px]`; NEW `text-base font-semibold min-w-[120px]` (:70).
- OLD full currency formatting `Intl 'currency'` USD (:10-13); NEW hand-rolled `$`/code prefix (:9).
- Empty state copy: "No team members found" (OLD :266) vs "No employees on payroll yet." (NEW :104).
- History rows: OLD action badges green/red; NEW plain text, no action distinction (:89-100).

## 7. Defect table

| Sev | Defect | Evidence | Conf |
|---|---|---|---|
| P1 | Roster **edit** UI missing — name/department/amount can never be corrected from the app; server `PATCH /salary/employees/:id` (NEW salary.js:70-91) has zero client callers | OLD Salary.jsx:87-135, :339 vs NEW Salary.jsx (no edit code) | HIGH |
| P1 | Roster **remove** missing — no DELETE route and no UI; `PATCH active:false` exists but is unreachable | OLD Salary.jsx:151-157, :342 + OLD salary.js:144-152 vs NEW salary.js (no delete) | HIGH |
| P2 | Department grouping (per-dept header: name, n/m paid, dept subtotal) replaced by a flat table | OLD Salary.jsx:164-170, :285-300 vs NEW :105-133 | HIGH |
| P2 | Summary stat cards (Total Payroll / Paid Out / Remaining / Employees x/y paid) reduced to one inline "Paid X of Y" line | OLD Salary.jsx:213-231 vs NEW :72 | HIGH |
| P2 | History regressed from an audit trail to a paid-snapshot: month-scoped `salary_payment_history` with marked_paid AND marked_unpaid rows → global list derived from `salary_payments`; **unmarking paid nulls `paid_at` and erases the history row**; unpaid actions never recorded | OLD salary.js:65-68, :92-105 + OLD Salary.jsx:234-254 vs NEW salary.js:34-49, :106 | HIGH |
| P2 | Mixed-currency totals: `totalDue`/`totalPaid` sum `monthly_amount` across currencies and render with the USD `money()` default, while the roster supports per-employee currency (NEW-introduced bug) | NEW Salary.jsx:50-51, :72 vs :80, :121 | HIGH |
| P3 | Re-mark-paid keeps a stale `amount`: NEW upsert `DO UPDATE` omits `amount` (OLD set `amount = EXCLUDED.amount`) — latent, `paid_amount` not displayed in NEW UI | NEW salary.js:103-107 vs OLD salary.js:55-57 | HIGH |
| P3 | Paid metadata gone from rows: OLD showed paid date + "by {paid_by}"; NEW shows only the pill (server returns `paid_at`, unused) | OLD Salary.jsx:314-319 vs NEW :123-126 | HIGH |
| P3 | "This Month" reset button missing | OLD Salary.jsx:193-199 | HIGH |
| P3 | Unpaid state de-emphasized (red Unpaid pill → gray "Mark paid") and per-row in-flight spinner/disable dropped | OLD Salary.jsx:321-337 vs NEW :46-49, :123-126 | HIGH |
| P3 | Skeleton loaders (StatCards + 2 Blocks) → bare "Loading…" text | OLD Salary.jsx:259-263 vs NEW :102 | HIGH |
| P3 | Roster sort changed: amount DESC then name → department then name (biggest salaries no longer float to top) | OLD salary.js:30 vs NEW salary.js:23 | HIGH |
| P3 | Payment `notes` capability dropped (OLD API accepted + COALESCE-preserved notes; NEW schema has no column) — OLD had no UI consumer either | OLD salary.js:43, :60 vs cadence server/index.js:1202-1214 | LOW |
| P3 | Department entry free-text → fixed `DEPARTMENTS` select (payroll employees aren't users; the permission-boundary rationale doesn't apply to them) | OLD Salary.jsx:360 vs NEW :78 | LOW |
| P3 | NEW `PATCH /employees/:id` drops OLD's field validation (empty-name 400, non-negative amount 400) — moot until an edit UI exists, then it regresses | OLD salary.js:117-131 vs NEW salary.js:73-77 | MED |

Intentional divergences:
- [INT] `label_id` scoping on every query + in-tenant employee re-validation (NEW salary.js:22, :100-101) — multi-tenancy.
- [INT] `requireAdmin` replacing `requirePagePermission('/salary')` (grantable page permission) — auth model; effective UI access unchanged (OLD client also gated to admins).
- [INT] `marked_by` as a users FK instead of `paid_by` name string (NEW salary.js:110 vs OLD :62) — survives renames, tenancy-consistent modeling.
- [INT] Per-employee `currency` column + picker — NEW multi-tenant/international capability (the totals bug it exposes is the P2 above).

# Team

## 1. Files compared (purpose & pairing)

- OLD: `boom-dashboard/client/src/pages/Team.jsx` (951) + `server/routes/team.js` (700) + detail page `client/src/pages/TeamMember.jsx` (266, route `/team/:id`, boom App.jsx:183).
- NEW: `cadence/client/src/pages/Team.jsx` (202) + `cadence/server/routes/team.js` (189).
- **The two pages named "Team" are different features.** OLD /team is a task command center (people list with expandable per-member task lists, assign/request, Workload board, Velocity analytics) — member CRUD lived in OLD **Settings → Users/Permissions** (`boom Settings.jsx`, `server/routes/settings.js`). NEW /team IS the member-management surface (invite, roles, departments, remove); OLD Team's task features relocated to NEW **/team-work** (`cadence/client/src/pages/TeamWork.jsx` + `components/mywork/TaskSurface.jsx` + `server/routes/tasks.js`), and the permissions/reps/capacity editors to NEW **Settings → Team** (`cadence Settings.jsx:430-457`: `PermissionsManager`, `RepsManager`, task_capacity form). This file judges NEW Team against BOTH OLD sources and credits relocations; anything relocated-with-loss or unrelocated is a defect. Design-token deltas: RC-1..RC-6 in `_audit/01-design-system.md`.

## 2. Route & permissions

| | OLD | NEW |
|---|---|---|
| /team | open to every logged-in user (boom App.jsx:182, no guard); roster + everyone's delegated tasks visible to all (self-added tasks filtered for non-privileged viewers, OLD team.js:349-357) | `AdminRoute` (cadence App.jsx:187); nav item admin-only (cadence Layout.jsx:300) |
| Task surface | same /team page + /team/:id | `/team-work` — `AdminRoute` at the router but server-scoped: Superadmin/Admin whole workspace, Approver own department, others 403 (cadence App.jsx:139, TeamWork.jsx:4-6) |
| Member mutations | OLD settings.js `adminOnly` on all /settings/users routes (:16-22) with Superadmin-only escalation guards (:62-64, :159-175) | NEW team.js: GET / any member (:37), POST / + /:id/resend + PATCH /:id + DELETE /:id `requireAdmin` (:57, :107, :127, :167) — **no Superadmin-tier guards on POST/PATCH** (see P1) |

## 3. Server/API diff

| Concern | OLD | NEW | Δ |
|---|---|---|---|
| Roster | `GET /team` — id/name/email/role/department/hierarchy_level/created_at, ordered hierarchy→name (OLD team.js:84-93) | same + computed `pending` (password NULL ∧ invite_token present), platform operators filtered out (NEW team.js:36-52) | parity+ ([INT] operator filter) |
| Create member | OLD settings.js `POST /users` — admin sets a password, bcrypt, `boom_rep`; Superadmin-only for Admin/Superadmin roles (:55-124); optional welcome email via EmailPreviewModal payload | NEW `POST /team` — created passwordless with a 7-day invite token, invite email best-effort, link returned for copy (:57-105); role/department enum-validated (:20-24); dupe email → 400 (:99-101) | [INT] invite architecture; **escalation guard lost** (P1) |
| Resend/revoke invite | n/a (no invite model) | `POST /:id/resend` regenerates token + re-emails (:107-125); no explicit revoke (delete the member instead) | NEW-only |
| Edit member | OLD settings.js `PUT /users/:id` — name/email/role/department/hierarchy/password/boom_rep; Superadmin-only to edit admins or assign admin roles (:159-166); last-Superadmin **demote** guard (:170-175) | NEW `PATCH /team/:id` — name/role/department/hierarchy_level COALESCE patch; token_version bump when role/department actually changed (:127-160) | **all three escalation guards absent** (P1); no email/password edit ([INT] — invite model owns passwords) |
| Delete member | OLD settings.js `DELETE /users/:id` — self-delete 400, Superadmin-only for admins, last-Superadmin guard, tasks/activity cleanup + dynamic FK sweep in a transaction (:225-260) | NEW `DELETE /team/:id` — identical guard set via `checkUserDeletable` + `deleteUserWithSweep` (team.js:167-180, lib/userDelete.js:11-24) | parity |
| Member detail | `GET /team/:id` (member + releases w/ checklist completion + tasks + activity, visibility-filtered) and `GET /team/:id/tasks` (OLD team.js:338-431) | none | missing (P1, see /team/:id) |
| Tasks | `POST /team/tasks` (hierarchy → task_type request/assignment, `pending_email` preview payload back to client), `PUT /tasks/:id`, `/tasks/:id/assign`, `/tasks/reorder`, `DELETE /tasks/:id` (creator or level-≥ rule) (OLD team.js:432-700) | relocated to `server/routes/tasks.js` — department-boundary `teamFilter`/`canMutateTask`/`canAssignTo`, bulk PATCH, midpoint reorder; assignment email sent directly, fire-and-forget (tasks.js:140-153) | relocated; request semantics + email preview lost (P2/P3) |
| Workload | `GET /team/workload` — releases-by-assignee w/ checklist completion (OLD team.js:214-253) | none; NEW WorkloadView derives from the one task fetch vs `labels.settings.task_capacity` | release dimension lost (P2) |
| Velocity | `GET /team/velocity` (admin) — per-member release velocity, 30/90d, 12-mo monthly buckets, on-time rate (OLD team.js:105-213) | none anywhere | missing (P1) |
| My-work | `GET /team/my-work` (OLD team.js:256+) | relocated to /my-work + routes/tasks.js | relocated, judged in my-work.md |
| Rep visibility | OLD settings.js visible-reps CRUD + per-user editor UI in Settings.jsx; `boom_rep` identity field on users (:33, :57) | endpoints exist (`GET/PUT /settings/visible-reps/:userId`, cadence settings.js:108-146) and ledger enforces (cadence ledger.js:108-109) but **zero client callers** (repo grep: no `visible-reps` in client/src); `RepsManager` manages only the label-level rep roster (`/reps`, RepsManager.jsx:14-31) | editor unreachable (P1) |

## 4. UI structure diff

- OLD /team: PageHeader ("N members · M active tasks" subtitle :263) with New Task button + People/Workload/Velocity segmented toggle (admin sees Velocity) (:264-287) → global quick-task composer with live `@`-mention assignee dropdown, category/priority/date selects (:291-378) → department filter tabs "Everyone | …" (:383-397) → **People list**: expandable rows with avatar (overdue = red tint), name → link to /team/:id, YOU/ADMIN/APPROVER/SUPERADMIN/EXEC 9px badges (:749-763), done-% progress bar (:766-777), req/overdue/in-progress/todo count pills (:779-785); expanded panel = assign-or-request form (violet request styling by hierarchy :793-841) + task rows (3-state checkbox cycler, category chip, priority dot, due date, hover delete) (:843-923). **Workload**: per-member capacity strip (5-tier score from overdue/in-progress/todo/releases), stacked task bar + legend, release chips w/ vertical completion bar + days-until, avg % (:399-558). **Velocity**: 4 stat cards, 9-col per-member table w/ 12-month trend micro-bars + on-time-rate pill, recent-releases cards (:560-715). Plus EmailPreviewModal for the assignment email (:931-948).
- NEW /team: PageHeader + "Invite member" button (:89-93) → invite-result banner (link mono, Copy w/ Copied state, email-sent/error status, Dismiss :96-118) → invite form (name/email/role/department selects :120-136) → members table: Member (name + email + amber "Invite pending" pill :146-150), Department (admin-editable select w/ sign-out warning toast :71-77, :155-165), Role (Superadmin-only select on non-self rows, else pill :170-179), actions (Resend for pending :183-186, Trash remove non-self :188-191).
- NEW /team-work (relocation target): Board/Table/Calendar/List/Workload views, group/filter/sort, quick-add drawer with assignee select + hotkeys (TaskSurface.jsx:162-215, :384-412).
- OLD /team/:id (TeamMember.jsx): member header + releases/tasks/activity tabs — no NEW counterpart (tracked in the dedicated `missing--team-member` entry; kept brief here).

## 5. Behavior/interactions diff

- Invite: NEW creates → shows link + email status, resend regenerates the token; toasts throughout (:38-61). OLD had no invites (direct password create in Settings) — [INT].
- Role change: NEW inline select, Superadmin-only client-side, self-row read-only (:63-67, :170); OLD Settings modal edit with server-enforced tiering. NEW's enforcement is client-side only (P1).
- Department change: NEW inline select, warns "they'll be signed out" (token_version bump) (:68-77) — [INT] consequence of department-as-permission-boundary; OLD department was a display string edited in Settings.
- Remove: `window.confirm` → DELETE with full server guards (:79-83). Parity with OLD Settings (which also disabled the button client-side for last-Superadmin, boom Settings.jsx:648, :740 — NEW relies on the server error toast instead; acceptable).
- Hierarchy: NEW never displays or sets `hierarchy_level` — invite form omits it (default 99, NEW team.js:66), PATCH is never sent it from this UI; OLD set it at create/edit (boom Settings.jsx:255, :302, :317) and used it for assign-vs-request + delete rights + EXEC badges + roster order (P2).
- Task interactions (assign, request, 3-state toggle, delete rights, dept tabs, @-mention, `n`/1-2-3 hotkeys :52-55): all gone from /team; /team-work covers assignment/status/reorder but has no request-upward concept and no @-mention parse (P2/P3).
- Loading/error: OLD full-page spinner + error text (:247-256, :380); NEW "Loading…" text, load errors swallowed (`.catch(() => {})` :31), no empty state needed (self always listed).
- Impersonation entry point: in the Layout header in both apps, not on either Team page (grep: boom Layout.jsx / cadence Layout.jsx) — No differences found (for this page).
- Task-capacity setting: NEW-only, Settings → Team (cadence Settings.jsx:136-150, :432-454), powers /team-work Workload bars. No OLD counterpart — not a defect.

## 6. Visual/design diff

- RC-1..RC-6 apply. Page-specific:
- OLD role badges: 9px uppercase tracked chips (YOU gray / ADMIN red-boom / APPROVER amber / SUPERADMIN violet / EXEC violet) (:757-761); NEW: rounded-full `text-xs` pills, brand/indigo/amber/gray tones (ROLE_STYLES :9-14) — larger, no YOU/EXEC concept, Superadmin brand-colored instead of violet.
- OLD rows carry avatars (initial circles, state-tinted); NEW table has none.
- OLD is list-of-cards density with 10-11px metadata everywhere (RC-3); NEW is a standard table with `text-xs`/`text-sm`.
- NEW invite banner `bg-brand-50/40 border-brand-200` with mono link text — no OLD analogue.
- OLD dept tabs = underline tabs; NEW has no dept filter UI.

## 7. Defect table

| Sev | Defect | Evidence | Conf |
|---|---|---|---|
| P1 | **Privilege-escalation guards missing server-side**: `POST /team` and `PATCH /team/:id` are plain `requireAdmin` — an Admin can invite or promote anyone to Superadmin, edit a Superadmin's role/department, or demote the last Superadmin (only DELETE is guarded). OLD enforced Superadmin-only create/edit of admin tiers + a last-Superadmin demote guard. NEW hides the control client-side only (Team.jsx:170) | NEW team.js:57-105, :127-160 vs OLD settings.js:62-64, :159-175; delete-only guards in cadence lib/userDelete.js:11-24 | HIGH |
| P1 | Velocity analytics gone with no counterpart: per-member release velocity (4 team stat cards, 9-col table w/ 12-month trend bars + on-time rate, recent-releases cards) + `GET /team/velocity` | OLD Team.jsx:560-715 + OLD team.js:105-213; no NEW route or view (repo grep) | HIGH |
| P1 | Per-user rep-visibility editor unreachable: NEW server keeps `GET/PUT /settings/visible-reps/:userId` and the ledger enforces it, but no client code calls it — restricting a user's visible reps now requires direct DB writes. OLD had the editor in Settings | cadence settings.js:108-146, ledger.js:108-109; grep `visible-reps` in cadence client/src = 0 hits; OLD Settings.jsx (boom_rep + reps UI, settings.js:449) | HIGH |
| P1 | `/team/:id` member detail page missing (releases w/ completion, task list w/ visibility rules, activity log; `GET /team/:id`, `GET /team/:id/tasks`) — brief here; full entry lives in `missing--team-member` | OLD TeamMember.jsx (266) + OLD team.js:338-431; NEW has neither route nor page | HIGH |
| P2 | Workload lost the release dimension: OLD blended assigned releases (chips w/ completion + days-until) into a 5-tier capacity score (overdue×3 + inProgress×2 + todo + releases×2); NEW WorkloadView is open-task count vs `task_capacity` only | OLD Team.jsx:399-558 + team.js:214-253 vs cadence WorkloadView (per CLAUDE.md task build; TaskSurface data pipeline) | HIGH |
| P2 | Request-vs-assign hierarchy semantics dropped: `task_type='request'` when the target outranks you, violet REQUEST styling, request-count pills, request-aware delete rights; NEW tasks have no task_type — upward assignment just 403s via `canAssignTo` | OLD team.js:432-467, :660-700 + Team.jsx:173-179, :781, :793-841, :892-896; cadence tasks.js has no task_type (grep) | HIGH |
| P2 | Team visibility narrowed: OLD /team was every user's window into who's on the team and who's carrying what; NEW /team is admin-only and /team-work is Approver+ — a plain User has no people directory at all | boom App.jsx:182 vs cadence App.jsx:139, :187 | LOW (may be a deliberate privacy stance; not forced by multi-tenancy) |
| P2 | `hierarchy_level` orphaned: no NEW UI displays or sets it (invitees all land at 99); server PATCH accepts it and the roster still orders by it, so ordering is frozen at defaults | NEW team.js:66, :138-146 + Team.jsx (no field) vs boom Settings.jsx:255, :302, :317 + Team.jsx:29-30, :761 | HIGH |
| P3 | Task-assignment email sends silently, fire-and-forget — OLD returned a `pending_email` payload for EmailPreviewModal (editable To/CC, skip, queue) | cadence tasks.js:140-153 vs OLD team.js POST /tasks + Team.jsx:931-948 | HIGH |
| P3 | Roster at-a-glance task summary gone from any people list: per-member done-% progress bar, req/overdue/active/todo pills, "N members · M active tasks" subtitle, dept filter tabs (grouping exists on /team-work but there is no per-person rollup row) | OLD Team.jsx:242-245, :263, :383-397, :717-929 | HIGH |
| P3 | `@`-mention quick-task composer (type `@name` inline → assignee chip) + `n`/view-number hotkeys on the team surface — NEW quick-add uses a plain assignee select, no mention parse | OLD Team.jsx:48-128, :291-378 vs cadence TaskSurface.jsx:162-215, :384-412 | HIGH |
| P3 | Member-row identity styling: avatars + YOU/EXEC badges absent; role tones remapped (Superadmin violet→brand) | OLD Team.jsx:739-763 vs NEW Team.jsx:9-14, :146-156 | HIGH |

Intentional divergences:
- [INT] Invite-link onboarding (passwordless create, 7-day token, resend, pending badge, copy-link fallback, email-sent/error surfacing) replacing OLD's admin-set password + welcome email — multi-tenant auth architecture (NEW team.js:57-125, Team.jsx:96-118).
- [INT] `token_version` bump when role/department actually changes (+ "they'll be signed out" toast) — department is a JWT claim NEW's task scoping trusts (NEW team.js:135-146, Team.jsx:68-77).
- [INT] Department constrained to the `DEPARTMENTS` enum with a loud server 400 — it is a permission boundary in NEW (team.js:15-24).
- [INT] Platform operators filtered out of the roster; invite link built from `FRONTEND_URL`/Origin, never the Host header (team.js:26-33, :41-44) — tenancy/security hardening.
- [INT] Email/password editing absent from PATCH — the invite/accept flow owns credentials in NEW.

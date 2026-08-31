# missing--team-member — Member detail page (OLD `/team/:id`)

## 1. What it is
Per-person profile: one member's identity, workload stats, assigned releases, task list,
and activity trail — the drill-down behind every name on OLD's /team roster.
- Route: `/team/:id` → `TeamMember` (OLD `client/src/App.jsx:183`); reached via the
  name link on OLD Team.jsx roster rows (see `_audit/pages/team.md` §4).
- Permissions: Protected shell, any logged-in user; per-viewer TASK visibility enforced
  server-side (OLD `server/routes/team.js:348-357` — see §2).

NOTE: the roster/CRUD/velocity/workload comparison lives in `_audit/pages/team.md`
(its P1 row already points here). This entry is ONLY the detail-page anatomy.

## 2. OLD anatomy (`client/src/pages/TeamMember.jsx`, 266 lines)

**Profile header card** (:85-135)
- Avatar initial circle, boom-tinted when viewing yourself (:88-93); name + 9px badges:
  YOU (self), ADMIN, APPROVER, SUPERADMIN, and EXEC when `hierarchy_level <= 2`
  (:96-103); subtitle `department · email` (:105).
- **4 stat tiles** (:110-124): Releases count · Avg Completion (mean of per-release
  checklist %, :64-66) · Open Tasks (highlighted when >5) · Overdue (red when >0,
  `isPastLocal(due_date)` :61-63).
- **Upcoming alert** (:128-135): orange banner "N releases dropping in the next 14 days
  with incomplete checklists" — releases where `daysUntilLocal(release_date)` in 0..14 (:67-70).

**Tab strip** (:72-77, :139-159): Releases (count) / Tasks (open count) / Activity, red
underline active style.

**Releases tab** (:163-205): rows link to `/releases` with `state.highlightId` (:176-179);
project name, artist · formatted date; checklist completion bar + % (emerald at 100%);
days-until chip ("Today" / "Nd" / "Nd ago", red when ≤7 days out, faded when past,
:169-171, :196-198); HIGH badge when `priority === 'high priority'` (:200).

**Tasks tab** (:209-247): priority dot (Urgent red / High boom / Medium amber / Low gray,
:9), description w/ line-through when Done, category chip (7-color map :15-23),
"from {assigned_by_name}" attribution (:229-231), due date (red+bold when overdue),
status pill To Do/In Progress/Done (:10-14). Overdue rows get red border/tint (:219).

**Activity tab** (:251-276): last-30 `activity_log` rows — initial avatar, `detail` text,
short timestamp.

**Server — `GET /api/team/:id`** (OLD `server/routes/team.js:338-401`; deliberately
registered AFTER the named /team routes, comment :337)
- Member row: id/name/email/role/department/hierarchy_level (:341-345); 404 on miss.
- **Task visibility rule** (:348-357): Admin/Superadmin or self-view see all tasks;
  everyone else only sees DELEGATED tasks (`assigned_by IS NOT NULL AND assigned_by
  != user_id`) — self-added personal tasks stay private.
- Parallel queries (:358-385): releases where `assigned_to = :id`, non-archived, with all
  `CHECKLIST_KEYS` booleans → computed `completion` % (:387-390); tasks + assigned_by_name;
  `activity_log` LIMIT 30.
- Sibling `GET /api/team/:id/tasks` (:404-431): same visibility filter, tasks only —
  used by the roster's expandable rows, listed here because a port shares the rule.

## 3. NEW status — confirmed absent
- No `/team/:id` route in NEW `client/src/App.jsx` (grep `team/` → only api calls in
  Team.jsx), no member-detail page component.
- NEW `server/routes/team.js` has only `GET /` (:39), `POST /` (:60), `POST /:id/resend`
  (:105), `PATCH /:id` (:128), `DELETE /:id` (:175) — no member-detail GET.
- Partial coverage elsewhere: NEW `/team-work` can group-by-assignee (tasks dimension
  only, Approver+); NEW Team.jsx table shows role/department inline. Nothing shows one
  person's releases, completion stats, overdue rollup, or activity trail. NEW does have
  the data: `releases.assigned_to` (NEW `server/routes/releases.js:49,123`), tasks w/
  `assigned_by`, `activity_log`.

## 4. Port requirements
- Endpoint: label-scoped `GET /api/team/:id` — member row (`AND label_id`), releases via
  `assigned_to` + NEW's 14-item checklist completion, tasks w/ OLD's visibility filter
  (mind NEW's department-boundary rules in `routes/tasks.js` — an Approver-lead port
  should reuse `teamFilter()` semantics rather than the OLD admin-or-self rule),
  `activity_log LIMIT 30`. Route ordering: keep `/:id` after named routes (OLD team.js:337)
  — NEW team.js currently has no named GETs so a bare `/:id` is safe, or `(\\d+)`-constrain
  it per the bank-statements precedent.
- Client: new page + route + name-links from NEW Team.jsx rows; reuse `utils/dates.js`
  (`formatDate/isPastLocal/daysUntilLocal`), `Skeleton`, existing Breadcrumb-equivalent,
  task status/priority chip styles from `components/mywork/taskFields.js`.
- Decide viewer gate: OLD was open to all users; NEW /team is AdminRoute — mirroring team.md's
  P2 "visibility narrowed" call, the detail page's gate should be decided with it.

## 5. Defects
- [P1] Member detail page missing — no per-person view of releases (w/ checklist completion + 14-day risk), delegated tasks (privacy-filtered), stats (avg completion / open / overdue), or activity trail (OLD TeamMember.jsx 266L + team.js:338-431); already flagged as a P1 row in _audit/pages/team.md §7 — fix: new page + route + label-scoped `GET /team/:id` (HIGH)

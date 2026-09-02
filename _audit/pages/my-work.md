# My Work

OLD: `boom-dashboard/client/src/pages/MyWork.jsx` (1,703 ln) + `components/MyWorkRail.jsx` + `components/mywork/{TaskList,TaskDetail}.jsx` + `components/mywork/useAutosave.js` + `server/routes/team.js` (GET /team/my-work :256, POST/PUT/DELETE /team/tasks* :432-698)
NEW: `cadence/client/src/pages/MyWork.jsx` (18 ln) + `pages/TeamWork.jsx` (27 ln) — thin shells over `components/mywork/*` (TaskSurface 549, TaskToolbar 323, TaskBoard 75, TaskTable 211, TaskCell 126, TaskCalendar 158, TaskDrawer 218, WorkloadView 151, TaskCard 98, GroupHeader 44, Popover 40, WaitingOnYou 54, taskFields.js 298, useTaskData 193, useTaskView 160, useTaskDnd 99) + `constants/taskViews.js` + `server/routes/tasks.js` (647 ln).

Context: OLD itself was rebuilt 2026-08-27 into a two-pane Notes UI; several controls in OLD are **rendered but dead** (see §4 "OLD dead controls"). NEW is a from-scratch Notion-style database (documented in cadence CLAUDE.md "Post-spec: task database views + Team Work"). This diff compares LIVE OLD behavior against NEW.

## 1. Layout & structure

**OLD** (`MyWork.jsx:1031-1701`):
1. Greeting header — time-of-day `Good morning, {first}.` h1 `text-3xl font-black` (:1036) + status pill row: red "N overdue", amber "N due today", blue "N in progress" solid-color pills, gray open/release counts (:1039-1059); empty fallback "Your workspace is clear. Time to create." (:1062).
2. Two-column command-center grid `lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]` (:1073); on <lg the right rail is ordered FIRST as a horizontal strip (:1679, MyWorkRail.jsx:81-106).
3. Upcoming-deadline alert — orange banner "N releases dropping in the next 14 days" with per-release chip links (name · Nd · completion%) (:1077-1105).
4. ONE card with a 3-tab strip: **To Do Today** (count) / **My Tasks** (count) / **My Releases** (count) (:1025-1029, :1109-1127), tab-level controls in the strip (release sorts :1132-1147, Assign Release :1148-1157, Group segmented control :1165-1184, Filter button :1186-1201, calendar toggle :1202-1210, New Task :1211-1217).
   - To Do Today: "Also today" strip, rollover banner, Overdue/Due today/In progress sections, Plan-your-day suggestions (:1230-1461).
   - My Releases: assign panel + sorted release rows with completion bars (:1464-1601).
   - My Tasks: Notes-style two-pane — 300px list column (Open/Done/All buckets + search) + autosaving detail pane (:1615-1671; TaskList.jsx; TaskDetail.jsx).
5. Right rail `MyWorkRail` (reviews / mentions / approvals / statement cutoff / stalled bulk deals) (:1679-1681).
6. `EmailPreviewModal` raised when an assignment returns `pending_email` (:1683-1700).

**NEW** (`TaskSurface.jsx:347-548`):
1. `PageHeader` "My Work / Tasks assigned to you" (pages/MyWork.jsx:14) — no greeting, no pills.
2. `WaitingOnYou` strip (Approver+ only): up to 3 count tiles — overdue tasks, awaiting approval, campaigns to review (WaitingOnYou.jsx:26-51).
3. `TaskToolbar` two rows: view switcher (Board/Table/Calendar/List[/Workload]) + saved-views menu + Add task; search + Group select + Sort select/direction + Filters popover + Columns popover (TaskToolbar.jsx:72-309).
4. Optional inline quick-add form (desktop card grid / mobile BottomSheet) (TaskSurface.jsx:378-466).
5. Count line "N of M tasks · drag hints · undo depth" (:468-474).
6. View body: TaskBoard / TaskTable / TaskCalendar / list (TaskTable dense) / WorkloadView (:260-345).
7. Floating bulk-action bar when rows selected (:486-522).
8. `TaskDrawer` right-panel overlay with ObjectDiscussion thread (:524-534) + "Task unavailable" modal (:536-546).
9. Sibling page **/team-work** (no OLD analog) — same shell with `surface="team"` (pages/TeamWork.jsx), route Approver+-gated (App.jsx:139, :93-98).

Net: single-card 3-tab personal command center → toolbar-driven multi-view database. No element of the OLD page layout survives except the concept of a "waiting on you" rail.

## 2. Visual differences

| Element | OLD | NEW | Source |
|---|---|---|---|
| Page title | `Good {morning...}, {first}.` `text-3xl font-black text-gray-900` | static "My Work" `text-xl font-bold text-ink` + subtitle | OLD MyWork.jsx:31-35,1036; NEW PageHeader.jsx:5, pages/MyWork.jsx:14 |
| Header status pills | solid `bg-red-500/amber-500/blue-500 text-white` rounded-full counts | none | OLD :1039-1053 |
| Primary nav on page | underline tab strip, active `border-red-500 text-red-500` + count pill `bg-red-50` | segmented pill switcher on `bg-page`, active `bg-card shadow-sm ring-1 ring-rule` | OLD :1111-1126; NEW TaskToolbar.jsx:78-97 |
| Priority encoding (rows) | list: dot WEIGHT, gray scale (Urgent filled `fill-gray-900` → Low hairline `text-gray-300`) — deliberately colorless (TaskList comment :12-16); today rows: stripe Urgent `bg-red-500`/High `bg-amber-400`/Medium `bg-blue-400`/Low `bg-gray-300` | colored left border stripe High `border-l-red-500`/Medium `border-l-amber-500`/Low `border-l-gray-300`; calendar dot High red/Medium amber/Low gray | OLD TaskList.jsx:23-28, MyWork.jsx:112-117; NEW taskFields.js:20-21 — **High shifts amber→red, Medium blue→amber** (Urgent gone, see §7-1) |
| Overdue date color | `text-rose-600 font-semibold` | `text-danger font-medium` (#dc2626) | OLD TaskList.jsx:108-109; NEW TaskCard.jsx:13, tokens per 01-design-system.md |
| Selected row | `bg-boom-50` list row | `ring-2 ring-brand-400` card / `bg-selected` table row (multi-select) | OLD TaskList.jsx:77; NEW TaskCard.jsx:57, TaskTable.jsx:148 |
| Done task | `line-through text-gray-400` 13px row | `line-through text-ink-muted` 14px card text | OLD TaskList.jsx:102-103; NEW TaskCard.jsx:78 |
| Category display | uppercase 10px gray text in list; colored chips per category (`CATEGORY_STYLE`, 7 hues) elsewhere | plain `text-ink-muted` 11px inline text, no color coding anywhere | OLD TaskList.jsx:120-124, MyWork.jsx:38-47; NEW TaskCard.jsx:87 |
| Row typography | title `text-[13px]`, body preview `text-[12px]`, date `text-[11px]` | card title `text-sm` (14px), meta `text-[11px]` | OLD TaskList.jsx:102,117; NEW TaskCard.jsx:78-79 (RC-3 pattern) |
| Detail editor | full-pane borderless: 19px bold title input, flex-1 borderless textarea, one quiet 12px metadata line | 448px drawer with labeled `.input` fields + 5-row textarea | OLD TaskDetail.jsx:134-215; NEW TaskDrawer.jsx:98-203 |
| Loading state | Skeleton.PageHeader + card w/ 2 line stubs + Skeleton.TaskList(4) | per-view: Skeleton.Table / TaskList(6) / Block h-32rem / KanbanBoard | OLD :834-847; NEW TaskSurface.jsx:260-267 |
| Drop indicator | `border-t-2 border-t-boom-500` on hovered row | 2px `bg-brand-500` insertion line above/below card; inset td shadow in table | OLD TaskList.jsx:76; NEW TaskCard.jsx:42-43, TaskTable.jsx:24-31 |
| Accent | boom red throughout (`bg-boom-600` New Task, `text-boom-600` links) | brand var (RC-2) | e.g. OLD :1214; NEW throughout |
| Card radius / fonts / control heights | RC-6 / RC-1 / RC-5 apply page-wide | — | 01-design-system.md |

## 3. Copy & content differences

- Greeting "Good morning, {name}." → "My Work" + "Tasks assigned to you" (OLD :31-35; NEW pages/MyWork.jsx:14).
- "Your workspace is clear. Time to create." (OLD :1062) → "Nothing on your plate yet." + Add task button (NEW TaskSurface.jsx:293).
- List empty: "No tasks here." / "Nothing matches." (OLD :1647) → filtered-empty "No tasks match these filters." + "N tasks hidden." + Clear filters (NEW :305-313, no OLD analog).
- "All clear for today. Nothing overdue, due today, or in progress. {Weekday, Month D}." (OLD :1377-1380) — no NEW equivalent (no Today surface; the "Today" preset just shows an empty list).
- Rollover: "N tasks rolled over from previous days." / "Reschedule all → today" (OLD :1408-1416) — absent in NEW.
- "Also today" strip: "⚑ N reviews assigned to you", "@ N unread mentions", "⏳ statement cutoff in N days" (OLD :1352-1364) — absent.
- Relative dates: OLD "3d ago / Yesterday / Today / Tomorrow / In N days / {date}" (:49-61) → NEW "N days late / Due today / Due tomorrow / Due {date} / No due date" (taskFields.js:47-55).
- Title placeholder "Untitled — type @ to hand it to somebody" (OLD TaskDetail.jsx:142) → none (NEW drawer input has no placeholder, TaskDrawer.jsx:119).
- Notes placeholder "Write…" (OLD TaskDetail.jsx:213) → "Longer detail, links, context…" (NEW TaskDrawer.jsx:172).
- Detail-pane empty "Select a task" (OLD TaskDetail.jsx:120) → n/a (drawer only opens on demand); NEW adds "Task unavailable / This task was deleted, or reassigned somewhere you can't see it." (TaskSurface.jsx:539-545).
- Snooze title "Snooze — push the due date to tomorrow" / btn "Tmrw" (OLD :1304-1306) and "Push out a week" (OLD TaskDetail.jsx:199 — OLD's own title/behavior mismatch, snooze is +1 day :726-729) — all absent in NEW.
- Rail heading "Waiting on you" retained (OLD MyWorkRail.jsx:85,112; NEW WaitingOnYou.jsx:30); rail item copy entirely different (§4).
- NEW-only copy: toasts ("Saved", "Task added", "n of m updated"…, useTaskData.js:89-149), "Only team leads can reassign." (TaskDrawer.jsx:160), delete confirms (TaskToolbar.jsx:318, TaskDrawer.jsx:212), "drag-to-reorder needs the Manual sort · press z to undo (N)" (TaskSurface.jsx:471-472), Workload copy ("Available", "of {cap} · over", WorkloadView.jsx:110,130).

## 4. Feature & interaction differences

### Present in OLD, missing in NEW
- **To Do Today tab** (:1230-1461): triage partition Overdue (most-late first, "Nd late" badges) / Due today / In progress-only sections with per-section headers+counts; hover-reveal **Start** (→ In Progress, :1292-1300) and **Tmrw snooze** (+1 day, :1301-1307, :726-729); **rollover banner** with one-click "Reschedule all → today" (:1406-1419, :737-746); **"Plan your day" suggestions** (top-priority undated tasks + "+ Today" button, :1326-1348); **"Also today" cross-app strip** (reviews assigned to me via /artist-campaigns/review-feed, unread mentions via /notifications, statement-cutoff ≤7d countdown, :748-771, :1350-1367). NEW's `preset:today` / `preset:overdue` list views (constants/taskViews.js:58-65) cover only the due-date slices; nothing covers Start/snooze/rollover/suggestions/strip.
- **My Releases tab** (:1464-1601): my assigned releases with 14-item checklist completion bar + %, days-until, HIGH-priority badge, hover unassign (:1587-1594), 4-key sort control (:892-897,1132-1147), and the **Assign Release panel** (searchable unassigned list, per-row Assign, :1468-1538, PUT /releases/:id/assign :384-410). No NEW analog on either task page; NEW's task payload has no releases at all.
- **MyWorkRail** for all users (MyWorkRail.jsx): review items with payee/amount/artist rows + "+N more" (:121-146), unread-mentions list with actor + snippet deep links (:149-167), statement-cutoff countdown card (:181-190), stalled-bulk-deals card list (:193-207), all-clear card (:114-118), mobile horizontal StripCards (:81-106). NEW `WaitingOnYou` keeps only three COUNT tiles (overdue tasks / pending approvals / campaign reviews) and renders **nothing for non-Approver users** (WaitingOnYou.jsx:13,26) — OLD gated only the approvals card (`isBkAdmin`, MyWorkRail.jsx:15,41-45).
- **Upcoming-deadline alert** — "N releases dropping in the next 14 days" chips (:1077-1105; served from /team/my-work `upcoming`, team.js:299-302). Absent from NEW my-work (NEW Releases *list page* has a 14-day banner per CLAUDE.md, not this page).
- **@-mention assign in the task title** — typing `@` in the detail title offers the roster, picking strips the mention and hands the task over via PUT /team/tasks/:id/assign, Enter picks first match (TaskDetail.jsx:84-166; MyWork.jsx:534-549). NEW reassignment is a plain select in drawer/table, and only for leads (TaskDrawer.jsx:154-160, TaskCell.jsx:109-120).
- **EmailPreviewModal on assign** — OLD server *prepares* the notification (`pending_email`, team.js:477-496, :550-568) and the client previews it with editable To/CC, Send/Skip (MyWork.jsx:1683-1700). NEW **auto-sends** fire-and-forget with no preview and no opt-out (tasks.js:137-154, :243-246, :618-620).
- **One-click complete** — status circle on every row toggles To Do/In Progress → Done → To Do (TaskList.jsx:90-98, MyWork.jsx:24,693-704; also in TaskDetail:172-176). NEW has no done-toggle affordance; completing requires the inline status select, the drawer, board-drag to Done, or the bulk bar.
- **Pin to top** (localStorage `pinned_tasks`, pin-first ordering; MyWork.jsx:342-352,807-810; TaskDetail.jsx:201-202) — dropped; CLAUDE.md logs it as deliberate ("pinned (redundant with drag)").
- **Release link editing** — OLD TaskDetail release `<select>` (TaskDetail.jsx:219-231). NEW shows `release_name` readonly (taskFields.js:99, TaskDrawer.jsx:183-185) and no UI can set/clear `release_id`, though the server accepts it (tasks.js:531,556-559).
- **Task notes autosave** — per-keystroke debounced 600ms with id-captured writes + retry (useAutosave.js; MyWork.jsx:243-260). NEW notes commit on blur / explicit "Save notes" / drawer-close cleanup only (TaskDrawer.jsx:33-44,76-80,165-179).
- **?new=task deep link** — OLD FAB navigated with `?new=task` and the page auto-opened creation (:279-289). NEW Fab targets bare `/my-work` (Fab.jsx:14) and TaskSurface reads no query params — landing does not open the form.
- Refetch on acting-user switch — OLD `useEffect(fetchData, [user?.id])` (:461); NEW `useTaskData` reloads only on surface change (useTaskData.js:57-66). CONFIRMED 2026-09-02 (Phase 10) — enter-workspace/impersonation is setState-only: `AuthContext.jsx:97-129` calls setToken/setUser/setLabel with no reload and no `key` change, and `App.jsx` puts no `key` on Layout. The tree does NOT remount, so this stale-data defect is real whether cadence impersonation remounts the tree.
- **Quick-add NL parsing** (`!high`/`#category`/today/tomorrow/weekday, :628-681) — NOT a live regression: OLD's own 2026-08-27 rebuild left it unreachable dead code (dead-cluster comment :467-486 names `quickAddTask`). Recorded for completeness.

### Present in NEW, missing in OLD
- **/team-work page** — department-scoped team surface (server `teamFilter`, tasks.js:67-73: Admin → workspace, Approver → own department, else 403; route gate App.jsx:93-98,139), Workload view (per-person absolute-capacity bars, overdue/dueToday/week/high/done-7d chips, unassigned drill-through; WorkloadView.jsx), assignee/department group-bys, "Assign to" in quick-add, bulk Assign.
- **Four switchable views** — Board (kanban by any dimension, TaskBoard.jsx), Table (sticky header, frozen first column, ~9 toggleable columns, inline cell editing, TaskTable.jsx/TaskCell.jsx), Calendar (real month grid, drag-to-reschedule, undated tray, TaskCalendar.jsx — OLD's CalendarView existed but was never rendered, see below), List (dense single-column).
- **Saved views** — `task_views` table + /tasks/views CRUD (tasks.js:262-349), 6 client presets, upsert-by-name with collision warning, last-used persistence (useTaskView.js:38-135; TaskToolbar.jsx:99-166; constants/taskViews.js).
- **Filters** — search across description/category/assignee/release/notes, multi-select status/priority/assignee/category, due-bucket filter, "Hide Done older than 30 days" (taskFields.js:112-139; TaskToolbar.jsx:235-284). OLD's live UI had only the list search over description/notes/category (:800-806) — its category/priority/assigned-by filter row was dead.
- **Multi-select + bulk bar** — checkbox selection, bulk status/priority/due-today/assign in one PATCH /tasks/bulk with "n of m" reporting (TaskSurface.jsx:486-522; tasks.js:358-428).
- **Undo stack** — 20-deep, `z` hotkey, exact-field rollback (useTaskData.js:16,79-104).
- **Hotkeys** — n/f/g/z/1-5/Escape (TaskSurface.jsx:215-235). OLD: "Keyboard shortcuts — disabled for now" (:1019).
- **Optimistic mutation layer** — patch + exact rollback + toasts; neighbor-based reorder with renormalize-and-refetch (useTaskData.js:79-186).
- **Per-group quick add** — "+" on a droppable column pre-fills the group's implied field (TaskSurface.jsx:160-168; GroupHeader.jsx:32-41).
- **completed_at** stamping + Workload "done this week" (tasks.js:604-607, :393-395; WorkloadView.jsx:37).
- **ObjectDiscussion thread per task** in the drawer (TaskDrawer.jsx:191-195).
- **Task-unavailable modal** for rows dropped by refetch (TaskSurface.jsx:207-210,536-546).
- Mobile: BottomSheet quick-add + snap-scroll board + list fallbacks for table/calendar (TaskSurface.jsx:318-343,378-426; TaskBoard.jsx:17).

### Behaves differently
- **Create**: OLD "New Task" creates a row instantly ("New task", Medium/General) and opens it in the pane, Notes-style (:559-597). NEW opens a form first; nothing is created until submit (TaskSurface.jsx:160-184).
- **Delete**: OLD deletes immediately with no confirm (TaskDetail.jsx:203-204 → :706-716). NEW ConfirmDialog with truncated title (TaskDrawer.jsx:207-214).
- **Reorder protocol**: OLD PUT /team/tasks/reorder `{ids:[...]}` — whole-list rewrite, sort_order = array index, own-tasks-only via WHERE (team.js:588-611); drop index from hovered row (MyWork.jsx:993-1017, TaskList.jsx:68-73). NEW PATCH /tasks/:id/reorder `{before_id, after_id}` — integer midpoints on 1024 gaps, loud renormalize + client refetch, per-task permission gate (tasks.js:436-526; useTaskDnd.js; useTaskData.js:162-186). NEW survives concurrent reorders; OLD last-writer-wins the whole list.
- **Untouched-order fallback**: OLD sorts never-dragged tasks by due date under the manual order (`sort_order NULLS LAST, due_date`, :807-823; team.js:276-282). NEW Manual sort puts null-sort_order tasks LAST in id order (taskFields.js:147-172) — a fresh list orders by creation, not due date.
- **Permission model**: OLD = hierarchy_level — anyone assigns down / requests up (`task_type` 'assignment'|'request', team.js:459-466,545), delete by creator-or-hierarchy (:685-690), and PUT /tasks/:id had NO ownership check at all (:613-655). NEW = role/department — canMutateTask (own/admin/dept-lead, not upward, tasks.js:86-107), canAssignTo (admin anywhere, Approver own dept, :114-125), unassign admin-only (:565-571), non-lead creation silently self-assigns (:216-224). `task_type` no longer computed/stored. **Intentional divergence** (documented auth redesign, cadence CLAUDE.md), but note the capability loss: a regular user can no longer hand a task to anyone or request work from a superior.
- **Assignment notification**: prepared-preview-and-decide → auto-send (see §4-missing).
- **Done visibility**: OLD Done bucket lists all completed tasks, pane bucket 'done' (:800-801); NEW default filter hides Done older than 30 days (`hide_old_done: true`, taskViews.js:25; taskFields.js:133-137).
- **Due buckets**: OLD overdue/today/week(1-7d)/later/none (:68-104); NEW adds 'tomorrow' and the 'week' *filter* spans today+tomorrow+week (taskFields.js:25-44,126-131).
- **OLD dead controls now real in NEW**: OLD renders a Group segmented control (:1165-1184), Filter button (:1186-1201) and calendar toggle (:1202-1210) that mutate state nothing reads — `taskGroups` (:967-984), the filter row, and `CalendarView` (:119-218) are never rendered; Today-tab Edit/pencil calls `startEdit` whose form no longer exists (:1277, :307-340). NEW's grouping, filters and calendar actually function — improvement, not defect.

## 5. Data layer differences

| Concern | OLD | NEW |
|---|---|---|
| Page fetch | GET `/team/my-work` → `{releases(+14 checklist bools + completion%), upcoming(≤30d — banner says 14, team.js:299-302 vs MyWork.jsx:1082), tasks(+assigned_by_name, +release_name/release_artist_name), activity(20, fetched but never rendered)}` (team.js:256-335) | GET `/tasks` (own) / `/tasks?scope=team` / `?scope=all` / `?user_id=` (admin) → task rows only via TASK_SELECT (`assignee_name, assignee_department, assigner_name, release_name`) (tasks.js:32-38,165-201). Releases/upcoming/activity gone from the payload |
| Roster | GET `/team` (twice — :267-273 and :463-465) | GET `/team` once (useTaskData.js:71-73) |
| Create | POST `/team/tasks` — hierarchy task_type, returns `pending_email` (team.js:432-503) | POST `/tasks` — lead-gated user_id, release in-tenant check, enum validation, notes/category caps (5000/60), sort_order top-of-label, auto email (tasks.js:205-252) |
| Update | PUT `/team/tasks/:id` — COALESCE partials incl. `progress`, **no auth check** (team.js:613-655) | PATCH `/tasks/:id` — canMutateTask gate, UPDATABLE allow-list (no progress, no user_id-as-field), badEnum, completed_at derivation, reassignment branch + canAssignTo, NaN-id 404 (tasks.js:531-627) |
| Assign | PUT `/team/tasks/:id/assign` `{user_id}` → task_type + pending_email (team.js:523-574) | folded into PATCH `user_id`; unassign admin-only; auto email (tasks.js:563-581,618-620) |
| Reorder | PUT `/team/tasks/reorder` `{ids}` full-list, ≤500, UNNEST ordinality (team.js:588-611) | PATCH `/tasks/:id/reorder` `{before_id,after_id}` midpoint/renormalize, returns `renormalized` flag (tasks.js:457-526) |
| Delete | creator-or-hierarchy rule (team.js:661-698) | canMutateTask (tasks.js:630-645) |
| NEW-only endpoints | — | `/tasks/views` GET/POST/PATCH/DELETE (tasks.js:272-349); PATCH `/tasks/bulk` (:358-428) |
| Priority enum | Urgent/High/Medium/Low (client-only convention; MyWork.jsx:14-19, TaskDetail.jsx:25; server never validates) | High/Medium/Low, server-validated (`badEnum`, tasks.js:536; lib/constants.js:27; client constants.js:21). **'Urgent' dropped** |
| Status enum | To Do/In Progress/Done (convention) | identical, server-validated (lib/constants.js:25) |
| Category | fixed 7 (General/Release/Marketing/A&R/Finance/Legal/Operations; TaskDetail.jsx:26) | free text ≤60 chars, NULL = Uncategorized (tasks.js:15-23; server/index.js:889) |
| Schema | tasks: user_id, assigned_by, **task_type**, description, category, priority, status, due_date, release_id, notes, **progress**, sort_order (dense ints) | tasks: + **label_id**, + **completed_at**, sort_order (1024-gapped); no task_type/progress; new **task_views** table (server/index.js:870-920). (`progress` was already dead in OLD UI — updateProgress :683-691 has no caller) |
| Date handling | local-calendar client helpers `daysUntilLocal/isPastLocal/formatDate` (MyWork.jsx:5); server `upcoming` uses UTC-ish `new Date()` math (team.js:300) | same local-calendar family via utils/dates.js (taskFields.js:11, header comment :5-9); completed_at compared as instant (taskFields.js:133-137). Equivalent semantics for due dates |
| Response envelope | `{success, data}` | `{success, data}` (+ `requested/updated` on bulk, `renormalized` on reorder) — matched |
| Refetch policy | `fetchData()` after most mutations (e.g. :696-698, :710), patched-in for autosave/newTask | optimistic + server-row merge, refetch only after renormalize (useTaskData.js:1-10) |

## 6. Tables & forms

- **OLD forms**: the add-task form and edit-task form were deleted by OLD's own rebuild (dead cluster :467-486; `startEdit`/`saveEdit` :307-340 write state nothing renders). Live editing surface = TaskDetail pane: borderless title input, priority select (4 opts), category select (7 opts), date input, release select, autosaving textarea (TaskDetail.jsx:134-231). Notes modal state (:363-379) is likewise dead.
- **NEW forms**: quick-add (Task/Priority/Due/Category-datalist/Assign-to; desktop grid card, mobile BottomSheet; TaskSurface.jsx:378-466); drawer form (description on blur-commit, status/priority selects, date, category datalist, assignee select w/ lead gating, notes textarea; TaskDrawer.jsx:116-180); save-view inline form with name-collision warning (TaskToolbar.jsx:143-161).
- **Tables**: OLD has none (list rows only). NEW Table view: sticky `thead`, exactly one frozen sticky first column with opaque backgrounds + td-shadow insertion lines, grouped `tbody` sections with collapsible GroupHeader rows, inline TaskCell editors (text select-on-focus, selects commit-on-pointer-change but defer on arrow-key nav, date input; flash tint feedback), per-row checkbox + grip, "Open" hover/focus button (TaskTable.jsx:88-209; TaskCell.jsx).
- Field vocabulary in the NEW grid: description/status/priority/due_date/assignee/category/release(ro)/department(ro)/completed_at(ro) (taskFields.js:92-102); defaults 5 cols mine / 5 team (:105-106).

## 7. Defects found

1. **[P1] 'Urgent' priority level dropped** — OLD ranks Urgent above High everywhere (MyWork.jsx:14,112,906; TaskDetail.jsx:25); NEW enums are High/Medium/Low and the server 400s anything else. Vocabulary and triage granularity lost; would also break any imported OLD data. Fix: `cadence/server/lib/constants.js:27`, `client/src/constants.js:21`, `client/src/components/mywork/taskFields.js:20-22`. (HIGH)
2. **[P1] To Do Today triage surface lost** — in-progress section, Start button, snooze-to-tomorrow, "Reschedule all → today" rollover, "Plan your day" undated suggestions, "Also today" strip (reviews/mentions/statement cutoff). NEW presets Today/Overdue cover only the due-date slices. Fix: `cadence/client/src/components/mywork/TaskSurface.jsx` (new Today module) per OLD MyWork.jsx:1230-1461,726-771. (HIGH)
3. **[P1] My Releases tab missing** — assigned-release rows w/ completion %, days-until, HIGH badge, unassign, self-assign panel + search, 4-key sorting (OLD :1464-1601,:892-897,371-410; data from /team/my-work releases). No NEW surface lists "my releases". Fix: `cadence/client/src/pages/MyWork.jsx` + a releases slice on `server/routes/tasks.js` or reuse /releases?assigned_to. (HIGH)
4. **[P1] Waiting-on-you rail gutted and role-gated** — unread-mentions list w/ snippets, statement-cutoff countdown, stalled bulk deals, review item rows, all-clear card all gone; NEW shows 3 count tiles and only to Approver+, so regular users get nothing (OLD MyWorkRail.jsx:15-207 vs NEW WaitingOnYou.jsx:13-51). Fix: `cadence/client/src/components/mywork/WaitingOnYou.jsx`. (HIGH)
5. **[P2] Upcoming-release deadline alert missing from My Work** — orange 14-day banner w/ per-release chips (OLD :1077-1105). Fix: `cadence/client/src/pages/MyWork.jsx` above TaskSurface. (HIGH)
6. **[P2] Greeting header + status pills lost** — time-of-day greeting `text-3xl font-black` + overdue/due-today/in-progress pills (OLD :31-35,1034-1064) → static PageHeader. Fix: `cadence/client/src/pages/MyWork.jsx:14`. (HIGH)
7. **[P2] Assignment email preview flow lost** — OLD returns `pending_email` and the client previews via EmailPreviewModal (editable To/CC, Skip; team.js:477-496, MyWork.jsx:1683-1700); NEW silently auto-sends (tasks.js:137-154,243-246,618-620) even though cadence ships EmailPreviewModal. Fix: `cadence/server/routes/tasks.js:243,618` return prepared payload + raise modal from `useTaskData/TaskSurface`. (HIGH)
8. **[P2] No one-click mark-done control** — OLD's status circle on every row/detail (TaskList.jsx:90-98; TaskDetail.jsx:172-176; STATUS_CYCLE MyWork.jsx:24); NEW requires inline select/drawer/drag/bulk. Fix: `cadence/client/src/components/mywork/TaskCard.jsx` add a done-toggle circle wired to `onPatch(status)`. (HIGH)
9. **[P2] Task↔release link not editable in NEW UI** — OLD TaskDetail release select (TaskDetail.jsx:219-231); NEW renders release readonly (taskFields.js:99; TaskDrawer.jsx:183-185) though PATCH accepts release_id (tasks.js:531). Fix: release select in `TaskDrawer.jsx` + quick-add. (HIGH)
10. **[P2] @-mention hand-over in title missing** — type-@-to-assign with roster autocomplete, Enter-picks-first, mention text stripped (TaskDetail.jsx:84-166). NEW leads use a select; the affordance is gone for everyone. Fix: `cadence/client/src/components/mywork/TaskDrawer.jsx:119` description input. (MED — partially superseded by the documented lead-only assignment model)
11. **[P3] Manual-sort fallback ignores due date** — OLD never-dragged tasks order by due date (MyWork.jsx:807-823; team.js:276-282); NEW null-sort_order tasks sort last by id (taskFields.js:147-172), so an untouched list is creation-ordered. Fix: `taskFields.js rankOf('manual')` fall back to due_date before id. (HIGH)
12. **[P3] Pin-to-top removed** — OLD localStorage pins + pin-first sort + pin/unpin buttons (MyWork.jsx:342-352,807-810; TaskDetail.jsx:201-202). Documented as deliberate in cadence CLAUDE.md ("redundant with drag") but it is a per-view-independent affordance drag does not replicate under non-Manual sorts. Fix (if honored): `useTaskView`/`taskFields` pinned set. (HIGH)
13. **[P3] Category color system dropped** — 7 fixed categories each with a hue (CATEGORY_STYLE MyWork.jsx:38-47) → free-text, monochrome everywhere (TaskCard.jsx:87). Fix: hash-tint or map in `taskFields.js`. (MED)
14. **[P3] Priority stripe colors remapped** — High amber→red, Medium blue→amber (OLD :112-117 vs NEW taskFields.js:20-22); consequence of dropping Urgent — a Medium task now shows the color OLD used for High. Fix with defect 1. (HIGH)
15. **[P3] Instant-create replaced by form-first** — OLD New Task creates immediately and opens the editor (:559-597); NEW requires filling a form. Fix: optional — `TaskSurface.openAdd` could create-then-open-drawer. (HIGH, severity judgment: interaction only)
16. **[P3] Notes autosave downgraded to blur/manual save** — OLD 600ms debounced per-keystroke with retry + wrong-record guard (useAutosave.js); NEW commits on blur/close (TaskDrawer.jsx:33-44,76-80). Typing then killing the tab loses the draft. Fix: debounce in `TaskDrawer.jsx`. (MED)
17. **[P3] FAB "New task" deep link lost** — OLD `?new=task` auto-opened creation (MyWork.jsx:279-289); NEW Fab links plain `/my-work` (Fab.jsx:14) and TaskSurface reads no params. Fix: `cadence/client/src/components/Fab.jsx:14` + param handling in `TaskSurface.jsx`. (HIGH)
18. **[P3] No refetch on acting-user switch** — OLD refetches on `user?.id` (:461); NEW loads on surface change only (useTaskData.js:57-66). CONFIRMED 2026-09-02 (Phase 10) — enter-workspace/impersonation is setState-only: `AuthContext.jsx:97-129` calls setToken/setUser/setLabel with no reload and no `key` change, and `App.jsx` puts no `key` on Layout. The tree does NOT remount, so this stale-data defect is real (impersonation may remount the tree). Fix: add user id to `useTaskData` deps. (LOW)
19. **[P3] Quick-add shorthand parsing absent** (`!high` `#cat` today/tomorrow/weekday, OLD :628-681) — informational: already dead/unreachable in OLD (:467-486) and logged in cadence CLAUDE.md as not carried over. (LOW)

**Intentional divergences**: role/department permission model replacing hierarchy assign-down/request-up + `task_type` (documented redesign; auth); canMutateTask/canAssignTo gates where OLD's PUT had none (auth hardening); label_id scoping + in-tenant release/user validation (tenancy); /team-work Approver+ gate (new page, dept scoping); branded task email via lib/email.js vs Boom-red Gmail-OAuth template (branding — the missing *preview* is defect 7); brand accent vs boom red (RC-2); {success,data} envelope unchanged.

// The shared shell behind BOTH /my-work and /team-work.
//
// One `surface` prop ("mine" | "team") decides the fetch scope, the default view,
// which views and group-by dimensions are offered, and which saved views are
// listed. Everything else — the pipeline, the four views, editing, DnD, the drawer —
// is identical, so the two pages cannot drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckSquare, ChevronDown, Filter, Plus, RefreshCw, X } from 'lucide-react'
import Button from '../ui/Button'
import Skeleton from '../Skeleton'
import BottomSheet from '../ui/BottomSheet'
import Modal from '../ui/Modal'
import useHotkeys from '../../hooks/useHotkeys'
import useIsMobile from '../../hooks/useIsMobile'
import { useAuth } from '../../context/AuthContext'
import { TASK_STATUSES, PRIORITIES } from '../../constants'
import { localDateStr } from '../../utils/dates'
import useTaskData from './useTaskData'
import useTaskView from './useTaskView'
import useTaskDnd from './useTaskDnd'
import { canDropInGroup, categoriesIn, groupFieldFor, groupTasks } from './taskFields'
import TaskToolbar from './TaskToolbar'
import Popover from './Popover'
import TaskBoard from './TaskBoard'
import TaskTable from './TaskTable'
import TaskCalendar from './TaskCalendar'
import TaskDrawer from './TaskDrawer'
import WorkloadView, { DEFAULT_CAPACITY } from './WorkloadView'
import WaitingOnYou from './WaitingOnYou'

// A menu button for the bulk bar. Deliberately buttons, not a <select> — see the
// comment at the bar itself.
function BulkMenu({ label, items, open, busy, isMobile, onToggle, onClose, onPick }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-secondary !py-1 !px-2.5 text-xs"
      >
        {label} <ChevronDown size={12} aria-hidden="true" />
      </button>
      {/* placement=top: the bar is pinned near the bottom of the viewport. */}
      <Popover open={open} onClose={onClose} title={label} isMobile={isMobile} width="w-48" placement="top" align="left">
        <div role="menu" className="space-y-0.5">
          {items.map(it => (
            <button
              key={it.key}
              role="menuitem"
              onClick={() => onPick(it.fields)}
              className="w-full text-left text-sm px-2 py-1.5 rounded-lg text-ink hover:bg-elev
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              {it.label}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}

const BLANK = { description: '', priority: 'Medium', status: 'To Do', due_date: '', user_id: '', category: '' }

export default function TaskSurface({ surface = 'mine' }) {
  const { user, label } = useAuth()
  const isMobile = useIsMobile()
  const searchRef = useRef(null)

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = user?.role === 'Approver'
  const isLead = isAdmin || isApprover
  const myDept = user?.department || null
  // Workspace-wide target for the Workload bars. Lives in labels.settings (shallow-
  // merged by PATCH /api/label) and is already on AuthContext, so this costs no fetch.
  const capacity = Number(label?.settings?.task_capacity) || DEFAULT_CAPACITY

  const data = useTaskData(surface)
  const { tasks, members, loading, error } = data

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [openTask, setOpenTask] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [bulkMenu, setBulkMenu] = useState(null)   // 'status' | 'priority' | 'assign'
  const [bulkBusy, setBulkBusy] = useState(false)

  // ── Permissions: mirror the server so affordances match what will succeed ──
  // Server equivalent: canMutateTask in server/routes/tasks.js.
  const canEditTask = useCallback((task) => {
    if (!task) return false
    if (task.user_id === user?.id || isAdmin) return true
    return isApprover && !!myDept && task.assignee_department === myDept
  }, [user?.id, isAdmin, isApprover, myDept])

  // Reassignment targets: admins → anyone; a lead → their own department only.
  const assignableMembers = useMemo(() => {
    if (isAdmin) return members
    if (isApprover && myDept) return members.filter(m => m.department === myDept)
    return []
  }, [members, isAdmin, isApprover, myDept])

  // /team fetches the WHOLE workspace roster (it's auth-only, not admin-gated), but
  // a department-scoped Approver must not see a Workload row or an assignee column
  // for every other department — they'd all read "0 open · available" and the
  // drill-through would open an empty board.
  const roster = useMemo(
    () => (surface === 'team' && !isAdmin ? assignableMembers : members),
    [surface, isAdmin, assignableMembers, members]
  )

  // The view pipeline groups by the scoped roster, so an out-of-scope teammate
  // never becomes a column.
  const v = useTaskView(surface, tasks, roster)
  const { view, groups, sorted } = v

  const dropCtx = useMemo(
    () => ({ isAdmin, isLead, department: myDept, members: roster }),
    [isAdmin, isLead, myDept, roster]
  )
  const canDropGroup = useCallback((key) => canDropInGroup(view.group, key, dropCtx), [view.group, dropCtx])

  const canGroupBy = useCallback((g) => {
    if (g.teamOnly && surface !== 'team') return false
    if (g.adminOnly && !isAdmin) return false
    return true
  }, [surface, isAdmin])

  // A dimension can stop being offerable (e.g. an Approver landing on a saved
  // admin view grouped by department) — fall back rather than render one column
  // labelled misleadingly.
  useEffect(() => {
    if (view.group === 'department' && !isAdmin) v.setGroup('assignee')
    if ((view.group === 'assignee' || view.group === 'department') && surface !== 'team') v.setGroup('status')
    if (view.type === 'workload' && surface !== 'team') v.setType('board')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.group, view.type, surface, isAdmin])

  // HTML5 drag events don't fire on touch, which is why nothing in this repo is
  // touch-draggable. Below 768px the status/assignee controls are the move path.
  const dnd = useTaskDnd({
    view,
    reorderTask: data.reorderTask,
    canDropGroup,
    canEditTask,
    enabled: !isMobile && view.sort.key === 'manual',
  })

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleGroup = (key) => setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const clearSelection = () => setSelected(new Set())

  const openAdd = (groupKey) => {
    // Per-group add pre-fills whatever that group implies, so "+" in the High
    // column creates a High task and "+" in Done creates a Done one. Nulls from
    // groupFieldFor (e.g. Uncategorized) become '' so the inputs stay controlled.
    const preset = groupKey ? groupFieldFor(view.group, groupKey) : null
    const clean = Object.fromEntries(Object.entries(preset || {}).map(([k, val]) => [k, val ?? '']))
    setForm({ ...BLANK, ...clean })
    setShowForm(true)
  }

  const submitForm = async (e) => {
    e?.preventDefault()
    if (!form.description.trim()) return
    setSaving(true)
    const created = await data.createTask({
      description: form.description.trim(),
      priority: form.priority,
      status: form.status || undefined,
      due_date: form.due_date || undefined,
      user_id: form.user_id || undefined,
      category: form.category?.trim() || undefined,
    })
    setSaving(false)
    if (created) { setForm(BLANK); setShowForm(false) }
  }

  const patch = (id, fields) => data.patchTask(id, fields, { silent: true })

  const bulkSet = async (fields) => {
    const ids = [...selected]
    if (!ids.length || bulkBusy) return
    setBulkBusy(true)
    const rows = await data.bulkPatch(ids, fields)
    setBulkBusy(false)
    setBulkMenu(null)
    // Only on success. Clearing unconditionally meant a failed bulk edit threw away
    // the selection along with the error, leaving nothing to retry.
    if (rows) clearSelection()
  }

  const drillDown = (userId) => {
    v.setFilter('user_id', [userId])
    v.setType('board')
    v.setGroup('status')
  }

  // Keep the open drawer in sync with the live row.
  const drawerTask = openTask ? tasks.find(t => t.id === openTask.id) || null : null
  // A refetch can drop the open task (deleted elsewhere, reassigned out of scope).
  // The drawer used to just vanish mid-edit with no explanation.
  const drawerMissing = !!openTask && !drawerTask

  // ── Hotkeys ───────────────────────────────────────────────────────────────
  // Single keys only: useHotkeys bails on any meta/ctrl/alt and ignores events
  // from inputs, so ⌘-combos can't be expressed here (Layout owns those).
  useHotkeys({
    n: () => openAdd(null),
    f: () => searchRef.current?.focus(),
    z: () => data.undoLast(),
    g: () => {
      const opts = ['status', 'priority', 'due', 'category', ...(surface === 'team' ? ['assignee'] : [])]
      v.setGroup(opts[(opts.indexOf(view.group) + 1) % opts.length])
    },
    1: () => v.setType('board'),
    2: () => v.setType('table'),
    3: () => v.setType('calendar'),
    4: () => v.setType('list'),
    5: () => surface === 'team' && v.setType('workload'),
    // The drawer and the toolbar popovers own Escape while open, via the shared
    // overlay stack — they consume the key before this page-level handler sees it.
    // That's what stops Escape-in-a-popover from clearing a multi-select.
    Escape: () => {
      if (showForm) setShowForm(false)
      else if (selected.size) clearSelection()
    },
  }, [view.group, view.type, surface, showForm, selected.size, data.undoLast])

  // ── Render ────────────────────────────────────────────────────────────────
  const visibleCount = groups.reduce((n, g) => n + g.count, 0)

  // Calendar's mobile fallback: the same pipeline, re-grouped by due bucket so the
  // day structure survives without a grid.
  const mobileDayGroups = useMemo(
    () => groupTasks(sorted, 'due', { members: roster }),
    [sorted, roster]
  )

  const sharedViewProps = {
    // assignableMembers, not the full roster: an assignee dropdown offering someone
    // the server will 403 is a rollback waiting to happen.
    groups, members: assignableMembers, collapsed, onToggleGroup: toggleGroup,
    selected, onToggleSelect: toggleSelect,
    onOpen: setOpenTask, onPatch: patch, canEditTask,
    canAssign: isLead && assignableMembers.length > 0,
    canUnassign: isAdmin,
    drag: dnd.drag, over: dnd.over,
    dragHandlersFor: dnd.dragHandlersFor, groupDragProps: dnd.groupDragProps,
    groupDroppable: canDropGroup,
  }

  const body = () => {
    if (loading) {
      if (view.type === 'table') return <Skeleton.Table rows={8} cols={view.columns.length} />
      if (view.type === 'list' || view.type === 'workload') return <Skeleton.TaskList count={6} />
      // A 3-column kanban skeleton snapping into a 7×6 month grid is a big layout jump.
      if (view.type === 'calendar') return <Skeleton.Block h="h-[32rem]" />
      return <Skeleton.KanbanBoard cols={3} cards={2} />
    }
    if (error) {
      return (
        <div className="card p-10 text-center">
          <AlertTriangle size={28} className="text-warning mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink">Couldn't load tasks</p>
          <p className="text-xs text-ink-muted mt-1">{error}</p>
          {surface === 'team' && (
            <p className="text-xs text-ink-muted mt-1">
              Team Work needs a department — ask an admin to set yours on the{' '}
              <Link to="/team" className="text-brand-ink hover:underline font-medium">Team page</Link>.
            </p>
          )}
          {/* `load` was already in scope one line away; the only recovery used to be
              a browser reload. */}
          <Button variant="secondary" size="sm" className="mt-4" onClick={data.load}>
            <RefreshCw size={14} /> Retry
          </Button>
        </div>
      )
    }
    if (!tasks.length) {
      return (
        <div className="card p-10 text-center">
          <CheckSquare size={28} className="text-ink-faint mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink-muted">
            {surface === 'team' ? 'No tasks in your team yet.' : 'Nothing on your plate yet.'}
          </p>
          {/* The copy named an action the state didn't offer. */}
          <Button size="sm" className="mt-4" onClick={() => openAdd(null)}>
            <Plus size={14} /> Add task
          </Button>
        </div>
      )
    }
    // Filters that match nothing used to fall straight through to the Board, which
    // rendered N columns all saying "Empty" — the page looked broken and there was no
    // way back out. The highest-frequency confusing state in a filterable view.
    if (visibleCount === 0) {
      return (
        <div className="card p-10 text-center">
          <Filter size={28} className="text-ink-faint mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink-muted">No tasks match these filters.</p>
          <p className="text-xs text-ink-muted mt-1">{tasks.length} task{tasks.length === 1 ? '' : 's'} hidden.</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={v.resetFilters}>Clear filters</Button>
        </div>
      )
    }
    if (view.type === 'workload') {
      return <WorkloadView tasks={sorted} roster={roster} capacity={capacity} onDrillDown={drillDown} />
    }
    if (view.type === 'calendar') {
      // 7 columns at 390px leaves ~40px of text per chip, so every task read
      // "Fini…". Fall back to the day-grouped dense list rather than a new component.
      if (isMobile) {
        return <TaskTable {...sharedViewProps} groups={mobileDayGroups} columns={['description']} dense />
      }
      return (
        <TaskCalendar
          tasks={sorted}
          onOpen={setOpenTask}
          onReschedule={(id, iso) => patch(id, { due_date: iso })}
          canEditTask={canEditTask}
          dndEnabled={!isMobile}
        />
      )
    }
    if (view.type === 'table') {
      // Below 768px a 6-column grid is unusable, so the table falls back to the
      // list rendering (same branch style as Ledger.jsx:427).
      return isMobile
        ? <TaskTable {...sharedViewProps} columns={['description']} dense />
        : <TaskTable {...sharedViewProps} columns={view.columns} />
    }
    if (view.type === 'list') {
      return <TaskTable {...sharedViewProps} columns={['description']} dense />
    }
    return <TaskBoard {...sharedViewProps} onAdd={openAdd} showAssignee={surface === 'team'} />
  }

  return (
    <div>
      {/* Personal rail, rendered here rather than in the page so it can reuse the
          task list this hook already fetched instead of asking for it again. */}
      {surface === 'mine' && !loading && <WaitingOnYou tasks={tasks} />}

      <TaskToolbar
        surface={surface}
        isMobile={isMobile}
        view={view}
        tasks={tasks}
        members={roster}
        allViews={v.allViews}
        activeViewId={v.activeViewId}
        isDirty={v.isDirty}
        activeFilterCount={v.activeFilterCount}
        setType={v.setType}
        setGroup={v.setGroup}
        setSort={v.setSort}
        setFilter={v.setFilter}
        toggleFilterValue={v.toggleFilterValue}
        resetFilters={v.resetFilters}
        toggleColumn={v.toggleColumn}
        applyView={v.applyView}
        saveView={v.saveView}
        deleteView={v.deleteView}
        onAdd={() => openAdd(null)}
        canGroupBy={canGroupBy}
        searchRef={searchRef}
      />

      {showForm && (isMobile ? (
        /* 6 stacked fields at 40px min-height is ~400px, and autoFocus raises the
           keyboard — Add/Cancel ended up below the fold. The sheet already exists. */
        <BottomSheet
          open
          onClose={() => setShowForm(false)}
          title="New task"
          footer={
            <div className="flex gap-2">
              <Button type="submit" form="quick-add" disabled={saving} className="flex-1">{saving ? 'Adding…' : 'Add task'}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          }
        >
          <form id="quick-add" onSubmit={submitForm} className="space-y-3">
          <div className="sm:col-span-2">
            <label className="label">Task</label>
            <input className="input" value={form.description} autoFocus
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" list="quickadd-categories" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <datalist id="quickadd-categories">
              {categoriesIn(tasks).map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          {assignableMembers.length > 0 && (
            <div className="sm:col-span-2">
              <label className="label">Assign to</label>
              <select className="input" value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">Me ({user?.name})</option>
                {assignableMembers.filter(m => m.id !== user?.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          </form>
        </BottomSheet>
      ) : (
        <form onSubmit={submitForm} className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Task</label>
            <input className="input" value={form.description} autoFocus
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Category</label>
            <input className="input" list="quickadd-categories" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <datalist id="quickadd-categories">
              {categoriesIn(tasks).map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          {assignableMembers.length > 0 && (
            <div className="sm:col-span-2">
              <label className="label">Assign to</label>
              <select className="input" value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                <option value="">Me ({user?.name})</option>
                {assignableMembers.filter(m => m.id !== user?.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" disabled={saving} className="flex-1">{saving ? 'Adding…' : 'Add'}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </form>
      ))}

      {!loading && !error && tasks.length > 0 && (
        <p className="text-[11px] text-ink-muted mb-2">
          {visibleCount} of {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {view.sort.key !== 'manual' && ' · drag-to-reorder needs the Manual sort'}
          {data.undoDepth > 0 && ` · press z to undo (${data.undoDepth})`}
        </p>
      )}

      {body()}

      {/* Bulk action bar — one request for the whole selection.
          These were native <select>s. Chrome fires `change` on every arrow keypress
          in a closed select, so tabbing to one and pressing ↓↓↓ silently applied
          three different statuses to the entire selection, with no confirm and no
          undo. Buttons have no value, so they can't fire on arrow keys and can't go
          stale mid-request either.
          Position: above BottomNav (fixed, h-14, z-30, shown under lg) plus the home
          indicator — at bottom-4/z-50 this bar covered the app's whole navigation. */}
      {selected.size > 0 && (
        <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] lg:bottom-4 left-1/2 -translate-x-1/2 z-50 card shadow-modal px-3 py-2 flex items-center gap-2 flex-wrap max-w-[95vw]">
          <span className="text-xs font-semibold text-ink" aria-live="polite">{selected.size} selected</span>

          <BulkMenu
            label="Status" open={bulkMenu === 'status'} busy={bulkBusy} isMobile={isMobile}
            onToggle={() => setBulkMenu(m => (m === 'status' ? null : 'status'))}
            onClose={() => setBulkMenu(null)}
            items={TASK_STATUSES.map(x => ({ key: x, label: x, fields: { status: x } }))}
            onPick={bulkSet}
          />
          <BulkMenu
            label="Priority" open={bulkMenu === 'priority'} busy={bulkBusy} isMobile={isMobile}
            onToggle={() => setBulkMenu(m => (m === 'priority' ? null : 'priority'))}
            onClose={() => setBulkMenu(null)}
            items={PRIORITIES.map(x => ({ key: x, label: x, fields: { priority: x } }))}
            onPick={bulkSet}
          />
          <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulkSet({ due_date: localDateStr() })}>Due today</Button>
          {assignableMembers.length > 0 && (
            <BulkMenu
              label="Assign" open={bulkMenu === 'assign'} busy={bulkBusy} isMobile={isMobile}
              onToggle={() => setBulkMenu(m => (m === 'assign' ? null : 'assign'))}
              onClose={() => setBulkMenu(null)}
              items={assignableMembers.map(m => ({ key: m.id, label: m.name, fields: { user_id: m.id } }))}
              onPick={bulkSet}
            />
          )}
          <button
            onClick={clearSelection}
            className="text-ink-muted hover:text-ink rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="Clear selection"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <TaskDrawer
        task={drawerTask}
        tasks={tasks}
        members={assignableMembers}
        canEdit={canEditTask(drawerTask)}
        canAssign={isLead && assignableMembers.length > 0}
        canUnassign={isAdmin}
        onClose={() => setOpenTask(null)}
        onPatch={patch}
        onDelete={data.removeTask}
      />

      <Modal
        open={drawerMissing}
        onClose={() => setOpenTask(null)}
        title="Task unavailable"
        size="sm"
        footer={<Button variant="secondary" onClick={() => setOpenTask(null)}>Close</Button>}
      >
        <p className="text-sm text-ink-muted">
          This task was deleted, or reassigned somewhere you can't see it.
        </p>
      </Modal>
    </div>
  )
}

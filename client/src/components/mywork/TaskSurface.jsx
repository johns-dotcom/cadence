// The shared shell behind BOTH /my-work and /team-work.
//
// One `surface` prop ("mine" | "team") decides the fetch scope, the default view,
// which views and group-by dimensions are offered, and which saved views are
// listed. Everything else — the pipeline, the four views, editing, DnD, the drawer —
// is identical, so the two pages cannot drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckSquare, X } from 'lucide-react'
import Button from '../ui/Button'
import Skeleton from '../Skeleton'
import useHotkeys from '../../hooks/useHotkeys'
import useIsMobile from '../../hooks/useIsMobile'
import { useAuth } from '../../context/AuthContext'
import { TASK_STATUSES, PRIORITIES } from '../../constants'
import { localDateStr } from '../../utils/dates'
import useTaskData from './useTaskData'
import useTaskView from './useTaskView'
import useTaskDnd from './useTaskDnd'
import { canDropInGroup, categoriesIn, groupFieldFor } from './taskFields'
import TaskToolbar from './TaskToolbar'
import TaskBoard from './TaskBoard'
import TaskTable from './TaskTable'
import TaskCalendar from './TaskCalendar'
import TaskDrawer from './TaskDrawer'
import WorkloadView from './WorkloadView'
import WaitingOnYou from './WaitingOnYou'

const BLANK = { description: '', priority: 'Medium', status: 'To Do', due_date: '', user_id: '', category: '' }

export default function TaskSurface({ surface = 'mine' }) {
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const searchRef = useRef(null)

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = user?.role === 'Approver'
  const isLead = isAdmin || isApprover
  const myDept = user?.department || null

  const data = useTaskData(surface)
  const { tasks, members, loading, error } = data

  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [openTask, setOpenTask] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

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
    if (!ids.length) return
    await data.bulkPatch(ids, fields)
    clearSelection()
  }

  const drillDown = (userId) => {
    v.setFilter('user_id', [userId])
    v.setType('board')
    v.setGroup('status')
  }

  // Keep the open drawer in sync with the live row.
  const drawerTask = openTask ? tasks.find(t => t.id === openTask.id) || null : null

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
    Escape: () => {
      if (drawerTask) setOpenTask(null)
      else if (showForm) setShowForm(false)
      else if (selected.size) clearSelection()
    },
  }, [view.group, view.type, surface, drawerTask, showForm, selected.size, data.undoLast])

  // ── Render ────────────────────────────────────────────────────────────────
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
      return <Skeleton.KanbanBoard cols={3} cards={2} />
    }
    if (error) {
      return (
        <div className="card p-10 text-center">
          <p className="text-sm text-gray-600">{error}</p>
          {surface === 'team' && (
            <p className="text-xs text-gray-400 mt-2">
              Team Work needs a department. Ask an admin to set yours on the Team page.
            </p>
          )}
        </div>
      )
    }
    if (!tasks.length) {
      return (
        <div className="card p-10 text-center">
          <CheckSquare size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            {surface === 'team' ? 'No tasks in your team yet.' : 'No tasks. Add one to get started.'}
          </p>
        </div>
      )
    }
    if (view.type === 'workload') {
      return <WorkloadView tasks={sorted} roster={roster} onDrillDown={drillDown} />
    }
    if (view.type === 'calendar') {
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

  const visibleCount = groups.reduce((n, g) => n + g.count, 0)

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

      {showForm && (
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
      )}

      {!loading && !error && tasks.length > 0 && (
        <p className="text-[11px] text-gray-400 mb-2">
          {visibleCount} of {tasks.length} task{tasks.length === 1 ? '' : 's'}
          {view.sort.key !== 'manual' && ' · drag-to-reorder needs the Manual sort'}
          {data.undoDepth > 0 && ` · press z to undo (${data.undoDepth})`}
        </p>
      )}

      {body()}

      {/* Bulk action bar — one request for the whole selection. */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 card shadow-modal px-3 py-2 flex items-center gap-2 flex-wrap max-w-[95vw]">
          <span className="text-xs font-semibold text-ink">{selected.size} selected</span>
          <select className="input w-auto !py-1 text-xs" defaultValue="" onChange={e => e.target.value && bulkSet({ status: e.target.value })}>
            <option value="">Set status…</option>
            {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto !py-1 text-xs" defaultValue="" onChange={e => e.target.value && bulkSet({ priority: e.target.value })}>
            <option value="">Set priority…</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={() => bulkSet({ due_date: localDateStr() })}>Due today</Button>
          {assignableMembers.length > 0 && (
            <select className="input w-auto !py-1 text-xs" defaultValue="" onChange={e => e.target.value && bulkSet({ user_id: e.target.value })}>
              <option value="">Assign to…</option>
              {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <button onClick={clearSelection} className="text-gray-400 hover:text-ink" aria-label="Clear selection"><X size={14} /></button>
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
    </div>
  )
}

// Pure data layer for My Work / Team Work. No React, no API — just the field
// descriptors and the filter → sort → group pipeline, so the four views (Board,
// Table, Calendar, List) and the Workload rollup all agree by construction.
//
// ALL date logic goes through utils/dates.js, which is local-calendar and parses
// the 'YYYY-MM-DD' prefix directly. Never `new Date(due_date)` — that parses a DB
// date as UTC midnight and makes "due today" read as overdue west of UTC.
// The one exception is `completed_at`, a TIMESTAMP: it is compared as an INSTANT
// (see hide_old_done below), never bucketed into calendar days.

import { formatDate, daysUntilLocal, localDateStr, dateOnly } from '../../utils/dates'
import { TASK_STATUSES, PRIORITIES, DEPARTMENTS } from '../../constants'

// Sentinel group keys. Real values can't collide with these.
export const UNASSIGNED = '__unassigned__'
export const UNCATEGORIZED = '__uncategorized__'
export const NO_DEPARTMENT = '__nodept__'

// Static class maps — Tailwind's JIT can't see interpolated class strings.
export const PRIORITY_DOT = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-400' }
export const PRIORITY_STRIPE = { High: 'border-l-red-500', Medium: 'border-l-amber-500', Low: 'border-l-gray-300' }
export const PRIORITY_TONE = { High: 'danger', Medium: 'warning', Low: 'neutral' }

// ── Due buckets ────────────────────────────────────────────────────────────
export const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue', tone: 'danger' },
  { key: 'today', label: 'Today', tone: 'warning' },
  { key: 'tomorrow', label: 'Tomorrow', tone: 'info' },
  { key: 'week', label: 'This week', tone: 'neutral' },
  { key: 'later', label: 'Later', tone: 'neutral' },
  { key: 'none', label: 'No date', tone: 'neutral' },
]

// The one definition of "overdue / due today" on the client. Workload counts,
// group headers and the days-late stamp all read this, so they cannot disagree.
export function dueBucketOf(task) {
  const d = daysUntilLocal(task?.due_date)
  if (d === null) return 'none'
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d <= 7) return 'week'
  return 'later'
}

// "3 days late" / "Due today" / "Due Aug 20" — the short stamp on a card.
export function dueLabel(task) {
  if (!task?.due_date) return 'No due date'
  const d = daysUntilLocal(task.due_date)
  if (d === null) return 'No due date'
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} late`
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  return `Due ${formatDate(task.due_date)}`
}

export const isOpen = (t) => t.status !== 'Done'

// ── Group-by / sort options ────────────────────────────────────────────────
// teamOnly: meaningless on /my-work (a single-person dataset).
// adminOnly: a department lead's dataset is one department by construction.
export const GROUP_BYS = [
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'due', label: 'Due date' },
  { key: 'category', label: 'Category' },
  { key: 'assignee', label: 'Assignee', teamOnly: true },
  { key: 'department', label: 'Department', teamOnly: true, adminOnly: true },
  { key: 'none', label: 'None' },
]

export const SORTS = [
  { key: 'manual', label: 'Manual' },
  { key: 'due_date', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'description', label: 'Name' },
  { key: 'created_at', label: 'Created' },
]

export const DUE_FILTERS = [
  { key: 'any', label: 'Any time' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'none', label: 'No due date' },
]

// ── Column descriptors (Table + List) ──────────────────────────────────────
// `kind` drives the inline editor in TaskCell. `field` is the patch key when it
// differs from the column key. `render` is display-only.
export const COLS = [
  { key: 'description', label: 'Task', kind: 'text', width: 'min-w-[18rem]', render: t => t.description },
  { key: 'status', label: 'Status', kind: 'select', options: TASK_STATUSES, width: 'w-32' },
  { key: 'priority', label: 'Priority', kind: 'select', options: PRIORITIES, width: 'w-28' },
  { key: 'due_date', label: 'Due', kind: 'date', width: 'w-32', render: t => formatDate(t.due_date) },
  { key: 'assignee', label: 'Assignee', kind: 'user', field: 'user_id', width: 'w-40', render: t => t.assignee_name || 'Unassigned' },
  { key: 'category', label: 'Category', kind: 'text', width: 'w-36', render: t => t.category || '—' },
  { key: 'release', label: 'Release', kind: 'readonly', width: 'w-40', render: t => t.release_name || '—' },
  { key: 'department', label: 'Dept', kind: 'readonly', width: 'w-32', render: t => t.assignee_department || '—' },
  { key: 'completed_at', label: 'Completed', kind: 'readonly', width: 'w-32', render: t => formatDate(t.completed_at) },
]

export const ALL_COL_KEYS = COLS.map(c => c.key)
export const DEFAULT_COLS = ['description', 'status', 'priority', 'due_date', 'category']
export const DEFAULT_TEAM_COLS = ['description', 'assignee', 'status', 'priority', 'due_date']
export const colByKey = (key) => COLS.find(c => c.key === key)

// ── Filtering ──────────────────────────────────────────────────────────────
const DONE_STALE_MS = 30 * 864e5

export function matches(task, f = {}) {
  if (f.q) {
    const q = f.q.toLowerCase()
    const hay = [task.description, task.category, task.assignee_name, task.release_name, task.notes]
      .filter(Boolean).join(' ').toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (f.status?.length && !f.status.includes(task.status)) return false
  if (f.priority?.length && !f.priority.includes(task.priority)) return false
  if (f.user_id?.length && !f.user_id.includes(task.user_id)) return false
  if (f.category?.length && !f.category.includes(task.category || UNCATEGORIZED)) return false
  if (f.department?.length && !f.department.includes(task.assignee_department || NO_DEPARTMENT)) return false
  if (f.release_id && task.release_id !== f.release_id) return false

  if (f.due && f.due !== 'any') {
    const b = dueBucketOf(task)
    // The 'week' filter means "the next 7 days", which spans three buckets.
    const hit = f.due === 'week' ? ['today', 'tomorrow', 'week'].includes(b) : b === f.due
    if (!hit) return false
  }

  // Long-finished work is hidden by default. completed_at is a TIMESTAMP, so this
  // is an instant comparison — deliberately not day bucketing.
  if (f.hide_old_done && task.status === 'Done' && task.completed_at) {
    if (Date.parse(task.completed_at) < Date.now() - DONE_STALE_MS) return false
  }
  return true
}

// ── Sorting ────────────────────────────────────────────────────────────────
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]))
const STATUS_RANK = Object.fromEntries(TASK_STATUSES.map((s, i) => [s, i]))

// Returns a comparable primitive, or null to mean "sorts last" regardless of
// direction (matching the server's `NULLS LAST`).
function rankOf(task, key) {
  switch (key) {
    case 'manual': return task.sort_order ?? null
    case 'due_date': return dateOnly(task.due_date)
    case 'priority': return PRIORITY_RANK[task.priority] ?? null
    case 'status': return STATUS_RANK[task.status] ?? null
    case 'description': return String(task.description || '').toLowerCase()
    case 'created_at': return task.created_at || null
    default: return null
  }
}

export function sortTasks(tasks, sort = {}) {
  const key = sort.key || 'manual'
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...tasks].sort((a, b) => {
    const ra = rankOf(a, key)
    const rb = rankOf(b, key)
    // Nulls last in BOTH directions — so they don't jump to the top on a desc sort.
    if (ra === null && rb === null) return a.id - b.id
    if (ra === null) return 1
    if (rb === null) return -1
    if (ra < rb) return -dir
    if (ra > rb) return dir
    return a.id - b.id // stable tiebreak
  })
}

// ── Grouping ───────────────────────────────────────────────────────────────
// The key a task belongs to, per dimension.
function groupKeyOf(task, group) {
  switch (group) {
    case 'status': return task.status
    case 'priority': return task.priority
    case 'due': return dueBucketOf(task)
    case 'category': return task.category || UNCATEGORIZED
    case 'assignee': return task.user_id == null ? UNASSIGNED : String(task.user_id)
    case 'department': return task.assignee_department || NO_DEPARTMENT
    default: return 'all'
  }
}

// The ORDERED key list for a dimension. Order comes from here, never from object
// key iteration, so groups don't reshuffle between renders.
function orderedKeys(group, tasks, ctx) {
  const present = new Set(tasks.map(t => groupKeyOf(t, group)))
  switch (group) {
    case 'status': return TASK_STATUSES
    case 'priority': return PRIORITIES
    case 'due': return DUE_BUCKETS.map(b => b.key)
    case 'assignee': {
      // Roster order (/team returns hierarchy_level, name), unassigned last.
      const ids = (ctx.members || []).map(m => String(m.id))
      const extras = [...present].filter(k => k !== UNASSIGNED && !ids.includes(k))
      return [...ids, ...extras, ...(present.has(UNASSIGNED) ? [UNASSIGNED] : [])]
    }
    case 'department': {
      const known = DEPARTMENTS.filter(d => present.has(d))
      const extras = [...present].filter(k => k !== NO_DEPARTMENT && !DEPARTMENTS.includes(k)).sort()
      return [...known, ...extras, ...(present.has(NO_DEPARTMENT) ? [NO_DEPARTMENT] : [])]
    }
    case 'category': {
      const named = [...present].filter(k => k !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b))
      return [...named, ...(present.has(UNCATEGORIZED) ? [UNCATEGORIZED] : [])]
    }
    default: return ['all']
  }
}

function groupLabel(group, key, ctx) {
  if (group === 'due') return DUE_BUCKETS.find(b => b.key === key)?.label || key
  if (group === 'assignee') {
    if (key === UNASSIGNED) return 'Unassigned'
    return (ctx.members || []).find(m => String(m.id) === key)?.name || `User #${key}`
  }
  if (group === 'category') return key === UNCATEGORIZED ? 'Uncategorized' : key
  if (group === 'department') return key === NO_DEPARTMENT ? 'No department' : key
  if (group === 'none') return 'All tasks'
  return key
}

function groupTone(group, key) {
  if (group === 'due') return DUE_BUCKETS.find(b => b.key === key)?.tone || 'neutral'
  if (group === 'priority') return PRIORITY_TONE[key] || 'neutral'
  return 'neutral'
}

/**
 * → [{ key, label, tone, count, items }] in a stable, dimension-defined order.
 * Empty groups are kept for the fixed dimensions (status/priority/due) so they
 * still render as drop targets; dynamic dimensions only list what's present.
 */
export function groupTasks(tasks, group, ctx = {}) {
  if (!group || group === 'none') {
    return [{ key: 'all', label: 'All tasks', tone: 'neutral', count: tasks.length, items: tasks }]
  }
  const byKey = new Map()
  for (const t of tasks) {
    const k = groupKeyOf(t, group)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(t)
  }
  return orderedKeys(group, tasks, ctx).map(key => {
    const items = byKey.get(key) || []
    return { key, label: groupLabel(group, key, ctx), tone: groupTone(group, key), count: items.length, items }
  })
}

// ── Drag targets ───────────────────────────────────────────────────────────
/**
 * The field patch implied by dropping a task into a group, or null when the group
 * isn't something you can set on a task.
 *
 * Null cases: 'overdue' / 'week' / 'later' (which day would you mean?),
 * 'department' (derived from the assignee, not stored on the task), and 'none'.
 */
export function groupFieldFor(group, key) {
  switch (group) {
    case 'status': return { status: key }
    case 'priority': return { priority: key }
    case 'category': return { category: key === UNCATEGORIZED ? null : key }
    case 'assignee': return key === UNASSIGNED ? null : { user_id: Number(key) }
    case 'due':
      if (key === 'today') return { due_date: localDateStr() }
      if (key === 'tomorrow') return { due_date: localDateStr(new Date(Date.now() + 864e5)) }
      if (key === 'none') return { due_date: null }
      return null
    default: return null
  }
}

/**
 * Can the current user drop into this group? Mirrors the server's rules so the
 * affordance is suppressed up front instead of the card visually moving and then
 * bouncing on a 403.
 *   ctx: { isAdmin, isLead, department, members }
 */
export function canDropInGroup(group, key, ctx = {}) {
  if (!groupFieldFor(group, key)) return false
  if (group === 'assignee') {
    if (ctx.isAdmin) return true
    if (!ctx.isLead || !ctx.department) return false
    const target = (ctx.members || []).find(m => String(m.id) === String(key))
    return !!target && target.department === ctx.department
  }
  return true
}

// Distinct category values in the dataset, for the filter chips and a datalist.
export function categoriesIn(tasks) {
  return [...new Set(tasks.map(t => t.category).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

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
import { TASK_STATUSES, TASK_PRIORITIES, DEPARTMENTS } from '../../constants'

// Sentinel group keys. Real values can't collide with these.
export const UNASSIGNED = '__unassigned__'
export const UNCATEGORIZED = '__uncategorized__'
export const NO_DEPARTMENT = '__nodept__'

// Static class maps — Tailwind's JIT can't see interpolated class strings.
//
// Four levels, red → amber → blue → gray. Restoring 'Urgent' also un-shifts the
// two below it: while the scale topped out at High, High wore the red that means
// "drop everything" and Medium wore High's amber, so an ordinary task read one
// level louder than it was.
export const PRIORITY_DOT = { Urgent: 'bg-red-500', High: 'bg-amber-500', Medium: 'bg-blue-400', Low: 'bg-gray-400' }
export const PRIORITY_STRIPE = { Urgent: 'border-l-red-500', High: 'border-l-amber-500', Medium: 'border-l-blue-400', Low: 'border-l-gray-300' }
export const PRIORITY_TONE = { Urgent: 'danger', High: 'warning', Medium: 'info', Low: 'neutral' }

// Category → tint. Categories are free text here (they were a fixed 7 in boom), so
// the hue is HASHED from the name rather than mapped: a workspace's own vocabulary
// gets stable colour without a config step, and the same word is always the same
// colour across the board, the table and the drawer.
//
// Translucent `/15` fills, never the solid `-100` scale — those go near-white in
// dark and take their text with them.
const CATEGORY_TINTS = [
  'bg-violet-500/15 text-violet-600',
  'bg-sky-500/15 text-sky-600',
  'bg-emerald-500/15 text-emerald-600',
  'bg-amber-500/15 text-amber-600',
  'bg-rose-500/15 text-rose-600',
  'bg-cyan-500/15 text-cyan-600',
  'bg-indigo-500/15 text-indigo-600',
]

export function categoryTint(category) {
  if (!category) return null
  const s = String(category).trim().toLowerCase()
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return CATEGORY_TINTS[h % CATEGORY_TINTS.length]
}

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
  { key: 'priority', label: 'Priority', kind: 'select', options: TASK_PRIORITIES, width: 'w-28' },
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
const PRIORITY_RANK = Object.fromEntries(TASK_PRIORITIES.map((p, i) => [p, i]))
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

/**
 * Tiebreak for equal ranks.
 *
 * Under the Manual sort, every task that has never been dragged has
 * `sort_order === null`, so they ALL rank equal and the tiebreak is what actually
 * orders them. Falling straight through to `id` meant a fresh list came out in
 * creation order — the least useful order a to-do list has. The server's own query
 * reads `sort_order NULLS LAST, due_date`; this is that second key.
 *
 * Deliberately direction-INDEPENDENT, like the nulls-last rule: reversing Manual
 * reverses the rows somebody hand-placed, not the "soonest first" default beneath
 * them.
 */
function tiebreak(a, b, key) {
  if (key === 'manual') {
    const da = dateOnly(a.due_date)
    const db = dateOnly(b.due_date)
    if (da !== db) {
      if (da === null) return 1
      if (db === null) return -1
      return da < db ? -1 : 1
    }
  }
  return a.id - b.id
}

export function sortTasks(tasks, sort = {}) {
  const key = sort.key || 'manual'
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...tasks].sort((a, b) => {
    const ra = rankOf(a, key)
    const rb = rankOf(b, key)
    // Nulls last in BOTH directions — so they don't jump to the top on a desc sort.
    if (ra === null && rb === null) return tiebreak(a, b, key)
    if (ra === null) return 1
    if (rb === null) return -1
    if (ra < rb) return -dir
    if (ra > rb) return dir
    return tiebreak(a, b, key)
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
    case 'priority': return TASK_PRIORITIES
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

// ── Quick-add shorthand ────────────────────────────────────────────────────
/**
 * Parse "master the single !high #A&R friday" into
 * { description:'master the single', priority:'High', category:'A&R', due_date:'…' }.
 *
 * Three rules, and a scoping rule that matters more than any of them:
 *
 *  · `!urgent|!high|!medium|!med|!low` — anywhere. Unambiguous: no English sentence
 *    contains a bare `!word`.
 *  · `#anything` — anywhere. Same reasoning. Case is preserved, so `#A&R` stays
 *    `A&R` and matches the existing category rather than creating a lowercase twin.
 *  · dates — `today`, `tomorrow`/`tmrw`, a weekday name or 3-letter abbreviation,
 *    optionally prefixed `next`. **Recognised only in the TRAILING run of tokens.**
 *
 * That last scope is the whole safety of this feature. Date words are ordinary
 * English, and a parser that grabbed them anywhere would turn "ship the Monday
 * newsletter" into a task called "ship the newsletter" due next Monday — silently
 * editing what somebody typed. Trailing-only makes it a suffix grammar: "call the
 * distributor friday" works, and the word inside a title is left alone.
 *
 * Pure and total: never throws, and a line made ENTIRELY of shorthand keeps its raw
 * text as the description rather than resolving to an empty required field.
 */
const PRIORITY_WORDS = { urgent: 'Urgent', high: 'High', hi: 'High', med: 'Medium', medium: 'Medium', low: 'Low' }

const WEEKDAY_INDEX = {}
;['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].forEach((d, i) => {
  WEEKDAY_INDEX[d] = i
  WEEKDAY_INDEX[d.slice(0, 3)] = i
})

// The NEXT occurrence of this weekday, always strictly in the future — said on a
// Friday, "friday" means the one coming, not today.
function nextWeekday(dow) {
  const now = new Date()
  const delta = ((dow - now.getDay() + 7) % 7) || 7
  return localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + delta))
}

// A trailing token → an ISO date, or null when it isn't one. `prev` lets "next"
// bind to the weekday after it.
function trailingDate(tok, prev) {
  const w = tok.toLowerCase().replace(/[.,]$/, '')
  if (w === 'today' || w === 'tod') return { date: localDateStr(), consumePrev: false }
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmw') {
    return { date: localDateStr(new Date(Date.now() + 864e5)), consumePrev: false }
  }
  const dow = WEEKDAY_INDEX[w]
  if (dow === undefined) return null
  return { date: nextWeekday(dow), consumePrev: !!prev && prev.toLowerCase() === 'next' }
}

export function parseQuickAdd(raw) {
  const blank = { description: String(raw || '').trim(), priority: null, category: null, due_date: null }
  const words = String(raw || '').split(/\s+/).filter(Boolean)
  if (!words.length) return blank

  const out = { priority: null, category: null, due_date: null }
  const kept = []
  for (const w of words) {
    const lower = w.toLowerCase()
    if (w[0] === '!' && PRIORITY_WORDS[lower.slice(1)]) { out.priority = PRIORITY_WORDS[lower.slice(1)]; continue }
    if (w[0] === '#' && w.length > 1) { out.category = w.slice(1); continue }
    kept.push(w)
  }

  // Walk the tail. One date wins (the last one typed); earlier trailing date words
  // are left in the title rather than fighting over the field.
  if (kept.length) {
    const hit = trailingDate(kept[kept.length - 1], kept[kept.length - 2])
    if (hit) {
      out.due_date = hit.date
      kept.splice(hit.consumePrev ? -2 : -1)
    }
  }

  const description = kept.join(' ').trim()
  return description ? { description, ...out } : blank
}

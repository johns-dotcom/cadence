// My Work — the operator's own to-do list, across every workspace at once.
//
// WHY THIS CAN EXIST. A platform operator is one person with many user rows: one
// per workspace they have entered, all keyed to their email (server
// lib/operatorGhost). Their tasks are therefore already spread across tenant
// databases with nothing joining them up — which is exactly the list this page
// is. No new table; Platform HQ is simply another workspace on it.
//
// WORKSPACE IDENTITY IS TWO ENCODINGS, a colour and a two-letter tag, the same
// pair /calendar uses. Past three tenants no ordering of eight hues clears the
// CVD/deltaE gate, and any two rows here can sit adjacent — so the tag is not
// decoration, it is the encoding that still works at the ninth workspace and for
// a colourblind reader.
//
// TWO LISTS, NEVER SUMMED. "Mine" is work waiting on me. "Delegated" is work I
// handed to somebody inside a workspace and am waiting on THEM for. They need
// opposite actions, so one number over both would be a number nobody can act on.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarClock, Check, CheckCircle2, ChevronDown,
  Clock, Loader2, Plus, RefreshCw, Search, StickyNote, Trash2, UserCheck, X,
} from 'lucide-react'
import api from '../api'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import { useTheme } from '../context/ThemeContext'
import useIsMobile from '../hooks/useIsMobile'
import { useToast } from '../context/ToastContext'
import { resolveColors, tagMap } from '../utils/workspaceColor'
import { daysUntilLocal, formatDate, localDateStr } from '../utils/dates'
import { TASK_PRIORITIES } from '../constants'
// The tenant task surface's own vocabulary maps. Pure data — imported rather
// than re-typed so a priority means the same thing, and looks the same, on both
// sides of the platform boundary.
import { PRIORITY_DOT, PRIORITY_RANK, noteLine } from '../components/mywork/taskFields'

// The urgency buckets. Fixed order, because scanning top-down IS the answer to
// "what do I do next" — and `order` lives with the label so a new bucket can
// never be added in one place and sorted in another.
const DUE_BUCKETS = [
  { key: 'overdue', label: 'Overdue', tone: 'text-danger', icon: AlertTriangle },
  { key: 'today', label: 'Today', tone: 'text-warning', icon: CalendarClock },
  { key: 'week', label: 'This week', tone: 'text-info', icon: Clock },
  { key: 'later', label: 'Later', tone: 'text-ink-muted', icon: Clock },
  { key: 'none', label: 'No due date', tone: 'text-ink-faint', icon: Clock },
  { key: 'done', label: 'Recently done', tone: 'text-success', icon: CheckCircle2 },
]

function bucketOf(t) {
  if (t.status === 'Done') return 'done'
  const d = daysUntilLocal(t.due_date)
  if (d === null) return 'none'
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d <= 7) return 'week'
  return 'later'
}

function dueLabel(t) {
  if (!t.due_date) return null
  const d = daysUntilLocal(t.due_date)
  if (d === null) return null
  if (d < 0) return `${-d}d late`
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d <= 7) return `${d}d`
  return formatDate(t.due_date)
}

// One row's workspace mark: the colour rail plus the tag. The tag wears an ink
// token, never the slot colour — the rail beside it carries identity, and small
// text in a series colour is the pairing that fails contrast.
function WorkspaceMark({ ws, color, tag }) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-shrink-0" title={ws?.name || 'Unknown workspace'}>
      <span className="w-1 h-4 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" />
      <span className="text-[10px] font-bold tracking-wide text-ink-muted">{tag}</span>
    </span>
  )
}

// The detail pane — what a task IS, beside the list of what there is.
//
// Every control that acts on one task lives here rather than on the row: a list
// where each line carries six controls is a toolbar per line, and it stops
// reading as a list. The note is the BODY, borderless and given the room, because
// it is the reason you opened the task.
export function TaskDetail({
  task, editable, busy, draft, onDraft, onDraftBlur, onPatch, onDelete, onClose,
  workspace, color, tag, roster = [], onAssign,
}) {
  const done = task.status === 'Done'
  const late = bucketOf(task) === 'overdue'
  const [menu, setMenu] = useState(null) // 'priority' | null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {editable ? (
            <input
              key={task.id}
              defaultValue={task.description}
              onBlur={e => {
                const v = e.target.value.trim()
                if (v && v !== task.description) onPatch(task.id, { description: v })
                else e.target.value = task.description
              }}
              className={`w-full bg-transparent border-0 p-0 text-xl font-bold tracking-tight outline-none
                          focus:ring-0 ${done ? 'line-through text-ink-muted' : 'text-ink'}`}
              aria-label="Task name"
            />
          ) : (
            <h2 className={`text-xl font-bold tracking-tight ${done ? 'line-through text-ink-muted' : 'text-ink'}`}>{task.description}</h2>
          )}
        </div>
        <button onClick={onClose} aria-label="Close detail"
          className="lg:hidden text-ink-muted hover:text-ink p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Meta row — status · priority · category, then the date and the
          destructive action kept apart from them. */}
      <div className="flex items-center gap-2 flex-wrap mt-2 text-sm">
        {editable ? (
          <button
            onClick={() => onPatch(task.id, { status: done ? 'To Do' : 'Done' })}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink rounded px-1 -ml-1
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <span className={`w-4 h-4 rounded-full border flex items-center justify-center
              ${done ? 'bg-success border-success text-white' : 'border-rule'}`}>
              {done && <Check size={10} aria-hidden="true" />}
            </span>
            {task.status}
          </button>
        ) : (
          <span className="text-ink-muted">{task.status}</span>
        )}

        <span className="text-ink-faint" aria-hidden="true">·</span>

        {editable ? (
          <div className="relative">
            <button onClick={() => setMenu(menu === 'priority' ? null : 'priority')}
              aria-haspopup="menu" aria-expanded={menu === 'priority'}
              className="inline-flex items-center gap-1 text-ink-muted hover:text-ink rounded px-1
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Medium}`} aria-hidden="true" />
              {task.priority || 'Medium'} <ChevronDown size={12} aria-hidden="true" />
            </button>
            {menu === 'priority' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} aria-hidden="true" />
                <div role="menu" className="absolute left-0 top-full mt-1 z-20 card p-1 w-32 shadow-lg">
                  {TASK_PRIORITIES.map(pr => (
                    <button key={pr} role="menuitem"
                      onClick={() => { setMenu(null); onPatch(task.id, { priority: pr }) }}
                      className="w-full text-left text-xs px-2 py-1.5 rounded text-ink hover:bg-elev">{pr}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="text-ink-muted">{task.priority || 'Medium'}</span>
        )}

        <span className="text-ink-faint" aria-hidden="true">·</span>

        {editable ? (
          <input
            key={`cat-${task.id}`}
            defaultValue={task.category || ''}
            placeholder="No category"
            onBlur={e => {
              const v = e.target.value.trim() || null
              if (v !== (task.category || null)) onPatch(task.id, { category: v })
            }}
            className="bg-transparent border-0 p-0 text-sm text-ink-muted outline-none focus:ring-0 w-28"
            aria-label="Category"
          />
        ) : (
          <span className="text-ink-muted">{task.category || 'No category'}</span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-2">
        {editable ? (
          <input
            type="date"
            value={task.due_date ? String(task.due_date).slice(0, 10) : ''}
            onChange={e => onPatch(task.id, { due_date: e.target.value || null })}
            disabled={busy}
            aria-label="Due date"
            className={`bg-transparent border border-rule rounded px-1.5 py-0.5 text-xs
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                        ${late ? 'text-danger' : 'text-ink-muted'}`}
          />
        ) : (
          <span className={`text-xs ${late ? 'text-danger' : 'text-ink-muted'}`}>{dueLabel(task) || 'No due date'}</span>
        )}

        {editable && !done && (
          <>
            {task.status !== 'In Progress' && (
              <button onClick={() => onPatch(task.id, { status: 'In Progress' })} disabled={busy}
                className="text-[11px] font-semibold text-ink-muted hover:text-ink rounded px-1
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Start</button>
            )}
            {/* Relative to TODAY, not to the old due date: snoozing a task five
                days late must mean "tomorrow", not "four days late". */}
            <button onClick={() => onPatch(task.id, { due_date: localDateStr(new Date(Date.now() + 864e5)) })} disabled={busy}
              title="Due tomorrow"
              className="text-[11px] font-semibold text-ink-muted hover:text-ink rounded px-1
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">+1d</button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {busy && <Loader2 size={13} className="animate-spin text-ink-faint" aria-hidden="true" />}
          {editable && (
            <button onClick={onDelete} aria-label="Delete task"
              className="text-ink-faint hover:text-danger p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Which workspace this belongs to — both console encodings, because the
          pane is where you confirm you are about to act on the right tenant. */}
      <div className="flex items-center gap-2 mt-3 text-[11px] text-ink-muted">
        <WorkspaceMark ws={workspace} color={color} tag={tag} />
        <span className="truncate">{task.label_name}</span>
        {task.label_status === 'suspended' && <span className="text-warning font-semibold">suspended</span>}
        {task.release_name && <span className="truncate">· ♪ {task.release_name}</span>}
        <a href={`/workspaces?open=${task.label_id}`}
          className="ml-auto font-semibold text-brand-ink hover:underline inline-flex items-center gap-0.5">
          Workspace <ArrowUpRight size={10} aria-hidden="true" />
        </a>
      </div>

      {/* Who holds it. The one write allowed on a task a tenant's person owns:
          moving work you created is the other half of being able to assign it,
          while its CONTENT stays theirs. */}
      {onAssign && (
        <div className="flex items-center gap-2 mt-2 pb-3 border-b border-divider">
          <span className="text-[11px] text-ink-muted flex-shrink-0">Assigned to</span>
          <select
            value={editable ? '' : String(task.user_id ?? '')}
            disabled={busy}
            onChange={e => onAssign(e.target.value)}
            className="input !h-7 !py-0 text-xs max-w-[14rem]"
            aria-label="Assign this task to"
          >
            <option value="">Me (in the console)</option>
            {roster.map(m => (
              <option key={m.id} value={m.id}>{m.name}{m.department ? ` · ${m.department}` : ''}</option>
            ))}
            {/* An assignee who has since left the roster would otherwise render
                as "Me", which is the one reading that is definitely wrong. */}
            {!editable && task.assignee_name && !roster.some(m => m.id === task.user_id) && (
              <option value={String(task.user_id)}>{task.assignee_name}</option>
            )}
          </select>
          {!editable && <span className="text-[11px] text-ink-faint">waiting on them</span>}
        </div>
      )}

      {/* The note. Borderless and full-height on purpose: it is the body of the
          document, not one more labelled field. */}
      {editable ? (
        <textarea
          value={draft}
          onChange={e => onDraft(e.target.value)}
          onBlur={onDraftBlur}
          placeholder="Write a note… saves as you type"
          className="mt-3 w-full flex-1 min-h-[14rem] bg-transparent border-0 p-0 text-sm text-ink
                     placeholder:text-ink-faint resize-none outline-none focus:ring-0"
          aria-label="Note"
        />
      ) : (
        <p className="mt-3 text-sm text-ink whitespace-pre-wrap">{task.notes || <span className="text-ink-faint italic">No note</span>}</p>
      )}
    </div>
  )
}

/**
 * `embedded` renders this inside the tenant /my-work as its "All workspaces"
 * tab, for an operator who has ENTERED a workspace. It drops the four stat
 * cards: the page around it already prints status pills for the workspace the
 * operator is standing in, and two rows of numbers about two different sets of
 * tasks, side by side, is a way to read the wrong one.
 *
 * `onCount` reports the open count upward so the tab that owns this can carry a
 * badge without fetching the same thing twice.
 */
export default function PlatformMyWork({ embedded = false, onCount }) {
  const { theme } = useTheme()
  // The two-pane breakpoint, matching the lg: grid below.
  const wide = !useIsMobile('(max-width: 1023px)')
  const { toast } = useToast()

  const [data, setData] = useState({ workspaces: [], mine: [], delegated: [], scoped: false, capped: false, delegated_capped: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('pwork_group_v1') || 'due')
  const [q, setQ] = useState('')
  const [wsFilter, setWsFilter] = useState('all')
  const [showDone, setShowDone] = useState(false)
  const [tab, setTab] = useState('mine')
  const [busy, setBusy] = useState(null)       // task id mid-write
  const [confirmDel, setConfirmDel] = useState(null)
  // The console has no task drawer, so the note is edited in place. `draft`
  // holds the text being typed: rendering straight from `data` would fight the
  // optimistic patch and jump the caret on every autosave.
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState('')
  const noteTimer = useRef(null)
  const draftRef = useRef({ id: null, value: '' })
  draftRef.current = { id: selectedId, value: draft }

  // Per-workspace rosters, fetched only when one is actually needed. The console
  // has no single tenant, so there is no roster to load up front — and loading
  // every workspace's people to fill one select would be a cross-tenant read
  // nobody asked for.
  const [rosters, setRosters] = useState({})
  const loadRoster = useCallback((labelId) => {
    const id = Number(labelId)
    if (!Number.isInteger(id)) return
    setRosters(r => (r[id] ? r : { ...r, [id]: 'loading' }))
    api.get(`/platform/work/workspaces/${id}/members`)
      .then(res => setRosters(r => ({ ...r, [id]: res.data.data || [] })))
      .catch(() => setRosters(r => ({ ...r, [id]: [] })))
  }, [])
  const rosterFor = (labelId) => {
    const v = rosters[Number(labelId)]
    return Array.isArray(v) ? v : []
  }

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ label_id: '', description: '', priority: 'Medium', due_date: '', category: '', user_id: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback((silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    return api.get('/platform/work')
      .then(r => { setData(r.data.data || {}); setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Could not load your work'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    onCount?.((data.mine || []).filter(t => t.status !== 'Done').length)
  }, [data.mine, onCount])
  useEffect(() => { localStorage.setItem('pwork_group_v1', groupBy) }, [groupBy])

  const workspaces = data.workspaces || []
  // Colours and tags resolve against the WHOLE roster, in the console's own
  // order, so hiding or filtering a workspace never repaints or renames another.
  const resolved = useMemo(() => resolveColors(workspaces, theme), [workspaces, theme])
  const tags = useMemo(() => tagMap(workspaces), [workspaces])
  const wsById = useMemo(() => new Map(workspaces.map(w => [Number(w.id), w])), [workspaces])
  const colorOf = (id) => resolved.get(Number(id))?.color || '#888888'
  const tagOf = (id) => tags.get(Number(id)) || '??'

  const rows = tab === 'mine' ? (data.mine || []) : (data.delegated || [])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(t => {
      if (!showDone && t.status === 'Done') return false
      if (wsFilter !== 'all' && Number(t.label_id) !== Number(wsFilter)) return false
      if (!needle) return true
      return [t.description, t.category, t.notes, t.label_name, t.assignee_name]
        .some(v => String(v || '').toLowerCase().includes(needle))
    })
  }, [rows, q, wsFilter, showDone])

  // One pipeline: the section counts, the header totals and the rows below them
  // are all reductions over `shown`, so they cannot disagree.
  const groups = useMemo(() => {
    const out = new Map()
    const push = (key, label, tone, icon, order, t) => {
      if (!out.has(key)) out.set(key, { key, label, tone, icon, order, items: [] })
      out.get(key).items.push(t)
    }
    shown.forEach(t => {
      if (groupBy === 'workspace') {
        const ws = wsById.get(Number(t.label_id))
        push(`w${t.label_id}`, ws?.name || `Workspace ${t.label_id}`, 'text-ink-muted', Building2, Number(t.label_id), t)
      } else if (groupBy === 'priority') {
        const p = t.priority || 'Medium'
        push(p, p, 'text-ink-muted', Clock, PRIORITY_RANK[p] ?? 9, t)
      } else {
        const b = bucketOf(t)
        const meta = DUE_BUCKETS.find(x => x.key === b) || DUE_BUCKETS[4]
        push(b, meta.label, meta.tone, meta.icon, DUE_BUCKETS.indexOf(meta), t)
      }
    })
    const list = [...out.values()].sort((a, b) => a.order - b.order)
    // Inside a bucket: most urgent first, then priority — the same reading order
    // the buckets themselves are in.
    list.forEach(g => g.items.sort((a, b) => {
      const ad = daysUntilLocal(a.due_date), bd = daysUntilLocal(b.due_date)
      if (ad !== bd) return (ad === null ? 1e9 : ad) - (bd === null ? 1e9 : bd)
      return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
    }))
    return list
  }, [shown, groupBy, wsById])

  // Re-derived from the live rows, never held as an object: a stale copy here
  // would keep showing the pre-patch task after an edit.
  const selected = useMemo(() => shown.find(t => t.id === selectedId) || null, [shown, selectedId])

  // Keep a pane's worth of content on screen: if the selection falls out of the
  // filtered set, take the first row instead of leaving an empty pane beside a
  // full list. Desktop only — on a phone the detail renders BELOW the list, and
  // auto-opening it would push the list off the screen on arrival.
  useEffect(() => {
    if (wide && shown.length && !shown.some(t => t.id === selectedId)) {
      setSelectedId(shown[0].id)
      setDraft(shown[0].notes || '')
      loadRoster(shown[0].label_id)
    }
  }, [wide, shown, selectedId, loadRoster])

  const openCount = (list) => list.filter(t => t.status !== 'Done').length
  const overdueCount = useMemo(() => shown.filter(t => bucketOf(t) === 'overdue').length, [shown])

  const patch = async (id, fields) => {
    setBusy(id)
    // Optimistic, with an exact rollback: this list is worked through quickly and
    // a full refetch per tick would move rows under the pointer.
    const before = (data.mine || []).find(t => t.id === id)
    setData(d => ({ ...d, mine: (d.mine || []).map(t => (t.id === id ? { ...t, ...fields } : t)) }))
    try {
      const r = await api.patch(`/platform/work/tasks/${id}`, fields)
      const row = r.data.data
      setData(d => ({ ...d, mine: (d.mine || []).map(t => (t.id === id ? row : t)) }))
    } catch (e) {
      if (before) setData(d => ({ ...d, mine: (d.mine || []).map(t => (t.id === id ? before : t)) }))
      toast(e.response?.data?.error || 'Could not update the task', 'error')
    } finally { setBusy(null) }
  }

  // Autosave the note: debounced while typing, flushed on close. The id is
  // captured from the ref at FIRE time, not from the closure, so a save armed
  // against one task can never land on the next one after a fast switch.
  const saveNote = useCallback((id, value) => {
    clearTimeout(noteTimer.current)
    return api.patch(`/platform/work/tasks/${id}`, { notes: value.trim() || null })
      .then(r => setData(d => ({ ...d, mine: (d.mine || []).map(t => (t.id === id ? r.data.data : t)) })))
      .catch(e => toast(e.response?.data?.error || 'Could not save the note', 'error'))
  }, [toast])

  const scheduleNote = (id, value) => {
    clearTimeout(noteTimer.current)
    noteTimer.current = setTimeout(() => {
      const d = draftRef.current
      if (d.id === id) saveNote(id, d.value)
    }, 600)
  }

  // Commit whatever is in the box before it stops being on screen. Only when it
  // actually CHANGED — leaving a note you merely read must not stamp updated_at.
  const flushNote = useCallback(() => {
    const d = draftRef.current
    clearTimeout(noteTimer.current)
    if (d.id == null) return
    const row = (data.mine || []).find(t => t.id === d.id)
    if (row && (row.notes || '') !== d.value) saveNote(d.id, d.value)
  }, [data.mine, saveNote])

  const selectTask = (t) => {
    if (t.id === selectedId) return
    flushNote()
    setSelectedId(t.id)
    setDraft(t.notes || '')
    // The pane offers a reassign picker, which needs that tenant's people.
    loadRoster(t.label_id)
  }

  // Hand a task on, or take it back. Both lists are rewritten from the response
  // rather than patched in place: the row MOVES between "mine" and "waiting on
  // them", and a local patch would leave it under the heading it just left.
  const assign = async (t, userId) => {
    setBusy(t.id)
    try {
      const r = await api.post(`/platform/work/tasks/${t.id}/assign`, { user_id: userId || null })
      const row = r.data.data
      const mineNow = !userId
      setData(d => ({
        ...d,
        mine: mineNow ? [row, ...(d.mine || []).filter(x => x.id !== t.id)] : (d.mine || []).filter(x => x.id !== t.id),
        delegated: mineNow ? (d.delegated || []).filter(x => x.id !== t.id) : [row, ...(d.delegated || []).filter(x => x.id !== t.id)],
      }))
      setTab(mineNow ? 'mine' : 'delegated')
      setSelectedId(row.id)
      if (!r.data.unchanged) toast(mineNow ? 'Taken back' : `Assigned to ${row.assignee_name}`, 'success')
    } catch (e) {
      toast(e.response?.data?.error || 'Could not reassign the task', 'error')
    } finally { setBusy(null) }
  }

  const remove = async (t) => {
    setBusy(t.id)
    try {
      await api.delete(`/platform/work/tasks/${t.id}`)
      setData(d => ({ ...d, mine: (d.mine || []).filter(x => x.id !== t.id) }))
      toast('Task deleted', 'success')
    } catch (e) {
      toast(e.response?.data?.error || 'Could not delete the task', 'error')
    } finally { setBusy(null); setConfirmDel(null) }
  }

  const submitAdd = async (e) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const r = await api.post('/platform/work/tasks', {
        ...form,
        label_id: Number(form.label_id),
        due_date: form.due_date || null,
        user_id: form.user_id || null,
      })
      // It lands in whichever list it belongs to. Pushing an assigned task into
      // "mine" would show it under the wrong heading until the next refetch.
      const row = r.data.data
      const toMine = !form.user_id
      setData(d => toMine
        ? { ...d, mine: [row, ...(d.mine || [])] }
        : { ...d, delegated: [row, ...(d.delegated || [])] })
      setForm(f => ({ label_id: f.label_id, description: '', priority: 'Medium', due_date: '', category: '', user_id: '' }))
      setShowAdd(false)
      setTab(toMine ? 'mine' : 'delegated')
      toast(toMine ? `Added to ${row.label_name}` : `Assigned to ${row.assignee_name} in ${row.label_name}`, 'success')
    } catch (err) {
      toast(err.response?.data?.error || 'Could not create the task', 'error')
    } finally { setSaving(false) }
  }

  const GroupPill = ({ id, label }) => (
    <button
      onClick={() => setGroupBy(id)}
      aria-pressed={groupBy === id}
      className={`text-[11px] font-semibold px-2 py-1 rounded transition
        ${groupBy === id ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:text-ink'}`}
    >{label}</button>
  )

  if (loading) {
    return (
      <div className="space-y-4">
        {!embedded && <Skeleton.StatCards count={3} />}
        <Skeleton.TaskList count={6} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="card p-10 text-center">
        <AlertTriangle size={28} className="text-warning mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-ink">Couldn't load your work</p>
        <p className="text-xs text-ink-muted mt-1">{error}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => load()}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Headline. Deliberately three separate figures — mine, waiting on them,
          and how much of mine is late — never one total: they call for different
          actions and summing them would produce a number nobody can act on. */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${embedded ? 'hidden' : ''}`}>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none">{openCount(data.mine || [])}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Open, assigned to me</p>
        </div>
        <div className="card p-4 border-l-4 border-l-red-500">
          <p className="text-2xl font-bold text-ink leading-none">{overdueCount}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Overdue{wsFilter !== 'all' || q ? ' (filtered)' : ''}</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none">{openCount(data.delegated || [])}</p>
          <p className="text-[11px] text-ink-muted mt-1.5">Waiting on someone else</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-bold text-ink leading-none">
            {new Set((data.mine || []).filter(t => t.status !== 'Done').map(t => t.label_id)).size}
          </p>
          <p className="text-[11px] text-ink-muted mt-1.5">Workspaces with work</p>
        </div>
      </div>

      {embedded && (
        <p className="text-[11px] text-ink-muted">
          Every task assigned to you across every workspace you can reach, including this one and Platform HQ —
          not the tasks of the workspace you are standing in.
        </p>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center border-b border-divider px-3 sm:px-5 gap-1 flex-wrap" role="tablist">
          {[
            { id: 'mine', label: 'My tasks', count: openCount(data.mine || []) },
            { id: 'delegated', label: 'Waiting on them', count: openCount(data.delegated || []) },
          ].map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 py-3.5 mr-5 text-xs font-semibold border-b-2 transition-all rounded-t
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                ${tab === t.id ? 'border-brand-500 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                ${tab === t.id ? 'bg-brand-500/15 text-brand-ink' : 'bg-elev text-ink-muted'}`}>{t.count}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            <button
              onClick={() => load(true)}
              className="text-ink-muted hover:text-ink p-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              title="Refresh"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <Button size="sm" onClick={() => setShowAdd(v => !v)}>
              <Plus size={13} /> New task
            </Button>
          </div>
        </div>

        {showAdd && (
          <form onSubmit={submitAdd} className="border-b border-divider bg-elev px-3 sm:px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="lg:col-span-2">
                <label className="label">Workspace</label>
                <select className="input" required value={form.label_id}
                  onChange={e => {
                    // The assignee only means anything inside one workspace, so a
                    // workspace change clears it rather than carrying a person
                    // who is not a member of the new one.
                    setForm(f => ({ ...f, label_id: e.target.value, user_id: '' }))
                    loadRoster(e.target.value)
                  }}>
                  <option value="">Choose…</option>
                  {workspaces.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}{w.is_system ? ' (platform)' : ''}{w.status === 'suspended' ? ' — suspended' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="label">Task</label>
                <input className="input" required value={form.description} placeholder="What needs doing?"
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Priority</label>
                <select className="input" value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                  {TASK_PRIORITIES.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Due date</label>
                <input type="date" className="input" value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" value={form.category} placeholder="Optional"
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <label className="label">Assign to</label>
                <select className="input" value={form.user_id} disabled={!form.label_id}
                  onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                  <option value="">Me (kept in the console)</option>
                  {rosterFor(form.label_id).map(m => (
                    <option key={m.id} value={m.id}>{m.name}{m.department ? ` · ${m.department}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2 lg:col-span-2">
                <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add task'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </div>
            <p className="text-[11px] text-ink-faint mt-2.5">
              {form.user_id ? (
                <>Assigned to <span className="font-semibold text-ink-muted">{rosterFor(form.label_id).find(m => String(m.id) === String(form.user_id))?.name || 'them'}</span> in
                that workspace: it appears in their My Work, they are emailed, and the assignment is recorded in that
                workspace's activity log. You keep it here under “Waiting on them”.</>
              ) : (
                <>The task is assigned to you inside that workspace — it is not visible to its team, and you
                keep it here. Filing into a workspace you have never opened creates your membership there,
                which is logged in that workspace exactly as entering it is.</>
              )}
            </p>
          </form>
        )}

        <div className="px-3 sm:px-5 py-3 border-b border-divider flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <input
              className="input !pl-8 !h-8 text-xs"
              placeholder="Search tasks, workspaces, notes…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <select className="input !h-8 !w-auto text-xs" value={wsFilter} onChange={e => setWsFilter(e.target.value)}>
            <option value="all">All workspaces</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="flex items-center gap-1 border border-rule rounded-lg p-0.5">
            <span className="hidden sm:inline text-[10px] font-bold text-ink-faint uppercase tracking-wider px-1.5">Group</span>
            <GroupPill id="due" label="Urgency" />
            <GroupPill id="workspace" label="Workspace" />
            <GroupPill id="priority" label="Priority" />
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-ink-muted cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            Show done
          </label>
          {(q || wsFilter !== 'all' || showDone) && (
            <button onClick={() => { setQ(''); setWsFilter('all'); setShowDone(false) }}
              className="text-[11px] font-semibold text-brand-ink hover:underline">Clear</button>
          )}
          <span className="text-[11px] text-ink-muted ml-auto">
            {shown.length} of {rows.length}
          </span>
        </div>

        <div className="p-3 sm:p-5">
          {tab === 'delegated' && (
            <p className="text-[11px] text-ink-muted mb-3">
              Tasks you assigned to a workspace's own people. Read-only here — editing somebody's queue from
              outside their workspace is a different act from keeping your own list, so these link into the
              workspace instead.
            </p>
          )}

          {!shown.length ? (
            <div className="p-10 text-center">
              <CheckCircle2 size={28} className="text-success mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm text-ink">
                {rows.length ? 'Nothing matches these filters.' : tab === 'mine' ? 'Nothing on your plate.' : 'Nothing is waiting on anyone else.'}
              </p>
              {rows.length > 0 && (
                <Button variant="secondary" size="sm" className="mt-4"
                  onClick={() => { setQ(''); setWsFilter('all'); setShowDone(false) }}>Clear filters</Button>
              )}
            </div>
          ) : (
            /* Two panes: the list answers "what is on my plate", the pane beside
               it answers "what is this one". The row therefore carries only what
               you scan by — title, note, workspace — and every control that acts
               on a single task moved into the detail, which is why the list reads
               as a list instead of a toolbar per line. */
            <div className="lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-5">
              <div className="min-w-0 lg:max-h-[34rem] lg:overflow-y-auto lg:pr-1">
                {groups.map(g => (
                  <section key={g.key} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      {groupBy === 'workspace'
                        ? <WorkspaceMark ws={wsById.get(g.order)} color={colorOf(g.order)} tag={tagOf(g.order)} />
                        : <g.icon size={13} className={g.tone} aria-hidden="true" />}
                      <h3 className="text-[11px] font-bold text-ink uppercase tracking-wide">{g.label}</h3>
                      <span className="text-[11px] text-ink-muted">{g.items.length}</span>
                    </div>
                    <div className="card divide-y divide-divider overflow-hidden">
                      {g.items.map(t => {
                        const done = t.status === 'Done'
                        const late = bucketOf(t) === 'overdue'
                        const on = t.id === selectedId
                        return (
                          <div
                            key={t.id}
                            className={`flex items-start gap-2.5 px-3 py-2 transition ${on ? 'bg-selected' : 'hover:bg-elev'}`}
                          >
                            {tab === 'mine' ? (
                              <button
                                onClick={() => patch(t.id, { status: done ? 'To Do' : 'Done' })}
                                disabled={busy === t.id}
                                aria-label={done ? 'Mark as not done' : 'Mark as done'}
                                className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition
                                  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                                  ${done ? 'bg-success border-success text-white' : 'border-rule hover:border-brand-400'}`}
                              >
                                {done && <Check size={10} aria-hidden="true" />}
                              </button>
                            ) : (
                              <UserCheck size={13} className="text-ink-faint mt-1 flex-shrink-0" aria-hidden="true" />
                            )}

                            <button
                              onClick={() => selectTask(t)}
                              aria-current={on}
                              className="min-w-0 flex-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.Medium}`}
                                  title={t.priority || 'Medium'} aria-hidden="true" />
                                <span className={`text-sm truncate ${done ? 'line-through text-ink-muted' : 'text-ink font-medium'}`}>{t.description}</span>
                              </div>
                              {/* The note, not a marker that one exists. "No note"
                                  is the muted tier so a row that HAS one still wins
                                  the scan, and it advertises the field. */}
                              <p className={`text-[12px] truncate mt-0.5 ${t.notes ? 'text-ink-muted' : 'text-ink-faint italic'}`}>
                                {t.notes ? noteLine(t.notes) : (tab === 'mine' ? 'No note' : '')}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-ink-muted flex-wrap">
                                <WorkspaceMark ws={wsById.get(Number(t.label_id))} color={colorOf(t.label_id)} tag={tagOf(t.label_id)} />
                                <span className="truncate max-w-[9rem]">{t.label_name}</span>
                                {t.category && <span className="uppercase tracking-wide text-ink-faint truncate">{t.category}</span>}
                                {dueLabel(t) && <span className={late ? 'text-danger font-semibold' : ''}>{dueLabel(t)}</span>}
                              </div>
                            </button>
                            {busy === t.id && <Loader2 size={12} className="animate-spin text-ink-faint mt-1 flex-shrink-0" aria-hidden="true" />}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>

              {/* Detail. Below lg it renders under the list rather than beside it,
                  and only once something is picked — a permanently-open pane on a
                  phone would push the list off the screen. */}
              <div className={`min-w-0 lg:border-l lg:border-divider lg:pl-5 ${selected ? 'mt-5 lg:mt-0' : 'hidden lg:block'}`}>
                {selected ? (
                  <TaskDetail
                    task={selected}
                    editable={tab === 'mine'}
                    busy={busy === selected.id}
                    draft={draft}
                    onDraft={v => { setDraft(v); scheduleNote(selected.id, v) }}
                    onDraftBlur={() => saveNote(selected.id, draftRef.current.value)}
                    onPatch={patch}
                    onDelete={() => setConfirmDel(selected)}
                    onClose={() => { flushNote(); setSelectedId(null) }}
                    roster={rosterFor(selected.label_id)}
                    onAssign={uid => assign(selected, uid)}
                    workspace={wsById.get(Number(selected.label_id))}
                    color={colorOf(selected.label_id)}
                    tag={tagOf(selected.label_id)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-center py-16">
                    <div>
                      <StickyNote size={26} className="text-ink-faint mx-auto mb-2" aria-hidden="true" />
                      <p className="text-sm text-ink-muted">Pick a task to read and write its note.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Disclosures, not silence. A capped list that says nothing reads as a
              complete one, and a scoped list reads as the whole platform. */}
          <div className="mt-4 space-y-1">
            {(tab === 'mine' ? data.capped : data.delegated_capped) && (
              <p className="text-[11px] text-warning">
                Showing the first 500 tasks — narrow by workspace to see the rest.
              </p>
            )}
            <p className="text-[11px] text-ink-faint">
              Finished work is listed for 30 days, then drops off.
              {data.scoped && ' Limited to the workspaces you have access to, plus your own platform list.'}
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete this task?"
        message={confirmDel ? `“${confirmDel.description}” in ${confirmDel.label_name}. This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => remove(confirmDel)}
        onClose={() => setConfirmDel(null)}
      />
    </div>
  )
}

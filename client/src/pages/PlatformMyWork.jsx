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
  Clock, Loader2, Plus, RefreshCw, Search, Trash2, UserCheck,
} from 'lucide-react'
import api from '../api'
import Button from '../components/ui/Button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Skeleton from '../components/Skeleton'
import { useTheme } from '../context/ThemeContext'
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

export default function PlatformMyWork() {
  const { theme } = useTheme()
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
  const [menuFor, setMenuFor] = useState(null) // task id whose priority menu is open
  const [confirmDel, setConfirmDel] = useState(null)
  // The console has no task drawer, so the note is edited in place. `draft`
  // holds the text being typed: rendering straight from `data` would fight the
  // optimistic patch and jump the caret on every autosave.
  const [openNote, setOpenNote] = useState(null)   // task id whose note is open
  const [draft, setDraft] = useState('')
  const noteTimer = useRef(null)
  const draftRef = useRef({ id: null, value: '' })
  draftRef.current = { id: openNote, value: draft }

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ label_id: '', description: '', priority: 'Medium', due_date: '', category: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback((silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    return api.get('/platform/work')
      .then(r => { setData(r.data.data || {}); setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Could not load your work'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }, [])

  useEffect(() => { load() }, [load])
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

  const closeNote = () => {
    const d = draftRef.current
    clearTimeout(noteTimer.current)
    if (d.id != null) {
      const row = (data.mine || []).find(t => t.id === d.id)
      // Only write when it actually changed — closing a note you only read
      // should not stamp updated_at.
      if (row && (row.notes || '') !== d.value) saveNote(d.id, d.value)
    }
    setOpenNote(null); setDraft('')
  }

  const toggleNote = (t) => {
    if (openNote === t.id) { closeNote(); return }
    if (openNote != null) closeNote()
    setOpenNote(t.id); setDraft(t.notes || '')
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
      })
      setData(d => ({ ...d, mine: [r.data.data, ...(d.mine || [])] }))
      setForm(f => ({ label_id: f.label_id, description: '', priority: 'Medium', due_date: '', category: '' }))
      setShowAdd(false)
      setTab('mine')
      toast(`Added to ${r.data.data.label_name}`, 'success')
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
        <Skeleton.StatCards count={3} />
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
                  onChange={e => setForm(f => ({ ...f, label_id: e.target.value }))}>
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
              <div className="flex items-end gap-2 lg:col-span-2">
                <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add task'}</Button>
                <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </div>
            <p className="text-[11px] text-ink-faint mt-2.5">
              The task is assigned to you inside that workspace — it is not visible to its team, and you
              keep it here. Filing into a workspace you have never opened creates your membership there,
              which is logged in that workspace exactly as entering it is.
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
          ) : groups.map(g => (
            <section key={g.key} className="mb-5 last:mb-0">
              <div className="flex items-center gap-2 mb-2">
                {groupBy === 'workspace'
                  ? <WorkspaceMark ws={wsById.get(g.order)} color={colorOf(g.order)} tag={tagOf(g.order)} />
                  : <g.icon size={14} className={g.tone} aria-hidden="true" />}
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">{g.label}</h3>
                <span className="text-[11px] text-ink-muted">{g.items.length}</span>
              </div>
              <div className="card divide-y divide-divider">
                {g.items.map(t => {
                  const done = t.status === 'Done'
                  const mine = tab === 'mine'
                  const late = bucketOf(t) === 'overdue'
                  return (
                    <div key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                      {mine ? (
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
                        <UserCheck size={14} className="text-ink-faint mt-1 flex-shrink-0" aria-hidden="true" />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.Medium}`}
                            title={t.priority || 'Medium'} aria-hidden="true" />
                          {/* The title opens the note. This page has no drawer, so
                              without it the note would be readable nowhere. */}
                          {mine ? (
                            <button
                              onClick={() => toggleNote(t)}
                              aria-expanded={openNote === t.id}
                              className={`text-sm min-w-0 text-left rounded truncate
                                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                                ${done ? 'line-through text-ink-muted' : 'text-ink hover:text-brand-ink'}`}
                            >{t.description}</button>
                          ) : (
                            <p className={`text-sm min-w-0 ${done ? 'line-through text-ink-muted' : 'text-ink'}`}>{t.description}</p>
                          )}
                        </div>

                        {/* The note itself, not a marker saying one exists. "No
                            note" is the muted tier so a row that HAS one still
                            wins the scan — and it advertises a field nobody would
                            otherwise discover on this page. */}
                        {openNote !== t.id && (
                          <p className={`text-[12px] mt-0.5 truncate ${t.notes ? 'text-ink-muted' : 'text-ink-faint italic'}`}>
                            {t.notes ? noteLine(t.notes) : (mine ? 'No note' : '')}
                          </p>
                        )}

                        {openNote === t.id && (
                          <div className="mt-1.5">
                            <textarea
                              autoFocus
                              rows={4}
                              value={draft}
                              onChange={e => { setDraft(e.target.value); scheduleNote(t.id, e.target.value) }}
                              onBlur={() => saveNote(t.id, draftRef.current.value)}
                              onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); closeNote() } }}
                              placeholder="Longer detail, links, context…"
                              className="input resize-y w-full text-[13px]"
                            />
                            <div className="flex items-center gap-2 mt-1">
                              <button onClick={closeNote}
                                className="text-[11px] font-semibold text-brand-ink hover:underline rounded
                                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Done</button>
                              <span className="text-[10px] text-ink-faint">Saves as you type</span>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-ink-muted">
                          {groupBy !== 'workspace' && (
                            <WorkspaceMark ws={wsById.get(Number(t.label_id))} color={colorOf(t.label_id)} tag={tagOf(t.label_id)} />
                          )}
                          <span className="truncate max-w-[14rem]">{t.label_name}</span>
                          {t.label_status === 'suspended' && <span className="text-warning font-semibold">suspended</span>}
                          {t.category && <span className="px-1.5 py-0.5 rounded bg-elev">{t.category}</span>}
                          {t.release_name && <span className="truncate max-w-[12rem]">♪ {t.release_name}</span>}
                          {!mine && t.assignee_name && <span>→ {t.assignee_name}</span>}
                          {dueLabel(t) && (
                            <span className={late ? 'text-danger font-semibold' : ''}>{dueLabel(t)}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        {mine && !done && (
                          <>
                            {t.status !== 'In Progress' && (
                              <button onClick={() => patch(t.id, { status: 'In Progress' })} disabled={busy === t.id}
                                className="text-[10px] font-semibold text-ink-muted hover:text-ink px-1.5 py-1 rounded
                                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Start</button>
                            )}
                            {/* Relative to TODAY, not to the old due date: snoozing a
                                task 5 days late must mean "tomorrow", not "4 days late". */}
                            <button onClick={() => patch(t.id, { due_date: localDateStr(new Date(Date.now() + 864e5)) })}
                              disabled={busy === t.id} title="Due tomorrow"
                              className="text-[10px] font-semibold text-ink-muted hover:text-ink px-1.5 py-1 rounded
                                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">+1d</button>
                            <div className="relative">
                              <button onClick={() => setMenuFor(menuFor === t.id ? null : t.id)}
                                aria-haspopup="menu" aria-expanded={menuFor === t.id}
                                className="text-[10px] font-semibold text-ink-muted hover:text-ink px-1.5 py-1 rounded inline-flex items-center gap-0.5
                                           focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                                {t.priority || 'Medium'} <ChevronDown size={10} aria-hidden="true" />
                              </button>
                              {menuFor === t.id && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} aria-hidden="true" />
                                  <div role="menu" className="absolute right-0 top-full mt-1 z-20 card p-1 w-28 shadow-lg">
                                    {TASK_PRIORITIES.map(p => (
                                      <button key={p} role="menuitem"
                                        onClick={() => { setMenuFor(null); patch(t.id, { priority: p }) }}
                                        className="w-full text-left text-xs px-2 py-1.5 rounded text-ink hover:bg-elev">
                                        {p}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                            <input
                              type="date"
                              value={t.due_date ? String(t.due_date).slice(0, 10) : ''}
                              onChange={e => patch(t.id, { due_date: e.target.value || null })}
                              disabled={busy === t.id}
                              aria-label="Due date"
                              className="text-[10px] bg-transparent border border-rule rounded px-1 py-0.5 text-ink-muted
                                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                            />
                          </>
                        )}
                        {mine && (
                          <button onClick={() => setConfirmDel(t)} disabled={busy === t.id} aria-label="Delete task"
                            className="text-ink-faint hover:text-danger p-1 rounded
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        )}
                        {!mine && (
                          <a
                            href={`/workspaces?open=${t.label_id}`}
                            className="text-[10px] font-semibold text-brand-ink hover:underline inline-flex items-center gap-0.5 px-1.5 py-1"
                          >
                            Workspace <ArrowUpRight size={10} aria-hidden="true" />
                          </a>
                        )}
                        {busy === t.id && <Loader2 size={12} className="animate-spin text-ink-faint" aria-hidden="true" />}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

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

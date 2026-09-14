import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Music, FileText, Disc3, ExternalLink,
  Calendar as CalendarIcon, AlertCircle, RefreshCw, Building2, Eye, EyeOff,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import useHotkeys from '../hooks/useHotkeys'
import { localDateStr, formatDate } from '../utils/dates'
import { workspaceColor, workspaceTint, colorMap } from '../utils/workspaceColor'

// Every workspace's schedule on one grid.
//
// Colour carries the WORKSPACE and the icon carries the KIND — the opposite of
// the tenant calendar, where there is only one workspace so colour is free to
// mean kind. The question this page exists to answer is "who is dropping what,
// when, and is anyone colliding", and that is a question about tenants.

const KINDS = {
  release:         { label: 'Release',          icon: Music,        group: 'releases' },
  event:           { label: 'Event',            icon: CalendarIcon, group: 'events' },
  contract_signed: { label: 'Contract signed',  icon: FileText,     group: 'contracts' },
  contract_expiry: { label: 'Contract expires', icon: FileText,     group: 'contracts' },
  dsp_live:        { label: 'Live on DSP',      icon: Disc3,        group: 'dsp' },
  dsp_submitted:   { label: 'Submitted to DSP', icon: Disc3,        group: 'dsp' },
}
const GROUPS = [
  { key: 'releases',  label: 'Releases' },
  { key: 'events',    label: 'Events' },
  { key: 'contracts', label: 'Contracts' },
  // DSP is one row per release per platform, so across every tenant it can
  // outnumber everything else combined. It ships OFF by default and says so —
  // a month you have to un-clutter before you can read it is a month nobody
  // reads.
  { key: 'dsp',       label: 'DSP milestones', offByDefault: true },
]
const kindOf = (e) => KINDS[e.kind] || KINDS.event
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const DEFAULT_GROUPS = () => new Set(GROUPS.filter(g => !g.offByDefault).map(g => g.key))

export default function PlatformCalendar() {
  const { toast } = useToast()
  const { enterWorkspace } = useAuth()
  const navigate = useNavigate()

  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [events, setEvents] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [degraded, setDegraded] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [groups, setGroups] = useState(DEFAULT_GROUPS)
  const [hiddenWs, setHiddenWs] = useState(() => new Set())
  const [selected, setSelected] = useState(null)

  const monthStart = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1), [cursor])
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), [cursor])

  const load = () => {
    setLoading(true)
    // The window is exactly the month on screen. The server caps the range, so
    // there is no way for this page to ask for every row in every tenant.
    api.get('/platform/calendar', { params: { from: iso(monthStart), to: iso(monthEnd) } })
      .then(r => {
        setEvents(r.data.data || [])
        setWorkspaces(r.data.workspaces || [])
        setDegraded(r.data.degraded || [])
        setError(null)
      })
      .catch(() => setError('Could not load the calendar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [cursor])

  const todayIso = localDateStr()
  const colors = useMemo(() => colorMap(workspaces), [workspaces])
  const wsName = useMemo(() => new Map(workspaces.map(w => [Number(w.id), w.name])), [workspaces])

  const shown = useMemo(
    () => events.filter(e => groups.has(kindOf(e).group) && !hiddenWs.has(Number(e.label_id))),
    [events, groups, hiddenWs],
  )

  const byDate = useMemo(() => {
    const m = {}
    for (const e of shown) if (e.date) (m[e.date] ||= []).push(e)
    // Stable order inside a cell: workspace first, then title, so a day's chips
    // don't reshuffle between renders.
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) =>
        (wsName.get(Number(a.label_id)) || '').localeCompare(wsName.get(Number(b.label_id)) || '') ||
        a.title.localeCompare(b.title))
    }
    return m
  }, [shown, wsName])

  // Per-workspace counts for the month on screen — this is what makes the
  // legend a reading rather than a key, and it counts the KIND filters but not
  // the workspace filter, so hiding one never changes another's number.
  const wsCounts = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (!groups.has(kindOf(e).group)) continue
      const k = Number(e.label_id)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [events, groups])

  // Only the weeks the month needs. Leading/trailing slots are inert nulls, so
  // an adjacent month's dates can never masquerade as this month's.
  const weeks = useMemo(() => {
    const lead = monthStart.getDay()
    const days = monthEnd.getDate()
    const cells = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
    ]
    while (cells.length % 7) cells.push(null)
    const out = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [cursor, monthStart, monthEnd])

  const prevMonth = () => { setSelected(null); setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1)) }
  const nextMonth = () => { setSelected(null); setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1)) }
  const goToday = () => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(todayIso) }
  useHotkeys({ ArrowLeft: prevMonth, ArrowRight: nextMonth, t: goToday, r: load, Escape: () => setSelected(null) }, [todayIso])

  const toggleGroup = (k) => setGroups(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleWs = (id) => setHiddenWs(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisible = hiddenWs.size === 0

  // There is no /releases/:id inside the operator shell — opening an event
  // means entering that workspace first, then landing on the record. One
  // gesture, stated on the button.
  const open = async (e) => {
    if (!e.link) return
    const r = await enterWorkspace(e.label_id)
    if (r.success) navigate(e.link)
    else toast(r.error || 'Could not enter workspace', 'error')
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const selectedEvents = selected ? (byDate[selected] || []) : []

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-ink">Release calendar</h1>
          <p className="text-xs text-ink-muted mt-0.5">
            {loading ? 'Loading…' : `${shown.length} event${shown.length === 1 ? '' : 's'} across ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} · ${monthLabel}`}
          </p>
        </div>
        <button onClick={load} title="Refresh (r)" className="btn-secondary !py-1.5 text-xs">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {degraded.length > 0 && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-warning/10 text-warning text-xs">
          Some sources couldn’t load ({degraded.join(', ')}) — this month may be incomplete.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => toggleGroup(g.key)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
              groups.has(g.key) ? 'border-rule bg-card text-ink' : 'border-divider bg-elev text-ink-faint'}`}
          >
            {groups.has(g.key) ? <Eye size={12} /> : <EyeOff size={12} />}
            {g.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="card p-10 text-center">
          <AlertCircle size={28} className="text-danger mx-auto mb-3" />
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <div className="xl:col-span-3"><Skeleton.Block h="h-[34rem]" /></div>
          <div className="space-y-4"><Skeleton.Block h="h-72" /><Skeleton.Block h="h-40" /></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <div className="xl:col-span-3 bg-card border border-rule rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-divider">
              <div className="flex items-center gap-1">
                <button onClick={prevMonth} title="Previous month (←)" className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-elev"><ChevronLeft size={18} /></button>
                <span className="text-sm font-bold text-ink w-40 text-center">{monthLabel}</span>
                <button onClick={nextMonth} title="Next month (→)" className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-elev"><ChevronRight size={18} /></button>
              </div>
              <button onClick={goToday} title="Jump to today (t)" className="text-xs font-semibold text-brand-ink hover:underline">Today</button>
            </div>

            <div className="grid grid-cols-7 border-b border-divider">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="px-2 py-2 text-[10px] font-bold text-ink-faint uppercase tracking-wider text-center">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {weeks.flat().map((d, i) => {
                if (!d) return <div key={i} className="min-h-[108px] border-b border-r border-divider bg-elev" />
                const key = iso(d)
                const dayEvents = byDate[key] || []
                const isToday = key === todayIso
                const isPast = key < todayIso
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(s => (s === key ? null : key))}
                    className={`min-h-[108px] border-b border-r border-divider p-1.5 text-left align-top overflow-hidden transition-colors ${
                      selected === key ? 'bg-brand-500/10' : 'hover:bg-elev'}`}
                  >
                    <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center mb-1 ${
                      isToday ? 'bg-brand-600 text-white' : isPast ? 'text-ink-faint' : 'text-ink-muted'}`}>
                      {d.getDate()}
                    </span>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map(e => {
                        const color = colors.get(Number(e.label_id)) || workspaceColor({ id: e.label_id })
                        const Icon = kindOf(e).icon
                        return (
                          <span
                            key={e.id}
                            title={`${wsName.get(Number(e.label_id)) || 'Workspace'} — ${e.title}${e.subtitle ? ` (${e.subtitle})` : ''}`}
                            className="w-full flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded text-[10px] font-medium text-ink"
                            style={{ ...workspaceTint(color, 16), borderLeft: `2px solid ${color}` }}
                          >
                            <Icon size={9} className="flex-shrink-0 opacity-70" />
                            <span className="truncate">{e.title}</span>
                          </span>
                        )
                      })}
                      {dayEvents.length > 3 && (
                        <span className="block text-[10px] font-semibold text-ink-faint pl-1">+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            {/* Selected day */}
            {selected && (
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-ink">{formatDate(selected)}</h2>
                  <button onClick={() => setSelected(null)} className="text-xs text-ink-faint hover:text-ink">Clear</button>
                </div>
                {!selectedEvents.length ? (
                  <p className="text-sm text-ink-muted py-4 text-center">Nothing scheduled.</p>
                ) : (
                  <div className="space-y-1 -mx-1">
                    {selectedEvents.map(e => {
                      const color = colors.get(Number(e.label_id)) || workspaceColor({ id: e.label_id })
                      const K = kindOf(e)
                      const Icon = K.icon
                      return (
                        <div key={e.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-elev group">
                          <span className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-ink" style={workspaceTint(color, 20)}>
                            <Icon size={13} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink leading-snug break-words">{e.title}</p>
                            {e.subtitle && <p className="text-[11px] text-ink-muted truncate">{e.subtitle}</p>}
                            {e.description && <p className="text-[11px] text-ink-muted mt-0.5 whitespace-pre-line">{e.description}</p>}
                            <p className="text-[10px] text-ink-faint mt-0.5">
                              <span className="font-semibold" style={{ color }}>●</span>{' '}
                              {wsName.get(Number(e.label_id)) || 'Workspace'} · {K.label}{e.meta ? ` · ${e.meta}` : ''}
                            </p>
                          </div>
                          {e.link && (
                            <button
                              onClick={() => open(e)}
                              title={`Enter ${wsName.get(Number(e.label_id)) || 'workspace'} and open this`}
                              className="p-1 rounded text-ink-faint hover:text-brand-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex-shrink-0"
                            >
                              <ExternalLink size={13} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Workspace key — also the filter. */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-sm font-bold text-ink flex items-center gap-1.5"><Building2 size={14} className="text-ink-muted" /> Workspaces</h2>
                {!allVisible && <button onClick={() => setHiddenWs(new Set())} className="text-xs font-semibold text-brand-ink hover:underline">Show all</button>}
              </div>
              {!workspaces.length ? (
                <p className="text-sm text-ink-muted py-2">No workspaces.</p>
              ) : (
                <div className="space-y-0.5 -mx-1">
                  {workspaces.map(w => {
                    const id = Number(w.id)
                    const hidden = hiddenWs.has(id)
                    const n = wsCounts.get(id) || 0
                    return (
                      <button
                        key={id}
                        onClick={() => toggleWs(id)}
                        title={hidden ? 'Show on the calendar' : 'Hide from the calendar'}
                        className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-elev transition-colors ${hidden ? 'opacity-45' : ''}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: workspaceColor(w) }} />
                        <span className="text-xs text-ink truncate flex-1 text-left">{w.name}</span>
                        {w.status === 'suspended' && <span className="text-[10px] font-semibold text-danger">susp.</span>}
                        <span className="text-[11px] font-semibold text-ink-faint flex-shrink-0">{n}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-ink-faint mt-2.5">
                Colour identifies the workspace; the icon identifies the kind of event. Counts are for {monthLabel} and follow the filters above.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

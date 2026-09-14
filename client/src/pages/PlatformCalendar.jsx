import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Music, FileText, Disc3, ExternalLink,
  Calendar as CalendarIcon, AlertCircle, RefreshCw, Building2, Eye, EyeOff,
  Wand2,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import useHotkeys from '../hooks/useHotkeys'
import { localDateStr, formatDate } from '../utils/dates'
import { useTheme } from '../context/ThemeContext'
import Popover from '../components/mywork/Popover'
import WorkspaceColorPicker from '../components/WorkspaceColorPicker'
import { resolveColors, similarPairs, suggestColor, tagMap, DE_FLOOR, CVD_TARGET } from '../utils/workspaceColor'

// Every workspace's schedule on one grid.
//
// Identity is carried by the WORKSPACE and kind by the icon — the opposite of
// the tenant calendar, where there is only one workspace so colour is free to
// mean kind. The question this page exists to answer is "who is dropping what,
// when, and is anyone colliding", and that is a question about tenants.
//
// Workspace identity is TWO encodings: a colour and a text tag (see
// utils/workspaceColor). Running a categorical palette through a CVD/deltaE
// validator, no ordering of eight hues clears the all-pairs gate past three
// slots — and any two tenants can land in the same day cell — so the tag is not
// decoration, it is the encoding that still works at the ninth tenant, for a
// colourblind reader, and on a printout.
//
// Colours DEFAULT to each workspace's brand accent, because that is what the
// label already answers to. Two labels can of course pick the same dark grey,
// so the legend measures every visible pair and says so, with a one-click fix —
// telling the operator is better than silently overriding their branding.

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
  const [editing, setEditing] = useState(null)   // workspace id whose colour picker is open
  const [savingColor, setSavingColor] = useState(false)

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
  // Colour resolution needs the theme: brand/override colours are fixed hex,
  // but the palette fallback has its own stepping for the dark card.
  const { theme } = useTheme()
  const resolved = useMemo(() => resolveColors(workspaces, theme), [workspaces, theme])
  const colorOf = (id) => resolved.get(Number(id))?.color || '#888888'
  // Tags resolve against the WHOLE roster, so hiding a workspace never
  // renames another one's tag.
  const tags = useMemo(() => tagMap(workspaces), [workspaces])
  // Measured, not guessed — same OKLab/Machado maths as the palette validator.
  const clashes = useMemo(() => similarPairs(workspaces, resolved), [workspaces, resolved])
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

  // Fix every measured clash at once. Only the SECOND workspace of each pair
  // moves, so a colour somebody deliberately set is not overwritten first, and
  // suggestColor is re-run against the colours already applied in this pass —
  // otherwise two fixes can land on the same slot and trade one clash for another.
  const autoFix = async () => {
    setSavingColor(true)
    const moved = new Set()
    let roster = workspaces
    for (const pair of clashes) {
      const target = moved.has(Number(pair.a.id)) ? pair.b : pair.b
      const id = Number(target.id)
      if (moved.has(id)) continue
      const color = suggestColor(id, roster, resolveColors(roster, theme), theme)
      roster = roster.map(w => (Number(w.id) === id ? { ...w, console_color: color } : w))
      moved.add(id)
      try { await api.put(`/platform/workspaces/${id}/colors`, { console_color: color }) }
      catch { toast(`Could not recolour ${target.name}`, 'error'); setSavingColor(false); return }
    }
    setWorkspaces(roster)
    setSavingColor(false)
    if (moved.size) toast(`Recoloured ${moved.size} workspace${moved.size === 1 ? '' : 's'}`)
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
                        const color = colorOf(e.label_id)
                        const Icon = kindOf(e).icon
                        return (
                          <span
                            key={e.id}
                            title={`${wsName.get(Number(e.label_id)) || 'Workspace'} — ${e.title}${e.subtitle ? ` (${e.subtitle})` : ''}`}
                            className="w-full flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-sm text-[10px] font-medium text-ink bg-elev"
                            style={{ borderLeft: `4px solid ${color}` }}
                          >
                            {/* The tag wears an ink token, never the slot
                                colour: the coloured rail beside it carries
                                identity, and small text in a series colour is
                                the pairing that fails contrast. */}
                            <span className="font-bold tracking-wide text-ink-muted flex-shrink-0">
                              {tags.get(Number(e.label_id)) || '??'}
                            </span>
                            <Icon size={9} className="flex-shrink-0 opacity-60" />
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
                      const color = colorOf(e.label_id)
                      const K = kindOf(e)
                      const Icon = K.icon
                      return (
                        <div key={e.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-elev group">
                          <span
                            className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-ink bg-elev"
                            style={{ boxShadow: `inset 0 0 0 2px ${color}` }}
                          >
                            <Icon size={13} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink leading-snug break-words">{e.title}</p>
                            {e.subtitle && <p className="text-[11px] text-ink-muted truncate">{e.subtitle}</p>}
                            {e.description && <p className="text-[11px] text-ink-muted mt-0.5 whitespace-pre-line">{e.description}</p>}
                            <p className="text-[10px] text-ink-faint mt-0.5 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="font-bold text-ink-muted">{tags.get(Number(e.label_id)) || '??'}</span>
                              <span className="truncate">{wsName.get(Number(e.label_id)) || 'Workspace'} · {K.label}{e.meta ? ` · ${e.meta}` : ''}</span>
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
              {/* Measured, not eyeballed: the same OKLab + Machado maths the
                  palette validator runs. Below either published floor the
                  operator is told which pair, by how much, and offered the fix
                  — rather than the console quietly overriding their branding. */}
              {clashes.length > 0 && (
                <div className="mb-3 rounded-lg bg-warning/10 p-2.5">
                  <p className="text-[11px] font-semibold text-warning flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    {clashes.length} pair{clashes.length === 1 ? '' : 's'} hard to tell apart
                  </p>
                  {clashes.slice(0, 3).map((c, i) => (
                    <p key={i} className="text-[10px] text-ink-muted mt-1">
                      {c.a.name} · {c.b.name} —{' '}
                      {c.normal < DE_FLOOR
                        ? `ΔE ${c.normal.toFixed(1)} (needs ${DE_FLOOR})`
                        : `colourblind ΔE ${c.cvd.toFixed(1)} (needs ${CVD_TARGET})`}
                    </p>
                  ))}
                  {clashes.length > 3 && <p className="text-[10px] text-ink-faint mt-1">+{clashes.length - 3} more</p>}
                  <button onClick={autoFix} disabled={savingColor}
                    className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-ink hover:underline disabled:opacity-50">
                    <Wand2 size={11} /> Pick distinct colours
                  </button>
                </div>
              )}

              {!workspaces.length ? (
                <p className="text-sm text-ink-muted py-2">No workspaces.</p>
              ) : (
                <div className="space-y-0.5 -mx-1">
                  {workspaces.map(w => {
                    const id = Number(w.id)
                    const hidden = hiddenWs.has(id)
                    const n = wsCounts.get(id) || 0
                    const res = resolved.get(id) || {}
                    return (
                      <div key={id} className={`relative flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-elev transition-colors ${hidden ? 'opacity-45' : ''}`}>
                        {/* Swatch EDITS, row toggles. A view-click and a
                            change-click must never be the same gesture. */}
                        <button
                          onClick={() => setEditing(e => (e === id ? null : id))}
                          title={`Change ${w.name}'s colour (${res.source === 'brand' ? 'brand accent' : res.source === 'custom' ? 'set by an operator' : 'auto-assigned'})`}
                          className="w-3.5 h-3.5 rounded-sm flex-shrink-0 ring-1 ring-inset ring-black/10 hover:scale-125 transition-transform"
                          style={{ background: res.color }}
                        />
                        <button onClick={() => toggleWs(id)}
                          title={hidden ? 'Show on the calendar' : 'Hide from the calendar'}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left">
                          <span className="text-[10px] font-bold tracking-wide text-ink-muted flex-shrink-0 w-6">{tags.get(id)}</span>
                          <span className="text-xs text-ink truncate flex-1">{w.name}</span>
                          {w.status === 'suspended' && <span className="text-[10px] font-semibold text-danger">susp.</span>}
                          <span className="text-[11px] font-semibold text-ink-faint flex-shrink-0">{n}</span>
                        </button>

                        <Popover open={editing === id} onClose={() => setEditing(null)} title={w.name} align="right" width="w-64">
                          <WorkspaceColorPicker
                            workspace={w}
                            workspaces={workspaces}
                            field="console_color"
                            theme={theme}
                            onSaved={(patch) => {
                              // Patch locally — reloading would re-fetch the whole
                              // month to change one swatch, and drop the selected day.
                              setWorkspaces(ws => ws.map(x => (Number(x.id) === id ? { ...x, ...patch } : x)))
                              setEditing(null)
                            }}
                          />
                        </Popover>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-[10px] text-ink-faint mt-2.5">
                Colours default to each workspace's brand accent — click a swatch to change one. The tag is what to read when two colours look alike.
                Counts are for {monthLabel} and follow the filters above.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

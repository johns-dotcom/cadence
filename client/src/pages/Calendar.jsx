import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Plus, Trash2, Music, CheckSquare, FileText,
  Disc3, Calendar as CalendarIcon, AlertCircle, ExternalLink,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { Modal, ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import useHotkeys from '../hooks/useHotkeys'
import { localDateStr, formatDate, daysUntilLocal } from '../utils/dates'
import { parseLocalDate } from '../utils/releases'
import { CALENDAR_EVENT_TYPES } from '../constants'

// Per-kind presentation. Tints are translucent so they survive both themes —
// the solid `-50` fills go near-white on the dark card and take their text
// with them.
const KINDS = {
  release:         { label: 'Release',           icon: Music,        dot: 'bg-brand-500',   chip: 'bg-brand-500/15 text-brand-ink' },
  task:            { label: 'Task due',          icon: CheckSquare,  dot: 'bg-amber-500',   chip: 'bg-amber-500/15 text-amber-600' },
  contract_expiry: { label: 'Contract expires',  icon: FileText,     dot: 'bg-red-500',     chip: 'bg-red-500/15 text-red-600' },
  contract_signed: { label: 'Contract signed',   icon: FileText,     dot: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-600' },
  dsp_live:        { label: 'Live on DSP',       icon: Disc3,        dot: 'bg-purple-500',  chip: 'bg-purple-500/15 text-purple-600' },
  dsp_submitted:   { label: 'Submitted to DSP',  icon: Disc3,        dot: 'bg-indigo-500',  chip: 'bg-indigo-500/15 text-indigo-600' },
  event:           { label: 'Event',             icon: CalendarIcon, dot: 'bg-slate-400',   chip: 'bg-slate-500/15 text-slate-600' },
}

// Filter chips collapse the 7 kinds into 5 groups: nobody wants to toggle
// "signed" and "expiring" separately, and 7 chips is a second row.
const GROUPS = [
  { key: 'releases',  label: 'Releases',  kinds: ['release'],                            dot: 'bg-brand-500' },
  { key: 'tasks',     label: 'Tasks',     kinds: ['task'],                               dot: 'bg-amber-500' },
  { key: 'contracts', label: 'Contracts', kinds: ['contract_expiry', 'contract_signed'], dot: 'bg-red-500' },
  { key: 'dsp',       label: 'DSP',       kinds: ['dsp_live', 'dsp_submitted'],          dot: 'bg-purple-500' },
  { key: 'events',    label: 'Events',    kinds: ['event'],                              dot: 'bg-slate-400' },
]
const GROUP_OF = {}
for (const g of GROUPS) for (const k of g.kinds) GROUP_OF[k] = g.key

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (isoStr, n) => { const [y, m, d] = isoStr.split('-').map(Number); return iso(new Date(y, m - 1, d + n)) }
const kindOf = (e) => KINDS[e.kind] || KINDS.event

export default function Calendar() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [degraded, setDegraded] = useState([])
  const [enabled, setEnabled] = useState(() => new Set(GROUPS.map(g => g.key)))
  const [selected, setSelected] = useState(null)   // ISO date string, or null → Upcoming panel
  const [addFor, setAddFor] = useState(null)       // ISO date the modal opens on
  const [form, setForm] = useState({ title: '', description: '', event_type: 'manual', event_date: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/calendar')
      .then(r => { setEvents(r.data.data || []); setDegraded(r.data.degraded || []); setError(null) })
      .catch(() => setError('Could not load the calendar'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const todayIso = localDateStr()
  const visible = (e) => enabled.has(GROUP_OF[e.kind] || 'events')
  const shown = useMemo(() => events.filter(visible), [events, enabled])

  // Index by ISO date for per-cell lookup. Server already normalises to
  // 'YYYY-MM-DD' from the local parts of the pg Date, so no re-parsing here —
  // a `new Date('YYYY-MM-DD')` round-trip is the classic day-shift.
  const byDate = useMemo(() => {
    const map = {}
    for (const e of shown) {
      if (!e.date) continue
      ;(map[String(e.date).slice(0, 10)] ||= []).push(e)
    }
    return map
  }, [shown])

  // Only the weeks the month actually needs — a fixed 6-row grid pads February
  // with a whole empty week. Leading/trailing slots are inert nulls, so an
  // adjacent month's events never masquerade as this month's.
  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const lead = first.getDay()
    const cells = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)),
    ]
    while (cells.length % 7) cells.push(null)
    const out = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [cursor])

  // Next 14 days, local-calendar windowed and sorted.
  const upcoming = useMemo(() => {
    const end = addDays(todayIso, 14)
    return shown
      .filter(e => e.date && e.date >= todayIso && e.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  }, [shown, todayIso])

  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const prevMonth = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  const nextMonth = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))
  const goToday = () => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(todayIso) }
  const openAdd = (date) => { setForm({ title: '', description: '', event_type: 'manual', event_date: date || selected || todayIso }); setAddFor(date || selected || todayIso) }
  const toggleGroup = (k) => setEnabled(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })

  useHotkeys({
    ArrowLeft: prevMonth,
    ArrowRight: nextMonth,
    t: goToday,
    n: () => openAdd(),
    Escape: () => setSelected(null),
  }, [selected, todayIso])

  const createEvent = async (e) => {
    e?.preventDefault()
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    setSaving(true)
    try {
      await api.post('/calendar', {
        title: form.title.trim(),
        event_date: form.event_date,
        description: form.description.trim() || null,
        event_type: form.event_type,
      })
      toast('Event added')
      setAddFor(null)
      setSelected(form.event_date)
      // Jump the grid to the month the event landed in, so it's visible.
      const [y, m] = form.event_date.split('-').map(Number)
      setCursor(new Date(y, m - 1, 1))
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to add event', 'error') }
    finally { setSaving(false) }
  }

  const deleteEvent = (e) => setConfirmDel(e)
  const doDelete = async () => {
    const e = confirmDel
    setConfirmDel(null)
    try { await api.delete(`/calendar/${e.eventId}`); setEvents(list => list.filter(x => x.id !== e.id)) }
    catch { toast('Failed to delete', 'error') }
  }

  // A chip click NAVIGATES (or does nothing for a manual event). Deleting is a
  // separate, explicit trash button in the day panel — view-click and
  // destroy-click must never be the same gesture.
  const onChipClick = (e) => {
    if (e.link) navigate(e.link)
    else setSelected(String(e.date).slice(0, 10))
  }

  const EventCard = (e) => {
    const K = kindOf(e)
    const Icon = K.icon
    return (
      <div key={e.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-brand-500/10 group">
        <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${K.chip}`}><Icon size={13} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink leading-snug break-words">{e.title}</p>
          {e.subtitle && <p className="text-[11px] text-ink-muted truncate">{e.subtitle}</p>}
          {e.description && <p className="text-[11px] text-ink-muted mt-0.5 whitespace-pre-line">{e.description}</p>}
          <p className="text-[10px] text-ink-faint mt-0.5">{K.label}{e.meta ? ` · ${e.meta}` : ''}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {e.link && (
            <button onClick={() => navigate(e.link)} title="Open" className="p-1 rounded text-ink-faint hover:text-brand-ink opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
              <ExternalLink size={13} />
            </button>
          )}
          {e.deletable && (
            <button onClick={() => deleteEvent(e)} title="Delete event" className="p-1 rounded text-ink-faint hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={loading ? 'Loading…' : `${shown.length} event${shown.length === 1 ? '' : 's'}`}
        action={
          <button onClick={() => openAdd()} className="btn-primary"><Plus size={15} /> Add event</button>
        }
      />

      {degraded.length > 0 && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-warning/10 text-warning text-xs">
          Some sources couldn’t load ({degraded.join(', ')}) — this month may be incomplete.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => toggleGroup(g.key)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition ${
              enabled.has(g.key) ? 'border-rule bg-card text-ink' : 'border-divider bg-elev text-ink-faint'}`}
          >
            <span className={`w-2 h-2 rounded-full ${g.dot} ${enabled.has(g.key) ? '' : 'opacity-30'}`} />
            {g.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <div className="xl:col-span-3"><Skeleton.Block h="h-[32rem]" /></div>
          <div className="space-y-4"><Skeleton.Block h="h-64" /><Skeleton.Block h="h-40" /></div>
        </div>
      ) : error ? (
        <div className="card p-10 text-center">
          <AlertCircle size={28} className="text-danger mx-auto mb-3" />
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          {/* Month grid */}
          <div className="xl:col-span-3 bg-card border border-rule rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-divider">
              <div className="flex items-center gap-1">
                <button onClick={prevMonth} title="Previous month (←)" className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-gray-100"><ChevronLeft size={18} /></button>
                <span className="text-sm font-bold text-ink w-36 text-center">{monthLabel}</span>
                <button onClick={nextMonth} title="Next month (→)" className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-gray-100"><ChevronRight size={18} /></button>
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
                if (!d) return <div key={i} className="min-h-[100px] border-b border-r border-divider bg-elev" />
                const key = iso(d)
                const dayEvents = byDate[key] || []
                const isToday = key === todayIso
                const isPast = key < todayIso
                return (
                  <button
                    key={i}
                    onClick={() => setSelected(s => (s === key ? null : key))}
                    className={`min-h-[100px] border-b border-r border-divider p-1.5 text-left align-top group transition-colors ${
                      selected === key ? 'bg-brand-500/10' : 'hover:bg-gray-100'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${
                        isToday ? 'bg-brand-600 text-white' : isPast ? 'text-ink-faint' : 'text-ink-muted'}`}>
                        {d.getDate()}
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={ev => { ev.stopPropagation(); openAdd(key) }}
                        title="Add event on this day"
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-brand-ink transition-opacity"
                      >
                        <Plus size={13} />
                      </span>
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map(e => {
                        const K = kindOf(e)
                        const Icon = K.icon
                        return (
                          <span
                            key={e.id}
                            role="button"
                            tabIndex={-1}
                            onClick={ev => { ev.stopPropagation(); onChipClick(e) }}
                            title={[e.title, e.subtitle].filter(Boolean).join(' — ')}
                            className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${K.chip} hover:brightness-95`}
                          >
                            <Icon size={9} className="flex-shrink-0" />
                            <span className="truncate">{e.title}</span>
                          </span>
                        )
                      })}
                      {dayEvents.length > 3 && (
                        <span className="block text-[10px] text-ink-faint pl-1.5">+{dayEvents.length - 3} more</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {selected ? (
              <div className="card p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h2 className="text-sm font-bold text-ink">{formatDate(selected)}</h2>
                    <p className="text-[11px] text-ink-faint">
                      {parseLocalDate(selected)?.toLocaleDateString(undefined, { weekday: 'long' })}
                    </p>
                  </div>
                  <button onClick={() => openAdd(selected)} className="btn-secondary !py-1 !px-2 text-xs"><Plus size={13} /> Add</button>
                </div>
                {(byDate[selected] || []).length ? (
                  <div className="-mx-2">{(byDate[selected] || []).map(EventCard)}</div>
                ) : <p className="text-sm text-ink-muted py-3">No events this day.</p>}
                <button onClick={() => setSelected(null)} className="text-xs font-semibold text-brand-ink hover:underline mt-2">Show upcoming instead</button>
              </div>
            ) : (
              <div className="card p-4">
                <h2 className="text-sm font-bold text-ink mb-2">Upcoming (14 days)</h2>
                {upcoming.length ? (
                  <div className="-mx-2 max-h-[26rem] overflow-y-auto">
                    {upcoming.map(e => {
                      const days = daysUntilLocal(e.date) ?? 0
                      const K = kindOf(e)
                      const Icon = K.icon
                      return (
                        <button
                          key={e.id}
                          onClick={() => {
                            const [y, m] = e.date.split('-').map(Number)
                            setCursor(new Date(y, m - 1, 1))
                            setSelected(e.date)
                          }}
                          className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-brand-500/10 text-left"
                        >
                          <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${K.chip}`}><Icon size={13} /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink leading-snug truncate">{e.title}</p>
                            {e.subtitle && <p className="text-[11px] text-ink-muted truncate">{e.subtitle}</p>}
                          </div>
                          <span className={`text-[10px] font-semibold flex-shrink-0 px-1.5 py-0.5 rounded-full ${days === 0 ? 'bg-success/15 text-success' : days <= 3 ? 'bg-warning/15 text-warning' : 'text-ink-faint'}`}>
                            {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : <p className="text-sm text-ink-muted py-3">Nothing upcoming.</p>}
              </div>
            )}

            {/* Legend */}
            <div className="card p-4">
              <h2 className="text-sm font-bold text-ink mb-2">Legend</h2>
              <div className="space-y-1.5">
                {Object.entries(KINDS).map(([k, K]) => (
                  <div key={k} className="flex items-center gap-2 text-[11px] text-ink-muted">
                    <span className={`w-2 h-2 rounded-full ${K.dot}`} />{K.label}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-ink-faint mt-3 leading-relaxed">
                Tasks show only your own due dates. Contract dates need Approver or above.
              </p>
              <p className="text-[10px] text-ink-faint mt-2">Keys: ← → month · <kbd className="font-mono">t</kbd> today · <kbd className="font-mono">n</kbd> new event</p>
            </div>
          </div>
        </div>
      )}

      {/* Add-event modal */}
      <Modal
        open={!!addFor}
        onClose={() => setAddFor(null)}
        title="New event"
        size="md"
        footer={
          <>
            <button onClick={() => setAddFor(null)} className="btn-secondary">Cancel</button>
            <button onClick={createEvent} disabled={saving} className="btn-primary"><Plus size={15} /> {saving ? 'Adding…' : 'Add event'}</button>
          </>
        }
      >
        <form onSubmit={createEvent} className="space-y-3">
          <div>
            <label className="label">Title</label>
            <input autoFocus required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Event title" className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date</label>
              <input type="date" required value={form.event_date} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Type</label>
              <select value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))} className="input">
                {CALENDAR_EVENT_TYPES.map(t => <option key={t} value={t}>{t === 'manual' ? 'General' : t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Notes (optional)" rows={3} className="input resize-none" />
          </div>
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={doDelete}
        title="Delete this event?"
        message={confirmDel ? `“${confirmDel.title}” will be removed from the calendar.` : ''}
      />
    </div>
  )
}

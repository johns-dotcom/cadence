import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

// Event kinds → colour + label. "event" is a manual entry (deletable); the rest
// are derived live from releases/tasks/contracts and link to their source page.
const KINDS = {
  release:          { label: 'Releases',  dot: 'bg-brand-500',   text: 'text-brand-700',   bg: 'bg-brand-50' },
  task:             { label: 'Tasks',     dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' },
  contract_expiry:  { label: 'Expiring',  dot: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50' },
  contract_signed:  { label: 'Signed',    dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  dsp:              { label: 'DSP live',   dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50' },
  event:            { label: 'Events',    dot: 'bg-violet-500',  text: 'text-violet-700',  bg: 'bg-violet-50' },
}
const KIND_KEYS = Object.keys(KINDS)
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function Calendar() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [events, setEvents] = useState([])
  const [enabled, setEnabled] = useState(() => new Set(KIND_KEYS))
  const [addFor, setAddFor] = useState(null) // ISO date string for the add modal
  const [form, setForm] = useState({ title: '', description: '' })

  const load = () => { api.get('/calendar').then(r => setEvents(r.data.data || [])).catch(() => {}) }
  useEffect(() => { load() }, [])

  // Index events by ISO date for fast per-cell lookup.
  const byDate = useMemo(() => {
    const map = {}
    for (const e of events) {
      if (!e.date) continue
      const key = String(e.date).slice(0, 10)
      ;(map[key] ||= []).push(e)
    }
    return map
  }, [events])

  // Build the 6-week grid (leading/trailing days from adjacent months).
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [cursor])

  const todayIso = iso(new Date())
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const toggleKind = (k) => setEnabled(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const visible = (e) => enabled.has(e.kind)

  const createEvent = async () => {
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    try {
      await api.post('/calendar', { title: form.title.trim(), event_date: addFor, description: form.description.trim() || null, color: 'violet' })
      toast('Event added'); setAddFor(null); setForm({ title: '', description: '' }); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to add event', 'error') }
  }
  const deleteEvent = async (eventId) => {
    if (!window.confirm('Delete this event?')) return
    try { await api.delete(`/calendar/${eventId}`); load() } catch { toast('Failed', 'error') }
  }
  const onEventClick = (e) => { if (e.link) navigate(e.link); else if (e.kind === 'event') deleteEvent(e.eventId) }

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Releases, tasks, contract dates and events for this workspace"
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="btn-secondary">Today</button>
            <div className="flex items-center border border-rule rounded-lg">
              <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="p-1.5 text-gray-500 hover:text-gray-800"><ChevronLeft size={16} /></button>
              <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="p-1.5 text-gray-500 hover:text-gray-800"><ChevronRight size={16} /></button>
            </div>
          </div>
        }
      />

      {/* Legend / filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-base font-semibold text-ink mr-2 min-w-[150px]">{monthLabel}</span>
        {KIND_KEYS.map(k => (
          <button
            key={k}
            onClick={() => toggleKind(k)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${enabled.has(k) ? 'border-rule text-gray-700 bg-card' : 'border-divider text-gray-400 opacity-60'}`}
          >
            <span className={`w-2 h-2 rounded-full ${KINDS[k].dot}`} />
            {KINDS[k].label}
          </button>
        ))}
      </div>

      {/* Month grid */}
      <div className="bg-card border border-rule rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-divider">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const key = iso(d)
            const inMonth = d.getMonth() === cursor.getMonth()
            const dayEvents = (byDate[key] || []).filter(visible)
            return (
              <div key={i} className={`min-h-[104px] border-b border-r border-divider p-1.5 group relative ${inMonth ? '' : 'bg-page/50'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium ${key === todayIso ? 'bg-brand-600 text-white w-5 h-5 rounded-full flex items-center justify-center' : inMonth ? 'text-gray-600' : 'text-gray-300'}`}>{d.getDate()}</span>
                  <button onClick={() => { setAddFor(key); setForm({ title: '', description: '' }) }} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-brand-600 transition-opacity" title="Add event">
                    <Plus size={13} />
                  </button>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 4).map(e => (
                    <button
                      key={e.id}
                      onClick={() => onEventClick(e)}
                      title={e.title}
                      className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium truncate text-left ${KINDS[e.kind].bg} ${KINDS[e.kind].text} hover:brightness-95`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${KINDS[e.kind].dot}`} />
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                  {dayEvents.length > 4 && <span className="block text-[10px] text-gray-400 pl-1.5">+{dayEvents.length - 4} more</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Add-event modal */}
      {addFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-overlay" onClick={() => setAddFor(null)}>
          <div className="w-full max-w-md bg-card rounded-2xl border border-rule shadow-modal p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-ink">New event · {new Date(addFor + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
              <button onClick={() => setAddFor(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <input autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Event title" className="input w-full" onKeyDown={e => e.key === 'Enter' && createEvent()} />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Notes (optional)" rows={3} className="input w-full resize-none" />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAddFor(null)} className="btn-secondary">Cancel</button>
              <button onClick={createEvent} className="btn-primary"><Plus size={15} /> Add event</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

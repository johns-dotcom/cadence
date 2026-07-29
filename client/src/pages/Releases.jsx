import { useEffect, useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, Music, Search, CalendarDays, List, Bell, ChevronLeft, ChevronRight, GitMerge } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { RELEASE_TYPES, RELEASE_STATUSES, RELEASE_CHECKLIST } from '../constants'
import { formatDate, daysUntilLocal } from '../utils/dates'

const STATUS_STYLES = {
  Draft:     'bg-gray-100 text-gray-600',
  Scheduled: 'bg-amber-100 text-amber-700',
  Released:  'bg-emerald-100 text-emerald-700',
  Archived:  'bg-gray-100 text-gray-400',
}
const CHECK_KEYS = RELEASE_CHECKLIST.map(c => c.key)
const progressOf = (r) => {
  const done = CHECK_KEYS.filter(k => r[k]).length
  return Math.round((done / CHECK_KEYS.length) * 100)
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Releases() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [releases, setReleases] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ project_name: '', artist_id: '', release_date: '', release_type: 'Single', status: 'Draft' })
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState('list') // 'list' | 'calendar'
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/releases'), api.get('/artists')])
      .then(([r, a]) => { setReleases(r.data.data || []); setArtists(a.data.data || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.project_name.trim()) return
    setSaving(true)
    try {
      await api.post('/releases', { ...form, artist_id: form.artist_id || undefined, release_date: form.release_date || undefined })
      toast('Release created')
      setForm({ project_name: '', artist_id: '', release_date: '', release_type: 'Single', status: 'Draft' })
      setShowForm(false)
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create release', 'error')
    } finally { setSaving(false) }
  }
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const shown = useMemo(() => {
    const lq = q.trim().toLowerCase()
    return releases.filter(r => {
      if (status && r.status !== status) return false
      if (lq && !`${r.project_name} ${r.artist_name || ''}`.toLowerCase().includes(lq)) return false
      return true
    })
  }, [releases, q, status])

  // Releases dropping within 14 days that aren't fully prepped — the banner.
  const upcoming = useMemo(() => releases
    .filter(r => r.status !== 'Archived' && !r.archived && r.release_date)
    .map(r => ({ ...r, days: daysUntilLocal(r.release_date), pct: progressOf(r) }))
    .filter(r => r.days >= 0 && r.days <= 14)
    .sort((a, b) => a.days - b.days), [releases])

  // Calendar cells for the current cursor month.
  const calendar = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const startDow = first.getDay()
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const byDay = {}
    releases.forEach(r => {
      if (!r.release_date) return
      const d = new Date(r.release_date)
      if (d.getFullYear() === cursor.y && d.getMonth() === cursor.m) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(r)
    })
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let day = 1; day <= daysInMonth; day++) cells.push({ day, items: byDay[day] || [] })
    return cells
  }, [cursor, releases])

  const shiftMonth = (delta) => setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  return (
    <div>
      <PageHeader
        title="Releases"
        subtitle="Release pipeline"
        action={
          <div className="flex items-center gap-2">
            <Link to="/data-quality" className="btn-secondary" title="Find & merge duplicate releases"><GitMerge size={15} /> Duplicates</Link>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> New release</button>
          </div>
        }
      />

      {upcoming.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <Bell size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">{upcoming.length} release{upcoming.length === 1 ? '' : 's'} dropping in the next 14 days</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {upcoming.slice(0, 6).map(r => (
                <Link key={r.id} to={`/releases/${r.id}`} className="text-xs text-amber-800 hover:underline">
                  {r.project_name} · {r.days === 0 ? 'today' : `${r.days}d`} · {r.pct}%
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2"><label className="label">Project name</label><input className="input" value={form.project_name} onChange={set('project_name')} placeholder="Single / EP / Album title" autoFocus /></div>
          <div><label className="label">Artist</label><select className="input" value={form.artist_id} onChange={set('artist_id')}><option value="">Unassigned</option>{artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label className="label">Release date</label><input type="date" className="input" value={form.release_date} onChange={set('release_date')} /></div>
          <div><label className="label">Type</label><select className="input" value={form.release_type} onChange={set('release_type')}>{RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={set('status')}>{RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div className="flex items-end"><button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Create'}</button></div>
        </form>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or artist…" className="input !pl-9" />
        </div>
        <select className="input !w-auto" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
          <button onClick={() => setView('list')} className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${view === 'list' ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}><List size={13} /> List</button>
          <button onClick={() => setView('calendar')} className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${view === 'calendar' ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}><CalendarDays size={13} /> Calendar</button>
        </div>
      </div>

      {loading ? (
        <Skeleton.Block h="h-64" />
      ) : releases.length === 0 ? (
        <div className="card p-10 text-center"><Music size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No releases yet.</p></div>
      ) : view === 'calendar' ? (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft size={16} /></button>
            <h2 className="text-sm font-bold text-ink">{MONTHS[cursor.m]} {cursor.y}</h2>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-400 uppercase mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendar.map((cell, i) => (
              <div key={i} className={`min-h-[68px] rounded-lg p-1 ${cell ? 'bg-page/40' : ''}`}>
                {cell && (
                  <>
                    <p className="text-[10px] text-gray-400 text-right pr-0.5">{cell.day}</p>
                    <div className="space-y-0.5">
                      {cell.items.slice(0, 3).map(r => (
                        <button key={r.id} onClick={() => navigate(`/releases/${r.id}`)} title={`${r.project_name} — ${r.artist_name || ''}`} className="w-full truncate text-left text-[10px] font-medium text-brand-700 bg-brand-50 rounded px-1 py-0.5 hover:bg-brand-100">
                          {r.project_name}
                        </button>
                      ))}
                      {cell.items.length > 3 && <p className="text-[9px] text-gray-400 pl-1">+{cell.items.length - 3}</p>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-500">No releases match.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {['Project', 'Artist', 'Type', 'Date', 'Owner', 'Progress', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shown.map(r => {
                const pct = progressOf(r)
                return (
                  <tr key={r.id} onClick={() => navigate(`/releases/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-ink">{r.project_name}</td>
                    <td className="px-4 py-3 text-gray-600">{r.artist_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.release_type || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.release_date ? formatDate(r.release_date) : '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{r.assignee_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} /></div>
                        <span className="text-[11px] text-gray-400 tabular-nums">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status] || STATUS_STYLES.Draft}`}>{r.status}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

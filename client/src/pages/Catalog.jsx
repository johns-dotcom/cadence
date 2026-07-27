import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Disc3, Sparkles, Archive, RotateCcw, Music } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

const DATE_PRESETS = [
  { key: 'all', label: 'All time' },
  { key: '12m', label: 'Last 12 mo' },
  { key: '24m', label: 'Last 24 mo' },
  { key: 'ytd', label: 'This year' },
]
const yearOf = (d) => (d ? new Date(d).getFullYear() : 'Undated')
const isReleased = (r) => r.release_date && new Date(r.release_date) <= new Date()

export default function Catalog() {
  const { toast } = useToast()
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [genre, setGenre] = useState('')
  const [type, setType] = useState('')
  const [preset, setPreset] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [limit, setLimit] = useState(60)

  const load = () => { setLoading(true); api.get('/releases').then(r => setAll(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const genres = useMemo(() => [...new Set(all.map(r => r.genre).filter(Boolean))].sort(), [all])
  const types = useMemo(() => [...new Set(all.map(r => r.release_type).filter(Boolean))].sort(), [all])

  const presetCut = () => {
    const d = new Date()
    if (preset === '12m') return new Date(d.setMonth(d.getMonth() - 12))
    if (preset === '24m') return new Date(d.setMonth(d.getMonth() - 24))
    if (preset === 'ytd') return new Date(d.getFullYear(), 0, 1)
    return null
  }

  const shown = useMemo(() => {
    const cut = presetCut(); const lq = q.trim().toLowerCase()
    return all.filter(r => {
      if (!isReleased(r)) return false
      if (showArchived !== !!r.archived) return false
      if (cut && new Date(r.release_date) < cut) return false
      if (genre && r.genre !== genre) return false
      if (type && r.release_type !== type) return false
      if (lq && !`${r.project_name} ${r.artist_name} ${r.upc} ${r.isrc}`.toLowerCase().includes(lq)) return false
      return true
    })
  }, [all, q, genre, type, preset, showArchived])

  const groups = useMemo(() => {
    const g = {}
    shown.slice(0, limit).forEach(r => { (g[yearOf(r.release_date)] = g[yearOf(r.release_date)] || []).push(r) })
    return Object.entries(g).sort((a, b) => String(b[0]).localeCompare(String(a[0])))
  }, [shown, limit])

  const archive = async (r) => { try { await api.patch(`/releases/${r.id}`, { archived: !r.archived }); load() } catch { toast('Failed', 'error') } }

  const syncArtwork = async () => {
    const missing = shown.filter(r => !r.cover_art_url).slice(0, 40)
    if (!missing.length) { toast('All shown releases already have artwork'); return }
    setSyncing(true); let ok = 0
    for (const r of missing) { try { await api.post(`/releases/${r.id}/sync-artwork`); ok++ } catch { /* skip */ } }
    setSyncing(false); toast(`Synced artwork for ${ok} of ${missing.length}`); load()
  }

  return (
    <div>
      <PageHeader title="Catalog" subtitle="Your released back-catalog"
        action={<button onClick={syncArtwork} disabled={syncing} className="btn-secondary"><Sparkles size={15} /> {syncing ? 'Syncing…' : 'Sync artwork'}</button>} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, artist, UPC, ISRC…" className="input !pl-9" />
        </div>
        <select className="input !w-auto" value={genre} onChange={e => setGenre(e.target.value)}><option value="">All genres</option>{genres.map(g => <option key={g}>{g}</option>)}</select>
        <select className="input !w-auto" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{types.map(t => <option key={t}>{t}</option>)}</select>
        <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
          {DATE_PRESETS.map(p => <button key={p.key} onClick={() => setPreset(p.key)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${preset === p.key ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>{p.label}</button>)}
        </div>
        <button onClick={() => setShowArchived(v => !v)} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${showArchived ? 'bg-gray-900 text-white border-gray-900' : 'border-rule text-gray-500 hover:bg-gray-50'}`}><Archive size={13} className="inline mr-1" />{showArchived ? 'Archived' : 'Active'}</button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">{Array.from({ length: 12 }).map((_, i) => <Skeleton.Block key={i} h="h-44" />)}</div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><Disc3 size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">{showArchived ? 'Nothing archived.' : 'No released catalog matches. Releases appear here once their date has passed.'}</p></div>
      ) : (
        <div className="space-y-6">
          {groups.map(([year, items]) => (
            <div key={year}>
              <h2 className="text-sm font-bold text-ink mb-3">{year} <span className="text-gray-400 font-normal">· {items.length}</span></h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                {items.map(r => (
                  <div key={r.id} className="group">
                    <Link to={`/releases/${r.id}`} className="block aspect-square rounded-xl overflow-hidden bg-gray-100 ring-1 ring-black/5 relative">
                      {r.cover_art_url
                        ? <img src={r.cover_art_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><Music size={28} className="text-gray-300" /></div>}
                      {r.release_type && <span className="absolute top-1.5 left-1.5 text-[9px] font-bold uppercase bg-black/60 text-white px-1.5 py-0.5 rounded">{r.release_type}</span>}
                    </Link>
                    <div className="mt-1.5 flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">{r.project_name}</p>
                        <p className="text-[11px] text-gray-400 truncate">{r.artist_name || '—'} · {formatDate(r.release_date)}</p>
                        {(r.upc || r.isrc) && <p className="text-[10px] text-gray-300 font-mono truncate">{r.upc || r.isrc}</p>}
                      </div>
                      <button onClick={() => archive(r)} title={r.archived ? 'Unarchive' : 'Archive'} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-brand-600 flex-shrink-0">{r.archived ? <RotateCcw size={13} /> : <Archive size={13} />}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {shown.length > limit && <div className="text-center"><button onClick={() => setLimit(l => l + 60)} className="btn-secondary">Load more ({shown.length - limit})</button></div>}
        </div>
      )}
    </div>
  )
}

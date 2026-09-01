import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Disc3, Search, Download, RefreshCw, ChevronRight, ChevronDown,
  Archive, ArchiveRestore, Check, AlertCircle, X,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { Modal } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { genreTone } from '../constants'
import { formatDate } from '../utils/dates'

// Two-letter initials from the first letters of the first two words, so
// "Nova Rae" reads NR and not just N — a grid of single letters is a grid of
// identical circles.
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

// Release windows offered by the export popover.
const WINDOWS = [
  { days: 0, label: 'All time' },
  { days: 30, label: '1 mo' },
  { days: 90, label: '3 mo' },
  { days: 180, label: '6 mo' },
  { days: 365, label: '12 mo' },
  { days: 730, label: '24 mo' },
]

const RELEASE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'has', label: 'Has releases' },
  { key: 'none', label: 'No releases' },
]

const SORTS = [
  { key: 'name-asc', label: 'Name (A–Z)' },
  { key: 'name-desc', label: 'Name (Z–A)' },
  { key: 'releases-desc', label: 'Most releases' },
  { key: 'newest', label: 'Recently added' },
]

export default function Artists() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)

  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)   // first load only — the list stays on screen while refetching
  const [refetching, setRefetching] = useState(false)
  const [error, setError] = useState(null)

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('')
  const [saving, setSaving] = useState(false)

  // Filters / sort
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [genreFilter, setGenreFilter] = useState('')
  const [genreOpen, setGenreOpen] = useState(false)
  const [genreSearch, setGenreSearch] = useState('')
  const [releaseFilter, setReleaseFilter] = useState('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const [sort, setSort] = useState('name-asc')
  const [archivedOpen, setArchivedOpen] = useState(true)

  // Export popover
  const [exportOpen, setExportOpen] = useState(false)
  const [exportWindow, setExportWindow] = useState(0)
  const [exportGenres, setExportGenres] = useState([])   // [] = all genres
  const [exporting, setExporting] = useState(false)

  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // 300ms debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // A stale response from a slower earlier query must not overwrite a newer
  // one; the generation counter is the guard.
  const gen = useRef(0)
  const load = (first = false) => {
    const my = ++gen.current
    if (first) setLoading(true); else setRefetching(true)
    // include_archived is always on: the roster owns the archived section, and
    // without it an archived artist is only reachable via global search.
    api.get('/artists', { params: { include_archived: 1, search: debounced || undefined } })
      .then(res => {
        if (my !== gen.current) return
        setArtists(res.data.data || [])
        setError(null)
      })
      .catch(() => { if (my === gen.current) setError('Failed to load artists') })
      .finally(() => { if (my === gen.current) { setLoading(false); setRefetching(false) } })
  }
  useEffect(() => { load(artists.length === 0) }, [debounced])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.post('/artists', { name: name.trim(), genre: genre.trim() || undefined })
      toast('Artist added')
      setName(''); setGenre(''); setShowForm(false)
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add artist', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Archive/restore is optimistic — the card should visibly move between the
  // two sections on click — with an exact rollback if the server disagrees.
  const setArchived = async (a, archived) => {
    const before = artists
    setArtists(list => list.map(x => (x.id === a.id ? { ...x, archived } : x)))
    if (archived) setArchivedOpen(true)
    try {
      await api.patch(`/artists/${a.id}/archive`, { archived })
      toast(archived ? `${a.name} archived` : `${a.name} restored`)
    } catch (err) {
      setArtists(before)
      toast(err.response?.data?.error || 'Failed to update artist', 'error')
    }
  }

  const active = useMemo(() => artists.filter(a => !a.archived), [artists])
  const archived = useMemo(() => artists.filter(a => a.archived), [artists])

  // Genre counts drive the dropdown's per-row badges; derived from the ACTIVE
  // roster only so an archived cleanup doesn't inflate them.
  const genreCounts = useMemo(() => {
    const m = new Map()
    for (const a of active) if (a.genre) m.set(a.genre, (m.get(a.genre) || 0) + 1)
    return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
  }, [active])

  const filtered = useMemo(() => {
    let out = active
    if (genreFilter) out = out.filter(a => a.genre === genreFilter)
    if (releaseFilter === 'has') out = out.filter(a => a.total_releases > 0)
    if (releaseFilter === 'none') out = out.filter(a => !a.total_releases)
    if (activeOnly) out = out.filter(a => a.has_recent_release)
    const cmp = {
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'releases-desc': (a, b) => (b.total_releases || 0) - (a.total_releases || 0) || a.name.localeCompare(b.name),
      'newest': (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')),
    }[sort]
    return [...out].sort(cmp)
  }, [active, genreFilter, releaseFilter, activeOnly, sort])

  const stats = useMemo(() => ({
    total: active.length,
    genres: new Set(active.map(a => a.genre).filter(Boolean)).size,
    releases: active.reduce((s, a) => s + (a.total_releases || 0), 0),
    activeRoster: active.filter(a => a.has_recent_release).length,
  }), [active])

  // Live subtitle — says what you are looking at, including the filters.
  const subtitle = [
    `${filtered.length} artist${filtered.length === 1 ? '' : 's'}`,
    genreFilter || null,
    releaseFilter !== 'all' ? RELEASE_FILTERS.find(f => f.key === releaseFilter)?.label : null,
    activeOnly ? 'Active only' : null,
    debounced ? `matching “${debounced}”` : null,
  ].filter(Boolean).join(' · ')

  const doExport = async () => {
    setExporting(true)
    try {
      const params = {}
      if (exportGenres.length) params.genres = exportGenres.join(',')
      if (exportWindow > 0) params.since_days = exportWindow
      const res = await api.get('/artists/export', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      const gl = exportGenres.length ? exportGenres.join('-').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) : 'all'
      a.href = url
      a.download = `roster-${gl}${exportWindow > 0 ? `-last${exportWindow}d` : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      setExportOpen(false)
    } catch {
      toast('Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  // Batch loop mirroring the Catalog's artwork sync: keep calling until the
  // server stops making progress, so one click covers a whole roster without
  // a request that runs for minutes.
  const syncImages = async () => {
    setSyncing(true); setSyncMsg('')
    let updated = 0
    let total = 0
    try {
      for (let pass = 0; pass < 30; pass++) {
        const { data } = await api.post('/artists/sync-images', { limit: 40 })
        const d = data.data || {}
        if (d.disabled) { setSyncMsg('Spotify is not configured on the server'); break }
        updated += d.updated || 0
        total += d.total || 0
        setSyncMsg(`Updated ${updated}/${total}…`)
        // No rows processed, or nothing left that isn't already stamped.
        if (!d.total || !d.remaining) break
        await new Promise(r => setTimeout(r, 500))
      }
      if (total) { setSyncMsg(`Updated ${updated}/${total}`); load() }
      else if (!syncMsg) setSyncMsg('Nothing to sync')
    } catch (err) {
      setSyncMsg(err.response?.data?.error || 'Sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 8000)
    }
  }

  const ArtistCard = (a) => {
    const tone = genreTone(a.genre)
    const img = a.image_url && a.image_url !== 'not_found' ? a.image_url : null
    return (
      <div key={a.id} className="relative group">
        <Link
          to={`/artists/${a.id}`}
          className={`card flex items-center gap-3 px-4 py-3.5 pr-12 transition-all hover:border-brand-300 hover:shadow-elevated hover:-translate-y-0.5 ${a.archived ? 'opacity-60' : ''}`}
        >
          {img ? (
            <img src={img} alt="" className="w-11 h-11 rounded-full object-cover flex-shrink-0 bg-gray-100 ring-1 ring-rule" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-brand-500/15 ring-1 ring-rule flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-brand-ink">{initialsOf(a.name)}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">{a.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {a.genre && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tone}`}>{a.genre}</span>
              )}
              <span className="text-[11px] text-ink-faint tabular-nums">
                {a.total_releases} release{a.total_releases === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <ChevronRight size={14} className="text-ink-faint flex-shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
        {a.archived ? (
          <button
            onClick={() => setArchived(a, false)}
            title="Restore to the active roster"
            className="absolute top-1/2 -translate-y-1/2 right-3 text-[10px] font-semibold text-brand-ink hover:underline"
          >
            Restore
          </button>
        ) : (
          <button
            onClick={() => setArchived(a, true)}
            title="Archive — hides the artist from the roster without deleting anything"
            className="absolute top-2 right-2 p-1.5 rounded-lg text-ink-faint opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-warning hover:bg-warning/10 transition-opacity"
          >
            <Archive size={14} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Roster"
        subtitle={subtitle}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setExportOpen(true)} title="Export roster to Excel (alphabetical by name)" className="btn-secondary">
              <Download size={14} /> Export
            </button>
            {isApprover && (
              <button
                onClick={syncImages}
                disabled={syncing}
                title="Sync profile images from Spotify"
                className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-ink-muted hover:text-brand-ink hover:border-brand-300 disabled:opacity-50"
              >
                <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
              </button>
            )}
            <div className="relative w-64 max-w-[45vw]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search artists…"
                className="input !pl-9 !pr-8"
              />
              {refetching && <RefreshCw size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint animate-spin" />}
              {!refetching && search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"><X size={13} /></button>
              )}
            </div>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary">
              <Plus size={16} /> Add artist
            </button>
          </div>
        }
      />

      {syncMsg && <p className="text-xs text-ink-muted mb-3">{syncMsg}</p>}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Artist name" autoFocus />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label">Genre</label>
            <input className="input" value={genre} onChange={e => setGenre(e.target.value)} placeholder="Optional" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {loading ? (
        <div className="space-y-6">
          <Skeleton.StatCards count={4} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton.Card key={i} />)}
          </div>
        </div>
      ) : error ? (
        <div className="card p-10 text-center">
          <AlertCircle size={28} className="text-danger mx-auto mb-3" />
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={() => load(true)} className="btn-secondary">Retry</button>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Total Artists', value: stats.total },
              { label: 'Genres', value: stats.genres },
              { label: 'Total Releases', value: stats.releases },
              { label: 'Active Roster', value: stats.activeRoster },
            ].map(s => (
              <div key={s.label} className="card px-4 py-3">
                <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">{s.label}</p>
                <p className="text-xl font-bold text-ink mt-0.5 tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Filter toolbar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* Genre */}
            <div className="relative">
              <button
                onClick={() => { setGenreOpen(o => !o); setGenreSearch('') }}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${genreFilter ? 'border-brand-300 bg-brand-500/10 text-brand-ink' : 'border-rule text-ink-muted hover:text-ink'}`}
              >
                {genreFilter || 'All genres'} <ChevronDown size={13} />
              </button>
              {genreOpen && (
                <>
                  <button className="fixed inset-0 z-10 cursor-default" onClick={() => setGenreOpen(false)} aria-label="Close genre menu" />
                  <div className="absolute z-20 mt-1 w-60 bg-card border border-rule rounded-xl shadow-modal p-2">
                    <input
                      autoFocus
                      value={genreSearch}
                      onChange={e => setGenreSearch(e.target.value)}
                      placeholder="Filter genres…"
                      className="input !py-1.5 text-xs mb-1"
                    />
                    <div className="max-h-64 overflow-y-auto">
                      <button
                        onClick={() => { setGenreFilter(''); setGenreOpen(false) }}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs text-ink hover:bg-brand-500/10"
                      >
                        <span>All genres</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-ink-faint tabular-nums">{active.length}</span>
                          {!genreFilter && <Check size={13} className="text-brand-ink" />}
                        </span>
                      </button>
                      {genreCounts
                        .filter(([g]) => !genreSearch || g.toLowerCase().includes(genreSearch.toLowerCase()))
                        .map(([g, n]) => (
                          <button
                            key={g}
                            onClick={() => { setGenreFilter(g); setGenreOpen(false) }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs text-ink hover:bg-brand-500/10"
                          >
                            <span className="truncate">{g}</span>
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-ink-faint tabular-nums">{n}</span>
                              {genreFilter === g && <Check size={13} className="text-brand-ink" />}
                            </span>
                          </button>
                        ))}
                      {!genreCounts.length && <p className="px-2 py-2 text-xs text-ink-faint">No genres set yet.</p>}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Has / has-no releases */}
            <div className="inline-flex rounded-lg border border-rule overflow-hidden">
              {RELEASE_FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setReleaseFilter(f.key)}
                  className={`text-xs font-medium px-3 py-1.5 transition ${releaseFilter === f.key ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:text-ink'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Active only */}
            <button
              onClick={() => setActiveOnly(v => !v)}
              title="Only artists with a release in the past year or scheduled in the future"
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${activeOnly ? 'border-brand-300 bg-brand-500/10 text-brand-ink' : 'border-rule text-ink-muted hover:text-ink'}`}
            >
              <span className={`w-2 h-2 rounded-full ${activeOnly ? 'bg-success' : 'bg-gray-300'}`} />
              Active only
            </button>

            {/* Sort */}
            <select value={sort} onChange={e => setSort(e.target.value)} className="input !w-auto !py-1.5 text-xs ml-auto">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {/* Grid */}
          {filtered.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(ArtistCard)}
            </div>
          ) : (
            <div className="card p-10 text-center">
              <Disc3 size={28} className="text-ink-faint mx-auto mb-3" />
              <p className="text-sm text-ink-muted">
                {active.length ? 'No artists match these filters.' : 'No artists yet.'}
              </p>
              {active.length > 0 && (
                <button
                  onClick={() => { setSearch(''); setGenreFilter(''); setReleaseFilter('all'); setActiveOnly(false) }}
                  className="btn-secondary mt-3"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {/* Archived */}
          {archived.length > 0 && (
            <div className="mt-8 pt-5 border-t border-rule">
              <button onClick={() => setArchivedOpen(o => !o)} className="flex items-center gap-2 mb-3 text-sm font-semibold text-ink-muted hover:text-ink">
                {archivedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <ArchiveRestore size={14} />
                Archived ({archived.length})
              </button>
              {archivedOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {archived.map(a => (
                    <div key={a.id}>
                      {ArtistCard(a)}
                      {a.archived_at && <p className="text-[10px] text-ink-faint mt-1 ml-1">Archived {formatDate(a.archived_at)}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Export */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export roster"
        size="md"
        footer={
          <>
            <button onClick={() => setExportOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={doExport} disabled={exporting} className="btn-primary">
              <Download size={14} />
              {exporting ? 'Building…' : `Download ${exportGenres.length ? `${exportGenres.length} genre${exportGenres.length === 1 ? '' : 's'}` : 'all genres'}${exportWindow ? ` · past ${WINDOWS.find(w => w.days === exportWindow)?.label}` : ''}`}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="label mb-1.5">Release window</p>
            <div className="grid grid-cols-3 gap-1.5">
              {WINDOWS.map(w => (
                <button
                  key={w.days}
                  onClick={() => setExportWindow(w.days)}
                  className={`text-xs font-medium px-2 py-2 rounded-lg border transition ${exportWindow === w.days ? 'border-brand-300 bg-brand-500/15 text-brand-ink' : 'border-rule text-ink-muted hover:text-ink'}`}
                >
                  {w.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">
              Keeps artists with a release in the window. Every row still shows its last release date, so you can see why it qualified.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="label !mb-0">Genres</p>
              <button
                onClick={() => setExportGenres(exportGenres.length ? [] : genreCounts.map(([g]) => g))}
                className="text-[11px] font-semibold text-brand-ink hover:underline"
              >
                {exportGenres.length ? 'All genres' : 'Select all'}
              </button>
            </div>
            {genreCounts.length ? (
              <div className="max-h-48 overflow-y-auto border border-rule rounded-lg p-2 space-y-0.5">
                {genreCounts.map(([g, n]) => (
                  <label key={g} className="flex items-center gap-2 px-1.5 py-1 rounded text-xs text-ink cursor-pointer hover:bg-brand-500/10">
                    <input
                      type="checkbox"
                      checked={exportGenres.includes(g)}
                      onChange={e => setExportGenres(s => (e.target.checked ? [...s, g] : s.filter(x => x !== g)))}
                    />
                    <span className="flex-1 truncate">{g}</span>
                    <span className="text-ink-faint tabular-nums">{n}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-faint">No genres set on the roster yet — the export will include everyone.</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

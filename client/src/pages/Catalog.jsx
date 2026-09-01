import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Disc3, RefreshCw, Archive, RotateCcw, Music2, ExternalLink } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import useHotkeys from '../hooks/useHotkeys'
import { ConfirmDialog } from '../components/ui'
import { GENRE_OPTIONS, RELEASE_TYPES } from '../constants'
import { formatDate, localDateStr } from '../utils/dates'
import { spotifyUrl, hasArtwork } from '../utils/releases'

// Time presets. Order is load-bearing — the 1–6 hotkeys index this array.
const TIME_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: 'this_year', label: 'This year' },
  { value: '6mo', label: '6 mo' },
  { value: '12mo', label: '12 mo' },
  { value: '24mo', label: '2 yrs' },
  { value: 'custom', label: 'Custom' },
]
const MONTH_OPTIONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }))

// Per-type tints so a grid of covers is scannable by format at a glance.
const TYPE_TONES = {
  Single: 'bg-info/15 text-info',
  EP: 'bg-brand-500/20 text-brand-ink',
  Album: 'bg-success/15 text-success',
}

const PAGE = 60

export default function Catalog() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [filterArtist, setFilterArtist] = useState('')
  const [genre, setGenre] = useState('')
  const [releaseType, setReleaseType] = useState('')
  const [timePreset, setTimePreset] = useState('all')
  const [filterYear, setFilterYear] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // Archived view pulls archived releases across BOTH the catalog and the
  // pipeline — an archived project is usually one that was delayed or never
  // released, so it has no catalog date to be found by.
  const [showArchived, setShowArchived] = useState(false)

  const [visibleCount, setVisibleCount] = useState(PAGE)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [movingId, setMovingId] = useState(null)
  const [confirmMove, setConfirmMove] = useState(null)
  const syncTimer = useRef(null)

  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    try {
      const params = showArchived
        ? { archived: 'true', in_catalog: 'any' }
        : { in_catalog: 'true' }
      if (genre) params.genre = genre
      if (releaseType) params.release_type = releaseType

      const now = new Date()
      if (timePreset === 'this_year') {
        params.date_from = `${now.getFullYear()}-01-01`
        params.date_to = `${now.getFullYear()}-12-31`
      } else if (timePreset === '6mo' || timePreset === '12mo' || timePreset === '24mo') {
        const months = timePreset === '6mo' ? 6 : timePreset === '12mo' ? 12 : 24
        const d = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
        params.date_from = localDateStr(d)
      } else if (timePreset === 'custom') {
        if (customFrom) params.date_from = customFrom
        if (customTo) params.date_to = customTo
      } else if (filterYear) {
        params.month = filterMonth ? `${filterYear}-${filterMonth}` : filterYear
      }

      const { data } = await api.get('/releases', { params })
      setReleases(data.data || [])
      setError('')
    } catch {
      setError('Failed to load catalog')
    } finally { setLoading(false) }
  }, [showArchived, genre, releaseType, timePreset, filterYear, filterMonth, customFrom, customTo])

  useEffect(() => { fetchCatalog(); setVisibleCount(PAGE) }, [fetchCatalog])
  // Client-side filters paginate too — a fresh search must start at page 1,
  // not inside whatever window the last "Load more" left behind.
  useEffect(() => { setVisibleCount(PAGE) }, [search, filterArtist])
  useEffect(() => () => clearTimeout(syncTimer.current), [])

  // Presets and the Year/Month drill are mutually exclusive — both are a date
  // window and applying two would silently intersect them.
  const handlePreset = (preset) => { setTimePreset(preset); setFilterYear(''); setFilterMonth(''); setCustomFrom(''); setCustomTo('') }
  const handleYear = (y) => { setFilterYear(y); setTimePreset('') }
  const handleMonth = (m) => { if (m && !filterYear) setFilterYear(String(new Date().getFullYear())); setFilterMonth(m); setTimePreset('') }
  const clearDates = () => { setFilterYear(''); setFilterMonth(''); setCustomFrom(''); setCustomTo(''); setTimePreset('all') }

  useHotkeys({
    s: () => syncArtwork(),
    ...Object.fromEntries(TIME_PRESETS.map((p, i) => [String(i + 1), () => handlePreset(p.value)])),
  }, [filterYear])

  // Artist suggestions: case-insensitive dedup keeping the most common
  // spelling, so "kaia" and "KAIA" collapse to whichever the data prefers.
  const allArtists = useMemo(() => {
    const map = {}
    releases.forEach(r => {
      if (!r.artist_name) return
      const key = r.artist_name.toLowerCase()
      map[key] = map[key] || {}
      map[key][r.artist_name] = (map[key][r.artist_name] || 0) + 1
    })
    return Object.values(map)
      .map(v => Object.entries(v).sort((a, b) => b[1] - a[1])[0][0])
      .sort((a, b) => a.localeCompare(b))
  }, [releases])

  // Genre/type options come from the fixed vocabulary plus whatever this
  // catalog actually contains — deriving purely from data made phantom options
  // appear from unreleased rows and dropped the canonical spellings.
  const genres = useMemo(() => {
    const set = new Set(GENRE_OPTIONS)
    releases.forEach(r => { if (r.genre) set.add(r.genre) })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [releases])
  const types = useMemo(() => {
    const set = new Set(RELEASE_TYPES)
    releases.forEach(r => { if (r.release_type) set.add(r.release_type) })
    return [...set]
  }, [releases])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    const a = filterArtist.trim().toLowerCase()
    return releases.filter(r => {
      if (a && !(r.artist_name || '').toLowerCase().includes(a)) return false
      if (!s) return true
      return (r.artist_name || '').toLowerCase().includes(s)
        || (r.project_name || '').toLowerCase().includes(s)
        || (r.upc || '').toLowerCase().includes(s)
        || (r.isrc || '').toLowerCase().includes(s)
    })
  }, [releases, search, filterArtist])

  const paginated = filtered.slice(0, visibleCount)
  const hasMore = filtered.length > visibleCount

  const byYear = useMemo(() => {
    const acc = {}
    paginated.forEach(r => {
      const y = r.release_date ? String(r.release_date).slice(0, 4) : 'Undated'
      ;(acc[y] = acc[y] || []).push(r)
    })
    // Numeric years descending; 'Undated' last (it isn't a year, so it can't
    // pretend to a position in the timeline).
    const years = Object.keys(acc).sort((x, y) => {
      if (x === 'Undated') return 1
      if (y === 'Undated') return -1
      return Number(y) - Number(x)
    })
    return years.map(y => [y, acc[y]])
  }, [paginated])

  const availableYears = useMemo(() => {
    const y = new Date().getFullYear()
    return Array.from({ length: 11 }, (_, i) => String(y - i))
  }, [])

  // ── Artwork sync ───────────────────────────────────────────────────────
  // Drives the SERVER's 2-phase batch (`POST /releases/sync-artwork`): phase 1
  // resolves rows with a Spotify URI, phase 2 does a strict artist+title
  // search, and permanent misses get stamped 'not_found' so they are never
  // retried forever. We loop until the server reports nothing remaining, with
  // a no-progress guard and a hard iteration cap so a misbehaving backend
  // can't hang the page.
  const syncArtwork = async () => {
    if (syncing) return
    setSyncing(true)
    setSyncResult(null)
    clearTimeout(syncTimer.current)
    let totalUpdated = 0
    try {
      let lastRemaining = null
      for (let iter = 0; iter < 30; iter++) {
        const { data } = await api.post('/releases/sync-artwork')
        const { updated, remaining, total, disabled } = data.data
        if (disabled) { setSyncResult({ error: 'Spotify is not configured on this server.' }); break }
        totalUpdated += updated
        setSyncResult({ updated: totalUpdated, remaining })
        if (remaining === 0 || total === 0) break
        if (lastRemaining !== null && remaining >= lastRemaining) break
        lastRemaining = remaining
        await new Promise(r => setTimeout(r, 500))
      }
      if (totalUpdated > 0) fetchCatalog()
      syncTimer.current = setTimeout(() => setSyncResult(null), 8000)
    } catch (err) {
      setSyncResult({ error: err.response?.data?.error || 'Sync failed' })
      syncTimer.current = setTimeout(() => setSyncResult(null), 6000)
    } finally { setSyncing(false) }
  }

  const moveBackToPipeline = async (id) => {
    setMovingId(id)
    try {
      await api.put(`/releases/${id}/catalog`)
      setReleases(prev => prev.filter(r => r.id !== id))
      toast('Moved back to the tracker')
    } catch { toast('Failed to update release', 'error') }
    finally { setMovingId(null); setConfirmMove(null) }
  }

  const unarchive = async (id) => {
    setMovingId(id)
    try {
      await api.put(`/releases/${id}/archive`)
      // No longer archived, so it doesn't belong in this view.
      setReleases(prev => prev.filter(r => r.id !== id))
      toast('Unarchived')
    } catch { toast('Failed to unarchive release', 'error') }
    finally { setMovingId(null) }
  }

  const rowFiltersActive = search || filterArtist || genre || releaseType

  return (
    <div>
      <PageHeader
        title={showArchived ? 'Archived Releases' : 'Catalog'}
        subtitle={loading ? '—' : `${filtered.length} ${showArchived ? 'archived ' : ''}release${filtered.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            {syncResult && (
              <span className={`text-xs ${syncResult.error ? 'text-danger' : 'text-ink-muted'}`}>
                {syncResult.error
                  ? syncResult.error
                  : syncResult.updated > 0
                    ? `✓ ${syncResult.updated} artwork${syncResult.updated === 1 ? '' : 's'} synced${syncResult.remaining > 0 ? ` · ${syncResult.remaining} remaining` : ''}`
                    : syncResult.remaining > 0
                      ? `${syncResult.remaining} releases without artwork (no Spotify match found)`
                      : 'All artwork up to date'}
              </span>
            )}
            <button
              onClick={() => setShowArchived(v => !v)}
              title={showArchived ? 'Return to the catalog view' : 'View archived releases (delayed or never-released)'}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors ${
                showArchived ? 'bg-warning/15 border-warning/40 text-warning' : 'bg-card border-rule text-ink-muted hover:bg-gray-50'
              }`}
            >
              <Archive size={13} /> {showArchived ? 'Back to catalog' : 'View archived'}
            </button>
            <button
              onClick={syncArtwork} disabled={syncing} className="btn-secondary"
              title="Fetch cover art from Spotify for the whole catalog (s)"
            >
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync artwork'}
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Row 1 — text + facets */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[200px] max-w-xs flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search artist, title, UPC, ISRC…"
              className="input !pl-9 !pr-8"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"><X size={13} /></button>
            )}
          </div>

          <div className="relative">
            <input
              list="catalog-artists" value={filterArtist} onChange={e => setFilterArtist(e.target.value)}
              placeholder="All artists" className="input !w-auto min-w-[180px] !pr-8"
            />
            <datalist id="catalog-artists">{allArtists.map(a => <option key={a} value={a} />)}</datalist>
            {filterArtist && (
              <button onClick={() => setFilterArtist('')} aria-label="Clear artist filter" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"><X size={13} /></button>
            )}
          </div>

          <select className="input !w-auto" value={genre} onChange={e => setGenre(e.target.value)}>
            <option value="">All genres</option>{genres.map(g => <option key={g}>{g}</option>)}
          </select>
          <select className="input !w-auto" value={releaseType} onChange={e => setReleaseType(e.target.value)}>
            <option value="">All types</option>{types.map(t => <option key={t}>{t}</option>)}
          </select>

          {rowFiltersActive && (
            <button
              onClick={() => { setSearch(''); setFilterArtist(''); setGenre(''); setReleaseType('') }}
              className="btn-secondary !py-2 text-xs"
            >Clear</button>
          )}

          <span className="text-xs text-ink-muted ml-auto">{filtered.length} release{filtered.length === 1 ? '' : 's'}</span>
        </div>

        {/* Row 2 — time window */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
            {TIME_PRESETS.map((p, i) => (
              <button
                key={p.value} onClick={() => handlePreset(p.value)} title={`${p.label} (${i + 1})`}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${timePreset === p.value ? 'bg-card text-ink shadow-sm' : 'text-ink-muted'}`}
              >{p.label}</button>
            ))}
          </div>

          {timePreset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input !w-auto" />
              <span className="text-xs text-ink-muted">to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input !w-auto" />
              {(customFrom || customTo) && (
                <button onClick={clearDates} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><X size={11} /> Clear</button>
              )}
            </div>
          ) : (
            <>
              <div className={`flex items-center px-3 py-2 bg-card border rounded-xl transition-colors ${filterYear ? 'border-brand-400' : 'border-rule'}`}>
                <select value={filterYear} onChange={e => handleYear(e.target.value)} className="text-sm text-ink-muted bg-transparent border-0 outline-none cursor-pointer">
                  <option value="">Year</option>{availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className={`flex items-center px-3 py-2 bg-card border rounded-xl transition-colors ${filterMonth ? 'border-brand-400' : 'border-rule'}`}>
                <select value={filterMonth} onChange={e => handleMonth(e.target.value)} className="text-sm text-ink-muted bg-transparent border-0 outline-none cursor-pointer">
                  <option value="">Month</option>{MONTH_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              {(filterYear || filterMonth) && (
                <button onClick={clearDates} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"><X size={11} /> Clear</button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="card p-6 text-center mb-6">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={fetchCatalog} className="btn-secondary">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton.Block key={i} h="h-64" className="rounded-2xl" />)}
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Disc3 size={40} className="text-ink-faint mb-4" />
          <p className="text-ink font-medium">{showArchived ? 'No archived releases' : 'No releases in the catalog yet'}</p>
          <p className="text-sm text-ink-muted mt-1">
            {showArchived
              ? 'Archive delayed or never-released projects from the Release Tracker or their detail page.'
              : 'Mark releases as “Released” from the Release Tracker to add them here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {byYear.map(([yr, items]) => (
            <div key={yr}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xs font-bold text-ink-muted uppercase tracking-widest">{yr}</h2>
                <div className="flex-1 h-px bg-gray-100" />
                <span className="text-xs text-ink-muted">{items.length} release{items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {items.map(r => (
                  <CatalogCard
                    key={r.id} release={r} busy={movingId === r.id}
                    archivedMode={showArchived}
                    onNavigate={() => navigate(`/releases/${r.id}`, { state: { from: 'catalog' } })}
                    onMoveBack={() => (showArchived ? unarchive(r.id) : setConfirmMove(r))}
                  />
                ))}
              </div>
            </div>
          ))}

          {hasMore ? (
            <div className="text-center py-6">
              <button onClick={() => setVisibleCount(v => v + PAGE)} className="btn-secondary">
                Load more ({filtered.length - visibleCount} remaining)
              </button>
            </div>
          ) : filtered.length > PAGE && (
            <p className="text-center text-xs text-ink-muted py-4">Showing all {filtered.length} releases</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmMove} busy={!!movingId}
        onClose={() => setConfirmMove(null)}
        onConfirm={() => confirmMove && moveBackToPipeline(confirmMove.id)}
        title="Move back to tracker"
        message={confirmMove ? `Move “${confirmMove.project_name}” out of the catalog and back into the active pipeline?` : ''}
        confirmLabel="Move back" variant="primary"
      />
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────
// The WHOLE card is the click target (title and artist were dead space
// before), carrying `state.from = 'catalog'` so the detail page's back link
// returns here instead of dumping you in the tracker.
function CatalogCard({ release: r, busy, archivedMode, onNavigate, onMoveBack }) {
  const [broken, setBroken] = useState(false)
  const spotify = spotifyUrl(r.spotify_uri)
  const showArt = hasArtwork(r) && !broken

  return (
    <div
      role="button" tabIndex={0} onClick={onNavigate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate() } }}
      className="group text-left bg-card rounded-2xl border border-divider overflow-hidden hover:shadow-elevated transition-shadow cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <div className="relative aspect-square bg-gray-100">
        {showArt
          ? <img src={r.cover_art_url} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><Music2 size={32} className="text-ink-faint" /></div>}
        {r.release_type && (
          <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_TONES[r.release_type] || 'bg-gray-100 text-ink-muted'}`}>
            {r.release_type}
          </span>
        )}
        {/* Hover overlay: external links + the move-back action */}
        <div className="absolute inset-0 bg-overlay opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {spotify && (
            <a
              href={spotify} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              title="Open in Spotify" aria-label="Open in Spotify"
              className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"
            ><ExternalLink size={15} /></a>
          )}
          {r.apple_music_link && (
            <a
              href={r.apple_music_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              title="Open in Apple Music" aria-label="Open in Apple Music"
              className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white"
            ><Music2 size={15} /></a>
          )}
          <button
            onClick={e => { e.stopPropagation(); onMoveBack() }} disabled={busy}
            title={archivedMode ? 'Unarchive' : 'Move back to the tracker'}
            aria-label={archivedMode ? 'Unarchive' : 'Move back to the tracker'}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white disabled:opacity-50"
          >
            {busy ? <RefreshCw size={15} className="animate-spin" /> : <RotateCcw size={15} />}
          </button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs font-semibold text-ink truncate">{r.project_name}</p>
        <p className="text-xs text-ink-muted truncate">{r.artist_name || '—'}</p>
        <div className="flex items-center gap-2 text-[10px] text-ink-muted mt-1">
          <span>{formatDate(r.release_date)}</span>
          {r.genre && <><span>·</span><span className="truncate">{r.genre}</span></>}
        </div>
        {(r.upc || r.isrc) && (
          <div className="mt-2 pt-2 border-t border-divider space-y-0.5">
            {r.upc && <p className="text-[10px] font-mono text-ink-muted truncate">UPC {r.upc}</p>}
            {r.isrc && <p className="text-[10px] font-mono text-ink-muted truncate">ISRC {r.isrc}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

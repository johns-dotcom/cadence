import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, X, Plus, Calendar, List, Archive, Bell, ChevronLeft, ChevronRight, GitMerge, Copy } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import useHotkeys from '../hooks/useHotkeys'
import { Badge, Modal } from '../components/ui'
import ReleaseWorkspace, { TAB_IDS } from '../components/ReleaseWorkspace'
import { RELEASE_TYPES, RELEASE_STATUSES, PRIORITIES, GENRE_OPTIONS } from '../constants'
import { formatDate } from '../utils/dates'
import { progressOf, parseLocalDate, countdownOf, priorityToneOf } from '../utils/releases'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const YEARS = (() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3, y - 4, y - 5].map(String) })()
const UPCOMING_OPTIONS = [['Upcoming', 'Upcoming'], ['Past', 'Past'], ['', 'All dates']]

export default function Releases() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)

  const [releases, setReleases] = useState([])
  const [artists, setArtists] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters. `upcoming` defaults to Upcoming so the page opens on the work
  // that's actually ahead of you, soonest first — a release tracker is a
  // countdown, not an archive.
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [genre, setGenre] = useState('')
  const [priority, setPriority] = useState('')
  const [releaseType, setReleaseType] = useState('')
  const [status, setStatus] = useState('')
  const [upcoming, setUpcoming] = useState('Upcoming')
  const [showArchived, setShowArchived] = useState(false)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')

  const [view, setView] = useState('list')
  const [expandedId, setExpandedId] = useState(null)
  const [tabById, setTabById] = useState({})
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState({})   // id → snapshot, for merge
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  // Suppress the full-page skeleton on refetches so a filter change doesn't
  // blank the table (and steal focus) mid-typing.
  const hasLoaded = useRef(false)
  // Generation guard: a filtered request in flight must never clobber a newer
  // search-bypass request (or vice versa) when both change close together.
  const genRef = useRef(0)
  const rowRefs = useRef({})
  const pendingScroll = useRef(null)

  const getTab = (id) => tabById[id] || 'checklist'
  const setTab = (id, tab) => setTabById(prev => ({ ...prev, [id]: tab }))

  const load = useCallback(async (bypassFilters = false) => {
    const myGen = ++genRef.current
    try {
      if (!hasLoaded.current) setLoading(true)
      const params = {}
      if (!bypassFilters) {
        if (year && month) params.month = `${year}-${month}`
        else if (year) params.month = year
        if (genre) params.genre = genre
        if (priority) params.priority = priority
        if (releaseType) params.release_type = releaseType
        if (status) params.status = status
        if (upcoming === 'Upcoming') params.upcoming = true
        else if (upcoming === 'Past') params.upcoming = false
      }
      // The archived toggle is a scope, not a filter — it survives a search.
      if (showArchived) params.archived = 'true'
      const { data } = await api.get('/releases', { params })
      if (myGen !== genRef.current) return
      setReleases(data.data || [])
      setError('')
    } catch {
      if (myGen !== genRef.current) return
      setError('Failed to load releases')
    } finally {
      if (myGen === genRef.current) { setLoading(false); hasLoaded.current = true }
    }
  }, [year, month, genre, priority, releaseType, status, upcoming, showArchived])

  useEffect(() => { load(debounced.length >= 2) }, [load])

  useEffect(() => {
    api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {})
    api.get('/team').then(r => setMembers(r.data.data || [])).catch(() => {})
  }, [])

  // Debounce the box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // A search ≥2 chars bypasses the filters entirely — when you're hunting for
  // one release by ISRC you don't want the Upcoming filter hiding it. Skipped
  // on mount, where the filter effect above has already fetched.
  const searchMounted = useRef(false)
  useEffect(() => {
    if (!searchMounted.current) { searchMounted.current = true; return }
    if (debounced.length >= 2) load(true)
    else if (debounced === '') load(false)
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return releases
    return releases.filter(r =>
      r.project_name?.toLowerCase().includes(s) ||
      r.artist_name?.toLowerCase().includes(s) ||
      r.isrc?.toLowerCase().includes(s) ||
      r.upc?.toLowerCase().includes(s))
  }, [releases, search])

  // Banner: dropping in the next 14 days AND not fully prepped. A release
  // that's already at 100% needs no nagging.
  const notifications = useMemo(
    () => shown.filter(r => { const cd = countdownOf(r.release_date); return cd && cd.days >= 0 && cd.days <= 14 && progressOf(r) < 100 }),
    [shown])

  const applyPatched = useCallback((updated) => {
    setReleases(prev => prev.map(r => (r.id === updated.id ? { ...r, ...updated } : r)))
  }, [])
  const dropRelease = useCallback((id) => {
    setReleases(prev => prev.filter(r => r.id !== id))
    setExpandedId(prev => (prev === id ? null : prev))
  }, [])

  // Jump-to from a banner chip / calendar cell: clear the date filters that
  // could be hiding the row, switch to the list, expand it, and scroll once
  // the refetch settles.
  const jumpTo = (id, tab) => {
    pendingScroll.current = id
    setYear(''); setMonth(''); setUpcoming('')
    setView('list')
    setExpandedId(id)
    if (tab) setTab(id, tab)
  }

  useEffect(() => {
    if (view !== 'list' || loading) return
    const targetId = pendingScroll.current ?? expandedId
    if (!targetId) return
    const el = rowRefs.current[targetId]
    if (el) {
      pendingScroll.current = null
      const t = setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
      return () => clearTimeout(t)
    }
  }, [expandedId, view, loading])

  useHotkeys({
    n: () => setShowAdd(true),
    v: () => setView(v => (v === 'list' ? 'calendar' : 'list')),
    j: () => setFocusedIdx(i => Math.min(i + 1, shown.length - 1)),
    k: () => setFocusedIdx(i => Math.max(i - 1, 0)),
    Enter: () => {
      const r = shown[focusedIdx]
      if (r) setExpandedId(prev => (prev === r.id ? null : r.id))
    },
    ...Object.fromEntries(TAB_IDS.map((t, i) => [String(i + 1), () => { if (expandedId) setTab(expandedId, t) }])),
  }, [shown, focusedIdx, expandedId])

  const toggleSelect = (r) => setSelected(prev => {
    const next = { ...prev }
    if (next[r.id]) delete next[r.id]
    else next[r.id] = { id: r.id, project_name: r.project_name, artist_name: r.artist_name, release_date: r.release_date, upc: r.upc, isrc: r.isrc }
    return next
  })

  const archiveRow = async (r) => {
    try {
      const { data } = await api.put(`/releases/${r.id}/archive`)
      // Archiving while the Archived scope is off means the row no longer
      // belongs on screen — drop it rather than leaving a ghost.
      if (data.data.archived !== showArchived) dropRelease(r.id)
      else applyPatched(data.data)
    } catch { toast('Failed to archive', 'error') }
  }

  const anyFilter = year || month || genre || priority || releaseType || status || upcoming !== 'Upcoming'
  const clearFilters = () => { setYear(''); setMonth(''); setGenre(''); setPriority(''); setReleaseType(''); setStatus(''); setUpcoming('Upcoming') }

  const genres = useMemo(() => {
    const set = new Set(GENRE_OPTIONS)
    releases.forEach(r => { if (r.genre) set.add(r.genre) })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [releases])

  const calendar = useMemo(() => {
    const startDow = new Date(cursor.y, cursor.m, 1).getDay()
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
    const byDay = {}
    shown.forEach(r => {
      const d = parseLocalDate(r.release_date)
      if (d && d.getFullYear() === cursor.y && d.getMonth() === cursor.m) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(r)
    })
    const cells = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let day = 1; day <= daysInMonth; day++) cells.push({ day, items: byDay[day] || [] })
    return cells
  }, [cursor, shown])

  if (loading) return <div className="space-y-6"><Skeleton.PageHeader /><Skeleton.Table rows={8} cols={8} /></div>

  return (
    <div className="space-y-5">
      <PageHeader
        title="Release Tracker"
        subtitle="Manage your release checklist"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
              <button onClick={() => setView('list')} title="List view (v)" className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${view === 'list' ? 'bg-card text-ink shadow-sm' : 'text-ink-muted'}`}><List size={13} /> List</button>
              <button onClick={() => setView('calendar')} title="Calendar view (v)" className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${view === 'calendar' ? 'bg-card text-ink shadow-sm' : 'text-ink-muted'}`}><Calendar size={13} /> Calendar</button>
            </div>
            <Link to="/data-quality" className="btn-secondary" title="Find & merge duplicate releases"><GitMerge size={15} /> Duplicates</Link>
            <button onClick={() => setShowAdd(true)} className="btn-primary" title="Add release (n)"><Plus size={16} /> Add release</button>
          </div>
        }
      />

      <NotificationBanner notifications={notifications} onJumpTo={(id) => jumpTo(id, 'checklist')} />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search artist, project, ISRC, UPC…"
            className="input !pl-9 !pr-8"
          />
          {search && (
            <button onClick={() => setSearch('')} title="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"><X size={14} /></button>
          )}
        </div>
        <div className="flex items-center gap-1.5 bg-card border border-rule rounded-xl px-2 py-1 flex-wrap">
          <FilterSelect value={year} onChange={setYear} label="All years" options={YEARS.map(y => [y, y])} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={month} onChange={setMonth} label="All months" options={MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m])} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={genre} onChange={setGenre} label="Genre" options={genres.map(g => [g, g])} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={priority} onChange={setPriority} label="Priority" options={[['Standard', 'Standard'], ...PRIORITIES.map(p => [p, p])]} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={releaseType} onChange={setReleaseType} label="Type" options={RELEASE_TYPES.map(t => [t, t])} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={status} onChange={setStatus} label="Status" options={RELEASE_STATUSES.map(s => [s, s])} />
          <span className="text-ink-faint">|</span>
          <FilterSelect value={upcoming} onChange={setUpcoming} label="All dates" options={UPCOMING_OPTIONS} allowEmptyLabel />
        </div>
        <button
          onClick={() => setShowArchived(v => !v)}
          title="Show archived (delayed or never-released) projects"
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
            showArchived ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-ink-muted border-rule hover:text-ink'
          }`}
        >
          <Archive size={12} /> Archived
        </button>
        {anyFilter && <button onClick={clearFilters} className="text-xs font-semibold text-ink-muted hover:text-ink px-2">Clear</button>}
      </div>

      {error && (
        <div className="card p-6 text-center">
          <p className="text-sm text-danger mb-3">{error}</p>
          <button onClick={() => load(debounced.length >= 2)} className="btn-secondary">Retry</button>
        </div>
      )}

      {view === 'calendar' ? (
        <CalendarView
          cells={calendar} cursor={cursor} setCursor={setCursor}
          onReleaseClick={(r) => jumpTo(r.id)}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-divider">
            <p className="text-xs text-ink-muted font-medium">{shown.length} release{shown.length === 1 ? '' : 's'}</p>
            {showArchived && <p className="text-xs text-ink-muted">Showing archived</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-divider bg-gray-50">
                  <th className="pl-4 pr-1 py-3 w-8" title="Select for merge"><span className="sr-only">Select</span></th>
                  {['Artist', 'Project', 'Date', 'Format', 'Genre', 'Priority', 'Assigned', 'Completion'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold text-ink-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {shown.length === 0 ? (
                  <tr><td colSpan={9} className="px-5 py-16 text-center text-sm text-ink-muted">
                    {anyFilter || search ? 'No releases match these filters.' : 'No releases yet.'}
                  </td></tr>
                ) : shown.map((r, idx) => (
                  <ReleaseRow
                    key={r.id}
                    release={r} idx={idx}
                    expanded={expandedId === r.id}
                    focused={focusedIdx === idx}
                    selected={!!selected[r.id]}
                    tab={getTab(r.id)}
                    rowRef={el => { rowRefs.current[r.id] = el }}
                    onToggleExpand={() => { setExpandedId(prev => (prev === r.id ? null : r.id)); setFocusedIdx(idx) }}
                    onToggleSelect={() => toggleSelect(r)}
                    onArchive={() => archiveRow(r)}
                    onTabChange={(t) => setTab(r.id, t)}
                    onPatched={applyPatched}
                    onRemoved={dropRelease}
                    artists={artists} members={members}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MergeBar
        selected={selected} isAdmin={isAdmin}
        onClear={() => setSelected({})}
        onMerged={(sourceIds, survivor) => {
          setReleases(prev => prev.filter(x => !sourceIds.includes(x.id)).map(x => (survivor && x.id === survivor.id ? { ...x, ...survivor } : x)))
          setSelected({})
        }}
      />

      <AddReleaseModal
        open={showAdd} onClose={() => setShowAdd(false)} artists={artists}
        onCreated={(rel) => { setReleases(prev => [rel, ...prev]); toast('Release created') }}
      />
    </div>
  )
}

// ── Filter select ────────────────────────────────────────────────────────
// Bare select inside the pipe-separated filter bar. Highlights when set so a
// narrowed list never looks like an empty one.
function FilterSelect({ value, onChange, label, options, allowEmptyLabel = false }) {
  return (
    <select
      value={value} onChange={e => onChange(e.target.value)}
      className={`text-sm bg-transparent border-0 outline-none cursor-pointer py-1 pr-1 ${value ? 'text-brand-ink font-semibold' : 'text-ink-muted'}`}
    >
      {!allowEmptyLabel && <option value="">{label}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{v === '' && allowEmptyLabel ? label : l}</option>)}
    </select>
  )
}

// ── Notification banner ──────────────────────────────────────────────────
function NotificationBanner({ notifications, onJumpTo }) {
  const [collapsed, setCollapsed] = useState(false)
  if (!notifications.length) return null
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/10 px-5 py-3.5">
      <button onClick={() => setCollapsed(v => !v)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2.5">
          <Bell size={13} className="text-warning flex-shrink-0" />
          <p className="text-xs font-semibold text-warning tracking-wide uppercase">
            {notifications.length} release{notifications.length === 1 ? '' : 's'} dropping soon — checklists incomplete
          </p>
        </div>
        <span className="text-xs text-ink-muted flex-shrink-0 ml-2">{collapsed ? 'Show' : 'Hide'}</span>
      </button>
      {!collapsed && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {notifications.map(r => {
            const cd = countdownOf(r.release_date)
            const pct = progressOf(r)
            return (
              <button
                key={r.id} onClick={() => onJumpTo(r.id)}
                className="inline-flex items-center gap-1 text-xs bg-card border border-rule rounded-lg px-2.5 py-1 hover:border-warning transition-colors text-ink"
              >
                {r.project_name}
                <span className="text-ink-faint mx-0.5">·</span>
                <span className={cd?.cls}>{cd?.label}</span>
                <span className="text-ink-faint mx-0.5">·</span>
                <span className="text-warning font-semibold">{pct}%</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Row + inline workspace ───────────────────────────────────────────────
function ReleaseRow({
  release: r, expanded, focused, selected, tab, rowRef, onToggleExpand, onToggleSelect,
  onArchive, onTabChange, onPatched, onRemoved, artists, members,
}) {
  const pct = progressOf(r)
  const tone = priorityToneOf(r)
  return (
    <>
      <tr
        ref={rowRef}
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className={`cursor-pointer transition-colors ${
          expanded ? 'bg-gray-50' : selected ? 'bg-selected' : focused ? 'bg-brand-500/10' : 'hover:bg-gray-50'
        }`}
      >
        <td className="pl-4 pr-1 py-3.5 w-8" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox" checked={selected} onChange={onToggleSelect}
            aria-label={`Select ${r.project_name} to merge`} title="Select to merge with other releases"
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-400 cursor-pointer"
          />
        </td>
        <td className="px-5 py-3.5 text-sm font-semibold text-ink whitespace-nowrap">{r.artist_name || '—'}</td>
        <td className="px-5 py-3.5 text-sm">
          {/* A real anchor so cmd/middle-click opens the detail page in a tab. */}
          <Link to={`/releases/${r.id}`} onClick={e => e.stopPropagation()} className="text-ink-muted hover:text-brand-ink transition-colors">
            {r.project_name}
          </Link>
        </td>
        <td className="px-5 py-3.5 text-sm text-ink-muted whitespace-nowrap">{formatDate(r.release_date)}</td>
        <td className="px-5 py-3.5 text-sm text-ink-muted">{r.release_type || '—'}</td>
        <td className="px-5 py-3.5 text-sm text-ink-muted">{r.genre || '—'}</td>
        <td className="px-5 py-3.5">{tone ? <Badge tone={tone}>{r.priority}</Badge> : <span className="text-ink-faint text-sm">—</span>}</td>
        <td className="px-5 py-3.5">
          {r.assignee_name
            ? <span className="text-xs font-medium text-ink-muted bg-gray-100 px-2 py-1 rounded-full">{r.assignee_name}</span>
            : <span className="text-ink-faint text-xs">—</span>}
        </td>
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-ink-muted tabular-nums w-8">{pct}%</span>
            <button
              onClick={e => { e.stopPropagation(); onArchive() }}
              title={r.archived ? 'Unarchive' : 'Archive (delayed or never-released)'}
              className={`ml-1 p-1 rounded transition-colors ${r.archived ? 'text-warning' : 'text-ink-faint hover:text-warning'}`}
            >
              <Archive size={13} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="p-0">
            <div className="border-t border-divider bg-card">
              <ReleaseWorkspace
                release={r} tab={tab} onTabChange={onTabChange}
                onPatched={onPatched} onRemoved={onRemoved}
                artists={artists} members={members} variant="inline"
              />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Calendar ─────────────────────────────────────────────────────────────
function CalendarView({ cells, cursor, setCursor, onReleaseClick }) {
  const shift = (delta) => setCursor(c => { const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const today = new Date()
  const CHIP = {
    done: 'bg-success/15 text-success',
    high: 'bg-danger/15 text-danger',
    med: 'bg-warning/15 text-warning',
    plain: 'bg-gray-100 text-ink-muted',
  }
  const chipFor = (r) => {
    if (progressOf(r) === 100) return CHIP.done
    const tone = priorityToneOf(r)
    if (tone === 'danger') return CHIP.high
    if (tone === 'warning') return CHIP.med
    return CHIP.plain
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1.5 rounded-lg hover:bg-gray-50 text-ink-muted"><ChevronLeft size={18} /></button>
        <h2 className="text-sm font-semibold text-ink">{MONTHS[cursor.m]} {cursor.y}</h2>
        <button onClick={() => shift(1)} aria-label="Next month" className="p-1.5 rounded-lg hover:bg-gray-50 text-ink-muted"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 border-b border-divider">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-ink-muted uppercase tracking-wider">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`e${i}`} className="min-h-[80px] border-b border-r border-divider bg-gray-50" />
          const isToday = today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === cell.day
          return (
            <div key={cell.day} className={`min-h-[80px] border-b border-r border-divider p-2 ${isToday ? 'bg-brand-500/10' : 'hover:bg-gray-50'}`}>
              <div className={`text-xs font-semibold mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-brand-600 text-white' : 'text-ink-muted'}`}>
                {cell.day}
              </div>
              <div className="space-y-1">
                {cell.items.map(r => (
                  <button
                    key={r.id} onClick={() => onReleaseClick(r)}
                    title={`${r.artist_name || '—'} — ${r.project_name} (${progressOf(r)}%)`}
                    className={`w-full text-left px-1.5 py-1 rounded text-xs font-medium truncate transition-opacity hover:opacity-80 ${chipFor(r)}`}
                  >
                    {r.artist_name ? `${r.artist_name} — ` : ''}{r.project_name}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-5 py-3 border-t border-divider flex items-center gap-4 flex-wrap">
        <span className="text-xs text-ink-muted font-medium">Legend:</span>
        {[['Complete', CHIP.done], ['High priority', CHIP.high], ['Priority', CHIP.med], ['Standard', CHIP.plain]].map(([label, cls]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className={`w-3 h-3 rounded inline-block ${cls}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Merge ────────────────────────────────────────────────────────────────
function MergeBar({ selected, isAdmin, onClear, onMerged }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [targetId, setTargetId] = useState(null)
  const [busy, setBusy] = useState(false)
  const rows = Object.values(selected)
  if (rows.length < 2) return null

  const confirm = async () => {
    if (!targetId) return
    const sourceIds = rows.map(r => r.id).filter(id => id !== targetId)
    if (!sourceIds.length) return
    setBusy(true)
    try {
      const { data } = await api.post('/flags/merge-releases', { target_id: targetId, source_ids: sourceIds })
      onMerged(sourceIds, data.data?.release || null)
      toast(`Merged ${sourceIds.length} release${sourceIds.length === 1 ? '' : 's'}`)
      setOpen(false); setTargetId(null)
    } catch (err) {
      toast(err.response?.data?.error || 'Merge failed', 'error')
    } finally { setBusy(false) }
  }

  return (
    <>
      {!open && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 bg-ink text-page rounded-full shadow-xl px-5 py-2.5 flex items-center gap-3">
          <Copy size={14} />
          <span className="text-sm font-semibold">{rows.length} selected</span>
          <button
            onClick={() => { setTargetId(null); setOpen(true) }}
            disabled={!isAdmin}
            title={isAdmin ? 'Merge the selected releases' : 'Only admins can merge releases'}
            className="text-xs font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-full transition-colors"
          >
            Merge into one…
          </button>
          <button onClick={onClear} className="text-xs opacity-70 hover:opacity-100">Clear</button>
        </div>
      )}

      <Modal
        open={open} onClose={() => !busy && setOpen(false)} size="xl"
        title={`Merge ${rows.length} releases`}
        footer={
          <>
            <button onClick={() => setOpen(false)} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={confirm} disabled={!targetId || busy} className="btn-primary disabled:opacity-40">
              {busy ? 'Merging…' : targetId ? 'Confirm merge' : 'Pick one to keep'}
            </button>
          </>
        }
      >
        <p className="text-xs text-ink-muted mb-4">
          Pick which one to keep. The others are permanently deleted; their metadata fills the survivor’s blanks,
          their completed checklist items carry over, and their comments, budget items, tasks and DSP rows are folded in.
        </p>
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {rows.map(r => (
            <label key={r.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${targetId === r.id ? 'bg-brand-500/15 border-brand-400' : 'border-rule hover:bg-gray-50'}`}>
              <input type="radio" name="merge-target" checked={targetId === r.id} onChange={() => setTargetId(r.id)} className="text-brand-600 focus:ring-brand-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{r.project_name || '—'} <span className="text-xs font-normal text-ink-muted">· {r.artist_name || 'Unassigned'}</span></p>
                <div className="flex items-center gap-2.5 text-[11px] text-ink-muted mt-0.5 flex-wrap">
                  {r.release_date && <span>{formatDate(r.release_date)}</span>}
                  {r.upc && <span className="font-mono">UPC {r.upc}</span>}
                  {r.isrc && <span className="font-mono">ISRC {r.isrc}</span>}
                </div>
              </div>
            </label>
          ))}
        </div>
      </Modal>
    </>
  )
}

// ── Add release ──────────────────────────────────────────────────────────
const BLANK = {
  artist_name: '', project_name: '', release_date: '', release_type: '', genre: '',
  priority: 'Standard', producer: '', featured_artists: '', upc: '', isrc: '', notes: '',
}

function AddReleaseModal({ open, onClose, onCreated, artists }) {
  const { toast } = useToast()
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.project_name.trim()) { toast('Project name is required', 'error'); return }
    if (!form.release_date) { toast('Release date is required', 'error'); return }
    setSaving(true)
    try {
      const { data } = await api.post('/releases', form)
      onCreated(data.data)
      setForm(BLANK)
      onClose()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create release', 'error')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open={open} onClose={onClose} size="xl" title="Add new release"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create release'}</button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Artist</label>
            {/* Free text + datalist: typing a new name creates the artist. */}
            <input className="input" list="add-release-artists" value={form.artist_name} onChange={set('artist_name')} placeholder="Artist or band name" />
            <datalist id="add-release-artists">{artists.map(a => <option key={a.id} value={a.name} />)}</datalist>
          </div>
          <div><label className="label">Project name</label><input className="input" value={form.project_name} onChange={set('project_name')} required placeholder="Album or single title" autoFocus /></div>
          <div><label className="label">Release date</label><input type="date" className="input" value={form.release_date} onChange={set('release_date')} required /></div>
          <div>
            <label className="label">Release type</label>
            <select className="input" value={form.release_type} onChange={set('release_type')}><option value="">Select type</option>{RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          </div>
          <div>
            <label className="label">Genre</label>
            <input className="input" list="add-release-genres" value={form.genre} onChange={set('genre')} placeholder="e.g. Hip-Hop" />
            <datalist id="add-release-genres">{GENRE_OPTIONS.map(g => <option key={g} value={g} />)}</datalist>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={form.priority} onChange={set('priority')}><option value="Standard">Standard</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select>
          </div>
          <div><label className="label">UPC</label><input className="input" value={form.upc} onChange={set('upc')} placeholder="UPC code" /></div>
          <div><label className="label">ISRC</label><input className="input" value={form.isrc} onChange={set('isrc')} placeholder="ISRC code" /></div>
          <div><label className="label">Producer</label><input className="input" value={form.producer} onChange={set('producer')} placeholder="Producer name" /></div>
          <div><label className="label">Featured artists</label><input className="input" value={form.featured_artists} onChange={set('featured_artists')} placeholder="Comma-separated" /></div>
        </div>
        <div><label className="label">Notes</label><textarea rows={2} className="input resize-none" value={form.notes} onChange={set('notes')} placeholder="Internal notes…" /></div>
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, Info, Music, Users, CalendarClock, UserCheck,
  CalendarDays, ChevronRight, Filter, X, DollarSign, CheckSquare, ExternalLink,
  Music2, RefreshCw, TrendingUp, Link2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import ReconciledBadge from '../components/statements/ReconciledBadge'
import Skeleton from '../components/Skeleton'
import { formatDate, isPastLocal, daysUntilLocal, localDateStr } from '../utils/dates'
import useHotkeys from '../hooks/useHotkeys'

// Turn whatever the user stored in `spotify_uri` into a clickable https URL.
// Returns null for anything we can't confidently parse — we'd rather fall
// through to the internal release page than send people to a wrong URL.
function spotifyWebUrl(uri) {
  if (!uri || typeof uri !== 'string') return null
  const s = uri.trim()
  if (!s) return null
  // Already a Spotify URL (http or https, with or without query params).
  if (/^https?:\/\/(open\.|play\.)?spotify\.(com|link|app\.link)\//i.test(s)) {
    return s.replace(/^http:\/\//i, 'https://')
  }
  // Protocol-less URL: "open.spotify.com/album/xyz" — browsers would treat
  // this as a relative path, so we have to prepend https:// ourselves.
  if (/^(open\.|play\.)?spotify\.(com|link)\//i.test(s)) {
    return 'https://' + s
  }
  // spotify:TYPE:ID URI — case-insensitive, extra colon segments ignored.
  const m = s.match(/^spotify:(album|track|episode|show|artist|playlist):([A-Za-z0-9]+)/i)
  if (m) return `https://open.spotify.com/${m[1].toLowerCase()}/${m[2]}`
  // Bare IDs, apple music links pasted into the wrong field, etc. — bail.
  return null
}

function relativeDateLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(String(dateStr).slice(0, 10))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((today - d) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Genre donut palette — brand accent first, then fixed hues.
const GENRE_COLORS = [
  'rgb(var(--color-brand-500))', '#6366F1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EC4899', '#8B5CF6', '#64748B',
]
const LAST_YEAR_FILL = 'rgb(var(--color-gray-300))'

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-rule rounded-lg px-3 py-2 shadow-elevated">
        <p className="text-xs font-medium text-ink-muted mb-1">{label}</p>
        {payload.map((entry, i) => (
          <p key={i} className="text-sm" style={{ color: entry.color }}>
            <span className="font-semibold">{entry.value}</span>
            <span className="text-ink-faint ml-1">{entry.name === 'releases' ? 'this year' : 'last year'}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

const CustomPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

function greeting(name) {
  const h = new Date().getHours()
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return name ? `${g}, ${name.split(' ')[0]}.` : `${g}.`
}

const usd = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(n || 0)

// Severity tint: color-mix keeps the wash theme-aware without a raw *-50 fill.
const severityBg = (sev) => ({
  background: `color-mix(in srgb, var(--color-${sev === 'critical' ? 'danger' : sev === 'warning' ? 'warning' : 'info'}) 7%, transparent)`,
})
const severityBorder = (sev) =>
  sev === 'critical' ? 'border-l-danger' : sev === 'warning' ? 'border-l-warning' : 'border-l-info'
const SeverityIcon = ({ severity }) => {
  if (severity === 'critical') return <AlertCircle className="text-danger" size={15} />
  if (severity === 'warning') return <AlertTriangle className="text-warning" size={15} />
  return <Info className="text-info" size={15} />
}

export default function Dashboard() {
  const { user, label } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Superadmin'
  const [data, setData] = useState(null)
  const [w, setW] = useState(null)
  const [chart, setChart] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [myTasks, setMyTasks] = useState(null)
  const [latestReleases, setLatestReleases] = useState([])
  const [syncingArt, setSyncingArt] = useState(false)
  const [artSyncMsg, setArtSyncMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Chart filters
  const [filterYear, setFilterYear] = useState('')
  const [filterGenre, setFilterGenre] = useState('')
  const [filterFormat, setFilterFormat] = useState('')
  const [chartLoading, setChartLoading] = useState(false)

  // Owner-configured home customization (Settings → Home dashboard).
  const dash = label?.settings?.dashboard || {}
  const vis = (k) => dash.widgets?.[k] !== false // default on
  const pinned = Array.isArray(dash.pinned) ? dash.pinned.filter(p => p && p.label && p.url) : []
  const welcome = label?.settings?.welcome

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]) // re-fetch when the acting user switches

  // Refetch chart data when filters change (skip until the initial load lands)
  useEffect(() => {
    if (!chart) return
    fetchChart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterYear, filterGenre, filterFormat])

  const fetchChart = async () => {
    try {
      setChartLoading(true)
      const params = new URLSearchParams()
      if (filterYear) params.set('year', filterYear)
      if (filterGenre) params.set('genre', filterGenre)
      if (filterFormat) params.set('format', filterFormat)
      const res = await api.get(`/dashboard/chart?${params.toString()}`)
      setChart(res.data.data)
    } catch (err) {
      console.error('Failed to refetch chart:', err)
    } finally {
      setChartLoading(false)
    }
  }

  const fetchData = async () => {
    try {
      // Latest releases — past 14 days (local calendar).
      const from = new Date(); from.setDate(from.getDate() - 14)
      const [dashRes, widgetsRes, chartRes, notifRes, latestRes, tasksRes] = await Promise.all([
        api.get('/dashboard'),
        api.get('/dashboard/widgets'),
        api.get('/dashboard/chart'),
        api.get('/dashboard/notifications').catch(() => ({ data: { data: [] } })),
        api.get(`/releases?archived=false&in_catalog=any&date_from=${localDateStr(from)}`).catch(() => ({ data: { data: [] } })),
        api.get('/tasks').catch(() => null),
      ])

      setData(dashRes.data.data)
      setW(widgetsRes.data.data)
      setChart(chartRes.data.data)
      setNotifications(notifRes.data.data || [])

      // Task buckets computed with LOCAL-calendar helpers so they can never
      // disagree with My Work near midnight for users outside the server TZ.
      const tasks = tasksRes?.data?.data
      if (Array.isArray(tasks)) {
        setMyTasks({
          total: tasks.filter(t => t.status !== 'Done').length,
          overdue: tasks.filter(t => t.status !== 'Done' && isPastLocal(t.due_date)).length,
          dueToday: tasks.filter(t => t.status !== 'Done' && daysUntilLocal(t.due_date) === 0).length,
        })
      }

      // Cap today as the upper bound so future-dated rows don't show up.
      const todayStr = localDateStr()
      const latest = (latestRes.data?.data || [])
        .filter(r => r.release_date && String(r.release_date).slice(0, 10) <= todayStr)
        .sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)))
      setLatestReleases(latest)
      setError('')
    } catch (err) {
      setError('Failed to load dashboard data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSyncLatestArt = async () => {
    setSyncingArt(true)
    setArtSyncMsg('')
    let totalUpdated = 0
    try {
      // First request uses force=true to wipe existing (potentially wrong)
      // covers in the 14-day window so every release gets re-evaluated from
      // scratch — Phase 1 for URI'd rows, strict-match Phase 2 for the rest.
      // Subsequent batches don't force (nothing left to wipe). Hard cap on
      // iterations so a misbehaving backend can never hang the UI.
      let first = true
      let lastRemaining = null
      let disabled = false
      for (let iter = 0; iter < 10; iter++) {
        const res = await api.post('/releases/sync-artwork', { days: 14, force: first })
        first = false
        const { updated, remaining, total } = res.data.data
        disabled = !!res.data.data.disabled
        totalUpdated += updated
        if (remaining === 0 || total === 0) break
        // No-progress guard: if the remaining count isn't dropping, the
        // backend has nothing more it can match — stop rather than spin.
        if (lastRemaining !== null && remaining >= lastRemaining) break
        lastRemaining = remaining
        await new Promise(r => setTimeout(r, 500))
      }
      await fetchData()
      setArtSyncMsg(disabled ? 'Spotify not configured' : totalUpdated > 0 ? `Updated ${totalUpdated}` : 'All up to date')
      setTimeout(() => setArtSyncMsg(''), 5000)
    } catch (err) {
      console.error('sync-artwork failed:', err)
      setArtSyncMsg('Sync failed')
      setTimeout(() => setArtSyncMsg(''), 6000)
    } finally {
      setSyncingArt(false)
    }
  }

  useHotkeys({ r: () => fetchData() })

  const hasActiveFilters = filterGenre || filterFormat
  const clearFilters = () => { setFilterGenre(''); setFilterFormat('') }

  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton.PageHeader />
        <Skeleton.StatCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton.Block h="h-64" className="lg:col-span-2" />
          <Skeleton.Block h="h-64" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-danger">{error}</p>
      </div>
    )
  }

  const chartData = chart?.releasesByMonth || []
  const genreData = w?.genres || []
  const thisWeek = w?.thisWeek || []
  const nextWeek = w?.nextWeek || []
  const selectedYear = chart?.selectedYear || new Date().getFullYear()
  const availableYears = chart?.availableYears || []
  const availableGenres = chart?.availableGenres || []
  const availableFormats = chart?.availableFormats || []
  const pendingApprovals = w?.pendingApprovals || 0
  const bk = w?.bookkeeping
  const showBk = vis('bookkeeping') && w?.isBkAdmin
  // Fall back to the server-side buckets if the tasks fetch failed.
  const mt = myTasks || (w?.myTasks && { total: w.myTasks.open, overdue: w.myTasks.overdue, dueToday: w.myTasks.due_today }) || null

  const statCards = [
    { label: 'Total Artists', value: data?.stats?.artists || 0, icon: Users, color: 'text-info' },
    { label: 'Total Releases', value: data?.stats?.releases || 0, icon: Music, color: 'text-brand-ink' },
    { label: 'Upcoming', value: data?.stats?.upcoming || 0, icon: CalendarClock, color: 'text-warning' },
    { label: 'Team Members', value: data?.stats?.teamMembers || 0, icon: UserCheck, color: 'text-success' },
    { label: 'Open Deals', value: data?.stats?.openDeals || 0, icon: TrendingUp, color: 'text-info' },
  ]

  return (
    <div className="space-y-8">
      {/* Personalized greeting */}
      <div>
        <h1 className="text-3xl font-black text-ink tracking-tight">{greeting(user?.name)}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <p className="text-sm text-ink-faint">Here's what's happening at {label?.name || 'your label'}.</p>
          {/* Books-closed watermark. Self-hiding for anyone who can't see
              statements, so it needs no isAdmin guard here. */}
          <ReconciledBadge />
        </div>
      </div>

      {welcome && (
        <div className="rounded-xl border border-brand-200 bg-brand-500/10 px-4 py-3">
          <p className="text-sm text-ink whitespace-pre-line">{welcome}</p>
        </div>
      )}

      {/* Pinned links */}
      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-ink-faint uppercase tracking-widest inline-flex items-center gap-1"><Link2 size={12} /> Quick links</span>
          {pinned.map((p, i) => {
            const external = /^https?:\/\//.test(p.url)
            const cls = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rule text-ink-muted hover:bg-elev hover:text-ink transition'
            return external
              ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className={cls}>{p.label} <ExternalLink size={11} className="text-ink-faint" /></a>
              : <Link key={i} to={p.url} className={cls}>{p.label}</Link>
          })}
        </div>
      )}

      {/* Action cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* My Tasks */}
        {vis('tasks') && (
          <Link to="/my-work" className="card px-5 py-4 hover:shadow-md transition-all group">
            <div className="flex items-center justify-between mb-2">
              <CheckSquare size={18} className="text-brand-ink" />
              {mt && mt.overdue > 0 && (
                <span className="text-[10px] font-bold bg-danger text-white px-2 py-0.5 rounded-full">{mt.overdue} overdue</span>
              )}
            </div>
            <p className="text-2xl font-bold text-ink">{mt?.total || 0}</p>
            <p className="text-xs text-ink-faint mt-0.5">
              open task{mt?.total !== 1 ? 's' : ''}
              {mt?.dueToday > 0 && <span className="text-warning font-semibold"> · {mt.dueToday} due today</span>}
            </p>
          </Link>
        )}

        {/* Pending Approvals */}
        {isAdmin && (
          <Link to="/approvals" className="card px-5 py-4 hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-2">
              <DollarSign size={18} className="text-warning" />
              {pendingApprovals > 0 && (
                <span className="text-[10px] font-bold bg-warning text-white px-2 py-0.5 rounded-full">{pendingApprovals}</span>
              )}
            </div>
            <p className="text-2xl font-bold text-ink">{pendingApprovals}</p>
            <p className="text-xs text-ink-faint mt-0.5">pending approval{pendingApprovals !== 1 ? 's' : ''}</p>
          </Link>
        )}

        {/* Stats */}
        {statCards.map(({ label: lbl, value, icon: Icon, color }) => (
          <div key={lbl} className="card px-5 py-4 hover:shadow-md transition-all">
            <div className="mb-2">
              <Icon size={18} className={color} strokeWidth={1.5} />
            </div>
            <p className="text-2xl font-bold text-ink">{value}</p>
            <p className="text-xs text-ink-faint mt-0.5">{lbl}</p>
          </div>
        ))}
      </div>

      {/* Latest Releases — past 14 days */}
      {vis('latest_releases') && latestReleases.length > 0 && (
        <div className="card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                <Music2 size={15} className="text-brand-ink" />
                Latest Releases
              </h2>
              <p className="text-[11px] text-ink-faint mt-0.5">Out in the past 14 days</p>
            </div>
            <div className="flex items-center gap-3">
              {artSyncMsg && <span className="text-[11px] text-ink-faint">{artSyncMsg}</span>}
              <button
                onClick={handleSyncLatestArt}
                disabled={syncingArt}
                title="Pull Spotify cover art for the releases in this row"
                className="p-1.5 text-ink-faint hover:text-success rounded-lg hover:bg-elev transition-colors disabled:opacity-40"
              >
                <RefreshCw size={13} className={syncingArt ? 'animate-spin' : ''} />
              </button>
              <Link to="/catalog" className="text-xs text-brand-ink hover:opacity-80 font-medium flex items-center gap-0.5">
                Open Catalog <ChevronRight size={14} />
              </Link>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
            {latestReleases.map(r => {
              // Only honor a real Spotify URL here. Presave links are for
              // pre-release and often dead once a track is out, so we'd rather
              // fall through to the internal release page than send a user to
              // a 404 behind the green Spotify badge.
              const spotifyUrl = spotifyWebUrl(r.spotify_uri)
              const hasArt = r.cover_art_url && r.cover_art_url !== 'not_found'
              const card = (
                <div className="group w-40 flex-shrink-0">
                  <div className="relative aspect-square rounded-lg overflow-hidden bg-elev flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                    {hasArt ? (
                      <img src={r.cover_art_url} alt={`${r.project_name} cover art`}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                        loading="lazy"
                        onError={e => { e.target.style.display = 'none' }} />
                    ) : (
                      <Music2 size={28} className="text-ink-faint" />
                    )}
                    {spotifyUrl && (
                      <div className="absolute bottom-1.5 right-1.5 w-7 h-7 rounded-full bg-[#1DB954] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
                        <ExternalLink size={13} />
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs font-semibold text-ink truncate">{r.project_name || 'Untitled'}</div>
                  <div className="text-[11px] text-ink-muted truncate">{r.artist_name || '—'}</div>
                  <div className="text-[10px] text-ink-faint mt-0.5">{relativeDateLabel(r.release_date)}</div>
                </div>
              )
              return spotifyUrl ? (
                <a key={r.id} href={spotifyUrl} target="_blank" rel="noopener noreferrer" title={`Listen on Spotify — ${r.project_name}`}>
                  {card}
                </a>
              ) : (
                <Link key={r.id} to={`/releases/${r.id}`} title={r.project_name}>
                  {card}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Bookkeeping summary (finance roles) */}
      {showBk && bk && (
        <div className="card">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
              <DollarSign size={15} className="text-success" />
              Bookkeeping
            </h2>
            <Link to="/ledger" className="text-xs text-brand-ink hover:opacity-80 font-medium flex items-center gap-0.5">
              Open Ledger <ChevronRight size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-5 pb-4">
            <div className="bg-elev rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-ink-muted font-medium">Logged MTD</p>
              <p className="text-lg font-bold text-ink mt-0.5">{usd(bk.loggedMtd)}</p>
              <p className="text-[11px] text-ink-faint">{bk.invoiceCount || 0} invoice{bk.invoiceCount !== 1 ? 's' : ''}</p>
            </div>
            <div className="bg-elev rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-ink-muted font-medium">Awaiting Approval</p>
              <Link to="/approvals">
                <p className={`text-lg font-bold mt-0.5 ${bk.awaitingApproval > 0 ? 'text-brand-ink' : 'text-ink'}`}>{bk.awaitingApproval || 0}</p>
              </Link>
              <p className="text-[11px] text-ink-faint">
                {bk.awaitingApproval > 0
                  ? <Link to="/approvals" className="text-brand-ink font-semibold">Review now →</Link>
                  : 'all clear'}
              </p>
            </div>
            <div className="bg-elev rounded-lg px-3 py-2.5">
              <p className="text-[11px] text-ink-muted font-medium">Paid MTD</p>
              <p className="text-lg font-bold text-success mt-0.5">{usd(bk.paidMtd)}</p>
              <p className="text-[11px] text-ink-faint">
                {bk.loggedMtd > 0 ? `${Math.round((bk.paidMtd / bk.loggedMtd) * 100)}% of logged` : '—'}
              </p>
            </div>
          </div>

          {/* Recent invoices mini-list */}
          {bk.recent && bk.recent.length > 0 && (
            <>
              <div className="px-5 pb-1">
                <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Recent</p>
              </div>
              <div className="divide-y divide-divider pb-1">
                {bk.recent.slice(0, 3).map((inv, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{inv.payee}</p>
                      <p className="text-xs text-ink-faint">{formatDate(inv.date)}{inv.category ? ` · ${inv.category}` : ''}</p>
                    </div>
                    <p className="text-sm font-semibold text-brand-ink ml-3 whitespace-nowrap">{usd(inv.amount)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Charts Row */}
      {(vis('releases_chart') || vis('genre_pie')) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Release Pipeline Chart */}
          {vis('releases_chart') && (
            <div className={`card p-5 hover:shadow-md transition-shadow ${vis('genre_pie') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink">Releases per Month — {selectedYear}</h2>
                {chartData.some(d => d.lastYear > 0) && (
                  <div className="flex items-center gap-4 text-xs text-ink-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-brand-500" />
                      {selectedYear}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: LAST_YEAR_FILL }} />
                      {selectedYear - 1}
                    </span>
                  </div>
                )}
              </div>

              {/* Filter Bar */}
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-ink-faint">
                  <Filter size={13} />
                  <span>Filters</span>
                </div>

                <select
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="text-xs border border-rule rounded-md px-2.5 py-1.5 text-ink bg-card focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 cursor-pointer"
                >
                  <option value="">All Years</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                  className="text-xs border border-rule rounded-md px-2.5 py-1.5 text-ink bg-card focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 cursor-pointer"
                >
                  <option value="">All Genres</option>
                  {availableGenres.map(g => <option key={g} value={g}>{g}</option>)}
                </select>

                <select
                  value={filterFormat}
                  onChange={(e) => setFilterFormat(e.target.value)}
                  className="text-xs border border-rule rounded-md px-2.5 py-1.5 text-ink bg-card focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 cursor-pointer"
                >
                  <option value="">All Formats</option>
                  {availableFormats.map(f => <option key={f} value={f}>{f}</option>)}
                </select>

                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-xs text-ink-faint hover:text-ink-muted flex items-center gap-1 ml-1 transition-colors"
                  >
                    <X size={12} />
                    Clear
                  </button>
                )}

                {chartLoading && (
                  <div className="w-3.5 h-3.5 border border-brand-500 border-t-transparent rounded-full animate-spin ml-auto" />
                )}
              </div>

              {chartData.some(d => d.releases > 0 || d.lastYear > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" vertical={false} />
                    <XAxis
                      dataKey="month"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'rgb(var(--color-gray-400))' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'rgb(var(--color-gray-400))' }}
                      allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-bg-elev)' }} />
                    <Bar dataKey="releases" fill="rgb(var(--color-brand-500))" radius={[4, 4, 0, 0]} barSize={24} />
                    {chartData.some(d => d.lastYear > 0) && (
                      <Bar dataKey="lastYear" fill={LAST_YEAR_FILL} radius={[4, 4, 0, 0]} barSize={24} name="lastYear" />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-60 text-ink-faint text-sm">
                  No releases match these filters
                </div>
              )}
            </div>
          )}

          {/* Genre Breakdown */}
          {vis('genre_pie') && (
            <div className={`card p-5 hover:shadow-md transition-shadow ${vis('releases_chart') ? '' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-semibold text-ink mb-4">Releases by Genre</h2>
              {genreData.length > 0 ? (
                <div>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={genreData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        innerRadius={40}
                        dataKey="count"
                        nameKey="genre"
                        labelLine={false}
                        label={CustomPieLabel}
                      >
                        {genreData.map((_, idx) => (
                          <Cell key={idx} fill={GENRE_COLORS[idx % GENRE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [`${value} releases`, name]}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg-card)', color: 'var(--color-text)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
                    {genreData.map((g, idx) => (
                      <div key={g.genre} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: GENRE_COLORS[idx % GENRE_COLORS.length] }} />
                        <span className="text-ink-muted truncate">{g.genre}</span>
                        <span className="text-ink-faint ml-auto tabular-nums">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-ink-faint text-sm">
                  No genre data available
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Second Row: Upcoming + Notifications + Recent activity */}
      {(vis('upcoming') || vis('notifications') || vis('activity')) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* This Week / Next Week */}
          {vis('upcoming') && (
            <div className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
                  <CalendarDays size={16} className="text-ink-faint" />
                  Upcoming Releases
                </h2>
                <Link to="/releases" className="text-xs text-brand-ink hover:opacity-80 font-medium flex items-center gap-0.5">
                  View all <ChevronRight size={14} />
                </Link>
              </div>

              {thisWeek.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-2">This Week</p>
                  <div className="space-y-1.5">
                    {thisWeek.map((r) => (
                      <div key={r.id} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 flex-shrink-0" />
                          <span className="text-sm text-ink font-medium truncate">{r.artist_name || '—'}</span>
                          <span className="text-sm text-ink-faint truncate">— {r.project_name}</span>
                        </div>
                        <span className="text-xs text-ink-faint ml-3 whitespace-nowrap tabular-nums">{formatDate(r.release_date)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {nextWeek.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-2">Next Week</p>
                  <div className="space-y-1.5">
                    {nextWeek.map((r) => (
                      <div key={r.id} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: LAST_YEAR_FILL }} />
                          <span className="text-sm text-ink font-medium truncate">{r.artist_name || '—'}</span>
                          <span className="text-sm text-ink-faint truncate">— {r.project_name}</span>
                        </div>
                        <span className="text-xs text-ink-faint ml-3 whitespace-nowrap tabular-nums">{formatDate(r.release_date)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {thisWeek.length === 0 && nextWeek.length === 0 && (
                <p className="text-sm text-ink-faint py-6 text-center">No releases in the next two weeks</p>
              )}
            </div>
          )}

          {/* Notifications */}
          {vis('notifications') && (
            <div className="card p-5 hover:shadow-md transition-shadow flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-ink">Notifications</h2>
                {notifications.length > 0 && (
                  <button
                    onClick={() => setNotifications([])}
                    className="text-[10px] font-semibold text-ink-faint hover:text-ink-muted transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto max-h-80">
                {notifications.length === 0 ? (
                  <p className="text-sm text-ink-faint py-6 text-center">All clear — no alerts</p>
                ) : (
                  notifications.map((notif, idx) => (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-lg border-l-2 ${severityBorder(notif.severity)} flex gap-2.5 items-start`}
                      style={severityBg(notif.severity)}
                    >
                      <div className="flex-shrink-0 mt-0.5"><SeverityIcon severity={notif.severity} /></div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink">{notif.type}</p>
                        {notif.releaseId ? (
                          <Link to={`/releases/${notif.releaseId}`} className="text-xs text-ink-muted mt-0.5 leading-relaxed hover:underline block">{notif.message}</Link>
                        ) : (
                          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{notif.message}</p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Recent activity */}
          {vis('activity') && (
            <div className={`card p-5 hover:shadow-md transition-shadow ${vis('upcoming') && vis('notifications') ? '' : (vis('upcoming') || vis('notifications')) ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-semibold text-ink mb-4">Recent activity</h2>
              {data?.recentActivity?.length ? (
                <ul className="divide-y divide-divider">
                  {data.recentActivity.map(a => (
                    <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                      <p className="text-sm text-ink truncate min-w-0"><span className="font-medium">{a.user_name || 'Someone'}</span> <span className="text-ink-muted">{a.action}</span>{a.detail && <span className="text-ink-faint"> — {a.detail}</span>}</p>
                      <span className="text-xs text-ink-faint flex-shrink-0">{new Date(a.created_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-faint py-6 text-center">No activity yet.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

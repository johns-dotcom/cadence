import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Disc3, TrendingUp, ArrowRight, LogIn, Ban, Users, Music,
  CalendarClock, DollarSign, CheckSquare, AlertCircle, Search, RefreshCw,
  CalendarDays, ShieldAlert, Clock, ChevronRight,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import useHotkeys from '../hooks/useHotkeys'
import { formatDate } from '../utils/dates'
import { useTheme } from '../context/ThemeContext'
import { resolveColors, tagMap } from '../utils/workspaceColor'

// The operator's dashboard. Same vocabulary as a workspace dashboard — stat
// cards, a bookkeeping band, activity — but every figure spans every workspace
// the operator can see, and the grid underneath breaks it back down per tenant.

const fmtAgo = (d) => {
  if (!d) return 'never'
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`
  return formatDate(d)
}
const num = (n) => Number(n || 0).toLocaleString()
// Whole dollars above $1k: the operator band is a scale reading, and cents on a
// six-figure roll-up are noise that costs column width.
const usd = (n) => {
  const v = Number(n || 0)
  return v >= 1000 || v <= -1000
    ? `$${Math.round(v).toLocaleString()}`
    : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// The operator's own sign-ins / workspace entries are self-noise on an
// at-a-glance page — filtered here, still present on the full /activity feed.
const NOISE = /signed in|workspace entered/i

const SEVERITY = {
  danger: { icon: ShieldAlert, cls: 'text-danger' },
  warning: { icon: AlertCircle, cls: 'text-warning' },
  info: { icon: Clock, cls: 'text-info' },
}

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'pending', label: 'Awaiting approval' },
  { key: 'logged_mtd', label: 'Logged this month' },
  { key: 'upcoming', label: 'Upcoming releases' },
  { key: 'members', label: 'Members' },
  { key: 'last_active', label: 'Last active' },
]

function StatCard({ icon: Icon, value, label, tone = 'text-ink-muted', to, onClick }) {
  const body = (
    <>
      <Icon size={17} className={tone} strokeWidth={1.8} />
      <p className="text-2xl font-bold text-ink mt-2.5 leading-none">{value}</p>
      <p className="text-[11px] text-ink-muted mt-1.5">{label}</p>
    </>
  )
  const cls = 'card p-4 text-left w-full'
  if (to) return <Link to={to} className={`${cls} block hover:border-brand-300 transition-colors`}>{body}</Link>
  if (onClick) return <button onClick={onClick} className={`${cls} hover:border-brand-300 transition-colors`}>{body}</button>
  return <div className={cls}>{body}</div>
}

export default function PlatformOverview() {
  const { toast } = useToast()
  const { user, enterWorkspace } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('name')

  const load = (silent = false) => {
    silent ? setRefreshing(true) : setLoading(true)
    api.get('/platform/overview')
      .then(r => { setData(r.data.data); setError(null) })
      .catch(() => setError('Could not load the platform overview'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }
  useEffect(() => { load() }, [])
  useHotkeys({ r: () => load(true) }, [])

  const enter = async (id, then) => {
    const result = await enterWorkspace(id)
    if (result.success) navigate(then || '/')
    else toast(result.error || 'Could not enter workspace', 'error')
  }

  const t = data?.totals || {}
  const all = data?.workspaces || []
  const activity = (data?.recentActivity || []).filter(a => !NOISE.test(a.action || '')).slice(0, 8)
  const wsName = useMemo(() => new Map(all.map(w => [Number(w.id), w.name])), [all])
  // The same colour + tag pairing the calendar uses, from the same source,
  // so a workspace is recognisable across both console pages.
  const tags = useMemo(() => tagMap(all), [all])
  // Same resolution the calendar uses — brand accent by default, an operator
  // override when set, a validated palette slot otherwise — so a workspace is
  // the same colour on both console pages.
  const { theme } = useTheme()
  const resolved = useMemo(() => resolveColors(all, theme), [all, theme])
  const colorOf = (id) => resolved.get(Number(id))?.color || '#888888'

  // Search + sort run over the SAME array the header counts reduce over, so a
  // filtered grid never sits under a total that describes a different set —
  // the filtered count is stated separately instead.
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle
      ? all.filter(w => `${w.name} ${w.slug || ''}`.toLowerCase().includes(needle))
      : [...all]
    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'last_active') {
        const at = a.last_active ? new Date(a.last_active).getTime() : 0
        const bt = b.last_active ? new Date(b.last_active).getTime() : 0
        return bt - at || a.name.localeCompare(b.name)
      }
      return (Number(b[sort]) || 0) - (Number(a[sort]) || 0) || a.name.localeCompare(b.name)
    })
    return list
  }, [all, q, sort])

  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  if (error && !data) {
    return (
      <div className="card p-10 text-center">
        <AlertCircle size={28} className="text-danger mx-auto mb-3" />
        <p className="text-sm text-danger mb-3">{error}</p>
        <button onClick={() => load()} className="btn-secondary">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero band — platform scale, and the two ways out of this page. */}
      <div className="rounded-2xl p-6 sm:p-7 text-white relative overflow-hidden" style={{ background: 'linear-gradient(120deg,#0f172a 0%, #1e1b4b 55%, rgb(var(--color-brand-700)) 130%)' }}>
        <div className="absolute -right-8 -top-10 opacity-10"><Disc3 size={180} /></div>
        <div className="relative">
          <p className="text-sm text-white/70">Welcome back, {user?.name?.split(' ')[0] || 'operator'}</p>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mt-3">
            <div>
              <p className="text-4xl font-bold leading-none">{loading ? '—' : num(t.active)}</p>
              <p className="text-xs text-white/60 mt-1.5">Active workspaces</p>
            </div>
            <div className="h-9 w-px bg-white/15 hidden sm:block" />
            <div><p className="text-2xl font-semibold leading-none">{loading ? '—' : num(t.members)}</p><p className="text-xs text-white/60 mt-1.5">Members</p></div>
            <div className="flex items-center gap-2">
              {t.new_30d > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/10 rounded-full px-2.5 py-1"><TrendingUp size={12} /> +{t.new_30d} this month</span>
              )}
              {t.suspended > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-white/10 rounded-full px-2.5 py-1"><Ban size={12} /> {t.suspended} suspended</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-5">
            <Link to="/workspaces" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white text-gray-900 px-3.5 py-2 rounded-lg hover:bg-white/90 transition"><Building2 size={15} /> Manage workspaces</Link>
            <Link to="/calendar" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 text-white px-3.5 py-2 rounded-lg hover:bg-white/20 transition"><CalendarDays size={15} /> Calendar</Link>
            <button onClick={() => load(true)} title="Refresh (r)" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-white/10 text-white px-3 py-2 rounded-lg hover:bg-white/20 transition">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          {data?.scoped && (
            <p className="text-[11px] text-white/60 mt-3">
              Showing the {num(t.workspaces)} workspace{t.workspaces === 1 ? '' : 's'} you have access to — not the whole platform.
            </p>
          )}
        </div>
      </div>

      {/* Platform-wide counts. Every figure here is the sum of the grid below. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {loading ? <div className="col-span-full"><Skeleton.StatCards count={6} /></div> : (
          <>
            <StatCard icon={Users} value={num(t.artists)} label="Artists" tone="text-info" />
            <StatCard icon={Music} value={num(t.releases)} label="Releases" tone="text-brand-ink" />
            <StatCard icon={CalendarClock} value={num(t.upcoming)} label="Upcoming" tone="text-warning" to="/calendar" />
            <StatCard icon={TrendingUp} value={num(t.open_deals)} label="Open deals" tone="text-success" />
            <StatCard icon={DollarSign} value={num(t.pending)} label="Awaiting approval" tone={t.pending ? 'text-warning' : 'text-ink-muted'} />
            <StatCard icon={CheckSquare} value={num(t.open_tasks)} label="Open tasks" tone={t.overdue_tasks ? 'text-danger' : 'text-ink-muted'} />
          </>
        )}
      </div>

      {/* Money band — the cross-tenant equivalent of the workspace Bookkeeping
          widget. Amounts are USD equivalents, and the page says so: a tenant
          billing in EUR is converted at its own locked rate, never 1:1. */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-success" />
            <h2 className="text-sm font-bold text-ink">Bookkeeping</h2>
            <span className="text-[11px] text-ink-faint">· all workspaces · {monthLabel}</span>
          </div>
          <Link to="/workspaces" className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1">Workspaces <ChevronRight size={12} /></Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-elev rounded-xl p-4">
            <p className="text-[11px] text-ink-muted">Logged MTD</p>
            <p className="text-2xl font-bold text-ink mt-1 leading-none">{loading ? '—' : usd(t.logged_mtd)}</p>
            <p className="text-[11px] text-ink-faint mt-1.5">{num(t.invoices_mtd)} invoice{t.invoices_mtd === 1 ? '' : 's'}</p>
          </div>
          <div className="bg-elev rounded-xl p-4">
            <p className="text-[11px] text-ink-muted">Paid MTD</p>
            <p className="text-2xl font-bold text-success mt-1 leading-none">{loading ? '—' : usd(t.paid_mtd)}</p>
            <p className="text-[11px] text-ink-faint mt-1.5">
              {t.logged_mtd > 0 ? `${Math.round((t.paid_mtd / t.logged_mtd) * 100)}% of logged` : '—'}
            </p>
          </div>
          <div className="bg-elev rounded-xl p-4">
            <p className="text-[11px] text-ink-muted">Awaiting approval</p>
            <p className={`text-2xl font-bold mt-1 leading-none ${t.pending ? 'text-warning' : 'text-ink'}`}>{loading ? '—' : num(t.pending)}</p>
            <p className="text-[11px] text-ink-faint mt-1.5">{t.pending ? `${usd(t.pending_usd)} outstanding` : 'all clear'}</p>
          </div>
        </div>
        <p className="text-[10px] text-ink-faint mt-3">
          USD equivalents. A stamped FX rate on an invoice always wins; unstamped foreign rows convert at the rate as of their own date.
          Approvals are the full queue, not just this month.
        </p>
      </div>

      {/* Per-workspace grid — the same dashboard, one card per tenant. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-bold text-ink">
            Workspaces
            {!loading && <span className="text-ink-faint font-normal ml-2">{q ? `${shown.length} of ${all.length}` : num(all.length)}</span>}
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={q} onChange={e => setQ(e.target.value)} placeholder="Find a workspace…"
                className="input !py-1.5 !pl-8 text-xs w-44 sm:w-56"
              />
            </div>
            <select value={sort} onChange={e => setSort(e.target.value)} className="input !py-1.5 text-xs !w-auto">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map(i => <Skeleton.Block key={i} h="h-44" />)}
          </div>
        ) : !shown.length ? (
          <div className="card p-8 text-center">
            <Building2 size={26} className="text-ink-faint mx-auto mb-2" />
            <p className="text-sm text-ink-muted">{q ? `No workspace matches “${q}”.` : 'No workspaces yet.'}</p>
            {q
              ? <button onClick={() => setQ('')} className="text-xs font-semibold text-brand-ink mt-2">Clear search</button>
              : <Link to="/workspaces" className="text-xs font-semibold text-brand-ink mt-2 inline-block">Create one →</Link>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shown.map(w => {
              const color = colorOf(w.id)
              const suspended = w.status === 'suspended'
              return (
                <div key={w.id} className="card p-0 overflow-hidden group hover:border-brand-300 transition-colors flex">
                  {/* The identity rail — the same colour this workspace wears
                      on every chip of the calendar. */}
                  <span className="w-2 flex-shrink-0" style={{ background: color }} aria-hidden="true" />
                  <div className="flex-1 min-w-0 p-4">
                    <div className="flex items-center gap-2.5">
                      {/* Neutral, so the card spends its colour in ONE place —
                          the full-height rail. White-on-slot was not an option
                          anyway: three of the eight light slots sit under 3:1,
                          so white text on them is unreadable. */}
                      <div className="w-9 h-9 rounded-lg bg-elev flex items-center justify-center flex-shrink-0">
                        <span className="text-ink font-bold text-[11px] tracking-wide">{tags.get(w.id)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{w.name}</p>
                        <p className="text-[11px] text-ink-faint truncate">
                          {num(w.members)} member{w.members === 1 ? '' : 's'} · active {fmtAgo(w.last_active)}
                        </p>
                      </div>
                      {suspended && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/15 text-danger">Suspended</span>}
                    </div>

                    <div className="grid grid-cols-4 gap-1 mt-3.5 text-center">
                      {[
                        { v: w.artists, l: 'Artists' },
                        { v: w.releases, l: 'Releases' },
                        { v: w.upcoming, l: 'Upcoming', tone: w.upcoming ? 'text-warning' : '' },
                        { v: w.open_deals, l: 'Deals' },
                      ].map(c => (
                        <div key={c.l} className="bg-elev rounded-lg py-1.5">
                          <p className={`text-sm font-bold leading-none ${c.tone || 'text-ink'}`}>{num(c.v)}</p>
                          <p className="text-[10px] text-ink-faint mt-1">{c.l}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-divider">
                      <div className="min-w-0">
                        <p className="text-[10px] text-ink-faint">Logged this month</p>
                        <p className="text-sm font-bold text-ink leading-tight">
                          {usd(w.logged_mtd)}
                          {w.paid_mtd > 0 && <span className="text-[11px] font-medium text-success ml-1.5">{usd(w.paid_mtd)} paid</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {w.pending > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">
                            {w.pending} to approve
                          </span>
                        )}
                        {w.overdue_tasks > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-danger/15 text-danger">
                            {w.overdue_tasks} overdue
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      <button onClick={() => enter(w.id)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:underline">
                        <LogIn size={12} /> Enter workspace
                      </button>
                      <Link to={`/workspaces?open=${w.id}`} className="text-xs font-semibold text-ink-muted hover:text-ink">Manage</Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Three rails: what needs doing, what is coming, what just happened. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div>
          <h2 className="text-sm font-bold text-ink mb-3">Needs attention</h2>
          <div className="card divide-y divide-divider">
            {loading ? <div className="p-4"><Skeleton.TaskList count={4} /></div> : (data?.attention || []).slice(0, 8).map((a, i) => {
              const S = SEVERITY[a.severity] || SEVERITY.info
              const Icon = S.icon
              return (
                <button key={i} onClick={() => enter(a.label_id)} className="w-full text-left px-4 py-2.5 hover:bg-elev transition-colors flex items-start gap-2.5">
                  <Icon size={14} className={`${S.cls} mt-0.5 flex-shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-sm text-ink leading-snug">{a.text}</p>
                    <p className="text-[11px] text-ink-faint truncate">{a.workspace}</p>
                  </div>
                </button>
              )
            })}
            {!loading && !data?.attention?.length && (
              <div className="px-4 py-8 text-center"><p className="text-sm text-ink-muted">Everything looks healthy. 🎉</p></div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Upcoming releases</h2>
            <Link to="/calendar" className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1">Calendar <ArrowRight size={12} /></Link>
          </div>
          <div className="card divide-y divide-divider">
            {loading ? <div className="p-4"><Skeleton.TaskList count={4} /></div> : (data?.upcomingReleases || []).slice(0, 8).map(r => (
              <button key={r.id} onClick={() => enter(r.label_id, `/releases/${r.id}`)} className="w-full text-left px-4 py-2.5 hover:bg-elev transition-colors flex items-center gap-2.5">
                <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: colorOf(r.label_id) }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{r.project_name}</p>
                  <p className="text-[11px] text-ink-faint truncate">
                    <span className="font-bold text-ink-muted">{tags.get(Number(r.label_id))}</span>
                    {' '}{[wsName.get(Number(r.label_id)), r.artist_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-ink-muted flex-shrink-0">{formatDate(r.release_date)}</span>
              </button>
            ))}
            {!loading && !data?.upcomingReleases?.length && (
              <div className="px-4 py-8 text-center"><p className="text-sm text-ink-muted">Nothing scheduled in the next 45 days.</p></div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Recent activity</h2>
            <Link to="/activity" className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1">All <ArrowRight size={12} /></Link>
          </div>
          <div className="card divide-y divide-divider">
            {loading ? <div className="p-4"><Skeleton.TaskList count={6} /></div> : activity.map((a, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-2.5">
                <span className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: colorOf(a.label_id) }} />
                <div className="min-w-0">
                  <p className="text-sm text-ink leading-snug">{a.action}{a.detail ? <span className="text-ink-faint"> — {a.detail}</span> : ''}</p>
                  <p className="text-[11px] text-ink-faint truncate">
                    <span className="font-bold text-ink-muted">{tags.get(Number(a.label_id))}</span>{' '}
                    <span className="font-medium text-ink-muted">{a.workspace}</span> · {a.user_name || 'System'} · {fmtAgo(a.created_at)}
                  </p>
                </div>
              </div>
            ))}
            {!loading && !activity.length && (
              <div className="px-4 py-8 text-center"><p className="text-sm text-ink-muted">Nothing notable yet.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

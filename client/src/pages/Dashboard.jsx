import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, Music, CalendarClock, TrendingUp, Briefcase, CheckSquare, BookOpen, Disc3, ExternalLink, Link2 } from 'lucide-react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import { useAuth } from '../context/AuthContext'
import api from '../api'
import PageHeader from '../components/PageHeader'
import ReconciledBadge from '../components/statements/ReconciledBadge'
import Skeleton from '../components/Skeleton'
import { formatDate } from '../utils/dates'

const STAT_CARDS = [
  { key: 'artists', label: 'Artists', icon: Users },
  { key: 'releases', label: 'Releases', icon: Music },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { key: 'openDeals', label: 'Open deals', icon: TrendingUp },
  { key: 'myTasks', label: 'My open tasks', icon: Briefcase },
]
const PIE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#a3a3a3']
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

export default function Dashboard() {
  const { user, label } = useAuth()
  const [data, setData] = useState(null)
  const [w, setW] = useState(null)
  const [loading, setLoading] = useState(true)

  // Owner-configured home customization (Settings → Home dashboard).
  const dash = label?.settings?.dashboard || {}
  const vis = (k) => dash.widgets?.[k] !== false // default on
  const pinned = Array.isArray(dash.pinned) ? dash.pinned.filter(p => p && p.label && p.url) : []
  const welcome = label?.settings?.welcome

  useEffect(() => {
    Promise.all([
      api.get('/dashboard').then(r => setData(r.data.data)).catch(() => {}),
      api.get('/dashboard/widgets').then(r => setW(r.data.data)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const showBk = vis('bookkeeping') && w?.isBkAdmin
  const chartsRow = vis('releases_chart') || vis('genre_pie')
  const bottomRow = vis('upcoming') || vis('activity')

  return (
    <div>
      <div className="mb-2"><ReconciledBadge /></div>
      <PageHeader title={`Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}`} subtitle={label?.name ? `${label.name} · label operations` : 'Label operations'} />

      {welcome && (
        <div className="rounded-xl border border-brand-200 bg-brand-500/10/50 px-4 py-3 mb-6">
          <p className="text-sm text-brand-900 whitespace-pre-line">{welcome}</p>
        </div>
      )}

      {/* Pinned links */}
      {pinned.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest inline-flex items-center gap-1"><Link2 size={12} /> Quick links</span>
          {pinned.map((p, i) => {
            const external = /^https?:\/\//.test(p.url)
            const cls = 'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-rule text-gray-600 hover:bg-gray-50 hover:text-ink transition'
            return external
              ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className={cls}>{p.label} <ExternalLink size={11} className="text-gray-400" /></a>
              : <Link key={i} to={p.url} className={cls}>{p.label}</Link>
          })}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="card p-5">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p><Icon size={16} className="text-gray-400" /></div>
            <p className="text-3xl font-bold text-ink mt-2">{loading ? '—' : (data?.stats?.[key] ?? 0)}</p>
          </div>
        ))}
      </div>

      {/* Task summary + bookkeeping widget */}
      {(vis('tasks') || showBk) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {vis('tasks') && (
            <div className="card p-5">
              <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><CheckSquare size={15} /> My tasks</h2>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Open', w?.myTasks?.open, 'text-ink'], ['Due today', w?.myTasks?.due_today, 'text-amber-600'], ['Overdue', w?.myTasks?.overdue, 'text-red-600']].map(([lbl, v, cls]) => (
                  <Link key={lbl} to="/my-work" className="rounded-lg bg-page/50 py-3 hover:bg-gray-100"><p className={`text-2xl font-bold ${cls}`}>{loading ? '—' : (v ?? 0)}</p><p className="text-[11px] text-gray-400">{lbl}</p></Link>
                ))}
              </div>
            </div>
          )}

          {showBk && (
            <div className={`card p-5 ${vis('tasks') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><BookOpen size={15} /> Bookkeeping</h2>
                {w.pendingApprovals > 0 && <Link to="/approvals" className="text-xs font-semibold text-brand-600 hover:underline">{w.pendingApprovals} awaiting approval →</Link>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-page/50 p-3"><p className="text-[11px] text-gray-400">Logged (MTD)</p><p className="text-xl font-bold text-ink">{money(w.bookkeeping?.loggedMtd)}</p></div>
                <div className="rounded-lg bg-page/50 p-3"><p className="text-[11px] text-gray-400">Paid (MTD)</p><p className="text-xl font-bold text-emerald-600">{money(w.bookkeeping?.paidMtd)}</p></div>
                <Link to="/approvals" className="rounded-lg bg-page/50 p-3 hover:bg-gray-100 block"><p className="text-[11px] text-gray-400">Awaiting approval</p><p className="text-xl font-bold text-amber-600">{w.bookkeeping?.awaitingApproval ?? 0}</p></Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Releases chart + genre pie */}
      {chartsRow && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {vis('releases_chart') && (
            <div className={`card p-5 ${vis('genre_pie') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-bold text-ink mb-3">Releases by month</h2>
              {loading ? <Skeleton.Block h="h-40" /> : (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={w?.releasesByMonth || []}><XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} /><Tooltip /><Bar dataKey="count" fill="rgb(var(--color-brand-500))" radius={[3, 3, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
          {vis('genre_pie') && (
            <div className={`card p-5 ${vis('releases_chart') ? '' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-bold text-ink mb-3">Genre mix</h2>
              {(w?.genres || []).length ? (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={w.genres} dataKey="count" nameKey="genre" innerRadius={36} outerRadius={70} paddingAngle={2}>{w.genres.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip /></PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-sm text-gray-400">No releases yet.</p>}
            </div>
          )}
        </div>
      )}

      {/* Upcoming releases + recent activity */}
      {bottomRow && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {vis('upcoming') && (
            <div className="card p-5">
              <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><CalendarClock size={15} /> Upcoming (3 wks)</h2>
              {w?.upcomingReleases?.length ? (
                <div className="space-y-2">
                  {w.upcomingReleases.map(r => (
                    <Link key={r.id} to={`/releases/${r.id}`} className="flex items-center gap-2.5 hover:bg-gray-50 rounded-lg p-1 -m-1">
                      {r.cover_art_url ? <img src={r.cover_art_url} alt="" className="w-9 h-9 rounded object-cover bg-gray-100" /> : <div className="w-9 h-9 rounded bg-gray-100 flex items-center justify-center"><Disc3 size={16} className="text-gray-300" /></div>}
                      <div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink truncate">{r.project_name}</p><p className="text-[11px] text-gray-400 truncate">{r.artist_name || '—'}</p></div>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{formatDate(r.release_date)}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">Nothing in the next three weeks.</p>}
            </div>
          )}

          {vis('activity') && (
            <div className={`card p-5 ${vis('upcoming') ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <h2 className="text-sm font-bold text-ink mb-3">Recent activity</h2>
              {loading ? <Skeleton.TaskList count={5} /> : data?.recentActivity?.length ? (
                <ul className="divide-y divide-divider">
                  {data.recentActivity.map(a => (
                    <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
                      <p className="text-sm text-ink truncate min-w-0"><span className="font-medium">{a.user_name || 'Someone'}</span> <span className="text-gray-500">{a.action}</span>{a.detail && <span className="text-gray-400"> — {a.detail}</span>}</p>
                      <span className="text-xs text-gray-400 flex-shrink-0">{new Date(a.created_at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-400">No activity yet.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

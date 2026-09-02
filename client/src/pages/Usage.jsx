import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Eye, LogIn, MousePointerClick, Users } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { PAGE_LABELS } from '../components/Layout'
import { formatDate } from '../utils/dates'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

// Paths the nav map doesn't carry (detail routes, and pages that no longer
// exist). Keeping a removed page's label means the views it accumulated while
// it was alive still read as a name instead of a bare path.
const EXTRA_LABELS = {
  '/': 'Dashboard',
  '/releases/:id': 'Release Detail',
  '/artists/:id': 'Artist Profile',
  '/team/:id': 'Team Member',
  '/artist-budgets/:id': 'Artist Budget Sheet',
  '/bank-statements/:id': 'Bank Statement',
  '/recoupments/artist/:id': 'Recoupment (artist)',
  '/messages/:id': 'Messages',
  '/create-nda/:id': 'Create NDA',
  '/usage': 'Usage',
  '/settings': 'Settings',
  '/team': 'Team',
  '/activity': 'Activity History',
  '/requests': 'Requests & feedback',
  '/messages': 'Messages',
}

function pageLabel(path) {
  const direct = PAGE_LABELS[path] || EXTRA_LABELS[path]
  if (direct) return direct
  // Fall back to naming the family: /artist-campaigns/:id → "Artist Campaigns — subpage"
  const known = { ...PAGE_LABELS, ...EXTRA_LABELS }
  const base = Object.keys(known)
    .filter(k => k !== '/' && path.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0]
  return base ? `${known[base]} — subpage` : path
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="card px-4 py-4">
      <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-ink-muted mb-1.5">
        <Icon size={12} /> {label}
      </div>
      <div className="text-2xl font-black text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-faint mt-0.5">{sub}</div>}
    </div>
  )
}

export default function Usage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.get('/analytics/summary', { params: { days } })
      .then(r => { if (!cancelled) setData(r.data?.data || null) })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || 'Failed to load usage') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  // One row per person: views + active days + logins + actions merged by name.
  const userRows = useMemo(() => {
    if (!data) return []
    const map = new Map()
    const get = (name) => {
      if (!map.has(name)) map.set(name, { name, views: 0, active_days: 0, logins: 0, actions: 0, last_seen: null })
      return map.get(name)
    }
    for (const u of data.topUsers || []) Object.assign(get(u.name), { views: u.views, active_days: u.active_days, last_seen: u.last_seen })
    for (const l of data.logins || []) { const r = get(l.name); r.logins = l.logins; if (!r.last_seen) r.last_seen = l.last_login }
    for (const a of data.actions || []) get(a.name).actions = a.actions
    return [...map.values()].sort((x, y) => y.views - x.views || y.logins - x.logins)
  }, [data])

  const totalLogins = useMemo(() => (data?.logins || []).reduce((s, l) => s + l.logins, 0), [data])
  const totalActions = useMemo(() => (data?.actions || []).reduce((s, a) => s + a.actions, 0), [data])
  const maxViews = useMemo(() => Math.max(1, ...(data?.topPages || []).map(p => p.views)), [data])

  return (
    <div>
      <PageHeader title="Usage" subtitle="Who's using the workspace, and where they spend their time." />

      <div className="flex gap-1.5 mb-5 overflow-x-auto">
        {RANGES.map(r => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              days === r.days ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-ink-muted border-rule hover:border-gray-300'
            }`}
          >
            Last {r.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card p-4 mb-5 flex items-center gap-2 text-sm text-danger">
          {error}
          <button onClick={() => setDays(d => d)} className="ml-auto text-xs font-semibold hover:underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-5">
          <Skeleton.StatCards count={4} />
          <Skeleton.Block h="h-64" />
          <Skeleton.Table rows={6} />
        </div>
      ) : data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Eye} label="Page views" value={data.totals.views.toLocaleString()} sub={`last ${data.days} days`} />
            <StatCard icon={Users} label="Active users" value={data.totals.users} sub="viewed at least one page" />
            <StatCard icon={LogIn} label="Logins" value={totalLogins.toLocaleString()} sub="sessions started" />
            <StatCard icon={MousePointerClick} label="Actions" value={totalActions.toLocaleString()} sub="edits, approvals, uploads…" />
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold text-ink mb-4 flex items-center gap-2">
              <BarChart3 size={14} className="text-brand-ink" /> Daily activity
            </h3>
            {data.daily.length === 0 ? (
              <p className="text-sm text-ink-muted py-8 text-center">No page views recorded yet — data starts collecting now.</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      {/* The accent is a runtime CSS var, so the gradient reads it
                          rather than hardcoding a hex the workspace didn't pick. */}
                      <linearGradient id="usageViewsFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.15)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(v, name) => [v, name === 'views' ? 'Page views' : 'Active users']}
                      labelFormatter={d => formatDate(d)}
                    />
                    <Area type="monotone" dataKey="views" stroke="rgb(var(--color-brand-500))" strokeWidth={2} fill="url(#usageViewsFill)" />
                    <Area type="monotone" dataKey="users" stroke="#6366f1" strokeWidth={1.5} fillOpacity={0} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-divider">
                <h3 className="text-sm font-bold text-ink">Most-used pages</h3>
              </div>
              {data.topPages.length === 0 ? (
                <p className="text-sm text-ink-muted p-6 text-center">Nothing yet.</p>
              ) : data.topPages.map(p => (
                <div key={p.path} className="px-5 py-2.5 border-b border-divider last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-xs font-bold text-ink truncate" title={p.path}>{pageLabel(p.path)}</span>
                    <span className="text-xs font-bold text-ink-muted tabular-nums whitespace-nowrap">
                      {p.views.toLocaleString()}
                      <span className="text-ink-faint font-semibold"> · {p.users} user{p.users === 1 ? '' : 's'}</span>
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-500/15 overflow-hidden">
                    {/* Inline width — a Tailwind class can't express a computed %. */}
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(3, (p.views / maxViews) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-divider">
                <h3 className="text-sm font-bold text-ink">Most active people</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[460px] text-xs">
                  <thead>
                    <tr className="bg-page border-b border-rule text-left">
                      <th className="px-5 py-2 font-bold text-ink-muted">Person</th>
                      <th className="px-3 py-2 font-bold text-ink-muted text-right">Views</th>
                      <th className="px-3 py-2 font-bold text-ink-muted text-right">Days active</th>
                      <th className="px-3 py-2 font-bold text-ink-muted text-right">Logins</th>
                      <th className="px-3 py-2 font-bold text-ink-muted text-right">Actions</th>
                      <th className="px-5 py-2 font-bold text-ink-muted text-right">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-6 text-center text-ink-muted">Nothing yet.</td></tr>
                    ) : userRows.map(u => (
                      <tr key={u.name} className="border-b border-divider last:border-b-0">
                        <td className="px-5 py-2 font-bold text-ink">{u.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{u.views.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{u.active_days || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{u.logins || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{u.actions || '—'}</td>
                        <td className="px-5 py-2 text-right text-ink-faint whitespace-nowrap">{u.last_seen ? formatDate(u.last_seen) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-ink-faint px-1">
            Page views start collecting from the moment this feature deployed — older history shows logins and actions
            only. Views are kept for {data.retention_days || 180} days, then deleted. Operators viewing this workspace
            from the platform console are not counted.
          </p>
        </div>
      )}
    </div>
  )
}

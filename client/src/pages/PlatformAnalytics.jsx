import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Building2, Disc3, TrendingUp, Users } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'

// Operator console — CROSS-TENANT growth. Deliberately a different question
// from a workspace's own /usage page: this is "is the platform growing and who
// is busy", never "what did a named person look at". No per-user rows here.

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

// 12 months ending this month, so a month with no signups shows as a zero bar
// rather than vanishing and making growth look smooth.
function fillMonths(rows) {
  const by = Object.fromEntries((rows || []).map(r => [r.month, r.n]))
  const out = []
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 11)
  for (let i = 0; i < 12; i++) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ month: key, label: key.slice(2), n: by[key] || 0 })
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

function RankList({ title, rows, valueKey, unit, empty }) {
  const max = Math.max(1, ...rows.map(r => r[valueKey] || 0))
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-divider">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted p-6 text-center">{empty}</p>
      ) : rows.map(r => (
        <div key={r.id} className="px-5 py-2.5 border-b border-divider last:border-b-0">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <Link to="/workspaces" className="text-xs font-bold text-ink truncate hover:text-brand-ink hover:underline">{r.name}</Link>
            <span className="text-xs font-bold text-ink-muted tabular-nums whitespace-nowrap">
              {(r[valueKey] || 0).toLocaleString()} <span className="text-ink-faint font-semibold">{unit}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-500/15 overflow-hidden">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(3, ((r[valueKey] || 0) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PlatformAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    api.get('/platform/analytics')
      .then(r => setData(r.data?.data || null))
      .catch(err => setError(err.response?.data?.error || 'Failed to load analytics'))
      .finally(() => setLoading(false))
  }
  // Wrapped, not passed directly — `load` returns undefined but the pattern is
  // the repo's standing rule (a Promise would be read as a cleanup function).
  useEffect(() => { load() }, [])

  const workspaces = useMemo(() => fillMonths(data?.workspacesByMonth), [data])
  const users = useMemo(() => fillMonths(data?.usersByMonth), [data])
  const newWorkspaces = useMemo(() => workspaces.reduce((s, m) => s + m.n, 0), [workspaces])
  const newUsers = useMemo(() => users.reduce((s, m) => s + m.n, 0), [users])
  const totalEvents = useMemo(() => (data?.topByActivity || []).reduce((s, w) => s + w.events, 0), [data])
  const totalReleases = useMemo(() => (data?.topByReleases || []).reduce((s, w) => s + w.releases, 0), [data])

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Platform growth and the busiest workspaces." />

      {error && (
        <div className="card p-4 mb-5 flex items-center gap-2 text-sm text-danger">
          {error}
          <button onClick={load} className="ml-auto text-xs font-semibold hover:underline">Retry</button>
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
            <StatCard icon={Building2} label="New workspaces" value={newWorkspaces} sub="last 12 months" />
            <StatCard icon={Users} label="New members" value={newUsers.toLocaleString()} sub="last 12 months, operators excluded" />
            <StatCard icon={Activity} label="Events" value={totalEvents.toLocaleString()} sub="last 30 days, top 8 workspaces" />
            <StatCard icon={Disc3} label="Releases" value={totalReleases.toLocaleString()} sub="all time, top 8 workspaces" />
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-bold text-ink mb-4 flex items-center gap-2">
              <TrendingUp size={14} className="text-brand-ink" /> Growth by month
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={workspaces.map((w, i) => ({ label: w.label, workspaces: w.n, members: users[i]?.n || 0 }))}
                  margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip formatter={(v, n) => [v, n === 'workspaces' ? 'Workspaces' : 'Members']} />
                  <Bar dataKey="workspaces" fill="rgb(var(--color-brand-500))" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="members" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <RankList title="Busiest workspaces (30d)" rows={data.topByActivity || []} valueKey="events" unit="events" empty="No activity yet." />
            <RankList title="Largest catalogs" rows={data.topByReleases || []} valueKey="releases" unit="releases" empty="No releases yet." />
          </div>

          <p className="text-[11px] text-ink-faint px-1">
            Counts come from workspace audit trails and catalogs — no tenant content is read here. Per-page usage lives
            inside each workspace on its own Usage page, visible only to that workspace's admins.
          </p>
        </div>
      )}
    </div>
  )
}

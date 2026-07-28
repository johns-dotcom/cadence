import { useEffect, useState } from 'react'
import { Eye, Users, LogIn, Activity as ActivityIcon } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { PAGE_LABELS } from '../components/Layout'
import { formatDate } from '../utils/dates'

const RANGES = [{ key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' }]
const STATS = [
  { key: 'views', label: 'Page views', icon: Eye },
  { key: 'actives', label: 'Active users', icon: Users },
  { key: 'logins', label: 'Logins', icon: LogIn },
  { key: 'actions', label: 'Actions', icon: ActivityIcon },
]
const labelFor = (path) => (PAGE_LABELS && PAGE_LABELS[path]) || path

export default function UsageAnalytics() {
  const [range, setRange] = useState('30d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/analytics?range=${range}`).then(r => setData(r.data.data)).catch(() => setData(null)).finally(() => setLoading(false))
  }, [range])

  return (
    <div>
      <PageHeader
        title="Usage analytics"
        subtitle="How your team is using the workspace"
        action={
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-0.5">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${range === r.key ? 'bg-card text-ink shadow-sm' : 'text-gray-500'}`}>{r.label}</button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STATS.map(({ key, label, icon: Icon }) => (
          <div key={key} className="card p-5">
            <div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p><Icon size={16} className="text-gray-400" /></div>
            <p className="text-3xl font-bold text-ink mt-2">{loading ? '—' : (data?.stats?.[key] ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="card p-5 mb-6">
        <h2 className="text-sm font-bold text-ink mb-3">Daily activity</h2>
        {loading ? <Skeleton.Block h="h-56" /> : (
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.daily || []}>
                <defs>
                  <linearGradient id="vg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="rgb(var(--color-brand-500))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-gray-200))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="views" stroke="rgb(var(--color-brand-500))" fill="url(#vg)" strokeWidth={2} name="Views" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">Most-used pages</h2>
          {loading ? <Skeleton.TaskList count={6} /> : data?.pages?.length ? (
            <div className="space-y-2">
              {data.pages.map(p => {
                const max = data.pages[0].views || 1
                return (
                  <div key={p.path} className="flex items-center gap-3">
                    <span className="text-sm text-ink w-40 truncate flex-shrink-0">{labelFor(p.path)}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.round((p.views / max) * 100)}%` }} /></div>
                    <span className="text-xs text-gray-400 tabular-nums w-10 text-right">{p.views}</span>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-gray-400">No page views recorded yet.</p>}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">Most-active users</h2>
          {loading ? <Skeleton.TaskList count={6} /> : data?.users?.length ? (
            <ul className="divide-y divide-divider">
              {data.users.map(u => (
                <li key={u.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{u.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">Last seen {formatDate(u.last_seen)}</p>
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">{u.views.toLocaleString()} views</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-400">No active users yet.</p>}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'

export default function PlatformAnalytics() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/platform/analytics').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div>
      <PageHeader title="Analytics" subtitle="Platform growth and the most active workspaces" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{Array.from({ length: 4 }).map((_, i) => <Skeleton.Block key={i} h="h-56" />)}</div>
    </div>
  )

  const maxAct = Math.max(1, ...(data?.topByActivity || []).map(w => w.events))
  const maxRel = Math.max(1, ...(data?.topByReleases || []).map(w => w.releases))

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Platform growth and the most active workspaces" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">New workspaces / month</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.workspacesByMonth || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--color-gray-200))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="n" fill="rgb(var(--color-brand-500))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">New members / month</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.usersByMonth || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--color-gray-200))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="n" fill="rgb(var(--color-brand-500))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Most active (last 30 days)</h2>
          <div className="space-y-2.5">
            {(data?.topByActivity || []).map(w => (
              <div key={w.id}>
                <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">{w.name}</span><span className="font-semibold text-ink">{w.events}</span></div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${(w.events / maxAct) * 100}%` }} /></div>
              </div>
            ))}
            {!data?.topByActivity?.length && <p className="text-sm text-gray-400">No activity yet.</p>}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Top by catalog size</h2>
          <div className="space-y-2.5">
            {(data?.topByReleases || []).map(w => (
              <div key={w.id}>
                <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">{w.name}</span><span className="font-semibold text-ink">{w.releases} releases</span></div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(w.releases / maxRel) * 100}%` }} /></div>
              </div>
            ))}
            {!data?.topByReleases?.length && <p className="text-sm text-gray-400">No releases yet.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// Release velocity — how much each person is actually shipping, and how prepared
// it was when it shipped. Admin only (GET /api/team/velocity is requireAdmin).
//
// Deliberately about RELEASES, not tasks: Team Work's Workload view already answers
// "who is busy right now", and answering "who is delivering" from open-task counts
// would just reward people for leaving tickets open.
//
// The 12-month sparkline is a bar row, not a chart library: twelve integers per
// person across a roster is a lot of Recharts instances for something that has to
// convey exactly one thing — the shape of the year.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import api from '../api'
import Button from './ui/Button'
import Skeleton from './Skeleton'
import { formatDate } from '../utils/dates'

function StatCard({ label, value, sub }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="text-xl font-bold text-ink mt-1 leading-none">{value}</p>
      {sub && <p className="text-[10px] text-ink-muted mt-1">{sub}</p>}
    </div>
  )
}

// On-time = shipped with a complete checklist. null means "nothing shipped yet",
// which is NOT 0% — a new hire would otherwise read as the worst on the team.
function OnTimePill({ rate }) {
  if (rate === null || rate === undefined) return <span className="text-[11px] text-ink-faint">—</span>
  const tone = rate >= 80 ? 'bg-emerald-500/15 text-emerald-600'
    : rate >= 50 ? 'bg-amber-500/15 text-amber-600'
      : 'bg-red-500/15 text-red-600'
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tone}`}>{rate}%</span>
}

function Trend({ monthly }) {
  const peak = Math.max(1, ...monthly.map(m => m.count))
  return (
    <div className="flex items-end gap-[2px] h-6" aria-hidden="true">
      {monthly.map((m, i) => (
        <div
          key={i}
          title={`${m.label}: ${m.count}`}
          className={`w-1.5 rounded-sm ${m.count ? 'bg-brand-500' : 'bg-rule'}`}
          // Relative to the person's OWN peak: this is a shape, not a magnitude —
          // comparing bar heights across rows is not a claim it makes.
          style={{ height: `${m.count ? Math.max(15, (m.count / peak) * 100) : 8}%` }}
        />
      ))}
    </div>
  )
}

export default function TeamVelocity() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/team/velocity')
      .then(r => { setData(r.data.data); setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Failed to load velocity'))
      .finally(() => setLoading(false))
  }
  // Wrapped, not passed directly — `load` returns a Promise, which React would
  // treat as the effect's cleanup and crash on unmount.
  useEffect(() => { load() }, [])

  if (loading) return <div className="space-y-4"><Skeleton.StatCards count={4} /><Skeleton.Table rows={5} cols={6} /></div>
  if (error) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-ink">Couldn't load velocity</p>
        <p className="text-xs text-ink-muted mt-1">{error}</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={load}><RefreshCw size={14} /> Retry</Button>
      </div>
    )
  }

  const { velocity = [], totals = {} } = data || {}
  const active = velocity.filter(v => v.total > 0)

  if (!active.length) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-ink-muted">No releases are assigned to anyone yet.</p>
        <p className="text-xs text-ink-muted mt-1">
          Set an owner on a release from the{' '}
          <Link to="/releases" className="text-brand-ink hover:underline font-medium">Releases</Link> page.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Assigned releases" value={totals.totalReleases ?? 0} sub={`${totals.activeMembers ?? 0} people carrying work`} />
        <StatCard label="Shipped · 30 days" value={totals.last30 ?? 0} />
        <StatCard label="Shipped · 90 days" value={totals.last90 ?? 0} />
        <StatCard label="Avg checklist" value={`${totals.avgCompletion ?? 0}%`} sub="across people with releases" />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-divider text-left">
              {['Member', 'Total', 'Shipped', 'Upcoming', '30d', '90d', 'Avg %', 'On time', 'Last 12 months'].map(h => (
                <th key={h} scope="col" className="px-3 py-2.5 text-[10px] font-semibold text-ink-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {active.map(v => (
              <tr key={v.id} className="hover:bg-elev transition">
                <td className="px-3 py-2">
                  <Link to={`/team/${v.id}`} className="text-sm font-medium text-ink hover:text-brand-ink">{v.name}</Link>
                  <p className="text-[10px] text-ink-muted">{v.department || 'No department'}</p>
                </td>
                <td className="px-3 py-2 text-ink">{v.total}</td>
                <td className="px-3 py-2 text-ink-muted">{v.released}</td>
                <td className="px-3 py-2 text-ink-muted">{v.upcoming}</td>
                <td className="px-3 py-2 text-ink-muted">{v.last30}</td>
                <td className="px-3 py-2 text-ink-muted">{v.last90}</td>
                <td className="px-3 py-2 text-ink-muted">{v.avgCompletion}%</td>
                <td className="px-3 py-2"><OnTimePill rate={v.onTimeRate} /></td>
                <td className="px-3 py-2"><Trend monthly={v.monthly || []} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2">Recently shipped</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {active.flatMap(v => (v.recentReleases || []).map(r => ({ ...r, owner: v.name })))
            .sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')))
            .slice(0, 6)
            .map(r => (
              <Link key={r.id} to={`/releases/${r.id}`} className="card p-3 hover:bg-elev transition">
                <p className="text-sm text-ink truncate">{r.project_name}</p>
                <p className="text-[11px] text-ink-muted truncate">{r.artist_name || 'Unknown artist'} · {formatDate(r.release_date)}</p>
                <p className="text-[10px] text-ink-muted mt-1">
                  {r.owner} · <span className={r.completion === 100 ? 'text-success' : 'text-warning'}>{r.completion}% checklist</span>
                </p>
              </Link>
            ))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { DollarSign, CreditCard, TrendingUp, AlertCircle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { PLAN, PLAN_STYLE, STATUS_STYLE, money } from '../constants/plans'

export default function PlatformBilling() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [planFilter, setPlanFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => { api.get('/platform/billing').then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false)) }, [])

  const t = data?.totals || {}
  const shown = useMemo(() => (data?.workspaces || []).filter(w =>
    (!planFilter || w.plan === planFilter) && (!statusFilter || w.billing_status === statusFilter)
  ), [data, planFilter, statusFilter])

  const paying = (t.statusMix?.active || 0) + (t.statusMix?.past_due || 0)

  return (
    <div>
      <PageHeader title="Billing & plans" subtitle="Revenue, plan mix, and per-workspace subscriptions" />

      {/* Rollup cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="card p-4"><div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><DollarSign size={12} /> MRR</div><p className="text-2xl font-bold text-ink">{loading ? '—' : money(t.mrr)}</p></div>
        <div className="card p-4"><div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><CreditCard size={12} /> Paying</div><p className="text-2xl font-bold text-ink">{loading ? '—' : paying}</p></div>
        <div className="card p-4"><div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><TrendingUp size={12} /> Trialing</div><p className="text-2xl font-bold text-ink">{loading ? '—' : (t.statusMix?.trialing || 0)}</p></div>
        <div className="card p-4"><div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1"><AlertCircle size={12} /> Past due</div><p className={`text-2xl font-bold ${(t.statusMix?.past_due || 0) > 0 ? 'text-red-600' : 'text-ink'}`}>{loading ? '—' : (t.statusMix?.past_due || 0)}</p></div>
      </div>

      {/* Plan mix */}
      {!loading && (
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(t.planMix || {}).map(([k, n]) => (
            <button key={k} onClick={() => setPlanFilter(planFilter === k ? '' : k)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${planFilter === k ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-rule text-gray-600 hover:bg-gray-50'}`}>
              {PLAN[k]?.name || k}: <span className="font-bold">{n}</span>
            </button>
          ))}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input !w-auto !py-1.5 text-xs ml-auto">
            <option value="">All statuses</option>
            {Object.keys(t.statusMix || {}).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={5} /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[10px] text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 font-semibold">Workspace</th>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Seats</th>
                <th className="px-4 py-3 font-semibold text-right">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shown.map(w => {
                const over = w.seat_limit != null && w.members > w.seat_limit
                return (
                  <tr key={w.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-ink">{w.name}</td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${PLAN_STYLE[w.plan] || PLAN_STYLE.free}`}>{PLAN[w.plan]?.name || w.plan}</span></td>
                    <td className="px-4 py-2.5"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[w.billing_status] || ''}`}>{w.billing_status}</span></td>
                    <td className="px-4 py-2.5"><span className={over ? 'text-red-600 font-semibold' : 'text-gray-600'}>{w.members}{w.seat_limit != null ? ` / ${w.seat_limit}` : ''}</span></td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink tabular-nums">{money(w.mrr)}</td>
                  </tr>
                )
              })}
              {!shown.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No workspaces match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3">Manage a workspace's plan from its drawer → Manage tab.</p>
    </div>
  )
}

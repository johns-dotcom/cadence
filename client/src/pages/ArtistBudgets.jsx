// Artist Budgets index — every artist with a budget OR spend. An artist with
// spend and no sheet LISTS with an empty budget column; there is no "create
// budget" step to hide behind.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw, Scale, Search } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { money } from '../utils/money'

const SORTS = [
  ['committed', 'Committed'], ['spent', 'Spent'], ['open', 'Open'],
  ['budget', 'Budget'], ['variance', 'Most overspent'], ['name', 'Name'],
]

export default function ArtistBudgets() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [onlyBudgeted, setOnlyBudgeted] = useState(false)
  const [sort, setSort] = useState('committed')

  const load = () => {
    setError(null)
    api.get('/artist-budgets').then((r) => setData(r.data.data)).catch((err) => setError(err.response?.data?.error || 'Failed to load'))
  }
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    if (!data) return []
    let list = data.artists
    if (onlyBudgeted) list = list.filter((a) => a.has_budget)
    if (q.trim()) list = list.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()))
    const cmp = {
      committed: (a, b) => b.committed - a.committed,
      spent: (a, b) => b.spent - a.spent,
      open: (a, b) => b.open - a.open,
      budget: (a, b) => b.budget - a.budget,
      // Most overspent first; artists with no budget sort last.
      variance: (a, b) => (a.variance ?? Infinity) - (b.variance ?? Infinity),
      name: (a, b) => a.name.localeCompare(b.name),
    }[sort]
    return [...list].sort(cmp)
  }, [data, q, onlyBudgeted, sort])

  if (error) return (
    <div className="card p-10 text-center">
      <AlertTriangle size={28} className="text-warning mx-auto mb-3" />
      <p className="text-sm text-ink">Couldn't load artist budgets</p>
      <p className="text-xs text-ink-muted mt-1">{error}</p>
      <button className="btn-secondary mt-4 inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={14} /> Retry</button>
    </div>
  )
  if (!data) return <div><PageHeader title="Artist Budgets" /><div className="card p-2"><Skeleton.Table rows={8} cols={6} /></div></div>

  return (
    <div>
      <PageHeader
        title="Artist Budgets"
        subtitle={`${data.totals.artists} artists · ${money(data.totals.spent)} spent · ${money(data.totals.open)} in open invoices`}
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input !pl-8 !py-1.5 text-sm w-48" placeholder="Search artists…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={onlyBudgeted} onChange={(e) => setOnlyBudgeted(e.target.checked)} /> only budgeted</label>
        <select className="input !py-1.5 !w-auto text-sm ml-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            {['Artist', 'Budget', 'Spent', 'Open', 'Committed', 'Variance', 'Bank'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">No artists{onlyBudgeted ? ' with budgets — set one on any artist\'s sheet' : ''}.</td></tr>}
            {rows.map((a) => (
              <tr key={a.key} className="hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <Link to={`/artist-budgets/${a.key}`} className="font-medium text-ink hover:text-brand-600">{a.name}</Link>
                  {a.over_committed && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700" title="Within budget on spend, over it once the open invoices are paid">over-committed</span>}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-gray-600">{a.budget ? money(a.budget) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums font-medium text-ink">{money(a.spent)}</td>
                <td className="px-3 py-2.5 tabular-nums text-amber-600">{a.open ? money(a.open) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">{money(a.committed)}</td>
                <td className={`px-3 py-2.5 tabular-nums ${a.variance == null ? 'text-gray-300' : a.variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {a.variance == null ? '—' : money(a.variance)}
                </td>
                <td className="px-3 py-2.5">
                  {/* spent-only state bar — verified / awaiting / unverified */}
                  {a.spent > 0 ? (
                    <div className="w-24 h-1.5 rounded-full overflow-hidden flex bg-gray-100" title={`${money(a.verified)} on statements · ${money(a.awaiting)} awaiting · ${money(a.unverified)} with no bank line`}>
                      <div className="bg-emerald-500 h-full" style={{ width: `${(a.verified / a.spent) * 100}%` }} />
                      <div className="bg-sky-400 h-full" style={{ width: `${(a.awaiting / a.spent) * 100}%` }} />
                      <div className="bg-rose-500 h-full" style={{ width: `${(a.unverified / a.spent) * 100}%` }} />
                    </div>
                  ) : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5"><Scale size={12} /> Spent is money that has left the bank. Open invoices are counted separately and added into Committed — an unpaid invoice is not an expenditure.</p>
    </div>
  )
}

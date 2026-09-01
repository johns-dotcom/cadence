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
      <PageHeader title="Artist Budgets" subtitle="What each artist was budgeted, what has actually been spent, and the difference." />

      {/* The summary band. Spent alone reads as money that is gone; the open
          figure and its COUNT are the part that is still a decision, and
          "N with no budget set yet" is this page's actual call to action. */}
      <div className="card p-3 mb-4">
        <p className="text-[12px] text-ink-muted">
          <b className="text-ink tabular-nums">{data.totals.artists}</b> artists ·{' '}
          <b className="text-ink tabular-nums">{money(data.totals.spent)}</b> spent
          {data.totals.open > 0 && (
            <> · <b className="text-warning tabular-nums">{money(data.totals.open)}</b> in open invoices ({data.totals.open_count})</>
          )}
          {' · '}against <b className="text-ink tabular-nums">{money(data.totals.budget)}</b> budgeted
          {data.totals.with_budget < data.totals.artists && (
            <span className="text-ink-faint"> · {data.totals.artists - data.totals.with_budget} with no budget set yet</span>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className="input !pl-8 !py-1.5 text-sm w-48" placeholder="Search artists…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={onlyBudgeted} onChange={(e) => setOnlyBudgeted(e.target.checked)} /> only budgeted</label>
        <select className="input !py-1.5 !w-auto text-sm ml-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
            {['Artist', 'Budget', 'Spent', 'Open', 'Committed', 'Variance', 'Bank'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-ink-faint">No artists{onlyBudgeted ? ' with budgets — set one on any artist\'s sheet' : ''}.</td></tr>}
            {rows.map((a) => (
              <tr key={a.key} className="hover:bg-elev">
                <td className="px-3 py-2.5">
                  <Link to={`/artist-budgets/${a.key}`} className="font-medium text-ink hover:text-brand-ink">{a.name}</Link>
                  <span className="text-ink-faint text-[11px]"> · {a.count} paid item{a.count === 1 ? '' : 's'}</span>
                  {a.over_committed && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-danger/10 text-danger" title="Within budget on spend, over it once the open invoices are paid">over-committed</span>}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink-muted">{a.budget ? money(a.budget) : <span className="text-ink-faint">not set</span>}</td>
                <td className="px-3 py-2.5 tabular-nums font-medium text-ink">{money(a.spent)}</td>
                <td className="px-3 py-2.5 tabular-nums text-warning" title={a.open_count ? `${a.open_count} unpaid invoice${a.open_count === 1 ? '' : 's'}` : ''}>{a.open ? money(a.open) : <span className="text-ink-faint">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">{money(a.committed)}</td>
                <td className={`px-3 py-2.5 tabular-nums ${a.variance == null ? 'text-ink-faint' : a.variance < 0 ? 'text-danger' : 'text-success'}`}>
                  {a.variance == null ? '—' : money(a.variance)}
                </td>
                <td className="px-3 py-2.5"><StateBar a={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-ink-faint mt-2 flex items-center gap-1.5"><Scale size={12} /> Spent is money that has left the bank. Open invoices are counted separately and added into Committed — an unpaid invoice is not an expenditure.</p>
    </div>
  )
}

// Four states, one bar — the same vocabulary as the sheet and Recoupments.
// SPENT only: Open has its own column, and putting one amount in two places on
// the same row is how a reader double-counts it.
//
// The text sublabel is the point of the cell. A bar with no numbers can only be
// hovered, so the split — how much of this artist's spend is actually PROVABLE
// to a partner — was a fact you had to go looking for.
function StateBar({ a }) {
  const parts = [
    ['verified', a.verified, 'bg-success', 'confirmed'],
    ['awaiting', a.awaiting, 'bg-info', 'unconfirmed'],
    ['unverified', a.unverified, 'bg-danger', 'no bank line'],
  ].filter(([, v]) => v > 0)
  if (!parts.length) return <span className="text-ink-faint">—</span>
  const total = parts.reduce((t, [, v]) => t + v, 0) || 1
  const tip = parts.map(([k, v]) => `${money(v)} ${
    k === 'verified' ? 'confirmed on a statement'
      : k === 'awaiting' ? 'paid, statement not uploaded yet'
        : 'paid, but no matching bank line'}`).join(' · ')
  return (
    <span title={tip}>
      <span className="flex h-1.5 w-24 rounded-full overflow-hidden bg-elev">
        {parts.map(([k, v, cls]) => <span key={k} className={cls} style={{ width: `${(100 * v) / total}%` }} />)}
      </span>
      <span className="mt-1 block text-[10px] text-ink-faint tabular-nums">
        {parts.map(([, v, , word]) => `${money(v)} ${word}`).join(' · ')}
      </span>
    </span>
  )
}

// The review list of everything excluded from Reports. Grouped by scope;
// orphaned item rules (their display row vanished with a statement
// re-upload) are named — the fingerprint still suppresses a matching row.

import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Search, ShieldCheck } from 'lucide-react'
import api from '../../api'
import { money, moneyOrig } from '../../utils/money'
import Skeleton from '../Skeleton'
import { formatDate } from '../../utils/dates'

// `pnl` rides in so a standing line rule can advertise what it is ACTUALLY
// keeping out of the current range. A rule with no live figure beside it reads
// as free; the figure is what makes someone revisit it.
export default function DismissedTab({ toast, onChanged, pnl }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')

  const load = async () => {
    setError(null)
    try { const r = await api.get('/reports/dismissals'); setRows(r.data.data) }
    catch (err) { setError(err.response?.data?.error || 'Failed to load dismissals') }
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    if (!q.trim()) return rows
    const s = q.toLowerCase()
    return rows.filter((r) => [r.payee, r.cell_key, r.reason, r.bs_ref, r.dismissed_by].some((v) => String(v || '').toLowerCase().includes(s)))
  }, [rows, q])

  const restore = async (r) => {
    try {
      await api.post('/reports/dismiss/restore', { id: r.id })
      toast('Restored — the money is counted again')
      load(); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // A silent load failure here would read as "nothing is dismissed".
  if (error) return <div className="card p-8 text-center"><p className="text-sm text-rose-600">{error}</p><button className="btn-secondary mt-3" onClick={load}>Retry</button></div>
  if (!rows) return <div className="card p-2"><Skeleton.Table rows={5} cols={4} /></div>

  const groups = [
    ['category', 'Line rules — a standing exclusion; new rows landing on the line stay excluded'],
    ['item', 'Items'],
    ['bs_line', 'Balance-sheet lines'],
    ['bs_item', 'Balance-sheet items'],
  ]

  return (
    <div>
      <div className="relative mb-3 max-w-sm">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input !pl-8 !py-1.5 text-sm" placeholder="Search dismissals…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!filtered.length && (
        <div className="card p-10 text-center">
          <ShieldCheck size={28} className="text-emerald-400 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nothing is dismissed — every row is counted.</p>
        </div>
      )}
      {groups.map(([scope, label]) => {
        const g = filtered.filter((r) => r.scope === scope)
        if (!g.length) return null
        return (
          <div key={scope} className="mb-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1.5">{label} ({g.length})</p>
            <div className="card divide-y divide-divider">
              {g.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <span className="text-ink truncate block">
                      {scope === 'category' ? `${r.cell_kind} · ${r.cell_key}`
                        : scope === 'bs_line' ? r.cell_key
                        : scope === 'bs_item' ? (r.payee ? `${r.payee} (${r.bs_ref})` : r.bs_ref)
                        : (r.payee || <span className="font-mono text-xs text-gray-400">{r.row_fingerprint}</span>)}
                      {r.orphaned && <span className="ml-2 text-[10px] uppercase text-warning" title="The row behind this rule is gone (statement re-uploaded). The exclusion still applies if a matching row comes back.">no longer present</span>}
                      {scope === 'category' && (() => {
                        const hit = pnl?.dismissed?.by_rule?.[`${r.cell_kind}|${r.cell_key}`]
                        if (!hit) return <span className="ml-2 text-[10px] text-ink-faint">nothing in this range</span>
                        return <span className="ml-2 text-[10px] text-warning">{money(hit.usd)} excluded in range · {hit.count} row{hit.count === 1 ? '' : 's'}</span>
                      })()}
                    </span>
                    <span className="text-[11px] text-gray-400 block truncate">
                      {[r.reason, r.dismissed_by && `by ${r.dismissed_by}`, r.dismissed_at && formatDate(r.dismissed_at)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {r.amount != null && <span className="tabular-nums text-gray-500 whitespace-nowrap">{moneyOrig(r.amount, r.currency)}</span>}
                  <button className="text-gray-400 hover:text-ink inline-flex items-center gap-1 text-xs" onClick={() => restore(r)}>
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

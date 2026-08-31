// The rows behind one P&L cell. INVARIANT: the header total equals the cell
// it was opened from — a visible drift warning renders otherwise, because a
// drill that doesn't reconcile to its cell is worse than none.

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { money, moneyOrig } from '../../utils/money'
import Skeleton from '../Skeleton'
import CategoryOptions from '../CategoryOptions'

export default function DrillModal({ drill, range, artist, pnl, onClose, refetch, toast }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(new Set())
  const [action, setAction] = useState(null) // { type: 'recat'|'artist'|'month', row? , bulk? }
  const [actionValue, setActionValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.get('/reports/pnl/detail', {
        params: {
          kind: drill.kind, key: drill.key, keys: drill.keys, month: drill.month || undefined,
          from: range.from, to: range.to, artist: artist || undefined,
          drillCategory: drill.drillCategory || undefined,
        },
      })
      setData(res.data.data)
    } catch (err) { setError(err.response?.data?.error || 'Drill failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  const rows = useMemo(() => {
    if (!data) return []
    if (!q.trim()) return data.rows
    const s = q.toLowerCase()
    return data.rows.filter((r) => [r.payee, r.artist, r.song, r.invoice_number, String(r.usd)].some((v) => String(v || '').toLowerCase().includes(s)))
  }, [data, q])

  const drift = data && drill.cellTotal != null ? Math.abs(data.total - drill.cellTotal) : 0
  const shownTotal = rows.reduce((s, r) => s + r.usd, 0)

  const runSingle = async (row, type, value) => {
    if (type === 'recat') await api.post('/reports/recategorize', row.expense_id ? { expense_id: row.expense_id, category: value } : { income_id: row.income_id, category: value })
    if (type === 'artist') await api.post('/reports/set-artist', { expense_id: row.expense_id, artist: value })
    if (type === 'month') await api.post('/reports/reassign-month', row.expense_id ? { expense_id: row.expense_id, target_month: value || null } : { income_id: row.income_id, target_month: value || null })
    if (type === 'dismiss') await api.post('/reports/dismiss', row.expense_id ? { expense_id: row.expense_id, reason: value, cell_kind: drill.kind === 'income' ? 'income' : 'expense', cell_key: drill.key } : { income_id: row.income_id, reason: value, cell_key: drill.key })
  }

  const apply = async () => {
    setBusy(true)
    const targets = action.bulk ? rows.filter((r) => sel.has(r.expense_id ?? `i${r.income_id}`)) : [action.row]
    const errors = []
    try {
      if (action.type === 'artist' && action.bulk) {
        // one call — the endpoint takes ids
        await api.post('/reports/set-artist', { expense_ids: targets.map((r) => r.expense_id).filter(Boolean), artist: actionValue })
      } else {
        let done = 0
        for (const row of targets) {
          try { await runSingle(row, action.type, actionValue) } catch (err) { errors.push(`${row.payee || row.income_id}: ${err.response?.data?.error || 'failed'}`) }
          done += 1
          if (targets.length > 3) setProgress({ done, total: targets.length })
        }
      }
      if (errors.length) toast(`${errors.length} of ${targets.length} failed — ${errors[0]}`, 'error')
      else toast(action.type === 'dismiss' ? 'Dismissed' : 'Saved')
      setAction(null); setActionValue(''); setSel(new Set()); setProgress(null)
      await load(); refetch()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error')
    } finally { setBusy(false); setProgress(null) }
  }

  const keyOf = (r) => r.expense_id ?? `i${r.income_id}`
  const toggle = (r) => setSel((x) => { const n = new Set(x); const k = keyOf(r); n.has(k) ? n.delete(k) : n.add(k); return n })

  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="font-bold text-ink">{drill.label}</h3>
            <p className="text-xs text-gray-400">
              {data ? <>Cell total {money(data.total)}{q.trim() ? ` · ${money(shownTotal)} shown` : ''}{data.truncated ? ` · showing first ${data.rows.length} of ${data.truncated} — the total covers all of them` : ''}</> : '…'}
              {data?.dismissed?.count ? <span className="text-amber-600"> · +{money(data.dismissed.total)} dismissed ({data.dismissed.count})</span> : null}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>
        {data && drift >= 1 && (
          <div className="card px-3 py-2 mb-2 border-rose-300 bg-rose-50 text-xs text-rose-700 flex items-center gap-2">
            <AlertTriangle size={13} /> Drill total {money(data.total)} does not match the cell {money(drill.cellTotal)} — do not present this cell until it reconciles.
          </div>
        )}

        <div className="relative my-2">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input !pl-8 !py-1.5 text-sm" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {sel.size > 0 && (
          <div className="card px-3 py-2 mb-2 bg-brand-500/10 border-brand-200 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{sel.size} selected</span>
            <button className="btn-secondary !py-1" onClick={() => { setAction({ type: 'recat', bulk: true }); setActionValue('') }}>Recategorize</button>
            <button className="btn-secondary !py-1" onClick={() => { setAction({ type: 'artist', bulk: true }); setActionValue('') }}>Set artist</button>
            <button className="btn-secondary !py-1 ml-auto" onClick={() => setSel(new Set())}>Clear</button>
            {progress && <span className="text-xs text-gray-400">{progress.done}/{progress.total}</span>}
          </div>
        )}

        {loading ? <Skeleton.Table rows={6} cols={5} /> : error ? (
          <p className="text-sm text-rose-600 p-4">{error}</p>
        ) : (
          <div className="divide-y divide-divider">
            {rows.map((r) => (
              <div key={keyOf(r)} className="flex items-center gap-2 py-1.5 text-sm">
                <input type="checkbox" checked={sel.has(keyOf(r))} onChange={() => toggle(r)} />
                <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{r.date}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-ink truncate block">{r.payee || '—'}
                    {r.evidence === 'invented' && <span className="ml-1.5 text-[10px] uppercase text-gray-400" title="Booked from a bank line — no invoice document behind it">bank</span>}
                    {r.split_of && <span className="ml-1.5 text-[10px] text-gray-400" title="One slice of a split payment — the other slices keep their own labels">part of a split</span>}
                    {r.moved_from && <span className="ml-1.5 text-[10px] text-indigo-500" title={`Reported here by a period adjustment (paid ${r.moved_from})`}>moved from {r.moved_from}</span>}
                  </span>
                  <span className="text-[11px] text-gray-400 truncate block">
                    {[r.artist, r.song, r.invoice_number && `#${r.invoice_number}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <span className="tabular-nums text-right whitespace-nowrap">
                  {money(r.usd)}
                  {r.currency && r.currency !== 'USD' && <span className="block text-[10px] text-gray-400">{moneyOrig(r.amount, r.currency)}</span>}
                </span>
                <div className="flex items-center gap-1 text-[11px]">
                  {r.expense_id && <button className="text-gray-400 hover:text-ink" title="Recategorize" onClick={() => { setAction({ type: 'recat', row: r }); setActionValue(r.category || '') }}>cat</button>}
                  {r.expense_id && <button className="text-gray-400 hover:text-ink" title="Set artist" onClick={() => { setAction({ type: 'artist', row: r }); setActionValue(r.artist || '') }}>artist</button>}
                  <button className="text-gray-400 hover:text-ink" title="Report this row in a different month (report-only)" onClick={() => { setAction({ type: 'month', row: r }); setActionValue(r.report_month || '') }}>mo</button>
                  <button className="text-gray-400 hover:text-rose-600" title="Dismiss from Reports" onClick={() => { setAction({ type: 'dismiss', row: r }); setActionValue('') }}>✕</button>
                  {r.expense_id && <Link to={`/ledger?focus=${r.split_of || r.expense_id}`} className="text-gray-400 hover:text-ink" title="Open on the Ledger"><ExternalLink size={12} /></Link>}
                </div>
              </div>
            ))}
            {!rows.length && <p className="text-sm text-gray-400 py-6 text-center">No rows{q.trim() ? ' match the filter' : ''}.</p>}
          </div>
        )}

        {data?.recoveries?.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer">Recoveries netted into this cell ({data.recoveries.length})</summary>
            {data.recoveries.map((r) => (
              <div key={r.income_id} className="flex items-center gap-2 py-1 text-sm text-emerald-700">
                <span className="text-xs text-gray-400 tabular-nums w-20">{r.date}</span>
                <span className="flex-1 truncate">{r.payee}</span>
                <span className="tabular-nums">−{money(r.usd)}</span>
              </div>
            ))}
          </details>
        )}

        {action && (
          <div className="fixed inset-0 z-[80] bg-overlay flex items-center justify-center p-4" onClick={() => setAction(null)}>
            <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h4 className="font-bold text-ink mb-2">
                {action.type === 'recat' && `Recategorize ${action.bulk ? `${sel.size} rows` : action.row?.payee || ''}`}
                {action.type === 'artist' && `Set artist on ${action.bulk ? `${sel.size} rows` : action.row?.payee || ''}`}
                {action.type === 'month' && 'Report in a different month'}
                {action.type === 'dismiss' && `Dismiss ${action.row?.payee || 'row'} from Reports`}
              </h4>
              {action.type === 'recat' && (
                <select className="input" value={actionValue} onChange={(e) => setActionValue(e.target.value)}>
                  <option value="">—</option>
                  <CategoryOptions kind={drill.kind === 'income' ? 'income' : 'expense'} />
                </select>
              )}
              {action.type === 'artist' && (
                <>
                  <input className="input" list="drill-artists" value={actionValue} onChange={(e) => setActionValue(e.target.value)} placeholder="Artist (blank clears)" />
                  <datalist id="drill-artists">{(pnl?.artists || []).map((a) => <option key={a} value={a} />)}</datalist>
                </>
              )}
              {action.type === 'month' && (
                <>
                  <p className="text-xs text-ink-muted mb-2">Report-only — the row keeps its real payment date. Setting it back to its own month clears the override.</p>
                  <input type="month" className="input" value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
                </>
              )}
              {action.type === 'dismiss' && (
                <>
                  <p className="text-xs text-ink-muted mb-2">Removes it from the list AND the reported total, disclosed in the banner and the Dismissed tab.</p>
                  <input className="input" placeholder="Reason (optional)" value={actionValue} onChange={(e) => setActionValue(e.target.value)} />
                </>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button className="btn-secondary" onClick={() => setAction(null)}>Cancel</button>
                <button className="btn-primary" disabled={busy || (action.type === 'recat' && !actionValue)} onClick={apply}>{busy ? 'Working…' : 'Apply'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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

export default function DrillModal({ drill, range, artist, pnl, onClose, refetch, toast, onShowDismissed }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(new Set())
  const [action, setAction] = useState(null) // { type: 'recat'|'artist'|'month', row? , bulk? }
  const [actionValue, setActionValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  // Sort is applied SERVER-side over the full result set, so "biggest first"
  // shows the biggest rows and not the biggest of an arbitrary first 500.
  const [sort, setSort] = useState({ by: 'date', dir: 'desc' })

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await api.get('/reports/pnl/detail', {
        params: {
          kind: drill.kind, key: drill.key, keys: drill.keys, month: drill.month || undefined,
          from: range.from, to: range.to, artist: artist || undefined,
          drillCategory: drill.drillCategory || undefined,
          sort: sort.by, dir: sort.dir,
        },
      })
      setData(res.data.data)
    } catch (err) { setError(err.response?.data?.error || 'Drill failed') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [sort.by, sort.dir]) // eslint-disable-line

  const rows = useMemo(() => {
    if (!data) return []
    if (!q.trim()) return data.rows
    const s = q.toLowerCase()
    return data.rows.filter((r) => [r.payee, r.artist, r.song, r.invoice_number, String(r.usd)].some((v) => String(v || '').toLowerCase().includes(s)))
  }, [data, q])

  const keyOf = (r) => r.expense_id ?? `i${r.income_id}`

  // A selection that survives a filter change is a selection the operator can
  // no longer see — and the bulk bar would then act on invisible rows.
  useEffect(() => {
    setSel((prev) => {
      if (!prev.size) return prev
      const visible = new Set(rows.map(keyOf))
      const next = new Set([...prev].filter((k) => visible.has(k)))
      return next.size === prev.size ? prev : next
    })
  }, [rows]) // eslint-disable-line

  const drift = data && drill.cellTotal != null ? Math.abs(data.total - drill.cellTotal) : 0
  const shownTotal = rows.reduce((s, r) => s + r.usd, 0)
  const selectedTotal = rows.filter((r) => sel.has(keyOf(r))).reduce((s, r) => s + r.usd, 0)
  const attributable = rows.filter((r) => sel.has(keyOf(r)) && r.expense_id).length
  const allIds = data?.all_expense_ids || []
  // Past the render cap the client holds ids it is not showing. "Attribute all"
  // uses them so a 900-row cell is not silently capped at the 500 on screen.
  const beyondCap = data?.truncated ? allIds.length : 0

  const runSingle = async (row, type, value) => {
    if (type === 'recat') await api.post('/reports/recategorize', row.expense_id ? { expense_id: row.expense_id, category: value } : { income_id: row.income_id, category: value })
    if (type === 'artist') await api.post('/reports/set-artist', { expense_id: row.expense_id, artist: value })
    if (type === 'month') await api.post('/reports/reassign-month', row.expense_id ? { expense_id: row.expense_id, target_month: value || null } : { income_id: row.income_id, target_month: value || null })
    if (type === 'dismiss') await api.post('/reports/dismiss', row.expense_id ? { expense_id: row.expense_id, reason: value, cell_kind: drill.kind === 'income' ? 'income' : 'expense', cell_key: drill.key } : { income_id: row.income_id, reason: value, cell_key: drill.key })
  }

  const apply = async () => {
    setBusy(true)
    const targets = action.all ? rows : action.bulk ? rows.filter((r) => sel.has(keyOf(r))) : [action.row]
    const errors = []
    try {
      if (action.type === 'artist' && action.all) {
        // Every id in the cell, including rows past the 500-row render cap.
        await api.post('/reports/set-artist', { expense_ids: allIds, artist: actionValue })
      } else if (action.type === 'artist' && action.bulk) {
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

  const toggle = (r) => setSel((x) => { const n = new Set(x); const k = keyOf(r); n.has(k) ? n.delete(k) : n.add(k); return n })

  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h3 className="font-bold text-ink">{drill.label}</h3>
            <p className="text-xs text-gray-400">
              {data ? <>Cell total {money(data.total)}{q.trim() ? ` · ${money(shownTotal)} shown` : ''}{data.truncated ? ` · showing first ${data.rows.length} of ${data.truncated} — the total covers all of them` : ''}</> : '…'}
              {data?.dismissed?.count ? (
                <button className="text-warning hover:underline" onClick={() => onShowDismissed?.()}>
                  {' · '}+{money(data.dismissed.total)} dismissed ({data.dismissed.count}) →
                </button>
              ) : null}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>
        {data && drift >= 1 && (
          <div className="card px-3 py-2 mb-2 border-rose-300 bg-rose-50 text-xs text-rose-700 flex items-center gap-2">
            <AlertTriangle size={13} /> Drill total {money(data.total)} does not match the cell {money(drill.cellTotal)} — do not present this cell until it reconciles.
          </div>
        )}

        {data?.evidence && (data.evidence.invoice.rows > 0 || data.evidence.invented.rows > 0) && (
          <div className="card px-3 py-2 my-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-1">What backs these figures</p>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-elev mb-1.5">
              {['invoice', 'invented'].map((k) => {
                const pct = data.total ? Math.max(0, (data.evidence[k]?.usd || 0) / data.total * 100) : 0
                return <div key={k} className={k === 'invoice' ? 'bg-brand-500' : 'bg-amber-500'} style={{ width: `${Math.min(100, pct)}%` }} />
              })}
            </div>
            <p className="text-[11px] text-ink-muted">
              {money(data.evidence.invoice?.usd || 0)} across {data.evidence.invoice?.rows || 0} row{(data.evidence.invoice?.rows || 0) === 1 ? '' : 's'} has an invoice behind it ·{' '}
              {money(data.evidence.invented?.usd || 0)} across {data.evidence.invented?.rows || 0} was booked from a bank line with no document.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 my-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input !pl-8 !py-1.5 text-sm" placeholder="Filter rows…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-ink-faint">Sort</span>
            {[['date', 'Date'], ['name', 'Name'], ['amount', 'Amount']].map(([k, l]) => (
              <button key={k}
                onClick={() => setSort((s) => (s.by === k ? { by: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: k, dir: k === 'name' ? 'asc' : 'desc' }))}
                className={`text-[11px] font-semibold px-2 py-1 rounded ${sort.by === k ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:bg-elev'}`}>
                {l}{sort.by === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
          {rows.length > 0 && (
            <button className="text-[11px] font-semibold text-brand-ink hover:underline"
              onClick={() => setSel(new Set(rows.map(keyOf)))}>Select all {rows.length}</button>
          )}
        </div>

        {sel.size > 0 && (
          <div className="card px-3 py-2 mb-2 bg-brand-500/10 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{sel.size} selected · {money(selectedTotal)}</span>
            <button className="btn-secondary !py-1" onClick={() => { setAction({ type: 'recat', bulk: true }); setActionValue('') }}>Recategorize</button>
            {/* An income row has no artist to set, so the button says how many
                of the selection it will actually touch rather than silently
                skipping the rest. */}
            <button className="btn-secondary !py-1" disabled={!attributable}
              onClick={() => { setAction({ type: 'artist', bulk: true }); setActionValue('') }}>
              {attributable === sel.size ? 'Set artist' : `Set artist on ${attributable} of ${sel.size}`}
            </button>
            <button className="btn-secondary !py-1" onClick={() => { setAction({ type: 'month', bulk: true }); setActionValue('') }}>Move month</button>
            <button className="btn-secondary !py-1 ml-auto" onClick={() => setSel(new Set())}>Clear</button>
            {progress && <span className="text-xs text-ink-muted">{progress.done}/{progress.total}</span>}
          </div>
        )}
        {beyondCap > rows.length && (
          <div className="card px-3 py-2 mb-2 text-xs text-ink-muted flex flex-wrap items-center gap-2">
            <span>{beyondCap} rows are in this cell; {rows.length} are rendered.</span>
            <button className="btn-secondary !py-1 text-xs" onClick={() => { setAction({ type: 'artist', all: true }); setActionValue('') }}>
              Attribute all {beyondCap}
            </button>
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
                {action.type === 'artist' && `Set artist on ${action.all ? `all ${allIds.length} rows` : action.bulk ? `${attributable} row${attributable === 1 ? '' : 's'}` : action.row?.payee || ''}`}
                {action.type === 'month' && `Report ${action.bulk ? `${sel.size} rows` : 'this row'} in a different month`}
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

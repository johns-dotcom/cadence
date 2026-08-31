// Monthly intake cohorts — one row per month a row entered the books, with
// the paid/unpaid split of that cohort, sortable columns, MoM deltas computed
// chronologically (then re-sorted for display), a Peak badge, and a summary
// strip. Rows drill to their invoices (bucket month_YYYY-MM).
//
// Boom's two "Difference" readings (Received − Approved / Received − Paid) are
// deliberately NOT ported: under the aligned cohort recipe paid + unpaid =
// received on every row by construction, which makes the first reading
// identically zero and the second just "unpaid" — degenerate columns.
import { useState } from 'react'
import { ChevronRight, ArrowUpDown } from 'lucide-react'
import { money, moneyCompact } from '../../utils/money'

const monthLabel = (ym) => {
  const [y, m] = (ym || '').split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function PaidUnpaidBar({ paid, unpaid }) {
  const total = paid + unpaid
  if (total <= 0) return <div className="h-1.5 bg-elev rounded-full" />
  return (
    <div className="h-1.5 bg-elev rounded-full overflow-hidden flex">
      {paid > 0 && <div className="h-full" style={{ width: `${(paid / total) * 100}%`, background: '#10b981' }} />}
      {unpaid > 0 && <div className="h-full" style={{ width: `${(unpaid / total) * 100}%`, background: '#f43f5e' }} />}
    </div>
  )
}

const GRID = { gridTemplateColumns: '1.4fr 1fr 0.9fr 0.9fr 0.9fr 1fr 20px' }

export default function MonthlyRollup({ months, onDrill }) {
  const [sortKey, setSortKey] = useState('month')
  const [sortDir, setSortDir] = useState('desc')
  const rows = months || []

  // Chronological first for the MoM deltas, display sort after.
  const chrono = [...rows].sort((a, b) => a.month.localeCompare(b.month))
  const withDelta = chrono.map((m, i) => {
    const prior = i > 0 ? chrono[i - 1] : null
    const deltaPct = prior && prior.received_usd > 0 ? ((m.received_usd - prior.received_usd) / prior.received_usd) * 100 : null
    return { ...m, priorMonth: prior?.month || null, deltaPct }
  })
  const display = [...withDelta].sort((a, b) => {
    if (sortKey === 'month') return sortDir === 'desc' ? b.month.localeCompare(a.month) : a.month.localeCompare(b.month)
    const an = Number(a[sortKey]) || 0, bn = Number(b[sortKey]) || 0
    return sortDir === 'desc' ? bn - an : an - bn
  })

  const totals = withDelta.reduce((acc, m) => ({
    paid: acc.paid + m.paid_usd, unpaid: acc.unpaid + m.unpaid_usd,
    received: acc.received + m.received_usd, count: acc.count + m.received_count,
  }), { paid: 0, unpaid: 0, received: 0, count: 0 })
  const biggest = withDelta.reduce((best, m) => (m.received_usd > (best?.received_usd || 0) ? m : best), null)
  const smallest = withDelta.reduce((least, m) => (least == null || m.received_usd < least.received_usd ? m : least), null)
  const avgReceived = withDelta.length ? totals.received / withDelta.length : 0
  const avgPaid = withDelta.length ? totals.paid / withDelta.length : 0

  const toggleSort = (key) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => (d === 'desc' ? 'asc' : 'desc')); return prev }
      setSortDir('desc'); return key
    })
  }
  const SortHeader = ({ label, keyName, className = '' }) => (
    <button type="button" onClick={() => toggleSort(keyName)} title={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold ${sortKey === keyName ? 'text-ink-muted' : 'text-ink-faint hover:text-ink-muted'} ${className}`}>
      {label}
      <ArrowUpDown size={10} />
      {sortKey === keyName && <span className="text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )

  return (
    <div className="card p-5">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-ink">Monthly rollup</h2>
        <p className="text-[11px] text-ink-faint mt-0.5">
          Invoices by the month they entered the books, split <span className="font-semibold text-success">paid</span> vs{' '}
          <span className="font-semibold text-danger">still open</span>. Paid + open = received on every row. Click a month for its invoices.
        </p>
      </div>

      {withDelta.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4 pb-4 border-b border-rule">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Total paid</p>
            <p className="text-base font-bold text-success tabular-nums mt-0.5">{money(totals.paid)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Still open</p>
            <p className="text-base font-bold text-danger tabular-nums mt-0.5">{money(totals.unpaid)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Received</p>
            <p className="text-base font-bold text-ink tabular-nums mt-0.5">{money(totals.received)}</p>
            <p className="text-[10px] text-ink-faint mt-0.5">{totals.count} invoice{totals.count === 1 ? '' : 's'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Avg / month</p>
            <p className="text-sm font-bold text-ink tabular-nums mt-0.5">{moneyCompact(avgReceived)} <span className="text-[10px] font-semibold text-ink-faint uppercase">received</span></p>
            <p className="text-sm font-bold text-success tabular-nums">{moneyCompact(avgPaid)} <span className="text-[10px] font-semibold text-ink-faint uppercase">paid</span></p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Biggest month</p>
            {biggest ? (
              <button type="button" onClick={() => onDrill?.(`month_${biggest.month}`)} className="text-sm font-bold text-ink tabular-nums mt-0.5 hover:text-brand-ink block truncate">
                {monthLabel(biggest.month)}
              </button>
            ) : <p className="text-sm text-ink-faint mt-0.5">—</p>}
            {biggest && <p className="text-[10px] text-ink-muted tabular-nums">{money(biggest.received_usd)}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">Smallest month</p>
            {smallest ? (
              <button type="button" onClick={() => onDrill?.(`month_${smallest.month}`)} className="text-sm font-bold text-ink tabular-nums mt-0.5 hover:text-brand-ink block truncate">
                {monthLabel(smallest.month)}
              </button>
            ) : <p className="text-sm text-ink-faint mt-0.5">—</p>}
            {smallest && <p className="text-[10px] text-ink-muted tabular-nums">{money(smallest.received_usd)}</p>}
          </div>
        </div>
      )}

      {withDelta.length > 0 && (
        <div className="hidden md:grid gap-3 px-4 py-2 text-[10px] uppercase tracking-wider font-semibold text-ink-faint border-b border-rule" style={GRID}>
          <SortHeader label="Month" keyName="month" />
          <span>Paid / open split</span>
          <SortHeader label="Paid" keyName="paid_usd" className="justify-end" />
          <SortHeader label="Open" keyName="unpaid_usd" className="justify-end" />
          <SortHeader label="Received" keyName="received_usd" className="justify-end" />
          <span className="text-right">vs prior</span>
          <span />
        </div>
      )}

      {display.length === 0 ? (
        <p className="text-center text-xs text-ink-faint py-6">No spend recorded in this window.</p>
      ) : (
        <div className="space-y-2 mt-2">
          {display.map(m => {
            const isBiggest = biggest && m.month === biggest.month && m.received_usd > 0
            return (
              <button
                key={m.month}
                type="button"
                onClick={() => onDrill?.(`month_${m.month}`)}
                className={`group w-full text-left border rounded-lg bg-card flex flex-col md:grid gap-2 md:gap-3 px-4 py-2.5 transition-colors ${isBiggest ? 'border-warning/50 bg-brand-500/5 hover:border-warning' : 'border-rule hover:bg-elev'}`}
                style={GRID}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-ink group-hover:text-brand-ink">{monthLabel(m.month)}</span>
                  {isBiggest && <span className="text-[9px] font-bold text-warning bg-brand-500/10 rounded px-1.5 py-0.5 uppercase tracking-wider">Peak</span>}
                  <span className="text-[11px] text-ink-faint truncate">{m.received_count} inv</span>
                </span>
                <span className="hidden md:flex items-center"><span className="w-full"><PaidUnpaidBar paid={m.paid_usd} unpaid={m.unpaid_usd} /></span></span>
                <span className="text-[11px] font-semibold tabular-nums text-success md:text-right">{moneyCompact(m.paid_usd)}</span>
                <span className="text-[11px] font-semibold tabular-nums text-danger md:text-right">{moneyCompact(m.unpaid_usd)}</span>
                <span className="text-[11px] font-semibold tabular-nums text-ink md:text-right">{moneyCompact(m.received_usd)}</span>
                <span className="md:text-right text-[11px] tabular-nums">
                  {m.deltaPct == null ? <span className="text-ink-faint">—</span> : (
                    <span className={m.deltaPct > 0 ? 'text-danger' : m.deltaPct < 0 ? 'text-success' : 'text-ink-faint'} title={m.priorMonth ? `vs ${monthLabel(m.priorMonth)}` : undefined}>
                      {m.deltaPct > 0 ? '↑' : m.deltaPct < 0 ? '↓' : ''} {Math.abs(m.deltaPct).toFixed(0)}%
                    </span>
                  )}
                </span>
                <ChevronRight size={14} className="justify-self-end self-center text-ink-faint group-hover:text-brand-ink" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

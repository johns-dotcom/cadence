// Cash forecast — 30/60/90-day windows. Committed = unpaid invoices whose
// invoice-anchored due date falls inside the window (overdue included: it's
// still cash you owe). Projected = trailing 4-week intake rate × window. A
// planning aid, not a promise — the caveat says so.
import { money } from '../../utils/money'

const WINDOWS = [
  { key: 'in_30', label: 'Next 30 days', accent: 'text-warning', barA: '#f59e0b', barB: '#fde68a' },
  { key: 'in_60', label: 'Next 60 days', accent: 'text-ink-muted', barA: '#475569', barB: '#cbd5e1' },
  { key: 'in_90', label: 'Next 90 days', accent: 'text-ink-muted', barA: '#475569', barB: '#cbd5e1' },
]

export default function CashForecast({ forecast }) {
  if (!forecast) return null
  const windows = WINDOWS.map(w => {
    const d = forecast[w.key] || { committed: 0, projected: 0 }
    return { ...w, committed: d.committed, projected: d.projected, total: d.committed + d.projected }
  })
  const maxTotal = Math.max(...windows.map(w => w.total), 1)
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Cash forecast</h2>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Committed obligations + projected new invoicing · trailing 4-week rate ≈ <span className="font-semibold text-ink-muted">{money(forecast.weekly_avg_usd)}/week</span>
          </p>
        </div>
        <div className="text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5 mr-3"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#f59e0b' }} /> Committed (invoiced, due)</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#fde68a' }} /> Projected (rate × window)</span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {windows.map(w => {
          const totalPct = (w.total / maxTotal) * 100
          const committedShare = w.total > 0 ? (w.committed / w.total) * 100 : 0
          return (
            <div key={w.key} className="border border-rule rounded-lg p-3.5 bg-elev">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className={`text-[11px] font-bold uppercase tracking-wider ${w.accent}`}>{w.label}</span>
                <span className="text-[10px] text-ink-faint font-semibold">plan for</span>
              </div>
              <p className="text-xl font-bold text-ink tabular-nums mb-2.5">{money(w.total)}</p>
              <div className="h-3 bg-card rounded-full overflow-hidden flex mb-2" style={{ width: `${Math.max(totalPct, 8)}%` }}>
                <div className="h-full rounded-l-full" style={{ width: `${committedShare}%`, background: w.barA }} />
                <div className="h-full rounded-r-full" style={{ width: `${100 - committedShare}%`, background: w.barB }} />
              </div>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="text-ink-muted">Committed</span>
                <span className="font-semibold tabular-nums text-ink">{money(w.committed)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-muted">+ Projected new</span>
                <span className="font-semibold tabular-nums text-ink">{money(w.projected)}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-[10px] text-ink-faint mt-3 pt-3 border-t border-divider">
        Projected assumes new invoicing arrives at the trailing 4-week rate. Treat as a planning aid, not a promise.
      </p>
    </div>
  )
}

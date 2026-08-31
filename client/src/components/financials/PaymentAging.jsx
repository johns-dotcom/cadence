// Payment aging + upcoming due. Left: unpaid invoices grouped by days past
// their INVOICE-ANCHORED due date (invoice_date + payment_terms — not the
// submission-anchored schedule, which hides genuinely-overdue invoices).
// Right: the near-term cash call (due in 7/30/60 days). Every non-empty
// bucket drills to its rows.
import { money } from '../../utils/money'

const BUCKETS = [
  { key: '0-30', drill: 'aging_0_30', label: '0–30 days past due', bar: '#fbbf24' },
  { key: '30-60', drill: 'aging_30_60', label: '30–60 days', bar: '#f97316' },
  { key: '60-90', drill: 'aging_60_90', label: '60–90 days', bar: '#f43f5e' },
  { key: '90+', drill: 'aging_90_plus', label: '90+ days', bar: '#be123c' },
]
const WINDOWS = [
  { key: 'in_7', drill: 'upcoming_7', label: 'Next 7 days', accent: 'text-warning' },
  { key: 'in_30', drill: 'upcoming_30', label: 'Next 30 days', accent: 'text-ink' },
  { key: 'in_60', drill: 'upcoming_60', label: 'Next 60 days', accent: 'text-ink-muted' },
]

export default function PaymentAging({ aging, upcoming, onDrill }) {
  if (!aging || !upcoming) return null
  const overdueTotal = BUCKETS.reduce((s, b) => s + (aging[b.key]?.usd || 0), 0)
  const overdueCount = BUCKETS.reduce((s, b) => s + (aging[b.key]?.count || 0), 0)
  return (
    <div className="card p-5">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6">
        <div>
          <h2 className="text-sm font-bold text-ink">Payment aging</h2>
          <p className="text-[11px] text-ink-faint mt-0.5 mb-4">
            Unpaid invoices past their invoice-anchored due date · {overdueCount} invoice{overdueCount === 1 ? '' : 's'} · {money(overdueTotal)}
          </p>
          {overdueTotal === 0 ? (
            <div className="text-center py-6 text-sm font-semibold text-success bg-brand-500/5 border border-rule rounded-lg">✓ Nothing past due</div>
          ) : (
            <div className="space-y-2">
              {BUCKETS.map(b => {
                const bucket = aging[b.key] || { count: 0, usd: 0 }
                const pct = overdueTotal > 0 ? (bucket.usd / overdueTotal) * 100 : 0
                const clickable = bucket.count > 0 && typeof onDrill === 'function'
                return (
                  <button
                    key={b.key}
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && onDrill(b.drill)}
                    title={clickable ? `View the ${bucket.count} invoice${bucket.count === 1 ? '' : 's'} in this bucket` : undefined}
                    className={`w-full flex items-center gap-3 text-xs text-left rounded-md px-1 py-1 transition-colors ${clickable ? 'hover:bg-elev cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="w-36 shrink-0 font-semibold text-ink-muted">{b.label}</span>
                    <div className="flex-1 h-3 bg-elev rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(pct, bucket.usd > 0 ? 2 : 0)}%`, background: b.bar }} />
                    </div>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tabular-nums bg-elev text-ink-muted border border-rule">{bucket.count}</span>
                    <span className="w-24 text-right font-bold tabular-nums text-ink">{money(bucket.usd)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div className="min-w-[240px] md:border-l md:pl-6 md:border-rule">
          <h2 className="text-sm font-bold text-ink mb-1">Upcoming due</h2>
          <p className="text-[11px] text-ink-faint mb-4">Near-term cash call</p>
          <div className="space-y-1">
            {WINDOWS.map(w => {
              const d = upcoming[w.key] || { count: 0, usd: 0 }
              const clickable = d.count > 0 && typeof onDrill === 'function'
              return (
                <button
                  key={w.key}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onDrill(w.drill)}
                  title={clickable ? `View the ${d.count} invoice${d.count === 1 ? '' : 's'} due in this window` : undefined}
                  className={`w-full flex items-center justify-between gap-3 rounded-md px-1 py-1 transition-colors ${clickable ? 'hover:bg-elev cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="text-xs text-ink-muted">{w.label}</span>
                  <span className="flex items-baseline gap-2">
                    <span className={`text-sm font-bold tabular-nums ${w.accent}`}>{money(d.usd)}</span>
                    <span className="text-[11px] text-ink-faint tabular-nums">{d.count} inv</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

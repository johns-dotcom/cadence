// Top spend — segmented By Artist / By Song / By Category / By Rep switcher
// over share-scaled bars with the unpaid overlay, rank, % of the visible
// total, and family counts. "Unassigned" / "Not assigned" rows stay visible:
// unattributed money is an accountability gap, not noise.
import { useState } from 'react'
import { money, moneyCompact } from '../../utils/money'

const DIMENSIONS = [
  { key: 'artist', label: 'By Artist' },
  { key: 'song', label: 'By Song' },
  { key: 'category', label: 'By Category' },
  { key: 'rep', label: 'By Rep' },
]

export default function BreakdownSection({ breakdowns, reps }) {
  const [dim, setDim] = useState('artist')
  const rows = dim === 'rep' ? (reps || []) : (breakdowns?.[dim] || [])
  const visibleTotal = rows.reduce((s, r) => s + r.total_usd, 0)
  const maxTotal = Math.max(...rows.map(r => r.total_usd), 1)
  const gapLabels = new Set(['Unassigned', 'Not assigned'])
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <h2 className="text-sm font-bold text-ink">Top spend</h2>
          <p className="text-[11px] text-ink-faint mt-0.5">Range-scoped · paid + unpaid committed · top {rows.length}</p>
        </div>
        <div className="flex items-center bg-elev rounded-lg p-1">
          {DIMENSIONS.map(d => (
            <button key={d.key} type="button" onClick={() => setDim(d.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${dim === d.key ? 'bg-card text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted'}`}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-faint py-4">Nothing in this window.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => {
            const pct = visibleTotal > 0 ? (r.total_usd / visibleTotal) * 100 : 0
            const width = (r.total_usd / maxTotal) * 100
            const paidShare = r.total_usd > 0 ? (r.paid_usd / r.total_usd) * 100 : 0
            const isGap = gapLabels.has(r.label)
            return (
              <div key={`${dim}-${r.label}`} className="flex items-center gap-3 text-xs">
                <span className="w-5 text-right text-[10px] text-ink-faint tabular-nums">{i + 1}</span>
                <span className={`w-40 shrink-0 truncate font-semibold ${isGap ? 'text-danger' : 'text-ink-muted'}`} title={r.label}>{r.label}</span>
                <div className="flex-1 h-3.5 bg-elev rounded-full overflow-hidden flex">
                  <div className="h-full" style={{ width: `${(width * paidShare) / 100}%`, background: '#10b981' }} />
                  <div className="h-full" style={{ width: `${(width * (100 - paidShare)) / 100}%`, background: '#f43f5e' }} />
                </div>
                <span className="w-10 text-right text-[10px] text-ink-faint tabular-nums">{pct.toFixed(0)}%</span>
                <span className="w-20 text-right font-bold tabular-nums text-ink" title={`${money(r.paid_usd)} paid · ${money(r.unpaid_usd)} open`}>{moneyCompact(r.total_usd)}</span>
                <span className="w-12 text-right text-[10px] text-ink-faint tabular-nums">{r.row_count} inv</span>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[10px] text-ink-faint mt-3 pt-2 border-t border-divider">
        <span className="inline-flex items-center gap-1 mr-3"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#10b981' }} /> paid</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#f43f5e' }} /> unpaid (committed)</span>
      </p>
    </div>
  )
}

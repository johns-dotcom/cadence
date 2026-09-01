import { Lock } from 'lucide-react'

// The charges themselves — what the bank actually paid the ad platforms.
//
// This table is the evidence behind every number above it. A pool that asks for
// a dollar figure with nothing like this on screen — no charges, no dates, no
// running total — is a pool nobody uses, because any amount typed is
// unfalsifiable. Here the allocation and the money it came out of are visible at
// the same time.
//
// Pure presentation. Every mutation belongs to the page.

const usd = (c) => `$${((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (d) => String(d || '').slice(0, 10)

export default function ChargeTable({ charges = [], highlight = [], onUndo }) {
  if (!charges.length) {
    return <div className="px-3 py-8 text-center text-[13px] text-ink-muted">No ad charges in this month.</div>
  }
  const hot = new Set(highlight)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] font-bold text-ink-muted uppercase tracking-wider border-b border-divider">
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Payee</th>
            <th className="px-3 py-2 text-right">Charge</th>
            <th className="px-3 py-2">Allocated to</th>
            <th className="px-3 py-2 text-right">Unallocated</th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.root_id} className={`border-b border-divider ${hot.has(c.root_id) ? 'bg-brand-500/10' : 'hover:bg-elev'}`}>
              <td className="px-3 py-2 text-ink-muted tabular-nums whitespace-nowrap">{day(c.date)}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-ink">{c.payee}</span>
                <span className="text-[11px] text-ink-faint ml-1.5">{c.category}</span>
                {/* Named, never hidden. A charge this page cannot restructure is
                    still money in the pool, and a total nobody can reproduce is
                    worse than an awkward row. */}
                {!c.allocatable && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-warning" title={c.blocked.join('; ')}>
                    <Lock size={10} /> {c.blocked[0]}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{usd(c.charge_cents)}</td>
              <td className="px-3 py-2">
                {c.allocations.length === 0 && c.attributed.length === 0 && <span className="text-ink-faint">—</span>}
                <div className="flex flex-wrap gap-1.5">
                  {c.allocations.map((a) => (
                    <span key={a.expense_id}
                      className="inline-flex items-center gap-1 text-[11px] bg-elev border border-rule rounded-full pl-2 pr-1 py-0.5">
                      <span className="font-semibold text-ink">{a.artist}</span>
                      {a.song && <span className="text-ink-faint">· {a.song}</span>}
                      <span className="text-ink-muted tabular-nums">{usd(a.cents)}</span>
                      {onUndo && (
                        <button onClick={() => onUndo(a)} title={`Return ${usd(a.cents)} to the pool`}
                          className="text-ink-faint hover:text-danger px-0.5" aria-label="Return to the pool">&times;</button>
                      )}
                    </span>
                  ))}
                  {/* Somebody named these elsewhere in the app, not here. Shown so
                      the arithmetic on the row adds up, without an undo we do not own. */}
                  {c.attributed.map((a) => (
                    <span key={a.expense_id}
                      className="inline-flex items-center gap-1 text-[11px] text-ink-faint border border-dashed border-rule rounded-full px-2 py-0.5"
                      title="Attributed elsewhere in the app, not by this page">
                      {a.artist || 'unnamed'} <span className="tabular-nums">{usd(a.cents)}</span>
                    </span>
                  ))}
                </div>
              </td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${c.open_cents ? 'text-ink' : 'text-success'}`}>
                {c.open_cents ? usd(c.open_cents) : 'done'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

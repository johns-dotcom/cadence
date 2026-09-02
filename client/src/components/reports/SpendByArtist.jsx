// Spend by Artist — operating spend matrix, advances as their OWN column
// beside spend (never folded in: the report answers "what did we spend that
// we can't get back", and folding advances in would break the tie to the
// P&L). Refuses to render when ties_to_pnl fails.

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { money } from '../../utils/money'

const TOPS = [10, 25, 50, 0]
const STICKY_TD = 'sticky left-0 z-10 bg-card shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]'

// Top-N is LIFTED to the page so Export follows the screen. Exporting while
// "Top 10" is displayed and getting every artist is exactly the trap the
// reference app removed by making one value drive both.
export default function SpendByArtist({ data, onDrill, topN = 0, onTopN }) {
  // Category columns come ordered by ARTIST-ATTRIBUTABLE spend, with
  // overhead-only columns pushed to the end and greyed: sorting by the grand
  // total lets overhead lead a sheet whose subject is artists.
  const cats = useMemo(() => {
    if (data.category_order?.length) return data.category_order
    const totals = {}
    for (const r of data.rows) for (const [c, v] of Object.entries(r.by_category)) totals[c] = (totals[c] || 0) + v
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([c]) => ({ category: c, overhead_only: false }))
  }, [data])

  if (!data.ties_to_pnl) {
    return (
      <div className="card p-8 text-center border-rose-300">
        <AlertTriangle size={28} className="text-rose-500 mx-auto mb-3" />
        <p className="text-sm font-bold text-rose-600">Do not present this.</p>
        <p className="text-xs text-ink-muted mt-1">
          The artist rollup ({money(data.total)}) does not tie to the P&L expense total ({money(data.pnl_expense_total)}). Something double-counts or drops rows — fix before trusting any figure on this tab.
        </p>
      </div>
    )
  }

  const named = data.rows.filter((r) => r.key !== '')
  const unattributed = data.rows.find((r) => r.key === '')
  const shown = topN ? named.slice(0, topN) : named
  const rest = topN ? named.slice(topN) : []
  const restKeys = rest.map((r) => r.key)
  const restTotal = rest.reduce((s, r) => s + r.total, 0)
  const restAdv = rest.reduce((s, r) => s + r.advances, 0)

  const drillArtist = (row, cat) => onDrill({
    kind: 'artist', key: row.key, month: null,
    drillCategory: cat || undefined,
    label: `${row.name}${cat ? ` · ${cat}` : ''}`,
    cellTotal: cat ? (cat === 'Advance' ? row.advances : (row.by_category[cat] || 0)) : row.total,
  })

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Operating spend</p><p className="text-2xl font-bold text-ink mt-1">{money(data.total)}</p></div>
        <div className="card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Advances</p><p className="text-2xl font-bold text-ink mt-1">{money(data.advances.total)}</p><p className="text-[11px] text-gray-400">recoupable — beside spend, never inside it</p></div>
        <div className="card p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total out</p><p className="text-2xl font-bold text-ink mt-1">{money(data.total_out)}</p></div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Coverage</p>
          <p className="text-2xl font-bold text-ink mt-1">{data.coverage.pct}%</p>
          <p className="text-[11px] text-gray-400">{money(data.coverage.attributed)} names an artist · {data.coverage.artists} artists</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-3">
        <span className="text-xs text-gray-400 mr-1">Show</span>
        {TOPS.map((n) => (
          <button key={n} onClick={() => onTopN?.(n)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${topN === n ? 'bg-brand-600 text-white border-brand-600' : 'bg-gray-100 text-gray-600 border-transparent'}`}>
            {n === 0 ? 'All artists' : `Top ${n}`}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className={`px-3 py-2 text-left font-semibold min-w-[170px] sticky left-0 z-20 bg-page`}>Artist</th>
              <th className="px-3 py-2 text-right font-semibold">Spend</th>
              <th className="px-3 py-2 text-right font-semibold">Advances</th>
              <th className="px-3 py-2 text-right font-semibold">Total out</th>
              {cats.map((c) => (
                <th key={c.category} className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${c.overhead_only ? 'text-ink-faint' : ''}`}
                  title={c.overhead_only ? 'No artist-attributable spend in this category — it is all overhead' : undefined}>
                  {c.category}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-t border-divider">
                <td className={`px-3 py-1.5 truncate max-w-[220px] ${STICKY_TD}`}>
                  {r.name}
                  {/* Spelling merges are DISCLOSED: "Ezra ×3" says this row also
                      absorbed two other spellings the reader would otherwise
                      hunt for and not find. */}
                  {r.spellings?.length > 1 && (
                    <span className="ml-1 text-[10px] text-ink-faint" title={`Merged spellings: ${r.spellings.join(', ')}`}>×{r.spellings.length}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums"><button className="hover:underline" onClick={() => drillArtist(r)}>{money(r.total)}</button></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.advances ? <button className="hover:underline" onClick={() => drillArtist(r, 'Advance')}>{money(r.advances)}</button> : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{money(r.total_out)}</td>
                {cats.map((c) => (
                  <td key={c.category} className="px-3 py-1.5 text-right tabular-nums">
                    {r.by_category[c.category] ? <button className="hover:underline" onClick={() => drillArtist(r, c.category)}>{money(r.by_category[c.category])}</button> : <span className="text-ink-faint">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {rest.length > 0 && (
              <tr className="border-t border-divider text-gray-500">
                <td className={`px-3 py-1.5 ${STICKY_TD}`}>
                  <button className="hover:underline" onClick={() => onDrill({ kind: 'artist', keys: restKeys, label: `Other artists (${rest.length})`, cellTotal: restTotal })}>
                    Other artists ({rest.length})
                  </button>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(restTotal)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(restAdv)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(restTotal + restAdv)}</td>
                {cats.map((c) => <td key={c.category} />)}
              </tr>
            )}
            {unattributed && (
              <tr className="border-t border-divider text-gray-500 italic">
                <td className={`px-3 py-1.5 ${STICKY_TD}`}>
                  <button className="hover:underline" onClick={() => onDrill({ kind: 'artist', key: '', label: 'Not attributed to an artist', cellTotal: unattributed.total })}>
                    Not attributed to an artist
                  </button>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(unattributed.total)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{unattributed.advances ? money(unattributed.advances) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(unattributed.total_out)}</td>
                {cats.map((c) => (
                  <td key={c.category} className="px-3 py-1.5 text-right tabular-nums">
                    {unattributed.by_category[c.category] ? <button className="hover:underline" onClick={() => drillArtist(unattributed, c.category)}>{money(unattributed.by_category[c.category])}</button> : '—'}
                  </td>
                ))}
              </tr>
            )}
            <tr className="border-t-2 border-rule font-bold">
              <td className={`px-3 py-2 ${STICKY_TD}`}>TOTAL SPEND</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(data.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(data.advances.total)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(data.total_out)}</td>
              {cats.map((c) => <td key={c.category} />)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-sm">
        <p className="font-semibold text-ink mb-2">What this total excludes</p>
        <ul className="space-y-1 text-gray-500 text-xs">
          <li>Below-the-line pass-through (advances shown in their own column): <b>{money(data.excluded.below_line)}</b></li>
          <li>Excluded by review — dismissed items and lines: <b>{money(data.excluded.dismissed.total)}</b> ({data.excluded.dismissed.count})</li>
          <li>Moved out of this range by period adjustments: <b>{money(data.excluded.moved_out.total)}</b> ({data.excluded.moved_out.count})</li>
          <li>Approved but unpaid — committed, not yet cash: <b>{money(data.excluded.unpaid.total)}</b> ({data.excluded.unpaid.count})</li>
          {data.excluded.non_recurring > 0 && <li>Non-recurring one-offs held out of operating results: <b>{money(data.excluded.non_recurring)}</b></li>}
          {data.advances.other_total > 0 && <li>Below-line spend outside the Advance category (not in the Advances column): <b>{money(data.advances.other_total)}</b></li>}
        </ul>
        <p className="text-[11px] text-ink-muted mt-2">
          Advances: {money(data.advances.attributed_total)} of the {money(data.advances.total)} names an artist; the remainder sits on the unattributed row.
          {data.advances.advance_only_artists > 0 && ` ${data.advances.advance_only_artists} artist${data.advances.advance_only_artists === 1 ? '' : 's'} appear${data.advances.advance_only_artists === 1 ? 's' : ''} here only because of an advance — they have no operating spend at all.`}
        </p>
        <p className="text-[11px] text-ink-faint mt-1">Placeholder artist values (N/A, TBD, various…) count as unattributed, never as artists. The rollup ties to the P&L expense total by construction. Export Excel follows this Top-N.</p>
      </div>
    </div>
  )
}

// The invoice rows behind one Financials card — KPI windows, unpaid pipeline,
// aging/upcoming buckets, or a monthly cohort. Window logic lives server-side
// in the SAME module that computed the card, so the footer total ties to the
// number that was clicked. Rows are split SLICES (Cadence's split parent
// keeps only its own slice); each links to its family root on the Ledger.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, X } from 'lucide-react'
import api from '../../api'
import { money, moneyOrig } from '../../utils/money'
import Skeleton from '../Skeleton'
import useEscapeStack from '../../hooks/useEscapeStack'

const monthTitle = (ym) => {
  const [y, m] = (ym || '').split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const BUCKET_META = {
  this_week: { title: 'This week — paid invoices', blurb: 'Paid Monday → today' },
  last_week: { title: 'Last week — paid invoices', blurb: 'Day-matched: Monday → same weekday, one week back' },
  mtd: { title: 'Month-to-date — paid invoices', blurb: 'Paid so far this month' },
  last_mtd: { title: 'Last month — paid invoices', blurb: 'Same day-of-month range, last month' },
  ytd: { title: 'Year-to-date — paid invoices', blurb: 'Paid so far this year' },
  last_ytd: { title: 'Last year — paid invoices', blurb: 'Same period, last year' },
  unpaid: { title: 'Unpaid pipeline', blurb: 'Every outstanding approved invoice, largest first' },
  aging_0_30: { title: '0–30 days past due', blurb: 'Unpaid, 1–30 days past the invoice-anchored due date' },
  aging_30_60: { title: '30–60 days past due', blurb: 'Unpaid, 31–60 days past due' },
  aging_60_90: { title: '60–90 days past due', blurb: 'Unpaid, 61–90 days past due' },
  aging_90_plus: { title: '90+ days past due', blurb: 'Unpaid, more than 90 days past due — escalate' },
  upcoming_7: { title: 'Due in the next 7 days', blurb: 'Unpaid, due within a week — near-term cash call' },
  upcoming_30: { title: 'Due in the next 30 days', blurb: 'Unpaid, due within a month' },
  upcoming_60: { title: 'Due in the next 60 days', blurb: 'Unpaid, due within two months' },
}
const metaFor = (bucket) =>
  BUCKET_META[bucket] ||
  (bucket?.startsWith('month_')
    ? { title: `${monthTitle(bucket.slice(6))} — intake cohort`, blurb: 'Everything that entered the books this month, paid or not' }
    : { title: bucket, blurb: '' })

export default function KpiDrillModal({ bucket, filters, onClose }) {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  useEscapeStack(true, onClose)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const params = { bucket }
    for (const k of ['artist', 'category', 'rep']) if (filters?.[k]) params[k] = filters[k]
    api.get('/financials/exec/rows', { params })
      .then(r => { if (!cancelled) setPayload(r.data?.data || null) })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || 'Failed to load rows') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bucket]) // eslint-disable-line

  const meta = metaFor(bucket)
  const rows = payload?.rows || []
  const isOverdueish = bucket === 'unpaid' || bucket.startsWith('aging_')
  const isUpcoming = bucket.startsWith('upcoming_')
  const rangeText = payload?.from && payload?.to ? `${payload.from} → ${payload.to}` : ''

  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-bold text-ink">{meta.title}</h3>
            <p className="text-xs text-ink-faint mt-0.5">{meta.blurb}{rangeText ? ` · ${rangeText}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={18} /></button>
        </div>

        {loading ? <Skeleton.Table rows={6} cols={5} /> : error ? (
          <p className="text-sm text-danger p-4">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-faint text-center py-8">No invoices in this window.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-ink-faint">
                    <th className="text-left font-semibold py-2">Date</th>
                    <th className="text-left font-semibold py-2">Vendor</th>
                    <th className="text-left font-semibold py-2">Artist</th>
                    <th className="text-left font-semibold py-2">Category</th>
                    <th className="text-right font-semibold py-2">Amount</th>
                    {isOverdueish && <th className="text-right font-semibold py-2">Overdue</th>}
                    {isUpcoming && <th className="text-right font-semibold py-2">Due in</th>}
                    <th className="text-left font-semibold py-2 pl-3">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.expense_id} className="border-b border-divider hover:bg-elev">
                      <td className="py-2 text-ink-muted tabular-nums whitespace-nowrap">{r.date || '—'}</td>
                      <td className="py-2 font-semibold text-ink max-w-[220px]">
                        <span className="truncate block" title={r.payee}>
                          {r.payee || '—'}
                          {r.split_of && <span className="ml-1.5 text-[10px] font-normal text-ink-faint" title="One slice of a split invoice — the total lives on the family root">part of a split</span>}
                        </span>
                        {r.invoice_number && <span className="text-[10px] font-normal text-ink-faint">#{r.invoice_number}</span>}
                      </td>
                      <td className="py-2 text-ink-muted truncate max-w-[150px]" title={r.artist}>{r.artist || '—'}</td>
                      <td className="py-2 text-ink-muted truncate max-w-[130px]">{r.category || '—'}</td>
                      <td className="py-2 text-right font-bold tabular-nums text-ink whitespace-nowrap">
                        {money(r.usd)}
                        {r.currency && r.currency !== 'USD' && <span className="block text-[10px] font-normal text-ink-faint">{moneyOrig(r.amount, r.currency)}</span>}
                      </td>
                      {isOverdueish && (
                        <td className={`py-2 text-right tabular-nums ${(r.days_overdue || 0) > 30 ? 'text-danger font-bold' : 'text-ink-muted'}`}>
                          {(r.days_overdue || 0) > 0 ? `${r.days_overdue}d` : '—'}
                        </td>
                      )}
                      {isUpcoming && (
                        <td className={`py-2 text-right tabular-nums ${(r.days_until_due ?? 99) <= 7 ? 'text-warning font-bold' : 'text-ink-muted'}`}>
                          {r.days_until_due != null ? `${r.days_until_due}d` : '—'}
                        </td>
                      )}
                      <td className="py-2 pl-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${r.payment_status === 'Paid' ? 'bg-brand-500/10 text-success' : 'bg-brand-500/10 text-danger'}`}>
                          {r.payment_status || 'Unpaid'}
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Link to={`/ledger?focus=${r.root_id}`} className="text-ink-faint hover:text-ink inline-flex" title="Open on the Ledger"><ExternalLink size={12} /></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-rule text-xs">
              <span className="text-ink-muted">
                {payload.row_count} row{payload.row_count === 1 ? '' : 's'}
                {payload.truncated ? ` · showing first ${rows.length} — the total covers all of them` : ''}
              </span>
              <span className="font-bold text-ink tabular-nums">Total {money(payload.total_usd)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

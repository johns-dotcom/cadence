// One month at a glance — the drill page behind a Financials monthly-rollup row.
//
// ANCHOR: the intake cohort (the day a row entered the books), identical to the
// rollup row this page is opened from and to the `month_YYYY-MM` drill bucket.
// Any other anchor and the page total would contradict the number that was
// clicked. Because paid + open = received by construction under that recipe,
// the fourth stat card is CASH OUT — money whose payment date falls in this
// calendar month, a different set of rows entirely (older invoices paid now,
// minus this month's invoices paid later). The two bases are never summed.
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Search, ExternalLink } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../api'
import Skeleton from '../components/Skeleton'
import PayeeLink from '../components/PayeeLink'
import { money, moneyCompact } from '../utils/money'
import { AXIS_TICK, TOOLTIP, GRID_STROKE } from '../utils/chartTheme'

const PAID = '#10b981'
const OPEN = '#f43f5e'
// Categories below this share of an artist's month fold away behind a toggle —
// a 0.3% row is noise in a mix meant to answer "what did we buy".
const CATEGORY_MIN_SHARE = 0.01

const monthLabel = (ym) => {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return ym || ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
const dayNum = (iso) => Number(String(iso || '').slice(8, 10)) || 0

// Every card here measures spend, so one polarity rule covers all of them:
// up is more money out. No per-card inversion to get wrong.
function MonthDelta({ current, prior, priorMonth }) {
  if (!prior || prior <= 0) return null
  const pct = ((current - prior) / prior) * 100
  if (!Number.isFinite(pct)) return null
  const up = pct >= 0
  return (
    <span className={`text-[11px] font-bold ${up ? 'text-danger' : 'text-success'}`} title={`vs ${monthLabel(priorMonth)} (${money(prior)})`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

function MonthStatCard({ label, value, delta, sub, tone = 'text-ink' }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
        {delta}
      </div>
      {sub && <p className="text-[11px] text-ink-faint mt-1">{sub}</p>}
    </div>
  )
}

function ShareBar({ pct }) {
  return (
    <div className="h-1.5 w-full bg-elev rounded-full overflow-hidden">
      <div className="h-full bg-brand-600" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

function DayTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0]?.payload || {}
  return (
    <div style={TOOLTIP.contentStyle}>
      <p style={{ ...TOOLTIP.labelStyle, marginBottom: 4 }}>{label}</p>
      <p style={TOOLTIP.itemStyle}>Paid {money(row.paid_usd)}</p>
      <p style={TOOLTIP.itemStyle}>Open {money(row.unpaid_usd)}</p>
      <p style={{ ...TOOLTIP.itemStyle, fontWeight: 700 }}>Total {money(row.received_usd)}</p>
      <p style={TOOLTIP.labelStyle}>{row.received_count} invoice{row.received_count === 1 ? '' : 's'}</p>
    </div>
  )
}

// Per-artist category mix. Arrives nested in the same payload as the row it
// expands from — one pull, so the mix cannot disagree with its parent total.
function CategoryMix({ artist }) {
  const [showAll, setShowAll] = useState(false)
  const total = artist.total_usd || 0
  const rows = artist.categories || []
  const big = rows.filter(c => total > 0 && c.total_usd / total >= CATEGORY_MIN_SHARE)
  const small = rows.filter(c => !(total > 0 && c.total_usd / total >= CATEGORY_MIN_SHARE))
  const shown = showAll ? rows : (big.length ? big : rows)
  const hidden = showAll ? 0 : (big.length ? small.length : 0)
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#a3a3a3']

  if (!rows.length) return <p className="text-[11px] text-ink-faint px-4 py-3">No categorised spend for this artist.</p>
  return (
    <div className="px-4 py-3 bg-elev/60">
      <div className="h-2 w-full rounded-full overflow-hidden flex mb-3">
        {rows.map((c, i) => (
          <div key={c.category} title={`${c.category} — ${money(c.total_usd)}`}
            style={{ width: `${total > 0 ? (c.total_usd / total) * 100 : 0}%`, background: palette[i % palette.length] }} />
        ))}
      </div>
      <div className="space-y-1">
        {shown.map((c, i) => (
          <div key={c.category} className="flex items-center gap-3 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: palette[rows.indexOf(c) % palette.length] }} />
            <span className="flex-1 truncate text-ink-muted font-semibold" title={c.category}>{c.category}</span>
            <span className="w-12 text-right text-ink-faint tabular-nums">{total > 0 ? ((c.total_usd / total) * 100).toFixed(0) : 0}%</span>
            <span className="w-24 text-right tabular-nums text-success font-semibold">{money(c.paid_usd)}</span>
            <span className="w-24 text-right tabular-nums text-danger">{c.unpaid_usd > 0 ? `+${money(c.unpaid_usd)} owed` : ''}</span>
            <span className="w-14 text-right text-ink-faint tabular-nums">{c.row_count} inv</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-[11px] font-semibold text-brand-ink hover:underline">
          +{hidden} more &lt; 1% · click to show
        </button>
      )}
    </div>
  )
}

const SORTS = {
  label: (a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: 'base' }),
  paid_usd: (a, b) => b.paid_usd - a.paid_usd,
  unpaid_usd: (a, b) => b.unpaid_usd - a.unpaid_usd,
  total_usd: (a, b) => b.total_usd - a.total_usd,
  row_count: (a, b) => b.row_count - a.row_count,
}

export default function FinancialsMonth() {
  const { month } = useParams()
  const [params] = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState('total_usd')
  const [sortDir, setSortDir] = useState('desc')
  const [openArtist, setOpenArtist] = useState(null)

  // The rollup's scope travels with the link, so a filtered Financials page
  // drills into a filtered month rather than silently widening.
  const scope = useMemo(() => {
    const p = {}
    for (const k of ['artist', 'category', 'rep']) { const v = params.get(k); if (v) p[k] = v }
    return p
  }, [params])
  const scopeQuery = useMemo(() => {
    const s = new URLSearchParams(scope).toString()
    return s ? `?${s}` : ''
  }, [scope])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null); setOpenArtist(null); setQ('')
    api.get(`/financials/month/${month}`, { params: scope })
      .then(r => { if (!cancelled) setData(r.data?.data || null) })
      .catch(err => { if (!cancelled) setError(err.response?.data?.error || 'Failed to load this month.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [month, scopeQuery]) // eslint-disable-line

  const s = data?.summary
  const prior = data?.prior
  const artistRows = useMemo(() => {
    const rows = (data?.artists || []).filter(a => !q.trim() || String(a.label).toLowerCase().includes(q.trim().toLowerCase()))
    const cmp = SORTS[sortKey] || SORTS.total_usd
    const sorted = [...rows].sort(cmp)
    return sortDir === 'desc' ? sorted : sorted.reverse()
  }, [data, q, sortKey, sortDir])

  const toggleSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }
  const SortHeader = ({ label, keyName, className = '' }) => (
    <button type="button" onClick={() => toggleSort(keyName)} title={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold ${sortKey === keyName ? 'text-ink-muted' : 'text-ink-faint hover:text-ink-muted'} ${className}`}>
      {label}{sortKey === keyName && <span className="text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )

  const back = (
    <Link to="/financials" className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-faint hover:text-ink mb-3">
      <ArrowLeft size={13} /> Back to Financials
    </Link>
  )

  if (loading) {
    return (
      <div>
        {back}
        <Skeleton.PageHeader />
        <Skeleton.StatCards count={4} />
        <div className="mt-6"><Skeleton.Block h="h-56" /></div>
        <div className="mt-6"><Skeleton.Table rows={6} cols={6} /></div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div>
        {back}
        <div className="card p-8 text-center">
          <p className="text-sm text-danger font-semibold">{error || 'No data for this month.'}</p>
          <p className="text-xs text-ink-faint mt-1">Months are addressed as YYYY-MM, for example 2026-06.</p>
        </div>
      </div>
    )
  }

  const categoriesTotal = (data.categories || []).reduce((acc, c) => acc + c.total_usd, 0)
  const vendorsMax = Math.max(...(data.vendors || []).map(v => v.total_usd), 1)

  return (
    <div>
      {back}

      {/* Month-hop header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight">{monthLabel(data.month)}</h1>
          <p className="text-sm text-ink-muted mt-1">
            {s.invoice_count} invoice{s.invoice_count === 1 ? '' : 's'} across {s.artist_count} artist{s.artist_count === 1 ? '' : 's'} and {s.vendor_count} vendor{s.vendor_count === 1 ? '' : 's'}
            {data.filters?.applied && <span className="text-ink-faint"> · scoped by {[data.filters.artist, data.filters.category, data.filters.rep].filter(Boolean).join(' · ')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/financials/month/${data.prev_month}${scopeQuery}`} title={monthLabel(data.prev_month)}
            className="btn-secondary !px-2.5 !py-1.5 inline-flex items-center gap-1 text-xs">
            <ChevronLeft size={14} /> {monthLabel(data.prev_month)}
          </Link>
          <Link to={`/financials/month/${data.next_month}${scopeQuery}`} title={monthLabel(data.next_month)}
            className="btn-secondary !px-2.5 !py-1.5 inline-flex items-center gap-1 text-xs">
            {monthLabel(data.next_month)} <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MonthStatCard label="Received this month" value={money(s.received_usd)}
          delta={<MonthDelta current={s.received_usd} prior={prior.received_usd} priorMonth={prior.month} />}
          sub={`Avg invoice ${money(s.avg_invoice_usd)}`} />
        <MonthStatCard label="Paid" value={money(s.paid_usd)} tone="text-success"
          delta={<MonthDelta current={s.paid_usd} prior={prior.paid_usd} priorMonth={prior.month} />}
          sub={s.received_usd > 0 ? `${((s.paid_usd / s.received_usd) * 100).toFixed(0)}% of the cohort` : 'Nothing received'} />
        <MonthStatCard label="Still open" value={money(s.unpaid_usd)} tone="text-danger"
          delta={<MonthDelta current={s.unpaid_usd} prior={prior.unpaid_usd} priorMonth={prior.month} />}
          sub={s.received_usd > 0 ? `${((s.unpaid_usd / s.received_usd) * 100).toFixed(0)}% of the cohort` : '—'} />
        <MonthStatCard label="Cash out in the month" value={money(s.cash_out_usd)}
          delta={<MonthDelta current={s.cash_out_usd} prior={prior.cash_out_usd} priorMonth={prior.month} />}
          sub={`${s.cash_out_count} invoice${s.cash_out_count === 1 ? '' : 's'} paid — payment-date basis, not the cohort`} />
      </div>

      {/* Daily activity */}
      <div className="card p-5 mt-6">
        <h2 className="text-sm font-bold text-ink">Daily activity</h2>
        <p className="text-[11px] text-ink-faint mt-0.5 mb-3">
          Invoices by the day they entered the books, <span className="font-semibold text-success">paid</span> vs <span className="font-semibold text-danger">still open</span>. Quiet days are shown so the shape of the month is honest.
        </p>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={dayNum} interval={2} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickFormatter={moneyCompact} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<DayTooltip />} cursor={TOOLTIP.cursor} />
              <Bar dataKey="paid_usd" stackId="d" fill={PAID} radius={[0, 0, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="unpaid_usd" stackId="d" fill={OPEN} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By artist */}
      <div className="card p-5 mt-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <h2 className="text-sm font-bold text-ink">By artist</h2>
            <p className="text-[11px] text-ink-faint mt-0.5">Click a row for its category mix.</p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input !py-1.5 !pl-8 !pr-2 w-56 text-xs" placeholder="Search artists…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>

        {artistRows.length === 0 ? (
          <p className="text-center text-xs text-ink-faint py-6">{q.trim() ? 'No artist matches that search.' : 'No spend recorded this month.'}</p>
        ) : (
          <>
            <div className="hidden md:flex items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-ink-faint border-b border-rule">
              <span className="w-6" />
              <span className="w-44"><SortHeader label="Artist" keyName="label" /></span>
              <span className="flex-1">Share of month</span>
              <span className="w-24 text-right"><SortHeader label="Paid" keyName="paid_usd" className="justify-end" /></span>
              <span className="w-24 text-right"><SortHeader label="Open" keyName="unpaid_usd" className="justify-end" /></span>
              <span className="w-24 text-right"><SortHeader label="Total" keyName="total_usd" className="justify-end" /></span>
              <span className="w-16 text-right"><SortHeader label="Rows" keyName="row_count" className="justify-end" /></span>
              <span className="w-4" />
            </div>
            <div className="divide-y divide-divider">
              {artistRows.map((a, i) => {
                const id = a.key || '__unassigned__'
                const open = openArtist === id
                const pct = s.received_usd > 0 ? (a.total_usd / s.received_usd) * 100 : 0
                return (
                  <div key={id}>
                    <button type="button" onClick={() => setOpenArtist(open ? null : id)}
                      className="w-full text-left flex flex-col md:flex-row md:items-center gap-2 md:gap-3 px-3 py-2.5 hover:bg-elev transition-colors">
                      <span className="w-6 text-[10px] text-ink-faint tabular-nums">{i + 1}</span>
                      <span className={`w-44 truncate text-sm font-semibold ${a.key ? 'text-ink' : 'text-danger'}`} title={a.label}>{a.label}</span>
                      <span className="flex-1 flex items-center gap-2">
                        <span className="flex-1"><ShareBar pct={pct} /></span>
                        <span className="w-10 text-right text-[10px] text-ink-faint tabular-nums">{pct.toFixed(0)}%</span>
                      </span>
                      <span className="w-24 text-right text-xs font-semibold tabular-nums text-success">{moneyCompact(a.paid_usd)}</span>
                      <span className="w-24 text-right text-xs font-semibold tabular-nums text-danger">{moneyCompact(a.unpaid_usd)}</span>
                      <span className="w-24 text-right text-xs font-bold tabular-nums text-ink">{money(a.total_usd)}</span>
                      <span className="w-16 text-right text-[11px] text-ink-faint tabular-nums">{a.row_count}</span>
                      <ChevronDown size={14} className={`w-4 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && <CategoryMix artist={a} />}
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-ink-faint mt-3">
              {artistRows.length} of {(data.artists || []).length} artist{(data.artists || []).length === 1 ? '' : 's'} · avg invoice {money(s.avg_invoice_usd)}
              {data.artists_truncated && <span className="text-warning"> · showing the top {(data.artists || []).length} of {data.artists_truncated}</span>}
            </p>
          </>
        )}
      </div>

      {/* Category + vendors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">By category</h2>
          {(data.categories || []).length === 0 ? (
            <p className="text-xs text-ink-faint py-4">Nothing categorised this month.</p>
          ) : (
            <div className="space-y-1.5">
              {data.categories.map(c => {
                const pct = categoriesTotal > 0 ? (c.total_usd / categoriesTotal) * 100 : 0
                return (
                  <div key={c.label} className="flex items-center gap-3 text-xs">
                    <span className="w-36 shrink-0 truncate font-semibold text-ink-muted" title={c.label}>{c.label}</span>
                    <span className="flex-1"><ShareBar pct={pct} /></span>
                    <span className="w-10 text-right text-[10px] text-ink-faint tabular-nums">{pct.toFixed(0)}%</span>
                    <span className="w-20 text-right font-bold tabular-nums text-ink" title={`${money(c.paid_usd)} paid · ${money(c.unpaid_usd)} open`}>{moneyCompact(c.total_usd)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink">Top vendors</h2>
          <p className="text-[11px] text-ink-faint mt-0.5 mb-3">Top {(data.vendors || []).length} of {data.vendor_total} billing this month.</p>
          {(data.vendors || []).length === 0 ? (
            <p className="text-xs text-ink-faint py-4">No vendors billed this month.</p>
          ) : (
            <div className="space-y-1.5">
              {data.vendors.map((v, i) => (
                <div key={v.label} className="flex items-center gap-3 text-xs">
                  <span className="w-5 text-right text-[10px] text-ink-faint tabular-nums">{i + 1}</span>
                  <span className="w-40 shrink-0 truncate font-semibold text-ink-muted">
                    <PayeeLink payee={v.label === 'No vendor' ? '' : v.label} className="text-ink-muted">{v.label}</PayeeLink>
                  </span>
                  <span className="flex-1"><ShareBar pct={(v.total_usd / vendorsMax) * 100} /></span>
                  <span className="w-12 text-right text-[10px] text-ink-faint tabular-nums">{v.row_count} inv</span>
                  <span className="w-20 text-right font-bold tabular-nums text-ink">{moneyCompact(v.total_usd)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top invoices */}
      <div className="card p-5 mt-6">
        <h2 className="text-sm font-bold text-ink">Biggest invoices</h2>
        <p className="text-[11px] text-ink-faint mt-0.5 mb-3">
          Largest {(data.top_invoices || []).length} of {data.top_invoices_of} by USD-equivalent. Split invoices are summed back to the billed total.
        </p>
        {(data.top_invoices || []).length === 0 ? (
          <p className="text-xs text-ink-faint py-4">No invoices this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-ink-faint">
                  <th className="text-left font-semibold py-2">Date</th>
                  <th className="text-left font-semibold py-2">Vendor</th>
                  <th className="text-left font-semibold py-2">Artist</th>
                  <th className="text-left font-semibold py-2">Category</th>
                  <th className="text-right font-semibold py-2">Amount</th>
                  <th className="text-left font-semibold py-2 pl-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.top_invoices.map(r => (
                  <tr key={r.root_id} className="border-b border-divider hover:bg-elev">
                    <td className="py-2 text-ink-muted tabular-nums whitespace-nowrap">{r.date}</td>
                    <td className="py-2 font-semibold text-ink max-w-[220px]">
                      <span className="truncate block"><PayeeLink payee={r.payee} className="text-ink">{r.payee || '—'}</PayeeLink></span>
                      {r.invoice_number && <span className="text-[10px] font-normal text-ink-faint">#{r.invoice_number}</span>}
                    </td>
                    <td className="py-2 text-ink-muted truncate max-w-[150px]" title={r.artist || ''}>{r.artist || '—'}</td>
                    <td className="py-2 text-ink-muted truncate max-w-[150px]" title={r.category || ''}>{r.category || '—'}</td>
                    <td className="py-2 text-right font-bold tabular-nums text-ink whitespace-nowrap">{money(r.usd)}</td>
                    <td className="py-2 pl-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand-500/10 ${r.payment_status === 'Paid' ? 'text-success' : 'text-danger'}`}>
                        {r.payment_status}
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
        )}
      </div>

      <p className="text-[11px] text-ink-faint mt-4">
        USD-equivalent throughout, locked FX honoured, rounded at the row. Split slices are summed once; the invoice table rolls them back to the family total.
        Everything except “Cash out” is the intake cohort for {monthLabel(data.month)} — do not add the two together.
      </p>
    </div>
  )
}

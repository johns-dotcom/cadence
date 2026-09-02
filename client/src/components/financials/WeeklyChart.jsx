// Weekly spend & intake — grouped paid (payment_date) vs open-billing
// (invoice_date) bars, received-$ line (submission date), trailing-4-week
// moving average of cash out, and an average reference line. The three series
// sit on THREE different date bases — the tooltip and subtitle say so out
// loud, and nothing here sums across them.
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'
import { money, moneyCompact } from '../../utils/money'
import { AXIS_TICK } from '../../utils/chartTheme'

const C = { paid: '#10b981', unpaid: '#f43f5e', received: '#0ea5e9', ma: '#f59e0b', avg: '#94a3b8' }

const fmtWeek = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`
}

export default function WeeklyChart({ weeks }) {
  const raw = (weeks || []).map(w => ({
    label: fmtWeek(w.week_start),
    week_start: w.week_start,
    paid: Number(w.paid_usd) || 0,
    unpaid: Number(w.unpaid_usd) || 0,
    received_usd: Number(w.received_usd) || 0,
    received_count: Number(w.received_count) || 0,
  }))
  // Trailing-4-week MA of CASH OUT only — paid+unpaid would average two
  // different date bases into a meaningless number.
  const data = raw.map((w, i) => {
    if (i < 3) return { ...w, ma4: null }
    let sum = 0
    for (let k = i - 3; k <= i; k++) sum += raw[k].paid
    return { ...w, ma4: sum / 4 }
  })
  const totals = data.reduce((a, w) => ({
    paid: a.paid + w.paid, unpaid: a.unpaid + w.unpaid,
    received_usd: a.received_usd + w.received_usd, received_count: a.received_count + w.received_count,
  }), { paid: 0, unpaid: 0, received_usd: 0, received_count: 0 })
  const avgPerWeek = data.length ? totals.paid / data.length : 0
  const biggest = data.reduce((best, w) => (w.paid > (best?.paid || 0) ? w : best), null)

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload
    return (
      <div className="bg-card border border-rule rounded-lg shadow-md px-3 py-2 text-xs" style={{ minWidth: 250 }}>
        <p className="font-semibold text-ink mb-1.5">Week of {row.week_start}</p>
        <div className="grid gap-y-1" style={{ gridTemplateColumns: '1fr auto' }}>
          <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: C.paid }} /> Cash out <span className="text-[9px] text-ink-faint">(paid this week)</span></span>
          <span className="font-semibold text-ink tabular-nums text-right">{money(row.paid)}</span>
          <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: C.unpaid }} /> Open billing <span className="text-[9px] text-ink-faint">(invoiced, still open)</span></span>
          <span className="font-semibold text-ink tabular-nums text-right">{money(row.unpaid)}</span>
          <span className="inline-flex items-center gap-1.5 text-ink-muted pt-1 border-t border-divider"><span className="inline-block w-3 h-0.5" style={{ background: C.received }} /> Received <span className="text-[9px] text-ink-faint">({row.received_count} submitted)</span></span>
          <span className="font-semibold text-ink tabular-nums text-right pt-1 border-t border-divider">{money(row.received_usd)}</span>
        </div>
        <p className="text-[10px] text-ink-faint pt-1 leading-tight mt-1">Three different date bases — don't sum the bars.</p>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-bold text-ink">Weekly spend &amp; intake</h2>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {data.length} weeks · USD-equivalent · <span className="text-ink-muted">cash out (paid) and new billing (invoiced) side-by-side — different date bases, don't sum them.</span>
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] flex-wrap">
          <span className="text-ink-faint">Cash out <span className="font-bold tabular-nums text-success">{moneyCompact(totals.paid)}</span></span>
          <span className="text-ink-faint">Open billing <span className="font-bold tabular-nums text-danger">{moneyCompact(totals.unpaid)}</span></span>
          <span className="text-ink-faint">Received <span className="font-bold tabular-nums" style={{ color: C.received }}>{totals.received_count} · {moneyCompact(totals.received_usd)}</span></span>
          <span className="text-ink-faint">Avg / wk <span className="font-bold tabular-nums text-ink">{moneyCompact(avgPerWeek)}</span></span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS_TICK} tickFormatter={moneyCompact} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
          {avgPerWeek > 0 && (
            <ReferenceLine y={avgPerWeek} stroke={C.avg} strokeDasharray="4 4"
              label={{ value: `avg ${moneyCompact(avgPerWeek)}`, position: 'insideTopLeft', offset: 8, fontSize: 10, fill: C.avg }} />
          )}
          <Bar dataKey="paid" fill={C.paid} radius={[3, 3, 0, 0]} />
          <Bar dataKey="unpaid" fill={C.unpaid} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="ma4" stroke={C.ma} strokeWidth={2} dot={false} activeDot={false} connectNulls={false} />
          <Line type="monotone" dataKey="received_usd" stroke={C.received} strokeWidth={2} dot={{ r: 2.5, fill: C.received, strokeWidth: 0 }} activeDot={{ r: 4 }} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-ink-muted flex-wrap">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C.paid }} /> Cash out <span className="text-ink-faint">(by payment date)</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C.unpaid }} /> Open billing <span className="text-ink-faint">(by invoice date, still open)</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: C.received }} /> Received $ <span className="text-ink-faint">(new invoicing per week)</span></span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-0.5" style={{ background: C.ma }} /> 4-week MA of cash out</span>
      </div>
      {biggest && biggest.paid > 0 && (
        <p className="text-[11px] text-ink-muted mt-3 pt-3 border-t border-divider">
          Biggest cash-out week: <span className="font-semibold text-ink">{biggest.week_start}</span> at <span className="font-bold text-ink tabular-nums">{money(biggest.paid)}</span> paid.
        </p>
      )}
    </div>
  )
}

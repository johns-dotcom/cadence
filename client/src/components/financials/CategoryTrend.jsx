// Category composition trend — stacked monthly category mix over the range
// (top 8 categories, remainder in "Other"). The breakdown gives ranking;
// this gives composition change over time.
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { money, moneyCompact } from '../../utils/money'

const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#a855f7', '#f43f5e', '#84cc16', '#94a3b8']
const colorFor = (cat, i) => (cat === 'Other' ? COLORS[COLORS.length - 1] : COLORS[i % (COLORS.length - 1)])

const shortMonth = (ym) => {
  const [y, m] = (ym || '').split('-').map(Number)
  if (!y || !m) return ym
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function CategoryTrend({ trend }) {
  if (!trend?.months?.length || !trend?.categories?.length) return null
  const data = trend.months.map(row => ({ ...row, label: shortMonth(row.month) }))
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-bold text-ink">Category composition</h2>
        <p className="text-[11px] text-ink-faint">{data.length} months · USD-equivalent · commitment-dated</p>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={moneyCompact} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            formatter={(v, key) => [money(v), key]}
            labelFormatter={(l, payload) => payload?.[0]?.payload?.month || l}
            contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          {trend.categories.map((cat, i) => (
            <Area key={cat} type="monotone" dataKey={cat} stackId="1" stroke={colorFor(cat, i)} fill={colorFor(cat, i)} fillOpacity={0.7} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-ink-muted">
        {trend.categories.map((cat, i) => (
          <span key={cat} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colorFor(cat, i) }} />{cat}
          </span>
        ))}
      </div>
    </div>
  )
}

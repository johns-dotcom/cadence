// Financials — the operational executive spend view (commitment basis: every
// approved invoice counts, paid or not, and every figure carries the
// paid/unpaid split). Cash-basis accounting depth lives on /reports; the
// basis row below the header says so out loud.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, Download, Calendar, Loader } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { CURRENCIES } from '../constants'
import ReconciledBadge from '../components/statements/ReconciledBadge'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { money, moneyCompact } from '../utils/money'
import WeeklyChart from '../components/financials/WeeklyChart'
import PaymentAging from '../components/financials/PaymentAging'
import CashForecast from '../components/financials/CashForecast'
import MonthlyRollup from '../components/financials/MonthlyRollup'
import BreakdownSection from '../components/financials/BreakdownSection'
import CategoryTrend from '../components/financials/CategoryTrend'
import KpiDrillModal from '../components/financials/KpiDrillModal'

const INCOME_SOURCES = ['Streaming', 'Sync', 'Physical', 'YouTube', 'Merch', 'Performance', 'Publishing', 'Other']
const PIE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#a3a3a3']

// ── Range picker — 3m/6m/12m presets + custom from/to, persisted ───────────
const RANGE_KEY = 'financials-range-v1'
const PRESETS = [
  { key: '3m', label: '3m', months: 3 },
  { key: '6m', label: '6m', months: 6 },
  { key: '12m', label: '12m', months: 12 },
]
function loadRange() {
  try {
    const v = JSON.parse(localStorage.getItem(RANGE_KEY) || 'null')
    if (v && typeof v === 'object' && v.preset) return v
  } catch { /* fall through */ }
  return { preset: '6m', customFrom: '', customTo: '' }
}
function useRange() {
  const [range, setRangeRaw] = useState(loadRange)
  const setRange = (next) => {
    setRangeRaw(next)
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(next)) } catch { /* best effort */ }
  }
  const derived = useMemo(() => {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (range.preset === 'custom') return { from: range.customFrom || null, to: range.customTo || null }
    const preset = PRESETS.find(p => p.key === range.preset) || PRESETS[1]
    const today = new Date()
    const from = new Date(today); from.setMonth(from.getMonth() - preset.months)
    return { from: iso(from), to: iso(today) }
  }, [range])
  return { range, setRange, derived }
}

function RangePicker({ range, setRange, derived }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center bg-elev rounded-xl p-1">
        {PRESETS.map(p => (
          <button key={p.key} type="button" onClick={() => setRange({ ...range, preset: p.key })}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${range.preset === p.key ? 'bg-card text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted'}`}>
            {p.label}
          </button>
        ))}
        <button type="button"
          onClick={() => setRange({ ...range, preset: 'custom', customFrom: range.customFrom || derived.from || '', customTo: range.customTo || derived.to || '' })}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1 ${range.preset === 'custom' ? 'bg-card text-ink shadow-sm' : 'text-ink-faint hover:text-ink-muted'}`}>
          <Calendar size={12} /> Custom
        </button>
      </div>
      {range.preset === 'custom' && (
        <div className="flex items-center gap-2 text-xs">
          <input type="date" className="input !py-1 !px-2 w-auto" value={range.customFrom} onChange={e => setRange({ ...range, preset: 'custom', customFrom: e.target.value })} />
          <span className="text-ink-faint">→</span>
          <input type="date" className="input !py-1 !px-2 w-auto" value={range.customTo} onChange={e => setRange({ ...range, preset: 'custom', customTo: e.target.value })} />
        </div>
      )}
    </div>
  )
}

// ── KPI card (sparkline + day-matched % delta + drill) ──────────────────────
function DeltaChip({ current, prior }) {
  if (!prior) return null
  const pct = ((current - prior) / prior) * 100
  if (!Number.isFinite(pct)) return null
  const up = pct >= 0
  return <span className={`text-[11px] font-bold ${up ? 'text-danger' : 'text-success'}`}>{up ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}%</span>
}
function KpiCard({ label, value, delta, sub, sparkline, sparkColor = '#10b981', onClick }) {
  const Wrap = onClick ? 'button' : 'div'
  const gid = `spark-${label.replace(/\W+/g, '')}`
  return (
    <Wrap type={onClick ? 'button' : undefined} onClick={onClick}
      className={`card p-4 relative overflow-hidden text-left w-full ${onClick ? 'hover:shadow-sm cursor-pointer transition-all' : ''}`}>
      <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wider">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <p className="text-2xl font-bold text-ink tabular-nums">{value}</p>
        {delta}
      </div>
      {sub && <p className="text-[11px] text-ink-faint mt-1">{sub}</p>}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2 -mx-1 -mb-1" style={{ height: 32 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline.map((v, i) => ({ i, v }))}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={sparkColor} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Wrap>
  )
}

export default function Financials() {
  const { toast } = useToast()
  const { range, setRange, derived } = useRange()
  const [filters, setFilters] = useState({ artist: '', category: '', rep: '' })
  const [filterOptions, setFilterOptions] = useState({ artists: [], categories: [], reps: [] })
  const [exec, setExec] = useState(null)
  const [execLoading, setExecLoading] = useState(true)
  const [execError, setExecError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [income, setIncome] = useState([])
  const [artists, setArtists] = useState([])
  const [drillBucket, setDrillBucket] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmIncome, setConfirmIncome] = useState(null)
  const [form, setForm] = useState({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })

  const scopeParams = () => {
    const p = {}
    if (derived.from) p.from = derived.from
    if (derived.to) p.to = derived.to
    for (const k of ['artist', 'category', 'rep']) if (filters[k]) p[k] = filters[k]
    return p
  }
  const loadExec = () => {
    setExecLoading(true); setExecError(null)
    return api.get('/financials/exec', { params: scopeParams() })
      .then(r => setExec(r.data.data))
      .catch(err => setExecError(err.response?.data?.error || 'Failed to load the financial summary.'))
      .finally(() => setExecLoading(false))
  }
  const loadSummary = () => api.get('/financials/summary', { params: scopeParams() }).then(r => setSummary(r.data.data)).catch(() => setSummary(null))
  const loadAnalytics = () => api.get('/financials/analytics', { params: scopeParams() }).then(r => setAnalytics(r.data.data)).catch(() => setAnalytics(null))
  const loadIncome = () => api.get('/financials/income').then(r => setIncome(r.data.data || [])).catch(() => {})

  useEffect(() => { loadExec(); loadSummary(); loadAnalytics() }, [derived.from, derived.to, filters.artist, filters.category, filters.rep]) // eslint-disable-line
  useEffect(() => {
    loadIncome()
    api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {})
    api.get('/financials/filter-options').then(r => setFilterOptions(r.data.data || { artists: [], categories: [], reps: [] })).catch(() => {})
  }, []) // eslint-disable-line

  const addIncome = async (e) => {
    e.preventDefault()
    if (!form.amount) { toast('Amount is required', 'error'); return }
    try {
      await api.post('/financials/income', { ...form, artist_id: form.artist_id || undefined })
      toast('Income added'); setShowForm(false)
      setForm({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })
      loadSummary(); loadIncome(); loadAnalytics()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const removeIncome = async () => {
    const id = confirmIncome?.id
    if (!id) return
    try { await api.delete(`/financials/income/${id}`); setConfirmIncome(null); loadSummary(); loadIncome(); loadAnalytics() }
    catch { toast('Failed', 'error') }
  }

  const doExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const res = await api.get('/financials/export', { params: scopeParams(), responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url; a.download = `cadence-financials-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
    finally { setExporting(false) }
  }

  const kpi = exec?.kpi
  // Sparkline shapes match each card's meaning: weekly paid for the flow
  // cards, cumulative for YTD, running open balance for the pipeline.
  const sparks = useMemo(() => {
    const trailing = (exec?.weeks || []).slice(-8)
    let paidCum = 0, receivedCum = 0
    const cumulative = trailing.map(w => {
      paidCum += Number(w.paid_usd) || 0
      receivedCum += (Number(w.paid_usd) || 0) + (Number(w.unpaid_usd) || 0)
      return { paidCum, openBal: receivedCum - paidCum }
    })
    return { paid: trailing.map(w => Number(w.paid_usd) || 0), ytd: cumulative.map(x => x.paidCum), open: cumulative.map(x => x.openBal) }
  }, [exec])

  const pie = (summary?.expenseByCategory || []).slice(0, 8).map(c => ({ name: c.category, value: c.total }))
  const filtersActive = filters.artist || filters.category || filters.rep

  return (
    <div>
      <PageHeader
        title="Financials"
        subtitle="Executive spend view — paid, unpaid, and intake across every artist / song / category"
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <RangePicker range={range} setRange={setRange} derived={derived} />
            <button onClick={doExport} disabled={exporting} className="btn-secondary" title="Multi-sheet Excel of the current range + scope">
              {exporting ? <Loader size={15} className="animate-spin" /> : <Download size={15} />} {exporting ? 'Building…' : 'Export'}
            </button>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add income</button>
          </div>
        }
      />

      {/* Basis disclosure — Financials and Reports answer different questions
          and WILL show different totals for the same range. Say so. */}
      <div className="flex flex-wrap items-center gap-2 -mt-3 mb-5 text-xs text-ink-muted">
        <span className="font-semibold text-ink-faint uppercase tracking-wider text-[10px]">Basis</span>
        <span>
          Commitment view — every approved invoice counts from its payment date, or its invoice date if unpaid.{' '}
          <strong className="font-semibold text-ink">Unpaid spend is included</strong>, and every figure shows its paid / unpaid split.
        </span>
        <Link to="/reports" className="text-brand-ink hover:underline font-semibold whitespace-nowrap">Cash basis? See Reports →</Link>
        <span className="ml-auto"><ReconciledBadge /></span>
      </div>

      {showForm && (
        <form onSubmit={addIncome} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className="label">Source</label><select className="input" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>{INCOME_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Artist</label><select className="input" value={form.artist_id} onChange={e => setForm(f => ({ ...f, artist_id: e.target.value }))}><option value="">—</option>{artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div><label className="label">Date</label><input type="date" className="input" value={form.income_date} onChange={e => setForm(f => ({ ...f, income_date: e.target.value }))} /></div>
          <div className="flex items-end"><button className="btn-primary w-full">Save income</button></div>
        </form>
      )}

      {/* Exec KPI row — fixed points-in-time (not range-scoped), day-matched
          deltas so a partial window never compares against a full one. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {execLoading && !kpi ? (
          [0, 1, 2, 3].map(i => <Skeleton.Block key={i} h="h-28" />)
        ) : kpi ? (
          <>
            <KpiCard label="This Week" value={money(kpi.this_week)}
              delta={<DeltaChip current={kpi.this_week} prior={kpi.last_week} />}
              sub={`vs ${money(kpi.last_week)} last week (same days elapsed)`}
              sparkline={sparks.paid} sparkColor="#10b981"
              onClick={() => setDrillBucket('this_week')} />
            <KpiCard label="Month-to-Date" value={money(kpi.mtd)}
              delta={<DeltaChip current={kpi.mtd} prior={kpi.last_mtd} />}
              sub={`vs ${money(kpi.last_mtd)} same-day last month`}
              sparkline={sparks.paid} sparkColor="#10b981"
              onClick={() => setDrillBucket('mtd')} />
            <KpiCard label="Year-to-Date" value={money(kpi.ytd)}
              delta={<DeltaChip current={kpi.ytd} prior={kpi.last_ytd} />}
              sub={kpi.last_ytd > 0 ? `vs ${money(kpi.last_ytd)} same-period last year` : 'no prior-year data to compare against'}
              sparkline={sparks.ytd} sparkColor="#6366f1"
              onClick={() => setDrillBucket('ytd')} />
            <KpiCard label="Unpaid Pipeline" value={money(kpi.unpaid_total)}
              sub={`${kpi.unpaid_count} invoice${kpi.unpaid_count === 1 ? '' : 's'} outstanding`}
              sparkline={sparks.open} sparkColor="#f43f5e"
              onClick={() => setDrillBucket('unpaid')} />
          </>
        ) : (
          <div className="col-span-2 md:col-span-4 card p-6 text-center text-sm text-ink-muted">
            {execError || 'Failed to load the financial summary.'}{' '}
            <button type="button" onClick={loadExec} className="text-brand-ink font-semibold hover:underline">Retry</button>
          </div>
        )}
      </div>

      {/* Range-scoped P&L strip — income vs committed spend, split disclosed. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-ink-faint mb-1"><TrendingUp size={13} className="text-success" /> Income <span className="text-[10px]">(range)</span></div>
          <p className="text-xl font-bold text-success tabular-nums">{money(summary?.income)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-ink-faint mb-1"><TrendingDown size={13} className="text-danger" /> Expenses <span className="text-[10px]">(range · paid + unpaid)</span></div>
          <p className="text-xl font-bold text-danger tabular-nums">{money(summary?.expenses)}</p>
          <p className="text-[11px] text-ink-faint mt-1">
            <span className="text-success font-semibold">{money(summary?.expenses_paid)} paid</span>
            {' · '}
            <span className="text-danger font-semibold">{money(summary?.expenses_unpaid)} open</span>
            {summary?.unpaid_count ? ` (${summary.unpaid_count} inv)` : ''}
          </p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-ink-faint mb-1"><Wallet size={13} /> Net <span className="text-[10px]">(income − committed spend)</span></div>
          <p className={`text-xl font-bold tabular-nums ${(summary?.net || 0) >= 0 ? 'text-ink' : 'text-danger'}`}>{money(summary?.net)}</p>
        </div>
      </div>

      {/* Cross-page scope — every section (and the drills) respects it. */}
      <div className="card px-4 py-3 mb-6 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint mr-1">Scope:</span>
        {[
          { key: 'artist', all: 'All artists', options: filterOptions.artists },
          { key: 'category', all: 'All categories', options: filterOptions.categories },
          { key: 'rep', all: 'All reps', options: filterOptions.reps },
        ].map(f => (
          <select key={f.key} value={filters[f.key]} onChange={e => setFilters(prev => ({ ...prev, [f.key]: e.target.value }))}
            className="input !w-auto !py-1 !px-2 text-xs font-semibold max-w-[180px]">
            <option value="">{f.all}</option>
            {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        {filtersActive && (
          <button type="button" onClick={() => setFilters({ artist: '', category: '', rep: '' })} className="text-brand-ink font-semibold hover:underline">Clear all</button>
        )}
        <span className="ml-auto text-[11px] text-ink-faint">Income panels ignore category/rep scope (income has neither).</span>
      </div>

      <div className="space-y-6">
        {execLoading && !exec ? <Skeleton.Block h="h-72" /> : exec?.weeks?.length ? <WeeklyChart weeks={exec.weeks} /> : null}

        {exec?.aging && exec?.upcoming && <PaymentAging aging={exec.aging} upcoming={exec.upcoming} onDrill={setDrillBucket} />}

        {exec?.forecast && <CashForecast forecast={exec.forecast} />}

        {exec?.monthly && <MonthlyRollup months={exec.monthly} onDrill={setDrillBucket} />}

        {exec?.breakdowns && <BreakdownSection breakdowns={exec.breakdowns} reps={exec.reps} />}

        {/* Monthly income vs expenses, expenses split paid/unpaid. */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-1">Income vs expenses by month</h2>
          <p className="text-[11px] text-ink-faint mb-4">Expenses stack <span className="text-success font-semibold">paid</span> + <span className="text-danger font-semibold">unpaid committed</span>; the line is net.</p>
          {!analytics ? <Skeleton.Block h="h-64" /> : (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={analytics.monthlySeries || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m) => String(m).slice(2)} />
                  <YAxis tick={{ fontSize: 10 }} width={48} tickFormatter={moneyCompact} />
                  <Tooltip formatter={(v, k) => [money(v), { income: 'Income', expenses_paid: 'Expenses (paid)', expenses_unpaid: 'Expenses (unpaid)', net: 'Net' }[k] || k]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                  <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses_paid" stackId="e" fill="#ef4444" />
                  <Bar dataKey="expenses_unpaid" stackId="e" fill="#fca5a5" radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="net" stroke="rgb(var(--color-brand-600))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {exec?.category_trend && <CategoryTrend trend={exec.category_trend} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category pie (range-scoped) */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-2">Expenses by category <span className="text-[10px] font-normal text-ink-faint">(range · paid + unpaid)</span></h2>
            {pie.length ? (
              <div className="flex items-center gap-4">
                <div style={{ width: 150, height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pie} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={2}>
                        {pie.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => money(v)} contentStyle={{ fontSize: 12, borderRadius: 8, background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1">
                  {(summary?.expenseByCategory || []).slice(0, 8).map((c, i) => (
                    <div key={c.category} className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{c.category}</span>
                      <span className="font-semibold text-ink tabular-nums" title={`${money(c.paid)} paid · ${money(c.unpaid)} open`}>
                        {money(c.total)}
                        {c.unpaid > 0 && <span className="text-danger font-normal"> · {moneyCompact(c.unpaid)} open</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-sm text-ink-faint">No approved expenses in this range.</p>}
          </div>

          {/* Top vendors (range-scoped, unpaid disclosed) */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Top vendors <span className="text-[10px] font-normal text-ink-faint">(range)</span></h2>
            {analytics?.topVendors?.length ? (
              <div className="space-y-1.5">
                {analytics.topVendors.map(v => (
                  <div key={v.vendor} className="flex items-center justify-between text-sm py-1 border-b border-divider last:border-0">
                    <span className="text-ink-muted truncate">{v.vendor}</span>
                    <span className="font-semibold text-ink tabular-nums whitespace-nowrap">
                      {money(v.total)}
                      {v.unpaid > 0 && <span className="text-[11px] text-danger font-normal"> · {moneyCompact(v.unpaid)} open</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-faint">No vendor spend in this range.</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Per-artist P&L — bucket-keyed, so non-roster / unassigned money
              stays visible and the column ties to total expenses. */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Per-artist P&amp;L <span className="text-[10px] font-normal text-ink-faint">(range · spend incl. unpaid)</span></h2>
            {analytics?.byArtist?.length ? (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[10px] text-ink-faint uppercase tracking-wide border-b border-divider"><th className="py-1.5">Artist</th><th className="py-1.5 text-right">Spend</th><th className="py-1.5 text-right">Income</th><th className="py-1.5 text-right">Net</th></tr></thead>
                <tbody>
                  {analytics.byArtist.map(a => (
                    <tr key={a.artist_id || a.name} className="border-b border-divider last:border-0">
                      <td className="py-1.5">
                        {a.artist_id
                          ? <Link to={`/artists/${a.artist_id}`} className="text-ink hover:text-brand-ink">{a.name}</Link>
                          : <span className={a.name === 'Unassigned' ? 'text-danger' : 'text-ink'}>{a.name}</span>}
                      </td>
                      <td className="py-1.5 text-right text-danger tabular-nums" title={`${money(a.spend_paid)} paid · ${money(a.spend_unpaid)} open`}>{money(a.spend)}</td>
                      <td className="py-1.5 text-right text-success tabular-nums">{money(a.income)}</td>
                      <td className={`py-1.5 text-right font-semibold tabular-nums ${a.net >= 0 ? 'text-ink' : 'text-danger'}`}>{money(a.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-ink-faint">No per-artist activity in this range.</p>}
          </div>

          {/* Recent income */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Recent income</h2>
            {income.length ? (
              <div className="space-y-1.5">
                {income.slice(0, 12).map(i => (
                  <div key={i.id} className="flex items-center gap-2 py-1.5 border-b border-divider last:border-0 group">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{i.source}{i.artist_name ? ` · ${i.artist_name}` : ''}</p>
                      <p className="text-[11px] text-ink-faint">{new Date(i.income_date).toLocaleDateString()}</p>
                    </div>
                    <span className="text-sm font-semibold text-success tabular-nums">{money(i.amount)}</span>
                    <button onClick={() => setConfirmIncome(i)} className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-danger transition-opacity" title="Delete income entry"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-faint">No income recorded yet.</p>}
          </div>
        </div>

        <p className="text-[11px] text-ink-faint text-center pt-2">
          USD-equivalent throughout (locked FX rates honored). Split slices are each counted once — a co-brand invoice split N ways never multi-counts.
        </p>
      </div>

      {drillBucket && <KpiDrillModal bucket={drillBucket} filters={filters} onClose={() => setDrillBucket(null)} />}

      <ConfirmDialog
        open={!!confirmIncome}
        onClose={() => setConfirmIncome(null)}
        onConfirm={removeIncome}
        title="Delete income entry?"
        message={confirmIncome ? `${confirmIncome.source || 'Income'} — ${money(confirmIncome.amount)} on ${new Date(confirmIncome.income_date).toLocaleDateString()}. This cannot be undone.` : ''}
      />
    </div>
  )
}

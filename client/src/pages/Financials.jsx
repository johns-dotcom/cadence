import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, Download, ArrowUp, ArrowDown } from 'lucide-react'
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { CURRENCIES } from '../constants'

const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
]
const INCOME_SOURCES = ['Streaming', 'Sync', 'Physical', 'YouTube', 'Merch', 'Performance', 'Publishing', 'Other']
const PIE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6', '#a3a3a3']
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const PERSIST = 'financials-period'

export default function Financials() {
  const { toast } = useToast()
  const [period, setPeriod] = useState(() => localStorage.getItem(PERSIST) || 'year')
  const [summary, setSummary] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [income, setIncome] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })

  const loadSummary = () => api.get('/financials/summary', { params: { period } }).then(r => setSummary(r.data.data)).catch(() => {})
  const loadIncome = () => api.get('/financials/income').then(r => setIncome(r.data.data || [])).catch(() => {})
  useEffect(() => { localStorage.setItem(PERSIST, period); loadSummary() }, [period])
  useEffect(() => {
    Promise.all([
      api.get('/financials/analytics').then(r => setAnalytics(r.data.data)).catch(() => {}),
      loadIncome(),
      api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  const addIncome = async (e) => {
    e.preventDefault()
    if (!form.amount) { toast('Amount is required', 'error'); return }
    try {
      await api.post('/financials/income', { ...form, artist_id: form.artist_id || undefined })
      toast('Income added'); setShowForm(false)
      setForm({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })
      loadSummary(); loadIncome(); api.get('/financials/analytics').then(r => setAnalytics(r.data.data)).catch(() => {})
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const removeIncome = async (id) => {
    if (!window.confirm('Delete this income entry?')) return
    try { await api.delete(`/financials/income/${id}`); loadSummary(); loadIncome() } catch { toast('Failed', 'error') }
  }

  const exportCsv = () => {
    const lines = ['Section,Name,Amount USD']
    ;(summary?.expenseByCategory || []).forEach(c => lines.push(`Category,"${c.category}",${c.total}`))
    ;(analytics?.topVendors || []).forEach(v => lines.push(`Vendor,"${v.vendor}",${v.total}`))
    ;(analytics?.byArtist || []).forEach(a => lines.push(`Artist net,"${a.name}",${a.net}`))
    const url = window.URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'financials.csv'; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
  }

  const Delta = ({ v, invert }) => {
    if (v == null || v === 0) return null
    const good = invert ? v < 0 : v > 0
    const Icon = v > 0 ? ArrowUp : ArrowDown
    return <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${good ? 'text-emerald-600' : 'text-red-500'}`}><Icon size={11} />{money(Math.abs(v))} vs last mo</span>
  }
  const pie = (summary?.expenseByCategory || []).slice(0, 8).map(c => ({ name: c.category, value: c.total }))

  return (
    <div>
      <PageHeader
        title="Financials"
        subtitle="Income, expenses and profit for this workspace"
        action={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="btn-secondary"><Download size={15} /> Export</button>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add income</button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5 mb-5">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${period === p.key ? 'bg-gray-900 text-white border-gray-900' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>{p.label}</button>
        ))}
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

      {/* KPI cards with prior-month deltas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><TrendingUp size={13} className="text-emerald-500" /> Income</div>
          <p className="text-xl font-bold text-emerald-600">{money(summary?.income)}</p>
          <Delta v={analytics?.deltas?.income} />
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><TrendingDown size={13} className="text-red-500" /> Expenses</div>
          <p className="text-xl font-bold text-red-600">{money(summary?.expenses)}</p>
          <Delta v={analytics?.deltas?.expenses} invert />
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Wallet size={13} /> Net</div>
          <p className={`text-xl font-bold ${(summary?.net || 0) >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(summary?.net)}</p>
          <Delta v={analytics?.deltas?.net} />
        </div>
      </div>

      {/* Monthly trend */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-bold text-ink mb-4">Last 12 months</h2>
        {loading ? <Skeleton.Block h="h-64" /> : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={analytics?.monthlySeries || []}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expenses" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="net" stroke="rgb(var(--color-brand-600))" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Category pie */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-2">Expenses by category</h2>
          {pie.length ? (
            <div className="flex items-center gap-4">
              <div style={{ width: 150, height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={pie} dataKey="value" nameKey="name" innerRadius={38} outerRadius={70} paddingAngle={2}>{pie.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip formatter={(v) => money(v)} /></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1">
                {pie.map((c, i) => (
                  <div key={c.name} className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 text-gray-600"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PIE[i % PIE.length] }} />{c.name}</span>
                    <span className="font-semibold text-ink">{money(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400">No approved expenses in this period.</p>}
        </div>

        {/* Top vendors */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">Top vendors (12mo)</h2>
          {analytics?.topVendors?.length ? (
            <div className="space-y-1.5">
              {analytics.topVendors.map(v => (
                <div key={v.vendor} className="flex items-center justify-between text-sm py-1 border-b border-divider last:border-0">
                  <span className="text-gray-600 truncate">{v.vendor}</span>
                  <span className="font-semibold text-ink tabular-nums">{money(v.total)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No vendor spend yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Per-artist P&L */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">Per-artist P&amp;L (12mo)</h2>
          {analytics?.byArtist?.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider"><th className="py-1.5">Artist</th><th className="py-1.5 text-right">Spend</th><th className="py-1.5 text-right">Income</th><th className="py-1.5 text-right">Net</th></tr></thead>
              <tbody>
                {analytics.byArtist.map(a => (
                  <tr key={a.artist_id} className="border-b border-divider last:border-0">
                    <td className="py-1.5"><Link to={`/artists/${a.artist_id}`} className="text-ink hover:text-brand-600">{a.name}</Link></td>
                    <td className="py-1.5 text-right text-red-600">{money(a.spend)}</td>
                    <td className="py-1.5 text-right text-emerald-600">{money(a.income)}</td>
                    <td className={`py-1.5 text-right font-semibold ${a.net >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(a.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-400">No per-artist activity yet.</p>}
        </div>

        {/* Recent income */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-3">Recent income</h2>
          {income.length ? (
            <div className="space-y-1.5">
              {income.slice(0, 12).map(i => (
                <div key={i.id} className="flex items-center gap-2 py-1.5 border-b border-divider last:border-0 group">
                  <div className="flex-1 min-w-0"><p className="text-sm text-ink truncate">{i.source}{i.artist_name ? ` · ${i.artist_name}` : ''}</p><p className="text-[11px] text-gray-400">{new Date(i.income_date).toLocaleDateString()}</p></div>
                  <span className="text-sm font-semibold text-emerald-600">{money(i.amount)}</span>
                  <button onClick={() => removeIncome(i.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No income recorded yet.</p>}
        </div>
      </div>
    </div>
  )
}

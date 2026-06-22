import { useEffect, useState } from 'react'
import { Plus, X, Trash2, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { CURRENCIES } from '../constants'

const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
]
const INCOME_SOURCES = ['Streaming', 'Sync', 'Physical', 'YouTube', 'Merch', 'Performance', 'Publishing', 'Other']
const money = (n, c = 'USD') => `${c === 'USD' ? '$' : c + ' '}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Financials() {
  const { toast } = useToast()
  const [period, setPeriod] = useState('year')
  const [summary, setSummary] = useState(null)
  const [income, setIncome] = useState([])
  const [artists, setArtists] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })

  const loadSummary = () => api.get('/financials/summary', { params: { period } }).then(r => setSummary(r.data.data)).catch(() => {})
  const loadIncome = () => api.get('/financials/income').then(r => setIncome(r.data.data || [])).catch(() => {})
  useEffect(loadSummary, [period])
  useEffect(() => { loadIncome(); api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {}) }, [])

  const addIncome = async (e) => {
    e.preventDefault()
    if (!form.amount) { toast('Amount is required', 'error'); return }
    try {
      await api.post('/financials/income', { ...form, artist_id: form.artist_id || undefined })
      toast('Income added'); setShowForm(false)
      setForm({ source: 'Streaming', amount: '', currency: 'USD', artist_id: '', description: '', income_date: '' })
      loadSummary(); loadIncome()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const removeIncome = async (id) => {
    if (!window.confirm('Delete this income entry?')) return
    try { await api.delete(`/financials/income/${id}`); loadSummary(); loadIncome() } catch { toast('Failed', 'error') }
  }

  const maxCat = Math.max(1, ...(summary?.expenseByCategory || []).map(c => c.total))

  return (
    <div>
      <PageHeader
        title="Financials"
        subtitle="Income, expenses and profit for this workspace"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add income</button>}
      />

      <div className="flex flex-wrap gap-1.5 mb-5">
        {PERIODS.map(p => (
          <button key={p.key} onClick={() => setPeriod(p.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${period === p.key ? 'bg-gray-900 text-white border-gray-900' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>
            {p.label}
          </button>
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

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><TrendingUp size={13} className="text-emerald-500" /> Income</div>
          <p className="text-xl font-bold text-emerald-600">{money(summary?.income)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><TrendingDown size={13} className="text-red-500" /> Expenses</div>
          <p className="text-xl font-bold text-red-600">{money(summary?.expenses)}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><Wallet size={13} /> Net</div>
          <p className={`text-xl font-bold ${(summary?.net || 0) >= 0 ? 'text-ink' : 'text-red-600'}`}>{money(summary?.net)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expense by category */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Expenses by category</h2>
          {summary?.expenseByCategory?.length ? (
            <div className="space-y-2.5">
              {summary.expenseByCategory.map(c => (
                <div key={c.category}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">{c.category}</span><span className="font-semibold text-ink">{money(c.total)}</span></div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${(c.total / maxCat) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No approved expenses in this period.</p>}
        </div>

        {/* Income entries */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Recent income</h2>
          {income.length ? (
            <div className="space-y-1.5">
              {income.slice(0, 12).map(i => (
                <div key={i.id} className="flex items-center gap-2 py-1.5 border-b border-divider last:border-0 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink truncate">{i.source}{i.artist_name ? ` · ${i.artist_name}` : ''}</p>
                    <p className="text-[11px] text-gray-400">{new Date(i.income_date).toLocaleDateString()}</p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-600">{money(i.amount, i.currency)}</span>
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

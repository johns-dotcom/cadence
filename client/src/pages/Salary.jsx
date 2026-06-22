import { useEffect, useState } from 'react'
import { Plus, Check, ChevronLeft, ChevronRight, X, History } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { DEPARTMENTS, CURRENCIES } from '../constants'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n, c = 'USD') => `${c === 'USD' ? '$' : c + ' '}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Salary() {
  const { toast } = useToast()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', department: '', monthly_amount: '', currency: 'USD' })
  const [history, setHistory] = useState(null)

  const toggleHistory = async () => {
    if (history) { setHistory(null); return }
    try { const { data } = await api.get('/salary/history'); setHistory(data.data || []) }
    catch { toast('Failed to load history', 'error') }
  }

  const load = () => {
    setLoading(true)
    api.get('/salary', { params: { month, year } }).then(r => { setEmployees(r.data.data.employees || []) }).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [month, year])

  const prev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1) }
  const next = () => { if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1) }

  const addEmployee = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) { toast('Name is required', 'error'); return }
    try {
      await api.post('/salary/employees', form)
      toast('Employee added'); setShowForm(false); setForm({ name: '', department: '', monthly_amount: '', currency: 'USD' }); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const togglePaid = async (emp) => {
    try { await api.put(`/salary/${emp.id}/pay`, { month, year, paid: !emp.paid }); load() }
    catch { toast('Failed', 'error') }
  }

  const totalDue = employees.reduce((s, e) => s + Number(e.monthly_amount || 0), 0)
  const totalPaid = employees.filter(e => e.paid).reduce((s, e) => s + Number(e.monthly_amount || 0), 0)

  return (
    <div>
      <PageHeader
        title="Salary"
        subtitle="Monthly payroll for this workspace"
        action={
          <div className="flex items-center gap-2">
            <button onClick={toggleHistory} className="btn-secondary"><History size={15} /> {history ? 'Hide history' : 'History'}</button>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add employee</button>
          </div>
        }
      />

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-1.5 border border-rule rounded-lg text-gray-500 hover:text-gray-800"><ChevronLeft size={16} /></button>
          <span className="text-base font-semibold text-ink min-w-[120px] text-center">{MONTHS[month - 1]} {year}</span>
          <button onClick={next} className="p-1.5 border border-rule rounded-lg text-gray-500 hover:text-gray-800"><ChevronRight size={16} /></button>
        </div>
        <div className="text-sm text-gray-500">Paid <span className="font-semibold text-emerald-600">{money(totalPaid)}</span> of <span className="font-semibold text-ink">{money(totalDue)}</span></div>
      </div>

      {showForm && (
        <form onSubmit={addEmployee} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="label">Department</label><select className="input" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}><option value="">—</option>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select></div>
          <div><label className="label">Monthly</label><input type="number" step="0.01" className="input" value={form.monthly_amount} onChange={e => setForm(f => ({ ...f, monthly_amount: e.target.value }))} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="col-span-2 sm:col-span-4"><button className="btn-primary">Save employee</button></div>
        </form>
      )}

      {history && (
        <div className="card p-4 mb-6">
          <h2 className="text-sm font-bold text-ink mb-3">Payment history</h2>
          {history.length === 0 ? <p className="text-sm text-gray-400">No payments recorded yet.</p> : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-divider last:border-0">
                  <span className="text-ink">{h.employee} <span className="text-gray-400">· {MONTHS[h.month - 1]} {h.year}</span></span>
                  <span className="text-[11px] text-gray-400">{h.marked_by || '—'} · {h.paid_at ? new Date(h.paid_at).toLocaleDateString() : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : employees.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-500">No employees on payroll yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Employee</th>
                <th className="px-4 py-2.5 font-semibold">Department</th>
                <th className="px-4 py-2.5 font-semibold text-right">Monthly</th>
                <th className="px-4 py-2.5 font-semibold text-center">{MONTHS[month - 1]} status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id} className="border-b border-divider last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{e.name}</td>
                  <td className="px-4 py-3 text-gray-500">{e.department || '—'}</td>
                  <td className="px-4 py-3 text-right text-ink">{money(e.monthly_amount, e.currency)}</td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => togglePaid(e)}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${e.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                      {e.paid ? <><Check size={12} /> Paid</> : 'Mark paid'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

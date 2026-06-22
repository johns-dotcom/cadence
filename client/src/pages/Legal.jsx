import { useEffect, useState } from 'react'
import { Plus, Trash2, Shield } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import FileAttach from '../components/FileAttach'
import { useToast } from '../context/ToastContext'

const STATUSES = ['Active', 'Expired', 'Terminated']
const STATUS_STYLE = { Active: 'bg-emerald-100 text-emerald-700', Expired: 'bg-amber-100 text-amber-700', Terminated: 'bg-red-100 text-red-700' }
const BLANK = { counterparty: '', status: 'Active', effective_date: '', expiration_date: '', notes: '' }

// NDA register for the workspace.
export default function Legal() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)

  const load = () => { setLoading(true); api.get('/ndas').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.counterparty.trim()) { toast('Counterparty is required', 'error'); return }
    try { await api.post('/ndas', form); toast('NDA added'); setShowForm(false); setForm(BLANK); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (row, status) => { try { await api.patch(`/ndas/${row.id}`, { status }); load() } catch { toast('Failed', 'error') } }
  const remove = async (id) => { if (!window.confirm('Delete this NDA?')) return; try { await api.delete(`/ndas/${id}`); load() } catch { toast('Failed', 'error') } }

  return (
    <div>
      <PageHeader
        title="NDAs"
        subtitle="Non-disclosure agreements"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add NDA</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2"><label className="label">Counterparty</label><input className="input" value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} /></div>
          <div><label className="label">Effective</label><input type="date" className="input" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} /></div>
          <div><label className="label">Expires</label><input type="date" className="input" value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} /></div>
          <div className="col-span-2 sm:col-span-4"><button className="btn-primary">Save NDA</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><Shield size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No NDAs on file.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Counterparty</th>
                <th className="px-4 py-2.5 font-semibold">Effective</th>
                <th className="px-4 py-2.5 font-semibold">Expires</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider last:border-0 hover:bg-gray-50 group">
                  <td className="px-4 py-3 font-medium text-ink">{r.counterparty}</td>
                  <td className="px-4 py-3 text-gray-500">{r.effective_date ? new Date(r.effective_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.expiration_date ? new Date(r.expiration_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                      className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[r.status] || STATUS_STYLE.Active}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><FileAttach base="/ndas" id={r.id} fileName={r.file_name} onChange={load} /></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

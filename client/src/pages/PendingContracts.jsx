import { useEffect, useState } from 'react'
import { Plus, Trash2, FileClock, CheckCircle2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { CONTRACT_TYPES } from '../constants'
import { localDateStr } from '../utils/dates'

const STATUSES = ['Not Sent', 'Sent', 'In Review', 'Signed']
const STATUS_STYLE = {
  'Not Sent': 'bg-gray-100 text-gray-600', 'Sent': 'bg-amber-100 text-amber-700',
  'In Review': 'bg-blue-100 text-blue-700', 'Signed': 'bg-emerald-100 text-emerald-700',
}
const BLANK = { counterparty: '', type: '', status: 'Not Sent', sent_date: '', due_date: '', notes: '' }

export default function PendingContracts() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)

  const load = () => { setLoading(true); api.get('/pending-contracts').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.counterparty.trim()) { toast('Counterparty is required', 'error'); return }
    try { await api.post('/pending-contracts', form); toast('Added'); setShowForm(false); setForm(BLANK); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (row, status) => {
    try { await api.patch(`/pending-contracts/${row.id}`, { status }); load() } catch { toast('Failed', 'error') }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this pending contract?')) return
    try { await api.delete(`/pending-contracts/${id}`); load() } catch { toast('Failed', 'error') }
  }

  // Counter-signed → promote into an Active contract, then clear the pending row.
  const promote = async (r) => {
    if (!window.confirm(`Promote "${r.counterparty}" to an active contract?`)) return
    try {
      await api.post('/contracts', {
        type: r.type || 'Recording', status: 'Active', date_signed: localDateStr(),
        notes: `Counterparty: ${r.counterparty}${r.notes ? `\n${r.notes}` : ''}`,
      })
      await api.delete(`/pending-contracts/${r.id}`)
      toast('Promoted to active contract')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to promote', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Pending Contracts"
        subtitle="Agreements awaiting signature"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div><label className="label">Counterparty</label><input className="input" value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} /></div>
          <div><label className="label">Type</label><select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}><option value="">—</option>{CONTRACT_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Status</label><select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><label className="label">Sent date</label><input type="date" className="input" value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} /></div>
          <div><label className="label">Due date</label><input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
          <div className="flex items-end"><button className="btn-primary w-full">Save</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><FileClock size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No pending contracts.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                <th className="px-4 py-2.5 font-semibold">Counterparty</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Due</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider last:border-0 hover:bg-gray-50 group">
                  <td className="px-4 py-3 font-medium text-ink">{r.counterparty}</td>
                  <td className="px-4 py-3 text-gray-500">{r.type || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{r.due_date ? new Date(r.due_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                      className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[r.status] || STATUS_STYLE['Not Sent']}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.status === 'Signed' && (
                      <button onClick={() => promote(r)} title="Promote to active contract" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 px-2"><CheckCircle2 size={13} /> Activate</button>
                    )}
                    <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-red-600 px-1.5"><Trash2 size={14} /></button>
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

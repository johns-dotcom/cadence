import { useEffect, useState } from 'react'
import { Plus, Trash2, Shield } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import FileAttach from '../components/FileAttach'
import { ConfirmDialog } from '../components/ui'
import { formatDate } from '../utils/dates'
import { useToast } from '../context/ToastContext'

const STATUSES = ['Active', 'Expired', 'Terminated']
const STATUS_STYLE = { Active: 'bg-success/15 text-success', Expired: 'bg-warning/15 text-warning', Terminated: 'bg-danger/15 text-danger' }
const BLANK = { counterparty: '', status: 'Active', effective_date: '', expiration_date: '', notes: '' }

// NDA register for the workspace.
export default function Legal() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = () => { setLoading(true); api.get('/ndas').then(r => setRows(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.counterparty.trim()) { toast('Counterparty is required', 'error'); return }
    try { await api.post('/ndas', form); toast('NDA added'); setShowForm(false); setForm(BLANK); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (row, status) => { try { await api.patch(`/ndas/${row.id}`, { status }); load() } catch { toast('Failed', 'error') } }
  const remove = async () => {
    const row = confirmDelete
    setConfirmDelete(null)
    try { await api.delete(`/ndas/${row.id}`); toast('NDA deleted'); load() } catch { toast('Failed', 'error') }
  }

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
          <div><label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-4"><label className="label">Notes</label>
            <textarea rows={2} className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Scope, carve-outs, who signed…" />
          </div>
          <div className="col-span-2 sm:col-span-4"><button className="btn-primary">Save NDA</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><Shield size={26} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">No NDAs on file.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-ink-faint uppercase tracking-wide border-b border-divider bg-page/50">
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
                  <td className="px-4 py-3 font-medium text-ink">
                    {r.counterparty}
                    {r.notes && <span className="block text-xs font-normal text-ink-faint mt-0.5">{r.notes}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(r.effective_date)}</td>
                  <td className="px-4 py-3 text-ink-muted">{formatDate(r.expiration_date)}</td>
                  <td className="px-4 py-3">
                    <select value={r.status} onChange={e => setStatus(r, e.target.value)}
                      className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[r.status] || STATUS_STYLE.Active}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3"><FileAttach base="/ndas" id={r.id} fileName={r.file_name} onChange={load} /></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => setConfirmDelete(r)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-faint hover:text-danger transition-opacity" aria-label={`Delete NDA with ${r.counterparty}`}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={remove}
        title="Delete NDA"
        message={`Delete the NDA with "${confirmDelete?.counterparty}"? Any attached document is removed too.`}
      />
    </div>
  )
}

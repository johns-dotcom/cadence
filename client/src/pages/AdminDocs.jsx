import { useEffect, useState } from 'react'
import { Plus, Trash2, Lock, AlertTriangle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import FileAttach from '../components/FileAttach'
import { useToast } from '../context/ToastContext'

const CATEGORIES = ['Legal', 'NDAs', 'Compliance', 'HR / People', 'Financial', 'IP / Brand', 'Internal Policies', 'Templates']
const STATUSES = ['Active', 'Draft', 'Expired', 'Archived']
const CONFIDENTIALITY = ['Internal', 'Restricted']
const STATUS_STYLE = { Active: 'bg-emerald-100 text-emerald-700', Draft: 'bg-gray-100 text-gray-600', Expired: 'bg-amber-100 text-amber-700', Archived: 'bg-gray-100 text-gray-400' }
const BLANK = { title: '', category: 'Legal', status: 'Active', confidentiality: 'Internal', counterparty: '', signed_date: '', expiration_date: '', tags: '', notes: '' }

const soonExpiring = (d) => d && (new Date(d) - new Date()) / 86400000 <= 90 && new Date(d) >= new Date()

// Secure document vault — admin only (gated server-side too).
export default function AdminDocs() {
  const { toast } = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [filter, setFilter] = useState('All')

  const load = () => { setLoading(true); api.get('/admin-docs').then(r => setDocs(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast('Title is required', 'error'); return }
    try { await api.post('/admin-docs', form); toast('Document added'); setShowForm(false); setForm(BLANK); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setStatus = async (doc, status) => { try { await api.patch(`/admin-docs/${doc.id}`, { status }); load() } catch { toast('Failed', 'error') } }
  const remove = async (id) => { if (!window.confirm('Delete this document?')) return; try { await api.delete(`/admin-docs/${id}`); load() } catch { toast('Failed', 'error') } }

  const cats = ['All', ...CATEGORIES]
  const shown = filter === 'All' ? docs : docs.filter(d => d.category === filter)
  const expiring = docs.filter(d => soonExpiring(d.expiration_date))

  return (
    <div>
      <PageHeader
        title="Admin Docs"
        subtitle="Secure company document vault"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add document</button>}
      />

      {expiring.length > 0 && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={15} /> {expiring.length} document{expiring.length === 1 ? '' : 's'} expiring within 90 days.
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2"><label className="label">Title</label><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><label className="label">Category</label><select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Confidentiality</label><select className="input" value={form.confidentiality} onChange={e => setForm(f => ({ ...f, confidentiality: e.target.value }))}>{CONFIDENTIALITY.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Counterparty</label><input className="input" value={form.counterparty} onChange={e => setForm(f => ({ ...f, counterparty: e.target.value }))} /></div>
          <div><label className="label">Signed</label><input type="date" className="input" value={form.signed_date} onChange={e => setForm(f => ({ ...f, signed_date: e.target.value }))} /></div>
          <div><label className="label">Expires</label><input type="date" className="input" value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} /></div>
          <div><label className="label">Tags</label><input className="input" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="comma, separated" /></div>
          <div className="col-span-2 sm:col-span-4"><button className="btn-primary">Save document</button></div>
        </form>
      )}

      <div className="flex flex-wrap gap-1.5 mb-4">
        {cats.map(c => (
          <button key={c} onClick={() => setFilter(c)}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${filter === c ? 'bg-gray-900 text-white border-gray-900' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>{c}</button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><Lock size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No documents{filter !== 'All' ? ` in ${filter}` : ''}.</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map(d => (
            <div key={d.id} className="card p-4 group">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{d.title}</p>
                  <p className="text-[11px] text-gray-400">{d.category}{d.confidentiality === 'Restricted' ? ' · Restricted' : ''}</p>
                </div>
                <button onClick={() => remove(d.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity flex-shrink-0"><Trash2 size={14} /></button>
              </div>
              {d.expiration_date && <p className={`text-[11px] mb-2 ${soonExpiring(d.expiration_date) ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>Expires {new Date(d.expiration_date).toLocaleDateString()}</p>}
              <div className="flex items-center justify-between gap-2">
                <select value={d.status} onChange={e => setStatus(d, e.target.value)}
                  className={`text-[10px] font-semibold rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_STYLE[d.status] || STATUS_STYLE.Active}`}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <FileAttach base="/admin-docs" id={d.id} fileName={d.file_name} onChange={load} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

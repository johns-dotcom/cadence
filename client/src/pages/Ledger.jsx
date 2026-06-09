import { useEffect, useState } from 'react'
import { Plus, Check, X, Trash2, Paperclip, Link2, BookOpen, DollarSign } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const STATUS_STYLES = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}
const FILTERS = ['all', 'pending', 'approved', 'rejected']

export default function Ledger() {
  const { toast } = useToast()
  const { label } = useAuth()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    invoice_date: '', payee: '', description: '', category: '', artist: '',
    invoice_number: '', amount: '', currency: 'USD', payment_method: '', notes: '',
  })
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })

  const load = () => {
    setLoading(true)
    const q = filter === 'all' ? '' : `?status=${filter}`
    api.get(`/ledger/entries${q}`).then(res => setEntries(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [filter])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.payee.trim() || !form.amount) { toast('Payee and amount are required', 'error'); return }
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v) })
      Object.entries(files).forEach(([k, f]) => { if (f) fd.append(k, f) })
      await api.post('/ledger/entries', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('Entry added')
      setForm({ invoice_date: '', payee: '', description: '', category: '', artist: '', invoice_number: '', amount: '', currency: 'USD', payment_method: '', notes: '' })
      setFiles({ invoice_file: null, w9_file: null, receipt_file: null })
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add entry', 'error')
    } finally { setSaving(false) }
  }

  const act = async (id, path, body) => {
    try { await api.post(`/ledger/entries/${id}/${path}`, body || {}); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const reject = async (id) => {
    const reason = window.prompt('Reason for rejection (optional):') ?? null
    act(id, 'reject', { reason })
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this entry?')) return
    try { await api.delete(`/ledger/entries/${id}`); load() } catch { toast('Failed', 'error') }
  }
  const openFile = async (id, type) => {
    try { const { data } = await api.get(`/ledger/entries/${id}/file/${type}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file', 'error') }
  }

  const copyVendorLink = () => {
    const url = `${window.location.origin}/submit/${label?.slug}`
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Expenses and vendor payments"
        action={
          <div className="flex items-center gap-2">
            <button onClick={copyVendorLink} className="btn-secondary">
              {copied ? <><Check size={15} /> Copied</> : <><Link2 size={15} /> Vendor form link</>}
            </button>
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add entry</button>
          </div>
        }
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div><label className="label">Payee</label><input className="input" value={form.payee} onChange={set('payee')} autoFocus /></div>
          <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Invoice date</label><input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Category</label><select className="input" value={form.category} onChange={set('category')}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Artist / project</label><input className="input" value={form.artist} onChange={set('artist')} /></div>
          <div><label className="label">Invoice #</label><input className="input" value={form.invoice_number} onChange={set('invoice_number')} /></div>
          <div><label className="label">Payment method</label><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div className="lg:col-span-2"><label className="label">Description</label><input className="input" value={form.description} onChange={set('description')} /></div>
          <div><label className="label">Invoice file</label><input type="file" className="input py-1.5" onChange={e => setFiles(f => ({ ...f, invoice_file: e.target.files[0] }))} /></div>
          <div><label className="label">W9 (optional)</label><input type="file" className="input py-1.5" onChange={e => setFiles(f => ({ ...f, w9_file: e.target.files[0] }))} /></div>
          <div className="lg:col-span-4"><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add entry'}</button></div>
        </form>
      )}

      <div className="flex items-center gap-1 mb-4">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg capitalize transition ${filter === f ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="card p-10 text-center"><BookOpen size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No entries{filter !== 'all' ? ` (${filter})` : ''}.</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {['Date', 'Payee', 'Category', 'Amount', 'Status', 'Payment', 'Files', ''].map(h => (
                  <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {entries.map(en => (
                <tr key={en.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{en.invoice_date ? new Date(en.invoice_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-ink">{en.payee}</p>
                    {en.vendor_submitted && <span className="text-[10px] text-brand-600 font-semibold uppercase">Vendor submission</span>}
                    {en.artist && <p className="text-xs text-gray-400">{en.artist}</p>}
                  </td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{en.category || '—'}</td>
                  <td className="px-3 py-3 text-ink font-medium whitespace-nowrap">{en.currency} {Number(en.amount).toLocaleString()}</td>
                  <td className="px-3 py-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span></td>
                  <td className="px-3 py-3">
                    {en.payment_status === 'Paid'
                      ? <span className="text-xs text-emerald-600 font-medium">Paid</span>
                      : <span className="text-xs text-gray-400">Unpaid</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      {en.invoice_r2_key && <button onClick={() => openFile(en.id, 'invoice')} title="Invoice" className="text-gray-400 hover:text-brand-600"><Paperclip size={14} /></button>}
                      {en.w9_r2_key && <button onClick={() => openFile(en.id, 'w9')} title="W9" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">W9</button>}
                      {en.receipt_r2_key && <button onClick={() => openFile(en.id, 'receipt')} title="Receipt" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">RCT</button>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
                      {en.status === 'pending' && (
                        <>
                          <button onClick={() => act(en.id, 'approve')} title="Approve" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Check size={15} /></button>
                          <button onClick={() => reject(en.id)} title="Reject" className="text-red-500 hover:bg-red-50 p-1 rounded"><X size={15} /></button>
                        </>
                      )}
                      {en.status === 'approved' && en.payment_status !== 'Paid' && (
                        <button onClick={() => act(en.id, 'mark-paid')} title="Mark paid" className="text-gray-500 hover:text-emerald-600 p-1 rounded"><DollarSign size={15} /></button>
                      )}
                      <button onClick={() => remove(en.id)} title="Delete" className="text-gray-300 hover:text-danger p-1 rounded"><Trash2 size={14} /></button>
                    </div>
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

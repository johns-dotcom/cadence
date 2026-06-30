import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2, ArrowLeft, Plus } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const blankLine = () => ({ description: '', amount: '' })
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CreateInvoice() {
  const { toast } = useToast()
  const { label } = useAuth()
  const navigate = useNavigate()
  const [nextNumber, setNextNumber] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ bill_to: '', bill_to_address: '', description: '', purchase_order: '', due_by: 'UPON RECEIPT' })
  const [lines, setLines] = useState([blankLine()])

  useEffect(() => { api.get('/invoices/next-number').then(r => setNextNumber(r.data.data.next_number)).catch(() => {}) }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setLine = (i, k) => (e) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: e.target.value } : l))
  const total = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)

  const create = async (e) => {
    e.preventDefault()
    if (!form.bill_to.trim()) { toast('Bill-to is required', 'error'); return }
    const cleanLines = lines.filter(l => l.description.trim() || l.amount)
    const amount = cleanLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
    if (amount <= 0) { toast('Add at least one line item with an amount', 'error'); return }
    setSaving(true)
    try {
      await api.post('/invoices', {
        ...form,
        amount,
        line_items: cleanLines.map(l => ({ description: l.description, amount: parseFloat(l.amount) || 0 })),
      })
      toast('Invoice created')
      navigate('/invoices')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create invoice', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <button onClick={() => navigate('/invoices')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"><ArrowLeft size={15} /> Back to invoices</button>
      <PageHeader title="Create invoice" subtitle={nextNumber != null ? `Will be issued as #${nextNumber}` : 'New invoice'} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <form onSubmit={create} className="lg:col-span-3 card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Bill to</label><input className="input" value={form.bill_to} onChange={set('bill_to')} autoFocus /></div>
            <div><label className="label">Purchase order</label><input className="input" value={form.purchase_order} onChange={set('purchase_order')} placeholder="N/A" /></div>
            <div className="sm:col-span-2"><label className="label">Bill-to address</label><input className="input" value={form.bill_to_address} onChange={set('bill_to_address')} /></div>
            <div><label className="label">Due by</label><input className="input" value={form.due_by} onChange={set('due_by')} /></div>
            <div><label className="label">Description / memo</label><input className="input" value={form.description} onChange={set('description')} /></div>
          </div>

          <div>
            <label className="label">Line items</label>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input className="input flex-1" placeholder="Description" value={l.description} onChange={setLine(i, 'description')} />
                  <input type="number" step="0.01" className="input w-32" placeholder="0.00" value={l.amount} onChange={setLine(i, 'amount')} />
                  <button type="button" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)} className="text-gray-300 hover:text-danger px-1"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setLines(ls => [...ls, blankLine()])} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><Plus size={13} /> Add line</button>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-divider">
            <button type="button" onClick={() => navigate('/invoices')} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create invoice'}</button>
          </div>
        </form>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="card p-6 sticky top-4">
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-2.5 min-w-0">
                {label?.logo_url
                  ? <img src={label.logo_url} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                  : <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0"><span className="text-white font-bold text-sm">{label?.name?.charAt(0)?.toUpperCase() || 'C'}</span></div>}
                <div className="min-w-0"><p className="text-sm font-bold text-ink truncate">{label?.name || 'Workspace'}</p><p className="text-[11px] text-gray-400">Invoice</p></div>
              </div>
              <div className="text-right"><p className="text-[10px] uppercase tracking-widest text-gray-400">Invoice</p><p className="text-sm font-mono font-semibold text-ink">#{nextNumber ?? '—'}</p></div>
            </div>

            <div className="space-y-1 mb-5 text-sm">
              <p className="text-[10px] uppercase tracking-widest text-gray-400">Bill to</p>
              <p className="font-medium text-ink">{form.bill_to || '—'}</p>
              {form.bill_to_address && <p className="text-gray-500 whitespace-pre-line text-xs">{form.bill_to_address}</p>}
              {form.purchase_order && <p className="text-xs text-gray-400 mt-1">PO: {form.purchase_order}</p>}
            </div>

            <table className="w-full text-sm mb-4">
              <thead><tr className="text-left text-[10px] uppercase tracking-widest text-gray-400 border-b border-divider"><th className="py-1.5 font-semibold">Item</th><th className="py-1.5 font-semibold text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-divider">
                {lines.filter(l => l.description.trim() || l.amount).map((l, i) => (
                  <tr key={i}><td className="py-1.5 text-gray-700">{l.description || '—'}</td><td className="py-1.5 text-right text-gray-700">{money(l.amount)}</td></tr>
                ))}
                {lines.filter(l => l.description.trim() || l.amount).length === 0 && (
                  <tr><td colSpan={2} className="py-2 text-gray-300 text-xs">No line items yet</td></tr>
                )}
              </tbody>
            </table>

            <div className="flex items-center justify-between pt-3 border-t-2 border-ink/10">
              <span className="text-sm font-semibold text-ink">Total</span>
              <span className="text-lg font-bold text-ink">{money(total)}</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Due {form.due_by || 'UPON RECEIPT'}{form.description ? ` · ${form.description}` : ''}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

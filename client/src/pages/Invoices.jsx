import { useEffect, useState } from 'react'
import { Plus, Trash2, Receipt, Check } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

const blankLine = () => ({ description: '', amount: '' })

export default function Invoices() {
  const { toast } = useToast()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [nextNumber, setNextNumber] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ bill_to: '', bill_to_address: '', description: '', purchase_order: '', due_by: 'UPON RECEIPT' })
  const [lines, setLines] = useState([blankLine()])

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/invoices'), api.get('/invoices/next-number')])
      .then(([inv, num]) => { setInvoices(inv.data.data || []); setNextNumber(num.data.data.next_number) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

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
      setForm({ bill_to: '', bill_to_address: '', description: '', purchase_order: '', due_by: 'UPON RECEIPT' })
      setLines([blankLine()])
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create invoice', 'error')
    } finally { setSaving(false) }
  }

  const togglePaid = async (inv) => {
    const next = inv.payment_status === 'Paid' ? 'Unpaid' : 'Paid'
    try { await api.put(`/invoices/${inv.id}`, { payment_status: next }); load() }
    catch { toast('Failed', 'error') }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this invoice?')) return
    try { await api.delete(`/invoices/${id}`); load() } catch { toast('Failed', 'error') }
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Invoices you issue"
        action={<button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> New invoice</button>}
      />

      {showForm && (
        <form onSubmit={create} className="card p-5 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">New invoice</h2>
            {nextNumber != null && <span className="text-xs text-gray-400">Will be #{nextNumber}</span>}
          </div>
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
            <button type="button" onClick={() => setLines(ls => [...ls, blankLine()])} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">+ Add line</button>
            <p className="text-right text-sm font-semibold text-ink mt-2">Total: ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>

          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create invoice'}</button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <div className="card p-10 text-center"><Receipt size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No invoices yet.</p></div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {['#', 'Bill to', 'Amount', 'Due', 'Status', ''].map(h => <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-gray-500">#{inv.invoice_number}</td>
                  <td className="px-4 py-3 font-medium text-ink">{inv.bill_to}</td>
                  <td className="px-4 py-3 text-ink">${Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.due_by}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => togglePaid(inv)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${inv.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {inv.payment_status === 'Paid' && <Check size={11} />} {inv.payment_status}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(inv.id)} className="text-gray-400 hover:text-danger" title="Delete"><Trash2 size={15} /></button>
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

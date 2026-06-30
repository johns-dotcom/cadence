import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Receipt, Check } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

export default function Invoices() {
  const { toast } = useToast()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.get('/invoices')
      .then((inv) => setInvoices(inv.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

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
        action={<Link to="/invoices/new" className="btn-primary"><Plus size={16} /> New invoice</Link>}
      />

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : invoices.length === 0 ? (
        <div className="card p-10 text-center">
          <Receipt size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-4">No invoices yet.</p>
          <Link to="/invoices/new" className="btn-primary inline-flex"><Plus size={16} /> Create your first invoice</Link>
        </div>
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

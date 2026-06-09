import { useEffect, useState } from 'react'
import { CreditCard, CalendarClock, Check, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { PAYMENT_TERMS, PAYMENT_METHODS } from '../constants'

const today = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })
const isOverdue = (d) => d && new Date(d) < new Date(new Date().toDateString())

// Sum payables by currency.
function totalsByCurrency(rows) {
  const t = {}
  rows.forEach(r => { t[r.currency] = (t[r.currency] || 0) + Number(r.amount || 0) })
  return t
}

export default function Payments() {
  const { toast } = useToast()
  const [tab, setTab] = useState('due') // due | paid
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [payModal, setPayModal] = useState(null)   // { ids } | null
  const [schedModal, setSchedModal] = useState(null) // { id } | null

  const load = () => {
    setLoading(true)
    setSel(new Set())
    const url = tab === 'due' ? '/ledger/payables' : '/ledger/entries?payment_status=Paid'
    api.get(url).then(res => setRows(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [tab])

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(s => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))

  const selectedRows = rows.filter(r => sel.has(r.id))
  const selTotals = totalsByCurrency(selectedRows)

  const doPay = async ({ payment_date, payment_method }) => {
    const ids = payModal.ids
    try {
      if (ids.length === 1) await api.post(`/ledger/entries/${ids[0]}/mark-paid`, { payment_date, payment_method })
      else await api.post('/ledger/batch-pay', { ids, payment_date, payment_method })
      toast(`Marked ${ids.length} paid`); setPayModal(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const doSchedule = async ({ payment_terms, scheduled_payment_date }) => {
    try {
      await api.post(`/ledger/entries/${schedModal.id}/schedule`, { payment_terms, scheduled_payment_date: scheduled_payment_date || undefined })
      toast('Scheduled'); setSchedModal(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const dueTotals = totalsByCurrency(rows)

  return (
    <div>
      <PageHeader title="Payments" subtitle="Approved invoices awaiting payment" />

      <div className="flex items-center gap-1 mb-4">
        {['due', 'paid'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg capitalize transition ${tab === t ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {t === 'due' ? 'Due' : 'Paid'}
          </button>
        ))}
      </div>

      {/* Totals */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {Object.entries(tab === 'due' ? dueTotals : totalsByCurrency(rows)).map(([cur, amt]) => (
            <div key={cur} className="card px-4 py-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">{tab === 'due' ? 'Outstanding' : 'Paid'} ({cur})</p>
              <p className="text-lg font-bold text-ink">{cur} {fmt(amt)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Batch action bar */}
      {tab === 'due' && sel.size > 0 && (
        <div className="flex items-center justify-between card px-4 py-2.5 mb-3 bg-brand-50 border-brand-200">
          <span className="text-sm font-medium text-ink">
            {sel.size} selected · {Object.entries(selTotals).map(([c, a]) => `${c} ${fmt(a)}`).join(' · ')}
          </span>
          <button onClick={() => setPayModal({ ids: [...sel] })} className="btn-primary py-1.5"><CreditCard size={15} /> Mark paid</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center"><CreditCard size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">{tab === 'due' ? 'Nothing due. All caught up. 🎉' : 'No payments recorded yet.'}</p></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                {tab === 'due' && <th className="px-3 py-3"><input type="checkbox" checked={sel.size === rows.length} onChange={toggleAll} /></th>}
                {(tab === 'due'
                  ? ['Payee', 'Category', 'Amount', 'Invoice date', 'Due', 'Terms', '']
                  : ['Payee', 'Amount', 'Paid date', 'Method', 'Paid by']
                ).map(h => <th key={h} className="px-3 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map(r => tab === 'due' ? (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-3"><p className="font-medium text-ink">{r.payee}</p>{r.artist && <p className="text-xs text-gray-400">{r.artist}</p>}</td>
                  <td className="px-3 py-3 text-gray-600">{r.category || '—'}</td>
                  <td className="px-3 py-3 text-ink font-medium whitespace-nowrap">{r.currency} {fmt(r.amount)}</td>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {r.scheduled_payment_date
                      ? <span className={isOverdue(r.scheduled_payment_date) ? 'text-red-600 font-medium' : 'text-gray-600'}>{new Date(r.scheduled_payment_date).toLocaleDateString()}{isOverdue(r.scheduled_payment_date) ? ' · overdue' : ''}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{r.payment_terms || '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
                      <button onClick={() => setSchedModal({ id: r.id, terms: r.payment_terms || 'Net 30' })} className="text-gray-500 hover:text-brand-600 p-1" title="Schedule"><CalendarClock size={15} /></button>
                      <button onClick={() => setPayModal({ ids: [r.id] })} className="text-gray-500 hover:text-emerald-600 p-1" title="Mark paid"><Check size={16} /></button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-medium text-ink">{r.payee}</td>
                  <td className="px-3 py-3 text-ink">{r.currency} {fmt(r.amount)}</td>
                  <td className="px-3 py-3 text-gray-500">{r.payment_date ? new Date(r.payment_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-3 text-gray-500">{r.payment_method || '—'}</td>
                  <td className="px-3 py-3 text-gray-500">{r.paid_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payModal && <PayModal count={payModal.ids.length} onClose={() => setPayModal(null)} onConfirm={doPay} />}
      {schedModal && <ScheduleModal initialTerms={schedModal.terms} onClose={() => setSchedModal(null)} onConfirm={doSchedule} />}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div className="relative card p-5 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PayModal({ count, onClose, onConfirm }) {
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  return (
    <Modal title={`Mark ${count} paid`} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Payment date</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label className="label">Method</label><select className="input" value={method} onChange={e => setMethod(e.target.value)}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
        <button onClick={() => onConfirm({ payment_date: date, payment_method: method || undefined })} className="btn-primary w-full">Confirm payment</button>
      </div>
    </Modal>
  )
}

function ScheduleModal({ initialTerms, onClose, onConfirm }) {
  const [terms, setTerms] = useState(initialTerms || 'Net 30')
  const [date, setDate] = useState('')
  return (
    <Modal title="Schedule payment" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Payment terms</label><select className="input" value={terms} onChange={e => setTerms(e.target.value)}>{PAYMENT_TERMS.map(t => <option key={t}>{t}</option>)}</select></div>
        <div>
          <label className="label">Or a specific due date</label>
          <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">Leave blank to derive the due date from the invoice date + terms.</p>
        </div>
        <button onClick={() => onConfirm({ payment_terms: terms, scheduled_payment_date: date })} className="btn-primary w-full">Save schedule</button>
      </div>
    </Modal>
  )
}

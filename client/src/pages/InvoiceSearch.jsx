import { useEffect, useMemo, useState } from 'react'
import { Search, Paperclip, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
// Mirror of server normalizeInvoiceNum for client-side matching.
const normInv = (s) => String(s || '').toLowerCase().trim().replace(/^(invoice|inv|no\.?|#)[\s\-.:]*/i, '').replace(/[-\s.]/g, '').replace(/^0+/, '')
const weekKey = (d) => { const dt = new Date(d); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); return dt.toISOString().slice(0, 10) }

// Documents index: every invoice document that's come in, searchable by
// normalized invoice number / vendor / artist, with a submissions-per-week
// chart and a collapsible rejected section.
export default function InvoiceSearch() {
  const { toast } = useToast()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showRejected, setShowRejected] = useState(false)

  useEffect(() => { api.get('/ledger/entries').then(r => setEntries(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }, [])

  const openFile = async (id, type) => {
    try { const { data } = await api.get(`/ledger/entries/${id}/file/${type}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file', 'error') }
  }

  // Invoices = entries that carry an invoice file or came via a vendor.
  const invoices = useMemo(() => entries.filter(e => e.invoice_r2_key || e.vendor_submitted), [entries])

  const nq = normInv(q)
  const lq = q.trim().toLowerCase()
  const match = (e) => !q.trim() || (nq && normInv(e.invoice_number).includes(nq)) || `${e.payee} ${e.artist}`.toLowerCase().includes(lq)
  const active = invoices.filter(e => e.status !== 'rejected' && match(e))
  const rejected = invoices.filter(e => e.status === 'rejected' && match(e))

  // Submissions per week (last 12 weeks).
  const chart = useMemo(() => {
    const now = new Date(); const weeks = []
    for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i * 7); weeks.push(weekKey(d)) }
    const counts = Object.fromEntries(weeks.map(w => [w, 0]))
    invoices.forEach(e => { const w = weekKey(e.created_at); if (w in counts) counts[w]++ })
    return weeks.map(w => ({ week: w.slice(5), n: counts[w] }))
  }, [invoices])

  const Row = ({ e }) => (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3"><p className="font-medium text-ink">{e.payee}</p>{e.artist && <p className="text-xs text-gray-400">{e.artist}</p>}</td>
      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{e.invoice_number || '—'}</td>
      <td className="px-4 py-3 text-ink whitespace-nowrap">{money(e.amount, e.currency)}</td>
      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDate(e.invoice_date || e.created_at)}</td>
      <td className="px-4 py-3">
        <span className="inline-flex gap-2">
          {e.invoice_r2_key && <button onClick={() => openFile(e.id, 'invoice')} title="Invoice" className="text-gray-400 hover:text-brand-600"><Paperclip size={14} /></button>}
          {e.w9_r2_key && <button onClick={() => openFile(e.id, 'w9')} className="text-[11px] text-gray-400 hover:text-brand-600 font-bold">W9</button>}
          {e.receipt_r2_key && <button onClick={() => openFile(e.id, 'receipt')} className="text-[11px] text-gray-400 hover:text-brand-600 font-bold">RCT</button>}
        </span>
      </td>
    </tr>
  )

  return (
    <div>
      <PageHeader title="Invoice search" subtitle="Every invoice document received, searchable" />

      {!loading && (
        <div className="card p-4 mb-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Submissions per week</p>
          <div style={{ height: 120 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}><XAxis dataKey="week" tick={{ fontSize: 10 }} interval={1} /><Tooltip /><Bar dataKey="n" fill="rgb(var(--color-brand-500))" radius={[3, 3, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice # (INV-0012 = 12), vendor, or artist…" className="input !pl-9" />
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={5} /></div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-page/50 border-b border-divider text-left">
                {['Vendor', 'Invoice #', 'Amount', 'Date', 'Files'].map(h => <th key={h} className="px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-divider">
                {active.length ? active.map(e => <Row key={e.id} e={e} />) : <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400"><FileText size={24} className="text-gray-300 mx-auto mb-2" />No invoices match.</td></tr>}
              </tbody>
            </table>
          </div>

          {rejected.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowRejected(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 mb-2">
                {showRejected ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Rejected ({rejected.length})
              </button>
              {showRejected && (
                <div className="card overflow-x-auto opacity-80">
                  <table className="w-full text-sm"><tbody className="divide-y divide-divider">{rejected.map(e => <Row key={e.id} e={e} />)}</tbody></table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

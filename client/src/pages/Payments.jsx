import { useEffect, useState } from 'react'
import { CreditCard, CalendarClock, Check, X, Zap, Send, MailCheck, Pause, Download, Upload, Eye } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import EmailPreviewModal from '../components/EmailPreviewModal'
import { useToast } from '../context/ToastContext'
import { PAYMENT_TERMS, PAYMENT_METHODS } from '../constants'
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatDate, isPastLocal, daysUntilLocal } from '../utils/dates'
import useIsMobile from '../hooks/useIsMobile'

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })
const usd = (n) => `$${fmt(n)}`
const today = () => new Date().toISOString().slice(0, 10)

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'duesoon', label: 'Due Soon' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'rush', label: 'Rush' },
  { key: 'hold', label: 'Hold' },
  { key: 'paid', label: 'Paid' },
]

function totalsByCurrency(rows) {
  const t = {}
  // family_amount collapses split families into their parent's full total.
  rows.forEach(r => { t[r.currency] = (t[r.currency] || 0) + Number(r.family_amount ?? r.amount ?? 0) })
  return t
}

export default function Payments() {
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const [filter, setFilter] = useState('all')
  const [preview, setPreview] = useState(null) // { url, label } file pop-up
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [reps, setReps] = useState({})
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [payModal, setPayModal] = useState(null)
  const [schedModal, setSchedModal] = useState(null)
  const [emailItems, setEmailItems] = useState(null)
  const [ccRep, setCcRep] = useState(false) // default OFF per spec

  const isPaid = filter === 'paid'

  const load = () => {
    setLoading(true); setSel(new Set())
    const url = isPaid ? '/ledger/entries?payment_status=Paid' : '/ledger/payables'
    api.get(url).then(res => setRows(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
    api.get('/ledger/payment-stats').then(r => setStats(r.data.data)).catch(() => {})
  }
  useEffect(() => { load() }, [filter])
  useEffect(() => { api.get('/reps').then(r => setReps(Object.fromEntries((r.data.data || []).filter(x => x.email).map(x => [String(x.name).toLowerCase(), x.email])))).catch(() => {}) }, [])
  useEffect(() => { api.get('/ledger/payment-analytics').then(r => setAnalytics(r.data.data)).catch(() => {}) }, [])

  // Client-side quick filter over the payables list (paid loads its own list).
  // /payables now also returns anything paid in the last 7 days; those linger under
  // "All" only — a paid invoice is not unpaid, due soon, overdue, rush or held.
  const shown = isPaid ? rows : rows.filter(r => {
    if (filter === 'all') return true
    if (r.payment_status === 'Paid') return false
    if (filter === 'unpaid') return !r.on_hold
    if (filter === 'rush') return r.rush
    if (filter === 'hold') return r.on_hold
    if (r.on_hold) return false // held rows leave Due Soon / Overdue
    const d = daysUntilLocal(r.scheduled_payment_date)
    if (filter === 'overdue') return isPastLocal(r.scheduled_payment_date)
    if (filter === 'duesoon') return d !== null && d >= 0 && d <= 7
    return true
  })

  const openFile = (id, type) => api.get(`/ledger/entries/${id}/file/${type}`).then(({ data }) => setPreview({ url: data.data.url, label: type })).catch(() => toast('No file', 'error'))
  // Dropping a proof marks the whole split family paid — that's the point of the
  // control. Goes to pay-with-proof rather than the plain file-attach route, which
  // only ever turned the cell green and left the row Unpaid.
  //
  // Deliberately sends NO payment_date, so the server's AI extraction supplies the
  // date off the document. Via PayModal that extraction is dead code, because the
  // modal always posts today's date.
  const uploadProof = async (id, file) => {
    if (!file) return
    try {
      const fd = new FormData(); fd.append('proof', file)
      const { data } = await api.post(`/ledger/entries/${id}/pay-with-proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data || {}
      toast(`Marked paid${d.payment_date ? ` · ${formatDate(d.payment_date)}` : ''}${d.reference ? ` · ref ${d.reference}` : ''}`)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
  }
  const exportCsv = () => {
    const cols = isPaid
      ? ['Payee', 'Amount', 'Currency', 'Paid date', 'Method', 'Reference']
      : ['Date', 'Payee', 'Artist', 'Inv #', 'Amount', 'Currency', 'Rep', 'Vendor email', 'Due date', 'Status', 'Bank']
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const line = (r) => (isPaid
      ? [r.payee, r.amount, r.currency, formatDate(r.payment_date), r.payment_method, r.payment_ref]
      : [formatDate(r.invoice_date), r.payee, r.artist, r.invoice_number, r.amount, r.currency, r.rep, r.vendor_email, formatDate(r.scheduled_payment_date), r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'Hold' : r.rush ? 'Rush' : (r.payment_status || 'Unpaid'), r.vendor_bank]).map(cell).join(',')
    const csv = [cols.map(cell).join(','), ...shown.map(line)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `payments-${filter}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // Paid rows have no checkbox, so they must not be swept up by select-all either.
  const selectable = shown.filter(r => r.payment_status !== 'Paid')
  const toggleAll = () => setSel(s => s.size === selectable.length ? new Set() : new Set(selectable.map(r => r.id)))
  const selectedRows = shown.filter(r => sel.has(r.id))
  const selTotals = totalsByCurrency(selectedRows)

  const doPay = async ({ payment_date, payment_method, payment_ref, proof }) => {
    const ids = payModal.ids
    try {
      if (proof && ids.length === 1) {
        const fd = new FormData(); fd.append('proof', proof)
        if (payment_date) fd.append('payment_date', payment_date)
        if (payment_method) fd.append('payment_method', payment_method)
        if (payment_ref) fd.append('payment_ref', payment_ref)
        const { data } = await api.post(`/ledger/entries/${ids[0]}/pay-with-proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        toast(`Paid${data.data.reference ? ` · ref ${data.data.reference}` : ''}`)
      } else if (ids.length === 1) await api.post(`/ledger/entries/${ids[0]}/mark-paid`, { payment_date, payment_method, payment_ref })
      else await api.post('/ledger/batch-pay', { ids, payment_date, payment_method })
      setPayModal(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Send-for-Approval: preview the approval_request email, then POST the
  // attachment-bearing route (Excel summary + invoice PDFs) on Send.
  const sendForApproval = () => {
    const rows = selectedRows
    if (!rows.length) return
    const byCur = {}
    rows.forEach(r => { byCur[r.currency || 'USD'] = (byCur[r.currency || 'USD'] || 0) + Number(r.family_amount ?? r.amount ?? 0) })
    const totalLine = Object.entries(byCur).map(([c, a]) => `${c} ${fmt(a)}`).join(' · ')
    const ids = [...sel]
    setEmailItems([{
      kind: 'approval_request', label: `${rows.length} invoice(s)`,
      ctx: { to: '', count: rows.length, totalLine, note: '' },
      onCustomSend: async ({ to, cc }) => { await api.post('/ledger/send-for-approval', { ids, to: [to, ...cc].filter(Boolean), note: '' }) },
    }])
  }
  const doSchedule = async ({ payment_terms, scheduled_payment_date }) => {
    try {
      await api.post(`/ledger/entries/${schedModal.id}/schedule`, { payment_terms, scheduled_payment_date: scheduled_payment_date || undefined })
      toast('Scheduled'); setSchedModal(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const toggleRush = async (r) => {
    try {
      if (r.rush) await api.delete(`/ledger/entries/${r.id}/rush`)
      else await api.post(`/ledger/entries/${r.id}/rush`, { reason: window.prompt('Why is this a rush? (optional)') ?? '' })
      load()
    } catch { toast('Failed', 'error') }
  }
  const toggleHold = async (r) => {
    try {
      if (r.on_hold) await api.delete(`/ledger/entries/${r.id}/hold`)
      else await api.post(`/ledger/entries/${r.id}/hold`, { reason: window.prompt('Reason for hold? (optional)') ?? '' })
      load()
    } catch { toast('Failed', 'error') }
  }
  const bulkFlag = async (kind) => {
    const reason = window.prompt(`${kind === 'rush' ? 'Rush' : 'Hold'} reason for selected (optional)`) ?? ''
    try { await api.post(`/ledger/${kind}-bulk`, { ids: [...sel], reason }); toast(`${sel.size} ${kind === 'rush' ? 'flagged rush' : 'held'}`); load() }
    catch { toast('Failed', 'error') }
  }

  // Build confirmation items with CC = vendor saved emails (+ rep if toggled).
  const buildConfirmItems = async (list) => {
    const items = []
    for (const r of list) {
      const cc = []
      try { const { data } = await api.get(`/ledger/vendors/${encodeURIComponent(r.payee)}/emails`); cc.push(...data.data.map(e => e.email)) } catch { /* none */ }
      if (ccRep && r.rep && reps[r.rep.toLowerCase()]) cc.push(reps[r.rep.toLowerCase()])
      items.push({
        kind: 'payment_confirmation', label: r.payee,
        ctx: { to: r.vendor_email || '', cc: [...new Set(cc)], vendorName: r.vendor_name || r.payee, invoiceNumber: r.invoice_number, amount: r.amount, currency: r.currency, method: r.payment_method, date: r.payment_date },
        onItemSent: () => api.post(`/ledger/entries/${r.id}/mark-sent`).catch(() => {}),
      })
    }
    return items
  }
  const sendConfirm = async (r) => {
    if (!r.vendor_email) { toast('No vendor email on this entry', 'error'); return }
    setEmailItems(await buildConfirmItems([r]))
  }
  const sendConfirmBulk = async () => {
    const list = selectedRows.filter(r => r.vendor_email)
    if (!list.length) { toast('No selected rows have a vendor email', 'error'); return }
    setEmailItems(await buildConfirmItems(list))
  }

  const c = stats?.counts || {}
  const CARDS = stats ? [
    { label: 'Overdue', value: usd(stats.overdue), sub: `${c.overdue || 0} invoices`, color: 'text-rose-600' },
    { label: 'Due within 7 days', value: usd(stats.duesoon), sub: `${c.duesoon || 0} invoices`, color: 'text-amber-600' },
    { label: 'Total unpaid', value: usd(stats.outstanding), sub: `${c.unpaid || 0} invoices`, color: 'text-ink' },
    { label: 'Paid recently', value: usd(stats.paidRecent), sub: `${c.paidRecent || 0} in the last 7 days`, color: 'text-emerald-600' },
    { label: 'Total entries', value: String((c.unpaid || 0) + (c.paidRecent || 0)), sub: 'unpaid + recent', color: 'text-ink' },
  ] : []

  return (
    <div>
      <PageHeader title="Payment Dashboard" subtitle="Unpaid invoices and anything paid in the last 7 days. Older payments live in the ledger." />

      {/* Filters + export */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'text-gray-500 border-rule hover:bg-gray-100'}`}>{f.label}</button>
          ))}
        </div>
        <button onClick={exportCsv} className="btn-secondary py-1.5 ml-auto"><Download size={15} /> CSV</button>
      </div>

      {/* Headline stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {CARDS.map(card => (
          <div key={card.label} className="card p-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{card.label}</p>
            <p className={`text-2xl font-bold leading-tight mt-1.5 ${card.color}`}>{card.value}</p>
            <p className="text-[11px] text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Weekly trend cards (last 12 weeks) */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <WeeklyTrend title="Invoices logged / week" series={analytics.submissions} color="#6366f1" />
          <WeeklyTrend title="Paid / week" series={analytics.paid} color="#10b981" />
        </div>
      )}

      {/* Invoices header */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-bold text-ink">Invoices</h2>
        <span className="text-sm text-gray-400">{shown.length}</span>
      </div>

      {/* Batch action bar */}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 card px-4 py-2.5 mb-3 bg-brand-50 border-brand-200">
          <span className="text-sm font-medium text-ink">{sel.size} selected · {Object.entries(selTotals).map(([c, a]) => `${c} ${fmt(a)}`).join(' · ')}</span>
          <div className="flex items-center gap-2">
            {!isPaid && <button onClick={() => bulkFlag('rush')} className="btn-secondary py-1.5"><Zap size={15} /> Rush</button>}
            {!isPaid && <button onClick={() => bulkFlag('hold')} className="btn-secondary py-1.5"><Pause size={15} /> Hold</button>}
            {!isPaid && <button onClick={sendForApproval} className="btn-secondary py-1.5"><Send size={15} /> Send for approval</button>}
            {!isPaid && <button onClick={() => setPayModal({ ids: [...sel] })} className="btn-primary py-1.5"><CreditCard size={15} /> Mark paid</button>}
            {isPaid && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer mr-1"><input type="checkbox" checked={ccRep} onChange={e => setCcRep(e.target.checked)} /> CC rep</label>
                <button onClick={sendConfirmBulk} className="btn-primary py-1.5"><Send size={15} /> Send confirmations</button>
              </>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={6} cols={6} /></div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><CreditCard size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">{isPaid ? 'No payments recorded yet.' : 'Nothing here. All caught up. 🎉'}</p></div>
      ) : isMobile ? (
        /* Mobile card list (<768px). The select checkbox drives the same bulk
           bar as desktop; quick actions mirror the row buttons. */
        <div className="space-y-2">
          {shown.map(r => (
            <div key={r.id} className={`card p-3 ${r.on_hold || (r.payment_status === 'Paid' && !isPaid) ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2.5">
                {r.payment_status === 'Paid' && !isPaid
                  ? <span className="mt-1 w-4 flex-shrink-0" aria-hidden="true" />
                  : <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink truncate flex items-center gap-1.5">
                      {r.payee}
                      {r.rush && <Zap size={12} className="text-amber-600 flex-shrink-0" />}
                      {r.on_hold && <Pause size={12} className="text-gray-500 flex-shrink-0" />}
                    </p>
                    <span className="text-sm font-semibold text-ink tabular-nums flex-shrink-0">{r.currency} {fmt(r.family_amount ?? r.amount)}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate mt-0.5">
                    {isPaid || r.payment_status === 'Paid'
                      ? `${r.payment_method || '—'} · paid ${formatDate(r.payment_date)}`
                      : `${[r.category, r.artist].filter(Boolean).join(' · ') || '—'}${r.scheduled_payment_date ? ` · due ${formatDate(r.scheduled_payment_date)}` : ''}`}
                  </p>
                  <div className="flex items-center gap-1 mt-2 justify-end">
                    {r.payment_status === 'Paid' && !isPaid ? (
                      <span className="text-[11px] text-emerald-600 font-medium">Paid</span>
                    ) : isPaid ? (
                      r.vendor_email
                        ? <button onClick={() => sendConfirm(r)} className="inline-flex items-center gap-1 text-xs text-brand-600 px-1"><Send size={14} /> {r.payment_notified ? 'Resend' : 'Send confirmation'}</button>
                        : <span className="text-[11px] text-gray-300">no email</span>
                    ) : (
                      <>
                        <button onClick={() => toggleRush(r)} className={`p-1.5 ${r.rush ? 'text-amber-600' : 'text-gray-400'}`} title="Rush"><Zap size={16} /></button>
                        <button onClick={() => toggleHold(r)} className={`p-1.5 ${r.on_hold ? 'text-gray-700' : 'text-gray-400'}`} title="Hold"><Pause size={16} /></button>
                        <button onClick={() => setSchedModal({ id: r.id, terms: r.payment_terms || 'Net 30' })} className="text-gray-500 p-1.5" title="Schedule"><CalendarClock size={16} /></button>
                        <button onClick={() => setPayModal({ ids: [r.id] })} className="text-emerald-600 p-1.5" title="Mark paid"><Check size={17} /></button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-page/50 border-b border-divider text-left">
                <th className="px-3 py-2.5"><input type="checkbox" checked={selectable.length > 0 && sel.size === selectable.length} onChange={toggleAll} /></th>
                {(isPaid ? ['Payee', 'Amount', 'Paid date', 'Method', 'Confirmation', '']
                  : ['Date', 'Payee', 'Artist', 'Inv #', 'Amount', 'Rep', 'Due date', 'Status', 'Bank', 'Invoice', 'Proof', '']
                ).map(h => <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shown.map(r => isPaid ? (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-3 font-medium text-ink">{r.payee}</td>
                  <td className="px-3 py-3 text-ink">{r.currency} {fmt(r.amount)}</td>
                  <td className="px-3 py-3 text-gray-500">{formatDate(r.payment_date)}</td>
                  <td className="px-3 py-3 text-gray-500">{r.payment_method || '—'}</td>
                  <td className="px-3 py-3">{r.payment_notified ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium"><MailCheck size={13} /> Sent</span> : <span className="text-xs text-gray-400">Not sent</span>}</td>
                  <td className="px-3 py-3 text-right">{r.vendor_email ? <button onClick={() => sendConfirm(r)} className="text-gray-500 hover:text-brand-600 p-1" title={r.payment_notified ? 'Resend confirmation' : 'Send confirmation'}><Send size={15} /></button> : <span className="text-[11px] text-gray-300">no email</span>}</td>
                </tr>
              ) : (
                <tr key={r.id} className={`hover:bg-gray-50 ${r.on_hold || r.payment_status === 'Paid' ? 'opacity-60' : ''}`}>
                  {/* Recently-paid rows linger here for 7 days but are done: no
                      checkbox (nothing left to bulk-act on) and no action icons. */}
                  <td className="px-3 py-3">{r.payment_status !== 'Paid' && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.invoice_date)}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-ink flex items-center gap-1.5">
                      {r.payee}
                      {r.rush && <span title={r.rush_reason || 'Rush'} className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded"><Zap size={10} /> Rush</span>}
                      {r.on_hold && <span title={r.hold_reason || 'On hold'} className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded"><Pause size={10} /> Hold</span>}
                      {r.split_count > 0 && <span className="text-[10px] font-bold uppercase bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded">Split</span>}
                    </p>
                    {r.vendor_email && <p className="text-[11px] text-gray-400 truncate max-w-[200px]">{r.vendor_email}</p>}
                  </td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.artist || '—'}</td>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{r.invoice_number || '—'}</td>
                  <td className="px-3 py-3 text-ink font-medium whitespace-nowrap">{r.currency} {fmt(r.family_amount ?? r.amount)}{r.split_count > 0 && <span className="block text-[10px] text-gray-400 font-normal">family total</span>}</td>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{r.rep || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {r.scheduled_payment_date
                      ? <span className={isPastLocal(r.scheduled_payment_date) && !r.on_hold && r.payment_status !== 'Paid' ? 'text-red-600 font-medium' : 'text-gray-600'}>{formatDate(r.scheduled_payment_date)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${r.payment_status === 'Paid' ? 'bg-emerald-50 text-emerald-700' : r.on_hold ? 'bg-gray-200 text-gray-600' : r.payment_status === 'Partial' ? 'bg-amber-100 text-amber-700' : 'bg-rose-50 text-rose-600'}`}>{r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'On hold' : (r.payment_status || 'Unpaid')}</span>
                  </td>
                  <td className="px-3 py-3 text-gray-500 truncate max-w-[140px]">{r.vendor_bank || '—'}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.invoice_r2_key ? <button onClick={() => openFile(r.id, 'invoice')} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><Eye size={13} /> View</button> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {/* proof_r2_key is the payment proof; receipt_r2_key is the
                        expense receipt a reimbursement is claiming. Falling back to
                        receipt keeps every pre-existing row's link working. */}
                    {(r.proof_r2_key || r.receipt_r2_key)
                      ? <button onClick={() => openFile(r.id, r.proof_r2_key ? 'proof' : 'receipt')} className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"><Eye size={13} /> Proof</button>
                      : r.payment_status === 'Paid'
                        ? <span className="text-gray-300">—</span>
                        : <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadProof(r.id, e.dataTransfer.files?.[0]) }} title="Attaching proof marks this paid" className="inline-flex items-center gap-1 text-[11px] text-gray-400 border border-dashed border-rule rounded px-2 py-1 cursor-pointer hover:border-brand-300 hover:text-brand-600"><Upload size={12} /> Drop file<input type="file" accept="application/pdf,image/*" hidden onChange={e => uploadProof(r.id, e.target.files?.[0])} /></label>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
                      {r.payment_status === 'Paid' ? <span className="text-[11px] text-gray-400">Paid {formatDate(r.payment_date)}</span> : <>
                      <button onClick={() => toggleRush(r)} className={`p-1 ${r.rush ? 'text-amber-600' : 'text-gray-400 hover:text-amber-600'}`} title={r.rush ? 'Clear rush' : 'Flag rush'}><Zap size={15} /></button>
                      <button onClick={() => toggleHold(r)} className={`p-1 ${r.on_hold ? 'text-gray-700' : 'text-gray-400 hover:text-gray-700'}`} title={r.on_hold ? 'Release hold' : 'Hold'}><Pause size={15} /></button>
                      <button onClick={() => setSchedModal({ id: r.id, terms: r.payment_terms || 'Net 30' })} className="text-gray-500 hover:text-brand-600 p-1" title="Schedule"><CalendarClock size={15} /></button>
                      <button onClick={() => setPayModal({ ids: [r.id] })} className="text-gray-500 hover:text-emerald-600 p-1" title="Mark paid"><Check size={16} /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payModal && <PayModal count={payModal.ids.length} onClose={() => setPayModal(null)} onConfirm={doPay} />}
      {schedModal && <ScheduleModal initialTerms={schedModal.terms} onClose={() => setSchedModal(null)} onConfirm={doSchedule} />}
      {emailItems && <EmailPreviewModal items={emailItems} onClose={() => setEmailItems(null)} onDone={() => { setEmailItems(null); load() }} />}
      {preview && (
        <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule flex-shrink-0">
              <span className="text-sm font-semibold text-ink capitalize">{preview.label}</span>
              <div className="flex items-center gap-3">
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">Open in new tab</a>
                <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-ink"><X size={18} /></button>
              </div>
            </div>
            <iframe src={preview.url} title="File preview" className="flex-1 w-full bg-gray-100" />
          </div>
        </div>
      )}
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
  const [ref, setRef] = useState('')
  const [proof, setProof] = useState(null)
  return (
    <Modal title={`Mark ${count} paid`} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="label">Payment date</label><input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label className="label">Method</label><select className="input" value={method} onChange={e => setMethod(e.target.value)}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
        {count === 1 && <div><label className="label">Reference</label><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="confirmation / wire ref" /></div>}
        {count === 1 && (
          <div>
            <label className="label">Proof of payment (optional — AI reads date & ref)</label>
            <input type="file" className="input py-1.5" onChange={e => setProof(e.target.files?.[0] || null)} />
          </div>
        )}
        <button onClick={() => onConfirm({ payment_date: date, payment_method: method || undefined, payment_ref: ref || undefined, proof })} className="btn-primary w-full">{proof ? 'Pay with proof' : 'Confirm payment'}</button>
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

// Tiny 12-week bar chart. `series` = [{ week, count, amount }].
function WeeklyTrend({ title, series, color }) {
  const data = (series || []).map(s => ({ ...s, label: s.week.slice(5) }))
  const total = data.reduce((a, d) => a + (d.count || 0), 0)
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
        <span className="text-xs text-gray-400">{total} in 12 wks</span>
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9ca3af' }} interval={1} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v, n) => [v, n === 'count' ? 'entries' : n]} labelFormatter={(l) => `Week of ${l}`} />
            <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

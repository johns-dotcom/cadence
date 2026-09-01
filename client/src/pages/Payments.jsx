import { useEffect, useMemo, useRef, useState } from 'react'
import { CreditCard, CalendarClock, Check, X, Zap, Send, MailCheck, Pause, Download, Upload, Eye, Pencil, Trash2, ChevronRight, ChevronDown, Receipt, FileSpreadsheet, Undo2, SlidersHorizontal, CalendarDays, List, AlertTriangle } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import EmailPreviewModal from '../components/EmailPreviewModal'
import BankEvidenceDot from '../components/BankEvidenceDot'
import CategoryOptions from '../components/CategoryOptions'
import BottomSheet from '../components/ui/BottomSheet'
import { useToast } from '../context/ToastContext'
import { PAYMENT_TERMS, PAYMENT_METHODS, CURRENCIES } from '../constants'
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatDate, isPastLocal, daysUntilLocal } from '../utils/dates'
import useIsMobile from '../hooks/useIsMobile'
import useEscapeStack from '../hooks/useEscapeStack'

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })
const usd = (n) => `$${fmt(n)}`
const usdFmt = (n) => `≈ USD ${fmt(n)}`
const today = () => new Date().toISOString().slice(0, 10)
const famAmt = (r) => Number(r.family_amount ?? r.amount ?? 0)

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'duesoon', label: 'Due Soon' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'rush', label: 'Rush' },
  { key: 'hold', label: 'Hold' },
  { key: 'multi', label: 'Multi-invoice' },
  { key: 'paid', label: 'Paid' },
]

// Method → badge tint (token-backed; raw *-100 fills go near-white in dark).
const METHOD_BADGE = {
  ACH: 'bg-brand-500/15 text-brand-ink', Wire: 'bg-violet-500/15 text-violet-700',
  Check: 'bg-teal-500/15 text-teal-700', 'Credit Card': 'bg-amber-500/15 text-warning',
  PayPal: 'bg-sky-500/15 text-sky-700', Cash: 'bg-gray-500/10 text-ink-muted',
}

// Amount filter grammar: `500` / `500-1000` / `>500` / `<=250`. Returns null on
// blank, {invalid:true} on unrecognized input so a typo never silently wipes
// the list (the field shows an amber ring instead).
function parseAmountQuery(s) {
  s = String(s || '').trim()
  if (!s) return null
  let m
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) return { min: +m[1], max: +m[2] }
  if ((m = s.match(/^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/))) {
    const v = +m[2]
    if (m[1] === '>') return { min: v, ex: true }
    if (m[1] === '>=') return { min: v }
    if (m[1] === '<') return { max: v, ex: true }
    return { max: v }
  }
  if (/^\d+(?:\.\d+)?$/.test(s)) return { eq: +s }
  return { invalid: true }
}
function matchesAmount(q, v) {
  if (!q || q.invalid) return true
  if (q.eq != null) return Math.abs(v - q.eq) < 0.005
  if (q.min != null && (q.ex ? v <= q.min : v < q.min)) return false
  if (q.max != null && (q.ex ? v >= q.max : v > q.max)) return false
  return true
}

function totalsByCurrency(rows) {
  const t = {}
  // family_amount collapses split families into their parent's full total.
  rows.forEach(r => { t[r.currency || 'USD'] = (t[r.currency || 'USD'] || 0) + famAmt(r) })
  return t
}
const totalsLine = (t) => Object.entries(t).map(([c, a]) => `${c} ${fmt(a)}`).join(' · ') || '—'
const usdOfRows = (rows) => rows.reduce((a, r) => a + Number(r.usd_equiv ?? ((r.currency || 'USD') === 'USD' ? famAmt(r) : 0)), 0)

// A paid row still owing its confirmation email (the send affordance's gate):
// paid + reachable + proof on file + not already notified.
const hasProof = (r) => !!(r.proof_r2_key || r.receipt_r2_key || Number(r.inst_count) > 0)
const pendingConfirmation = (r) => r.payment_status === 'Paid' && r.vendor_email && hasProof(r) && !r.payment_notified

const CC_DEFAULT_KEY = 'payments_cc_default'
const loadCcDefault = () => { try { const v = JSON.parse(localStorage.getItem(CC_DEFAULT_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

export default function Payments() {
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('list') // list | calendar
  const [preview, setPreview] = useState(null) // { url, label } file pop-up
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [reps, setReps] = useState([]) // [{name,email}]
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState(new Set())
  const [payModal, setPayModal] = useState(null)
  const [schedModal, setSchedModal] = useState(null)
  const [instModal, setInstModal] = useState(null) // row
  const [flagModal, setFlagModal] = useState(null) // { kind:'rush'|'hold', rows:[] }
  const [emailItems, setEmailItems] = useState(null)
  const [ccRep, setCcRep] = useState(false) // default OFF per spec
  const [ccDefault, setCcDefault] = useState(loadCcDefault)
  // Toolbar
  const [q, setQ] = useState('')
  const [amountQ, setAmountQ] = useState('')
  const [methodF, setMethodF] = useState('')
  const [statusF, setStatusF] = useState('')
  const [repF, setRepF] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [sort, setSort] = useState('due')
  const [filterSheet, setFilterSheet] = useState(false)
  const [sheetRow, setSheetRow] = useState(null)
  // Row state
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [childrenOf, setChildrenOf] = useState({})
  const [statusMenu, setStatusMenu] = useState(null)
  // Marking a rush row paid keeps it under the Rush chip for 10s — long enough
  // to reach its send-confirmation affordance before it re-files under All.
  const [rushGrace, setRushGrace] = useState(() => new Set())
  const [undo, setUndo] = useState(null) // { label, fn }
  const undoTimer = useRef(null)

  const isPaid = filter === 'paid'

  const load = () => {
    // ONE fetch serves every chip (boom's model): /payables = unpaid + the
    // 14-day paid window. The Paid chip filters that same window — the page
    // subtitle promises exactly this scope, and all-time paid history lives in
    // the ledger.
    api.get('/ledger/payables').then(res => setRows(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
    api.get('/ledger/payment-stats').then(r => setStats(r.data.data)).catch(() => {})
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setSel(new Set()) }, [filter])
  useEffect(() => { api.get('/reps').then(r => setReps((r.data.data || []).filter(x => x.name))).catch(() => {}) }, [])
  useEffect(() => { api.get('/ledger/payment-analytics').then(r => setAnalytics(r.data.data)).catch(() => {}) }, [])

  const repEmail = (name) => reps.find(x => x.name === name)?.email || null

  const pushUndo = (label, fn) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo({ label, fn })
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }
  const runUndo = async () => {
    const u = undo
    setUndo(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    try { await u.fn(); toast('Undone'); load() } catch (err) { toast(err.response?.data?.error || 'Undo failed', 'error') }
  }

  // ── Vendor batching worklist (Multi-invoice) ─────────────────────────────
  // Open-invoice count per vendor, counted by FAMILY over the FULL set (not
  // the current chip), excluding held (kept for the tooltip). Mixed currency
  // or method inside one vendor's batch gets a ⚠ — it can't go as one transfer.
  const vendorOpen = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (r.payment_status === 'Paid') continue
      const k = String(r.payee || '').trim().toLowerCase()
      if (!k) continue
      const v = m.get(k) || { count: 0, held: 0, currencies: new Set(), methods: new Set() }
      if (r.on_hold) v.held++
      else {
        v.count++
        v.currencies.add(r.currency || 'USD')
        if (r.payment_method) v.methods.add(r.payment_method)
      }
      m.set(k, v)
    }
    return m
  }, [rows])

  // ── Filter pipeline ───────────────────────────────────────────────────────
  const amountQuery = parseAmountQuery(amountQ)
  const chipFiltered = rows.filter(r => {
    if (isPaid) return r.payment_status === 'Paid'
    if (filter === 'all') return true
    if (r.payment_status === 'Paid') return filter === 'rush' && rushGrace.has(r.id)
    // Unpaid = everything not Paid (incl. held — the Total-unpaid card counts
    // them too, and a chip that disagrees with its card is a bug, not a view).
    if (filter === 'unpaid') return true
    if (filter === 'rush') return r.rush
    if (filter === 'hold') return r.on_hold
    if (filter === 'multi') return (vendorOpen.get(String(r.payee || '').trim().toLowerCase())?.count || 0) > 1 && !r.on_hold
    if (r.on_hold) return false // held rows leave Due Soon / Overdue
    if (filter === 'overdue') return isPastLocal(r.scheduled_payment_date)
    const d = daysUntilLocal(r.scheduled_payment_date)
    if (filter === 'duesoon') return d !== null && d >= 0 && d <= 7
    return true
  })
  const shown = useMemo(() => {
    const lq = q.trim().toLowerCase()
    let out = chipFiltered.filter(r => {
      if (lq && !`${r.payee} ${r.vendor_name || ''} ${r.artist || ''} ${r.invoice_number || ''}`.toLowerCase().includes(lq)) return false
      if (!matchesAmount(amountQuery, famAmt(r))) return false
      if (methodF && r.payment_method !== methodF) return false
      if (statusF) {
        const st = r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'Hold' : (r.payment_status || 'Unpaid')
        if (st !== statusF) return false
      }
      if (repF === '__none' ? r.rep : (repF && r.rep !== repF)) return false
      return true
    })
    // Amount sorts compare USD equivalents (family-aware — usd_equiv is served
    // per head off the locked rate) so a 900 GBP invoice outranks 1000 MXN.
    const usdOf = (r) => Number(r.usd_equiv ?? famAmt(r))
    const cmp = {
      due: (a, b) => String(a.scheduled_payment_date || '9999').localeCompare(String(b.scheduled_payment_date || '9999')) || String(a.invoice_date || '').localeCompare(String(b.invoice_date || '')) || a.id - b.id,
      new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      old: (a, b) => new Date(a.created_at) - new Date(b.created_at),
      amount: (a, b) => usdOf(b) - usdOf(a),
      'amount-low': (a, b) => usdOf(a) - usdOf(b),
      payee: (a, b) => String(a.payee || '').localeCompare(String(b.payee || '')),
    }[sort]
    if (cmp) out = [...out].sort(cmp)
    return out
  }, [chipFiltered, q, amountQ, methodF, statusF, repF, sort]) // eslint-disable-line

  // Group-by renders header rows between segments.
  const grouped = useMemo(() => {
    if (!groupBy) return [{ key: null, rows: shown }]
    const g = new Map()
    for (const r of shown) {
      const k = groupBy === 'method' ? (r.payment_method || 'No method') : (r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'Hold' : (r.payment_status || 'Unpaid'))
      if (!g.has(k)) g.set(k, [])
      g.get(k).push(r)
    }
    return [...g.entries()].map(([key, rows]) => ({ key, rows }))
  }, [shown, groupBy])

  const openFile = (id, type) => api.get(`/ledger/entries/${id}/file/${type}`).then(({ data }) => setPreview({ url: data.data.url, label: type })).catch(() => toast('No file', 'error'))

  // Dropping a proof marks the whole split family paid — that's the point of the
  // control. Deliberately sends NO payment_date, so the server's AI extraction
  // supplies the date off the document.
  const uploadProof = async (id, file) => {
    if (!file) return
    try {
      const fd = new FormData(); fd.append('proof', file)
      const { data } = await api.post(`/ledger/entries/${id}/pay-with-proof`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data || {}
      toast(`Marked paid${d.payment_date ? ` · ${formatDate(d.payment_date)}` : ''}${d.reference ? ` · ref ${d.reference}` : ''}`)
      afterPay([id])
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
  }

  const exportCsv = () => {
    const cols = isPaid
      ? ['Payee', 'Amount', 'Currency', 'Paid date', 'Method', 'Reference', 'Confirmation']
      : ['Date', 'Payee', 'Artist', 'Song', 'Inv #', 'Amount', 'Currency', 'Method', 'Rep', 'Vendor email', 'Due date', 'Status', 'Paid date', 'Bank']
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const line = (r) => (isPaid
      ? [r.payee, famAmt(r), r.currency, formatDate(r.payment_date), r.payment_method, r.payment_ref, r.payment_notified ? 'Sent' : '']
      : [formatDate(r.invoice_date), r.payee, r.artist, r.song, r.invoice_number, famAmt(r), r.currency, r.payment_method, r.rep, r.vendor_email, formatDate(r.scheduled_payment_date), r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'Hold' : r.rush ? 'Rush' : (r.payment_status || 'Unpaid'), formatDate(r.payment_date), r.vendor_bank]).map(cell).join(',')
    const csv = [cols.map(cell).join(','), ...shown.map(line)].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `payments-${filter}.csv`; a.click(); URL.revokeObjectURL(url)
  }
  const exportExcel = async () => {
    try {
      const f = filter === 'unpaid' ? 'unpaid' : filter === 'overdue' ? 'overdue' : filter === 'duesoon' ? 'due_soon' : 'all'
      const res = await api.get(`/ledger/payments-export?filter=${f}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = `payments-${f}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  // Unpaid rows AND paid rows still owing their confirmation are selectable.
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectable = shown.filter(r => r.payment_status !== 'Paid' || pendingConfirmation(r))
  // Membership check, not count equality (a boom-documented bug fix): the
  // selection may hold ids filtered out of view.
  const allSelected = selectable.length > 0 && selectable.every(r => sel.has(r.id))
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(selectable.map(r => r.id)))
  const pendingConf = shown.filter(pendingConfirmation)
  const selectedRows = rows.filter(r => sel.has(r.id))
  const selectedUnpaid = selectedRows.filter(r => r.payment_status !== 'Paid')
  const selectedPaidPending = selectedRows.filter(pendingConfirmation)
  const selTotals = totalsByCurrency(selectedRows)
  const filteredUnpaid = shown.filter(r => r.payment_status !== 'Paid')

  const afterPay = (ids) => {
    // Rush grace + undo, then refetch.
    const rushIds = ids.filter(id => rows.find(r => r.id === id)?.rush)
    if (rushIds.length) {
      setRushGrace(s => new Set([...s, ...rushIds]))
      setTimeout(() => setRushGrace(s => { const n = new Set(s); rushIds.forEach(i => n.delete(i)); return n }), 10000)
    }
    pushUndo(`Marked ${ids.length} paid`, async () => { for (const id of ids) await api.patch(`/ledger/entries/${id}`, { payment_status: 'Unpaid' }) })
    setSel(new Set()); setPayModal(null)
    load()
  }

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
      } else if (proof) {
        // Batch with ONE proof: the wire confirmation covers the whole batch,
        // stored once and linked on every entry.
        const fd = new FormData(); fd.append('proof', proof); fd.append('ids', JSON.stringify(ids))
        if (payment_date) fd.append('payment_date', payment_date)
        if (payment_method) fd.append('payment_method', payment_method)
        if (payment_ref) fd.append('payment_ref', payment_ref)
        await api.post('/ledger/batch-pay', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      } else if (ids.length === 1) await api.post(`/ledger/entries/${ids[0]}/mark-paid`, { payment_date, payment_method, payment_ref })
      else await api.post('/ledger/batch-pay', { ids, payment_date, payment_method, payment_ref })
      afterPay(ids)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const unpay = async (r) => {
    try {
      await api.patch(`/ledger/entries/${r.id}`, { payment_status: 'Unpaid' })
      pushUndo(`Un-paid ${r.payee}`, () => api.post(`/ledger/entries/${r.id}/mark-paid`, { payment_date: r.payment_date ? String(r.payment_date).slice(0, 10) : undefined }))
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const doDelete = async (r) => {
    if (!window.confirm(`Delete "${r.payee}" — ${r.currency} ${fmt(famAmt(r))}? It moves to the archive.`)) return
    try {
      await api.delete(`/ledger/entries/${r.id}`)
      pushUndo(`Deleted ${r.payee}`, () => api.post(`/ledger/entries/${r.id}/restore`))
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Send-for-Approval: preview the approval_request email (with a personal-note
  // field), then POST the attachment-bearing route (Excel + invoice PDFs).
  const sendForApproval = () => {
    const rowsSel = selectedUnpaid
    if (!rowsSel.length) return
    const totalLine = totalsLine(totalsByCurrency(rowsSel))
    const ids = rowsSel.map(r => r.id)
    setEmailItems([{
      kind: 'approval_request', label: `${rowsSel.length} invoice(s)`, noteField: true,
      ctx: { to: '', count: rowsSel.length, totalLine, note: '' },
      onCustomSend: async ({ to, cc, subject, note }) => { await api.post('/ledger/send-for-approval', { ids, to: [to, ...cc].filter(Boolean), note: note || '', subject }) },
    }])
  }
  const doSchedule = async ({ payment_terms, scheduled_payment_date }) => {
    try {
      await api.post(`/ledger/entries/${schedModal.id}/schedule`, { payment_terms, scheduled_payment_date: scheduled_payment_date || undefined })
      toast('Scheduled'); setSchedModal(null); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Rush / hold — modal with invoice context + capped reason; Cancel applies
  // nothing (the old window.prompt applied the flag even on Cancel).
  const openFlag = (kind, list) => setFlagModal({ kind, rows: list })
  const clearFlag = async (r, kind) => {
    try { await api.delete(`/ledger/entries/${r.id}/${kind}`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const doFlag = async (reason) => {
    const { kind, rows: list } = flagModal
    try {
      if (list.length === 1) await api.post(`/ledger/entries/${list[0].id}/${kind}`, { reason: reason || undefined })
      else {
        const { data } = await api.post(`/ledger/${kind}-bulk`, { ids: list.map(r => r.id), reason })
        const d = data.data || {}
        toast(`${d.rushed ?? d.held ?? 0} ${kind === 'rush' ? 'flagged rush' : 'held'}${d.skipped ? ` · ${d.skipped} skipped (already paid)` : ''}`)
      }
      setFlagModal(null); setSel(new Set()); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // ── Confirmations — grouped by vendor: one email covers every selected paid
  // invoice for that vendor (boom's bulk_payment_confirmation).
  const buildVendorItems = async (list) => {
    const groups = new Map()
    for (const r of list) {
      const k = String(r.vendor_email).toLowerCase()
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    const items = []
    for (const group of groups.values()) {
      const head = group[0]
      const cc = [...ccDefault]
      try { const { data } = await api.get(`/ledger/vendors/${encodeURIComponent(head.payee)}/emails`); cc.push(...data.data.map(e => e.email)) } catch { /* none */ }
      if (ccRep && head.rep && repEmail(head.rep)) cc.push(repEmail(head.rep))
      const ids = group.map(r => r.id)
      const multi = group.length > 1
      items.push({
        kind: multi ? 'bulk_payment_confirmation' : 'payment_confirmation',
        label: multi ? `${head.payee} · ${group.length} invoices` : head.payee,
        noteField: true,
        ctx: {
          to: head.vendor_email, cc: [...new Set(cc)], vendorName: head.vendor_name || head.payee,
          // Family total, never the parent's slice — a split vendor billed once.
          invoiceNumber: multi ? null : head.invoice_number,
          amount: multi ? null : famAmt(head),
          currency: head.currency, method: head.payment_method, date: head.payment_date ? String(head.payment_date).slice(0, 10) : null,
          invoices: multi ? group.map(r => ({ invoiceNumber: r.invoice_number, amount: famAmt(r), currency: r.currency, date: r.payment_date ? String(r.payment_date).slice(0, 10) : null, method: r.payment_method })) : null,
          totalLine: multi ? totalsLine(totalsByCurrency(group)) : null,
        },
        onCustomSend: async ({ to, cc, subject, note }) => {
          await api.post('/ledger/send-vendor-confirmation', { ids, to, cc, subject, note, force: group.some(r => !hasProof(r)) })
        },
      })
    }
    return items
  }
  const sendConfirm = async (r) => {
    if (!r.vendor_email) { toast('No vendor email on this entry', 'error'); return }
    if (!hasProof(r) && !window.confirm('No proof of payment is on file for this entry. Send the confirmation anyway?')) return
    if (r.payment_notified && !window.confirm('A confirmation was already sent for this entry. Send it again?')) return
    setEmailItems(await buildVendorItems([r]))
  }
  const sendConfirmBulk = async () => {
    const paidSel = selectedRows.filter(r => r.payment_status === 'Paid' && r.vendor_email)
    const eligible = paidSel.filter(r => hasProof(r) && !r.payment_notified)
    const skipped = paidSel.length - eligible.length
    if (!eligible.length) { toast(skipped ? 'Every selected row was already sent or has no proof' : 'No selected paid rows have a vendor email', 'error'); return }
    if (skipped) toast(`${skipped} skipped (already sent or no proof)`)
    setEmailItems(await buildVendorItems(eligible))
  }
  const markSent = (r) => api.post(`/ledger/entries/${r.id}/mark-sent`).then(load).catch(() => toast('Failed', 'error'))
  const markUnsent = (r) => { if (window.confirm('Mark this confirmation as NOT sent?')) api.post(`/ledger/entries/${r.id}/mark-unsent`).then(load).catch(() => toast('Failed', 'error')) }
  const editCcDefault = () => {
    const cur = ccDefault.join(', ')
    const next = window.prompt('Default CC on every payment confirmation (comma-separated emails):', cur)
    if (next === null) return
    const list = next.split(',').map(s => s.trim()).filter(s => /\S+@\S+\.\S+/.test(s))
    setCcDefault(list)
    try { localStorage.setItem(CC_DEFAULT_KEY, JSON.stringify(list)) } catch { /* private mode */ }
    toast(list.length ? `Default CC saved (${list.length})` : 'Default CC cleared')
  }

  // ── Inline edit ───────────────────────────────────────────────────────────
  const startEdit = (r) => {
    setEditId(r.id)
    setDraft({
      payee: r.payee || '', artist: r.artist || '', song: r.song || '', amount: r.amount || '',
      invoice_date: r.invoice_date ? String(r.invoice_date).slice(0, 10) : '', invoice_number: r.invoice_number || '',
      category: r.category || '', payment_method: r.payment_method || '', currency: r.currency || 'USD',
      scheduled_payment_date: r.scheduled_payment_date ? String(r.scheduled_payment_date).slice(0, 10) : '',
      rep: r.rep || '', notes: r.notes || '',
    })
  }
  const saveEdit = async (r) => {
    if (!(parseFloat(draft.amount) > 0)) return toast('Amount must be greater than zero', 'error')
    const body = {}
    for (const k of Object.keys(draft)) {
      const prev = k.endsWith('_date') ? (r[k] ? String(r[k]).slice(0, 10) : '') : String(r[k] ?? '')
      if (String(draft[k] ?? '') !== prev) body[k] = draft[k]
    }
    try {
      if (Object.keys(body).length) await api.patch(`/ledger/entries/${r.id}`, body)
      setEditId(null); toast('Saved'); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const toggleExpand = async (r) => {
    setExpanded(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
    if (!childrenOf[r.id]) {
      try { const { data } = await api.get(`/ledger/entries?parent=${r.id}`); setChildrenOf(c => ({ ...c, [r.id]: data.data || [] })) }
      catch { /* leave empty */ }
    }
  }

  const c = stats?.counts || {}
  // Per-currency native captions (never netted): a label owing USD + GBP is
  // not owing "one number of anything" — the USD headline is a convenience.
  const natCaption = (bucket) => {
    const nat = stats?.native?.[bucket] || {}
    const parts = Object.entries(nat).filter(([cur]) => cur !== 'USD')
    return parts.length ? Object.entries(nat).map(([cur, a]) => `${cur} ${fmt(a)}`).join(' · ') : null
  }
  const CARDS = stats ? [
    { label: 'Overdue', value: usd(stats.overdue), sub: `${c.overdue || 0} invoices`, native: natCaption('overdue'), color: 'text-danger' },
    { label: 'Due within 7 days', value: usd(stats.duesoon), sub: `${c.duesoon || 0} invoices`, native: natCaption('duesoon'), color: 'text-warning' },
    { label: 'Total unpaid', value: usd(stats.outstanding), sub: `${c.unpaid || 0} invoices`, native: natCaption('outstanding'), color: 'text-ink' },
    { label: 'Paid this month', value: usd(stats.paidMonth), sub: `${c.paidMonth || 0} this month`, native: natCaption('paidMonth'), color: 'text-success' },
    { label: 'Total entries', value: String((c.unpaid || 0) + (c.paidRecent || 0)), sub: 'unpaid + recently paid', color: 'text-ink' },
  ] : []

  const rowActions = {
    pay: (r) => setPayModal({ ids: [r.id] }),
    schedule: (r) => setSchedModal({ id: r.id, terms: r.payment_terms || 'Net 30' }),
    rush: (r) => (r.rush ? clearFlag(r, 'rush') : openFlag('rush', [r])),
    hold: (r) => (r.on_hold ? clearFlag(r, 'hold') : openFlag('hold', [r])),
    installments: (r) => setInstModal(r),
    _startEdit: startEdit,
    unpay, sendConfirm, markSent, markUnsent, openFile, uploadProof, doDelete,
  }

  return (
    <div className={isMobile ? 'pb-24' : 'pb-16'}>
      <PageHeader title="Payment Dashboard" subtitle="Unpaid invoices and anything paid in the last 14 days. Older payments live in the ledger." />

      {/* Quick filters + view + export */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'text-ink-muted border-rule hover:bg-page/70'}`}>{f.label}</button>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => setView(v => (v === 'list' ? 'calendar' : 'list'))} className={`btn-secondary !py-1.5 text-xs ${view === 'calendar' ? '!bg-brand-500/10 text-brand-ink' : ''}`}>
            {view === 'calendar' ? <List size={14} /> : <CalendarDays size={14} />} {view === 'calendar' ? 'List' : 'Calendar'}
          </button>
          <button onClick={exportCsv} className="btn-secondary !py-1.5 text-xs"><Download size={14} /> CSV</button>
          <button onClick={exportExcel} className="btn-secondary !py-1.5 text-xs"><FileSpreadsheet size={14} /> Excel</button>
        </span>
      </div>

      {/* Headline stat cards — USD headline + native per-currency caption. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {CARDS.map(card => (
          <div key={card.label} className="card p-4">
            <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">{card.label}</p>
            <p className={`text-2xl font-bold leading-tight mt-1.5 ${card.color}`}>{card.value}</p>
            {card.native && <p className="text-[11px] text-ink-muted mt-0.5" title="Native totals per currency — never netted into one number">{card.native}</p>}
            <p className="text-[11px] text-ink-faint mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Weekly trend cards (last 12 weeks) */}
      {analytics && !isMobile && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          <WeeklyTrend title="Invoices logged / week" series={analytics.submissions} color="#6366f1" />
          <WeeklyTrend title="Paid / week" series={analytics.paid} color="#10b981" />
        </div>
      )}

      {/* Filter toolbar */}
      {isMobile ? (
        <div className="flex items-center gap-2 mb-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, artist, inv #…" className="input flex-1 !py-2" />
          <button onClick={() => setFilterSheet(true)} className="btn-secondary !py-2 text-xs"><SlidersHorizontal size={14} /> Filters</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, artist, inv #…" className="input !w-56 !py-2" />
          <input value={amountQ} onChange={e => setAmountQ(e.target.value)}
            title="Amount filter: 500 · 500-1000 · >500 · <=250 (matches the family total)"
            placeholder="Amount (>500, 500-1000…)"
            className={`input !w-44 !py-2 ${amountQuery?.invalid ? '!border-warning ring-1 ring-warning/40' : ''}`} />
          <select className="input !w-auto !py-2" value={methodF} onChange={e => setMethodF(e.target.value)}><option value="">All methods</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select>
          <select className="input !w-auto !py-2" value={statusF} onChange={e => setStatusF(e.target.value)}><option value="">All statuses</option><option>Unpaid</option><option>Partial</option><option>Hold</option><option>Paid</option></select>
          <select className="input !w-auto !py-2" value={repF} onChange={e => setRepF(e.target.value)}><option value="">All reps</option><option value="__none">No rep</option>{reps.map(r => <option key={r.name}>{r.name}</option>)}</select>
          <select className="input !w-auto !py-2" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="due">Sort: due date</option><option value="amount">Amount: high</option><option value="amount-low">Amount: low</option>
            <option value="new">Newest</option><option value="old">Oldest</option><option value="payee">Payee A–Z</option>
          </select>
          <select className="input !w-auto !py-2" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            <option value="">No grouping</option><option value="method">Group: method</option><option value="status">Group: status</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer"><input type="checkbox" checked={ccRep} onChange={e => setCcRep(e.target.checked)} /> CC rep on confirmations</label>
          <button onClick={editCcDefault} className="text-xs font-semibold text-brand-ink hover:underline" title={ccDefault.length ? `Default CC: ${ccDefault.join(', ')}` : 'No default CC set'}>CC defaults{ccDefault.length ? ` (${ccDefault.length})` : ''}</button>
        </div>
      )}

      {/* Invoices header */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-bold text-ink">Invoices</h2>
        <span className="text-sm text-ink-faint">{shown.length}</span>
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={6} cols={6} /></div>
      ) : view === 'calendar' ? (
        <CalendarView rows={shown} />
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center"><CreditCard size={28} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">{isPaid ? 'Nothing paid in the last 14 days.' : 'Nothing here. All caught up. 🎉'}</p></div>
      ) : isMobile ? (
        <div className="space-y-2">
          {shown.map(r => (
            <MobileCard key={r.id} r={r} sel={sel} toggle={toggle} onOpen={() => setSheetRow(r)} isPaidTab={isPaid} />
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-page/50 border-b border-divider text-left">
                {/* Frozen first cell: checkbox + date + payee + amount travel together. */}
                <th className="sticky left-0 z-10 bg-page px-3 py-2.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap shadow-[8px_0_8px_-8px_rgba(0,0,0,0.15)]">
                  <span className="inline-flex items-center gap-3"><input type="checkbox" checked={allSelected} onChange={toggleAll} /> Invoice</span>
                </th>
                {(isPaid ? ['Paid date', 'Method', 'Reference', 'Confirmation', '']
                  : ['Artist', 'Rep', 'Inv #', 'Method', 'Due date', 'Status', 'Confirmation', 'Bank', 'Invoice', 'Proof', '']
                ).map(h => <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {grouped.map(g => (
                <GroupRows key={g.key ?? '_'} group={g} isPaid={isPaid} sel={sel} toggle={toggle}
                  vendorOpen={vendorOpen} setQ={setQ} actions={rowActions}
                  statusMenu={statusMenu} setStatusMenu={setStatusMenu}
                  expanded={expanded} childrenOf={childrenOf} toggleExpand={toggleExpand}
                  editId={editId} draft={draft} setDraft={setDraft} startEdit={startEdit} saveEdit={saveEdit} cancelEdit={() => setEditId(null)}
                  reps={reps} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Persistent bottom bar — filtered + selected totals, select shortcuts,
          bulk actions. Always visible on the list (boom parity), not only while
          something is selected. */}
      {!loading && view === 'list' && shown.length > 0 && (
        <div className={`${isMobile ? 'fixed bottom-16 inset-x-2 z-30' : 'sticky bottom-2 z-30 mt-3'} card px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 shadow-modal`}>
          <span className="text-xs text-ink-muted">
            <span className="font-semibold text-ink">Filtered unpaid:</span> {totalsLine(totalsByCurrency(filteredUnpaid))}
            {usdOfRows(filteredUnpaid) > 0 && <span className="text-ink-faint" title="USD equivalent (locked rates where stamped)"> · {usdFmt(usdOfRows(filteredUnpaid))}</span>}
          </span>
          {sel.size > 0 && (
            <span className="text-xs text-ink-muted">
              <span className="font-semibold text-ink">Selected ({sel.size}):</span> {totalsLine(selTotals)}
              {usdOfRows(selectedRows) > 0 && <span className="text-ink-faint"> · {usdFmt(usdOfRows(selectedRows))}</span>}
            </span>
          )}
          <span className="flex-1" />
          <span className="flex flex-wrap items-center gap-2">
            <button onClick={toggleAll} className="text-xs font-semibold text-brand-ink hover:underline">{allSelected ? 'Clear all' : `Select all (${selectable.length})`}</button>
            {pendingConf.length > 0 && (
              <button onClick={() => setSel(new Set(pendingConf.map(r => r.id)))} className="text-xs font-semibold text-brand-ink hover:underline">Select pending confirmations ({pendingConf.length})</button>
            )}
            {sel.size > 0 && <button onClick={() => setSel(new Set())} className="text-xs text-ink-faint hover:text-ink">Clear</button>}
            {selectedUnpaid.length > 0 && (<>
              <button onClick={() => openFlag('rush', selectedUnpaid)} className="btn-secondary !py-1.5 text-xs"><Zap size={13} /> Rush ({selectedUnpaid.length})</button>
              <button onClick={() => openFlag('hold', selectedUnpaid)} className="btn-secondary !py-1.5 text-xs"><Pause size={13} /> Hold ({selectedUnpaid.length})</button>
              <button onClick={sendForApproval} className="btn-secondary !py-1.5 text-xs"><Send size={13} /> Send for approval</button>
              <button onClick={() => setPayModal({ ids: selectedUnpaid.map(r => r.id) })} className="btn-primary !py-1.5 text-xs"><CreditCard size={13} /> Mark {selectedUnpaid.length} paid</button>
            </>)}
            {selectedPaidPending.length > 0 && (
              <button onClick={sendConfirmBulk} className="btn-primary !py-1.5 text-xs"><Send size={13} /> Send {selectedPaidPending.length} confirmation{selectedPaidPending.length === 1 ? '' : 's'}</button>
            )}
          </span>
        </div>
      )}

      {/* 6s undo toast */}
      {undo && (
        <div className={`fixed ${isMobile ? 'bottom-28' : 'bottom-16'} left-1/2 -translate-x-1/2 z-40 bg-ink text-page rounded-lg px-4 py-2.5 flex items-center gap-3 shadow-modal text-sm`}>
          <span>{undo.label}</span>
          <button onClick={runUndo} className="font-bold inline-flex items-center gap-1 hover:underline"><Undo2 size={14} /> Undo</button>
          <button onClick={() => setUndo(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      {payModal && <PayModal count={payModal.ids.length} onClose={() => setPayModal(null)} onConfirm={doPay} />}
      {schedModal && <ScheduleModal initialTerms={schedModal.terms} onClose={() => setSchedModal(null)} onConfirm={doSchedule} />}
      {instModal && <InstallmentsModal row={instModal} onClose={() => { setInstModal(null); load() }} toast={toast} />}
      {flagModal && <RushHoldModal kind={flagModal.kind} rows={flagModal.rows} onClose={() => setFlagModal(null)} onConfirm={doFlag} />}
      {emailItems && <EmailPreviewModal open items={emailItems} onClose={() => setEmailItems(null)} onDone={() => { setEmailItems(null); load() }} />}

      {/* Mobile: filter sheet + row detail sheet */}
      <BottomSheet open={filterSheet} onClose={() => setFilterSheet(false)} title="Filters">
        <div className="space-y-3 pb-2">
          <div><label className="label">Amount</label><input value={amountQ} onChange={e => setAmountQ(e.target.value)} placeholder=">500, 500-1000…" className={`input ${amountQuery?.invalid ? '!border-warning' : ''}`} /></div>
          <div><label className="label">Method</label><select className="input" value={methodF} onChange={e => setMethodF(e.target.value)}><option value="">All</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Status</label><select className="input" value={statusF} onChange={e => setStatusF(e.target.value)}><option value="">All</option><option>Unpaid</option><option>Partial</option><option>Hold</option><option>Paid</option></select></div>
          <div><label className="label">Rep</label><select className="input" value={repF} onChange={e => setRepF(e.target.value)}><option value="">All</option><option value="__none">No rep</option>{reps.map(r => <option key={r.name}>{r.name}</option>)}</select></div>
          <div><label className="label">Sort</label><select className="input" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="due">Due date</option><option value="amount">Amount: high</option><option value="amount-low">Amount: low</option>
            <option value="new">Newest</option><option value="old">Oldest</option><option value="payee">Payee A–Z</option>
          </select></div>
          <button onClick={() => { setAmountQ(''); setMethodF(''); setStatusF(''); setRepF(''); setSort('due') }} className="btn-secondary w-full">Reset filters</button>
        </div>
      </BottomSheet>
      {sheetRow && (
        <PaymentSheet r={rows.find(x => x.id === sheetRow.id) || sheetRow} onClose={() => setSheetRow(null)} actions={rowActions} isPaidTab={isPaid} />
      )}

      {preview && (
        <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule flex-shrink-0">
              <span className="text-sm font-semibold text-ink capitalize">{preview.label}</span>
              <div className="flex items-center gap-3">
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-brand-ink hover:underline">Open in new tab</a>
                <button onClick={() => setPreview(null)} className="text-ink-faint hover:text-ink"><X size={18} /></button>
              </div>
            </div>
            <iframe src={preview.url} title="File preview" className="flex-1 w-full bg-page" />
          </div>
        </div>
      )}
    </div>
  )
}

// One group segment: optional header row + its rows (+ edit panels + children).
function GroupRows({ group, isPaid, sel, toggle, vendorOpen, setQ, actions, statusMenu, setStatusMenu, expanded, childrenOf, toggleExpand, editId, draft, setDraft, startEdit, saveEdit, cancelEdit, reps }) {
  const colSpan = isPaid ? 6 : 12
  return (<>
    {group.key !== null && (
      <tr className="bg-page/70">
        <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{group.key} <span className="font-normal normal-case">· {group.rows.length}</span></td>
      </tr>
    )}
    {group.rows.map(r => (
      <RowSet key={r.id} r={r} isPaid={isPaid} sel={sel} toggle={toggle} vendorOpen={vendorOpen} setQ={setQ} actions={actions}
        statusMenu={statusMenu} setStatusMenu={setStatusMenu} expanded={expanded} childrenOf={childrenOf} toggleExpand={toggleExpand}
        editId={editId} draft={draft} setDraft={setDraft} startEdit={startEdit} saveEdit={saveEdit} cancelEdit={cancelEdit} reps={reps} />
    ))}
  </>)
}

function RowSet(props) {
  const { r, isPaid, editId } = props
  return (<>
    {isPaid ? <PaidRow {...props} /> : <UnpaidRow {...props} />}
    {editId === r.id && <EditRow {...props} />}
    {props.expanded.has(r.id) && (props.childrenOf[r.id] || []).map(ch => (
      <tr key={ch.id} className="bg-page/40">
        <td className="sticky left-0 z-10 bg-page/40 px-3 py-2 pl-10 text-xs text-ink-muted whitespace-nowrap shadow-[8px_0_8px_-8px_rgba(0,0,0,0.15)]">↳ {ch.artist || '—'}{ch.song ? ` — ${ch.song}` : ''}</td>
        <td colSpan={props.isPaid ? 5 : 11} className="px-3 py-2 text-xs text-ink-muted">{ch.category || '—'} · {ch.currency} {fmt(ch.amount)}{ch.notes ? ` · ${ch.notes}` : ''}</td>
      </tr>
    ))}
  </>)
}

// The frozen first cell shared by both row types.
function FrozenCell({ r, sel, toggle, children, selectable = true }) {
  return (
    <td className="sticky left-0 z-10 bg-card px-3 py-3 whitespace-nowrap shadow-[8px_0_8px_-8px_rgba(0,0,0,0.15)]">
      <div className="flex items-center gap-2.5">
        {selectable ? <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /> : <span className="w-3.5" />}
        {children}
      </div>
    </td>
  )
}

function UnpaidRow({ r, sel, toggle, vendorOpen, setQ, actions, statusMenu, setStatusMenu, expanded, toggleExpand }) {
  const paid = r.payment_status === 'Paid'
  const vo = vendorOpen.get(String(r.payee || '').trim().toLowerCase())
  const mixed = vo && (vo.currencies.size > 1 || vo.methods.size > 1)
  const dLeft = daysUntilLocal(r.scheduled_payment_date)
  const dueTone = paid || r.on_hold ? 'text-ink-muted'
    : isPastLocal(r.scheduled_payment_date) ? 'text-danger font-medium'
    : dLeft !== null && dLeft <= 7 ? 'text-warning font-medium' : 'text-ink-muted'
  const instPaid = Number(r.inst_paid || 0)
  const showProgress = r.payment_status === 'Partial' && instPaid > 0
  return (
    <tr className={`hover:bg-page/40 ${r.on_hold || paid ? 'opacity-60' : ''}`}>
      <FrozenCell r={r} sel={sel} toggle={toggle} selectable={!paid || pendingConfirmation(r)}>
        <div className="min-w-0">
          <p className="font-medium text-ink flex items-center gap-1.5">
            {r.split_count > 0 && (
              <button onClick={() => toggleExpand(r)} className="text-ink-faint hover:text-ink -ml-1" title={`${r.split_count + 1} slices — expand`}>
                {expanded.has(r.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
            <span className="truncate max-w-[180px]">{r.payee}</span>
            {r.rush && <span title={`${r.rush_reason || 'Rush'}${r.rush_by ? ` — ${r.rush_by}` : ''}${r.rush_at ? ` · ${formatDate(r.rush_at)}` : ''}`} className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase bg-amber-500/15 text-warning px-1.5 py-0.5 rounded">
              <Zap size={10} /> Rush <button onClick={e => { e.stopPropagation(); actions.rush(r) }} className="hover:text-danger" title="Clear rush">×</button></span>}
            {r.on_hold && <span title={`${r.hold_reason || 'On hold'}${r.hold_by ? ` — ${r.hold_by}` : ''}${r.hold_at ? ` · ${formatDate(r.hold_at)}` : ''}`} className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase bg-gray-500/15 text-ink-muted px-1.5 py-0.5 rounded">
              <Pause size={10} /> Hold <button onClick={e => { e.stopPropagation(); actions.hold(r) }} className="hover:text-danger" title="Release hold">×</button></span>}
            {r.split_count > 0 && <span className="text-[10px] font-bold uppercase bg-brand-500/15 text-brand-ink px-1.5 py-0.5 rounded">Split</span>}
            {vo && vo.count > 1 && !r.on_hold && (
              <button onClick={() => setQ(r.payee)}
                title={`${vo.count} open invoices for this vendor${vo.held ? ` (+${vo.held} held)` : ''} — click to isolate.${mixed ? ' Mixed currency or method — cannot be sent as one transfer.' : ''}`}
                className={`inline-flex items-center gap-0.5 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${mixed ? 'bg-amber-500/15 text-warning' : 'bg-sky-500/15 text-sky-700'}`}>
                {mixed && <AlertTriangle size={9} />} {vo.count} open
              </button>
            )}
          </p>
          <p className="text-[11px] text-ink-faint">{formatDate(r.invoice_date)}{r.vendor_email ? ` · ${r.vendor_email}` : ''}</p>
          <p className="text-sm font-semibold text-ink tabular-nums">
            {r.currency} {fmt(famAmt(r))}
            {r.split_count > 0 && <span className="ml-1 text-[10px] text-ink-faint font-normal">family total</span>}
          </p>
          {r.usd_equiv != null && (r.currency || 'USD') !== 'USD' && <p className="text-[11px] text-ink-faint tabular-nums" title={`≈ USD ${r.usd_equiv}`}>{usdFmt(r.usd_equiv)}</p>}
          {showProgress && <p className="text-[11px] text-warning tabular-nums">{fmt(instPaid)} / {fmt(famAmt(r))} paid</p>}
        </div>
      </FrozenCell>
      <td className="px-3 py-3 text-ink-muted whitespace-nowrap">{r.artist || '—'}</td>
      <td className="px-3 py-3 text-ink-muted whitespace-nowrap">{r.rep || '—'}</td>
      <td className="px-3 py-3 text-ink-muted whitespace-nowrap">{r.invoice_number || '—'}</td>
      <td className="px-3 py-3 whitespace-nowrap">{r.payment_method ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${METHOD_BADGE[r.payment_method] || 'bg-gray-500/10 text-ink-muted'}`}>{r.payment_method}</span> : <span className="text-ink-faint">—</span>}</td>
      <td className={`px-3 py-3 whitespace-nowrap ${dueTone}`}>{r.scheduled_payment_date ? formatDate(r.scheduled_payment_date) : <span className="text-ink-faint">—</span>}</td>
      <td className="px-3 py-3 whitespace-nowrap relative">
        <span className="inline-flex items-center gap-1.5">
          <StatusPill r={r} open={statusMenu === r.id} setOpen={(v) => setStatusMenu(v ? r.id : null)} actions={actions} />
          <BankEvidenceDot row={r} />
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {paid ? (
          r.payment_notified
            ? <span className="inline-flex items-center gap-1 text-xs text-success font-medium"><MailCheck size={13} /> Sent <button onClick={() => actions.markUnsent(r)} className="text-ink-faint hover:text-danger text-[11px] underline">undo</button></span>
            : r.vendor_email
              ? <span className="inline-flex items-center gap-1.5">
                  <button onClick={() => actions.sendConfirm(r)} className="text-xs font-semibold text-brand-ink hover:underline">Send</button>
                  <button onClick={() => actions.markSent(r)} className="text-[11px] text-ink-faint hover:text-ink underline" title="Confirmed out-of-band">mark sent</button>
                </span>
              : <span className="text-[11px] text-ink-faint">no email</span>
        ) : <span className="text-ink-faint">—</span>}
      </td>
      <td className="px-3 py-3 text-ink-muted truncate max-w-[120px]">{r.vendor_bank || '—'}</td>
      <td className="px-3 py-3 whitespace-nowrap">{r.invoice_r2_key ? <button onClick={() => actions.openFile(r.id, 'invoice')} className="inline-flex items-center gap-1 text-xs text-brand-ink hover:underline"><Eye size={13} /> View</button> : <span className="text-ink-faint">—</span>}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {(r.proof_r2_key || r.receipt_r2_key)
          ? <button onClick={() => actions.openFile(r.id, r.proof_r2_key ? 'proof' : 'receipt')} className="inline-flex items-center gap-1 text-xs text-success hover:underline"><Eye size={13} /> Proof</button>
          : paid
            ? <span className="text-ink-faint">—</span>
            : <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); actions.uploadProof(r.id, e.dataTransfer.files?.[0]) }} title="Attaching proof marks this paid" className="inline-flex items-center gap-1 text-[11px] text-ink-faint border border-dashed border-rule rounded px-2 py-1 cursor-pointer hover:border-brand-300 hover:text-brand-ink"><Upload size={12} /> Drop file<input type="file" accept="application/pdf,image/*" hidden onChange={e => actions.uploadProof(r.id, e.target.files?.[0])} /></label>}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1 justify-end whitespace-nowrap">
          {paid ? <span className="text-[11px] text-ink-faint">Paid {formatDate(r.payment_date)}</span> : <>
            <button onClick={() => actions.installments(r)} className="text-ink-faint hover:text-warning p-1" title={Number(r.inst_count) > 0 ? `${r.inst_count} partial payment(s)` : 'Record a partial payment'}><Receipt size={15} /></button>
            <button onClick={() => actions.rush(r)} className={`p-1 ${r.rush ? 'text-warning' : 'text-ink-faint hover:text-warning'}`} title={r.rush ? 'Clear rush' : 'Flag rush'}><Zap size={15} /></button>
            <button onClick={() => actions.hold(r)} className={`p-1 ${r.on_hold ? 'text-ink' : 'text-ink-faint hover:text-ink'}`} title={r.on_hold ? 'Release hold' : 'Hold'}><Pause size={15} /></button>
            <button onClick={() => actions.schedule(r)} className="text-ink-faint hover:text-brand-ink p-1" title="Schedule"><CalendarClock size={15} /></button>
            <button onClick={() => actions.pay(r)} className="text-ink-faint hover:text-success p-1" title="Mark paid"><Check size={16} /></button>
          </>}
          <EditDeleteButtons r={r} actions={actions} />
        </div>
      </td>
    </tr>
  )
}

function EditDeleteButtons({ r, actions }) {
  return (<>
    <button onClick={() => actions._startEdit(r)} className="text-ink-faint hover:text-brand-ink p-1" title="Edit"><Pencil size={14} /></button>
    <button onClick={() => actions.doDelete(r)} className="text-ink-faint hover:text-danger p-1" title="Delete (archives)"><Trash2 size={14} /></button>
  </>)
}

function PaidRow({ r, sel, toggle, actions }) {
  return (
    <tr className="hover:bg-page/40">
      <FrozenCell r={r} sel={sel} toggle={toggle} selectable={pendingConfirmation(r)}>
        <div className="min-w-0">
          <p className="font-medium text-ink truncate max-w-[200px]">{r.payee}</p>
          {r.vendor_email && <p className="text-[11px] text-ink-faint truncate max-w-[200px]">{r.vendor_email}</p>}
          <p className="text-sm font-semibold text-ink tabular-nums">{r.currency} {fmt(famAmt(r))}</p>
          {r.usd_equiv != null && (r.currency || 'USD') !== 'USD' && <p className="text-[11px] text-ink-faint tabular-nums">{usdFmt(r.usd_equiv)}</p>}
        </div>
      </FrozenCell>
      <td className="px-3 py-3 text-ink-muted whitespace-nowrap">{formatDate(r.payment_date)}</td>
      <td className="px-3 py-3 whitespace-nowrap">{r.payment_method ? <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${METHOD_BADGE[r.payment_method] || 'bg-gray-500/10 text-ink-muted'}`}>{r.payment_method}</span> : '—'}</td>
      <td className="px-3 py-3 text-ink-muted whitespace-nowrap">{r.payment_ref || '—'}</td>
      <td className="px-3 py-3 whitespace-nowrap">
        {r.payment_notified
          ? <span className="inline-flex items-center gap-1 text-xs text-success font-medium"><MailCheck size={13} /> Sent <button onClick={() => actions.markUnsent(r)} className="text-ink-faint hover:text-danger text-[11px] underline" title="Mark as not sent">undo</button></span>
          : r.vendor_email
            ? <span className="inline-flex items-center gap-1.5">
                <span className="text-xs text-ink-faint">Not sent</span>
                <button onClick={() => actions.markSent(r)} className="text-[11px] text-ink-faint hover:text-ink underline" title="Confirmed out-of-band">mark sent</button>
              </span>
            : <span className="text-[11px] text-ink-faint">no email</span>}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        {r.vendor_email && <button onClick={() => actions.sendConfirm(r)} className="text-ink-faint hover:text-brand-ink p-1" title={r.payment_notified ? 'Resend confirmation' : 'Send confirmation'}><Send size={15} /></button>}
        <button onClick={() => actions.unpay(r)} className="text-ink-faint hover:text-danger p-1 text-[11px] underline" title="Mark as unpaid">unpay</button>
      </td>
    </tr>
  )
}

// Status pill → popover: Paid / Partially Paid… / Unpaid (the un-pay path).
function StatusPill({ r, open, setOpen, actions }) {
  useEscapeStack(open, () => setOpen(false))
  const label = r.payment_status === 'Paid' ? 'Paid' : r.on_hold ? 'On hold' : (r.payment_status || 'Unpaid')
  const tone = r.payment_status === 'Paid' ? 'bg-emerald-500/15 text-success' : r.on_hold ? 'bg-gray-500/15 text-ink-muted' : r.payment_status === 'Partial' ? 'bg-amber-500/15 text-warning' : 'bg-rose-500/10 text-danger'
  return (
    <span className="relative">
      <button onClick={() => setOpen(!open)} className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer ${tone}`} title="Change payment status">{label}</button>
      {open && (<>
        <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
        <span className="absolute left-0 top-full mt-1 z-30 card !p-1 shadow-modal flex flex-col min-w-[150px]">
          <button onClick={() => { setOpen(false); actions.pay(r) }} className="text-left text-xs px-2.5 py-1.5 rounded hover:bg-page/70 text-success font-medium">Paid</button>
          <button onClick={() => { setOpen(false); actions.installments(r) }} className="text-left text-xs px-2.5 py-1.5 rounded hover:bg-page/70 text-warning font-medium">Partially paid…</button>
          <button onClick={() => { setOpen(false); r.payment_status !== 'Unpaid' ? actions.unpay(r) : null }} className="text-left text-xs px-2.5 py-1.5 rounded hover:bg-page/70 text-ink-muted">Unpaid</button>
        </span>
      </>)}
    </span>
  )
}

// Inline row editor — 12 fields, amount>0 guard, diff-PATCH.
function EditRow({ r, isPaid, draft, setDraft, saveEdit, cancelEdit, reps }) {
  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))
  return (
    <tr className="bg-page/50">
      <td colSpan={isPaid ? 6 : 12} className="px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <div><label className="label">Payee</label><input className="input !py-1.5" value={draft.payee} onChange={set('payee')} /></div>
          <div><label className="label">Artist</label><input className="input !py-1.5" value={draft.artist} onChange={set('artist')} /></div>
          <div><label className="label">Song</label><input className="input !py-1.5" value={draft.song} onChange={set('song')} /></div>
          <div><label className="label">Amount</label><input type="number" step="0.01" className="input !py-1.5" value={draft.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input !py-1.5" value={draft.currency} onChange={set('currency')}>{CURRENCIES.map(x => <option key={x}>{x}</option>)}</select></div>
          <div><label className="label">Invoice date</label><input type="date" className="input !py-1.5" value={draft.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Inv #</label><input className="input !py-1.5" value={draft.invoice_number} onChange={set('invoice_number')} /></div>
          <div><label className="label">Category</label><select className="input !py-1.5" value={draft.category} onChange={set('category')}><option value="">—</option><CategoryOptions /></select></div>
          <div><label className="label">Method</label><select className="input !py-1.5" value={draft.payment_method} onChange={set('payment_method')}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Due date</label><input type="date" className="input !py-1.5" value={draft.scheduled_payment_date} onChange={set('scheduled_payment_date')} /></div>
          <div><label className="label">Rep</label><select className="input !py-1.5" value={draft.rep} onChange={set('rep')}><option value="">—</option>{reps.map(x => <option key={x.name}>{x.name}</option>)}</select></div>
          <div><label className="label">Notes</label><input className="input !py-1.5" value={draft.notes} onChange={set('notes')} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={cancelEdit} className="btn-secondary !py-1.5 text-xs">Cancel</button>
          <button onClick={() => saveEdit(r)} className="btn-primary !py-1.5 text-xs">Save</button>
        </div>
      </td>
    </tr>
  )
}

function MobileCard({ r, sel, toggle, onOpen, isPaidTab }) {
  const paid = r.payment_status === 'Paid'
  return (
    <div className={`card p-3 ${r.on_hold || (paid && !isPaidTab) ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2.5">
        {(!paid || pendingConfirmation(r))
          ? <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="mt-1 flex-shrink-0" />
          : <span className="mt-1 w-4 flex-shrink-0" aria-hidden="true" />}
        <button onClick={onOpen} className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-ink truncate flex items-center gap-1.5">
              {r.payee}
              {r.rush && <Zap size={12} className="text-warning flex-shrink-0" />}
              {r.on_hold && <Pause size={12} className="text-ink-muted flex-shrink-0" />}
              {r.split_count > 0 && <span className="text-[9px] font-bold uppercase bg-brand-500/15 text-brand-ink px-1 py-0.5 rounded flex-shrink-0">Split ×{r.split_count + 1}</span>}
            </p>
            <span className="text-sm font-semibold text-ink tabular-nums flex-shrink-0">{r.currency} {fmt(famAmt(r))}</span>
          </div>
          <p className="text-[11px] text-ink-faint truncate mt-0.5">
            {paid
              ? `${r.payment_method || '—'} · paid ${formatDate(r.payment_date)}${r.payment_notified ? ' · confirmation sent' : ''}`
              : `${[r.category, r.artist].filter(Boolean).join(' · ') || '—'}${r.scheduled_payment_date ? ` · due ${formatDate(r.scheduled_payment_date)}` : ''}`}
          </p>
        </button>
      </div>
    </div>
  )
}

// Mobile detail drawer: full row context + every action.
function PaymentSheet({ r, onClose, actions, isPaidTab }) {
  const paid = r.payment_status === 'Paid'
  const Line = ({ k, v }) => <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-ink-faint">{k}</span><span className="text-ink text-right min-w-0 truncate">{v || '—'}</span></div>
  return (
    <BottomSheet open onClose={onClose} title={r.payee}
      footer={
        <div className="flex flex-wrap gap-2">
          {!paid && <>
            <button onClick={() => { onClose(); actions.pay(r) }} className="btn-primary flex-1 !py-2 text-sm"><Check size={15} /> Mark paid</button>
            <button onClick={() => { onClose(); actions.installments(r) }} className="btn-secondary !py-2 text-sm"><Receipt size={15} /> Partial</button>
            <button onClick={() => { onClose(); actions.rush(r) }} className={`btn-secondary !py-2 text-sm ${r.rush ? 'text-warning' : ''}`}><Zap size={15} /> {r.rush ? 'Unrush' : 'Rush'}</button>
            <button onClick={() => { onClose(); actions.hold(r) }} className="btn-secondary !py-2 text-sm"><Pause size={15} /> {r.on_hold ? 'Release' : 'Hold'}</button>
            <button onClick={() => { onClose(); actions.schedule(r) }} className="btn-secondary !py-2 text-sm"><CalendarClock size={15} /> Schedule</button>
          </>}
          {paid && r.vendor_email && !r.payment_notified && <button onClick={() => { onClose(); actions.sendConfirm(r) }} className="btn-primary flex-1 !py-2 text-sm"><Send size={15} /> Send confirmation</button>}
          {paid && <button onClick={() => { onClose(); actions.unpay(r) }} className="btn-secondary !py-2 text-sm">Unpay</button>}
        </div>
      }>
      <div className="divide-y divide-divider">
        <Line k="Amount" v={`${r.currency} ${fmt(famAmt(r))}${r.split_count > 0 ? ` (family, ×${r.split_count + 1})` : ''}`} />
        {r.usd_equiv != null && (r.currency || 'USD') !== 'USD' && <Line k="≈ USD" v={usd(r.usd_equiv)} />}
        <Line k="Artist" v={r.artist} />
        <Line k="Invoice #" v={r.invoice_number} />
        <Line k="Invoice date" v={formatDate(r.invoice_date)} />
        <Line k="Due date" v={formatDate(r.scheduled_payment_date)} />
        <Line k="Status" v={paid ? `Paid ${formatDate(r.payment_date)}` : r.on_hold ? 'On hold' : (r.payment_status || 'Unpaid')} />
        <Line k="Method" v={r.payment_method} />
        <Line k="Rep" v={r.rep} />
        <Line k="Vendor email" v={r.vendor_email} />
        <Line k="Bank" v={r.vendor_bank} />
        {r.rush && <Line k="Rush" v={`${r.rush_reason || 'yes'}${r.rush_by ? ` — ${r.rush_by}` : ''}`} />}
        {r.on_hold && <Line k="Hold" v={`${r.hold_reason || 'yes'}${r.hold_by ? ` — ${r.hold_by}` : ''}`} />}
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {r.invoice_r2_key && <button onClick={() => actions.openFile(r.id, 'invoice')} className="btn-secondary !py-1.5 text-xs"><Eye size={13} /> Invoice</button>}
        {(r.proof_r2_key || r.receipt_r2_key) && <button onClick={() => actions.openFile(r.id, r.proof_r2_key ? 'proof' : 'receipt')} className="btn-secondary !py-1.5 text-xs"><Eye size={13} /> Proof</button>}
        {!paid && (
          <label className="btn-secondary !py-1.5 text-xs cursor-pointer"><Upload size={13} /> Upload proof (marks paid)
            <input type="file" accept="application/pdf,image/*" hidden onChange={e => { onClose(); actions.uploadProof(r.id, e.target.files?.[0]) }} />
          </label>
        )}
        {paid && r.vendor_email && (r.payment_notified
          ? <button onClick={() => { onClose(); actions.markUnsent(r) }} className="btn-secondary !py-1.5 text-xs">Confirmation sent — undo</button>
          : <button onClick={() => { onClose(); actions.markSent(r) }} className="btn-secondary !py-1.5 text-xs">Mark confirmation sent</button>)}
      </div>
    </BottomSheet>
  )
}

// ── Month calendar of due / paid invoices ────────────────────────────────────
function CalendarView({ rows }) {
  const [anchor, setAnchor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const year = anchor.getFullYear(), month = anchor.getMonth()
  const first = new Date(year, month, 1)
  const startDow = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayStr = today()
  // date (YYYY-MM-DD) → events
  const byDay = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const paid = r.payment_status === 'Paid'
      const d = paid ? r.payment_date : r.scheduled_payment_date
      if (!d) continue
      const key = String(d).slice(0, 10)
      if (!m.has(key)) m.set(key, [])
      m.get(key).push({ r, type: paid ? 'paid' : isPastLocal(r.scheduled_payment_date) ? 'overdue' : 'due' })
    }
    return m
  }, [rows])
  const TONE = { overdue: 'bg-rose-500/15 text-danger', due: 'bg-amber-500/15 text-warning', paid: 'bg-emerald-500/15 text-success' }
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(new Date(year, month - 1, 1))} className="btn-secondary !py-1 !px-2 text-xs">‹</button>
          <button onClick={() => setAnchor(new Date(year, month + 1, 1))} className="btn-secondary !py-1 !px-2 text-xs">›</button>
          <button onClick={() => { const d = new Date(); setAnchor(new Date(d.getFullYear(), d.getMonth(), 1)) }} className="btn-secondary !py-1 text-xs">Today</button>
          <p className="text-sm font-bold text-ink ml-1">{anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Overdue</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Due</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Paid</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px text-[10px] font-semibold text-ink-faint uppercase mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="px-1.5 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px bg-divider rounded-lg overflow-hidden border border-divider">
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} className="bg-page/40 min-h-[84px]" />
          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const events = byDay.get(key) || []
          const isToday = key === todayStr
          return (
            <div key={key} className={`min-h-[84px] p-1 ${isToday ? 'bg-brand-500/10' : 'bg-card'}`}>
              <p className={`text-[11px] mb-0.5 ${isToday ? 'font-bold text-brand-ink' : 'text-ink-faint'}`}>{d}</p>
              {events.slice(0, 3).map((ev, j) => (
                <p key={j} title={`${ev.r.payee} — ${ev.r.currency} ${fmt(famAmt(ev.r))}`} className={`truncate text-[10px] font-medium rounded px-1 py-0.5 mb-0.5 ${TONE[ev.type]}`}>{ev.r.payee}</p>
              ))}
              {events.length > 3 && <p className="text-[10px] text-ink-faint px-1">+{events.length - 3} more</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Modal({ title, onClose, children, wide }) {
  useEscapeStack(true, onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div className={`relative card p-5 w-full ${wide ? 'max-w-xl' : 'max-w-sm'} max-h-[88vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={16} /></button>
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
        <div><label className="label">Method</label><select className="input" value={method} onChange={e => setMethod(e.target.value)}><option value="">— Same as invoice —</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
        <div><label className="label">Reference</label><input className="input" value={ref} onChange={e => setRef(e.target.value)} placeholder="confirmation / wire ref" /></div>
        <div>
          <label className="label">Proof of payment (optional{count > 1 ? ' — applied to every entry' : ' — AI reads date & ref'})</label>
          <input type="file" className="input py-1.5" onChange={e => setProof(e.target.files?.[0] || null)} />
        </div>
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
          <p className="text-xs text-ink-faint mt-1">Leave blank to derive the due date from the invoice date + terms.</p>
        </div>
        <button onClick={() => onConfirm({ payment_terms: terms, scheduled_payment_date: date })} className="btn-primary w-full">Save schedule</button>
      </div>
    </Modal>
  )
}

// Rush/Hold with invoice context + a capped reason — Cancel applies NOTHING
// (the window.prompt this replaces applied the flag even on Cancel).
function RushHoldModal({ kind, rows, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const totals = totalsLine(totalsByCurrency(rows))
  const isRush = kind === 'rush'
  return (
    <Modal title={isRush ? `Request rush — ${rows.length} invoice${rows.length === 1 ? '' : 's'}` : `Hold payment — ${rows.length} invoice${rows.length === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-lg bg-page/60 border border-divider p-3 text-xs text-ink-muted space-y-0.5">
          {rows.slice(0, 3).map(r => <p key={r.id} className="truncate"><span className="font-semibold text-ink">{r.payee}</span> — {r.currency} {fmt(famAmt(r))}{r.invoice_number ? ` · #${r.invoice_number}` : ''}</p>)}
          {rows.length > 3 && <p>…and {rows.length - 3} more</p>}
          <p className="pt-1 font-semibold text-ink">Total: {totals}</p>
        </div>
        <div>
          <textarea autoFocus className="input" rows={2} value={reason} onChange={e => setReason(e.target.value.slice(0, 500))}
            placeholder={isRush ? 'Why is this a rush? (optional) — e.g. Vendor leaving for tour Friday' : 'Why on hold? (optional) — e.g. Waiting on artist confirmation'} />
          <p className="text-[10px] text-ink-faint text-right mt-0.5">{reason.length}/500</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={() => onConfirm(reason.trim())} className={`flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg text-white ${isRush ? 'bg-amber-600 hover:bg-amber-700' : 'bg-gray-600 hover:bg-gray-700'}`}>
            {isRush ? <Zap size={15} /> : <Pause size={15} />} {isRush ? 'Request rush' : 'Hold payment'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// Partial payments: family total / paid so far / remaining, the installment
// table, and the add form. Server keys everything to the family root.
function InstallmentsModal({ row, onClose, toast }) {
  const [data, setData] = useState(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  const [ref, setRef] = useState('')
  const [proof, setProof] = useState(null)
  const [busy, setBusy] = useState(false)
  const familyTotal = famAmt(row)
  const load = () => api.get(`/ledger/entries/${row.id}/installments`).then(r => setData(r.data.data)).catch(() => setData({ installments: [], total: 0 }))
  useEffect(() => { load() }, []) // eslint-disable-line
  const paid = Number(data?.total || 0)
  const remaining = Math.round((familyTotal - paid) * 100) / 100
  const add = async () => {
    if (!(parseFloat(amount) > 0)) return toast('Enter a valid amount', 'error')
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('amount', amount); fd.append('paid_date', date)
      if (method) fd.append('method', method)
      if (ref) fd.append('reference', ref)
      if (proof) fd.append('proof', proof)
      const { data: res } = await api.post(`/ledger/entries/${row.id}/installments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast(res.data.payment_status === 'Paid' ? 'Fully paid' : `Recorded — ${fmt(res.data.paid)} of ${fmt(familyTotal)}`)
      setAmount(''); setRef(''); setProof(null)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }
  const remove = async (id) => {
    try { await api.delete(`/ledger/installments/${id}`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const viewProof = (id) => api.get(`/ledger/installments/${id}/proof`).then(({ data }) => window.open(data.data.url, '_blank', 'noopener')).catch(() => toast('No proof', 'error'))
  return (
    <Modal title={`Partial payments — ${row.payee}`} onClose={onClose} wide>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="rounded-lg bg-page/60 border border-divider p-2"><p className="text-[10px] uppercase font-semibold text-ink-faint">Family total</p><p className="text-sm font-bold text-ink tabular-nums">{row.currency} {fmt(familyTotal)}</p></div>
        <div className="rounded-lg bg-page/60 border border-divider p-2"><p className="text-[10px] uppercase font-semibold text-ink-faint">Paid so far</p><p className="text-sm font-bold text-success tabular-nums">{row.currency} {fmt(paid)}</p></div>
        <div className="rounded-lg bg-page/60 border border-divider p-2"><p className="text-[10px] uppercase font-semibold text-ink-faint">{remaining < 0 ? 'Overpaid' : 'Remaining'}</p><p className={`text-sm font-bold tabular-nums ${remaining < 0 ? 'text-danger' : 'text-ink'}`}>{row.currency} {fmt(Math.abs(remaining))}</p></div>
      </div>
      {data === null ? <p className="text-xs text-ink-faint">Loading…</p> : data.installments.length > 0 && (
        <div className="overflow-x-auto mb-3 rounded-lg border border-divider">
          <table className="w-full text-xs">
            <thead><tr className="bg-page/50 text-left text-[10px] uppercase text-ink-faint">
              <th className="px-2.5 py-1.5 font-semibold">Date</th><th className="px-2.5 py-1.5 font-semibold text-right">Amount</th><th className="px-2.5 py-1.5 font-semibold">Method</th><th className="px-2.5 py-1.5 font-semibold">Ref</th><th className="px-2.5 py-1.5 font-semibold">By</th><th /><th />
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {data.installments.map(i => (
                <tr key={i.id}>
                  <td className="px-2.5 py-1.5 text-ink-muted">{formatDate(i.paid_date)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-ink">{fmt(i.amount)}</td>
                  <td className="px-2.5 py-1.5">{i.method ? <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${METHOD_BADGE[i.method] || 'bg-gray-500/10 text-ink-muted'}`}>{i.method}</span> : '—'}</td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-ink-muted">{i.reference || '—'}</td>
                  <td className="px-2.5 py-1.5 text-ink-faint">{i.created_by || '—'}</td>
                  <td className="px-1 py-1.5">{i.proof_r2_key && <button onClick={() => viewProof(i.id)} className="text-brand-ink hover:underline text-[11px]">proof</button>}</td>
                  <td className="px-1 py-1.5"><button onClick={() => remove(i.id)} className="text-ink-faint hover:text-danger" title="Remove"><Trash2 size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div><label className="label">Amount</label><input type="number" step="0.01" className="input !py-1.5" value={amount} onChange={e => setAmount(e.target.value)} placeholder={remaining > 0 ? String(remaining) : ''} /></div>
        <div><label className="label">Date</label><input type="date" className="input !py-1.5" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label className="label">Method</label><select className="input !py-1.5" value={method} onChange={e => setMethod(e.target.value)}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
        <div><label className="label">Ref</label><input className="input !py-1.5" value={ref} onChange={e => setRef(e.target.value)} /></div>
        <div className="col-span-2 sm:col-span-3"><label className="label">Proof (optional)</label><input type="file" className="input !py-1" onChange={e => setProof(e.target.files?.[0] || null)} /></div>
        <div className="flex items-end"><button onClick={add} disabled={busy} className="btn-primary w-full !py-2">{busy ? 'Saving…' : 'Record'}</button></div>
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
        <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">{title}</p>
        <span className="text-xs text-ink-faint">{total} in 12 wks</span>
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

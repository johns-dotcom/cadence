import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Pencil, Eye, Download, Check, FileText, Loader, Table as TableIcon, LayoutGrid } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import Modal from '../components/ui/Modal'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES } from '../constants'

// Real currency rendering — CAD is CA$, JPY has no decimals. Unknown ISO codes
// fall back to a plain number with the code suffix so the invoice still renders.
function formatCurrency(amount, currency = 'USD') {
  const cur = String(currency || 'USD').toUpperCase()
  const n = Number(amount)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number.isFinite(n) ? n : 0)
  } catch {
    return `${Number.isFinite(n) ? n : 0}` + (Number(amount) === 0 ? '.00' : '') + ' ' + cur
  }
}

const blankLine = () => ({ description: '', amount: '' })
const pad = (n) => String(n).padStart(4, '0')

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

// Fallback only, for rows from a server too old to send `invoice_date`: pin a
// timezone rather than falling back to the reader's, so the printed date is the
// same day for a client reading it in Berlin.
const TZ_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
})
function tzDay(v) {
  const d = new Date(v || Date.now())
  return Number.isNaN(d.getTime()) ? null : TZ_DAY.format(d)
}

// The date the invoice bears, printed from the server's `invoice_date` —
// 'YYYY-MM-DD' in the company's timezone, and the same day its DUE BY line was
// counted from. It must NOT be `new Date(created_at).toLocaleDateString(...)`,
// which renders a timestamp in the READER's timezone: an invoice raised after
// 5pm Pacific printed the previous day while its deadline was counted from the
// UTC one — a Net 45 document dated 46 days before its own due date.
//
// Formatted from the string parts through Date.UTC — parsing 'YYYY-MM-DD' with
// the local constructor would reintroduce exactly the shift this removes.
function invoiceDay(invoice) {
  return /^\d{4}-\d{2}-\d{2}$/.test(invoice?.invoice_date || '')
    ? invoice.invoice_date
    : tzDay(invoice?.created_at)
}

function formatInvoiceDate(invoice) {
  const day = invoiceDay(invoice)
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${wd}, ${MONTHS[m - 1]} ${d}, ${y}`
}

// The same day, abbreviated for the list. Both readers go through invoiceDay so
// the table cannot name a different date than the document it opens.
function shortInvoiceDate(invoice) {
  const day = invoiceDay(invoice)
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`
}

// Render the workspace's "Funds payable to" block from saved invoice settings.
function PayableTo({ inv, compact }) {
  const t = compact ? 'text-[10px]' : 'text-[12px]'
  if (!inv || !Object.values(inv).some(Boolean)) {
    return <p className="text-xs text-gray-300">Set your company &amp; bank details in Settings → Invoice details.</p>
  }
  const Row = ({ label, value }) => value ? <p><span className="font-semibold">{label}</span> {value}</p> : null
  // Two routing numbers stack under one ROUTING label (WIRE then ACH); if only
  // one exists it takes the label.
  const routingLines = [inv.routing, inv.routing_ach].filter(Boolean)
  return (
    <div className={`${t} leading-relaxed text-ink space-y-2`}>
      <p className="text-[11px] font-bold tracking-wide">FUNDS PAYABLE TO:</p>
      <div>
        {inv.company_name && <p className="font-semibold">{inv.company_name}</p>}
        {inv.address && <p className="whitespace-pre-line">{inv.address}</p>}
      </div>
      {(inv.contact || inv.phone || inv.email) && (
        <div>
          <Row label="CONTACT:" value={inv.contact} />
          <Row label="PHONE:" value={inv.phone} />
          <Row label="EMAIL:" value={inv.email} />
        </div>
      )}
      {inv.ein && <p><span className="font-semibold">EIN:</span> {inv.ein}</p>}
      {(inv.bank_name || inv.bank_address || inv.account_name || inv.account_type || inv.swift || routingLines.length > 0 || inv.account_number) && (
        <div>
          <Row label="BANK:" value={inv.bank_name} />
          <Row label="ADDRESS:" value={inv.bank_address} />
          <Row label="NAME:" value={inv.account_name} />
          <Row label="TYPE:" value={inv.account_type} />
          <Row label="SWIFT:" value={inv.swift} />
          {routingLines.length > 0 && <Row label="ROUTING:" value={routingLines[0]} />}
          {routingLines.length > 1 && <p className="pl-[68px]">{routingLines[1]}</p>}
          <Row label="ACCOUNT:" value={inv.account_number} />
        </div>
      )}
    </div>
  )
}

// The invoice document itself — one component, rendered by the live preview,
// the card view (compact) and the preview modal, so they cannot drift.
// `frame` wraps it in its own card; pass false when the parent already is one.
function InvoicePreview({ invoice, settings, label, compact, frame = true }) {
  const t = compact ? 'text-[11px]' : 'text-[12px]'
  const inner = (
    <>
      {label?.logo_url
        ? <img src={label.logo_url} alt="" className={`${compact ? 'h-7' : 'h-9'} mb-1 object-contain`} />
        : <p className={`${compact ? 'text-xl' : 'text-2xl'} font-extrabold text-brand-600 mb-1`}>{label?.name}</p>}
      <h1 className={`${compact ? 'text-3xl' : 'text-4xl'} font-extrabold tracking-tight text-ink`}>INVOICE</h1>
      <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
        NO.: {invoice.invoice_number != null ? pad(invoice.invoice_number) : '—'}<br />
        PURCHASE ORDER #: {invoice.purchase_order || 'N/A'}
      </p>

      <div className="border-t border-divider my-4" />
      <div className="flex justify-between gap-6">
        <div className={t}>
          <p className="font-bold mb-1">Bill To</p>
          <p className="text-gray-600 whitespace-pre-line">{invoice.bill_to || 'Client Name'}</p>
          {invoice.bill_to_address && <p className="text-gray-400 whitespace-pre-line mt-1">{invoice.bill_to_address}</p>}
        </div>
        <div className={compact ? 'min-w-[210px]' : 'min-w-[260px]'}><PayableTo inv={settings} compact={compact} /></div>
      </div>

      <div className="border-t border-divider my-4" />
      <p className={t}><span className="font-bold">DUE BY:</span> {invoice.due_by || 'UPON RECEIPT'}</p>

      <div className="border-t border-divider my-4" />
      <table className={`w-full ${t}`}>
        <thead><tr className="border-b border-divider"><th className="text-left font-bold pb-1.5">Description</th><th className="text-right font-bold pb-1.5">Amount Due</th></tr></thead>
        <tbody>
          {(Array.isArray(invoice.line_items) && invoice.line_items.length ? invoice.line_items : [{ description: invoice.description || 'Description', amount: invoice.amount || 0 }]).map((l, i) => (
            <tr key={i}><td className="py-1.5 text-gray-600">{l.description || 'Description'}</td><td className="py-1.5 text-right text-gray-600">{formatCurrency(l.amount, invoice.currency)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-between items-center border-t-2 border-ink/10 pt-3 mt-3">
        <span className="font-bold text-ink">TOTAL DUE</span>
        <span className={`font-bold text-ink ${compact ? 'text-base' : 'text-lg'}`}>{formatCurrency(invoice.amount, invoice.currency)}</span>
      </div>
      <p className="text-[11px] text-gray-400 mt-6">{formatInvoiceDate(invoice)}</p>
    </>
  )
  if (!frame) return <div>{inner}</div>
  return <div className={`card ${compact ? 'p-5' : 'p-7'}`}>{inner}</div>
}

// Status badge — 3-state cycle Unpaid → Paid → Partial. Token tints (same
// recipe as ui/Badge) so intensity reads on both themes.
const PAID_BADGE = {
  Paid: 'bg-[rgba(16,185,129,0.12)] text-success',
  Unpaid: 'bg-[rgba(239,68,68,0.10)] text-danger',
  Partial: 'bg-[rgba(245,158,11,0.12)] text-warning',
}
const PAID_CYCLE = ['Unpaid', 'Paid', 'Partial']

export default function CreateInvoice() {
  const { toast } = useToast()
  const { label } = useAuth()

  const [invoices, setInvoices] = useState([])
  const [nextNumber, setNextNumber] = useState(null)
  const [invSettings, setInvSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('table')
  const [editingId, setEditingId] = useState(null)
  const [previewModal, setPreviewModal] = useState(null)
  const formRef = useRef(null)

  const [form, setForm] = useState({ bill_to: '', bill_to_address: '', purchase_order: 'N/A', currency: 'USD', payment_terms: 'Net 30', due_date: '' })
  const [lines, setLines] = useState([blankLine()])

  // Payment terms — the vocabulary comes from the server so the dropdown
  // cannot drift from the arithmetic behind it.
  const [termOptions, setTermOptions] = useState([])
  useEffect(() => {
    api.get('/invoices/terms')
      .then(({ data }) => setTermOptions(data?.data?.terms || []))
      .catch(() => setTermOptions([]))
  }, [])

  // `due` is what the SERVER says the choice means — asked for rather than
  // computed here, so the date in the preview is the date that gets saved.
  // An edit anchors on the invoice's own issue date (`invoice_id`), a new one
  // on today in the company's timezone. This page computes no dates at all.
  const [due, setDue] = useState({ due_by: null, due_date: null, invoice_date: null, error: null })
  useEffect(() => {
    const params = {
      terms: form.payment_terms,
      ...(editingId ? { invoice_id: editingId } : {}),
      ...(form.due_date ? { custom: form.due_date } : {}),
    }
    api.get('/invoices/due-date', { params })
      .then(({ data }) => setDue(data?.data || { due_by: null, due_date: null, invoice_date: null, error: null }))
      .catch(() => setDue({ due_by: null, due_date: null, invoice_date: null, error: null }))
  }, [form.payment_terms, form.due_date, editingId])

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/invoices'), api.get('/invoices/next-number'), api.get('/label')])
      .then(([inv, num, lab]) => {
        setInvoices(inv.data.data || [])
        setNextNumber(num.data.data.next_number)
        setInvSettings(lab.data.data?.invoice_settings || {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setLine = (i, k) => (e) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: e.target.value } : l))
  // Filter on !== '' (not truthiness) so legitimate $0 lines (comps, no-charge
  // items) survive — an all-$0 invoice is a real document.
  const validLines = lines.filter(l => l.description.trim() && l.amount !== '')
  const previewLines = lines.filter(l => l.description.trim() || l.amount !== '')
  const total = validLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const editingInvoice = editingId ? invoices.find(i => i.id === editingId) : null
  const shownNumber = editingInvoice ? editingInvoice.invoice_number : nextNumber

  const reset = () => {
    setEditingId(null)
    setForm({ bill_to: '', bill_to_address: '', purchase_order: 'N/A', currency: 'USD', payment_terms: 'Net 30', due_date: '' })
    setLines([blankLine()])
  }

  const editInvoice = (inv) => {
    setEditingId(inv.id)
    setForm({
      bill_to: inv.bill_to || '', bill_to_address: inv.bill_to_address || '',
      purchase_order: inv.purchase_order || 'N/A', currency: (inv.currency || 'USD').toUpperCase(),
      payment_terms: inv.payment_terms || 'Due on receipt',
      due_date: (inv.due_date || '').slice(0, 10),
    })
    const items = Array.isArray(inv.line_items) ? inv.line_items : []
    setLines(items.length ? items.map(l => ({ description: l.description || '', amount: l.amount != null ? String(l.amount) : '' })) : [blankLine()])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async (e) => {
    e.preventDefault()
    // In-flight guard — ⌘Enter fires requestSubmit() regardless of the
    // button's disabled state, so a double press created duplicate invoices.
    if (saving) return
    if (!form.bill_to.trim()) { toast('Bill-to is required', 'error'); return }
    if (!validLines.length) { toast('Add at least one line item', 'error'); return }
    setSaving(true)
    const payload = {
      bill_to: form.bill_to, bill_to_address: form.bill_to_address,
      purchase_order: form.purchase_order, currency: form.currency,
      amount: total,
      description: validLines.map(l => l.description).filter(Boolean).join(', '),
      line_items: validLines.map(l => ({ description: l.description, amount: parseFloat(l.amount) || 0 })),
      payment_terms: form.payment_terms,
      ...(form.due_date ? { due_date: form.due_date } : {}),
    }
    try {
      if (editingId) { await api.put(`/invoices/${editingId}`, payload); toast('Invoice updated') }
      else { await api.post('/invoices', payload); toast('Invoice created') }
      reset(); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save invoice', 'error')
    } finally { setSaving(false) }
  }

  // Unpaid → Paid → Partial, patched in place — a status click should not
  // refetch the world.
  const cycleStatus = async (inv) => {
    const cur = inv.payment_status || 'Unpaid'
    const next = PAID_CYCLE[(PAID_CYCLE.indexOf(cur) + 1) % PAID_CYCLE.length]
    try {
      await api.put(`/invoices/${inv.id}`, { payment_status: next })
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, payment_status: next } : i))
    } catch { toast('Failed', 'error') }
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this invoice?')) return
    try { await api.delete(`/invoices/${id}`); if (editingId === id) reset(); load() } catch { toast('Failed', 'error') }
  }

  // Generate the invoice as a real PDF and trigger a browser download — no
  // print dialog, no popup blocker in the path. Renders text directly with
  // jsPDF so the output is selectable/searchable (not a flattened raster).
  // Layout mirrors the on-screen InvoicePreview. jsPDF is lazy-imported (like
  // the NDA builder) so it stays out of the main bundle.
  const handleDownload = async (invoice) => {
    let jsPDF
    try { ({ jsPDF } = await import('jspdf')) } catch { toast('PDF module failed to load', 'error'); return }
    const s = invSettings || {}
    const doc = new jsPDF({ unit: 'pt', format: 'a4' })
    const W = doc.internal.pageSize.getWidth()
    const M = 50
    const colGap = 28
    const rightX = M + (W - M * 2 + colGap) / 2

    const RULE = [204, 204, 204]
    const RULE_LIGHT = [229, 229, 229]
    const INK = [17, 17, 17]
    const MUTED = [102, 102, 102]
    const FAINT = [153, 153, 153]
    const SUB = [85, 85, 85]
    const hexToRgb = (hex) => {
      const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
      if (!m) return null
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)]
    }
    const BRAND = hexToRgb(label?.accent_color) || INK

    const setColor = ([r, g, b]) => doc.setTextColor(r, g, b)
    const setRuleColor = ([r, g, b]) => doc.setDrawColor(r, g, b)
    const text = (str, x, y) => doc.text(String(str ?? ''), x, y)
    const rightAlign = (str, x, y) => { const v = String(str ?? ''); doc.text(v, x - doc.getTextWidth(v), y) }
    const rule = (y, color = RULE) => { setRuleColor(color); doc.setLineWidth(0.6); doc.line(M, y, W - M, y) }

    // Header: workspace name in the brand accent (image logos would need a
    // same-origin fetch; the name is always available).
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(26)
    setColor(BRAND)
    text(label?.name || '', M, 75)

    doc.setFontSize(38)
    setColor(INK)
    text('INVOICE', M, 120)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    setColor(MUTED)
    text(`NO.: ${pad(invoice.invoice_number)}`, M, 142)
    text(`PURCHASE ORDER #: ${invoice.purchase_order || 'N/A'}`, M, 156)

    rule(176)

    let yL = 198
    let yR = 198
    const LH = 14

    // ── Left column: Bill To ──
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    setColor(INK)
    text('Bill To:', M, yL); yL += LH + 4

    doc.setFont('helvetica', 'normal')
    setColor([51, 51, 51])
    ;(invoice.bill_to || '').split('\n').forEach(line => { if (line.trim()) { text(line, M, yL); yL += LH } })
    if (invoice.bill_to_address) {
      setColor(SUB)
      invoice.bill_to_address.split('\n').forEach(line => { if (line.trim()) { text(line, M, yL); yL += LH } })
    }

    // ── Right column: Funds Payable To ──
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    setColor(INK)
    text('FUNDS PAYABLE TO:', rightX, yR); yR += LH + 4

    doc.setFont('helvetica', 'normal')
    setColor([51, 51, 51])
    if (s.company_name) { text(s.company_name, rightX, yR); yR += LH }
    ;(s.address || '').split('\n').forEach(l => { if (l.trim()) { text(l.trim(), rightX, yR); yR += LH } })

    if (s.contact || s.phone || s.email) yR += 10
    if (s.contact) { text(`CONTACT: ${s.contact}`, rightX, yR); yR += LH }
    if (s.phone) { text(`PHONE: ${s.phone}`, rightX, yR); yR += LH }
    if (s.email) { text(`EMAIL: ${s.email}`, rightX, yR); yR += LH }

    if (s.ein) {
      yR += 8
      setRuleColor(RULE_LIGHT); doc.setLineWidth(0.5)
      doc.line(rightX, yR, W - M, yR); yR += LH
      text(`EIN: ${s.ein}`, rightX, yR); yR += LH
    }

    const routingLines = [s.routing, s.routing_ach].filter(Boolean)
    if (s.bank_name || s.bank_address || s.account_name || s.account_type || s.swift || routingLines.length || s.account_number) {
      yR += 8
      setRuleColor(RULE_LIGHT); doc.setLineWidth(0.5)
      doc.line(rightX, yR, W - M, yR); yR += LH
      if (s.bank_name) { text(`BANK: ${s.bank_name}`, rightX, yR); yR += LH }
      if (s.bank_address) { text(`ADDRESS: ${s.bank_address}`, rightX, yR); yR += LH }
      if (s.account_name) { text(`NAME: ${s.account_name}`, rightX, yR); yR += LH }
      if (s.account_type) { text(`TYPE: ${s.account_type}`, rightX, yR); yR += LH }
      if (s.swift) { text(`SWIFT: ${s.swift}`, rightX, yR); yR += LH }
      if (routingLines.length) { text(`ROUTING: ${routingLines[0]}`, rightX, yR); yR += LH }
      // Second routing line is indented under "ROUTING:" so the values stack.
      if (routingLines.length > 1) { text(routingLines[1], rightX + 56, yR); yR += LH }
      if (s.account_number) { text(`ACCOUNT: ${s.account_number}`, rightX, yR); yR += LH }
    }

    // ── Below the two columns ──
    let y = Math.max(yL, yR) + 14

    doc.setFontSize(11)
    setColor(INK)
    doc.setFont('helvetica', 'bold')
    text('DUE BY:', M, y)
    doc.setFont('helvetica', 'normal')
    text(invoice.due_by || 'UPON RECEIPT', M + 56, y)
    y += 14
    rule(y); y += 18

    doc.setFont('helvetica', 'bold')
    text('Description', M, y)
    rightAlign('Amount Due', W - M, y)
    y += 8
    rule(y, RULE_LIGHT); y += 14

    doc.setFont('helvetica', 'normal')
    const items = (Array.isArray(invoice.line_items) && invoice.line_items.length)
      ? invoice.line_items
      : [{ description: invoice.description, amount: invoice.amount }]
    for (const li of items) {
      // Wrap long descriptions to the column width so they don't run into the
      // right-aligned amount.
      const maxDescW = (W - M) - M - 90
      const wrapped = doc.splitTextToSize(String(li.description || ''), maxDescW)
      wrapped.forEach((line, i) => { text(line, M, y + i * LH) })
      rightAlign(formatCurrency(li.amount, invoice.currency), W - M, y)
      y += LH * Math.max(wrapped.length, 1)
    }
    y += 4
    rule(y); y += 18

    doc.setFont('helvetica', 'bold')
    text('TOTAL DUE', M, y)
    rightAlign(formatCurrency(invoice.amount, invoice.currency), W - M, y)
    y += 14
    rule(y); y += 16

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    setColor(FAINT)
    text(formatInvoiceDate(invoice), M, y)

    // Deterministic filename: Workspace-Invoice#0007-Payee.pdf
    const safeLabel = (label?.name || 'Invoice').replace(/[^a-zA-Z0-9.]/g, '')
    const safePayee = (invoice.bill_to || '').split('\n')[0].replace(/[^a-zA-Z0-9]/g, '')
    doc.save(`${safeLabel}-Invoice#${pad(invoice.invoice_number)}-${safePayee}.pdf`)
  }

  const previewInvoice = {
    invoice_number: shownNumber,
    purchase_order: form.purchase_order,
    bill_to: form.bill_to,
    bill_to_address: form.bill_to_address,
    currency: form.currency,
    amount: total,
    line_items: (previewLines.length ? previewLines : [blankLine()]).map(l => ({ description: l.description || 'Description', amount: parseFloat(l.amount) || 0 })),
    // What the invoice will actually print — the server's answer, so the
    // preview cannot print one day and bill from another.
    due_by: due.due_by || 'UPON RECEIPT',
    invoice_date: due.invoice_date || null,
    created_at: editingInvoice?.created_at || new Date().toISOString(),
  }

  // Meta hotkeys: ⌘↵ submit · ⌘⇧L add line item · ⌘P download the open
  // preview (or the latest saved invoice). Registered directly (the shared
  // useHotkeys deliberately ignores modifier combos).
  const hkRef = useRef(null)
  hkRef.current = { previewModal, invoices }
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'enter') { e.preventDefault(); formRef.current?.requestSubmit() }
      else if (k === 'l' && e.shiftKey) { e.preventDefault(); setLines(ls => [...ls, blankLine()]) }
      else if (k === 'p' && !e.shiftKey) {
        e.preventDefault()
        const { previewModal: pm, invoices: list } = hkRef.current
        if (pm) handleDownload(pm)
        else if (list.length) handleDownload(list[0])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invSettings, label])

  const badge = (inv) => (
    <button onClick={() => cycleStatus(inv)} title="Click to change status" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${PAID_BADGE[inv.payment_status] || PAID_BADGE.Unpaid}`}>
      {inv.payment_status === 'Paid' && <Check size={11} />}{inv.payment_status || 'Unpaid'}
    </button>
  )

  return (
    <div>
      <PageHeader title={editingId ? `Edit invoice #${pad(shownNumber)}` : 'Create invoice'} subtitle="Issue an invoice from this workspace" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <form ref={formRef} onSubmit={save} className="card p-6">
          <div className="mb-5">
            <h2 className="text-base font-bold text-ink">{editingId ? 'Edit invoice' : 'New invoice'}</h2>
            <p className="text-sm text-gray-400">
              {editingId
                ? `Editing invoice for ${(editingInvoice?.bill_to || form.bill_to || '').split('\n')[0]}`
                : `Invoice #${nextNumber != null ? pad(nextNumber) : '—'} will be created`}
            </p>
          </div>

          <label className="label">Bill To</label>
          <textarea className="input min-h-[64px] mb-4" value={form.bill_to} onChange={set('bill_to')} placeholder={'Company name\nContact name'} autoFocus required />

          <label className="label">Address</label>
          <textarea className="input min-h-[64px] mb-4" value={form.bill_to_address} onChange={set('bill_to_address')} placeholder="Street address, city, state, zip" />

          {/* Payment terms — what the invoice tells the client, and the date it
              works out to. The date comes from the server (GET /invoices/due-date):
              this preview has to be the document that gets saved, and two
              implementations of "add 30 days" on opposite sides of a timezone is
              how a deadline moves by a day with nothing saying so. */}
          <label className="label">Payment terms</label>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <select className="input !w-auto" value={form.payment_terms} onChange={e => setForm(f => ({ ...f, payment_terms: e.target.value, due_date: '' }))}>
              {(termOptions.length ? termOptions : [{ label: 'Net 30' }]).map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
            {form.payment_terms === 'Custom' && (
              <input type="date" className="input !w-auto" value={form.due_date} min={due.invoice_date || undefined} onChange={set('due_date')} />
            )}
            {/* An error is stated rather than swallowed — a Custom term with no
                date would otherwise be refused only on submit. */}
            <span className={`text-xs ${due.error ? 'text-warning' : 'text-gray-500'}`}>
              {due.error ? due.error : due.due_by ? `Due ${due.due_by}` : 'Due upon receipt'}
            </span>
          </div>

          <div className="flex items-center justify-between mb-2">
            <label className="label !mb-0">Line Items</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Currency</span>
              <select className="input !w-auto !py-1 text-sm" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className="input flex-1" placeholder="Description" value={l.description} onChange={setLine(i, 'description')} />
                <input type="number" step="0.01" min="0" className="input w-28" placeholder="0.00" value={l.amount} onChange={setLine(i, 'amount')} />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="text-gray-300 hover:text-danger px-1"><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines(ls => [...ls, blankLine()])} className="mt-2 text-xs font-semibold text-brand-ink hover:text-brand-700 inline-flex items-center gap-1"><Plus size={13} /> Add item</button>
          {lines.some(l => l.amount !== '') && (
            <div className="mt-2 text-right text-sm font-semibold text-ink">
              Total: {formatCurrency(lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0), form.currency)}
            </div>
          )}

          <div className="mt-4">
            <label className="label">Purchase order</label>
            <input className="input" value={form.purchase_order} onChange={set('purchase_order')} placeholder="N/A" />
          </div>

          <div className="flex items-center gap-2 mt-5">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader className="animate-spin" size={16} /> : editingId ? <Pencil size={16} /> : <Plus size={16} />}
              {saving ? 'Saving…' : (editingId ? 'Update Invoice' : 'Create Invoice')}
            </button>
            {editingId && <button type="button" onClick={reset} className="btn-secondary">Cancel</button>}
          </div>
        </form>

        {/* ── Live invoice preview ── */}
        <div>
          <InvoicePreview invoice={previewInvoice} settings={invSettings} label={label} />
          {(form.bill_to || total > 0) && (
            <button type="button" onClick={() => handleDownload(previewInvoice)} className="btn-secondary mt-4 text-xs"><Download size={14} /> Download PDF</button>
          )}
        </div>
      </div>

      {/* ── Saved invoices ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-ink">Saved Invoices ({invoices.length})</h2>
          <div className="inline-flex rounded-lg border border-rule overflow-hidden text-sm">
            <button onClick={() => setView('table')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold ${view === 'table' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}><TableIcon size={14} /> Table</button>
            <button onClick={() => setView('cards')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold border-l border-rule ${view === 'cards' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}><LayoutGrid size={14} /> Cards</button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton.Block h="h-24" />
            <Skeleton.Block h="h-64" />
          </div>
        ) : invoices.length === 0 ? (
          <div className="card p-10 text-center text-sm text-gray-500">No invoices yet — create your first one above.</div>
        ) : view === 'table' ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-divider text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-semibold">Invoice #</th><th className="px-4 py-3 font-semibold">Bill To</th><th className="px-4 py-3 font-semibold">Description</th><th className="px-4 py-3 font-semibold text-right">Amount</th><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr></thead>
              <tbody className="divide-y divide-divider">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-600">#{pad(inv.invoice_number)}</td>
                    <td className="px-4 py-3 font-medium text-ink">{(inv.bill_to || '').split('\n')[0]}</td>
                    <td className="px-4 py-3 text-gray-500">{inv.description || '—'}</td>
                    <td className="px-4 py-3 text-right text-ink whitespace-nowrap">{formatCurrency(inv.amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{shortInvoiceDate(inv)}</td>
                    <td className="px-4 py-3">{badge(inv)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => editInvoice(inv)} title="Edit" className="text-gray-400 hover:text-brand-ink px-1.5"><Pencil size={14} /></button>
                      <button onClick={() => setPreviewModal(inv)} title="Preview" className="text-gray-400 hover:text-brand-ink px-1.5"><Eye size={14} /></button>
                      <button onClick={() => handleDownload(inv)} title="Download PDF" className="text-gray-400 hover:text-success px-1.5"><Download size={14} /></button>
                      <button onClick={() => remove(inv.id)} title="Delete" className="text-gray-300 hover:text-danger px-1.5"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            {invoices.map(inv => (
              <div key={inv.id} className="card overflow-hidden !p-0">
                <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-elev border-b border-divider flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText size={15} className="text-gray-400" />
                    <span className="text-sm font-semibold text-ink whitespace-nowrap">Invoice #{pad(inv.invoice_number)}</span>
                    {badge(inv)}
                    <span className="text-xs text-gray-500 truncate">— {(inv.bill_to || '').split('\n')[0]}</span>
                    <span className="text-xs font-medium text-gray-600 whitespace-nowrap">{formatCurrency(inv.amount, inv.currency)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => editInvoice(inv)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-ink hover:bg-gray-100 rounded-md"><Pencil size={13} /> Edit</button>
                    <button onClick={() => handleDownload(inv)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-ink hover:bg-gray-100 rounded-md"><Download size={13} /> Download</button>
                    <button onClick={() => remove(inv.id)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-[rgba(239,68,68,0.10)] rounded-md"><Trash2 size={13} /> Delete</button>
                  </div>
                </div>
                <div className="p-5">
                  <InvoicePreview invoice={inv} settings={invSettings} label={label} compact frame={false} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Preview modal ── */}
      <Modal
        open={!!previewModal}
        onClose={() => setPreviewModal(null)}
        title={previewModal ? `Invoice #${pad(previewModal.invoice_number)}` : ''}
        size="xl"
        footer={previewModal && (
          <>
            <button onClick={() => handleDownload(previewModal)} className="btn-secondary text-xs"><Download size={14} /> Download</button>
            <button onClick={() => setPreviewModal(null)} className="btn-primary text-xs">Close</button>
          </>
        )}
      >
        {previewModal && <InvoicePreview invoice={previewModal} settings={invSettings} label={label} frame={false} />}
      </Modal>
    </div>
  )
}

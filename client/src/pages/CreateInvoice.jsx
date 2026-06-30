import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Pencil, Eye, Download, Check, Table as TableIcon, LayoutGrid } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { CURRENCIES } from '../constants'

const CUR = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$', MXN: '$', JPY: '¥', BRL: 'R$', CHF: 'CHF ', SEK: 'kr ', NOK: 'kr ', DKK: 'kr ' }
const sym = (c) => CUR[c] || `${c} `
const money = (n, c = 'USD') => `${sym(c)}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const blankLine = () => ({ description: '', amount: '' })
const pad = (n) => String(n).padStart(4, '0')
const longDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

// Render the workspace's "Funds payable to" block from saved invoice settings.
function PayableTo({ inv }) {
  if (!inv || !Object.values(inv).some(Boolean)) {
    return <p className="text-xs text-gray-300">Set your company &amp; bank details in Settings → Invoice details.</p>
  }
  const Row = ({ label, value }) => value ? <p><span className="font-semibold">{label}</span> {value}</p> : null
  return (
    <div className="text-[12px] leading-relaxed text-ink space-y-2">
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
      {(inv.bank_name || inv.bank_address || inv.account_name || inv.account_type || inv.swift || inv.routing || inv.account_number) && (
        <div>
          <Row label="BANK:" value={inv.bank_name} />
          <Row label="ADDRESS:" value={inv.bank_address} />
          <Row label="NAME:" value={inv.account_name} />
          <Row label="TYPE:" value={inv.account_type} />
          <Row label="SWIFT:" value={inv.swift} />
          <Row label="ROUTING:" value={inv.routing} />
          <Row label="ACCOUNT:" value={inv.account_number} />
        </div>
      )}
    </div>
  )
}

export default function CreateInvoice() {
  const { toast } = useToast()
  const { label } = useAuth()
  const navigate = useNavigate()

  const [invoices, setInvoices] = useState([])
  const [nextNumber, setNextNumber] = useState(null)
  const [invSettings, setInvSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('table')
  const [editingId, setEditingId] = useState(null)

  const [form, setForm] = useState({ bill_to: '', bill_to_address: '', purchase_order: 'N/A', due_by: 'UPON RECEIPT', currency: 'USD' })
  const [lines, setLines] = useState([blankLine()])

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
  const cleanLines = lines.filter(l => l.description.trim() || l.amount)
  const total = cleanLines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const shownNumber = editingId ? invoices.find(i => i.id === editingId)?.invoice_number : nextNumber

  const reset = () => {
    setEditingId(null)
    setForm({ bill_to: '', bill_to_address: '', purchase_order: 'N/A', due_by: 'UPON RECEIPT', currency: 'USD' })
    setLines([blankLine()])
  }

  const editInvoice = (inv) => {
    setEditingId(inv.id)
    setForm({
      bill_to: inv.bill_to || '', bill_to_address: inv.bill_to_address || '',
      purchase_order: inv.purchase_order || 'N/A', due_by: inv.due_by || 'UPON RECEIPT', currency: inv.currency || 'USD',
    })
    const items = Array.isArray(inv.line_items) ? inv.line_items : []
    setLines(items.length ? items.map(l => ({ description: l.description || '', amount: l.amount != null ? String(l.amount) : '' })) : [blankLine()])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.bill_to.trim()) { toast('Bill-to is required', 'error'); return }
    if (total <= 0) { toast('Add at least one line item with an amount', 'error'); return }
    setSaving(true)
    const payload = {
      bill_to: form.bill_to, bill_to_address: form.bill_to_address,
      purchase_order: form.purchase_order, due_by: form.due_by, currency: form.currency,
      amount: total,
      description: cleanLines.map(l => l.description).filter(Boolean).join(', '),
      line_items: cleanLines.map(l => ({ description: l.description, amount: parseFloat(l.amount) || 0 })),
    }
    try {
      if (editingId) { await api.put(`/invoices/${editingId}`, payload); toast('Invoice updated') }
      else { await api.post('/invoices', payload); toast('Invoice created') }
      reset(); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save invoice', 'error')
    } finally { setSaving(false) }
  }

  const togglePaid = async (inv) => {
    const next = inv.payment_status === 'Paid' ? 'Unpaid' : 'Paid'
    try { await api.put(`/invoices/${inv.id}`, { payment_status: next }); load() } catch { toast('Failed', 'error') }
  }
  const remove = async (id) => {
    if (!window.confirm('Delete this invoice?')) return
    try { await api.delete(`/invoices/${id}`); if (editingId === id) reset(); load() } catch { toast('Failed', 'error') }
  }

  // Open a print-ready invoice in a new window → "Save as PDF".
  const printInvoice = (inv) => {
    const items = Array.isArray(inv.line_items) && inv.line_items.length ? inv.line_items : [{ description: inv.description || '', amount: inv.amount }]
    const c = inv.currency || 'USD'
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))
    const s = invSettings || {}
    const payable = [
      s.company_name && `<div style="font-weight:700">${esc(s.company_name)}</div>`,
      s.address && `<div style="white-space:pre-line">${esc(s.address)}</div>`,
      (s.contact || s.phone || s.email) ? '<div style="height:8px"></div>' : '',
      s.contact && `<div><b>CONTACT:</b> ${esc(s.contact)}</div>`,
      s.phone && `<div><b>PHONE:</b> ${esc(s.phone)}</div>`,
      s.email && `<div><b>EMAIL:</b> ${esc(s.email)}</div>`,
      s.ein ? `<div style="height:8px"></div><div><b>EIN:</b> ${esc(s.ein)}</div>` : '',
      (s.bank_name || s.account_number) ? '<div style="height:8px"></div>' : '',
      s.bank_name && `<div><b>BANK:</b> ${esc(s.bank_name)}</div>`,
      s.bank_address && `<div><b>ADDRESS:</b> ${esc(s.bank_address)}</div>`,
      s.account_name && `<div><b>NAME:</b> ${esc(s.account_name)}</div>`,
      s.account_type && `<div><b>TYPE:</b> ${esc(s.account_type)}</div>`,
      s.swift && `<div><b>SWIFT:</b> ${esc(s.swift)}</div>`,
      s.routing && `<div><b>ROUTING:</b> ${esc(s.routing)}</div>`,
      s.account_number && `<div><b>ACCOUNT:</b> ${esc(s.account_number)}</div>`,
    ].filter(Boolean).join('')
    const rows = items.map(l => `<tr><td style="padding:6px 0">${esc(l.description) || '—'}</td><td style="padding:6px 0;text-align:right">${money(l.amount, c)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice #${pad(inv.invoice_number)}</title>
      <style>*{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;box-sizing:border-box}
      body{margin:48px;font-size:13px}h1{font-size:40px;margin:4px 0 2px;letter-spacing:-1px}
      .logo{font-size:34px;font-weight:800;color:#e2483d}.muted{color:#64748b}.hr{border-top:1px solid #e5e7eb;margin:18px 0}
      .grid{display:flex;justify-content:space-between;gap:40px}table{width:100%;border-collapse:collapse;font-size:13px}
      .tot{display:flex;justify-content:space-between;border-top:2px solid #0f172a22;padding-top:10px;margin-top:6px;font-weight:700;font-size:16px}</style></head>
      <body>
      ${label?.logo_url ? `<img src="${label.logo_url}" style="height:42px"/>` : `<div class="logo">${esc(label?.name || '')}</div>`}
      <h1>INVOICE</h1>
      <div class="muted">NO.: ${pad(inv.invoice_number)}<br/>PURCHASE ORDER #: ${esc(inv.purchase_order || 'N/A')}</div>
      <div class="hr"></div>
      <div class="grid"><div><div style="font-weight:700">Bill To</div><div style="white-space:pre-line">${esc(inv.bill_to)}</div>${inv.bill_to_address ? `<div class="muted" style="white-space:pre-line">${esc(inv.bill_to_address)}</div>` : ''}</div>
      <div style="text-align:left;min-width:280px">${payable}</div></div>
      <div class="hr"></div>
      <div><b>DUE BY:</b> ${esc(inv.due_by || 'UPON RECEIPT')}</div>
      <div class="hr"></div>
      <table><thead><tr><th style="text-align:left;border-bottom:1px solid #e5e7eb;padding-bottom:6px">Description</th><th style="text-align:right;border-bottom:1px solid #e5e7eb;padding-bottom:6px">Amount Due</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot"><span>TOTAL DUE</span><span>${money(inv.amount, c)}</span></div>
      <p class="muted" style="margin-top:24px">${longDate(inv.created_at || Date.now())}</p>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`
    const w = window.open('', '_blank')
    if (!w) { toast('Allow pop-ups to download the invoice', 'error'); return }
    w.document.write(html); w.document.close()
  }

  const previewInv = {
    invoice_number: shownNumber, purchase_order: form.purchase_order, bill_to: form.bill_to,
    bill_to_address: form.bill_to_address, due_by: form.due_by, currency: form.currency,
    amount: total, line_items: cleanLines, created_at: Date.now(),
  }

  return (
    <div>
      <PageHeader title={editingId ? `Edit invoice #${pad(shownNumber)}` : 'Create invoice'} subtitle="Issue an invoice from this workspace" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <form onSubmit={save} className="card p-6">
          <div className="mb-5">
            <h2 className="text-base font-bold text-ink">{editingId ? 'Edit invoice' : 'New invoice'}</h2>
            <p className="text-sm text-gray-400">{editingId ? `Editing #${pad(shownNumber)}` : `Invoice #${nextNumber != null ? pad(nextNumber) : '—'} will be created`}</p>
          </div>

          <label className="label">Bill To</label>
          <textarea className="input min-h-[64px] mb-4" value={form.bill_to} onChange={set('bill_to')} placeholder={'Company name\nContact name'} autoFocus />

          <label className="label">Address</label>
          <textarea className="input min-h-[64px] mb-4" value={form.bill_to_address} onChange={set('bill_to_address')} placeholder="Street address, city, state, zip" />

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
                <input type="number" step="0.01" className="input w-28" placeholder="0.00" value={l.amount} onChange={setLine(i, 'amount')} />
                <button type="button" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls)} className="text-gray-300 hover:text-danger px-1"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines(ls => [...ls, blankLine()])} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><Plus size={13} /> Add item</button>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div><label className="label">Purchase order</label><input className="input" value={form.purchase_order} onChange={set('purchase_order')} placeholder="N/A" /></div>
            <div><label className="label">Due by</label><input className="input" value={form.due_by} onChange={set('due_by')} /></div>
          </div>

          <div className="flex items-center gap-2 mt-5">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center"><Plus size={16} /> {saving ? 'Saving…' : (editingId ? 'Update Invoice' : 'Create Invoice')}</button>
            {editingId && <button type="button" onClick={reset} className="btn-secondary">Cancel</button>}
          </div>
        </form>

        {/* ── Live invoice preview ── */}
        <div className="card p-7">
          {label?.logo_url
            ? <img src={label.logo_url} alt="" className="h-9 mb-1 object-contain" />
            : <p className="text-2xl font-extrabold text-brand-600 mb-1">{label?.name}</p>}
          <h1 className="text-4xl font-extrabold tracking-tight text-ink">INVOICE</h1>
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">NO.: {shownNumber != null ? pad(shownNumber) : '—'}<br />PURCHASE ORDER #: {form.purchase_order || 'N/A'}</p>

          <div className="border-t border-divider my-4" />
          <div className="flex justify-between gap-6">
            <div className="text-[12px]">
              <p className="font-bold mb-1">Bill To</p>
              <p className="text-gray-600 whitespace-pre-line">{form.bill_to || 'Client Name'}</p>
              {form.bill_to_address && <p className="text-gray-400 whitespace-pre-line mt-1">{form.bill_to_address}</p>}
            </div>
            <div className="min-w-[260px]"><PayableTo inv={invSettings} /></div>
          </div>

          <div className="border-t border-divider my-4" />
          <p className="text-[12px]"><span className="font-bold">DUE BY:</span> {form.due_by || 'UPON RECEIPT'}</p>

          <div className="border-t border-divider my-4" />
          <table className="w-full text-[12px]">
            <thead><tr className="border-b border-divider"><th className="text-left font-bold pb-1.5">Description</th><th className="text-right font-bold pb-1.5">Amount Due</th></tr></thead>
            <tbody>
              {(cleanLines.length ? cleanLines : [{ description: 'Description', amount: 0 }]).map((l, i) => (
                <tr key={i}><td className="py-1.5 text-gray-600">{l.description || 'Description'}</td><td className="py-1.5 text-right text-gray-600">{money(l.amount, form.currency)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center border-t-2 border-ink/10 pt-3 mt-3">
            <span className="font-bold text-ink">TOTAL DUE</span>
            <span className="font-bold text-ink text-lg">{money(total, form.currency)}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-6">{longDate(Date.now())}</p>
          {(form.bill_to || total > 0) && (
            <button type="button" onClick={() => printInvoice(previewInv)} className="btn-secondary mt-4 text-xs"><Download size={14} /> Download / print PDF</button>
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
          <p className="text-sm text-gray-400">Loading…</p>
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
                    <td className="px-4 py-3 text-right text-ink whitespace-nowrap">{money(inv.amount, inv.currency)}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{new Date(inv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="px-4 py-3"><button onClick={() => togglePaid(inv)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${inv.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{inv.payment_status === 'Paid' && <Check size={11} />}{inv.payment_status}</button></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => editInvoice(inv)} title="Edit" className="text-gray-400 hover:text-brand-600 px-1.5"><Pencil size={14} /></button>
                      <button onClick={() => { editInvoice(inv) }} title="Preview" className="text-gray-400 hover:text-brand-600 px-1.5"><Eye size={15} /></button>
                      <button onClick={() => printInvoice(inv)} title="Download" className="text-gray-400 hover:text-emerald-600 px-1.5"><Download size={15} /></button>
                      <button onClick={() => remove(inv.id)} title="Delete" className="text-gray-300 hover:text-danger px-1.5"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {invoices.map(inv => (
              <div key={inv.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-sm text-gray-500">#{pad(inv.invoice_number)}</span>
                  <button onClick={() => togglePaid(inv)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${inv.payment_status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{inv.payment_status === 'Paid' && <Check size={11} />}{inv.payment_status}</button>
                </div>
                <p className="font-semibold text-ink mt-2">{(inv.bill_to || '').split('\n')[0]}</p>
                <p className="text-xs text-gray-500 line-clamp-1">{inv.description || '—'}</p>
                <p className="text-lg font-bold text-ink mt-2">{money(inv.amount, inv.currency)}</p>
                <p className="text-xs text-gray-400">{new Date(inv.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-divider">
                  <button onClick={() => editInvoice(inv)} title="Edit" className="text-gray-400 hover:text-brand-600 px-1.5"><Pencil size={14} /></button>
                  <button onClick={() => printInvoice(inv)} title="Download" className="text-gray-400 hover:text-emerald-600 px-1.5"><Download size={15} /></button>
                  <button onClick={() => remove(inv.id)} title="Delete" className="text-gray-300 hover:text-danger px-1.5 ml-auto"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

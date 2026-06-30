import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Check, X, Trash2, Paperclip, Link2, BookOpen, DollarSign, Download, Upload, SlidersHorizontal, FileBarChart } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import LedgerEntryDrawer from '../components/LedgerEntryDrawer'

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
  const [copied, setCopied] = useState(false)

  const load = () => {
    setLoading(true)
    const q = filter === 'all' ? '' : `?status=${filter}`
    api.get(`/ledger/entries${q}`).then(res => setEntries(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [filter])

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

  // ── CSV export / import ──────────────────────────────────────────────
  const importRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState(null)
  const [report1099, setReport1099] = useState(null)

  const open1099 = async () => {
    try { const { data } = await api.get('/ledger/1099-report'); setReport1099(data.data) }
    catch { toast('Failed to load 1099 report', 'error') }
  }

  const exportCsv = async () => {
    try {
      const res = await api.get('/ledger/export', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url; a.download = `ledger-${label?.slug || 'export'}.csv`
      document.body.appendChild(a); a.click(); a.remove()
      window.URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  // Minimal CSV parser — header row maps to known columns; quoted fields with
  // commas/newlines are handled.
  const parseCsv = (text) => {
    const rows = []; let row = []; let field = ''; let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
        else if (c === '"') inQuotes = false
        else field += c
      } else if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' } if (c === '\r' && text[i + 1] === '\n') i++ }
      else field += c
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }
    if (rows.length < 2) return []
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])))
  }

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (!rows.length) { toast('No rows found in CSV', 'error'); return }
      const { data } = await api.post('/ledger/import', { rows })
      toast(`Imported ${data.data.inserted} entries`)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Import failed', 'error') }
    finally { setImporting(false); if (importRef.current) importRef.current.value = '' }
  }

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Expenses and vendor payments"
        action={
          <div className="flex items-center gap-2">
            <button onClick={open1099} className="btn-secondary"><FileBarChart size={15} /> 1099</button>
            <button onClick={exportCsv} className="btn-secondary"><Download size={15} /> Export</button>
            <button onClick={() => importRef.current?.click()} disabled={importing} className="btn-secondary">
              <Upload size={15} /> {importing ? 'Importing…' : 'Import'}
            </button>
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImportFile} />
            <button onClick={copyVendorLink} className="btn-secondary">
              {copied ? <><Check size={15} /> Copied</> : <><Link2 size={15} /> Vendor form link</>}
            </button>
            <Link to="/ledger/new-reimbursement" className="btn-secondary"><Plus size={16} /> Add reimbursement</Link>
            <Link to="/ledger/new-invoice" className="btn-primary"><Plus size={16} /> Add invoice</Link>
          </div>
        }
      />

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
                <tr key={en.id} className={`hover:bg-gray-50 align-top ${en.voided ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{en.invoice_date ? new Date(en.invoice_date).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-3">
                    <p className={`font-medium text-ink ${en.voided ? 'line-through' : ''}`}>{en.payee}</p>
                    {en.vendor_submitted && <span className="text-[10px] text-brand-600 font-semibold uppercase">Vendor submission</span>}
                    {en.voided && <span className="text-[10px] text-red-500 font-semibold uppercase ml-1">Voided</span>}
                    {en.split_count > 0 && <span className="text-[10px] text-gray-400 font-semibold uppercase ml-1">{en.split_count} splits</span>}
                    {en.is_bulk_deal && <span className="text-[10px] text-violet-500 font-semibold uppercase ml-1">Bulk deal</span>}
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
                      <button onClick={() => setDrawerEntry(en)} title="Details" className="text-gray-400 hover:text-brand-600 p-1 rounded"><SlidersHorizontal size={14} /></button>
                      <button onClick={() => remove(en.id)} title="Delete" className="text-gray-300 hover:text-danger p-1 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawerEntry && (
        <LedgerEntryDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} onChanged={load} />
      )}

      {report1099 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-overlay overflow-y-auto" onClick={() => setReport1099(null)}>
          <div className="w-full max-w-2xl bg-card rounded-2xl border border-rule shadow-modal my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
              <h2 className="text-base font-semibold text-ink">1099 report · {report1099.year} <span className="text-xs font-normal text-gray-400">(paid ≥ $600)</span></h2>
              <button onClick={() => setReport1099(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {report1099.vendors.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-400">No vendors crossed the $600 threshold this year.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                    <th className="px-4 py-2 font-semibold">Vendor</th><th className="px-4 py-2 font-semibold text-right">Paid</th><th className="px-4 py-2 font-semibold text-center">W9</th>
                  </tr></thead>
                  <tbody>
                    {report1099.vendors.map((v, i) => (
                      <tr key={i} className="border-b border-divider last:border-0">
                        <td className="px-4 py-2 text-ink">{v.vendor}<span className="block text-[11px] text-gray-400">{v.email || ''}</span></td>
                        <td className="px-4 py-2 text-right font-medium">${Number(v.total_paid).toLocaleString()}</td>
                        <td className="px-4 py-2 text-center">{v.has_w9 ? <Check size={14} className="text-emerald-600 inline" /> : <span className="text-[10px] text-red-500 font-semibold">MISSING</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

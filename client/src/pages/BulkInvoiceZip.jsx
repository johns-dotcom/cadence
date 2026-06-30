import { useEffect, useRef, useState } from 'react'
import { Package, Upload, Search } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

// Two ways to pull invoice files out: bulk-match a spreadsheet, or one vendor.
export default function BulkInvoiceZip() {
  const { toast } = useToast()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [vendors, setVendors] = useState([])
  const [vendor, setVendor] = useState('')

  useEffect(() => { api.get('/ledger/vendors').then(r => setVendors((r.data.data || []).map(v => v.name))).catch(() => {}) }, [])

  const downloadBlob = (data, name) => {
    const url = window.URL.createObjectURL(new Blob([data]))
    const a = document.createElement('a'); a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
  }

  const runBulk = async () => {
    if (!file) { toast('Choose a spreadsheet first', 'error'); return }
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await api.post('/ledger/bulk-zip', fd, { headers: { 'Content-Type': 'multipart/form-data' }, responseType: 'blob' })
      downloadBlob(res.data, 'invoices.zip')
      toast('ZIP downloaded — open matches.csv in each sheet folder')
    } catch (err) { toast('Could not process the spreadsheet', 'error') }
    finally { setBusy(false) }
  }

  const runVendor = async () => {
    if (!vendor.trim()) { toast('Pick a vendor', 'error'); return }
    setBusy(true)
    try {
      const res = await api.get('/ledger/vendor-zip', { params: { payee: vendor.trim() }, responseType: 'blob' })
      downloadBlob(res.data, `${vendor.trim().replace(/[^a-z0-9]+/gi, '-')}.zip`)
    } catch (err) { toast('No invoices found for that vendor', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Bulk Invoice ZIP" subtitle="Pull invoice files (and W9s) out in bulk" />

      {/* Mode 1: spreadsheet */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-bold text-ink mb-1">From a spreadsheet</h2>
        <p className="text-xs text-gray-400 mb-3">Upload an .xlsx/.xls with a <strong>Vendor</strong> column (also accepts Payee/Supplier/Company/Bill To) and an <strong>Invoice #</strong> column. You'll get a ZIP of every matching invoice file + W9s, plus a per-sheet <code>matches.csv</code>. Invoice numbers match after stripping <code>#</code>/<code>INV-</code>/leading zeros.</p>
        <div onClick={() => fileRef.current?.click()} className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-lg border-2 border-dashed border-rule hover:border-brand-300 cursor-pointer text-center mb-3">
          <Upload size={20} className="text-gray-400" />
          <span className="text-sm text-gray-600">{file ? file.name : 'Click to choose a spreadsheet (.xlsx / .xls)'}</span>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        </div>
        <button onClick={runBulk} disabled={busy || !file} className="btn-primary w-full"><Package size={16} /> {busy ? 'Building ZIP…' : 'Download invoices & W9s'}</button>
      </div>

      {/* Mode 2: single vendor */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-ink mb-1">One vendor</h2>
        <p className="text-xs text-gray-400 mb-3">Every invoice on file for a vendor + their W9 + a branded Excel ledger.</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input list="vendor-list" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor name" className="input !pl-9" />
            <datalist id="vendor-list">{vendors.map(v => <option key={v} value={v} />)}</datalist>
          </div>
          <button onClick={runVendor} disabled={busy || !vendor.trim()} className="btn-primary flex-shrink-0"><Package size={16} /> Download</button>
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, Sparkles, Trash2, Check, AlertTriangle, Loader2 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

let rid = 1
const blankFields = () => ({ payee: '', amount: '', currency: 'USD', invoice_number: '', invoice_date: '', category: '', is_reimbursement: false })

// Drop many invoice PDFs → AI parses each sequentially → review/edit the
// extracted fields in a table → batch-create as ledger entries (each with its
// file). Reuses the single-file parse + create endpoints.
export default function BulkUpload() {
  const { toast } = useToast()
  const inputRef = useRef(null)
  const [rows, setRows] = useState([])       // { id, file, fields, parsing, error, done }
  const [creating, setCreating] = useState(false)

  const onFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const fresh = files.map(f => ({ id: rid++, file: f, fields: blankFields(), parsing: true, error: null, done: false }))
    setRows(r => [...r, ...fresh])
    // Parse sequentially to respect the AI rate limit.
    for (const row of fresh) {
      try {
        const fd = new FormData(); fd.append('file', row.file)
        const { data } = await api.post('/ledger/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        const d = data.data
        setRows(rs => rs.map(x => x.id === row.id ? { ...x, parsing: false, fields: {
          ...x.fields,
          payee: d.vendor_name || '', amount: d.amount != null ? String(d.amount) : '',
          currency: d.currency || 'USD', invoice_number: d.invoice_number || '',
          invoice_date: d.invoice_date || '', category: d.category || '',
        } } : x))
      } catch {
        setRows(rs => rs.map(x => x.id === row.id ? { ...x, parsing: false, error: 'Could not read — fill manually' } : x))
      }
    }
  }

  const setField = (id, k, v) => setRows(rs => rs.map(x => x.id === id ? { ...x, fields: { ...x.fields, [k]: v } } : x))
  const remove = (id) => setRows(rs => rs.filter(x => x.id !== id))

  const createAll = async () => {
    const pending = rows.filter(r => !r.done)
    const invalid = pending.find(r => !r.fields.payee.trim() || !r.fields.amount)
    if (invalid) { toast('Every row needs a payee and amount', 'error'); return }
    setCreating(true)
    let ok = 0
    for (const row of pending) {
      try {
        const fd = new FormData()
        Object.entries(row.fields).forEach(([k, v]) => { if (v) fd.append(k, v) })
        fd.append(row.fields.is_reimbursement ? 'receipt_file' : 'invoice_file', row.file)
        await api.post('/ledger/entries', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        setRows(rs => rs.map(x => x.id === row.id ? { ...x, done: true } : x)); ok++
      } catch (err) {
        setRows(rs => rs.map(x => x.id === row.id ? { ...x, error: err.response?.data?.error || 'Failed' } : x))
      }
    }
    setCreating(false)
    toast(`Created ${ok} of ${pending.length}`)
  }

  const parsing = rows.some(r => r.parsing)
  const remaining = rows.filter(r => !r.done)

  return (
    <div>
      <PageHeader title="Bulk upload" subtitle="Drop many invoices — AI reads each, you review, then create them all"
        action={<Link to="/ledger" className="btn-secondary">Go to ledger →</Link>} />

      <div onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files) }}
        className="card border-2 border-dashed border-rule hover:border-brand-300 p-8 text-center cursor-pointer mb-5">
        <Upload size={26} className="text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-600">Click or drop invoice PDFs / images here</p>
        <p className="text-xs text-gray-400 mt-1">Each is parsed with AI; review before creating.</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,image/*" className="hidden" onChange={e => onFiles(e.target.files)} />
      </div>

      {rows.length > 0 && (
        <>
          <div className="card overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead><tr className="bg-page/50 border-b border-divider text-left">
                {['File', 'Payee', 'Amount', 'Cur.', 'Invoice #', 'Date', 'Category', 'Reimb.', ''].map(h => <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-divider">
                {rows.map(r => (
                  <tr key={r.id} className={r.done ? 'opacity-50' : ''}>
                    <td className="px-3 py-2 max-w-[160px]"><p className="truncate text-gray-600" title={r.file.name}>{r.file.name}</p>{r.error && <p className="text-[10px] text-red-500 inline-flex items-center gap-0.5"><AlertTriangle size={9} /> {r.error}</p>}</td>
                    {r.parsing ? (
                      <td colSpan={7} className="px-3 py-2 text-gray-400 text-xs"><Loader2 size={13} className="inline animate-spin mr-1" /> Reading…</td>
                    ) : (
                      <>
                        <td className="px-3 py-2"><input className="input !py-1 text-sm !w-36" value={r.fields.payee} onChange={e => setField(r.id, 'payee', e.target.value)} /></td>
                        <td className="px-3 py-2"><input type="number" step="0.01" className="input !py-1 text-sm !w-24" value={r.fields.amount} onChange={e => setField(r.id, 'amount', e.target.value)} /></td>
                        <td className="px-3 py-2"><select className="input !py-1 text-sm !w-20" value={r.fields.currency} onChange={e => setField(r.id, 'currency', e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></td>
                        <td className="px-3 py-2"><input className="input !py-1 text-sm !w-24" value={r.fields.invoice_number} onChange={e => setField(r.id, 'invoice_number', e.target.value)} /></td>
                        <td className="px-3 py-2"><input type="date" className="input !py-1 text-sm !w-36" value={r.fields.invoice_date} onChange={e => setField(r.id, 'invoice_date', e.target.value)} /></td>
                        <td className="px-3 py-2"><select className="input !py-1 text-sm !w-32" value={r.fields.category} onChange={e => setField(r.id, 'category', e.target.value)}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></td>
                        <td className="px-3 py-2 text-center"><input type="checkbox" checked={r.fields.is_reimbursement} onChange={e => setField(r.id, 'is_reimbursement', e.target.checked)} /></td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right">{r.done ? <Check size={15} className="text-emerald-600 inline" /> : <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-red-600"><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 inline-flex items-center gap-1"><Sparkles size={12} /> {parsing ? 'Parsing files…' : `${remaining.length} ready to create`}</p>
            <button onClick={createAll} disabled={creating || parsing || !remaining.length} className="btn-primary">{creating ? 'Creating…' : `Create ${remaining.length} entr${remaining.length === 1 ? 'y' : 'ies'}`}</button>
          </div>
        </>
      )}
    </div>
  )
}

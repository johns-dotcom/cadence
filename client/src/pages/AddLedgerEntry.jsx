import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

// One component, two pages: an invoice expense (needs a W9) or a
// reimbursement (needs a receipt). `mode` decides the labels + which
// document field shows, and is sent to the server as is_reimbursement.
export default function AddLedgerEntry({ mode = 'invoice' }) {
  const isReimb = mode === 'reimbursement'
  const { toast } = useToast()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [form, setForm] = useState({
    invoice_date: '', payee: '', description: '', category: '', artist: '',
    invoice_number: '', amount: '', currency: 'USD', payment_method: '', notes: '',
  })
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  // AI: extract fields from the attached invoice and prefill the form.
  const scanInvoice = async () => {
    if (!files.invoice_file) { toast('Attach a file first', 'error'); return }
    setScanning(true)
    try {
      const fd = new FormData(); fd.append('file', files.invoice_file)
      const { data } = await api.post('/ledger/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      setForm(f => ({
        ...f,
        payee: d.vendor_name || f.payee,
        amount: d.amount != null ? String(d.amount) : f.amount,
        currency: d.currency || f.currency,
        invoice_number: d.invoice_number || f.invoice_number,
        invoice_date: d.invoice_date || f.invoice_date,
        category: d.category || f.category,
        payment_method: d.payment_method || f.payment_method,
        description: d.description || f.description,
      }))
      toast('Scanned — review the prefilled fields')
    } catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning(false) }
  }

  const create = async (e) => {
    e.preventDefault()
    if (!form.payee.trim() || !form.amount) { toast(`${isReimb ? 'Pay-to' : 'Payee'} and amount are required`, 'error'); return }
    setSaving(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v) })
      if (isReimb) fd.append('is_reimbursement', 'true')
      Object.entries(files).forEach(([k, f]) => { if (f) fd.append(k, f) })
      await api.post('/ledger/entries', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast(isReimb ? 'Reimbursement added' : 'Invoice added')
      navigate('/ledger')
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add entry', 'error')
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate('/ledger')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-3"><ArrowLeft size={15} /> Back to ledger</button>
      <PageHeader
        title={isReimb ? 'Add reimbursement' : 'Add invoice'}
        subtitle={isReimb ? 'Reimburse an out-of-pocket expense — attach the receipt' : 'Record a vendor invoice — attach the invoice and W9'}
      />

      <form onSubmit={create} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="sm:col-span-2 lg:col-span-1"><label className="label">{isReimb ? 'Pay to' : 'Payee'}</label><input className="input" value={form.payee} onChange={set('payee')} autoFocus /></div>
        <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></div>
        <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">{isReimb ? 'Date' : 'Invoice date'}</label><input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} /></div>
        <div><label className="label">Category</label><select className="input" value={form.category} onChange={set('category')}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">Artist / project</label><input className="input" value={form.artist} onChange={set('artist')} /></div>
        {!isReimb && <div><label className="label">Invoice #</label><input className="input" value={form.invoice_number} onChange={set('invoice_number')} /></div>}
        <div><label className="label">Payment method</label><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="label">Description</label><input className="input" value={form.description} onChange={set('description')} placeholder={isReimb ? 'What was this expense for?' : ''} /></div>

        <div>
          <label className="label">{isReimb ? 'Invoice / backup (optional)' : 'Invoice file'}</label>
          <input type="file" className="input py-1.5" onChange={e => setFiles(f => ({ ...f, invoice_file: e.target.files[0] }))} />
          {files.invoice_file && <button type="button" onClick={scanInvoice} disabled={scanning} className="text-xs font-semibold text-brand-600 hover:underline mt-1 inline-flex items-center gap-1"><Sparkles size={12} /> {scanning ? 'Scanning…' : 'Scan & autofill'}</button>}
        </div>
        {isReimb ? (
          <div><label className="label">Receipt</label><input type="file" className="input py-1.5" onChange={e => setFiles(f => ({ ...f, receipt_file: e.target.files[0] }))} /></div>
        ) : (
          <div><label className="label">W9 (optional)</label><input type="file" className="input py-1.5" onChange={e => setFiles(f => ({ ...f, w9_file: e.target.files[0] }))} /></div>
        )}

        <div className="sm:col-span-2 lg:col-span-3 flex items-center justify-between pt-2 border-t border-divider">
          <button type="button" onClick={() => navigate('/ledger')} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : (isReimb ? 'Add reimbursement' : 'Add invoice')}</button>
        </div>
      </form>
    </div>
  )
}

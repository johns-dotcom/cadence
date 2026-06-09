import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Disc3, CheckCircle2, Upload } from 'lucide-react'
import api from '../api'
import { applyAccent } from '../utils/branding'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

// PUBLIC page — no auth. Vendors reach it at /submit/:slug. The label's
// name + branding are loaded from the public context endpoint.
export default function VendorSubmit() {
  const { slug } = useParams()
  const [ctx, setCtx] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = useState({
    vendor_name: '', vendor_email: '', vendor_address: '', vendor_bank: '',
    artist: '', category: '', invoice_number: '', payment_method: '',
    amount: '', currency: 'USD', rep: '', notes: '', is_reimbursement: 'no',
  })
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })

  useEffect(() => {
    api.get(`/vendor/${slug}`)
      .then(res => {
        setCtx(res.data.data)
        if (res.data.data?.accent_color) applyAccent(res.data.data.accent_color)
      })
      .catch(() => setNotFound(true))
  }, [slug])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const isReimb = form.is_reimbursement === 'yes'

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setSubmitting(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      if (files.invoice_file) fd.append('invoice_file', files.invoice_file)
      if (files.w9_file) fd.append('w9_file', files.w9_file)
      if (files.receipt_file) fd.append('receipt_file', files.receipt_file)
      await api.post(`/vendor/${slug}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setDone(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed. Please try again.')
    } finally { setSubmitting(false) }
  }

  if (notFound) return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="card p-8 text-center max-w-sm">
        <p className="text-sm text-gray-600">This vendor form link isn't valid. Please check with your contact for the correct link.</p>
      </div>
    </div>
  )

  if (!ctx) return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (done) return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="card p-10 text-center max-w-md">
        <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-4" />
        <h1 className="text-lg font-bold text-ink mb-2">Submission received</h1>
        <p className="text-sm text-gray-500">Thanks — {ctx.name} has your invoice and will be in touch. You can close this page.</p>
      </div>
    </div>
  )

  const Field = ({ label, children }) => (
    <div><label className="label">{label}</label>{children}</div>
  )

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Co-branded header — label leads, Cadence powers it */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-2">
            {ctx.logo_url
              ? <img src={ctx.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover bg-gray-100" />
              : <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center"><span className="text-white font-bold">{ctx.name?.charAt(0)?.toUpperCase()}</span></div>}
            <span className="text-2xl font-bold text-ink tracking-tight">{ctx.name}</span>
          </div>
          <p className="text-sm text-gray-500">Vendor invoice submission</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-ink mb-3">Your details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Legal / government name"><input className="input" value={form.vendor_name} onChange={set('vendor_name')} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.vendor_email} onChange={set('vendor_email')} /></Field>
              <Field label="Mailing address"><input className="input" value={form.vendor_address} onChange={set('vendor_address')} /></Field>
              <Field label="Bank name"><input className="input" value={form.vendor_bank} onChange={set('vendor_bank')} /></Field>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-bold text-ink mb-3">Invoice</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Artist / project"><input className="input" value={form.artist} onChange={set('artist')} /></Field>
              <Field label="Category">
                <select className="input" value={form.category} onChange={set('category')}>
                  <option value="">Select…</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Invoice number"><input className="input" value={form.invoice_number} onChange={set('invoice_number')} /></Field>
              <Field label="Preferred payment method">
                <select className="input" value={form.payment_method} onChange={set('payment_method')}>
                  <option value="">Select…</option>
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Amount"><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></Field>
              <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Your contact at the label (optional)"><input className="input" value={form.rep} onChange={set('rep')} /></Field>
              <Field label="Is this a reimbursement?">
                <select className="input" value={form.is_reimbursement} onChange={set('is_reimbursement')}>
                  <option value="no">No — standard invoice</option>
                  <option value="yes">Yes — reimbursement</option>
                </select>
              </Field>
            </div>
            <div className="mt-3"><Field label="Notes (optional)"><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></Field></div>
          </div>

          <div>
            <h2 className="text-sm font-bold text-ink mb-3">Documents</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Invoice file (required)"><input type="file" className="input py-2" onChange={e => setFiles(f => ({ ...f, invoice_file: e.target.files[0] }))} /></Field>
              {isReimb
                ? <Field label="Receipt (required)"><input type="file" className="input py-2" onChange={e => setFiles(f => ({ ...f, receipt_file: e.target.files[0] }))} /></Field>
                : <Field label="W9 / W8 form"><input type="file" className="input py-2" onChange={e => setFiles(f => ({ ...f, w9_file: e.target.files[0] }))} /></Field>}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-red-600 text-xs">{error}</p></div>}

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Submitting…' : <><Upload size={16} /> Submit invoice</>}
          </button>
        </form>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-gray-400">
          <Disc3 size={12} /> <span>Powered by Cadence</span>
        </div>
      </div>
    </div>
  )
}

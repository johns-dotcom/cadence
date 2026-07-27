import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Disc3, CheckCircle2, Upload, ArrowRight, ArrowLeft, ShieldCheck, AlertTriangle, Sparkles } from 'lucide-react'
import api from '../api'
import Dropzone from '../components/Dropzone'
import CcChipInput from '../components/CcChipInput'
import { applyAccent } from '../utils/branding'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const STEPS = ['Your info', 'Documents', 'Project info']
const BLANK = {
  vendor_name: '', vendor_email: '', vendor_address: '', vendor_bank: '',
  artist: '', category: '', invoice_number: '', payment_method: '',
  amount: '', currency: 'USD', rep: '', notes: '', socials: '', is_reimbursement: 'no',
}

// PUBLIC page — no auth. Reached at /submit/:token. Three-step wizard, branded
// per label. Draft autosaves to localStorage (files excluded) so a refresh
// doesn't lose typing.
export default function VendorSubmit() {
  const { slug } = useParams()
  const draftKey = `vendorform:${slug}`
  const [ctx, setCtx] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1)

  const [form, setForm] = useState(BLANK)
  const [extraEmails, setExtraEmails] = useState([])
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })
  const [w9OnFile, setW9OnFile] = useState(false)
  const [checking, setChecking] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [dupWarn, setDupWarn] = useState('')
  const [hasDraft, setHasDraft] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const isReimb = form.is_reimbursement === 'yes'

  useEffect(() => {
    api.get(`/vendor/${slug}`)
      .then(res => { setCtx(res.data.data); if (res.data.data?.accent_color) applyAccent(res.data.data.accent_color) })
      .catch(() => setNotFound(true))
    try { if (localStorage.getItem(draftKey)) setHasDraft(true) } catch { /* ignore */ }
  }, [slug])

  // Autosave draft (form fields only — never files).
  useEffect(() => {
    if (!ctx) return
    try { localStorage.setItem(draftKey, JSON.stringify({ form, extraEmails })) } catch { /* quota */ }
  }, [form, extraEmails, ctx]) // eslint-disable-line

  const resumeDraft = () => {
    try { const d = JSON.parse(localStorage.getItem(draftKey) || '{}'); if (d.form) setForm({ ...BLANK, ...d.form }); if (d.extraEmails) setExtraEmails(d.extraEmails) } catch { /* ignore */ }
    setHasDraft(false)
  }
  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } setHasDraft(false); setForm(BLANK); setExtraEmails([]) }

  const checkW9 = async () => {
    if (!form.vendor_name.trim()) { setW9OnFile(false); return }
    try { const { data } = await api.get(`/vendor/${slug}/w9-status`, { params: { name: form.vendor_name.trim() } }); setW9OnFile(!!data.data.on_file) }
    catch { setW9OnFile(false) }
  }

  const autofill = async () => {
    if (!files.invoice_file) return
    setAutofilling(true); setError('')
    try {
      const fd = new FormData(); fd.append('invoice_file', files.invoice_file)
      const { data } = await api.post(`/vendor/${slug}/parse-invoice`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      setForm(f => ({
        ...f,
        vendor_name: f.vendor_name || d.vendor_name || '',
        amount: d.amount != null ? String(d.amount) : f.amount,
        currency: d.currency || f.currency,
        invoice_number: f.invoice_number || d.invoice_number || '',
        category: f.category || d.category || '',
        payment_method: f.payment_method || d.payment_method || '',
        notes: f.notes || d.description || '',
      }))
    } catch { setError('Could not read the invoice — fill the fields manually.') }
    finally { setAutofilling(false) }
  }

  const checkDup = async () => {
    if (!form.invoice_number.trim() || (!form.vendor_email.trim() && !form.vendor_name.trim())) return
    try {
      const { data } = await api.get(`/vendor/${slug}/check-dup`, { params: { email: form.vendor_email, name: form.vendor_name, invoice_number: form.invoice_number, amount: form.amount } })
      setDupWarn(data.data.duplicate ? 'We may already have this invoice number from you — double-check before submitting.'
        : data.data.similar ? 'A submission with the same amount already exists — make sure this isn’t a duplicate.' : '')
    } catch { setDupWarn('') }
  }

  // Step 1 → 2 validation.
  const nextFromInfo = () => {
    setError('')
    if (!form.vendor_name.trim()) return setError('Please enter your legal / government name.')
    if (!form.vendor_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.vendor_email)) return setError('Please enter a valid email address.')
    if (!form.vendor_address.trim()) return setError('Please enter your mailing address.')
    if (!form.vendor_bank.trim()) return setError('Please enter your bank name.')
    if (!form.payment_method) return setError('Please select your preferred payment method.')
    setStep(2)
  }
  // Step 2 → 3 validation + invoice-number gate.
  const nextFromDocs = async () => {
    setError('')
    if (!files.invoice_file) return setError('Please upload your invoice file.')
    if (!form.invoice_number.trim()) return setError('Please enter your invoice number.')
    if (isReimb && !files.receipt_file) return setError('Please attach your supporting receipt.')
    if (!isReimb && !w9OnFile && !files.w9_file) return setError('Please upload your W9 / W8 form.')
    setChecking(true)
    try {
      const fd = new FormData(); fd.append('invoice_file', files.invoice_file); fd.append('invoice_number', form.invoice_number)
      const { data } = await api.post(`/vendor/${slug}/check-invoice-number`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (data.data.checked && !data.data.matches) { setError(`The invoice number you entered doesn’t match the document (${data.data.document_number}). Please correct it.`); setChecking(false); return }
    } catch { /* fails open */ }
    setChecking(false); checkDup(); setStep(3)
  }

  const submit = async (e) => {
    e.preventDefault(); setError(''); setSubmitting(true)
    if (!form.artist.trim()) { setError('Please enter the artist or project.'); setSubmitting(false); return }
    if (!form.category) { setError('Please select a category.'); setSubmitting(false); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('Please enter a valid amount.'); setSubmitting(false); return }
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append('extra_emails', JSON.stringify(extraEmails))
      if (files.invoice_file) fd.append('invoice_file', files.invoice_file)
      if (files.w9_file) fd.append('w9_file', files.w9_file)
      if (files.receipt_file) fd.append('receipt_file', files.receipt_file)
      await api.post(`/vendor/${slug}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      clearDraft(); setDone(true)
    } catch (err) { setError(err.response?.data?.error || 'Submission failed. Please try again.') }
    finally { setSubmitting(false) }
  }

  if (notFound) return <Center><p className="text-sm text-gray-600">This vendor form link isn’t valid. Please check with your contact for the correct link.</p></Center>
  if (!ctx) return <div className="min-h-screen bg-page flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" /></div>
  if (done) return (
    <Center>
      <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-4" />
      <h1 className="text-lg font-bold text-ink mb-2">Submission received</h1>
      <p className="text-sm text-gray-500">Thanks — {ctx.name} has your invoice and will be in touch. You can close this page.</p>
    </Center>
  )

  const Field = ({ label, children }) => <div><label className="label">{label}</label>{children}</div>

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-2">
            {ctx.logo_url ? <img src={ctx.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover bg-gray-100" />
              : <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center"><span className="text-white font-bold">{ctx.name?.charAt(0)?.toUpperCase()}</span></div>}
            <span className="text-2xl font-bold text-ink tracking-tight">{ctx.name}</span>
          </div>
          <p className="text-sm text-gray-500">Vendor invoice submission</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${step === i + 1 ? 'text-brand-600' : step > i + 1 ? 'text-emerald-600' : 'text-gray-400'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${step === i + 1 ? 'bg-brand-600 text-white' : step > i + 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100'}`}>{step > i + 1 ? '✓' : i + 1}</span>
                <span className="hidden sm:inline">{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-rule" />}
            </div>
          ))}
        </div>

        {hasDraft && step === 1 && (
          <div className="card px-4 py-2.5 mb-4 flex items-center justify-between gap-3 bg-brand-50/40 border-brand-200">
            <span className="text-xs text-gray-600">You have a saved draft.</span>
            <span className="flex gap-2"><button onClick={resumeDraft} className="text-xs font-semibold text-brand-600 hover:underline">Resume</button><button onClick={clearDraft} className="text-xs text-gray-400 hover:text-gray-600">Start fresh</button></span>
          </div>
        )}

        <div className="card p-6 space-y-5">
          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Legal / government name"><input className="input" value={form.vendor_name} onChange={set('vendor_name')} onBlur={checkW9} /></Field>
              <Field label="Email"><input type="email" className="input" value={form.vendor_email} onChange={set('vendor_email')} /></Field>
              <div className="sm:col-span-2"><label className="label">Additional emails (optional, up to 4 — CC'd on updates)</label><CcChipInput value={extraEmails} onChange={v => setExtraEmails(v.slice(0, 4))} placeholder="add@email.com" /></div>
              <Field label="Preferred payment method"><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">Select…</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Bank name"><input className="input" value={form.vendor_bank} onChange={set('vendor_bank')} /></Field>
              <div className="sm:col-span-2"><Field label="Mailing address"><input className="input" value={form.vendor_address} onChange={set('vendor_address')} /></Field></div>
              {w9OnFile && <p className="sm:col-span-2 text-xs text-emerald-600 inline-flex items-center gap-1"><ShieldCheck size={13} /> We already have your W9 on file — you can skip it in the next step.</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="Is this a reimbursement?">
                <select className="input" value={form.is_reimbursement} onChange={set('is_reimbursement')}><option value="no">No — standard invoice</option><option value="yes">Yes — reimbursement</option></select>
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Invoice number"><input className="input" value={form.invoice_number} onChange={set('invoice_number')} /></Field>
                <div />
                <Field label="Invoice file (required)">
                  <Dropzone value={files.invoice_file} onChange={file => setFiles(f => ({ ...f, invoice_file: file }))} required />
                  {files.invoice_file && <button type="button" onClick={autofill} disabled={autofilling} className="text-xs font-semibold text-brand-600 hover:underline mt-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> {autofilling ? 'Reading…' : 'Auto-fill from invoice'}</button>}
                </Field>
                {isReimb
                  ? <Field label="Receipt (required)"><Dropzone value={files.receipt_file} onChange={file => setFiles(f => ({ ...f, receipt_file: file }))} required /></Field>
                  : <Field label={w9OnFile ? 'W9 / W8 (on file — optional)' : 'W9 / W8 form (required)'}><Dropzone value={files.w9_file} onChange={file => setFiles(f => ({ ...f, w9_file: file }))} /></Field>}
              </div>
              <p className="text-[11px] text-gray-400">The invoice number you enter is checked against your uploaded document before you continue.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {dupWarn && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> {dupWarn}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Artist / project"><input className="input" value={form.artist} onChange={set('artist')} /></Field>
                <Field label="Song (optional)"><input className="input" value={form.song || ''} onChange={set('song')} /></Field>
                <Field label="Category"><select className="input" value={form.category} onChange={set('category')}><option value="">Select…</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Your contact at the label">
                  {ctx.reps?.length
                    ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">Select…</option>{ctx.reps.map(r => <option key={r}>{r}</option>)}</select>
                    : <input className="input" value={form.rep} onChange={set('rep')} />}
                </Field>
                <Field label="Amount"><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></Field>
                <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
                <div className="sm:col-span-2"><Field label="Social links (optional)"><input className="input" value={form.socials} onChange={set('socials')} placeholder="@handles / links relevant to this spend" /></Field></div>
                <div className="sm:col-span-2"><Field label="Notes (optional)"><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></Field></div>
              </div>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-red-600 text-xs">{error}</p></div>}

          {/* Nav */}
          <div className="flex items-center justify-between pt-1">
            {step > 1 ? <button type="button" onClick={() => { setError(''); setStep(step - 1) }} className="btn-secondary"><ArrowLeft size={15} /> Back</button> : <span />}
            {step === 1 && <button type="button" onClick={nextFromInfo} className="btn-primary">Next <ArrowRight size={15} /></button>}
            {step === 2 && <button type="button" onClick={nextFromDocs} disabled={checking} className="btn-primary">{checking ? 'Checking…' : <>Next <ArrowRight size={15} /></>}</button>}
            {step === 3 && <button type="button" onClick={submit} disabled={submitting} className="btn-primary">{submitting ? 'Submitting…' : <><Upload size={16} /> Submit invoice</>}</button>}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-gray-400"><Disc3 size={12} /> <span>Powered by Cadence</span></div>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div className="min-h-screen bg-page flex items-center justify-center p-4"><div className="card p-10 text-center max-w-md">{children}</div></div>
}

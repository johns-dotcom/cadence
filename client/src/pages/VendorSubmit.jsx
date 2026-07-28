import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Disc3, CheckCircle2, Upload, ArrowRight, ArrowLeft, ShieldCheck, AlertTriangle, Sparkles, Plus, X, Trash2 } from 'lucide-react'
import api from '../api'
import Dropzone from '../components/Dropzone'
import CcChipInput from '../components/CcChipInput'
import { applyAccent } from '../utils/branding'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const STEPS = ['Your info', 'Documents', 'Project info']
const BLANK = {
  vendor_name: '', vendor_email: '', vendor_address: '', vendor_bank: '',
  category: '', invoice_number: '', payment_method: '',
  amount: '', currency: 'USD', rep: '', description: '', is_reimbursement: 'no',
}
const BLANK_SPLIT = () => ({ artist: '', song: '', amount: '', socials: [] })

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
  const [splits, setSplits] = useState([BLANK_SPLIT()])
  const [extraEmails, setExtraEmails] = useState([])
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })
  const [w9OnFile, setW9OnFile] = useState(false)
  const [checking, setChecking] = useState(false)
  const [autofilling, setAutofilling] = useState(false)
  const [dupWarn, setDupWarn] = useState('')
  const [hasDraft, setHasDraft] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const isReimb = form.is_reimbursement === 'yes'

  // ── Artist allocation (split the invoice across artists) ──
  const updSplit = (i, patch) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  const splitField = (i) => (field, value) => updSplit(i, { [field]: value })
  const addArtist = () => setSplits(s => [...s, BLANK_SPLIT()])
  const removeArtist = (i) => setSplits(s => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s))
  const addSocial = (i) => () => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: [...l.socials, { handle: '', amount: '' }] } : l))
  const updSocial = (i) => (sIdx, field, value) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.map((so, j) => j === sIdx ? { ...so, [field]: value } : so) } : l))
  const removeSocial = (i) => (sIdx) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.filter((_, j) => j !== sIdx) } : l))

  const total = parseFloat(form.amount) || 0
  const allocated = splits.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)
  const multi = splits.length > 1

  useEffect(() => {
    api.get(`/vendor/${slug}`)
      .then(res => { setCtx(res.data.data); if (res.data.data?.accent_color) applyAccent(res.data.data.accent_color) })
      .catch(() => setNotFound(true))
    try { if (localStorage.getItem(draftKey)) setHasDraft(true) } catch { /* ignore */ }
  }, [slug])

  // Autosave draft (form fields only — never files).
  useEffect(() => {
    if (!ctx) return
    try { localStorage.setItem(draftKey, JSON.stringify({ form, extraEmails, splits })) } catch { /* quota */ }
  }, [form, extraEmails, splits, ctx]) // eslint-disable-line

  const resumeDraft = () => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || '{}')
      if (d.form) setForm({ ...BLANK, ...d.form })
      if (d.extraEmails) setExtraEmails(d.extraEmails)
      if (Array.isArray(d.splits) && d.splits.length) setSplits(d.splits.map(l => ({ ...BLANK_SPLIT(), ...l, socials: l.socials || [] })))
    } catch { /* ignore */ }
    setHasDraft(false)
  }
  const clearDraft = () => { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } setHasDraft(false); setForm(BLANK); setExtraEmails([]); setSplits([BLANK_SPLIT()]) }

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
        description: f.description || d.description || '',
      }))
    } catch { setError('Could not read the invoice — fill the fields manually.') }
    finally { setAutofilling(false) }
  }
  // Auto-parse the moment an invoice is chosen (with a manual retry button too).
  const onInvoiceFile = (file) => {
    setFiles(f => ({ ...f, invoice_file: file }))
    if (file) setTimeout(() => autofillFrom(file), 0)
  }
  const autofillFrom = async (file) => {
    setAutofilling(true); setError('')
    try {
      const fd = new FormData(); fd.append('invoice_file', file)
      const { data } = await api.post(`/vendor/${slug}/parse-invoice`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      setForm(f => ({
        ...f,
        vendor_name: f.vendor_name || d.vendor_name || '',
        amount: f.amount || (d.amount != null ? String(d.amount) : ''),
        currency: d.currency || f.currency,
        invoice_number: f.invoice_number || d.invoice_number || '',
        category: f.category || d.category || '',
        payment_method: f.payment_method || d.payment_method || '',
        description: f.description || d.description || '',
      }))
    } catch { /* silent on auto — the manual button surfaces errors */ }
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
    e.preventDefault(); setError('')
    const cleanSplits = splits
      .map(l => ({
        artist: (l.artist || '').trim(), song: (l.song || '').trim(), amount: parseFloat(l.amount) || 0,
        socials: (l.socials || []).map(s => ({ handle: (s.handle || '').trim(), amount: parseFloat(s.amount) || 0 })).filter(s => s.handle),
      }))
      .filter(l => l.artist)
    if (!cleanSplits.length) return setError('Please enter at least one artist / project.')
    if (!form.category) return setError('Please select a category.')
    if (!total || total <= 0) return setError('Please enter a valid invoice amount.')
    // One artist with no amount → allocate the whole invoice to them.
    if (cleanSplits.length === 1 && !cleanSplits[0].amount) cleanSplits[0].amount = total
    const sum = cleanSplits.reduce((a, l) => a + l.amount, 0)
    if (Math.abs(sum - total) > 0.01) return setError(`Your artist split (${sum.toFixed(2)}) must add up to the invoice total (${total.toFixed(2)} ${form.currency}).`)

    setSubmitting(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      // Primary/legacy fields for compatibility + the full breakdown.
      fd.append('artist', cleanSplits[0].artist)
      fd.append('song', cleanSplits[0].song)
      fd.append('socials', cleanSplits.flatMap(l => l.socials.map(s => s.handle)).join(', '))
      fd.append('splits', JSON.stringify(cleanSplits))
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

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-2">
            {ctx.logo_url ? <img src={ctx.logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-gray-100 p-0.5" />
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
                  <Dropzone value={files.invoice_file} onChange={onInvoiceFile} required />
                  {files.invoice_file && <button type="button" onClick={autofill} disabled={autofilling} className="text-xs font-semibold text-brand-600 hover:underline mt-1.5 inline-flex items-center gap-1"><Sparkles size={12} /> {autofilling ? 'Reading…' : 'Re-read from invoice'}</button>}
                  {autofilling && <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1"><Sparkles size={11} className="animate-pulse" /> Reading your invoice…</p>}
                </Field>
                {isReimb
                  ? <Field label="Receipt (required)"><Dropzone value={files.receipt_file} onChange={file => setFiles(f => ({ ...f, receipt_file: file }))} required /></Field>
                  : <Field label={w9OnFile ? 'W9 / W8 (on file — optional)' : 'W9 / W8 form (required)'}><Dropzone value={files.w9_file} onChange={file => setFiles(f => ({ ...f, w9_file: file }))} /></Field>}
              </div>
              <p className="text-[11px] text-gray-400">The invoice number you enter is checked against your uploaded document before you continue.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {dupWarn && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 inline-flex items-center gap-1.5"><AlertTriangle size={13} /> {dupWarn}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Category"><select className="input" value={form.category} onChange={set('category')}><option value="">Select…</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Your contact at the label">
                  {ctx.reps?.length
                    ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">Select…</option>{ctx.reps.map(r => <option key={r}>{r}</option>)}</select>
                    : <input className="input" value={form.rep} onChange={set('rep')} />}
                </Field>
                <Field label="Invoice total"><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></Field>
                <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
              </div>

              {/* Artist allocation */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label !mb-0">Artist{multi ? 's' : ''} &amp; allocation</label>
                  {(multi || splits.some(l => l.amount)) && (
                    <span className={`text-[11px] font-semibold ${total > 0 && Math.abs(total - allocated) < 0.01 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      Allocated {allocated.toFixed(2)} / {total.toFixed(2)} {form.currency}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {splits.map((l, i) => (
                    <SplitLine key={i} index={i} line={l} multi={multi}
                      onField={splitField(i)} onSocial={updSocial(i)} addSocial={addSocial(i)} removeSocial={removeSocial(i)}
                      onRemove={() => removeArtist(i)} canRemove={splits.length > 1} />
                  ))}
                </div>
                <button type="button" onClick={addArtist} className="text-xs font-semibold text-brand-600 hover:underline mt-2 inline-flex items-center gap-1"><Plus size={13} /> Add another artist</button>
                <p className="text-[11px] text-gray-400 mt-1">Split the invoice across artists and, optionally, attach socials (with amounts) to each.</p>
              </div>

              <Field label="Description (optional)"><textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder="What this invoice is for" /></Field>
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

// Module-scope so its identity is stable across renders — defining it inside
// the component remounts every input on each keystroke and drops focus.
function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

// One artist allocation line: artist / song / amount + a socials sub-list
// (each social with an optional amount). Module-scope for stable focus.
function SplitLine({ line, index, multi, onField, onSocial, addSocial, removeSocial, onRemove, canRemove }) {
  return (
    <div className="rounded-xl border border-rule p-3 bg-page/30">
      {multi && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Artist {index + 1}</span>
          {canRemove && <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className="label">Artist / project</label><input className="input" value={line.artist} onChange={e => onField('artist', e.target.value)} /></div>
        <div><label className="label">Song (optional)</label><input className="input" value={line.song} onChange={e => onField('song', e.target.value)} /></div>
        <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={line.amount} onChange={e => onField('amount', e.target.value)} placeholder={multi ? '' : 'full invoice'} /></div>
      </div>
      <div className="mt-2 pl-0.5">
        {line.socials.map((s, si) => (
          <div key={si} className="flex items-center gap-2 mb-1.5">
            <input className="input !py-1.5 text-sm flex-1" value={s.handle} onChange={e => onSocial(si, 'handle', e.target.value)} placeholder="@handle / link" />
            <input type="number" step="0.01" className="input !py-1.5 text-sm !w-28" value={s.amount} onChange={e => onSocial(si, 'amount', e.target.value)} placeholder="amount" />
            <button type="button" onClick={() => removeSocial(si)} className="text-gray-300 hover:text-red-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add social</button>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div className="min-h-screen bg-page flex items-center justify-center p-4"><div className="card p-10 text-center max-w-md">{children}</div></div>
}

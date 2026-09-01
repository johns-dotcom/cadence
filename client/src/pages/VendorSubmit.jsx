import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Disc3, CheckCircle2, Upload, ArrowRight, ArrowLeft, ShieldCheck, ShieldAlert, AlertTriangle, Sparkles, Plus, X, Trash2, Info, CreditCard } from 'lucide-react'
import api from '../api'
import Dropzone from '../components/Dropzone'
import CcChipInput from '../components/CcChipInput'
import { applyAccent } from '../utils/branding'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

const STEPS = ['Your info', 'Documents', 'Project info']
// The three methods the vault supports — the SERVER's lib/paymentFields.js is
// the authority; this mirror exists so the vendor is told before they press a
// button rather than by a 400 afterwards.
const FORM_METHODS = ['ACH', 'Wire', 'PayPal']
const BLANK = {
  vendor_name: '', vendor_email: '', vendor_address: '',
  category: '', invoice_number: '', payment_method: '',
  amount: '', currency: 'USD', rep: '', description: '', is_reimbursement: 'no',
}
const BLANK_PAY = {
  account: '', routing: '', account_type: '', holder: '', bank_name: '', bank_address: '',
  wire_scope: '', iban_swift: '', beneficiary_address: '', intermediary_bank: '', paypal: '',
}
const BLANK_SPLIT = () => ({ artist: '', song: '', amount: '', socials: [] })

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
const looksLikeSwiftOnly = (v) => {
  const s = String(v || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s) && !/^[A-Z]{2}[0-9]{2}/.test(s)
}
const dstr = (d) => String(d || '').slice(0, 10)

// Which payment fields this method still needs — client mirror of the server's
// validatePaymentFields required set. When the two disagree the server wins.
function payMissing(method, pay, reusing) {
  if (reusing) return []
  const m = []
  if (method === 'ACH') {
    if (!pay.account.trim()) m.push('account number')
    if (!pay.routing.trim()) m.push('routing number')
    if (!pay.account_type) m.push('account type')
    if (!pay.holder.trim()) m.push('name on the account')
    if (!pay.bank_name.trim()) m.push('bank name')
    if (!pay.bank_address.trim()) m.push('bank address')
  } else if (method === 'Wire') {
    if (!pay.wire_scope) m.push('whether your bank is in the US or outside it')
    else if (pay.wire_scope === 'Domestic') {
      if (!pay.routing.trim()) m.push('routing number')
      if (!pay.account.trim()) m.push('account number')
      if (!pay.holder.trim()) m.push('name on the account')
      if (!pay.bank_name.trim()) m.push('bank name')
    } else {
      if (!pay.iban_swift.trim()) m.push('IBAN or SWIFT/BIC')
      if (looksLikeSwiftOnly(pay.iban_swift) && !pay.account.trim()) m.push('account number')
      if (!pay.holder.trim()) m.push('name on the account')
      if (!pay.bank_name.trim()) m.push('bank name')
      if (!pay.bank_address.trim()) m.push('bank address')
      if (!pay.beneficiary_address.trim()) m.push('beneficiary address')
    }
  } else if (method === 'PayPal') {
    if (!pay.paypal.trim()) m.push('PayPal email or handle')
  }
  return m
}

// PUBLIC page — no auth. Reached at /submit/:token. Three-step wizard, branded
// per label. Draft autosaves to localStorage (files + sensitive payment numbers
// excluded) so a refresh doesn't lose typing.
export default function VendorSubmit() {
  const { slug } = useParams()
  const draftKey = `vendorform:${slug}`
  const [ctx, setCtx] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone] = useState(null) // { scheduled_payment_date } when submitted
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1)

  const [form, setForm] = useState(BLANK)
  const [pay, setPay] = useState(BLANK_PAY)
  const [payOnFile, setPayOnFile] = useState(null)
  const [payReuse, setPayReuse] = useState(false)
  const [splits, setSplits] = useState([BLANK_SPLIT()])
  const [noSocials, setNoSocials] = useState(false)
  const [extraEmails, setExtraEmails] = useState([])
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, receipt_file: null })
  const [roster, setRoster] = useState([])
  const [w9OnFile, setW9OnFile] = useState(false)
  const [w9Check, setW9Check] = useState({ status: 'idle' })
  const [checking, setChecking] = useState(false)
  const [dupWarn, setDupWarn] = useState(false)
  const [similar, setSimilar] = useState(null)
  const [aiPrefilled, setAiPrefilled] = useState(null)
  const [hasDraft, setHasDraft] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const setP = (k) => (e) => setPay(p => ({ ...p, [k]: e.target.value }))
  const isReimb = form.is_reimbursement === 'yes'
  const reusing = !!(payOnFile?.on_file && payOnFile.reusable && payReuse)

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
    api.get(`/vendor/${slug}/roster`).then(r => setRoster(r.data.data || [])).catch(() => {})
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (d && d.savedAt) setHasDraft(true)
    } catch { /* ignore */ }
  }, [slug]) // eslint-disable-line

  // Autosave draft — only once there is something worth keeping, and PAUSED
  // while the resume banner is showing so the blank form can't clobber the
  // stored draft before the vendor clicks Resume. Files and sensitive payment
  // numbers (account / routing / IBAN) are never written to localStorage.
  const meaningful = form.vendor_name.trim() || form.vendor_email.trim() || form.invoice_number.trim()
    || form.amount || splits.some(l => l.artist.trim() || l.song.trim())
  useEffect(() => {
    if (!ctx || hasDraft || !meaningful) return
    const safePay = { ...pay, account: '', routing: '', iban_swift: '' }
    try { localStorage.setItem(draftKey, JSON.stringify({ form, extraEmails, splits, pay: safePay, noSocials, savedAt: Date.now() })) } catch { /* quota */ }
  }, [form, extraEmails, splits, pay, noSocials, ctx, hasDraft]) // eslint-disable-line

  const resumeDraft = () => {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || '{}')
      if (d.form) setForm({ ...BLANK, ...d.form })
      if (d.pay) setPay({ ...BLANK_PAY, ...d.pay })
      if (d.extraEmails) setExtraEmails(d.extraEmails)
      if (d.noSocials) setNoSocials(true)
      if (Array.isArray(d.splits) && d.splits.length) setSplits(d.splits.map(l => ({ ...BLANK_SPLIT(), ...l, socials: l.socials || [] })))
    } catch { /* ignore */ }
    setHasDraft(false)
  }
  const clearDraft = () => {
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    setHasDraft(false); setForm(BLANK); setPay(BLANK_PAY); setExtraEmails([]); setSplits([BLANK_SPLIT()]); setNoSocials(false)
  }

  // Live W9-on-file check — debounced as you type (min 3 chars).
  useEffect(() => {
    const name = form.vendor_name.trim()
    if (name.length < 3) { setW9OnFile(false); return }
    const t = setTimeout(async () => {
      try { const { data } = await api.get(`/vendor/${slug}/w9-status`, { params: { name } }); setW9OnFile(!!data.data.on_file) }
      catch { setW9OnFile(false) }
    }, 500)
    return () => clearTimeout(t)
  }, [form.vendor_name, slug])

  // Do we already hold payment details / contact info for this email? Debounced,
  // and email-EXACT — the server matches nothing weaker, because a name
  // collision that showed one vendor another's bank details is not a mistake
  // worth risking for convenience.
  useEffect(() => {
    const email = form.vendor_email.trim()
    if (!isValidEmail(email)) { setPayOnFile(null); setPayReuse(false); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/vendor/${slug}/payment-on-file`, { params: { email } })
        if (cancelled) return
        const d = data.data
        setPayOnFile(d?.on_file ? d : null)
        // Pre-selected, but the vendor still has to look at it — the panel says
        // "still correct?" rather than quietly reusing an account.
        if (d?.on_file && d.reusable) { setPayReuse(true); if (d.method) setForm(f => ({ ...f, payment_method: d.method })) }
      } catch { /* they type their details, which is fine */ }
      try {
        const { data } = await api.get(`/vendor/${slug}/lookup`, { params: { email } })
        if (cancelled || !data.data?.found) return
        setForm(f => ({
          ...f,
          vendor_name: f.vendor_name || data.data.vendor_name || '',
          vendor_address: f.vendor_address || data.data.vendor_address || '',
          payment_method: f.payment_method || (FORM_METHODS.includes(data.data.payment_method) ? data.data.payment_method : ''),
        }))
      } catch { /* prefill is a convenience */ }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.vendor_email, slug])

  // Live duplicate advisory while typing the invoice number on step 2 —
  // NON-blocking by design: normalized numbers collapse "001"/"1"/"INV-" so a
  // hard block would lock out vendors whose numbering restarts each year.
  useEffect(() => {
    if (step !== 2) return
    const num = form.invoice_number.trim()
    if (!num || (!form.vendor_email.trim() && !form.vendor_name.trim())) { setDupWarn(false); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/vendor/${slug}/check-dup`, { params: { email: form.vendor_email, name: form.vendor_name, invoice_number: num } })
        setDupWarn(!!data.data.duplicate)
      } catch { setDupWarn(false) }
    }, 600)
    return () => clearTimeout(t)
  }, [form.invoice_number, form.vendor_email, form.vendor_name, step, slug])

  // Pre-submit W9 sanity check the moment the file is chosen: signed? right
  // name? A definitively unsigned form blocks step 2; AI-off falls open.
  const onW9File = async (file) => {
    setFiles(f => ({ ...f, w9_file: file }))
    if (!file) { setW9Check({ status: 'idle' }); return }
    setW9Check({ status: 'checking' })
    try {
      const fd = new FormData(); fd.append('w9_file', file); fd.append('vendor_name', form.vendor_name)
      const { data } = await api.post(`/vendor/${slug}/validate-w9`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      if (!d.checked) setW9Check({ status: 'idle' })
      else if (!d.valid) setW9Check({ status: 'unsigned', info: d })
      else if (d.name_matches === false) setW9Check({ status: 'warn', info: d })
      else setW9Check({ status: 'ok', info: d })
    } catch { setW9Check({ status: 'idle' }) }
  }

  // Step 1 → 2 validation.
  const missingPay = payMissing(form.payment_method, pay, reusing)
  const nextFromInfo = () => {
    setError('')
    if (!form.vendor_name.trim()) return setError('Please enter your legal / government name.')
    if (!form.vendor_email.trim() || !isValidEmail(form.vendor_email)) return setError('Please enter a valid email address.')
    if (!form.payment_method) return setError('Please select your preferred payment method.')
    if (missingPay.length) return setError(`Still needed so we can pay you: ${missingPay.join(', ')}.`)
    setStep(2)
  }

  // Apply the AI prefill from the step-2 parse, only into empty fields, and
  // remember what it touched so step 3 can ask the vendor to verify it.
  const applyPrefill = (d) => {
    if (!d) return
    const filled = {}
    setForm(f => {
      const next = { ...f }
      if (!f.amount && d.amount != null) { next.amount = String(d.amount); filled.amount = d.amount }
      if (d.currency && CURRENCIES.includes(d.currency)) { next.currency = d.currency; filled.currency = d.currency }
      const cats = ctx?.categories?.length ? ctx.categories : EXPENSE_CATEGORIES
      if (!f.category && d.category && cats.includes(d.category)) { next.category = d.category; filled.category = d.category }
      if (!f.description && d.description) { next.description = d.description; filled.description = d.description }
      return next
    })
    setAiPrefilled(Object.keys(filled).length ? filled : null)
  }

  // Step 2 → 3: gates + ONE AI parse. The same server call verifies the entered
  // invoice number against the document (blocking on mismatch or a numberless
  // document) and returns the parsed fields for prefill — one paid call instead
  // of the old three.
  const nextFromDocs = async () => {
    setError('')
    if (!files.invoice_file) return setError('Please upload your invoice file.')
    if (!form.invoice_number.trim()) return setError('Please enter your invoice number.')
    if (isReimb && !files.receipt_file) return setError('Please attach your supporting receipt.')
    if (!isReimb && !w9OnFile && !files.w9_file) return setError('Please upload your W9 / W8 form.')
    if (w9Check.status === 'unsigned') return setError('Your W9 / W8 appears to be unsigned. Please sign and date it, then re-upload.')
    setChecking(true)
    let parsedAmount = null
    try {
      const fd = new FormData(); fd.append('invoice_file', files.invoice_file); fd.append('invoice_number', form.invoice_number)
      const { data } = await api.post(`/vendor/${slug}/check-invoice-number`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      if (d.checked && d.document_missing_number) { setChecking(false); return setError('Your uploaded invoice doesn’t include an invoice number. Please add one to the document and re-upload.') }
      if (d.checked && !d.matches) { setChecking(false); return setError(`The invoice number you entered doesn’t match the document (${d.document_number}). Please correct one of them.`) }
      if (d.parsed) { applyPrefill(d.parsed); parsedAmount = d.parsed.amount }
    } catch { /* fails open */ }
    // Similar-amount advisory (30-day window, same currency) with details.
    try {
      const amt = parsedAmount != null ? parsedAmount : form.amount
      const { data } = await api.get(`/vendor/${slug}/check-dup`, {
        params: { email: form.vendor_email, name: form.vendor_name, invoice_number: form.invoice_number, amount: amt, currency: form.currency },
      })
      setSimilar(data.data.similar || null)
    } catch { setSimilar(null) }
    setChecking(false)
    setStep(3)
  }

  // Everything step 3 still needs, named — so the vendor finds out before they
  // press the button rather than by a 400 that reports one problem at a time.
  const step3Missing = (() => {
    const m = []
    const named = splits.filter(l => l.artist.trim())
    if (!named.length) m.push('an artist or project')
    else if (named.some(l => !l.song.trim())) m.push('a song / track for every artist row')
    if (!total || total <= 0) m.push('the invoice total')
    if (!form.category) m.push('a category')
    if (ctx?.reps?.length && !form.rep) m.push('your contact at the label')
    if (!noSocials && !splits.some(l => l.socials.some(s => s.handle.trim()))) m.push('a social handle (or check "no social media")')
    return m
  })()

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (step3Missing.length) return setError(`Still needed before you can submit: ${step3Missing.join(' · ')}`)
    const rosterSet = new Set(roster.map(n => n.toLowerCase()))
    const cleanSplits = splits
      .map(l => ({
        artist: l.artist.trim(), song: l.song.trim(), amount: parseFloat(l.amount) || 0,
        off_roster: !!l.artist.trim() && !rosterSet.has(l.artist.trim().toLowerCase()),
        socials: (l.socials || []).map(s => ({ handle: (s.handle || '').trim(), amount: parseFloat(s.amount) || 0 })).filter(s => s.handle),
      }))
      .filter(l => l.artist)
    // One artist with no amount → allocate the whole invoice to them.
    if (cleanSplits.length === 1 && !cleanSplits[0].amount) cleanSplits[0].amount = total
    const sum = cleanSplits.reduce((a, l) => a + l.amount, 0)
    if (Math.abs(sum - total) > 0.01) return setError(`Your artist split (${sum.toFixed(2)}) must add up to the invoice total (${total.toFixed(2)} ${form.currency}).`)

    setSubmitting(true)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append('splits', JSON.stringify(cleanSplits))
      fd.append('extra_emails', JSON.stringify(extraEmails))
      if (noSocials) fd.append('no_socials', 'true')
      // Payment coordinates. When the vendor confirmed what we already hold,
      // the fields stay home on purpose — the server reads its stored record.
      if (reusing) fd.append('payment_reuse_on_file', 'true')
      else {
        fd.append('payment_account_number', pay.account)
        fd.append('payment_routing_number', pay.routing)
        fd.append('payment_account_type', pay.account_type)
        fd.append('payment_holder_name', pay.holder)
        fd.append('payment_bank_name', pay.bank_name)
        fd.append('payment_bank_address', pay.bank_address)
        fd.append('payment_wire_scope', pay.wire_scope)
        fd.append('payment_iban_swift', pay.iban_swift)
        fd.append('payment_beneficiary_address', pay.beneficiary_address)
        fd.append('payment_intermediary_bank', pay.intermediary_bank)
        fd.append('payment_paypal', pay.paypal)
      }
      if (files.invoice_file) fd.append('invoice_file', files.invoice_file)
      if (files.w9_file) fd.append('w9_file', files.w9_file)
      if (files.receipt_file) fd.append('receipt_file', files.receipt_file)
      const { data } = await api.post(`/vendor/${slug}/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
      setDone(data.data || {})
    } catch (err) { setError(err.response?.data?.error || 'Submission failed. Please try again.') }
    finally { setSubmitting(false) }
  }

  // "Submit Another": contact + payment info stay, documents + project reset.
  const submitAnother = () => {
    setDone(null); setError(''); setStep(2)
    setForm(f => ({ ...f, invoice_number: '', amount: '', description: '' }))
    setSplits([BLANK_SPLIT()]); setNoSocials(false)
    setFiles({ invoice_file: null, w9_file: null, receipt_file: null })
    setW9Check({ status: 'idle' }); setDupWarn(false); setSimilar(null); setAiPrefilled(null)
  }

  if (notFound) return <Center><p className="text-sm text-ink-muted">This vendor form link isn’t valid. Please check with your contact for the correct link.</p></Center>
  if (!ctx) return <div className="min-h-screen bg-page flex items-center justify-center"><div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" /></div>
  if (done) return (
    <Center>
      <CheckCircle2 size={40} className="text-success mx-auto mb-4" />
      <h1 className="text-lg font-bold text-ink mb-2">{isReimb ? 'Reimbursement received' : 'Invoice received'}</h1>
      <p className="text-sm text-ink-muted mb-1.5">Thanks — {ctx.name} has your {isReimb ? 'reimbursement request' : 'invoice'} and will review it shortly.</p>
      {done.scheduled_payment_date && (
        <p className="text-sm text-ink-muted mb-4">Our standard terms are <span className="font-semibold text-ink">{done.payment_terms || 'Net 30'}</span> — payment on or around <span className="font-semibold text-ink">{dstr(done.scheduled_payment_date)}</span>.</p>
      )}
      <button onClick={submitAnother} className="btn-secondary mx-auto">Submit another invoice</button>
    </Center>
  )

  return (
    <div className="min-h-screen bg-page py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-2.5 mb-2">
            {ctx.logo_url ? <img src={ctx.logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-page p-0.5" />
              : <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center"><span className="text-white font-bold">{ctx.name?.charAt(0)?.toUpperCase()}</span></div>}
            <span className="text-2xl font-bold text-ink tracking-tight">{ctx.name}</span>
          </div>
          <p className="text-sm text-ink-muted">{isReimb ? 'Reimbursement request' : 'Vendor invoice submission'}</p>
        </div>

        {/* Mode toggle — top-level, not buried in a step */}
        <div className="flex justify-center gap-1.5 mb-4">
          {[['no', 'Invoice'], ['yes', 'Reimbursement']].map(([v, lbl]) => (
            <button key={v} type="button" onClick={() => setForm(f => ({ ...f, is_reimbursement: v }))}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${form.is_reimbursement === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-card text-ink-muted border-rule hover:text-ink'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${step === i + 1 ? 'text-brand-ink' : step > i + 1 ? 'text-success' : 'text-ink-faint'}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${step === i + 1 ? 'bg-brand-600 text-white' : step > i + 1 ? 'bg-brand-500/15 text-brand-ink' : 'bg-page border border-rule'}`}>{step > i + 1 ? '✓' : i + 1}</span>
                <span className="hidden sm:inline">{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-rule" />}
            </div>
          ))}
        </div>

        {hasDraft && step === 1 && (
          <div className="card px-4 py-2.5 mb-4 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-muted">You have a saved draft.</span>
            <span className="flex gap-2"><button onClick={resumeDraft} className="text-xs font-semibold text-brand-ink hover:underline">Resume</button><button onClick={clearDraft} className="text-xs text-ink-faint hover:text-ink">Start fresh</button></span>
          </div>
        )}

        <div className="card p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Legal / government name *"><input className="input" value={form.vendor_name} onChange={set('vendor_name')} placeholder="Must match your W9 / W8" /></Field>
                <Field label={isReimb ? 'Email *' : 'Email * — for 1099'}>
                  <input type="email" className="input" value={form.vendor_email} onChange={set('vendor_email')} />
                  {form.vendor_email.trim() && !isValidEmail(form.vendor_email) && <p className="text-[11px] text-danger mt-1">Please enter a valid email address.</p>}
                </Field>
                <div className="sm:col-span-2"><label className="label">Additional emails (optional, up to 4 — CC'd on updates)</label><CcChipInput value={extraEmails} onChange={v => setExtraEmails(v.slice(0, 4))} placeholder="add@email.com" /></div>
                <Field label="Preferred payment method *">
                  <select className="input" value={form.payment_method} onChange={e => { setForm(f => ({ ...f, payment_method: e.target.value })); }}>
                    <option value="">Select…</option>
                    <option value="ACH">ACH (bank transfer)</option>
                    <option value="Wire">Wire transfer</option>
                    <option value="PayPal">PayPal</option>
                  </select>
                </Field>
                <Field label="Mailing address (optional)"><input className="input" value={form.vendor_address} onChange={set('vendor_address')} /></Field>
              </div>

              {/* ── Payment details ──────────────────────────────────────────
                  Shown once a method is chosen — the fields differ by method,
                  and asking a PayPal vendor for a routing number teaches people
                  to type anything. */}
              {form.payment_method && (
                <div className="rounded-xl border border-rule p-4 bg-page/40">
                  <p className="text-xs font-bold text-ink mb-1 inline-flex items-center gap-1.5"><CreditCard size={13} /> Payment details</p>
                  {reusing ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-ink">{payOnFile.method} ••••{payOnFile.last4}</span>
                      {payOnFile.holder_name && <span className="text-ink-muted">· {payOnFile.holder_name}</span>}
                      <span className="text-ink-muted">— still correct?</span>
                      <button type="button" onClick={() => setPayReuse(false)} className="text-sm font-semibold text-brand-ink hover:underline">Enter different details</button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[11px] text-ink-muted mb-3">
                        We pay from these details. Put them here even if they're already on your invoice — that way nothing depends on us reading the document correctly.
                        {payOnFile?.on_file && payOnFile.reusable && (
                          <button type="button" onClick={() => setPayReuse(true)} className="ml-1 font-semibold text-brand-ink hover:underline">
                            Use the {payOnFile.method} ••••{payOnFile.last4} we have on file
                          </button>
                        )}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {form.payment_method === 'ACH' && (<>
                          <Field label="Account number *"><input className="input" value={pay.account} onChange={setP('account')} placeholder="000123456789" /></Field>
                          <Field label="Routing number *"><input className="input" value={pay.routing} onChange={setP('routing')} placeholder="9 digits, from the bottom of a check" /></Field>
                          <Field label="Account type *">
                            <select className="input" value={pay.account_type} onChange={setP('account_type')}>
                              <option value="">Select…</option><option>Checking</option><option>Savings</option>
                            </select>
                          </Field>
                          <Field label="Name on the account *"><input className="input" value={pay.holder} onChange={setP('holder')} /></Field>
                          <Field label="Bank name *"><input className="input" value={pay.bank_name} onChange={setP('bank_name')} placeholder="e.g. Chase, Bank of America" /></Field>
                          <Field label="Bank address *"><input className="input" value={pay.bank_address} onChange={setP('bank_address')} placeholder="Street, City, State, ZIP" /></Field>
                        </>)}
                        {form.payment_method === 'Wire' && (<>
                          {/* Asked FIRST, alone — a domestic US wire has no IBAN
                              to give, so the required list IS this answer. */}
                          <div className="sm:col-span-2">
                            <label className="label">Where is your bank? *</label>
                            <select className="input" value={pay.wire_scope} onChange={setP('wire_scope')}>
                              <option value="">Select…</option>
                              <option value="Domestic">United States (domestic wire)</option>
                              <option value="International">Outside the US (international wire)</option>
                            </select>
                          </div>
                          {pay.wire_scope === 'Domestic' && (<>
                            <Field label="Routing number (ABA) *"><input className="input" value={pay.routing} onChange={setP('routing')} placeholder="9 digits" /></Field>
                            <Field label="Account number *"><input className="input" value={pay.account} onChange={setP('account')} /></Field>
                            <Field label="Name on the account *"><input className="input" value={pay.holder} onChange={setP('holder')} /></Field>
                            <Field label="Bank name *"><input className="input" value={pay.bank_name} onChange={setP('bank_name')} /></Field>
                            <div className="sm:col-span-2"><Field label="Bank address (optional for a US wire)"><input className="input" value={pay.bank_address} onChange={setP('bank_address')} /></Field></div>
                          </>)}
                          {pay.wire_scope === 'International' && (<>
                            <Field label="IBAN or SWIFT/BIC *"><input className="input" value={pay.iban_swift} onChange={setP('iban_swift')} placeholder="GB82 WEST 1234 5698 7654 32" /></Field>
                            <Field label={looksLikeSwiftOnly(pay.iban_swift) ? 'Account number *' : 'Account number'}>
                              <input className="input" value={pay.account} onChange={setP('account')}
                                placeholder={looksLikeSwiftOnly(pay.iban_swift) ? 'Required — a SWIFT/BIC names your bank, not your account' : 'Not needed if you gave an IBAN'} />
                            </Field>
                            <Field label="Name on the account *"><input className="input" value={pay.holder} onChange={setP('holder')} /></Field>
                            <Field label="Bank name *"><input className="input" value={pay.bank_name} onChange={setP('bank_name')} /></Field>
                            <div className="sm:col-span-2"><Field label="Bank address *"><input className="input" value={pay.bank_address} onChange={setP('bank_address')} placeholder="Street, City, Country" /></Field></div>
                            <div className="sm:col-span-2"><Field label="Beneficiary address *"><input className="input" value={pay.beneficiary_address} onChange={setP('beneficiary_address')} placeholder="YOUR address, as the account holder" /></Field></div>
                            <div className="sm:col-span-2"><Field label="Intermediary / correspondent bank (optional)"><input className="input" value={pay.intermediary_bank} onChange={setP('intermediary_bank')} placeholder="Only if your bank requires one" /></Field></div>
                          </>)}
                        </>)}
                        {form.payment_method === 'PayPal' && (
                          <div className="sm:col-span-2"><Field label="PayPal email or handle *"><input className="input" value={pay.paypal} onChange={setP('paypal')} placeholder="you@example.com or @yourhandle" /></Field></div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {w9OnFile && <p className="text-xs text-success inline-flex items-center gap-1"><ShieldCheck size={13} /> We already have your W9 on file — you can skip it in the next step.</p>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {/* Invoice-requirements guidance */}
              <div className="rounded-lg border border-rule bg-brand-500/10 px-3 py-2.5 text-xs text-ink inline-flex items-start gap-2">
                <Info size={14} className="text-brand-ink flex-shrink-0 mt-0.5" />
                <span>{isReimb
                  ? <>Attach the receipt you're claiming alongside your own invoice for the reimbursement.</>
                  : <>Your invoice should be billed to <span className="font-semibold">{ctx.name}</span> and include an invoice number and the total. We pay from the details you gave in step 1 — a "Pay now" link isn't needed.</>}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Invoice number *">
                  <input className="input" value={form.invoice_number} onChange={set('invoice_number')} />
                  {dupWarn && <p className="text-[11px] text-warning mt-1 inline-flex items-center gap-1"><AlertTriangle size={11} /> We may already have this invoice number from you — double-check before submitting. You can still continue.</p>}
                </Field>
                <div />
                <Field label="Invoice file (required)">
                  <Dropzone value={files.invoice_file} onChange={file => setFiles(f => ({ ...f, invoice_file: file }))} required />
                </Field>
                {isReimb
                  ? <Field label="Receipt (required)"><Dropzone value={files.receipt_file} onChange={file => setFiles(f => ({ ...f, receipt_file: file }))} required /></Field>
                  : (
                    <Field label={w9OnFile ? 'W9 / W8 (on file — optional)' : 'W9 / W8 form (required)'}>
                      <Dropzone value={files.w9_file} onChange={onW9File} />
                      {w9Check.status === 'checking' && <p className="text-[11px] text-ink-faint mt-1 inline-flex items-center gap-1"><Sparkles size={11} className="animate-pulse" /> Checking your form…</p>}
                      {w9Check.status === 'ok' && <p className="text-[11px] text-success mt-1 inline-flex items-center gap-1"><ShieldCheck size={11} /> Looks good — signed{w9Check.info?.form_type ? ` ${w9Check.info.form_type}` : ''}.</p>}
                      {w9Check.status === 'warn' && <p className="text-[11px] text-warning mt-1 inline-flex items-center gap-1"><AlertTriangle size={11} /> The name on the form ({w9Check.info?.legal_name || '—'}) doesn't look like "{form.vendor_name}". Double-check before continuing.</p>}
                      {w9Check.status === 'unsigned' && <p className="text-[11px] text-danger mt-1 inline-flex items-center gap-1"><ShieldAlert size={11} /> This form appears to be unsigned — please sign and date it, then re-upload.</p>}
                    </Field>
                  )}
              </div>
              <p className="text-[11px] text-ink-faint">When you continue, we read your invoice to verify the number and pre-fill the next step for you.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {aiPrefilled && (
                <div className="rounded-lg border border-rule bg-brand-500/10 px-3 py-2.5 text-xs text-ink">
                  <p className="font-semibold mb-0.5 inline-flex items-center gap-1.5"><Sparkles size={12} className="text-brand-ink" /> We pre-filled these from your invoice — please correct anything that's wrong:</p>
                  <p className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {aiPrefilled.amount != null && <span>Amount: <b>{aiPrefilled.amount}</b></span>}
                    {aiPrefilled.currency && <span>Currency: <b>{aiPrefilled.currency}</b></span>}
                    {aiPrefilled.category && <span>Category: <b>{aiPrefilled.category}</b></span>}
                    {aiPrefilled.description && <span>Description: <b>{aiPrefilled.description}</b></span>}
                  </p>
                </div>
              )}
              {similar && (
                <div className="rounded-lg border border-rule bg-page px-3 py-2 text-xs text-warning inline-flex items-center gap-1.5">
                  <AlertTriangle size={13} className="flex-shrink-0" />
                  <span>You submitted {similar.currency} {Number(similar.amount).toLocaleString()} on {dstr(similar.date)}{similar.invoice_number ? ` (invoice ${similar.invoice_number})` : ''} — make sure this isn't the same invoice.</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Category *"><select className="input" value={form.category} onChange={set('category')}><option value="">Select…</option>{(ctx?.categories?.length ? ctx.categories : EXPENSE_CATEGORIES).map(c => <option key={c}>{c}</option>)}</select></Field>
                <Field label={ctx.reps?.length ? 'Your contact at the label *' : 'Your contact at the label'}>
                  {ctx.reps?.length
                    ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">Select…</option>{ctx.reps.map(r => <option key={r}>{r}</option>)}</select>
                    : <input className="input" value={form.rep} onChange={set('rep')} />}
                </Field>
                <Field label="Invoice total *"><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></Field>
                <Field label="Currency"><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
              </div>

              {/* Artist allocation */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label !mb-0">Artist{multi ? 's' : ''} &amp; allocation</label>
                  {(multi || splits.some(l => l.amount)) && (
                    <span className={`text-[11px] font-semibold ${total > 0 && Math.abs(total - allocated) < 0.01 ? 'text-success' : 'text-warning'}`}>
                      Allocated {allocated.toFixed(2)} / {total.toFixed(2)} {form.currency}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {splits.map((l, i) => (
                    <SplitLine key={i} index={i} line={l} multi={multi} roster={roster} labelName={ctx.name}
                      onField={splitField(i)} onSocial={updSocial(i)} addSocial={addSocial(i)} removeSocial={removeSocial(i)}
                      onRemove={() => removeArtist(i)} canRemove={splits.length > 1} />
                  ))}
                </div>
                <button type="button" onClick={addArtist} className="text-xs font-semibold text-brand-ink hover:underline mt-2 inline-flex items-center gap-1"><Plus size={13} /> Add another artist</button>
                <p className="text-[11px] text-ink-faint mt-1">Split the invoice across artists and attach the social handles used (with amounts) to each.</p>
                <label className="inline-flex items-center gap-1.5 mt-2 text-xs text-ink-muted cursor-pointer">
                  <input type="checkbox" checked={noSocials} onChange={e => setNoSocials(e.target.checked)} />
                  This work involved no social media (recorded as “N/A”)
                </label>
              </div>

              <Field label="Description (optional)"><textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder="What this invoice is for" /></Field>

              {step3Missing.length > 0 && (
                <div className="rounded-lg border border-rule bg-page px-3 py-2 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">Still needed before you can submit:</span> {step3Missing.join(' · ')}
                </div>
              )}
            </div>
          )}

          {error && <div className="rounded-lg border border-rule bg-page px-3 py-2.5"><p className="text-danger text-xs">{error}</p></div>}

          {/* Nav */}
          <div className="flex items-center justify-between pt-1">
            {step > 1 ? <button type="button" onClick={() => { setError(''); setStep(step - 1) }} className="btn-secondary"><ArrowLeft size={15} /> Back</button> : <span />}
            {step === 1 && <button type="button" onClick={nextFromInfo} className="btn-primary">Next — upload documents <ArrowRight size={15} /></button>}
            {step === 2 && <button type="button" onClick={nextFromDocs} disabled={checking} className="btn-primary">{checking ? 'Reading your invoice…' : <>Next — review &amp; submit <ArrowRight size={15} /></>}</button>}
            {step === 3 && <button type="button" onClick={submit} disabled={submitting || step3Missing.length > 0} className="btn-primary">{submitting ? 'Submitting…' : <><Upload size={16} /> Submit {isReimb ? 'reimbursement' : 'invoice'}</>}</button>}
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-ink-faint"><Disc3 size={12} /> <span>Powered by Cadence</span></div>
      </div>
    </div>
  )
}

// Module-scope so its identity is stable across renders — defining it inside
// the component remounts every input on each keystroke and drops focus.
function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>
}

// Artist input with roster suggestions. Free text stays allowed — an off-roster
// collaborator is legitimate — but it's said out loud instead of silently
// fragmenting reports, and the server re-validates against the live roster.
function RosterPicker({ value, roster, labelName, onChange }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const q = value.trim().toLowerCase()
  const matches = q ? roster.filter(n => n.toLowerCase().includes(q)).slice(0, 8) : roster.slice(0, 8)
  const exact = !!q && roster.some(n => n.toLowerCase() === q)
  const handleShaped = /^@/.test(value.trim())
  return (
    <div className="relative" ref={boxRef}>
      <input className="input" value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && matches.length > 0 && !exact && (
        <div className="absolute z-20 left-0 right-0 mt-1 card !p-1 max-h-44 overflow-y-auto shadow-lg">
          {matches.map(n => (
            <button key={n} type="button" onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(n); setOpen(false) }}
              className="block w-full text-left px-2.5 py-1.5 text-sm text-ink rounded-md hover:bg-brand-500/10">{n}</button>
          ))}
        </div>
      )}
      {handleShaped && <p className="text-[11px] text-warning mt-1">That looks like a social handle — the artist / project name goes here; handles go under Socials.</p>}
      {!handleShaped && q.length > 1 && !exact && roster.length > 0 && (
        <p className="text-[11px] text-ink-faint mt-1">Not on the {labelName} roster — that's OK, it'll be flagged for review.</p>
      )}
    </div>
  )
}

// One artist allocation line: artist / song / amount + a socials sub-list
// (each social with an optional amount). Module-scope for stable focus.
function SplitLine({ line, index, multi, roster, labelName, onField, onSocial, addSocial, removeSocial, onRemove, canRemove }) {
  return (
    <div className="rounded-xl border border-rule p-3 bg-page/30">
      {multi && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">Artist {index + 1}</span>
          {canRemove && <button type="button" onClick={onRemove} className="text-ink-faint hover:text-danger"><Trash2 size={13} /></button>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className="label">Artist / project *</label><RosterPicker value={line.artist} roster={roster} labelName={labelName} onChange={v => onField('artist', v)} /></div>
        <div><label className="label">Song / track *</label><input className="input" value={line.song} onChange={e => onField('song', e.target.value)} /></div>
        <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={line.amount} onChange={e => onField('amount', e.target.value)} placeholder={multi ? '' : 'full invoice'} /></div>
      </div>
      <div className="mt-2 pl-0.5">
        {line.socials.map((s, si) => (
          <div key={si} className="flex items-center gap-2 mb-1.5">
            <input className="input !py-1.5 text-sm flex-1" value={s.handle} onChange={e => onSocial(si, 'handle', e.target.value)} placeholder="@handle / link" />
            <input type="number" step="0.01" className="input !py-1.5 text-sm !w-28" value={s.amount} onChange={e => onSocial(si, 'amount', e.target.value)} placeholder="amount" />
            <button type="button" onClick={() => removeSocial(si)} className="text-ink-faint hover:text-danger flex-shrink-0"><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add social</button>
      </div>
    </div>
  )
}

function Center({ children }) {
  return <div className="min-h-screen bg-page flex items-center justify-center p-4"><div className="card p-10 text-center max-w-md">{children}</div></div>
}

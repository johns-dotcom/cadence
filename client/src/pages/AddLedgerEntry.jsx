import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles, Loader2, Plus, X, Trash2, AtSign, Receipt } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Dropzone from '../components/Dropzone'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const SOCIAL_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X/Twitter', 'Facebook', 'Spotify', 'Other']
const BLANK_SOCIAL = () => ({ platform: 'Instagram', handle: '', amount: '' })
const BLANK_SPLIT = () => ({ artist: '', song: '', amount: '', socials: [] })

// Internal "Add invoice" — a team member manually enters/uploads an invoice
// (or a reimbursement). Parsing the invoice with AI is an explicit button, not a
// side effect of uploading: every parse spends one of the workspace's monthly AI
// requests, and auto-parsing spent another on every replacement. A proof of
// payment auto-marks it paid; and the amount can be split across artists (and
// socials with amounts) which are created as ledger splits on save. Staff
// entries are created approved (they don't route through Approvals).
export default function AddLedgerEntry({ mode = 'invoice' }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [isReimb, setIsReimb] = useState(mode === 'reimbursement')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [parsed, setParsed] = useState(false)
  // `currency` defaults to 'USD' and is therefore never blank, so the usual
  // fill-blanks-only rule can't express "leave the user's choice alone" for it.
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [dup, setDup] = useState(null)
  const [reps, setReps] = useState([])

  const [form, setForm] = useState({
    invoice_date: '', payee: '', category: '', artist: '', song: '',
    invoice_number: '', amount: '', currency: 'USD', payment_method: '', rep: '',
    vendor_email: '', vendor_address: '', vendor_bank: '', description: '', notes: '',
    payment_status: '', payment_date: '',
  })
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, proof_file: null, receipt_file: null })
  const [socials, setSocials] = useState([BLANK_SOCIAL()])
  const [splitOn, setSplitOn] = useState(false)
  const [splits, setSplits] = useState([BLANK_SPLIT(), BLANK_SPLIT()])

  useEffect(() => { api.get('/reps').then(r => setReps((r.data.data || []).map(x => x.name).filter(Boolean))).catch(() => {}) }, [])
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const checkDup = async () => {
    if (isReimb || !form.payee.trim() || !form.invoice_number.trim()) { setDup(null); return }
    try { const { data } = await api.get('/ledger/check-dup', { params: { payee: form.payee.trim(), invoice_number: form.invoice_number.trim() } }); setDup(data.data?.duplicate ? data.data.match : null) }
    catch { setDup(null) }
  }

  // Choosing a file no longer parses it — see the Parse button below. Reset `parsed`
  // so a replacement file doesn't inherit the previous one's state.
  const onInvoice = (file) => { setFiles(f => ({ ...f, invoice_file: file })); setParsed(false) }

  const scanInvoice = async () => {
    const f = files.invoice_file
    // Guard: there was no double-fire check and no way to cancel an in-flight parse,
    // so two overlapping requests could let the REPLACED file's data win.
    if (!f || scanning) return
    setScanning(true)
    try {
      const fd = new FormData(); fd.append('file', f)
      const { data } = await api.post('/ledger/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      // Fill blanks only — whatever you typed wins.
      setForm(prev => ({
        ...prev,
        payee: prev.payee || d.vendor_name || '',
        amount: prev.amount || (d.amount != null ? String(d.amount) : ''),
        currency: currencyTouched ? prev.currency : (d.currency || prev.currency),
        invoice_number: prev.invoice_number || d.invoice_number || '',
        invoice_date: prev.invoice_date || d.invoice_date || '',
        category: prev.category || d.category || '',
        payment_method: prev.payment_method || d.payment_method || '',
        description: prev.description || d.description || '',
      }))
      setParsed(true)
      toast('Invoice parsed — review the fields')
    } catch (err) {
      // Always surfaced now. The old auto path swallowed everything, including the
      // 403 non-approvers get from this endpoint and the monthly AI-limit 502.
      toast(err.response?.data?.error || 'Could not read the invoice', 'error')
    } finally { setScanning(false) }
  }

  // Socials (top-level, used when not splitting)
  const socialField = (i, k) => (e) => setSocials(s => s.map((x, idx) => idx === i ? { ...x, [k]: e.target.value } : x))
  const addSocial = () => setSocials(s => [...s, BLANK_SOCIAL()])
  const removeSocial = (i) => setSocials(s => (s.length > 1 ? s.filter((_, idx) => idx !== i) : [BLANK_SOCIAL()]))

  // Splits
  const splitField = (i) => (k, v) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  const addArtist = () => setSplits(s => [...s, BLANK_SPLIT()])
  const removeArtist = (i) => setSplits(s => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s))
  const addSplitSocial = (i) => () => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: [...l.socials, { handle: '', amount: '' }] } : l))
  const updSplitSocial = (i) => (si, k, v) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.map((so, j) => j === si ? { ...so, [k]: v } : so) } : l))
  const removeSplitSocial = (i) => (si) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.filter((_, j) => j !== si) } : l))

  const total = parseFloat(form.amount) || 0
  const allocated = splits.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)

  const create = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      if (!form.payee.trim()) throw new Error(isReimb ? 'Enter who to pay.' : 'Enter the payee.')
      if (!total || total <= 0) throw new Error('Enter a valid amount.')
      if (!form.invoice_date) throw new Error('Enter the invoice date.')
      if (!isReimb && !form.invoice_number.trim()) throw new Error('Enter the invoice number.')
      if (isReimb && !files.receipt_file) throw new Error('Attach the receipt for this reimbursement.')

      // Build the allocation (artist_breakdown). Only sent when it's a real
      // split (multiple artists) or socials carry amounts.
      let splitsPayload = null
      if (splitOn) {
        const clean = splits
          .map(l => ({ artist: l.artist.trim(), song: (l.song || '').trim(), amount: parseFloat(l.amount) || 0,
            socials: (l.socials || []).map(s => ({ handle: (s.handle || '').trim(), amount: parseFloat(s.amount) || 0 })).filter(s => s.handle) }))
          .filter(l => l.artist)
        if (clean.length < 1) throw new Error('Add at least one artist to split across.')
        const sum = clean.reduce((a, l) => a + l.amount, 0)
        if (Math.abs(sum - total) > 0.01) throw new Error(`Splits (${sum.toFixed(2)}) must add up to the amount (${total.toFixed(2)}).`)
        splitsPayload = clean
      } else {
        const socialLines = socials
          .filter(s => s.handle.trim())
          .map(s => ({ handle: [s.platform, s.handle.trim()].filter(Boolean).join(' '), amount: parseFloat(s.amount) || 0 }))
        if (socialLines.some(s => s.amount > 0)) splitsPayload = [{ artist: form.artist.trim(), song: form.song.trim(), amount: total, socials: socialLines }]
      }

      const fd = new FormData()
      // When splitting, artist/song live on the allocation rows. Blank them here so
      // the parent container doesn't keep whatever was typed before the box was
      // ticked (the server uses parent.artist / parent.song as the per-child
      // fallback, so a leftover value would leak into the children).
      Object.entries(form).forEach(([k, v]) => fd.append(k, splitOn && (k === 'artist' || k === 'song') ? '' : v))
      fd.append('vendor_name', form.payee)
      fd.append('is_reimbursement', isReimb ? 'true' : 'false')
      if (splitsPayload) fd.append('splits', JSON.stringify(splitsPayload))
      for (const key of ['invoice_file', 'w9_file', 'proof_file', 'receipt_file']) if (files[key]) fd.append(key, files[key])

      const { data } = await api.post('/ledger/entries', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (data.data?.pending) toast('Submitted for approval — a bookkeeper will review it')
      else toast(data.data?.split_parts ? `Added & split across ${data.data.split_parts} lines` : (isReimb ? 'Reimbursement added' : 'Invoice added'))
      navigate(isApprover ? '/ledger' : '/')
    } catch (err) { toast(err.response?.data?.error || err.message || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate(isApprover ? '/ledger' : '/')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"><ArrowLeft size={15} /> {isApprover ? 'Ledger' : 'Back'}</button>
      <PageHeader title={isReimb ? 'Add reimbursement' : 'Add invoice'} subtitle={isApprover ? 'Upload and parse an invoice, then review before saving' : 'Upload an invoice — it goes to your bookkeeper for approval'} />

      <form onSubmit={create} className="space-y-5">
        {/* Invoice upload */}
        <div>
          <Dropzone value={files.invoice_file} onChange={onInvoice} accept="application/pdf,image/*" label="Drag or click to upload invoice" hint="PDF, JPG, or PNG" />

          {/* Explicit action, matching the /contracts/draft-clause control. Gated on
              isApprover because POST /ledger/parse-invoice sits below requireApprover
              while /add-invoice itself is open to any member — showing the button to
              them would guarantee a 403. */}
          {files.invoice_file && isApprover && (
            <div className="rounded-xl border border-dashed border-rule bg-page/40 p-3 mt-2">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={14} className="text-brand-600" />
                <span className="text-xs font-semibold text-ink">Fill fields from the invoice</span>
              </div>
              <button type="button" onClick={scanInvoice} disabled={scanning} className="btn-secondary !py-1.5">
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {scanning ? 'Reading the invoice…' : parsed ? 'Parse again' : 'Parse invoice'}
              </button>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Only empty fields are filled — your edits are kept. AI features require a configured key.
              </p>
            </div>
          )}
        </div>

        {/* Reimbursement toggle */}
        <label className="card px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={isReimb} onChange={e => setIsReimb(e.target.checked)} /> <Receipt size={15} className="text-gray-400" /> This is a reimbursement</span>
          <span className="text-xs text-gray-400">Reimburses staff for an out-of-pocket expense</span>
        </label>

        {/* Supporting docs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {isReimb
            ? <div><label className="label">Receipt (required)</label><Dropzone value={files.receipt_file} onChange={file => setFiles(f => ({ ...f, receipt_file: file }))} accept="application/pdf,image/*" label="Upload receipt" /></div>
            : <div><label className="label">W9 / W8 form (optional)</label><Dropzone value={files.w9_file} onChange={file => setFiles(f => ({ ...f, w9_file: file }))} accept="application/pdf,image/*" label="Upload W9 / W8" /></div>}
          <div><label className="label">Proof of payment (optional)</label><Dropzone value={files.proof_file} onChange={file => setFiles(f => ({ ...f, proof_file: file }))} accept="application/pdf,image/*" label="Upload proof" hint="Auto-marks as paid" /></div>
        </div>

        {/* Core fields */}
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Invoice date *</label><input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">{isReimb ? 'Pay to *' : 'Payee *'}</label><input className="input" value={form.payee} onChange={set('payee')} onBlur={checkDup} /></div>
          <div><label className="label">Category</label><select className="input" value={form.category} onChange={set('category')}><option value="">Select category</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          {/* Hidden while splitting: the allocation rows below own artist + song, and
              two sets of the same fields on one form reads as a bug. The typed values
              stay in state so unchecking the box restores them, but they are NOT
              submitted (see create()) — otherwise the parent row keeps a stale artist
              and the split rows silently inherit a song nobody can see. */}
          {!splitOn && <div><label className="label">Artist</label><input className="input" value={form.artist} onChange={set('artist')} /></div>}
          {!splitOn && <div><label className="label">Song</label><input className="input" value={form.song} onChange={set('song')} /></div>}
          {!isReimb && <div><label className="label">Invoice # *</label><input className="input" value={form.invoice_number} onChange={set('invoice_number')} onBlur={checkDup} /></div>}
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></div>
          {/* Setting this by hand opts out of the parse overwriting it. */}
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={e => { setCurrencyTouched(true); set('currency')(e) }}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Payment method</label><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Rep</label>{reps.length ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">—</option>{reps.map(r => <option key={r}>{r}</option>)}</select> : <input className="input" value={form.rep} onChange={set('rep')} />}</div>
          {isApprover && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-page/60 border border-rule px-3 py-2.5">
              <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={form.payment_status === 'Paid'}
                  onChange={e => setForm(f => ({ ...f, payment_status: e.target.checked ? 'Paid' : '', payment_date: e.target.checked ? (f.payment_date || new Date().toISOString().slice(0, 10)) : '' }))} />
                Mark as already paid
              </label>
              {form.payment_status === 'Paid' && (
                <span className="inline-flex items-center gap-2 text-sm text-gray-500">Paid on <input type="date" className="input !w-auto !py-1" value={form.payment_date} onChange={set('payment_date')} /></span>
              )}
            </div>
          )}
          {!isReimb && <div><label className="label">Vendor email</label><input type="email" className="input" value={form.vendor_email} onChange={set('vendor_email')} placeholder="vendor@example.com" /></div>}
          <div className="sm:col-span-2"><label className="label">Mailing address</label><input className="input" value={form.vendor_address} onChange={set('vendor_address')} placeholder="Street, City, State, ZIP" /></div>
          <div className="sm:col-span-2"><label className="label">Bank name <span className="text-gray-400 font-normal">— for payment routing</span></label><input className="input" value={form.vendor_bank} onChange={set('vendor_bank')} placeholder="e.g. Chase, Bank of America" /></div>

          {dup && <p className="sm:col-span-2 text-xs text-amber-700">Heads up: a submission with this payee + invoice # may already exist.</p>}

          {/* Socials (only when not splitting) */}
          {!splitOn && (
            <div className="sm:col-span-2">
              <label className="label inline-flex items-center gap-1"><AtSign size={12} /> Social handles <span className="text-gray-400 font-normal">— optional, for creator / influencer rows</span></label>
              <div className="space-y-2">
                {socials.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={s.platform} onChange={socialField(i, 'platform')} className="input !w-auto !py-1.5 text-sm">{SOCIAL_PLATFORMS.map(p => <option key={p}>{p}</option>)}</select>
                    <input value={s.handle} onChange={socialField(i, 'handle')} placeholder="@handle" className="input !py-1.5 text-sm flex-1" />
                    <input type="number" step="0.01" value={s.amount} onChange={socialField(i, 'amount')} placeholder="$" className="input !py-1.5 text-sm !w-24" />
                    <button type="button" onClick={() => removeSocial(i)} className="text-gray-300 hover:text-red-600 flex-shrink-0"><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-600 hover:underline mt-1.5 inline-flex items-center gap-1"><Plus size={12} /> Add another handle</button>
            </div>
          )}

          {/* Split toggle */}
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1"><input type="checkbox" checked={splitOn} onChange={e => setSplitOn(e.target.checked)} /> Split between multiple artists</label>

          {splitOn && (
            <div className="sm:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Allocation <span className="font-normal normal-case tracking-normal">— artist &amp; song are set per row</span></span>
                <span className={`text-[11px] font-semibold ${Math.abs(total - allocated) < 0.01 && total > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>Allocated {allocated.toFixed(2)} / {total.toFixed(2)} {form.currency}</span>
              </div>
              {splits.map((l, i) => (
                <SplitRow key={i} index={i} line={l} onField={splitField(i)} onSocial={updSplitSocial(i)} addSocial={addSplitSocial(i)} removeSocial={removeSplitSocial(i)} onRemove={() => removeArtist(i)} canRemove={splits.length > 1} />
              ))}
              <button type="button" onClick={addArtist} className="text-xs font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={13} /> Add another artist</button>
            </div>
          )}

          <div className="sm:col-span-2"><label className="label">Description</label><textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder="What this invoice is for" /></div>
          <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
        </div>

        <div className="flex justify-end">
          {/* Blocked mid-parse: the response would otherwise patch a form that has
              already navigated away. */}
          <button type="submit" disabled={saving || scanning} className="btn-primary">{saving ? 'Saving…' : (isReimb ? 'Add reimbursement' : 'Add invoice')}</button>
        </div>
      </form>
    </div>
  )
}

function SplitRow({ line, index, onField, onSocial, addSocial, removeSocial, onRemove, canRemove }) {
  return (
    <div className="rounded-xl border border-rule p-3 bg-page/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Artist {index + 1}</span>
        {canRemove && <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div><label className="label">Artist</label><input className="input" value={line.artist} onChange={e => onField('artist', e.target.value)} /></div>
        <div><label className="label">Song</label><input className="input" value={line.song} onChange={e => onField('song', e.target.value)} /></div>
        <div><label className="label">Amount</label><input type="number" step="0.01" className="input" value={line.amount} onChange={e => onField('amount', e.target.value)} /></div>
      </div>
      <div className="mt-2">
        {line.socials.map((s, si) => (
          <div key={si} className="flex items-center gap-2 mb-1.5">
            <input className="input !py-1.5 text-sm flex-1" value={s.handle} onChange={e => onSocial(si, 'handle', e.target.value)} placeholder="@handle / link" />
            <input type="number" step="0.01" className="input !py-1.5 text-sm !w-24" value={s.amount} onChange={e => onSocial(si, 'amount', e.target.value)} placeholder="$" />
            <button type="button" onClick={() => removeSocial(si)} className="text-gray-300 hover:text-red-600 flex-shrink-0"><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add social</button>
      </div>
    </div>
  )
}

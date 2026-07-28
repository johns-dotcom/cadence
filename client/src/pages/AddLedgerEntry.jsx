import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles, Plus, X, Trash2, AtSign, Receipt } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Dropzone from '../components/Dropzone'
import { useToast } from '../context/ToastContext'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const SOCIAL_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X/Twitter', 'Facebook', 'Spotify', 'Other']
const BLANK_SOCIAL = () => ({ platform: 'Instagram', handle: '', amount: '' })
const BLANK_SPLIT = () => ({ artist: '', song: '', amount: '', socials: [] })

// Internal "Add invoice" — a team member manually enters/uploads an invoice
// (or a reimbursement). Uploading the invoice auto-parses it; a proof of
// payment auto-marks it paid; and the amount can be split across artists (and
// socials with amounts) which are created as ledger splits on save. Staff
// entries are created approved (they don't route through Approvals).
export default function AddLedgerEntry({ mode = 'invoice' }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [isReimb, setIsReimb] = useState(mode === 'reimbursement')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [dup, setDup] = useState(null)
  const [reps, setReps] = useState([])

  const [form, setForm] = useState({
    invoice_date: '', payee: '', category: '', artist: '', song: '',
    invoice_number: '', amount: '', currency: 'USD', payment_method: '', rep: '',
    vendor_email: '', vendor_address: '', vendor_bank: '', description: '', notes: '',
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

  const onInvoice = (file) => { setFiles(f => ({ ...f, invoice_file: file })); if (file) setTimeout(() => scanInvoice(file), 0) }
  const scanInvoice = async (file) => {
    const f = file || files.invoice_file
    if (!f) return
    setScanning(true)
    try {
      const fd = new FormData(); fd.append('file', f)
      const { data } = await api.post('/ledger/parse-invoice', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const d = data.data
      setForm(prev => ({
        ...prev,
        payee: prev.payee || d.vendor_name || '',
        amount: prev.amount || (d.amount != null ? String(d.amount) : ''),
        currency: d.currency || prev.currency,
        invoice_number: prev.invoice_number || d.invoice_number || '',
        invoice_date: prev.invoice_date || d.invoice_date || '',
        category: prev.category || d.category || '',
        payment_method: prev.payment_method || d.payment_method || '',
        description: prev.description || d.description || '',
      }))
      if (file) toast('Invoice parsed — review the fields')
    } catch { if (!file) toast('Could not read the invoice', 'error') }
    finally { setScanning(false) }
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
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append('vendor_name', form.payee)
      fd.append('is_reimbursement', isReimb ? 'true' : 'false')
      if (splitsPayload) fd.append('splits', JSON.stringify(splitsPayload))
      for (const key of ['invoice_file', 'w9_file', 'proof_file', 'receipt_file']) if (files[key]) fd.append(key, files[key])

      const { data } = await api.post('/ledger/entries', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast(data.data?.split_parts ? `Added & split across ${data.data.split_parts} lines` : (isReimb ? 'Reimbursement added' : 'Invoice added'))
      navigate('/ledger')
    } catch (err) { toast(err.response?.data?.error || err.message || 'Failed to save', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate('/ledger')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"><ArrowLeft size={15} /> Ledger</button>
      <PageHeader title={isReimb ? 'Add reimbursement' : 'Add invoice'} subtitle="Upload and parse an invoice, then review before saving" />

      <form onSubmit={create} className="space-y-5">
        {/* Invoice upload */}
        <div>
          <Dropzone value={files.invoice_file} onChange={onInvoice} accept="application/pdf,image/*" label="Drag or click to upload invoice" hint="PDF, JPG, or PNG" />
          {scanning && <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1"><Sparkles size={11} className="animate-pulse" /> Reading the invoice…</p>}
          {files.invoice_file && !scanning && <button type="button" onClick={() => scanInvoice()} className="text-xs font-semibold text-brand-600 hover:underline mt-1 inline-flex items-center gap-1"><Sparkles size={12} /> Re-parse</button>}
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
          <div><label className="label">Artist</label><input className="input" value={form.artist} onChange={set('artist')} disabled={splitOn} /></div>
          <div><label className="label">Song</label><input className="input" value={form.song} onChange={set('song')} disabled={splitOn} /></div>
          {!isReimb && <div><label className="label">Invoice # *</label><input className="input" value={form.invoice_number} onChange={set('invoice_number')} onBlur={checkDup} /></div>}
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Payment method</label><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Rep</label>{reps.length ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">—</option>{reps.map(r => <option key={r}>{r}</option>)}</select> : <input className="input" value={form.rep} onChange={set('rep')} />}</div>
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
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Allocation</span>
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
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : (isReimb ? 'Add reimbursement' : 'Add invoice')}</button>
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

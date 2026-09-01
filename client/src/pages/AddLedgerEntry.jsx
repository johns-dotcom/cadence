import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Sparkles, Loader2, Plus, X, Trash2, AtSign, Receipt, FileText, AlertTriangle, CheckCircle2, Zap, Pause, Package } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Dropzone from '../components/Dropzone'
import Modal from '../components/ui/Modal'
import ApprovalChecklistFields from '../components/ApprovalChecklistFields'
import { answerCobrand, checklistComplete, checklistPayload, checklistOutstanding } from '../lib/approvalChecklist'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import useUnsavedWarning from '../hooks/useUnsavedWarning'
import { PAYMENT_METHODS, CURRENCIES } from '../constants'
import CategoryOptions from '../components/CategoryOptions'

const SOCIAL_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'X/Twitter', 'Facebook', 'Spotify', 'Other']
const BLANK_SOCIAL = () => ({ platform: 'Instagram', handle: '', amount: '' })
const BLANK_SPLIT = (amount = '') => ({ artist: '', song: '', amount, socials: [] })
const MP = { headers: { 'Content-Type': 'multipart/form-data' } }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const today = () => new Date().toISOString().slice(0, 10)

// Client mirror of server/lib/normalizeInvoiceNum.js — "INV-123", "#123" and
// "00123" are all the same invoice number. Used for the typed-vs-printed
// mismatch warning; the server is still the gate.
function normInv(num) {
  if (!num) return ''
  let s = String(num).toLowerCase().trim()
  let prev
  do { prev = s; s = s.replace(/^(invoice|inv|no\.?|#)[\s\-.:]*/i, '') } while (s && s !== prev)
  return s.replace(/[-\s.]/g, '').replace(/^0+/, '')
}

// Internal "Add invoice" — a team member manually enters/uploads an invoice
// (or a reimbursement). Parsing the invoice with AI is an explicit button, not
// a side effect of uploading: every parse spends the workspace's monthly AI
// requests (the button fires the field extraction, the document gate and the
// line-item read together — three calls, one click, boom fired four). A proof
// of payment auto-marks it paid (approvers only); the amount can be split
// across artists (and socials with amounts) or across the invoice's own line
// items, which become ledger splits on save. Approver saves go through the
// approval-checklist review; everyone else's land pending in Approvals.
export default function AddLedgerEntry({ mode = 'invoice' }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [isReimb, setIsReimb] = useState(mode === 'reimbursement')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [proofScanning, setProofScanning] = useState(false)
  const [parsed, setParsed] = useState(false)
  const [reps, setReps] = useState([])
  // The pre-save review — an approver's save files straight to `approved`, so
  // the same checklist the Approvals deck asks gates the save here (the server
  // stores it via the same writeApprovalChecklist, so "approved" means one
  // thing however the invoice got there). Answers are cleared on every open —
  // never inherited from a previous review.
  const [review, setReview] = useState(false)
  const [checks, setChecks] = useState({})

  const initialForm = () => ({
    invoice_date: '', payee: '', category: '', artist: '', song: '',
    invoice_number: '', amount: '', currency: 'USD', payment_method: '',
    rep: user?.name || '',
    vendor_email: '', vendor_address: '', vendor_bank: '', description: '', notes: '',
    payment_status: '', payment_date: '', payment_ref: '',
    urgency: 'none', urgency_reason: '',
  })
  const [form, setForm] = useState(initialForm)
  const [files, setFiles] = useState({ invoice_file: null, w9_file: null, proof_file: null })
  const [receipts, setReceipts] = useState([])
  const [socials, setSocials] = useState([BLANK_SOCIAL()])
  const [splitOn, setSplitOn] = useState(false)
  const [splits, setSplits] = useState([BLANK_SPLIT(), BLANK_SPLIT()])
  const [bulk, setBulk] = useState({ on: false, quantity: '', unit: '' })

  // Parse-derived state.
  const [docInvoiceNumber, setDocInvoiceNumber] = useState(null) // number printed on the doc
  const [docCheck, setDocCheck] = useState(null)                 // is-this-an-invoice gate
  const [lines, setLines] = useState(null)                       // editable line items
  const [lineMeta, setLineMeta] = useState(null)
  // Vendor intelligence.
  const [w9Check, setW9Check] = useState(null)                   // attach-time W9 validation
  const [w9OnFile, setW9OnFile] = useState(null)                 // vendor already has a W9
  const [vendorSugs, setVendorSugs] = useState([])               // "did you mean" chips
  // Duplicate warning (live) + the post-save banner.
  const [dupMatch, setDupMatch] = useState(null)
  const [dupSimilar, setDupSimilar] = useState([])
  const [saved, setSaved] = useState(null)

  useEffect(() => { api.get('/reps').then(r => setReps((r.data.data || []).map(x => x.name).filter(Boolean))).catch(() => {}) }, [])
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  // The current user is always a valid rep for their own entry, even when the
  // configured rep list doesn't know them.
  const repOptions = user?.name && !reps.includes(user.name) ? [user.name, ...reps] : reps

  // Dirty form → beforeunload prompt. Saving/saved states disarm it.
  useUnsavedWarning(!saving && !!(form.payee.trim() || form.amount || files.invoice_file || receipts.length))

  const checkDup = async (payee, num) => {
    payee = String(payee ?? form.payee).trim()
    num = String(num ?? form.invoice_number).trim()
    if (!payee || !num) { setDupMatch(null); setDupSimilar([]); return }
    try {
      const { data } = await api.get('/ledger/check-dup', { params: { payee, invoice_number: num } })
      setDupMatch(data.data?.duplicate ? data.data.match : null)
      setDupSimilar(data.data?.similar || [])
    } catch { setDupMatch(null); setDupSimilar([]) }
  }

  // Live duplicate check while typing (500ms), not just on blur — the warning
  // has to exist BEFORE the save click, and a post-parse sweep re-runs it with
  // the freshly parsed payee + number.
  useEffect(() => {
    const t = setTimeout(() => { checkDup(form.payee, form.invoice_number) }, 500)
    return () => clearTimeout(t)
  }, [form.payee, form.invoice_number]) // eslint-disable-line react-hooks/exhaustive-deps

  // Vendor suggest (approvers — the endpoint is Approver+): an exact payee
  // match silently fills the blank contact fields; near-misses become
  // "did you mean" chips with invoice counts.
  useEffect(() => {
    if (!isApprover) return
    const q = form.payee.trim()
    if (q.length < 2) { setVendorSugs([]); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/ledger/vendor-suggest', { params: { q } })
        const vendors = data.data?.vendors || []
        const exact = vendors.find(v => (v.name || '').toLowerCase() === q.toLowerCase())
        if (exact) {
          setVendorSugs([])
          setForm(f => ({
            ...f,
            vendor_email: f.vendor_email || exact.email || '',
            vendor_address: f.vendor_address || exact.address || '',
            vendor_bank: f.vendor_bank || exact.bank || '',
          }))
        } else setVendorSugs(vendors.slice(0, 5))
      } catch { setVendorSugs([]) }
    }, 400)
    return () => clearTimeout(t)
  }, [form.payee, isApprover])

  // W9-on-file lookup (any member — booleans only, alias-aware).
  useEffect(() => {
    const q = form.payee.trim()
    if (q.length < 2) { setW9OnFile(null); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/ledger/vendor-w9-status', { params: { payee: q } })
        setW9OnFile(data.data?.has_w9 ? data.data : null)
      } catch { setW9OnFile(null) }
    }, 400)
    return () => clearTimeout(t)
  }, [form.payee])

  // Choosing a file no longer parses it — see the Parse button below. Reset the
  // parse-derived state so a replacement file doesn't inherit the previous one's.
  const onInvoice = (file) => {
    setFiles(f => ({ ...f, invoice_file: file }))
    setParsed(false); setDocCheck(null); setDocInvoiceNumber(null)
    if (!file) { setLines(null); setLineMeta(null) }
  }

  const scanInvoice = async () => {
    // A reimbursement without an invoice file can parse its first receipt
    // instead (boom's parseFile fallback).
    const f = files.invoice_file || (isReimb ? receipts[0] : null)
    // Guard: there was no double-fire check and no way to cancel an in-flight parse,
    // so two overlapping requests could let the REPLACED file's data win.
    if (!f || scanning) return
    setScanning(true)
    try {
      const mkFd = () => { const fd = new FormData(); fd.append('file', f); return fd }
      // One click, three questions: the fields, "is this even an invoice",
      // and the line items. Fired together over the same upload.
      const [parseRes, validateRes, linesRes] = await Promise.allSettled([
        api.post('/ledger/parse-invoice', mkFd(), MP),
        api.post('/ledger/validate-invoice', mkFd(), MP),
        api.post('/ledger/parse-lines', mkFd(), MP),
      ])

      if (parseRes.status === 'fulfilled') {
        const body = parseRes.value.data || {}
        const d = body.data || {}
        // Parsed-value-wins (boom parity): re-parsing can REFRESH a wrong
        // field. Nothing re-runs after you type, so later edits still stand.
        let freshPayee = '', freshNum = ''
        setForm(prev => {
          freshPayee = d.vendor_name || prev.payee
          freshNum = d.invoice_number || prev.invoice_number
          return {
            ...prev,
            payee: d.vendor_name || prev.payee,
            amount: d.amount != null ? String(d.amount) : prev.amount,
            currency: d.currency || prev.currency,
            invoice_number: d.invoice_number || prev.invoice_number,
            invoice_date: d.invoice_date || prev.invoice_date,
            category: d.category || prev.category,
            payment_method: d.payment_method || prev.payment_method,
            description: d.description || prev.description,
            vendor_email: d.vendor_email || prev.vendor_email,
            artist: !splitOn && d.artist ? d.artist : prev.artist,
            song: !splitOn && d.song ? d.song : prev.song,
          }
        })
        setDocInvoiceNumber(d.invoice_number || null)
        // Handles the model spotted (e.g. an @name it was told not to call an
        // artist) prefill the socials editor, amount-less.
        if (Array.isArray(body.suggest_socials) && body.suggest_socials.length) {
          setSocials(prev => {
            const have = new Set(prev.map(s => s.handle.trim().toLowerCase()).filter(Boolean))
            const add = body.suggest_socials.filter(h => !have.has(String(h).trim().toLowerCase()))
              .map(h => ({ platform: 'Other', handle: String(h).trim(), amount: '' }))
            if (!add.length) return prev
            return [...prev.filter(s => s.handle.trim()), ...add, ...(prev.some(s => !s.handle.trim()) ? [] : [])]
          })
        }
        ;(body.ai_warnings || []).forEach(w => toast(w))
        // ai_status routing — "not configured", "errored" and "ran but found
        // nothing" are three different problems and get three different toasts.
        const filled = Object.values(d).filter(v => v != null && v !== '').length
        if (body.ai_status === 'disabled') toast(body.ai_error || 'AI is not configured on the server', 'error')
        else if (body.ai_status === 'error') toast(body.ai_error || 'Could not read the invoice', 'error')
        else if (!filled) toast('The AI ran but found no usable fields on this document', 'error')
        else { setParsed(true); toast(`Invoice parsed — ${filled} field${filled === 1 ? '' : 's'} read. Review before saving`) }
        // Post-parse dup sweep with the fresh values — the 500ms debounce would
        // get there too, but the moment right after a parse fills the form is
        // exactly when a duplicate is most likely to appear.
        if (freshPayee && freshNum) checkDup(freshPayee, freshNum)
      } else {
        toast(parseRes.reason?.response?.data?.error || 'Could not read the invoice', 'error')
      }

      if (validateRes.status === 'fulfilled') {
        const v = validateRes.value.data?.data
        setDocCheck(v && v.ai ? v : null) // fail-open results carry no signal
      }

      if (linesRes.status === 'fulfilled') {
        const L = linesRes.value.data?.data
        if (L && Array.isArray(L.lines) && L.lines.length >= 2) {
          setLines(L.lines.map((l, i) => ({
            key: `ai-${i}-${Date.now()}`,
            description: l.description || '',
            category: l.category || '',
            artist: l.artist || '',
            amount: l.amount != null ? String(l.amount) : '',
            recoupable: !!l.recoupable,
          })))
          setLineMeta(L)
        } else { setLines(null); setLineMeta(null) }
      }
    } finally { setScanning(false) }
  }

  // W9 attach → auto-validate (spinner → issues / "looks complete").
  const onW9 = async (file) => {
    setFiles(f => ({ ...f, w9_file: file }))
    if (!file) { setW9Check(null); return }
    setW9Check({ checking: true })
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('vendor_name', form.payee)
      const { data } = await api.post('/ledger/validate-w9', fd, MP)
      setW9Check(data.data?.ai ? data.data : null)
    } catch { setW9Check(null) }
  }

  // Proof attach → mark Paid (approvers; the server refuses it for anyone
  // else) + best-effort extraction of date / method / reference. Removing the
  // proof takes the auto-set payment state with it.
  const onProof = async (file) => {
    setFiles(f => ({ ...f, proof_file: file }))
    if (!file) {
      setForm(f => ({ ...f, payment_status: '', payment_date: '', payment_ref: '' }))
      return
    }
    if (isApprover) setForm(f => ({ ...f, payment_status: 'Paid', payment_date: f.payment_date || today() }))
    setProofScanning(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const { data } = await api.post('/ledger/parse-proof', fd, MP)
      const d = data.data || {}
      if (isApprover && d.payment_date) { setForm(f => ({ ...f, payment_date: d.payment_date })); toast(`Payment date read from the proof: ${d.payment_date}`) }
      // Applied INSIDE the updater so a method picked mid-scan survives.
      if (d.payment_method) setForm(f => (f.payment_method ? f : { ...f, payment_method: d.payment_method }))
      if (isApprover && d.reference_number) setForm(f => (f.payment_ref ? f : { ...f, payment_ref: d.reference_number }))
    } catch { /* extraction is a courtesy */ }
    finally { setProofScanning(false) }
  }

  // Socials (top-level, used when not splitting)
  const socialField = (i, k) => (e) => setSocials(s => s.map((x, idx) => idx === i ? { ...x, [k]: e.target.value } : x))
  const addSocial = () => setSocials(s => [...s, BLANK_SOCIAL()])
  const removeSocial = (i) => setSocials(s => (s.length > 1 ? s.filter((_, idx) => idx !== i) : [BLANK_SOCIAL()]))

  // Splits
  const splitField = (i) => (k, v) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, [k]: v } : l))
  // "Add another artist" pre-fills the REMAINDER — the number the next row
  // almost always is.
  const addArtist = () => setSplits(s => {
    const sum = s.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0)
    const rem = total > sum ? (Math.round((total - sum) * 100) / 100).toFixed(2) : ''
    return [...s, BLANK_SPLIT(rem)]
  })
  const removeArtist = (i) => setSplits(s => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s))
  const addSplitSocial = (i) => () => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: [...l.socials, { handle: '', amount: '' }] } : l))
  const updSplitSocial = (i) => (si, k, v) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.map((so, j) => j === si ? { ...so, [k]: v } : so) } : l))
  const removeSplitSocial = (i) => (si) => setSplits(s => s.map((l, idx) => idx === i ? { ...l, socials: l.socials.filter((_, j) => j !== si) } : l))

  const total = parseFloat(form.amount) || 0
  const allocated = splits.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0)

  // Line items: usable = carries an amount or at least a description. Two or
  // more usable lines TAKE PRECEDENCE over the artist splitter (boom rule) —
  // the invoice is really N small expenses stapled together.
  const usableLines = (lines || []).filter(l => (parseFloat(l.amount) || 0) > 0 || l.description.trim())
  const lineMode = usableLines.length > 1
  const linesSum = Math.round(usableLines.reduce((a, l) => a + (parseFloat(l.amount) || 0), 0) * 100) / 100
  const linesDiff = Math.round((linesSum - total) * 100) / 100
  const hideArtistSong = splitOn || lineMode

  // Social handles metadata — persisted as expenses.social_handles whether or
  // not they carry amounts (amount-ed ones ALSO become split lines).
  const collectSocialHandles = () => {
    if (splitOn) {
      return splits.flatMap(l => (l.socials || [])
        .filter(s => (s.handle || '').trim())
        .map(s => ({ platform: null, handle: s.handle.trim(), artist: (l.artist || '').trim() || null, amount: parseFloat(s.amount) > 0 ? parseFloat(s.amount) : null })))
    }
    return socials.filter(s => s.handle.trim())
      .map(s => ({ platform: s.platform, handle: s.handle.trim(), artist: form.artist.trim() || null, amount: parseFloat(s.amount) > 0 ? parseFloat(s.amount) : null }))
  }

  // Validate the form and build the allocation (artist_breakdown). Throws on
  // the first problem; only sent when it's a real split (multiple artists /
  // line items) or socials carry amounts.
  const validateForm = () => {
    if (!form.payee.trim()) throw new Error(isReimb ? 'Enter who to pay.' : 'Enter the payee.')
    if (!total || total <= 0) throw new Error('Enter a valid amount.')
    if (!form.invoice_date) throw new Error(isReimb ? 'Enter the date.' : 'Enter the invoice date.')
    if (!isReimb && !form.invoice_number.trim()) throw new Error('Enter the invoice number.')
    // Rows without a reachable contact can't get decision or payment emails.
    if (!form.vendor_email.trim()) throw new Error(isReimb ? 'Enter an email for the person being reimbursed.' : 'Enter the vendor email.')
    if (!EMAIL_RE.test(form.vendor_email.trim())) throw new Error('That email address doesn\'t look valid.')
    if (isReimb && !receipts.length) throw new Error('Attach the receipt for this reimbursement.')

    // Non-approver submissions need the attribution an approver would
    // otherwise chase: a song (or splits that carry it) + at least one social.
    if (!isApprover) {
      // Song is an invoice-mode ask (boom's reimb page required only socials).
      if (!isReimb && !splitOn && !lineMode && !form.song.trim()) throw new Error('Enter the song this spend is for (or split it across artists).')
      if (!collectSocialHandles().length) throw new Error('Add at least one social handle for this work.')
    }

    let splitsPayload = null
    if (lineMode) {
      const clean = usableLines.map(l => ({
        artist: (l.artist || '').trim(), song: '', amount: parseFloat(l.amount) || 0,
        category: (l.category || '').trim() || null, description: (l.description || '').trim() || null,
        recoupable: !!l.recoupable, socials: [],
      }))
      if (clean.some(l => !(l.amount > 0))) throw new Error('Every line item needs an amount — remove empty lines or fill them in.')
      if (Math.abs(linesSum - total) > 0.01) throw new Error(`Line items (${linesSum.toFixed(2)}) must tie out to the invoice amount (${total.toFixed(2)}).`)
      splitsPayload = clean
    } else if (splitOn) {
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
    return splitsPayload
  }

  // Reset in place for rapid multi-entry — the success banner up top carries
  // the link to what was just saved.
  const resetForm = () => {
    setForm(initialForm())
    setFiles({ invoice_file: null, w9_file: null, proof_file: null })
    setReceipts([])
    setSocials([BLANK_SOCIAL()])
    setSplitOn(false); setSplits([BLANK_SPLIT(), BLANK_SPLIT()])
    setBulk({ on: false, quantity: '', unit: '' })
    setParsed(false); setDocCheck(null); setDocInvoiceNumber(null)
    setLines(null); setLineMeta(null)
    setW9Check(null); setW9OnFile(null); setVendorSugs([])
    setDupMatch(null); setDupSimilar([])
    setChecks({})
  }

  const submit = async (checklist, force = false) => {
    setSaving(true)
    try {
      const splitsPayload = validateForm()

      const fd = new FormData()
      // When splitting (or in line mode), artist/song live on the allocation
      // rows. Blank them here so the parent container doesn't keep whatever
      // was typed before (the server uses parent.artist / parent.song as the
      // per-child fallback, so a leftover value would leak into the children).
      const skip = new Set(['urgency', 'urgency_reason'])
      Object.entries(form).forEach(([k, v]) => { if (!skip.has(k)) fd.append(k, hideArtistSong && (k === 'artist' || k === 'song') ? '' : v) })
      fd.append('vendor_name', form.payee)
      fd.append('is_reimbursement', isReimb ? 'true' : 'false')
      if (form.urgency !== 'none' && form.payment_status !== 'Paid') {
        fd.append('urgency', form.urgency)
        if (form.urgency_reason.trim()) fd.append('urgency_reason', form.urgency_reason.trim())
      }
      if (bulk.on) {
        fd.append('is_bulk_deal', 'true')
        if (bulk.quantity) fd.append('bulk_deal_quantity', bulk.quantity)
        if (bulk.unit.trim()) fd.append('bulk_deal_unit', bulk.unit.trim())
      }
      const handles = collectSocialHandles()
      if (handles.length) fd.append('social_handles', JSON.stringify(handles))
      if (splitsPayload) fd.append('splits', JSON.stringify(splitsPayload))
      // The completed review, validated server-side BEFORE the insert and
      // stamped onto the row (who/when + answers) when it's created approved.
      if (checklist) fd.append('checklist', JSON.stringify(checklist))
      if (force) fd.append('force_duplicate', 'true')
      for (const key of ['invoice_file', 'w9_file', 'proof_file']) if (files[key]) fd.append(key, files[key])
      receipts.forEach(f => fd.append('receipt_file', f))

      const { data } = await api.post('/ledger/entries', fd, MP)
      setReview(false)
      setSaved({ id: data.data?.id, pending: !!data.data?.pending, split_parts: data.data?.split_parts || 0, reimb: isReimb })
      resetForm()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      // The server's duplicate gate answers 409 with the existing invoice —
      // "Add anyway" resubmits with force_duplicate (checklist preserved, the
      // review is NOT re-asked; nothing about the answers changed).
      if (err.response?.status === 409 && err.response.data?.duplicate) {
        const d = err.response.data.duplicate
        const ok = window.confirm(
          `Invoice #${d.invoice_number || form.invoice_number} already exists as entry #${d.id}`
          + (d.amount != null ? ` — ${Number(d.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${d.currency || ''}` : '')
          + (d.status ? ` (${d.status}${d.payment_status ? `, ${d.payment_status}` : ''})` : '')
          + '.\n\nAdd this one anyway?'
        )
        if (ok) { setSaving(false); return submit(checklist, true) }
      } else {
        toast(err.response?.data?.error || err.message || 'Failed to save', 'error')
      }
    } finally { setSaving(false) }
  }

  const create = async (e) => {
    e.preventDefault()
    if (isApprover) {
      // An approver's save files straight to `approved` — it never reaches the
      // Approvals queue, so THIS is where the checklist gets asked. Validate
      // first so form errors surface before the review opens.
      try { validateForm() } catch (err) { toast(err.message, 'error'); return }
      setChecks({})
      setReview(true)
      return
    }
    // Non-approvers submit straight through: their row lands pending and gets
    // its checklist from the approver in the Approvals queue.
    await submit(null)
  }

  // What the row WILL hold — the review must show what is being confirmed.
  // While splitting (or in line mode), artist/song live on the allocation
  // rows, so their joined values are shown and edited there, not here.
  const reviewValues = {
    artist: splitOn ? splits.map(l => l.artist).filter(Boolean).join(', ')
      : lineMode ? [...new Set(usableLines.map(l => l.artist).filter(Boolean))].join(', ')
      : form.artist,
    song: splitOn ? splits.map(l => l.song).filter(Boolean).join(', ') : lineMode ? '' : form.song,
    amount: form.amount,
    category: checks.cobrand === true ? 'Marketing' : form.category,
  }
  // Edits write through to the form and clear the field's confirmation — the
  // tick must always refer to the value that will be saved.
  const reviewFieldChange = (field, value) => {
    if (hideArtistSong && (field === 'artist' || field === 'song')) { toast(lineMode ? 'Edit artist per line item' : 'Edit artist and song on the split rows', 'error'); return }
    setForm(f => ({ ...f, [field]: value }))
    setChecks(p => { const n = { ...p }; delete n[field]; return n })
  }

  const dupBanner = dupMatch || dupSimilar.length > 0

  return (
    <div className="max-w-3xl">
      <button onClick={() => navigate(isApprover ? '/ledger' : '/')} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-3"><ArrowLeft size={15} /> {isApprover ? 'Ledger' : 'Back'}</button>
      <PageHeader title={isReimb ? 'Add reimbursement' : 'Add invoice'} subtitle={isApprover ? 'Upload and parse an invoice, then review before saving' : 'Upload an invoice — it goes to your bookkeeper for approval'} />

      {/* Success banner — the form resets in place for the next entry. */}
      {saved && (
        <div className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 mb-4 flex items-start gap-2.5 text-sm">
          <CheckCircle2 size={16} className="text-success mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-ink">
            {saved.pending
              ? <>Submitted for approval — a bookkeeper will review it.{isApprover && <> <Link className="font-semibold text-brand-ink hover:underline" to="/approvals">Open Approvals →</Link></>}</>
              : <>{saved.reimb ? 'Reimbursement' : 'Invoice'} saved{saved.split_parts ? ` and split across ${saved.split_parts} lines` : ''}.{isApprover && saved.id && <> <Link className="font-semibold text-brand-ink hover:underline" to={`/ledger?focus=${saved.id}`}>Open in Ledger →</Link></>}</>}
            {' '}The form is ready for the next one.
          </div>
          <button type="button" onClick={() => setSaved(null)} className="text-ink-faint hover:text-ink flex-shrink-0"><X size={14} /></button>
        </div>
      )}

      {/* Duplicate warning — entry-linked and status-aware. Pending entries are
          NOT in the ledger (it lists approved rows only), so the link has to
          say where the existing one actually is. */}
      {dupBanner && (
        <div className="rounded-xl border border-warning/50 bg-warning/10 px-3.5 py-2.5 mb-4 text-xs text-ink">
          <div className="font-bold mb-1 flex items-center gap-1.5 text-warning">
            <AlertTriangle size={13} />
            {dupMatch ? 'Possible duplicate invoice' : 'Similar invoice number already on file'}
          </div>
          {dupMatch && (
            <p>
              Invoice <b>#{form.invoice_number}</b> for <b>{form.payee}</b> already exists as entry <b>#{dupMatch.id}</b>
              {dupMatch.amount != null && <> — {Number(dupMatch.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {dupMatch.currency || ''}</>}
              {dupMatch.child_rows > 0 && <> <b>split across {dupMatch.child_rows + 1} artists</b></>}
              {dupMatch.payment_status && <> ({dupMatch.payment_status})</>}
              {dupMatch.invoice_date && <> · dated {String(dupMatch.invoice_date).slice(0, 10)}</>}
              {dupMatch.status && dupMatch.status !== 'approved' && <> · <b>{dupMatch.status === 'pending' ? 'awaiting approval' : dupMatch.status}</b></>}.
              {isApprover && (dupMatch.status && dupMatch.status !== 'approved'
                ? <> <Link to="/approvals" className="underline font-semibold">Open in Approvals →</Link></>
                : <> <Link to={`/ledger?focus=${dupMatch.id}`} className="underline font-semibold">Open existing entry →</Link></>)}
              {dupMatch.status === 'pending' && (
                <span className="block text-[11px] text-ink-muted mt-0.5">It is not in the ledger yet — the ledger lists approved entries only, which is why searching for it there finds nothing.</span>
              )}
            </p>
          )}
          {!dupMatch && dupSimilar.length > 0 && (
            <ul className="space-y-0.5">
              {dupSimilar.map((inv, i) => (
                <li key={inv?.id || i}>
                  <b>#{inv?.invoice_number}</b>
                  {inv?.amount != null && <> — {Number(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} {inv?.currency || ''}</>}
                  {inv?.payment_status && <> ({inv.payment_status})</>}
                  {inv?.invoice_date && <> · dated {String(inv.invoice_date).slice(0, 10)}</>}
                  <span className="text-ink-muted"> — same number, formatted differently</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={create} className="space-y-5">
        {/* Invoice upload */}
        <div>
          <Dropzone value={files.invoice_file} onChange={onInvoice} accept="application/pdf,image/*" label={<><span className="font-semibold text-brand-600">Choose the invoice</span> or drag it here</>} hint="PDF, JPG, or PNG" />

          {/* Explicit action, matching the /contracts/draft-clause control —
              every parse spends monthly AI quota, so it never fires as an
              upload side effect. Open to every member (the endpoints answer
              any workspace member, same as POST /entries). */}
          {(files.invoice_file || (isReimb && receipts.length > 0)) && (
            <div className="rounded-xl border border-dashed border-rule bg-page/40 p-3 mt-2">
              <div className="flex items-center gap-1.5 mb-2">
                <Sparkles size={14} className="text-brand-600" />
                <span className="text-xs font-semibold text-ink">Fill fields from the {files.invoice_file ? 'invoice' : 'receipt'}</span>
              </div>
              <button type="button" onClick={scanInvoice} disabled={scanning} className="btn-secondary !py-1.5">
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {scanning ? 'Reading the document…' : parsed ? 'Parse again' : 'Parse document'}
              </button>
              <p className="text-[11px] text-ink-faint mt-1.5">
                Parsed values refresh the fields (your later edits stand) and the document is checked + read for line items. AI features require a configured key.
              </p>
            </div>
          )}

          {/* Document gate result — red issues or a green pass chip. */}
          {docCheck && !docCheck.valid && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 mt-2 text-xs text-ink">
              <div className="font-bold text-danger mb-0.5 flex items-center gap-1.5"><AlertTriangle size={13} /> This may not be a usable invoice</div>
              <ul className="list-disc ml-4 space-y-0.5">{docCheck.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {docCheck && docCheck.valid && (
            <p className="text-[11px] font-semibold text-success mt-2 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Looks like a valid invoice{docCheck.billed_to ? ` billed to ${docCheck.billed_to}` : ''}</p>
          )}
        </div>

        {/* Reimbursement toggle */}
        <label className="card px-4 py-3 flex items-center justify-between gap-3 cursor-pointer">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={isReimb} onChange={e => setIsReimb(e.target.checked)} /> <Receipt size={15} className="text-ink-faint" /> This is a reimbursement</span>
          <span className="text-xs text-ink-faint">Reimburses staff for an out-of-pocket expense</span>
        </label>

        {/* Supporting docs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {isReimb ? (
            <div>
              <label className="label">Receipts (required)</label>
              <Dropzone value={null} multiple onChange={fs => setReceipts(prev => [...prev, ...(Array.isArray(fs) ? fs : [fs])].filter(Boolean))} accept="application/pdf,image/*" label={<><span className="font-semibold text-brand-600">Add receipts</span> — you can pick several</>} hint="PDF, JPG, or PNG" />
              {receipts.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-ink-muted">{receipts.length} receipt{receipts.length === 1 ? '' : 's'}</span>
                    <button type="button" onClick={() => setReceipts([])} className="text-[11px] font-semibold text-danger hover:underline">Clear all</button>
                  </div>
                  {receipts.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-ink">
                      <FileText size={12} className="text-brand-600 flex-shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <button type="button" onClick={() => setReceipts(prev => prev.filter((_, j) => j !== i))} className="text-ink-faint hover:text-danger flex-shrink-0"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="label">W9 / W8 form {w9OnFile && !files.w9_file ? <span className="text-success font-semibold normal-case">— already on file</span> : '(optional)'}</label>
              <Dropzone value={files.w9_file} onChange={onW9} accept="application/pdf,image/*" label="Upload W9 / W8" hint={w9OnFile && !files.w9_file ? 'Only upload if updated' : 'PDF, JPG, or PNG'} />
              {w9Check?.checking && <p className="text-[11px] text-ink-muted mt-1.5 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Checking the form…</p>}
              {w9Check && !w9Check.checking && !w9Check.valid && (
                <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 mt-1.5 text-xs text-ink">
                  <div className="font-bold text-danger mb-0.5">W9 issues found</div>
                  <ul className="list-disc ml-4 space-y-0.5">{w9Check.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              )}
              {w9Check && !w9Check.checking && w9Check.valid && (
                <p className="text-[11px] font-semibold text-success mt-1.5 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Looks complete{w9Check.form_type ? ` · ${w9Check.form_type}` : ''}{w9Check.legal_name ? ` · ${w9Check.legal_name}` : ''}</p>
              )}
            </div>
          )}
          <div>
            <label className="label">Proof of payment (optional)</label>
            <Dropzone value={files.proof_file} onChange={onProof} accept="application/pdf,image/*" label="Upload proof" hint={isApprover ? 'Auto-marks as paid' : 'Attached for your bookkeeper'} />
            {proofScanning && <p className="text-[11px] text-ink-muted mt-1.5 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Reading payment details…</p>}
          </div>
        </div>

        {/* Core fields */}
        <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">{isReimb ? 'Date *' : 'Invoice date *'}</label><input type="date" className="input" value={form.invoice_date} onChange={set('invoice_date')} /></div>
          <div>
            <label className="label">{isReimb ? 'Pay to *' : 'Payee *'}</label>
            <input className="input" value={form.payee} onChange={set('payee')} />
            {w9OnFile && !isReimb && (
              <p className="text-[11px] text-success mt-1 inline-flex items-center gap-1"><CheckCircle2 size={11} /> W9 already on file{w9OnFile.vendor && w9OnFile.vendor.toLowerCase() !== form.payee.trim().toLowerCase() ? ` (as ${w9OnFile.vendor})` : ''}</p>
            )}
            {vendorSugs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="text-[11px] text-ink-muted self-center">Did you mean:</span>
                {vendorSugs.map(v => (
                  <button key={v.name} type="button"
                    onClick={() => setForm(f => ({ ...f, payee: v.name, vendor_email: f.vendor_email || v.email || '', vendor_address: f.vendor_address || v.address || '', vendor_bank: f.vendor_bank || v.bank || '' }))}
                    className="text-[11px] font-semibold text-brand-ink bg-brand-500/10 hover:bg-brand-500/15 rounded-full px-2.5 py-1">
                    {v.name} <span className="font-normal text-ink-muted">· {v.invoices} invoice{v.invoices === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div><label className="label">Category</label><select className="input" value={form.category} onChange={set('category')}><option value="">Select category</option><CategoryOptions /></select></div>
          {/* Hidden while splitting / in line mode: the allocation rows below own
              artist + song, and two sets of the same fields on one form reads as
              a bug. The typed values stay in state so switching back restores
              them, but they are NOT submitted (see submit()) — otherwise the
              parent row keeps a stale artist and the split rows silently inherit
              a song nobody can see. */}
          {!hideArtistSong && <div><label className="label">Artist</label><input className="input" value={form.artist} onChange={set('artist')} /></div>}
          {!hideArtistSong && <div><label className="label">Song{!isApprover && !isReimb ? ' *' : ''}</label><input className="input" value={form.song} onChange={set('song')} /></div>}
          <div>
            <label className="label">{isReimb ? 'Invoice / ref # (optional)' : 'Invoice # *'}</label>
            <input className="input" value={form.invoice_number} onChange={set('invoice_number')} />
            {/* Typed-vs-printed cross-check, off the parse's extraction. */}
            {docInvoiceNumber && form.invoice_number && normInv(docInvoiceNumber) !== normInv(form.invoice_number) && (
              <p className="text-[11px] text-warning mt-1 inline-flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> Typed #{form.invoice_number} doesn't match the number on the document (#{docInvoiceNumber})</p>
            )}
          </div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={form.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Payment method</label><select className="input" value={form.payment_method} onChange={set('payment_method')}><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Rep</label>{repOptions.length ? <select className="input" value={form.rep} onChange={set('rep')}><option value="">—</option>{repOptions.map(r => <option key={r}>{r}</option>)}</select> : <input className="input" value={form.rep} onChange={set('rep')} />}</div>
          <div><label className="label">{isReimb ? 'Email *' : 'Vendor email *'}</label><input type="email" className="input" value={form.vendor_email} onChange={set('vendor_email')} placeholder={isReimb ? 'who to notify when it\'s paid' : 'vendor@example.com'} /></div>
          {isApprover && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-page/60 border border-rule px-3 py-2.5">
              <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={form.payment_status === 'Paid'}
                  onChange={e => setForm(f => ({ ...f, payment_status: e.target.checked ? 'Paid' : '', payment_date: e.target.checked ? (f.payment_date || today()) : '', payment_ref: e.target.checked ? f.payment_ref : '' }))} />
                Mark as already paid
              </label>
              {form.payment_status === 'Paid' && (
                <>
                  <span className="inline-flex items-center gap-2 text-sm text-ink-muted">Paid on <input type="date" className="input !w-auto !py-1" value={form.payment_date} onChange={set('payment_date')} /></span>
                  <span className="inline-flex items-center gap-2 text-sm text-ink-muted">Ref # <input className="input !w-40 !py-1" value={form.payment_ref} onChange={set('payment_ref')} placeholder="Check #, wire ref…" /></span>
                </>
              )}
            </div>
          )}

          {/* Urgency — Rush = "expedite this", Hold = "pause this". Mutually
              exclusive; meaningless on a row born Paid, so hidden there (the
              server drops the flags on paid rows anyway). */}
          {form.payment_status !== 'Paid' && (
            <div className="sm:col-span-2">
              <label className="label">Urgency</label>
              <div className="inline-flex rounded-lg border border-rule overflow-hidden">
                {[{ key: 'none', label: 'Normal', Icon: null }, { key: 'rush', label: 'Rush', Icon: Zap }, { key: 'hold', label: 'Hold', Icon: Pause }].map(opt => {
                  const active = form.urgency === opt.key
                  const activeStyle = opt.key === 'rush' ? 'bg-warning/15 text-warning' : opt.key === 'hold' ? 'bg-selected text-ink' : 'bg-page text-ink'
                  return (
                    <button key={opt.key} type="button"
                      onClick={() => setForm(f => ({ ...f, urgency: opt.key, urgency_reason: opt.key === 'none' ? '' : f.urgency_reason }))}
                      className={`px-4 py-1.5 text-sm font-semibold border-r border-rule last:border-r-0 inline-flex items-center gap-1.5 transition-colors ${active ? activeStyle : 'bg-card text-ink-muted hover:bg-page/60'}`}>
                      {opt.Icon && <opt.Icon size={13} fill={active ? 'currentColor' : 'none'} />}
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              {form.urgency !== 'none' && (
                <div className="mt-2">
                  <textarea className="input" rows={2} value={form.urgency_reason}
                    onChange={e => setForm(f => ({ ...f, urgency_reason: e.target.value.slice(0, 500) }))}
                    placeholder={form.urgency === 'rush' ? 'Why is this a rush? (optional) — e.g. Vendor leaving for tour Friday' : 'Why on hold? (optional) — e.g. Waiting on artist confirmation'} />
                  <div className="text-[10px] text-ink-faint text-right mt-0.5">{form.urgency_reason.length}/500</div>
                </div>
              )}
            </div>
          )}

          {/* Bulk-deal marker — quantity + unit only mean something while it's
              on, and they're dropped server-side when it's off. */}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={bulk.on} onChange={e => setBulk(b => ({ ...b, on: e.target.checked }))} />
              <Package size={14} className="text-ink-faint" /> Bulk deal
            </label>
            {bulk.on && (
              <>
                <input type="number" min="1" className="input !w-24 !py-1.5" value={bulk.quantity} onChange={e => setBulk(b => ({ ...b, quantity: e.target.value }))} placeholder="Qty" />
                <input className="input !w-36 !py-1.5" value={bulk.unit} onChange={e => setBulk(b => ({ ...b, unit: e.target.value }))} placeholder="videos, posts…" />
              </>
            )}
          </div>

          <div className="sm:col-span-2"><label className="label">Mailing address</label><input className="input" value={form.vendor_address} onChange={set('vendor_address')} placeholder="Street, City, State, ZIP" /></div>
          <div className="sm:col-span-2"><label className="label">Bank name <span className="text-ink-faint font-normal">— for payment routing</span></label><input className="input" value={form.vendor_bank} onChange={set('vendor_bank')} placeholder="e.g. Chase, Bank of America" /></div>

          {/* Line items — parsed off the document, human-reviewed here. Two or
              more usable lines become the split (they take precedence over the
              artist splitter). */}
          {lines && (
            <div className="sm:col-span-2 rounded-xl border border-rule overflow-hidden">
              <div className="px-3 py-2 bg-page/60 border-b border-rule flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{lines.length} line items</span>
                <span className="text-[11px] text-ink-muted">
                  read by AI{lineMeta?.printed_total != null
                    ? (lineMeta?.reconciles ? ` and checked against the printed total of ${Number(lineMeta.printed_total).toFixed(2)}` : ` — NOT verified: ${lineMeta?.reason || 'totals differ'}`)
                    : ' — no printed total found to verify against'} · correct anything wrong here
                </span>
                <button type="button" onClick={() => { setLines(null); setLineMeta(null) }} className="ml-auto text-[11px] font-semibold text-danger hover:underline">Discard line items</button>
              </div>
              <div className="max-h-80 overflow-y-auto overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-card border-b border-rule">
                    <tr className="text-[10px] uppercase tracking-wide text-ink-muted">
                      <th className="text-left px-2 py-1.5 font-bold">Description</th>
                      <th className="text-left px-2 py-1.5 font-bold w-40">Category</th>
                      <th className="text-left px-2 py-1.5 font-bold w-32">Artist</th>
                      <th className="text-right px-2 py-1.5 font-bold w-24">Amount</th>
                      <th className="text-center px-2 py-1.5 font-bold w-14" title="Recoupable from the artist. Defaults on only when the line names one.">Recoup</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const setLine = (field, value) => setLines(prev => prev.map((x, ix) => ix === i ? { ...x, [field]: value } : x))
                      return (
                        <tr key={l.key} className="border-b border-divider last:border-0">
                          <td className="px-2 py-1"><input className="input !py-1 text-[12.5px]" value={l.description} onChange={e => setLine('description', e.target.value)} /></td>
                          <td className="px-2 py-1"><select className="input !py-1 text-[12.5px]" value={l.category} onChange={e => setLine('category', e.target.value)}><option value="">— pick —</option><CategoryOptions /></select></td>
                          <td className="px-2 py-1"><input className="input !py-1 text-[12.5px]" value={l.artist} placeholder="— none —" onChange={e => setLine('artist', e.target.value)} /></td>
                          <td className="px-2 py-1"><input type="number" step="0.01" className="input !py-1 text-[12.5px] text-right" value={l.amount} onChange={e => setLine('amount', e.target.value)} /></td>
                          <td className="px-2 py-1 text-center"><input type="checkbox" checked={!!l.recoupable} onChange={e => setLine('recoupable', e.target.checked)} /></td>
                          <td className="px-1 py-1 text-center"><button type="button" title="Remove this line" onClick={() => setLines(prev => prev.filter((_, ix) => ix !== i))} className="text-ink-faint hover:text-danger"><Trash2 size={13} /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* THE TIE-OUT. Saving lines that don't add up to the invoice is
                  how a ledger stops reconciling — the save is blocked on it. */}
              <div className="px-3 py-2 bg-page/60 border-t border-rule flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setLines(prev => [...prev, { key: `new-${prev.length}-${Date.now()}`, description: '', category: '', artist: '', amount: '', recoupable: false }])} className="text-[11px] font-semibold text-ink-muted hover:text-brand-ink">+ add line</button>
                  {lineMode && linesDiff !== 0 && (
                    <button type="button" title="Put the difference on the last line so the lines tie to the invoice."
                      onClick={() => setLines(prev => prev.map((l, ix) => ix === prev.length - 1 ? { ...l, amount: (Math.round(((parseFloat(l.amount) || 0) - linesDiff) * 100) / 100).toFixed(2) } : l))}
                      className="text-[11px] font-semibold text-brand-ink hover:underline">put the remainder on the last line</button>
                  )}
                </div>
                <div className="text-xs tabular-nums">
                  <span className="text-ink-muted">lines</span> {linesSum.toFixed(2)}
                  <span className="text-ink-faint"> / invoice </span>{total.toFixed(2)}
                  {linesDiff === 0 && total > 0
                    ? <span className="ml-2 font-bold text-success">ties out</span>
                    : <span className="ml-2 font-bold text-danger">{linesDiff > 0 ? `over by ${linesDiff.toFixed(2)}` : `${Math.abs(linesDiff).toFixed(2)} left`}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Socials (metadata on the row; amount-ed handles also become split lines) */}
          {!splitOn && (
            <div className="sm:col-span-2">
              <label className="label inline-flex items-center gap-1"><AtSign size={12} /> Social handles <span className="text-ink-faint font-normal">— {!isApprover ? 'at least one required' : 'optional, for creator / influencer rows'}</span></label>
              <div className="space-y-2">
                {socials.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select value={s.platform} onChange={socialField(i, 'platform')} className="input !w-auto !py-1.5 text-sm">{SOCIAL_PLATFORMS.map(p => <option key={p}>{p}</option>)}</select>
                    <input value={s.handle} onChange={socialField(i, 'handle')} placeholder="@handle" className="input !py-1.5 text-sm flex-1" />
                    <input type="number" step="0.01" value={s.amount} onChange={socialField(i, 'amount')} placeholder="$" className="input !py-1.5 text-sm !w-24" />
                    <button type="button" onClick={() => removeSocial(i)} className="text-ink-faint hover:text-danger flex-shrink-0"><X size={14} /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-ink hover:underline mt-1.5 inline-flex items-center gap-1"><Plus size={12} /> Add another handle</button>
            </div>
          )}

          {/* Split toggle — line items own the split when present. */}
          {!lineMode && (
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-ink cursor-pointer mt-1"><input type="checkbox" checked={splitOn} onChange={e => setSplitOn(e.target.checked)} /> Split between multiple artists</label>
          )}
          {lineMode && (
            <p className="sm:col-span-2 text-[11px] text-ink-muted">The line items above define the split — each line becomes its own ledger entry. Discard them to split by artist instead.</p>
          )}

          {splitOn && !lineMode && (
            <div className="sm:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">Allocation <span className="font-normal normal-case tracking-normal">— artist &amp; song are set per row</span></span>
                <span className={`text-[11px] font-semibold ${Math.abs(total - allocated) < 0.01 && total > 0 ? 'text-success' : 'text-warning'}`}>Allocated {allocated.toFixed(2)} / {total.toFixed(2)} {form.currency}</span>
              </div>
              {splits.map((l, i) => (
                <SplitRow key={i} index={i} line={l} onField={splitField(i)} onSocial={updSplitSocial(i)} addSocial={addSplitSocial(i)} removeSocial={removeSplitSocial(i)} onRemove={() => removeArtist(i)} canRemove={splits.length > 1} />
              ))}
              <button type="button" onClick={addArtist} className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"><Plus size={13} /> Add another artist</button>
            </div>
          )}

          <div className="sm:col-span-2"><label className="label">Description</label><textarea className="input" rows={2} value={form.description} onChange={set('description')} placeholder={isReimb ? 'What this reimbursement covers' : 'What this invoice is for'} /></div>
          <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
        </div>

        <div className="flex justify-end">
          {/* Blocked mid-parse: the response would otherwise patch a form that
              has already been reset or saved. */}
          <button type="submit" disabled={saving || scanning} className="btn-primary">{saving ? 'Saving…' : isApprover ? (isReimb ? 'Review & save reimbursement' : 'Review & save invoice') : (isReimb ? 'Add reimbursement' : 'Add invoice')}</button>
        </div>
      </form>

      {/* The pre-save review — ApprovalChecklistFields is the SAME card the
          Approvals deck shows, so the checklist means one thing on both
          surfaces. The form's own values are context here, never pre-answers:
          ticking a box on a form is not the same act as answering the question
          that gets stored. */}
      <Modal
        open={review}
        onClose={() => setReview(false)}
        title="Review before saving"
        size="lg"
        footer={<>
          <button type="button" className="btn-secondary" onClick={() => setReview(false)} disabled={saving}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!checklistComplete(checks) || saving}
            onClick={() => submit(checklistPayload(checks))}
            title={checklistComplete(checks) ? 'Save this invoice as approved' : 'Every item has to be answered first'}
          >
            {saving ? 'Saving…' : (isReimb ? 'Save reimbursement' : 'Save invoice')}
          </button>
        </>}
      >
        <p className="text-xs text-ink-muted mb-3">
          This saves straight to the ledger as <b>approved</b>, so the checklist the Approvals queue asks is answered here.
        </p>
        <DocPreview file={files.invoice_file || receipts[0]} />
        <ApprovalChecklistFields
          values={reviewValues}
          checks={checks}
          onCheck={(key, val) => setChecks(p => ({ ...p, [key]: val }))}
          onCobrand={(val) => setChecks(p => answerCobrand(p, val))}
          onFieldChange={reviewFieldChange}
          context={{}}
          disabled={saving}
          fieldKey="add-invoice"
        />
        {!checklistComplete(checks) && (
          <p className="text-[11px] text-ink-faint mt-3">{checklistOutstanding(checks).join(' · ')} still to answer</p>
        )}
      </Modal>
    </div>
  )
}

// Inline blob-URL preview of the not-yet-uploaded document, so the review is a
// comparison against the invoice rather than a memory test.
function DocPreview({ file }) {
  const [show, setShow] = useState(false)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!file || !show) { setUrl(null); return }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, show])
  if (!file) return null
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setShow(v => !v)} className="btn-secondary !py-1.5 text-xs">
        <FileText size={13} /> {show ? 'Hide document' : 'Show document'}
      </button>
      {show && url && (
        file.type === 'application/pdf'
          ? <iframe title="Document preview" src={url} className="w-full h-72 mt-2 rounded-lg border border-rule bg-card" />
          : <img src={url} alt="Document preview" className="max-h-72 mt-2 rounded-lg border border-rule" />
      )}
    </div>
  )
}

function SplitRow({ line, index, onField, onSocial, addSocial, removeSocial, onRemove, canRemove }) {
  return (
    <div className="rounded-xl border border-rule p-3 bg-page/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">Artist {index + 1}</span>
        {canRemove && <button type="button" onClick={onRemove} className="text-ink-faint hover:text-danger"><Trash2 size={13} /></button>}
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
            <button type="button" onClick={() => removeSocial(si)} className="text-ink-faint hover:text-danger flex-shrink-0"><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={addSocial} className="text-[11px] font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"><Plus size={12} /> Add social</button>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, X, Sparkles, Zap, Pencil, FileText, Paperclip, Tag, History, ShieldAlert, ShieldCheck, Split, Mail, Search, Flag, Archive, AlertTriangle, Copy, Plus, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import api from '../api'
import Skeleton from '../components/Skeleton'
import EmailPreviewModal from '../components/EmailPreviewModal'
import { useToast } from '../context/ToastContext'
import { CURRENCIES } from '../constants'
import CategoryOptions from '../components/CategoryOptions'
import ApprovalChecklistDeck from '../components/ApprovalChecklistDeck'
import W9ReviewDeck from '../components/W9ReviewDeck'
import SocialHandlesEditor from '../components/SocialHandlesEditor'
import useEscapeStack from '../hooks/useEscapeStack'

// Severity chips — token-backed tints (raw *-100 fills go near-white in dark).
const SEV = { high: 'bg-red-500/15 text-danger', medium: 'bg-amber-500/15 text-warning', low: 'bg-gray-500/10 text-ink-muted' }
const SCAN_FIELDS = ['payee', 'amount', 'currency', 'invoice_number', 'artist']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const usdFmt = (n) => `≈ USD ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase()
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// "· 2m ago" evidence stamps on scan banners — a finding with no age reads as
// fresh whether it was made a minute or a month ago.
function relativeAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// The AI sometimes reports "no document was provided" as a discrepancy even
// though the file is right there in the same request. Those synthetic claims
// are filtered at render time (boom's isMissingDocClaim) — a real finding
// always names a field like name/amount/date/signature.
function isMissingDocClaim(d) {
  const field = String(d?.field || '').toLowerCase()
  const valueText = `${d?.form_value || ''} ${d?.document_value || ''} ${d?.w9_value || ''}`.toLowerCase()
  const fieldLooksSynthetic = /\b(form|document|image|attachment|tax[_ ]?form)[_ ]?(document|attached|present|provided|missing)?\b/.test(field)
    && !/(name|amount|address|email|invoice[_ ]?number|date|currency|tin|signature|signed|dated)/.test(field)
  const valueIndicatesMissing = /no\s+(form|document|image|invoice|receipt|tax[- ]?form|w[- ]?[89])/.test(valueText)
    || /not\s+(attached|provided|present|available|submitted)/.test(valueText)
    || /missing\s+(form|document|image|invoice|receipt)/.test(valueText)
  return fieldLooksSynthetic || valueIndicatesMissing
}

export default function Approvals() {
  const { toast } = useToast()
  const [list, setList] = useState([])
  const [reps, setReps] = useState([]) // [{name, email}] — email feeds the CC-rep chip
  const [loading, setLoading] = useState(true)
  // −1 on load: `a` must never act on a card nobody has looked at.
  const [focus, setFocus] = useState(-1)
  const [emailItems, setEmailItems] = useState(null)
  const [editId, setEditId] = useState(null)
  const [draft, setDraft] = useState({})
  const [scanning, setScanning] = useState('')
  const [auditFor, setAuditFor] = useState(null)
  const [splitFor, setSplitFor] = useState(null)
  const [aliasFor, setAliasFor] = useState(null)
  const [rejectFor, setRejectFor] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [deckItems, setDeckItems] = useState(null)
  const [w9Data, setW9Data] = useState(null) // { queue, reviewed, no_w9 }
  const [w9DeckOpen, setW9DeckOpen] = useState(false)
  const [activityOn, setActivityOn] = useState(false)
  const [preview, setPreview] = useState(null) // { id, type, filename }
  const [expandedDesc, setExpandedDesc] = useState(() => new Set())
  // Reviewer-staged split rows, per entry — travel in the deck's approve
  // payload (split-before-approve), never as a separate write.
  const [breakdownDrafts, setBreakdownDrafts] = useState({})
  const emailQueue = useRef([])
  // Notify vendor is OPT-IN (boom parity): a decision email is a deliberate
  // act, not a side effect of clearing the queue.
  const [notifyMap, setNotifyMap] = useState({})
  const [q, setQ] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sort, setSort] = useState('new')
  const cardRefs = useRef({})

  const load = () => {
    api.get('/ledger/approvals').then(r => setList(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  const loadW9 = () => {
    api.get('/ledger/w9-reviews').then(r => setW9Data(r.data.data || null)).catch(() => {})
  }
  useEffect(() => { load(); loadW9() }, [])
  useEffect(() => { api.get('/reps').then(r => setReps((r.data.data || []).filter(x => x.name))).catch(() => {}) }, [])

  const willNotify = (en) => !!en.vendor_email && (notifyMap[en.id] ?? false)
  const toggleNotify = (en) => setNotifyMap(m => ({ ...m, [en.id]: !(m[en.id] ?? false) }))
  // CC the entry's rep on vendor decision emails (boom's cc_rep).
  const ccFor = (en) => {
    const rep = reps.find(r => r.name === en.rep)
    return rep?.email ? [rep.email] : []
  }
  const emailCtx = (en, extra = {}) => ({
    to: en.vendor_email, cc: ccFor(en), vendorName: en.vendor_name || en.payee,
    invoiceNumber: en.invoice_number, amount: en.family_amount ?? en.amount, currency: en.currency, ...extra,
  })

  // Staged (cleaned) breakdown for an entry, or null. Given to the deck so the
  // reviewer's corrected split rides in the approve payload.
  const stagedBreakdown = (en) => {
    const rows = breakdownDrafts[en.id]
    if (!Array.isArray(rows)) return null
    const clean = rows
      .map(s => ({ artist: (s.artist || '').trim(), song: (s.song || '').trim() || null, amount: parseFloat(s.amount) || 0 }))
      .filter(s => s.artist && s.amount > 0)
    return clean.length > 1 ? clean : null
  }

  // Approving opens the checklist deck — never a direct status flip. A bypass
  // anywhere makes the checklist optional in practice, so every entry point
  // (row button, `a`, ⇧A, "Review all", "Review selected") routes through here.
  // No window.confirm either: the deck IS the confirm, card by card.
  const openReview = (rows) => {
    if (!rows.length) return
    emailQueue.current = []
    setDeckItems(rows)
  }
  // Vendor emails queue up per approval and drain into EmailPreviewModal once
  // the deck closes (boom's queue-then-drain model — one modal, N emails).
  const onDeckApproved = (en) => {
    if (willNotify(en)) emailQueue.current.push({ kind: 'vendor_approved', label: en.payee, ctx: emailCtx(en) })
  }
  const onDeckPatched = (id, patch) => setList(l => l.map(e => (e.id === id ? { ...e, ...patch } : e)))
  const closeDeck = () => {
    setDeckItems(null)
    setSelected(new Set())
    const queued = emailQueue.current
    emailQueue.current = []
    if (queued.length) setEmailItems(queued)
    load(); loadW9()
  }

  const openFile = async (id, type) => {
    try { const { data } = await api.get(`/ledger/entries/${id}/file/${type}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file', 'error') }
  }
  const rescan = async (en, type) => {
    setScanning(`${en.id}:${type}`)
    try {
      const { data } = await api.post(`/ledger/entries/${en.id}/rescan?type=${type}`)
      // A scan that couldn't run is an answer too — surface why instead of a
      // silent reload that looks like "nothing changed".
      const r = data?.data?.[type === 'w9' ? 'w9' : 'invoice']
      if (r && r.ok === false) toast(`Re-scan: ${r.reason || 'could not run'}`, 'error')
      else toast('Scan complete')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Scan failed', 'error') }
    finally { setScanning('') }
  }
  const dismissScan = async (en, type) => {
    try { await api.post(`/ledger/entries/${en.id}/dismiss-scan`, { type }); toast('Scan dismissed'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  // Per-discrepancy × — optimistic removal, server rebuilds the JSONB array
  // around the one item (summary + scanned_at preserved).
  const dismissDiscrepancy = async (en, type, d) => {
    const col = type === 'w9' ? 'w9_scan' : 'ai_scan'
    setList(l => l.map(e => e.id === en.id && e[col] ? {
      ...e, [col]: { ...e[col], discrepancies: (e[col].discrepancies || []).filter(x => x !== d) },
    } : e))
    try {
      await api.post(`/ledger/entries/${en.id}/dismiss-scan`, {
        type, discrepancy: { field: d.field, form_value: d.form_value ?? null, document_value: d.document_value ?? null },
      })
    } catch (err) { toast(err.response?.data?.error || 'Failed to dismiss', 'error'); load() }
  }
  const patchField = async (en, field, value) => {
    if (String(en[field] ?? '') === String(value ?? '')) return
    try { await api.patch(`/ledger/entries/${en.id}`, { [field]: value }); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const toggleRush = (en) => {
    if (en.rush) { api.delete(`/ledger/entries/${en.id}/rush`).then(load).catch(err => toast(err.response?.data?.error || 'Failed', 'error')) }
    else {
      const reason = window.prompt('Why is this a rush? (optional)')
      if (reason === null) return
      api.post(`/ledger/entries/${en.id}/rush`, { reason: reason.trim() || undefined }).then(load)
        .catch(err => toast(err.response?.data?.error || 'Failed', 'error'))
    }
  }
  // Flag-for-review — optimistic toggle, exact rollback via reload on failure.
  const toggleFlag = async (en) => {
    const next = !en.flagged
    let reason = null
    if (next) {
      reason = window.prompt('Reason for flagging (optional):')
      if (reason === null) return
    }
    setList(l => l.map(e => e.id === en.id ? { ...e, flagged: next, flag_reason: next ? (reason || null) : null } : e))
    try { await api.post(`/ledger/entries/${en.id}/flag`, { flagged: next, flag_reason: reason || undefined }) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); load() }
  }
  // One-click "Use ‘X’" for the unknown-artist / unknown-song banners.
  const applySuggestion = async (en, field, value) => {
    try { await api.patch(`/ledger/entries/${en.id}`, { [field]: value }); toast(`${field === 'artist' ? 'Artist' : 'Song'} set to "${value}"`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const startEdit = (en) => {
    setEditId(en.id)
    setDraft({
      payee: en.payee || '', amount: en.amount || '', currency: en.currency || 'USD',
      invoice_number: en.invoice_number || '', invoice_date: en.invoice_date ? fmtDate(en.invoice_date) : '',
      artist: en.artist || '', song: en.song || '', category: en.category || '', description: en.description || '',
      rep: en.rep || '', vendor_email: en.vendor_email || '', payment_method: en.payment_method || '', notes: en.notes || '',
      social_handles: Array.isArray(en.social_handles) ? en.social_handles.map(s => ({ ...s })) : [],
    })
  }
  const saveEdit = async (en) => {
    // Client-side guards mirroring the server's: a cleared amount must not
    // PATCH '' and a malformed email must not land on the vendor record.
    if (!(parseFloat(draft.amount) > 0)) return toast('Amount must be greater than zero', 'error')
    if (draft.vendor_email.trim() && !EMAIL_RE.test(draft.vendor_email.trim())) return toast('Vendor email looks malformed', 'error')
    try {
      const body = {}
      for (const k of ['payee', 'amount', 'currency', 'invoice_number', 'invoice_date', 'artist', 'song', 'category', 'description', 'rep', 'vendor_email', 'payment_method', 'notes']) {
        if (String(draft[k] ?? '') !== String(k === 'invoice_date' ? fmtDate(en[k]) : (en[k] ?? ''))) body[k] = draft[k]
      }
      // Socials: strip empty rows; always compare against the stored array.
      const socials = (draft.social_handles || []).filter(s => (s.handle || '').trim())
      if (JSON.stringify(socials) !== JSON.stringify(en.social_handles || [])) body.social_handles = socials
      const changed = Object.keys(body)
      if (changed.length) await api.patch(`/ledger/entries/${en.id}`, body)
      if (changed.some(k => SCAN_FIELDS.includes(k)) && (en.invoice_r2_key || en.w9_r2_key)) await api.post(`/ledger/entries/${en.id}/rescan?type=both`).catch(() => {})
      setEditId(null); toast('Saved'); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase()
    let out = list.filter(en => {
      if (repFilter && en.rep !== repFilter) return false
      if (catFilter && en.category !== catFilter) return false
      if (lq && !`${en.payee} ${en.vendor_name || ''} ${en.artist || ''} ${en.invoice_number || ''} ${en.description || ''}`.toLowerCase().includes(lq)) return false
      return true
    })
    const amt = (e) => Number(e.family_amount ?? e.amount ?? 0)
    out = [...out].sort((a, b) => {
      if (sort === 'amount') return amt(b) - amt(a)
      if (sort === 'amount-low') return amt(a) - amt(b)
      const da = new Date(a.created_at), db = new Date(b.created_at)
      return sort === 'old' ? da - db : db - da
    })
    return out
  }, [list, q, repFilter, catFilter, sort])

  // Hotkeys over the filtered list. contentEditable and modifier chords are
  // ignored (⌘A must stay "select all", not "review all").
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (deckItems || w9DeckOpen || preview || emailItems) return
      if (e.key === 'A' && e.shiftKey) { e.preventDefault(); openReview(selected.size ? filtered.filter(x => selected.has(x.id)) : filtered); return }
      if (e.key === 'j') setFocus(f => Math.min(f + 1, filtered.length - 1))
      else if (e.key === 'k') setFocus(f => Math.max(f - 1, 0))
      else if (e.key === 'a' && focus >= 0 && filtered[focus]) openReview([filtered[focus]])
      else if (e.key === 'r' && focus >= 0 && filtered[focus]) setRejectFor(filtered[focus].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line
  useEffect(() => { if (focus >= 0) cardRefs.current[filtered[focus]?.id]?.scrollIntoView({ block: 'nearest' }) }, [focus]) // eslint-disable-line

  const nameMismatch = (en) => en.vendor_name && en.payee && en.vendor_name.trim().toLowerCase() !== en.payee.trim().toLowerCase()
  const toggleSel = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = filtered.length > 0 && filtered.every(e => selected.has(e.id))
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map(e => e.id)))
  const selectedRows = filtered.filter(e => selected.has(e.id))
  const w9QueueCount = w9Data?.queue?.length || 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2">
          Pending Approvals
          {list.length > 0 && <span className="text-sm font-bold bg-emerald-500/15 text-emerald-700 rounded-full px-2 py-0.5">{list.length}</span>}
        </h1>
        <Link to="/approvals/archive" className="btn-secondary !py-1.5 text-xs"><Archive size={13} /> View archive</Link>
      </div>
      <p className="text-sm text-ink-muted mb-5">Review vendor-submitted invoices before they appear in the ledger.</p>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Full-width search on a phone, then the three filters share the row
            two-up. `min-w-[220px]` alone made the search a 220px stub with a
            select crammed beside it at 375px. */}
        <div className="relative w-full sm:flex-1 sm:w-auto sm:min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor, artist, invoice #, description…" className="input !pl-9" />
        </div>
        <select className="input !w-[calc(50%-0.25rem)] sm:!w-auto" value={repFilter} onChange={e => setRepFilter(e.target.value)}><option value="">All reps</option>{reps.map(r => <option key={r.name}>{r.name}</option>)}</select>
        <select className="input !w-[calc(50%-0.25rem)] sm:!w-auto" value={catFilter} onChange={e => setCatFilter(e.target.value)}><option value="">All categories</option><CategoryOptions /></select>
        <select className="input !w-[calc(50%-0.25rem)] sm:!w-auto" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="new">Newest first</option><option value="old">Oldest first</option>
          <option value="amount">Amount: high</option><option value="amount-low">Amount: low</option>
        </select>
        <button onClick={() => setActivityOn(v => !v)} className={`btn-secondary !py-2 text-xs ${activityOn ? '!bg-brand-500/10 text-brand-ink' : ''}`}>
          <History size={13} /> Activity
        </button>
        <span className="flex-1" />
        {w9QueueCount > 0 && (
          <button onClick={() => setW9DeckOpen(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold border border-brand-300 text-brand-ink px-3 py-2 rounded-lg hover:bg-brand-500/10 transition">
            <ShieldCheck size={15} /> Review W9s ({w9QueueCount})
          </button>
        )}
        {filtered.length > 0 && (
          <button onClick={() => openReview(selected.size ? selectedRows : filtered)} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-emerald-600 text-white px-3.5 py-2 rounded-lg hover:bg-emerald-700 transition">
            <Check size={15} /> {selected.size ? `Review selected (${selected.size})` : `Review all ${filtered.length}`}
          </button>
        )}
      </div>

      {/* Bulk-selection bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2.5 mb-4 px-1">
          <label className="inline-flex items-center gap-2 text-xs text-ink-muted cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            Select all {filtered.length}
          </label>
          {selected.size > 0 && (<>
            <span className="text-xs font-semibold text-ink">{selected.size} selected</span>
            <button onClick={() => openReview(selectedRows)} className="text-xs font-semibold text-emerald-700 hover:underline">Review {selected.size}</button>
            <button onClick={() => setSelected(new Set())} className="text-xs text-ink-faint hover:text-ink">Clear</button>
          </>)}
          <span className="flex-1" />
          <span className="text-xs text-ink-faint">{filtered.length} pending{list.length !== filtered.length ? ` of ${list.length}` : ''}</span>
        </div>
      )}

      {activityOn && <ActivityPanel />}

      {loading ? (
        <div className="space-y-3"><Skeleton.Card /><Skeleton.Card /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center"><Check size={30} className="text-emerald-400 mx-auto mb-3" /><p className="text-sm text-ink-muted">{list.length ? 'Nothing matches your filters.' : 'Nothing pending — the queue is clear. 🎉'}</p></div>
      ) : (
        <div className="space-y-4">
          {filtered.map((en, i) => {
            const editing = editId === en.id
            const vendorBreakdown = Array.isArray(en.artist_breakdown) ? en.artist_breakdown : null
            const familyAmt = en.family_amount ?? en.amount
            return (
              <div key={en.id} ref={el => (cardRefs.current[en.id] = el)} onMouseEnter={() => setFocus(i)}
                className={`card p-4 transition-shadow ${i === focus ? 'ring-2 ring-brand-400' : ''} ${en.rush ? 'border-l-4 border-l-amber-500' : ''}`}>
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(en.id)} onChange={() => toggleSel(en.id)} className="mt-2 flex-shrink-0" />
                  <div className="w-9 h-9 rounded-full bg-brand-500/15 flex items-center justify-center flex-shrink-0"><span className="text-sm font-bold text-brand-700">{initial(en.payee)}</span></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-ink truncate">{en.payee}</p>
                      <button onClick={() => toggleFlag(en)}
                        title={en.flagged ? `Flagged${en.flag_reason ? `: ${en.flag_reason}` : ''}${en.flagged_by ? ` — ${en.flagged_by}` : ''} (click to clear)` : 'Flag for review'}
                        className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase rounded px-1.5 py-0.5 border transition ${en.flagged ? 'bg-amber-500/15 border-amber-500/40 text-warning' : 'border-transparent text-ink-faint hover:text-warning'}`}>
                        <Flag size={11} className={en.flagged ? 'fill-current' : ''} />{en.flagged ? 'Flagged' : ''}
                      </button>
                      {en.rush && <span title={`${en.rush_reason ? `${en.rush_reason} — ` : ''}${en.rush_by || ''}${en.rush_at ? ` · ${fmtDate(en.rush_at)}` : ''}`} className="text-[10px] font-bold uppercase text-warning bg-amber-500/15 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Zap size={10} className="fill-current" /> Rush</span>}
                      {en.is_reimbursement && <span className="text-[10px] font-bold uppercase text-violet-700 bg-violet-500/15 rounded px-1.5 py-0.5">Reimb.</span>}
                      {en.off_roster_artist && <span title="The vendor declared this artist is not on the roster" className="text-[10px] font-bold uppercase text-warning bg-amber-500/15 rounded px-1.5 py-0.5">Off-roster</span>}
                    </div>
                    {en.vendor_email && <p className="text-xs text-ink-faint truncate">{en.vendor_email}</p>}
                    <p className="text-sm font-semibold text-brand-ink truncate mt-0.5">{en.artist || 'No artist'}{en.song ? ` — ${en.song}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => patchField(en, 'cobrand', !en.cobrand)} className={`text-[11px] font-bold uppercase rounded-full px-2.5 py-1 border transition ${en.cobrand ? 'bg-brand-600 border-brand-600 text-white' : 'border-brand-300 text-brand-ink hover:bg-brand-500/10'}`}>{en.cobrand ? '✓' : '?'} Cobrand</button>
                    <button onClick={() => patchField(en, 'is_bulk_deal', !en.is_bulk_deal)} className={`text-[11px] font-bold uppercase rounded-full px-2.5 py-1 border transition ${en.is_bulk_deal ? 'bg-teal-600 border-teal-600 text-white' : 'border-teal-500/40 text-teal-600 hover:bg-teal-500/10'}`}>{en.is_bulk_deal ? '✓' : '?'} Bulk deal</button>
                    <div className="text-right ml-1">
                      <p className="font-bold text-rose-500 whitespace-nowrap" title={en.usd_equiv ? usdFmt(en.usd_equiv) : undefined}>
                        {money(familyAmt, en.currency)}
                        {en.split_count > 0 && <span className="ml-1 text-[10px] font-bold text-ink-faint align-middle" title={`Split family total (${en.split_count + 1} lines)`}>×{en.split_count + 1}</span>}
                      </p>
                      {en.usd_equiv != null && en.currency !== 'USD' && <p className="text-[11px] text-ink-faint">{usdFmt(en.usd_equiv)}</p>}
                      <p className="text-[11px] text-ink-faint">{fmtDate(en.invoice_date)}</p>
                    </div>
                  </div>
                </div>

                {/* Bulk-deal qty/unit — inline, save-on-blur, only while the chip is on */}
                {en.is_bulk_deal && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-ink-muted">
                    <span className="font-semibold text-ink-faint uppercase text-[10px]">Bulk</span>
                    <input type="number" min="1" defaultValue={en.bulk_deal_quantity ?? ''} key={`q${en.id}:${en.bulk_deal_quantity ?? ''}`} placeholder="Qty"
                      onBlur={e => { const v = parseInt(e.target.value, 10) || null; if (v !== en.bulk_deal_quantity) patchField(en, 'bulk_deal_quantity', v) }}
                      className="input !py-1 !w-[72px] text-xs" />
                    <input defaultValue={en.bulk_deal_unit ?? ''} key={`u${en.id}:${en.bulk_deal_unit ?? ''}`} placeholder="Unit (videos, posts…)"
                      onBlur={e => { const v = e.target.value.trim() || null; if (v !== (en.bulk_deal_unit ?? null)) patchField(en, 'bulk_deal_unit', v) }}
                      className="input !py-1 !w-[150px] text-xs" />
                  </div>
                )}

                {/* Warning banners */}
                <div className="mt-3 space-y-2">
                  {/* Name mismatch — full banner, vendor-submitted rows only (a
                      hand-entered row carrying a vendor_name is not a claim). */}
                  {en.vendor_submitted && nameMismatch(en) && (
                    <Banner icon={<Flag size={15} className="text-warning mt-0.5 flex-shrink-0" />}>
                      <span className="font-bold">The vendor's name doesn't match the payee.</span>{' '}
                      The form was submitted as <span className="font-semibold">"{en.vendor_name}"</span> but the payee reads{' '}
                      <span className="font-semibold">"{en.payee}"</span>. If it's a DBA, add an alias to silence this.
                    </Banner>
                  )}
                  {/* Unknown artist / song with one-click apply */}
                  {en.unknown_artist && (
                    <Banner icon={<AlertTriangle size={15} className="text-warning mt-0.5 flex-shrink-0" />}>
                      <span className="font-bold">"{en.artist}" isn't on the roster.</span>
                      {en.suggested_artist_name && (<>
                        {' '}Did they mean <span className="font-semibold">{en.suggested_artist_name}</span>?
                        <button onClick={() => applySuggestion(en, 'artist', en.suggested_artist_name)} className="ml-2 text-[11px] font-bold text-brand-ink border border-brand-300 rounded px-2 py-0.5 hover:bg-brand-500/10">Use "{en.suggested_artist_name}"</button>
                      </>)}
                    </Banner>
                  )}
                  {en.unknown_song && (
                    <Banner icon={<AlertTriangle size={15} className="text-warning mt-0.5 flex-shrink-0" />}>
                      <span className="font-bold">"{en.song}" isn't in the catalog.</span>
                      {en.suggested_song_name && (<>
                        {' '}Closest match: <span className="font-semibold">{en.suggested_song_name}</span>{en.suggested_release_artist ? ` (${en.suggested_release_artist})` : ''}.
                        <button onClick={() => applySuggestion(en, 'song', en.suggested_song_name)} className="ml-2 text-[11px] font-bold text-brand-ink border border-brand-300 rounded px-2 py-0.5 hover:bg-brand-500/10">Use "{en.suggested_song_name}"</button>
                      </>)}
                    </Banner>
                  )}
                  {/* Possible duplicates — normalized invoice-number collisions
                      across this vendor's identities. Leading zeros normalize
                      away ("001" and "1" are one number), so a hit is a
                      question, not a verdict. */}
                  {Array.isArray(en.possible_duplicates) && en.possible_duplicates.length > 0 && (
                    <Banner icon={<Copy size={15} className="text-warning mt-0.5 flex-shrink-0" />}>
                      <p className="font-bold mb-1">Invoice #{en.invoice_number} may already be on file.</p>
                      {en.possible_duplicates.map(d => (
                        <p key={d.id} className="flex items-center gap-2">
                          <Link to={`/ledger?focus=${d.id}`} className="font-semibold text-brand-ink hover:underline">#{d.invoice_number} — entry {d.id}</Link>
                          <span>{money(d.amount, en.currency)}</span>
                          {d.invoice_date && <span className="text-ink-faint">{fmtDate(d.invoice_date)}</span>}
                          <span className="text-[10px] uppercase font-bold text-ink-faint">{d.status}</span>
                        </p>
                      ))}
                    </Banner>
                  )}

                  {/* Scan banners */}
                  {['invoice', 'w9'].map(kind => {
                    const hasFile = kind === 'invoice' ? en.invoice_r2_key : (en.w9_r2_key || en.w9_entry_id)
                    if (!hasFile) return null
                    const scan = kind === 'invoice' ? en.ai_scan : en.w9_scan
                    // A W9 covered by another row's file: no scan of its own here.
                    const ownFile = kind === 'invoice' ? en.invoice_r2_key : en.w9_r2_key
                    if (!ownFile && !scan) return null
                    const rawDisc = scan?.discrepancies || []
                    // Synthetic "no document provided" findings are filtered
                    // when the file plainly exists.
                    const disc = ownFile ? rawDisc.filter(d => !isMissingDocClaim(d)) : rawDisc
                    const clean = scan && disc.length === 0
                    const label = kind === 'invoice' ? 'Invoice' : (scan?.form_type || 'W-9')
                    return (
                      <div key={kind} className={`rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${clean ? 'bg-emerald-500/10 border-emerald-500/30' : disc.length ? 'bg-amber-500/10 border-amber-500/30' : 'bg-page/50 border-divider'}`}>
                        {clean ? <Check size={15} className="text-emerald-600 mt-0.5 flex-shrink-0" /> : disc.length ? <ShieldAlert size={15} className="text-warning mt-0.5 flex-shrink-0" /> : <Sparkles size={15} className="text-ink-faint mt-0.5 flex-shrink-0" />}
                        <div className="flex-1 min-w-0 text-[13px]">
                          {!scan ? <span className="text-ink-muted">{label} not scanned yet.</span>
                            : clean ? <span className="text-emerald-800">{label}: all form fields match — no discrepancies detected.</span>
                            : (
                              <div className="space-y-0.5">
                                {disc.map((d, j) => (
                                  <div key={j} className="flex items-start gap-1.5 text-ink group/disc">
                                    <span className={`px-1 rounded text-[9px] font-bold uppercase ${SEV[d.severity] || SEV.low}`}>{d.severity}</span>
                                    <span>{d.field}: "{d.form_value ?? '—'}" vs "{d.document_value ?? d.w9_value ?? '—'}"</span>
                                    <button onClick={() => dismissDiscrepancy(en, kind, d)} title="Dismiss this finding only"
                                      className="opacity-0 group-hover/disc:opacity-100 text-ink-faint hover:text-danger transition-opacity"><X size={12} /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          {scan?.summary && !clean && <p className="italic text-[12px] text-ink-muted mt-1">{scan.summary}</p>}
                          {scan?.scanned_at && <p className="text-[10px] text-ink-faint mt-0.5">scanned · {relativeAgo(scan.scanned_at)}</p>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {ownFile && (
                            <button onClick={() => rescan(en, kind)} disabled={!!scanning} className="text-[11px] font-semibold text-ink-muted border border-rule rounded-md px-2 py-1 hover:bg-page/70">{scanning === `${en.id}:${kind}` ? '…' : scan ? 'Re-scan' : 'Scan'}</button>
                          )}
                          {scan && disc.length > 0 && (
                            <button onClick={() => dismissScan(en, kind)} title="Dismiss the whole scan" className="text-[11px] font-semibold text-ink-muted border border-rule rounded-md px-2 py-1 hover:bg-page/70">Dismiss</button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {/* Payment coordinates cross-check — only the two states worth
                      a human. `match`/`absent`/`unscanned` stay silent: a banner
                      for the expected case would be noise on every row. */}
                  {(en.payment_check?.verdict === 'mismatch' || en.payment_check?.changed_from) && (
                    <div className="rounded-lg border px-3 py-2.5 flex items-start gap-2.5 bg-amber-500/10 border-amber-500/30">
                      <ShieldAlert size={15} className="text-warning mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0 text-[13px] text-ink space-y-1">
                        {en.payment_check.verdict === 'mismatch' && (
                          <p>
                            <span className="font-bold">The bank details on the form don't match the invoice.</span>{' '}
                            Form says <span className="font-semibold">••••{en.payment_check.typed_last4 || '?'}</span>, the invoice says{' '}
                            <span className="font-semibold">••••{en.payment_check.doc_last4 || '?'}</span> ({en.payment_check.method}).
                            Confirm with the vendor on a channel you already trust before paying — redirected-payment fraud looks exactly like this.
                          </p>
                        )}
                        {en.payment_check.changed_from && (
                          <p>
                            <span className="font-bold">This vendor changed their payment details.</span>{' '}
                            We previously held <span className="font-semibold">{en.payment_check.changed_from.method} ••••{en.payment_check.changed_from.last4 || '?'}</span>;
                            this submission gives <span className="font-semibold">{en.payment_check.method} ••••{en.payment_check.typed_last4 || '?'}</span>.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-xs text-ink-muted">
                  <span><span className="font-semibold text-ink-faint uppercase text-[10px] mr-1">Date</span>{fmtDate(en.invoice_date) || '—'}</span>
                  <span className="text-ink-faint">·</span>
                  <span><span className="font-semibold text-ink-faint uppercase text-[10px] mr-1">#</span>{en.invoice_number || '—'}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="inline-flex items-center gap-1"><span className="font-semibold text-ink-faint uppercase text-[10px]">Cat</span>
                    <select value={en.category || ''} onChange={e => patchField(en, 'category', e.target.value)} className="text-xs bg-page/60 border border-rule rounded px-1.5 py-0.5 text-ink cursor-pointer"><option value="">—</option><CategoryOptions /></select>
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span><span className="font-semibold text-ink-faint uppercase text-[10px] mr-1">Rep</span>{en.rep || '—'}</span>
                  {(en.payment_method || en.payment_last4) && (<>
                    <span className="text-ink-faint">·</span>
                    <span><span className="font-semibold text-ink-faint uppercase text-[10px] mr-1">Pay</span>{en.payment_method || '—'}{en.payment_last4 ? ` ••••${en.payment_last4}` : ''}{en.payment_check?.reused_on_file ? ' (on file)' : ''}</span>
                  </>)}
                </div>

                {en.description && (
                  <Description text={en.description} expanded={expandedDesc.has(en.id)}
                    onToggle={() => setExpandedDesc(s => { const n = new Set(s); n.has(en.id) ? n.delete(en.id) : n.add(en.id); return n })} />
                )}

                {/* Files — real filenames, in-app preview. A W9 held on another
                    row still gets a chip here (cross-row coverage). */}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {en.invoice_r2_key && <FileChip icon={<FileText size={13} className="text-amber-500" />} name={en.invoice_filename || 'Invoice'} onClick={() => setPreview({ id: en.id, type: 'invoice', filename: en.invoice_filename })} />}
                  {en.w9_r2_key
                    ? <FileChip icon={<Paperclip size={13} />} name={en.w9_filename || 'W-9'} onClick={() => setPreview({ id: en.id, type: 'w9', filename: en.w9_filename })} />
                    : en.w9_entry_id
                      ? <FileChip icon={<Paperclip size={13} />} name="W-9 (on file)" title="This vendor's W-9 lives on another entry" onClick={() => setPreview({ id: en.w9_entry_id, type: 'w9', filename: 'W-9 on file' })} />
                      : null}
                  {en.receipt_r2_key && <FileChip icon={<Paperclip size={13} />} name={en.receipt_filename || 'Receipt'} onClick={() => setPreview({ id: en.id, type: 'receipt', filename: en.receipt_filename })} />}
                </div>

                {/* Split-before-approve editor. Seeded from the vendor's
                    allocation; the reviewer's rows travel in the deck's approve
                    payload and REPLACE the vendor's split. */}
                {splitFor === en.id && (
                  <SplitEditor
                    entry={en}
                    familyAmount={Number(familyAmt || 0)}
                    vendorBreakdown={vendorBreakdown}
                    rows={breakdownDrafts[en.id]}
                    onChange={rows => setBreakdownDrafts(d => ({ ...d, [en.id]: rows }))}
                  />
                )}

                {/* Alias panel — chips + add + link-as-alias. Every change
                    refetches so read-time silencing clears resolved
                    discrepancies immediately. */}
                {aliasFor === en.id && <AliasPanel en={en} onChanged={load} toast={toast} />}

                {/* Edit-in-place */}
                {editing && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-divider pt-3">
                    <div><label className="label">Payee</label><input className="input !py-1.5" value={draft.payee} onChange={e => setDraft(d => ({ ...d, payee: e.target.value }))} /></div>
                    <div><label className="label">Amount</label><input type="number" step="0.01" className="input !py-1.5" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} /></div>
                    <div><label className="label">Currency</label><select className="input !py-1.5" value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value }))}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="label">Invoice #</label><input className="input !py-1.5" value={draft.invoice_number} onChange={e => setDraft(d => ({ ...d, invoice_number: e.target.value }))} /></div>
                    <div><label className="label">Invoice date</label><input type="date" className="input !py-1.5" value={draft.invoice_date} onChange={e => setDraft(d => ({ ...d, invoice_date: e.target.value }))} /></div>
                    <div><label className="label">Artist</label><input className="input !py-1.5" value={draft.artist} onChange={e => setDraft(d => ({ ...d, artist: e.target.value }))} /></div>
                    <div><label className="label">Song</label><input className="input !py-1.5" value={draft.song} onChange={e => setDraft(d => ({ ...d, song: e.target.value }))} /></div>
                    <div><label className="label">Category</label><select className="input !py-1.5" value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}><option value="">—</option><CategoryOptions /></select></div>
                    <div><label className="label">Rep</label><select className="input !py-1.5" value={draft.rep} onChange={e => setDraft(d => ({ ...d, rep: e.target.value }))}><option value="">—</option>{reps.map(r => <option key={r.name}>{r.name}</option>)}</select></div>
                    <div><label className="label">Vendor email</label><input type="email" className="input !py-1.5" value={draft.vendor_email} onChange={e => setDraft(d => ({ ...d, vendor_email: e.target.value }))} /></div>
                    <div><label className="label">Payment method</label><input className="input !py-1.5" value={draft.payment_method} onChange={e => setDraft(d => ({ ...d, payment_method: e.target.value }))} placeholder="Wire, PayPal…" /></div>
                    <div><label className="label">Notes</label><input className="input !py-1.5" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} /></div>
                    <div className="col-span-2 sm:col-span-4"><label className="label">Description</label><input className="input !py-1.5" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></div>
                    <div className="col-span-2 sm:col-span-4">
                      <label className="label">Social handles</label>
                      <SocialHandlesEditor value={draft.social_handles} currency={draft.currency}
                        onChange={rows => setDraft(d => ({ ...d, social_handles: rows }))} />
                    </div>
                    <div className="col-span-2 sm:col-span-4 flex justify-end"><button onClick={() => saveEdit(en)} className="btn-primary !py-1.5 text-xs">Save</button></div>
                  </div>
                )}

                {auditFor === en.id && <AuditTrail id={en.id} />}

                {/* Inline reject panel — multi-line reason, rule-based notify
                    pre-check (vendor-submitted with an email), busy state. */}
                {rejectFor === en.id && (
                  <RejectPanel en={en}
                    defaultNotify={!!(en.vendor_submitted && en.vendor_email)}
                    onCancel={() => setRejectFor(null)}
                    onDone={(reason, notify) => {
                      setRejectFor(null)
                      if (notify && en.vendor_email) setEmailItems([{ kind: 'vendor_rejected', label: en.payee, ctx: emailCtx(en, { reason }) }])
                      else toast('Rejected')
                      load(); loadW9()
                    }}
                    toast={toast} />
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-divider">
                  <button onClick={() => setSplitFor(splitFor === en.id ? null : en.id)} className={`btn-secondary !py-1.5 text-xs ${stagedBreakdown(en) ? 'text-brand-ink' : ''}`}><Split size={13} /> Split{stagedBreakdown(en) ? ` (${stagedBreakdown(en).length})` : ''}</button>
                  <button onClick={() => (editing ? setEditId(null) : startEdit(en))} className="btn-secondary !py-1.5 text-xs"><Pencil size={13} /> {editing ? 'Close' : 'Edit'}</button>
                  <button onClick={() => setAliasFor(aliasFor === en.id ? null : en.id)} className="btn-secondary !py-1.5 text-xs"><Tag size={13} /> Aliases</button>
                  <button onClick={() => setAuditFor(auditFor === en.id ? null : en.id)} className="btn-secondary !py-1.5 text-xs"><History size={13} /> Audit</button>
                  <button onClick={() => toggleRush(en)} title={en.rush ? `${en.rush_reason ? `${en.rush_reason} — ` : ''}${en.rush_by || ''}` : 'Flag for expedited payment'} className={`btn-secondary !py-1.5 text-xs ${en.rush ? 'text-warning' : ''}`}><Zap size={13} className={en.rush ? 'fill-current' : ''} /> {en.rush ? 'Rush on' : 'Rush'}</button>
                  <span className="flex-1" />
                  {en.vendor_email && <button onClick={() => toggleNotify(en)} title="Email the vendor on decision (off by default — a decision email is a deliberate act)" className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border ${willNotify(en) ? 'border-brand-300 text-brand-ink bg-brand-500/10' : 'border-rule text-ink-faint'}`}><Mail size={14} /> Notify vendor</button>}
                  <button onClick={() => setRejectFor(rejectFor === en.id ? null : en.id)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg border border-red-500/40 text-danger hover:bg-red-500/10"><X size={14} /> Reject</button>
                  <button onClick={() => openReview([en])} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><Check size={14} /> Review</button>
                </div>
              </div>
            )
          })}
          <p className="text-[11px] text-ink-faint text-center pt-1">Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd> review · <kbd>r</kbd> reject · <kbd>⇧A</kbd> review all</p>
        </div>
      )}

      {deckItems && <ApprovalChecklistDeck items={deckItems} onApproved={onDeckApproved} onEntryPatched={onDeckPatched} onClose={closeDeck} breakdownFor={stagedBreakdown} />}
      {w9DeckOpen && w9Data && (
        <W9ReviewDeck items={w9Data.queue}
          onReviewed={(entryId) => setW9Data(d => d ? { ...d, queue: d.queue.filter(c => c.entry_id !== entryId) } : d)}
          onClose={() => { setW9DeckOpen(false); loadW9() }} />
      )}
      {emailItems && <EmailPreviewModal open items={emailItems} onClose={() => setEmailItems(null)} onDone={() => { setEmailItems(null); load() }} />}
      {preview && <FilePreview {...preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function Banner({ icon, children }) {
  return (
    <div className="rounded-lg border px-3 py-2.5 flex items-start gap-2.5 bg-amber-500/10 border-amber-500/30">
      {icon}
      <div className="flex-1 min-w-0 text-[13px] text-ink space-y-0.5">{children}</div>
    </div>
  )
}

// 120-char clamp with more/less — a long description otherwise pushes the
// action row below the fold on every card.
function Description({ text, expanded, onToggle }) {
  const long = text.length > 120
  return (
    <p className="mt-2 text-[13px] text-ink-muted">
      <span className="font-semibold text-ink-faint uppercase text-[10px] mr-1.5">Desc</span>
      {expanded || !long ? text : `${text.slice(0, 120)}…`}
      {long && <button onClick={onToggle} className="ml-1.5 text-[11px] font-semibold text-brand-ink hover:underline">{expanded ? 'less' : 'more'}</button>}
    </p>
  )
}

function FileChip({ icon, name, onClick, title }) {
  const label = String(name || '').length > 30 ? `${String(name).slice(0, 30)}…` : name
  return (
    <button onClick={onClick} title={title || name} className="inline-flex items-center gap-1.5 text-xs bg-page/60 border border-rule rounded-lg px-2.5 py-1.5 text-ink-muted hover:text-brand-ink">
      {icon} {label}
    </button>
  )
}

// In-app document preview — signed URL into an <iframe> (PDF) or <img>. Falls
// back to an open-in-new-tab link for anything else, and degrades gracefully
// when R2 isn't configured (the fetch just fails into the error line).
function FilePreview({ id, type, filename, onClose }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')
  useEscapeStack(true, onClose)
  useEffect(() => {
    api.get(`/ledger/entries/${id}/file/${type}`)
      .then(r => setUrl(r.data.data.url))
      .catch(e => setErr(e.response?.data?.error || 'Could not load the file'))
  }, [id, type])
  const ext = String(filename || '').split('.').pop()?.toLowerCase()
  const isImg = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-3xl p-4 max-h-[92vh] flex flex-col" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-ink truncate">{filename || type}</p>
          <div className="flex items-center gap-3">
            {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><ExternalLink size={12} /> Open in tab</a>}
            <button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-[300px] overflow-auto rounded-lg border border-divider bg-page/50 flex items-center justify-center">
          {err ? <p className="text-sm text-danger p-6">{err}</p>
            : !url ? <p className="text-sm text-ink-faint p-6">Loading…</p>
            : isImg ? <img src={url} alt={filename} className="max-w-full max-h-[75vh] object-contain" />
            : <iframe src={url} title={filename || 'document'} className="w-full h-[75vh]" />}
        </div>
      </div>
    </div>,
    document.body
  )
}

// Editable artist/song/amount split rows, seeded from the vendor's allocation.
// Pure staging — nothing persists until the deck's approve payload carries it.
function SplitEditor({ entry, familyAmount, vendorBreakdown, rows, onChange }) {
  const seeded = rows ?? (vendorBreakdown || []).map(l => ({ artist: l.artist || '', song: l.song || '', amount: l.amount ?? '' }))
  const set = (i, patch) => onChange(seeded.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const total = seeded.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
  const diff = Math.round((familyAmount - total) * 100) / 100
  return (
    <div className="mt-3 rounded-lg bg-page/60 border border-divider p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide">Split before approve</p>
        {vendorBreakdown && rows && (
          <button onClick={() => onChange(undefined)} className="text-[11px] font-semibold text-brand-ink hover:underline">Reset to vendor allocation</button>
        )}
      </div>
      <div className="space-y-1.5">
        {seeded.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={r.artist} onChange={e => set(i, { artist: e.target.value })} placeholder="Artist" className="input !py-1 text-xs flex-1 min-w-0" />
            <input value={r.song || ''} onChange={e => set(i, { song: e.target.value })} placeholder="Song (optional)" className="input !py-1 text-xs flex-1 min-w-0" />
            <input type="number" step="0.01" value={r.amount ?? ''} onChange={e => set(i, { amount: e.target.value })} placeholder="Amount" className="input !py-1 text-xs !w-[100px] flex-shrink-0" />
            <button onClick={() => onChange(seeded.filter((_, j) => j !== i))} className="text-ink-faint hover:text-danger flex-shrink-0" title="Remove"><X size={13} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2">
        <button onClick={() => onChange([...seeded, { artist: '', song: '', amount: '' }])} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline"><Plus size={12} /> Add line</button>
        <p className={`text-[11px] ${Math.abs(diff) < 0.01 ? 'text-success' : 'text-warning'}`}>
          {seeded.length ? `${money(total, entry.currency)} of ${money(familyAmount, entry.currency)}${Math.abs(diff) >= 0.01 ? ` (${diff > 0 ? `${money(diff, entry.currency)} unallocated` : `${money(-diff, entry.currency)} over`})` : ' — balanced'}` : 'No split — approve files a single line.'}
        </p>
      </div>
      <p className="text-[11px] text-ink-faint mt-1.5">
        {seeded.filter(r => (r.artist || '').trim() && parseFloat(r.amount) > 0).length > 1
          ? 'These lines ride in the approve payload and become real ledger splits when you approve.'
          : vendorBreakdown ? 'Vendor allocation shown — it applies automatically on approve unless you change it here.' : 'Add at least two lines to split this invoice on approve.'}
      </p>
    </div>
  )
}

// Alias chips + add + link-as-alias-of-existing-vendor. Changes call onChanged
// (a queue refetch) so read-time alias silencing clears resolved discrepancies
// immediately — no rescan needed.
function AliasPanel({ en, onChanged, toast }) {
  const [aliases, setAliases] = useState(null)
  const [input, setInput] = useState('')
  const [vendors, setVendors] = useState([])
  const [linkTo, setLinkTo] = useState('')
  const loadAliases = () => {
    api.get(`/ledger/vendors/${encodeURIComponent(en.payee)}/aliases`).then(r => setAliases(r.data.data || [])).catch(() => setAliases([]))
  }
  useEffect(() => { loadAliases() }, [en.payee]) // eslint-disable-line
  useEffect(() => { api.get('/ledger/vendors').then(r => setVendors((r.data.data || []).map(v => v.name || v.payee).filter(Boolean))).catch(() => {}) }, [])

  const add = async () => {
    const alias = input.trim()
    if (!alias) return
    try { await api.post(`/ledger/vendors/${encodeURIComponent(en.payee)}/aliases`, { alias }); setInput(''); toast('Alias added'); loadAliases(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const remove = async (id) => {
    try { await api.delete(`/ledger/vendors/aliases/${id}`); loadAliases(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  // The inverse direction: record THIS payee as an alias of an existing vendor
  // (a DBA whose canonical record already exists).
  const linkAsAlias = async () => {
    if (!linkTo) return
    try { await api.post(`/ledger/vendors/${encodeURIComponent(linkTo)}/aliases`, { alias: en.payee }); setLinkTo(''); toast(`"${en.payee}" linked as an alias of ${linkTo}`); loadAliases(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  return (
    <div className="mt-3 rounded-lg bg-page/60 border border-divider p-3">
      <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide mb-2">Aliases of "{en.payee}"</p>
      {aliases === null ? <p className="text-xs text-ink-faint">Loading…</p> : (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {aliases.length === 0 && <span className="text-xs text-ink-faint">No aliases yet.</span>}
          {aliases.map(a => (
            <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-brand-500/10 text-brand-ink rounded-full px-2.5 py-1">
              {a.alias}
              <button onClick={() => remove(a.id)} className="hover:text-danger" title="Remove alias"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Add an alias (Enter)" className="input !py-1.5 text-xs flex-1 min-w-0" />
        <button onClick={add} className="btn-secondary !py-1.5 text-xs">Add</button>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <select value={linkTo} onChange={e => setLinkTo(e.target.value)} className="input !py-1.5 text-xs flex-1 min-w-0">
          <option value="">Or link "{en.payee}" as an alias of an existing vendor…</option>
          {vendors.filter(v => v.trim().toLowerCase() !== String(en.payee || '').trim().toLowerCase()).map(v => <option key={v}>{v}</option>)}
        </select>
        <button onClick={linkAsAlias} disabled={!linkTo} className="btn-secondary !py-1.5 text-xs disabled:opacity-40">Link</button>
      </div>
      <p className="text-[11px] text-ink-faint mt-1.5">Aliases silence name discrepancies immediately — the queue re-reads them on every load, no rescan needed.</p>
    </div>
  )
}

function RejectPanel({ en, defaultNotify, onCancel, onDone, toast }) {
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(defaultNotify)
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    const r = reason.trim()
    if (!r) return toast('A rejection reason is required', 'error')
    setBusy(true)
    try {
      // notify:false always — the page previews the email via
      // EmailPreviewModal instead of letting the server auto-send.
      await api.post(`/ledger/entries/${en.id}/reject`, { reason: r, notify: false })
      onDone(r, notify)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
      <p className="text-[11px] font-bold text-danger uppercase tracking-wide mb-2">Reject this invoice</p>
      <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
        placeholder="Reason for rejection (required — the vendor sees this if you notify them)"
        rows={2} className="input text-sm w-full !py-1.5" />
      <div className="flex items-center gap-3 mt-2">
        <label className={`inline-flex items-center gap-1.5 text-xs ${en.vendor_email ? 'text-ink-muted cursor-pointer' : 'text-ink-faint'}`}>
          <input type="checkbox" checked={notify && !!en.vendor_email} disabled={!en.vendor_email} onChange={e => setNotify(e.target.checked)} />
          Notify vendor{en.vendor_email ? '' : ' (no email on file)'}
        </label>
        <span className="flex-1" />
        <button onClick={onCancel} disabled={busy} className="btn-secondary !py-1.5 text-xs">Cancel</button>
        <button onClick={confirm} disabled={busy || !reason.trim()} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
          {busy ? 'Rejecting…' : 'Confirm rejection'}
        </button>
      </div>
    </div>
  )
}

// The last 50 approve / split / reject / restore actions across the queue —
// who did what, when, to which payee.
const VERB_TONE = { approved: 'text-success', rejected: 'text-danger', split: 'text-brand-ink', restored: 'text-warning', w9_review: 'text-ink-muted' }
function ActivityPanel() {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get('/ledger/approval-history').then(r => setRows(r.data.data || [])).catch(() => setRows([])) }, [])
  return (
    <div className="card p-3 mb-4 max-h-64 overflow-y-auto">
      <p className="text-[11px] font-semibold text-ink-faint uppercase tracking-wide mb-2">Recent approval activity</p>
      {rows === null ? <p className="text-xs text-ink-faint">Loading…</p>
        : rows.length === 0 ? <p className="text-xs text-ink-faint">No approval actions recorded yet.</p>
        : rows.map((r, i) => (
          <p key={i} className="text-xs text-ink-muted py-0.5 truncate">
            <span className="font-semibold text-ink">{r.actor || 'Someone'}</span>{' '}
            <span className={`font-semibold ${VERB_TONE[r.action] || 'text-ink-muted'}`}>{r.action.replace('_', ' ')}</span>{' '}
            {r.payee || (r.expense_id ? `entry #${r.expense_id}` : '')}
            {r.detail ? <span className="text-ink-faint"> · {String(r.detail).slice(0, 80)}</span> : ''}
            <span className="text-ink-faint float-right">{relativeAgo(r.created_at)}</span>
          </p>
        ))}
    </div>
  )
}

function AuditTrail({ id }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get(`/ledger/entries/${id}/bk-audit`).then(r => setRows(r.data.data || [])).catch(() => setRows([])) }, [id])
  return (
    <div className="mt-2 rounded-lg bg-page/60 border border-divider p-2 text-xs">
      {rows === null ? <p className="text-ink-faint">Loading…</p>
        : rows.length === 0 ? <p className="text-ink-faint">No audit history yet.</p>
        : rows.map((r, i) => <p key={i} className="text-ink-muted"><span className="font-semibold text-ink capitalize">{r.action}</span> {r.detail ? `· ${r.detail}` : ''} <span className="text-ink-faint">— {r.actor} · {new Date(r.created_at).toLocaleString()}</span></p>)}
    </div>
  )
}

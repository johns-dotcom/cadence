import { useEffect, useState, useRef, useMemo, Fragment } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Plus, Check, X, Trash2, Paperclip, Link2, BookOpen, DollarSign, Download, Upload, SlidersHorizontal, FileBarChart, Search, Pencil, ChevronRight, ChevronDown, Scissors, Flag, Receipt, RotateCcw, AlertTriangle, Filter, Landmark, Ban, Undo2, GitMerge } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Modal from '../components/ui/Modal'
import BottomSheet from '../components/ui/BottomSheet'
import useDiscardGuard from '../hooks/useDiscardGuard'
import SocialHandlesEditor from '../components/SocialHandlesEditor'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import LedgerEntryDrawer from '../components/LedgerEntryDrawer'
import SplitModal from '../components/SplitModal'
import { formatDate } from '../utils/dates'
import useIsMobile from '../hooks/useIsMobile'
import { PAYMENT_METHODS, CURRENCIES } from '../constants'
import useCategories from '../hooks/useCategories'
import CategoryOptions from '../components/CategoryOptions'
import { dropTarget } from '../utils/drop'
import useHotkeys from '../hooks/useHotkeys'
import BankEvidenceDot from '../components/BankEvidenceDot'

const STATUS_STYLES = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' }
const STATUSES = ['all', 'approved', 'rejected']
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const PAID_CYCLE = { Unpaid: 'Paid', Paid: 'Partial', Partial: 'Unpaid' }
// Colored pills so payment state reads at a glance (matches the Status column).
const PAID_PILL = { Paid: 'bg-emerald-100 text-emerald-700', Partial: 'bg-amber-100 text-amber-700', Unpaid: 'bg-rose-100 text-rose-700' }

// Payment terms to days (mirror of server lib/payments.js TERM_DAYS, so a terms
// edit derives the due date without a round trip).
const TERM_DAYS = { 'Due on receipt': 0, 'Net 7': 7, 'Net 14': 14, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60, 'Net 90': 90 }
const TERM_OPTIONS = [...Object.keys(TERM_DAYS), 'Custom']
const termsDue = (invoiceDate, terms) => {
  const days = TERM_DAYS[terms]
  if (!invoiceDate || days === undefined) return null
  const d = new Date(String(invoiceDate).slice(0, 10)); if (isNaN(d)) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// Client mirror of server lib/normalizeInvoiceNum: the search box matches
// normalized invoice numbers ("INV-0042" finds "#42").
const normInv = (num) => {
  if (!num) return ''
  let s = String(num).toLowerCase().trim(); let prev
  do { prev = s; s = s.replace(/^(invoice|inv|no\.?|#)[\s\-.:]*/i, '') } while (s && s !== prev)
  return s.replace(/[-\s.]/g, '').replace(/^0+/, '')
}

// Amount query to predicate (boom semantics, LED-5): strips $ , and spaces;
// bare "500" = exact match within $0.005; > and < are STRICT; >= / <= are
// supported; "a-b" is inclusive. Returns undefined for empty, null for invalid.
function parseAmountQuery(raw) {
  const s = String(raw || '').replace(/[$,\s]/g, '')
  if (!s) return undefined
  let m
  if ((m = s.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) { const a = +m[1], b = +m[2]; return v => v >= a && v <= b }
  if ((m = s.match(/^>=(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v >= a }
  if ((m = s.match(/^<=(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v <= a }
  if ((m = s.match(/^>(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v > a }
  if ((m = s.match(/^<(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v < a }
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => Math.abs(v - a) < 0.005 }
  return null
}

// Social handles: prefer the persisted social_handles rows (what Approvals and
// campaigns write), then legacy artist_breakdown handles (skipping the
// post-split {origin, splits} snapshot shape), then a "Socials:" note.
function socialsOf(en) {
  const out = []
  const push = (h) => { if (h) out.push(String(h)) }
  try {
    if (Array.isArray(en.social_handles)) for (const s of en.social_handles) push(s?.handle)
    const bd = en.artist_breakdown
    const arr = Array.isArray(bd) ? bd : (Array.isArray(bd?.splits) ? bd.splits : [])
    for (const it of arr) {
      push(it?.handle)
      if (Array.isArray(it?.socials)) for (const s of it.socials) push(s?.handle)
    }
  } catch { /* ignore malformed breakdown */ }
  if (!out.length && typeof en.notes === 'string') {
    const m = en.notes.match(/socials?:\s*([^\n]+)/i)
    if (m) return m[1].trim()
  }
  return out.length ? [...new Set(out)].join(', ') : ''
}
// Due date = invoice date + "Net N" from terms, else the scheduled date.
function dueDateStr(en) {
  const m = String(en.payment_terms || '').match(/(\d+)/)
  if (en.invoice_date && m) {
    const d = new Date(en.invoice_date); d.setDate(d.getDate() + Number(m[1]))
    return formatDate(d.toISOString().slice(0, 10))
  }
  return en.scheduled_payment_date ? formatDate(en.scheduled_payment_date) : ''
}
const usdOf = (en, amt) => {
  const a = Number(amt ?? en.amount) || 0
  if ((en.currency || 'USD') === 'USD') return a
  return en.fx_rate_to_usd ? a / Number(en.fx_rate_to_usd) : null
}
const usdTitle = (en, amt) => {
  const u = usdOf(en, amt)
  return u == null ? undefined : `= USD ${u.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Source buckets (LED-15): one priority resolver shared by the Source column
// badge and the source filter, so they can never disagree.
const sourceOf = (en) =>
  (en.entry_source === 'artist_campaigns' || en.campaign_id) ? 'campaign'
    : en.vendor_submitted ? 'vendor'
    : en.entry_source === 'expense' ? 'expense'
    : (en.entry_source === 'reimbursement' || en.is_reimbursement) ? 'reimb'
    : 'manual'
const SOURCE_META = {
  campaign: { label: 'Campaign', cls: 'bg-violet-500/10 text-violet-600', hint: 'Born on / linked to an artist campaign' },
  vendor: { label: 'Vendor', cls: 'bg-brand-500/10 text-brand-700', hint: 'Submitted through the public vendor form' },
  expense: { label: 'Expense', cls: 'bg-sky-500/10 text-sky-700', hint: 'Quick-added expense (no invoice)' },
  reimb: { label: 'Reimb', cls: 'bg-emerald-500/10 text-emerald-700', hint: 'Reimbursement' },
  manual: { label: 'Manual', cls: 'bg-gray-500/10 text-gray-500', hint: 'Added internally' },
}
const SOURCE_FILTERS = [['', 'Any source'], ['vendor', 'Vendor-submitted'], ['manual', 'Manual'], ['expense', 'Quick expense'], ['campaign', 'Campaign'], ['reimb', 'Reimbursement']]

// ── The two halves of the ledger ────────────────────────────────────────────
//
// One component, two routes — `/ledger` and `/bank-ledger` — exactly as the
// reference app did it. The bank half is not a different table: statement-born
// rows live in `expenses` like every other row, take the same inline edits,
// bulk edits, splits, undo and per-currency totals, and would be a second copy
// of ~1,500 lines of money-editing UI if they got their own page.
//
// What differs is only WHICH rows arrive (`?source=`, server-side), three extra
// columns that mean nothing on an invoice, and the statement lens.
//
// `invoices` is the COMPLEMENT of `bank` server-side, so the two views always
// partition the ledger. "All spend" stays the default on `/ledger`: it is what
// the page has always shown, and narrowing it silently would be a change nobody
// asked for.
const LEDGER_VIEWS = [
  { key: 'all', label: 'All spend', title: 'Everything — invoices plus spend booked straight off a bank statement. This is the ledger total.' },
  { key: 'invoices', label: 'Invoices', title: 'Rows backed by an invoice document: vendor submissions, staff-entered invoices, recoupment and campaign spend.' },
  { key: 'bank', label: 'Bank items', title: 'Rows booked directly from a bank statement — no invoice behind them.' },
]

// A statement, named the way a person thinks of it: the month it covers, then
// the account. `filename` is what the bank called the file, which is unreadable
// in a dropdown and sorts by nothing useful.
function stmtOptionLabel(st) {
  const d = st?.period_end || st?.period_start
  const when = d
    ? new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : String(st?.filename || '').slice(0, 18)
  const acct = String(st?.account || '').toUpperCase()
  return `${when}${acct ? ` · ${acct}` : ''}`
}

// Disposition chips for a bank line with no editable row on this page. The
// vocabulary is the SERVER's (lib/statementLens.js) — the page never re-derives
// it, so there is no second copy of the rule to drift.
const DISPO_CHIP = {
  matched: { label: 'invoice', cls: 'bg-indigo-500/10 text-indigo-600' },
  toconfirm: { label: 'unconfirmed', cls: 'bg-amber-500/10 text-amber-700' },
  booked: { label: 'booked', cls: 'bg-gray-500/10 text-gray-500' },
  'booked-income': { label: 'income', cls: 'bg-emerald-500/10 text-emerald-700' },
  dismissed: { label: 'dismissed', cls: 'bg-gray-500/10 text-gray-500' },
  open: { label: 'open', cls: 'bg-amber-500/15 text-amber-700' },
  'open-credit': { label: 'open', cls: 'bg-amber-500/15 text-amber-700' },
}

const usdMoney = (v) => Number(v || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const DATE_FIELDS = new Set(['invoice_date', 'payment_date', 'scheduled_payment_date', 'qb_entry_date'])
const PAGE = 150      // incremental render window (desktop)
const MOBILE_PAGE = 100

export default function Ledger({ bank = false }) {
  const { toast } = useToast()
  const { label, user } = useAuth()
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const { expense: expenseCats } = useCategories()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const focusId = params.get('focus')

  // Which half, and (on the invoiced route) which cut of it. `bank` is the
  // ROUTE; `view` is the switch inside `/ledger`. Kept in the URL so the switch
  // survives a refresh and can be linked to.
  const view = bank ? 'bank' : (params.get('view') === 'invoices' ? 'invoices' : 'all')
  const source = view === 'all' ? null : view          // null = today's unfiltered fetch
  const setView = (v) => {
    if (v === 'bank') { navigate('/bank-ledger'); return }
    if (bank) { navigate(v === 'invoices' ? '/ledger?view=invoices' : '/ledger'); return }
    setParams(p => { const n = new URLSearchParams(p); if (v === 'invoices') n.set('view', 'invoices'); else n.delete('view'); return n }, { replace: true })
  }

  // ── Statement lens state (bank half only) ────────────────────────────────
  const [statements, setStatements] = useState([])
  const [stmtId, setStmtId] = useState('')
  const [stmtData, setStmtData] = useState(null)   // { statement, transactions, lens }
  const [stmtLoading, setStmtLoading] = useState(false)
  const [direction, setDirection] = useState('out')  // 'out' | 'in' | 'both'
  const [txBusy, setTxBusy] = useState(null)

  // Filters (all client-side over the loaded set for instant response).
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [amountQ, setAmountQ] = useState('')
  const [fCategory, setFCategory] = useState('')
  const [fPaid, setFPaid] = useState('')
  const [fMethod, setFMethod] = useState('')
  const [fSource, setFSource] = useState('')
  const [fFlag, setFFlag] = useState('')       // '' | flagged | unflagged | ai
  // Extra filters (behind "More filters"), matching the richer column set.
  const [moreOpen, setMoreOpen] = useState(false)
  const [fArtist, setFArtist] = useState('')
  const [fRep, setFRep] = useState('')
  const [fCurrency, setFCurrency] = useState('')
  const [fType, setFType] = useState('')       // '' | 'invoice' | 'reimb'
  const [fRecoup, setFRecoup] = useState('')    // '' | 'yes' | 'no'
  const [fCobrand, setFCobrand] = useState('')
  const [fBulk, setFBulk] = useState('')
  const [fUfr, setFUfr] = useState('')
  const [fCampaign, setFCampaign] = useState('')
  const [fQb, setFQb] = useState('')
  const [sort, setSort] = useState({ key: 'invoice_date', dir: 'desc' })
  const [filterSheet, setFilterSheet] = useState(false)

  const [copied, setCopied] = useState(false)
  const importRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [preview, setPreview] = useState(null) // { url, label } for the file pop-up
  const [report1099, setReport1099] = useState(null)
  const [splitEntry, setSplitEntry] = useState(null)     // parent being (re)split
  const [carveEntry, setCarveEntry] = useState(null)     // fee/reimb carve-off
  const [expanded, setExpanded] = useState({})           // { [parentId]: true }
  const [childrenMap, setChildrenMap] = useState({})     // { [parentId]: [rows] }
  const [exportMenu, setExportMenu] = useState(false)
  const [confirmDel, setConfirmDel] = useState(null)     // entry pending delete
  const [flagFor, setFlagFor] = useState(null)           // { en, reason } flag editor
  const [socialsFor, setSocialsFor] = useState(null)     // { en, rows } socials editor
  const [receiptsFor, setReceiptsFor] = useState(null)   // entry whose receipts list is open
  const [dupGroups, setDupGroups] = useState([])         // duplicate-invoice groups (admins)
  const [dupOpen, setDupOpen] = useState(false)
  const [focusMiss, setFocusMiss] = useState(null)       // { id, status } focus target not listed

  // Row selection (LED-1). Held as a Set of ids; every READ re-intersects with
  // the current filtered set, so a filter change can't strand hidden ids.
  const [sel, setSel] = useState(() => new Set())
  const toggleSel = (id) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // Incremental render (LED-9): paint a window, grow it from a sentinel.
  const [renderCap, setRenderCap] = useState(PAGE)
  const [mobileCap, setMobileCap] = useState(MOBILE_PAGE)
  const sentinelRef = useRef(null)

  // Inline edit + 20-deep undo. Stack entries:
  //   { type:'patch', id, old:{field:value,...}, label }
  //   { type:'bulk', field, previous:[{id,value}], label }
  const [editing, setEditing] = useState(null) // { id, key }
  const [draft, setDraft] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [artists, setArtists] = useState([])   // [{id, name}] for profile links
  // Declared here, not beside its fetch effect below: songsByArtist's useMemo
  // dependency array is evaluated during render, so a later const would be in
  // the TDZ and the page would crash on mount.
  const [releases, setReleases] = useState([])
  const artistNames = useMemo(() => artists.map(a => a.name).filter(Boolean), [artists])
  const artistIdByName = useMemo(() => { const m = {}; artists.forEach(a => { if (a.name) m[a.name.toLowerCase()] = a.id }); return m }, [artists])

  const pushUndo = (rec) => setUndoStack(s => [...s.slice(-19), rec])

  // Per-artist song suggestions (boom's per-artist datalists, LED-18): catalog
  // titles + spellings already in the ledger, keyed by lowercase artist.
  const songsByArtist = useMemo(() => {
    const m = new Map()
    const add = (artist, song) => {
      if (!song) return
      const k = (artist || '').toLowerCase()
      if (!m.has(k)) m.set(k, new Set())
      m.get(k).add(song)
    }
    releases.forEach(r => add(r.artist_name || r.artist, r.project_name))
    entries.forEach(e => add(e.artist, e.song))
    return m
  }, [releases, entries])
  const songOptionsFor = (en) => {
    const own = songsByArtist.get((en.artist || '').toLowerCase())
    if (own && own.size) return [...own]
    return [...new Set([...songsByArtist.values()].flatMap(sset => [...sset]))].slice(0, 50)
  }

  const beginEdit = (en, key) => {
    const v = en[key]
    setEditing({ id: en.id, key })
    setDraft(v == null ? '' : DATE_FIELDS.has(key) ? String(v).slice(0, 10) : v)
  }

  // One PATCH, possibly multi-field (terms deriving the due date etc). Optimistic
  // with exact-old-values undo; server splits/links surface through the toast.
  const applyLocal = (id, patch) => {
    setEntries(list => list.map(e => e.id === id ? { ...e, ...patch } : e))
    // Split children live in childrenMap, not entries — patch them there too so
    // an inline edit on a child row (children own their toggles) paints.
    setChildrenMap(m => {
      let changed = false
      const n = {}
      for (const [pid, kids] of Object.entries(m)) {
        n[pid] = kids.map(k => { if (k.id === id) { changed = true; return { ...k, ...patch } } return k })
      }
      return changed ? n : m
    })
  }
  const patchEntry = async (en, patch, labelText) => {
    const old = {}
    Object.keys(patch).forEach(k => { old[k] = en[k] ?? null })
    applyLocal(en.id, patch)
    pushUndo({ type: 'patch', id: en.id, old, label: labelText || `${en.payee}: ${Object.keys(patch)[0]}` })
    try {
      const { data } = await api.patch(`/ledger/entries/${en.id}`, patch)
      if (data.split_parts) { toast(`Split across ${data.split_parts} songs`); load(true) }
      else if (data.linked_release) { toast(`Saved - linked to release "${data.linked_release.name}"`); load(true) }
    } catch (err) { toast(err.response?.data?.error || 'Save failed', 'error'); load(true) }
  }

  const commitEdit = async (en, key, raw) => {
    setEditing(null)
    const val = key === 'amount' ? (raw === '' ? null : Number(raw)) : (raw === '' ? null : raw)
    if (DATE_FIELDS.has(key)) { if (String(en[key] || '').slice(0, 10) === String(val || '')) return }
    else if (String(en[key] ?? '') === String(val ?? '')) return
    const patch = { [key]: val }
    // Terms drive the due date (boom's calcDueDate); a hand-set due date means
    // the terms are Custom (LED-8).
    if (key === 'payment_terms') {
      const due = termsDue(en.invoice_date, val)
      if (due) patch.scheduled_payment_date = due
    }
    if (key === 'scheduled_payment_date' && val) patch.payment_terms = 'Custom'
    // Cobrand spend is Marketing by definition; mirror the server rule locally.
    if (key === 'cobrand' && val === true) patch.category = 'Marketing'
    await patchEntry(en, patch)
  }

  const undoLast = async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack(s => s.slice(0, -1))
    try {
      if (last.type === 'bulk') {
        // Regroup by held value: one call per distinct old value (boom's revertBulk).
        const byVal = new Map()
        for (const p of last.previous) {
          const k = p.value === null || p.value === undefined ? '\u0000null' : String(p.value)
          if (!byVal.has(k)) byVal.set(k, { value: p.value, ids: [] })
          byVal.get(k).ids.push(p.id)
        }
        for (const { value, ids } of byVal.values()) {
          await api.post('/ledger/entries/bulk', { ids, field: last.field, value })
        }
        toast('Bulk edit reverted'); load(true)
      } else {
        applyLocal(last.id, last.old)
        await api.patch(`/ledger/entries/${last.id}`, last.old)
        toast('Reverted')
      }
    } catch { toast('Undo failed', 'error'); load(true) }
  }

  // Props bundle for the module-scope EditCell (keeps its identity stable so
  // the <input> doesn't remount + lose focus/cursor on every keystroke).
  const editProps = { editing, draft, setDraft, commitEdit, beginEdit, setEditing, artistNames, songOptionsFor }

  // -- Toggleable columns, persisted per user+workspace ------------------
  const BASE_COLS = [
    { key: 'invoice_date', label: 'Date', render: en => <EditCell en={en} field="invoice_date" kind="date" display={<span className="text-gray-500 whitespace-nowrap">{formatDate(en.invoice_date)}</span>} {...editProps} /> },
    { key: 'payee', label: 'Payee', render: en => <PayeeCell en={en} onFlag={() => setDrawerEntry(en)} onToggleSplits={toggleExpand} isOpen={!!expanded[en.id]} onUngroup={ungroup} editProps={editProps} /> },
    { key: 'artist', label: 'Artist', render: en => {
      const aid = en.artist ? artistIdByName[en.artist.toLowerCase()] : null
      return <EditCell en={en} field="artist" kind="datalist" display={
        aid ? <Link to={`/artists/${aid}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">{en.artist}</Link>
            : <span className="text-gray-600">{en.artist || '—'}</span>
      } {...editProps} />
    } },
    { key: 'song', label: 'Song', render: en => <EditCell en={en} field="song" kind="song" display={
      en.release_id ? <Link to={`/releases/${en.release_id}`} onClick={e => e.stopPropagation()} className="text-brand-600 hover:underline">{en.song || '—'}</Link>
        : <span className="text-gray-600">{en.song || '—'}</span>
    } {...editProps} /> },
    { key: 'description', label: 'Description', render: en => <EditCell en={en} field="description" display={<span className="text-gray-600 truncate block max-w-[220px]">{en.description || '—'}</span>} {...editProps} /> },
    { key: 'category', label: 'Category', render: en => <EditCell en={en} field="category" kind="select" options={expenseCats} display={<span className="text-gray-600 whitespace-nowrap">{en.category || '—'}</span>} {...editProps} /> },
    { key: 'invoice_number', label: 'Invoice #', render: en => <EditCell en={en} field="invoice_number" display={<span className="text-gray-500 whitespace-nowrap">{en.invoice_number || '—'}</span>} {...editProps} /> },
    { key: 'amount', label: 'Amount', render: en => en.split_count > 0
      ? <span title={usdTitle(en, en.family_amount)} className="text-ink font-semibold whitespace-nowrap tabular-nums">{money(en.family_amount ?? en.amount, en.currency)}<span className="block text-[10px] text-gray-400 font-normal">{money(en.amount, en.currency)} this slice</span></span>
      : <EditCell en={en} field="amount" kind="number" display={<span title={usdTitle(en)} className="text-ink font-semibold whitespace-nowrap tabular-nums">{money(en.amount, en.currency)}</span>} {...editProps} /> },
    { key: 'currency', label: 'Currency', render: en => <EditCell en={en} field="currency" kind="select" options={CURRENCIES} display={<span className="text-gray-500">{en.currency || 'USD'}</span>} {...editProps} /> },
    { key: 'usd', label: '= USD', render: en => {
      const usd = usdOf(en, en.family_amount ?? en.amount)
      return <span className="text-gray-500 whitespace-nowrap tabular-nums">{usd == null ? '—' : `USD ${usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</span>
    } },
    { key: 'status', label: 'Status', render: en => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span> },
    { key: 'payment', label: 'Payment', render: en => en.status === 'approved' && !en.voided
      ? <button onClick={() => cyclePaid(en)} title="Click to cycle" className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${PAID_PILL[en.payment_status] || PAID_PILL.Unpaid}`}>{en.payment_status || 'Unpaid'}</button>
      : <span title={en.voided ? 'Voided' : 'Payment state is set once the entry is approved'} className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold opacity-60 ${PAID_PILL[en.payment_status] || PAID_PILL.Unpaid}`}>{en.payment_status || 'Unpaid'}</span> },
    { key: 'payment_method', label: 'Method', render: en => <EditCell en={en} field="payment_method" kind="select" options={PAYMENT_METHODS} display={<span className="text-gray-500 whitespace-nowrap">{en.payment_method || '—'}</span>} {...editProps} /> },
    { key: 'payment_date', label: 'Paid on', render: en => <EditCell en={en} field="payment_date" kind="date" display={<span className="text-gray-500 whitespace-nowrap">{en.payment_date ? formatDate(en.payment_date) : '—'}</span>} {...editProps} /> },
    { key: 'paid_by', label: 'Paid by', render: en => <EditCell en={en} field="paid_by" display={<span className="text-emerald-600 whitespace-nowrap">{en.paid_by || '—'}</span>} {...editProps} /> },
    { key: 'scheduled_payment_date', label: 'Due date', render: en => {
      const past = en.scheduled_payment_date && en.payment_status !== 'Paid' && String(en.scheduled_payment_date).slice(0, 10) < new Date().toISOString().slice(0, 10)
      return <EditCell en={en} field="scheduled_payment_date" kind="date" display={<span className={`whitespace-nowrap ${past ? 'text-danger font-semibold' : 'text-gray-500'}`}>{en.scheduled_payment_date ? formatDate(en.scheduled_payment_date) : '—'}</span>} {...editProps} />
    } },
    { key: 'rep', label: 'Rep', render: en => <EditCell en={en} field="rep" display={<span className="text-gray-500">{en.rep || '—'}</span>} {...editProps} /> },
    { key: 'vendor_email', label: 'Vendor email', render: en => <EditCell en={en} field="vendor_email" display={<span className="text-gray-500 truncate block max-w-[180px]">{en.vendor_email || '—'}</span>} {...editProps} /> },
    { key: 'vendor_address', label: 'Address', render: en => <EditCell en={en} field="vendor_address" display={<span className="text-gray-500 truncate block max-w-[200px]">{en.vendor_address || '—'}</span>} {...editProps} /> },
    { key: 'vendor_bank', label: 'Bank', render: en => <EditCell en={en} field="vendor_bank" display={<span className="text-gray-500 truncate block max-w-[160px]">{en.vendor_bank || '—'}</span>} {...editProps} /> },
    { key: 'socials', label: 'Socials', render: en => {
      const s = socialsOf(en)
      return <button onClick={() => setSocialsFor({ en, rows: Array.isArray(en.social_handles) ? en.social_handles : [] })} title="Edit social handles" className="text-left text-gray-500 truncate block max-w-[180px] hover:text-brand-600">{s || <span className="text-gray-300">+ add</span>}</button>
    } },
    { key: 'payment_terms', label: 'Terms', render: en => <EditCell en={en} field="payment_terms" kind="select" options={TERM_OPTIONS} display={<span className="text-gray-500 whitespace-nowrap">{en.payment_terms || '—'}</span>} {...editProps} /> },
    { key: 'due', label: 'Due', render: en => { const d = dueDateStr(en); return <span className="text-gray-500 whitespace-nowrap">{d || '—'}</span> } },
    { key: 'recoupable', label: 'Recoup?', render: en => <YNBadge value={!!en.recoupable} onClick={() => commitEdit(en, 'recoupable', !en.recoupable)} /> },
    { key: 'ufr', label: 'UFR?', render: en => en.recoupable
      ? <YNBadge value={!!en.ufr} onClick={() => commitEdit(en, 'ufr', !en.ufr)} title={en.ufr_marked_at ? `Marked ${formatDate(en.ufr_marked_at)}` : 'Un-recouped funds recovered'} />
      : <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-500/10 text-gray-400" title="Not recoupable - UFR does not apply">N/A</span> },
    { key: 'campaign', label: 'Campaign?', render: en => en.campaign_id
      ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-600" title="Linked to a campaign (unlink from the drawer)">Yes</span>
      : <YNBadge value={en.artist_campaign === true ? true : en.artist_campaign === false ? false : null}
          title="Campaign inclusion: Yes, No, auto"
          onClick={() => patchEntry(en, { artist_campaign: en.artist_campaign === true ? false : en.artist_campaign === false ? null : true }, `${en.payee}: campaign`)} /> },
    { key: 'reimbursement', label: 'Reimb?', render: en => <YNBadge value={!!en.is_reimbursement} onClick={() => commitEdit(en, 'is_reimbursement', !en.is_reimbursement)} /> },
    { key: 'cobrand', label: 'Cobrand?', render: en => <YNBadge value={!!en.cobrand} accent onClick={() => commitEdit(en, 'cobrand', !en.cobrand)} title={en.cobrand ? 'Cobrand (forces category Marketing)' : 'Not cobrand'} /> },
    { key: 'is_bulk_deal', label: 'Bulk deal?', render: en => <YNBadge value={!!en.is_bulk_deal} accent onClick={() => commitEdit(en, 'is_bulk_deal', !en.is_bulk_deal)} /> },
    { key: 'in_quickbooks', label: 'QB?', render: en => <YNBadge value={!!en.in_quickbooks} title={en.qb_entry_date ? `Entered in QuickBooks ${formatDate(en.qb_entry_date)}` : 'In QuickBooks?'} onClick={() => patchEntry(en, { in_quickbooks: !en.in_quickbooks, qb_entry_date: !en.in_quickbooks ? new Date().toISOString().slice(0, 10) : null }, `${en.payee}: QB`)} /> },
    { key: 'recoupment_label', label: 'Tone label', render: en => <EditCell en={en} field="recoupment_label" display={<span className="text-gray-500 whitespace-nowrap">{en.recoupment_label || '—'}</span>} {...editProps} /> },
    { key: 'source', label: 'Source', render: en => { const s = SOURCE_META[sourceOf(en)]; return <span title={s.hint} className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${s.cls}`}>{s.label}</span> } },
    { key: 'type', label: 'Type', render: en => <span className="text-gray-500">{en.is_reimbursement ? 'Reimb.' : 'Invoice'}</span> },
    { key: 'approved_by', label: 'Approved by', render: en => <span className="text-gray-500 whitespace-nowrap">{en.approved_by || '—'}</span> },
    { key: 'created_at', label: 'Uploaded', render: en => <span className="text-gray-500 whitespace-nowrap">{en.created_at ? formatDate(en.created_at) : '—'}</span> },
    { key: 'notes', label: 'Notes', render: en => <EditCell en={en} field="notes" display={<span className="text-gray-600 truncate block max-w-[220px]">{en.notes || '—'}</span>} {...editProps} /> },
    { key: 'payment_ref', label: 'Ref', render: en => <EditCell en={en} field="payment_ref" display={<span className="text-gray-500 whitespace-nowrap">{en.payment_ref || '—'}</span>} {...editProps} /> },
    { key: 'invoice_file', label: 'Invoice', render: en => <FileCell en={en} type="invoice" r2key={en.invoice_r2_key} parentFallback openFile={openFile} onChanged={() => load(true)} toast={toast} /> },
    { key: 'w9_file', label: 'W9', render: en => <FileCell en={en} type="w9" r2key={en.w9_r2_key} sharedFromId={!en.w9_r2_key && en.w9_entry_id && en.w9_entry_id !== en.id ? en.w9_entry_id : null} openFile={openFile} onChanged={() => load(true)} toast={toast} /> },
    { key: 'proof_file', label: 'Proof', render: en => <FileCell en={en} type="proof" r2key={en.proof_r2_key} openFile={openFile} onChanged={() => load(true)} toast={toast} /> },
    { key: 'receipt_file', label: 'Receipt', render: en => (en.is_reimbursement || en.receipt_r2_key || en.receipt_count > 0)
      ? <span className="inline-flex items-center gap-1.5">
          <FileCell en={en} type="receipt" r2key={en.receipt_r2_key} openFile={openFile} onChanged={() => load(true)} toast={toast} />
          {(en.receipt_count > 0) && <button onClick={() => setReceiptsFor(en)} className="text-[10px] font-semibold text-brand-600 hover:underline whitespace-nowrap">+{en.receipt_count} more</button>}
        </span>
      : <span className="text-gray-300 text-xs" title="Receipts apply to reimbursements">N/A</span> },
    { key: 'files', label: 'Files', render: en => <FilesCell en={en} openFile={openFile} /> },
  ]

  // ── Bank-only columns ────────────────────────────────────────────────────
  // Offered ONLY on the bank half. On the invoiced one they would be three
  // empty columns and three more toggles in a menu that already has forty.
  // All three read fields the server only computes for ?source=bank; the first
  // two come from lib/bankEvidence.js, which resolves a split child through
  // COALESCE(parent_id, id) so a slice shows its family's line, not nothing.
  const BANK_COLS = !bank ? [] : [
    { key: 'statement', label: 'Statement', render: en => {
      const ev = en.bank_evidence
      if (!ev) return <span className="text-ink-faint text-xs" title="No bank line settles this row — it may have been unmatched, or its statement deleted">—</span>
      return <Link to={`/bank-statements/${ev.statement_id}`} onClick={e => e.stopPropagation()} className="text-brand-ink hover:underline whitespace-nowrap text-xs font-medium">
        {stmtOptionLabel({ period_end: ev.period_start, account: ev.account })}
      </Link>
    } },
    { key: 'bank_line', label: 'Bank line', render: en => {
      const ev = en.bank_evidence
      if (!ev) return <span className="inline-flex items-center gap-1.5"><BankEvidenceDot row={en} /><span className="text-ink-faint text-xs">—</span></span>
      return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <BankEvidenceDot row={en} />
        <span className="text-ink-muted text-xs tabular-nums">{formatDate(ev.txn_date)}</span>
        <span className="text-ink-faint text-[10px] uppercase">{ev.method || ''}</span>
      </span>
    } },
    // "Is an invoice still wanted for this?" — the INVERSE of the stored
    // answer. `no_invoice_expected` means somebody said none is coming; a row
    // nobody has answered still wants one, which is why the default reads Yes.
    { key: 'inv_wanted', label: 'Inv wanted?', render: en => (
      <span title={en.no_invoice_expected
        ? 'Answered on Bank Matching: no invoice is coming for this line'
        : 'Nobody has said an invoice is unnecessary — this line still wants paper'}
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${en.no_invoice_expected ? 'bg-gray-500/10 text-ink-faint' : 'bg-amber-500/15 text-amber-700'}`}>
        {en.no_invoice_expected ? 'No' : 'Yes'}
      </span>
    ) },
  ]
  const COLS = [...BANK_COLS, ...BASE_COLS]
  const ALL_KEYS = COLS.map(c => c.key)
  // Identity columns can't be hidden (boom froze them outright).
  const ALWAYS_ON = ['payee', 'amount']
  // Boom shipped ~16 toggleables ON by default on top of its always-on set (LED-23).
  const DEFAULT_COLS = ['invoice_date', 'payee', 'artist', 'song', 'description', 'category', 'invoice_number', 'amount', 'status', 'payment', 'payment_method', 'vendor_email', 'vendor_bank', 'rep', 'paid_by', 'socials', 'source', 'files']
  // The bank half opens with the SAME columns as the invoiced one (John's call
  // on the reference app: "more similar to the normal ledger"), plus its three.
  // What a bank row never fills is a one-click preset below, not a default —
  // the document cells are where a late-arriving invoice goes, and hiding them
  // means a detour through the menu before you can attach one.
  const BANK_DEFAULT_COLS = ['statement', 'bank_line', 'inv_wanted', ...DEFAULT_COLS]
  // Structurally empty on a statement-born row: it has no invoice number, no
  // document, no vendor contact, nothing was ever scheduled (the money already
  // left), and every row's Source badge says the same thing.
  const BANK_TIDY_HIDDEN = ['invoice_number', 'invoice_file', 'w9_file', 'proof_file', 'receipt_file',
    'vendor_email', 'vendor_address', 'vendor_bank', 'socials', 'payment_terms', 'due',
    'reimbursement', 'cobrand', 'is_bulk_deal', 'campaign', 'source']
  // Separate keys, deliberately: one key would make hiding a column on one half
  // silently rearrange the other, and the two halves want different sets.
  const storeKey = `ledger-cols:${bank ? 'bank:' : ''}${label?.id || 0}:${user?.id || 0}`
  const [visible, setVisible] = useState(bank ? BANK_DEFAULT_COLS : DEFAULT_COLS)
  const [colMenu, setColMenu] = useState(false)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storeKey) || 'null')
      if (Array.isArray(s) && s.length) setVisible([...new Set([...s.filter(k => ALL_KEYS.includes(k)), ...ALWAYS_ON])])
      else setVisible(bank ? BANK_DEFAULT_COLS : DEFAULT_COLS)
    } catch { /* default */ }
  }, [storeKey]) // eslint-disable-line
  // Page hotkeys. The Columns and Export buttons already advertise "(c)" and
  // "(x)" in their tooltips and neither key was wired; `z` is the undo the
  // shortcuts registry has been promising since the inline-edit pass. Declared
  // here because `colMenu`/`exportMenu` are the two toggles it drives, and
  // useHotkeys ignores keystrokes while an input, textarea or select has focus —
  // which is every inline cell edit on this page.
  useHotkeys({
    z: () => undoLast(),
    c: () => { setColMenu(v => !v); setExportMenu(false) },
    x: () => { setExportMenu(v => !v); setColMenu(false) },
  }, [undoStack])

  // One-click preset rather than a default — see BANK_TIDY_HIDDEN.
  const applyBankTidy = () => {
    const n = (bank ? BANK_DEFAULT_COLS : DEFAULT_COLS).filter(k => !BANK_TIDY_HIDDEN.includes(k) || ALWAYS_ON.includes(k))
    localStorage.setItem(storeKey, JSON.stringify(n)); setVisible(n); setColMenu(false)
  }
  const toggleCol = (key) => {
    if (ALWAYS_ON.includes(key)) return
    setVisible(v => { const n = v.includes(key) ? v.filter(k => k !== key) : [...v, key]; localStorage.setItem(storeKey, JSON.stringify(n)); return n })
  }
  const shownCols = COLS.filter(c => visible.includes(c.key))

  const lastFetch = useRef(0)
  const load = (silent = false) => {
    if (!silent) setLoading(true)
    lastFetch.current = Date.now()
    // ?source= is opt-in server-side: 'all' sends nothing and the endpoint
    // behaves exactly as it always has.
    api.get('/ledger/entries', { params: source ? { source } : {} })
      .then(res => setEntries(res.data.data || [])).catch(() => {}).finally(() => { if (!silent) setLoading(false) })
  }
  useEffect(() => { load() }, [source]) // eslint-disable-line

  // The statement list. Bank half only — a statement lens over the invoiced
  // ledger would answer a question that page is not asked.
  const [stmtDenied, setStmtDenied] = useState(false)
  useEffect(() => {
    if (!bank) return
    api.get('/bank-statements')
      .then(r => setStatements((r.data.data || []).filter(st => st.status === 'ready')))
      // The statements API is Admin-only while the ledger itself is Approver+.
      // An Approver still gets the full editable bank half; they just have
      // nothing to tie it against, and the page says so rather than showing an
      // empty dropdown that looks broken.
      .catch(err => { setStatements([]); setStmtDenied(err.response?.status === 403) })
  }, [bank])

  // One statement's lines + its tie-out. `/lens` deliberately, not `/:id`:
  // the detail endpoint re-runs auto-matching on open and carries suggestions,
  // candidates and 12-month category usage. A read-only tie-out should not
  // have a side effect.
  const loadLens = () => {
    if (!bank || !stmtId) { setStmtData(null); return }
    setStmtLoading(true)
    api.get(`/bank-statements/${stmtId}/lens`)
      .then(r => setStmtData(r.data?.data || null))
      .catch(() => setStmtData(null))
      .finally(() => setStmtLoading(false))
  }
  useEffect(() => {
    if (!bank || !stmtId) { setStmtData(null); return }
    let alive = true
    setStmtLoading(true)
    api.get(`/bank-statements/${stmtId}/lens`)
      .then(r => { if (alive) setStmtData(r.data?.data || null) })
      .catch(() => { if (alive) setStmtData(null) })
      .finally(() => { if (alive) setStmtLoading(false) })
    return () => { alive = false }
  }, [bank, stmtId])

  // Act on a TRANSACTION (not a ledger row) from the extra-lines list. Every
  // one of these endpoints already exists — this list is a second door onto
  // Bank Matching's decisions, never a second implementation of them.
  const txAct = async (id, path, body) => {
    setTxBusy(id)
    try { await api.post(`/bank-statements/txns/${id}/${path}`, body || {}); loadLens(); load(true) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setTxBusy(null) }
  }
  useEffect(() => { api.get('/artists').then(r => setArtists((r.data.data || []).filter(a => a.name))).catch(() => {}) }, [])
  useEffect(() => { api.get('/releases').then(r => setReleases(r.data.data || [])).catch(() => {}) }, [])
  // Duplicate-invoice groups (admin endpoint; non-admins just don't see the banner).
  useEffect(() => { api.get('/flags').then(r => setDupGroups(r.data.data?.invoice_dupes || [])).catch(() => {}) }, [])
  // Cross-page edits appear without a reload: silent refetch on window focus,
  // throttled to 10s (boom parity, LED-21).
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastFetch.current > 10000) load(true) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, []) // eslint-disable-line

  // Hotkeys (bubble phase; overlays own Escape via the capture-phase stack):
  // z = undo, c = columns, x = export menu. Ignored while typing.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'z') undoLast()
      if (e.key === 'c') setColMenu(v => !v)
      if (e.key === 'x') setExportMenu(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

  const cyclePaid = async (en) => {
    if (en.status !== 'approved') { toast('Only approved entries take payment state', 'error'); return }
    const next = PAID_CYCLE[en.payment_status] || 'Paid'
    pushUndo({ type: 'patch', id: en.id, old: { payment_status: en.payment_status || 'Unpaid' }, label: `${en.payee}: payment` })
    try {
      if (next === 'Paid') await api.post(`/ledger/entries/${en.id}/mark-paid`, {})   // stamps fx + notify path
      else await api.patch(`/ledger/entries/${en.id}`, { payment_status: next })
      load(true)
    } catch (err) { setUndoStack(s => s.slice(0, -1)); toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const act = async (id, path, body) => { try { await api.post(`/ledger/entries/${id}/${path}`, body || {}); load(true) } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } }
  const reject = async (id) => { const reason = window.prompt('Reason for rejection (required):')?.trim(); if (!reason) return; act(id, 'reject', { reason }) }
  const doDelete = async () => {
    const en = confirmDel; if (!en) return
    try { await api.delete(`/ledger/entries/${en.id}`); setConfirmDel(null); toast('Entry deleted'); load(true) }
    catch { toast('Failed', 'error') }
  }
  function openFile(id, type) { api.get(`/ledger/entries/${id}/file/${type}`).then(({ data }) => setPreview({ url: data.data.url, label: type })).catch(() => toast('No file', 'error')) }

  const saveFlag = async (en, flagged, reason) => {
    setFlagFor(null)
    applyLocal(en.id, { flagged, flag_reason: flagged ? reason : null })
    try { await api.post(`/ledger/entries/${en.id}/flag`, { flagged, flag_reason: reason }) }
    catch { toast('Flag failed', 'error'); load(true) }
  }

  const saveSocials = async () => {
    const { en, rows } = socialsFor
    const clean = rows.filter(r => (r.handle || '').trim())
    setSocialsFor(null)
    await patchEntry(en, { social_handles: clean.length ? clean : null }, `${en.payee}: socials`)
  }

  // Split families: lazily fetch children the first time a parent is expanded.
  const fetchChildren = async (parentId) => {
    try { const { data } = await api.get('/ledger/entries', { params: { parent: parentId } }); setChildrenMap(m => ({ ...m, [parentId]: data.data || [] })); return data.data || [] }
    catch { toast('Could not load splits', 'error'); return [] }
  }
  const toggleExpand = (en) => {
    const open = !expanded[en.id]
    setExpanded(m => ({ ...m, [en.id]: open }))
    if (open && !childrenMap[en.id]) fetchChildren(en.id)
  }
  const unsplit = async (en) => {
    if (!window.confirm(`Merge the ${en.split_count} slices back into ${en.payee}?`)) return
    try { await api.delete(`/ledger/entries/${en.id}/splits`); toast('Unsplit'); setExpanded(m => ({ ...m, [en.id]: false })); setChildrenMap(m => { const n = { ...m }; delete n[en.id]; return n }); load(true) }
    catch (err) { toast(err.response?.data?.error || 'Could not unsplit', 'error') }
  }
  const afterSplit = () => { const id = splitEntry?.id; setSplitEntry(null); if (id) { setChildrenMap(m => { const n = { ...m }; delete n[id]; return n }); setExpanded(m => ({ ...m, [id]: true })) } load(true) }
  const ungroup = async (en) => {
    if (!window.confirm(`Ungroup this payment (${en.settlement_group_size} invoices)? Bank matches are not touched.`)) return
    try { await api.delete(`/ledger/settlement-groups/${en.settlement_group_id}`); toast('Ungrouped'); load(true) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const copyVendorLink = () => {
    const url = `${window.location.origin}/submit/${label?.vendor_form_token}`
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const open1099 = async () => { try { const { data } = await api.get('/ledger/1099-report'); setReport1099(data.data) } catch { toast('Failed to load 1099 report', 'error') } }

  // Export menu (LED-12). Every export carries the current filters: "export
  // what I'm looking at". The ZIPs are capped server-side.
  const exportParams = () => {
    const p = {}
    if (status !== 'all') p.status = status
    if (search.trim()) p.q = search.trim()
    if (fCategory) p.category = fCategory
    if (fPaid) p.payment_status = fPaid
    if (fArtist) p.artist = fArtist
    // The export must contain EXACTLY the page it was launched from. Same
    // ?source= contract as the list — a workbook that disagrees with the screen
    // it came from is worse than no workbook, and this one goes out.
    if (source) p.source = source
    return p
  }
  const download = async (path, filename, type) => {
    setExportMenu(false)
    try {
      const res = await api.get(path, { params: exportParams(), responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], type ? { type } : undefined))
      const a = document.createElement('a'); a.href = url; a.download = filename
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch (err) {
      let msg = 'Export failed'
      if (err.response?.data instanceof Blob) { try { msg = JSON.parse(await err.response.data.text()).error || msg } catch { /* keep default */ } }
      toast(msg, 'error')
    }
  }

  const parseCsv = (text) => {
    const rows = []; let row = []; let field = ''; let inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inQuotes) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') inQuotes = false; else field += c }
      else if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = '' } if (c === '\r' && text[i + 1] === '\n') i++ }
      else field += c
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }
    if (rows.length < 2) return []
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])))
  }
  const onImportFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try { const rows = parseCsv(await file.text()); if (!rows.length) { toast('No rows found in CSV', 'error'); return } const { data } = await api.post('/ledger/import', { rows }); toast(`Imported ${data.data.inserted} entries`); load() }
    catch (err) { toast(err.response?.data?.error || 'Import failed', 'error') }
    finally { setImporting(false); if (importRef.current) importRef.current.value = '' }
  }

  // -- Apply filters + sort client-side ----------------------------------
  // Filter option lists derived from what's actually loaded.
  const distinct = (key) => [...new Set(entries.map(e => e[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  const artistOpts = useMemo(() => distinct('artist'), [entries])
  const repOpts = useMemo(() => distinct('rep'), [entries])
  const currencyOpts = useMemo(() => distinct('currency'), [entries])
  const ynMatch = (mode, val) => mode === '' || (mode === 'yes' ? !!val : !val)
  const advancedActive = fArtist || fRep || fCurrency || fType || fRecoup || fCobrand || fBulk || fUfr || fCampaign || fQb
  const clearAdvanced = () => { setFArtist(''); setFRep(''); setFCurrency(''); setFType(''); setFRecoup(''); setFCobrand(''); setFBulk(''); setFUfr(''); setFCampaign(''); setFQb('') }
  const anyFilter = !!(advancedActive || search || amountQ || fCategory || fPaid || fMethod || fSource || fFlag || status !== 'all')
  const clearAll = () => { clearAdvanced(); setSearch(''); setAmountQ(''); setFCategory(''); setFPaid(''); setFMethod(''); setFSource(''); setFFlag(''); setStatus('all') }

  const amountPredResult = useMemo(() => parseAmountQuery(amountQ), [amountQ])
  const amountInvalid = amountPredResult === null && amountQ.trim() !== ''

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qInv = normInv(q)
    const amt = amountPredResult || null
    let list = entries.filter(en => {
      if (status !== 'all' && en.status !== status) return false
      if (q && !`${en.payee} ${en.artist} ${en.song} ${en.invoice_number}`.toLowerCase().includes(q)
          && !(qInv && normInv(en.invoice_number) && normInv(en.invoice_number).includes(qInv))) return false
      if (amt && !amt(Number(en.amount) || 0) && !amt(Number(en.family_amount) || 0)) return false
      if (fCategory && en.category !== fCategory) return false
      if (fPaid && (en.payment_status || 'Unpaid') !== fPaid) return false
      if (fMethod && en.payment_method !== fMethod) return false
      if (fSource && sourceOf(en) !== fSource) return false
      if (fFlag === 'flagged' && !en.flagged) return false
      if (fFlag === 'unflagged' && en.flagged) return false
      if (fFlag === 'ai' && !((en.ai_flags || 0) + (en.w9_flags || 0))) return false
      // Advanced filters
      if (fArtist && en.artist !== fArtist) return false
      if (fRep && en.rep !== fRep) return false
      if (fCurrency && (en.currency || 'USD') !== fCurrency) return false
      if (fType === 'invoice' && en.is_reimbursement) return false
      if (fType === 'reimb' && !en.is_reimbursement) return false
      if (!ynMatch(fRecoup, en.recoupable)) return false
      if (!ynMatch(fCobrand, en.cobrand)) return false
      if (!ynMatch(fBulk, en.is_bulk_deal)) return false
      if (!ynMatch(fUfr, en.ufr)) return false
      if (!ynMatch(fQb, en.in_quickbooks)) return false
      if (!ynMatch(fCampaign, en.campaign_id || en.artist_campaign === true)) return false
      // The statement lens narrows the LEDGER rows too. Without this, picking
      // June would show June's unbooked lines beside every month's booked ones,
      // and the tie-out header would sit above a row set that is not the month
      // it describes. bank_evidence.statement_id is the row's own line,
      // resolved through the family root — the same join the extras list uses.
      if (stmtId && String(en.bank_evidence?.statement_id ?? '') !== String(stmtId)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    // Empties always sink to the end (boom rule); id is the tiebreaker.
    list = [...list].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key]
      if (sort.key === 'amount') { av = Number(a.family_amount ?? av) || 0; bv = Number(b.family_amount ?? bv) || 0 }
      const ae = av == null || av === '', be = bv == null || bv === ''
      if (ae && be) return b.id - a.id
      if (ae) return 1
      if (be) return -1
      const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv))
      return cmp * dir || b.id - a.id
    })
    return list
  }, [entries, status, search, amountPredResult, fCategory, fPaid, fMethod, fSource, fFlag, fArtist, fRep, fCurrency, fType, fRecoup, fCobrand, fBulk, fUfr, fQb, fCampaign, sort, stmtId])

  // Reset the paint window when the result set changes shape.
  useEffect(() => { setRenderCap(PAGE); setMobileCap(MOBILE_PAGE) }, [status, search, amountQ, fCategory, fPaid, fMethod, fSource, fFlag, fArtist, fRep, fCurrency, fType, fRecoup, fCobrand, fBulk, fUfr, fQb, fCampaign, sort, stmtId])
  const shownRows = filtered.slice(0, renderCap)

  // Sentinel: grow the window as it nears the viewport.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || renderCap >= filtered.length) return
    const ob = new IntersectionObserver((es) => { if (es.some(x => x.isIntersecting)) setRenderCap(c => c + PAGE) }, { rootMargin: '600px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [renderCap, filtered.length, loading, isMobile])

  const totals = useMemo(() => {
    const t = {}
    let usdSum = 0, unconverted = 0
    // Use family_amount so a split parent contributes its whole family (its
    // slice + hidden children), never just the parent's slice.
    filtered.filter(e => !e.voided).forEach(e => {
      const amt = Number(e.family_amount ?? e.amount) || 0
      t[e.currency || 'USD'] = (t[e.currency || 'USD'] || 0) + amt
      const u = usdOf(e, amt)
      if (u == null) unconverted++; else usdSum += u
    })
    // Currencies ordered by magnitude (boom parity, LED-22).
    const ordered = Object.entries(t).sort((a, b) => b[1] - a[1])
    return { ordered, usdSum, unconverted, multi: ordered.length > 1 || (ordered[0] && ordered[0][0] !== 'USD') }
  }, [filtered])
  // ── The statement lens ───────────────────────────────────────────────────
  //
  // Ledger rows on this half, by the transaction they settle. `bank_evidence`
  // resolves through COALESCE(parent_id, id), so a split child maps to its
  // family's line — right, because one bank line should be one row here.
  //
  // Built from the FILTERED set, not all entries: a line whose row the current
  // filters hide has no row ON SCREEN, and must therefore appear in the extras
  // list rather than vanishing from a page that claims to account for the month.
  const rowByTxn = useMemo(() => {
    const m = new Map()
    for (const e of filtered) { const t = e.bank_evidence?.txn_id; if (t != null && !m.has(t)) m.set(t, e) }
    return m
  }, [filtered])
  const lens = stmtData?.lens || null
  // The set difference. `disposition` is the SERVER's answer
  // (lib/statementLens.js) — the page never re-derives it, so there is no
  // second copy of the money rule here to drift from the first.
  const extraTx = useMemo(() => {
    const list = stmtData?.transactions || []
    const wantOut = direction === 'out' || direction === 'both'
    const wantIn = direction === 'in' || direction === 'both'
    return list
      .filter(t => {
        const isCredit = t.direction === 'credit'
        if (isCredit ? !wantIn : !wantOut) return false
        return !(t.disposition === 'booked' && rowByTxn.has(t.id))
      })
      .sort((a, b) => String(b.txn_date || '').localeCompare(String(a.txn_date || '')))
  }, [stmtData, rowByTxn, direction])

  const totalsLine = totals.ordered.map(([c, a]) => `${c} ${a.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join('   ') || '—'
  const totalsUsd = totals.multi ? ` = USD ${totals.usdSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${totals.unconverted ? ` (+${totals.unconverted} unconverted)` : ''}` : ''

  // -- Selection, re-read against the current filters ---------------------
  const selectedRows = useMemo(() => filtered.filter(e => sel.has(e.id)), [filtered, sel])
  const shownIds = useMemo(() => new Set(shownRows.map(r => r.id)), [shownRows])
  const selBelow = selectedRows.filter(r => !shownIds.has(r.id)).length
  const selUsd = selectedRows.reduce((a, r) => a + (usdOf(r, r.family_amount ?? r.amount) || 0), 0)
  const allSelected = filtered.length > 0 && selectedRows.length === filtered.length
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(filtered.map(r => r.id)))
  const headerCbRef = useRef(null)
  useEffect(() => { if (headerCbRef.current) headerCbRef.current.indeterminate = selectedRows.length > 0 && !allSelected }, [selectedRows.length, allSelected])

  const bulkApply = async (field, value) => {
    const ids = selectedRows.map(r => r.id)
    if (!ids.length) return
    try {
      const { data } = await api.post('/ledger/entries/bulk', { ids, field, value })
      const d = data.data
      pushUndo({ type: 'bulk', field, previous: d.previous, label: `bulk ${field} x ${d.changed}` })
      toast(`${d.changed} changed${d.already ? `, ${d.already} already` : ''}${d.skipped ? `, ${d.skipped} skipped` : ''}${d.relinked ? `, ${d.relinked} linked to releases` : ''}`)
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Bulk edit failed', 'error') }
  }
  const groupSelection = async () => {
    const ids = selectedRows.map(r => r.id)
    try { const { data } = await api.post('/ledger/settlement-groups', { ids }); toast(`Grouped ${data.data.size} invoices as one payment`); setSel(new Set()); load(true) }
    catch (err) { toast(err.response?.data?.error || 'Could not group', 'error') }
  }

  const setSortKey = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  // -- ?focus deep link (LED-10) ------------------------------------------
  // Row present: spotlight. Absent: fetch it; a split child expands its
  // parent first; a pending/missing row gets an explanatory banner. The URL
  // param is stripped once handled so a reload doesn't re-spotlight.
  const rowRefs = useRef({})
  const focusHandled = useRef(null)
  const spotlight = (el) => {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('ring-2', 'ring-amber-400')
    setTimeout(() => { el.classList.remove('ring-2', 'ring-amber-400'); setParams(p => { const n = new URLSearchParams(p); n.delete('focus'); return n }, { replace: true }) }, 6000)
  }
  useEffect(() => {
    if (!focusId || loading || focusHandled.current === focusId) return
    const idx = filtered.findIndex(e => String(e.id) === focusId)
    if (idx >= renderCap) { setRenderCap(idx + 20); return }   // stretch the paint window to it
    const el = rowRefs.current[focusId]
    if (el) { focusHandled.current = focusId; spotlight(el); return }
    focusHandled.current = focusId
    api.get(`/ledger/entries/${focusId}`).then(async ({ data }) => {
      const row = data.data
      if (row.parent_id) {
        setExpanded(m => ({ ...m, [row.parent_id]: true }))
        await fetchChildren(row.parent_id)
        setTimeout(() => { const kel = rowRefs.current[focusId]; if (kel) spotlight(kel) }, 300)
        return
      }
      // ── The row might be in the OTHER half ──────────────────────────────
      // ?focus= is linked from a dozen places, and a great many of those ids
      // are bank-created entries. Fixed HERE rather than at every call site,
      // so a link written anywhere lands in the right half without knowing
      // which half that is. `xhalf` caps it at ONE hop — redirecting on
      // "not found" without a marker would bounce a genuinely unknown id
      // between the two pages forever.
      // Only the NARROWED views can be the wrong half. "All spend" excludes
      // nothing, so a row missing there is missing for a different reason
      // (pending, deleted, another workspace) and must not be bounced.
      const wrongHalf = source === 'bank' ? row.entry_source !== 'bank_statement'
        : source === 'invoices' ? row.entry_source === 'bank_statement'
        : false
      if (wrongHalf && !params.get('xhalf')) {
        focusHandled.current = null
        navigate(`${bank ? '/ledger' : '/bank-ledger'}?focus=${focusId}&xhalf=1`, { replace: true })
        return
      }
      setFocusMiss({ id: focusId, status: row.status, otherHalf: wrongHalf })
    }).catch(() => setFocusMiss({ id: focusId, status: null }))
  }, [focusId, loading, entries, renderCap]) // eslint-disable-line

  // First-cell prefix: selection checkbox + manual flag button (boom kept both
  // inside the frozen region).
  const firstCellPrefix = (en) => (
    <span className="inline-flex items-center gap-1 mr-1.5 align-top">
      <input type="checkbox" checked={sel.has(en.id)} onChange={() => toggleSel(en.id)} onClick={e => e.stopPropagation()} className="mt-0.5" />
      <button
        onClick={(e) => { e.stopPropagation(); setFlagFor({ en, reason: en.flag_reason || '' }) }}
        title={en.flagged ? `Flagged by ${en.flagged_by || '—'}${en.flag_reason ? `: ${en.flag_reason}` : ''}` : 'Flag for review'}
        className={en.flagged ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}>
        <Flag size={13} fill={en.flagged ? 'currentColor' : 'none'} />
      </button>
    </span>
  )

  return (
    <div>
      <PageHeader
        title={bank ? 'Bank Ledger' : 'Ledger'}
        subtitle={bank
          ? 'Spend booked straight off a bank statement — no invoice behind it'
          : 'Expenses and vendor payments'}
        action={
          <div className="flex items-center gap-2">
            {bank && <Link to="/bank-matching" className="btn-secondary" title="Decide what an unanswered bank line should become"><GitMerge size={15} /> Bank Matching</Link>}
            {!bank && <button onClick={open1099} className="btn-secondary"><FileBarChart size={15} /> 1099</button>}
            <div className="relative">
              <button onClick={() => setExportMenu(v => !v)} className="btn-secondary" title="Export (x)"><Download size={15} /> Export</button>
              {exportMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-60 card p-1.5 shadow-modal" onMouseLeave={() => setExportMenu(false)}>
                  <button onClick={() => download('/ledger/export-xlsx', `ledger-${label?.slug || 'export'}.xlsx`)} className="w-full text-left px-2.5 py-1.5 text-sm text-ink hover:bg-brand-500/10 rounded">Excel workbook <span className="block text-[10px] text-gray-400">All + Unpaid + Paid tabs, family totals</span></button>
                  <button onClick={() => download('/ledger/export', `ledger-${label?.slug || 'export'}.csv`, 'text/csv')} className="w-full text-left px-2.5 py-1.5 text-sm text-ink hover:bg-brand-500/10 rounded">CSV</button>
                  <button onClick={() => download('/ledger/export-invoices-zip', 'invoices.zip')} className="w-full text-left px-2.5 py-1.5 text-sm text-ink hover:bg-brand-500/10 rounded">Invoices ZIP <span className="block text-[10px] text-gray-400">Files matching the current filters</span></button>
                  <button onClick={() => download('/ledger/export-w9s-zip', 'w9s.zip')} className="w-full text-left px-2.5 py-1.5 text-sm text-ink hover:bg-brand-500/10 rounded">W9s ZIP</button>
                </div>
              )}
            </div>
            {/* The creation paths all make an INVOICED row. Offering them here
                would file the new entry onto the other half, which reads as the
                button doing nothing. */}
            {!bank && <>
              <button onClick={() => importRef.current?.click()} disabled={importing} className="btn-secondary"><Upload size={15} /> {importing ? 'Importing…' : 'Import'}</button>
              <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImportFile} />
              <button onClick={copyVendorLink} className="btn-secondary">{copied ? <><Check size={15} /> Copied</> : <><Link2 size={15} /> Vendor form link</>}</button>
              <button onClick={() => setQuickOpen(true)} className="btn-secondary"><Plus size={16} /> Add expense</button>
              <Link to="/ledger/new-reimbursement" className="btn-secondary"><Plus size={16} /> Add reimbursement</Link>
              <Link to="/ledger/new-invoice" className="btn-primary"><Plus size={16} /> Add invoice</Link>
            </>}
          </div>
        }
      />

      {/* Duplicate-invoice banner (LED-14): live groups from /flags (admins). */}
      {dupGroups.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-500/10 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            <AlertTriangle size={15} className="text-amber-600 flex-shrink-0" />
            <span className="text-ink font-medium">{dupGroups.length} potential duplicate invoice group{dupGroups.length === 1 ? '' : 's'}</span>
            <span className="text-gray-500">review and delete the wrong copy, or dismiss the group if it&apos;s legit.</span>
            <button onClick={() => setDupOpen(v => !v)} className="text-xs font-semibold text-amber-700 hover:underline">{dupOpen ? 'Hide' : 'Show'}</button>
            <Link to="/duplicates" className="text-xs font-semibold text-brand-600 hover:underline ml-auto">Manage on Duplicates page</Link>
          </div>
          {dupOpen && (
            <div className="mt-2 space-y-1">
              {dupGroups.slice(0, 12).map(g => (
                <div key={g.flag_key} className="text-xs text-gray-600 flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${g.severity === 'high' ? 'bg-red-500/10 text-red-600' : g.severity === 'medium' ? 'bg-amber-500/15 text-amber-700' : 'bg-gray-500/10 text-gray-500'}`}>{g.severity}</span>
                  <span className="font-medium text-ink">{g.vendor}</span> #{g.number}
                  {(g.items || []).map(it => (
                    <Link key={it.id} to={`/ledger?focus=${it.id}`} onClick={() => { setFocusMiss(null); focusHandled.current = null }} className="text-brand-600 hover:underline">#{it.id} ({money(it.amount, it.currency)})</Link>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ?focus miss banner */}
      {focusMiss && (
        <div className="mb-3 rounded-lg border border-rule bg-page/60 px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap">
          <span className="text-ink">Entry #{focusMiss.id} is not in this ledger view.</span>
          {focusMiss.otherHalf
            ? <span className="text-gray-500">It lives on the <Link to={bank ? '/ledger' : '/bank-ledger'} className="text-brand-600 hover:underline font-semibold">{bank ? 'invoiced' : 'bank'} half</Link>, and both halves were already checked.</span>
            : focusMiss.status === 'pending'
            ? <span className="text-gray-500">The ledger lists approved entries; it&apos;s waiting in <Link to={`/approvals?focus=${focusMiss.id}`} className="text-brand-600 hover:underline font-semibold">Approvals</Link>.</span>
            : focusMiss.status === null
              ? <span className="text-gray-500">It may have been deleted, or it lives in another workspace.</span>
              : <span className="text-gray-500">Its status is &quot;{focusMiss.status}&quot;; check the status chips or the <Link to="/ledger/archive" className="text-brand-600 hover:underline">archive</Link>.</span>}
          <button onClick={() => setFocusMiss(null)} className="ml-auto text-gray-400 hover:text-ink"><X size={15} /></button>
        </div>
      )}

      {/* ── The two halves ─────────────────────────────────────────────────
          A segmented control rather than a filter chip: this is a change of
          PAGE (the server sends a different row set), and dressing it as a
          filter would suggest the rows are all still here. */}
      <div role="tablist" aria-label="Ledger half" className="inline-flex items-center gap-0.5 p-0.5 mb-3 rounded-lg bg-elev border border-rule">
        {LEDGER_VIEWS.map(v => (
          <button key={v.key} role="tab" aria-selected={view === v.key} title={v.title}
            onClick={() => setView(v.key)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md transition ${view === v.key ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* ── The statement lens: what the month did, and whether it adds up ──
          A bank ledger's whole job. The balances are the statement's own
          printed figures, captured at upload, so this reports a proven fact
          rather than re-deriving one. */}
      {bank && (
        <div className="card p-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Landmark size={15} className="text-ink-muted flex-shrink-0" />
            <select className="input !w-auto" value={stmtId} onChange={e => setStmtId(e.target.value)}
              title="Narrow the ledger to one statement, and tie that month out line by line">
              <option value="">All statements — no tie-out</option>
              {statements.map(st => <option key={st.id} value={st.id}>{stmtOptionLabel(st)}</option>)}
            </select>
            {stmtId && (
              <select className="input !w-auto" value={direction} onChange={e => setDirection(e.target.value)} title="Which side of the statement the line list covers">
                <option value="out">Money out</option>
                <option value="in">Money in</option>
                <option value="both">Both</option>
              </select>
            )}
            {stmtId && <button onClick={() => setStmtId('')} className="text-xs font-semibold text-ink-muted hover:text-ink">Clear</button>}
            {!statements.length && (stmtDenied
              ? <span className="text-xs text-ink-faint">The statement tie-out is Admin-only — the rows below are still fully editable.</span>
              : <span className="text-xs text-ink-faint">No ready statements — upload one on <Link to="/bank-statements" className="text-brand-ink hover:underline">Bank Statements</Link>.</span>)}
          </div>

          {stmtId && stmtLoading && !lens && <div className="text-xs text-ink-faint mt-2">Reading the statement…</div>}

          {stmtId && lens && (() => {
            const side = direction === 'in' ? lens.moneyIn : lens.moneyOut
            const DISPO = [
              ['booked', 'booked here', 'text-ink'],
              ['matched', 'matched to an invoice', 'text-ink-muted'],
              ['toconfirm', 'matched, not yet confirmed paid', 'text-amber-700'],
              ['creator', 'creator payments', 'text-ink-muted'],
              ['booked-income', 'booked as income', 'text-emerald-600'],
              ['dismissed', 'dismissed', 'text-ink-faint'],
              ['open', 'still open', 'text-amber-700'],
              ['open-credit', 'still open', 'text-amber-700'],
            ]
            return (
              <>
                <div className="flex items-baseline gap-3 flex-wrap mt-2.5">
                  <span className="text-[13px] font-bold text-ink">{stmtOptionLabel(lens.statement)}</span>
                  <span className="text-[11px] text-ink-faint tabular-nums">
                    {String(lens.statement.period_start || '').slice(0, 10)} – {String(lens.statement.period_end || '').slice(0, 10)}
                  </span>
                  {lens.hasBalances ? (
                    <span className="text-[11.5px] text-ink-muted tabular-nums">
                      opened <b className="text-ink">{usdMoney(lens.begin)}</b>
                      {' · '}in <b className="text-emerald-600">{usdMoney(lens.moneyIn.usd)}</b>
                      {' · '}out <b className="text-ink">{usdMoney(lens.moneyOut.usd)}</b>
                      {' · '}closed <b className="text-ink">{usdMoney(lens.end)}</b>{' '}
                      {lens.ties
                        ? <span className="text-emerald-600 font-extrabold" title="Beginning + credits − debits equals the closing balance the statement prints, to the cent.">✓ ties</span>
                        : <span className="text-danger font-extrabold" title="These rows do not add up to the statement's printed closing balance. The parser reconciles at upload, so drift here means rows changed afterwards.">off by {usdMoney(Math.abs(lens.drift))}</span>}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-ink-faint" title="This account's statements are parsed without beginning and ending balances, so there is nothing to tie the rows against. Not a discrepancy.">
                      no balances on this statement — nothing to tie against
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-wrap mt-2">
                  <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">
                    money {direction === 'in' ? 'in' : 'out'} · {side.n} line{side.n === 1 ? '' : 's'} · {usdMoney(side.usd)}
                  </span>
                  {DISPO.map(([k, lbl, cls]) => {
                    const v = side.by[k]
                    if (!v) return null
                    return <span key={k} className={`text-[11px] tabular-nums ${cls}`}>{v.n} {lbl} <span className="text-ink-faint">{usdMoney(v.usd)}</span></span>
                  })}
                  {direction === 'both' && <span className="text-[11px] text-ink-faint">· in and out are subtotalled apart, never netted</span>}
                  {lens.moneyIn.by['open-credit']?.n > 0 && direction !== 'in' && (
                    <button onClick={() => setDirection('in')} className="text-[11px] font-bold text-amber-700 underline decoration-dotted underline-offset-2"
                      title="Credits with no answer yet — not booked as income, not dismissed as a transfer">
                      {lens.moneyIn.by['open-credit'].n} credit{lens.moneyIn.by['open-credit'].n === 1 ? '' : 's'} unanswered
                    </button>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search payee, artist, song, invoice #" className="input !pl-9" />
        </div>
        {!isMobile && <>
          <input value={amountQ} onChange={e => setAmountQ(e.target.value)}
            placeholder="Amount: 500 or >1000" title={amountInvalid ? 'Amount filter not understood; try 500, 500-1000, >500 or <=500' : 'Exact: 500. Range: 500-1000. Compare: >500, <=500'}
            className={`input !w-48 ${amountInvalid ? '!border-amber-400 !ring-1 !ring-amber-400' : ''}`} />
          <select className="input !w-auto" value={fCategory} onChange={e => setFCategory(e.target.value)}><option value="">All categories</option><CategoryOptions /></select>
          <select className="input !w-auto" value={fPaid} onChange={e => setFPaid(e.target.value)}><option value="">Any payment</option><option>Unpaid</option><option>Partial</option><option>Paid</option></select>
          <select className="input !w-auto" value={fMethod} onChange={e => setFMethod(e.target.value)}><option value="">Any method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select>
          <select className={`input !w-auto ${fSource ? '!border-brand-300 text-brand-700' : ''}`} value={fSource} onChange={e => setFSource(e.target.value)}>{SOURCE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className={`input !w-auto ${fFlag ? '!border-amber-400 text-amber-700' : ''}`} value={fFlag} onChange={e => setFFlag(e.target.value)}>
            <option value="">Flag: any</option><option value="flagged">Flagged</option><option value="unflagged">Unflagged</option><option value="ai">AI discrepancies</option>
          </select>
          <button onClick={() => setMoreOpen(v => !v)} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${advancedActive ? 'bg-brand-500/10 text-brand-700 border-brand-300' : 'text-gray-500 hover:bg-gray-100 border-rule'}`}>More filters{advancedActive ? ' •' : ''}</button>
          {anyFilter && <button onClick={clearAll} title="Clear every filter" className="text-xs font-semibold px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 border border-rule">Clear</button>}
          <div className="relative">
            <button onClick={() => setColMenu(v => !v)} className="btn-secondary" title="Toggle columns (c)"><SlidersHorizontal size={15} /> Columns</button>
            {colMenu && (
              <div className="absolute right-0 top-full mt-1 z-30 w-52 max-h-[60vh] overflow-y-auto card p-2 shadow-modal" onMouseLeave={() => setColMenu(false)}>
                {COLS.map(c => (
                  <label key={c.key} className={`flex items-center gap-2 px-2 py-1 text-sm rounded ${ALWAYS_ON.includes(c.key) ? 'text-gray-400' : 'text-ink hover:bg-gray-50 cursor-pointer'}`}>
                    <input type="checkbox" checked={visible.includes(c.key)} disabled={ALWAYS_ON.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}{ALWAYS_ON.includes(c.key) ? ' (always)' : ''}
                  </label>
                ))}
                {bank && (
                  <button onClick={applyBankTidy}
                    title="Hide the columns a statement-born row never fills: no invoice number, no document, no vendor contact, nothing scheduled."
                    className="w-full text-left mt-1 pt-2 border-t border-divider px-2 py-1 text-[11px] font-bold text-ink-muted hover:text-ink">
                    Hide what a bank row never fills
                  </button>
                )}
              </div>
            )}
          </div>
        </>}
        {isMobile && (
          <button onClick={() => setFilterSheet(true)} className={`btn-secondary ${anyFilter ? '!border-brand-300 !text-brand-700' : ''}`}><Filter size={15} /> Filters{anyFilter ? ' •' : ''}</button>
        )}
      </div>

      {/* Advanced filters, matched to the extended column set */}
      {moreOpen && !isMobile && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-page/60 border border-rule">
          <select className="input !w-auto" value={fArtist} onChange={e => setFArtist(e.target.value)}><option value="">Any artist</option>{artistOpts.map(a => <option key={a}>{a}</option>)}</select>
          <select className="input !w-auto" value={fRep} onChange={e => setFRep(e.target.value)}><option value="">Any rep</option>{repOpts.map(r => <option key={r}>{r}</option>)}</select>
          <select className="input !w-auto" value={fCurrency} onChange={e => setFCurrency(e.target.value)}><option value="">Any currency</option>{currencyOpts.map(c => <option key={c}>{c}</option>)}</select>
          <select className="input !w-auto" value={fType} onChange={e => setFType(e.target.value)}><option value="">Any type</option><option value="invoice">Invoice</option><option value="reimb">Reimbursement</option></select>
          <select className="input !w-auto" value={fRecoup} onChange={e => setFRecoup(e.target.value)}><option value="">Recoup: any</option><option value="yes">Recoupable</option><option value="no">Not recoupable</option></select>
          <select className="input !w-auto" value={fCampaign} onChange={e => setFCampaign(e.target.value)}><option value="">Campaign: any</option><option value="yes">In a campaign</option><option value="no">Not in a campaign</option></select>
          <select className="input !w-auto" value={fUfr} onChange={e => setFUfr(e.target.value)}><option value="">UFR: any</option><option value="yes">UFR marked</option><option value="no">No UFR</option></select>
          <select className="input !w-auto" value={fQb} onChange={e => setFQb(e.target.value)}><option value="">QB: any</option><option value="yes">In QuickBooks</option><option value="no">Not in QB</option></select>
          <select className="input !w-auto" value={fCobrand} onChange={e => setFCobrand(e.target.value)}><option value="">Cobrand: any</option><option value="yes">Cobrand</option><option value="no">Not cobrand</option></select>
          <select className="input !w-auto" value={fBulk} onChange={e => setFBulk(e.target.value)}><option value="">Bulk deal: any</option><option value="yes">Bulk deal</option><option value="no">Not bulk</option></select>
          {advancedActive && <button onClick={clearAdvanced} className="text-xs font-semibold px-3 py-2 rounded-lg text-gray-500 hover:bg-gray-100 border border-rule">Clear</button>}
        </div>
      )}

      <div className="flex items-center gap-1 mb-4">
        {STATUSES.map(f => (
          <button key={f} onClick={() => setStatus(f)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg capitalize transition ${status === f ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{f}</button>
        ))}
        <span className="text-xs text-gray-400 ml-2">{filtered.length} of {entries.length}</span>
      </div>

      {loading ? (
        <div className="card p-2"><Skeleton.Table rows={8} cols={shownCols.length + 1} /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <BookOpen size={28} className="text-gray-300 mx-auto mb-3" />
          {/* Truly-empty and filtered-empty are different news. "No entries
              match." on a brand-new workspace reads as a filter you can't find,
              and sends people hunting for a control that isn't set. */}
          <p className="text-sm text-gray-500">
            {stmtId ? 'No ledger rows on this statement — every line it holds is in the list below.'
              : entries.length === 0 ? 'No entries yet. Invoices land here once they are added or approved.'
              : 'No entries match the current filters.'}
          </p>
          {anyFilter && <button onClick={clearAll} className="mt-2 text-xs font-semibold text-brand-600 hover:underline">Clear filters</button>}
        </div>
      ) : isMobile ? (
        /* Mobile card list (<768px). Tap a card to open the detail drawer;
           inline quick actions mirror the desktop row actions. */
        <div className="space-y-2">
          {filtered.slice(0, mobileCap).map(en => (
            <div
              key={en.id}
              ref={el => (rowRefs.current[en.id] = el)}
              onClick={() => setDrawerEntry(en)}
              className={`card p-3 ${en.voided ? 'opacity-50' : ''} ${en.entry_source === 'expense' ? 'bg-sky-50/70 border-sky-200' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{en.flagged && <Flag size={11} className="inline text-amber-500 mr-1" fill="currentColor" />}{en.payee || '—'}</p>
                  <p className="text-[11px] text-gray-400 truncate">{[en.category, en.artist].filter(Boolean).join(' · ') || '—'} · {formatDate(en.invoice_date)}</p>
                </div>
                <span className={`flex-shrink-0 inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-semibold text-ink tabular-nums" title={usdTitle(en, en.family_amount ?? en.amount)}>{money(en.family_amount ?? en.amount, en.currency)}</span>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  {en.status === 'approved' && !en.voided
                    ? <button onClick={() => cyclePaid(en)} className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${PAID_PILL[en.payment_status] || PAID_PILL.Unpaid}`}>{en.payment_status || 'Unpaid'}</button>
                    : <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold opacity-60 ${PAID_PILL[en.payment_status] || PAID_PILL.Unpaid}`}>{en.payment_status || 'Unpaid'}</span>}
                  {en.status === 'approved' && en.payment_status !== 'Paid' && !en.voided && (
                    <button onClick={() => act(en.id, 'mark-paid')} title="Mark paid" className="text-gray-500 p-1"><DollarSign size={16} /></button>
                  )}
                  <button onClick={() => setDrawerEntry(en)} title="Details" className="text-gray-400 p-1"><SlidersHorizontal size={15} /></button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length > mobileCap && (
            <button onClick={() => setMobileCap(c => c + MOBILE_PAGE)} className="btn-secondary w-full">Load more ({filtered.length - mobileCap} left)</button>
          )}
          <div className="card px-3 py-2.5 text-[11px] font-semibold text-gray-500 sticky bottom-16">
            Totals: {totalsLine}{totalsUsd && <span className="text-gray-400 font-normal">{totalsUsd}</span>}
          </div>
        </div>
      ) : (
        // FROZEN FIRST COLUMN: the frozen region is exactly ONE sticky <td> per
        // row (ci === 0), NOT several adjacent sticky cells. Multiple sticky
        // cells produce sub-pixel gaps that flicker on horizontal scroll. The
        // sticky cell paints its own row background (so row washes like the
        // expense-hue don't vanish under it) and carries a right-edge shadow to
        // separate it from the scrolling body. Do NOT split into multiple cells.
        // The selection checkbox + flag button live INSIDE that cell (boom kept
        // them in its frozen block for the same reason).
        <div className="card overflow-x-auto max-h-[75vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-30">
              <tr className="bg-page border-b border-divider text-left">
                {shownCols.map((c, ci) => (
                  <th key={c.key} className={`px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap select-none bg-page ${ci === 0 ? 'sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]' : ''}`}>
                    {ci === 0 && <input ref={headerCbRef} type="checkbox" checked={allSelected} onChange={toggleAll} onClick={e => e.stopPropagation()} title={`Select all ${filtered.length} rows the current filters show`} className="mr-2 align-middle" />}
                    <button onClick={() => setSortKey(c.key)} className="uppercase tracking-wider hover:text-gray-600 cursor-pointer">
                      {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 bg-page" />
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {shownRows.map(en => (
                <Fragment key={en.id}>
                <tr ref={el => (rowRefs.current[en.id] = el)} className={`group align-top transition-shadow ${en.voided ? 'opacity-50' : ''} ${en.entry_source === 'expense' ? 'bg-sky-50/70 hover:bg-sky-100/70' : 'hover:bg-gray-50'}`}>
                  {shownCols.map((c, ci) => <td key={c.key} title={en.voided ? `Voided by ${en.voided_by || '—'}` : undefined} className={`px-3 py-3 ${ci === 0 ? `sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] ${en.entry_source === 'expense' ? 'bg-sky-50' : 'bg-card'} group-hover:bg-gray-50` : ''}`}>
                    {ci === 0 ? <div className="flex items-start"><span className="flex-shrink-0">{firstCellPrefix(en)}</span><div className="min-w-0 flex-1">{c.render(en)}</div></div> : c.render(en)}
                  </td>)}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
                      {en.status === 'pending' && (
                        <>
                          <button onClick={() => act(en.id, 'approve')} title="Approve" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Check size={15} /></button>
                          <button onClick={() => reject(en.id)} title="Reject" className="text-red-500 hover:bg-red-50 p-1 rounded"><X size={15} /></button>
                        </>
                      )}
                      {en.status === 'approved' && en.payment_status !== 'Paid' && !en.voided && (
                        <button onClick={() => act(en.id, 'mark-paid')} title="Mark paid" className="text-gray-500 hover:text-emerald-600 p-1 rounded"><DollarSign size={15} /></button>
                      )}
                      <button onClick={() => setSplitEntry(en)} title={en.split_count > 0 ? 'Edit split' : 'Split across artists/songs'} className="text-gray-400 hover:text-brand-600 p-1 rounded"><Scissors size={14} /></button>
                      {en.split_count > 0
                        ? <button onClick={() => unsplit(en)} title="Unsplit (merge slices back)" className="text-gray-400 hover:text-amber-600 p-1 rounded"><RotateCcw size={14} /></button>
                        : !en.is_reimbursement && <button onClick={() => setCarveEntry(en)} title="Carve off a reimbursement (fee + receipt)" className="text-gray-400 hover:text-brand-600 p-1 rounded"><Receipt size={14} /></button>}
                      <button onClick={() => setEditEntry(en)} title="Edit" className="text-gray-400 hover:text-brand-600 p-1 rounded"><Pencil size={14} /></button>
                      <button onClick={() => setDrawerEntry(en)} title="Details" className="text-gray-400 hover:text-brand-600 p-1 rounded"><SlidersHorizontal size={14} /></button>
                      <button onClick={() => setConfirmDel(en)} title="Delete" className="text-gray-300 hover:text-danger p-1 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
                {expanded[en.id] && (childrenMap[en.id] || []).map(kid => (
                  // OPAQUE, and the same fill on the row and its frozen first cell:
                  // that cell has to paint over the columns sliding underneath it
                  // during horizontal scroll, and a translucent one lets them
                  // show through (the same reason --color-bg-selected is opaque).
                  <tr key={`k-${kid.id}`} ref={el => (rowRefs.current[kid.id] = el)} className="bg-elev text-[13px]">
                    {shownCols.map((c, ci) => (
                      <td key={c.key} className={`px-3 py-2 ${ci === 0 ? 'sticky left-0 z-10 bg-elev shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)]' : ''}`}>
                        {ci === 0 ? <span className="flex items-center gap-1.5 text-gray-500 pl-4"><span className="text-gray-300">{'↳'}</span>{c.render(kid)}</span> : c.render(kid)}
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => setEditEntry(kid)} title="Edit slice" className="text-gray-400 hover:text-brand-600 p-1 rounded"><Pencil size={13} /></button>
                        <button onClick={() => setDrawerEntry(kid)} title="Details" className="text-gray-400 hover:text-brand-600 p-1 rounded"><SlidersHorizontal size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {expanded[en.id] && !childrenMap[en.id] && (
                  <tr className="bg-page/40"><td colSpan={shownCols.length + 1} className="px-3 py-2 text-xs text-gray-400 pl-8">Loading splits…</td></tr>
                )}
                </Fragment>
              ))}
              {renderCap < filtered.length && (
                <tr ref={sentinelRef}>
                  <td colSpan={shownCols.length + 1} className="px-3 py-3 text-center text-xs text-gray-400">
                    showing {shownRows.length} of {filtered.length} rows; scroll for more
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-20">
              <tr className="border-t-2 border-divider bg-page">
                <td className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 sticky left-0 bg-page shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] whitespace-nowrap">TOTAL</td>
                <td className="px-3 py-2.5 text-[11px] font-semibold text-gray-500 whitespace-nowrap" colSpan={shownCols.length}>
                  {totalsLine}{totalsUsd && <span className="text-gray-400 font-normal">{totalsUsd}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── The lines with no editable row on this page ────────────────────
          The other half of "does this month add up". A booked debit is already
          a full ledger row above; everything else — matched lines whose invoice
          lives on the invoiced half, dismissals, and the entire credit side,
          which `expenses` cannot hold at all — appears here, or it appears
          nowhere on a page claiming to account for the month.

          Deliberately NOT ledger rows: there is no expense id behind them, so
          there are no inline editors and no bulk checkbox. The buttons act on
          the TRANSACTION, through the endpoints Bank Matching already owns. */}
      {bank && stmtId && lens && extraTx.length > 0 && (
        <div className="card mt-3 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-divider flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
              {extraTx.length} more line{extraTx.length === 1 ? '' : 's'} on this statement — no ledger row here
            </span>
            <span className="text-[11px] text-ink-faint">not in the TOTAL above</span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-divider">
              {extraTx.map(t => {
                const isCredit = t.direction === 'credit'
                const chip = DISPO_CHIP[t.disposition] || DISPO_CHIP.open
                const busy = txBusy === t.id
                return (
                  <tr key={`x-${t.id}`} className={`${t.disposition === 'dismissed' ? 'opacity-70' : ''}`}>
                    <td className={`px-4 py-2.5 w-[38%] ${isCredit ? 'border-l-[3px] border-emerald-500' : 'border-l-[3px] border-transparent'}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span title={isCredit ? 'Money in' : 'Money out'} className={`text-xs ${isCredit ? 'text-emerald-600' : 'text-ink-faint'}`}>{isCredit ? '↓' : '↑'}</span>
                        <span className="text-[11px] text-ink-faint tabular-nums whitespace-nowrap">{formatDate(t.txn_date)}</span>
                        <span className="text-xs font-semibold text-ink truncate" title={t.description || ''}>{t.payee_guess || t.description || '—'}</span>
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-right text-xs font-bold tabular-nums whitespace-nowrap ${isCredit ? 'text-emerald-600' : 'text-ink'}`}>
                      {isCredit ? '+' : '−'}{usdMoney(t.usd)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.label}</span>
                        {(t.disposition === 'matched' || t.disposition === 'toconfirm') && (
                          <span className="text-[11.5px] text-ink-muted">
                            settled by {t.match_method === 'creator' ? 'a creator payment' : 'an invoice'} ·{' '}
                            <Link to={`/ledger?focus=${t.matched_expense_id}`} className="text-brand-ink font-bold hover:underline">open it on the ledger →</Link>
                          </span>
                        )}
                        {t.disposition === 'booked-income' && (
                          <span className="text-[11.5px] text-ink-muted">{t.income_type || 'income'}{t.income_artist ? ` · ${t.income_artist}` : ''}</span>
                        )}
                        {t.disposition === 'booked' && (
                          <span className="text-[11.5px] text-ink-faint">its ledger row is not in this view</span>
                        )}
                        {t.disposition === 'dismissed' && (
                          <span className="text-[11.5px] text-ink-faint">{t.dismissed_reason || 'no entry needed'}</span>
                        )}
                        {(t.disposition === 'open' || t.disposition === 'open-credit') && (
                          <span className="text-[11.5px] text-amber-700">nothing decided yet</span>
                        )}
                        {t.reference && <span className="text-[10.5px] text-ink-faint">ref {t.reference}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        {t.disposition === 'open' && (
                          <>
                            <Link to={`/bank-matching?statement=${stmtId}&filter=open`} className="text-[11px] font-bold text-brand-ink hover:underline" title="Decide what this line is, on the surface that owns that decision">Answer it →</Link>
                            <button disabled={busy} onClick={() => txAct(t.id, 'dismiss', {})} title="No ledger entry is needed for this line" className="text-ink-faint hover:text-danger p-1 disabled:opacity-50"><Ban size={14} /></button>
                          </>
                        )}
                        {t.disposition === 'open-credit' && (
                          <Link to={`/bank-matching?statement=${stmtId}`} className="text-[11px] font-bold text-brand-ink hover:underline" title="Book it as income, or dismiss it as internal movement">Answer it →</Link>
                        )}
                        {t.disposition === 'dismissed' && (
                          <button disabled={busy} onClick={() => txAct(t.id, 'restore', {})} title="Restore — this line does need an answer" className="text-ink-faint hover:text-brand-ink p-1 disabled:opacity-50"><RotateCcw size={14} /></button>
                        )}
                        {t.disposition === 'booked-income' && (
                          <button disabled={busy} onClick={() => txAct(t.id, 'unbook-income', {})} title="Unbook the income entry" className="text-ink-faint hover:text-danger p-1 disabled:opacity-50"><Undo2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk bar (LED-1): appears with a selection; z stays under overlays. */}
      {selectedRows.length > 0 && !isMobile && (
        <BulkBar
          count={selectedRows.length}
          below={selBelow}
          usd={selUsd}
          categories={expenseCats}
          artistNames={artistNames}
          canGroup={selectedRows.length >= 2 && new Set(selectedRows.map(r => (r.payee || '').trim().toLowerCase())).size === 1 && selectedRows.every(r => !r.settlement_group_id)}
          onApply={bulkApply}
          onGroup={groupSelection}
          onClear={() => setSel(new Set())}
        />
      )}

      {/* Undo affordance for inline edits (also: press z) */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-6 left-6 z-[40] flex items-center gap-3 bg-card border border-rule shadow-modal rounded-xl px-4 py-2.5">
          <span className="text-xs text-gray-500">Edited {undoStack[undoStack.length - 1].label}</span>
          <button onClick={undoLast} className="text-xs font-semibold text-brand-600 hover:underline">Undo (z)</button>
        </div>
      )}

      {drawerEntry && <LedgerEntryDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} onChanged={() => load(true)} />}
      {quickOpen && <QuickExpenseModal artistNames={artistNames} toast={toast} onClose={() => setQuickOpen(false)} onCreated={() => { setQuickOpen(false); load() }} />}
      {editEntry && <EditEntryModal entry={editEntry} artistNames={artistNames} toast={toast} onClose={() => setEditEntry(null)} onSaved={() => { setEditEntry(null); load(true) }} />}
      {splitEntry && <SplitModal entry={splitEntry} artistNames={artistNames} toast={toast} onClose={() => setSplitEntry(null)} onDone={afterSplit} />}
      {carveEntry && <CarveReimbModal entry={carveEntry} toast={toast} onClose={() => setCarveEntry(null)} onDone={() => { setCarveEntry(null); load(true) }} />}

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={doDelete}
        title="Delete ledger entry"
        message={confirmDel ? `Delete ${confirmDel.payee || 'this entry'} (${money(confirmDel.family_amount ?? confirmDel.amount, confirmDel.currency)})?${confirmDel.split_count > 0 ? ` Its ${confirmDel.split_count} split slices are deleted with it.` : ''} It can be restored from the archive.` : ''}
        confirmLabel="Delete"
      />

      {/* Flag-for-review editor (LED-4) */}
      {flagFor && <FlagModal flagFor={flagFor} setFlagFor={setFlagFor} onSave={saveFlag} />}

      {/* Socials editor (LED-8): writes expenses.social_handles */}
      {socialsFor && <SocialsModal socialsFor={socialsFor} setSocialsFor={setSocialsFor} onSave={saveSocials} />}

      {receiptsFor && <ReceiptsModal entry={receiptsFor} toast={toast} onClose={() => setReceiptsFor(null)} onChanged={() => load(true)} />}

      {/* Mobile filter sheet: the full filter set + sort (LED-25) */}
      <BottomSheet open={filterSheet} onClose={() => setFilterSheet(false)} title="Filters"
        footer={<div className="flex gap-2"><button onClick={() => { clearAll(); setFilterSheet(false) }} className="btn-secondary flex-1">Clear all</button><button onClick={() => setFilterSheet(false)} className="btn-primary flex-1">Done</button></div>}>
        <div className="space-y-2.5 px-1">
          <input value={amountQ} onChange={e => setAmountQ(e.target.value)} placeholder="Amount: 500 or >1000" className={`input w-full ${amountInvalid ? '!border-amber-400' : ''}`} />
          <select className="input w-full" value={status} onChange={e => setStatus(e.target.value)}>{STATUSES.map(sv => <option key={sv} value={sv}>{sv === 'all' ? 'Any status' : sv}</option>)}</select>
          <select className="input w-full" value={fCategory} onChange={e => setFCategory(e.target.value)}><option value="">All categories</option><CategoryOptions /></select>
          <select className="input w-full" value={fPaid} onChange={e => setFPaid(e.target.value)}><option value="">Any payment</option><option>Unpaid</option><option>Partial</option><option>Paid</option></select>
          <select className="input w-full" value={fMethod} onChange={e => setFMethod(e.target.value)}><option value="">Any method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select>
          <select className="input w-full" value={fSource} onChange={e => setFSource(e.target.value)}>{SOURCE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input w-full" value={fFlag} onChange={e => setFFlag(e.target.value)}><option value="">Flag: any</option><option value="flagged">Flagged</option><option value="unflagged">Unflagged</option><option value="ai">AI discrepancies</option></select>
          <select className="input w-full" value={fArtist} onChange={e => setFArtist(e.target.value)}><option value="">Any artist</option>{artistOpts.map(a => <option key={a}>{a}</option>)}</select>
          <select className="input w-full" value={fRecoup} onChange={e => setFRecoup(e.target.value)}><option value="">Recoup: any</option><option value="yes">Recoupable</option><option value="no">Not recoupable</option></select>
          <select className="input w-full" value={`${sort.key}:${sort.dir}`} onChange={e => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir }) }}>
            <option value="invoice_date:desc">Newest first</option>
            <option value="invoice_date:asc">Oldest first</option>
            <option value="amount:desc">Amount: high to low</option>
            <option value="amount:asc">Amount: low to high</option>
            <option value="payee:asc">Payee A-Z</option>
            <option value="scheduled_payment_date:asc">Due date</option>
          </select>
        </div>
      </BottomSheet>

      {/* File preview. Read-only, so Escape and the backdrop just close it —
          there is nothing here to lose. The panel overrides Modal's padding and
          scroll because this is a full-height viewer, not a card. */}
      {preview && (
        <Modal open onClose={() => setPreview(null)} size="3xl" className="!p-0 !overflow-hidden h-[88vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule flex-shrink-0">
            <span className="text-sm font-semibold text-ink capitalize">{preview.label}</span>
            <div className="flex items-center gap-3">
              <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">Open in new tab</a>
              <button onClick={() => setPreview(null)} className="text-ink-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
            </div>
          </div>
          <iframe src={preview.url} title="File preview" className="flex-1 w-full bg-gray-100" />
        </Modal>
      )}

      {/* 1099 report. Also read-only — Escape closes outright. */}
      {report1099 && (
        <Modal
          open
          onClose={() => setReport1099(null)}
          size="xl"
          title={<>1099 report · {report1099.year} <span className="text-xs font-normal text-gray-400">(reporting threshold; split slices included)</span></>}
        >
          <div className="-mx-5 -mb-5 border-t border-divider max-h-[60vh] overflow-y-auto">
              {report1099.vendors.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-400">No vendors crossed the reporting threshold this year.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide border-b border-divider bg-page/50">
                    <th className="px-4 py-2 font-semibold">Vendor</th><th className="px-4 py-2 font-semibold text-right">Paid</th><th className="px-4 py-2 font-semibold text-center">W9</th>
                  </tr></thead>
                  <tbody>
                    {report1099.vendors.map((v, i) => (
                      <tr key={i} className="border-b border-divider last:border-0">
                        <td className="px-4 py-2 text-ink">{v.vendor}<span className="block text-[11px] text-gray-400">{v.email || ''}</span></td>
                        <td className="px-4 py-2 text-right font-medium">${Number(v.total_paid).toLocaleString()}</td>
                        <td className="px-4 py-2 text-center">{v.has_w9 ? <Check size={14} className="text-emerald-600 inline" /> : <span className="text-[10px] text-red-500 font-semibold">MISSING</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </Modal>
      )}
    </div>
  )
}

// Flag-for-review editor (LED-4).
//
// Dismissal: the note is unsaved text, so Escape / backdrop confirm before
// throwing away an EDITED one. Opening a flagged row to read who flagged it and
// closing again is untouched, so it shuts instantly — the guard compares
// against the note the dialog opened with, not against empty.
function FlagModal({ flagFor, setFlagFor, onSave }) {
  const en = flagFor.en
  const boxRef = useRef(null)
  const requestClose = useDiscardGuard(
    flagFor.reason !== (en.flag_reason || ''),
    () => setFlagFor(null),
    { message: 'Discard this flag note?' },
  )
  // useFocusTrap deliberately focuses the PANEL, and it runs after React
  // applies `autoFocus`, so the attribute alone is a no-op inside a Modal. This
  // dialog is one textarea and nothing else — a parent effect runs after the
  // child's, so this is the one that wins.
  useEffect(() => { boxRef.current?.focus() }, [])
  return (
    <Modal open onClose={requestClose} size="sm"
      title={<span className="flex items-center gap-2"><Flag size={15} className="text-amber-500" /> Flag for review</span>}>
      <p className="text-xs text-gray-400 -mt-2 mb-2 truncate">{en.payee} · {money(en.amount, en.currency)}</p>
      <textarea ref={boxRef} rows={3} maxLength={500} className="input w-full" placeholder="Why does this need review? (optional)"
        value={flagFor.reason} onChange={e => setFlagFor(f => ({ ...f, reason: e.target.value }))} />
      {en.flagged && <p className="text-[11px] text-gray-400 mt-1">Flagged by {en.flagged_by || '—'}{en.flagged_at ? ` on ${formatDate(en.flagged_at)}` : ''}</p>}
      <div className="flex justify-end gap-2 mt-4">
        {en.flagged && <button onClick={() => onSave(en, false, null)} className="btn-secondary">Remove flag</button>}
        <button onClick={() => onSave(en, true, flagFor.reason.trim() || null)} className="btn-primary">{en.flagged ? 'Update flag' : 'Flag'}</button>
      </div>
    </Modal>
  )
}

// Socials editor (LED-8): writes expenses.social_handles.
//
// Dismissal: handle rows carry amounts that become split lines, so an edited
// list confirms before it is discarded. Compared against the rows the row
// already had, so open-and-close is instant.
function SocialsModal({ socialsFor, setSocialsFor, onSave }) {
  const en = socialsFor.en
  const initial = useRef(JSON.stringify(socialsFor.rows))
  const requestClose = useDiscardGuard(
    JSON.stringify(socialsFor.rows) !== initial.current,
    () => setSocialsFor(null),
    { message: 'Discard these social handles?' },
  )
  return (
    <Modal open onClose={requestClose} size="lg" title={`Social handles · ${en.payee}`}>
      <SocialHandlesEditor value={socialsFor.rows} onChange={rows => setSocialsFor(s => ({ ...s, rows }))} currency={en.currency || 'USD'} />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={requestClose} className="btn-secondary">Cancel</button>
        <button onClick={onSave} className="btn-primary">Save</button>
      </div>
    </Modal>
  )
}

// Y/N chip (boom's YNBadge): green Yes / quiet No; `accent` renders Yes in the
// brand family (Cobrand / Bulk in boom were blue). null = 3-state dash.
function YNBadge({ value, onClick, title, accent }) {
  const cls = value === true
    ? (accent ? 'bg-brand-500/15 text-brand-700' : 'bg-emerald-500/15 text-emerald-700')
    : value === false ? 'bg-gray-500/10 text-gray-500' : 'bg-gray-500/10 text-gray-400'
  return (
    <button onClick={onClick} title={title || 'Click to toggle'} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls} ${onClick ? 'hover:ring-1 hover:ring-brand-300' : ''}`}>
      {value === true ? 'Yes' : value === false ? 'No' : '—'}
    </button>
  )
}

// Editable cell: click to edit; Enter/blur commits, Esc cancels. Module-scope
// (identity stable across renders) so the input keeps focus while typing.
function EditCell({ en, field, kind = 'text', options, display, editing, draft, setDraft, commitEdit, beginEdit, setEditing, artistNames, songOptionsFor }) {
  if (editing?.id === en.id && editing?.key === field) {
    const common = { autoFocus: true, className: 'input !py-1 !px-1.5 text-sm w-full min-w-[110px]', value: draft, onChange: e => setDraft(e.target.value), onBlur: () => commitEdit(en, field, draft), onKeyDown: e => { if (e.key === 'Enter') commitEdit(en, field, draft); if (e.key === 'Escape') setEditing(null) } }
    if (kind === 'select') return <select {...common}><option value="">{'—'}</option>{options.map(o => <option key={o}>{o}</option>)}</select>
    if (kind === 'number') return <input type="number" step="0.01" {...common} />
    if (kind === 'date') return <input type="date" {...common} />
    if (kind === 'datalist') return <><input list="ledger-artists" {...common} /><datalist id="ledger-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></>
    if (kind === 'song') return <><input list="ledger-songs" {...common} /><datalist id="ledger-songs">{(songOptionsFor ? songOptionsFor(en) : []).map(sg => <option key={sg} value={sg} />)}</datalist></>
    return <input {...common} />
  }
  return <span onClick={() => beginEdit(en, field)} className="cursor-text hover:bg-brand-500/10 rounded px-1 -mx-1 block min-h-[1.25rem]" title="Click to edit">{display}</span>
}

function PayeeCell({ en, onFlag, onToggleSplits, isOpen, onUngroup, editProps }) {
  const flags = (en.ai_flags || 0) + (en.w9_flags || 0)
  return (
    <div>
      <EditCell en={en} field="payee" display={<p className={`font-medium text-ink ${en.voided ? 'line-through' : ''}`}>{en.payee || '—'}</p>} {...editProps} />
      {en.vendor_submitted && <span className="text-[10px] text-brand-600 font-semibold uppercase">Vendor</span>}
      {en.voided && <span className="text-[10px] text-red-500 font-semibold uppercase ml-1" title={`Voided by ${en.voided_by || '—'}`}>Voided</span>}
      {en.split_count > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onToggleSplits?.(en) }} title="Show/hide splits"
          className="inline-flex items-center gap-0.5 text-[10px] text-brand-600 font-semibold uppercase ml-1 hover:underline align-middle">
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{en.split_count} splits
        </button>
      )}
      {en.settlement_group_size > 1 && (
        <button onClick={(e) => { e.stopPropagation(); onUngroup?.(en) }} title="One bank payment settles these invoices; click to ungroup (bank matches unaffected)"
          className="text-[9px] text-violet-600 font-bold uppercase ml-1 px-1 py-0.5 rounded bg-violet-500/10 hover:bg-violet-500/20 align-middle whitespace-nowrap">
          One payment · {en.settlement_group_size}
        </button>
      )}
      {en.is_bulk_deal && <span className="text-[10px] text-violet-500 font-semibold uppercase ml-1" title={en.bulk_deal_quantity ? `${en.bulk_deal_quantity} ${en.bulk_deal_unit || 'items'}` : undefined}>Bulk</span>}
      {en.rush && <span className="text-[10px] text-amber-600 font-semibold uppercase ml-1">Rush</span>}
      {flags > 0 && <button onClick={onFlag} className="text-[10px] text-red-600 font-semibold uppercase ml-1 hover:underline">{flags} AI flag(s)</button>}
    </div>
  )
}

function FilesCell({ en, openFile }) {
  return (
    <div className="flex gap-1.5">
      {en.invoice_r2_key && <button onClick={() => openFile(en.id, 'invoice')} title="Invoice" className="text-gray-400 hover:text-brand-600"><Paperclip size={14} /></button>}
      {en.w9_r2_key && <button onClick={() => openFile(en.id, 'w9')} title="W9" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">W9</button>}
      {en.proof_r2_key && <button onClick={() => openFile(en.id, 'proof')} title="Proof of payment" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">PRF</button>}
      {en.receipt_r2_key && <button onClick={() => openFile(en.id, 'receipt')} title="Receipt" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">RCT</button>}
      {!en.invoice_r2_key && !en.w9_r2_key && !en.proof_r2_key && !en.receipt_r2_key && <span className="text-gray-300">{'—'}</span>}
    </div>
  )
}

// A per-type file cell: open / upload / replace / remove. Split children
// without their own invoice open the PARENT's (the family shares one document);
// rows without their own W9 but with an alias-sibling that holds one offer
// "View (shared)" plus an explicit Upload that targets THIS row (LED-11).
function FileCell({ en, type, r2key, openFile, onChanged, toast, sharedFromId, parentFallback }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      await api.post(`/ledger/entries/${en.id}/file/${type}`, fd)
      onChanged()
    } catch { toast('Upload failed', 'error') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(`Remove the ${type} file from ${en.payee}?`)) return
    try { await api.delete(`/ledger/entries/${en.id}/file/${type}`); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Remove failed', 'error') }
  }
  return (
    <span className="inline-flex items-center gap-1.5" {...dropTarget(upload)}>
      {r2key && <button onClick={() => openFile(en.id, type)} className="text-brand-600 hover:underline text-xs">Open</button>}
      {!r2key && sharedFromId && <button onClick={() => openFile(sharedFromId, type)} title="This vendor's W9 lives on another entry" className="text-brand-600/80 hover:underline text-xs whitespace-nowrap">View (shared)</button>}
      {!r2key && parentFallback && en.parent_id && <button onClick={() => openFile(en.parent_id, type)} title="Split slices share the family's invoice" className="text-brand-600/80 hover:underline text-xs whitespace-nowrap">Open (family)</button>}
      {!r2key && sharedFromId
        ? <button onClick={() => ref.current?.click()} title="Upload a W9 onto THIS entry (not the shared one)" className="text-[10px] font-semibold text-gray-500 border border-rule rounded px-1.5 py-0.5 hover:text-brand-600 hover:border-brand-300">{busy ? '…' : 'Upload'}</button>
        : <button onClick={() => ref.current?.click()} title={r2key ? 'Replace file' : 'Upload file'} className="text-gray-300 hover:text-brand-600">
            {busy ? <span className="text-[10px] text-gray-400">{'…'}</span> : <Upload size={13} />}
          </button>}
      {r2key && <button onClick={remove} title="Remove file" className="text-gray-300 hover:text-danger opacity-0 group-hover:opacity-100"><X size={12} /></button>}
      <input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
    </span>
  )
}

// The extra receipts on an entry (first one lives on the row; 2nd..nth are
// entity_files). List / add another / remove one (LED-11).
function ReceiptsModal({ entry, toast, onClose, onChanged }) {
  const [files, setFiles] = useState(null)
  const addRef = useRef(null)
  const load = () => api.get(`/ledger/entries/${entry.id}/receipts`).then(r => setFiles(r.data.data || [])).catch(() => setFiles([]))
  useEffect(() => { load() }, [entry.id]) // eslint-disable-line
  const add = async (file) => {
    if (!file) return
    try { const fd = new FormData(); fd.append('file', file); await api.post(`/ledger/entries/${entry.id}/receipts`, fd); load(); onChanged() }
    catch { toast('Upload failed', 'error') }
  }
  const del = async (fid) => {
    try { await api.delete(`/ledger/entries/${entry.id}/receipts/${fid}`); load(); onChanged() }
    catch { toast('Remove failed', 'error') }
  }
  // Dismissal: every action here (add, remove) writes to the server the moment
  // it is taken, so this dialog never holds unsaved state. Escape closes.
  return (
    <Modal open onClose={onClose} size="md" title={<span className="truncate">Receipts · {entry.payee}</span>}>
      {files === null ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="space-y-1.5">
          {entry.receipt_r2_key && <p className="text-xs text-gray-500">1 primary receipt on the entry (open it from the Receipt column).</p>}
          {files.map(f => (
            <div key={f.id} className="flex items-center justify-between text-sm py-1.5 border-b border-divider">
              <a href={f.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline truncate">{f.original_name || f.filename}</a>
              <button onClick={() => del(f.id)} className="text-gray-300 hover:text-danger flex-shrink-0"><Trash2 size={13} /></button>
            </div>
          ))}
          {!files.length && <p className="text-sm text-gray-400">No extra receipts.</p>}
        </div>
      )}
      <button onClick={() => addRef.current?.click()} className="btn-secondary w-full mt-4"><Plus size={14} /> Add another receipt</button>
      <input ref={addRef} type="file" accept="application/pdf,image/*" hidden onChange={e => { add(e.target.files?.[0]); e.target.value = '' }} />
    </Modal>
  )
}

// Bulk bar (LED-1): one field across the whole selection. Selection state is
// honest about paint vs write; "N below the visible rows" says the write hits
// rows the incremental render hasn't painted yet.
function BulkBar({ count, below, usd, categories, artistNames, canGroup, onApply, onGroup, onClear }) {
  const [panel, setPanel] = useState(null)   // 'artist' | 'song' | 'category'
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const apply = async (field, value) => {
    setBusy(true)
    try { await onApply(field, value); setPanel(null); setVal('') } finally { setBusy(false) }
  }
  const open = (p) => { setPanel(panel === p ? null : p); setVal('') }
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[40] bg-card border border-rule shadow-modal rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap max-w-[92vw]">
      <span className="text-xs font-semibold text-ink whitespace-nowrap">{count} selected
        <span className="text-gray-400 font-normal"> · USD {usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        {below > 0 && <span className="text-amber-600 font-normal" title="Selected rows the incremental render hasn't painted yet; bulk edits still write to them"> · {below} below the visible rows</span>}
      </span>
      <button onClick={() => open('artist')} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${panel === 'artist' ? 'bg-brand-500/10 border-brand-300 text-brand-700' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>Set artist</button>
      <button onClick={() => open('song')} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${panel === 'song' ? 'bg-brand-500/10 border-brand-300 text-brand-700' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>Set song</button>
      <button onClick={() => open('category')} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${panel === 'category' ? 'bg-brand-500/10 border-brand-300 text-brand-700' : 'border-rule text-gray-500 hover:bg-gray-50'}`}>Set category</button>
      <button onClick={() => apply('in_quickbooks', true)} disabled={busy} title="Mark the selection as entered in QuickBooks" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rule text-gray-500 hover:bg-gray-50">QB {'✓'}</button>
      <button onClick={() => apply('recoupable', false)} disabled={busy} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-rule text-gray-500 hover:bg-gray-50">Not recoupable</button>
      {canGroup && <button onClick={onGroup} disabled={busy} title="Declare these invoices as settling in ONE bank payment" className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-violet-500/10 text-violet-600 hover:bg-violet-500/20">One payment</button>}
      <button onClick={onClear} className="text-xs font-semibold text-gray-400 hover:text-ink">Clear</button>
      {panel && (
        <div className="w-full flex items-center gap-2 pt-2 border-t border-divider">
          {panel === 'category' ? (
            <select autoFocus className="input !py-1.5 text-sm flex-1" value={val} onChange={e => setVal(e.target.value)}>
              <option value="">choose category</option>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          ) : (
            <>
              <input autoFocus list={panel === 'artist' ? 'bulk-artists' : undefined} className="input !py-1.5 text-sm flex-1"
                placeholder={panel === 'song' ? 'One song. A comma splits an entry per song, which stays a per-row edit.' : `New ${panel} for the selection`}
                value={val} onChange={e => setVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && val.trim()) apply(panel, val.trim()) }} />
              {panel === 'artist' && <datalist id="bulk-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist>}
            </>
          )}
          <button onClick={() => apply(panel, val.trim() || null)} disabled={busy || (panel === 'category' && !val)} className="btn-primary !py-1.5 text-xs">{busy ? 'Applying…' : 'Apply'}</button>
        </div>
      )}
    </div>
  )
}

// Fee/reimbursement carve-off (boom's split-fee-reimb, LED-32): fee + reimb
// must equal the entry total, and the receipt is REQUIRED; the reimbursement
// child carries it. Unsplit pulls the receipt back onto the parent.
function CarveReimbModal({ entry, toast, onClose, onDone }) {
  const total = Number(entry.amount || 0)
  const [fee, setFee] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)
  const feeRef = useRef(null)
  const reimb = fee === '' ? '' : Math.round((total - Number(fee)) * 100) / 100
  const valid = fee !== '' && Number(fee) > 0 && reimb > 0 && receipt
  // Dismissal: a typed fee or a chosen receipt file is unsaved work — the file
  // especially, since re-picking it means going back through the OS dialog. And
  // while the multipart POST is in flight nothing closes it: the carve either
  // lands or fails, and both outcomes are reported here.
  const requestClose = useDiscardGuard(fee !== '' || !!receipt, onClose, {
    busy: saving, message: 'Discard this carve-off? The fee and receipt you picked will be lost.',
  })
  // `autoFocus` is applied before Modal's focus trap runs, so it does nothing
  // inside a Modal — this parent effect is what actually lands the caret.
  useEffect(() => { feeRef.current?.focus() }, [])
  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('fee_amount', String(Number(fee)))
      fd.append('reimb_amount', String(reimb))
      fd.append('receipt', receipt)
      await api.post(`/ledger/entries/${entry.id}/split-fee-reimb`, fd)
      toast('Reimbursement carved off')
      onDone()
    } catch (err) { toast(err.response?.data?.error || 'Could not carve', 'error'); setSaving(false) }
  }
  return (
    <Modal open onClose={requestClose} size="md"
      title={<span className="flex items-center gap-2"><Receipt size={15} /> Carve off reimbursement</span>}>
      <div>
        <p className="text-xs text-gray-400 -mt-2 mb-4">{entry.payee} · {money(total, entry.currency)}: split into a fee and a receipt-backed reimbursement slice.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Fee</label><input ref={feeRef} type="number" step="0.01" className="input" value={fee} onChange={e => setFee(e.target.value)} /></div>
          <div><label className="label">Reimbursement</label><input type="number" className="input" value={reimb} readOnly disabled /></div>
          <div className="col-span-2">
            <label className="label">Receipt <span className="text-danger">*</span></label>
            <div onClick={() => fileRef.current?.click()} {...dropTarget(f => setReceipt(f))}
              className={`border-2 border-dashed rounded-lg px-4 py-4 text-center text-sm cursor-pointer ${receipt ? 'border-emerald-300 text-ink' : 'border-rule text-gray-400 hover:border-brand-300'}`}>
              {receipt ? receipt.name : 'Drop the receipt here, or click to choose'}
              <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={e => { setReceipt(e.target.files?.[0] || null); e.target.value = '' }} />
            </div>
          </div>
        </div>
        {fee !== '' && reimb <= 0 && <p className="text-xs text-danger mt-2">The fee must be less than the total.</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={requestClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={!valid || saving} className="btn-primary">{saving ? 'Carving…' : 'Carve off'}</button>
        </div>
      </div>
    </Modal>
  )
}

// Quick-add an expense straight from the ledger; no invoice number or file
// required (for costs that don't have an invoice). Posts to the same create
// endpoint as an approver, so it lands in the ledger immediately.
function QuickExpenseModal({ onClose, onCreated, artistNames, toast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ invoice_date: today, payee: '', category: '', artist: '', song: '', amount: '', currency: 'USD', payment_method: '', rep: '', description: '', notes: '', recoupable: true })
  const [markPaid, setMarkPaid] = useState(false)
  const [paidDate, setPaidDate] = useState(today)
  const [proof, setProof] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const proofRef = useRef(null)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const takeProof = (file) => { if (file) { setProof(file); setMarkPaid(true) } } // proof implies paid
  // Dismissal: 12 fields plus an attached proof file. Dirty is measured against
  // the form as it opened (today's date and Recoupable are pre-filled defaults,
  // not input), so opening the dialog and pressing Escape is instant, while a
  // half-typed expense is never lost to a stray keypress. No close while the
  // create request is in flight — this dialog creates a LEDGER ROW.
  const initial = useRef(JSON.stringify(f))
  const dirty = JSON.stringify(f) !== initial.current || !!proof || markPaid
  const requestClose = useDiscardGuard(dirty, onClose, {
    busy: saving, message: 'Discard this expense? Nothing you entered has been saved.',
  })

  const save = async () => {
    if (!f.payee.trim() || !f.amount) { toast('A description and amount are required', 'error'); return }
    setSaving(true)
    try {
      const fd = new FormData()
      const body = { ...f, vendor_name: f.payee, entry_source: 'expense', is_reimbursement: 'false', payment_status: markPaid ? 'Paid' : '', payment_date: markPaid ? paidDate : '' }
      Object.entries(body).forEach(([k, v]) => fd.append(k, v))
      if (proof) fd.append('proof_file', proof)
      await api.post('/ledger/entries', fd)
      toast('Expense added')
      onCreated()
    } catch (err) { toast(err.response?.data?.error || 'Failed to add expense', 'error'); setSaving(false) }
  }

  return (
    <Modal open onClose={requestClose} size="lg" title="Add expense">
      <div>
        <p className="text-xs text-gray-400 -mt-2 mb-4">For a cost with no invoice; no invoice number or file needed.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
          <div className="col-span-2"><label className="label">Description / paid to *</label><input className="input" value={f.payee} onChange={set('payee')} placeholder="e.g. Studio rental, office supplies" /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">Select category</option><CategoryOptions /></select></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Artist</label><input list="qx-artists" className="input" value={f.artist} onChange={set('artist')} /><datalist id="qx-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
          <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
          <div><label className="label">Payment method</label><select className="input" value={f.payment_method} onChange={set('payment_method')}><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div className="flex items-end"><label className="inline-flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={f.recoupable} onChange={e => setF(s => ({ ...s, recoupable: e.target.checked }))} /> Recoupable</label></div>
          <div className="col-span-2"><label className="label">Notes</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
          <div className="col-span-2">
            <label className="label">Proof of payment <span className="text-gray-400 font-normal">(optional)</span></label>
            <div
              onClick={() => proofRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); takeProof(e.dataTransfer.files?.[0]) }}
              className={`border-2 border-dashed rounded-lg px-4 py-5 text-center text-sm cursor-pointer transition ${dragOver ? 'border-brand-400 bg-brand-500/10 text-brand-700' : 'border-rule text-gray-400 hover:border-brand-300'}`}>
              {proof
                ? <span className="text-ink inline-flex items-center gap-2">{proof.name}<button onClick={e => { e.stopPropagation(); setProof(null) }} className="text-gray-400 hover:text-danger"><X size={14} /></button></span>
                : <span>Drop proof of payment here, or click to choose</span>}
              <input ref={proofRef} type="file" accept="application/pdf,image/*" hidden onChange={e => { takeProof(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-3 rounded-lg bg-page/60 border border-rule px-3 py-2.5">
            <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer"><input type="checkbox" checked={markPaid} onChange={e => setMarkPaid(e.target.checked)} /> Mark as already paid</label>
            {markPaid && <span className="inline-flex items-center gap-2 text-sm text-gray-500">Paid on <input type="date" className="input !w-auto !py-1" value={paidDate} onChange={e => setPaidDate(e.target.value)} /></span>}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={requestClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Adding…' : 'Add expense'}</button>
        </div>
      </div>
    </Modal>
  )
}

// Full edit form for a ledger entry: every editable field in one place (for
// the fields that aren't inline-editable in the table, and as a convenient
// all-in-one editor). PATCHes /ledger/entries/:id.
function EditEntryModal({ entry, artistNames, toast, onClose, onSaved }) {
  const d = (x) => x ? String(x).slice(0, 10) : ''
  const [f, setF] = useState({
    invoice_date: d(entry.invoice_date), payee: entry.payee || '', description: entry.description || '',
    category: entry.category || '', artist: entry.artist || '', song: entry.song || '',
    invoice_number: entry.invoice_number || '', amount: entry.amount ?? '', currency: entry.currency || 'USD',
    payment_method: entry.payment_method || '', payment_status: entry.payment_status || 'Unpaid',
    payment_date: d(entry.payment_date), scheduled_payment_date: d(entry.scheduled_payment_date),
    paid_by: entry.paid_by || '',
    rep: entry.rep || '', vendor_email: entry.vendor_email || '', vendor_address: entry.vendor_address || '',
    vendor_bank: entry.vendor_bank || '', payment_terms: entry.payment_terms || '', payment_ref: entry.payment_ref || '',
    notes: entry.notes || '', recoupment_label: entry.recoupment_label || '',
    recoupable: !!entry.recoupable, cobrand: !!entry.cobrand, is_bulk_deal: !!entry.is_bulk_deal, is_reimbursement: !!entry.is_reimbursement,
    ufr: !!entry.ufr, in_quickbooks: !!entry.in_quickbooks,
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const chk = (k) => (e) => setF(s => ({ ...s, [k]: e.target.checked }))
  // Dismissal: this is the every-field editor for a live ledger row — the most
  // expensive thing on the page to retype and the one where a silent discard is
  // least likely to be noticed (the row simply still says what it said before).
  // Compared against the entry as loaded, so a look-and-close is instant. No
  // close mid-PATCH.
  const initial = useRef(JSON.stringify(f))
  const requestClose = useDiscardGuard(JSON.stringify(f) !== initial.current, onClose, {
    busy: saving, message: 'Discard your edits to this entry?',
  })

  const save = async () => {
    if (!f.payee.trim() || f.amount === '' || f.amount == null) { toast('Payee and amount are required', 'error'); return }
    setSaving(true)
    try {
      const payload = {}
      for (const [k, v] of Object.entries(f)) payload[k] = v === '' ? null : v   // empty -> null (dates/amount)
      if (payload.cobrand) payload.category = 'Marketing'   // mirror the server rule
      await api.patch(`/ledger/entries/${entry.id}`, payload)
      toast('Entry updated')
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error'); setSaving(false) }
  }

  return (
    <Modal open onClose={requestClose} size="xl" title={<span className="truncate">Edit · {entry.payee || 'entry'}</span>}>
      <div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Payee / description *</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">{'—'}</option><CategoryOptions /></select></div>
          <div><label className="label">Invoice #</label><input className="input" value={f.invoice_number} onChange={set('invoice_number')} /></div>
          <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
          <div><label className="label">Artist</label><input list="edit-artists" className="input" value={f.artist} onChange={set('artist')} /><datalist id="edit-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
          <div><label className="label">Payment method</label><select className="input" value={f.payment_method} onChange={set('payment_method')}><option value="">{'—'}</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Payment status</label><select className="input" value={f.payment_status} onChange={set('payment_status')}><option>Unpaid</option><option>Partial</option><option>Paid</option></select></div>
          <div><label className="label">Paid on</label><input type="date" className="input" value={f.payment_date} onChange={set('payment_date')} /></div>
          <div><label className="label">Paid by</label><input className="input" value={f.paid_by} onChange={set('paid_by')} /></div>
          <div><label className="label">Scheduled</label><input type="date" className="input" value={f.scheduled_payment_date} onChange={set('scheduled_payment_date')} /></div>
          <div><label className="label">Terms</label><input className="input" value={f.payment_terms} onChange={set('payment_terms')} placeholder="e.g. Net 30" /></div>
          <div><label className="label">Payment ref</label><input className="input" value={f.payment_ref} onChange={set('payment_ref')} /></div>
          <div><label className="label">Tone label</label><input className="input" value={f.recoupment_label} onChange={set('recoupment_label')} placeholder="Recoupment grouping" /></div>
          <div><label className="label">Vendor email</label><input type="email" className="input" value={f.vendor_email} onChange={set('vendor_email')} /></div>
          <div className="col-span-2"><label className="label">Mailing address</label><input className="input" value={f.vendor_address} onChange={set('vendor_address')} /></div>
          <div><label className="label">Bank</label><input className="input" value={f.vendor_bank} onChange={set('vendor_bank')} /></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Notes</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
          <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-4 rounded-lg bg-page/60 border border-rule px-3 py-2.5">
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.recoupable} onChange={chk('recoupable')} /> Recoupable</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.is_reimbursement} onChange={chk('is_reimbursement')} /> Reimbursement</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600" title="Forces category Marketing"><input type="checkbox" checked={f.cobrand} onChange={chk('cobrand')} /> Cobrand</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.is_bulk_deal} onChange={chk('is_bulk_deal')} /> Bulk deal</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600" title="Un-recouped funds recovered"><input type="checkbox" checked={f.ufr} onChange={chk('ufr')} disabled={!f.recoupable} /> UFR</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.in_quickbooks} onChange={chk('in_quickbooks')} /> In QuickBooks</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={requestClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </Modal>
  )
}

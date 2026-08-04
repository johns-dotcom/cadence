import { useEffect, useState, useRef, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Check, X, Trash2, Paperclip, Link2, BookOpen, DollarSign, Download, Upload, SlidersHorizontal, FileBarChart, Search, Pencil } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import LedgerEntryDrawer from '../components/LedgerEntryDrawer'
import { formatDate } from '../utils/dates'
import useIsMobile from '../hooks/useIsMobile'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, CURRENCIES } from '../constants'

const STATUS_STYLES = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' }
const STATUSES = ['all', 'approved', 'rejected']
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const PAID_CYCLE = { Unpaid: 'Paid', Paid: 'Partial', Partial: 'Unpaid' }
const PAID_STYLE = { Paid: 'text-emerald-600', Partial: 'text-amber-600', Unpaid: 'text-gray-400' }

// Amount query → predicate. Supports "500", "500-1000", ">500", "<500".
function amountPred(raw) {
  const s = String(raw || '').trim(); if (!s) return null
  let m
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) { const a = +m[1], b = +m[2]; return v => v >= a && v <= b }
  if ((m = s.match(/^>=?\s*(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v >= a }
  if ((m = s.match(/^<=?\s*(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v <= a }
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) { const a = +m[1]; return v => v >= a }
  return null
}

// Social handles pulled from the multi-artist breakdown (or a "Socials:" note).
function socialsOf(en) {
  const out = []
  try {
    const bd = en.artist_breakdown
    const arr = Array.isArray(bd) ? bd : (bd ? [bd] : [])
    for (const it of arr) {
      if (it?.handle) out.push(it.handle)
      if (Array.isArray(it?.socials)) for (const s of it.socials) if (s?.handle) out.push(s.handle)
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

export default function Ledger() {
  const { toast } = useToast()
  const { label, user } = useAuth()
  const isMobile = useIsMobile()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [params] = useSearchParams()
  const focusId = params.get('focus')

  // Filters (all client-side over the loaded set for instant response).
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [amountQ, setAmountQ] = useState('')
  const [fCategory, setFCategory] = useState('')
  const [fPaid, setFPaid] = useState('')
  const [fMethod, setFMethod] = useState('')
  const [fSource, setFSource] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
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
  const [sort, setSort] = useState({ key: 'invoice_date', dir: 'desc' })

  const [copied, setCopied] = useState(false)
  const importRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [editEntry, setEditEntry] = useState(null)
  const [report1099, setReport1099] = useState(null)

  // Inline edit + 20-deep undo.
  const [editing, setEditing] = useState(null) // { id, key }
  const [draft, setDraft] = useState('')
  const [undoStack, setUndoStack] = useState([])
  const [artistNames, setArtistNames] = useState([])

  const beginEdit = (en, key) => { setEditing({ id: en.id, key }); setDraft(en[key] ?? '') }
  const commitEdit = async (en, key, raw) => {
    setEditing(null)
    const val = key === 'amount' ? (raw === '' ? null : Number(raw)) : (raw === '' ? null : raw)
    if (String(en[key] ?? '') === String(val ?? '')) return
    setEntries(list => list.map(e => e.id === en.id ? { ...e, [key]: val } : e))
    setUndoStack(s => [...s.slice(-19), { id: en.id, key, old: en[key], label: `${en.payee}: ${key}` }])
    try { await api.patch(`/ledger/entries/${en.id}`, { [key]: val }) } catch { toast('Save failed', 'error'); load() }
  }
  const undoLast = async () => {
    setUndoStack(s => {
      const last = s[s.length - 1]; if (!last) return s
      setEntries(list => list.map(e => e.id === last.id ? { ...e, [last.key]: last.old } : e))
      api.patch(`/ledger/entries/${last.id}`, { [last.key]: last.old }).catch(() => load())
      toast('Reverted')
      return s.slice(0, -1)
    })
  }

  // Props bundle for the module-scope EditCell (keeps its identity stable so
  // the <input> doesn't remount + lose focus/cursor on every keystroke).
  const editProps = { editing, draft, setDraft, commitEdit, beginEdit, setEditing, artistNames }

  // ── Toggleable columns, persisted per user+workspace ──────────────────
  const COLS = [
    { key: 'invoice_date', label: 'Date', render: en => <span className="text-gray-500 whitespace-nowrap">{formatDate(en.invoice_date)}</span> },
    { key: 'payee', label: 'Payee', render: en => <PayeeCell en={en} onFlag={() => setDrawerEntry(en)} /> },
    { key: 'artist', label: 'Artist', render: en => <EditCell en={en} field="artist" kind="datalist" display={<span className="text-gray-600">{en.artist || '—'}</span>} {...editProps} /> },
    { key: 'song', label: 'Song', render: en => <EditCell en={en} field="song" display={<span className="text-gray-600">{en.song || '—'}</span>} {...editProps} /> },
    { key: 'description', label: 'Description', render: en => <EditCell en={en} field="description" display={<span className="text-gray-600 truncate block max-w-[220px]">{en.description || '—'}</span>} {...editProps} /> },
    { key: 'category', label: 'Category', render: en => <EditCell en={en} field="category" kind="select" options={EXPENSE_CATEGORIES} display={<span className="text-gray-600 whitespace-nowrap">{en.category || '—'}</span>} {...editProps} /> },
    { key: 'invoice_number', label: 'Invoice #', render: en => <EditCell en={en} field="invoice_number" display={<span className="text-gray-500 whitespace-nowrap">{en.invoice_number || '—'}</span>} {...editProps} /> },
    { key: 'amount', label: 'Amount', render: en => <EditCell en={en} field="amount" kind="number" display={<span className="text-ink font-medium whitespace-nowrap tabular-nums">{money(en.amount, en.currency)}</span>} {...editProps} /> },
    { key: 'currency', label: 'Currency', render: en => <span className="text-gray-500">{en.currency || 'USD'}</span> },
    { key: 'usd', label: '≈ USD', render: en => {
      const usd = (en.currency || 'USD') === 'USD' ? Number(en.amount || 0) : (en.fx_rate_to_usd ? Number(en.amount || 0) / Number(en.fx_rate_to_usd) : null)
      return <span className="text-gray-500 whitespace-nowrap tabular-nums">{usd == null ? '—' : `USD ${usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</span>
    } },
    { key: 'status', label: 'Status', render: en => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span> },
    { key: 'payment', label: 'Payment', render: en => <button onClick={() => cyclePaid(en)} title="Click to cycle" className={`text-xs font-medium hover:underline ${PAID_STYLE[en.payment_status] || PAID_STYLE.Unpaid}`}>{en.payment_status || 'Unpaid'}</button> },
    { key: 'payment_method', label: 'Method', render: en => <EditCell en={en} field="payment_method" kind="select" options={PAYMENT_METHODS} display={<span className="text-gray-500 whitespace-nowrap">{en.payment_method || '—'}</span>} {...editProps} /> },
    { key: 'payment_date', label: 'Paid on', render: en => <span className="text-gray-500 whitespace-nowrap">{en.payment_date ? formatDate(en.payment_date) : '—'}</span> },
    { key: 'scheduled_payment_date', label: 'Scheduled', render: en => <span className="text-gray-500 whitespace-nowrap">{en.scheduled_payment_date ? formatDate(en.scheduled_payment_date) : '—'}</span> },
    { key: 'rep', label: 'Rep', render: en => <EditCell en={en} field="rep" display={<span className="text-gray-500">{en.rep || '—'}</span>} {...editProps} /> },
    { key: 'vendor_email', label: 'Vendor email', render: en => <EditCell en={en} field="vendor_email" display={<span className="text-gray-500 truncate block max-w-[180px]">{en.vendor_email || '—'}</span>} {...editProps} /> },
    { key: 'vendor_address', label: 'Address', render: en => <EditCell en={en} field="vendor_address" display={<span className="text-gray-500 truncate block max-w-[200px]">{en.vendor_address || '—'}</span>} {...editProps} /> },
    { key: 'vendor_bank', label: 'Bank', render: en => <EditCell en={en} field="vendor_bank" display={<span className="text-gray-500 truncate block max-w-[160px]">{en.vendor_bank || '—'}</span>} {...editProps} /> },
    { key: 'socials', label: 'Socials', render: en => { const s = socialsOf(en); return <span className="text-gray-500 truncate block max-w-[180px]">{s || '—'}</span> } },
    { key: 'payment_terms', label: 'Terms', render: en => <EditCell en={en} field="payment_terms" display={<span className="text-gray-500 whitespace-nowrap">{en.payment_terms || '—'}</span>} {...editProps} /> },
    { key: 'due', label: 'Due', render: en => { const d = dueDateStr(en); return <span className="text-gray-500 whitespace-nowrap">{d || '—'}</span> } },
    { key: 'recoupable', label: 'Recoup?', render: en => <button onClick={() => commitEdit(en, 'recoupable', !en.recoupable)} className="text-gray-500 hover:text-brand-600">{en.recoupable ? 'Yes' : 'No'}</button> },
    { key: 'ufr', label: 'UFR?', render: en => <span className="text-gray-500">{en.ufr ? 'Yes' : 'No'}</span> },
    { key: 'campaign', label: 'Campaign?', render: en => <span className="text-gray-500">{(en.campaign_id || en.artist_campaign === true) ? 'Yes' : 'No'}</span> },
    { key: 'reimbursement', label: 'Reimb?', render: en => <span className="text-gray-500">{en.is_reimbursement ? 'Yes' : 'No'}</span> },
    { key: 'cobrand', label: 'Cobrand?', render: en => <button onClick={() => commitEdit(en, 'cobrand', !en.cobrand)} className="text-gray-500 hover:text-brand-600">{en.cobrand ? 'Yes' : 'No'}</button> },
    { key: 'is_bulk_deal', label: 'Bulk deal?', render: en => <button onClick={() => commitEdit(en, 'is_bulk_deal', !en.is_bulk_deal)} className="text-gray-500 hover:text-brand-600">{en.is_bulk_deal ? 'Yes' : 'No'}</button> },
    { key: 'type', label: 'Type', render: en => <span className="text-gray-500">{en.is_reimbursement ? 'Reimb.' : 'Invoice'}</span> },
    { key: 'approved_by', label: 'Approved by', render: en => <span className="text-gray-500 whitespace-nowrap">{en.approved_by || '—'}</span> },
    { key: 'paid_by', label: 'Paid by', render: en => <span className="text-gray-500 whitespace-nowrap">{en.paid_by || '—'}</span> },
    { key: 'created_at', label: 'Uploaded', render: en => <span className="text-gray-500 whitespace-nowrap">{en.created_at ? formatDate(en.created_at) : '—'}</span> },
    { key: 'notes', label: 'Notes', render: en => <EditCell en={en} field="notes" display={<span className="text-gray-600 truncate block max-w-[220px]">{en.notes || '—'}</span>} {...editProps} /> },
    { key: 'payment_ref', label: 'Ref', render: en => <EditCell en={en} field="payment_ref" display={<span className="text-gray-500 whitespace-nowrap">{en.payment_ref || '—'}</span>} {...editProps} /> },
    { key: 'invoice_file', label: 'Invoice', render: en => <FileCell en={en} type="invoice" r2key={en.invoice_r2_key} openFile={openFile} onUploaded={load} toast={toast} /> },
    { key: 'w9_file', label: 'W9', render: en => <FileCell en={en} type="w9" r2key={en.w9_r2_key} openFile={openFile} onUploaded={load} toast={toast} /> },
    { key: 'receipt_file', label: 'Receipt / proof', render: en => <FileCell en={en} type="receipt" r2key={en.receipt_r2_key} openFile={openFile} onUploaded={load} toast={toast} /> },
    { key: 'files', label: 'Files', render: en => <FilesCell en={en} openFile={openFile} /> },
  ]
  const ALL_KEYS = COLS.map(c => c.key)
  const DEFAULT_COLS = ['invoice_date', 'payee', 'artist', 'song', 'category', 'amount', 'status', 'payment', 'files']
  const storeKey = `ledger-cols:${label?.id || 0}:${user?.id || 0}`
  const [visible, setVisible] = useState(DEFAULT_COLS)
  const [colMenu, setColMenu] = useState(false)
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(storeKey) || 'null'); if (Array.isArray(s) && s.length) setVisible(s.filter(k => ALL_KEYS.includes(k))) } catch { /* default */ }
  }, [storeKey]) // eslint-disable-line
  const toggleCol = (key) => setVisible(v => { const n = v.includes(key) ? v.filter(k => k !== key) : [...v, key]; localStorage.setItem(storeKey, JSON.stringify(n)); return n })
  const shownCols = COLS.filter(c => visible.includes(c.key))

  const load = () => {
    setLoading(true)
    api.get('/ledger/entries').then(res => setEntries(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { api.get('/artists').then(r => setArtistNames((r.data.data || []).map(a => a.name).filter(Boolean))).catch(() => {}) }, [])

  // Hotkey: z = undo last inline edit (ignored while typing).
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'z' && !e.metaKey && !e.ctrlKey) undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line

  // Focus deep-link: scroll + amber spotlight for a few seconds.
  const rowRefs = useRef({})
  useEffect(() => {
    if (!focusId || loading) return
    const el = rowRefs.current[focusId]
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('ring-2', 'ring-amber-400'); setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 3500) }
  }, [focusId, loading, entries])

  const cyclePaid = async (en) => {
    const next = PAID_CYCLE[en.payment_status] || 'Paid'
    try {
      if (next === 'Paid') await api.post(`/ledger/entries/${en.id}/mark-paid`, {})   // stamps fx + notify path
      else await api.patch(`/ledger/entries/${en.id}`, { payment_status: next })
      load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const act = async (id, path, body) => { try { await api.post(`/ledger/entries/${id}/${path}`, body || {}); load() } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') } }
  const reject = async (id) => { const reason = window.prompt('Reason for rejection (required):')?.trim(); if (!reason) return; act(id, 'reject', { reason }) }
  const remove = async (id) => { if (!window.confirm('Delete this entry?')) return; try { await api.delete(`/ledger/entries/${id}`); load() } catch { toast('Failed', 'error') } }
  function openFile(id, type) { api.get(`/ledger/entries/${id}/file/${type}`).then(({ data }) => window.open(data.data.url, '_blank', 'noopener')).catch(() => toast('No file', 'error')) }

  const copyVendorLink = () => {
    const url = `${window.location.origin}/submit/${label?.vendor_form_token}`
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const open1099 = async () => { try { const { data } = await api.get('/ledger/1099-report'); setReport1099(data.data) } catch { toast('Failed to load 1099 report', 'error') } }
  const exportCsv = async () => {
    try {
      const res = await api.get('/ledger/export', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }))
      const a = document.createElement('a'); a.href = url; a.download = `ledger-${label?.slug || 'export'}.csv`
      document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
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

  // ── Apply filters + sort client-side ──────────────────────────────────
  // Filter option lists derived from what's actually loaded.
  const distinct = (key) => [...new Set(entries.map(e => e[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
  const artistOpts = useMemo(() => distinct('artist'), [entries])
  const repOpts = useMemo(() => distinct('rep'), [entries])
  const currencyOpts = useMemo(() => distinct('currency'), [entries])
  const ynMatch = (mode, val) => mode === '' || (mode === 'yes' ? !!val : !val)
  const advancedActive = fArtist || fRep || fCurrency || fType || fRecoup || fCobrand || fBulk || fUfr || fCampaign
  const clearAdvanced = () => { setFArtist(''); setFRep(''); setFCurrency(''); setFType(''); setFRecoup(''); setFCobrand(''); setFBulk(''); setFUfr(''); setFCampaign('') }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const amt = amountPred(amountQ)
    let list = entries.filter(en => {
      if (status !== 'all' && en.status !== status) return false
      if (q && !`${en.payee} ${en.artist} ${en.song} ${en.invoice_number}`.toLowerCase().includes(q)) return false
      if (amt && !amt(Number(en.amount) || 0)) return false
      if (fCategory && en.category !== fCategory) return false
      if (fPaid && (en.payment_status || 'Unpaid') !== fPaid) return false
      if (fMethod && en.payment_method !== fMethod) return false
      if (fSource === 'vendor' && !en.vendor_submitted) return false
      if (fSource === 'manual' && en.vendor_submitted) return false
      if (flaggedOnly && !(en.ai_scan?.discrepancies?.length || en.w9_scan?.discrepancies?.length)) return false
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
      if (!ynMatch(fCampaign, en.campaign_id || en.artist_campaign === true)) return false
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    list = [...list].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key]
      if (sort.key === 'amount') { av = Number(av) || 0; bv = Number(bv) || 0; return (av - bv) * dir }
      if (sort.key === 'invoice_date') { av = av || ''; bv = bv || ''; return av < bv ? -dir : av > bv ? dir : 0 }
      return String(av || '').localeCompare(String(bv || '')) * dir
    })
    return list
  }, [entries, status, search, amountQ, fCategory, fPaid, fMethod, fSource, flaggedOnly, fArtist, fRep, fCurrency, fType, fRecoup, fCobrand, fBulk, fUfr, fCampaign, sort])

  const totals = useMemo(() => {
    const t = {}
    filtered.filter(e => !e.voided).forEach(e => { t[e.currency || 'USD'] = (t[e.currency || 'USD'] || 0) + (Number(e.amount) || 0) })
    return t
  }, [filtered])

  const setSortKey = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })

  return (
    <div>
      <PageHeader
        title="Ledger"
        subtitle="Expenses and vendor payments"
        action={
          <div className="flex items-center gap-2">
            <button onClick={open1099} className="btn-secondary"><FileBarChart size={15} /> 1099</button>
            <button onClick={exportCsv} className="btn-secondary"><Download size={15} /> Export</button>
            <button onClick={() => importRef.current?.click()} disabled={importing} className="btn-secondary"><Upload size={15} /> {importing ? 'Importing…' : 'Import'}</button>
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={onImportFile} />
            <button onClick={copyVendorLink} className="btn-secondary">{copied ? <><Check size={15} /> Copied</> : <><Link2 size={15} /> Vendor form link</>}</button>
            <button onClick={() => setQuickOpen(true)} className="btn-secondary"><Plus size={16} /> Add expense</button>
            <Link to="/ledger/new-reimbursement" className="btn-secondary"><Plus size={16} /> Add reimbursement</Link>
            <Link to="/ledger/new-invoice" className="btn-primary"><Plus size={16} /> Add invoice</Link>
          </div>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search payee, artist, song, invoice #…" className="input !pl-9" />
        </div>
        <input value={amountQ} onChange={e => setAmountQ(e.target.value)} placeholder="Amount: 500 · 500-1000 · >500" className="input !w-52" />
        <select className="input !w-auto" value={fCategory} onChange={e => setFCategory(e.target.value)}><option value="">All categories</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className="input !w-auto" value={fPaid} onChange={e => setFPaid(e.target.value)}><option value="">Any payment</option><option>Unpaid</option><option>Partial</option><option>Paid</option></select>
        <select className="input !w-auto" value={fMethod} onChange={e => setFMethod(e.target.value)}><option value="">Any method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select>
        <select className="input !w-auto" value={fSource} onChange={e => setFSource(e.target.value)}><option value="">Any source</option><option value="vendor">Vendor-submitted</option><option value="manual">Manual</option></select>
        <button onClick={() => setFlaggedOnly(v => !v)} className={`text-xs font-semibold px-3 py-2 rounded-lg ${flaggedOnly ? 'bg-red-600 text-white' : 'text-gray-500 hover:bg-gray-100 border border-rule'}`}>⚠ Flagged</button>
        <button onClick={() => setMoreOpen(v => !v)} className={`text-xs font-semibold px-3 py-2 rounded-lg border ${advancedActive ? 'bg-brand-50 text-brand-700 border-brand-300' : 'text-gray-500 hover:bg-gray-100 border-rule'}`}>More filters{advancedActive ? ' •' : ''}</button>
        <div className="relative">
          <button onClick={() => setColMenu(v => !v)} className="btn-secondary"><SlidersHorizontal size={15} /> Columns</button>
          {colMenu && (
            <div className="absolute right-0 top-full mt-1 z-30 w-48 card p-2 shadow-modal" onMouseLeave={() => setColMenu(false)}>
              {COLS.map(c => (
                <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-sm text-ink hover:bg-gray-50 rounded cursor-pointer">
                  <input type="checkbox" checked={visible.includes(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Advanced filters — matched to the extended column set */}
      {moreOpen && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-page/60 border border-rule">
          <select className="input !w-auto" value={fArtist} onChange={e => setFArtist(e.target.value)}><option value="">Any artist</option>{artistOpts.map(a => <option key={a}>{a}</option>)}</select>
          <select className="input !w-auto" value={fRep} onChange={e => setFRep(e.target.value)}><option value="">Any rep</option>{repOpts.map(r => <option key={r}>{r}</option>)}</select>
          <select className="input !w-auto" value={fCurrency} onChange={e => setFCurrency(e.target.value)}><option value="">Any currency</option>{currencyOpts.map(c => <option key={c}>{c}</option>)}</select>
          <select className="input !w-auto" value={fType} onChange={e => setFType(e.target.value)}><option value="">Any type</option><option value="invoice">Invoice</option><option value="reimb">Reimbursement</option></select>
          <select className="input !w-auto" value={fRecoup} onChange={e => setFRecoup(e.target.value)}><option value="">Recoup: any</option><option value="yes">Recoupable</option><option value="no">Not recoupable</option></select>
          <select className="input !w-auto" value={fCampaign} onChange={e => setFCampaign(e.target.value)}><option value="">Campaign: any</option><option value="yes">In a campaign</option><option value="no">Not in a campaign</option></select>
          <select className="input !w-auto" value={fUfr} onChange={e => setFUfr(e.target.value)}><option value="">UFR: any</option><option value="yes">UFR uploaded</option><option value="no">No UFR</option></select>
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
        <div className="card p-10 text-center"><BookOpen size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No entries match.</p></div>
      ) : isMobile ? (
        /* Mobile card list (<768px). Tap a card to open the detail drawer;
           inline quick actions mirror the desktop row actions. */
        <div className="space-y-2">
          {filtered.map(en => (
            <div
              key={en.id}
              ref={el => (rowRefs.current[en.id] = el)}
              onClick={() => setDrawerEntry(en)}
              className={`card p-3 ${en.voided ? 'opacity-50' : ''} ${en.entry_source === 'expense' ? 'bg-sky-50/70 border-sky-200' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{en.payee || '—'}</p>
                  <p className="text-[11px] text-gray-400 truncate">{[en.category, en.artist].filter(Boolean).join(' · ') || '—'} · {formatDate(en.invoice_date)}</p>
                </div>
                <span className={`flex-shrink-0 inline-block px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-semibold text-ink tabular-nums">{money(en.amount, en.currency)}</span>
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => cyclePaid(en)} className={`text-[11px] font-medium px-1.5 ${PAID_STYLE[en.payment_status] || PAID_STYLE.Unpaid}`}>{en.payment_status || 'Unpaid'}</button>
                  {en.status === 'pending' && (
                    <>
                      <button onClick={() => act(en.id, 'approve')} title="Approve" className="text-emerald-600 p-1"><Check size={16} /></button>
                      <button onClick={() => reject(en.id)} title="Reject" className="text-red-500 p-1"><X size={16} /></button>
                    </>
                  )}
                  {en.status === 'approved' && en.payment_status !== 'Paid' && (
                    <button onClick={() => act(en.id, 'mark-paid')} title="Mark paid" className="text-gray-500 p-1"><DollarSign size={16} /></button>
                  )}
                  <button onClick={() => setDrawerEntry(en)} title="Details" className="text-gray-400 p-1"><SlidersHorizontal size={15} /></button>
                </div>
              </div>
            </div>
          ))}
          <div className="card px-3 py-2.5 text-[11px] font-semibold text-gray-500 sticky bottom-16">
            Totals: {Object.entries(totals).map(([c, a]) => `${c} ${a.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join('  ·  ') || '—'}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-page/50 border-b border-divider text-left">
                {shownCols.map((c, ci) => (
                  <th key={c.key} onClick={() => setSortKey(c.key)} className={`px-3 py-2.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-gray-600 ${ci === 0 ? 'sticky left-0 z-20 bg-page' : ''}`}>
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {filtered.map(en => (
                <tr key={en.id} ref={el => (rowRefs.current[en.id] = el)} className={`group align-top transition-shadow ${en.voided ? 'opacity-50' : ''} ${en.entry_source === 'expense' ? 'bg-sky-50/70 hover:bg-sky-100/70' : 'hover:bg-gray-50'}`}>
                  {shownCols.map((c, ci) => <td key={c.key} className={`px-3 py-3 ${ci === 0 ? `sticky left-0 z-10 ${en.entry_source === 'expense' ? 'bg-sky-50' : 'bg-card'} group-hover:bg-gray-50` : ''}`}>{c.render(en)}</td>)}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
                      {en.status === 'pending' && (
                        <>
                          <button onClick={() => act(en.id, 'approve')} title="Approve" className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Check size={15} /></button>
                          <button onClick={() => reject(en.id)} title="Reject" className="text-red-500 hover:bg-red-50 p-1 rounded"><X size={15} /></button>
                        </>
                      )}
                      {en.status === 'approved' && en.payment_status !== 'Paid' && (
                        <button onClick={() => act(en.id, 'mark-paid')} title="Mark paid" className="text-gray-500 hover:text-emerald-600 p-1 rounded"><DollarSign size={15} /></button>
                      )}
                      <button onClick={() => setEditEntry(en)} title="Edit" className="text-gray-400 hover:text-brand-600 p-1 rounded"><Pencil size={14} /></button>
                      <button onClick={() => setDrawerEntry(en)} title="Details" className="text-gray-400 hover:text-brand-600 p-1 rounded"><SlidersHorizontal size={14} /></button>
                      <button onClick={() => remove(en.id)} title="Delete" className="text-gray-300 hover:text-danger p-1 rounded"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-divider bg-page/40">
                <td className="px-3 py-2.5 text-[11px] font-semibold text-gray-500" colSpan={shownCols.length + 1}>
                  Totals: {Object.entries(totals).map(([c, a]) => `${c} ${a.toLocaleString(undefined, { minimumFractionDigits: 2 })}`).join('  ·  ') || '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Undo affordance for inline edits (also: press z) */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-6 left-6 z-[90] flex items-center gap-3 bg-card border border-rule shadow-modal rounded-xl px-4 py-2.5">
          <span className="text-xs text-gray-500">Edited {undoStack[undoStack.length - 1].label}</span>
          <button onClick={undoLast} className="text-xs font-semibold text-brand-600 hover:underline">Undo (z)</button>
        </div>
      )}

      {drawerEntry && <LedgerEntryDrawer entry={drawerEntry} onClose={() => setDrawerEntry(null)} onChanged={load} />}
      {quickOpen && <QuickExpenseModal artistNames={artistNames} toast={toast} onClose={() => setQuickOpen(false)} onCreated={() => { setQuickOpen(false); load() }} />}
      {editEntry && <EditEntryModal entry={editEntry} artistNames={artistNames} toast={toast} onClose={() => setEditEntry(null)} onSaved={() => { setEditEntry(null); load() }} />}

      {report1099 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-overlay overflow-y-auto" onClick={() => setReport1099(null)}>
          <div className="w-full max-w-2xl bg-card rounded-2xl border border-rule shadow-modal my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-divider">
              <h2 className="text-base font-semibold text-ink">1099 report · {report1099.year} <span className="text-xs font-normal text-gray-400">(paid ≥ $600)</span></h2>
              <button onClick={() => setReport1099(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {report1099.vendors.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-400">No vendors crossed the $600 threshold this year.</p>
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
          </div>
        </div>
      )}
    </div>
  )
}

// Editable cell: click to edit; Enter/blur commits, Esc cancels. Module-scope
// (identity stable across renders) so the input keeps focus while typing.
function EditCell({ en, field, kind = 'text', options, display, editing, draft, setDraft, commitEdit, beginEdit, setEditing, artistNames }) {
  if (editing?.id === en.id && editing?.key === field) {
    const common = { autoFocus: true, className: 'input !py-1 !px-1.5 text-sm w-full', value: draft, onChange: e => setDraft(e.target.value), onBlur: () => commitEdit(en, field, draft), onKeyDown: e => { if (e.key === 'Enter') commitEdit(en, field, draft); if (e.key === 'Escape') setEditing(null) } }
    if (kind === 'select') return <select {...common}><option value="">—</option>{options.map(o => <option key={o}>{o}</option>)}</select>
    if (kind === 'number') return <input type="number" step="0.01" {...common} />
    if (kind === 'datalist') return <><input list="ledger-artists" {...common} /><datalist id="ledger-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></>
    return <input {...common} />
  }
  return <span onClick={() => beginEdit(en, field)} className="cursor-text hover:bg-brand-50/60 rounded px-1 -mx-1 block min-h-[1.25rem]" title="Click to edit">{display}</span>
}

function PayeeCell({ en, onFlag }) {
  const flags = (en.ai_scan?.discrepancies?.length || 0) + (en.w9_scan?.discrepancies?.length || 0)
  return (
    <div>
      <p className={`font-medium text-ink ${en.voided ? 'line-through' : ''}`}>{en.payee}</p>
      {en.vendor_submitted && <span className="text-[10px] text-brand-600 font-semibold uppercase">Vendor</span>}
      {en.voided && <span className="text-[10px] text-red-500 font-semibold uppercase ml-1">Voided</span>}
      {en.split_count > 0 && <span className="text-[10px] text-gray-400 font-semibold uppercase ml-1">{en.split_count} splits</span>}
      {en.is_bulk_deal && <span className="text-[10px] text-violet-500 font-semibold uppercase ml-1">Bulk</span>}
      {en.rush && <span className="text-[10px] text-amber-600 font-semibold uppercase ml-1">⚡ Rush</span>}
      {flags > 0 && <button onClick={onFlag} className="text-[10px] text-red-600 font-semibold uppercase ml-1 hover:underline">⚠ {flags} flag(s)</button>}
    </div>
  )
}

function FilesCell({ en, openFile }) {
  return (
    <div className="flex gap-1.5">
      {en.invoice_r2_key && <button onClick={() => openFile(en.id, 'invoice')} title="Invoice" className="text-gray-400 hover:text-brand-600"><Paperclip size={14} /></button>}
      {en.w9_r2_key && <button onClick={() => openFile(en.id, 'w9')} title="W9" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">W9</button>}
      {en.receipt_r2_key && <button onClick={() => openFile(en.id, 'receipt')} title="Receipt" className="text-[10px] text-gray-400 hover:text-brand-600 font-bold">RCT</button>}
      {!en.invoice_r2_key && !en.w9_r2_key && !en.receipt_r2_key && <span className="text-gray-300">—</span>}
    </div>
  )
}

// A per-type file cell: opens the file if present, and always offers an
// upload/replace control so files can be attached straight from the ledger.
function FileCell({ en, type, r2key, openFile, onUploaded, toast }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const upload = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      await api.post(`/ledger/entries/${en.id}/file/${type}`, fd)
      onUploaded()
    } catch { toast('Upload failed', 'error'); setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {r2key && <button onClick={() => openFile(en.id, type)} className="text-brand-600 hover:underline text-xs">Open</button>}
      <button onClick={() => ref.current?.click()} title={r2key ? 'Replace file' : 'Upload file'} className="text-gray-300 hover:text-brand-600">
        {busy ? <span className="text-[10px] text-gray-400">…</span> : <Upload size={13} />}
      </button>
      <input ref={ref} type="file" accept="application/pdf,image/*" hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }} />
    </span>
  )
}

// Quick-add an expense straight from the ledger — no invoice number or file
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
    <div className="fixed inset-0 z-[60] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink">Add expense</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">For a cost with no invoice — no invoice number or file needed.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
          <div className="col-span-2"><label className="label">Description / paid to *</label><input className="input" value={f.payee} onChange={set('payee')} placeholder="e.g. Studio rental, office supplies" /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">Select category</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Artist</label><input list="qx-artists" className="input" value={f.artist} onChange={set('artist')} /><datalist id="qx-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
          <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
          <div><label className="label">Payment method</label><select className="input" value={f.payment_method} onChange={set('payment_method')}><option value="">Select method</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div className="flex items-end"><label className="inline-flex items-center gap-2 text-sm text-gray-600 pb-2"><input type="checkbox" checked={f.recoupable} onChange={e => setF(s => ({ ...s, recoupable: e.target.checked }))} /> Recoupable</label></div>
          <div className="col-span-2"><label className="label">Notes</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
          <div className="col-span-2">
            <label className="label">Proof of payment <span className="text-gray-400 font-normal">— optional</span></label>
            <div
              onClick={() => proofRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); takeProof(e.dataTransfer.files?.[0]) }}
              className={`border-2 border-dashed rounded-lg px-4 py-5 text-center text-sm cursor-pointer transition ${dragOver ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-rule text-gray-400 hover:border-brand-300'}`}>
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
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Adding…' : 'Add expense'}</button>
        </div>
      </div>
    </div>
  )
}

// Full edit form for a ledger entry — every editable field in one place (for
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
    rep: entry.rep || '', vendor_email: entry.vendor_email || '', vendor_address: entry.vendor_address || '',
    vendor_bank: entry.vendor_bank || '', payment_terms: entry.payment_terms || '', payment_ref: entry.payment_ref || '',
    notes: entry.notes || '',
    recoupable: !!entry.recoupable, cobrand: !!entry.cobrand, is_bulk_deal: !!entry.is_bulk_deal, is_reimbursement: !!entry.is_reimbursement,
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const chk = (k) => (e) => setF(s => ({ ...s, [k]: e.target.checked }))

  const save = async () => {
    if (!f.payee.trim() || f.amount === '' || f.amount == null) { toast('Payee and amount are required', 'error'); return }
    setSaving(true)
    try {
      const payload = {}
      for (const [k, v] of Object.entries(f)) payload[k] = v === '' ? null : v   // empty → null (dates/amount)
      await api.patch(`/ledger/entries/${entry.id}`, payload)
      toast('Entry updated')
      onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-ink truncate">Edit · {entry.payee || 'entry'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Payee / description *</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Invoice #</label><input className="input" value={f.invoice_number} onChange={set('invoice_number')} /></div>
          <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
          <div><label className="label">Artist</label><input list="edit-artists" className="input" value={f.artist} onChange={set('artist')} /><datalist id="edit-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></div>
          <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
          <div><label className="label">Payment method</label><select className="input" value={f.payment_method} onChange={set('payment_method')}><option value="">—</option>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</select></div>
          <div><label className="label">Payment status</label><select className="input" value={f.payment_status} onChange={set('payment_status')}><option>Unpaid</option><option>Partial</option><option>Paid</option></select></div>
          <div><label className="label">Paid on</label><input type="date" className="input" value={f.payment_date} onChange={set('payment_date')} /></div>
          <div><label className="label">Scheduled</label><input type="date" className="input" value={f.scheduled_payment_date} onChange={set('scheduled_payment_date')} /></div>
          <div><label className="label">Terms</label><input className="input" value={f.payment_terms} onChange={set('payment_terms')} placeholder="e.g. Net 30" /></div>
          <div><label className="label">Payment ref</label><input className="input" value={f.payment_ref} onChange={set('payment_ref')} /></div>
          <div><label className="label">Vendor email</label><input type="email" className="input" value={f.vendor_email} onChange={set('vendor_email')} /></div>
          <div className="col-span-2"><label className="label">Mailing address</label><input className="input" value={f.vendor_address} onChange={set('vendor_address')} /></div>
          <div><label className="label">Bank</label><input className="input" value={f.vendor_bank} onChange={set('vendor_bank')} /></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Description</label><input className="input" value={f.description} onChange={set('description')} /></div>
          <div className="col-span-2 md:col-span-3"><label className="label">Notes</label><input className="input" value={f.notes} onChange={set('notes')} /></div>
          <div className="col-span-2 md:col-span-3 flex flex-wrap items-center gap-4 rounded-lg bg-page/60 border border-rule px-3 py-2.5">
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.recoupable} onChange={chk('recoupable')} /> Recoupable</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.is_reimbursement} onChange={chk('is_reimbursement')} /> Reimbursement</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.cobrand} onChange={chk('cobrand')} /> Cobrand</label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.is_bulk_deal} onChange={chk('is_bulk_deal')} /> Bulk deal</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

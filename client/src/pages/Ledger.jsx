import { useEffect, useState, useRef, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Check, X, Trash2, Paperclip, Link2, BookOpen, DollarSign, Download, Upload, SlidersHorizontal, FileBarChart, Search } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import LedgerEntryDrawer from '../components/LedgerEntryDrawer'
import { formatDate } from '../utils/dates'
import useIsMobile from '../hooks/useIsMobile'
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../constants'

const STATUS_STYLES = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' }
const STATUSES = ['all', 'pending', 'approved', 'rejected']
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
  const [sort, setSort] = useState({ key: 'invoice_date', dir: 'desc' })

  const [copied, setCopied] = useState(false)
  const importRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState(null)
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

  // Editable cell: click to edit; Enter/blur commits, Esc cancels.
  const EditCell = ({ en, field, kind = 'text', options, display }) => {
    if (editing?.id === en.id && editing?.key === field) {
      const common = { autoFocus: true, className: 'input !py-1 !px-1.5 text-sm w-full', value: draft, onChange: e => setDraft(e.target.value), onBlur: () => commitEdit(en, field, draft), onKeyDown: e => { if (e.key === 'Enter') commitEdit(en, field, draft); if (e.key === 'Escape') setEditing(null) } }
      if (kind === 'select') return <select {...common}><option value="">—</option>{options.map(o => <option key={o}>{o}</option>)}</select>
      if (kind === 'number') return <input type="number" step="0.01" {...common} />
      if (kind === 'datalist') return <><input list="ledger-artists" {...common} /><datalist id="ledger-artists">{artistNames.map(a => <option key={a} value={a} />)}</datalist></>
      return <input {...common} />
    }
    return <span onClick={() => beginEdit(en, field)} className="cursor-text hover:bg-brand-50/60 rounded px-1 -mx-1 block min-h-[1.25rem]" title="Click to edit">{display}</span>
  }

  // ── Toggleable columns, persisted per user+workspace ──────────────────
  const COLS = [
    { key: 'invoice_date', label: 'Date', render: en => <span className="text-gray-500 whitespace-nowrap">{formatDate(en.invoice_date)}</span> },
    { key: 'payee', label: 'Payee', render: en => <PayeeCell en={en} onFlag={() => setDrawerEntry(en)} /> },
    { key: 'artist', label: 'Artist', render: en => <EditCell en={en} field="artist" kind="datalist" display={<span className="text-gray-600">{en.artist || '—'}</span>} /> },
    { key: 'song', label: 'Song', render: en => <EditCell en={en} field="song" display={<span className="text-gray-600">{en.song || '—'}</span>} /> },
    { key: 'category', label: 'Category', render: en => <EditCell en={en} field="category" kind="select" options={EXPENSE_CATEGORIES} display={<span className="text-gray-600 whitespace-nowrap">{en.category || '—'}</span>} /> },
    { key: 'invoice_number', label: 'Invoice #', render: en => <EditCell en={en} field="invoice_number" display={<span className="text-gray-500 whitespace-nowrap">{en.invoice_number || '—'}</span>} /> },
    { key: 'amount', label: 'Amount', render: en => <EditCell en={en} field="amount" kind="number" display={<span className="text-ink font-medium whitespace-nowrap tabular-nums">{money(en.amount, en.currency)}</span>} /> },
    { key: 'status', label: 'Status', render: en => <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[en.status] || ''}`}>{en.status}</span> },
    { key: 'payment', label: 'Payment', render: en => <button onClick={() => cyclePaid(en)} title="Click to cycle" className={`text-xs font-medium hover:underline ${PAID_STYLE[en.payment_status] || PAID_STYLE.Unpaid}`}>{en.payment_status || 'Unpaid'}</button> },
    { key: 'payment_method', label: 'Method', render: en => <EditCell en={en} field="payment_method" kind="select" options={PAYMENT_METHODS} display={<span className="text-gray-500 whitespace-nowrap">{en.payment_method || '—'}</span>} /> },
    { key: 'rep', label: 'Rep', render: en => <EditCell en={en} field="rep" display={<span className="text-gray-500">{en.rep || '—'}</span>} /> },
    { key: 'recoupable', label: 'Recoup', render: en => <button onClick={() => commitEdit(en, 'recoupable', !en.recoupable)} className="text-gray-500 hover:text-brand-600">{en.recoupable ? 'Yes' : 'No'}</button> },
    { key: 'type', label: 'Type', render: en => <span className="text-gray-500">{en.is_reimbursement ? 'Reimb.' : 'Invoice'}</span> },
    { key: 'files', label: 'Files', render: en => <FilesCell en={en} openFile={openFile} /> },
  ]
  const ALL_KEYS = COLS.map(c => c.key)
  const DEFAULT_COLS = ['invoice_date', 'payee', 'category', 'amount', 'status', 'payment', 'files']
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
  useEffect(load, [])
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
    const url = `${window.location.origin}/submit/${label?.vendor_form_token || label?.slug}`
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
  }, [entries, status, search, amountQ, fCategory, fPaid, fMethod, fSource, flaggedOnly, sort])

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
              className={`card p-3 ${en.voided ? 'opacity-50' : ''}`}
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
                <tr key={en.id} ref={el => (rowRefs.current[en.id] = el)} className={`group hover:bg-gray-50 align-top transition-shadow ${en.voided ? 'opacity-50' : ''}`}>
                  {shownCols.map((c, ci) => <td key={c.key} className={`px-3 py-3 ${ci === 0 ? 'sticky left-0 z-10 bg-card group-hover:bg-gray-50' : ''}`}>{c.render(en)}</td>)}
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

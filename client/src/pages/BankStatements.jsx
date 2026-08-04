import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Landmark, Upload, ArrowLeft, Trash2, Search, X, Check, Link2, Undo2, Ban, RotateCcw, DollarSign, Sparkles } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { EXPENSE_CATEGORIES } from '../constants'
import { dropTarget } from '../utils/drop'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const STATUS_CHIP = {
  open: 'bg-gray-100 text-gray-600', toconfirm: 'bg-amber-100 text-amber-700', matched: 'bg-sky-100 text-sky-700',
  booked: 'bg-emerald-100 text-emerald-700', dismissed: 'bg-gray-100 text-gray-400', credit: 'bg-violet-100 text-violet-700',
}
const STATUS_LABEL = { open: 'Open', toconfirm: 'To confirm', matched: 'Matched', booked: 'Booked', dismissed: 'Dismissed', credit: 'Credit' }

export default function BankStatements() {
  const { id } = useParams()
  return id ? <StatementDetail id={id} /> : <StatementList />
}

// ── List + upload ────────────────────────────────────────────────────────
function StatementList() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [statements, setStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(() => {
    api.get('/bank-statements').then(r => setStatements(r.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    api.get('/bank-statements/accounts').then(r => { setAccounts(r.data.data || []); setAccount((r.data.data || [])[0]?.key || '') }).catch(() => {})
    load()
  }, [load])
  // Poll while any statement is still parsing.
  useEffect(() => {
    if (!statements.some(s => s.status === 'parsing')) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [statements, load])

  const doUpload = async (file) => {
    if (!file) return
    if (!account) { toast('Choose an account first', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('account', account)
      const { data } = await api.post('/bank-statements/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast(data.data.status === 'parsing' ? 'Uploaded — parsing in the background' : 'Statement imported')
      load()
    } catch (err) { toast(err.response?.data?.error || 'Upload failed', 'error') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div>
      <PageHeader title="Bank Statements" subtitle="Reconcile bank activity against the ledger" />

      <div className="card p-5 mb-5">
        <div className="flex items-center gap-2 mb-1"><Landmark size={15} className="text-brand-600" /><h2 className="text-sm font-bold text-ink">Import a statement</h2></div>
        <p className="text-xs text-gray-400 mb-4">CSV imports instantly. PDF statements are parsed by AI in the background (may take a few minutes) — or upload the CSV export for speed.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[220px]" value={account} onChange={e => setAccount(e.target.value)}>
            {accounts.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary" {...dropTarget(doUpload)}>
            <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload CSV / PDF'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.pdf,application/pdf,text/csv" hidden onChange={e => doUpload(e.target.files?.[0])} />
        </div>
      </div>

      {loading ? <div className="card p-2"><Skeleton.Table rows={5} cols={5} /></div> : statements.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-gray-400">No statements yet. Upload one above to start reconciling.</p></div>
      ) : (
        <div className="card divide-y divide-divider">
          {statements.map(s => (
            <button key={s.id} onClick={() => s.status === 'ready' && navigate(`/bank-statements/${s.id}`)} className={`w-full text-left px-5 py-3.5 flex items-center gap-4 ${s.status === 'ready' ? 'hover:bg-gray-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink truncate">{s.account} · {s.filename || 'statement'}</p>
                <p className="text-[11px] text-gray-400">
                  {s.period_start ? `${formatDate(s.period_start)} – ${formatDate(s.period_end)} · ` : ''}{s.txn_count || 0} txns
                  {s.import_summary ? ` · ${s.import_summary.auto_matched || 0} auto-matched` : ''}
                </p>
              </div>
              {s.status === 'parsing' && <span className="text-[10px] font-semibold uppercase bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full animate-pulse">Parsing…</span>}
              {s.status === 'error' && <span title={s.error} className="text-[10px] font-semibold uppercase bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Error</span>}
              {s.status === 'ready' && s.open_count > 0 && <span className="text-[10px] font-semibold uppercase bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s.open_count} open</span>}
              {s.status === 'ready' && s.open_count === 0 && <span className="text-[10px] font-semibold uppercase bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Reconciled</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Statement detail (the mini-ledger) ─────────────────────────────────────
const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'toconfirm', label: 'To confirm' },
  { key: 'matched', label: 'Matched' }, { key: 'booked', label: 'Booked' }, { key: 'dismissed', label: 'Dismissed' },
]

function StatementDetail({ id }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(new Set())
  const [matchTxn, setMatchTxn] = useState(null)
  const [entryTxn, setEntryTxn] = useState(null)

  const load = useCallback(() => {
    api.get(`/bank-statements/${id}`).then(r => setData(r.data.data)).catch(() => toast('Failed to load', 'error')).finally(() => setLoading(false))
  }, [id, toast])
  useEffect(() => { load() }, [load])

  const act = async (txnId, path, body) => {
    try { await api.post(`/bank-statements/txns/${txnId}/${path}`, body || {}); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const bulk = async (action, extra) => {
    const ids = [...sel]; if (!ids.length) return
    try { const { data: r } = await api.post('/bank-statements/txns/bulk', { ids, action, ...extra }); toast(`${r.data.affected} updated`); setSel(new Set()); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const delRule = async (kind, ruleId) => { try { await api.delete(`/bank-statements/rules/${kind}/${ruleId}`); load() } catch { toast('Failed', 'error') } }

  const txns = data?.transactions || []
  const counts = useMemo(() => {
    const c = { all: 0, open: 0, toconfirm: 0, matched: 0, booked: 0, dismissed: 0, credit: 0 }
    txns.forEach(t => { if (t.direction === 'debit' && !t.dismissed) c.all++; c[t.disposition] = (c[t.disposition] || 0) + 1 })
    return c
  }, [txns])
  const debits = txns.filter(t => t.direction === 'debit')
  const credits = txns.filter(t => t.direction === 'credit')
  const shown = useMemo(() => {
    let list = debits
    if (filter === 'all') list = list.filter(t => !t.dismissed)
    else list = list.filter(t => t.disposition === filter)
    if (q.trim()) { const s = q.toLowerCase(); list = list.filter(t => [t.payee_guess, t.description, t.exp_payee, t.exp_category].some(v => String(v || '').toLowerCase().includes(s))) }
    return list
  }, [debits, filter, q])

  if (loading) return <div className="card p-6"><Skeleton.Block /></div>
  if (!data) return null
  const s = data.statement
  const cov = data.coverage || { matched: 0, live: 0 }
  const covPct = cov.live > 0 ? Math.round((cov.matched / cov.live) * 100) : 0
  const catStrip = Object.entries(data.catTotals || {}).sort((a, b) => b[1] - a[1])
  const toggle = (tid) => setSel(x => { const n = new Set(x); n.has(tid) ? n.delete(tid) : n.add(tid); return n })
  const selRows = shown.filter(t => sel.has(t.id))
  const selDisp = new Set(selRows.map(t => t.disposition))

  return (
    <div>
      <button onClick={() => navigate('/bank-statements')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-ink mb-3"><ArrowLeft size={15} /> All statements</button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><Landmark size={20} /> {s.account}</h1>
          <p className="text-sm text-gray-400">{s.period_start ? `${formatDate(s.period_start)} – ${formatDate(s.period_end)} · ` : ''}{s.txn_count} transactions{s.import_summary ? ` · ${s.import_summary.auto_matched || 0} auto-matched · ${s.import_summary.dup_skipped || 0} duplicates skipped` : ''}</p>
        </div>
        <button onClick={async () => { if (window.confirm('Delete this statement? Booked/matched ledger entries stay.')) { try { await api.delete(`/bank-statements/${id}`); navigate('/bank-statements') } catch { toast('Failed', 'error') } } }} className="text-gray-300 hover:text-danger p-2"><Trash2 size={16} /></button>
      </div>

      {/* Coverage + category strip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Coverage</p>
          <p className="text-2xl font-bold text-ink mt-1">{covPct}%</p>
          <p className="text-[11px] text-gray-400">{money(cov.matched)} of {money(cov.live)} live debits matched</p>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${covPct}%` }} /></div>
        </div>
        <div className="card p-4 lg:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Where the money went</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {catStrip.length ? catStrip.map(([cat, amt]) => (
              <span key={cat} className={cat === 'Unorganized' ? 'text-amber-600' : 'text-gray-600'}><span className="font-semibold text-ink">{money(amt)}</span> {cat}</span>
            )) : <span className="text-gray-400 text-sm">No debits yet.</span>}
          </div>
        </div>
      </div>

      {/* Filter chips + search */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`text-xs font-medium px-3 py-1.5 rounded-full ${filter === f.key ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label} <span className="opacity-70">{counts[f.key] || 0}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="input !pl-8 !py-1.5 text-sm w-48" />
        </div>
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-30 card shadow-modal px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 bg-brand-50 border-brand-200">
          <span className="text-sm font-medium text-ink">{sel.size} selected</span>
          {[...selDisp].every(d => d === 'open') && <>
            <CategoryQuickSelect onPick={(cat) => bulk('book', { category: cat })} label="Book as…" />
            <button onClick={() => bulk('dismiss')} className="btn-secondary !py-1.5 text-xs"><Ban size={13} /> Dismiss</button>
            <button onClick={() => bulk('accept-suggestions')} className="btn-secondary !py-1.5 text-xs"><Sparkles size={13} /> Accept high-confidence</button>
          </>}
          {[...selDisp].every(d => d === 'toconfirm') && <button onClick={() => bulk('mark-paid')} className="btn-secondary !py-1.5 text-xs"><DollarSign size={13} /> Mark paid</button>}
          <button onClick={() => setSel(new Set())} className="text-gray-400 hover:text-ink ml-1"><X size={16} /></button>
        </div>
      )}

      {/* The table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <th className="px-3 py-2.5 w-8"></th>
            {['Date', 'Payee', 'Category', 'Amount', 'Status', ''].map(h => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">No transactions in this view.</td></tr>}
            {shown.map(t => (
              <tr key={t.id} className="align-top hover:bg-gray-50">
                <td className="px-3 py-3"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{formatDate(t.txn_date)}</td>
                <td className="px-3 py-3 min-w-[220px]">
                  <p className="font-medium text-ink">{t.exp_payee || t.payee_guess || t.description || '—'}</p>
                  {t.exp_payee && (t.payee_guess || t.description) && <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{t.payee_guess || t.description}</p>}
                  {!t.exp_payee && t.payee_guess && t.description && t.payee_guess !== t.description && <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{t.description}</p>}
                </td>
                <td className="px-3 py-3">
                  {t.disposition === 'open'
                    ? <InlineCategory onPick={(cat) => act(t.id, 'book', { category: cat })} onEntry={() => setEntryTxn(t)} />
                    : <span className={t.exp_category ? 'text-gray-600' : 'text-amber-600'}>{t.exp_category || (t.dismissed ? '—' : 'Unorganized')}</span>}
                </td>
                <td className="px-3 py-3 text-ink font-medium whitespace-nowrap tabular-nums">{money(t.amount, t.currency)}{t.match_score != null && t.match_method?.startsWith('auto') && <span className="block text-[10px] text-gray-400 font-normal">{Math.round(t.match_score * 100)}% {t.match_method.replace('auto-', '')}</span>}</td>
                <td className="px-3 py-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_CHIP[t.disposition]}`}>{STATUS_LABEL[t.disposition]}{t.dismissed && t.dismissed_reason ? ` · ${t.dismissed_reason}` : ''}</span></td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5 justify-end whitespace-nowrap text-gray-400">
                    {t.disposition === 'open' && <>
                      <button onClick={() => setMatchTxn(t)} title="Match to a ledger entry" className="hover:text-brand-600 p-1"><Link2 size={15} /></button>
                      <button onClick={() => act(t.id, 'dismiss', {})} title="Dismiss" className="hover:text-danger p-1"><Ban size={15} /></button>
                      <button onClick={() => act(t.id, 'dismiss', { rule: true })} title="Always dismiss like this" className="hover:text-danger p-1 text-[10px] font-bold">∀</button>
                    </>}
                    {t.disposition === 'toconfirm' && <button onClick={() => act(t.id, 'mark-paid', {})} title="Mark paid" className="hover:text-emerald-600 p-1"><DollarSign size={15} /></button>}
                    {t.disposition === 'toconfirm' && <button onClick={() => act(t.id, 'unmatch', {})} title="Unlink" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'matched' && <button onClick={() => act(t.id, 'unmatch', {})} title="Unlink" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'booked' && <button onClick={() => act(t.id, 'unbook', {})} title="Unbook (removes the created entry)" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'dismissed' && <button onClick={() => act(t.id, 'restore', {})} title="Restore" className="hover:text-brand-600 p-1"><RotateCcw size={15} /></button>}
                    {t.matched_expense_id && <Link to={`/ledger?focus=${t.matched_expense_id}`} title="Open in ledger" className="hover:text-brand-600 p-1 text-[10px] font-bold">L</Link>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paid on ledger, no bank evidence */}
      {data.paidNoEvidence?.length > 0 && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-bold text-ink mb-1">Paid on the ledger, no bank evidence</h3>
          <p className="text-xs text-gray-400 mb-3">These entries are marked Paid in this period but no debit here matches them.</p>
          <div className="divide-y divide-divider">
            {data.paidNoEvidence.map(e => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <div><Link to={`/ledger?focus=${e.id}`} className="font-medium text-ink hover:text-brand-600">{e.payee}</Link><span className="text-[11px] text-gray-400 ml-2">{e.category || '—'} · paid {formatDate(e.payment_date)}</span></div>
                <span className="text-gray-600 tabular-nums">{money(e.amount, e.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credits (collapsed) */}
      {credits.length > 0 && (
        <details className="card p-5 mt-4">
          <summary className="text-sm font-bold text-ink cursor-pointer">Credits ({credits.length})</summary>
          <div className="divide-y divide-divider mt-2">
            {credits.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div><span className="text-gray-600">{t.payee_guess || t.description || '—'}</span><span className="text-[11px] text-gray-400 ml-2">{formatDate(t.txn_date)}</span></div>
                <span className="text-violet-600 tabular-nums">+{money(t.amount, t.currency)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Rules manager */}
      {(data.rules?.dismiss?.length > 0 || data.rules?.category?.length > 0) && (
        <div className="card p-5 mt-4">
          <h3 className="text-sm font-bold text-ink mb-3">Rules</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Book as category</p>
              {data.rules.category.length ? data.rules.category.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm py-1"><span className="text-gray-600 truncate">"{r.pattern}" → <span className="font-medium text-ink">{r.category}</span></span><button onClick={() => delRule('category', r.id)} className="text-gray-300 hover:text-danger"><X size={14} /></button></div>
              )) : <p className="text-xs text-gray-400">None yet.</p>}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Always dismiss</p>
              {data.rules.dismiss.length ? data.rules.dismiss.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm py-1"><span className="text-gray-600 truncate">"{r.pattern}"</span><button onClick={() => delRule('dismiss', r.id)} className="text-gray-300 hover:text-danger"><X size={14} /></button></div>
              )) : <p className="text-xs text-gray-400">None yet.</p>}
            </div>
          </div>
        </div>
      )}

      {matchTxn && <MatchModal txn={matchTxn} onClose={() => setMatchTxn(null)} onDone={() => { setMatchTxn(null); load() }} toast={toast} />}
      {entryTxn && <EntryModal txn={entryTxn} onClose={() => setEntryTxn(null)} onDone={() => { setEntryTxn(null); load() }} toast={toast} />}
    </div>
  )
}

// Inline "Categorize…" select — picking a category BOOKS the debit immediately.
function InlineCategory({ onPick, onEntry }) {
  return (
    <select className="input !py-1 !px-1.5 text-xs max-w-[150px]" value="" onChange={e => { if (e.target.value === '__entry') onEntry(); else if (e.target.value) onPick(e.target.value) }}>
      <option value="">Categorize…</option>
      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      <option value="__entry">Custom entry…</option>
    </select>
  )
}
function CategoryQuickSelect({ onPick, label }) {
  return (
    <select className="input !py-1.5 text-xs max-w-[160px]" value="" onChange={e => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

// Match dialog — top-3 suggestions + free ledger search.
function MatchModal({ txn, onClose, onDone, toast }) {
  const [sugg, setSugg] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  useEffect(() => { api.get(`/bank-statements/txns/${txn.id}/suggestions`).then(r => setSugg(r.data.data || [])).catch(() => setSugg([])) }, [txn.id])
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const t = setTimeout(() => api.get('/bank-statements/ledger-search', { params: { q } }).then(r => setResults(r.data.data || [])).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [q])
  const pick = async (expId) => {
    try { await api.post(`/bank-statements/txns/${txn.id}/match`, { expense_id: expId }); toast('Matched'); onDone() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-ink">Match transaction</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <p className="text-xs text-gray-400 mb-4">{txn.payee_guess || txn.description} · {money(txn.amount, txn.currency)} · {formatDate(txn.txn_date)}</p>
        {sugg && sugg.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Suggestions</p>
            <div className="flex flex-col gap-1.5">
              {sugg.map(x => (
                <button key={x.expense_id} onClick={() => pick(x.expense_id)} className="flex items-center justify-between text-left px-3 py-2 rounded-lg border border-rule hover:border-brand-400 hover:bg-brand-50/50">
                  <span className="text-sm text-ink truncate">{x.payee}{x.invoice_number ? <span className="text-gray-400"> · {x.invoice_number}</span> : ''}</span>
                  <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{money(x.amount, x.currency)} · {Math.round(x.score * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Search the ledger</p>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Payee or invoice #…" className="input mb-2" />
        <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto">
          {results.map(r => (
            <button key={r.id} onClick={() => pick(r.id)} className="flex items-center justify-between text-left px-3 py-2 rounded-lg border border-rule hover:border-brand-400 hover:bg-brand-50/50">
              <span className="text-sm text-ink truncate">{r.payee}{r.invoice_number ? <span className="text-gray-400"> · {r.invoice_number}</span> : ''}<span className="block text-[11px] text-gray-400">{r.payment_status} · {formatDate(r.invoice_date)}</span></span>
              <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{money(r.family_amount, r.currency)}</span>
            </button>
          ))}
          {q.trim() && results.length === 0 && <p className="text-xs text-gray-400 py-2">No unmatched ledger entries found.</p>}
        </div>
      </div>
    </div>
  )
}

// Fuller "Entry" form — book with a custom payee/artist + optional rule.
function EntryModal({ txn, onClose, onDone, toast }) {
  const [f, setF] = useState({ payee: txn.payee_guess || txn.description || '', category: '', artist: '', rule: false })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const save = async () => {
    setSaving(true)
    try { await api.post(`/bank-statements/txns/${txn.id}/book`, { payee: f.payee, category: f.category || null, artist: f.artist || null, rule: f.rule }); toast('Booked'); onDone() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-ink">Book as ledger entry</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <p className="text-xs text-gray-400 mb-4">{money(txn.amount, txn.currency)} · {formatDate(txn.txn_date)} — records an approved, Paid entry.</p>
        <div className="space-y-3">
          <div><label className="label">Payee</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">—</option>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Artist (optional)</label><input className="input" value={f.artist} onChange={set('artist')} /></div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.rule} onChange={set('rule')} /> Always book "{(txn.payee_guess || txn.description || '').slice(0, 40)}" as this category</label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Booking…' : 'Book entry'}</button></div>
      </div>
    </div>
  )
}

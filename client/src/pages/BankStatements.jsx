import { Fragment, useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  Landmark, Upload, ArrowLeft, Trash2, Search, X, Check, Link2, Undo2, Ban, RotateCcw, DollarSign, Sparkles,
  ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Loader, FileText, RefreshCw, Clock, Plus, Zap,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import CategoryOptions from '../components/CategoryOptions'
import StatementReviewDeck from '../components/statements/StatementReviewDeck'
import StatementFlagsCard from '../components/statements/StatementFlagsCard'
import { INCOME_TYPES } from '../constants'

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const STATUS_CHIP = {
  open: 'bg-gray-100 text-gray-600', toconfirm: 'bg-amber-100 text-amber-700', matched: 'bg-sky-100 text-sky-700',
  booked: 'bg-emerald-100 text-emerald-700', dismissed: 'bg-gray-100 text-gray-400',
  'open-credit': 'bg-violet-100 text-violet-700', 'booked-income': 'bg-emerald-100 text-emerald-700',
}
export const STATUS_LABEL = {
  open: 'Open', toconfirm: 'To confirm', matched: 'Matched', booked: 'Booked', dismissed: 'Dismissed',
  'open-credit': 'Money in', 'booked-income': 'Income',
}

// Open the original uploaded statement in a new tab. The endpoint is
// auth-gated, so fetch as a blob and hand the browser an object URL.
async function viewStmtFile(id, toast) {
  try {
    const r = await api.get(`/bank-statements/${id}/file`, { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err) {
    let msg = 'Could not open the file'
    try { msg = JSON.parse(await err.response?.data?.text?.())?.error || msg } catch { /* blob error body */ }
    toast(msg, 'error')
  }
}

export default function BankStatements() {
  const { id } = useParams()
  return id ? <StatementDetail id={id} /> : <StatementList />
}

// ── Library: month-grouped statements + upload + audits ─────────────────────
function StatementList() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState([])
  const [statements, setStatements] = useState([])
  const [months, setMonths] = useState([])
  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState('')
  const [uploading, setUploading] = useState(false)
  const [batch, setBatch] = useState(null) // { done, total, phase: 'uploading'|'parsing' }
  const [failures, setFailures] = useState([]) // per-file upload/parse failures
  const [dragOver, setDragOver] = useState(false)
  const [monthExpanded, setMonthExpanded] = useState(new Set())
  const [reparsing, setReparsing] = useState(null)
  // Extras audit — re-parses every stored PDF, so it runs only when asked.
  const [extras, setExtras] = useState(null)
  const [extrasBusy, setExtrasBusy] = useState(false)
  const [extrasOpen, setExtrasOpen] = useState(null)
  const [extrasRemoving, setExtrasRemoving] = useState(null)
  // Misfiled — fetched per statement (the detail names vendors).
  const [misfiled, setMisfiled] = useState({})
  const [misfiledOpen, setMisfiledOpen] = useState(null)
  const [misfiledBusy, setMisfiledBusy] = useState(null)
  const [misfiledFixing, setMisfiledFixing] = useState(null)
  const dragDepth = useRef(0)
  const fileRef = useRef(null)

  const acctLabel = useCallback((key) => accounts.find(a => a.key === key)?.label || key, [accounts])
  const extrasFor = (sid) => extras?.statements?.find(s => s.id === sid)

  const load = useCallback(() => {
    return Promise.all([
      api.get('/bank-statements').then(r => { setStatements(r.data.data || []); return r.data.data || [] }),
      api.get('/bank-statements/months').then(r => setMonths(r.data.data || [])).catch(() => {}),
    ]).catch(() => {}).finally(() => setLoading(false))
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

  // Batch upload: sequential per-file with a {done,total,phase} line, a
  // dismissible failure list, a poll over just-uploaded parsing ids, and a
  // single ready upload auto-opening.
  const handleUpload = async (fileList) => {
    const files = [...(fileList || [])].filter(f => /\.(csv|pdf)$/i.test(f.name))
    if (!files.length) return
    if (!account) { toast('Choose an account first', 'error'); return }
    setUploading(true)
    setFailures([])
    const uploaded = []
    const failed = []
    try {
      setBatch({ done: 0, total: files.length, phase: 'uploading' })
      for (const f of files) {
        try {
          const fd = new FormData(); fd.append('file', f); fd.append('account', account)
          const { data } = await api.post('/bank-statements/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
          uploaded.push(data.data)
        } catch (err) { failed.push(`${f.name}: ${err.response?.data?.error || err.message}`) }
        setBatch(b => b && { ...b, done: b.done + 1 })
      }
      load()
      const parsingIds = uploaded.filter(u => u.status === 'parsing').map(u => u.id)
      if (parsingIds.length) {
        setBatch({ done: 0, total: parsingIds.length, phase: 'parsing' })
        for (let i = 0; i < 300; i++) {
          await new Promise(r => setTimeout(r, 3000))
          const res = await api.get('/bank-statements').catch(() => null)
          const mine = (res?.data?.data || []).filter(s => parsingIds.includes(s.id))
          const still = mine.filter(s => s.status === 'parsing')
          setBatch({ done: parsingIds.length - still.length, total: parsingIds.length, phase: 'parsing' })
          if (!still.length) {
            mine.filter(s => s.status === 'error').forEach(s => failed.push(`${s.filename}: ${s.error || 'parse failed'}`))
            break
          }
        }
      }
      await load()
      // Single successful upload → straight into it (only once ready — a
      // still-parsing statement is an empty table with no explanation).
      if (uploaded.length === 1 && !failed.length) {
        const d = await api.get(`/bank-statements/${uploaded[0].id}`).catch(() => null)
        if (d?.data?.data?.statement?.status === 'ready') navigate(`/bank-statements/${uploaded[0].id}`)
      }
      if (failed.length) setFailures(failed)
    } finally {
      setBatch(null)
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Re-parse: strictly additive — report what was added / already present /
  // only-in-database, plus the doubling signature a duplicate import leaves.
  const reparseStatement = async (st) => {
    if (reparsing) return
    if (!window.confirm(`Re-parse "${st.filename}"?\n\nRuns the parser over the original file again and adds any transactions the first pass missed.\n\nNothing is deleted or overwritten — existing rows keep their matches and bookings.`)) return
    setReparsing(st.id)
    const report = (d) => {
      if (!d) { toast('Re-parse finished', 'success'); return }
      if (d.error) { window.alert('Re-parse failed: ' + d.error); return }
      const bits = [`${d.added} transaction${d.added === 1 ? '' : 's'} added`, `${d.already_present} already present`]
      if (d.duplicate_of_other_statement) bits.push(`${d.duplicate_of_other_statement} already on another statement`)
      if (d.only_in_database) bits.push(`${d.only_in_database} in the app but not in this parse — nothing removed`)
      const lines = [`Re-parsed ${d.parsed} row${d.parsed === 1 ? '' : 's'}.`, '', bits.join('\n'), '', `Statement now holds ${d.txn_count}.`]
      if (d.method === 'rules') lines.push('', "Parsed by rules and checked against the statement's own balances and section totals — this row count is arithmetically confirmed.")
      const surplus = (d.txn_count || 0) - (d.parsed || 0)
      if (d.parsed > 0 && d.txn_count >= d.parsed * 1.5) {
        lines.push('', `Warning: this statement holds ${surplus} more rows than the parse found — roughly ${(d.txn_count / d.parsed).toFixed(1)}x as many.`
          + (d.method === 'rules' ? ' Because the parse balances, the statement itself does not support those extra rows; that is what a duplicate import looks like.' : '')
          + ' Nothing was removed — worth a look before trusting this month.')
      } else if (d.added === 0) {
        lines.push('', 'Nothing new — the parser produced the same rows as before.'
          + (d.method === 'rules' ? '' : ' If you expected more, the PDF may be truncating; upload the CSV export instead.'))
        if (surplus > 0 && d.method === 'rules') {
          lines.push(`(${surplus} row${surplus === 1 ? '' : 's'} in the app aren't in this parse. Since the parse balances, the statement doesn't support them — most often duplicates from an earlier import. Nothing was removed.)`)
        }
      }
      window.alert(lines.join('\n'))
    }
    try {
      const { data } = await api.post(`/bank-statements/${st.id}/reparse`)
      const d = data.data || {}
      if (d.started) {
        // PDF re-parses background (an AI pass can take minutes) — poll the
        // list, then read the outcome from import_summary.reparse.
        const deadline = Date.now() + 20 * 60 * 1000
        for (;;) {
          await new Promise(r => setTimeout(r, 5000))
          let row = null
          try {
            const list = await api.get('/bank-statements')
            setStatements(list.data.data || [])
            row = (list.data.data || []).find(x => x.id === st.id)
          } catch { /* transient */ }
          if (row && row.status !== 'parsing') { report(row.import_summary?.reparse); break }
          if (Date.now() > deadline) { window.alert('Still parsing — it will finish in the background. Reopen this page in a few minutes.'); break }
        }
      } else report(d)
      await load()
    } catch (err) { window.alert('Re-parse failed: ' + (err.response?.data?.error || err.message)) }
    finally { setReparsing(null) }
  }

  const deleteStatement = async (st) => {
    if (!window.confirm(`Delete "${st.filename}"?\n\nIts parsed transactions and matches are removed. Ledger entries booked FROM this statement are archived with it (restorable); real matched invoices are not touched.`)) return
    try { await api.delete(`/bank-statements/${st.id}`); setExtras(null); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const checkExtras = async () => {
    if (extrasBusy) return
    setExtrasBusy(true)
    try { const r = await api.get('/bank-statements/extras'); setExtras(r.data.data) }
    catch (err) { toast(err.response?.data?.error || 'Could not check statements', 'error') }
    finally { setExtrasBusy(false) }
  }

  const removeExtras = async (st) => {
    const e = extrasFor(st.id)
    if (!e || !e.extraCount) return
    // Mismatched rows are not duplicates — the server refuses too, but saying
    // it here explains WHY instead of surfacing a bare 400.
    if (e.missingCount > 0) {
      window.alert(`Nothing to remove here.\n\nThis statement is also missing ${e.missingCount} transaction${e.missingCount === 1 ? '' : 's'} it charges, so the ${e.extraCount} apparent extras are the same transactions recorded under different details — commonly the wrong currency — not duplicates.\n\nRe-parse the statement to correct them.`)
      return
    }
    const ledger = [...new Set(e.groups.flatMap(g => g.matched_expense_ids))]
    if (!window.confirm(
      `Remove ${e.extraCount} extra transaction${e.extraCount === 1 ? '' : 's'} from "${st.filename}"?\n\n`
      + `The statement's own balances prove it holds ${e.expected} transactions. The app has ${e.held}.\n`
      + `Combined value of the extras: ${money(e.extraValue)}.\n\n`
      + (ledger.length ? `${ledger.length} ledger entr${ledger.length === 1 ? 'y' : 'ies'} will lose a bank match and may themselves be duplicates — worth reviewing after.\n\n` : '')
      + 'Only the surplus copies are deleted; rows carrying matches and dismissals are kept where possible. Nothing in the ledger is deleted.')) return
    setExtrasRemoving(st.id)
    try {
      const r = await api.post(`/bank-statements/${st.id}/extras/remove`)
      const d = r.data.data
      window.alert(`Removed ${d.removed} extra transaction${d.removed === 1 ? '' : 's'} worth ${money(d.value)}.\n\nStatement now holds ${d.txn_count}, matching the ${d.expected} its balances prove`
        + (d.txn_count === d.expected ? '.' : ` (${d.txn_count - d.expected} still differ).`)
        + (d.blocked_booked_income ? `\n\n${d.blocked_booked_income} left in place because they carry booked income — unbook those first.` : '')
        + (d.affected_expense_ids?.length ? `\n\n${d.affected_expense_ids.length} ledger entries lost a bank match. If they were created from the duplicate rows, they are duplicates too.` : ''))
      await load()
      checkExtras()
    } catch (err) { window.alert('Could not remove: ' + (err.response?.data?.error || err.message)) }
    finally { setExtrasRemoving(null) }
  }

  const openMisfiled = async (sid) => {
    if (misfiledOpen === sid) { setMisfiledOpen(null); return }
    setMisfiledOpen(sid)
    setExtrasOpen(null)
    if (misfiled[sid]) return
    setMisfiledBusy(sid)
    try { const r = await api.get(`/bank-statements/${sid}/misfiled`); setMisfiled(m => ({ ...m, [sid]: r.data.data })) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setMisfiledOpen(null) }
    finally { setMisfiledBusy(null) }
  }

  const repairMisfiled = async (st) => {
    const d = misfiled[st.id]
    if (!d?.repairs?.length) return
    const changing = d.repairs.filter(r => r.payee_changes)
    const losing = changing.filter(r => r.matched_expense_id || r.matched_income_id)
    if (!window.confirm(
      `Repair ${d.repairs.length} row${d.repairs.length === 1 ? '' : 's'} on "${st.filename}"?\n\n`
      + `Each one currently repeats another payment's details while a payment the statement charges is missing. The rows keep their id, date and amount; only who was paid changes.\n\n`
      + `${changing.length} change the vendor.\n`
      + `${losing.length} will lose their invoice match, because that invoice was matched to the OLD name — it goes back to the match pool for you to place.\n\nNothing in the ledger is deleted except bookings the app itself invented.`)) return
    setMisfiledFixing(st.id)
    try {
      const r = await api.post(`/bank-statements/${st.id}/misfiled/repair`)
      const out = r.data.data
      window.alert(`Repaired ${out.repaired} row${out.repaired === 1 ? '' : 's'}.\n${out.unmatched} lost a match; ${out.unbooked} invented booking${out.unbooked === 1 ? '' : 's'} removed.`)
      setMisfiled(m => ({ ...m, [st.id]: undefined }))
      setMisfiledOpen(null)
      await load()
      if (extras) checkExtras()
    } catch (err) { window.alert(err.response?.data?.error || err.message) }
    finally { setMisfiledFixing(null) }
  }

  const reconcileMonth = async (key, undo) => {
    try { await api.post(`/bank-statements/months/${key}/reconcile`, undo ? { undo: true } : {}); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  // Month grouping: statements by period month; processing rows (no period
  // yet) float to the top of the card.
  const { monthKeys, stByMonth, processing, monthOf } = useMemo(() => {
    const stByMonth = new Map()
    const processing = []
    for (const st of statements) {
      const mk = st.period_start ? String(st.period_start).slice(0, 7) : null
      if (!mk) { processing.push(st); continue }
      if (!stByMonth.has(mk)) stByMonth.set(mk, [])
      stByMonth.get(mk).push(st)
    }
    const monthOf = Object.fromEntries(months.map(m => [m.month_key, m]))
    const monthKeys = [...new Set([...stByMonth.keys(), ...months.map(m => m.month_key)])].sort((a, b) => b.localeCompare(a))
    return { monthKeys, stByMonth, processing, monthOf }
  }, [statements, months])
  const recCount = months.filter(m => m.reconciled_at).length

  return (
    <div
      onDragEnter={e => { e.preventDefault(); if (!uploading) { dragDepth.current++; setDragOver(true) } }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false) }}
      onDrop={e => {
        e.preventDefault()
        dragDepth.current = 0
        setDragOver(false)
        if (uploading) return
        const fs = [...(e.dataTransfer?.files || [])].filter(f => /\.(csv|pdf)$/i.test(f.name))
        if (fs.length) handleUpload(fs)
      }}
    >
      <PageHeader title="Bank Statements" subtitle="Reconcile bank activity against the ledger — drag files anywhere to upload" />

      {/* Full-page drop overlay */}
      {dragOver && !uploading && (
        <div className="fixed inset-0 z-[85] bg-overlay flex items-center justify-center pointer-events-none">
          <div className="card border-2 border-dashed border-brand-500 px-12 py-10 text-center shadow-modal">
            <Upload size={26} className="mx-auto mb-2 text-brand-ink" />
            <p className="text-sm font-bold text-ink">Drop to upload to {acctLabel(account)}</p>
            <p className="text-xs text-ink-muted mt-1">CSV or PDF, up to 30 MB each</p>
          </div>
        </div>
      )}

      <GlobalTxnSearch navigate={navigate} />

      <div className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-1"><Landmark size={15} className="text-brand-ink" /><h2 className="text-sm font-bold text-ink">Import statements</h2></div>
        <p className="text-xs text-ink-muted mb-4">CSV imports instantly. PDFs are parsed by rules when the layout proves itself against the statement's own balances — otherwise by AI in the background. You can select or drop several files at once.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[220px]" value={account} onChange={e => setAccount(e.target.value)}>
            {accounts.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
            <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload CSV / PDF'}
          </button>
          {statements.some(s => s.status === 'ready') && (
            <button onClick={checkExtras} disabled={extrasBusy}
              title="Re-parse every stored statement and compare it with what the app holds. A statement whose balances reconcile proves its own contents, so anything beyond that is wrong."
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-full border disabled:opacity-50 ${
                !extras ? 'border-rule text-ink-muted hover:text-ink bg-card'
                  : extras.total_extra > 0 || extras.total_misfiled > 0 ? 'border-danger/40 text-danger bg-danger/10'
                    : 'border-success/40 text-success bg-success/10'}`}>
              {extrasBusy ? <Loader size={11} className="animate-spin" /> : <Search size={11} />}
              {extrasBusy ? 'Checking…' : !extras ? 'Check for extras'
                : extras.total_extra > 0 ? `${extras.total_extra} extra to review`
                  : extras.total_misfiled > 0 ? `${extras.total_misfiled} misfiled` : 'No extras'}
            </button>
          )}
          {extras && extras.unverifiable > 0 && (
            <span className="text-[11px] text-ink-faint" title="Only statements whose balances reconcile can be checked.">
              {extras.checked} checked · {extras.unverifiable} couldn't be
            </span>
          )}
          <input ref={fileRef} type="file" multiple accept=".csv,.pdf,application/pdf,text/csv" hidden onChange={e => handleUpload(e.target.files)} />
        </div>
        {uploading && batch && (
          <p className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted mt-3">
            <Loader size={13} className="animate-spin" />
            {batch.phase === 'parsing'
              ? `Parsing PDFs — ${batch.done}/${batch.total} done… (AI parses take minutes; you can leave, they finish server-side)`
              : batch.total > 1 ? `Uploading ${Math.min(batch.done + 1, batch.total)}/${batch.total}…` : 'Uploading…'}
          </p>
        )}
        {failures.length > 0 && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-lg px-3 py-2 text-xs mt-3">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0">{failures.map((f, i) => <p key={i} className="truncate" title={f}>{f}</p>)}</div>
            <button onClick={() => setFailures([])} className="ml-auto hover:opacity-70"><X size={14} /></button>
          </div>
        )}
      </div>

      {loading ? <div className="card p-2"><Skeleton.Table rows={5} cols={5} /></div> : statements.length === 0 ? (
        <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No statements yet. Drop one anywhere on this page, or click Upload.</p></div>
      ) : (
        <div className="card overflow-hidden mb-4">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-divider">
            <CheckCircle2 size={14} className={months.length && recCount === months.length ? 'text-success' : 'text-ink-faint'} />
            <span className="text-sm font-bold text-ink">Statements by month</span>
            <span className="text-xs text-ink-muted tabular-nums">{recCount}/{months.length || monthKeys.length} reconciled</span>
          </div>

          {/* Uploads still parsing (or failed) — no period yet */}
          {processing.map(st => (
            <div key={st.id} className="flex items-center gap-3 px-4 py-2 border-b border-divider text-[13px]">
              {st.status === 'error'
                ? <AlertCircle size={13} className="text-danger shrink-0" />
                : <Loader size={13} className="animate-spin text-warning shrink-0" />}
              <span className="font-medium text-ink truncate">{st.filename}</span>
              {st.status === 'error'
                ? <span className="text-xs text-danger truncate" title={st.error}>parse failed — {st.error}</span>
                : <span className="text-xs text-ink-muted">parsing…</span>}
              <button onClick={() => deleteStatement(st)} className="ml-auto text-ink-faint hover:text-danger p-1"><Trash2 size={13} /></button>
            </div>
          ))}

          {monthKeys.map(mk => {
            const m = monthOf[mk]
            const sts = (stByMonth.get(mk) || []).sort((a, b) => a.account.localeCompare(b.account) || a.id - b.id)
            const [y, mo] = mk.split('-')
            const label = `${MONTH_FULL[Number(mo) - 1]} ${y}`
            const missing = m?.missing_accounts || []
            const ready = m && m.open_debits === 0 && missing.length === 0
            const expanded = monthExpanded.has(mk)
            const acctSeen = {}
            return (
              <div key={mk} className="border-b border-divider last:border-0">
                <div role="button" tabIndex={0}
                  onClick={() => setMonthExpanded(prev => { const n = new Set(prev); n.has(mk) ? n.delete(mk) : n.add(mk); return n })}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMonthExpanded(prev => { const n = new Set(prev); n.has(mk) ? n.delete(mk) : n.add(mk); return n }) } }}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left cursor-pointer hover:bg-brand-500/10">
                  {expanded ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
                  <span className="text-[13.5px] font-semibold text-ink w-32 shrink-0">{label}</span>
                  {missing.length > 0 && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5"
                      title={`No ${missing.map(acctLabel).join(' or ')} statement covers this month`}>
                      {missing.map(acctLabel).join(' + ')} missing
                    </span>
                  )}
                  {sts.some(s => s.overlaps_with) && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-warning bg-warning/10 border border-warning/30 rounded px-1.5 py-0.5"
                      title="A statement's date range overlaps another — duplicates were skipped on upload, but double-check coverage.">
                      overlaps
                    </span>
                  )}
                  <span className="flex-1" />
                  {m && (
                    <>
                      <span className="w-28 h-1 rounded-full bg-elev overflow-hidden shrink-0 hidden sm:block">
                        <span className={`block h-full rounded-full ${m.coverage >= 95 ? 'bg-success' : m.coverage >= 60 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${m.coverage}%` }} />
                      </span>
                      <span className="text-[12px] font-semibold text-ink w-10 text-right tabular-nums shrink-0">{m.coverage}%</span>
                      <span className={`text-[12px] w-16 text-right tabular-nums shrink-0 ${m.open_debits > 0 ? 'text-ink-muted' : 'text-success'}`}>
                        {m.open_debits > 0 ? `${m.open_debits} open` : 'clear'}
                      </span>
                    </>
                  )}
                  <span className="w-44 text-right shrink-0 hidden md:block">
                    {m?.reconciled_at ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success" title={`Reconciled by ${m.reconciled_by} on ${formatDate(m.reconciled_at)}`}>
                          <CheckCircle2 size={12} /> Reconciled
                        </span>
                        <button onClick={e => { e.stopPropagation(); reconcileMonth(mk, true) }} title="Un-reconcile this month" className="text-ink-faint hover:text-danger p-0.5"><X size={11} /></button>
                      </span>
                    ) : ready ? (
                      <button onClick={e => { e.stopPropagation(); reconcileMonth(mk, false) }}
                        className="text-[11px] font-bold px-2 py-1 rounded border text-success border-success/40 hover:bg-success/10">
                        Mark reconciled
                      </button>
                    ) : null}
                  </span>
                </div>

                {expanded && sts.map(st => {
                  acctSeen[st.account] = (acctSeen[st.account] || 0) + 1
                  const copyN = acctSeen[st.account]
                  const dupCount = sts.filter(s => s.account === st.account).length
                  const pct = st.debits > 0 ? Math.round(((st.matched || 0) / st.debits) * 100) : 0
                  const e = extrasFor(st.id)
                  return (
                    <Fragment key={st.id}>
                      <div
                        className={`flex items-center gap-3 pl-11 pr-4 py-1.5 border-t border-divider group text-[13px] ${st.status === 'ready' ? 'cursor-pointer hover:bg-brand-500/10' : 'opacity-70'}`}
                        onClick={() => { if (st.status === 'ready') navigate(`/bank-statements/${st.id}`) }}>
                        <span className="w-2 h-2 rounded-full shrink-0 bg-elev border border-rule" />
                        <span className="text-[12.5px] font-medium text-ink w-36 shrink-0 truncate" title={st.filename}>
                          {acctLabel(st.account)}{dupCount > 1 ? ` · copy ${copyN}` : ''}
                        </span>
                        {st.status === 'parsing' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning"><Loader size={12} className="animate-spin" /> parsing…</span>
                        ) : st.status === 'error' ? (
                          <span className="text-xs font-semibold text-danger truncate" title={st.error}>parse failed — {st.error}</span>
                        ) : (
                          <>
                            <span className="text-[12px] text-ink-muted w-44 shrink-0 hidden sm:inline tabular-nums">{formatDate(st.period_start)} – {formatDate(st.period_end)}</span>
                            <span className="w-24 h-1 rounded-full bg-elev overflow-hidden shrink-0">
                              <span className={`block h-full rounded-full ${pct >= 85 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${pct}%` }} />
                            </span>
                            <span className="text-[12px] text-ink-muted w-20 text-right tabular-nums shrink-0">{st.matched}/{st.debits}</span>
                            {st.open_credits > 0 && <span className="text-[11px] text-violet-600 tabular-nums shrink-0" title="Unanswered credits (Money in)">{st.open_credits} in</span>}
                            {st.open_value > 0 && <span className="text-[11px] text-ink-faint tabular-nums shrink-0 hidden lg:inline" title="Open debit value (USD-equivalent)">{money(st.open_value)} open</span>}
                            {e && !e.reconciles && <span className="text-[11px] text-ink-faint shrink-0" title={e.reason}>not checked</span>}
                            {e?.reconciles && e.misfiled_count > 0 && (
                              <button onClick={ev => { ev.stopPropagation(); openMisfiled(st.id) }}
                                title={`${e.misfiled_count} row(s) repeat another payment's reference while a payment the statement charges is missing. The month still reconciles — the money is right and the vendor is wrong.`}
                                className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30 shrink-0 hover:bg-warning/20">
                                {e.misfiled_count} misfiled · {money(e.misfiled_value)}
                              </button>
                            )}
                            {e?.reconciles && !e.extraCount && !e.misfiled_count && (
                              <span className="text-[11px] font-semibold text-success shrink-0" title={`All ${e.expected} transactions match the statement's balances.`}>✓ matches</span>
                            )}
                            {e?.reconciles && e.extraCount > 0 && e.missingCount > 0 && (
                              <button onClick={ev => { ev.stopPropagation(); setExtrasOpen(extrasOpen === st.id ? null : st.id); setMisfiledOpen(null) }}
                                title={`The statement proves ${e.expected} transactions and the app holds ${e.held}, but ${e.missingCount} don't line up — recorded under different details, commonly the wrong currency. Not duplicates; re-parsing corrects them.`}
                                className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/30 shrink-0 hover:bg-warning/20">
                                {e.missingCount} mismatched
                              </button>
                            )}
                            {e?.reconciles && e.extraCount > 0 && e.missingCount === 0 && (
                              <button onClick={ev => { ev.stopPropagation(); setExtrasOpen(extrasOpen === st.id ? null : st.id); setMisfiledOpen(null) }}
                                title={`The statement's balances prove ${e.expected} transactions; the app holds ${e.held}.`}
                                className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-danger/10 text-danger border border-danger/30 shrink-0 hover:bg-danger/20">
                                {e.extraCount} extra · {money(e.extraValue)}
                              </button>
                            )}
                          </>
                        )}
                        <span className="ml-auto flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          {st.r2_key && (
                            <button onClick={ev => { ev.stopPropagation(); viewStmtFile(st.id, toast) }} title="View the original statement file"
                              className="text-ink-faint hover:text-ink p-1"><FileText size={14} /></button>
                          )}
                          {st.r2_key && st.status !== 'parsing' && (
                            <button onClick={ev => { ev.stopPropagation(); reparseStatement(st) }} disabled={reparsing === st.id}
                              title="Re-parse the original file and add any transactions the first pass missed. Never deletes or duplicates."
                              className="text-ink-faint hover:text-brand-ink p-1 disabled:opacity-40">
                              {reparsing === st.id ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            </button>
                          )}
                          <button onClick={ev => { ev.stopPropagation(); deleteStatement(st) }} className="text-ink-faint hover:text-danger p-1"><Trash2 size={14} /></button>
                        </span>
                      </div>

                      {/* Misfiled detail — recorded-as vs actually */}
                      {misfiledOpen === st.id && (() => {
                        const d = misfiled[st.id]
                        if (misfiledBusy === st.id) return <div className="pl-11 pr-4 py-2 border-t border-divider text-[12px] text-ink-muted">Re-reading the statement…</div>
                        if (!d?.repairs?.length) return null
                        return (
                          <div className="pl-11 pr-4 py-2 border-t border-divider bg-warning/5" onClick={ev => ev.stopPropagation()}>
                            <p className="text-[12px] text-ink mb-1.5">
                              These rows repeat another payment's reference. The statement charges each reference once, and for every repeat a payment it does charge is missing — the month still balances while the money sits under the wrong name.
                            </p>
                            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-warning/30 bg-card">
                              <table className="w-full text-[12px]">
                                <thead className="text-ink-faint"><tr className="border-b border-divider">
                                  <th className="text-left font-semibold px-2 py-1">Date</th>
                                  <th className="text-right font-semibold px-2 py-1">Amount</th>
                                  <th className="text-left font-semibold px-2 py-1">Recorded as</th>
                                  <th className="text-left font-semibold px-2 py-1">Actually</th>
                                  <th className="text-left font-semibold px-2 py-1">Match</th>
                                </tr></thead>
                                <tbody className="tabular-nums">
                                  {d.repairs.map(r => (
                                    <tr key={r.txn_id} className="border-b border-divider last:border-0">
                                      <td className="px-2 py-1 text-ink-muted">{formatDate(r.txn_date)}</td>
                                      <td className="px-2 py-1 text-right text-ink">{money(r.amount)}</td>
                                      <td className="px-2 py-1 text-ink-muted truncate max-w-[14rem]" title={r.currently_reads}>{r.currently_payee || r.currently_reads}</td>
                                      <td className="px-2 py-1 truncate max-w-[14rem] font-semibold text-ink" title={r.should_read}>
                                        {r.should_payee || r.should_read}
                                        {!r.payee_changes && <span className="ml-1 font-normal text-ink-faint">(same vendor — reference only)</span>}
                                      </td>
                                      <td className="px-2 py-1 text-[11px] text-ink-faint">
                                        {r.matched_expense_id ? (r.payee_changes ? `entry ${r.matched_expense_id} — will be released` : `entry ${r.matched_expense_id} — kept`) : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              <button onClick={() => repairMisfiled(st)} disabled={misfiledFixing === st.id}
                                className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-lg bg-warning text-white hover:opacity-85 disabled:opacity-50">
                                {misfiledFixing === st.id ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                                Repair {d.repairs.length} row{d.repairs.length === 1 ? '' : 's'}
                              </button>
                              {st.r2_key && <button onClick={() => viewStmtFile(st.id, toast)} className="text-[12px] text-ink-muted hover:text-ink underline">Open the statement to check</button>}
                              {d.unclear?.length > 0 && <span className="text-[11px] text-ink-faint">{d.unclear.length} more look wrong but which payment they should be is a guess — left alone.</span>}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Extras detail — statement count vs app count per group */}
                      {extrasOpen === st.id && (() => {
                        if (!e?.groups?.length) return null
                        const ledger = [...new Set(e.groups.flatMap(g => g.matched_expense_ids))]
                        return (
                          <div className="pl-11 pr-4 py-2 border-t border-divider bg-danger/5" onClick={ev => ev.stopPropagation()}>
                            <p className="text-[12px] text-ink mb-1.5">
                              This statement's opening and closing balances prove <b>{e.expected}</b> transactions. The app holds <b>{e.held}</b>.
                              {e.missingCount > 0
                                ? <> But it is also missing {e.missingCount} — these are the same transactions recorded under different details (commonly the wrong currency), not duplicates. Re-parse to correct them.</>
                                : <> The {e.extraCount} extra row{e.extraCount === 1 ? ' is' : 's are'} not supported by the statement.</>}
                            </p>
                            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-danger/30 bg-card">
                              <table className="w-full text-[12px]">
                                <thead className="text-ink-faint"><tr className="border-b border-divider">
                                  <th className="text-left font-semibold px-2 py-1">Date</th>
                                  <th className="text-right font-semibold px-2 py-1">Amount</th>
                                  <th className="text-left font-semibold px-2 py-1">Description</th>
                                  <th className="text-right font-semibold px-2 py-1" title="How many the statement charges">Statement</th>
                                  <th className="text-right font-semibold px-2 py-1" title="How many the app holds">App</th>
                                  <th className="text-right font-semibold px-2 py-1">Extra</th>
                                </tr></thead>
                                <tbody className="tabular-nums">
                                  {e.groups.map((g, i) => (
                                    <tr key={i} className="border-b border-divider last:border-0">
                                      <td className="px-2 py-1 text-ink-muted">{formatDate(g.txn_date)}</td>
                                      <td className="px-2 py-1 text-right text-ink">{money(g.amount)}</td>
                                      <td className="px-2 py-1 text-ink-muted truncate max-w-[22rem]" title={g.description}>{g.payee_guess || g.description}</td>
                                      <td className="px-2 py-1 text-right text-ink-muted">{g.expected}</td>
                                      <td className="px-2 py-1 text-right text-ink-muted">{g.held}</td>
                                      <td className="px-2 py-1 text-right font-bold text-danger">{g.extra}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              {e.missingCount === 0 && (
                                <button onClick={() => removeExtras(st)} disabled={extrasRemoving === st.id}
                                  className="inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-lg bg-danger text-white hover:opacity-85 disabled:opacity-50">
                                  {extrasRemoving === st.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  Remove {e.extraCount} extra · {money(e.extraValue)}
                                </button>
                              )}
                              {st.r2_key && <button onClick={() => viewStmtFile(st.id, toast)} className="text-[12px] text-ink-muted hover:text-ink underline">Open the statement to check</button>}
                              {ledger.length > 0 && <span className="text-[11px] text-ink-faint">{ledger.length} ledger entr{ledger.length === 1 ? 'y' : 'ies'} will lose a bank match — nothing in the ledger is deleted.</span>}
                            </div>
                          </div>
                        )
                      })()}
                    </Fragment>
                  )
                })}
                {expanded && m && !m.reconciled_at && !ready && (
                  <div className="pl-11 pr-4 pb-2 text-[11px] text-ink-faint">
                    Reconcile unlocks when {[m.open_debits > 0 ? `${m.open_debits} open debit${m.open_debits === 1 ? '' : 's'} are resolved` : '', missing.length ? `the ${missing.map(acctLabel).join(' + ')} statement is uploaded` : ''].filter(Boolean).join(' and ')}.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <RemindersCard toast={toast} />
      <StatementFlagsCard toast={toast} />
    </div>
  )
}

// ── Reminders — monthly nudges delivered through the notification bell ──────
function RemindersCard({ toast }) {
  const [open, setOpen] = useState(false)
  const [reminders, setReminders] = useState([])
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(5)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    api.get('/bank-statements/reminders').then(r => setReminders(r.data.data || [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [load])
  const add = async (t, d) => {
    const name = String(t || '').trim()
    if (!name || busy) return
    setBusy(true)
    try { await api.post('/bank-statements/reminders', { title: name, cadence: 'monthly', day_of_month: d }); setTitle(''); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }
  const due = (r) => r.next_due && String(r.next_due).slice(0, 10) <= new Date().toISOString().slice(0, 10)
  return (
    <div className="card overflow-hidden mt-4 mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left">
        <Clock size={14} className="text-ink-faint" />
        <span className="text-sm font-bold text-ink-muted">Reminders{reminders.length > 0 ? ` — ${reminders.length}` : ''}</span>
        <span className="text-xs text-ink-faint">delivered to your notification bell when due</span>
        {open ? <ChevronDown size={14} className="ml-auto text-ink-faint" /> : <ChevronRight size={14} className="ml-auto text-ink-faint" />}
      </button>
      {open && reminders.map(r => (
        <div key={r.id} className={`flex items-center gap-3 px-4 py-2 border-t border-divider text-[13px] ${r.active ? '' : 'opacity-50'}`}>
          <span className="font-semibold text-ink min-w-0 flex-1 truncate">{r.title}</span>
          <span className="text-[11px] text-ink-faint whitespace-nowrap">
            {r.cadence === 'monthly' ? `monthly · day ${r.day_of_month}` : r.cadence} · next {formatDate(r.next_due)}
          </span>
          {r.active && due(r) && (
            <button onClick={async () => { try { await api.post(`/bank-statements/reminders/${r.id}/done`); load() } catch { toast('Failed', 'error') } }}
              className="text-[11px] font-bold px-2 py-1 rounded border text-brand-ink border-brand-500/40 hover:bg-brand-500/10">Done</button>
          )}
          <button onClick={async () => { try { await api.put(`/bank-statements/reminders/${r.id}`, { active: !r.active }); load() } catch { toast('Failed', 'error') } }}
            className={`text-[11px] font-bold px-2 py-1 rounded border ${r.active ? 'text-success border-success/40 bg-success/10' : 'text-ink-faint border-rule'}`}>
            {r.active ? 'On' : 'Off'}
          </button>
          <button onClick={async () => { if (!window.confirm(`Delete reminder "${r.title}"?`)) return; try { await api.delete(`/bank-statements/reminders/${r.id}`); load() } catch { toast('Failed', 'error') } }}
            className="text-ink-faint hover:text-danger p-1"><Trash2 size={13} /></button>
        </div>
      ))}
      {open && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-divider">
          {reminders.length === 0 && (
            <button onClick={() => add('Upload bank statements & re-run matching', 5)} disabled={busy}
              className="btn-secondary !py-1.5 text-xs"><Plus size={13} /> Monthly statement reminder (day 5)</button>
          )}
          <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add(title, day)}
            placeholder="Custom reminder…" className="input flex-1 min-w-[180px] !py-1.5 text-[13px]" />
          <label className="flex items-center gap-1 text-[12px] text-ink-muted">
            monthly on day
            <input type="number" min="1" max="31" value={day}
              onChange={e => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
              className="input w-16 !py-1.5 text-[13px]" />
          </label>
          <button onClick={() => add(title, day)} disabled={busy || !title.trim()} className="btn-primary !py-1.5 text-xs"><Plus size={13} /> Add</button>
        </div>
      )}
    </div>
  )
}

// Global search across every transaction on every statement. Clicking a hit
// opens its statement with the mini-ledger pre-filtered to the query.
function GlobalTxnSearch({ navigate }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return }
    const t = setTimeout(() => {
      api.get('/bank-statements/search', { params: { q } }).then(r => setResults(r.data.data || [])).catch(() => setResults([]))
    }, 300)
    return () => clearTimeout(t)
  }, [q])
  const go = (t) => {
    const chip = t.direction === 'credit' ? (t.matched_income_id ? 'booked-income' : 'open-credit') : (t.dismissed ? 'dismissed' : 'all')
    navigate(`/bank-statements/${t.statement_id}?q=${encodeURIComponent(q)}&chip=${chip}`)
  }
  return (
    <div className="relative mb-4 max-w-xl">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search every transaction on every statement…" className="input !pl-9" />
      {results && (
        <div className="absolute z-40 mt-1 w-full card shadow-modal max-h-80 overflow-y-auto p-1">
          {results.length === 0 && <p className="text-xs text-gray-400 p-3">No transactions match.</p>}
          {results.map(t => (
            <button key={t.id} onClick={() => go(t)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{formatDate(t.txn_date)}</span>
              <span className="flex-1 min-w-0 truncate text-ink">{t.exp_payee || t.payee_guess || t.description || '—'}
                <span className="block text-[11px] text-gray-400 truncate">{t.filename} · {t.account}</span>
              </span>
              <span className={`tabular-nums whitespace-nowrap ${t.direction === 'credit' ? 'text-violet-600' : 'text-gray-600'}`}>
                {t.direction === 'credit' ? '+' : ''}{money(t.amount, t.currency)}
              </span>
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
// Human labels for the matcher's decline reasons (import_summary.reasons).
const REASON_LABEL = {
  'no-candidate': 'no invoice candidates',
  'already-claimed-or-rejected': 'candidates already claimed / rejected',
  'nameless-descriptor': 'nameless descriptor',
  ambiguous: 'ambiguous between invoices',
  'amount-no-match': 'no amount match',
  'refused-weak-evidence': 'refused on weak evidence',
}

function StatementDetail({ id }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [sp] = useSearchParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(sp.get('chip') || 'all')
  const [q, setQ] = useState(sp.get('q') || '')
  const [sel, setSel] = useState(new Set())
  const [matchTxn, setMatchTxn] = useState(null)
  const [entryTxn, setEntryTxn] = useState(null)
  const [deckOpen, setDeckOpen] = useState(false)
  const [rematching, setRematching] = useState(false)

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
  // Named consequence, not a bare delete — removing a rule changes what every
  // future upload does.
  const delRule = async (kind, ruleId, label) => {
    if (!window.confirm(`Remove ${label}?\n\nFuture statements stop applying it. Nothing already recorded changes.`)) return
    try { await api.delete(`/bank-statements/rules/${kind}/${ruleId}`); load() } catch { toast('Failed', 'error') }
  }
  const rematch = async () => {
    if (rematching) return
    setRematching(true)
    try {
      const { data: r } = await api.post(`/bank-statements/rematch-all?statement_id=${id}`)
      toast(`${r.data.matched} of ${r.data.scanned} open debits matched`)
      load()
    } catch (err) { toast(err.response?.data?.error || 'Rematch failed', 'error') }
    finally { setRematching(false) }
  }

  const txns = data?.transactions || []
  const counts = useMemo(() => {
    const c = { all: 0, open: 0, toconfirm: 0, matched: 0, booked: 0, dismissed: 0, 'open-credit': 0, 'booked-income': 0 }
    txns.forEach(t => { if (t.direction === 'debit' && !t.dismissed) c.all++; c[t.disposition] = (c[t.disposition] || 0) + 1 })
    return c
  }, [txns])
  const openItems = useMemo(() => txns.filter(t => t.disposition === 'open' || t.disposition === 'open-credit'), [txns])
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
  const reasons = s.import_summary?.reasons || null
  const reasonLine = reasons && Object.keys(reasons).length
    ? Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${REASON_LABEL[k] || k}`).join(' · ')
    : null

  return (
    <div>
      <button onClick={() => navigate('/bank-statements')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-ink mb-3"><ArrowLeft size={15} /> All statements</button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><Landmark size={20} /> {s.account}</h1>
          <p className="text-sm text-gray-400">
            {s.period_start ? `${formatDate(s.period_start)} – ${formatDate(s.period_end)} · ` : ''}{s.txn_count} transactions
            {s.import_summary ? ` · ${s.import_summary.auto_matched || 0} auto-matched · ${s.import_summary.dup_skipped || 0} duplicates skipped` : ''}
            {s.import_summary?.parse_method === 'rules' ? ' · rule-parsed, balance-verified' : s.import_summary?.parse_method === 'ai' ? ' · AI-parsed' : ''}
          </p>
          {reasonLine && (
            <p className="text-[11px] text-ink-faint mt-0.5" title="Why the matcher declined the rest at import — the matcher's own verdicts, not a guess.">
              Unmatched: {reasonLine}
            </p>
          )}
          <p className="text-[11px] text-gray-400 mt-0.5">
            {s.ending_balance != null
              ? <>Ending balance {money(s.ending_balance)}{s.beginning_balance != null ? ` · beginning ${money(s.beginning_balance)}` : ''} · </>
              : <>No balance captured · </>}
            <button
              className="underline hover:text-ink"
              onClick={async () => {
                const v = window.prompt('Ending balance printed on this statement (leave blank to try re-reading the file):', s.ending_balance ?? '')
                if (v === null) return
                try {
                  if (v.trim() === '') {
                    const r = await api.post(`/bank-statements/${id}/reparse-balance`)
                    toast(`Balance read: ${money(r.data.data.ending_balance)}`)
                  } else {
                    const b = window.prompt('Beginning balance (optional):', s.beginning_balance ?? '')
                    await api.patch(`/bank-statements/${id}/balance`, { ending_balance: Number(v), beginning_balance: b && b.trim() !== '' ? Number(b) : null })
                    toast('Balance saved')
                  }
                  load()
                } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
              }}
            >{s.ending_balance != null ? 'Edit balance' : 'Set balance'}</button>
          </p>
        </div>
        <div className="flex items-center gap-1">
          {s.r2_key && (
            <button onClick={() => viewStmtFile(id, toast)} title="View the original statement file" className="text-gray-400 hover:text-ink p-2"><FileText size={16} /></button>
          )}
          <button onClick={rematch} disabled={rematching} title="Run the matcher again over this statement's open debits — additive, nothing already matched changes"
            className="text-gray-400 hover:text-brand-600 p-2 disabled:opacity-40">
            {rematching ? <Loader size={16} className="animate-spin" /> : <Zap size={16} />}
          </button>
          <button onClick={async () => { if (window.confirm('Delete this statement?\n\nMatched invoices stay on the ledger. Entries BOOKED from this statement are archived with it (restorable) so a re-upload cannot double-count them.')) { try { await api.delete(`/bank-statements/${id}`); navigate('/bank-statements') } catch { toast('Failed', 'error') } } }} className="text-gray-300 hover:text-danger p-2"><Trash2 size={16} /></button>
        </div>
      </div>

      {/* Coverage + category strip */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Coverage</p>
          <p className="text-2xl font-bold text-ink mt-1">{covPct}%</p>
          <p className="text-[11px] text-gray-400">≈{money(cov.matched)} of ≈{money(cov.live)} live debits matched (USD-equivalent)</p>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${covPct}%` }} /></div>
        </div>
        <div className="card p-4 lg:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Where the money went <span className="normal-case font-normal">(≈USD)</span></p>
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
        {openItems.length > 0 && (
          <button onClick={() => setDeckOpen(true)} className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5">
            <Sparkles size={13} /> Review deck ({openItems.length})
          </button>
        )}
      </div>

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-30 card shadow-modal px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 bg-brand-500/10 border-brand-200">
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
                  {t.reversed_by && <p className="text-[10px] font-semibold text-warning" title="A credit of the same amount reverses this a few days later — likely a FAILED payment, not vendor spend. Dismiss the pair rather than matching an invoice.">↩ reversed by a later credit</p>}
                </td>
                <td className="px-3 py-3">
                  {t.disposition === 'open'
                    ? <InlineCategory suggested={t.suggested_category} onPick={(cat) => act(t.id, 'book', { category: cat })} onEntry={() => setEntryTxn(t)} />
                    : <span className={t.exp_category ? 'text-gray-600' : 'text-amber-600'}>{t.exp_category || (t.dismissed ? '—' : 'Unorganized')}</span>}
                </td>
                <td className="px-3 py-3 text-ink font-medium whitespace-nowrap tabular-nums">
                  {money(t.amount, t.currency)}
                  {t.currency && t.currency !== 'USD' && t.usd != null && <span className="block text-[10px] text-gray-400 font-normal">≈ {money(t.usd)}</span>}
                  {t.match_score != null && t.match_method?.startsWith('auto') && <span className="block text-[10px] text-gray-400 font-normal">{Math.round(t.match_score * 100)}% {t.match_method.replace('auto-', '')}</span>}
                </td>
                <td className="px-3 py-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_CHIP[t.disposition]}`}>{STATUS_LABEL[t.disposition]}{t.dismissed && t.dismissed_reason ? ` · ${t.dismissed_reason}` : ''}</span></td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5 justify-end whitespace-nowrap text-gray-400">
                    {t.disposition === 'open' && <>
                      <button onClick={() => setMatchTxn(t)} title="Match to a ledger entry" className="hover:text-brand-600 p-1"><Link2 size={15} /></button>
                      <button onClick={() => act(t.id, 'dismiss', {})} title="Dismiss" className="hover:text-danger p-1"><Ban size={15} /></button>
                      <button onClick={() => act(t.id, 'dismiss', { rule: true })} title="Always dismiss like this (also sweeps existing open rows)" className="hover:text-danger p-1 text-[10px] font-bold">∀</button>
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
          <p className="text-xs text-gray-400 mb-3">Method-compatible entries marked Paid in (or within 3 days of) this period that no debit here matches. Candidates are this statement's open debits that could explain them.</p>
          <div className="divide-y divide-divider">
            {data.paidNoEvidence.map(e => (
              <div key={e.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <div><Link to={`/ledger?focus=${e.id}`} className="font-medium text-ink hover:text-brand-600">{e.payee}</Link><span className="text-[11px] text-gray-400 ml-2">{e.category || '—'} · paid {formatDate(e.payment_date)}{e.payment_method ? ` · ${e.payment_method}` : ''}</span></div>
                  <span className="text-gray-600 tabular-nums">{money(e.amount, e.currency)}</span>
                </div>
                {e.bank_candidates?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {e.bank_candidates.map(c => (
                      <button key={c.txn_id}
                        onClick={() => act(c.txn_id, 'match', { expense_id: e.id })}
                        title={c.description}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-rule text-ink-muted hover:border-brand-400 hover:text-brand-ink">
                        <Link2 size={10} className="inline mr-1" />{formatDate(c.txn_date)} · {money(c.amount)} · {c.payee_guess || 'no payee'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Money in — credits book to income, mirroring Categorize on debits. */}
      {credits.length > 0 && (
        <details className="card p-5 mt-4" open={credits.some(t => t.disposition === 'open-credit')}>
          <summary className="text-sm font-bold text-ink cursor-pointer">
            Money in ({credits.length}){counts['open-credit'] > 0 && <span className="ml-2 text-[11px] font-semibold text-violet-600">{counts['open-credit']} unanswered</span>}
          </summary>
          <div className="divide-y divide-divider mt-2">
            {credits.map(t => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <div className="flex-1 min-w-[180px]">
                  <span className={t.dismissed ? 'text-gray-400 line-through' : 'text-gray-600'}>{t.payee_guess || t.description || '—'}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{formatDate(t.txn_date)}{t.payee_email ? ` · ${t.payee_email}` : ''}</span>
                  {t.reversal_of && <span className="block text-[10px] font-semibold text-warning" title="This credit reverses an earlier debit of the same amount — internal, not income.">↩ reverses an earlier debit</span>}
                  {t.disposition === 'booked-income' && <span className="block text-[11px] text-emerald-600">Income · {t.income_type}</span>}
                </div>
                {t.disposition === 'open-credit' && (
                  <select
                    className="input !py-1 !px-1.5 text-xs max-w-[180px]" value=""
                    onChange={e => e.target.value && act(t.id, 'book-income', { income_type: e.target.value })}
                  >
                    <option value="">{t.suggested_income_type ? `Book as ${t.suggested_income_type}?` : 'Book as income…'}</option>
                    {t.suggested_income_type && <option value={t.suggested_income_type}>★ {t.suggested_income_type} (suggested)</option>}
                    {INCOME_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
                  </select>
                )}
                {t.disposition === 'open-credit' && <button onClick={() => act(t.id, 'dismiss', {})} title="Not income — internal movement" className="text-gray-400 hover:text-danger p-1"><Ban size={14} /></button>}
                {t.disposition === 'booked-income' && <button onClick={() => act(t.id, 'unbook-income', {})} title="Unbook income" className="text-gray-400 hover:text-danger p-1"><Undo2 size={14} /></button>}
                {t.dismissed && <button onClick={() => act(t.id, 'restore', {})} title="Restore" className="text-gray-400 hover:text-brand-600 p-1"><RotateCcw size={14} /></button>}
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
                <div key={r.id} className="flex items-center justify-between text-sm py-1"><span className="text-gray-600 truncate">"{r.pattern}" → <span className="font-medium text-ink">{r.category}</span></span><button onClick={() => delRule('category', r.id, `the rule booking "${r.pattern}" as ${r.category}`)} className="text-gray-300 hover:text-danger"><X size={14} /></button></div>
              )) : <p className="text-xs text-gray-400">None yet.</p>}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Always dismiss</p>
              {data.rules.dismiss.length ? data.rules.dismiss.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm py-1"><span className="text-gray-600 truncate">"{r.pattern}"</span><button onClick={() => delRule('dismiss', r.id, `the rule setting aside "${r.pattern}"`)} className="text-gray-300 hover:text-danger"><X size={14} /></button></div>
              )) : <p className="text-xs text-gray-400">None yet.</p>}
            </div>
          </div>
        </div>
      )}

      {matchTxn && <MatchModal txn={matchTxn} onClose={() => setMatchTxn(null)} onDone={() => { setMatchTxn(null); load() }} toast={toast} />}
      {entryTxn && <EntryModal txn={entryTxn} onClose={() => setEntryTxn(null)} onDone={() => { setEntryTxn(null); load() }} toast={toast} />}
      {deckOpen && <StatementReviewDeck open items={openItems} onClose={() => setDeckOpen(false)} onChanged={load} toast={toast} />}
    </div>
  )
}

// Inline "Categorize…" select — picking a category BOOKS the debit
// immediately. A view-time suggestion leads the list; nothing books without
// the pick.
function InlineCategory({ onPick, onEntry, suggested }) {
  return (
    <select className="input !py-1 !px-1.5 text-xs max-w-[170px]" value="" onChange={e => { if (e.target.value === '__entry') onEntry(); else if (e.target.value) onPick(e.target.value) }}>
      <option value="">{suggested ? `Book as ${suggested}?` : 'Categorize…'}</option>
      {suggested && <option value={suggested}>★ {suggested} (suggested)</option>}
      <CategoryOptions />
      <option value="__entry">Custom entry…</option>
    </select>
  )
}
function CategoryQuickSelect({ onPick, label }) {
  return (
    <select className="input !py-1.5 text-xs max-w-[160px]" value="" onChange={e => e.target.value && onPick(e.target.value)}>
      <option value="">{label}</option>
      <CategoryOptions />
    </select>
  )
}

// Match dialog — top-3 suggestions + free ledger search. Exported: the Bank
// Matching page reuses it so the two surfaces cannot drift.
export function MatchModal({ txn, onClose, onDone, toast }) {
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
                <button key={x.expense_id} onClick={() => pick(x.expense_id)} className="flex items-center justify-between text-left px-3 py-2 rounded-lg border border-rule hover:border-brand-400 hover:bg-brand-500/10">
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
            <button key={r.id} onClick={() => pick(r.id)} className="flex items-center justify-between text-left px-3 py-2 rounded-lg border border-rule hover:border-brand-400 hover:bg-brand-500/10">
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
    try {
      const { data: r } = await api.post(`/bank-statements/txns/${txn.id}/book`, { payee: f.payee, category: f.category || null, artist: f.artist || null, rule: f.rule })
      // The booking always lands; the RULE can be refused (vendor really
      // invoices, or the pattern is too short). Say so — a silently skipped
      // rule looks identical to a written one.
      toast(r.rule_skipped ? `Booked — ${r.rule_skipped}` : 'Booked')
      onDone()
    }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-ink">Book as ledger entry</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <p className="text-xs text-gray-400 mb-4">{money(txn.amount, txn.currency)} · {formatDate(txn.txn_date)} — records an approved, Paid entry.</p>
        <div className="space-y-3">
          <div><label className="label">Payee</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><option value="">—</option><CategoryOptions /></select></div>
          <div><label className="label">Artist (optional)</label><input className="input" value={f.artist} onChange={set('artist')} /></div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={f.rule} onChange={set('rule')} /> Always book "{(txn.payee_guess || txn.description || '').slice(0, 40)}" as this category</label>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Booking…' : 'Book entry'}</button></div>
      </div>
    </div>
  )
}

// Bank Matching — the reconciliation work surface. The statements page holds
// the FILES; every open bank line gets answered here, in one of three honest
// ways: it's this invoice (match), there is no invoice for it (book), or it
// isn't really spending (dismiss).
//
// Two directions, one page: statement → ledger (the queue) and ledger →
// statement (paid rows the bank never shows). The direction toggle is
// persisted, because which way somebody works is a habit, not a per-visit
// choice, and the whole working view (statement / filter / search / lens)
// lives in the URL so a refresh, a back button or a shared link all land in
// the same place.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, Ban, Check, ChevronDown, ChevronRight, DollarSign,
  FileX, Flag, GitMerge, Landmark, Link2, Loader, MoreHorizontal, RotateCcw,
  Scissors, Search, Sparkles, Undo2, Users, X,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import CategoryOptions from '../components/CategoryOptions'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { MatchModal, STATUS_CHIP, STATUS_LABEL } from './BankStatements'
import StatementReviewDeck from '../components/statements/StatementReviewDeck'
import StatementFlagsCard from '../components/statements/StatementFlagsCard'
import { money } from '../utils/money'
import { INCOME_TYPES } from '../constants'

const fmt = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const pct = (n) => `${Number(n || 0).toFixed(1)}%`

// The lead chips are the day's work; the rest are lookups. Splitting them
// means the four numbers that matter are not competing with five that don't.
const LEAD_CHIPS = [['open', 'Open'], ['likely', 'Likely'], ['needs-invoice', 'Needs invoice'], ['toconfirm', 'To confirm']]
const MORE_CHIPS = [
  ['all', 'All'], ['suggested', 'Suggested'], ['flagged', 'Flagged'], ['reversals', 'Reversals'],
  ['matched', 'Matched'], ['booked', 'Booked'], ['open-credit', 'Money in'], ['dismissed', 'Dismissed'],
]
const ALL_CHIPS = [...LEAD_CHIPS, ...MORE_CHIPS]

const SORTS = {
  date: (a, b) => String(b.txn_date).localeCompare(String(a.txn_date)) || b.id - a.id,
  amount: (a, b) => Number(b.usd || 0) - Number(a.usd || 0),
  payee: (a, b) => String(a.exp_payee || a.payee_guess || '').localeCompare(String(b.exp_payee || b.payee_guess || '')),
  // Confidence first, biggest unanswered money as the tie-break: two rows the
  // matcher is equally sure about are not equally worth a person's attention.
  confidence: (a, b) => (b.suggestions?.[0]?.score || 0) - (a.suggestions?.[0]?.score || 0) || Number(b.usd || 0) - Number(a.usd || 0),
}

function Panel({ title, sub, count, defaultOpen = false, right, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card mt-4">
      <div className="flex items-center gap-2 pr-4">
        <button className="flex-1 flex items-center gap-2 px-5 py-3 text-left" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={15} className="text-ink-faint" /> : <ChevronRight size={15} className="text-ink-faint" />}
          <span className="text-sm font-bold text-ink">{title}</span>
          {count != null && <span className="text-[11px] font-semibold bg-elev text-ink-muted rounded-full px-2 py-0.5">{count}</span>}
          {sub && <span className="text-xs text-ink-muted ml-2 truncate">{sub}</span>}
        </button>
        {open && right}
      </div>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

/** A tiny reusable "arm the confirm, then run it" holder. */
function useConfirmer() {
  const [ask, setAsk] = useState(null) // { title, message, confirmLabel, variant, run }
  const [busy, setBusy] = useState(false)
  const dialog = (
    <ConfirmDialog
      open={!!ask} busy={busy}
      title={ask?.title || 'Are you sure?'}
      message={ask?.message || ''}
      confirmLabel={ask?.confirmLabel || 'Confirm'}
      variant={ask?.variant || 'danger'}
      onClose={() => (busy ? null : setAsk(null))}
      onConfirm={async () => {
        setBusy(true)
        try { await ask.run() } finally { setBusy(false); setAsk(null) }
      }}
    />
  )
  return [setAsk, dialog]
}

export default function BankMatching() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()

  // ── URL is the source of truth for the working view ────────────────────
  const stmt = params.get('statement') || 'all'
  const chip = params.get('filter') || 'open'
  const q = params.get('q') || ''
  const lens = params.get('by') === 'artist' ? 'artist' : 'category'
  const view = params.get('view') || localStorage.getItem('bank_matching_direction') || 'queue'
  const setParam = useCallback((k, v) => {
    setParams((p) => {
      if (!v || v === '' ) p.delete(k); else p.set(k, v)
      return p
    }, { replace: true })
  }, [setParams])
  const setView = (v) => { localStorage.setItem('bank_matching_direction', v); setParam('view', v === 'queue' ? '' : v) }

  const [queue, setQueue] = useState(null)
  const [completion, setCompletion] = useState(null)
  const [months, setMonths] = useState([])
  const [accounts, setAccounts] = useState([])
  const [artists, setArtists] = useState([])
  const [sort, setSort] = useState('date')
  const [showMore, setShowMore] = useState(false)
  const [sel, setSel] = useState(new Set())
  const [matchTxn, setMatchTxn] = useState(null)
  const [attachTxn, setAttachTxn] = useState(null)
  const [splitTxn, setSplitTxn] = useState(null)
  const [vendorTxn, setVendorTxn] = useState(null)
  const [openCand, setOpenCand] = useState(null)   // ONE candidate panel at a time
  const [deckOpen, setDeckOpen] = useState(false)
  const [deckItems, setDeckItems] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [flagsKey, setFlagsKey] = useState(0)
  const [panelKey, setPanelKey] = useState(0)
  const [cap, setCap] = useState(120)
  const [rowDraft, setRowDraft] = useState({})      // per-row category/artist before booking
  const [confirm, confirmDialog] = useConfirmer()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qr, cr, mr] = await Promise.all([
        api.get('/bank-matching/queue', { params: { statement: stmt } }),
        api.get('/bank-matching/completion', { params: stmt !== 'all' ? { statement_id: stmt } : {} }),
        api.get('/bank-statements/months'),
      ])
      setQueue(qr.data.data); setCompletion(cr.data.data); setMonths(mr.data.data || [])
      setAccounts(qr.data.data?.accounts || [])
    } catch (err) { toast(err.response?.data?.error || 'Failed to load', 'error') }
    finally { setLoading(false) }
  }, [stmt, toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.get('/bank-matching/artist-names').then((r) => setArtists(r.data.data || [])).catch(() => setArtists([])) }, [])
  useEffect(() => { setCap(120); setOpenCand(null) }, [chip, q, stmt, sort])

  const refresh = () => { load(); setFlagsKey((k) => k + 1); setPanelKey((k) => k + 1); setSel(new Set()); setOpenCand(null) }
  const acctLabel = (key) => accounts.find((a) => a.key === key)?.label || key

  const rows = queue?.rows || []
  const needSet = useMemo(() => new Set(completion?.needs_invoice_txn_ids || []), [completion])

  const counts = useMemo(() => {
    const c = {}
    for (const k of ALL_CHIPS.map(([k2]) => k2)) c[k] = 0
    for (const t of rows) {
      if (t.direction === 'debit' && !t.dismissed) c.all += 1
      if (c[t.disposition] != null) c[t.disposition] += 1
      if (t.likely) c.likely += 1
      if (t.flagged) c.flagged += 1
      if (t.reversed_by || t.reversal_of) c.reversals += 1
      if (t.disposition === 'open' && t.suggestions?.length) c.suggested += 1
      // Open = unanswered, and a booked row still waiting for its document IS
      // unanswered. Counting only fully-open rows lets the number read zero
      // while a pile of work sits one chip away.
      if (t.disposition === 'open' || needSet.has(t.id)) c.open += 1
    }
    return c
  }, [rows, needSet])

  const shown = useMemo(() => {
    let list = rows
    if (chip === 'all') list = list.filter((t) => t.direction === 'debit' && !t.dismissed)
    else if (chip === 'likely') list = list.filter((t) => t.likely)
    else if (chip === 'flagged') list = list.filter((t) => t.flagged)
    else if (chip === 'reversals') list = list.filter((t) => t.reversed_by || t.reversal_of)
    else if (chip === 'suggested') list = list.filter((t) => t.disposition === 'open' && t.suggestions?.length)
    else if (chip === 'needs-invoice') list = list.filter((t) => needSet.has(t.id))
    else if (chip === 'open') list = list.filter((t) => t.disposition === 'open' || needSet.has(t.id))
    else list = list.filter((t) => t.disposition === chip)
    if (q.trim()) {
      const s = q.toLowerCase()
      list = list.filter((t) => [t.payee_guess, t.description, t.exp_payee, t.exp_category, t.exp_artist, t.reference, t.vendor_override]
        .some((v) => String(v || '').toLowerCase().includes(s)))
    }
    // The default sort follows the filter: on the open pile, confidence with
    // an amount tie-break puts the biggest answerable money first.
    const key = sort === 'date' && (chip === 'open' || chip === 'likely' || chip === 'suggested') ? 'confidence' : sort
    return [...list].sort(SORTS[key] || SORTS.date)
  }, [rows, chip, q, needSet, sort])

  const visible = shown.slice(0, cap)
  const openItems = useMemo(() => {
    // Deck membership: debits that still need an answer, plus credits that
    // are NOT reversal-shaped (a reversal is money coming back, never income).
    // Booked rows still waiting for their document belong here too — they are
    // the rematch pile.
    const wanted = rows.filter((t) => {
      if (t.dismissed) return false
      if (t.direction === 'credit') return t.disposition === 'open-credit' && !t.reversal_of && !t.reversed_by
      if (t.disposition === 'open') return !t.no_invoice
      return needSet.has(t.id)
    })
    // Rows with a match candidate first — deciding between two invoices is a
    // sharper question than picking a category, and asking it while attention
    // is fresh gets better answers.
    return [...wanted].sort((a, b) => (b.suggestions?.[0]?.score || 0) - (a.suggestions?.[0]?.score || 0))
  }, [rows, needSet])

  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selAllVisible = () => setSel((x) => (x.size >= visible.length ? new Set() : new Set(visible.map((t) => t.id))))

  // ── Actions ──────────────────────────────────────────────────────────────
  const act = async (txnId, path, body) => {
    if (busy) return
    setBusy(true)
    try { await api.post(`/bank-statements/txns/${txnId}/${path}`, body || {}); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }
  // Match with the prepayment loop closed: a 400 that says "this could be a
  // prepayment" is a QUESTION, not a dead end.
  const doMatch = async (txn, expenseId, extra) => {
    const post = (body) => api.post(`/bank-statements/txns/${txn.id}/match`, { expense_id: expenseId, ...body })
    try { await post(extra); toast('Matched'); refresh() }
    catch (err) {
      const d = err.response?.data
      if (d?.prepayment_possible) {
        confirm({
          title: 'Record it as a prepayment?', variant: 'primary', confirmLabel: 'Record anyway',
          message: `${d.error}\n\nThe match will be recorded with the dates as they are.`,
          run: async () => {
            try { await post({ ...extra, allow_prepayment: true }); toast('Matched'); refresh() }
            catch (e2) { toast(e2.response?.data?.error || 'Failed', 'error') }
          },
        })
        return
      }
      toast(d?.error || 'Failed', 'error')
    }
  }

  // The select shows the suggested category before anybody touches it, so the
  // book action must read the same fallback — otherwise the button looks
  // enabled and armed while the draft is still empty.
  const categoryOf = (t) => (rowDraft[t.id]?.category || t.suggested_category || '')
  const bookRow = async (t) => {
    const category = categoryOf(t)
    if (!category) { toast('Pick a category first', 'error'); return }
    await act(t.id, 'book', { category, artist: rowDraft[t.id]?.artist || null })
  }
  const saveArtist = async (t, artist) => {
    try { await api.post(`/bank-matching/tx/${t.id}/artist`, { artist }); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setCurrency = async (t, currency) => {
    if (currency === (t.currency || 'USD')) return
    try { await api.post(`/bank-matching/tx/${t.id}/currency`, { currency }); toast(`Read as ${currency} now`); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const toggleFlag = async (t) => {
    try { await api.post(`/bank-matching/tx/${t.id}/flag`, { flagged: !t.flagged }); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const rowNoInvoice = (t) => {
    const isOpen = t.disposition === 'open'
    const category = categoryOf(t)
    const send = (body) => api.post(`/bank-matching/tx/${t.id}/no-invoice`, body)
    const run = async (body) => {
      try {
        const { data } = await send(body)
        toast(data.data?.booked ? 'Booked, and recorded that no invoice is coming' : 'Recorded — the row stops asking for a document')
        refresh()
      } catch (err) {
        const d = err.response?.data
        if (d?.paid_candidates) {
          confirm({
            title: 'That may already be in the ledger', variant: 'primary', confirmLabel: 'Book a new entry anyway',
            message: d.error,
            run: () => run({ ...body, confirm_new: true }),
          })
          return
        }
        toast(d?.error || 'Failed', 'error')
      }
    }
    if (isOpen && !category) { toast('Pick a category first — booking it without one files the money nowhere', 'error'); return }
    confirm({
      title: 'No invoice is coming for this line?', variant: 'primary', confirmLabel: isOpen ? 'Book it and stop asking' : 'Stop asking',
      message: isOpen
        ? `The line is booked as "${category}" and stops counting as unfinished. Nothing already in the ledger changes.`
        : 'The money stays counted; the row stops asking for a document. Nothing already in the ledger changes.',
      run: () => run(isOpen ? { category, artist: rowDraft[t.id]?.artist || null } : {}),
    })
  }

  const acceptLikely = () => {
    const likely = rows.filter((t) => t.likely)
    if (!likely.length) return
    confirm({
      title: `Accept ${likely.length} likely match${likely.length === 1 ? '' : 'es'}?`, variant: 'primary', confirmLabel: 'Accept them',
      message: (
        <div className="text-sm text-ink-muted">
          <p className="mb-2">Each of these is the matcher's top candidate at 90% or better:</p>
          <ul className="space-y-0.5 max-h-52 overflow-y-auto">
            {likely.slice(0, 20).map((t) => (
              <li key={t.id} className="tabular-nums">
                {formatDate(t.txn_date)} · {t.payee_guess} <span className="text-ink-faint">→</span> {t.suggestions[0].payee} · {fmt(t.suggestions[0].amount, t.suggestions[0].currency)}
              </li>
            ))}
            {likely.length > 20 && <li className="text-ink-faint">…and {likely.length - 20} more</li>}
          </ul>
        </div>
      ),
      run: async () => {
        try {
          const { data: r } = await api.post('/bank-statements/txns/bulk', { ids: likely.map((t) => t.id), action: 'accept-suggestions' })
          toast(`${r.data.affected} matched`); refresh()
        } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
      },
    })
  }

  // ── Bulk ─────────────────────────────────────────────────────────────────
  const ids = [...sel]
  const bulk = (action, body, verb, message) => confirm({
    title: `${verb} ${ids.length} row${ids.length === 1 ? '' : 's'}?`, message, variant: 'danger', confirmLabel: verb,
    run: async () => {
      try {
        const { data: r } = await api.post('/bank-statements/txns/bulk', { ids, action, ...body })
        toast(`${r.data.affected} of ${ids.length} ${verb.toLowerCase()}ed`)
        refresh()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const bulkNoInvoice = () => confirm({
    title: `Record "no invoice coming" on ${ids.length} row${ids.length === 1 ? '' : 's'}?`, variant: 'primary', confirmLabel: 'Record it',
    message: 'Booked rows only. Rows still open need booking first, and rows matched to a real invoice cannot carry this answer — those are skipped and counted.',
    run: async () => {
      try {
        const { data: r } = await api.post('/bank-matching/no-invoice/bulk', { txn_ids: ids })
        toast(`${r.data.done} of ${ids.length} marked${r.data.skipped ? ` — ${r.data.skipped} skipped (${r.data.skipped_reason})` : ''}`)
        refresh()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const bulkUnmatch = () => confirm({
    title: `Unmatch ${ids.length} row${ids.length === 1 ? '' : 's'}?`, confirmLabel: 'Unmatch',
    message: 'Each unmatch is recorded as a "no", so the matcher never proposes that exact pairing again. Booked rows are skipped — they unbook, not unmatch.',
    run: async () => {
      try {
        const { data: r } = await api.post('/bank-matching/unmatch/bulk', { txn_ids: ids })
        toast(`${r.data.done.length} unmatched`
          + (r.data.skipped.length ? ` · ${r.data.skipped.length} skipped` : '')
          + (r.data.restored?.length ? ` · ${r.data.restored.length} booking${r.data.restored.length === 1 ? '' : 's'} restored` : ''))
        refresh()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const bulkUnbook = () => confirm({
    title: `Unbook ${ids.length} row${ids.length === 1 ? '' : 's'}?`, confirmLabel: 'Unbook',
    message: 'The entries these lines invented are archived and the lines go back to unanswered. Real invoices are untouched.',
    run: async () => {
      let done = 0
      for (const id of ids) { try { await api.post(`/bank-statements/txns/${id}/unbook`, {}); done += 1 } catch { /* reported below */ } }
      toast(`${done} of ${ids.length} unbooked`); refresh()
    },
  })
  const bulkRestore = async () => {
    let done = 0
    for (const id of ids) { try { await api.post(`/bank-statements/txns/${id}/restore`, {}); done += 1 } catch { /* counted */ } }
    toast(`${done} restored`); refresh()
  }

  // ── Matcher re-runs ──────────────────────────────────────────────────────
  const matchAgain = () => confirm({
    title: 'Run the matcher again?', variant: 'primary', confirmLabel: 'Match again',
    message: `Additive only — existing matches, bookings and dismissals are left exactly as they are; the matcher just looks again at what is still open${stmt !== 'all' ? ' on this statement' : ' on every statement'}.`,
    run: async () => {
      try {
        const { data } = await api.post(`/bank-statements/rematch-all${stmt !== 'all' ? `?statement_id=${stmt}` : ''}`)
        const d = data.data || {}
        toast(`${d.matched ?? 0} newly matched of ${d.scanned ?? 0} scanned`)
        refresh()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const resetMatching = () => confirm({
    title: 'Clear every automatic match and start over?', confirmLabel: 'Reset matching',
    message: 'Automatic AND manual matches are cleared, then the matcher re-derives what it can. Bookings, income and dismissals are left alone — but any match a person made by hand that the matcher cannot re-derive is reported and will need making again.',
    run: async () => {
      try {
        const { data } = await api.post('/bank-statements/reset-matching')
        const d = data.data || {}
        toast(`${d.rematched ?? 0} re-derived`
          + (d.manual_not_recovered ? ` · ${d.manual_not_recovered} hand-made match${d.manual_not_recovered === 1 ? '' : 'es'} not recovered` : ''),
        d.manual_not_recovered ? 'error' : 'success')
        refresh()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })

  const reconcileMonth = async (mk, undo) => {
    try { await api.post(`/bank-statements/months/${mk}/reconcile`, { undo }); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  if (loading && !queue) return <div><div className="card p-2"><Skeleton.Table rows={10} cols={6} /></div></div>

  const statements = queue?.statements || []

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><GitMerge size={20} /> Bank Matching</h1>
          {completion ? (
            <p className="text-sm text-ink-muted">
              <span className="font-semibold text-ink">{completion.left_all} left to answer · {money(completion.left_all_value)}</span>
              {' — '}match it, book it, or dismiss it.
            </p>
          ) : <p className="text-sm text-ink-muted">Every open bank line has three honest answers.</p>}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-rule overflow-hidden text-xs">
            {[['queue', 'Bank → ledger'], ['ledger', 'Ledger → bank']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                className={`px-2.5 py-1.5 font-medium ${view === k ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:bg-brand-500/10'}`}>{l}</button>
            ))}
          </div>
          <select className="input !py-1.5 !w-auto text-sm" value={stmt} onChange={(e) => setParam('statement', e.target.value === 'all' ? '' : e.target.value)}>
            <option value="all">All statements{completion ? ` — ${completion.left_all} left` : ''}</option>
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {s.period_start ? `${String(s.period_start).slice(0, 7)} · ` : ''}{acctLabel(s.account)}
                {completion?.by_statement?.[s.id] ? ` — ${completion.by_statement[s.id].left} left` : ''}
              </option>
            ))}
          </select>
          {openItems.length > 0 && (
            <button onClick={() => { setDeckItems(openItems); setDeckOpen(true) }} className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5">
              <Sparkles size={13} /> Review deck ({openItems.length})
            </button>
          )}
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="btn-secondary !py-1.5 !px-2" title="More"><MoreHorizontal size={15} /></button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-50 w-60 card p-1 shadow-modal text-sm">
                  {[
                    ['Batch view — clear by vendor', () => setView('batch')],
                    ['Match again (additive)', matchAgain],
                    ['Reset matching…', resetMatching],
                    ['Re-review answered rows', () => { setDeckItems(shown); setDeckOpen(true) }],
                  ].map(([label, fn]) => (
                    <button key={label} onClick={() => { setMenuOpen(false); fn() }}
                      className="w-full text-left px-3 py-1.5 rounded hover:bg-brand-500/10 text-ink">{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Months strip — the soft close ───────────────────────────────── */}
      {months.length > 0 && <MonthStrip months={months} acctLabel={acctLabel} onReconcile={reconcileMonth} />}

      {/* ── Completion ─────────────────────────────────────────────────── */}
      {completion && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-1">
            <StatCard label="Explained" value={pct(completion.explained_pct)} note="every bank line accounted for at all" />
            <StatCard label="Invoice-backed" value={pct(completion.invoice_backed_pct)} note="has a document behind it — a different claim" />
            <StatCard label="Matched" value={money(completion.matched.value)} tone="text-success" note={`${completion.matched.n} lines`} />
            <StatCard label="Creator payments" value={money(completion.creator.value)} tone="text-info" note={`${completion.creator.n} lines · explained, never invoice-backed`} />
            <StatCard label="Booked, invoice due" value={money(completion.needs_invoice.value)} tone="text-warning" note={`${completion.needs_invoice.n} lines want a document`} />
            <StatCard label="Open" value={money(completion.open.value)} tone="text-danger" note={`${completion.open.n} unanswered`} />
          </div>
          <p className="text-[11px] text-ink-faint mb-4">
            {completion.scoped_to_statement
              ? `Narrowed to this statement — ${money(completion.total)} of ${money(completion.workspace_total)} across the workspace.`
              : `Across every ready statement — ${money(completion.total)}.`}
          </p>
        </>
      )}

      {view === 'ledger' ? (
        <UnmatchedLedgerPanel key={panelKey} toast={toast} onChanged={refresh} inline />
      ) : view === 'batch' ? (
        <BatchView toast={toast} onChanged={refresh} onExit={() => setView('queue')} artists={artists} />
      ) : (
        <>
          {/* ── Chips + search ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {[...LEAD_CHIPS, ...(showMore ? MORE_CHIPS : [])].map(([k, l]) => (
              <button key={k} onClick={() => setParam('filter', k)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full ${chip === k ? 'bg-brand-600 text-white' : 'bg-elev text-ink-muted hover:bg-brand-500/10'}`}>
                {l} <span className="opacity-70">{counts[k] || 0}</span>
              </button>
            ))}
            <button onClick={() => setShowMore((v) => !v)} className="text-xs font-medium text-ink-muted hover:text-ink px-1">
              {showMore ? 'less' : 'more…'}
            </button>
            {counts.likely > 0 && (
              <button onClick={acceptLikely} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1"><Sparkles size={12} /> Accept {counts.likely} likely</button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {q && <button onClick={() => setParam('q', '')} className="text-[11px] text-ink-muted underline">clear</button>}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input value={q} onChange={(e) => setParam('q', e.target.value)} placeholder="Search…" className="input !pl-8 !py-1.5 text-sm w-48" />
              </div>
            </div>
          </div>

          {sel.size > 0 && (
            <div className="sticky top-2 z-20 card shadow-modal px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 bg-brand-500/10 border-brand-300">
              <span className="text-sm font-medium text-ink">{sel.size} selected</span>
              <BulkBookButton onBook={(category) => bulk('book', { category }, 'Book',
                `Each open debit becomes an approved, Paid ledger entry categorised "${category}". Rows that are already answered are skipped.`)} />
              <button onClick={() => bulk('mark-paid', {}, 'Mark paid', 'The matched invoice families are stamped Paid with the bank date and reference.')} className="btn-secondary !py-1.5 text-xs">Mark paid</button>
              <button onClick={bulkNoInvoice} className="btn-secondary !py-1.5 text-xs" title="Booked rows only — the money stays counted; the row stops asking for a document">No invoice coming</button>
              <button onClick={bulkUnmatch} className="btn-secondary !py-1.5 text-xs">Unmatch</button>
              <button onClick={bulkUnbook} className="btn-secondary !py-1.5 text-xs">Unbook</button>
              <button onClick={() => bulk('dismiss', {}, 'Dismiss', 'Matched and booked rows are refused by the server — only unanswered lines can be set aside.')} className="btn-secondary !py-1.5 text-xs">Dismiss</button>
              <button onClick={bulkRestore} className="btn-secondary !py-1.5 text-xs">Restore</button>
              <button onClick={() => setVendorTxn({ bulk: true, ids })} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1"><Users size={12} /> Vendor…</button>
              <button onClick={() => setSel(new Set())} className="text-ink-muted hover:text-ink ml-1"><X size={16} /></button>
            </div>
          )}

          {/* ── The queue ──────────────────────────────────────────────── */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" checked={visible.length > 0 && sel.size >= visible.length} onChange={selAllVisible} aria-label="Select all shown" />
                  </th>
                  <SortTh label="Date" k="date" sort={sort} setSort={setSort} />
                  <th className="px-3 py-2.5 whitespace-nowrap">Account</th>
                  <SortTh label="Payee" k="payee" sort={sort} setSort={setSort} />
                  <th className="px-3 py-2.5 whitespace-nowrap">
                    <button onClick={() => setParam('by', lens === 'artist' ? '' : 'artist')} className="uppercase tracking-wider hover:text-ink"
                      title="Category is the work to do; artist is the work done. Toggle which one the column shows.">
                      {lens === 'artist' ? 'Artist ⇄' : 'Answer ⇄'}
                    </button>
                  </th>
                  <SortTh label="Amount" k="amount" sort={sort} setSort={setSort} align="right" />
                  <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {visible.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-ink-muted">
                    {q.trim()
                      ? <>Nothing matches "{q}". <button className="underline text-brand-ink" onClick={() => setParam('q', '')}>Clear the search</button>.</>
                      : lens === 'artist' && chip === 'open'
                        ? 'Open lines have no artist yet — that is what booking them decides. Switch the column back to Answer, or work the queue.'
                        : `Nothing in "${(ALL_CHIPS.find(([k]) => k === chip) || [, chip])[1]}". Try another filter.`}
                  </td></tr>
                )}
                {visible.map((t) => (
                  <QueueRow
                    key={t.id} t={t} lens={lens} artists={artists} selected={sel.has(t.id)}
                    needsInvoice={needSet.has(t.id)} acctLabel={acctLabel}
                    draft={rowDraft[t.id] || {}}
                    setDraft={(patch) => setRowDraft((d) => ({ ...d, [t.id]: { ...(d[t.id] || {}), ...patch } }))}
                    open={openCand === t.id}
                    onOpenCand={() => setOpenCand(openCand === t.id ? null : t.id)}
                    onToggle={() => toggle(t.id)}
                    onValueClick={(v) => setParam('q', v)}
                    onMatch={(expenseId) => doMatch(t, expenseId)}
                    onSearch={() => setMatchTxn(t)}
                    onAttach={() => setAttachTxn(t)}
                    onSplit={() => setSplitTxn(t)}
                    onVendor={() => setVendorTxn({ txn: t })}
                    onBook={() => bookRow(t)}
                    onArtist={(a) => saveArtist(t, a)}
                    onFlag={() => toggleFlag(t)}
                    onCurrency={(c) => setCurrency(t, c)}
                    onNoInvoice={() => rowNoInvoice(t)}
                    onAct={(path, body, ask) => (ask ? confirm({ ...ask, run: () => act(t.id, path, body) }) : act(t.id, path, body))}
                    onIncome={(income_type) => act(t.id, 'book-income', { income_type })}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-ink-muted">
            <span>Showing {visible.length} of {shown.length} line{shown.length === 1 ? '' : 's'}{shown.length !== rows.length ? ` (${rows.length} in this statement selection)` : ''}.</span>
            {shown.length > visible.length && (
              <button onClick={() => setCap((c) => c + 200)} className="underline text-brand-ink font-semibold">
                Show 200 more — {shown.length - visible.length} still need an answer
              </button>
            )}
            {queue?.suggestions_capped && <span>Suggestion scoring capped at 200 open rows this load — narrow to one statement for full coverage.</span>}
          </div>
        </>
      )}

      {view !== 'ledger' && <UnmatchedLedgerPanel key={`p${panelKey}`} toast={toast} onChanged={refresh} />}
      <RematchPanel key={`r${panelKey}`} toast={toast} onChanged={refresh} confirm={confirm} statement={stmt} />
      <FundingPairsPanel key={`f${panelKey}`} toast={toast} onChanged={refresh} confirm={confirm} />
      <DuplicatePairsPanel key={`d${panelKey}`} toast={toast} onChanged={refresh} confirm={confirm} />
      <AutoDecisionsPanel key={`a${panelKey}`} toast={toast} onChanged={refresh} />
      <RulesPanel toast={toast} completion={completion} onChanged={refresh}
        onWorkThese={(pattern) => { setParam('filter', 'needs-invoice'); setParam('q', pattern); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
      <StatementFlagsCard key={flagsKey} toast={toast} onChanged={load} />

      {matchTxn && <MatchModal txn={matchTxn} onClose={() => setMatchTxn(null)} onDone={() => { setMatchTxn(null); refresh() }} toast={toast} />}
      {attachTxn && <AttachModal txn={attachTxn} onClose={() => setAttachTxn(null)} onDone={() => { setAttachTxn(null); refresh() }} toast={toast} confirm={confirm} />}
      {splitTxn && <SplitModal txn={splitTxn} artists={artists} onClose={() => setSplitTxn(null)} onDone={() => { setSplitTxn(null); refresh() }} toast={toast} />}
      {vendorTxn && <VendorModal target={vendorTxn} onClose={() => setVendorTxn(null)} onDone={() => { setVendorTxn(null); refresh() }} toast={toast} />}
      {deckOpen && <StatementReviewDeck open items={deckItems || openItems} onClose={() => setDeckOpen(false)} onChanged={refresh} toast={toast} artists={artists} />}
      {confirmDialog}
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────
function StatCard({ label, value, note, tone = 'text-ink' }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] font-semibold uppercase text-ink-muted">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] text-ink-muted">{note}</p>
    </div>
  )
}

function SortTh({ label, k, sort, setSort, align }) {
  return (
    <th className={`px-3 py-2.5 whitespace-nowrap ${align === 'right' ? 'text-right' : ''}`}>
      <button onClick={() => setSort(k)} className={`uppercase tracking-wider hover:text-ink ${sort === k ? 'text-ink' : ''}`}>
        {label}{sort === k ? ' ↓' : ''}
      </button>
    </th>
  )
}

function BulkBookButton({ onBook }) {
  const [cat, setCat] = useState('')
  return (
    <span className="inline-flex items-center gap-1">
      <select className="input !py-1 !px-1.5 text-xs !w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
        <option value="">Book as…</option>
        <CategoryOptions />
      </select>
      <button className="btn-secondary !py-1.5 text-xs" disabled={!cat} onClick={() => onBook(cat)}>Book</button>
    </span>
  )
}

// The months strip. Mark-reconciled needs BOTH conditions — zero open debits
// AND no configured account missing a statement for the month. A month can
// read 100% coverage while an entire account was simply never uploaded, and
// closing it then means "we reconciled the half we have".
function MonthStrip({ months, acctLabel, onReconcile }) {
  const [all, setAll] = useState(false)
  const list = all ? months : months.slice(0, 14)
  return (
    <div className="mb-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {list.map((m) => {
          const missing = m.missing_accounts || []
          const ready = m.open_debits === 0 && missing.length === 0
          return (
            <div key={m.month_key}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs ${m.reconciled_at ? (m.open_debits > 0 ? 'border-warning/40 bg-warning/10' : 'border-success/40 bg-success/10') : 'border-rule bg-card'}`}>
              <span className="font-bold text-ink">{m.month_key}</span>
              <span className="text-ink-muted ml-1.5">{m.coverage}% · {m.open_debits} open</span>
              {missing.length > 0 && (
                <span className="ml-1.5 text-warning font-semibold" title={`No ${missing.map(acctLabel).join(' or ')} statement covers this month`}>
                  · {missing.map(acctLabel).join(' + ')} missing
                </span>
              )}
              {m.reconciled_at ? (
                <button className="ml-2 text-ink-muted underline" title={`Reconciled by ${m.reconciled_by}. Undo?`} onClick={() => onReconcile(m.month_key, true)}>reopen</button>
              ) : ready ? (
                <button className="ml-2 text-success underline" onClick={() => onReconcile(m.month_key, false)}>reconcile</button>
              ) : (
                <span className="ml-2 text-ink-faint" title={
                  missing.length
                    ? `Upload the ${missing.map(acctLabel).join(' and ')} statement for this month first — a month cannot be closed on half its accounts.`
                    : `Answer the ${m.open_debits} open debit${m.open_debits === 1 ? '' : 's'} first.`
                }>
                  {missing.length ? 'statement missing' : `${m.open_debits} to answer`}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {months.length > 14 && (
        <button className="text-[11px] text-ink-muted underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Show recent 14 months' : `Show all ${months.length} months`}
        </button>
      )}
    </div>
  )
}

// ── One queue row ───────────────────────────────────────────────────────────
function QueueRow({
  t, lens, artists, selected, needsInvoice, acctLabel, draft, setDraft, open, onOpenCand, onToggle,
  onValueClick, onMatch, onSearch, onAttach, onSplit, onVendor, onBook, onArtist, onFlag, onNoInvoice, onAct, onIncome, onCurrency,
}) {
  const [armed, setArmed] = useState(null)
  const isOpen = t.disposition === 'open'
  const cands = t.suggestions || []
  const top = cands[0]
  // Two candidates within a hair of each other is the shape of a wrong match:
  // the amount agrees with both and only the name breaks the tie.
  const nearIdentical = cands.length > 1 && Math.abs(cands[0].score - cands[1].score) < 0.05
  const bankDiffers = t.exp_payee && t.payee_guess && t.exp_payee.toLowerCase() !== t.payee_guess.toLowerCase()

  return (
    <>
      <tr className={`align-top ${selected ? 'bg-selected' : 'hover:bg-brand-500/10'}`}>
        <td className="px-3 py-2.5"><input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${t.payee_guess || t.id}`} /></td>
        <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{formatDate(t.txn_date)}</td>
        <td className="px-3 py-2.5 text-ink-faint text-xs whitespace-nowrap">
          {acctLabel(t.account)}
          {t.filename && <span className="block truncate max-w-[110px]" title={t.filename}>{t.filename}</span>}
        </td>
        <td className="px-3 py-2.5 min-w-[200px]">
          <p className="font-medium text-ink truncate max-w-[280px] flex items-center gap-1">
            {t.flagged && <Flag size={11} className="text-warning shrink-0" />}
            {t.exp_payee || t.vendor_override || t.payee_guess || t.description || '—'}
          </p>
          {t.vendor_override && <p className="text-[11px] text-info">vendor set by hand: {t.vendor_override}</p>}
          {!t.vendor_override && t.vendor_hint && !t.exp_payee && (
            <p className="text-[11px] text-ink-muted">{t.vendor_hint.source === 'history' ? 'past matches say' : t.vendor_hint.source}: {t.vendor_hint.name}</p>
          )}
          {bankDiffers && <p className="text-[11px] text-ink-faint truncate max-w-[280px]">bank: {t.payee_guess}</p>}
          {t.payee_email && <p className="text-[11px] font-mono text-ink-faint">{t.payee_email}</p>}
          {t.description && t.description !== t.payee_guess && (
            <p className="text-[11px] text-ink-faint truncate max-w-[280px]" title={t.description}>{t.description}</p>
          )}
          {t.dismissed && t.dismissed_reason && <p className="text-[11px] text-ink-faint">set aside: {t.dismissed_reason}</p>}
        </td>

        {/* The lens column: category = the work to do, artist = the work done. */}
        <td className="px-3 py-2.5 min-w-[200px]">
          {lens === 'artist' ? (
            t.exp_source === 'bank_statement' && t.matched_expense_id ? (
              <select className="input !py-1 !px-1.5 text-xs max-w-[170px]" value={t.exp_artist || ''} onChange={(e) => onArtist(e.target.value)}>
                <option value="">— no artist —</option>
                {artists.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : isOpen ? (
              <select className="input !py-1 !px-1.5 text-xs max-w-[170px]" value={draft.artist || ''} onChange={(e) => setDraft({ artist: e.target.value })}>
                <option value="">artist (before booking)…</option>
                {artists.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : t.exp_artist ? (
              <button className="text-xs text-ink hover:underline" onClick={() => onValueClick(t.exp_artist)}>{t.exp_artist}</button>
            ) : <span className="text-xs text-ink-faint">—</span>
          ) : isOpen ? (
            <div className="flex items-center gap-1">
              <select className="input !py-1 !px-1.5 text-xs max-w-[140px]" value={draft.category || t.suggested_category || ''} onChange={(e) => setDraft({ category: e.target.value })}>
                <option value="">book as…</option>
                <CategoryOptions />
              </select>
              <button onClick={onBook} disabled={!(draft.category || t.suggested_category)}
                className="text-[11px] font-bold text-brand-ink hover:underline disabled:opacity-40">Book</button>
            </div>
          ) : t.disposition === 'open-credit' ? (
            <select className="input !py-1 !px-1.5 text-xs max-w-[170px]" value=""
              onChange={(e) => e.target.value && onIncome(e.target.value)}>
              <option value="">{t.suggested_income_type ? `Book as ${t.suggested_income_type}?` : 'Book as income…'}</option>
              {t.suggested_income_type && <option value={t.suggested_income_type}>★ {t.suggested_income_type}</option>}
              {INCOME_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          ) : (
            <span className="text-xs text-ink-muted block max-w-[190px]">
              {t.exp_category
                ? <button className="hover:underline" onClick={() => onValueClick(t.exp_category)}>{t.exp_category}</button>
                : (t.income_type || '—')}
              {t.no_invoice && <span className="text-ink-faint"> · no invoice expected</span>}
              {needsInvoice && <span className="text-warning"> · wants a document</span>}
            </span>
          )}

          {/* The match offer. It ARMS a comparison; it never matches on the
              click — a single click that files money against the wrong
              invoice is silent and nothing downstream contradicts it. */}
          {isOpen && top && (
            <button onClick={onOpenCand}
              className={`mt-1 block text-left text-xs rounded-lg border px-2 py-1 w-full ${t.likely ? 'border-success/40 bg-success/10' : 'border-rule hover:border-brand-400'}`}>
              <span className="text-ink">{top.payee}</span>
              <span className="text-ink-muted"> · {fmt(top.amount, top.currency)} · {Math.round(top.score * 100)}%</span>
              <span className="text-ink-faint"> — compare {cands.length > 1 ? `${cands.length} candidates` : ''} →</span>
            </button>
          )}
          {isOpen && !top && t.group_proposal?.sets?.length > 0 && (
            <button onClick={onAttach} className="mt-1 block text-left text-xs rounded-lg border border-info/40 bg-info/10 px-2 py-1 w-full text-ink">
              {t.group_proposal.ambiguous
                ? `${t.group_proposal.sets.length} different invoice sets add up to this — choose one →`
                : `Settles ${t.group_proposal.sets[0].invoices.length} invoices from ${t.group_proposal.sets[0].invoices[0].payee} →`}
            </button>
          )}
        </td>

        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap font-medium text-ink text-right">
          {t.direction === 'credit' ? <span className="text-info">+{fmt(t.amount, t.currency)}</span> : fmt(t.amount, t.currency)}
          {(t.currency || 'USD') !== 'USD' && <span className="block text-[11px] text-ink-faint">≈ {money(t.usd)}</span>}
          {/* Currency correction, only while the line is unanswered: the
              currency is what a match was measured against, so the server
              refuses it once one exists. */}
          {isOpen && (
            <select className="mt-1 input !py-0.5 !px-1 text-[11px] !w-auto" value={t.currency || 'USD'} onChange={(e) => onCurrency(e.target.value)}
              title="Mis-parsed currency? Correcting it here clears the stale USD conversion too.">
              {[t.currency || 'USD', 'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].filter((c, i, a) => a.indexOf(c) === i).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_CHIP[t.disposition] || 'bg-elev text-ink-muted'}`}>
            {STATUS_LABEL[t.disposition] || t.disposition}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 justify-end whitespace-nowrap text-ink-muted">
            <button onClick={onFlag} title={t.flagged ? 'Clear the review flag' : 'Flag for review'} className={`p-1 hover:text-warning ${t.flagged ? 'text-warning' : ''}`}><Flag size={14} /></button>
            {isOpen && <>
              <button onClick={onSearch} title="Match…" className="hover:text-brand-ink p-1"><Link2 size={15} /></button>
              <button onClick={onAttach} title="Settles several invoices…" className="hover:text-brand-ink p-1 text-[10px] font-bold">N:1</button>
              <button onClick={onSplit} title="Split into several booked slices…" className="hover:text-brand-ink p-1"><Scissors size={14} /></button>
              <button onClick={onVendor} title="This descriptor is which vendor?" className="hover:text-brand-ink p-1"><Users size={14} /></button>
              <button onClick={() => onAct('dismiss', {}, {
                title: 'Set this line aside?', confirmLabel: 'Dismiss',
                message: 'It stops counting as spending and leaves the queue. Nothing in the ledger changes — you can restore it from the Dismissed filter.',
              })} title="Dismiss" className="hover:text-danger p-1"><Ban size={15} /></button>
            </>}
            {(needsInvoice || (t.disposition === 'booked' && !t.no_invoice)) && (
              <button onClick={onNoInvoice} title="No invoice is coming for this line" className="hover:text-ink p-1"><FileX size={14} /></button>
            )}
            {t.disposition === 'toconfirm' && (
              <button onClick={() => onAct('mark-paid', {}, {
                title: 'Mark the invoice paid?', variant: 'primary', confirmLabel: 'Mark paid',
                message: 'The whole invoice family is stamped Paid with this bank date and reference.',
              })} title="Mark paid" className="hover:text-success p-1"><DollarSign size={15} /></button>
            )}
            {(t.disposition === 'toconfirm' || t.disposition === 'matched') && (
              <button onClick={() => onAct('unmatch', {}, {
                title: 'Unmatch this line?', confirmLabel: 'Unmatch',
                message: 'The link is removed and recorded as a "no", so the matcher never proposes this exact pairing again. The ledger entry is untouched.',
              })} title="Unmatch (records the no)" className="hover:text-danger p-1"><Undo2 size={15} /></button>
            )}
            {t.disposition === 'booked' && (
              <button onClick={() => onAct('unbook', {}, {
                title: 'Unbook this line?', confirmLabel: 'Unbook',
                message: 'The entry this line invented is archived and the line goes back to unanswered.',
              })} title="Unbook" className="hover:text-danger p-1"><Undo2 size={15} /></button>
            )}
            {t.disposition === 'booked-income' && (
              <button onClick={() => onAct('unbook-income', {}, {
                title: 'Unbook this income?', confirmLabel: 'Unbook income',
                message: 'The income row this credit created is deleted and the credit goes back to unanswered.',
              })} title="Unbook income" className="hover:text-danger p-1"><Undo2 size={15} /></button>
            )}
            {t.disposition === 'dismissed' && <button onClick={() => onAct('restore', {})} title="Restore" className="hover:text-brand-ink p-1"><RotateCcw size={15} /></button>}
            {t.matched_expense_id && <Link to={`/ledger?focus=${t.matched_expense_id}`} title="Open in ledger" className="hover:text-brand-ink p-1 text-[10px] font-bold">L</Link>}
            <Link to={`/bank-statements/${t.statement_id}`} title="Open the statement" className="hover:text-brand-ink p-1"><Landmark size={13} /></Link>
          </div>
        </td>
      </tr>

      {/* The comparison. One row at a time, arm-then-confirm. */}
      {open && isOpen && (
        <tr className="bg-elev"><td colSpan={8} className="px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
            Which invoice is this {fmt(t.amount, t.currency)} on {formatDate(t.txn_date)}?
          </p>
          {nearIdentical && (
            <p className="text-xs text-warning mb-2 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              These candidates score within a hair of each other. Marking the wrong one paid is silent — the invoice reads settled and nothing later disagrees.
            </p>
          )}
          <div className="space-y-1.5 max-w-3xl">
            {cands.map((c) => {
              const amtDiff = Math.abs(Number(c.amount) - Number(t.amount)) > 0.005
              return (
                <label key={c.expense_id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${armed === c.expense_id ? 'border-brand-400 bg-brand-500/10' : 'border-rule'}`}>
                  <input type="radio" name={`cand-${t.id}`} checked={armed === c.expense_id} onChange={() => setArmed(c.expense_id)} />
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-ink">{c.payee}{c.invoice_number ? ` · #${c.invoice_number}` : ''}</span>
                    <span className="block text-[11px] text-ink-muted">
                      {c.method} · {Math.round(c.score * 100)}%
                      {amtDiff && <span className="text-warning"> · amount differs by {fmt(Math.abs(Number(c.amount) - Number(t.amount)), t.currency)}</span>}
                    </span>
                  </span>
                  <span className="tabular-nums text-sm text-ink-muted">{fmt(c.amount, c.currency)}</span>
                  <Link to={`/ledger?focus=${c.expense_id}`} onClick={(e) => e.stopPropagation()} className="text-[10px] font-bold text-ink-muted hover:text-brand-ink">L</Link>
                </label>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button className="btn-primary !py-1.5 text-xs" disabled={!armed} onClick={() => { onMatch(armed); setArmed(null) }}>
              {armed ? `Match ${cands.find((c) => c.expense_id === armed)?.payee}` : 'Pick one to match'}
            </button>
            <button className="btn-secondary !py-1.5 text-xs" onClick={onSearch}>None of these — search the ledger</button>
            <button className="text-xs text-ink-muted underline" onClick={onOpenCand}>Close</button>
          </div>
        </td></tr>
      )}
    </>
  )
}

// ── Direction 2 — paid ledger rows the bank never shows ─────────────────────
function UnmatchedLedgerPanel({ toast, onChanged, inline = false }) {
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')
  const [filter, setFilter] = useState('')
  const [cap, setCap] = useState(50)
  const load = useCallback(() => {
    setState('loading')
    api.get('/bank-matching/unmatched-ledger')
      .then((r) => { setData(r.data.data); setState('ready') })
      .catch((err) => { setState(err.response?.data?.error || 'Could not load the ledger side') })
  }, [])
  useEffect(() => { load() }, [load])

  // One-click from "no bank proof" to matched, from the ledger side.
  const matchFromLedger = async (entry, cand) => {
    if (!window.confirm(
      `Is the ${formatDate(cand.txn_date)} ${fmt(cand.amount, cand.currency)} debit to "${cand.payee_guess}" the payment for ${entry.payee}?\n\n`
      + 'Matching ties the bank line to this ledger entry and teaches the matcher the descriptor. It can be unmatched.')) return
    try {
      await api.post(`/bank-statements/txns/${cand.id}/match`, { expense_id: entry.id })
      toast('Matched')
      load(); onChanged?.()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const SECTIONS = [
    ['needs_match', 'Needs a match', 'A statement covers the payment date and the money is not on it. This is the real work.', 'text-danger'],
    ['awaiting_statement', 'Statement not in yet', 'Paid after the newest statement we hold. Nothing is wrong.', 'text-ink-muted'],
    ['missing_statement', 'Statement missing', 'Inside the span we hold, and no statement covers it — a month somebody never uploaded.', 'text-warning'],
  ]
  const flt = (rows) => filter.trim()
    ? rows.filter((r) => [r.payee, r.artist, r.song, r.invoice_number, r.category].some((v) => String(v || '').toLowerCase().includes(filter.toLowerCase())))
    : rows

  const body = (
    <>
      {state === 'loading' && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader size={13} className="animate-spin" /> Reading the ledger side…</p>}
      {state !== 'loading' && state !== 'ready' && (
        <div className="rounded-lg border border-rule bg-danger/10 px-3 py-2 text-sm text-ink">
          {state} <button onClick={load} className="ml-2 font-bold underline">retry</button>
        </div>
      )}
      {state === 'ready' && data && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <input className="input !py-1.5 text-sm max-w-xs" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button onClick={load} className="text-xs text-ink-muted underline">refresh</button>
          </div>
          {SECTIONS.map(([key, title, sub, tone]) => (
            <div key={key} className="mb-4">
              <p className={`text-xs font-bold uppercase tracking-wide ${tone}`}>{title} — {data[key].n}{data[key].truncated ? '+' : ''} · {money(data[key].value)}</p>
              <p className="text-[11px] text-ink-muted mb-1.5">{sub}{data[key].truncated ? ' Capped at 400 rows — narrow with the filter to see the rest.' : ''}</p>
              <div className="divide-y divide-divider">
                {flt(data[key].rows).slice(0, cap).map((r) => (
                  <div key={r.id} className="py-1.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-ink-faint tabular-nums w-20 shrink-0">{formatDate(r.payment_date)}</span>
                      <Link to={`/ledger?focus=${r.id}`} className="flex-1 truncate text-ink hover:text-brand-ink">{r.payee}</Link>
                      <span className="text-[11px] text-ink-faint truncate max-w-[150px]">{[r.artist, r.category].filter(Boolean).join(' · ')}</span>
                      <span className="text-[11px] text-ink-faint w-24 truncate">{r.invoice_number || (r.has_invoice ? '' : 'no file')}</span>
                      <span className="text-[11px] text-ink-faint w-14 truncate">{r.payment_method || ''}</span>
                      <span className="tabular-nums text-ink-muted w-20 text-right">{money(r.usd)}</span>
                      <Link to={`/vendors?q=${encodeURIComponent(r.payee || '')}`} className="text-[11px] text-brand-ink hover:underline shrink-0">Find the line</Link>
                      <Link to={`/ledger?focus=${r.id}`} className="text-[11px] text-ink-muted hover:underline shrink-0">Correct</Link>
                    </div>
                    {/* The way out: open debits that could BE this payment. */}
                    {r.bank_candidates?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pl-[5.5rem] mt-1">
                        <span className="text-[10px] uppercase tracking-wide text-ink-faint">found in bank?</span>
                        {r.bank_candidates.map((c) => (
                          <button key={c.id} onClick={() => matchFromLedger(r, c)}
                            className="text-[11px] rounded-lg border border-rule px-2 py-0.5 hover:border-brand-400 hover:bg-brand-500/10 text-ink">
                            {formatDate(c.txn_date)} · {c.payee_guess} · {fmt(c.amount, c.currency)}
                            <span className="text-ink-faint"> ({c.days_apart}d)</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {flt(data[key].rows).length > cap && (
                  <button className="text-[11px] text-brand-ink underline py-1.5" onClick={() => setCap((c) => c + 150)}>
                    Showing {cap} of {flt(data[key].rows).length} — show more
                  </button>
                )}
                {!data[key].n && <p className="text-xs text-ink-muted py-1.5">None. 🎉</p>}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink-muted">Coverage: {data.coverage.map((c) => `${c.account} through ${c.latest ? formatDate(c.latest) : '—'} (${c.statements})`).join(' · ')}</p>
        </>
      )}
    </>
  )

  if (inline) {
    return (
      <div className="card p-5">
        <p className="text-sm font-bold text-ink">Paid on the ledger, not on any statement</p>
        <p className="text-xs text-ink-muted mb-3">The other direction — no dismiss here by design: a paid row's only exits are a match or a correction.</p>
        {body}
      </div>
    )
  }
  const total = data ? data.needs_match.n + data.awaiting_statement.n + data.missing_statement.n : null
  return (
    <Panel title="Paid on the ledger, not on any statement" count={total}
      sub="the other direction — no dismiss here by design: a paid row's only exits are a match or a correction">
      {body}
    </Panel>
  )
}

// ── Booked rows whose real invoice showed up ─────────────────────────────────
function RematchPanel({ toast, onChanged, confirm, statement }) {
  const [data, setData] = useState(null)
  const [showContested, setShowContested] = useState(false)
  const load = useCallback(() => {
    api.get('/bank-matching/rematch-candidates', { params: statement !== 'all' ? { statement } : {} })
      .then((r) => setData(r.data.data)).catch(() => setData({ pairs: [], contested: [] }))
  }, [statement])
  useEffect(() => { load() }, [load])
  if (!data?.pairs?.length && !data?.contested?.length) return null

  const accept = (p) => confirm({
    title: 'Swap the invented entry for the real invoice?', variant: 'primary', confirmLabel: 'Rematch',
    message: `The entry this bank line invented (${p.txn.booked_payee}) is archived and the line is tied to ${p.invoice.payee}'s invoice`
      + `${p.invoice.invoice_number ? ` #${p.invoice.invoice_number}` : ''} instead. The spend stops being counted twice. This can be undone.`,
    run: async () => {
      try { await api.post(`/bank-matching/tx/${p.txn.id}/rematch`, { expense_id: p.invoice.id }); toast('Rematched — the invented entry is retired'); load(); onChanged() }
      catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const undo = async (txnId) => {
    try { await api.post(`/bank-matching/tx/${txnId}/unrematch`, {}); toast('Undone — the original booking is back'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const Row = ({ p, contested }) => (
    <div className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="text-xs text-ink-faint tabular-nums">{formatDate(p.txn.txn_date)}</span>
      <span className="flex-1 min-w-[220px] truncate">
        <span className="text-ink-faint">booked</span> <span className="text-ink">{p.txn.booked_payee || p.txn.payee_guess}</span>
        <span className="text-ink-faint"> → invoice</span> <span className="text-ink">{p.invoice.payee}{p.invoice.invoice_number ? ` #${p.invoice.invoice_number}` : ''}</span>
        <span className="block text-[11px] text-ink-muted">
          {p.method} · {p.tier === 'exact' ? 'exact to the cent' : p.tier === 'fee' ? `within fee tolerance (${p.delta > 0 ? '+' : ''}${p.delta})` : 'cross-currency'}
          {p.gap_days != null && ` · ${p.gap_days} day${p.gap_days === 1 ? '' : 's'} apart`}
          {p.invoice.has_invoice ? ' · has a document' : ' · no document on file'}
          {p.fx && ` · ${money(p.fx.txn_usd)} bank vs ${money(p.fx.invoice_usd)} invoice (${p.fx.invoice_currency}, ×${p.fx.ratio})`}
        </span>
      </span>
      <span className="tabular-nums text-ink-muted">{fmt(p.txn.amount, p.txn.currency)}</span>
      <span className="text-[11px] text-ink-faint">{Math.round(p.score * 100)}%</span>
      {contested ? (
        <span className="text-[11px] text-warning">already claimed by a stronger pair</span>
      ) : (
        <span className="flex items-center gap-2">
          <button className="btn-secondary !py-1 text-xs" onClick={() => accept(p)}><Check size={12} /> Rematch</button>
          <button className="text-[11px] text-ink-muted underline" onClick={() => undo(p.txn.id)} title="If this row was rematched before, put its original booking back">undo</button>
        </span>
      )}
    </div>
  )

  return (
    <Panel title="Booked rows whose real invoice arrived" count={data.pairs.length} defaultOpen
      sub={`swap the invented entry for the document — ${data.booked_considered} booked rows weighed against ${data.invoices_available} unclaimed invoices`}>
      <div className="divide-y divide-divider">{data.pairs.map((p) => <Row key={p.txn.id} p={p} />)}</div>
      {data.contested?.length > 0 && (
        <div className="mt-2">
          <button className="text-[11px] text-ink-muted underline" onClick={() => setShowContested((v) => !v)}>
            {showContested ? 'Hide' : 'Show'} {data.contested.length} contested pairing{data.contested.length === 1 ? '' : 's'} — the same invoice or row wanted by more than one proposal
          </button>
          {showContested && <div className="divide-y divide-divider opacity-70">{data.contested.map((p, i) => <Row key={`c${i}`} p={p} contested />)}</div>}
        </div>
      )}
    </Panel>
  )
}

// ── PayPal funding pairs ─────────────────────────────────────────────────────
function FundingPairsPanel({ toast, onChanged, confirm }) {
  const [data, setData] = useState(null)
  const load = () => api.get('/bank-matching/funding-pairs/cross-currency').then((r) => setData(r.data.data)).catch(() => setData(null))
  useEffect(() => { load() }, [])
  if (!data || (!data.pairs?.length && !data.unproven?.length && !data.ambiguous?.length && !data.paired?.length)) return null

  const pair = async (p, unproven) => {
    try {
      await api.post(`/bank-matching/tx/${p.pp.id}/funding-pair`, { bank_txn_id: p.bank.id, unproven, confirm_unnamed: !!unproven })
      toast('Paired — the bank pull leg is set aside'); load(); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const closeAll = () => confirm({
    title: `Set aside ${data.pairs.length} funding pull${data.pairs.length === 1 ? '' : 's'}?`, variant: 'primary', confirmLabel: 'Close them',
    message: 'Only the PROVABLE pairs — same-currency matches and cross-currency pulls that name the recipient. Unproven pairs are excluded and stay for you to judge. Each failure is reported rather than collapsing the batch.',
    run: async () => {
      try {
        const { data: r } = await api.post('/bank-matching/funding-pairs/close-all', {
          pairs: data.pairs.map((p) => ({ pp_id: p.pp.id, bank_txn_id: p.bank.id })),
        })
        toast(`${r.data.done.length} set aside${r.data.failed.length ? ` · ${r.data.failed.length} refused` : ''}`)
        load(); onChanged()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const undo = async (bankId) => {
    try { await api.post('/bank-matching/tx/0/funding-pair', { bank_txn_id: bankId, undo: true }); toast('Reopened'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const Row = ({ p, unproven }) => (
    <div className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="text-xs text-ink-faint tabular-nums">{formatDate(p.pp.txn_date)}</span>
      <span className="flex-1 min-w-[200px] truncate text-ink">
        {p.pp.payee_guess || p.pp.description}
        <span className="block text-[11px] text-ink-muted">
          {p.tier === 'exact' ? `same currency, off by ${p.delta}` : `spread ${p.spread_pct > 0 ? '+' : ''}${p.spread_pct}%`}
          {p.named_by ? ` · the pull names "${p.named_by}"` : unproven ? ' · nothing in the pull names the recipient' : ''}
        </span>
      </span>
      <span className="tabular-nums text-ink-muted">{fmt(p.pp.amount, p.pp.currency)} ↔ {fmt(p.bank.amount, p.bank.currency)}</span>
      <button className={`!py-1 text-xs ${unproven ? 'btn-secondary' : 'btn-secondary'}`} onClick={() => pair(p, unproven)}>
        <GitMerge size={12} /> {unproven ? 'Pair anyway' : 'Pair'}
      </button>
    </div>
  )

  return (
    <Panel title="PayPal funding pulls" count={data.summary?.total || data.pairs.length}
      sub={`one payment on two statements — ${money(data.summary?.counted_twice_usd || 0)} would count twice`} defaultOpen
      right={data.pairs.length > 1 ? <button className="btn-secondary !py-1 text-xs" onClick={closeAll}>Close all {data.pairs.length} provable</button> : null}>
      <p className="text-[11px] text-ink-muted mb-2">
        {data.summary?.provable || 0} provable · {data.summary?.unproven || 0} unproven · {data.summary?.ambiguous || 0} ambiguous.
        Proposals only — nothing is dismissed until you say so.
      </p>
      <div className="divide-y divide-divider">{data.pairs.map((p) => <Row key={`${p.pp.id}-${p.bank.id}`} p={p} />)}</div>
      {data.unproven?.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-warning">Amount fits, nothing names the recipient</p>
          <p className="text-[11px] text-ink-muted mb-1">The band alone is not proof, so these are excluded from the bulk close and each needs a deliberate yes.</p>
          <div className="divide-y divide-divider">{data.unproven.map((p) => <Row key={`u${p.pp.id}-${p.bank.id}`} p={p} unproven />)}</div>
        </div>
      )}
      {data.ambiguous?.map((a) => (
        <div key={`amb-${a.pp.id}`} className="py-2 text-xs text-warning">
          {formatDate(a.pp.txn_date)} · {a.pp.payee_guess || a.pp.description} — {a.candidates.length} equally-plausible pulls; resolve by hand on the statements.
        </div>
      ))}
      {data.paired?.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Already set aside as funding pulls — {data.paired.length}</p>
          <div className="divide-y divide-divider">
            {data.paired.slice(0, 20).map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="text-xs text-ink-faint tabular-nums">{formatDate(b.txn_date)}</span>
                <span className="flex-1 truncate text-ink-muted">{b.payee_guess || b.description}</span>
                <span className="tabular-nums text-ink-muted">{fmt(b.amount, b.currency)}</span>
                <button className="text-[11px] text-ink-muted underline" onClick={() => undo(b.id)}>put it back</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── One payment, two ledger rows ─────────────────────────────────────────────
function DuplicatePairsPanel({ toast, onChanged, confirm }) {
  const [data, setData] = useState(null)
  const load = () => api.get('/bank-matching/duplicate-pairs').then((r) => setData(r.data.data)).catch(() => setData(null))
  useEffect(() => { load() }, [])
  if (!data?.pairs?.length) return null
  const merge = (p) => confirm({
    title: 'Merge these two rows?', variant: 'primary', confirmLabel: 'Merge',
    message: `#${p.orphan_id} (the hand-logged copy) is kept and keeps its documents; #${p.twin_id} is archived and its bank line, documents and recoupment marks move over. If the twin no longer holds a bank line the merge is refused rather than silently archiving a record.`,
    run: async () => {
      try {
        const { data: r } = await api.post('/bank-matching/duplicate-pairs/merge', { orphan_id: p.orphan_id, twin_id: p.twin_id })
        toast(`Merged — ${r.data.moved} bank line${r.data.moved === 1 ? '' : 's'} moved${r.data.carried?.length ? `, carried ${r.data.carried.join(' + ')}` : ''}`)
        load(); onChanged()
      } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })
  const reject = async (p) => {
    try { await api.post('/bank-matching/duplicate-pairs/reject', { orphan_id: p.orphan_id }); toast('Kept apart — won\'t be offered again'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const docs = (inv, w9) => [inv ? 'invoice' : null, w9 ? 'W9' : null].filter(Boolean).join(' + ') || 'no documents'
  return (
    <Panel title="One payment, two ledger rows" count={data.pairs.length} sub="a hand-logged copy beside the bank-matched one">
      <div className="divide-y divide-divider">
        {data.pairs.map((p) => (
          <div key={p.orphan_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="flex-1 min-w-[220px] truncate text-ink">
              {p.payee}
              <span className="block text-[11px] text-ink-muted">
                #{p.orphan_id} (no bank line, {docs(p.orphan_has_invoice, p.orphan_has_w9)}{p.orphan_artist ? `, ${p.orphan_artist}` : ''})
                {' vs '}#{p.twin_id} (matched, {docs(p.twin_has_invoice, p.twin_has_w9)}{p.twin_artist ? `, ${p.twin_artist}` : ''})
                {p.gap_days != null && ` · paid ${p.gap_days} day${p.gap_days === 1 ? '' : 's'} apart`}
              </span>
            </span>
            <span className="tabular-nums text-ink-muted">{fmt(p.amount, p.currency)}</span>
            <button className="btn-secondary !py-1 text-xs" onClick={() => merge(p)}>Merge</button>
            <button className="text-xs text-ink-muted underline" onClick={() => reject(p)}>Not duplicates</button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── What the matcher did unasked ─────────────────────────────────────────────
function AutoDecisionsPanel({ toast, onChanged }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [grouped, setGrouped] = useState(true)
  useEffect(() => { api.get('/bank-matching/auto-decisions', { params: { days } }).then((r) => setData(r.data.data)).catch(() => setData(null)) }, [days])
  if (!data?.total) return null
  const groups = new Map()
  for (const t of data.rows) {
    const k = t.payee_guess || '—'
    const g = groups.get(k) || { key: k, rows: [], vendors: new Set() }
    g.rows.push(t); if (t.exp_payee) g.vendors.add(t.exp_payee)
    groups.set(k, g)
  }
  const unmatch = async (t) => {
    try { await api.post(`/bank-statements/txns/${t.id}/unmatch`, {}); toast('Unmatched'); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const RowLine = (t) => (
    <div key={t.id} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
      <span className="text-xs text-ink-faint tabular-nums">{formatDate(t.txn_date)}</span>
      <span className="flex-1 min-w-[180px] truncate text-ink">{t.payee_guess || '—'} → {t.exp_payee}{t.invoice_number ? ` #${t.invoice_number}` : ''}</span>
      <span className="tabular-nums text-ink-muted">{fmt(t.amount, t.currency)}</span>
      <span className="text-[11px] text-ink-faint">{t.match_method?.replace('auto-', '')} {t.match_score != null ? `${Math.round(t.match_score * 100)}%` : ''}</span>
      <Link to={`/ledger?focus=${t.matched_expense_id || ''}`} className="text-[10px] font-bold text-ink-muted hover:text-brand-ink">L</Link>
      <button className="text-xs text-ink-muted underline" onClick={() => unmatch(t)}>Unmatch</button>
    </div>
  )
  return (
    <Panel title="Auto-decisions" count={data.total}
      sub={data.shown < data.total ? `showing ${data.shown} of ${data.total}` : 'every automatic match, so nothing happens silently'}
      right={
        <span className="flex items-center gap-2">
          <select className="input !py-1 !px-1.5 text-xs !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>last {d} days</option>)}
          </select>
          <button className="text-[11px] text-ink-muted underline" onClick={() => setGrouped((v) => !v)}>{grouped ? 'flat' : 'by vendor'}</button>
        </span>
      }>
      {grouped ? (
        [...groups.values()].sort((a, b) => b.rows.length - a.rows.length).map((g) => (
          <div key={g.key} className="border-b border-divider last:border-0 py-1">
            <p className="text-[11px] font-semibold text-ink-muted">
              {g.key} — {g.rows.length} line{g.rows.length === 1 ? '' : 's'}
              {g.vendors.size > 1 && <span className="text-warning"> · matched to {g.vendors.size} different vendors</span>}
            </p>
            {g.rows.map(RowLine)}
          </div>
        ))
      ) : <div className="divide-y divide-divider">{data.rows.map(RowLine)}</div>}
    </Panel>
  )
}

// ── Batch view — clear every open debit, vendor by vendor ────────────────────
function BatchView({ toast, onChanged, onExit, artists }) {
  const [groups, setGroups] = useState(null)
  const [rows, setRows] = useState([])
  const [expanded, setExpanded] = useState(new Set())
  const [pick, setPick] = useState({})       // txnId -> { category, artist }
  const [sel, setSel] = useState(new Set())
  const [progress, setProgress] = useState(null)
  const load = useCallback(async () => {
    try {
      const [g, q] = await Promise.all([
        api.get('/bank-matching/bank-vendors'),
        api.get('/bank-matching/queue', { params: { statement: 'all' } }),
      ])
      const open = (q.data.data.rows || []).filter((t) => t.disposition === 'open')
      setRows(open)
      // Only groups that still hold open work; biggest first, top 3 open.
      const byKey = new Map()
      for (const t of open) {
        const k = (g.data.data.find((x) => x.txn_ids.includes(t.id)) || {}).key || (t.payee_guess || '—')
        const arr = byKey.get(k) || []
        arr.push(t); byKey.set(k, arr)
      }
      const list = [...byKey.entries()]
        .map(([key, items]) => ({ key, items, name: items[0].payee_guess || items[0].description || key, total: items.reduce((s, t) => s + Number(t.usd || 0), 0) }))
        .sort((a, b) => b.items.length - a.items.length || b.total - a.total)
      setGroups(list)
      setExpanded(new Set(list.slice(0, 3).map((x) => x.key)))
    } catch (err) { toast(err.response?.data?.error || 'Failed to load', 'error'); setGroups([]) }
  }, [toast])
  useEffect(() => { load() }, [load])

  if (!groups) return <div className="card p-2"><Skeleton.Table rows={6} cols={4} /></div>

  const proposalFor = (t) => (t.suggestions?.[0]?.score >= 0.7 ? { kind: 'match', target: t.suggestions[0] } : { kind: 'book', category: pick[t.id]?.category || t.suggested_category || '' })
  const applySelected = async () => {
    const ids = [...sel]
    setProgress({ done: 0, total: ids.length, failed: [] })
    const failed = []
    let done = 0
    for (const id of ids) {
      const t = rows.find((x) => x.id === id)
      if (!t) continue
      const p = proposalFor(t)
      try {
        if (p.kind === 'match') await api.post(`/bank-statements/txns/${id}/match`, { expense_id: p.target.expense_id })
        else {
          if (!p.category) throw new Error('no category chosen')
          await api.post(`/bank-statements/txns/${id}/book`, { category: p.category, artist: pick[id]?.artist || null })
        }
        done += 1
      } catch (err) { failed.push({ id, payee: t.payee_guess, why: err.response?.data?.error || err.message }) }
      setProgress({ done, total: ids.length, failed })
    }
    toast(`${done} of ${ids.length} cleared`)
    setSel(new Set())
    await load(); onChanged()
  }
  const dismissSelected = async () => {
    const ids = [...sel]
    try {
      const { data: r } = await api.post('/bank-statements/txns/bulk', { ids, action: 'dismiss' })
      toast(`${r.data.affected} of ${ids.length} set aside`); setSel(new Set()); await load(); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const setGroupCategory = (g, category) => setPick((p) => {
    const n = { ...p }
    for (const t of g.items) n[t.id] = { ...(n[t.id] || {}), category }
    return n
  })
  const toggleGroupSel = (g) => setSel((s) => {
    const n = new Set(s)
    const all = g.items.every((t) => n.has(t.id))
    for (const t of g.items) all ? n.delete(t.id) : n.add(t.id)
    return n
  })

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-sm font-bold text-ink">Batch — clear open debits vendor by vendor</p>
        <button className="text-xs text-ink-muted underline" onClick={onExit}>back to the queue</button>
        <span className="ml-auto text-xs text-ink-muted">{rows.length} open across {groups.length} vendor{groups.length === 1 ? '' : 's'}</span>
      </div>
      {sel.size > 0 && (
        <div className="sticky top-2 z-20 card shadow-modal px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 bg-brand-500/10 border-brand-300">
          <span className="text-sm font-medium text-ink">{sel.size} selected</span>
          <button className="btn-primary !py-1.5 text-xs" onClick={applySelected}>Apply the proposals</button>
          <button className="btn-secondary !py-1.5 text-xs" onClick={dismissSelected}>Dismiss them</button>
          <button className="text-ink-muted hover:text-ink ml-1" onClick={() => setSel(new Set())}><X size={16} /></button>
          {progress && (
            <span className="text-xs text-ink-muted">
              {progress.done} of {progress.total}{progress.failed.length ? ` · ${progress.failed.length} refused` : ''}
            </span>
          )}
        </div>
      )}
      {progress?.failed?.length > 0 && (
        <div className="rounded-lg border border-rule bg-warning/10 px-3 py-2 mb-3 text-xs text-ink">
          <p className="font-semibold mb-1">These were refused — nothing about them changed:</p>
          {progress.failed.slice(0, 8).map((f) => <p key={f.id}>#{f.id} {f.payee}: {f.why}</p>)}
        </div>
      )}
      {groups.length === 0 && <p className="text-sm text-ink-muted py-6 text-center">No open debits. 🎉</p>}
      {groups.map((g) => {
        const isOpen = expanded.has(g.key)
        return (
          <div key={g.key} className="border-b border-divider last:border-0 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
                className="flex items-center gap-1.5 text-left">
                {isOpen ? <ChevronDown size={14} className="text-ink-faint" /> : <ChevronRight size={14} className="text-ink-faint" />}
                <span className="text-sm font-semibold text-ink truncate max-w-[280px]">{g.name}</span>
              </button>
              <span className="text-[11px] text-ink-muted tabular-nums">{g.items.length} × · {money(g.total)}</span>
              <span className="ml-auto flex items-center gap-2">
                <select className="input !py-1 !px-1.5 text-xs !w-auto" value="" onChange={(e) => e.target.value && setGroupCategory(g, e.target.value)}>
                  <option value="">book all as…</option>
                  <CategoryOptions />
                </select>
                <button className="text-[11px] text-brand-ink underline" onClick={() => toggleGroupSel(g)}>select all</button>
              </span>
            </div>
            {isOpen && (
              <div className="mt-1.5 divide-y divide-divider">
                {g.items.map((t) => {
                  const p = proposalFor(t)
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                      <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n })} />
                      <span className="text-xs text-ink-faint tabular-nums w-20">{formatDate(t.txn_date)}</span>
                      <span className="flex-1 min-w-[150px] truncate text-ink-muted">{t.description || t.payee_guess}</span>
                      <span className="tabular-nums text-ink">{fmt(t.amount, t.currency)}</span>
                      {p.kind === 'match' ? (
                        <span className="text-[11px] text-success truncate max-w-[220px]">match → {p.target.payee} ({Math.round(p.target.score * 100)}%)</span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <select className="input !py-1 !px-1.5 text-xs !w-auto" value={p.category}
                            onChange={(e) => setPick((s) => ({ ...s, [t.id]: { ...(s[t.id] || {}), category: e.target.value } }))}>
                            <option value="">book as…</option>
                            <CategoryOptions />
                          </select>
                          <select className="input !py-1 !px-1.5 text-xs !w-auto" value={pick[t.id]?.artist || ''}
                            onChange={(e) => setPick((s) => ({ ...s, [t.id]: { ...(s[t.id] || {}), artist: e.target.value } }))}>
                            <option value="">artist…</option>
                            {artists.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Multi-invoice attach ────────────────────────────────────────────────────
function AttachModal({ txn, onClose, onDone, toast, confirm }) {
  const [chosen, setChosen] = useState(() => new Set(txn.group_proposal?.ambiguous ? [] : (txn.group_proposal?.sets?.[0]?.expense_ids || [])))
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [known, setKnown] = useState(() => {
    const m = new Map()
    for (const s of txn.group_proposal?.sets || []) for (const i of s.invoices) m.set(i.id, i)
    return m
  })
  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const h = setTimeout(() => api.get('/bank-statements/ledger-search', { params: { q } })
      .then((r) => {
        const rows = r.data.data || []
        setResults(rows)
        setKnown((m) => { const n = new Map(m); for (const x of rows) n.set(x.id, { ...x, amount: Number(x.family_amount) }); return n })
      }).catch(() => {}), 250)
    return () => clearTimeout(h)
  }, [q])

  const total = [...chosen].reduce((s, id) => s + Number(known.get(id)?.amount || known.get(id)?.family_amount || 0), 0)
  const delta = total - Number(txn.amount)
  const toggle = (id) => setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const submit = async (allowPrepayment) => {
    try {
      const { data } = await api.post(`/bank-matching/tx/${txn.id}/attach`, { expense_ids: [...chosen], allow_prepayment: allowPrepayment })
      toast(`Settled ${data.data.linked.length} invoice${data.data.linked.length === 1 ? '' : 's'}`)
      onDone()
    } catch (err) {
      const d = err.response?.data
      if (d?.prepayment_possible && !allowPrepayment) {
        confirm({
          title: 'Record it as a prepayment?', variant: 'primary', confirmLabel: 'Record anyway',
          message: d.error, run: () => submit(true),
        })
        return
      }
      toast(d?.error || 'Failed', 'error')
    }
  }

  const Row = ({ inv }) => (
    <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${chosen.has(inv.id) ? 'border-brand-400 bg-brand-500/10' : 'border-rule'}`}>
      <input type="checkbox" checked={chosen.has(inv.id)} onChange={() => toggle(inv.id)} />
      <span className="flex-1 min-w-0">
        <span className="text-sm text-ink truncate block">{inv.payee}{inv.invoice_number ? ` · #${inv.invoice_number}` : ''}</span>
        <span className="text-[11px] text-ink-muted">
          {inv.payment_status || ''}{inv.invoice_date ? ` · ${formatDate(inv.invoice_date)}` : ''}
          {inv.partially_settled && <span className="text-warning"> · {money(inv.remaining)} left of {money(inv.family_amount)}</span>}
        </span>
      </span>
      <span className="tabular-nums text-sm text-ink-muted">{fmt(inv.amount ?? inv.family_amount, inv.currency)}</span>
    </label>
  )

  return (
    <Modal open onClose={onClose} title="One payment, several invoices" size="lg">
      <p className="text-xs text-ink-muted mb-3">
        {txn.payee_guess || txn.description} · {fmt(txn.amount, txn.currency)} · {formatDate(txn.txn_date)}
      </p>
      {txn.group_proposal?.ambiguous && (
        <p className="text-xs text-warning mb-3 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          More than one set of invoices adds up to this amount, so nothing is pre-selected. Attaching the wrong set marks real invoices paid by a payment that never covered them.
        </p>
      )}
      {(txn.group_proposal?.sets || []).map((s, i) => (
        <div key={i} className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Proposal {txn.group_proposal.sets.length > 1 ? i + 1 : ''} — {s.invoices.length} invoices totalling {money(s.total)}{s.delta ? ` (off by ${s.delta})` : ''}
            </p>
            <button className="text-[11px] text-brand-ink underline" onClick={() => setChosen(new Set(s.expense_ids))}>use this set</button>
          </div>
          <div className="space-y-1.5">{s.invoices.map((inv) => <Row key={inv.id} inv={inv} />)}</div>
        </div>
      ))}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-2">Add another invoice</p>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Payee or invoice #…" className="input mb-2" />
      <div className="space-y-1.5 max-h-[220px] overflow-y-auto">{results.map((r) => <Row key={r.id} inv={{ ...r, amount: Number(r.family_amount) }} />)}</div>
      <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-divider">
        <span className="text-sm text-ink-muted tabular-nums">
          {chosen.size} selected · {fmt(total, txn.currency)} against {fmt(txn.amount, txn.currency)}
          {Math.abs(delta) > 0.005 && <span className={Math.abs(delta) > Math.max(35, Number(txn.amount) * 0.01) ? 'text-danger' : 'text-warning'}> · off by {fmt(Math.abs(delta), txn.currency)}</span>}
        </span>
        <span className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={chosen.size === 0} onClick={() => submit(false)}>Settle {chosen.size || ''}</button>
        </span>
      </div>
    </Modal>
  )
}

// ── Split one bank line into several booked slices ──────────────────────────
function SplitModal({ txn, artists, onClose, onDone, toast }) {
  const [parts, setParts] = useState([{ amount: '', category: '', artist: '' }, { amount: '', category: '', artist: '' }])
  const [payee, setPayee] = useState(txn.vendor_override || txn.vendor_hint?.name || txn.payee_guess || '')
  const [saving, setSaving] = useState(false)
  const sum = parts.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const delta = sum - Number(txn.amount)
  const set = (i, k, v) => setParts((ps) => ps.map((p, j) => (i === j ? { ...p, [k]: v } : p)))
  const save = async () => {
    setSaving(true)
    try {
      const { data } = await api.post(`/bank-matching/tx/${txn.id}/split-book`, { parts, payee })
      toast(`Split into ${data.data.parts} slices for ${data.data.payee}`)
      onDone()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Split this line into slices" size="lg">
      <p className="text-xs text-ink-muted mb-3">
        {txn.payee_guess || txn.description} · {fmt(txn.amount, txn.currency)} · {formatDate(txn.txn_date)} — each slice becomes an approved, Paid entry in one family.
      </p>
      <label className="label">Payee for every slice</label>
      <input className="input mb-3" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Who was paid?" />
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="input !py-1.5 text-sm w-28" placeholder="Amount" value={p.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
            <select className="input !py-1.5 text-sm flex-1 min-w-[140px]" value={p.category} onChange={(e) => set(i, 'category', e.target.value)}>
              <option value="">category (required)…</option>
              <CategoryOptions />
            </select>
            <select className="input !py-1.5 text-sm w-40" value={p.artist} onChange={(e) => set(i, 'artist', e.target.value)}>
              <option value="">artist…</option>
              {artists.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            {parts.length > 2 && <button className="text-ink-muted hover:text-danger" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}><X size={15} /></button>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 mt-3">
        <button className="text-xs text-brand-ink underline disabled:opacity-40" disabled={parts.length >= 6}
          onClick={() => setParts((ps) => [...ps, { amount: '', category: '', artist: '' }])}>
          Add a slice{parts.length >= 6 ? ' (six is the limit)' : ''}
        </button>
        <span className={`text-sm tabular-nums ${Math.abs(delta) > 0.01 ? 'text-danger' : 'text-success'}`}>
          {fmt(sum, txn.currency)} of {fmt(txn.amount, txn.currency)}{Math.abs(delta) > 0.01 ? ` · ${delta > 0 ? 'over' : 'short'} by ${fmt(Math.abs(delta), txn.currency)}` : ' ✓'}
        </span>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving || Math.abs(delta) > 0.01 || parts.some((p) => !p.category)} onClick={save}>
          {saving ? 'Splitting…' : `Book ${parts.length} slices`}
        </button>
      </div>
    </Modal>
  )
}

// ── "This descriptor is which vendor?" ──────────────────────────────────────
function VendorModal({ target, onClose, onDone, toast }) {
  const txn = target.txn
  const [vendor, setVendor] = useState(txn?.vendor_override || txn?.vendor_hint?.name || '')
  const [saving, setSaving] = useState(false)
  const [unknown, setUnknown] = useState(null)
  const save = async (confirmNew) => {
    setSaving(true)
    try {
      if (target.bulk) {
        const { data } = await api.post('/bank-matching/vendor/bulk', { vendor, txn_ids: target.ids })
        toast(`${data.data.updated} row${data.data.updated === 1 ? '' : 's'} filed under ${vendor}`)
      } else {
        await api.post(`/bank-matching/tx/${txn.id}/vendor`, { vendor, confirm_new: confirmNew })
        toast(`Filed under ${vendor}`)
      }
      onDone()
    } catch (err) {
      const d = err.response?.data
      if (d?.unknown_vendor) { setUnknown(d.error); setSaving(false); return }
      toast(d?.error || 'Failed', 'error'); setSaving(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={target.bulk ? `Set the vendor on ${target.ids.length} rows` : 'Which vendor is this?'} size="md">
      <p className="text-xs text-ink-muted mb-3">
        {target.bulk
          ? 'The descriptor on each row is also taught to the matcher, so future statements land on the same vendor.'
          : `The bank says "${txn.payee_guess || txn.description}". Naming the vendor files this line under them and teaches the matcher the same lesson.`}
      </p>
      <input autoFocus className="input" value={vendor} onChange={(e) => { setVendor(e.target.value); setUnknown(null) }} placeholder="Ledger vendor name…" />
      {unknown && (
        <div className="mt-3 rounded-lg border border-rule bg-warning/10 px-3 py-2 text-xs text-ink">
          {unknown}
          <button className="ml-2 font-bold underline" onClick={() => save(true)}>Use it anyway</button>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving || !vendor.trim()} onClick={() => save(false)}>{saving ? 'Saving…' : 'Set vendor'}</button>
      </div>
    </Modal>
  )
}

// ── Upload rules — the setup surface for this page ───────────────────────────
// Organized around one question: will this line ever have an invoice behind
// it? If it will, it wants MATCHING — a booking rule would stop that
// permanently. If it never will, it wants a rule AND the note that no document
// is coming, or the rule feeds the needs-invoice queue on every upload.
function RulesPanel({ toast, completion, onChanged, onWorkThese }) {
  const [suggestions, setSuggestions] = useState(null)
  const [catRules, setCatRules] = useState([])
  const [dismissRules, setDismissRules] = useState([])
  const [artistRules, setArtistRules] = useState([])
  const [noInvRules, setNoInvRules] = useState([])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ pattern: '', artist: '', is_overhead: false })

  const load = async () => {
    setError('')
    try {
      const [s, c, d, a, n] = await Promise.all([
        api.get('/bank-matching/rule-suggestions'),
        // annotate=1: also report what each BOOK rule is DOING — how many rows
        // it is putting in the needs-invoice queue, and which ledger vendors
        // they resolve to.
        api.get('/bank-matching/category-rules?annotate=1'),
        api.get('/bank-matching/dismiss-rules'),
        api.get('/bank-matching/artist-rules'),
        api.get('/bank-matching/no-invoice-rules'),
      ])
      setSuggestions(s.data.data || null)
      setCatRules(c.data.data || [])
      setDismissRules(d.data.data || [])
      setArtistRules(a.data.data || [])
      setNoInvRules(n.data.data || [])
    } catch (err) {
      // Surfaced, not swallowed — a silent failure renders an empty rule list,
      // which reads as "no rules exist": the opposite of the truth.
      setError(err.response?.data?.error || err.message)
      setSuggestions('error')
    }
  }
  useEffect(() => { load() }, [])
  const done = () => { load(); onChanged() }

  // Accepting a "never invoices" suggestion — ONE call writes both halves (the
  // booking rule and the no-invoice marker), because a category rule on its
  // own feeds the needs-invoice queue.
  const acceptNoInvoice = async (x) => {
    if (busy) return
    const reach = x.also_matches_count
      ? `\n\nHEADS UP — this pattern also reaches ${x.conflict_rows} row${x.conflict_rows === 1 ? '' : 's'} `
        + `already booked to a different category, on: ${x.also_matches.slice(0, 4).join(', ')}`
        + `${x.also_matches_count > 4 ? '…' : ''}. Those would be recategorised from now on.`
      : ''
    const clash = x.conflicts.length
      ? `\n\nNote: ${x.conflicts.map((c) => `${c.times} were ${c.value}`).join(', ')}. The rule will use "${x.value}" for all of them from now on.`
      : ''
    const partial = x.book_pattern_hits < x.book_pattern_rows
      ? `\n\nThe pattern covers ${x.book_pattern_hits} of this vendor's ${x.book_pattern_rows} lines — the rest arrive under a different descriptor and will still be asked about.`
      : ''
    const clears = x.queue_rows
      ? `\n\n${x.queue_rows} row${x.queue_rows === 1 ? '' : 's'} (${money(x.queue_usd)}) leave the needs-invoice queue immediately. `
        + 'Nothing in the ledger changes and no money moves.'
      : ''
    if (!window.confirm(
      `Always book "${x.pattern}" as ${x.value}, and record that ${x.ledger_payee} never sends an invoice?\n\n`
      + `You've made this call ${x.times} times.${clash}${partial}${reach}${clears}\n\n`
      + 'The booking rule applies to future statements only.')) return
    setBusy(x.kind + x.pattern)
    try {
      await api.post('/bank-matching/category-rules', { pattern: x.pattern, category: x.value, no_invoice_pattern: x.no_invoice_pattern })
      done()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  // Same answer, no booking rule — nothing about the descriptors was
  // distinctive enough to write a rule that provably fires.
  const acceptStopAsking = async (x) => {
    if (busy) return
    if (!window.confirm(
      `Record that "${x.pattern}" never sends an invoice?\n\n`
      + `${x.queue_rows} booked row${x.queue_rows === 1 ? '' : 's'} (${money(x.queue_usd)}) stop counting as unfinished.\n\n`
      + 'No booking rule is written — these lines arrive under too many different descriptors for one to match '
      + 'reliably, so future ones still need a category. Nothing in the ledger changes and no money moves.')) return
    setBusy(x.kind + x.pattern)
    try { await api.post('/bank-matching/no-invoice-rules', { scope: 'vendor', pattern: x.pattern }); done() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const acceptOther = async (x) => {
    if (busy) return
    const reach = x.also_matches_count
      ? `\n\nHEADS UP — this pattern also matches ${x.also_matches_count} other vendor${x.also_matches_count === 1 ? '' : 's'}: `
        + `${x.also_matches.slice(0, 4).join(', ')}${x.also_matches_count > 4 ? '…' : ''}. They would be caught too.`
      : ''
    const clash = x.conflicts.length
      ? `\n\nNote: ${x.conflicts.map((c) => `${c.times} were ${c.value}`).join(', ')}. The rule will use "${x.value}" for all of them from now on.`
      : ''
    if (!window.confirm(
      `Always ${x.kind === 'dismiss' ? 'set aside' : 'attribute'} "${x.pattern}" as ${x.value}?\n\n`
      + `You've made this call ${x.times} times.${clash}${reach}\n\n`
      + 'Applies to future statements only — nothing already recorded changes.')) return
    setBusy(x.kind + x.pattern)
    try {
      if (x.kind === 'dismiss') await api.post('/bank-matching/dismiss-rules', { pattern: x.pattern })
      else await api.post('/bank-matching/artist-rules', { pattern: x.pattern, artist: x.value })
      done()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const markNoInvoice = async (c) => {
    if (busy) return
    if (!window.confirm(`Mark the category "${c.category}" as never having an invoice?\n\n`
      + `${c.n} booked row${c.n === 1 ? '' : 's'} (${money(c.value)}) across ${c.vendors} vendor${c.vendors === 1 ? '' : 's'} stop counting as unfinished.\n\n`
      + 'Nothing in the ledger changes and no money moves — this only records that no document is coming.')) return
    setBusy('cand' + c.category)
    try { await api.post('/bank-matching/no-invoice-rules', { scope: 'category', pattern: c.category }); done() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const markVendorNoInvoice = async (v) => {
    if (busy) return
    const name = v.sample || v.key
    if (!window.confirm(`Record that "${name}" never sends an invoice?\n\n`
      + `${v.n} booked row${v.n === 1 ? '' : 's'} (${money(v.value)}) stop counting as unfinished.\n\n`
      + 'Nothing in the ledger changes and no money moves.')) return
    setBusy('vend' + v.key)
    try { await api.post('/bank-matching/no-invoice-rules', { scope: 'vendor', pattern: name }); toast('Rule saved — those rows stop asking for a document'); done() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  // Close the leak on a BOOK rule already in force — one call writes a vendor
  // no-invoice rule per ledger payee its queue rows resolve to. Refused when
  // every payee really invoices: those rows want matching, not this answer.
  const pairRule = async (rule) => {
    if (busy) return
    const safe = (rule.ledger_payees || []).filter((p) => p.real_invoices === 0)
    const invoicing = (rule.ledger_payees || []).filter((p) => p.real_invoices > 0)
    if (!safe.length) {
      toast(`Every vendor behind this rule has sent real invoices — ${invoicing.map((p) => `${p.payee} (${p.real_invoices})`).join(', ')}. These rows want matching, not an answer.`, 'error')
      return
    }
    // `clears`, not `rows`: the no-invoice rule matches the ledger payee OR
    // the bank descriptor, so it also clears rows filed under another name.
    const clears = safe.reduce((s, p) => s + (p.clears ?? p.rows), 0)
    if (!window.confirm(
      `Record that ${safe.map((p) => `"${p.payee}"`).join(', ')} never send an invoice?\n\n`
      + `${clears} row${clears === 1 ? '' : 's'} leave the needs-invoice queue immediately`
      + `${clears > rule.queue_rows ? ` — more than this rule's ${rule.queue_rows}, because the same vendor also arrives under other descriptors` : ''}.`
      + (invoicing.length
        ? `\n\nLeft alone: ${invoicing.map((p) => `${p.payee} (${p.real_invoices} real invoices)`).join(', ')} — those rows want matching, not this answer.`
        : '')
      + '\n\nNothing in the ledger changes and no money moves.')) return
    setBusy('pair' + rule.id)
    try { await api.post('/bank-matching/no-invoice-rules', { scope: 'vendor', patterns: safe.map((p) => p.payee) }); done() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  // Removing a rule names its consequence — future statements stop applying
  // it; nothing already recorded changes.
  const remove = async (path, id, label) => {
    if (busy) return
    if (!window.confirm(`Remove ${label}?\n\nFuture statements stop applying it. Nothing already recorded changes.`)) return
    setBusy(path + id)
    try { await api.delete(`/bank-matching/${path}/${id}`); done() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(null) }
  }

  const addArtist = async () => {
    try {
      await api.post('/bank-matching/artist-rules', form)
      toast('Rule saved — applies to future statements')
      setForm({ pattern: '', artist: '', is_overhead: false }); done()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const totalRules = catRules.length + dismissRules.length + artistRules.length + noInvRules.length
  const sug = suggestions === 'error' || !suggestions ? [] : suggestions.suggestions || []
  const of = (k) => sug.filter((x) => x.kind === k)
  const matchSug = of('match')
  const noInvSug = [...of('category'), ...of('no-invoice')]
  const otherSug = [...of('dismiss'), ...of('artist')]
  const leaking = catRules.filter((r) => (r.queue_rows || 0) > 0)
  const leakRows = leaking.reduce((s, r) => s + r.queue_rows, 0)
  const candidates = completion?.category_candidates || []

  // ONE row treatment for every suggestion and in-force rule — the tag names
  // the ANSWER ("NO INVOICE"), not the table the rule lands in.
  const Row = ({ tag, tone, pattern, sub, value, meta, note, warn, action, busyKey }) => (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 border-b border-divider last:border-0 text-[13px] ${busy === busyKey ? 'opacity-50' : ''}`}>
      <span className={`text-[11px] font-semibold w-[74px] shrink-0 ${tone}`}>{tag}</span>
      <span className="font-mono font-semibold text-ink truncate max-w-[230px]" title={pattern}>"{pattern}"</span>
      {sub && <span className="text-[11px] text-ink-muted truncate max-w-[150px]" title={sub}>{sub}</span>}
      {value && <><span className="text-ink-faint">→</span><span className="font-semibold text-ink truncate max-w-[170px]">{value}</span></>}
      {meta && <span className="text-[11px] text-ink-muted tabular-nums">{meta}</span>}
      {note && <span className="text-[11px] text-ink-muted">{note}</span>}
      {warn && (
        <span className="inline-flex items-center gap-1 text-[11px] text-warning" title={warn.title}>
          <AlertTriangle size={11} /> {warn.label}
        </span>
      )}
      <span className="ml-auto shrink-0">{action}</span>
    </div>
  )

  const SectionHead = ({ title, sub }) => (
    <div className="pt-3 pb-1.5 border-b border-divider">
      <span className="text-sm font-bold text-ink">{title}</span>
      <span className="text-[12px] text-ink-muted"> — {sub}</span>
    </div>
  )

  return (
    <Panel title="Upload rules" count={totalRules} sub="will this line ever have an invoice behind it? Match it if so; rule + no-invoice note if not">
      {error && (
        <div className="mb-3 rounded-lg border border-rule bg-warning/10 px-3.5 py-2.5 text-[13px] text-ink">
          Couldn't load rules: {error}
          <button onClick={load} className="ml-2 font-bold underline">retry</button>
        </div>
      )}

      {/* 1. Invoices waiting — no rule is written from this section; the
          action is to go work them in the queue above. */}
      {matchSug.length > 0 && (
        <div className="mb-2">
          <SectionHead title="These have invoices — match them, don't rule them"
            sub={`${matchSug.length} vendor${matchSug.length === 1 ? '' : 's'} being booked past documents the ledger already holds`
              + `${suggestions.waiting_invoices ? `, ${suggestions.waiting_invoices} still unclaimed` : ''}. A booking rule here would make that permanent.`} />
          {matchSug.map((x) => (
            <Row key={x.kind + x.pattern} tag="MATCH" tone="text-success"
              pattern={x.pattern}
              meta={`${x.booked_rows} booked · ${money(x.total_usd)}`}
              note={x.waiting_invoices > 0
                ? `${x.waiting_invoices} invoice${x.waiting_invoices === 1 ? '' : 's'} waiting unclaimed`
                : `${x.real_invoices} real invoice${x.real_invoices === 1 ? '' : 's'} on file, all claimed`}
              warn={x.waiting_invoices === 0 ? {
                label: 'may be double-recorded',
                title: 'This vendor invoices, but every invoice is already claimed by another bank row — so these booked rows may be duplicate records of the same payments.',
              } : null}
              action={(
                <button onClick={() => onWorkThese && onWorkThese(x.pattern)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-success hover:underline">
                  Work these <ArrowRight size={11} />
                </button>
              )} />
          ))}
        </div>
      )}

      {/* 2. Never come with an invoice — the category rule is right here,
          PAIRED so it stops asking as well as booking. */}
      {noInvSug.length > 0 && (
        <div className="mb-2">
          <SectionHead title="These never come with an invoice"
            sub={`no vendor here has ever sent one. Accepting books future lines AND records that no document is coming`
              + `${suggestions.clears_queue_rows ? ` — ${suggestions.clears_queue_rows} rows leave the queue between them` : ''}.`} />
          {noInvSug.slice(0, 60).map((x) => (
            <Row key={x.kind + x.pattern} tag={x.kind === 'category' ? 'BOOK + NO INV' : 'NO INVOICE'}
              tone="text-ink-muted"
              pattern={x.pattern}
              sub={x.kind === 'category' && x.ledger_payee !== x.pattern ? x.ledger_payee : null}
              value={x.kind === 'category' ? x.value : null}
              meta={`${x.times}×${x.total_usd ? ` · ${money(x.total_usd)}` : ''}`}
              note={x.queue_rows ? `clears ${x.queue_rows} now` : (x.kind === 'no-invoice' ? null : 'no rule written')}
              warn={
                x.also_matches_count > 0 ? {
                  label: `relabels ${x.conflict_rows} row${x.conflict_rows === 1 ? '' : 's'}`,
                  title: `This pattern also reaches rows booked to a different category, on: ${x.also_matches.join(', ')}`,
                } : x.conflicts.length > 0 ? {
                  label: `but ${x.conflicts[0].times} were ${x.conflicts[0].value}`,
                  title: x.conflicts.map((c) => `${c.times} × ${c.value}`).join(', '),
                } : x.kind === 'category' && x.book_pattern_hits < x.book_pattern_rows ? {
                  label: `covers ${x.book_pattern_hits} of ${x.book_pattern_rows}`,
                  title: "The rest of this vendor's lines arrive under a different descriptor, so the rule will not catch them and they will still be asked about.",
                } : null
              }
              busyKey={x.kind + x.pattern}
              action={(
                <button onClick={() => (x.kind === 'category' ? acceptNoInvoice(x) : acceptStopAsking(x))}
                  disabled={!!busy}
                  className="text-[11px] font-bold text-ink hover:underline disabled:opacity-40">
                  {x.kind === 'category' ? 'Make it a rule' : 'Stop asking'}
                </button>
              )} />
          ))}
          {noInvSug.length > 60 && (
            <p className="py-2 text-[11px] text-ink-muted">Showing the 60 most-repeated of {noInvSug.length}. Accept some and the rest move up.</p>
          )}
        </div>
      )}

      {/* Whole categories where no vendor has ever invoiced — the same answer
          at category scope, reaching vendors too small to earn their own row. */}
      {candidates.length > 0 && (
        <div className="mb-2">
          <SectionHead title="Whole categories that never do"
            sub="no vendor in these has ever sent an invoice. Marking one stops its rows counting as unfinished — nothing in the ledger changes." />
          <div className="flex flex-wrap gap-1.5 py-2.5">
            {candidates.map((c) => (
              <button key={c.category} onClick={() => markNoInvoice(c)} disabled={!!busy}
                title={`${c.n} booked rows across ${c.vendors} vendor${c.vendors === 1 ? '' : 's'}, none of which has ever invoiced`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-rule bg-card hover:border-brand-400 text-[12px] disabled:opacity-40">
                <span className="text-ink-muted">{c.category}</span>
                <span className="tabular-nums text-[11px] text-ink-faint">{c.n}</span>
                <span className="tabular-nums text-[11px] text-ink-faint">{money(c.value)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vendors holding the needs-invoice pile — one-off "never invoices"
          answers, quantified before they apply. */}
      {(completion?.vendors?.length || 0) > 0 && (
        <div className="mb-2">
          <SectionHead title="Vendors holding the needs-invoice pile" sub="mark one as never invoicing — the confirm says exactly what leaves the queue." />
          <div className="flex flex-wrap gap-1.5 py-2.5">
            {completion.vendors.slice(0, 8).map((v) => (
              <button key={v.key} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-rule bg-card hover:border-brand-400 text-[12px] disabled:opacity-40"
                title={`${v.n} row${v.n === 1 ? '' : 's'} · ${money(v.value)} — mark "never invoices"`}
                onClick={() => markVendorNoInvoice(v)}>
                <span className="text-ink-muted">{v.sample || v.key}</span>
                <span className="tabular-nums text-[11px] text-ink-faint">{money(v.value)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Not spending, and who it was for — neither writes a booking. */}
      {otherSug.length > 0 && (
        <div className="mb-2">
          <SectionHead title="Not spending, and who it was for"
            sub="transfers and fees to keep out of the P&L, and standing artist attribution. Neither touches matching." />
          {otherSug.map((x) => (
            <Row key={x.kind + x.pattern}
              tag={x.kind === 'dismiss' ? 'SET ASIDE' : 'ARTIST'}
              tone={x.kind === 'dismiss' ? 'text-ink-muted' : 'text-info'}
              pattern={x.pattern}
              value={x.kind === 'artist' ? x.value : null}
              meta={`${x.times}×${x.total_usd ? ` · ${money(x.total_usd)}` : ''}`}
              warn={x.also_matches_count > 0 ? {
                label: `also catches ${x.also_matches_count} other vendor${x.also_matches_count === 1 ? '' : 's'}`,
                title: x.also_matches.join(', '),
              } : null}
              busyKey={x.kind + x.pattern}
              action={(
                <button onClick={() => acceptOther(x)} disabled={!!busy}
                  className="text-[11px] font-bold text-ink hover:underline disabled:opacity-40">
                  Make it a rule
                </button>
              )} />
          ))}
        </div>
      )}

      {/* In force — all four kinds in one list, each saying what it is DOING.
          A BOOK rule with no no-invoice partner books rows into the
          needs-invoice queue on every upload; a leaking rule must not look
          identical to a working one. */}
      <div className="mb-2">
        <SectionHead title={`In force — ${totalRules}`}
          sub={`applied to every statement automatically${leaking.length ? ` · ${leaking.length} ${leaking.length === 1 ? 'is' : 'are'} booking ${leakRows} row${leakRows === 1 ? '' : 's'} into the needs-invoice queue` : ''}`} />
        {totalRules === 0 && (
          <p className="py-5 text-center text-sm text-ink-muted">No rules yet. Accept one above and it starts applying to the next statement you upload.</p>
        )}
        {catRules.map((r) => (
          <Row key={`c${r.id}`} tag="BOOK" tone="text-ink-muted" pattern={r.pattern} value={r.category}
            meta={`${r.created_by || ''}${r.created_at ? ` · ${formatDate(r.created_at)}` : ''}`}
            warn={r.queue_rows > 0 ? {
              label: `feeding the queue: ${r.queue_rows} row${r.queue_rows === 1 ? '' : 's'} · ${money(r.queue_usd)}`,
              title: 'This rule books rows with no invoice behind them, and nothing records that no invoice is coming — so every one lands in the needs-invoice queue.',
            } : null}
            busyKey={busy === `pair${r.id}` ? `pair${r.id}` : `category-rules${r.id}`}
            action={(
              <span className="flex items-center gap-3">
                {r.queue_rows > 0 && (
                  <button onClick={() => pairRule(r)} disabled={!!busy}
                    title="Record that these vendors never send an invoice, so the rule stops feeding the queue"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-ink hover:underline disabled:opacity-40">
                    <FileX size={11} /> never invoice
                  </button>
                )}
                <button onClick={() => remove('category-rules', r.id, `the rule booking "${r.pattern}" as ${r.category}`)}
                  className="text-[11px] font-semibold text-ink-muted hover:text-danger">Remove</button>
              </span>
            )} />
        ))}
        {dismissRules.map((r) => (
          <Row key={`d${r.id}`} tag="SET ASIDE" tone="text-ink-muted" pattern={r.pattern}
            meta={`${r.created_by || ''}${r.created_at ? ` · ${formatDate(r.created_at)}` : ''}`}
            busyKey={`dismiss-rules${r.id}`}
            action={(
              <button onClick={() => remove('dismiss-rules', r.id, `the rule setting aside "${r.pattern}"`)}
                className="text-[11px] font-semibold text-ink-muted hover:text-danger">Remove</button>
            )} />
        ))}
        {artistRules.map((r) => (
          <Row key={`a${r.id}`} tag="ARTIST" tone="text-info" pattern={r.pattern}
            value={r.is_overhead ? 'overhead — no artist' : r.artist}
            meta={`${r.created_by || ''}${r.created_at ? ` · ${formatDate(r.created_at)}` : ''}`}
            busyKey={`artist-rules${r.id}`}
            action={(
              <button onClick={() => remove('artist-rules', r.id, `the artist rule for "${r.pattern}"`)}
                className="text-[11px] font-semibold text-ink-muted hover:text-danger">Remove</button>
            )} />
        ))}
        {noInvRules.map((r) => (
          <Row key={`n${r.id}`} tag="NO INVOICE" tone="text-ink-muted" pattern={r.pattern}
            note={`${r.scope} scope · never has an invoice`}
            meta={`${r.created_by || ''}${r.created_at ? ` · ${formatDate(r.created_at)}` : ''}`}
            busyKey={`no-invoice-rules${r.id}`}
            action={(
              <button onClick={() => remove('no-invoice-rules', r.id, `"${r.pattern}" as never having an invoice`)}
                className="text-[11px] font-semibold text-ink-muted hover:text-danger">Remove</button>
            )} />
        ))}
      </div>

      {/* Manual artist rule — future statements only. Historical attribution
          is by reviewed entry ids, never a pattern sweep ("TONE" is inside
          "Tone Pay, Inc"). */}
      <div className="flex flex-wrap gap-2 mt-3">
        <input className="input !py-1 text-xs flex-1 min-w-[120px]" placeholder="Descriptor pattern…" value={form.pattern} onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))} />
        <input className="input !py-1 text-xs flex-1 min-w-[100px]" placeholder="Artist" disabled={form.is_overhead} value={form.artist} onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))} />
        <label className="text-xs text-ink-muted inline-flex items-center gap-1"><input type="checkbox" checked={form.is_overhead} onChange={(e) => setForm((f) => ({ ...f, is_overhead: e.target.checked }))} /> overhead</label>
        <button className="btn-secondary !py-1 text-xs" onClick={addArtist} disabled={!form.pattern.trim()}>Add artist rule</button>
      </div>

      {suggestions === null && !error && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-ink-muted">
          <Loader size={13} className="animate-spin" /> Looking for decisions you've made repeatedly…
        </div>
      )}
    </Panel>
  )
}

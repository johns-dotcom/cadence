// Bank Matching — the reconciliation work surface. The statements page holds
// the FILES; every open bank line gets answered here, in one of three honest
// ways: it's this invoice (match), there is no invoice for it (book), or it
// isn't really spending (dismiss).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Ban, Check, ChevronDown, ChevronRight, DollarSign, GitMerge, Landmark,
  Link2, RotateCcw, Search, Sparkles, Undo2, X,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { MatchModal, STATUS_CHIP, STATUS_LABEL } from './BankStatements'
import StatementReviewDeck from '../components/statements/StatementReviewDeck'
import StatementFlagsCard from '../components/statements/StatementFlagsCard'
import { money } from '../utils/money'
import { INCOME_TYPES } from '../constants'

const fmt = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const CHIPS = [
  ['all', 'All'], ['open', 'Open'], ['likely', 'Likely'], ['needs-invoice', 'Needs invoice'],
  ['toconfirm', 'To confirm'], ['matched', 'Matched'], ['booked', 'Booked'],
  ['open-credit', 'Money in'], ['dismissed', 'Dismissed'],
]

function Panel({ title, sub, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card mt-4">
      <button className="w-full flex items-center gap-2 px-5 py-3 text-left" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
        <span className="text-sm font-bold text-ink">{title}</span>
        {count != null && <span className="text-[11px] font-semibold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{count}</span>}
        {sub && <span className="text-xs text-gray-400 ml-2 truncate">{sub}</span>}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  )
}

export default function BankMatching() {
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const stmt = params.get('statement') || 'all'
  const [queue, setQueue] = useState(null)
  const [completion, setCompletion] = useState(null)
  const [months, setMonths] = useState([])
  const [chip, setChip] = useState(params.get('filter') || 'open')
  const [q, setQ] = useState(params.get('q') || '')
  const [sel, setSel] = useState(new Set())
  const [matchTxn, setMatchTxn] = useState(null)
  const [deckOpen, setDeckOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [flagsKey, setFlagsKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [qr, cr, mr] = await Promise.all([
        api.get('/bank-matching/queue', { params: { statement: stmt } }),
        api.get('/bank-matching/completion', { params: stmt !== 'all' ? { statement_id: stmt } : {} }),
        api.get('/bank-statements/months'),
      ])
      setQueue(qr.data.data); setCompletion(cr.data.data); setMonths(mr.data.data || [])
    } catch (err) { toast(err.response?.data?.error || 'Failed to load', 'error') }
    finally { setLoading(false) }
  }, [stmt, toast])
  useEffect(() => { load() }, [load])
  const refresh = () => { load(); setFlagsKey((k) => k + 1); setSel(new Set()) }

  const rows = queue?.rows || []
  const counts = useMemo(() => {
    const c = { all: 0, open: 0, likely: 0, 'needs-invoice': 0, toconfirm: 0, matched: 0, booked: 0, 'open-credit': 0, dismissed: 0 }
    const needSet = new Set(completion?.needs_invoice_txn_ids || [])
    for (const t of rows) {
      if (t.direction === 'debit' && !t.dismissed) c.all += 1
      c[t.disposition] = (c[t.disposition] || 0) + 1
      if (t.likely) c.likely += 1
      if (needSet.has(t.id)) c['needs-invoice'] += 1
    }
    return c
  }, [rows, completion])

  const shown = useMemo(() => {
    const needSet = new Set(completion?.needs_invoice_txn_ids || [])
    let list = rows
    if (chip === 'all') list = list.filter((t) => t.direction === 'debit' && !t.dismissed)
    else if (chip === 'likely') list = list.filter((t) => t.likely)
    else if (chip === 'needs-invoice') list = list.filter((t) => needSet.has(t.id))
    else list = list.filter((t) => t.disposition === chip)
    if (q.trim()) {
      const s = q.toLowerCase()
      list = list.filter((t) => [t.payee_guess, t.description, t.exp_payee, t.exp_category, t.reference].some((v) => String(v || '').toLowerCase().includes(s)))
    }
    return list.slice(0, 400)
  }, [rows, chip, q, completion])

  const act = async (txnId, path, body) => {
    try { await api.post(`/bank-statements/txns/${txnId}/${path}`, body || {}); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const acceptLikely = async () => {
    const ids = rows.filter((t) => t.likely).map((t) => t.id)
    if (!ids.length) return
    try {
      const { data: r } = await api.post('/bank-statements/txns/bulk', { ids, action: 'accept-suggestions' })
      toast(`${r.data.affected} matched`)
      refresh()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const bulkNoInvoice = async () => {
    try {
      const { data: r } = await api.post('/bank-matching/no-invoice/bulk', { txn_ids: [...sel] })
      toast(`${r.data.done} marked "no invoice coming"`)
      refresh()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const bulkUnmatch = async () => {
    try {
      const { data: r } = await api.post('/bank-matching/unmatch/bulk', { txn_ids: [...sel] })
      toast(`${r.data.done.length} unmatched${r.data.skipped.length ? ` · ${r.data.skipped.length} skipped` : ''}`)
      refresh()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const reconcileMonth = async (mk, undo) => {
    try { await api.post(`/bank-statements/months/${mk}/reconcile`, { undo }); refresh() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const openItems = useMemo(() => rows.filter((t) => t.disposition === 'open' || t.disposition === 'open-credit'), [rows])
  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })

  if (loading && !queue) return <div><div className="card p-2"><Skeleton.Table rows={10} cols={6} /></div></div>

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight flex items-center gap-2"><GitMerge size={20} /> Bank Matching</h1>
          <p className="text-sm text-gray-400">Every open bank line has three honest answers: match it, book it, or dismiss it.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input !py-1.5 !w-auto text-sm" value={stmt}
            onChange={(e) => { setParams((p) => { p.set('statement', e.target.value); return p }, { replace: true }) }}>
            <option value="all">All statements</option>
            {(queue?.statements || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.period_start ? `${String(s.period_start).slice(0, 7)} · ` : ''}{s.account}
                {completion?.by_statement?.[s.id] ? ` — ${completion.by_statement[s.id].left} open` : ''}
              </option>
            ))}
          </select>
          {openItems.length > 0 && (
            <button onClick={() => setDeckOpen(true)} className="btn-primary !py-1.5 text-xs inline-flex items-center gap-1.5">
              <Sparkles size={13} /> Review deck ({openItems.length})
            </button>
          )}
        </div>
      </div>

      {/* Months strip — the soft close */}
      {months.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {months.slice(0, 14).map((m) => (
            <div key={m.month_key} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs ${m.reconciled_at ? (m.open_debits > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50') : 'border-rule bg-card'}`}>
              <span className="font-bold text-ink">{m.month_key}</span>
              <span className="text-gray-500 ml-1.5">{m.coverage}% · {m.open_debits} open</span>
              {m.reconciled_at ? (
                <button className="ml-2 text-gray-400 underline" title={`Reconciled by ${m.reconciled_by}. Undo?`} onClick={() => reconcileMonth(m.month_key, true)}>reopen</button>
              ) : (
                m.open_debits === 0 && <button className="ml-2 text-emerald-600 underline" onClick={() => reconcileMonth(m.month_key, false)}>reconcile</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Completion — matched ≠ booked ≠ open, and both percentages labelled. */}
      {completion && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Explained</p><p className="text-xl font-bold text-ink">{completion.explained_pct}%</p><p className="text-[10px] text-gray-400">every bank line accounted for at all</p></div>
          <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Invoice-backed</p><p className="text-xl font-bold text-ink">{completion.invoice_backed_pct}%</p><p className="text-[10px] text-gray-400">has a document behind it — a different claim</p></div>
          <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Matched</p><p className="text-xl font-bold text-emerald-600">{money(completion.matched.value)}</p><p className="text-[10px] text-gray-400">{completion.matched.n} lines</p></div>
          <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Booked, invoice due</p><p className="text-xl font-bold text-amber-600">{money(completion.booked_not_expected.value)}</p><p className="text-[10px] text-gray-400">{completion.booked_not_expected.n} lines want a document</p></div>
          <div className="card p-3"><p className="text-[10px] font-semibold uppercase text-gray-400">Open</p><p className="text-xl font-bold text-rose-600">{money(completion.open.value)}</p><p className="text-[10px] text-gray-400">{completion.open.n} unanswered</p></div>
        </div>
      )}

      {/* Chips + search + likely accept */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {CHIPS.map(([k, l]) => (
          <button key={k} onClick={() => setChip(k)} className={`text-xs font-medium px-3 py-1.5 rounded-full ${chip === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {l} <span className="opacity-70">{counts[k] || 0}</span>
          </button>
        ))}
        {counts.likely > 0 && (
          <button onClick={acceptLikely} className="btn-secondary !py-1.5 text-xs inline-flex items-center gap-1"><Sparkles size={12} /> Accept {counts.likely} likely</button>
        )}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !pl-8 !py-1.5 text-sm w-48" />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="sticky top-2 z-30 card shadow-modal px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 bg-brand-500/10 border-brand-200">
          <span className="text-sm font-medium text-ink">{sel.size} selected</span>
          <button onClick={bulkNoInvoice} className="btn-secondary !py-1.5 text-xs" title="Booked rows only — the money stays counted; the row stops asking for a document">No invoice coming</button>
          <button onClick={bulkUnmatch} className="btn-secondary !py-1.5 text-xs">Unmatch</button>
          <button onClick={() => setSel(new Set())} className="text-gray-400 hover:text-ink ml-1"><X size={16} /></button>
        </div>
      )}

      {/* The queue */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <th className="px-3 py-2.5 w-8"></th>
            {['Date', 'Account', 'Payee', 'Answer', 'Amount', 'Status', ''].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-gray-400">Nothing in this view.</td></tr>}
            {shown.map((t) => (
              <tr key={t.id} className="align-top hover:bg-gray-50">
                <td className="px-3 py-2.5"><input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} /></td>
                <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(t.txn_date)}</td>
                <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">{t.account}</td>
                <td className="px-3 py-2.5 min-w-[200px]">
                  <p className="font-medium text-ink truncate max-w-[280px]">{t.exp_payee || t.payee_guess || t.description || '—'}</p>
                  {t.payee_email && <p className="text-[11px] font-mono text-gray-400">{t.payee_email}</p>}
                </td>
                <td className="px-3 py-2.5 min-w-[190px]">
                  {t.disposition === 'open' && t.suggestions?.[0] ? (
                    <button
                      className={`text-left text-xs rounded-lg border px-2 py-1 w-full ${t.likely ? 'border-emerald-300 bg-emerald-50/60' : 'border-rule hover:border-brand-400'}`}
                      onClick={() => act(t.id, 'match', { expense_id: t.suggestions[0].expense_id })}
                      title="Accept this match"
                    >
                      <span className="text-ink">{t.suggestions[0].payee}</span>
                      <span className="text-gray-400"> · {fmt(t.suggestions[0].amount, t.suggestions[0].currency)} · {Math.round(t.suggestions[0].score * 100)}%</span>
                    </button>
                  ) : t.disposition === 'open' ? (
                    <span className="text-xs text-gray-400">{t.suggested_category ? `suggest: ${t.suggested_category}` : '—'}</span>
                  ) : t.disposition === 'open-credit' ? (
                    <select className="input !py-1 !px-1.5 text-xs max-w-[170px]" value=""
                      onChange={(e) => e.target.value && act(t.id, 'book-income', { income_type: e.target.value })}>
                      <option value="">{t.suggested_income_type ? `Book as ${t.suggested_income_type}?` : 'Book as income…'}</option>
                      {t.suggested_income_type && <option value={t.suggested_income_type}>★ {t.suggested_income_type}</option>}
                      {INCOME_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-gray-500 truncate block max-w-[190px]">{t.exp_category || t.income_type || '—'}{t.no_invoice ? ' · no invoice expected' : ''}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums whitespace-nowrap font-medium text-ink">
                  {t.direction === 'credit' ? <span className="text-violet-600">+{fmt(t.amount, t.currency)}</span> : fmt(t.amount, t.currency)}
                </td>
                <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_CHIP[t.disposition] || 'bg-gray-100 text-gray-500'}`}>{STATUS_LABEL[t.disposition] || t.disposition}</span></td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5 justify-end whitespace-nowrap text-gray-400">
                    {t.disposition === 'open' && <>
                      <button onClick={() => setMatchTxn(t)} title="Match…" className="hover:text-brand-600 p-1"><Link2 size={15} /></button>
                      <button onClick={() => act(t.id, 'dismiss', {})} title="Dismiss" className="hover:text-danger p-1"><Ban size={15} /></button>
                    </>}
                    {t.disposition === 'toconfirm' && <button onClick={() => act(t.id, 'mark-paid', {})} title="Mark paid" className="hover:text-emerald-600 p-1"><DollarSign size={15} /></button>}
                    {(t.disposition === 'toconfirm' || t.disposition === 'matched') && <button onClick={() => act(t.id, 'unmatch', {})} title="Unmatch (records the no)" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'booked' && <button onClick={() => act(t.id, 'unbook', {})} title="Unbook" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'booked-income' && <button onClick={() => act(t.id, 'unbook-income', {})} title="Unbook income" className="hover:text-danger p-1"><Undo2 size={15} /></button>}
                    {t.disposition === 'dismissed' && <button onClick={() => act(t.id, 'restore', {})} title="Restore" className="hover:text-brand-600 p-1"><RotateCcw size={15} /></button>}
                    {t.matched_expense_id && <Link to={`/ledger?focus=${t.matched_expense_id}`} title="Open in ledger" className="hover:text-brand-600 p-1 text-[10px] font-bold">L</Link>}
                    <Link to={`/bank-statements/${t.statement_id}`} title="Open the statement" className="hover:text-brand-600 p-1"><Landmark size={13} /></Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {queue?.suggestions_capped && <p className="text-[11px] text-gray-400 mt-1">Suggestion scoring capped at 200 open rows this load — narrow to one statement for full coverage.</p>}

      <UnmatchedLedgerPanel toast={toast} />
      <RematchPanel toast={toast} onChanged={refresh} />
      <FundingPairsPanel toast={toast} onChanged={refresh} />
      <DuplicatePairsPanel toast={toast} onChanged={refresh} />
      <AutoDecisionsPanel toast={toast} onChanged={refresh} />
      <RulesPanel toast={toast} completion={completion} onChanged={refresh} />
      <StatementFlagsCard key={flagsKey} toast={toast} onChanged={load} />

      {matchTxn && <MatchModal txn={matchTxn} onClose={() => setMatchTxn(null)} onDone={() => { setMatchTxn(null); refresh() }} toast={toast} />}
      {deckOpen && <StatementReviewDeck open items={openItems} onClose={() => setDeckOpen(false)} onChanged={refresh} toast={toast} />}
    </div>
  )
}

// ── Direction 2 — paid ledger rows the bank never shows ─────────────────────
function UnmatchedLedgerPanel({ toast }) {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { api.get('/bank-matching/unmatched-ledger').then((r) => setData(r.data.data)).catch(() => setData(null)) }, [])
  if (!data) return null
  const SECTIONS = [
    ['needs_match', 'Needs a match', 'A statement covers the payment date and the money is not on it. This is the real work.', 'text-rose-600'],
    ['awaiting_statement', 'Statement not in yet', 'Paid after the newest statement we hold. Nothing is wrong.', 'text-gray-500'],
    ['missing_statement', 'Statement missing', 'Inside the span we hold, and no statement covers it — a month somebody never uploaded.', 'text-amber-600'],
  ]
  const flt = (rows) => filter.trim()
    ? rows.filter((r) => [r.payee, r.artist, r.song, r.invoice_number, r.category].some((v) => String(v || '').toLowerCase().includes(filter.toLowerCase())))
    : rows
  return (
    <Panel title="Paid on the ledger, not on any statement" count={data.needs_match.n + data.awaiting_statement.n + data.missing_statement.n}
      sub={`the other direction — no dismiss here by design: a paid row's only exits are a match or a correction`}>
      <input className="input !py-1.5 text-sm max-w-xs mb-3" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {SECTIONS.map(([key, title, sub, tone]) => (
        <div key={key} className="mb-4">
          <p className={`text-xs font-bold uppercase tracking-wide ${tone}`}>{title} — {data[key].n} · {money(data[key].value)}</p>
          <p className="text-[11px] text-gray-400 mb-1.5">{sub}</p>
          <div className="divide-y divide-divider">
            {flt(data[key].rows).slice(0, 50).map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{formatDate(r.payment_date)}</span>
                <Link to={`/ledger?focus=${r.id}`} className="flex-1 truncate text-ink hover:text-brand-600">{r.payee}</Link>
                <span className="text-[11px] text-gray-400 truncate max-w-[160px]">{[r.artist, r.category].filter(Boolean).join(' · ')}</span>
                <span className="tabular-nums text-gray-600">{money(r.usd)}</span>
              </div>
            ))}
            {!data[key].n && <p className="text-xs text-gray-400 py-1.5">None. 🎉</p>}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-gray-400">Coverage: {data.coverage.map((c) => `${c.account} through ${c.latest ? formatDate(c.latest) : '—'} (${c.statements})`).join(' · ')}</p>
    </Panel>
  )
}

// ── Booked rows whose real invoice showed up ─────────────────────────────────
function RematchPanel({ toast, onChanged }) {
  const [data, setData] = useState(null)
  const load = () => api.get('/bank-matching/rematch-candidates').then((r) => setData(r.data.data)).catch(() => setData({ pairs: [] }))
  useEffect(() => { load() }, [])
  if (!data?.pairs?.length) return null
  const accept = async (p) => {
    try { await api.post(`/bank-matching/tx/${p.txn.id}/rematch`, { expense_id: p.invoice.id }); toast('Rematched — the invented entry is retired'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <Panel title="Booked rows whose real invoice arrived" count={data.pairs.length} sub="swap the invented entry for the document" defaultOpen>
      <div className="divide-y divide-divider">
        {data.pairs.map((p) => (
          <div key={p.txn.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="text-xs text-gray-400 tabular-nums">{formatDate(p.txn.txn_date)}</span>
            <span className="flex-1 min-w-[200px] truncate">
              <span className="text-gray-400">booked</span> <span className="text-ink">{p.txn.booked_payee || p.txn.payee_guess}</span>
              <span className="text-gray-400"> → invoice</span> <span className="text-ink">{p.invoice.payee}{p.invoice.invoice_number ? ` #${p.invoice.invoice_number}` : ''}</span>
            </span>
            <span className="tabular-nums text-gray-600">{fmt(p.txn.amount, p.txn.currency)}</span>
            <span className="text-[11px] text-gray-400">{Math.round(p.score * 100)}%</span>
            <button className="btn-secondary !py-1 text-xs" onClick={() => accept(p)}><Check size={12} /> Rematch</button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── PayPal funding pairs ─────────────────────────────────────────────────────
function FundingPairsPanel({ toast, onChanged }) {
  const [data, setData] = useState(null)
  const load = () => api.get('/bank-matching/funding-pairs/cross-currency').then((r) => setData(r.data.data)).catch(() => setData(null))
  useEffect(() => { load() }, [])
  if (!data || (!data.pairs?.length && !data.ambiguous?.length)) return null
  const pair = async (p) => {
    try { await api.post(`/bank-matching/tx/${p.pp.id}/funding-pair`, { bank_txn_id: p.bank.id }); toast('Paired — the bank pull leg is set aside'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <Panel title="PayPal funding pulls" count={data.pairs.length} sub="one payment on two statements — pair them or the spend counts twice" defaultOpen>
      <div className="divide-y divide-divider">
        {data.pairs.map((p) => (
          <div key={`${p.pp.id}-${p.bank.id}`} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="text-xs text-gray-400 tabular-nums">{formatDate(p.pp.txn_date)}</span>
            <span className="flex-1 min-w-[200px] truncate text-ink">{p.pp.payee_guess || p.pp.description}</span>
            <span className="tabular-nums text-gray-600">{fmt(p.pp.amount, p.pp.currency)} ↔ {fmt(p.bank.amount, p.bank.currency)}</span>
            <span className="text-[11px] text-gray-400">{p.tier === 'fx' ? 'cross-currency' : `Δ ${p.delta}`}</span>
            <button className="btn-secondary !py-1 text-xs" onClick={() => pair(p)}><GitMerge size={12} /> Pair</button>
          </div>
        ))}
        {data.ambiguous?.map((a) => (
          <div key={`amb-${a.pp.id}`} className="py-2 text-xs text-amber-600">
            {formatDate(a.pp.txn_date)} · {a.pp.payee_guess || a.pp.description} — {a.candidates.length} equally-plausible pulls; resolve by hand on the statements.
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── One payment, two ledger rows ─────────────────────────────────────────────
function DuplicatePairsPanel({ toast, onChanged }) {
  const [data, setData] = useState(null)
  const load = () => api.get('/bank-matching/duplicate-pairs').then((r) => setData(r.data.data)).catch(() => setData(null))
  useEffect(() => { load() }, [])
  if (!data?.pairs?.length) return null
  const merge = async (p) => {
    if (!window.confirm(`Merge? The hand-logged row keeps its documents; the twin (#${p.twin_id}) is archived and its bank match moves over.`)) return
    try { await api.post('/bank-matching/duplicate-pairs/merge', { orphan_id: p.orphan_id, twin_id: p.twin_id }); toast('Merged'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const reject = async (p) => {
    try { await api.post('/bank-matching/duplicate-pairs/reject', { orphan_id: p.orphan_id }); toast('Kept apart — won\'t be offered again'); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  return (
    <Panel title="One payment, two ledger rows" count={data.pairs.length} sub="a hand-logged copy beside the bank-matched one">
      <div className="divide-y divide-divider">
        {data.pairs.map((p) => (
          <div key={p.orphan_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="flex-1 min-w-[200px] truncate text-ink">{p.payee}</span>
            <span className="tabular-nums text-gray-600">{fmt(p.amount, p.currency)}</span>
            <span className="text-[11px] text-gray-400">#{p.orphan_id} (no bank line) vs #{p.twin_id} (matched)</span>
            <button className="btn-secondary !py-1 text-xs" onClick={() => merge(p)}>Merge</button>
            <button className="text-xs text-gray-400 underline" onClick={() => reject(p)}>Not duplicates</button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── What the matcher did unasked ─────────────────────────────────────────────
function AutoDecisionsPanel({ toast, onChanged }) {
  const [data, setData] = useState(null)
  useEffect(() => { api.get('/bank-matching/auto-decisions', { params: { days: 30 } }).then((r) => setData(r.data.data)).catch(() => setData(null)) }, [])
  if (!data?.total) return null
  return (
    <Panel title="Auto-decisions (last 30 days)" count={data.total} sub={data.shown < data.total ? `showing ${data.shown} of ${data.total}` : 'every automatic match, so nothing happens silently'}>
      <div className="divide-y divide-divider">
        {data.rows.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
            <span className="text-xs text-gray-400 tabular-nums">{formatDate(t.txn_date)}</span>
            <span className="flex-1 min-w-[180px] truncate text-ink">{t.payee_guess || '—'} → {t.exp_payee}{t.invoice_number ? ` #${t.invoice_number}` : ''}</span>
            <span className="tabular-nums text-gray-600">{fmt(t.amount, t.currency)}</span>
            <span className="text-[11px] text-gray-400">{t.match_method?.replace('auto-', '')} {t.match_score != null ? `${Math.round(t.match_score * 100)}%` : ''}</span>
            <button className="text-xs text-gray-400 underline" onClick={async () => {
              try { await api.post(`/bank-statements/txns/${t.id}/unmatch`, {}); toast('Unmatched'); onChanged() }
              catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
            }}>Unmatch</button>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Standing rules ───────────────────────────────────────────────────────────
function RulesPanel({ toast, completion, onChanged }) {
  const [artistRules, setArtistRules] = useState([])
  const [noInvRules, setNoInvRules] = useState([])
  const [form, setForm] = useState({ pattern: '', artist: '', is_overhead: false, retro: true })
  const load = () => {
    api.get('/bank-matching/artist-rules').then((r) => setArtistRules(r.data.data || [])).catch(() => {})
    api.get('/bank-matching/no-invoice-rules').then((r) => setNoInvRules(r.data.data || [])).catch(() => {})
  }
  useEffect(() => { load() }, [])
  const addArtist = async () => {
    try {
      const { data: r } = await api.post('/bank-matching/artist-rules', form)
      toast(form.retro && r.data.updated ? `Rule saved · ${r.data.updated} past rows attributed` : 'Rule saved')
      setForm({ pattern: '', artist: '', is_overhead: false, retro: true }); load(); onChanged()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const addNoInv = async (scope, pattern) => {
    try { await api.post('/bank-matching/no-invoice-rules', { scope, pattern }); toast('Rule saved — those rows stop asking for a document'); load(); onChanged() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const del = async (kind, id) => {
    try { await api.delete(`/bank-matching/${kind}/${id}`); load(); onChanged() }
    catch { toast('Failed', 'error') }
  }
  return (
    <Panel title="Standing rules" count={artistRules.length + noInvRules.length} sub="artist attribution, and spend that never comes with an invoice">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Artist attribution (descriptor contains → artist)</p>
          {artistRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1">
              <span className="text-gray-600 truncate">"{r.pattern}" → <span className="font-medium text-ink">{r.is_overhead ? 'overhead (no artist)' : r.artist}</span></span>
              <button onClick={() => del('artist-rules', r.id)} className="text-gray-300 hover:text-danger"><X size={14} /></button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 mt-2">
            <input className="input !py-1 text-xs flex-1 min-w-[120px]" placeholder="Descriptor pattern…" value={form.pattern} onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))} />
            <input className="input !py-1 text-xs flex-1 min-w-[100px]" placeholder="Artist" disabled={form.is_overhead} value={form.artist} onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))} />
            <label className="text-xs text-gray-500 inline-flex items-center gap-1"><input type="checkbox" checked={form.is_overhead} onChange={(e) => setForm((f) => ({ ...f, is_overhead: e.target.checked }))} /> overhead</label>
            <button className="btn-secondary !py-1 text-xs" onClick={addArtist} disabled={!form.pattern.trim()}>Add</button>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">No invoice is ever coming (equality, never substring)</p>
          {noInvRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1">
              <span className="text-gray-600 truncate">{r.scope}: "{r.pattern}"</span>
              <button onClick={() => del('no-invoice-rules', r.id)} className="text-gray-300 hover:text-danger"><X size={14} /></button>
            </div>
          ))}
          {completion?.category_candidates?.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] text-gray-400 mb-1">Whole categories still asking for documents — say so once:</p>
              <div className="flex flex-wrap gap-1.5">
                {completion.category_candidates.map((c) => (
                  <button key={c.category} className="text-xs bg-gray-100 hover:bg-gray-200 rounded-full px-2.5 py-1" onClick={() => addNoInv('category', c.category)}>
                    {c.category} ({c.n})
                  </button>
                ))}
              </div>
            </div>
          )}
          {completion?.vendors?.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] text-gray-400 mb-1">Vendors holding the needs-invoice pile:</p>
              <div className="flex flex-wrap gap-1.5">
                {completion.vendors.slice(0, 8).map((v) => (
                  <button key={v.key} className="text-xs bg-gray-100 hover:bg-gray-200 rounded-full px-2.5 py-1" title={`${v.n} rows · ${money(v.value)} — mark "never invoices"`}
                    onClick={() => addNoInv('vendor', v.sample || v.key)}>
                    {v.sample || v.key} · {money(v.value)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  )
}

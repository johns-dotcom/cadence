import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronRight, ChevronDown, ExternalLink, Star, Flag,
  Layers, Search, X, ShieldQuestion, ShieldCheck, Upload, EyeOff, Eye,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { money, moneyByCurrency } from '../utils/money'
import { statementLabel, statementWindowLabel } from '../utils/statements'
import { STATE_LABEL } from '../utils/recoupState'
import useCollapsed from '../hooks/useCollapsed'
import useFocusRefetch from '../hooks/useFocusRefetch'
import { ConfirmDialog } from '../components/ui'

const PRIORITIES = ['high', 'medium', 'low']
const PRIORITY_TONE = {
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-elev text-ink-muted',
}
const SORTS = [
  ['unverified', 'Most unverified'],
  ['provable', 'Most provable, unclaimed'],
  ['pending', 'Most pending upload'],
  ['total', 'Biggest total'],
]

// Recoupments index. Every figure on this page is stated on a BANK basis: the
// headline counts spend the bank shows plus spend paid before its statement
// arrived, and calls out separately the spend a statement should show and
// doesn't. See server/lib/recoupments.js for the four states.
export default function Recoupments() {
  const { toast } = useToast()
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [tab, setTab] = useState('artists')
  const [prioTab, setPrioTab] = useState('all')
  const [statements, setStatements] = useState([])
  const [priorYear, setPriorYear] = useState([])
  const [review, setReview] = useState([])

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('unverified')
  const [filterReady, setFilterReady] = useState('')
  const [showDismissed, setShowDismissed] = useState(false)
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimTarget, setClaimTarget] = useState(null)   // { name, ids, usd } | null
  const [claimBusy, setClaimBusy] = useState(false)
  const [indexNote, setIndexNote] = useState('')

  const { isCollapsed, toggleCollapsed } = useCollapsed('recoup_index_collapsed_v1')

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    return api.get('/financials/recoupments')
      .then(r => { setRows(r.data.data || []); setMeta(r.data.meta || null); setError(false) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])
  // Multi-admin drift: someone else's claim must not stay invisible here.
  useFocusRefetch(() => { load(true); if (tab === 'review') loadReview() })

  useEffect(() => {
    api.get('/financials/recoupments/notes', { params: { artist: '__recoupments_index__' } })
      .then(r => setIndexNote(r.data.data?.artistNote || '')).catch(() => {})
  }, [])
  useEffect(() => { if (tab === 'statements') api.get('/financials/statements').then(r => setStatements(r.data.data || [])).catch(() => {}) }, [tab])
  useEffect(() => { if (tab === 'prioryear') api.get('/financials/recoupments-prior-year').then(r => setPriorYear(r.data.data || [])).catch(() => {}) }, [tab])
  const loadReview = useCallback(() => api.get('/financials/recoupments/review').then(r => setReview(r.data.data || [])).catch(() => {}), [])
  useEffect(() => { if (tab === 'review') loadReview() }, [tab, loadReview])

  const exportAll = async () => {
    try {
      const { data: blob } = await api.get('/financials/recoupments/export', { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'recoupments.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  const saveIndexNote = async (note) => {
    try { await api.post('/financials/recoupments/notes', { artist: '__recoupments_index__', note }) }
    catch { toast('Failed to save the note', 'error') }
  }

  // Optimistic meta write with an exact refetch on failure.
  const setMetaField = async (row, patch) => {
    const prev = rows
    setRows(rs => rs.map(r => r.artist_key === row.artist_key ? { ...r, ...patch } : r))
    try { await api.post('/financials/recoupments/artist-meta', { artist: row.name, ...patch }) }
    catch (err) { setRows(prev); toast(err.response?.data?.error || 'Failed to save', 'error') }
  }

  const withMoney = rows.filter(r => r.items > 0 || r.income > 0)
  const anyPriority = withMoney.some(r => r.priority)
  const priorityCounts = useMemo(() => {
    const c = { all: 0, none: 0, high: 0, medium: 0, low: 0 }
    for (const r of withMoney) {
      if (r.dismissed && !showDismissed) continue
      c.all += 1
      const p = (r.priority || '').toLowerCase()
      if (PRIORITIES.includes(p)) c[p] += 1; else c.none += 1
    }
    return c
  }, [withMoney, showDismissed])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = withMoney.filter(r => {
      if (r.dismissed && !showDismissed) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      if (filterReady === 'yes' && !r.ready_for_planning) return false
      if (filterReady === 'no' && r.ready_for_planning) return false
      const p = (r.priority || '').toLowerCase()
      if (prioTab === 'none') return !PRIORITIES.includes(p)
      if (prioTab !== 'all') return p === prioTab
      return true
    })
    const key = { unverified: 'unverified_usd', provable: 'provable_usd', pending: 'pending_usd', total: 'usd' }[sort] || 'usd'
    // Priority-banded artists stay pinned above the rest in every sort mode —
    // the tag is a decision about attention, and a sort must not bury it.
    const rank = (r) => PRIORITIES.indexOf((r.priority || '').toLowerCase())
    list = [...list].sort((a, b) => {
      const ra = rank(a) === -1 ? 9 : rank(a)
      const rb = rank(b) === -1 ? 9 : rank(b)
      if (ra !== rb) return ra - rb
      return (b[key] || 0) - (a[key] || 0)
    })
    return list
  }, [withMoney, search, sort, filterReady, prioTab, showDismissed])

  const dismissedCount = withMoney.filter(r => r.dismissed).length
  const t = meta?.totals || {}
  const provable = meta?.provable_by_artist || []
  const provableTotal = provable.reduce((s, p) => s + p.usd, 0)
  const provableIds = provable.flatMap(p => p.ids)

  const claim = async () => {
    const ids = claimTarget ? claimTarget.ids : provableIds
    if (!ids.length) return
    setClaimBusy(true)
    try {
      const { data } = await api.post('/financials/recoupments/ufr-bulk', { ids, ufr: true })
      const d = data.data || {}
      toast(`Uploaded ${d.changed}${d.already ? ` · ${d.already} already claimed` : ''}${d.skipped ? ` · ${d.skipped} skipped` : ''}`)
      setClaimTarget(null); setClaimOpen(false)
      await load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setClaimBusy(false) }
  }

  const statsOpen = !isCollapsed('stats')
  const filtersOpen = !isCollapsed('filters')

  return (
    <div>
      <PageHeader
        title="Recoupments"
        subtitle="Recoupable spend on a bank basis — open an artist for the detail"
        action={
          <div className="flex items-center gap-2">
            <button onClick={exportAll} className="btn-secondary">Export</button>
            <Link to="/recoupments/audit" className="btn-secondary" title="Five integrity checks — money that should be claimed and has not been, and money claimed that cannot be shown"><ShieldCheck size={15} /> Audit</Link>
            <Link to="/recoupments/planning" className="btn-secondary"><Layers size={15} /> Planning</Link>
          </div>
        } />

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {[['artists', 'By artist'], ['statements', 'Statements'], ['prioryear', 'Prior year'],
          ['review', `Bank review${meta?.review_pending?.count ? ` (${meta.review_pending.count})` : ''}`]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${tab === k ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-brand-500/10'}`}>{lbl}</button>
        ))}
      </div>

      {tab === 'artists' && (
        <>
          {/* Stat tiles. Collapsible, with the headline inline when folded. */}
          <div className="card mb-4">
            <button onClick={() => toggleCollapsed('stats')}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-brand-500/5 transition rounded-t-xl">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wide">
                {statsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Totals
              </span>
              {!statsOpen && <span className="text-sm font-bold text-ink tabular-nums">{money(t.counted_usd)} <span className="font-normal text-ink-faint">on a bank basis</span></span>}
            </button>
            {statsOpen && (
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-divider border-t border-divider">
                <Tile title="Recoupable · bank basis" value={money(t.counted_usd)} items={t.counted_items}
                  hint={<>
                    <span className="text-success">{t.states?.verified || 0} on a statement</span>
                    {' · '}
                    <span className="text-info" title="Paid, and no uploaded statement covers the date yet — nothing to check it against. Counted, and normal.">{t.states?.awaiting_statement || 0} awaiting</span>
                    {(t.unverified_items > 0) && <> · <span className="text-danger">{t.unverified_items} no bank line</span></>}
                  </>}
                  byCurrency={t.by_currency} />
                <Tile title="Uploaded for recoupment" value={money(t.ufr_usd)} items={t.ufr_items}
                  hint={t.ufr_unverified_items > 0
                    ? <span className="text-danger" title="Claimed to a partner with no bank line behind it">{t.ufr_unverified_items} with no bank line</span>
                    : <span className="text-ink-faint">every claim has a bank line or is awaiting one</span>} />
                <Tile title="Pending upload" value={money(t.pending_usd)} items={t.pending_items}
                  hint={t.provable_items > 0
                    ? <button onClick={() => setClaimOpen(true)} className="text-success font-semibold hover:underline">{money(t.provable_usd)} provable now →</button>
                    : <span className="text-ink-faint">nothing provable is unclaimed</span>} />
                <Tile title="Paid" value={money(t.paid_usd)} items={t.paid_items} />
                <Tile title="Unpaid" value={money(t.unpaid_usd)} items={t.unpaid_items} hint={<span className="text-ink-faint">recoupable once payment clears</span>} />
              </div>
            )}
          </div>

          {/* Claim the provable — the bank proves it and nobody claimed it. */}
          {provable.length > 0 && (
            <div className="card mb-4 border-success/30">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-success">{money(provableTotal)} provable and unclaimed</p>
                  <p className="text-[11px] text-ink-muted">{provableIds.length} item{provableIds.length === 1 ? '' : 's'} across {provable.length} artist{provable.length === 1 ? '' : 's'} — a bank statement shows every one of these payments, and none has been uploaded for recoupment.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleCollapsed('claim')} className="text-xs font-semibold text-brand-ink hover:underline">{isCollapsed('claim') ? 'Show artists' : 'Hide artists'}</button>
                  <button onClick={() => { setClaimTarget(null); setClaimOpen(true) }} className="btn-primary !py-1.5 text-xs"><Upload size={13} /> Upload all {provableIds.length}</button>
                </div>
              </div>
              {!isCollapsed('claim') && (
                <div className="border-t border-divider divide-y divide-divider">
                  {provable.map(p => (
                    <div key={p.artist_key || '-'} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <Link to={`/recoupments/artist/${encodeURIComponent(p.artist_key || '-')}`} className="font-medium text-ink hover:text-brand-ink flex-1 truncate">{p.name}</Link>
                      <span className="text-ink-muted tabular-nums">{p.count} item{p.count === 1 ? '' : 's'}</span>
                      <span className="font-semibold text-ink tabular-nums">{money(p.usd)}</span>
                      <button onClick={() => { setClaimTarget(p); setClaimOpen(true) }}
                        className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-success/10 text-success hover:bg-success/15">Upload</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Unanswered bank-born spend — off every recoupment figure until answered. */}
          {meta?.review_pending?.count > 0 && (
            <button onClick={() => setTab('review')} className="card w-full text-left mb-4 px-4 py-3 hover:bg-brand-500/5 transition">
              <p className="text-sm font-bold text-warning inline-flex items-center gap-2"><ShieldQuestion size={15} /> {meta.review_pending.count} statement-born cost{meta.review_pending.count === 1 ? '' : 's'} · {money(meta.review_pending.usd)} waiting on a decision</p>
              <p className="text-[11px] text-ink-muted mt-0.5">Bank-imported rows inherit “recoupable” from a column default, not from a decision, so they are kept off every figure on this page until somebody answers. Open the Bank review tab →</p>
            </button>
          )}

          {/* Shared scratchpad. */}
          <div className="card p-3 mb-4">
            <textarea defaultValue={indexNote} rows={2} maxLength={4000}
              onBlur={e => { if (e.target.value !== indexNote) { setIndexNote(e.target.value); saveIndexNote(e.target.value) } }}
              placeholder="Shared notes for the whole recoupment run — saved when you click away."
              className="input text-xs w-full resize-y" />
          </div>

          {/* Filters. */}
          <div className="card mb-4">
            <button onClick={() => toggleCollapsed('filters')} className="w-full flex items-center justify-between gap-3 px-4 py-2 text-left hover:bg-brand-500/5 transition rounded-t-xl">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wide">
                {filtersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Filters
              </span>
              {(search || filterReady || sort !== 'unverified') && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-ink">Active</span>}
            </button>
            {filtersOpen && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-divider">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Artist…" className="input !py-1.5 !pl-7 text-xs !w-48" />
                </div>
                <select value={sort} onChange={e => setSort(e.target.value)} className="input !py-1.5 text-xs !w-auto">
                  {SORTS.map(([k, l]) => <option key={k} value={k}>Sort: {l}</option>)}
                </select>
                <select value={filterReady} onChange={e => setFilterReady(e.target.value)} className="input !py-1.5 text-xs !w-auto">
                  <option value="">Planning: all</option><option value="yes">Ready only</option><option value="no">Not ready</option>
                </select>
                {dismissedCount > 0 && (
                  <button onClick={() => setShowDismissed(v => !v)} className="text-xs font-medium inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-elev text-ink-muted hover:bg-brand-500/10">
                    {showDismissed ? <Eye size={12} /> : <EyeOff size={12} />} {showDismissed ? 'Hiding' : 'Show'} {dismissedCount} dismissed
                  </button>
                )}
                {(search || filterReady || sort !== 'unverified') && (
                  <button onClick={() => { setSearch(''); setFilterReady(''); setSort('unverified') }} className="text-xs font-semibold text-brand-ink hover:underline">Clear</button>
                )}
              </div>
            )}
          </div>

          {/* Priority subtabs — only once a priority exists, with live counts. */}
          {anyPriority && (
            <div className="flex flex-wrap items-center gap-1 mb-4">
              {[['all', 'All'], ...PRIORITIES.map(p => [p, p[0].toUpperCase() + p.slice(1)]), ['none', 'No priority']].map(([k, lbl]) => (
                <button key={k} onClick={() => setPrioTab(k)}
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition ${prioTab === k ? 'bg-brand-600 text-white' : 'bg-elev text-ink-muted hover:bg-brand-500/10'}`}>
                  {lbl} <span className="tabular-nums opacity-70">{priorityCounts[k] ?? 0}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'review' ? (
        <BankReviewQueue rows={review} onDone={() => { loadReview(); load(true) }} toast={toast} />
      ) : tab === 'prioryear' ? (
        <PriorYearView rows={priorYear} onUntag={async (id) => {
          try { await api.post('/financials/recoupments/prior-year', { ids: [id], tag: null }); toast('Untagged'); setPriorYear(p => p.filter(r => r.id !== id)); load(true) }
          catch { toast('Failed', 'error') }
        }} />
      ) : tab === 'statements' ? (
        <StatementsView rows={statements} />
      ) : loading ? (
        <div className="card p-2"><Skeleton.Table rows={6} cols={5} /></div>
      ) : error ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted mb-3">Couldn’t load recoupments.</p>
          <button onClick={() => load()} className="btn-secondary">Retry</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted">
            {withMoney.length === 0
              ? 'No recoupable activity yet. Mark ledger entries as recoupable and record artist income to see balances here.'
              : 'No artists match these filters.'}
          </p>
          {withMoney.length > 0 && <button onClick={() => { setSearch(''); setFilterReady(''); setPrioTab('all') }} className="btn-secondary mt-3">Clear filters</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visible.map(r => <ArtistCard key={r.artist_key || '-'} row={r} onMeta={setMetaField} />)}
        </div>
      )}

      <ConfirmDialog
        open={claimOpen} onClose={() => { setClaimOpen(false); setClaimTarget(null) }} onConfirm={claim}
        busy={claimBusy} variant="primary" confirmLabel="Upload for recoupment"
        title={`Upload ${(claimTarget ? claimTarget.ids.length : provableIds.length)} item${(claimTarget ? claimTarget.ids.length : provableIds.length) === 1 ? '' : 's'} for recoupment`}
        message={
          <div className="space-y-2 text-sm text-ink-muted">
            <p><span className="font-semibold text-ink">{money(claimTarget ? claimTarget.usd : provableTotal)}</span>{claimTarget ? ` for ${claimTarget.name}` : ''}.</p>
            <p>Every one has a bank statement behind it, so the claim has evidence under it.</p>
            <p>This stamps today as the upload date, and <span className="font-semibold text-ink">the upload date is what decides the statement period</span> — anything stamped on the 21st or later lands on next month’s statement.</p>
          </div>
        } />
    </div>
  )
}

function Tile({ title, value, items, hint, byCurrency }) {
  const mixed = byCurrency && Object.keys(byCurrency).length > 1
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">{title}</p>
      <p className="text-lg font-bold text-ink tabular-nums mt-0.5" title={mixed ? moneyByCurrency(byCurrency) : undefined}>
        {value}
        {mixed && <span className="text-[10px] font-normal text-ink-faint ml-1">mixed currency</span>}
      </p>
      <p className="text-[11px] text-ink-muted mt-0.5">
        {items !== undefined && <span className="text-ink-faint">{items} item{items === 1 ? '' : 's'}{hint ? ' · ' : ''}</span>}
        {hint}
      </p>
    </div>
  )
}

// One artist. The bank strip and the two progress bars are the whole point of
// the card: how much of this artist's spend is provable, and how much of it has
// actually been claimed.
function ArtistCard({ row, onMeta }) {
  const pctItems = row.items ? Math.round((row.ufr_items / row.items) * 100) : 0
  const pctUsd = row.usd ? Math.round((row.ufr_usd / row.usd) * 100) : 0
  const href = `/recoupments/artist/${encodeURIComponent(row.artist_key || '-')}`
  return (
    <div className={`card relative overflow-hidden ${row.dismissed ? 'opacity-60' : ''}`}>
      {/* Priority rail. */}
      {row.priority && <span className={`absolute left-0 top-0 bottom-0 w-1 ${row.priority.toLowerCase() === 'high' ? 'bg-danger' : row.priority.toLowerCase() === 'low' ? 'bg-ink-faint' : 'bg-warning'}`} />}
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={href} className="inline-flex items-center gap-1.5 font-semibold text-ink hover:text-brand-ink group">
              <span className="truncate">{row.name}</span>
              <ChevronRight size={15} className="text-ink-faint group-hover:text-brand-ink flex-shrink-0" />
            </Link>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {row.items} item{row.items === 1 ? '' : 's'}
              {row.cobrand_usd > 0 && <> · <span className="text-brand-ink">{money(row.cobrand_usd)} cobrand</span></>}
              {row.unassigned && <> · <span className="text-warning">no artist on these rows</span></>}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-bold text-ink tabular-nums" title={moneyByCurrency(row.by_currency)}>{money(row.usd)}</p>
            <p className="text-[10px] text-ink-faint">{money(row.counted_usd)} on a bank basis</p>
          </div>
        </div>

        {/* Bank strip — the four states, counts only. */}
        <div className="flex flex-wrap items-center gap-2 mt-2.5 text-[10px] font-medium">
          {['verified', 'awaiting_statement', 'unverified', 'unpaid'].map(s => (row.states?.[s] || 0) > 0 && (
            <span key={s} title={STATE_LABEL[s]}
              className={`px-1.5 py-0.5 rounded ${s === 'verified' ? 'bg-success/10 text-success' : s === 'awaiting_statement' ? 'bg-info/10 text-info' : s === 'unverified' ? 'bg-danger/10 text-danger' : 'bg-elev text-ink-muted'}`}>
              {row.states[s]} {STATE_LABEL[s].toLowerCase()}
            </span>
          ))}
          {row.provable_items > 0 && <span className="px-1.5 py-0.5 rounded bg-success/10 text-success" title="Provable on a bank statement and never uploaded for recoupment">{money(row.provable_usd)} unclaimed</span>}
        </div>

        {/* Two progress bars: items claimed, and dollars claimed. */}
        <div className="mt-3 space-y-1.5">
          <Bar label="Items uploaded" pct={pctItems} caption={`${row.ufr_items}/${row.items}`} />
          <Bar label="$ uploaded" pct={pctUsd} caption={`${money(row.ufr_usd)} / ${money(row.usd)}`} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-2.5 border-t border-divider">
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-ink-muted">Income <span className="text-success font-medium">{money(row.income)}</span></span>
            <span className="text-ink-muted">Balance <span className={`font-semibold ${row.balance >= 0 ? 'text-ink' : 'text-danger'}`}>{money(row.balance)}</span></span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${row.recouped ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{row.recouped ? 'Recouped' : 'Unrecouped'}</span>
          </div>
          {!row.unassigned && (
            <div className="flex items-center gap-1">
              {PRIORITIES.map(p => (
                <button key={p} title={`Priority: ${p}`} onClick={() => onMeta(row, { priority: (row.priority || '').toLowerCase() === p ? null : p })}
                  className={`w-6 h-6 rounded text-[10px] font-bold uppercase transition ${(row.priority || '').toLowerCase() === p ? PRIORITY_TONE[p] : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}>{p[0]}</button>
              ))}
              <button title={row.ready_for_planning ? 'Ready for planning' : 'Mark ready for planning'} onClick={() => onMeta(row, { ready_for_planning: !row.ready_for_planning })}
                className={`w-6 h-6 rounded inline-flex items-center justify-center transition ${row.ready_for_planning ? 'bg-success/10 text-success' : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}><Star size={12} fill={row.ready_for_planning ? 'currentColor' : 'none'} /></button>
              {row.flagged && <span title={row.flag_reason || 'Flagged'} className="w-6 h-6 rounded inline-flex items-center justify-center bg-warning/10 text-warning"><Flag size={12} /></span>}
              <button title={row.dismissed ? 'Restore to the active list' : 'Dismiss — hides this artist from the active list'} onClick={() => onMeta(row, { dismissed: !row.dismissed })}
                className="w-6 h-6 rounded inline-flex items-center justify-center bg-elev text-ink-faint hover:bg-brand-500/10">{row.dismissed ? <Eye size={12} /> : <X size={12} />}</button>
              {row.pending_items > 0 && (
                <Link to={`/recoupments/planning?artist=${encodeURIComponent(row.name)}`} title={`Plan ${row.name} — ${row.pending_items} item${row.pending_items === 1 ? '' : 's'} pending upload`}
                  className="w-6 h-6 rounded inline-flex items-center justify-center bg-elev text-ink-faint hover:bg-brand-500/10"><Layers size={12} /></Link>
              )}
            </div>
          )}
        </div>
        {row.notes && <p className="text-[11px] text-ink-muted mt-2 whitespace-pre-wrap">{row.notes}</p>}
      </div>
    </div>
  )
}

function Bar({ label, pct, caption }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-ink-faint mb-0.5">
        <span>{label}</span><span className="tabular-nums">{caption} · {pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-elev overflow-hidden">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  )
}

// Statement months across every artist. Unstamped is its own bucket — a UFR row
// with no stamp belongs to no statement and must not be filed into this month.
function StatementsView({ rows }) {
  const byMonth = {}
  for (const e of rows) { const k = e.statement_month || 'Unstamped'; (byMonth[k] = byMonth[k] || []).push(e) }
  const months = Object.keys(byMonth).sort((a, b) => (a === 'Unstamped' ? -1 : b === 'Unstamped' ? 1 : b.localeCompare(a)))
  if (!months.length) return <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No committed statements yet. Mark entries UFR (here or in Planning) to build a statement.</p></div>
  return (
    <div className="space-y-4">
      {months.map(month => {
        const items = byMonth[month]
        const unstamped = month === 'Unstamped'
        return (
          <div key={month} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider">
              <span className="font-semibold text-ink text-sm" title={unstamped ? 'Marked for recoupment with no upload date — these belong to no statement until one is set' : statementWindowLabel(month)}>
                {unstamped ? 'Unstamped' : `Statement ${statementLabel(month)}`}
                <span className="ml-2 text-[10px] font-normal text-ink-faint">{unstamped ? 'no upload date — belongs to no statement' : `covers ${statementWindowLabel(month)}`}</span>
              </span>
              <span className="text-sm font-semibold text-ink tabular-nums">{money(items.reduce((s, e) => s + Number(e.amount_usd || 0), 0))}</span>
            </div>
            <table className="w-full text-sm"><tbody className="divide-y divide-divider">
              {items.map(e => (
                <tr key={e.id} className="hover:bg-brand-500/5">
                  <td className="px-4 py-2 text-ink">{e.artist || '—'}</td>
                  <td className="px-4 py-2 text-ink-muted">{e.song || '—'}</td>
                  <td className="px-4 py-2 text-ink-muted truncate">{e.payee || '—'}</td>
                  <td className="px-4 py-2 text-right text-ink tabular-nums">{money(e.amount_usd)}<span className="text-[10px] text-ink-faint ml-1">{e.currency !== 'USD' ? `${e.currency} ${Number(e.amount).toFixed(2)}` : ''}</span></td>
                  <td className="px-4 py-2 text-right"><Link to={`/ledger?focus=${e.id}`} className="text-ink-faint hover:text-brand-ink inline-block"><ExternalLink size={13} /></Link></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )
      })}
    </div>
  )
}

// Prior-year subpage — tagged rows grouped into per-artist cards.
function PriorYearView({ rows, onUntag }) {
  if (!rows.length) return <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No prior-year entries. Tag entries from an artist’s page to move them here.</p></div>
  const byArtist = {}
  rows.forEach(r => { (byArtist[r.artist || '—'] = byArtist[r.artist || '—'] || []).push(r) })
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(byArtist).map(([artist, items]) => {
        const total = items.reduce((s, e) => s + Number(e.amount_usd || 0), 0)
        return (
          <div key={artist} className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider">
              <span className="font-semibold text-ink text-sm">{artist}</span>
              <span className="text-sm font-semibold text-ink tabular-nums">{money(total)} <span className="text-[10px] text-ink-faint font-normal">{items.length} entr{items.length === 1 ? 'y' : 'ies'}</span></span>
            </div>
            <div className="divide-y divide-divider">
              {items.map(e => (
                <div key={e.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="text-[10px] font-bold uppercase bg-elev text-ink-muted rounded px-1.5 py-0.5">{e.prior_year_tag}</span>
                  <span className="text-ink flex-1 truncate">{e.payee || '—'}{e.song ? ` · ${e.song}` : ''}</span>
                  <span className="text-ink font-medium tabular-nums">{money(e.amount_usd)}</span>
                  <button onClick={() => onUntag(e.id)} title="Unmark" className="text-ink-faint hover:text-brand-ink">Unmark</button>
                  <Link to={`/ledger?focus=${e.id}`} className="text-ink-faint hover:text-brand-ink"><ExternalLink size={13} /></Link>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// The bank-review gate. These rows are OFF every recoupment figure until they
// are answered, so this queue is the only place their money is visible.
function BankReviewQueue({ rows, onDone, toast }) {
  const [sel, setSel] = useState(new Set())
  const [artist, setArtist] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const answer = async (keep) => {
    if (!sel.size || busy) return
    setBusy(true)
    try {
      const { data } = await api.post('/financials/recoupments/review', {
        ids: [...sel], recoupable: keep, ...(keep && artist.trim() ? { artist: artist.trim() } : {}),
      })
      toast(`${data.data.reviewed} answered — ${keep ? 'recoupable' : 'not recoupable'}`)
      setSel(new Set()); setArtist(''); onDone()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  if (!rows.length) return <div className="card p-10 text-center"><p className="text-sm text-ink-muted">Nothing waiting. Every statement-born cost has been answered.</p></div>
  const selUsd = rows.filter(r => sel.has(r.id)).reduce((s, r) => s + Number(r.amount_usd || 0), 0)
  return (
    <div className="space-y-3">
      <div className="card p-3 text-xs text-ink-muted">
        Statement-born rows arrive marked <span className="font-semibold text-ink">recoupable</span> because that column defaults to true — not because anybody decided. Answer here and the row joins (or leaves) the recoupment figures. “No” also clears <span className="font-mono">recoupable</span>, so it stops claiming to be recoupable anywhere else.
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] text-ink-muted uppercase tracking-wide border-b border-divider">
            <th className="px-3 py-2 w-8"></th><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Payee</th>
            <th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Artist</th><th className="px-3 py-2 font-semibold text-right">Amount</th>
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {rows.map(r => (
              <tr key={r.id} className={sel.has(r.id) ? 'bg-selected' : 'hover:bg-brand-500/5'}>
                <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-3 py-2 text-ink-muted">{String(r.payment_date || r.invoice_date || '').slice(0, 10)}</td>
                <td className="px-3 py-2 text-ink truncate max-w-[280px]">{r.payee || '—'}</td>
                <td className="px-3 py-2 text-ink-muted">{r.category || '—'}</td>
                <td className="px-3 py-2 text-ink-muted">{r.artist || <span className="text-warning">none</span>}</td>
                <td className="px-3 py-2 text-right text-ink tabular-nums">{money(r.amount_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel.size > 0 && (
        <div className="sticky bottom-4 card p-3 flex flex-wrap items-center gap-3 shadow-elevated">
          <span className="text-sm font-semibold text-ink">{sel.size} selected · {money(selUsd)}</span>
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist (only on rows with none)" className="input !py-1.5 text-xs !w-64" />
          <button disabled={busy} onClick={() => answer(true)} className="btn-primary !py-1.5 text-xs">Recoupable</button>
          <button disabled={busy} onClick={() => answer(false)} className="btn-secondary !py-1.5 text-xs">Not recoupable</button>
          <button onClick={() => setSel(new Set())} className="text-xs font-semibold text-ink-muted hover:underline">Clear</button>
        </div>
      )}
    </div>
  )
}

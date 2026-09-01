import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, ChevronDown, ExternalLink, Check, Star, Flag, CalendarClock,
  Plus, Search, Scissors, Trash2, Undo2, Layers, FileText, Tag, AtSign, Pencil, Paperclip,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import SplitModal from '../components/SplitModal'
import SocialHandlesEditor from '../components/SocialHandlesEditor'
import BankEvidenceDot from '../components/BankEvidenceDot'
import CategoryOptions from '../components/CategoryOptions'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig, moneyByCurrency, totalsByCurrency } from '../utils/money'
import { STATE_LABEL } from '../utils/recoupState'
import { statementLabel, statementWindowLabel, recentStatementMonths, STATE_TONE } from '../utils/statements'
import { CURRENCIES } from '../constants'
import useCollapsed from '../hooks/useCollapsed'
import useFocusRefetch from '../hooks/useFocusRefetch'
import { Modal, ConfirmDialog } from '../components/ui'
import { addToPlan } from '../lib/recoupmentPlan'

// The four state sections, unverified FIRST: it is the only one of the four
// that is a discrepancy, and the only one a partner could challenge.
const SECTIONS = [
  { id: 'unverified', title: 'Unverified — no bank line', tone: 'unverified',
    desc: 'Paid, and a statement covering the payment date shows no matching transaction. Chase these before claiming them.' },
  { id: 'verified', title: 'Verified on a statement', tone: 'verified',
    desc: 'A bank statement shows the payment. Provable to a partner.' },
  { id: 'awaiting_statement', title: 'Awaiting the statement', tone: 'awaiting_statement',
    desc: 'Paid, and no uploaded statement covers the date yet — nothing to check it against. Counted, and normal for a cost uploaded the same month it was paid.' },
  { id: 'unpaid', title: 'Unpaid invoices', tone: 'unpaid',
    desc: 'Approved but not yet paid. Recoupable once payment clears.' },
]

const socialsList = (raw) => (Array.isArray(raw) ? raw : [])
  .map(s => ({ platform: (s?.platform || '').trim(), handle: (s?.handle || '').trim(), amount: s?.amount }))
  .filter(s => s.handle || s.platform)

// One artist's recoupment page. URL-addressable (`/recoupments/artist/:key`,
// `?statement=` for the tab) so a statement view is shareable.
export default function RecoupmentArtist() {
  const { key: routeKey } = useParams()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [labels, setLabels] = useState([])
  const [searchParams, setSearchParams] = useSearchParams()

  // 'pending' = not yet uploaded, 'uploaded' = every claimed row, 'total' =
  // everything, or a YYYY-MM key for one statement.
  const statement = searchParams.get('statement') || 'total'
  const setStatement = (s) => setSearchParams(prev => {
    const next = new URLSearchParams(prev)
    if (!s || s === 'total') next.delete('statement'); else next.set('statement', s)
    return next
  }, { replace: true })

  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('song')
  const [filterUfr, setFilterUfr] = useState('')
  const [filterPayment, setFilterPayment] = useState('')
  const [filterLabel, setFilterLabel] = useState('')
  const [sel, setSel] = useState(new Set())
  const [editing, setEditing] = useState(null)      // an entry being edited
  const [splitting, setSplitting] = useState(null)
  const [confirm, setConfirm] = useState(null)      // { title, message, onConfirm }
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState(null)            // { text, run }
  const undoTimer = useRef(null)

  const { isCollapsed, toggleCollapsed, setAllCollapsed } = useCollapsed('recoup_collapsed_v1')

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    return api.get(`/financials/recoupments/artist/${encodeURIComponent(routeKey)}`)
      .then(r => { setData(r.data.data); setError(false) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [routeKey])
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load(true))
  useEffect(() => { api.get('/financials/recoupments/labels').then(r => setLabels(r.data.data || [])).catch(() => {}) }, [])

  // Every mutation goes through here: optimistic where it is safe, always with
  // an undo that reverses the exact action rather than "refetch and hope".
  const showUndo = (text, run) => {
    clearTimeout(undoTimer.current)
    setUndo({ text, run })
    undoTimer.current = setTimeout(() => setUndo(null), 10000)
  }
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const entries = data?.entries || []
  const aKey = data?.artist?.key || '-'
  const artistName = data?.artist?.name || ''

  // ── The statement tab scopes everything below it: rows, groups, selection.
  const statementScoped = useMemo(() => {
    if (statement === 'total') return entries
    if (statement === 'pending') return entries.filter(e => !e.ufr)
    if (statement === 'uploaded') return entries.filter(e => e.ufr)
    return entries.filter(e => e.statement_month === statement)
  }, [entries, statement])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return statementScoped.filter(e => {
      if (filterUfr === 'yes' && !e.ufr) return false
      if (filterUfr === 'no' && e.ufr) return false
      if (filterUfr === 'unverified' && !(e.ufr && e.state === 'unverified')) return false
      if (filterPayment === 'paid' && e.payment_status !== 'Paid') return false
      if (filterPayment === 'unpaid' && e.payment_status === 'Paid') return false
      if (filterLabel === '__none__' && e.recoupment_label) return false
      if (filterLabel && filterLabel !== '__none__' && e.recoupment_label !== filterLabel) return false
      if (!q) return true
      const socials = socialsList(e.social_handles).map(s => `${s.platform} ${s.handle}`).join(' ')
      return [e.payee, e.artist, e.song, e.description, e.category, e.recoupment_label, e.notes, socials]
        .some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [statementScoped, search, filterUfr, filterPayment, filterLabel])

  // Two-pass grouping: primary axis (song or category), then recoupment-label
  // sub-buckets inside it. Keys are case-folded so "Tour" and "tour" are one
  // group, and the display name is the best spelling in the bucket.
  const groupsFor = useCallback((rows) => {
    const primary = new Map()
    for (const e of rows) {
      const raw = (groupBy === 'category' ? e.category : e.song) || '—'
      const k = raw.toLowerCase()
      if (!primary.has(k)) primary.set(k, { key: k, names: [], items: [] })
      primary.get(k).names.push(raw)
      primary.get(k).items.push(e)
    }
    const pinned = groupBy === 'category' ? ['advance', 'marketing'] : []
    return [...primary.values()]
      .map(g => {
        const byLabel = new Map()
        for (const e of g.items) {
          const lk = (e.recoupment_label || '').toLowerCase()
          if (!byLabel.has(lk)) byLabel.set(lk, { key: lk, name: e.recoupment_label || null, items: [] })
          byLabel.get(lk).items.push(e)
        }
        return {
          ...g,
          name: bestName(g.names),
          usd: g.items.reduce((s, e) => s + Number(e.amount_usd || 0), 0),
          labels: [...byLabel.values()].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || String(a.name).localeCompare(String(b.name))),
        }
      })
      // Sinks last, pinned first, then biggest.
      .sort((a, b) => {
        const pa = pinned.indexOf(a.key); const pb = pinned.indexOf(b.key)
        if (pa !== pb) return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
        if ((a.key === '—') !== (b.key === '—')) return a.key === '—' ? 1 : -1
        return b.usd - a.usd
      })
  }, [groupBy])

  const bySection = useMemo(() => {
    const b = { verified: [], awaiting_statement: [], unverified: [], unpaid: [] }
    for (const e of filtered) (b[e.state] || b.unpaid).push(e)
    return b
  }, [filtered])

  const monthsInView = data?.statement_months || []
  const selRows = filtered.filter(e => sel.has(e.id))

  // ── Writes ────────────────────────────────────────────────────────────────
  const patchEntry = async (id, patch, label) => {
    const before = entries.find(e => e.id === id)
    setData(d => ({ ...d, entries: d.entries.map(e => e.id === id ? { ...e, ...patch } : e) }))
    try {
      await api.patch(`/ledger/entries/${id}`, patch)
      if (before && label) {
        const revert = Object.fromEntries(Object.keys(patch).map(k => [k, before[k] ?? null]))
        showUndo(label, async () => { await api.patch(`/ledger/entries/${id}`, revert); load(true) })
      }
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); load(true) }
  }

  const toggleUfr = async (e) => {
    try {
      const { data: res } = await api.post(`/financials/recoupments/${e.id}/ufr`, { ufr: !e.ufr })
      setData(d => ({ ...d, entries: d.entries.map(x => x.id === e.id ? { ...x, ufr: res.data.ufr, ufr_marked_at: res.data.ufr_marked_at, statement_month: res.data.statement_month } : x) }))
      showUndo(e.ufr ? 'Removed from recoupment' : 'Uploaded for recoupment', async () => {
        await api.post(`/financials/recoupments/${e.id}/ufr`, { ufr: e.ufr }); load(true)
      })
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const bulk = async (fn, clear = true) => {
    if (!selRows.length || busy) return
    setBusy(true)
    try { await fn(selRows.map(e => e.id)); if (clear) setSel(new Set()); await load(true) }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }   // selection SURVIVES a failure
    finally { setBusy(false) }
  }

  const moveToMonth = (ids, month) => api.post('/financials/recoupments/move-month', { ids, month })
    .then(({ data: r }) => toast(`${r.data.moved} moved to ${statementLabel(month)}${r.data.already ? ` · ${r.data.already} already there` : ''}${r.data.skipped ? ` · ${r.data.skipped} not claimed` : ''}`))

  const setLabelBulk = (ids, label, markUfr) => api.post('/financials/recoupments/set-label', { ids, label, mark_ufr: !!markUfr })
    .then(({ data: r }) => toast(`${r.data.updated} labelled${markUfr ? ' and uploaded' : ''}`))

  const tagPriorYear = async (ids, tag) => {
    try {
      await api.post('/financials/recoupments/prior-year', { ids, tag })
      toast(tag ? `Tagged ${tag}` : 'Untagged')
      showUndo(tag ? `Tagged ${ids.length} as ${tag}` : 'Untagged', async () => { await api.post('/financials/recoupments/prior-year', { ids, tag: null }); load(true) })
      load(true)
    } catch { toast('Failed', 'error') }
  }

  // `flagged` is not in the ledger PATCH allow-list — flags have their own
  // endpoint because they carry a reason and an audit line.
  const flagEntry = async (e) => {
    const reason = e.flagged ? null : window.prompt('Why is this flagged? (optional)') ?? ''
    if (!e.flagged && reason === null) return
    try {
      await api.post(`/ledger/entries/${e.id}/flag`, { flagged: !e.flagged, flag_reason: reason || null })
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const removeEntry = async (e) => {
    try {
      await api.delete(`/ledger/entries/${e.id}`)
      setData(d => ({ ...d, entries: d.entries.filter(x => x.id !== e.id) }))
      showUndo(`Deleted ${e.payee || 'entry'}`, async () => { await api.post(`/ledger/entries/${e.id}/restore`); load(true) })
      load(true)
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const setSongStatus = async (song, patch) => {
    const k = song.toLowerCase()
    setData(d => ({ ...d, song_status: { ...d.song_status, [k]: { ...(d.song_status?.[k] || {}), ...patch } } }))
    try { await api.post('/financials/recoupments/song-status', { artist: artistName, song, ...patch }) }
    catch { toast('Failed to save', 'error'); load(true) }
  }
  const setSongNote = async (song, note) => {
    const k = song.toLowerCase()
    setData(d => ({ ...d, song_notes: { ...d.song_notes, [k]: note } }))
    try { await api.post('/financials/recoupments/notes', { artist: artistName, song, note }) }
    catch { toast('Failed to save', 'error') }
  }

  // Invoice / receipt preview. The file routes are auth-gated, so this fetches
  // the blob rather than linking — an <a href> would 401.
  const openFile = async (id, type) => {
    try {
      const { data: blob } = await api.get(`/ledger/entries/${id}/file/${type}`, { responseType: 'blob' })
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch { toast('Couldn’t open the file', 'error') }
  }

  const exportXlsx = async () => {
    try {
      const { data: blob } = await api.get(`/financials/recoupments/export?artist=${encodeURIComponent(aKey)}&group_by=${groupBy}`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${artistName || 'recoupments'}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }

  // Collapse / expand every level at once: sections, groups, label buckets.
  const allKeys = useMemo(() => {
    const keys = SECTIONS.map(s => `section:${s.id}`)
    for (const g of groupsFor(filtered)) {
      keys.push(`g:${aKey}:${g.key}`)
      for (const l of g.labels) keys.push(`l:${aKey}:${g.key}:${l.key}`)
    }
    return keys
  }, [filtered, groupsFor, aKey])

  if (loading) return <div className="card p-2"><Skeleton.Table rows={8} cols={5} /></div>
  if (error || !data) return (
    <div className="card p-10 text-center">
      <p className="text-sm text-ink-muted mb-3">Couldn’t load this artist.</p>
      <button onClick={() => load()} className="btn-secondary">Retry</button>
    </div>
  )

  const t = data.totals
  const filtersActive = search || filterUfr || filterPayment || filterLabel

  return (
    <div className="pb-24">
      <div className="mb-3">
        <Link to="/recoupments" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-brand-ink"><ArrowLeft size={13} /> All artists</Link>
      </div>
      <PageHeader
        title={artistName}
        subtitle={`${t.items} recoupable item${t.items === 1 ? '' : 's'} · ${money(t.counted_usd)} on a bank basis`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setAllCollapsed(allKeys, true)} className="btn-secondary !py-1.5 text-xs">Collapse all</button>
            <button onClick={() => setAllCollapsed(allKeys, false)} className="btn-secondary !py-1.5 text-xs">Expand all</button>
            <button onClick={exportXlsx} className="btn-secondary !py-1.5 text-xs"><FileText size={13} /> Export</button>
            <Link to={`/recoupments/planning?artist=${encodeURIComponent(artistName)}`} className="btn-secondary !py-1.5 text-xs"><Layers size={13} /> Planning</Link>
            <button onClick={() => setAdding(v => !v)} className="btn-primary !py-1.5 text-xs"><Plus size={13} /> Add expense</button>
          </div>
        } />

      {/* Totals + the deal it is measured against. */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-divider border border-divider rounded-xl overflow-hidden mb-4">
        <Tile title="Recoupable · bank basis" value={money(t.counted_usd)} sub={`${t.counted_items} of ${t.items} items`} byCurrency={t.by_currency} />
        <Tile title="Uploaded" value={money(t.ufr_usd)} sub={t.ufr_unverified_items > 0
          ? <button onClick={() => { setFilterUfr('unverified'); setStatement('total') }} className="text-danger font-semibold hover:underline">{t.ufr_unverified_items} with no bank line</button>
          : `${t.ufr_items} item${t.ufr_items === 1 ? '' : 's'}`} />
        <Tile title="Pending upload" value={money(t.pending_usd)} sub={t.provable_items > 0
          ? <span className="text-success font-semibold">{money(t.provable_usd)} provable now</span>
          : `${t.pending_items} item${t.pending_items === 1 ? '' : 's'}`} />
        <Tile title="Income" value={money(t.income)} sub={t.recouped ? 'Recouped' : 'Unrecouped'} />
        {data.deal
          ? <Tile title="Remaining vs deal" value={money(data.deal.recoupable_total - t.usd)}
              sub={<span className={data.deal.recoupable_total - t.usd < 0 ? 'text-danger' : 'text-success'}>{money(t.usd)} of {money(data.deal.recoupable_total)} spent</span>} />
          : <Tile title="Balance" value={money(t.balance)} sub="income − recoupable spend" />}
      </div>

      {data.deal && (
        <div className="card mb-4">
          <button onClick={() => toggleCollapsed('deal')} className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-brand-500/5 transition rounded-t-xl">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wide">
              {isCollapsed('deal') ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Deal
            </span>
            <span className="text-xs text-ink-muted tabular-nums">{money(data.deal.recoupable_total)} recoupable of {money(data.deal.total)}</span>
          </button>
          {!isCollapsed('deal') && (
            <div className="border-t border-divider divide-y divide-divider">
              {data.deal.lines.map((l, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                  <span className="text-ink flex-1 truncate">{l.label}{l.note ? <span className="text-ink-faint"> · {l.note}</span> : ''}</span>
                  {!l.recoupable && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-elev text-ink-muted">not recoupable</span>}
                  <span className="text-ink font-medium tabular-nums">{money(l.amount)}</span>
                </div>
              ))}
              {!data.deal.lines.length && <p className="px-4 py-3 text-xs text-ink-muted">Advance on file: {data.deal.advance}</p>}
            </div>
          )}
        </div>
      )}

      {/* Statement tabs — the tab scopes rows AND selection. */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        {[['total', 'Total', entries.length], ['pending', 'Pending upload', entries.filter(e => !e.ufr).length], ['uploaded', 'Uploaded', entries.filter(e => e.ufr).length]].map(([k, lbl, n]) => (
          <button key={k} onClick={() => { setStatement(k); setSel(new Set()) }}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${statement === k ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-brand-500/10'}`}>
            {lbl} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
        <span className="w-px h-5 bg-divider mx-1" />
        {monthsInView.map(m => (
          <button key={m} onClick={() => { setStatement(m); setSel(new Set()) }}
            title={`Statement ${statementLabel(m)} — covers uploads ${statementWindowLabel(m)}, released on the 20th`}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${statement === m ? 'bg-success/15 text-success' : 'text-ink-muted hover:bg-success/10'}`}>
            {statementLabel(m)} <span className="tabular-nums opacity-70">{entries.filter(e => e.statement_month === m).length}</span>
          </button>
        ))}
      </div>

      {/* Filters. */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Payee, song, category, @handle…" className="input !py-1.5 !pl-7 text-xs !w-64" />
        </div>
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="input !py-1.5 text-xs !w-auto">
          <option value="song">Group by song</option><option value="category">Group by category</option>
        </select>
        <select value={filterUfr} onChange={e => setFilterUfr(e.target.value)} className="input !py-1.5 text-xs !w-auto">
          <option value="">UFR: all</option><option value="yes">Uploaded</option><option value="no">Not uploaded</option>
          <option value="unverified">Uploaded, no bank match</option>
        </select>
        <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)} className="input !py-1.5 text-xs !w-auto">
          <option value="">Payment: all</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option>
        </select>
        <select value={filterLabel} onChange={e => setFilterLabel(e.target.value)} className="input !py-1.5 text-xs !w-auto">
          <option value="">Label: all</option><option value="__none__">No label</option>
          {labels.map(l => <option key={l.label} value={l.label}>{l.label} ({l.n})</option>)}
        </select>
        <button onClick={() => setSel(new Set(filtered.map(e => e.id)))} className="text-xs font-semibold text-brand-ink hover:underline">Select all {filtered.length}</button>
        {filtersActive && <button onClick={() => { setSearch(''); setFilterUfr(''); setFilterPayment(''); setFilterLabel('') }} className="text-xs font-semibold text-ink-muted hover:underline">Clear</button>}
      </div>

      {adding && <AddExpense artist={artistName} labels={labels} onDone={() => { setAdding(false); load(true) }} onCancel={() => setAdding(false)} toast={toast} />}

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-sm text-ink-muted">
            {entries.length === 0 ? `No recoupable entries for ${artistName}.`
              : statementScoped.length === 0 ? `Nothing in this statement period for ${artistName}.`
              : 'No entries match these filters.'}
          </p>
          {filtersActive && <button onClick={() => { setSearch(''); setFilterUfr(''); setFilterPayment(''); setFilterLabel('') }} className="btn-secondary mt-3">Clear filters</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {SECTIONS.filter(s => bySection[s.id].length > 0).map(s => {
            const rows = bySection[s.id]
            const tone = STATE_TONE[s.tone]
            const key = `section:${s.id}`
            const open = !isCollapsed(key)
            const ufrN = rows.filter(e => e.ufr).length
            const unver = rows.filter(e => e.ufr && e.state === 'unverified').length
            const cur = totalsByCurrency(rows, e => Number(e.amount || 0))
            return (
              <div key={s.id} className="card overflow-hidden">
                <button onClick={() => toggleCollapsed(key)} className="w-full flex items-center justify-between gap-4 px-4 py-3 border-b border-divider text-left hover:bg-brand-500/5 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    {open ? <ChevronDown size={14} className="text-ink-faint flex-shrink-0" /> : <ChevronRight size={14} className="text-ink-faint flex-shrink-0" />}
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone.dot}`} />
                    <div className="min-w-0">
                      <p className={`text-sm font-bold ${tone.text}`}>{s.title}</p>
                      <p className="text-[11px] text-ink-muted truncate">{s.desc}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                    <span className="tabular-nums font-bold text-ink" title={moneyByCurrency(cur)}>
                      {moneyByCurrency(cur) || money(0)}
                      <span className="font-normal text-ink-faint ml-1">≈ {money(rows.reduce((a, e) => a + Number(e.amount_usd || 0), 0))}</span>
                    </span>
                    <span className="text-ink-faint tabular-nums">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
                    {ufrN > 0 && <span className="text-success tabular-nums">{ufrN}/{rows.length} UFR</span>}
                    {unver > 0 && <span className="text-danger tabular-nums" title="Uploaded for recoupment with no bank line behind the claim">{unver} unverified</span>}
                  </div>
                </button>
                {open && (
                  <div className="p-3 space-y-3">
                    {groupsFor(rows).map(g => (
                      <Group key={g.key} g={g} aKey={aKey} groupBy={groupBy}
                        isCollapsed={isCollapsed} toggleCollapsed={toggleCollapsed}
                        songStatus={data.song_status?.[g.key]} songNote={data.song_notes?.[g.key]}
                        onSongStatus={(patch) => setSongStatus(g.name, patch)}
                        onSongNote={(note) => setSongNote(g.name, note)}
                        onTagYear={(ids) => { const y = window.prompt('Move to the prior-year subpage — enter the year (e.g. 2024):'); if (y && y.trim()) tagPriorYear(ids, y.trim()) }}
                        sel={sel} setSel={setSel}
                        row={(e) => (
                          <Row key={e.id} e={e} selected={sel.has(e.id)}
                            onSelect={() => setSel(x => { const n = new Set(x); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })}
                            onUfr={() => toggleUfr(e)}
                            onMove={(m) => moveToMonth([e.id], m).then(() => load(true))}
                            onEdit={() => setEditing(e)}
                            onSplit={() => setSplitting(e)}
                            onPatch={(patch, label) => patchEntry(e.id, patch, label)}
                            onFlag={() => flagEntry(e)}
                            onFile={(type) => openFile(e.id, type)}
                            onTagYear={() => { const y = window.prompt('Move to the prior-year subpage — enter the year (e.g. 2024):'); if (y && y.trim()) tagPriorYear([e.id], y.trim()) }}
                            onDelete={() => setConfirm({
                              title: 'Delete this entry?', message: `${e.payee || 'Entry'} — ${moneyOrig(e.amount, e.currency)}. It moves to the ledger archive and can be restored.`,
                              onConfirm: () => { removeEntry(e); setConfirm(null) },
                            })} />
                        )} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Non-recoupable: the promote-back worklist. */}
      {data.non_recoupable.length > 0 && (
        <div className="card mt-4">
          <button onClick={() => toggleCollapsed('nonrecoup')} className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-brand-500/5 transition rounded-xl">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-muted uppercase tracking-wide">
              {isCollapsed('nonrecoup') ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Non-recoupable · {data.non_recoupable.length}
            </span>
            <span className="text-xs text-ink-faint tabular-nums">{money(data.non_recoupable.reduce((s, e) => s + Number(e.amount_usd || 0), 0))}</span>
          </button>
          {!isCollapsed('nonrecoup') && (
            <div className="border-t border-divider divide-y divide-divider">
              {data.non_recoupable.map(e => (
                <div key={e.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <span className="text-ink-muted w-20 flex-shrink-0">{formatDate(e.payment_date || e.invoice_date)}</span>
                  <span className="text-ink flex-1 truncate">{e.payee || '—'}{e.category ? ` · ${e.category}` : ''}</span>
                  <span className="text-ink font-medium tabular-nums">{money(e.amount_usd)}</span>
                  <button onClick={() => patchEntry(e.id, { recoupable: true }, 'Marked recoupable')}
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-success/10 text-success hover:bg-success/15">Mark recoupable</button>
                  <Link to={`/ledger?focus=${e.id}`} className="text-ink-faint hover:text-brand-ink"><ExternalLink size={13} /></Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk bar. */}
      {selRows.length > 0 && (
        <BulkBar rows={selRows} busy={busy} labels={labels}
          onClear={() => setSel(new Set())}
          onAddToPlan={() => {
            // Staging is a CLIENT working set (lib/recoupmentPlan.js) — nothing
            // reaches the ledger until Planning's commit. Already-claimed rows
            // are not eligible there, so they are never staged.
            const ids = selRows.filter(e => !e.ufr).map(e => e.id)
            if (!ids.length) { toast('Those are already uploaded for recoupment', 'error'); return }
            addToPlan(ids)
            setSel(new Set())
            toast(`${ids.length} staged for planning${ids.length < selRows.length ? ` · ${selRows.length - ids.length} already claimed` : ''}`)
          }}
          onMarkUfr={() => bulk(ids => api.post('/financials/recoupments/ufr-bulk', { ids, ufr: true }).then(({ data: r }) => toast(`${r.data.changed} uploaded${r.data.already ? ` · ${r.data.already} already` : ''}`)))}
          onUnmarkUfr={() => bulk(ids => api.post('/financials/recoupments/ufr-bulk', { ids, ufr: false }).then(({ data: r }) => toast(`${r.data.changed} un-claimed`)))}
          onSetLabel={(label, markUfr) => bulk(ids => setLabelBulk(ids, label, markUfr))}
          onMove={(m) => bulk(ids => moveToMonth(ids, m))}
          onTagYear={() => { const y = window.prompt('Move to the prior-year subpage — enter the year (e.g. 2024):'); if (y && y.trim()) bulk(ids => tagPriorYear(ids, y.trim())) }} />
      )}

      {undo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 card px-4 py-2.5 shadow-elevated flex items-center gap-3">
          <span className="text-xs text-ink">{undo.text}</span>
          <button onClick={async () => { const u = undo; setUndo(null); try { await u.run() } catch { toast('Undo failed', 'error') } }}
            className="text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1"><Undo2 size={12} /> Undo</button>
        </div>
      )}

      {editing && <EditRow entry={editing} labels={labels} artist={artistName} onClose={() => setEditing(null)}
        onSave={async (patch) => { await patchEntry(editing.id, patch, 'Entry updated'); setEditing(null) }} />}
      {splitting && <SplitModal entry={splitting} artistNames={[artistName]} toast={toast}
        onClose={() => setSplitting(null)} onDone={() => { setSplitting(null); load(true) }} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={confirm?.onConfirm}
        title={confirm?.title} message={confirm?.message} />
    </div>
  )
}

const bestName = (names) => {
  const c = new Map()
  for (const n of names) c.set(n, (c.get(n) || 0) + 1)
  let best = names[0]; let bn = -1
  for (const [n, k] of c) if (k > bn || (k === bn && n.length > best.length)) { best = n; bn = k }
  return best
}

function Tile({ title, value, sub, byCurrency }) {
  const mixed = byCurrency && Object.keys(byCurrency).length > 1
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wide">{title}</p>
      <p className="text-lg font-bold text-ink tabular-nums mt-0.5" title={mixed ? moneyByCurrency(byCurrency) : undefined}>{value}</p>
      <p className="text-[11px] text-ink-muted mt-0.5">{sub}</p>
    </div>
  )
}

// A primary group (song or category) with its recoupment-label sub-buckets.
// The collapse key is deliberately NOT section-prefixed: folding "Marketing"
// folds it in every state section at once, because it is the same group.
function Group({ g, aKey, groupBy, isCollapsed, toggleCollapsed, songStatus, songNote, onSongStatus, onSongNote, onTagYear, sel, setSel, row }) {
  const key = `g:${aKey}:${g.key}`
  const open = !isCollapsed(key)
  const ids = g.items.map(e => e.id)
  const allSel = ids.every(id => sel.has(id))
  const isSong = groupBy === 'song' && g.key !== '—'
  const [noteOpen, setNoteOpen] = useState(false)
  return (
    <div className="border border-divider rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-page/40">
        <input type="checkbox" checked={allSel} onChange={() => setSel(s => { const n = new Set(s); ids.forEach(id => allSel ? n.delete(id) : n.add(id)); return n })}
          title={allSel ? 'Deselect this group' : 'Select this group'} />
        <button onClick={() => toggleCollapsed(key)} className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          {open ? <ChevronDown size={13} className="text-ink-faint" /> : <ChevronRight size={13} className="text-ink-faint" />}
          <span className="text-xs font-bold text-ink truncate">{g.name}</span>
          <span className="text-[10px] text-ink-faint">{g.items.length}</span>
        </button>
        {isSong && (
          <>
            <button onClick={() => onSongStatus({ finished: !songStatus?.finished })} title="Campaign finished (shared with Artist Campaigns)"
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${songStatus?.finished ? 'bg-success/10 text-success' : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}>
              <Check size={10} className="inline" /> Finished
            </button>
            <button onClick={() => onSongStatus({ ready_for_planning: !songStatus?.ready_for_planning })} title="Ready for recoupment planning"
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${songStatus?.ready_for_planning ? 'bg-success/10 text-success' : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}>
              <Star size={10} className="inline" /> Ready
            </button>
            <button onClick={() => setNoteOpen(v => !v)} title="Note for this song" className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${songNote ? 'bg-warning/10 text-warning' : 'bg-elev text-ink-faint hover:bg-brand-500/10'}`}><Pencil size={10} className="inline" /> Note</button>
          </>
        )}
        <button onClick={() => onTagYear(ids)} title="Tag this whole group for the prior-year subpage" className="text-ink-faint hover:text-brand-ink"><CalendarClock size={13} /></button>
        <span className="text-xs font-semibold text-ink tabular-nums">{money(g.usd)}</span>
      </div>
      {songNote && !noteOpen && <p className="px-3 py-1.5 text-[11px] text-warning bg-warning/5 border-t border-divider whitespace-pre-wrap">{songNote}</p>}
      {noteOpen && (
        <div className="px-3 py-2 border-t border-divider">
          <textarea defaultValue={songNote || ''} rows={2} placeholder={`Note for ${g.name}…`} className="input text-xs w-full resize-y"
            onBlur={e => { if (e.target.value !== (songNote || '')) onSongNote(e.target.value); setNoteOpen(false) }} />
        </div>
      )}
      {open && (
        <div className="divide-y divide-divider border-t border-divider">
          {g.labels.map(l => (
            <div key={l.key}>
              {g.labels.length > 1 || l.name ? (
                <button onClick={() => toggleCollapsed(`l:${aKey}:${g.key}:${l.key}`)}
                  className="w-full flex items-center gap-2 px-3 py-1 text-left bg-card hover:bg-brand-500/5 transition">
                  {isCollapsed(`l:${aKey}:${g.key}:${l.key}`) ? <ChevronRight size={11} className="text-ink-faint" /> : <ChevronDown size={11} className="text-ink-faint" />}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${l.name ? 'bg-brand-500/10 text-brand-ink' : 'bg-elev text-ink-faint'}`}>{l.name || 'No label'}</span>
                  <span className="text-[10px] text-ink-faint">{l.items.length}</span>
                </button>
              ) : null}
              {!isCollapsed(`l:${aKey}:${g.key}:${l.key}`) && <div className="divide-y divide-divider">{l.items.map(row)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ e, selected, onSelect, onUfr, onMove, onEdit, onSplit, onPatch, onFlag, onFile, onTagYear, onDelete }) {
  const [monthOpen, setMonthOpen] = useState(false)
  const socials = socialsList(e.social_handles)
  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs ${selected ? 'bg-selected' : 'hover:bg-brand-500/5'}`}>
      <input type="checkbox" checked={selected} onChange={onSelect} />
      <span className="text-ink-muted w-20 flex-shrink-0">{formatDate(e.payment_date || e.invoice_date)}</span>
      <BankEvidenceDot row={e} className="flex-shrink-0" />
      <button onClick={onEdit} className="text-ink flex-1 min-w-[120px] truncate text-left hover:text-brand-ink" title="Edit this entry">{e.payee || '—'}</button>
      {e.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0">{e.category}</span>}
      {e.recoupment_label && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-ink flex-shrink-0"><Tag size={9} className="inline" /> {e.recoupment_label}</span>}
      {socials.length > 0 && <span title={socials.map(s => `${s.platform} ${s.handle}`).join(', ')} className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0"><AtSign size={9} className="inline" /> {socials.length}</span>}
      {e.cobrand && <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/10 text-info flex-shrink-0">Cobrand</span>}
      {e.prior_year_tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-elev text-ink-muted flex-shrink-0">{e.prior_year_tag}</span>}
      <span className="text-ink font-medium tabular-nums flex-shrink-0" title={STATE_LABEL[e.state]}>
        {moneyOrig(e.amount, e.currency)}
        {e.currency !== 'USD' && <span className="text-[10px] text-ink-faint ml-1">≈ {money(e.amount_usd)}</span>}
      </span>
      <button onClick={() => onPatch({ payment_status: e.payment_status === 'Paid' ? 'Unpaid' : 'Paid' }, 'Payment status changed')}
        title="Toggle paid" className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${e.payment_status === 'Paid' ? 'bg-success/10 text-success' : 'bg-elev text-ink-muted'}`}>{e.payment_status === 'Paid' ? 'Paid' : 'Unpaid'}</button>
      <div className="relative flex-shrink-0">
        <button onClick={onUfr} title="Uploaded for recoupment — the upload date decides the statement"
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${e.ufr ? 'bg-success/10 text-success' : 'bg-elev text-ink-muted hover:bg-brand-500/10'}`}>
          {e.ufr && <Check size={10} />} UFR
        </button>
        {e.ufr && (
          <button onClick={() => setMonthOpen(v => !v)} title={e.statement_month ? `Statement ${statementLabel(e.statement_month)} — covers ${statementWindowLabel(e.statement_month)}. Click to move.` : 'No upload date — belongs to no statement. Click to set one.'}
            className="ml-1 text-[10px] font-semibold text-brand-ink hover:underline">{e.statement_month ? statementLabel(e.statement_month) : 'Unstamped'}</button>
        )}
        {monthOpen && (
          <select autoFocus value={e.statement_month || ''} onBlur={() => setMonthOpen(false)}
            onChange={ev => { setMonthOpen(false); if (ev.target.value && ev.target.value !== e.statement_month) onMove(ev.target.value) }}
            className="input !py-1 text-xs !w-32 absolute right-0 top-6 z-20">
            <option value="">Move to…</option>
            {recentStatementMonths().map(m => <option key={m} value={m}>{statementLabel(m)}</option>)}
          </select>
        )}
      </div>
      <button onClick={() => onPatch({ recoupable: false }, 'Marked non-recoupable')} title="Mark not recoupable" className="text-ink-faint hover:text-danger flex-shrink-0 text-[10px] font-semibold">R−</button>
      <button onClick={() => onPatch({ cobrand: !e.cobrand, ...(e.cobrand ? {} : { category: 'Marketing' }) }, 'Cobrand toggled')} title="Cobrand (forces category Marketing)" className="text-ink-faint hover:text-brand-ink flex-shrink-0 text-[10px] font-semibold">CB</button>
      {(e.invoice_filename || e.receipt_filename) && (
        <button onClick={() => onFile(e.invoice_filename ? 'invoice' : 'receipt')} title={e.invoice_filename || e.receipt_filename} className="text-ink-faint hover:text-brand-ink flex-shrink-0"><Paperclip size={12} /></button>
      )}
      <button onClick={onSplit} title="Split across artists" className="text-ink-faint hover:text-brand-ink flex-shrink-0"><Scissors size={12} /></button>
      <button onClick={onFlag} title={e.flag_reason || (e.flagged ? 'Flagged — click to clear' : 'Flag this entry')} className={`flex-shrink-0 ${e.flagged ? 'text-warning' : 'text-ink-faint hover:text-warning'}`}><Flag size={12} /></button>
      <button onClick={onTagYear} title="Tag prior year" className="text-ink-faint hover:text-brand-ink flex-shrink-0"><CalendarClock size={12} /></button>
      <button onClick={onDelete} title="Delete" className="text-ink-faint hover:text-danger flex-shrink-0"><Trash2 size={12} /></button>
      <Link to={`/ledger?focus=${e.id}`} title="View in ledger" className="text-ink-faint hover:text-brand-ink flex-shrink-0"><ExternalLink size={12} /></Link>
    </div>
  )
}

function BulkBar({ rows, busy, labels, onClear, onAddToPlan, onMarkUfr, onUnmarkUfr, onSetLabel, onMove, onTagYear }) {
  const [label, setLabel] = useState('')
  const [month, setMonth] = useState('')
  const cur = totalsByCurrency(rows, e => Number(e.amount || 0))
  const usd = rows.reduce((s, e) => s + Number(e.amount_usd || 0), 0)
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 lg:left-64 border-t border-rule bg-card px-4 py-2.5 flex flex-wrap items-center gap-2 shadow-elevated">
      <span className="text-sm font-semibold text-ink">{rows.length} selected</span>
      <span className="text-xs text-ink-muted tabular-nums" title={moneyByCurrency(cur)}>{moneyByCurrency(cur)} <span className="text-ink-faint">≈ {money(usd)}</span></span>
      <span className="flex-1" />
      <input list="recoup-labels" value={label} onChange={e => setLabel(e.target.value)} placeholder="Recoupment label…" className="input !py-1.5 text-xs !w-44" />
      <datalist id="recoup-labels">{labels.map(l => <option key={l.label} value={l.label} />)}</datalist>
      <button disabled={busy || !label.trim()} onClick={() => onSetLabel(label.trim(), false)} className="btn-secondary !py-1.5 text-xs">Set label</button>
      <button disabled={busy || !label.trim()} onClick={() => onSetLabel(label.trim(), true)} className="btn-secondary !py-1.5 text-xs">Set label &amp; mark UFR</button>
      <select value={month} onChange={e => { const m = e.target.value; setMonth(''); if (m) onMove(m) }} className="input !py-1.5 text-xs !w-32">
        <option value="">Move to…</option>
        {recentStatementMonths().map(m => <option key={m} value={m} title={statementWindowLabel(m)}>{statementLabel(m)}</option>)}
      </select>
      <button disabled={busy} onClick={onAddToPlan} title="Stage these into the recoupment plan — nothing is written until Planning's commit" className="btn-secondary !py-1.5 text-xs"><Layers size={12} /> Add to plan</button>
      <button disabled={busy} onClick={onTagYear} className="btn-secondary !py-1.5 text-xs">Prior year</button>
      <button disabled={busy} onClick={onUnmarkUfr} className="btn-secondary !py-1.5 text-xs">Un-claim</button>
      <button disabled={busy} onClick={onMarkUfr} className="btn-primary !py-1.5 text-xs">Mark UFR</button>
      <button onClick={onClear} className="text-xs font-semibold text-ink-muted hover:underline">Clear</button>
    </div>
  )
}

// Inline metadata editor — the row controls that do not fit on the row.
function EditRow({ entry, labels, artist, onClose, onSave }) {
  const [form, setForm] = useState({
    payee: entry.payee || '', category: entry.category || '', song: entry.song || '',
    recoupment_label: entry.recoupment_label || '', notes: entry.notes || '',
    social_handles: Array.isArray(entry.social_handles) ? entry.social_handles : [],
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  return (
    <Modal open onClose={onClose} title={`Edit — ${entry.payee || 'entry'}`} size="xl"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button disabled={saving} onClick={async () => {
          setSaving(true)
          await onSave({
            payee: form.payee.trim() || null, category: form.category || null, song: form.song.trim() || null,
            recoupment_label: form.recoupment_label.trim() || null, notes: form.notes.trim() || null,
            social_handles: form.social_handles.filter(s => String(s.handle || '').trim()),
          })
          setSaving(false)
        }} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-ink-muted">Payee<input value={form.payee} onChange={set('payee')} className="input !py-1.5 text-sm mt-1" /></label>
          <label className="text-xs font-semibold text-ink-muted">Song<input value={form.song} onChange={set('song')} className="input !py-1.5 text-sm mt-1" /></label>
          <label className="text-xs font-semibold text-ink-muted">Category
            <select value={form.category} onChange={set('category')} className="input !py-1.5 text-sm mt-1"><option value="">—</option><CategoryOptions /></select>
          </label>
          <label className="text-xs font-semibold text-ink-muted">Recoupment label
            <input list="recoup-labels-edit" value={form.recoupment_label} onChange={set('recoupment_label')} className="input !py-1.5 text-sm mt-1" />
            <datalist id="recoup-labels-edit">{labels.map(l => <option key={l.label} value={l.label} />)}</datalist>
          </label>
        </div>
        <label className="text-xs font-semibold text-ink-muted block">Notes<textarea value={form.notes} onChange={set('notes')} rows={2} className="input text-sm mt-1 w-full resize-y" /></label>
        <div>
          <p className="text-xs font-semibold text-ink-muted mb-1">Social handles</p>
          <SocialHandlesEditor value={form.social_handles} currency={entry.currency}
            onChange={(rows) => setForm(f => ({ ...f, social_handles: rows.map(r => ({ ...r, artist: r.artist || artist })) }))} />
        </div>
      </div>
    </Modal>
  )
}

function AddExpense({ artist, labels, onDone, onCancel, toast }) {
  const [form, setForm] = useState({ payee: '', description: '', song: '', category: '', amount: '', currency: 'USD', recoupment_label: '', paid: false, ufr: false })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const submit = async () => {
    if (!form.amount) { toast('Amount is required', 'error'); return }
    setSaving(true)
    try { await api.post('/financials/recoupments/add-expense', { ...form, artist }); toast('Recoupable expense added'); onDone() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  return (
    <div className="card p-3 mb-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
      <input className="input !py-1.5 text-sm" placeholder="Payee" value={form.payee} onChange={set('payee')} />
      <input className="input !py-1.5 text-sm" placeholder="Description (opt)" value={form.description} onChange={set('description')} />
      <input className="input !py-1.5 text-sm" placeholder="Song (opt)" value={form.song} onChange={set('song')} />
      <select className="input !py-1.5 text-sm" value={form.category} onChange={set('category')}><option value="">Category…</option><CategoryOptions /></select>
      <div className="flex gap-1">
        <input type="number" step="0.01" className="input !py-1.5 text-sm" placeholder="0.00" value={form.amount} onChange={set('amount')} />
        <select className="input !py-1.5 text-sm !w-20" value={form.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
      </div>
      <input list="recoup-labels-add" className="input !py-1.5 text-sm" placeholder="Recoupment label (opt)" value={form.recoupment_label} onChange={set('recoupment_label')} />
      <datalist id="recoup-labels-add">{labels.map(l => <option key={l.label} value={l.label} />)}</datalist>
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted"><input type="checkbox" checked={form.paid} onChange={set('paid')} /> Already paid</label>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted" title="Claim it on this month's statement as it is created"><input type="checkbox" checked={form.ufr} onChange={set('ufr')} /> Mark UFR</label>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={saving} onClick={submit} className="btn-primary !py-1.5 text-xs">{saving ? 'Adding…' : 'Add'}</button>
        <button onClick={onCancel} className="btn-secondary !py-1.5 text-xs">Cancel</button>
      </div>
    </div>
  )
}

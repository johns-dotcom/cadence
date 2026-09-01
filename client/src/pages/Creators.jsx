// Creator Payments — small PayPal payments to influencers that never have
// invoices. Three tabs over one dataset: the payments, the per-creator
// directory (W9/1099 exposure per calendar YEAR), and the move-in queue for
// rows born on Artist Campaigns / Recoupments.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRightLeft, Check, Info, Plus, Receipt, RefreshCw, Search, Users, X,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig } from '../utils/money'
import { recoupState, STATE_LABEL } from '../utils/recoupState'
import { STATE_TONE } from '../utils/statements'

const gapsFor = (r) => {
  const out = []
  if (!String(r.payee || '').trim()) out.push('a creator name')
  if (!(Number(r.amount) > 0)) out.push('an amount')
  if (!String(r.artist || '').trim()) out.push('an artist')
  if (!String(r.song || '').trim()) out.push('a song')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.vendor_email || ''))) out.push('an email')
  if (!String(r.paypal_handle || '').trim()) out.push('a PayPal handle')
  if (!String(r.socials || '').trim()) out.push('socials')
  return out
}
const parseSocials = (s) => String(s || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = x.match(/^([a-z/ ]+):\s*(.+)$/i)
  return m ? { platform: m[1].trim(), handle: m[2].trim() } : { platform: 'Instagram', handle: x }
})
const socialsText = (list) => (Array.isArray(list) && list.length
  ? list.map((h) => `${h.platform}: ${h.handle}`).join(' · ')
  : null)

export default function Creators() {
  const { toast } = useToast()
  const [tab, setTab] = useState('payments')
  const [data, setData] = useState(null)
  const [dir, setDir] = useState(null)
  const [conv, setConv] = useState(null)
  const [q, setQ] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [error, setError] = useState(null)
  const [payingId, setPayingId] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  // The search runs SERVER-side (the list is capped at 1000 rows, so filtering
  // the fetched page would quietly search a subset) and the header total is the
  // server's total for the query — the figure has to describe what is shown.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setError(null)
    try {
      const params = {}
      if (term) params.q = term
      if (creatorFilter) params.creator = creatorFilter
      const [p, d, c] = await Promise.all([
        api.get('/creators', { params }), api.get('/creators/directory'), api.get('/creators/convertible'),
      ])
      setData(p.data.data); setDir(d.data.data); setConv(c.data.data)
    } catch (err) { setError(err.response?.data?.error || 'Failed to load') }
  }, [term, creatorFilter])
  useEffect(() => { load() }, [load])

  // Mark-paid patches the row LOCALLY, never refetches — the list sorts by
  // payment_date and a refetch reorders it under the cursor. `payingId` is the
  // in-flight guard: a second click re-stamps paid_marked_at and re-fires the
  // FX stamp for a row that is already paid.
  const setPaid = async (row, paid) => {
    if (payingId) return
    setPayingId(row.id)
    try {
      const { data: r } = await api.put(`/creators/${row.id}`, { payment_status: paid ? 'Paid' : 'Unpaid' })
      setData((d) => ({
        ...d,
        rows: d.rows.map((x) => (x.id === row.id
          ? { ...x, payment_status: r.data.payment_status, payment_date: paid ? new Date().toISOString().slice(0, 10) : null }
          : x)),
      }))
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setPayingId(null) }
  }
  const del = async () => {
    const row = confirmDel
    setConfirmDel(null)
    try { await api.delete(`/creators/${row.id}`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  if (error) return (
    <div className="card p-10 text-center">
      <AlertTriangle size={28} className="text-warning mx-auto mb-3" />
      <p className="text-sm text-ink">Couldn't load creator payments</p>
      <p className="text-xs text-ink-muted mt-1">{error}</p>
      <button className="btn-secondary mt-4 inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={14} /> Retry</button>
    </div>
  )
  if (!data) return <div><PageHeader title="Creator Payments" /><div className="card p-2"><Skeleton.Table rows={8} cols={6} /></div></div>

  const rows = data.rows
  const missingBanner = dir?.summary?.w9_missing > 0
  const TABS = [
    ['payments', 'Payments', Receipt, rows.length],
    ['directory', 'Creators', Users, dir?.creators?.length || 0],
    ['movein', 'To move in', ArrowRightLeft, conv?.rows?.length || 0],
  ]

  return (
    <div>
      <PageHeader
        title="Creator Payments"
        subtitle="PayPal payments to creators — no invoices by design; they reconcile against the bank like everything else"
        action={<button className="btn-primary" onClick={() => setBatchOpen(true)}><Plus size={15} /> Log payments</button>}
      />

      {missingBanner && (
        <div className="card px-4 py-2.5 mb-4 border-l-4 border-l-warning flex items-start gap-2.5">
          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-ink">
            <strong>{dir.summary.w9_missing}</strong> creator{dir.summary.w9_missing === 1 ? '' : 's'} passed a 1099 threshold
            with no W9 on file ({money(dir.summary.w9_missing_value)} total).
            <span className="text-ink-muted"> A 1099 needs one. {dir.summary.threshold_note}.</span>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {TABS.map(([k, l, Icon, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === k ? 'bg-brand-600 text-white' : 'text-ink-muted hover:bg-elev'}`}>
            <Icon size={13} />{l}<span className={tab === k ? 'opacity-70' : 'text-ink-faint'}>{n}</span>
          </button>
        ))}
        {tab === 'payments' && (
          <div className="relative ml-auto flex items-center gap-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className="input !pl-8 !py-1.5 text-sm w-56" placeholder="Creator, email, handle, artist, song…" value={q} onChange={(e) => setQ(e.target.value)} />
            {/* The total for what is listed — the reason the search is a server
                query and not a filter over the fetched page. */}
            <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap" title="Total of the payments listed, in USD">{money(data.total)}</span>
          </div>
        )}
        {creatorFilter && (
          <button className="text-xs bg-brand-500/10 text-brand-ink rounded-full px-2.5 py-1 inline-flex items-center gap-1" onClick={() => { setCreatorFilter(''); setTab('payments') }}>
            {creatorFilter} <X size={11} />
          </button>
        )}
      </div>

      {tab === 'payments' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
              {['Date', 'Creator', 'PayPal', 'Artist · Song', 'Amount', 'Bank', ''].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-ink-muted">No creator payments{term || creatorFilter ? ' match' : ' yet — log the first with the button above'}.</td></tr>}
              {rows.map((r) => {
                const state = recoupState(r)
                return (
                  <tr key={r.id} className="hover:bg-elev">
                    <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{r.payment_date ? formatDate(r.payment_date) : <span className="text-warning">unpaid</span>}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-ink">{r.payee}</p>
                      <p className="text-[11px] text-ink-faint">{r.vendor_email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted font-mono text-xs">{r.paypal_handle}</td>
                    <td className="px-3 py-2.5 text-ink-muted max-w-[200px] truncate">{[r.artist, r.song].filter(Boolean).join(' · ')}</td>
                    <td className="px-3 py-2.5 tabular-nums font-medium text-ink whitespace-nowrap">
                      {money(r.amount_usd_calc)}
                      {r.currency !== 'USD' && <span className="block text-[10px] text-ink-faint font-normal">{moneyOrig(r.amount, r.currency)}</span>}
                    </td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATE_TONE[state].chip}`}>{STATE_LABEL[state]}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end text-ink-faint whitespace-nowrap">
                        {r.payment_status !== 'Paid'
                          ? <button className="btn-secondary !py-1 text-xs" disabled={payingId === r.id} onClick={() => setPaid(r, true)}>{payingId === r.id ? '…' : 'Mark paid'}</button>
                          : <button className="hover:text-danger p-1 text-[11px] disabled:opacity-40" disabled={payingId === r.id} title="Back to unpaid" onClick={() => setPaid(r, false)}>{payingId === r.id ? '…' : 'undo'}</button>}
                        <Link to={`/ledger?focus=${r.id}`} className="hover:text-brand-ink p-1 text-[10px] font-bold" title="Open in ledger">L</Link>
                        <button className="hover:text-danger p-1" title="Delete" onClick={() => setConfirmDel(r)}><X size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'directory' && dir && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
              {['Creator', 'PayPal', 'Socials', 'Artists', 'Payments', 'Last paid', 'Total (USD)', 'W9'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {dir.creators.map((c) => (
                <tr key={c.key} className="hover:bg-elev cursor-pointer" onClick={() => { setCreatorFilter(c.name); setTab('payments') }}>
                  <td className="px-3 py-2.5"><p className="font-medium text-ink">{c.name}</p><p className="text-[11px] text-ink-faint">{c.email}</p></td>
                  <td className="px-3 py-2.5 text-ink-muted font-mono text-[11px]">{c.paypal_handle || '—'}</td>
                  {/* Socials are a REQUIRED field on this page and the move-in
                      queue arrives without them — this column is where the gap
                      is visible and gets filled. */}
                  <td className="px-3 py-2.5 text-[11px] text-ink-muted max-w-[180px] truncate" title={socialsText(c.social_handles) || ''}>
                    {socialsText(c.social_handles) || <span className="text-ink-faint">none</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted text-xs max-w-[180px] truncate">{c.artists.join(', ') || '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted tabular-nums">{c.n}</td>
                  <td className="px-3 py-2.5 text-ink-muted text-[11px] tabular-nums whitespace-nowrap">{c.last_payment ? formatDate(c.last_payment) : '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums font-medium text-ink">{money(c.total)}
                    {c.years_over.map((y) => <span key={y.year} className="block text-[10px] text-ink-faint font-normal">{y.year}: {money(y.total)} (≥ ${y.threshold})</span>)}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.w9_missing
                      ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-danger/10 text-danger" title={`Over the threshold in ${c.years_over.map((y) => y.year).join(', ')}`}>Missing — 1099 needs one</span>
                      : c.w9_on_file
                        ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-success/10 text-success">On file</span>
                        : <span className="text-[10px] text-ink-faint">under threshold</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'movein' && conv && <MoveInTab rows={conv.rows} summary={conv.summary} toast={toast} onDone={load} />}

      {batchOpen && <BatchModal onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); load() }} toast={toast} />}

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={del}
        title="Delete this creator payment?"
        message={confirmDel ? `Delete the ${money(confirmDel.amount_usd_calc)} payment to ${confirmDel.payee}${confirmDel.currency !== 'USD' ? ` (${moneyOrig(confirmDel.amount, confirmDel.currency)})` : ''}? It leaves the recoupment and campaign totals it is counted in.` : ''}
      />
    </div>
  )
}

// Rows born on Artist Campaigns / Recoupments that are really creator
// payments. "Convert" pre-selects only clean proposals; review rows are
// visible and selectable but never selected FOR you.
function MoveInTab({ rows, summary, toast, onDone }) {
  const proposed = useMemo(() => new Set(rows.filter((r) => r.proposed === 'convert').map((r) => r.id)), [rows])
  const [sel, setSel] = useState(proposed)
  // Re-derive on every reload. Seeding once in a useState initializer leaves
  // ghost ids behind after a convert, and the "Move N in" count then describes
  // a set that no longer exists. (On mount this sets the identical Set
  // reference, which React bails out of.)
  useEffect(() => { setSel(proposed) }, [proposed])
  const [busy, setBusy] = useState(false)
  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Which gaps are UNIVERSAL across the movers. Artist Campaigns and
  // Recoupments never collected contact details, so nearly every row is missing
  // email, PayPal handle and socials — printing that on all of them is a wall of
  // identical text that hides the gaps which actually differ. The shared ones go
  // in the banner once; only what varies stays on the row.
  const universal = useMemo(() => {
    const movers = rows.filter((r) => r.proposed === 'convert')
    if (!movers.length) return new Set()
    return new Set(['email', 'PayPal handle', 'socials', 'song', 'artist']
      .filter((g) => movers.every((r) => (r.missing_info || []).includes(g))))
  }, [rows])

  const convert = async () => {
    setBusy(true)
    try {
      const { data: r } = await api.post('/creators/convert', { ids: [...sel] })
      toast(`${r.data.converted} moved in${r.data.relabelled_matches ? ` · ${r.data.relabelled_matches} bank match${r.data.relabelled_matches === 1 ? '' : 'es'} now record the creator disposition, so they stop counting as invoice-backed` : ''}`)
      onDone()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setBusy(false) }
  }

  if (!rows.length) return <div className="card p-10 text-center"><Users size={28} className="text-ink-faint mx-auto mb-3" /><p className="text-sm text-ink-muted">Nothing added on the campaign or recoupment pages looks like a creator payment.</p></div>

  return (
    <div>
      <div className="card p-3 mb-3 flex items-start gap-2.5">
        <Info size={14} className="text-ink-faint shrink-0 mt-0.5" />
        <div className="text-[12.5px] text-ink-muted">
          These were added on <strong className="text-ink">Artist Campaigns</strong> and <strong className="text-ink">Recoupments</strong>. None has an
          invoice, so none of them can be matched to a bank line where it sits — moving them here is what makes them reconcilable. Reversible.
          {summary && (
            <div className="text-ink-faint mt-1">
              {summary.convert} look like creator payments ({money(summary.convert_value)}).
              {summary.review > 0 && <> {summary.review} need a look first ({money(summary.review_value)}) — ad spend and advances are not creator payments.</>}
              {summary.already_matched > 0 && <> {summary.already_matched} {summary.already_matched === 1 ? 'is' : 'are'} already matched to a bank line; moving those also corrects the match so they stop counting as invoice-backed.</>}
              {universal.size > 0 && (
                <div className="mt-1">
                  Every one of them is missing <strong className="text-ink">{[...universal].join(', ')}</strong> — those pages never asked for it.
                  They move in flagged, and the Creators tab is where you fill it in.
                </div>
              )}
            </div>
          )}
        </div>
        <button className="btn-primary !py-1.5 text-xs ml-auto shrink-0" disabled={busy || !sel.size} onClick={convert}>
          <Check size={13} /> {busy ? 'Moving…' : `Move ${sel.size} in`}
        </button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-ink-faint uppercase tracking-wider">
            {['', 'Payee', 'Artist · Song', 'Category', 'Amount', 'From', 'Notes'].map((h, i) => <th key={i} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-divider">
            {rows.map((r) => {
              const review = r.proposed === 'review'
              const own = (r.missing_info || []).filter((g) => !universal.has(g))
              return (
                <tr key={r.id} className={review ? 'bg-warning/10' : 'hover:bg-elev'}>
                  <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-3 py-2 font-medium text-ink">{r.payee}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {r.artist || <span className="text-ink-faint">no artist</span>}
                    {r.song && <span className="text-ink-faint"> · {r.song}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-muted text-[11px]">{r.category || '—'}</td>
                  <td className="px-3 py-2 tabular-nums font-medium text-ink whitespace-nowrap">{money(r.usd)}</td>
                  <td className="px-3 py-2 text-[11px] text-ink-faint whitespace-nowrap">{r.entry_source === 'recoupment' ? 'Recoupments' : 'Artist Campaigns'}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {review && <span className="text-warning font-semibold">{r.review_reasons.join(' · ')}</span>}
                    {!review && own.length > 0 && <span className="text-ink-faint">missing {own.join(', ')}</span>}
                    {r.already_matched && <span className="text-success ml-1.5">already matched</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BatchModal({ onClose, onDone, toast }) {
  const [header, setHeader] = useState({ paid: true, payment_date: new Date().toISOString().slice(0, 10), is_bulk_deal: false, artist: '', song: '' })
  const blank = () => ({ payee: '', vendor_email: '', paypal_handle: '', socials: '', amount: '', artist: '', song: '', currency: 'USD' })
  const [rowsState, setRows] = useState([blank()])
  const [busy, setBusy] = useState(false)
  const upd = (i, k) => (e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))
  const effective = (r) => ({ ...r, artist: r.artist || header.artist, song: r.song || header.song })
  const allGaps = rowsState.map((r) => gapsFor(effective(r)))
  const batchTotal = rowsState.reduce((t, r) => t + (Number(r.amount) || 0), 0)
  // The first row that is not ready, named. Scanning six fields across five
  // cards to find the one empty box is the reason this hint exists.
  const firstGap = (() => {
    const bad = allGaps.map((g, i) => [i + 1, g]).filter(([, g]) => g.length)
    if (!bad.length) return null
    const [n, g] = bad[0]
    return `Creator ${n} still needs ${g.join(', ')}${bad.length > 1 ? ` (and ${bad.length - 1} more incomplete)` : ''}.`
  })()

  const save = async () => {
    setBusy(true)
    try {
      await api.post('/creators/batch', {
        payments: rowsState.map((r) => ({ ...effective(r), amount: Number(r.amount), social_handles: parseSocials(r.socials) })),
        payment_status: header.paid ? 'Paid' : 'Unpaid',
        payment_date: header.payment_date,
        is_bulk_deal: header.is_bulk_deal,
      })
      toast(`${rowsState.length} payment${rowsState.length === 1 ? '' : 's'} logged`)
      onDone()
    } catch (err) { toast(err.response?.data?.error || 'Failed — nothing was written', 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-2xl p-5 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-ink">Log creator payments</h3><button onClick={onClose} className="text-ink-faint hover:text-ink"><X size={18} /></button></div>
        <p className="text-xs text-ink-faint mb-4">Each creator becomes its own row — PayPal sends one transaction per recipient, so five creators are five bank lines. All-or-nothing: a bad row blocks the whole batch.</p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={header.paid} onChange={(e) => setHeader((h) => ({ ...h, paid: e.target.checked }))} /> Already paid</label>
          {header.paid && <div><label className="label">Paid on</label><input type="date" className="input !py-1.5" value={header.payment_date} onChange={(e) => setHeader((h) => ({ ...h, payment_date: e.target.value }))} /></div>}
          <label className="inline-flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" checked={header.is_bulk_deal} onChange={(e) => setHeader((h) => ({ ...h, is_bulk_deal: e.target.checked }))} /> Bulk deal</label>
          <div><label className="label">Artist (default)</label><input className="input !py-1.5" value={header.artist} onChange={(e) => setHeader((h) => ({ ...h, artist: e.target.value }))} /></div>
          <div><label className="label">Song (default)</label><input className="input !py-1.5" value={header.song} onChange={(e) => setHeader((h) => ({ ...h, song: e.target.value }))} /></div>
        </div>
        <div className="space-y-4">
          {rowsState.map((r, i) => (
            <div key={i} className="rounded-lg border border-rule p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">Creator {i + 1}</p>
                {rowsState.length > 1 && <button className="text-ink-faint hover:text-danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><X size={13} /></button>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <input className="input !py-1.5 text-sm" placeholder="Creator name *" value={r.payee} onChange={upd(i, 'payee')} />
                <input className="input !py-1.5 text-sm" placeholder="Email *" value={r.vendor_email} onChange={upd(i, 'vendor_email')} />
                <input className="input !py-1.5 text-sm" placeholder="PayPal handle *" value={r.paypal_handle} onChange={upd(i, 'paypal_handle')} />
                <input className="input !py-1.5 text-sm" placeholder="Amount *" type="number" value={r.amount} onChange={upd(i, 'amount')} />
                <input className="input !py-1.5 text-sm" placeholder={header.artist ? `Artist (${header.artist})` : 'Artist *'} value={r.artist} onChange={upd(i, 'artist')} />
                <input className="input !py-1.5 text-sm" placeholder={header.song ? `Song (${header.song})` : 'Song *'} value={r.song} onChange={upd(i, 'song')} />
                <input className="input !py-1.5 text-sm col-span-2 sm:col-span-3" placeholder='Socials * — "tiktok: @x, instagram: @y"' value={r.socials} onChange={upd(i, 'socials')} />
              </div>
              {allGaps[i].length > 0 && r.payee && <p className="text-[11px] text-warning mt-1.5">still needs: {allGaps[i].join(', ')}</p>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-divider">
          {/* Several creators on ONE song is the common case; retyping the song
              per row is how a row ends up unattributed, so the last row's
              artist and song carry forward. */}
          <button className="btn-secondary !py-1.5 text-xs" onClick={() => setRows((rs) => [...rs, { ...blank(), artist: rs[rs.length - 1]?.artist || '', song: rs[rs.length - 1]?.song || '' }])}><Plus size={13} /> Another creator</button>
          <span className="text-sm text-ink-muted">
            {rowsState.length} payment{rowsState.length === 1 ? '' : 's'} · <strong className="text-ink tabular-nums">{money(batchTotal)}</strong>
          </span>
          <span className="text-[11px] text-ink-faint flex-1 min-w-[12rem]">
            {firstGap || 'Each creator is a separate PayPal payment and matches its own statement line.'}
          </span>
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || !!firstGap} onClick={save}>{busy ? 'Saving…' : `Log ${rowsState.length}`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

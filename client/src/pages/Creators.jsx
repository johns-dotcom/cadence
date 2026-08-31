// Creator Payments — small PayPal payments to influencers that never have
// invoices. Three tabs over one dataset: the payments, the per-creator
// directory (W9/1099 exposure per calendar YEAR), and the move-in queue for
// rows born on Artist Campaigns / Recoupments.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Plus, RefreshCw, Search, Undo2, Users, X } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../utils/dates'
import { money, moneyOrig } from '../utils/money'
import { recoupState, STATE_LABEL, STATE_TONE } from '../utils/recoupState'

const REQUIRED = ['payee', 'amount', 'artist', 'song', 'vendor_email', 'paypal_handle', 'socials']
const gapsFor = (r) => {
  const out = []
  if (!String(r.payee || '').trim()) out.push('creator name')
  if (!(Number(r.amount) > 0)) out.push('amount')
  if (!String(r.artist || '').trim()) out.push('artist')
  if (!String(r.song || '').trim()) out.push('song')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.vendor_email || ''))) out.push('email')
  if (!String(r.paypal_handle || '').trim()) out.push('PayPal handle')
  if (!String(r.socials || '').trim()) out.push('socials')
  return out
}
const parseSocials = (s) => String(s || '').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = x.match(/^([a-z/ ]+):\s*(.+)$/i)
  return m ? { platform: m[1].trim(), handle: m[2].trim() } : { platform: 'Instagram', handle: x }
})

export default function Creators() {
  const { toast } = useToast()
  const { label, user } = useAuth()
  const [tab, setTab] = useState('payments')
  const [data, setData] = useState(null)
  const [dir, setDir] = useState(null)
  const [conv, setConv] = useState(null)
  const [q, setQ] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [p, d, c] = await Promise.all([
        api.get('/creators'), api.get('/creators/directory'), api.get('/creators/convertible'),
      ])
      setData(p.data.data); setDir(d.data.data); setConv(c.data.data)
    } catch (err) { setError(err.response?.data?.error || 'Failed to load') }
  }, [])
  useEffect(() => { load() }, [load])

  // Mark-paid patches the row LOCALLY, never refetches — the list sorts by
  // payment_date and a refetch reorders it under the cursor.
  const setPaid = async (row, paid) => {
    try {
      const { data: r } = await api.put(`/creators/${row.id}`, { payment_status: paid ? 'Paid' : 'Unpaid' })
      setData((d) => ({
        ...d,
        rows: d.rows.map((x) => (x.id === row.id
          ? { ...x, payment_status: r.data.payment_status, payment_date: paid ? new Date().toISOString().slice(0, 10) : null }
          : x)),
      }))
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const del = async (row) => {
    if (!window.confirm(`Delete the ${moneyOrig(row.amount, row.currency)} payment to ${row.payee}?`)) return
    try { await api.delete(`/creators/${row.id}`); load() }
    catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }

  const shown = useMemo(() => {
    let rows = data?.rows || []
    if (creatorFilter) rows = rows.filter((r) => String(r.payee || '').toLowerCase() === creatorFilter.toLowerCase())
    if (q.trim()) {
      const s = q.toLowerCase()
      rows = rows.filter((r) => [r.payee, r.artist, r.song, r.paypal_handle, r.vendor_email].some((v) => String(v || '').toLowerCase().includes(s)))
    }
    return rows
  }, [data, q, creatorFilter])

  if (error) return (
    <div className="card p-10 text-center">
      <AlertTriangle size={28} className="text-warning mx-auto mb-3" />
      <p className="text-sm text-ink">Couldn't load creator payments</p>
      <p className="text-xs text-ink-muted mt-1">{error}</p>
      <button className="btn-secondary mt-4 inline-flex items-center gap-1.5" onClick={load}><RefreshCw size={14} /> Retry</button>
    </div>
  )
  if (!data) return <div><PageHeader title="Creator Payments" /><div className="card p-2"><Skeleton.Table rows={8} cols={6} /></div></div>

  const missingBanner = dir?.summary?.w9_missing > 0

  return (
    <div>
      <PageHeader
        title="Creator Payments"
        subtitle="PayPal payments to creators — no invoices by design; they reconcile against the bank like everything else"
        action={<button className="btn-primary" onClick={() => setBatchOpen(true)}><Plus size={15} /> Log payments</button>}
      />

      {missingBanner && (
        <div className="card px-4 py-2.5 mb-4 border-amber-200 bg-amber-50/60 text-sm text-amber-800">
          {dir.summary.w9_missing} creator{dir.summary.w9_missing === 1 ? '' : 's'} passed a 1099 threshold with no W9 on file ({money(dir.summary.w9_missing_value)} total). {dir.summary.threshold_note}.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 mb-4">
        {[['payments', `Payments (${data.rows.length})`], ['directory', `Creators (${dir?.creators?.length || 0})`], ['movein', `To move in (${conv?.rows?.length || 0})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>{l}</button>
        ))}
        {tab === 'payments' && (
          <div className="relative ml-auto">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input !pl-8 !py-1.5 text-sm w-48" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        {creatorFilter && (
          <button className="text-xs bg-brand-500/10 text-brand-700 rounded-full px-2.5 py-1 inline-flex items-center gap-1" onClick={() => { setCreatorFilter(''); setTab('payments') }}>
            {creatorFilter} <X size={11} />
          </button>
        )}
      </div>

      {tab === 'payments' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {['Date', 'Creator', 'PayPal', 'Artist · Song', 'Amount', 'Bank', ''].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-gray-400">No creator payments{q ? ' match' : ' yet — log the first with the button above'}.</td></tr>}
              {shown.map((r) => {
                const state = recoupState(r)
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.payment_date ? formatDate(r.payment_date) : <span className="text-amber-600">unpaid</span>}</td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-ink">{r.payee}</p>
                      <p className="text-[11px] text-gray-400">{r.vendor_email}</p>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{r.paypal_handle}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[200px] truncate">{[r.artist, r.song].filter(Boolean).join(' · ')}</td>
                    <td className="px-3 py-2.5 tabular-nums font-medium text-ink whitespace-nowrap">
                      {money(r.amount_usd_calc)}
                      {r.currency !== 'USD' && <span className="block text-[10px] text-gray-400 font-normal">{moneyOrig(r.amount, r.currency)}</span>}
                    </td>
                    <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end text-gray-400 whitespace-nowrap">
                        {r.payment_status !== 'Paid'
                          ? <button className="btn-secondary !py-1 text-xs" onClick={() => setPaid(r, true)}>Mark paid</button>
                          : <button className="hover:text-danger p-1 text-[11px]" title="Back to unpaid" onClick={() => setPaid(r, false)}>undo</button>}
                        <Link to={`/ledger?focus=${r.id}`} className="hover:text-brand-600 p-1 text-[10px] font-bold" title="Open in ledger">L</Link>
                        <button className="hover:text-danger p-1" onClick={() => del(r)}><X size={13} /></button>
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
            <thead><tr className="bg-page/50 border-b border-divider text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {['Creator', 'Artists', 'Payments', 'Total (USD)', 'W9'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-divider">
              {dir.creators.map((c) => (
                <tr key={c.key} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setCreatorFilter(c.name); setTab('payments') }}>
                  <td className="px-3 py-2.5"><p className="font-medium text-ink">{c.name}</p><p className="text-[11px] text-gray-400">{c.email}{c.paypal_handle ? ` · ${c.paypal_handle}` : ''}</p></td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{c.artists.join(', ')}</td>
                  <td className="px-3 py-2.5 text-gray-500">{c.n}</td>
                  <td className="px-3 py-2.5 tabular-nums font-medium text-ink">{money(c.total)}
                    {c.years_over.map((y) => <span key={y.year} className="block text-[10px] text-gray-400 font-normal">{y.year}: {money(y.total)} (≥ ${y.threshold})</span>)}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.w9_missing
                      ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">Missing — 1099 needs one</span>
                      : c.w9_on_file
                        ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">On file</span>
                        : <span className="text-[10px] text-gray-400">not needed yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'movein' && conv && <MoveInTab rows={conv.rows} toast={toast} onDone={load} />}

      {batchOpen && <BatchModal onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); load() }} toast={toast} />}
    </div>
  )
}

// Rows born on Artist Campaigns / Recoupments that are really creator
// payments. "Convert" pre-selects only clean proposals; review rows are
// visible and selectable but never selected FOR you.
function MoveInTab({ rows, toast, onDone }) {
  const [sel, setSel] = useState(() => new Set(rows.filter((r) => r.proposed === 'convert').map((r) => r.id)))
  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  const convert = async () => {
    try {
      const { data: r } = await api.post('/creators/convert', { ids: [...sel] })
      toast(`${r.data.converted} moved in · ${r.data.relabelled_matches} bank matches relabelled`)
      onDone()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  if (!rows.length) return <div className="card p-10 text-center"><Users size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">Nothing added on the campaign or recoupment pages looks like a creator payment.</p></div>
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400">Moving a row in relabels its bank match so it stops counting as invoice-backed. Reversible.</p>
        <button className="btn-primary !py-1.5 text-xs" disabled={!sel.size} onClick={convert}><Check size={13} /> Move {sel.size} in</button>
      </div>
      <div className="card divide-y divide-divider">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
            <div className="flex-1 min-w-0">
              <p className="text-ink truncate">{r.payee} <span className="text-gray-400">· {[r.artist, r.song].filter(Boolean).join(' · ')} · from {r.entry_source === 'recoupment' ? 'Recoupments' : 'Artist Campaigns'}</span></p>
              {r.proposed === 'review' && <p className="text-[11px] text-amber-600">{r.review_reasons.join(' · ')}</p>}
              {r.missing_info.length > 0 && <p className="text-[11px] text-gray-400">missing: {r.missing_info.join(', ')}</p>}
            </div>
            <span className="tabular-nums text-gray-600">{money(r.usd)}</span>
          </div>
        ))}
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
        <div className="flex items-center justify-between mb-1"><h3 className="font-bold text-ink">Log creator payments</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <p className="text-xs text-gray-400 mb-4">Each creator becomes its own row — PayPal sends one transaction per recipient, so five creators are five bank lines. All-or-nothing: a bad row blocks the whole batch.</p>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={header.paid} onChange={(e) => setHeader((h) => ({ ...h, paid: e.target.checked }))} /> Already paid</label>
          {header.paid && <div><label className="label">Paid on</label><input type="date" className="input !py-1.5" value={header.payment_date} onChange={(e) => setHeader((h) => ({ ...h, payment_date: e.target.value }))} /></div>}
          <label className="inline-flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={header.is_bulk_deal} onChange={(e) => setHeader((h) => ({ ...h, is_bulk_deal: e.target.checked }))} /> Bulk deal</label>
          <div><label className="label">Artist (default)</label><input className="input !py-1.5" value={header.artist} onChange={(e) => setHeader((h) => ({ ...h, artist: e.target.value }))} /></div>
          <div><label className="label">Song (default)</label><input className="input !py-1.5" value={header.song} onChange={(e) => setHeader((h) => ({ ...h, song: e.target.value }))} /></div>
        </div>
        <div className="space-y-4">
          {rowsState.map((r, i) => (
            <div key={i} className="rounded-lg border border-rule p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-400 uppercase">Creator {i + 1}</p>
                {rowsState.length > 1 && <button className="text-gray-300 hover:text-danger" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><X size={14} /></button>}
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
              {allGaps[i].length > 0 && r.payee && <p className="text-[11px] text-amber-600 mt-1.5">still needs: {allGaps[i].join(', ')}</p>}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-4">
          <button className="btn-secondary" onClick={() => setRows((rs) => [...rs, { ...blank(), artist: '', song: '' }])}><Plus size={14} /> Another creator</button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={busy || allGaps.some((g) => g.length)} onClick={save}>{busy ? 'Saving…' : `Log ${rowsState.length}`}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

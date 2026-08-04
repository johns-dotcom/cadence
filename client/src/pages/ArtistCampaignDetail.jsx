import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Download, Plus, Flag, Check, FolderCheck, Eye, Link2, Ban, EyeOff,
  ExternalLink, MessageSquare, X, CheckCircle2, Circle, DollarSign,
} from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { formatDate } from '../utils/dates'
import { EXPENSE_CATEGORIES, CURRENCIES } from '../constants'

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const songLabel = (k) => k === '__no_song__' ? '(no song)' : k
const PRIORITY_CHIP = { High: 'bg-rose-100 text-rose-700', Medium: 'bg-amber-100 text-amber-700', Low: 'bg-sky-100 text-sky-700' }

// Provenance / status row wash (flag outranks finished).
function rowWash(en) {
  if (en.flagged) return 'bg-amber-50'
  if (en.not_campaign) return 'bg-gray-50 opacity-60'
  if (en.item_finished) return 'bg-emerald-50'
  if (en.entry_source === 'artist_campaigns') return 'bg-indigo-50/50'
  if (en.entry_source === 'recoupments') return 'bg-purple-50/50'
  return ''
}

export default function ArtistCampaignDetail() {
  const { artist } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(null) // song prefill or ''
  const [preview, setPreview] = useState(null)
  const [thread, setThread] = useState(null) // { id, comments, body }

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/artist-campaigns/${encodeURIComponent(artist)}`).then(r => setData(r.data.data)).catch(() => toast('Failed to load', 'error')).finally(() => setLoading(false))
  }, [artist])
  useEffect(() => { load() }, [load])

  const meta = data?.meta || {}
  const setMeta = async (patch) => { try { await api.post('/artist-campaigns/artist-meta', { artist: data.artist, ...patch }); load() } catch { toast('Failed', 'error') } }
  const setRow = async (id, patch) => { try { await api.post(`/artist-campaigns/entries/${id}/set`, patch); load() } catch { toast('Failed', 'error') } }
  const songStatus = async (song, patch) => { try { await api.post('/artist-campaigns/song-status', { artist: data.artist, song, ...patch }); load() } catch { toast('Failed', 'error') } }
  const dismiss = async (id) => { try { await api.post('/artist-campaigns/dismiss', { expense_id: id }); load() } catch { toast('Failed', 'error') } }
  const notCampaign = async (id, on) => { try { await api.post('/artist-campaigns/not-campaign', { expense_id: id, value: on }); load() } catch { toast('Failed', 'error') } }
  const openFile = (id) => api.get(`/ledger/entries/${id}/file/invoice`).then(({ data }) => setPreview(data.data.url)).catch(() => toast('No invoice', 'error'))
  const exportXlsx = async () => {
    try { const { data: blob } = await api.get(`/artist-campaigns/export?artist=${encodeURIComponent(artist)}`, { responseType: 'blob' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${artist}-campaigns.xlsx`; a.click(); URL.revokeObjectURL(url) } catch { toast('Export failed', 'error') }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!data) return <p className="text-sm text-gray-400">Not found.</p>

  const { entries, totals, categories, cobrand_by_song, releases, song_status } = data
  const catMax = categories.reduce((m, c) => Math.max(m, c.total), 0) || 1
  const statusByKey = Object.fromEntries((song_status || []).map(s => [s.song_key, s]))
  const releaseByKey = Object.fromEntries((releases || []).map(r => [String(r.project_name || '').trim().toLowerCase(), r]))

  // Group entries by song_key (children included — never parents-only).
  const groups = {}
  for (const e of entries) { (groups[e.song_key] ||= []).push(e) }
  const groupKeys = Object.keys(groups).sort((a, b) => (a === '__no_song__' ? 1 : b === '__no_song__' ? -1 : a.localeCompare(b)))
  const byCurr = totals.by_currency || {}
  const nativeLine = Object.entries(byCurr).map(([c, v]) => money(v, c)).join(' + ')

  return (
    <div>
      <div className="text-sm text-gray-400 mb-4"><button onClick={() => navigate('/artist-campaigns')} className="hover:text-gray-700">Artist Campaigns</button> <span className="mx-1">›</span> <span className="text-gray-600">{data.artist}</span></div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className={`text-2xl font-bold text-ink tracking-tight ${meta.complete ? 'line-through text-gray-400' : ''}`}>{data.artist}</h1>
        <select value={meta.priority || ''} onChange={e => setMeta({ priority: e.target.value || null })} className={`text-[11px] font-bold uppercase rounded-full px-2 py-0.5 border-0 cursor-pointer ${meta.priority ? PRIORITY_CHIP[meta.priority] : 'bg-gray-100 text-gray-400'}`}>
          <option value="">No priority</option><option>High</option><option>Medium</option><option>Low</option>
        </select>
        <button onClick={() => setMeta({ flagged: !meta.flagged, flag_reason: meta.flagged ? null : (window.prompt('Flag reason? (optional)') ?? '') })} className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.flagged ? 'bg-rose-50 text-rose-600 border-rose-200' : 'text-gray-500 border-rule hover:bg-gray-50'}`}><Flag size={13} /> {meta.flagged ? 'Flagged' : 'Flag'}</button>
        <button onClick={() => setMeta({ complete: !meta.complete })} className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.complete ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'text-gray-500 border-rule hover:bg-gray-50'}`}><Check size={13} /> Complete</button>
        <button onClick={() => setMeta({ ready_for_planning: !meta.ready_for_planning })} className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.ready_for_planning ? 'bg-brand-50 text-brand-700 border-brand-200' : 'text-gray-500 border-rule hover:bg-gray-50'}`}><FolderCheck size={13} /> Ready for planning</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAddOpen('')} className="btn-primary"><Plus size={15} /> Add expense</button>
          <button onClick={exportXlsx} className="btn-secondary"><Download size={15} /> Export</button>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase">Actual</p><p className="text-2xl font-bold text-ink mt-1">{usd(totals.spend)}</p>{nativeLine && <p className="text-[11px] text-gray-400 mt-0.5">{nativeLine}</p>}</div>
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase">Cobrand</p><p className="text-2xl font-bold text-ink mt-1">{usd(totals.cobrand)}</p></div>
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase">Unpaid</p><p className="text-2xl font-bold text-rose-600 mt-1">{usd(totals.unpaid)}</p><p className="text-[11px] text-gray-400 mt-0.5">{totals.unpaid_count} invoice{totals.unpaid_count === 1 ? '' : 's'}</p></div>
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase">Spends</p><p className="text-2xl font-bold text-ink mt-1">{entries.length}</p></div>
      </div>

      {/* Category breakdown + cobrand summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Spending by category</h2>
          {categories.length ? categories.map(c => (
            <div key={c.category} className="flex items-center gap-3 text-sm mb-2.5">
              <span className="w-28 flex-shrink-0 text-right text-gray-500 truncate">{c.category}</span>
              <div className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden"><div className="h-full bg-brand-500 rounded" style={{ width: `${Math.max(4, (c.total / catMax) * 100)}%` }} /></div>
              <span className="w-24 flex-shrink-0 text-right font-medium text-ink tabular-nums">{usd(c.total)}</span>
            </div>
          )) : <p className="text-sm text-gray-400">No spend.</p>}
        </div>
        {totals.cobrand > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Cobrand summary</h2>
            <p className="text-xl font-bold text-ink mb-3">{usd(totals.cobrand)}</p>
            <div className="space-y-1.5">
              {Object.entries(cobrand_by_song || {}).map(([sk, v]) => (
                <div key={sk} className="flex items-center justify-between text-sm"><span className="text-gray-500 truncate">{songLabel(sk)}</span><span className="font-medium text-ink tabular-nums">{usd(v)}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Song groups */}
      <div className="space-y-6">
        {groupKeys.map(sk => {
          const rows = groups[sk]
          const st = statusByKey[sk] || {}
          const rel = releaseByKey[sk]
          const groupTotal = rows.filter(r => !r.not_campaign).reduce((a, r) => a + (r.amount_usd || 0), 0)
          return (
            <div key={sk} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-divider">
                <h3 className={`font-bold text-ink ${st.finished ? 'line-through text-gray-400' : ''}`}>{songLabel(sk)}</h3>
                {rel && <span className="text-[11px] text-gray-400">{rel.release_type || 'Release'}{rel.release_date ? ` · ${formatDate(rel.release_date)}` : ''}</span>}
                <span className="text-sm font-semibold text-ink">{usd(groupTotal)}</span>
                {st.flagged && <span className="text-[10px] font-bold uppercase bg-rose-100 text-rose-700 rounded-full px-2 py-0.5 inline-flex items-center gap-1"><Flag size={9} /> Flagged</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => songStatus(sk === '__no_song__' ? '' : sk, { finished: !st.finished })} className={`inline-flex items-center gap-1 text-xs font-semibold ${st.finished ? 'text-emerald-600' : 'text-gray-500 hover:text-emerald-600'}`}>{st.finished ? <CheckCircle2 size={14} /> : <Circle size={14} />} Finished</button>
                  <button onClick={() => songStatus(sk === '__no_song__' ? '' : sk, { flagged: !st.flagged, flag_reason: st.flagged ? null : (window.prompt('Flag reason?') ?? '') })} className={`text-xs ${st.flagged ? 'text-rose-600' : 'text-gray-400 hover:text-rose-600'}`}><Flag size={14} /></button>
                  <button onClick={() => setAddOpen(sk === '__no_song__' ? '' : sk)} className="text-xs font-semibold text-brand-600 hover:underline"><Plus size={13} className="inline" /> Add</button>
                </div>
              </div>

              {/* Song notes */}
              <SongNotes key={sk + (st.notes || '')} initial={st.notes || ''} by={st.notes_updated_by} onSave={(v) => songStatus(sk === '__no_song__' ? '' : sk, { notes: v })} />

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-page/40 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    {['Date', 'Payee', 'Category', 'Socials', 'Amount', 'Paid', 'Rep', ''].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-divider">
                    {rows.map(en => (
                      <tr key={en.id} className={rowWash(en)}>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{formatDate(en.payment_date || en.invoice_date || en.created_at)}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-medium text-ink ${en.item_finished && !en.flagged ? 'line-through' : ''}`}>{en.payee}</span>
                          {en.not_campaign && <span className="ml-1.5 text-[9px] font-bold uppercase bg-gray-200 text-gray-500 rounded px-1">not campaign</span>}
                          {en.is_bulk_deal && <span className="ml-1.5 text-[9px] font-bold uppercase bg-violet-100 text-violet-600 rounded px-1">bulk{en.bulk_deal_quantity ? ` ${en.bulk_deal_completed || 0}/${en.bulk_deal_quantity}` : ''}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{en.category || '—'}</td>
                        <td className="px-3 py-2.5">{(Array.isArray(en.social_handles) ? en.social_handles : []).slice(0, 3).map((s, i) => <span key={i} className="inline-block text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5 mr-1">{s.handle || s.platform}</span>) || '—'}</td>
                        <td className="px-3 py-2.5 text-ink font-medium whitespace-nowrap">{money(en.amount, en.currency)}{en.currency !== 'USD' && <span className="text-[10px] text-gray-400 ml-1">≈{usd(en.amount_usd)}</span>}</td>
                        <td className="px-3 py-2.5"><span className={`text-xs font-semibold ${en.payment_status === 'Paid' ? 'text-emerald-600' : 'text-rose-600'}`}>{en.payment_status || 'Unpaid'}</span></td>
                        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{en.rep || '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-end whitespace-nowrap text-gray-400">
                            {en.has_invoice && <button onClick={() => openFile(en.id)} title="View invoice" className="hover:text-brand-600 p-1"><Eye size={14} /></button>}
                            <button onClick={() => setRow(en.id, { cobrand: !en.cobrand })} title="Cobrand" className={`p-1 ${en.cobrand ? 'text-brand-600' : 'hover:text-brand-600'}`}><Link2 size={14} /></button>
                            <button onClick={() => setRow(en.id, { item_finished: !en.item_finished })} title="Finished" className={`p-1 ${en.item_finished ? 'text-emerald-600' : 'hover:text-emerald-600'}`}><Check size={14} /></button>
                            <button onClick={() => setRow(en.id, { payment_status: en.payment_status === 'Paid' ? 'Unpaid' : 'Paid' })} title="Toggle paid" className="p-1 hover:text-emerald-600"><DollarSign size={14} /></button>
                            <button onClick={() => setRow(en.id, { flagged: !en.flagged, flag_reason: en.flagged ? null : (window.prompt('Flag reason?') ?? '') })} title="Flag" className={`p-1 ${en.flagged ? 'text-amber-600' : 'hover:text-amber-600'}`}><Flag size={14} /></button>
                            <button onClick={() => setThread({ id: en.id, payee: en.payee })} title="Comments" className={`p-1 relative ${en.comment_count ? 'text-brand-600' : 'hover:text-brand-600'}`}><MessageSquare size={14} />{en.comment_count > 0 && <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold">{en.comment_count}</span>}</button>
                            <button onClick={() => notCampaign(en.id, !en.not_campaign)} title="Not a campaign expense (cascades family)" className={`p-1 ${en.not_campaign ? 'text-gray-700' : 'hover:text-gray-700'}`}><EyeOff size={14} /></button>
                            <button onClick={() => dismiss(en.id)} title="Dismiss from this page" className="p-1 hover:text-danger"><Ban size={14} /></button>
                            <a href={`/ledger?focus=${en.id}`} title="Open in ledger" className="p-1 hover:text-brand-600"><ExternalLink size={14} /></a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
        {groupKeys.length === 0 && <div className="card p-10 text-center"><p className="text-sm text-gray-400">No campaign spend for this artist.</p></div>}
      </div>

      {addOpen !== null && <AddExpenseModal artist={data.artist} song={addOpen} onClose={() => setAddOpen(null)} onSaved={() => { setAddOpen(null); load() }} toast={toast} />}
      {thread && <CommentThread entry={thread} onClose={() => { setThread(null); load() }} toast={toast} />}
      {preview && (
        <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule"><span className="text-sm font-semibold text-ink">Invoice</span><div className="flex items-center gap-3"><a href={preview} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline">Open in new tab</a><button onClick={() => setPreview(null)} className="text-gray-400 hover:text-ink"><X size={18} /></button></div></div>
            <iframe src={preview} title="Invoice" className="flex-1 w-full bg-gray-100" />
          </div>
        </div>
      )}
    </div>
  )
}

// Song notes — autosaves on blur; local draft survives refetch (keyed remount).
function SongNotes({ initial, by, onSave }) {
  const [v, setV] = useState(initial)
  const [dirty, setDirty] = useState(false)
  return (
    <div className="px-4 py-2 border-b border-divider bg-page/20">
      <textarea value={v} onChange={e => { setV(e.target.value); setDirty(true) }} onBlur={() => { if (dirty) { onSave(v); setDirty(false) } }}
        placeholder="Song notes…" rows={1} className="w-full bg-transparent text-sm text-gray-600 outline-none resize-none" />
      {by && !dirty && <p className="text-[10px] text-gray-400">— {by}</p>}
    </div>
  )
}

// Per-expense comment thread modal.
function CommentThread({ entry, onClose, toast }) {
  const [comments, setComments] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get(`/artist-campaigns/entries/${entry.id}/comments`).then(r => setComments(r.data.data || [])).catch(() => setComments([])) }, [entry.id])
  const post = async () => {
    const b = body.trim(); if (!b || busy) return
    setBusy(true)
    try { const { data } = await api.post(`/artist-campaigns/entries/${entry.id}/comments`, { body: b }); setComments(c => [...(c || []), data.data]); setBody('') } catch { toast('Failed', 'error') } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[65] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-ink truncate">Comments · {entry.payee}</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <div className="flex-1 overflow-y-auto space-y-2 mb-3">
          {comments === null ? <p className="text-sm text-gray-400">Loading…</p> : comments.length ? comments.map(c => (
            <div key={c.id} className="text-sm"><span className="font-medium text-ink">{c.author}</span> <span className="text-[10px] text-gray-400">{formatDate(c.created_at)}</span><p className="text-gray-600 whitespace-pre-line">{c.body}</p></div>
          )) : <p className="text-sm text-gray-400">No comments yet.</p>}
        </div>
        <div className="flex items-end gap-2">
          <textarea value={body} onChange={e => setBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }} rows={1} placeholder="Comment…  @ to mention" className="input flex-1 resize-none text-sm" />
          <button onClick={post} disabled={busy || !body.trim()} className="btn-primary !py-2">Post</button>
        </div>
      </div>
    </div>
  )
}

// Add-expense modal — auto-approved + auto-paid + recoupable, stamped artist_campaigns.
function AddExpenseModal({ artist, song, onClose, onSaved, toast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ payee: '', amount: '', currency: 'USD', invoice_date: today, category: 'Marketing', song: song || '', rep: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }))
  const save = async () => {
    if (!f.payee.trim() || !f.amount) { toast('Payee and amount required', 'error'); return }
    setSaving(true)
    try {
      await api.post('/ledger/entries', { ...f, artist, vendor_name: f.payee, entry_source: 'artist_campaigns', artist_campaign: true, recoupable: true, payment_status: 'Paid', payment_date: f.invoice_date })
      toast('Expense added'); onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-[65] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-ink">Add campaign expense</h3><button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Payee *</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
          <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
          <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
          <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
          <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Adding…' : 'Add expense'}</button></div>
      </div>
    </div>
  )
}

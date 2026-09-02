import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Download, Plus, Flag, Check, FolderCheck, Eye, Link2, Ban, EyeOff, Users,
  ExternalLink, MessageSquare, X, CheckCircle2, Circle, DollarSign, AtSign, Scissors,
  Pencil, RotateCcw, ChevronDown, ChevronRight,
} from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import CampaignChat from '../components/CampaignChat'
import SplitModal from '../components/SplitModal'
import BankEvidenceDot from '../components/BankEvidenceDot'
import { Modal, Button, ConfirmDialog } from '../components/ui'
import { formatDate } from '../utils/dates'
import { CURRENCIES } from '../constants'
import CategoryOptions from '../components/CategoryOptions'
import useCollapsed from '../hooks/useCollapsed'
import useFocusRefetch from '../hooks/useFocusRefetch'
import Skeleton from '../components/Skeleton'

// Everything for one artist — deliberately UNSCOPED.
//
// This page is where you look at all of an artist's spend, so Legal and
// Recording rows arrive too. Each row carries `in_scope` and the FLAG (not a
// filter) decides which rows the TOTALS may include, which is what lets those
// totals agree with the artist's card. Same for `family_source`: a split child
// is inserted without `entry_source`, so a slice of a bank-born payment reads as
// an invoice — the row stays listed and the total leaves it out.

const usd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
const NO_SONG_KEY = '__no_song__'
const NO_SONG_SLUG = '__no-song__'
const slugOf = (k) => (k === NO_SONG_KEY ? NO_SONG_SLUG : encodeURIComponent(k))
const keyOfSlug = (s) => (!s || s === NO_SONG_SLUG ? NO_SONG_KEY : String(s).trim().toLowerCase())
const PRIORITIES = ['High', 'Medium', 'Low']
const PRIORITY_CHIP = { High: 'bg-rose-500/15 text-danger', Medium: 'bg-amber-500/15 text-warning', Low: 'bg-sky-500/15 text-sky-600' }

// Provenance / status row wash (flag outranks everything).
function rowWash(en) {
  if (en.flagged) return 'bg-amber-500/10'
  if (en.dismissed) return 'bg-elev opacity-50'
  if (en.not_campaign) return 'bg-elev opacity-60'
  if (!en.in_scope) return 'opacity-70'
  if (en.item_finished) return 'bg-emerald-500/10'
  if (en.entry_source === 'artist_campaigns') return 'bg-indigo-500/10'
  if (en.entry_source === 'recoupments') return 'bg-violet-500/10'
  return ''
}

export default function ArtistCampaignDetail() {
  const { artist, song: songParam } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [addOpen, setAddOpen] = useState(null)
  const [preview, setPreview] = useState(null)
  const [thread, setThread] = useState(null)
  const [socials, setSocials] = useState(null)
  const [splitEntry, setSplitEntry] = useState(null)
  const [assignFor, setAssignFor] = useState(null)
  const [linkFor, setLinkFor] = useState(null)
  const [renameFor, setRenameFor] = useState(null)
  const [notCampaignFor, setNotCampaignFor] = useState(null)
  const [undoDismiss, setUndoDismiss] = useState(null)
  const [sel, setSel] = useState(new Set())
  const { isCollapsed, toggleCollapsed } = useCollapsed(`ac:${artist}`)

  const load = useCallback(({ silent } = {}) => {
    if (!silent) setLoading(true)
    api.get(`/artist-campaigns/${encodeURIComponent(artist)}`, { params: showDismissed ? { include_dismissed: 'true' } : {} })
      .then((r) => { setData(r.data.data); setError(null) })
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false))
  }, [artist, showDismissed])
  useEffect(() => { load() }, [load])
  useFocusRefetch(() => load({ silent: true }))

  const setMeta = async (patch) => { try { await api.post('/artist-campaigns/artist-meta', { artist: data.artist, ...patch }); load({ silent: true }) } catch { toast('Failed', 'error') } }
  const setRow = async (id, patch) => { try { await api.post(`/artist-campaigns/entries/${id}/set`, patch); load({ silent: true }) } catch { toast('Failed', 'error') } }
  const songStatus = async (song, patch) => { try { await api.post('/artist-campaigns/song-status', { artist: data.artist, song, ...patch }); load({ silent: true }) } catch { toast('Failed', 'error') } }
  const dismiss = async (en) => {
    try {
      await api.post('/artist-campaigns/dismiss', { expense_id: en.id })
      setUndoDismiss(en)
      load({ silent: true })
    } catch { toast('Failed', 'error') }
  }
  const restore = async (id) => { try { await api.post('/artist-campaigns/restore', { expense_id: id }); setUndoDismiss(null); load({ silent: true }) } catch { toast('Failed', 'error') } }
  const notCampaign = async (id, on) => { try { await api.post('/artist-campaigns/not-campaign', { expense_id: id, value: on }); setNotCampaignFor(null); load({ silent: true }) } catch { toast('Failed', 'error') } }
  const openFile = (id) => api.get(`/ledger/entries/${id}/file/invoice`).then(({ data: d }) => setPreview(d.data.url)).catch(() => toast('No invoice', 'error'))
  const exportXlsx = async () => {
    try {
      const q = `artist=${encodeURIComponent(artist)}${songParam ? `&song=${encodeURIComponent(keyOfSlug(songParam) === NO_SONG_KEY ? '' : keyOfSlug(songParam))}` : ''}`
      const { data: blob } = await api.get(`/artist-campaigns/export?${q}`, { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${artist}-campaigns.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast('Export failed', 'error') }
  }
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const bulkSet = async (patch) => {
    const ids = [...sel]
    const failed = []
    for (const id of ids) {
      try { await api.post(`/artist-campaigns/entries/${id}/set`, patch) } catch { failed.push(id) }
    }
    if (failed.length) toast(`${ids.length - failed.length} of ${ids.length} updated`, 'error')
    setSel(new Set()); load({ silent: true })
  }

  // Song groups: spend desc, then release date desc, `(no song)` last — the same
  // order the export writes, so the sheet reads like the screen.
  const groups = useMemo(() => {
    if (!data) return []
    const releaseByKey = Object.fromEntries((data.releases || []).map((r) => [String(r.project_name || '').trim().toLowerCase(), r]))
    const map = new Map()
    for (const e of data.entries) {
      const k = e.song_key
      if (!map.has(k)) map.set(k, { key: k, names: new Map(), rows: [], invoiced: 0, unsettled: 0, release: releaseByKey[k] })
      const g = map.get(k)
      g.rows.push(e)
      const nm = String(e.song || '').trim()
      if (nm) g.names.set(nm, (g.names.get(nm) || 0) + 1)
      if (e.counted) {
        g.invoiced = Math.round((g.invoiced + e.amount_usd) * 100) / 100
        if (!e.bank_evidence) g.unsettled = Math.round((g.unsettled + e.amount_usd) * 100) / 100
      }
    }
    return [...map.values()].map((g) => ({
      ...g,
      // Most-used spelling wins, ties alphabetically — the display name, never
      // the lowercased key.
      name: g.key === NO_SONG_KEY ? '(no song)'
        : ([...g.names.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || g.key),
    })).sort((a, b) => {
      if (a.key === NO_SONG_KEY) return 1
      if (b.key === NO_SONG_KEY) return -1
      return b.invoiced - a.invoiced
        || String(b.release?.release_date || '').localeCompare(String(a.release?.release_date || ''))
    })
  }, [data])

  const shownGroups = songParam ? groups.filter((g) => g.key === keyOfSlug(songParam)) : groups

  if (loading) return <Skeleton.ArtistProfile />
  if (error) return (
    <div className="card p-8 text-center">
      <p className="text-sm text-danger">{error}</p>
      <button onClick={() => load()} className="mt-3 text-xs font-bold underline decoration-dotted">Try again</button>
    </div>
  )
  if (!data) return <p className="text-sm text-ink-muted">Not found.</p>

  const { totals, categories, cobrand_by_song, song_status } = data
  const meta = data.meta || {}
  const catMax = categories.reduce((m, c) => Math.max(m, c.total), 0) || 1
  const statusByKey = Object.fromEntries((song_status || []).map((s) => [s.song_key, s]))
  const byCurr = totals.by_currency || {}
  const nativeLine = Object.entries(byCurr).map(([c, v]) => money(v, c)).join(' + ')
  const songTitle = songParam ? (shownGroups[0]?.name || (keyOfSlug(songParam) === NO_SONG_KEY ? '(no song)' : songParam)) : null

  return (
    <div>
      <div className="text-sm text-ink-muted mb-4">
        <button onClick={() => navigate('/artist-campaigns')} className="hover:text-ink">Artist Campaigns</button>
        <span className="mx-1">›</span>
        {songParam
          ? <><button onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(artist)}`)} className="hover:text-ink">{data.artist}</button><span className="mx-1">›</span><span className="text-ink">{songTitle}</span></>
          : <span className="text-ink">{data.artist}</span>}
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className={`text-2xl font-bold text-ink tracking-tight ${meta.complete ? 'line-through text-ink-muted' : ''}`}>{data.artist}</h1>
        <div className="flex items-center gap-1">
          {PRIORITIES.map((p) => (
            <button key={p} onClick={() => setMeta({ priority: meta.priority === p ? null : p })}
              className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 border transition-colors ${
                meta.priority === p ? `${PRIORITY_CHIP[p]} border-transparent` : 'text-ink-faint border-rule hover:text-ink'}`}>{p[0]}</button>
          ))}
        </div>
        <button onClick={() => setMeta({ flagged: !meta.flagged, flag_reason: meta.flagged ? null : (window.prompt('Flag reason? (optional)') ?? '') })}
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.flagged ? 'bg-rose-500/10 text-danger border-rose-300' : 'text-ink-muted border-rule hover:bg-elev'}`}>
          <Flag size={13} /> {meta.flagged ? 'Flagged' : 'Flag'}
        </button>
        <button onClick={() => setMeta({ complete: !meta.complete })}
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.complete ? 'bg-emerald-500/10 text-success border-emerald-300' : 'text-ink-muted border-rule hover:bg-elev'}`}>
          <Check size={13} /> Complete
        </button>
        <button onClick={() => setMeta({ ready_for_planning: !meta.ready_for_planning })}
          className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border ${meta.ready_for_planning ? 'bg-brand-500/10 text-brand-ink border-brand-300' : 'text-ink-muted border-rule hover:bg-elev'}`}>
          <FolderCheck size={13} /> Ready for planning
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setAddOpen('')} className="btn-primary"><Plus size={15} /> Add expense</button>
          <button onClick={exportXlsx} className="btn-secondary"><Download size={15} /> Export</button>
        </div>
      </div>

      {/* Stat strip — every figure names its basis. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-ink-muted uppercase">Invoiced</p>
          <p className="text-2xl font-bold text-ink mt-1">{usd(totals.invoiced)}</p>
          {nativeLine && <p className="text-[11px] text-ink-faint mt-0.5">{nativeLine}</p>}
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-ink-muted uppercase">Unsettled</p>
          <p className="text-2xl font-bold text-ink mt-1">{usd(totals.unsettled)}</p>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {totals.no_bank_line_count > 0
              ? <span className="text-danger">{totals.no_bank_line_count} paid with no bank line</span>
              : 'no statement line behind it yet'}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-ink-muted uppercase">Unpaid</p>
          <p className="text-2xl font-bold text-danger mt-1">{usd(totals.unpaid)}</p>
          <p className="text-[11px] text-ink-faint mt-0.5">{totals.unpaid_count} invoice{totals.unpaid_count === 1 ? '' : 's'}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold text-ink-muted uppercase">Cobrand</p>
          <p className="text-2xl font-bold text-ink mt-1">{usd(totals.cobrand)}</p>
        </div>
      </div>
      <p className="text-[11px] text-ink-faint mb-6">
        Invoice-side totals over {(data.scope?.categories || []).join(' + ')} — the card&rsquo;s Settled figure is
        cash-basis and will differ.
        {totals.out_of_scope.count > 0 && (
          <> {totals.out_of_scope.count} other row{totals.out_of_scope.count === 1 ? '' : 's'} for this artist
            ({usd(totals.out_of_scope.total)}) {totals.out_of_scope.count === 1 ? 'is' : 'are'} listed below but excluded
            from campaign totals.</>
        )}
        {data.dismissed_count > 0 && (
          <> <button onClick={() => setShowDismissed((v) => !v)} className="font-semibold text-brand-ink hover:underline">
            {showDismissed ? 'Hide' : 'Show'} {data.dismissed_count} dismissed
          </button></>
        )}
      </p>

      {/* Category breakdown + cobrand summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-5">
          <h2 className="text-sm font-bold text-ink mb-4">Spending by category</h2>
          {categories.length ? categories.map((c) => (
            <div key={c.category} className="flex items-center gap-3 text-sm mb-2.5">
              <span className="w-28 flex-shrink-0 text-right text-ink-muted truncate">{c.category}</span>
              <div className="flex-1 h-3.5 rounded bg-elev overflow-hidden"><div className="h-full bg-brand-500 rounded" style={{ width: `${Math.max(4, (c.total / catMax) * 100)}%` }} /></div>
              <span className="w-24 flex-shrink-0 text-right font-medium text-ink tabular-nums">{usd(c.total)}</span>
            </div>
          )) : <p className="text-sm text-ink-muted">No campaign spend.</p>}
        </div>
        {totals.cobrand > 0 && (
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Cobrand summary</h2>
            <p className="text-xl font-bold text-ink mb-3">{usd(totals.cobrand)}</p>
            <div className="space-y-1.5">
              {Object.entries(cobrand_by_song || {}).map(([sk, v]) => (
                <div key={sk} className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted truncate">{sk === NO_SONG_KEY ? '(no song)' : sk}</span>
                  <span className="font-medium text-ink tabular-nums">{usd(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Song groups */}
      <div className="space-y-6">
        {shownGroups.map((g) => {
          const st = statusByKey[g.key] || {}
          const folded = isCollapsed(g.key)
          return (
            <div key={g.key} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-divider">
                <button onClick={() => toggleCollapsed(g.key)} className="text-ink-muted hover:text-ink" aria-label={folded ? 'Expand' : 'Collapse'}>
                  {folded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                </button>
                <h3 className={`font-bold text-ink ${st.finished ? 'line-through text-ink-muted' : ''}`}>
                  {songParam
                    ? g.name
                    : <button onClick={() => navigate(`/artist-campaigns/${encodeURIComponent(artist)}/${slugOf(g.key)}`)} className="hover:underline">{g.name}</button>}
                </h3>
                {g.key !== NO_SONG_KEY && (
                  <button onClick={() => setRenameFor(g)} title="Rename this song everywhere" className="text-ink-faint hover:text-brand-ink"><Pencil size={12} /></button>
                )}
                {g.release && <span className="text-[11px] text-ink-faint">{g.release.release_type || 'Release'}{g.release.release_date ? ` · ${formatDate(g.release.release_date)}` : ''}</span>}
                <span className="text-sm font-semibold text-ink" title="Invoice-side total for this song">{usd(g.invoiced)} <span className="text-[10px] font-normal text-ink-faint uppercase">invoiced</span></span>
                {g.unsettled > 0 && <span className="text-[11px] text-ink-faint tabular-nums">{usd(g.unsettled)} unsettled</span>}
                {st.flagged && <span className="text-[10px] font-bold uppercase bg-rose-500/15 text-danger rounded-full px-2 py-0.5 inline-flex items-center gap-1"><Flag size={9} /> Flagged</span>}
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => songStatus(g.key === NO_SONG_KEY ? '' : g.name, { finished: !st.finished })}
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${st.finished ? 'text-success' : 'text-ink-muted hover:text-success'}`}>
                    {st.finished ? <CheckCircle2 size={14} /> : <Circle size={14} />} Finished
                  </button>
                  <button onClick={() => songStatus(g.key === NO_SONG_KEY ? '' : g.name, { flagged: !st.flagged, flag_reason: st.flagged ? null : (window.prompt('Flag reason?') ?? '') })}
                    className={`text-xs ${st.flagged ? 'text-danger' : 'text-ink-faint hover:text-danger'}`}><Flag size={14} /></button>
                  <button onClick={() => setAddOpen(g.key === NO_SONG_KEY ? '' : g.name)} className="text-xs font-semibold text-brand-ink hover:underline"><Plus size={13} className="inline" /> Add</button>
                </div>
              </div>

              {!folded && (
                <>
                  <SongNotes key={g.key + (st.notes || '')} initial={st.notes || ''} by={st.notes_updated_by}
                    onSave={(v) => songStatus(g.key === NO_SONG_KEY ? '' : g.name, { notes: v })} />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-elev text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                        <th className="px-3 py-2 w-8"></th>
                        {['Date', 'Payee', 'Category', 'Socials', 'Amount', 'Paid', 'Rep', ''].map((h) => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-divider">
                        {g.rows.map((en) => (
                          <tr key={en.id} className={rowWash(en)}>
                            <td className="px-3 py-2.5"><input type="checkbox" checked={sel.has(en.id)} onChange={() => toggleSel(en.id)} aria-label="Select row" /></td>
                            <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5"><BankEvidenceDot row={en} />{formatDate(en.payment_date || en.invoice_date || en.created_at)}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`font-medium text-ink ${en.item_finished && !en.flagged ? 'line-through' : ''}`}>{en.payee}</span>
                              {!en.in_scope && <span className="ml-1.5 text-[9px] font-bold uppercase bg-elev text-ink-faint rounded px-1" title="Outside the campaign categories — listed for context, excluded from the totals">out of scope</span>}
                              {en.family_source === 'bank_statement' && <span className="ml-1.5 text-[9px] font-bold uppercase bg-elev text-ink-faint rounded px-1" title="Born from a bank statement — excluded from campaign totals">bank</span>}
                              {en.dismissed && <span className="ml-1.5 text-[9px] font-bold uppercase bg-elev text-ink-faint rounded px-1">dismissed</span>}
                              {en.not_campaign && <span className="ml-1.5 text-[9px] font-bold uppercase bg-elev text-ink-muted rounded px-1">not campaign</span>}
                              {en.is_bulk_deal && (
                                <span className="ml-1.5 text-[9px] font-bold uppercase bg-violet-500/15 text-violet-600 rounded px-1"
                                  title={(en.bulk_evidence || []).map((v) => v.title).join(', ') || 'Bulk deal'}>
                                  bulk {en.bulk_items_total ? `${en.bulk_delivered}/${en.bulk_items_total}` : (en.bulk_deal_quantity ? `${en.bulk_deal_completed || 0}/${en.bulk_deal_quantity}` : '')}
                                </span>
                              )}
                              {(en.bulk_evidence || []).slice(0, 3).map((v, i) => (
                                <a key={i} href={v.url} target="_blank" rel="noreferrer" className="ml-1 text-[10px] text-brand-ink hover:underline" title={v.title}>post{i + 1}</a>
                              ))}
                              {en.campaign_name && (
                                <span className="ml-1.5 text-[9px] font-bold uppercase bg-brand-500/15 text-brand-ink rounded px-1" title="Linked campaign">{en.campaign_name}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{en.category || '—'}</td>
                            <td className="px-3 py-2.5">
                              {(Array.isArray(en.social_handles) ? en.social_handles : []).slice(0, 3).map((s, i) => (
                                <span key={i} className={`inline-block text-[10px] rounded px-1.5 py-0.5 mr-1 ${en.socials_inherited ? 'bg-elev text-ink-faint italic' : 'bg-elev text-ink-muted'}`}
                                  title={en.socials_inherited ? 'Inherited from the parent invoice' : undefined}>{s.handle || s.platform}</span>
                              ))}
                            </td>
                            <td className="px-3 py-2.5 text-ink font-medium whitespace-nowrap">
                              {money(en.amount, en.currency)}{en.currency !== 'USD' && <span className="text-[10px] text-ink-faint ml-1">≈{usd(en.amount_usd)}</span>}
                            </td>
                            <td className="px-3 py-2.5"><span className={`text-xs font-semibold ${en.payment_status === 'Paid' ? 'text-success' : 'text-danger'}`}>{en.payment_status || 'Unpaid'}</span></td>
                            <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{en.rep || '—'}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1 justify-end whitespace-nowrap text-ink-faint">
                                {en.dismissed ? (
                                  <button onClick={() => restore(en.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><RotateCcw size={12} /> Restore</button>
                                ) : (
                                  <>
                                    {en.has_invoice && <button onClick={() => openFile(en.id)} title="View invoice" className="hover:text-brand-ink p-1"><Eye size={14} /></button>}
                                    <button onClick={() => setSocials(en)} title="Edit socials" className="p-1 hover:text-brand-ink"><AtSign size={14} /></button>
                                    {!en.parent_id && <button onClick={() => setSplitEntry(en)} title="Split across artists/songs" className="p-1 hover:text-brand-ink"><Scissors size={14} /></button>}
                                    <button onClick={() => setLinkFor(en)} title="Link a campaign" className={`p-1 ${en.campaign_id ? 'text-brand-ink' : 'hover:text-brand-ink'}`}><Link2 size={14} /></button>
                                    <button onClick={() => setRow(en.id, { cobrand: !en.cobrand })} title="Cobrand" className={`p-1 ${en.cobrand ? 'text-brand-ink' : 'hover:text-brand-ink'}`}><Users size={14} /></button>
                                    <button onClick={() => setRow(en.id, { item_finished: !en.item_finished })} title="Finished" className={`p-1 ${en.item_finished ? 'text-success' : 'hover:text-success'}`}><Check size={14} /></button>
                                    <button onClick={() => setRow(en.id, { payment_status: en.payment_status === 'Paid' ? 'Unpaid' : 'Paid' })} title="Toggle paid" className="p-1 hover:text-success"><DollarSign size={14} /></button>
                                    <button onClick={() => setRow(en.id, { flagged: !en.flagged, flag_reason: en.flagged ? null : (window.prompt('Flag reason?') ?? '') })} title="Flag" className={`p-1 ${en.flagged ? 'text-warning' : 'hover:text-warning'}`}><Flag size={14} /></button>
                                    <button onClick={() => setAssignFor(en)} title="Assign a reviewer" className={`p-1 ${(en.review_assignees || []).length ? 'text-brand-ink' : 'hover:text-brand-ink'}`}><Users size={14} /></button>
                                    <button onClick={() => setThread({ id: en.id, payee: en.payee })} title="Comments" className={`p-1 relative ${en.comment_count ? 'text-brand-ink' : 'hover:text-brand-ink'}`}>
                                      <MessageSquare size={14} />{en.comment_count > 0 && <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold">{en.comment_count}</span>}
                                    </button>
                                    <button onClick={() => setNotCampaignFor(en)} title="Not a campaign expense (cascades the family)" className={`p-1 ${en.not_campaign ? 'text-ink' : 'hover:text-ink'}`}><EyeOff size={14} /></button>
                                    <button onClick={() => dismiss(en)} title="Dismiss from this page" className="p-1 hover:text-danger"><Ban size={14} /></button>
                                  </>
                                )}
                                <a href={`/ledger?focus=${en.id}`} title="Open in ledger" className="p-1 hover:text-brand-ink"><ExternalLink size={14} /></a>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )
        })}
        {shownGroups.length === 0 && <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No spend for this artist.</p></div>}
      </div>

      {/* Bulk action bar — below BottomNav's z-30 so mobile navigation stays reachable. */}
      {sel.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 lg:bottom-6 z-20 card shadow-modal px-4 py-2.5 flex flex-wrap items-center gap-2 bg-brand-500/10 border-brand-300">
          <span className="text-sm font-medium text-ink">{sel.size} selected</span>
          <button onClick={() => bulkSet({ cobrand: true })} className="btn-secondary !py-1.5 text-xs">Cobrand</button>
          <button onClick={() => bulkSet({ cobrand: false })} className="btn-secondary !py-1.5 text-xs">Un-cobrand</button>
          <button onClick={() => bulkSet({ item_finished: true })} className="btn-secondary !py-1.5 text-xs">Finish</button>
          <button onClick={() => bulkSet({ payment_status: 'Paid' })} className="btn-secondary !py-1.5 text-xs">Paid</button>
          <button onClick={() => bulkSet({ payment_status: 'Unpaid' })} className="btn-secondary !py-1.5 text-xs">Unpaid</button>
          <button onClick={() => setSel(new Set())} className="text-ink-faint hover:text-ink" aria-label="Clear selection"><X size={16} /></button>
        </div>
      )}

      {/* Dismiss undo — the path back, without needing the tray. */}
      {undoDismiss && (
        <div className="fixed bottom-6 left-6 z-20 card shadow-modal px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm text-ink">Dismissed {undoDismiss.payee}</span>
          <button onClick={() => restore(undoDismiss.id)} className="text-sm font-semibold text-brand-ink hover:underline">Undo</button>
          <button onClick={() => setUndoDismiss(null)} className="text-ink-faint hover:text-ink" aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <CampaignChat room={songParam ? `song:${data.artist_key}:${keyOfSlug(songParam)}` : `artist:${data.artist_key}`} />

      {socials && <SocialsEditor entry={socials} onClose={() => setSocials(null)} onSaved={() => { setSocials(null); load({ silent: true }) }} toast={toast} />}
      {splitEntry && <SplitModal entry={splitEntry} artistNames={[data.artist]} toast={toast} onClose={() => setSplitEntry(null)} onDone={() => { setSplitEntry(null); load() }} />}
      {addOpen !== null && <AddExpenseModal artist={data.artist} song={addOpen} onClose={() => setAddOpen(null)} onSaved={() => { setAddOpen(null); load() }} toast={toast} />}
      {thread && <CommentThread entry={thread} onClose={() => { setThread(null); load({ silent: true }) }} toast={toast} />}
      {assignFor && <AssignModal entry={assignFor} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); load({ silent: true }) }} toast={toast} />}
      {linkFor && <CampaignLinkModal entry={linkFor} campaigns={data.campaigns || []} onClose={() => setLinkFor(null)} onSaved={() => { setLinkFor(null); load({ silent: true }) }} toast={toast} />}
      {renameFor && <RenameSongModal artist={artist} group={renameFor} onClose={() => setRenameFor(null)}
        onDone={(res) => { setRenameFor(null); toast(`Moved ${res.moved} ledger row(s), ${res.releases} release(s)`); load() }} toast={toast} />}

      <ConfirmDialog open={!!notCampaignFor} onClose={() => setNotCampaignFor(null)}
        onConfirm={() => notCampaign(notCampaignFor.id, !notCampaignFor.not_campaign)}
        title={notCampaignFor?.not_campaign ? 'Put this back in the campaign?' : 'Not a campaign expense?'}
        confirmLabel={notCampaignFor?.not_campaign ? 'Put it back' : 'Not a campaign'} variant="secondary"
        message={notCampaignFor ? `This cascades across the whole split family and changes the artist's Committed figure. The ledger row's campaign marker moves with it, so every other surface agrees.` : ''} />

      {preview && (
        <div className="fixed inset-0 z-[70] bg-overlay flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-card rounded-xl shadow-modal w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule">
              <span className="text-sm font-semibold text-ink">Invoice</span>
              <div className="flex items-center gap-3">
                <a href={preview} target="_blank" rel="noreferrer" className="text-xs text-brand-ink hover:underline">Open in new tab</a>
                <button onClick={() => setPreview(null)} className="text-ink-muted hover:text-ink" aria-label="Close"><X size={18} /></button>
              </div>
            </div>
            <iframe src={preview} title="Invoice" className="flex-1 w-full bg-elev" />
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
    <div className="px-4 py-2 border-b border-divider bg-elev">
      <textarea value={v} onChange={(e) => { setV(e.target.value); setDirty(true) }} onBlur={() => { if (dirty) { onSave(v); setDirty(false) } }}
        placeholder="Song notes…" rows={1} className="w-full bg-transparent text-sm text-ink-muted outline-none resize-none" />
      {by && !dirty && <p className="text-[10px] text-ink-faint">— {by}</p>}
    </div>
  )
}

// Rename a song everywhere: ledger + Release Tracker + the per-song flags.
function RenameSongModal({ artist, group, onClose, onDone, toast }) {
  const [to, setTo] = useState(group.name)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const { data } = await api.post(`/artist-campaigns/${encodeURIComponent(artist)}/rename-song`, { from: group.name, to })
      onDone(data.data)
    } catch (e) { toast(e.response?.data?.error || 'Failed', 'error'); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Rename “${group.name}”`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !to.trim() || to === group.name}>{busy ? 'Renaming…' : 'Rename everywhere'}</Button></>}>
      <label className="label">New name</label>
      <input className="input" value={to} onChange={(e) => setTo(e.target.value)} />
      <p className="text-[11px] text-ink-faint mt-2">
        One transaction across three places: the {group.rows.length} ledger row(s), the release&rsquo;s title in the
        Release Tracker, and this song&rsquo;s finished / notes / flags. Moving only one of them leaves the other two
        describing a song that no longer exists.
      </p>
    </Modal>
  )
}

function CampaignLinkModal({ entry, campaigns, onClose, onSaved, toast }) {
  const [busy, setBusy] = useState(false)
  const link = async (campaignId, expenseId) => {
    setBusy(true)
    try { await api.post('/artist-campaigns/link', { campaign_id: campaignId, expense_id: expenseId }); onSaved() }
    catch { toast('Failed', 'error'); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Link a campaign · ${entry.payee}`}>
      {campaigns.length === 0 ? (
        <p className="text-sm text-ink-muted">No campaigns recorded for this artist yet.</p>
      ) : (
        <div className="space-y-1">
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-elev">
              <span className="text-sm text-ink truncate flex-1">{c.name}{c.song ? ` · ${c.song}` : ''}</span>
              <span className="text-[11px] text-ink-faint tabular-nums">{c.planned_amount ? `${c.currency || 'USD'} ${c.planned_amount}` : ''}</span>
              {String(c.expense_id) === String(entry.id)
                ? <button disabled={busy} onClick={() => link(c.id, null)} className="text-[11px] font-semibold text-ink-muted hover:underline">Unlink</button>
                : <button disabled={busy} onClick={() => link(c.id, entry.id)} className="text-[11px] font-semibold text-brand-ink hover:underline">Link</button>}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-faint mt-3">
        Ad allocations point the other way — a slice carries its own campaign_id and is linked on Allocate Advertising.
      </p>
    </Modal>
  )
}

function AssignModal({ entry, onClose, onSaved, toast }) {
  const [users, setUsers] = useState([])
  const [sel, setSel] = useState(new Set((entry.review_assignees || []).map((u) => u.id)))
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/artist-campaigns/reviewers').then((r) => setUsers(r.data.data || [])).catch(() => setUsers([])) }, [])
  const save = async () => {
    setBusy(true)
    try { await api.post('/artist-campaigns/review-assign', { expense_id: entry.id, user_ids: [...sel] }); onSaved() }
    catch { toast('Failed', 'error'); setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Reviewers · ${entry.payee}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {users.map((u) => (
          <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-elev cursor-pointer">
            <input type="checkbox" checked={sel.has(u.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} />
            <span className="text-sm text-ink">{u.name}</span>
            <span className="text-[11px] text-ink-faint ml-auto">{u.role}</span>
          </label>
        ))}
        {!users.length && <p className="text-sm text-ink-muted">No teammates to assign.</p>}
      </div>
    </Modal>
  )
}

function CommentThread({ entry, onClose, toast }) {
  const [comments, setComments] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get(`/artist-campaigns/entries/${entry.id}/comments`).then((r) => setComments(r.data.data || [])).catch(() => setComments([])) }, [entry.id])
  const post = async () => {
    const b = body.trim()
    if (!b || busy) return
    setBusy(true)
    try { const { data } = await api.post(`/artist-campaigns/entries/${entry.id}/comments`, { body: b }); setComments((c) => [...(c || []), data.data]); setBody('') }
    catch { toast('Failed', 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Comments · ${entry.payee}`}>
      <div className="max-h-[50vh] overflow-y-auto space-y-2 mb-3">
        {comments === null ? <p className="text-sm text-ink-muted">Loading…</p> : comments.length ? comments.map((c) => (
          <div key={c.id} className="text-sm">
            <span className="font-medium text-ink">{c.author}</span> <span className="text-[10px] text-ink-faint">{formatDate(c.created_at)}</span>
            <p className="text-ink-muted whitespace-pre-line">{c.body}</p>
          </div>
        )) : <p className="text-sm text-ink-muted">No comments yet.</p>}
      </div>
      <div className="flex items-end gap-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post() } }}
          rows={1} placeholder="Comment…  @ to mention" className="input flex-1 resize-none text-sm" />
        <Button onClick={post} disabled={busy || !body.trim()}>Post</Button>
      </div>
    </Modal>
  )
}

// Socials editor — per-row social_handles with a running total vs the row amount.
const PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Twitter/X', 'Spotify', 'Facebook', 'Other']
function SocialsEditor({ entry, onClose, onSaved, toast }) {
  const [rows, setRows] = useState(Array.isArray(entry.social_handles) && entry.social_handles.length
    ? entry.social_handles.map((s) => ({ platform: s.platform || 'Instagram', handle: s.handle || '', amount: s.amount ?? '' }))
    : [{ platform: 'Instagram', handle: '', amount: '' }])
  const [saving, setSaving] = useState(false)
  const upd = (i, k, v) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)))
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const save = async () => {
    setSaving(true)
    const clean = rows.filter((r) => r.handle.trim()).map((r) => ({ platform: r.platform, handle: r.handle.trim(), amount: r.amount === '' ? null : Number(r.amount) }))
    try { await api.post(`/artist-campaigns/entries/${entry.id}/set`, { social_handles: clean }); onSaved() } catch { toast('Failed', 'error'); setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Socials · ${entry.payee}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></>}>
      {entry.socials_inherited && <p className="text-[11px] text-ink-faint mb-2">These are inherited from the parent invoice — saving here gives this slice its own.</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select value={r.platform} onChange={(e) => upd(i, 'platform', e.target.value)} className="input !w-auto !py-1.5 text-sm">{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
            <input value={r.handle} onChange={(e) => upd(i, 'handle', e.target.value)} placeholder="@handle" className="input !py-1.5 text-sm flex-1" />
            <input type="number" step="0.01" value={r.amount} onChange={(e) => upd(i, 'amount', e.target.value)} placeholder="$" className="input !py-1.5 text-sm !w-20" />
            <button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="text-ink-faint hover:text-danger" aria-label="Remove"><X size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={() => setRows((rs) => [...rs, { platform: 'Instagram', handle: '', amount: '' }])} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"><Plus size={12} /> Add handle</button>
      <div className="flex items-center justify-between mt-3 text-sm">
        <span className="text-ink-muted">Handles total</span>
        <span className={`font-medium tabular-nums ${Math.abs(total - Number(entry.amount || 0)) < 0.01 ? 'text-success' : 'text-ink-muted'}`}>
          {usd(total)} <span className="text-ink-faint">/ {money(entry.amount, entry.currency)}</span>
        </span>
      </div>
    </Modal>
  )
}

// Add-expense — auto-approved + auto-paid + recoupable, stamped artist_campaigns.
function AddExpenseModal({ artist, song, onClose, onSaved, toast }) {
  const today = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({ payee: '', amount: '', currency: 'USD', invoice_date: today, category: 'Marketing', song: song || '', rep: '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const save = async () => {
    if (!f.payee.trim() || !f.amount) { toast('Payee and amount required', 'error'); return }
    setSaving(true)
    try {
      await api.post('/ledger/entries', { ...f, artist, vendor_name: f.payee, entry_source: 'artist_campaigns', artist_campaign: true, recoupable: true, payment_status: 'Paid', payment_date: f.invoice_date })
      toast('Expense added'); onSaved()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error'); setSaving(false) }
  }
  return (
    <Modal open onClose={onClose} title="Add campaign expense" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add expense'}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className="label">Payee *</label><input className="input" value={f.payee} onChange={set('payee')} /></div>
        <div><label className="label">Amount *</label><input type="number" step="0.01" className="input" value={f.amount} onChange={set('amount')} /></div>
        <div><label className="label">Currency</label><select className="input" value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label">Date</label><input type="date" className="input" value={f.invoice_date} onChange={set('invoice_date')} /></div>
        <div><label className="label">Category</label><select className="input" value={f.category} onChange={set('category')}><CategoryOptions /></select></div>
        <div><label className="label">Song</label><input className="input" value={f.song} onChange={set('song')} /></div>
        <div><label className="label">Rep</label><input className="input" value={f.rep} onChange={set('rep')} /></div>
      </div>
      <p className="text-[11px] text-ink-faint mt-3">Recorded as approved, Paid on the invoice date, and recoupable.</p>
    </Modal>
  )
}

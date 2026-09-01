import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Pencil, X, Trash2, Plus, ExternalLink, Music,
  Instagram, Youtube, Globe, Paperclip, Download, Archive, ArchiveRestore,
  Sparkles, FileText, Briefcase, AlertCircle, Disc3, Link2,
} from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { Modal, ConfirmDialog } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { DEV_LOG_TYPES } from '../constants'
import { formatDate, localDateStr, daysUntilLocal } from '../utils/dates'
import { progressOf } from '../utils/releases'
import { dropTarget } from '../utils/drop'

// Color-coding for development-log entry types (dot + label tint).
const LOG_STYLE = {
  Note:      { dot: 'bg-gray-400',    text: 'text-ink-muted' },
  Meeting:   { dot: 'bg-blue-500',    text: 'text-blue-600' },
  Demo:      { dot: 'bg-violet-500',  text: 'text-violet-600' },
  Offer:     { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  Call:      { dot: 'bg-cyan-500',    text: 'text-cyan-600' },
  Feedback:  { dot: 'bg-amber-500',   text: 'text-amber-600' },
  Milestone: { dot: 'bg-pink-500',    text: 'text-pink-600' },
}

const SOCIALS = [
  { key: 'spotify_url',     label: 'Spotify',      icon: Music },
  { key: 'apple_music_url', label: 'Apple Music',  icon: Music },
  { key: 'youtube',         label: 'YouTube',      icon: Youtube },
  { key: 'soundcloud',      label: 'SoundCloud',   icon: Music },
  { key: 'instagram',       label: 'Instagram',    icon: Instagram },
  { key: 'tiktok',          label: 'TikTok',       icon: Music },
  { key: 'website',         label: 'Website',      icon: Globe },
]

// The five per-release URL columns aggregated by the Links tab. A label's
// links live on the release, not the artist, so an artist page with no
// "release links" view is missing most of the URLs anyone actually wants.
const RELEASE_LINK_FIELDS = [
  { key: 'spotify_uri', label: 'Spotify' },
  { key: 'apple_music_link', label: 'Apple Music' },
  { key: 'presave_link', label: 'Pre-save' },
  { key: 'presave_analytics', label: 'Pre-save analytics' },
  { key: 'ugc_link', label: 'UGC' },
]

const EDIT_FIELDS = [
  { key: 'name', label: 'Name' }, { key: 'genre', label: 'Genre' },
  { key: 'image_url', label: 'Image URL' }, { key: 'website', label: 'Website' },
  { key: 'spotify_url', label: 'Spotify URL' }, { key: 'apple_music_url', label: 'Apple Music URL' },
  { key: 'instagram', label: 'Instagram' }, { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' }, { key: 'soundcloud', label: 'SoundCloud' },
  { key: 'spotify_monthly_listeners', label: 'Monthly listeners', type: 'number' },
  { key: 'spotify_followers', label: 'Spotify followers', type: 'number' },
  { key: 'spotify_popularity', label: 'Popularity (0–100)', type: 'number' },
]

const STAT = (n) => ((n || n === 0) ? Number(n).toLocaleString() : '—')
const fileSize = (b) => (!b ? null : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`)
const imgOf = (u) => (u && u !== 'not_found' ? u : null)

// Money is rendered PER CURRENCY, never summed across them. Adding £ to $ and
// printing a '$' invents a number nobody can reconcile.
function moneyOf(totals) {
  const entries = Object.entries(totals || {}).filter(([, v]) => v)
  if (!entries.length) return '—'
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => `${cur === 'USD' ? '$' : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}${cur === 'USD' ? '' : ` ${cur}`}`)
    .join(' · ')
}
const sumOf = (totals) => Object.values(totals || {}).reduce((a, b) => a + Number(b || 0), 0)

// Ring gauge for Spotify popularity, banded so the number reads as good/ok/poor
// without having to know Spotify's 0–100 scale.
function PopularityRing({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  const r = 26
  const c = 2 * Math.PI * r
  const tone = v >= 70 ? 'text-success' : v >= 40 ? 'text-warning' : 'text-danger'
  return (
    <div className="relative w-16 h-16">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-gray-200" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          className={`${tone} stroke-current`}
          strokeDasharray={`${(v / 100) * c} ${c}`}
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${tone}`}>{v}</span>
    </div>
  )
}

export default function ArtistProfile() {
  const { id } = useParams()
  const { toast } = useToast()
  const { user, canView } = useAuth()
  const navigate = useNavigate()

  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const canDeleteArtist = user?.role === 'Superadmin'

  const [artist, setArtist] = useState(null)
  const [log, setLog] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [bio, setBio] = useState('')
  const [newLog, setNewLog] = useState({ entry_type: 'Note', note: '', log_date: localDateStr() })
  const [addingLog, setAddingLog] = useState(false)
  const [tab, setTab] = useState('overview')
  const [confirm, setConfirm] = useState(null)  // { title, message, onConfirm }
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState({})

  const loadFiles = () => api.get(`/artists/${id}/files`).then(f => setFiles(f.data.data || [])).catch(() => {})
  const load = () => {
    setLoading(true)
    // The log is NOT coupled to the artist: a failing log query should cost the
    // Development tab, not the whole page.
    api.get(`/artists/${id}`)
      .then(a => { setArtist(a.data.data); setLoadError(null) })
      .catch(err => setLoadError(err.response?.status === 404 ? 'notfound' : 'error'))
      .finally(() => setLoading(false))
    api.get(`/artists/${id}/log`).then(l => setLog(l.data.data || [])).catch(() => setLog([]))
    loadFiles()
  }
  useEffect(() => { load() }, [id])

  // ── Live Spotify tab, fetched lazily the first time the tab opens ──
  const [spotify, setSpotify] = useState(null)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  useEffect(() => {
    if (tab !== 'spotify' || spotify || spotifyLoading) return
    setSpotifyLoading(true)
    api.get(`/artists/${id}/spotify`)
      .then(r => setSpotify(r.data.data || { found: false }))
      .catch(() => setSpotify({ found: false, error: 'Could not reach Spotify' }))
      .finally(() => setSpotifyLoading(false))
  }, [tab, id, spotify, spotifyLoading])
  useEffect(() => { setSpotify(null) }, [id])

  const doUploadFile = async (file) => {
    if (!file) return
    setUploading(true); setUploadError(null)
    const fd = new FormData(); fd.append('file', file)
    try {
      await api.post(`/artists/${id}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast('File uploaded'); loadFiles()
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }
  const uploadFile = (e) => { doUploadFile(e.target.files?.[0]); if (e.target) e.target.value = '' }
  const openFile = async (fid) => {
    try { const { data } = await api.get(`/artists/${id}/files/${fid}`); window.open(data.data.url, '_blank', 'noopener') }
    catch { toast('No file', 'error') }
  }
  const delFile = (f) => setConfirm({
    title: 'Delete file?',
    message: `“${f.original_name}” will be removed permanently.`,
    onConfirm: async () => {
      setConfirm(null)
      try { await api.delete(`/artists/${id}/files/${f.id}`); loadFiles() } catch { toast('Failed', 'error') }
    },
  })

  const toggleArchive = async () => {
    try {
      await api.patch(`/artists/${id}/archive`, { archived: !artist.archived })
      toast(artist.archived ? 'Restored' : 'Archived'); load()
    } catch { toast('Failed', 'error') }
  }

  const [syncing, setSyncing] = useState(false)
  const syncSpotify = async () => {
    setSyncing(true)
    try { await api.post(`/artists/${id}/sync-spotify`); toast('Synced from Spotify'); setSpotify(null); load() }
    catch (err) { toast(err.response?.data?.error || 'Spotify sync failed', 'error') }
    finally { setSyncing(false) }
  }

  const startEdit = () => {
    const f = {}
    for (const { key } of EDIT_FIELDS) f[key] = artist[key] ?? ''
    setForm(f); setBio(artist.bio || ''); setEditing(true)
  }
  const save = async () => {
    try {
      const { data } = await api.patch(`/artists/${id}`, { ...form, bio })
      toast('Saved'); setEditing(false)
      // A rename changes the key the spend query matches on, so the aggregate
      // has to be re-read rather than patched in place.
      if (data.data?.name !== artist.name) load(); else setArtist(a => ({ ...a, ...data.data }))
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error') }
  }

  const addLog = async (e) => {
    e?.preventDefault()
    if (!newLog.note.trim()) return
    setAddingLog(true)
    try {
      const { data } = await api.post(`/artists/${id}/log`, newLog)
      // The server returns the enriched row (with `author`), so prepend rather
      // than refetch — the list shape already matches.
      setLog(l => [data.data, ...l])
      setNewLog({ entry_type: 'Note', note: '', log_date: localDateStr() })
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setAddingLog(false) }
  }
  const deleteLog = (entry) => setConfirm({
    title: 'Delete this entry?',
    message: 'The log entry will be removed permanently.',
    onConfirm: async () => {
      setConfirm(null)
      try { await api.delete(`/artists/${id}/log/${entry.id}`); setLog(l => l.filter(x => x.id !== entry.id)) }
      catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    },
  })

  const remove = () => setConfirm({
    title: 'Delete this artist?',
    message: 'This cannot be undone. Artists with releases cannot be deleted — reassign or remove the releases first.',
    onConfirm: async () => {
      setConfirm(null)
      try { await api.delete(`/artists/${id}`); toast('Artist deleted'); navigate('/artists') }
      catch (err) { toast(err.response?.data?.error || 'Failed to delete', 'error') }
    },
  })

  // Optimistic per-release archive from the Releases tab.
  const toggleReleaseArchive = async (r) => {
    setArchiveBusy(b => ({ ...b, [r.id]: true }))
    try {
      const { data } = await api.put(`/releases/${r.id}/archive`)
      const next = data.data?.archived ?? !r.archived
      setArtist(a => ({ ...a, releases: a.releases.map(x => (x.id === r.id ? { ...x, archived: next } : x)) }))
    } catch { toast('Failed to archive', 'error') }
    finally { setArchiveBusy(b => ({ ...b, [r.id]: false })) }
  }

  const releases = artist?.releases || []
  const contracts = artist?.contracts || []
  const deals = artist?.deals || []
  const expenses = artist?.expenses || []
  const spendCats = artist?.spendByCategory || []
  const spendTotals = artist?.spendTotals || {}
  const socialLinks = useMemo(() => SOCIALS.filter(s => artist?.[s.key]), [artist])

  // Aggregated release links, for the Links tab.
  const releaseLinks = useMemo(() => releases.flatMap(r =>
    RELEASE_LINK_FIELDS
      .filter(f => r[f.key])
      .map(f => ({ id: `${r.id}-${f.key}`, releaseId: r.id, release: r.project_name, label: f.label, url: r[f.key] }))
  ), [releases])

  // "Upcoming" is a LOCAL-calendar question. `new Date(r.release_date) > new
  // Date()` makes a release dropping today read as past, and shifts the whole
  // boundary a day west of UTC.
  const upcoming = useMemo(
    () => releases.filter(r => !r.archived && r.status !== 'Archived' && (daysUntilLocal(r.release_date) ?? -1) >= 0),
    [releases]
  )
  const activeContracts = contracts.filter(c => c.status === 'Active').length
  const unpaidTotals = useMemo(() => {
    const t = {}
    for (const e of expenses) {
      if (e.payment_status === 'paid') continue
      const c = e.currency || 'USD'
      t[c] = (t[c] || 0) + Number(e.amount || 0)
    }
    return t
  }, [expenses])
  const topCategory = spendCats[0]?.category || null

  const spendMax = spendCats.reduce((m, c) => Math.max(m, sumOf(c.totals)), 0) || 1
  const spendUsd = sumOf(spendTotals)
  const budgetTotal = artist?.budgetTotal || 0
  const budgetPct = budgetTotal > 0 ? Math.round((spendUsd / budgetTotal) * 100) : 0
  // Three bands, not two: >80% is the point at which someone should be told,
  // and a bar that only turns red after the money is already gone is a report,
  // not a warning.
  const budgetBar = budgetPct > 100 ? 'bg-danger' : budgetPct > 80 ? 'bg-warning' : 'bg-success'

  const showContracts = !!artist?.contracts_visible && canView('/contracts')
  const canOpenLedger = canView('/ledger')

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'spotify', label: 'Spotify', spotify: true },
    { key: 'releases', label: `Releases (${releases.length})` },
    { key: 'spends', label: `Spends (${expenses.length})` },
    { key: 'links', label: `Links (${socialLinks.length + releaseLinks.length})` },
    { key: 'development', label: `Development (${log.length})` },
    ...(showContracts ? [{ key: 'contracts', label: `Contracts (${contracts.length})` }] : []),
    { key: 'documents', label: `Documents (${files.length})` },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton.Line w="w-40" h="h-3" />
        <div className="flex items-start gap-4">
          <Skeleton.Circle size="w-16 h-16" />
          <div className="flex-1 space-y-2"><Skeleton.Line w="w-56" h="h-7" /><Skeleton.Line w="w-72" h="h-3" /></div>
        </div>
        <Skeleton.StatCards count={2} />
        <Skeleton.Block h="h-20" />
        <Skeleton.Block h="h-64" />
      </div>
    )
  }
  if (loadError || !artist) {
    return (
      <div className="card p-10 text-center">
        <AlertCircle size={28} className="text-ink-faint mx-auto mb-3" />
        <p className="text-sm text-ink-muted mb-4">
          {loadError === 'notfound' ? 'Artist not found.' : 'Could not load this artist.'}
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link to="/artists" className="btn-secondary"><ArrowLeft size={14} /> Back to roster</Link>
          {loadError === 'error' && <button onClick={load} className="btn-primary">Retry</button>}
        </div>
      </div>
    )
  }

  const ReleaseRow = (r, { showArchive = false } = {}) => {
    const pct = progressOf(r)
    const art = imgOf(r.cover_art_url)
    return (
      <div key={r.id} className={`card p-3 flex items-center gap-3 transition-colors hover:border-brand-300 ${r.archived ? 'opacity-60' : ''}`}>
        <Link to={`/releases/${r.id}`} className="flex items-center gap-3 min-w-0 flex-1">
          {art
            ? <img src={art} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-100" />
            : <div className="w-12 h-12 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Music size={15} className="text-ink-faint" /></div>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink truncate">{r.project_name}</p>
            <p className="text-[11px] text-ink-faint">
              {r.release_type || 'Release'}{r.release_date ? ` · ${formatDate(r.release_date)}` : ''}
              {r.assigned_to_name ? ` · ${r.assigned_to_name}` : ''}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="hidden sm:flex items-center gap-1.5" title={`Prep checklist ${pct}% complete`}>
            <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-ink-faint tabular-nums w-8">{pct}%</span>
          </div>
          {r.archived
            ? <span className="text-[10px] font-semibold uppercase text-ink-faint">Archived</span>
            : <span className="text-[10px] font-semibold uppercase text-ink-faint">{r.status}</span>}
          {showArchive && (
            <button
              onClick={() => toggleReleaseArchive(r)}
              disabled={archiveBusy[r.id]}
              title={r.archived ? 'Restore release' : 'Archive release'}
              className="p-1.5 rounded-lg text-ink-faint hover:text-warning hover:bg-warning/10 disabled:opacity-40"
            >
              {r.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            </button>
          )}
        </div>
      </div>
    )
  }

  const SpendingByCategory = () => (
    spendCats.length ? (
      <div className="space-y-2.5">
        {spendCats.map(c => (
          <div key={c.category} className="flex items-center gap-3 text-sm">
            <span className="w-28 flex-shrink-0 text-ink-muted truncate text-right">{c.category}</span>
            <div className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden">
              <div className="h-full bg-brand-500 rounded" style={{ width: `${Math.max(4, (sumOf(c.totals) / spendMax) * 100)}%` }} />
            </div>
            <span className="w-32 flex-shrink-0 text-right font-medium text-ink tabular-nums text-xs">{moneyOf(c.totals)}</span>
          </div>
        ))}
      </div>
    ) : <p className="text-sm text-ink-muted">No spend recorded for this artist yet.</p>
  )

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-sm text-ink-faint mb-4">
        <Link to="/artists" className="hover:text-ink">Roster</Link> <span className="mx-1">›</span> <span className="text-ink-muted">{artist.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        {imgOf(artist.image_url)
          ? <img src={artist.image_url} alt="" className="w-20 h-20 rounded-2xl object-cover flex-shrink-0 bg-gray-100" />
          : <div className="w-20 h-20 rounded-2xl bg-brand-500/15 flex items-center justify-center flex-shrink-0"><span className="text-3xl font-bold text-brand-ink">{artist.name?.charAt(0)?.toUpperCase()}</span></div>}
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-ink tracking-tight">{artist.name}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-ink-muted">
            {artist.genre && <span>{artist.genre}</span>}
            <span className="text-ink-faint">{releases.length} release{releases.length === 1 ? '' : 's'}</span>
            {showContracts && activeContracts > 0 && (
              <span className="text-[11px] font-semibold bg-success/15 text-success px-2 py-0.5 rounded-full">
                {activeContracts} active contract{activeContracts === 1 ? '' : 's'}
              </span>
            )}
            {artist.archived && <span className="text-[11px] font-semibold bg-gray-100 text-ink-muted px-2 py-0.5 rounded-full">Archived</span>}
          </div>
          {/* Link chips, in the header where they belong — these are the first
              thing anyone opening an artist wants. */}
          {socialLinks.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {socialLinks.map(s => { const Icon = s.icon; return (
                <a key={s.key} href={artist[s.key]} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border border-rule text-ink-muted hover:text-brand-ink hover:border-brand-300">
                  <Icon size={11} /> {s.label}
                </a>
              ) })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={syncSpotify} disabled={syncing} className="btn-secondary"><Sparkles size={14} /> {syncing ? 'Syncing…' : 'Spotify'}</button>
          <button onClick={startEdit} className="btn-secondary"><Pencil size={14} /> Edit</button>
          <button onClick={toggleArchive} title={artist.archived ? 'Restore' : 'Archive'} className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-ink-faint hover:text-warning hover:border-warning/30">
            {artist.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
          {/* Superadmin-only, mirroring the server gate — a button that always
              403s is worse than no button. */}
          {canDeleteArtist && (
            <button onClick={remove} title="Delete artist" className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-ink-faint hover:text-danger hover:border-danger/30"><Trash2 size={15} /></button>
          )}
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="card px-4 py-3"><p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Releases</p><p className="text-xl font-bold text-ink mt-0.5">{releases.length}</p></div>
        <div className="card px-4 py-3"><p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Upcoming</p><p className="text-xl font-bold text-ink mt-0.5">{upcoming.length}</p></div>
      </div>

      {/* Budget bar */}
      {(budgetTotal > 0 || spendUsd > 0) && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-ink">
              Budget
              {artist.budgetSource === 'recording_budget' && <span className="ml-2 text-[10px] font-medium text-ink-faint uppercase tracking-wide">Recording budget</span>}
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              {moneyOf(spendTotals)}{budgetTotal > 0 ? ` / $${budgetTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${budgetPct}%)` : ' spent'}
            </span>
          </div>
          {budgetTotal > 0 && (
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${budgetBar}`} style={{ width: `${Math.min(100, budgetPct)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-rule mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.key ? 'border-brand-600 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}>
            {t.spotify && <Music size={13} className="text-success" />}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Upcoming releases</h2>
            {upcoming.length ? <div className="space-y-2">{upcoming.map(r => ReleaseRow(r))}</div> : <p className="text-sm text-ink-muted">No upcoming releases.</p>}
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-4">Spending by category</h2>
            <SpendingByCategory />
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-1.5"><Briefcase size={14} /> Deal history</h2>
            {deals.length ? (
              <div className="divide-y divide-divider">
                {deals.map(d => (
                  <div key={d.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">{d.stage}{d.deal_type ? ` · ${d.deal_type}` : ''}</p>
                      <p className="text-[11px] text-ink-faint">{d.ar_rep || 'Unassigned'}{d.last_contact_date ? ` · last contact ${formatDate(d.last_contact_date)}` : ''}</p>
                    </div>
                    <Link to="/deals" className="text-xs font-semibold text-brand-ink hover:underline flex-shrink-0">Pipeline →</Link>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-muted">No deals recorded for this artist.</p>}
          </div>
        </div>
      )}

      {/* ── Spotify (live) ── */}
      {tab === 'spotify' && (
        spotifyLoading ? (
          <div className="space-y-4"><Skeleton.StatCards count={4} /><Skeleton.Block h="h-48" /></div>
        ) : spotify?.disabled ? (
          <div className="card p-8 text-center">
            <Music size={26} className="text-ink-faint mx-auto mb-3" />
            <p className="text-sm text-ink-muted">Spotify isn’t configured on this server.</p>
            <p className="text-xs text-ink-faint mt-1">Set <code className="font-mono">SPOTIFY_CLIENT_ID</code> and <code className="font-mono">SPOTIFY_CLIENT_SECRET</code> to enable live stats.</p>
          </div>
        ) : !spotify?.found ? (
          <div className="card p-8 text-center">
            <Music size={26} className="text-ink-faint mx-auto mb-3" />
            <p className="text-sm text-ink-muted">{spotify?.error || `Couldn’t find “${artist.name}” on Spotify.`}</p>
            <p className="text-xs text-ink-faint mt-1">Add the artist’s Spotify URL via Edit for an exact match.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="card px-4 py-3 flex items-center gap-3">
                <PopularityRing value={spotify.spotify_popularity} />
                <div><p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Popularity</p><p className="text-[11px] text-ink-faint mt-0.5">of 100</p></div>
              </div>
              {[
                { label: 'Followers', value: STAT(spotify.spotify_followers) },
                { label: 'Tracks found', value: STAT(spotify.tracks_found) },
                { label: 'Releases', value: STAT(spotify.discography?.length) },
                { label: 'Monthly listeners', value: STAT(artist.spotify_monthly_listeners) },
              ].map(s => (
                <div key={s.label} className="card px-4 py-3">
                  <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">{s.label}</p>
                  <p className="text-xl font-bold text-ink mt-0.5 tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(spotify.genres || []).map(g => (
                <span key={g} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-success/15 text-success">{g}</span>
              ))}
              {spotify.spotify_url && (
                <a href={spotify.spotify_url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold text-brand-ink hover:underline inline-flex items-center gap-1">
                  Open on Spotify <ExternalLink size={12} />
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="card p-5">
                <h2 className="text-sm font-bold text-ink mb-3">Top tracks</h2>
                {spotify.top_tracks?.length ? (
                  <div className="space-y-2">
                    {spotify.top_tracks.map((t, i) => (
                      <a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-1.5 rounded-lg hover:bg-brand-500/10">
                        <span className="w-4 text-[11px] text-ink-faint tabular-nums text-right">{i + 1}</span>
                        {t.image_url
                          ? <img src={t.image_url} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                          : <div className="w-9 h-9 rounded bg-gray-100 flex-shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink truncate">{t.name}</p>
                          <div className="h-1 rounded-full bg-gray-100 overflow-hidden mt-1 max-w-[160px]">
                            <div className="h-full bg-success rounded-full" style={{ width: `${t.popularity}%` }} />
                          </div>
                        </div>
                        <span className="text-[10px] text-ink-faint tabular-nums flex-shrink-0">{t.popularity}</span>
                      </a>
                    ))}
                  </div>
                ) : <p className="text-sm text-ink-muted">No top tracks returned.</p>}
              </div>

              <div className="card p-5">
                <h2 className="text-sm font-bold text-ink mb-1">Discography</h2>
                <p className="text-[11px] text-ink-faint mb-3">{spotify.album_count} album{spotify.album_count === 1 ? '' : 's'} · {spotify.single_count} single{spotify.single_count === 1 ? '' : 's'}</p>
                {spotify.discography?.length ? (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {spotify.discography.map(al => (
                      <a key={al.id} href={al.url} target="_blank" rel="noopener noreferrer" title={`${al.name}${al.release_date ? ` · ${al.release_date.slice(0, 4)}` : ''}`}>
                        {al.image_url
                          ? <img src={al.image_url} alt="" className="w-full aspect-square rounded object-cover hover:opacity-80 transition-opacity" />
                          : <div className="w-full aspect-square rounded bg-gray-100 flex items-center justify-center"><Disc3 size={16} className="text-ink-faint" /></div>}
                      </a>
                    ))}
                  </div>
                ) : <p className="text-sm text-ink-muted">No releases returned.</p>}
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Releases ── */}
      {tab === 'releases' && (
        releases.length
          ? <div className="space-y-2">{releases.map(r => ReleaseRow(r, { showArchive: true }))}</div>
          : <div className="card p-6 text-center"><p className="text-sm text-ink-muted">No releases yet.</p></div>
      )}

      {/* ── Spends ── */}
      {tab === 'spends' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card px-4 py-3">
              <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Total spend</p>
              <p className="text-lg font-bold text-ink mt-0.5 tabular-nums">{moneyOf(spendTotals)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Unpaid</p>
              <p className={`text-lg font-bold mt-0.5 tabular-nums ${sumOf(unpaidTotals) > 0 ? 'text-danger' : 'text-ink'}`}>{moneyOf(unpaidTotals)}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide">Top category</p>
              <p className="text-lg font-bold text-ink mt-0.5 truncate">{topCategory || '—'}</p>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-4">Spending by category</h2>
            <SpendingByCategory />
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-elev border-b border-divider">
                    {['Date', 'Payee', 'Song', 'Category', 'Amount', 'Status', ''].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-bold text-ink-muted uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {expenses.map(e => (
                    <tr key={e.id} className="hover:bg-brand-500/10">
                      <td className="px-3 py-2 text-ink-muted whitespace-nowrap">{formatDate(e.invoice_date)}</td>
                      <td className="px-3 py-2 text-ink max-w-[200px] truncate" title={e.description || ''}>{e.payee || '—'}</td>
                      <td className="px-3 py-2 text-ink-muted max-w-[140px] truncate">{e.song || '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          {e.category || 'Uncategorized'}
                          {e.recoupable && <span className="text-[9px] font-bold px-1 rounded bg-info/15 text-info">RECOUP</span>}
                          {e.cobrand && <span className="text-[9px] font-bold px-1 rounded bg-violet-500/15 text-violet-600">COBRAND</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink tabular-nums whitespace-nowrap">
                        {e.currency === 'USD' || !e.currency ? '$' : ''}{Number(e.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        {e.currency && e.currency !== 'USD' ? ` ${e.currency}` : ''}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                          e.payment_status === 'paid' ? 'bg-success/15 text-success'
                            : e.payment_status === 'partial' ? 'bg-warning/15 text-warning'
                            : 'bg-danger/15 text-danger'}`}>
                          {e.payment_status || 'unpaid'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canOpenLedger && (
                          <Link to={`/ledger?focus=${e.id}`} className="text-xs font-semibold text-brand-ink hover:underline whitespace-nowrap">Ledger →</Link>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!expenses.length && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-muted">No approved expenses recorded for this artist.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Links ── */}
      {tab === 'links' && (
        <div className="space-y-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-ink">Artist links</h2>
              <button onClick={startEdit} className="text-xs font-semibold text-brand-ink hover:underline">Edit →</button>
            </div>
            {socialLinks.length ? (
              <div className="flex flex-wrap gap-2">
                {socialLinks.map(s => { const Icon = s.icon; return (
                  <a key={s.key} href={artist[s.key]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-rule text-ink-muted hover:text-brand-ink hover:border-brand-300">
                    <Icon size={14} /> {s.label} <ExternalLink size={12} className="text-ink-faint" />
                  </a>
                ) })}
              </div>
            ) : <p className="text-sm text-ink-muted">No links yet — add them via Edit.</p>}
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Link2 size={14} /> Release links</h2>
            <p className="text-[11px] text-ink-faint mb-3">Spotify, Apple Music, pre-save, analytics and UGC URLs stored on this artist’s releases.</p>
            {releaseLinks.length ? (
              <div className="divide-y divide-divider">
                {releaseLinks.map(l => (
                  <div key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-ink truncate">{l.label}</p>
                      <p className="text-[11px] text-ink-faint truncate">{l.url}</p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-ink-faint hover:text-brand-ink"><ExternalLink size={13} /></a>
                      <Link to={`/releases/${l.releaseId}`} className="text-xs font-semibold text-brand-ink hover:underline truncate max-w-[140px]">{l.release} →</Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-ink-muted">No release links stored yet.</p>}
          </div>
        </div>
      )}

      {/* ── Development ── */}
      {tab === 'development' && (
        <div className="max-w-2xl">
          <form onSubmit={addLog} className="card p-3 mb-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <input
                type="date"
                value={newLog.log_date}
                onChange={e => setNewLog(l => ({ ...l, log_date: e.target.value }))}
                className="input !py-1.5 text-xs"
              />
              <select value={newLog.entry_type} onChange={e => setNewLog(l => ({ ...l, entry_type: e.target.value }))} className="input !py-1.5 text-xs">
                {DEV_LOG_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <textarea
              required
              value={newLog.note}
              onChange={e => setNewLog(l => ({ ...l, note: e.target.value }))}
              placeholder="What happened? (e.g. “Met with manager, discussed Q3 release plan”)"
              rows={2}
              className="input w-full resize-none text-sm"
            />
            <div className="flex justify-end mt-2">
              <button type="submit" disabled={addingLog || !newLog.note.trim()} className="btn-primary !py-1.5 text-xs disabled:opacity-50">
                <Plus size={13} /> {addingLog ? 'Adding…' : 'Add entry'}
              </button>
            </div>
          </form>
          {log.length ? (
            <div className="space-y-2">
              {log.map(e => {
                const st = LOG_STYLE[e.entry_type] || LOG_STYLE.Note
                const canDelete = isAdmin || e.created_by === user?.id
                return (
                  <div key={e.id} className="card p-3 group">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${st.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{e.entry_type}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-ink-faint">{formatDate(e.log_date)}</span>
                        {canDelete && (
                          <button onClick={() => deleteLog(e)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-faint hover:text-danger transition-opacity"><Trash2 size={12} /></button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-ink whitespace-pre-line">{e.note}</p>
                    {e.author && <p className="text-[10px] text-ink-faint mt-1">— {e.author}</p>}
                  </div>
                )
              })}
            </div>
          ) : <div className="card p-6 text-center"><p className="text-sm text-ink-muted">No development activity logged yet.</p></div>}
        </div>
      )}

      {/* ── Contracts ── */}
      {tab === 'contracts' && showContracts && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><FileText size={14} /> Contracts ({contracts.length})</h2>
            <Link to="/contracts" className="text-xs font-semibold text-brand-ink hover:underline">Manage →</Link>
          </div>
          {contracts.length ? (
            <div className="divide-y divide-divider">
              {contracts.map(c => {
                const days = daysUntilLocal(c.expiration_date)
                // Three tones: expiring inside 60 days is the state worth
                // flagging, and folding it into "not active" hides it.
                const tone = c.status === 'Active'
                  ? (days !== null && days >= 0 && days <= 60 ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')
                  : c.status === 'Expired' ? 'bg-gray-100 text-ink-muted' : 'bg-warning/15 text-warning'
                return (
                  <div key={c.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-ink truncate">
                        {c.type}{c.royalty_split ? ` · ${c.royalty_split}` : ''}{c.advance ? ` · ${c.advance}` : ''}
                      </p>
                      <p className="text-[11px] text-ink-faint">
                        {c.date_signed ? `Signed ${formatDate(c.date_signed)}` : 'Unsigned'}
                        {c.expiration_date ? ` · expires ${formatDate(c.expiration_date)}` : ''}
                        {c.territory ? ` · ${c.territory}` : ''}
                      </p>
                      {c.notes && <p className="text-[11px] text-ink-muted mt-1 whitespace-pre-line">{c.notes}</p>}
                      {c.file_name && (
                        <Link to="/contracts" className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink hover:underline mt-1">
                          <Paperclip size={11} /> {c.file_name}
                        </Link>
                      )}
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${tone}`}>{c.status || '—'}</span>
                  </div>
                )
              })}
            </div>
          ) : <p className="text-sm text-ink-muted">No contracts on file.</p>}
        </div>
      )}

      {/* ── Documents ── */}
      {tab === 'documents' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-ink">Documents</h2>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:underline cursor-pointer">
              <Paperclip size={13} /> {uploading ? 'Uploading…' : 'Attach'}
              <input type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
            </label>
          </div>
          <p className="text-[11px] text-ink-faint mb-3">Anything that isn’t a contract — riders, IDs, photos, demos, mood boards. Max 10 MB.</p>
          {uploadError && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs flex items-center justify-between gap-2">
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)}><X size={13} /></button>
            </div>
          )}
          <div
            {...dropTarget(f => { setDragging(false); doUploadFile(f) })}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            className={`rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-brand-400 bg-brand-500/10' : 'border-divider'} p-3`}
          >
            {files.length ? (
              <div className="divide-y divide-divider">
                {files.map(f => (
                  <div key={f.id} className="py-2 flex items-center gap-3 group">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <FileText size={14} className="text-ink-faint" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">{f.original_name}</p>
                      <p className="text-[11px] text-ink-faint">
                        {[fileSize(f.file_size), formatDate(f.created_at), f.uploaded_by_name].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => openFile(f.id)} title="Download" className="p-1.5 rounded-lg text-ink-faint hover:text-brand-ink hover:bg-brand-500/10"><Download size={14} /></button>
                      <button onClick={() => delFile(f)} title="Delete" className="p-1.5 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted text-center py-6">
                {dragging ? 'Drop to upload' : 'No files attached. Drag one here, or use Attach.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit artist" size="xl"
        footer={
          <>
            <button onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} className="btn-primary">Save changes</button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {EDIT_FIELDS.map(f => (
            <div key={f.key} className={f.key === 'name' || f.key === 'image_url' ? 'col-span-2' : ''}>
              <label className="label">{f.label}</label>
              <input type={f.type || 'text'} value={form[f.key] ?? ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} className="input" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="label">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} className="input resize-none" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm}
        title={confirm?.title}
        message={confirm?.message}
      />
    </div>
  )
}

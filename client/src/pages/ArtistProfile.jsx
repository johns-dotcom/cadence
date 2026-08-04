import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Pencil, X, Trash2, Plus, ExternalLink, Music,
  Instagram, Youtube, Globe, BarChart3, Paperclip, Download, Archive, ArchiveRestore, Sparkles, FileText,
} from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { DEV_LOG_TYPES } from '../constants'
import { formatDate } from '../utils/dates'

// Color-coding for development-log entry types (dot + label tint).
const LOG_STYLE = {
  Note:      { dot: 'bg-gray-400',    text: 'text-gray-500' },
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

const STAT = (n) => (n || n === 0) ? Number(n).toLocaleString() : '—'
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export default function ArtistProfile() {
  const { id } = useParams()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [artist, setArtist] = useState(null)
  const [log, setLog] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [bio, setBio] = useState('')
  const [newLog, setNewLog] = useState({ entry_type: 'Note', note: '' })
  const [tab, setTab] = useState('overview')

  const loadFiles = () => api.get(`/artists/${id}/files`).then(f => setFiles(f.data.data || [])).catch(() => {})
  const load = () => {
    setLoading(true)
    Promise.all([api.get(`/artists/${id}`), api.get(`/artists/${id}/log`)])
      .then(([a, l]) => { setArtist(a.data.data); setLog(l.data.data || []) })
      .catch(() => toast('Failed to load artist', 'error'))
      .finally(() => setLoading(false))
    loadFiles()
  }
  useEffect(() => { load() }, [id])

  const uploadFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    try { await api.post(`/artists/${id}/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); toast('File uploaded'); loadFiles() }
    catch { toast('Upload failed', 'error') }
    finally { e.target.value = '' }
  }
  const openFile = async (fid) => { try { const { data } = await api.get(`/artists/${id}/files/${fid}`); window.open(data.data.url, '_blank', 'noopener') } catch { toast('No file', 'error') } }
  const delFile = async (fid) => { try { await api.delete(`/artists/${id}/files/${fid}`); loadFiles() } catch { toast('Failed', 'error') } }
  const toggleArchive = async () => {
    try { await api.patch(`/artists/${id}`, { archived: !artist.archived }); toast(artist.archived ? 'Unarchived' : 'Archived'); load() }
    catch { toast('Failed', 'error') }
  }
  const [syncing, setSyncing] = useState(false)
  const syncSpotify = async () => {
    setSyncing(true)
    try { await api.post(`/artists/${id}/sync-spotify`); toast('Synced from Spotify'); load() }
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
      await api.patch(`/artists/${id}`, { ...form, bio })
      toast('Saved'); setEditing(false); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed to save', 'error') }
  }
  const addLog = async () => {
    if (!newLog.note.trim()) { toast('Note is required', 'error'); return }
    try {
      await api.post(`/artists/${id}/log`, newLog)
      setNewLog({ entry_type: 'Note', note: '' })
      api.get(`/artists/${id}/log`).then(l => setLog(l.data.data || []))
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
  }
  const deleteLog = async (logId) => {
    try { await api.delete(`/artists/${id}/log/${logId}`); setLog(l => l.filter(x => x.id !== logId)) }
    catch { toast('Failed', 'error') }
  }
  const remove = async () => {
    if (!window.confirm('Delete this artist? This cannot be undone.')) return
    try { await api.delete(`/artists/${id}`); toast('Artist deleted'); navigate('/artists') }
    catch { toast('Failed to delete', 'error') }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!artist) return <p className="text-sm text-gray-400">Artist not found.</p>

  const socialLinks = SOCIALS.filter(s => artist[s.key])
  const releases = artist.releases || []
  const contracts = artist.contracts || []
  const upcoming = releases.filter(r => r.release_date && new Date(r.release_date) > new Date() && r.status !== 'Archived')
  const activeContracts = contracts.filter(c => c.status === 'Active').length
  const spendCats = artist.spendByCategory || []
  const spendTotal = artist.spendTotal || 0
  const budgetTotal = artist.budgetTotal || 0
  const budgetPct = budgetTotal > 0 ? Math.round((spendTotal / budgetTotal) * 100) : 0
  const spendMax = spendCats.reduce((m, c) => Math.max(m, c.amount), 0) || 1
  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'spotify', label: 'Spotify' },
    { key: 'releases', label: `Releases (${releases.length})` },
    { key: 'spends', label: 'Spends' },
    { key: 'links', label: `Links (${socialLinks.length})` },
    { key: 'development', label: `Development (${log.length})` },
    { key: 'contracts', label: `Contracts (${contracts.length})` },
    { key: 'documents', label: 'Documents' },
  ]

  const ReleaseRow = (r) => (
    <Link key={r.id} to={`/releases/${r.id}`} className="card p-3 flex items-center gap-3 hover:border-brand-300 transition-colors">
      {r.cover_art_url
        ? <img src={r.cover_art_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0 bg-gray-100" />
        : <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Music size={15} className="text-gray-400" /></div>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{r.project_name}</p>
        <p className="text-[11px] text-gray-400">{r.release_type || 'Release'}{r.release_date ? ` · ${new Date(r.release_date).toLocaleDateString()}` : ''}</p>
      </div>
      <span className="text-[10px] font-semibold text-gray-400 uppercase">{r.status}</span>
    </Link>
  )

  const SpendingByCategory = () => (
    spendCats.length ? (
      <div className="space-y-2.5">
        {spendCats.map(c => (
          <div key={c.category} className="flex items-center gap-3 text-sm">
            <span className="w-28 flex-shrink-0 text-gray-500 truncate text-right">{c.category}</span>
            <div className="flex-1 h-3.5 rounded bg-gray-100 overflow-hidden"><div className="h-full bg-brand-500 rounded" style={{ width: `${Math.max(4, (c.amount / spendMax) * 100)}%` }} /></div>
            <span className="w-24 flex-shrink-0 text-right font-medium text-ink tabular-nums">{money(c.amount)}</span>
          </div>
        ))}
      </div>
    ) : <p className="text-sm text-gray-400">No spend recorded for this artist yet.</p>
  )

  return (
    <div>
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400 mb-4"><Link to="/artists" className="hover:text-gray-700">Roster</Link> <span className="mx-1">›</span> <span className="text-gray-600">{artist.name}</span></div>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        {artist.image_url
          ? <img src={artist.image_url} alt="" className="w-16 h-16 rounded-2xl object-cover flex-shrink-0 bg-gray-100" />
          : <div className="w-16 h-16 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0"><span className="text-2xl font-bold text-brand-700">{artist.name?.charAt(0)?.toUpperCase()}</span></div>}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-ink tracking-tight">{artist.name}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-sm text-gray-500">
            {artist.genre && <span>{artist.genre}</span>}
            <span className="text-gray-400">{releases.length} release{releases.length === 1 ? '' : 's'}</span>
            {activeContracts > 0 && <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{activeContracts} active contract{activeContracts === 1 ? '' : 's'}</span>}
            {artist.archived && <span className="text-[11px] font-semibold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Archived</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={syncSpotify} disabled={syncing} className="btn-secondary"><Sparkles size={14} /> {syncing ? 'Syncing…' : 'Spotify'}</button>
          <button onClick={startEdit} className="btn-secondary"><Pencil size={14} /> Edit</button>
          <button onClick={toggleArchive} title={artist.archived ? 'Unarchive' : 'Archive'} className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-gray-400 hover:text-amber-600 hover:border-amber-200">{artist.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>
          <button onClick={remove} className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-gray-400 hover:text-red-600 hover:border-red-200"><Trash2 size={15} /></button>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Releases</p><p className="text-2xl font-bold text-ink mt-1">{releases.length}</p></div>
        <div className="card p-4"><p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Upcoming</p><p className="text-2xl font-bold text-ink mt-1">{upcoming.length}</p></div>
      </div>

      {/* Budget bar */}
      {(budgetTotal > 0 || spendTotal > 0) && (
        <div className="card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-ink">Budget</span>
            <span className="text-sm text-gray-500 tabular-nums">{money(spendTotal)}{budgetTotal > 0 ? ` / ${money(budgetTotal)} (${budgetPct}%)` : ' spent'}</span>
          </div>
          {budgetTotal > 0 && (
            <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${budgetPct > 100 ? 'bg-rose-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, budgetPct)}%` }} /></div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-rule mb-6">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.label}</button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Upcoming releases</h2>
            {upcoming.length ? <div className="space-y-2">{upcoming.map(ReleaseRow)}</div> : <p className="text-sm text-gray-400">No upcoming releases.</p>}
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-4">Spending by category</h2>
            <SpendingByCategory />
          </div>
        </div>
      )}

      {/* ── Spotify ── */}
      {tab === 'spotify' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Monthly listeners', value: STAT(artist.spotify_monthly_listeners) },
            { label: 'Followers', value: STAT(artist.spotify_followers) },
            { label: 'Popularity', value: artist.spotify_popularity != null ? `${artist.spotify_popularity}/100` : '—' },
          ].map(s => (
            <div key={s.label} className="card p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><BarChart3 size={13} /> {s.label}</div>
              <p className="text-lg font-bold text-ink">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Releases ── */}
      {tab === 'releases' && (
        releases.length ? <div className="space-y-2">{releases.map(ReleaseRow)}</div> : <div className="card p-6 text-center"><p className="text-sm text-gray-400">No releases yet.</p></div>
      )}

      {/* ── Spends ── */}
      {tab === 'spends' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-bold text-ink">Spending by category</h2><span className="text-sm font-semibold text-ink">{money(spendTotal)} total</span></div>
          <SpendingByCategory />
        </div>
      )}

      {/* ── Links ── */}
      {tab === 'links' && (
        socialLinks.length ? (
          <div className="flex flex-wrap gap-2">
            {socialLinks.map(s => { const Icon = s.icon; return (
              <a key={s.key} href={artist[s.key]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-rule text-gray-600 hover:bg-gray-50"><Icon size={14} /> {s.label} <ExternalLink size={12} className="text-gray-400" /></a>
            ) })}
          </div>
        ) : <p className="text-sm text-gray-400">No links yet — add them via Edit.</p>
      )}

      {/* ── Development ── */}
      {tab === 'development' && (
        <div className="max-w-2xl">
          <div className="card p-3 mb-3">
            <div className="flex gap-2 mb-2">
              <select value={newLog.entry_type} onChange={e => setNewLog(l => ({ ...l, entry_type: e.target.value }))} className="input !w-auto !py-1.5 text-xs">{DEV_LOG_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            </div>
            <textarea value={newLog.note} onChange={e => setNewLog(l => ({ ...l, note: e.target.value }))} placeholder="Add a note, meeting outcome, demo feedback…" rows={2} className="input w-full resize-none text-sm" />
            <div className="flex justify-end mt-2"><button onClick={addLog} className="btn-primary !py-1.5 text-xs"><Plus size={13} /> Add entry</button></div>
          </div>
          {log.length ? (
            <div className="space-y-2">
              {log.map(e => { const st = LOG_STYLE[e.entry_type] || LOG_STYLE.Note; return (
                <div key={e.id} className="card p-3 group">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{e.entry_type}</span>
                    <div className="flex items-center gap-2"><span className="text-[10px] text-gray-400">{new Date(e.log_date).toLocaleDateString()}</span><button onClick={() => deleteLog(e.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"><Trash2 size={12} /></button></div>
                  </div>
                  <p className="text-sm text-ink whitespace-pre-line">{e.note}</p>
                  {e.author && <p className="text-[10px] text-gray-400 mt-1">— {e.author}</p>}
                </div>
              ) })}
            </div>
          ) : <div className="card p-6 text-center"><p className="text-sm text-gray-400">No log entries yet.</p></div>}
        </div>
      )}

      {/* ── Contracts ── */}
      {tab === 'contracts' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><FileText size={14} /> Contracts ({contracts.length})</h2>
            <Link to="/contracts" className="text-xs font-semibold text-brand-600 hover:underline">Manage →</Link>
          </div>
          {contracts.length ? (
            <div className="divide-y divide-divider">
              {contracts.map(c => (
                <div key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-ink truncate">{c.type}{c.royalty_split ? ` · ${c.royalty_split}` : ''}{c.advance ? ` · ${c.advance}` : ''}</p>
                    <p className="text-[11px] text-gray-400">{c.date_signed ? `Signed ${formatDate(c.date_signed)}` : 'Unsigned'}{c.expiration_date ? ` · expires ${formatDate(c.expiration_date)}` : ''}{c.territory ? ` · ${c.territory}` : ''}</p>
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{c.status || '—'}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No contracts on file.</p>}
        </div>
      )}

      {/* ── Documents ── */}
      {tab === 'documents' && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-ink">Files</h2>
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline cursor-pointer"><Paperclip size={13} /> Attach<input type="file" className="hidden" onChange={uploadFile} /></label>
          </div>
          {files.length ? (
            <div className="flex flex-wrap gap-2">
              {files.map(f => (
                <span key={f.id} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 rounded-lg px-2 py-1 group">
                  <button onClick={() => openFile(f.id)} className="inline-flex items-center gap-1 text-gray-600 hover:text-brand-600 max-w-[160px] truncate"><Download size={12} /> <span className="truncate">{f.original_name}</span></button>
                  <button onClick={() => delFile(f.id)} className="text-gray-300 hover:text-red-600"><X size={12} /></button>
                </span>
              ))}
            </div>
          ) : <p className="text-sm text-gray-400">No files attached.</p>}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-overlay overflow-y-auto" onClick={() => setEditing(false)}>
          <div className="w-full max-w-lg bg-card rounded-2xl border border-rule shadow-modal p-5 my-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-ink">Edit artist</h2>
              <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
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
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary">Save changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

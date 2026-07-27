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

  return (
    <div>
      <Link to="/artists" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft size={15} /> Back to roster
      </Link>

      {/* Header */}
      <div className="card p-5 mb-6 flex items-start gap-4">
        {artist.image_url ? (
          <img src={artist.image_url} alt="" className="w-20 h-20 rounded-2xl object-cover flex-shrink-0 bg-gray-100" />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-brand-700">{artist.name?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink tracking-tight">{artist.name}</h1>
          {artist.genre && <p className="text-sm text-gray-500 mt-0.5">{artist.genre}</p>}
          {artist.bio && <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{artist.bio}</p>}
          {socialLinks.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {socialLinks.map(s => {
                const Icon = s.icon
                return (
                  <a key={s.key} href={artist[s.key]} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-rule text-gray-600 hover:bg-gray-50">
                    <Icon size={13} /> {s.label} <ExternalLink size={11} className="text-gray-400" />
                  </a>
                )
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={syncSpotify} disabled={syncing} className="btn-secondary"><Sparkles size={14} /> {syncing ? 'Syncing…' : 'Spotify'}</button>
          <button onClick={startEdit} className="btn-secondary"><Pencil size={14} /> Edit</button>
          <button onClick={toggleArchive} title={artist.archived ? 'Unarchive' : 'Archive'} className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-gray-400 hover:text-amber-600 hover:border-amber-200">
            {artist.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
          <button onClick={remove} className="inline-flex items-center justify-center p-2 rounded-lg border border-rule text-gray-400 hover:text-red-600 hover:border-red-200"><Trash2 size={15} /></button>
        </div>
      </div>

      {/* Spotify stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
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

      {/* Files */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink">Files</h2>
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline cursor-pointer">
            <Paperclip size={13} /> Attach
            <input type="file" className="hidden" onChange={uploadFile} />
          </label>
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

      {/* Contracts */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><FileText size={14} /> Contracts ({artist.contracts?.length || 0})</h2>
          <Link to="/contracts" className="text-xs font-semibold text-brand-600 hover:underline">Manage →</Link>
        </div>
        {artist.contracts?.length ? (
          <div className="divide-y divide-divider">
            {artist.contracts.map(c => (
              <div key={c.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-ink truncate">{c.type}{c.royalty_split ? ` · ${c.royalty_split}` : ''}{c.advance ? ` · ${c.advance}` : ''}</p>
                  <p className="text-[11px] text-gray-400">
                    {c.date_signed ? `Signed ${formatDate(c.date_signed)}` : 'Unsigned'}
                    {c.expiration_date ? ` · expires ${formatDate(c.expiration_date)}` : ''}
                    {c.territory ? ` · ${c.territory}` : ''}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${c.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{c.status || '—'}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400">No contracts on file.</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Releases */}
        <div>
          <h2 className="text-sm font-semibold text-ink mb-3">Releases ({artist.releases?.length || 0})</h2>
          {artist.releases?.length ? (
            <div className="space-y-2">
              {artist.releases.map(r => (
                <Link key={r.id} to={`/releases/${r.id}`} className="card p-3 flex items-center gap-3 hover:border-brand-300 transition-colors">
                  {r.cover_art_url ? (
                    <img src={r.cover_art_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0 bg-gray-100" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0"><Music size={15} className="text-gray-400" /></div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink truncate">{r.project_name}</p>
                    <p className="text-[11px] text-gray-400">{r.release_type || 'Release'}{r.release_date ? ` · ${new Date(r.release_date).toLocaleDateString()}` : ''}</p>
                  </div>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">{r.status}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card p-6 text-center"><p className="text-sm text-gray-400">No releases yet.</p></div>
          )}
        </div>

        {/* Development log */}
        <div>
          <h2 className="text-sm font-semibold text-ink mb-3">Development log</h2>
          <div className="card p-3 mb-3">
            <div className="flex gap-2 mb-2">
              <select value={newLog.entry_type} onChange={e => setNewLog(l => ({ ...l, entry_type: e.target.value }))} className="input !w-auto !py-1.5 text-xs">
                {DEV_LOG_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <textarea value={newLog.note} onChange={e => setNewLog(l => ({ ...l, note: e.target.value }))} placeholder="Add a note, meeting outcome, demo feedback…" rows={2} className="input w-full resize-none text-sm" />
            <div className="flex justify-end mt-2"><button onClick={addLog} className="btn-primary !py-1.5 text-xs"><Plus size={13} /> Add entry</button></div>
          </div>
          {log.length ? (
            <div className="space-y-2">
              {log.map(e => {
                const st = LOG_STYLE[e.entry_type] || LOG_STYLE.Note
                return (
                <div key={e.id} className="card p-3 group">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${st.text}`}><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{e.entry_type}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">{new Date(e.log_date).toLocaleDateString()}</span>
                      <button onClick={() => deleteLog(e.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <p className="text-sm text-ink whitespace-pre-line">{e.note}</p>
                  {e.author && <p className="text-[10px] text-gray-400 mt-1">— {e.author}</p>}
                </div>
                )
              })}
            </div>
          ) : (
            <div className="card p-6 text-center"><p className="text-sm text-gray-400">No log entries yet.</p></div>
          )}
        </div>
      </div>

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

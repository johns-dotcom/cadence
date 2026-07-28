import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Check, Trash2, Sparkles, Archive, RotateCcw, UserCircle2 } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { RELEASE_TYPES, RELEASE_STATUSES, RELEASE_CHECKLIST, RELEASE_CHECKLIST_GROUPS, PRIORITIES } from '../constants'
import DspTracker from '../components/DspTracker'
import ReleaseExtras from '../components/ReleaseExtras'
import { formatDate } from '../utils/dates'
import useHotkeys from '../hooks/useHotkeys'

const LABELS = Object.fromEntries(RELEASE_CHECKLIST.map(c => [c.key, c.label]))
const TABS = ['Checklist', 'Metadata', 'DSP', 'Budget', 'Activity', 'Comments', 'Details']

export default function ReleaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const isAdmin = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)
  const [release, setRelease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState('Checklist')
  const [members, setMembers] = useState([])

  useEffect(() => {
    api.get(`/releases/${id}`)
      .then(res => setRelease(res.data.data))
      .catch(() => toast('Release not found', 'error'))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(() => { if (isAdmin) api.get('/team').then(r => setMembers(r.data.data || [])).catch(() => {}) }, [isAdmin])

  // Hotkeys: 1–7 jump to a tab; Esc goes back to the list.
  useHotkeys({
    ...Object.fromEntries(TABS.map((t, i) => [String(i + 1), () => setTab(t)])),
    Escape: () => navigate('/releases'),
  }, [navigate])

  const patch = async (fields) => {
    try {
      const { data } = await api.patch(`/releases/${id}`, fields)
      setRelease(data.data)
      return true
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to save', 'error')
      return false
    }
  }
  const set = (k) => (e) => setRelease(r => ({ ...r, [k]: e.target.value }))

  const syncArtwork = async () => {
    setSyncing(true)
    try {
      const { data } = await api.post(`/releases/${id}/sync-artwork`)
      setRelease(r => ({ ...r, cover_art_url: data.data.cover_art_url }))
      toast('Artwork synced from Spotify')
    } catch (err) { toast(err.response?.data?.error || 'No artwork found', 'error') }
    finally { setSyncing(false) }
  }

  const saveMeta = async () => {
    setSaving(true)
    await patch({
      project_name: release.project_name,
      release_date: release.release_date || null,
      release_type: release.release_type || null,
      genre: release.genre || null,
      priority: release.priority || null,
      producer: release.producer || null,
      featured_artists: release.featured_artists || null,
      upc: release.upc || null,
      isrc: release.isrc || null,
      spotify_uri: release.spotify_uri || null,
      notes: release.notes || null,
    })
    setSaving(false)
    toast('Saved')
  }

  const toggleChecklist = (key) => patch({ [key]: !release[key] })

  const remove = async () => {
    if (!window.confirm('Delete this release?')) return
    try { await api.delete(`/releases/${id}`); toast('Release deleted'); navigate('/releases') }
    catch { toast('Failed to delete', 'error') }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!release) return (
    <div className="card p-10 text-center">
      <p className="text-sm text-gray-500 mb-3">Release not found.</p>
      <Link to="/releases" className="text-sm text-brand-600">← Back to releases</Link>
    </div>
  )

  const total = RELEASE_CHECKLIST.length
  const done = RELEASE_CHECKLIST.filter(c => release[c.key]).length
  const pct = Math.round((done / total) * 100)

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate('/releases')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={15} /> Releases
      </button>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          {release.cover_art_url
            ? <img src={release.cover_art_url} alt="" className="w-14 h-14 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
            : <div className="w-14 h-14 rounded-lg bg-gray-100 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-ink tracking-tight truncate">{release.project_name}</h1>
              {release.archived && <span className="text-[10px] font-bold uppercase bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">Archived</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {release.artist_name || 'Unassigned'}
              {release.release_date ? ` · ${formatDate(release.release_date)}` : ''}
              {release.assignee_name ? ` · owned by ${release.assignee_name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={syncArtwork} disabled={syncing} className="btn-secondary"><Sparkles size={15} /> {syncing ? 'Syncing…' : 'Sync artwork'}</button>
        </div>
      </div>

      {/* Completion bar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full bg-brand-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs font-semibold text-gray-500 tabular-nums">{done}/{total} · {pct}%</span>
      </div>

      {/* Tab strip (scrollable on mobile). Number hints double as hotkeys. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-divider mb-5 -mx-1 px-1">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t ? 'border-brand-600 text-ink' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t} <span className="text-[10px] text-gray-300 ml-0.5">{i + 1}</span>
          </button>
        ))}
      </div>

      {/* ── Checklist ── */}
      {tab === 'Checklist' && (
        <div className="space-y-5">
          {RELEASE_CHECKLIST_GROUPS.map(group => {
            const gDone = group.keys.filter(k => release[k]).length
            return (
              <div key={group.name} className="card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-ink">{group.name}</h2>
                  <span className="text-xs text-gray-400">{gDone}/{group.keys.length}</span>
                </div>
                <div className="space-y-1">
                  {group.keys.map(key => {
                    const on = !!release[key]
                    return (
                      <button key={key} onClick={() => toggleChecklist(key)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 text-left transition">
                        <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>
                          {on && <Check size={11} className="text-white" />}
                        </span>
                        <span className={`text-sm ${on ? 'text-ink line-through decoration-gray-300' : 'text-gray-600'}`}>{LABELS[key] || key}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Metadata ── */}
      {tab === 'Metadata' && (
        <div className="card p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="label">Project name</label><input className="input" value={release.project_name || ''} onChange={set('project_name')} /></div>
            <div><label className="label">Type</label><select className="input" value={release.release_type || ''} onChange={set('release_type')}><option value="">—</option>{RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className="label">Priority</label><select className="input" value={release.priority || ''} onChange={set('priority')}><option value="">Standard</option>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
            <div><label className="label">Release date</label><input type="date" className="input" value={release.release_date ? release.release_date.slice(0, 10) : ''} onChange={set('release_date')} /></div>
            <div><label className="label">Genre</label><input className="input" value={release.genre || ''} onChange={set('genre')} /></div>
            <div><label className="label">Producer</label><input className="input" value={release.producer || ''} onChange={set('producer')} /></div>
            <div><label className="label">Featured artists</label><input className="input" value={release.featured_artists || ''} onChange={set('featured_artists')} /></div>
            <div><label className="label">UPC</label><input className="input" value={release.upc || ''} onChange={set('upc')} /></div>
            <div><label className="label">ISRC</label><input className="input" value={release.isrc || ''} onChange={set('isrc')} /></div>
            <div className="sm:col-span-2"><label className="label">Spotify URI</label><input className="input" value={release.spotify_uri || ''} onChange={set('spotify_uri')} placeholder="spotify:album:…" /></div>
            <div className="sm:col-span-2"><label className="label">Notes</label><textarea className="input" rows={3} value={release.notes || ''} onChange={set('notes')} /></div>
          </div>
          <button onClick={saveMeta} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save details'}</button>
        </div>
      )}

      {/* ── DSP ── */}
      {tab === 'DSP' && <div className="-mt-6"><DspTracker releaseId={id} /></div>}

      {/* ── Budget ── */}
      {tab === 'Budget' && <ReleaseExtras releaseId={id} budgetCap={release.budget_cap} onCapChange={(v) => patch({ budget_cap: v === '' ? null : v })} section="budget" />}

      {/* ── Activity ── */}
      {tab === 'Activity' && <ActivityTab releaseId={id} />}

      {/* ── Comments ── */}
      {tab === 'Comments' && <ReleaseExtras releaseId={id} section="comments" />}

      {/* ── Details ── */}
      {tab === 'Details' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-3">Status & ownership</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Status</label>
                <select className="input" value={release.status || 'Draft'} onChange={e => patch({ status: e.target.value })}>{RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
              </div>
              <div>
                <label className="label inline-flex items-center gap-1"><UserCircle2 size={13} /> Owner</label>
                <select className="input" value={release.assigned_to || ''} onChange={e => patch({ assigned_to: e.target.value ? Number(e.target.value) : null })} disabled={!isAdmin}>
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-bold text-ink mb-1">Archive & delete</h2>
            <p className="text-xs text-gray-400 mb-3">Archiving keeps the release in the catalog but out of active pipelines.</p>
            <div className="flex items-center gap-2">
              <button onClick={() => patch({ archived: !release.archived })} className="btn-secondary">
                {release.archived ? <><RotateCcw size={15} /> Unarchive</> : <><Archive size={15} /> Archive</>}
              </button>
              <button onClick={remove} className="btn-secondary text-danger"><Trash2 size={15} /> Delete release</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Best-effort recent-changes feed for this release, from the activity log.
function ActivityTab({ releaseId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { api.get(`/releases/${releaseId}/activity`).then(r => setRows(r.data.data || [])).catch(() => setRows([])) }, [releaseId])
  if (rows === null) return <p className="text-sm text-gray-400">Loading…</p>
  if (!rows.length) return <div className="card p-8 text-center"><p className="text-sm text-gray-400">No recorded activity for this release yet.</p></div>
  return (
    <div className="card p-5">
      <ul className="divide-y divide-divider">
        {rows.map(a => (
          <li key={a.id} className="py-2.5 flex items-center justify-between gap-4">
            <p className="text-sm text-ink truncate min-w-0"><span className="font-medium">{a.user_name || 'Someone'}</span> <span className="text-gray-500">{a.action}</span>{a.detail && <span className="text-gray-400"> — {a.detail}</span>}</p>
            <span className="text-xs text-gray-400 flex-shrink-0">{new Date(a.created_at).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

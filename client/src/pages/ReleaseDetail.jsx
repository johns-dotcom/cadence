import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Check, Trash2, Sparkles } from 'lucide-react'
import api from '../api'
import { useToast } from '../context/ToastContext'
import { RELEASE_TYPES, RELEASE_STATUSES, RELEASE_CHECKLIST } from '../constants'
import DspTracker from '../components/DspTracker'
import ReleaseExtras from '../components/ReleaseExtras'

export default function ReleaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [release, setRelease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get(`/releases/${id}`)
      .then(res => setRelease(res.data.data))
      .catch(() => toast('Release not found', 'error'))
      .finally(() => setLoading(false))
  }, [id])

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

  const [syncing, setSyncing] = useState(false)
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
      status: release.status,
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

  const done = RELEASE_CHECKLIST.filter(c => release[c.key]).length

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate('/releases')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={15} /> Releases
      </button>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {release.cover_art_url && <img src={release.cover_art_url} alt="" className="w-14 h-14 rounded-lg object-cover bg-gray-100 flex-shrink-0" />}
          <div>
            <h1 className="text-xl font-bold text-ink tracking-tight">{release.project_name}</h1>
            <p className="text-sm text-gray-500 mt-1">{release.artist_name || 'Unassigned'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncArtwork} disabled={syncing} className="btn-secondary"><Sparkles size={15} /> {syncing ? 'Syncing…' : 'Sync artwork'}</button>
          <button onClick={remove} className="btn-secondary text-danger"><Trash2 size={15} /> Delete</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Metadata */}
        <div className="lg:col-span-2 card p-5 space-y-3">
          <h2 className="text-sm font-bold text-ink mb-2">Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="label">Project name</label><input className="input" value={release.project_name || ''} onChange={set('project_name')} /></div>
            <div><label className="label">Type</label><select className="input" value={release.release_type || ''} onChange={set('release_type')}><option value="">—</option>{RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className="label">Status</label><select className="input" value={release.status || 'Draft'} onChange={set('status')}>{RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
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

        {/* Checklist */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-ink">Prep checklist</h2>
            <span className="text-xs text-gray-400">{done}/{RELEASE_CHECKLIST.length}</span>
          </div>
          <div className="space-y-1.5">
            {RELEASE_CHECKLIST.map(item => {
              const on = !!release[item.key]
              return (
                <button
                  key={item.key}
                  onClick={() => toggleChecklist(item.key)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 text-left transition"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${on ? 'bg-brand-600 border-brand-600' : 'border-gray-300'}`}>
                    {on && <Check size={11} className="text-white" />}
                  </span>
                  <span className={`text-sm ${on ? 'text-ink line-through decoration-gray-300' : 'text-gray-600'}`}>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <DspTracker releaseId={id} />
      <ReleaseExtras releaseId={id} budgetCap={release.budget_cap} onCapChange={(v) => patch({ budget_cap: v === '' ? null : v })} />
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import api from '../api'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import ReleaseWorkspace, { TAB_IDS } from '../components/ReleaseWorkspace'
import useHotkeys from '../hooks/useHotkeys'
import { hasArtwork } from '../utils/releases'

// Standalone page wrapper around the shared 7-tab workspace. Everything the
// list's expanded row can do, this page can do — because it is literally the
// same component. The page adds only what a full route can offer: a back link
// that knows where you came from, and the per-release artwork sync.
export default function ReleaseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const fromCatalog = location.state?.from === 'catalog'
  const backTo = fromCatalog ? '/catalog' : '/releases'

  const [release, setRelease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [tab, setTab] = useState('checklist')
  const [members, setMembers] = useState([])
  const [artists, setArtists] = useState([])
  // Unsaved Metadata-tab edits. Escape is a navigation key here, so without
  // this one keypress outside an input silently discarded a form of work.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/releases/${id}`)
      .then(res => setRelease(res.data.data))
      .catch(() => toast('Release not found', 'error'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    api.get('/team').then(r => setMembers(r.data.data || [])).catch(() => {})
    api.get('/artists').then(r => setArtists(r.data.data || [])).catch(() => {})
  }, [])

  // 1–7 jump to a tab; Escape goes back where you came from — unless there are
  // unsaved metadata edits, in which case it asks first.
  useHotkeys({
    ...Object.fromEntries(TAB_IDS.map((t, i) => [String(i + 1), () => setTab(t)])),
    Escape: () => {
      if (dirty && !window.confirm('Discard unsaved changes to this release?')) return
      navigate(backTo)
    },
  }, [navigate, backTo, dirty])

  const onPatched = useCallback((updated) => setRelease(prev => ({ ...prev, ...updated })), [])

  const syncArtwork = async () => {
    setSyncing(true)
    try {
      const { data } = await api.post(`/releases/${id}/sync-artwork`)
      setRelease(r => ({ ...r, cover_art_url: data.data.cover_art_url }))
      toast('Artwork synced from Spotify')
    } catch (err) { toast(err.response?.data?.error || 'No artwork found', 'error') }
    finally { setSyncing(false) }
  }

  if (loading) return <div className="space-y-6 max-w-4xl"><Skeleton.PageHeader /><Skeleton.Block h="h-64" /></div>
  if (!release) return (
    <div className="card p-10 text-center">
      <p className="text-sm text-ink-muted mb-3">Release not found.</p>
      <Link to="/releases" className="text-sm text-brand-ink">← Back to releases</Link>
    </div>
  )

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate(backTo)} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink mb-4">
        <ArrowLeft size={15} /> {fromCatalog ? 'Catalog' : 'Releases'}
      </button>

      {/* Artwork + its sync action. Everything else about the release lives in
          the shared workspace below, so this row stays deliberately thin. */}
      <div className="flex items-center justify-between gap-3 mb-5">
        {hasArtwork(release)
          ? <img src={release.cover_art_url} alt={`${release.project_name} cover art`} onError={e => { e.currentTarget.style.visibility = 'hidden' }} className="w-16 h-16 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
          : <div className="w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0" />}
        <button onClick={syncArtwork} disabled={syncing} className="btn-secondary flex-shrink-0">
          <Sparkles size={15} /> {syncing ? 'Syncing…' : 'Sync artwork'}
        </button>
      </div>

      <ReleaseWorkspace
        release={release}
        tab={tab}
        onTabChange={setTab}
        onPatched={onPatched}
        onRemoved={() => navigate('/releases')}
        onDirtyChange={setDirty}
        artists={artists}
        members={members}
        variant="page"
      />
    </div>
  )
}

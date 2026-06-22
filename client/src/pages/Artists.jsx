import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Disc3 } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'

export default function Artists() {
  const { toast } = useToast()
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [genre, setGenre] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/artists').then(res => setArtists(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const create = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.post('/artists', { name: name.trim(), genre: genre.trim() || undefined })
      toast('Artist added')
      setName(''); setGenre(''); setShowForm(false)
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add artist', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Artists"
        subtitle="Your label's roster"
        action={
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={16} /> Add artist
          </button>
        }
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label">Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Artist name" autoFocus />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="label">Genre</label>
            <input className="input" value={genre} onChange={e => setGenre(e.target.value)} placeholder="Optional" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : artists.length === 0 ? (
        <div className="card p-10 text-center">
          <Disc3 size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No artists yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {artists.map(a => (
            <Link key={a.id} to={`/artists/${a.id}`} className="card p-4 flex items-center gap-3 hover:border-brand-300 transition-colors">
              {a.image_url ? (
                <img src={a.image_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0 bg-gray-100" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-700">{a.name?.charAt(0)?.toUpperCase()}</span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">{a.name}</p>
                <p className="text-xs text-gray-400">
                  {a.genre ? `${a.genre} · ` : ''}{a.total_releases} release{a.total_releases === 1 ? '' : 's'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

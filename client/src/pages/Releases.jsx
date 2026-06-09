import { useEffect, useState } from 'react'
import { Plus, Music } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { RELEASE_TYPES, RELEASE_STATUSES } from '../constants'

const STATUS_STYLES = {
  Draft:     'bg-gray-100 text-gray-600',
  Scheduled: 'bg-amber-100 text-amber-700',
  Released:  'bg-emerald-100 text-emerald-700',
  Archived:  'bg-gray-100 text-gray-400',
}

export default function Releases() {
  const { toast } = useToast()
  const [releases, setReleases] = useState([])
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ project_name: '', artist_id: '', release_date: '', release_type: 'Single', status: 'Draft' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([api.get('/releases'), api.get('/artists')])
      .then(([r, a]) => { setReleases(r.data.data || []); setArtists(a.data.data || []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.project_name.trim()) return
    setSaving(true)
    try {
      await api.post('/releases', {
        ...form,
        artist_id: form.artist_id || undefined,
        release_date: form.release_date || undefined,
      })
      toast('Release created')
      setForm({ project_name: '', artist_id: '', release_date: '', release_type: 'Single', status: 'Draft' })
      setShowForm(false)
      load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create release', 'error')
    } finally {
      setSaving(false)
    }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <PageHeader
        title="Releases"
        subtitle="Release pipeline"
        action={
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={16} /> New release
          </button>
        }
      />

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <label className="label">Project name</label>
            <input className="input" value={form.project_name} onChange={set('project_name')} placeholder="Single / EP / Album title" autoFocus />
          </div>
          <div>
            <label className="label">Artist</label>
            <select className="input" value={form.artist_id} onChange={set('artist_id')}>
              <option value="">Unassigned</option>
              {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Release date</label>
            <input type="date" className="input" value={form.release_date} onChange={set('release_date')} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.release_type} onChange={set('release_type')}>
              {RELEASE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              {RELEASE_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : releases.length === 0 ? (
        <div className="card p-10 text-center">
          <Music size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No releases yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Project</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Artist</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {releases.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-ink">{r.project_name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.artist_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.release_type || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{r.release_date ? new Date(r.release_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.status] || STATUS_STYLES.Draft}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

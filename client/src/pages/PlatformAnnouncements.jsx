import { useEffect, useState } from 'react'
import { Megaphone, Plus, Trash2, Info, AlertTriangle, AlertOctagon, Eye, EyeOff } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import Skeleton from '../components/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const LEVELS = [
  { key: 'info', label: 'Info', icon: Info, chip: 'bg-brand-500/15 text-brand-700' },
  { key: 'warning', label: 'Warning', icon: AlertTriangle, chip: 'bg-amber-100 text-amber-700' },
  { key: 'critical', label: 'Critical', icon: AlertOctagon, chip: 'bg-red-100 text-red-700' },
]
const LEVEL = Object.fromEntries(LEVELS.map(l => [l.key, l]))
const BLANK = { title: '', body: '', level: 'info', target_label_ids: [], ends_at: '' }

export default function PlatformAnnouncements() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isOwner = user?.platform_role === 'owner'
  const [list, setList] = useState([])
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  const load = () => { setLoading(true); api.get('/platform/announcements').then(r => setList(r.data.data || [])).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(() => { load(); api.get('/platform/workspaces').then(r => setWorkspaces(r.data.data || [])).catch(() => {}) }, [])

  const create = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast('A title is required', 'error'); return }
    setSaving(true)
    try {
      await api.post('/platform/announcements', {
        title: form.title.trim(), body: form.body || null, level: form.level,
        target_label_ids: form.target_label_ids.length ? form.target_label_ids : null,
        ends_at: form.ends_at || null,
      })
      toast('Announcement published')
      setForm(BLANK); setShowForm(false); load()
    } catch (err) { toast(err.response?.data?.error || 'Failed', 'error') }
    finally { setSaving(false) }
  }
  const toggle = async (a) => { try { await api.patch(`/platform/announcements/${a.id}`, { active: !a.active }); load() } catch { toast('Failed', 'error') } }
  const remove = async (a) => { if (!window.confirm('Delete this announcement?')) return; try { await api.delete(`/platform/announcements/${a.id}`); load() } catch { toast('Failed', 'error') } }
  const toggleTarget = (id) => setForm(f => ({ ...f, target_label_ids: f.target_label_ids.includes(id) ? f.target_label_ids.filter(x => x !== id) : [...f.target_label_ids, id] }))

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Broadcast a banner to every workspace, or a targeted set"
        action={isOwner ? <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> New announcement</button> : null}
      />

      {showForm && isOwner && (
        <form onSubmit={create} className="card p-4 mb-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><label className="label">Title</label><input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
            <div><label className="label">Level</label><select className="input" value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))}>{LEVELS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></div>
          </div>
          <div><label className="label">Message</label><textarea className="input" rows={3} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Optional details shown under the title" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Audience</label>
              {form.target_label_ids.length === 0
                ? <p className="text-xs text-gray-500 mb-1.5">All workspaces <span className="text-gray-400">— pick below to target specific ones</span></p>
                : <p className="text-xs text-gray-500 mb-1.5">{form.target_label_ids.length} workspace{form.target_label_ids.length === 1 ? '' : 's'} selected</p>}
              <div className="max-h-32 overflow-y-auto border border-rule rounded-lg p-2 space-y-0.5">
                {workspaces.map(w => (
                  <label key={w.id} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer px-1 py-0.5 rounded hover:bg-gray-50">
                    <input type="checkbox" checked={form.target_label_ids.includes(w.id)} onChange={() => toggleTarget(w.id)} /> {w.name}
                  </label>
                ))}
                {!workspaces.length && <p className="text-xs text-gray-400">No workspaces.</p>}
              </div>
            </div>
            <div><label className="label">Expires (optional)</label><input type="datetime-local" className="input" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Publishing…' : 'Publish'}</button></div>
        </form>
      )}

      {loading ? (
        <Skeleton.TaskList count={4} />
      ) : list.length === 0 ? (
        <div className="card p-10 text-center"><Megaphone size={26} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No announcements yet.</p></div>
      ) : (
        <div className="space-y-2">
          {list.map(a => {
            const lv = LEVEL[a.level] || LEVEL.info
            const Icon = lv.icon
            return (
              <div key={a.id} className={`card p-4 flex items-start gap-3 ${!a.active ? 'opacity-60' : ''}`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${lv.chip}`}><Icon size={15} /></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-ink truncate">{a.title}</p>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lv.chip}`}>{lv.label}</span>
                    {!a.active && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
                  </div>
                  {a.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.body}</p>}
                  <p className="text-[11px] text-gray-400 mt-1">
                    {a.target_label_ids?.length ? `${a.target_label_ids.length} workspace${a.target_label_ids.length === 1 ? '' : 's'}` : 'All workspaces'}
                    {' · '}{a.dismissals} dismissed{a.author ? ` · by ${a.author}` : ''}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggle(a)} title={a.active ? 'Deactivate' : 'Activate'} className="text-gray-400 hover:text-brand-600 p-1">{a.active ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    <button onClick={() => remove(a)} title="Delete" className="text-gray-300 hover:text-red-600 p-1"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

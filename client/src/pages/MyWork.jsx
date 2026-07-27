import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, CheckSquare, AlertTriangle, Inbox, Stamp } from 'lucide-react'
import api from '../api'
import PageHeader from '../components/PageHeader'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { TASK_STATUSES, PRIORITIES } from '../constants'
import { isPastLocal } from '../utils/dates'

const PRIORITY_DOT = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-gray-400' }

export default function MyWork() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isAdmin = ['Superadmin', 'Admin'].includes(user?.role)
  const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(user?.role)

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [reviewCount, setReviewCount] = useState(0)
  const [pending, setPending] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState('mine') // 'mine' | 'all' (admins)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ description: '', priority: 'Medium', due_date: '', user_id: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    const url = scope === 'all' && isAdmin ? '/tasks?scope=all' : '/tasks'
    api.get(url).then(res => setTasks(res.data.data || [])).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(load, [scope])
  useEffect(() => { if (isAdmin) api.get('/team').then(res => setMembers(res.data.data || [])).catch(() => {}) }, [isAdmin])
  useEffect(() => {
    if (!isApprover) return
    api.get('/dashboard/widgets').then(r => setPending(r.data.data?.pendingApprovals || 0)).catch(() => {})
    api.get('/artist-campaigns/review-inbox').then(r => setReviewCount((r.data.data || []).length)).catch(() => {})
  }, [isApprover])

  const overdue = tasks.filter(t => t.status !== 'Done' && t.due_date && isPastLocal(t.due_date)).length

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    if (!form.description.trim()) return
    setSaving(true)
    try {
      await api.post('/tasks', {
        description: form.description.trim(),
        priority: form.priority,
        due_date: form.due_date || undefined,
        user_id: form.user_id || undefined,
      })
      toast('Task added')
      setForm({ description: '', priority: 'Medium', due_date: '', user_id: '' })
      setShowForm(false); load()
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add task', 'error')
    } finally { setSaving(false) }
  }

  const setStatus = async (id, status) => {
    try { await api.patch(`/tasks/${id}`, { status }); load() } catch { toast('Failed', 'error') }
  }
  const remove = async (id) => {
    try { await api.delete(`/tasks/${id}`); load() } catch { toast('Failed', 'error') }
  }

  const columns = TASK_STATUSES.map(s => ({ status: s, items: tasks.filter(t => t.status === s) }))

  return (
    <div>
      <PageHeader
        title="My Work"
        subtitle={scope === 'all' ? 'All tasks in this workspace' : 'Tasks assigned to you'}
        action={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select value={scope} onChange={e => setScope(e.target.value)} className="input w-auto">
                <option value="mine">My tasks</option>
                <option value="all">Everyone</option>
              </select>
            )}
            <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={16} /> Add task</button>
          </div>
        }
      />

      {isApprover && (overdue > 0 || reviewCount > 0 || pending > 0) && (
        <div className="mb-6">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Waiting on you</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {overdue > 0 && (
              <div className="card p-4 flex items-center gap-3 border-l-4 border-l-red-500">
                <AlertTriangle size={20} className="text-red-500 flex-shrink-0" />
                <div><p className="text-lg font-bold text-ink leading-none">{overdue}</p><p className="text-xs text-gray-500 mt-1">Overdue task{overdue === 1 ? '' : 's'}</p></div>
              </div>
            )}
            {pending > 0 && (
              <Link to="/approvals" className="card p-4 flex items-center gap-3 border-l-4 border-l-amber-500 hover:bg-gray-50 transition">
                <Stamp size={20} className="text-amber-500 flex-shrink-0" />
                <div><p className="text-lg font-bold text-ink leading-none">{pending}</p><p className="text-xs text-gray-500 mt-1">Awaiting your approval</p></div>
              </Link>
            )}
            {reviewCount > 0 && (
              <Link to="/artist-campaigns" className="card p-4 flex items-center gap-3 border-l-4 border-l-brand-500 hover:bg-gray-50 transition">
                <Inbox size={20} className="text-brand-500 flex-shrink-0" />
                <div><p className="text-lg font-bold text-ink leading-none">{reviewCount}</p><p className="text-xs text-gray-500 mt-1">Campaign{reviewCount === 1 ? '' : 's'} to review</p></div>
              </Link>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="card p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2 lg:col-span-2"><label className="label">Task</label><input className="input" value={form.description} onChange={set('description')} autoFocus /></div>
          <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={set('priority')}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
          <div><label className="label">Due date</label><input type="date" className="input" value={form.due_date} onChange={set('due_date')} /></div>
          {isAdmin && (
            <div className="sm:col-span-2">
              <label className="label">Assign to</label>
              <select className="input" value={form.user_id} onChange={set('user_id')}>
                <option value="">Me ({user?.name})</option>
                {members.filter(m => m.id !== user?.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-end"><button type="submit" disabled={saving} className="btn-primary w-full">{saving ? 'Adding…' : 'Add'}</button></div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="card p-10 text-center"><CheckSquare size={28} className="text-gray-300 mx-auto mb-3" /><p className="text-sm text-gray-500">No tasks. Add one to get started.</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {columns.map(col => (
            <div key={col.status} className="bg-elev border border-rule rounded-2xl p-3">
              <div className="flex items-center justify-between px-1 mb-2">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wide">{col.status}</h3>
                <span className="text-xs text-gray-400">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.map(t => (
                  <div key={t.id} className="card p-3 group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.Medium}`} />
                        <div className="min-w-0">
                          <p className="text-sm text-ink">{t.description}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {scope === 'all' && t.assignee_name ? `${t.assignee_name} · ` : ''}
                            {t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : 'No due date'}
                            {t.release_name ? ` · ${t.release_name}` : ''}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => remove(t.id)} className="text-gray-300 hover:text-danger opacity-0 group-hover:opacity-100 transition flex-shrink-0" title="Delete"><Trash2 size={13} /></button>
                    </div>
                    <select
                      value={t.status}
                      onChange={e => setStatus(t.id, e.target.value)}
                      className="mt-2 text-[11px] font-medium border border-rule rounded-md px-1.5 py-1 bg-card text-gray-600 cursor-pointer"
                    >
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                ))}
                {col.items.length === 0 && <p className="text-xs text-gray-300 px-1 py-2">Empty</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

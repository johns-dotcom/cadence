// Team member detail — one person's profile: identity, workload stats, the
// releases they own (with checklist completion and the 14-day risk window), their
// task list, and their activity trail. The drill-down behind every name on /team.
//
// Task visibility is decided SERVER-SIDE (routes/team.js GET /:id): admin, self, or
// a lead of that person's department sees everything; everyone else sees only work
// somebody else delegated to them, so self-added personal tasks stay private. When
// the list is filtered the server says so, and this page says so too — a partial
// list presented as complete is worse than no list.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowLeft, CheckSquare, Disc3, EyeOff, RefreshCw } from 'lucide-react'
import api from '../api'
import Button from '../components/ui/Button'
import Skeleton from '../components/Skeleton'
import { useAuth } from '../context/AuthContext'
import { daysUntilLocal, formatDate, isPastLocal } from '../utils/dates'
import { PRIORITY_DOT, categoryTint } from '../components/mywork/taskFields'

const ROLE_STYLES = {
  Superadmin: 'bg-violet-500/15 text-violet-600',
  Admin:      'bg-brand-500/15 text-brand-ink',
  Approver:   'bg-amber-500/15 text-amber-600',
  User:       'bg-gray-100 text-ink-muted',
}
const STATUS_STYLES = {
  'To Do':       'bg-gray-100 text-ink-muted',
  'In Progress': 'bg-blue-500/15 text-blue-600',
  Done:          'bg-emerald-500/15 text-emerald-600',
}
const EXEC_LEVEL = 2

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

function Stat({ label, value, tone }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-xl font-bold mt-1 leading-none ${tone || 'text-ink'}`}>{value}</p>
    </div>
  )
}

export default function TeamMember() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('releases')

  const load = () => {
    setLoading(true)
    api.get(`/team/${id}`)
      .then(r => { setData(r.data.data); setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Failed to load member'))
      .finally(() => setLoading(false))
  }
  // Wrapped: `load` returns a Promise, which React would treat as a cleanup fn.
  useEffect(() => { load() }, [id])

  if (loading) {
    return <div className="space-y-4"><Skeleton.PageHeader /><Skeleton.StatCards count={4} /><Skeleton.TaskList count={5} /></div>
  }
  if (error || !data) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-ink">Couldn't load this member</p>
        <p className="text-xs text-ink-muted mt-1">{error}</p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Retry</Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/team')}>Back to Team</Button>
        </div>
      </div>
    )
  }

  const isSelf = data.id === user?.id
  const releases = data.releases || []
  const tasks = data.tasks || []
  const openTasks = tasks.filter(t => t.status !== 'Done')
  // isPastLocal, not the server's is_overdue: this must agree with the same
  // "overdue" the board shows the person themselves, which is local-calendar.
  const overdue = openTasks.filter(t => isPastLocal(t.due_date)).length
  const avgCompletion = releases.length
    ? Math.round(releases.reduce((s, r) => s + Number(r.completion || 0), 0) / releases.length)
    : 0
  const atRisk = releases.filter(r => {
    const d = daysUntilLocal(r.release_date)
    return d !== null && d >= 0 && d <= 14 && Number(r.completion) < 100
  })

  const TABS = [
    ['releases', 'Releases', releases.length, Disc3],
    ['tasks', 'Tasks', openTasks.length, CheckSquare],
    ['activity', 'Activity', (data.activity || []).length, Activity],
  ]

  return (
    <div>
      <Link to="/team" className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink mb-4">
        <ArrowLeft size={13} aria-hidden="true" /> Team
      </Link>

      <div className="card p-5 mb-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
              ${isSelf ? 'bg-brand-500/15 text-brand-ink' : 'bg-gray-100 text-ink-muted'}`}
          >
            {initials(data.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink tracking-tight flex items-center flex-wrap gap-2">
              {data.name}
              {isSelf && <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-gray-100 text-ink-muted">You</span>}
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ROLE_STYLES[data.role] || ROLE_STYLES.User}`}>{data.role}</span>
              {Number(data.hierarchy_level) <= EXEC_LEVEL && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-violet-500/15 text-violet-600">Exec</span>
              )}
              {data.pending && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Invite pending</span>}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">{data.department || 'No department'} · {data.email}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Stat label="Releases" value={releases.length} />
        <Stat label="Avg completion" value={`${avgCompletion}%`} />
        <Stat label="Open tasks" value={openTasks.length} tone={openTasks.length > 5 ? 'text-warning' : undefined} />
        <Stat label="Overdue" value={overdue} tone={overdue > 0 ? 'text-danger' : undefined} />
      </div>

      {atRisk.length > 0 && (
        <div className="card p-3 mb-5 border-l-4 border-l-amber-500 flex items-start gap-2">
          <AlertTriangle size={15} className="text-warning mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-ink">
            <strong>{atRisk.length}</strong> release{atRisk.length === 1 ? '' : 's'} dropping in the next 14 days with an incomplete checklist.
          </p>
        </div>
      )}

      <div className="flex items-center gap-4 border-b border-divider mb-4 overflow-x-auto">
        {TABS.map(([k, lbl, count, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`inline-flex items-center gap-1.5 text-xs font-medium pb-2 -mb-px border-b-2 whitespace-nowrap transition
              ${tab === k ? 'border-brand-500 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            <Icon size={13} aria-hidden="true" /> {lbl} <span className="text-ink-faint">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'releases' && (
        releases.length === 0
          ? <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No releases assigned.</p></div>
          : (
            <div className="card divide-y divide-divider">
              {releases.map(r => {
                const d = daysUntilLocal(r.release_date)
                const pct = Number(r.completion || 0)
                return (
                  <Link key={r.id} to={`/releases/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-elev transition">
                    <Disc3 size={14} className="text-ink-faint flex-shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink truncate">
                        {r.project_name}
                        {String(r.priority || '').toLowerCase().includes('high') && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-danger">High</span>
                        )}
                      </p>
                      <p className="text-[11px] text-ink-muted truncate">{r.artist_name || 'Unknown artist'} · {formatDate(r.release_date)}</p>
                    </div>
                    <div className="w-24 flex-shrink-0 hidden sm:block">
                      <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                        <div className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className={`text-[11px] w-9 text-right flex-shrink-0 ${pct === 100 ? 'text-success' : 'text-ink-muted'}`}>{pct}%</span>
                    <span className={`text-[11px] w-14 text-right flex-shrink-0 ${
                      d === null ? 'text-ink-faint' : d < 0 ? 'text-ink-faint' : d <= 7 ? 'text-danger font-medium' : 'text-ink-muted'
                    }`}>
                      {d === null ? '—' : d < 0 ? `${-d}d ago` : d === 0 ? 'Today' : `${d}d`}
                    </span>
                  </Link>
                )
              })}
            </div>
          )
      )}

      {tab === 'tasks' && (
        <>
          {data.tasks_filtered && (
            <div className="flex items-start gap-2 mb-3 text-[11px] text-ink-muted">
              <EyeOff size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p>Showing only work delegated to {String(data.name).split(' ')[0]} by someone else. Their own personal tasks are private.</p>
            </div>
          )}
          {tasks.length === 0 ? (
            <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No tasks to show.</p></div>
          ) : (
            <div className="card divide-y divide-divider">
              {tasks.map(t => {
                const late = t.status !== 'Done' && isPastLocal(t.due_date)
                return (
                  <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 ${late ? 'bg-red-500/[0.04]' : ''}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.Medium}`} title={t.priority} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm text-ink ${t.status === 'Done' ? 'line-through text-ink-muted' : ''}`}>{t.description}</p>
                      <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5 text-[10px]">
                        {t.category && <span className={`px-1.5 rounded-full ${categoryTint(t.category)}`}>{t.category}</span>}
                        {t.assigned_by_name && <span className="text-ink-muted">from {t.assigned_by_name}</span>}
                        {t.release_name && <span className="text-ink-muted truncate">· {t.release_name}</span>}
                      </div>
                    </div>
                    <span className={`text-[11px] flex-shrink-0 ${late ? 'text-danger font-semibold' : 'text-ink-muted'}`}>
                      {t.due_date ? formatDate(t.due_date) : '—'}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLES[t.status] || STATUS_STYLES['To Do']}`}>{t.status}</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === 'activity' && (
        (data.activity || []).length === 0
          ? <div className="card p-10 text-center"><p className="text-sm text-ink-muted">No recent activity.</p></div>
          : (
            <div className="card divide-y divide-divider">
              {data.activity.map(a => (
                <div key={a.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span aria-hidden="true" className="w-6 h-6 rounded-full bg-gray-100 text-ink-muted flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                    {initials(data.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-ink">{a.action}</p>
                    {a.detail && <p className="text-[11px] text-ink-muted truncate">{a.detail}</p>}
                  </div>
                  <span className="text-[10px] text-ink-faint flex-shrink-0">{formatDate(a.created_at)}</span>
                </div>
              ))}
            </div>
          )
      )}
    </div>
  )
}

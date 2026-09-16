// My Work — the personal command centre.
//
// Shape is boom's: a greeting with the day's headline, one card carrying three
// tabs (To Do Today · My Tasks · My Releases), and a "Waiting on you" rail down
// the right. What sits INSIDE the My Tasks tab is cadence's own task database
// (Board / Table / Calendar / List, grouping, filters, saved views) — the shell
// is what changed, not the surface it wraps, so /team-work keeps sharing it.
//
// The page OWNS the task data (useTaskData here, handed down to TaskSurface).
// The tab counts, the status pills, the Today triage and the board therefore all
// reduce over ONE array: a count on a tab can't disagree with the rows revealed
// by pressing it. That is the same rule useTaskView already applies within the
// database itself.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarCheck, CheckSquare, Disc3, Globe2 } from 'lucide-react'
import api from '../api'
import TaskSurface from '../components/mywork/TaskSurface'
import PlatformMyWork from './PlatformMyWork'
import TodayPanel from '../components/mywork/TodayPanel'
import StatusPills from '../components/mywork/StatusPills'
import WaitingOnYou from '../components/mywork/WaitingOnYou'
import useTaskData from '../components/mywork/useTaskData'
import { canEditTaskFor, dueBucketOf, isOpen } from '../components/mywork/taskFields'
import Skeleton from '../components/Skeleton'
import useIsMobile from '../hooks/useIsMobile'
import { useAuth } from '../context/AuthContext'
import { RELEASE_CHECKLIST } from '../constants'
import { daysUntilLocal, formatDate, localDateStr } from '../utils/dates'

// Time-of-day greeting. Local clock, deliberately — this is the one place in the
// app where the user's own wall time is the right frame of reference.
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const completionOf = (r) =>
  Math.round((RELEASE_CHECKLIST.filter(c => r[c.key]).length / RELEASE_CHECKLIST.length) * 100)

// Four sorts, matching boom's release control. Kept as data so the button row and
// the comparator can't disagree about what "Completion" means.
const RELEASE_SORTS = [
  { key: 'date', label: 'Date', cmp: (a, b) => String(a.release_date || '9999').localeCompare(String(b.release_date || '9999')) },
  { key: 'completion', label: 'Completion', cmp: (a, b) => completionOf(a) - completionOf(b) },
  { key: 'name', label: 'Name', cmp: (a, b) => String(a.project_name || '').localeCompare(String(b.project_name || '')) },
  { key: 'artist', label: 'Artist', cmp: (a, b) => String(a.artist_name || '').localeCompare(String(b.artist_name || '')) },
]

const TAB_KEY = 'mywork_tab_v1'
// 'all' is operator-only and appended below, so a workspace member can never
// land on a tab that does not exist for them via ?tab= or a stale localStorage.
const TABS = ['today', 'tasks', 'releases']

// The releases assigned to me — a second dimension of work the tasks table knows
// nothing about. Fetched once at page level because THREE things read it: the tab
// count, the at-risk banner, and the tab body.
function useMyReleases() {
  const [releases, setReleases] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // `in_catalog=any` opts out of GET /releases' pipeline default: a record can be
    // catalogued and still be yours to finish. `archived` keeps its default
    // (unarchived only) — an archived release is retired, not outstanding.
    api.get('/releases', { params: { assigned_to: 'me', in_catalog: 'any', limit: 200 } })
      .then(r => setReleases(r.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // The 14-day risk window: dropping soon AND not finished. A release at 100% two
  // days out is not an alert, and saying so is the difference between a banner
  // people read and one they learn to scroll past.
  const atRisk = useMemo(
    () => releases.filter(r => {
      const d = daysUntilLocal(r.release_date)
      return d !== null && d >= 0 && d <= 14 && completionOf(r) < 100
    }),
    [releases]
  )

  return { releases, atRisk, loading }
}

function ReleaseList({ releases }) {
  const [sort, setSort] = useState('date')
  const sorted = useMemo(() => {
    const cmp = RELEASE_SORTS.find(s => s.key === sort)?.cmp
    return cmp ? [...releases].sort(cmp) : releases
  }, [releases, sort])

  if (!releases.length) {
    return (
      <div className="p-10 text-center">
        <Disc3 size={28} className="text-ink-faint mx-auto mb-3" aria-hidden="true" />
        <p className="text-sm text-ink-muted">No releases are assigned to you.</p>
        <Link to="/releases" className="text-xs text-brand-ink hover:underline mt-2 inline-block">Open Releases</Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-end gap-1 mb-2">
        <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider mr-1">Sort</span>
        {RELEASE_SORTS.map(s => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            aria-pressed={sort === s.key}
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded transition
              ${sort === s.key ? 'bg-brand-500/15 text-brand-ink' : 'text-ink-muted hover:text-ink'}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="card divide-y divide-divider">
        {sorted.map(r => {
          const pct = completionOf(r)
          const d = daysUntilLocal(r.release_date)
          return (
            <Link key={r.id} to={`/releases/${r.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-elev transition">
              <Disc3 size={14} className="text-ink-faint flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">
                  {r.project_name}
                  {String(r.priority || '').toLowerCase().includes('high') && (
                    <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-danger">High</span>
                  )}
                </p>
                <p className="text-[11px] text-ink-muted truncate">
                  {r.artist_name || 'Unknown artist'} · {formatDate(r.release_date)}
                </p>
              </div>
              <div className="w-24 flex-shrink-0 hidden sm:block">
                <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? 'bg-success' : 'bg-brand-500'}`}
                    style={{ width: `${pct}%` }}
                  />
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
    </div>
  )
}

export default function MyWork() {
  const { user } = useAuth()
  const first = String(user?.name || '').trim().split(/\s+/)[0] || 'there'
  const data = useTaskData('mine')
  const { tasks, loading } = data
  const { releases, atRisk, loading: releasesLoading } = useMyReleases()
  const [params] = useSearchParams()
  const [rescheduling, setRescheduling] = useState(false)
  // A platform operator standing inside a workspace still has work in the OTHER
  // ones. The console answers that; this tab puts the same answer here, so they
  // do not have to leave the workspace to see what else is on their plate.
  const isOperator = !!user?.is_platform_admin
  const [allCount, setAllCount] = useState(null)

  // Below xl the rail renders as the horizontal strip it already knows how to be:
  // a vertical stack of five full-width tiles above the card would push the tabs
  // off a phone screen entirely.
  const narrow = useIsMobile('(max-width: 1279px)')

  // Read in the state INITIALIZER, not an effect: TaskSurface consumes `?new=task`
  // in an effect of its own and strips it from the URL, so by the time a parent
  // effect ran the param could already be gone — and the add form would open on a
  // tab nobody is looking at.
  const tabKeys = useMemo(() => (isOperator ? [...TABS, 'all'] : TABS), [isOperator])
  const [tab, setTab] = useState(() => {
    if (params.get('new') === 'task') return 'tasks'
    const asked = params.get('tab')
    const allowed = user?.is_platform_admin ? [...TABS, 'all'] : TABS
    if (allowed.includes(asked)) return asked
    const last = localStorage.getItem(TAB_KEY)
    return allowed.includes(last) ? last : 'today'
  })
  // Losing operator status (exiting a workspace, a demotion) must not strand the
  // page on a tab that no longer renders.
  useEffect(() => { if (!tabKeys.includes(tab)) setTab('today') }, [tabKeys, tab])
  useEffect(() => { localStorage.setItem(TAB_KEY, tab) }, [tab])

  const openCount = useMemo(() => tasks.filter(isOpen).length, [tasks])
  const todayCount = useMemo(() => {
    // Exactly what TodayPanel renders, counted the same way — overdue, due today
    // and in progress, deduped, so the badge is the number of cards behind it.
    const open = tasks.filter(isOpen)
    const ids = new Set()
    open.forEach(t => {
      const b = dueBucketOf(t)
      if (b === 'overdue' || b === 'today' || t.status === 'In Progress') ids.add(t.id)
    })
    return ids.size
  }, [tasks])

  const canEditTask = useCallback((t) => canEditTaskFor(t, user), [user])

  const rescheduleOverdue = useCallback(async () => {
    const late = tasks.filter(t => isOpen(t) && dueBucketOf(t) === 'overdue').map(t => t.id)
    if (!late.length || rescheduling) return
    setRescheduling(true)
    await data.bulkPatch(late, { due_date: localDateStr() })
    setRescheduling(false)
  }, [tasks, rescheduling, data])

  const tabs = [
    { id: 'today', label: 'To Do Today', count: todayCount, icon: CalendarCheck },
    { id: 'tasks', label: 'My Tasks', count: openCount, icon: CheckSquare },
    { id: 'releases', label: 'My Releases', count: releases.length, icon: Disc3 },
    ...(isOperator ? [{ id: 'all', label: 'All workspaces', count: allCount, icon: Globe2 }] : []),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-ink tracking-tight">{greeting()}, {first}.</h1>
        {loading ? (
          <p className="text-sm text-ink-muted mt-1">Loading your day…</p>
        ) : openCount || releases.length ? (
          <StatusPills tasks={tasks} className="mt-3" />
        ) : (
          <p className="text-sm text-ink-muted mt-1">Your workspace is clear. Time to create.</p>
        )}
      </div>

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-5 xl:items-start">
        {/* order-2 below xl so the rail's strip sits ABOVE the card rather than
            buried under a full task database. */}
        <div className="min-w-0 order-2 xl:order-none space-y-4">
          {atRisk.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {atRisk.length} release{atRisk.length === 1 ? '' : 's'} dropping in the next 14 days with an incomplete checklist
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {atRisk.map(r => (
                    <Link
                      key={r.id}
                      to={`/releases/${r.id}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium bg-card border border-divider rounded-lg px-2.5 py-1.5 hover:border-brand-400 transition-colors"
                    >
                      <span className="text-ink">{r.project_name}</span>
                      <span className="text-ink-faint">·</span>
                      <span className={(daysUntilLocal(r.release_date) ?? 99) <= 3 ? 'text-danger font-bold' : 'text-warning'}>
                        {daysUntilLocal(r.release_date)}d
                      </span>
                      <span className="text-ink-faint">·</span>
                      <span className="text-ink-muted font-bold">{completionOf(r)}%</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center border-b border-divider px-3 sm:px-5 overflow-x-auto" role="tablist">
              {tabs.map(t => {
                const on = tab === t.id
                return (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-2 py-3.5 mr-5 sm:mr-6 text-xs font-semibold border-b-2 whitespace-nowrap transition-all
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-t
                      ${on ? 'border-brand-500 text-brand-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
                  >
                    <t.icon size={13} aria-hidden="true" />
                    {t.label}
                    {t.count != null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold
                        ${on ? 'bg-brand-500/15 text-brand-ink' : 'bg-elev text-ink-muted'}`}>{t.count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="p-3 sm:p-5">
              {/* Every tab stays MOUNTED and hides with a class. The database holds
                  its view type, search text, collapsed groups and selection in
                  component state, and unmounting it would throw all four away every
                  time somebody glanced at Today. `active` is what keeps the hidden
                  surface's hotkeys off the visible one. */}
              <div className={tab === 'today' ? '' : 'hidden'}>
                {loading
                  ? <Skeleton.TaskList count={4} />
                  : (
                    <TodayPanel
                      tasks={tasks}
                      onOpen={() => setTab('tasks')}
                      onPatch={data.patchTask}
                      canEditTask={canEditTask}
                      onBulkPatch={data.bulkPatch}
                      rescheduling={rescheduling}
                      onRescheduleOverdue={rescheduleOverdue}
                    />
                  )}
              </div>

              <div className={tab === 'tasks' ? '' : 'hidden'}>
                <TaskSurface surface="mine" data={data} chrome={false} active={tab === 'tasks'} />
              </div>

              <div className={tab === 'releases' ? '' : 'hidden'}>
                {releasesLoading ? <Skeleton.TaskList count={3} /> : <ReleaseList releases={releases} />}
              </div>

              {isOperator && (
                <div className={tab === 'all' ? '' : 'hidden'}>
                  <PlatformMyWork embedded onCount={setAllCount} />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="order-1 xl:order-none min-w-0">
          {!loading && <WaitingOnYou tasks={tasks} onBulkPatch={data.bulkPatch} layout={narrow ? 'strip' : 'rail'} />}
        </div>
      </div>
    </div>
  )
}

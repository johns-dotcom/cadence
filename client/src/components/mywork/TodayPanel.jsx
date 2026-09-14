// "To Do Today" — the triage tab.
//
// Everything else on this page answers "what work exists". This answers the
// narrower and more useful question: what am I dealing with before the day ends.
// Three sections, each task in exactly ONE of them — Overdue (most-late first),
// then due today, then anything already in progress — so scanning top-down is the
// order to work in, and nothing is counted twice.
//
// It is a LENS over the page's task array, not a second fetch: the same `tasks`
// the board renders and the same `dueBucketOf` it groups by. A separate query here
// is how a tab count ends up disagreeing with the board sitting behind it.

import { useMemo } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, Sun } from 'lucide-react'
import Button from '../ui/Button'
import TaskCard from './TaskCard'
import { dueBucketOf, isOpen, PRIORITY_RANK } from './taskFields'
import { daysUntilLocal, localDateStr } from '../../utils/dates'

function Section({ icon: Icon, title, tone, count, hint, children }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={tone} aria-hidden="true" />
        <h3 className="text-xs font-bold text-ink uppercase tracking-wide">{title}</h3>
        <span className="text-[11px] text-ink-muted">{count}</span>
        {hint && <span className="text-[11px] text-ink-faint ml-auto">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export default function TodayPanel({ tasks, onOpen, onPatch, canEditTask, onBulkPatch, rescheduling, onRescheduleOverdue }) {
  const { overdue, dueToday, inProgress, suggestions } = useMemo(() => {
    const open = tasks.filter(isOpen)
    const od = open.filter(t => dueBucketOf(t) === 'overdue')
      // Most-late first: the oldest thing on the list is the one that has been
      // ignored longest, not the one with the nearest date.
      .sort((a, b) => (daysUntilLocal(a.due_date) ?? 0) - (daysUntilLocal(b.due_date) ?? 0))
    const odIds = new Set(od.map(t => t.id))
    const dt = open.filter(t => dueBucketOf(t) === 'today' && !odIds.has(t.id))
    const dtIds = new Set(dt.map(t => t.id))
    const ip = open.filter(t => t.status === 'In Progress' && !odIds.has(t.id) && !dtIds.has(t.id))
    const claimed = new Set([...odIds, ...dtIds, ...ip.map(t => t.id)])
    // "Plan your day" — undated open work, most important first. Deliberately
    // undated only: a task due next month is not a suggestion for today, and
    // offering it would make the button mean "bring work forward" instead of
    // "decide when this happens".
    const sg = open
      .filter(t => !t.due_date && !claimed.has(t.id))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
      .slice(0, 3)
    return { overdue: od, dueToday: dt, inProgress: ip, suggestions: sg }
  }, [tasks])

  // `key` is passed directly at each call site, never through this spread:
  // React treats a spread key as a normal prop and warns, and React 19 drops it
  // entirely — which would silently destroy list reconciliation here.
  const cardProps = (t) => ({ task: t, onOpen, onPatch, canEdit: canEditTask?.(t) ?? false })

  const nothing = !overdue.length && !dueToday.length && !inProgress.length

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div>
      {/* The rollover banner. boom put it above the overdue rows because that is
          where the consequence of pressing it is visible. */}
      {overdue.length > 0 && onBulkPatch && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 mb-4 flex items-center gap-3 flex-wrap">
          <AlertTriangle size={15} className="text-danger flex-shrink-0" aria-hidden="true" />
          <p className="text-xs font-semibold text-ink min-w-0">
            {overdue.length} task{overdue.length === 1 ? '' : 's'} rolled over from previous days.
          </p>
          <Button
            size="sm" variant="secondary" className="ml-auto"
            onClick={onRescheduleOverdue}
            disabled={rescheduling}
          >
            {rescheduling ? <><Loader2 size={13} className="animate-spin" /> Rescheduling…</> : 'Reschedule all → today'}
          </Button>
        </div>
      )}

      {nothing ? (
        <div className="card p-10 text-center">
          <CheckCircle2 size={28} className="text-success mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-ink">All clear for today.</p>
          <p className="text-xs text-ink-muted mt-1">Nothing overdue, due today, or in progress. {today}.</p>
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <Section icon={AlertTriangle} tone="text-danger" title="Overdue" count={overdue.length}
              hint="Most late first">
              {overdue.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
            </Section>
          )}
          {dueToday.length > 0 && (
            <Section icon={CalendarClock} tone="text-warning" title="Due today" count={dueToday.length}>
              {dueToday.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
            </Section>
          )}
          {inProgress.length > 0 && (
            <Section icon={Clock} tone="text-info" title="In progress" count={inProgress.length}
              hint="Started, not yet due">
              {inProgress.map(t => <TaskCard key={t.id} {...cardProps(t)} />)}
            </Section>
          )}
        </>
      )}

      {suggestions.length > 0 && (
        <div className="mt-5 pt-4 border-t border-divider">
          <div className="flex items-center gap-2 mb-2">
            <Sun size={14} className="text-warning" aria-hidden="true" />
            <h3 className="text-xs font-bold text-ink uppercase tracking-wide">Plan your day</h3>
            <span className="text-[11px] text-ink-muted">no due date yet</span>
          </div>
          <div className="card divide-y divide-divider">
            {suggestions.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                <button
                  onClick={() => onOpen?.(t)}
                  className="min-w-0 flex-1 text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <p className="text-sm text-ink truncate">{t.description}</p>
                  <p className="text-[11px] text-ink-muted">
                    {t.priority || 'Medium'}{t.category ? ` · ${t.category}` : ''}
                  </p>
                </button>
                {(canEditTask?.(t) ?? false) && (
                  <Button size="sm" variant="secondary" className="flex-shrink-0"
                    onClick={() => onPatch?.(t.id, { due_date: localDateStr() })}>
                    Do today
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

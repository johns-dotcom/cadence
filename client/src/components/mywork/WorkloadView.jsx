// Workload — per-person load across the team. Team Work only.
//
// Computed CLIENT-SIDE from the tasks already on the page, using the same
// dueBucketOf() the board uses. There is deliberately no GET /api/tasks/workload:
// the natural SQL (dashboard.js:84-91 with GROUP BY u.id) decides overdue with
// `due_date < CURRENT_DATE`, which is the SERVER's timezone — so the endpoint's
// "overdue" would disagree with the board's sitting right next to it. Two sources of
// truth for the same number on one screen is worse than a memo.
//
// Drives off the ROSTER, not the tasks: grouping tasks by user_id silently drops
// everyone with nothing assigned, and "who is free" is half the point of this page.

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { dueBucketOf, isOpen } from './taskFields'

export const DEFAULT_CAPACITY = 10

export function buildWorkload(tasks, roster) {
  // A rolling 168h window on a real instant — NOT daysUntilLocal, which is
  // 'YYYY-MM-DD' prefix math and would truncate this TIMESTAMP to its UTC day.
  const weekAgo = Date.now() - 7 * 864e5

  return roster.map(m => {
    const own = tasks.filter(t => t.user_id === m.id)
    const live = own.filter(isOpen)
    const bucket = (k) => live.filter(t => dueBucketOf(t) === k).length
    return {
      ...m,
      open: live.length,
      overdue: bucket('overdue'),
      dueToday: bucket('today'),
      dueWeek: live.filter(t => ['today', 'tomorrow', 'week'].includes(dueBucketOf(t))).length,
      highOpen: live.filter(t => t.priority === 'High').length,
      noDue: live.filter(t => !t.due_date).length,
      done7: own.filter(t => t.completed_at && Date.parse(t.completed_at) >= weekAgo).length,
    }
  }).sort((a, b) => b.open - a.open || String(a.name).localeCompare(String(b.name)))
}

export default function WorkloadView({ tasks, roster, capacity = DEFAULT_CAPACITY, onDrillDown }) {
  const rows = useMemo(() => buildWorkload(tasks, roster), [tasks, roster])
  const cap = Math.max(1, Number(capacity) || DEFAULT_CAPACITY)

  // Strictly owner-less. This card drills through to filter `user_id: [null]`, so
  // counting out-of-roster owners here too would let a lead click "5 unassigned" and
  // land on "No tasks match these filters".
  const unassigned = tasks.filter(t => t.user_id == null && isOpen(t))

  if (!rows.length) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-ink-muted">No teammates in scope yet.</p>
        <p className="text-xs text-ink-muted mt-1">
          Team Work shows your department — set departments on the{' '}
          <Link to="/team" className="text-brand-ink hover:underline font-medium">Team page</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map(r => {
        // ABSOLUTE against the workspace capacity, not relative to the busiest
        // teammate. Relative made the chart useless: the busiest person was always
        // full, so a team where everyone had 2 tasks looked identical to one where
        // everyone had 40, and hiring someone visually reduced everyone else's load.
        const over = r.open > cap
        const pct = Math.min(100, Math.round((r.open / cap) * 100))
        return (
          <button
            key={r.id}
            onClick={() => onDrillDown?.(r.id)}
            className="card w-full p-3 text-left hover:border-brand-300 transition group
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            title={`Show ${r.name}'s board`}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 w-40 flex-shrink-0">
                <p className="text-sm font-medium text-ink truncate">{r.name}</p>
                <p className="text-[11px] text-ink-muted truncate">{r.department || 'No department'}</p>
              </div>

              <div className="flex-1 min-w-0">
                {/* bg-rule, not bg-gray-100: the empty part of the track was invisible
                    against the card in BOTH themes, so a 0-open row looked like a
                    rendering failure rather than an empty bar. */}
                <div
                  className="h-2 rounded-full bg-rule overflow-hidden"
                  role="progressbar"
                  aria-valuenow={r.open}
                  aria-valuemin={0}
                  aria-valuemax={cap}
                  aria-valuetext={`${r.open} open of ${cap} capacity${over ? ' — over capacity' : ''}`}
                >
                  {/* Inline width, not a Tailwind class: the old static 11-step map
                      quantized adjacent task counts onto the same bar and then
                      animated the ~90px snaps between them. */}
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${
                      over ? 'bg-danger' : r.overdue > 0 ? 'bg-warning' : 'bg-brand-500'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[11px]">
                  {r.open === 0 ? (
                    <span className="text-ink-muted">Available</span>
                  ) : (
                    <>
                      {r.overdue > 0 && (
                        <span className="text-danger font-medium inline-flex items-center gap-1">
                          <AlertTriangle size={10} aria-hidden="true" /> {r.overdue} overdue
                        </span>
                      )}
                      {r.dueToday > 0 && <span className="text-warning font-medium">{r.dueToday} due today</span>}
                      {r.dueWeek > 0 && <span className="text-ink-muted">{r.dueWeek} this week</span>}
                      {r.noDue > 0 && <span className="text-ink-muted">{r.noDue} unscheduled</span>}
                      {r.highOpen > 0 && <span className="text-ink-muted">{r.highOpen} high</span>}
                    </>
                  )}
                  {r.done7 > 0 && <span className="text-success">{r.done7} done this week</span>}
                </div>
              </div>

              <div className="text-right flex-shrink-0 w-20">
                <p className={`text-lg font-bold leading-none ${over ? 'text-danger' : 'text-ink'}`}>{r.open}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">of {cap}{over ? ' · over' : ''}</p>
              </div>
            </div>
          </button>
        )
      })}

      {unassigned.length > 0 && (
        // Was a look-alike card that wasn't clickable, telling you N tasks were
        // unattributable and giving you no way to see them.
        <button
          onClick={() => onDrillDown?.(null)}
          className="card w-full p-3 text-left border-dashed hover:border-brand-300 transition
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          <p className="text-sm text-ink">{unassigned.length} unassigned open task{unassigned.length === 1 ? '' : 's'}</p>
          <p className="text-[11px] text-ink-muted mt-0.5">Not attributable to anyone — open to assign them.</p>
        </button>
      )}
    </div>
  )
}

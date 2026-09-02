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

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Disc3 } from 'lucide-react'
import api from '../../api'
import { daysUntilLocal } from '../../utils/dates'
import { dueBucketOf, isOpen } from './taskFields'

export const DEFAULT_CAPACITY = 10

// A release is worth ~2 open tasks of load. Not a guess dressed as precision — it
// is boom's own weight, and the point is only that shipping a record is heavier
// than a to-do. Without it, someone carrying four releases and two tasks read
// "available" next to someone with nine trivial tasks.
export const RELEASE_WEIGHT = 2

export function buildWorkload(tasks, roster, releasesByMember = {}) {
  // A rolling 168h window on a real instant — NOT daysUntilLocal, which is
  // 'YYYY-MM-DD' prefix math and would truncate this TIMESTAMP to its UTC day.
  const weekAgo = Date.now() - 7 * 864e5

  return roster.map(m => {
    const own = tasks.filter(t => t.user_id === m.id)
    const live = own.filter(isOpen)
    const bucket = (k) => live.filter(t => dueBucketOf(t) === k).length
    // Releases come from GET /api/team/workload — a dimension the task payload
    // simply does not contain, which is why the bars could never see it.
    const releases = releasesByMember[String(m.id)] || releasesByMember[m.id] || []
    return {
      ...m,
      releases,
      load: live.length + releases.length * RELEASE_WEIGHT,
      open: live.length,
      overdue: bucket('overdue'),
      dueToday: bucket('today'),
      dueWeek: live.filter(t => ['today', 'tomorrow', 'week'].includes(dueBucketOf(t))).length,
      highOpen: live.filter(t => t.priority === 'High').length,
      noDue: live.filter(t => !t.due_date).length,
      done7: own.filter(t => t.completed_at && Date.parse(t.completed_at) >= weekAgo).length,
    }
  }).sort((a, b) => b.load - a.load || String(a.name).localeCompare(String(b.name)))
}

export default function WorkloadView({ tasks, roster, capacity = DEFAULT_CAPACITY, onDrillDown }) {
  // Fetched here rather than threaded through useTaskData: this is the only view
  // that needs it, and Workload is one of five — every other view would pay for a
  // request it never reads.
  const [releasesByMember, setReleasesByMember] = useState({})
  useEffect(() => {
    api.get('/team/workload').then(r => setReleasesByMember(r.data.data || {})).catch(() => {})
  }, [])

  const rows = useMemo(() => buildWorkload(tasks, roster, releasesByMember), [tasks, roster, releasesByMember])
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
        const over = r.load > cap
        const pct = Math.min(100, Math.round((r.load / cap) * 100))
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
                  aria-valuenow={r.load}
                  aria-valuemin={0}
                  aria-valuemax={cap}
                  aria-valuetext={`load ${r.load} of ${cap} capacity — ${r.open} open task${r.open === 1 ? '' : 's'}, ${r.releases.length} release${r.releases.length === 1 ? '' : 's'}${over ? ' — over capacity' : ''}`}
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
                  {r.open === 0 && r.releases.length === 0 ? (
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
                <p className={`text-lg font-bold leading-none ${over ? 'text-danger' : 'text-ink'}`}>{r.load}</p>
                <p className="text-[10px] text-ink-muted mt-0.5">of {cap}{over ? ' · over' : ''}</p>
              </div>
            </div>

            {/* Assigned releases, with checklist completion and the countdown. The
                vertical bar is the completion; days-until turns red inside a week,
                because that is when an incomplete checklist becomes a problem. */}
            {r.releases.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 mt-2 pl-[10.75rem]">
                <Disc3 size={11} className="text-ink-faint flex-shrink-0" aria-hidden="true" />
                {r.releases.slice(0, 5).map(rel => {
                  const d = daysUntilLocal(rel.release_date)
                  const soon = d !== null && d >= 0 && d <= 7
                  return (
                    <span
                      key={rel.id}
                      className="inline-flex items-center gap-1 text-[10px] rounded-full bg-elev border border-divider pl-1 pr-1.5 py-0.5"
                      title={`${rel.project_name} — ${rel.completion}% checklist`}
                    >
                      <span className="w-1 h-3 rounded-full bg-rule overflow-hidden flex flex-col justify-end" aria-hidden="true">
                        <span
                          className={`w-full rounded-full ${rel.completion === 100 ? 'bg-success' : 'bg-brand-500'}`}
                          style={{ height: `${Math.max(4, rel.completion)}%` }}
                        />
                      </span>
                      <span className="text-ink-muted max-w-[7rem] truncate">{rel.project_name}</span>
                      {d !== null && (
                        <span className={soon ? 'text-danger font-medium' : d < 0 ? 'text-ink-faint' : 'text-ink-muted'}>
                          {d < 0 ? `${-d}d ago` : d === 0 ? 'Today' : `${d}d`}
                        </span>
                      )}
                    </span>
                  )
                })}
                {r.releases.length > 5 && <span className="text-[10px] text-ink-muted">+{r.releases.length - 5}</span>}
              </div>
            )}
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

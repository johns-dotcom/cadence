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
import { AlertTriangle } from 'lucide-react'
import { dueBucketOf, isOpen } from './taskFields'

// Static width map — Tailwind's JIT can't see an interpolated class string.
const BAR = {
  0: 'w-0', 5: 'w-[5%]', 10: 'w-[10%]', 20: 'w-[20%]', 30: 'w-[30%]', 40: 'w-[40%]',
  50: 'w-[50%]', 60: 'w-[60%]', 70: 'w-[70%]', 80: 'w-[80%]', 90: 'w-[90%]', 100: 'w-full',
}
const barWidth = (frac) => {
  const steps = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  const pct = Math.round(frac * 100)
  return BAR[steps.reduce((best, s) => (Math.abs(s - pct) < Math.abs(best - pct) ? s : best), 0)]
}

export function buildWorkload(tasks, roster) {
  // A rolling 168h window on a real instant — NOT daysUntilLocal, which is
  // 'YYYY-MM-DD' prefix math and would truncate this TIMESTAMP to its UTC day.
  const weekAgo = Date.now() - 7 * 864e5

  const rows = roster.map(m => {
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
  })

  const peak = Math.max(1, ...rows.map(r => r.open))
  return rows
    .map(r => ({ ...r, load: r.open / peak }))
    .sort((a, b) => b.open - a.open || String(a.name).localeCompare(String(b.name)))
}

export default function WorkloadView({ tasks, roster, onDrillDown }) {
  const rows = useMemo(() => buildWorkload(tasks, roster), [tasks, roster])

  // Tasks whose owner isn't in the visible roster (e.g. orphaned by a removal).
  const rosterIds = new Set(roster.map(m => m.id))
  const unassigned = tasks.filter(t => t.user_id == null || !rosterIds.has(t.user_id)).filter(isOpen)

  if (!rows.length) {
    return (
      <div className="card p-10 text-center">
        <p className="text-sm text-gray-500">No teammates in scope yet.</p>
        <p className="text-xs text-gray-400 mt-1">Team Work shows your department — set departments on the Team page.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <button
          key={r.id}
          onClick={() => onDrillDown?.(r.id)}
          className="card w-full p-3 text-left hover:border-brand-300 transition group"
          title={`Show ${r.name}'s board`}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 w-40 flex-shrink-0">
              <p className="text-sm font-medium text-ink truncate">{r.name}</p>
              <p className="text-[11px] text-gray-400 truncate">{r.department || 'No department'}</p>
            </div>

            <div className="flex-1 min-w-0">
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${barWidth(r.load)} ${r.overdue > 0 ? 'bg-red-500' : 'bg-brand-500'}`} />
              </div>
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[11px]">
                {r.open === 0 ? (
                  <span className="text-gray-400">— available —</span>
                ) : (
                  <>
                    {r.overdue > 0 && (
                      <span className="text-red-600 font-medium inline-flex items-center gap-1">
                        <AlertTriangle size={10} /> {r.overdue} overdue
                      </span>
                    )}
                    {r.dueToday > 0 && <span className="text-amber-600 font-medium">{r.dueToday} due today</span>}
                    {r.dueWeek > 0 && <span className="text-gray-500">{r.dueWeek} this week</span>}
                    {r.noDue > 0 && <span className="text-gray-400">{r.noDue} unscheduled</span>}
                    {r.highOpen > 0 && <span className="text-gray-400">{r.highOpen} high</span>}
                  </>
                )}
                {r.done7 > 0 && <span className="text-emerald-600">{r.done7} done this week</span>}
              </div>
            </div>

            <div className="text-right flex-shrink-0 w-16">
              <p className="text-lg font-bold text-ink leading-none">{r.open}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">open</p>
            </div>
          </div>
        </button>
      ))}

      {unassigned.length > 0 && (
        <div className="card p-3 border-dashed">
          <p className="text-sm text-ink">{unassigned.length} unassigned open task{unassigned.length === 1 ? '' : 's'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Not attributable to anyone — assign them to bring them into the rollup.</p>
        </div>
      )}
    </div>
  )
}

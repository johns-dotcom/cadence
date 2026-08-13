// Calendar view — tasks placed on their due date, drag onto a day to reschedule.
//
// This is the ONE view that ignores grouping: it consumes `sorted` and re-indexes by
// due date, using the active group-by only as the COLOUR dimension. Don't "fix" it
// to render `groups` — a day cell is its own bucket.
//
// Grid construction and the byDate index follow pages/Calendar.jsx:34-50. Creating
// events per-cell is deliberately omitted: the global /calendar already does that,
// and quick-add here is one keystroke away.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { dateOnly, localDateStr } from '../../utils/dates'
import { PRIORITY_DOT } from './taskFields'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PER_CELL = 3

export default function TaskCalendar({ tasks, onOpen, onReschedule, canEditTask, dndEnabled = true }) {
  const [cursor, setCursor] = useState(() => new Date())
  const [dragId, setDragId] = useState(null)
  const [overIso, setOverIso] = useState(null)
  const [expanded, setExpanded] = useState(null) // iso of the day showing all items

  const byDate = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      const key = dateOnly(t.due_date)
      if (!key) continue
      ;(map[key] ||= []).push(t)
    }
    return map
  }, [tasks])

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [cursor])

  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)),
    [cells]
  )

  const undated = tasks.filter(t => !dateOnly(t.due_date))
  const todayIso = localDateStr()
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const shift = (n) => setCursor(c => new Date(c.getFullYear(), c.getMonth() + n, 1))

  const dropOn = (iso) => {
    const task = tasks.find(t => t.id === dragId)
    setDragId(null); setOverIso(null)
    if (!task || dateOnly(task.due_date) === iso) return
    onReschedule?.(task.id, iso)
  }

  const chip = (task) => {
    const draggable = dndEnabled && (!canEditTask || canEditTask(task))
    return (
      <button
        key={task.id}
        draggable={draggable}
        onDragStart={() => setDragId(task.id)}
        onDragEnd={() => { setDragId(null); setOverIso(null) }}
        onClick={() => onOpen?.(task)}
        className={`w-full flex items-center gap-1 text-left text-[11px] px-1 py-1 rounded transition
          hover:bg-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
          ${dragId === task.id ? 'opacity-40' : ''} ${task.status === 'Done' ? 'line-through text-ink-muted' : ''}`}
        title={task.description}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Medium}`} />
        <span className="truncate text-ink">{task.description}</span>
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-ink">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg hover:bg-elev text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="text-xs font-semibold text-brand-ink px-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">Today</button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg hover:bg-elev text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* role=grid so the 42 day cells are navigable/announceable as a month grid —
          they were bare divs whose only text was the day number. */}
      <div className="card overflow-hidden" role="grid" aria-label={monthLabel}>
        <div className="grid grid-cols-7 border-b border-divider" role="row">
          {WEEKDAYS.map(d => (
            <div key={d} role="columnheader" className="px-2 py-1.5 text-[10px] font-semibold text-ink-muted uppercase tracking-wide text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7" role="rowgroup">
          {/* gridcell must be owned by a row. `contents` supplies the row level
              without introducing a box that would break the 7-column grid. */}
          {weeks.map((week, w) => (
          <div key={`w${w}`} role="row" className="contents">
          {week.map((d, i) => {
            const iso = localDateStr(d)
            const items = byDate[iso] || []
            const otherMonth = d.getMonth() !== cursor.getMonth()
            const showAll = expanded === iso
            const shown = showAll ? items : items.slice(0, PER_CELL)
            return (
              <div
                key={iso + i}
                role="gridcell"
                // Without a label the cell announced just "14" — no month, no weekday.
                aria-label={`${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${items.length ? `, ${items.length} task${items.length === 1 ? '' : 's'}` : ', no tasks'}`}
                onDragOver={e => { if (dragId != null) { e.preventDefault(); setOverIso(iso) } }}
                onDragLeave={() => setOverIso(o => (o === iso ? null : o))}
                onDrop={e => { e.preventDefault(); dropOn(iso) }}
                className={`min-h-[5.5rem] border-b border-r border-divider p-1 transition
                  ${otherMonth ? 'bg-elev/40' : ''}
                  ${overIso === iso ? 'bg-brand-500/15 ring-1 ring-inset ring-brand-400' : ''}`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span aria-hidden="true" className={`text-[11px] ${iso === todayIso ? 'font-bold text-brand-ink' : otherMonth ? 'text-ink-faint' : 'text-ink-muted'}`}>
                    {d.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {shown.map(chip)}
                  {items.length > PER_CELL && (
                    <button
                      onClick={() => setExpanded(showAll ? null : iso)}
                      className="text-[10px] font-semibold text-brand-ink px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                    >
                      {showAll ? 'Show less' : `+${items.length - PER_CELL} more`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          </div>
          ))}
        </div>
      </div>

      {/* Undated tasks are invisible on a calendar, so surface them as a drag
          source rather than silently dropping them from the view. */}
      {undated.length > 0 && (
        <div className="mt-4">
          <h2 className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2">No due date ({undated.length})</h2>
          <div className="card p-2 flex flex-wrap gap-1">
            {undated.map(chip)}
          </div>
        </div>
      )}
    </div>
  )
}

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
        className={`w-full flex items-center gap-1 text-left text-[11px] px-1 py-0.5 rounded hover:bg-brand-50 transition
          ${dragId === task.id ? 'opacity-40' : ''} ${task.status === 'Done' ? 'opacity-50 line-through' : ''}`}
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
        <h3 className="text-sm font-bold text-ink">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="text-xs font-semibold text-brand-600 px-2">Today</button>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-divider">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const iso = localDateStr(d)
            const items = byDate[iso] || []
            const otherMonth = d.getMonth() !== cursor.getMonth()
            const showAll = expanded === iso
            const shown = showAll ? items : items.slice(0, PER_CELL)
            return (
              <div
                key={iso + i}
                onDragOver={e => { if (dragId != null) { e.preventDefault(); setOverIso(iso) } }}
                onDragLeave={() => setOverIso(o => (o === iso ? null : o))}
                onDrop={e => { e.preventDefault(); dropOn(iso) }}
                className={`min-h-[5.5rem] border-b border-r border-divider p-1 transition
                  ${otherMonth ? 'bg-elev/40' : ''}
                  ${overIso === iso ? 'bg-brand-50 ring-1 ring-inset ring-brand-400' : ''}`}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span className={`text-[11px] ${iso === todayIso ? 'font-bold text-brand-600' : otherMonth ? 'text-gray-300' : 'text-gray-500'}`}>
                    {d.getDate()}
                  </span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {shown.map(chip)}
                  {items.length > PER_CELL && (
                    <button
                      onClick={() => setExpanded(showAll ? null : iso)}
                      className="text-[10px] font-semibold text-brand-600 px-1"
                    >
                      {showAll ? 'Show less' : `+${items.length - PER_CELL} more`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Undated tasks are invisible on a calendar, so surface them as a drag
          source rather than silently dropping them from the view. */}
      {undated.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">No due date ({undated.length})</p>
          <div className="card p-2 flex flex-wrap gap-1">
            {undated.map(chip)}
          </div>
        </div>
      )}
    </div>
  )
}

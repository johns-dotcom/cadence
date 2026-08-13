// One task as a card — shared by Board, List and the mobile fallback, so a task
// looks and reads the same wherever it appears.
//
// Presentational only: every interaction is a callback. Drag props are spread in by
// the parent (TaskBoard owns the DnD state).

import { GripVertical, StickyNote } from 'lucide-react'
import { dueBucketOf, dueLabel, PRIORITY_STRIPE } from './taskFields'

// Only two states carry information: late and due-today. The other four buckets all
// resolved to the same muted gray, so colour was differentiating them by nothing.
const DUE_TEXT = {
  overdue: 'text-danger font-medium',
  today: 'text-warning font-medium',
  tomorrow: 'text-ink-muted',
  week: 'text-ink-muted',
  later: 'text-ink-muted',
  none: 'text-ink-faint',
}

export default function TaskCard({
  task, onOpen, showAssignee = false, selected = false, onToggleSelect,
  draggable = false, dragging = false, dragHandlers = {}, insertBefore = false, insertAfter = false,
}) {
  const bucket = dueBucketOf(task)
  const done = task.status === 'Done'

  // role="button" rather than a real <button>: the card contains a checkbox, and
  // nesting interactive elements inside a button is invalid HTML. Enter/Space match
  // native button behaviour — without this the card was mouse-only, so on Board and
  // List there was no way to open a task by keyboard at all.
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.target !== e.currentTarget) return // let the checkbox handle its own keys
    e.preventDefault()
    onOpen?.(task)
  }

  return (
    <div className="relative">
      {/* Insertion line — the only feedback that says WHERE the card will land. */}
      {insertBefore && <div className="absolute -top-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full z-10" />}
      {insertAfter && <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full z-10" />}

      <div
        role="button"
        tabIndex={0}
        aria-label={`${task.description}${done ? ' (done)' : ''}`}
        draggable={draggable}
        {...dragHandlers}
        onClick={() => onOpen?.(task)}
        onKeyDown={onKeyDown}
        className={`card p-3 group border-l-[3px] cursor-pointer transition
          focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
          ${PRIORITY_STRIPE[task.priority] || PRIORITY_STRIPE.Medium}
          ${dragging ? 'opacity-40' : ''}
          ${selected ? 'ring-2 ring-brand-400' : ''}`}
      >
        <div className="flex items-start gap-2">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onClick={e => e.stopPropagation()}
              onChange={() => onToggleSelect(task.id)}
              className="mt-0.5 flex-shrink-0 cursor-pointer"
              aria-label={`Select ${task.description}`}
            />
          )}
          {draggable && (
            <GripVertical size={13} className="mt-0.5 text-ink-faint opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0" aria-hidden="true" />
          )}

          <div className="min-w-0 flex-1">
            {/* Done reads via line-through only. It used to ALSO dim the card, which
                multiplied with the drag opacity to 24% — a Done card mid-drag was
                effectively invisible. */}
            <p className={`text-sm text-ink break-words ${done ? 'line-through text-ink-muted' : ''}`}>{task.description}</p>
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1 text-[11px]">
              {showAssignee && (
                <>
                  <span className="text-ink-muted font-medium">{task.assignee_name || 'Unassigned'}</span>
                  <span className="text-ink-faint" aria-hidden="true">·</span>
                </>
              )}
              <span className={DUE_TEXT[bucket]}>{dueLabel(task)}</span>
              {task.category && <><span className="text-ink-faint" aria-hidden="true">·</span><span className="text-ink-muted">{task.category}</span></>}
              {task.release_name && <><span className="text-ink-faint" aria-hidden="true">·</span><span className="text-ink-muted truncate">{task.release_name}</span></>}
              {/* lucide spreads `title` onto the <svg>, where it does nothing —
                  SVG needs a <title> child — so this needs a real accessible name. */}
              {task.notes && <StickyNote size={10} className="text-ink-faint" role="img" aria-label="Has notes" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// One task as a card — shared by Board, List and the mobile fallback, so a task
// looks and reads the same wherever it appears.
//
// Presentational only: every interaction is a callback. Drag props are spread in by
// the parent (TaskBoard owns the DnD state).

import { Check, Circle, CircleDot, Clock, GripVertical, StickyNote } from 'lucide-react'
import { localDateStr } from '../../utils/dates'
import { categoryTint, dueBucketOf, dueLabel, PRIORITY_STRIPE } from './taskFields'

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

// The status circle's cycle. Matches boom: one click from anywhere open marks Done,
// one more reopens. In Progress is reached by the Start action, the select, or a
// board drag — a three-stop cycle on a one-click control made "mark this done" a
// coin flip on whether the row was To Do or In Progress.
const nextStatus = (status) => (status === 'Done' ? 'To Do' : 'Done')

export default function TaskCard({
  task, onOpen, showAssignee = false, selected = false, onToggleSelect,
  draggable = false, dragging = false, dragHandlers = {}, insertBefore = false, insertAfter = false,
  onPatch, canEdit = false,
}) {
  const bucket = dueBucketOf(task)
  const done = task.status === 'Done'
  const tint = categoryTint(task.category)

  // Every quick action is the same shape: stop the card's onClick, then patch.
  const act = (fields) => (e) => { e.stopPropagation(); onPatch?.(task.id, fields) }
  // Push a due date to tomorrow. Relative to TODAY, not to the existing due date:
  // "snooze" on a task 5 days late must mean "deal with it tomorrow", not "make it
  // 4 days late".
  const snooze = act({ due_date: localDateStr(new Date(Date.now() + 864e5)) })
  const canAct = canEdit && !!onPatch

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

          {/* One-click complete. Completing a task was the single most common thing
              anyone does here and it took four clicks — open the drawer, change a
              select, wait, close — or a drag into the Done column. This is the
              affordance boom put on every row. Always rendered (not hover-only) so
              it is reachable on touch, where there is no hover. */}
          {canAct && (
            <button
              onClick={act({ status: nextStatus(task.status) })}
              aria-label={done ? `Reopen ${task.description}` : `Mark ${task.description} done`}
              title={done ? 'Reopen' : 'Mark done'}
              className={`mt-0.5 flex-shrink-0 rounded-full transition
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
                ${done ? 'text-success' : 'text-ink-faint hover:text-success'}`}
            >
              {done ? <Check size={14} /> : task.status === 'In Progress' ? <CircleDot size={14} /> : <Circle size={14} />}
            </button>
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
              {/* Tinted chip, not another gray word in the same gray row — category
                  was indistinguishable from the release name beside it. */}
              {task.category && <span className={`px-1.5 rounded-full ${tint}`}>{task.category}</span>}
              {task.release_name && <><span className="text-ink-faint" aria-hidden="true">·</span><span className="text-ink-muted truncate">{task.release_name}</span></>}
              {/* lucide spreads `title` onto the <svg>, where it does nothing —
                  SVG needs a <title> child — so this needs a real accessible name. */}
              {task.notes && <StickyNote size={10} className="text-ink-faint" role="img" aria-label="Has notes" />}
            </div>
          </div>

          {/* Triage actions. boom's To Do Today tab hung Start and a one-day snooze
              off every row; this app has no Today tab, so they live on the card and
              work in every view instead of one. Hover/focus-reveal, but rendered in
              the DOM so keyboard users reach them by tabbing. */}
          {canAct && !done && (
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
              {task.status === 'To Do' && (
                <button
                  onClick={act({ status: 'In Progress' })}
                  className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted hover:text-brand-ink rounded px-1
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  title="Move to In Progress"
                >
                  Start
                </button>
              )}
              <button
                onClick={snooze}
                aria-label={`Push ${task.description} to tomorrow`}
                title="Push the due date to tomorrow"
                className="text-ink-faint hover:text-warning rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <Clock size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

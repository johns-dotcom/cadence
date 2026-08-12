// One task as a card — shared by Board, List and the mobile fallback, so a task
// looks and reads the same wherever it appears.
//
// Presentational only: every interaction is a callback. Drag props are spread in by
// the parent (TaskBoard owns the DnD state).

import { GripVertical, MessageSquare, Paperclip } from 'lucide-react'
import { dueBucketOf, dueLabel, PRIORITY_DOT, PRIORITY_STRIPE } from './taskFields'

const DUE_TEXT = {
  overdue: 'text-red-600 font-medium',
  today: 'text-amber-600 font-medium',
  tomorrow: 'text-gray-500',
  week: 'text-gray-400',
  later: 'text-gray-400',
  none: 'text-gray-300',
}

export default function TaskCard({
  task, onOpen, showAssignee = false, selected = false, onToggleSelect,
  draggable = false, dragging = false, dragHandlers = {}, insertBefore = false, insertAfter = false,
}) {
  const bucket = dueBucketOf(task)
  const done = task.status === 'Done'

  return (
    <div className="relative">
      {/* Insertion line — the only feedback that says WHERE the card will land. */}
      {insertBefore && <div className="absolute -top-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full z-10" />}
      {insertAfter && <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-brand-500 rounded-full z-10" />}

      <div
        draggable={draggable}
        {...dragHandlers}
        onClick={() => onOpen?.(task)}
        className={`card p-3 group border-l-[3px] cursor-pointer transition
          ${PRIORITY_STRIPE[task.priority] || PRIORITY_STRIPE.Medium}
          ${dragging ? 'opacity-40' : ''}
          ${selected ? 'ring-2 ring-brand-400' : ''}
          ${done ? 'opacity-60' : ''}`}
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
            <GripVertical size={13} className="mt-0.5 text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0" />
          )}
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Medium}`} />

          <div className="min-w-0 flex-1">
            <p className={`text-sm text-ink break-words ${done ? 'line-through' : ''}`}>{task.description}</p>
            <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1 text-[11px]">
              {showAssignee && (
                <span className="text-gray-500 font-medium">{task.assignee_name || 'Unassigned'}</span>
              )}
              {showAssignee && <span className="text-gray-300">·</span>}
              <span className={DUE_TEXT[bucket]}>{dueLabel(task)}</span>
              {task.category && <><span className="text-gray-300">·</span><span className="text-gray-400">{task.category}</span></>}
              {task.release_name && <><span className="text-gray-300">·</span><span className="text-gray-400 truncate">{task.release_name}</span></>}
              {task.notes && <Paperclip size={10} className="text-gray-300" title="Has notes" />}
            </div>
          </div>

          <MessageSquare size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5" />
        </div>
      </div>
    </div>
  )
}

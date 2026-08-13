// Collapsible group header with a count — shared by Board columns and Table
// sections so the two never drift on labelling or collapse behaviour.

import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import Badge from '../ui/Badge'

export default function GroupHeader({
  group, collapsed, onToggle, onAdd, droppable = false, dense = false,
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${dense ? 'px-2 py-1' : 'px-1 mb-2'}`}>
      {/* -mx-1 px-1 py-1 gives this a ~28px hit area without shifting the label.
          It's the primary control on every column and used to be the bare height of
          a 12px uppercase label (~16px). */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 min-w-0 text-left -mx-1 px-1 py-1 rounded
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        aria-expanded={!collapsed}
      >
        {collapsed
          ? <ChevronRight size={13} className="text-ink-muted flex-shrink-0" aria-hidden="true" />
          : <ChevronDown size={13} className="text-ink-muted flex-shrink-0" aria-hidden="true" />}
        <h2 className="text-xs font-bold text-ink uppercase tracking-wide truncate">{group.label}</h2>
        {group.tone !== 'neutral'
          ? <Badge tone={group.tone}>{group.count}</Badge>
          : <span className="text-xs text-ink-muted">{group.count}</span>}
      </button>

      {/* The board already tints the whole column and draws an insertion rail, so a
          third "Drop" label here was noise. */}
      {onAdd && droppable && (
        <button
          onClick={() => onAdd(group.key)}
          className="p-1.5 -mr-1.5 rounded text-ink-faint hover:text-brand-ink transition flex-shrink-0
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          aria-label={`Add task to ${group.label}`}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  )
}

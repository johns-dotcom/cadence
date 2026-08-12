// Collapsible group header with a count — shared by Board columns and Table
// sections so the two never drift on labelling or collapse behaviour.

import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import Badge from '../ui/Badge'

export default function GroupHeader({
  group, collapsed, onToggle, onAdd, droppable = false, dragOver = false, dense = false,
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${dense ? 'px-2 py-1.5' : 'px-1 mb-2'}`}>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 min-w-0 text-left group/hdr"
        aria-expanded={!collapsed}
      >
        {collapsed
          ? <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />
          : <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />}
        <h3 className="text-xs font-bold text-ink uppercase tracking-wide truncate">{group.label}</h3>
        {group.tone !== 'neutral'
          ? <Badge tone={group.tone}>{group.count}</Badge>
          : <span className="text-xs text-gray-400">{group.count}</span>}
      </button>

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Only offered where the group is actually settable on a task — no point
            offering "add to Overdue". */}
        {onAdd && droppable && (
          <button
            onClick={() => onAdd(group.key)}
            className="text-gray-300 hover:text-brand-600 transition"
            title={`Add to ${group.label}`}
          >
            <Plus size={14} />
          </button>
        )}
        {dragOver && <span className="text-[10px] font-semibold text-brand-600 uppercase">Drop</span>}
      </div>
    </div>
  )
}

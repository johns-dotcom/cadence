// Board view — one column per group, drag within a column to reorder and across
// columns to change the grouped field.
//
// Columns come from the pipeline's `groups`, so a board grouped by assignee or due
// bucket works exactly like one grouped by status, with no special cases here.

import TaskCard from './TaskCard'
import GroupHeader from './GroupHeader'

export default function TaskBoard({
  groups, members, collapsed, onToggleGroup, selected, onToggleSelect,
  onOpen, onAdd, showAssignee,
  drag, over, dragHandlersFor, groupDragProps, groupDroppable,
}) {
  return (
    // Snap-scroll columns on phones (no DnD there), a grid from md up.
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 md:grid md:grid-cols-2 xl:grid-cols-3 md:overflow-visible md:pb-0">
      {groups.map(group => {
        const isCollapsed = collapsed.has(group.key)
        const droppable = groupDroppable?.(group.key)
        const isTarget = over?.groupKey === group.key
        const crossing = drag && drag.groupKey !== group.key
        return (
          <div
            key={group.key}
            {...(groupDragProps?.(group) || {})}
            className={`bg-elev border rounded-2xl p-3 snap-start min-w-[16rem] flex-shrink-0 md:min-w-0 transition
              ${isTarget ? 'border-brand-400 bg-brand-50/40' : 'border-rule'}
              ${crossing && !droppable ? 'opacity-60' : ''}`}
          >
            <GroupHeader
              group={group}
              collapsed={isCollapsed}
              onToggle={() => onToggleGroup(group.key)}
              onAdd={onAdd}
              droppable={droppable}
              dragOver={isTarget}
            />

            {!isCollapsed && (
              <div className="space-y-2 min-h-[3rem]">
                {group.items.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    showAssignee={showAssignee}
                    onOpen={onOpen}
                    selected={selected.has(task.id)}
                    onToggleSelect={onToggleSelect}
                    draggable={!!dragHandlersFor}
                    dragging={drag?.id === task.id}
                    dragHandlers={dragHandlersFor?.(task, i, group) || {}}
                    insertBefore={isTarget && over?.afterId === task.id}
                    insertAfter={isTarget && over?.beforeId === task.id}
                  />
                ))}
                {group.items.length === 0 && (
                  <p className="text-xs text-gray-300 px-1 py-3 text-center">
                    {crossing && droppable ? 'Drop here' : 'Empty'}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

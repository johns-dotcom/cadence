// Table view — grouped <tbody> sections, sticky header, frozen first column,
// inline editing, row grips, multi-select.
//
// Also renders the LIST view: a list is a dense table with one column and no
// header (`dense` + a single-key `columns`), so grouped rendering lives in exactly
// one place rather than two that can drift.

import { GripVertical } from 'lucide-react'
import { colByKey, PRIORITY_DOT } from './taskFields'
import GroupHeader from './GroupHeader'
import TaskCell from './TaskCell'
import TaskCard from './TaskCard'

export default function TaskTable({
  groups, columns, members, dense = false,
  collapsed, onToggleGroup,
  selected, onToggleSelect,
  onOpen, onPatch, canEditTask, canAssign = false, canUnassign = false,
  drag, over, dragHandlersFor, groupDroppable, groupDragProps,
}) {
  const cols = columns.map(colByKey).filter(Boolean)

  // Reassignment is lead-only server-side. Editing your OWN task doesn't earn you
  // the assignee cell, so gate that one column separately rather than letting the
  // edit 403 and roll back after the fact.
  const cellEditable = (col, rowEditable) => rowEditable && (col.key !== 'assignee' || canAssign)

  // ── List view: reuse TaskCard so a task reads identically to the board ──
  if (dense) {
    return (
      <div className="space-y-4">
        {groups.map(group => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key}>
              <GroupHeader
                group={group}
                collapsed={isCollapsed}
                onToggle={() => onToggleGroup(group.key)}
                droppable={groupDroppable?.(group.key)}
                dragOver={over?.groupKey === group.key}
              />
              {!isCollapsed && (
                <div className="space-y-1.5" {...(groupDragProps?.(group) || {})}>
                  {group.items.map((task, i) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      showAssignee
                      onOpen={onOpen}
                      selected={selected.has(task.id)}
                      onToggleSelect={onToggleSelect}
                      draggable={!!dragHandlersFor}
                      dragging={drag?.id === task.id}
                      dragHandlers={dragHandlersFor?.(task, i, group) || {}}
                      insertBefore={over?.groupKey === group.key && over?.afterId === task.id}
                      insertAfter={over?.groupKey === group.key && over?.beforeId === task.id}
                    />
                  ))}
                  {group.items.length === 0 && <p className="text-xs text-gray-300 px-1 py-2">Empty</p>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Table view ─────────────────────────────────────────────────────────
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr className="border-b border-divider text-left">
            <th className="w-8 px-2 py-2.5" />
            {/* Exactly ONE sticky cell per row (header included) — stacking several
                is what broke the Ledger's frozen column. It paints its own
                background so rows don't show through as they scroll under it. */}
            {cols.map((c, i) => (
              <th
                key={c.key}
                className={`px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap ${c.width || ''} ${
                  i === 0 ? 'sticky left-0 z-10 bg-card shadow-[1px_0_0_0_var(--color-border)]' : ''
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>

        {groups.map(group => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <tbody key={group.key} className="divide-y divide-divider" {...(groupDragProps?.(group) || {})}>
              <tr className="bg-elev/60">
                <td colSpan={cols.length + 1} className="px-1 py-0">
                  <GroupHeader
                    group={group}
                    collapsed={isCollapsed}
                    onToggle={() => onToggleGroup(group.key)}
                    droppable={groupDroppable?.(group.key)}
                    dragOver={over?.groupKey === group.key}
                    dense
                  />
                </td>
              </tr>

              {!isCollapsed && group.items.map((task, i) => {
                const canEdit = canEditTask ? canEditTask(task) : true
                const insertTop = over?.groupKey === group.key && over?.afterId === task.id
                const insertBottom = over?.groupKey === group.key && over?.beforeId === task.id
                return (
                  <tr
                    key={task.id}
                    draggable={!!dragHandlersFor && canEdit}
                    {...(dragHandlersFor?.(task, i, group) || {})}
                    className={`group hover:bg-gray-50 transition
                      ${drag?.id === task.id ? 'opacity-40' : ''}
                      ${selected.has(task.id) ? 'bg-brand-50/50' : ''}
                      ${insertTop ? 'shadow-[inset_0_2px_0_0_theme(colors.brand.500)]' : ''}
                      ${insertBottom ? 'shadow-[inset_0_-2px_0_0_theme(colors.brand.500)]' : ''}`}
                  >
                    <td className="px-2 py-2 align-top">
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={selected.has(task.id)}
                          onChange={() => onToggleSelect(task.id)}
                          className="cursor-pointer"
                          aria-label={`Select ${task.description}`}
                        />
                        {dragHandlersFor && canEdit && (
                          <GripVertical size={12} className="text-gray-300 opacity-0 group-hover:opacity-100 cursor-grab" />
                        )}
                      </div>
                    </td>

                    {cols.map((c, ci) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 align-top ${c.width || ''} ${
                          ci === 0 ? 'sticky left-0 z-10 bg-card group-hover:bg-gray-50 shadow-[1px_0_0_0_var(--color-border)]' : ''
                        }`}
                      >
                        {ci === 0 ? (
                          <div className="flex items-start gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${PRIORITY_DOT[task.priority] || PRIORITY_DOT.Medium}`} />
                            <div className="min-w-0 flex-1">
                              <TaskCell task={task} col={c} members={members} canEdit={cellEditable(c, canEdit)} canUnassign={canUnassign} onCommit={f => onPatch(task.id, f)} />
                            </div>
                            <button
                              onClick={() => onOpen?.(task)}
                              className="text-[10px] font-semibold text-brand-600 opacity-0 group-hover:opacity-100 flex-shrink-0"
                            >
                              Open
                            </button>
                          </div>
                        ) : (
                          <TaskCell task={task} col={c} members={members} canEdit={cellEditable(c, canEdit)} canUnassign={canUnassign} onCommit={f => onPatch(task.id, f)} />
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}

              {!isCollapsed && group.items.length === 0 && (
                <tr><td colSpan={cols.length + 1} className="px-4 py-3 text-xs text-gray-300">Empty</td></tr>
              )}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

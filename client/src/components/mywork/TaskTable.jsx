// Table view — grouped <tbody> sections, sticky header, frozen first column,
// inline editing, row grips, multi-select.
//
// Also renders the LIST view: a list is a dense table with one column and no
// header (`dense` + a single-key `columns`), so grouped rendering lives in exactly
// one place rather than two that can drift.

import { GripVertical } from 'lucide-react'
import { colByKey } from './taskFields'
import GroupHeader from './GroupHeader'
import TaskCell from './TaskCell'
import TaskCard from './TaskCard'

// box-shadow on a <tr> is NOT painted by Blink/WebKit under `border-collapse:
// collapse` (Tailwind preflight sets it) — only `background` renders in the row
// layer — so the drop-insertion line lives on the <td>s instead. That also works in
// the separated model, so it stops depending on browser table trivia.
//
// Do NOT "fix" this with `border-separate`: divide-y compiles to border-top on each
// <tr>, which the separated model ignores, silently deleting every row divider.
//
// Static strings on purpose — the JIT cannot see an interpolated class name. The
// sticky variants compose the frozen column's own right-hand rule.
const CELL_SHADOW = {
  none: '',
  top: 'shadow-[inset_0_2px_0_0_rgb(var(--color-brand-500))]',
  bottom: 'shadow-[inset_0_-2px_0_0_rgb(var(--color-brand-500))]',
  sticky: 'shadow-[1px_0_0_0_var(--color-border)]',
  stickyTop: 'shadow-[inset_0_2px_0_0_rgb(var(--color-brand-500)),1px_0_0_0_var(--color-border)]',
  stickyBottom: 'shadow-[inset_0_-2px_0_0_rgb(var(--color-brand-500)),1px_0_0_0_var(--color-border)]',
}

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
              />
              {!isCollapsed && (
                <div className="space-y-1.5" {...(groupDragProps?.(group) || {})}>
                  {group.items.map((task, i) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      showAssignee
                      onOpen={onOpen}
                      onPatch={onPatch}
                      canEdit={canEditTask ? canEditTask(task) : true}
                      selected={selected.has(task.id)}
                      onToggleSelect={onToggleSelect}
                      draggable={!!dragHandlersFor}
                      dragging={drag?.id === task.id}
                      dragHandlers={dragHandlersFor?.(task, i, group) || {}}
                      insertBefore={over?.groupKey === group.key && over?.afterId === task.id}
                      insertAfter={over?.groupKey === group.key && over?.beforeId === task.id}
                    />
                  ))}
                  {group.items.length === 0 && <p className="text-xs text-ink-muted px-1 py-2">Empty</p>}
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
                scope="col"
                className={`px-3 py-2.5 text-xs font-semibold text-ink-muted uppercase tracking-wide whitespace-nowrap ${c.width || ''} ${
                  i === 0 ? `sticky left-0 z-10 bg-card ${CELL_SHADOW.sticky}` : ''
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
                    dense
                  />
                </td>
              </tr>

              {!isCollapsed && group.items.map((task, i) => {
                const canEdit = canEditTask ? canEditTask(task) : true
                const insertTop = over?.groupKey === group.key && over?.afterId === task.id
                const insertBottom = over?.groupKey === group.key && over?.beforeId === task.id
                const isSel = selected.has(task.id)
                // useTaskDnd never sets both (beforeId/afterId are always different rows).
                const shadowFor = (sticky) => sticky
                  ? (insertTop ? CELL_SHADOW.stickyTop : insertBottom ? CELL_SHADOW.stickyBottom : CELL_SHADOW.sticky)
                  : (insertTop ? CELL_SHADOW.top : insertBottom ? CELL_SHADOW.bottom : CELL_SHADOW.none)

                return (
                  <tr
                    key={task.id}
                    draggable={!!dragHandlersFor && canEdit}
                    {...(dragHandlersFor?.(task, i, group) || {})}
                    // Selection is a ternary against hover, not a sibling class:
                    // hover: outranks a plain background in Tailwind's variant order,
                    // so hovering a selected row used to erase its tint entirely.
                    className={`group transition
                      ${drag?.id === task.id ? 'opacity-40' : ''}
                      ${isSel ? 'bg-selected' : 'hover:bg-elev'}`}
                  >
                    <td className={`px-2 py-2 align-top ${shadowFor(false)}`}>
                      <div className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => onToggleSelect(task.id)}
                          className="cursor-pointer"
                          aria-label={`Select ${task.description}`}
                        />
                        {dragHandlersFor && canEdit && (
                          <GripVertical size={12} className="text-ink-faint opacity-0 group-hover:opacity-100 cursor-grab" aria-hidden="true" />
                        )}
                      </div>
                    </td>

                    {cols.map((c, ci) => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 align-top ${c.width || ''} ${
                          ci === 0
                            // The frozen cell must stay OPAQUE — it paints over the
                            // cells sliding under it — so selection needs a solid
                            // token here rather than the row's tint showing through.
                            ? `sticky left-0 z-10 ${isSel ? 'bg-selected' : 'bg-card group-hover:bg-elev'} ${shadowFor(true)}`
                            : shadowFor(false)
                        }`}
                      >
                        {ci === 0 ? (
                          <div className="flex items-start gap-2">
                            {/* The priority dot used to sit here — redundant with the
                                literal Priority column a few cells away. */}
                            <div className="min-w-0 flex-1">
                              <TaskCell task={task} col={c} members={members} canEdit={cellEditable(c, canEdit)} canUnassign={canUnassign} onCommit={f => onPatch(task.id, f)} />
                            </div>
                            {/* focus:opacity-100 — Tab used to land on an invisible control. */}
                            <button
                              onClick={() => onOpen?.(task)}
                              className="text-[10px] font-semibold text-brand-ink opacity-0 group-hover:opacity-100 focus:opacity-100 flex-shrink-0 rounded px-1
                                         focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
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
                <tr><td colSpan={cols.length + 1} className="px-3 py-2 text-xs text-ink-muted">Empty</td></tr>
              )}
            </tbody>
          )
        })}
      </table>
    </div>
  )
}

// Native HTML5 drag-and-drop for tasks — cross-group moves AND intra-group
// reordering, shared by Board, Table and List.
//
// The repo's existing DnD (Deals.jsx) only moves cards between columns, which needs
// no notion of position. Reordering does, and HTML5 DnD gives you no drop index —
// so we derive one from the pointer against the hovered row's own midpoint, reading
// the neighbours out of the already-computed `group.items`. No sibling DOM
// measurement, no layout thrash.
//
// There is no library here on purpose: the app ships zero DnD dependencies and this
// is ~80 lines.

import { useCallback, useState } from 'react'
import { groupFieldFor } from './taskFields'

export default function useTaskDnd({ view, reorderTask, canDropGroup, canEditTask, enabled = true }) {
  const [drag, setDrag] = useState(null)   // { id, groupKey }
  const [over, setOver] = useState(null)   // { groupKey, beforeId, afterId }

  const reset = useCallback(() => { setDrag(null); setOver(null) }, [])

  const commit = useCallback(() => {
    if (!drag || !over) return reset()
    const crossed = over.groupKey !== drag.groupKey

    // Dropped exactly where it already sits — don't spend a request on it. The
    // null/null case matters: within its own group it means "no neighbours other
    // than me", i.e. the position is unchanged. Without this guard the server takes
    // the no-usable-neighbours branch and parks the card at the TOP of the label —
    // so dragging the bottom card downward would fling it to the top.
    if (!crossed && (over.beforeId === drag.id || over.afterId === drag.id)) return reset()
    if (!crossed && over.beforeId == null && over.afterId == null) return reset()

    // Suppressed groups never highlight, but a keyboard-less browser could still
    // fire the drop, so re-check rather than trusting the affordance.
    if (crossed && !canDropGroup(over.groupKey)) return reset()

    const fields = crossed ? groupFieldFor(view.group, over.groupKey) : null
    reorderTask(drag.id, over.beforeId, over.afterId, fields)
    reset()
  }, [drag, over, view.group, canDropGroup, reorderTask, reset])

  // Per-card / per-row handlers. `i` is the index within `group.items`.
  // Returns {} for a task the caller may not move; the hook itself returns
  // dragHandlersFor: null when dragging is off entirely, so views can test it to
  // decide whether to render grips at all.
  const dragHandlersForImpl = useCallback((task, i, group) => {
    if (canEditTask && !canEditTask(task)) return {}
    return {
      onDragStart: (e) => {
        setDrag({ id: task.id, groupKey: group.key })
        e.dataTransfer.effectAllowed = 'move'
        // Firefox refuses to start a drag without payload.
        try { e.dataTransfer.setData('text/plain', String(task.id)) } catch { /* ignore */ }
      },
      onDragEnd: reset,
      onDragOver: (e) => {
        if (!drag) return
        e.preventDefault()
        e.stopPropagation() // beat the group-level fallback below
        const r = e.currentTarget.getBoundingClientRect()
        const lower = e.clientY - r.top > r.height / 2
        const items = group.items
        setOver(lower
          ? { groupKey: group.key, beforeId: task.id, afterId: items[i + 1]?.id ?? null }
          : { groupKey: group.key, beforeId: items[i - 1]?.id ?? null, afterId: task.id })
      },
      onDrop: (e) => { e.preventDefault(); e.stopPropagation(); commit() },
    }
  }, [canEditTask, drag, reset, commit])

  // Group-body fallback: makes the empty space below the last card append, and an
  // empty group a valid target ({ beforeId: null, afterId: null }).
  const groupDragProps = useCallback((group) => {
    return {
      onDragOver: (e) => {
        if (!drag) return
        if (group.key !== drag.groupKey && !canDropGroup(group.key)) return // no highlight, no drop
        e.preventDefault()
        // Anchor on the last item that ISN'T the one being dragged, so appending
        // within a group lands after the real tail rather than losing its anchor.
        const tail = group.items.filter(t => t.id !== drag.id).slice(-1)[0]
        setOver({ groupKey: group.key, beforeId: tail ? tail.id : null, afterId: null })
      },
      onDragLeave: () => setOver(o => (o && o.groupKey === group.key ? null : o)),
      onDrop: (e) => { e.preventDefault(); commit() },
    }
  }, [drag, canDropGroup, commit])

  // NULL rather than a no-op function when dragging is off, so views can use it as
  // the single test for "should this row have a grip and be draggable at all".
  return {
    drag,
    over,
    dragHandlersFor: enabled ? dragHandlersForImpl : null,
    groupDragProps: enabled ? groupDragProps : null,
    dragging: !!drag,
  }
}

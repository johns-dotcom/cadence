// Task detail drawer — every field, a notes body, and a live discussion thread.
//
// The drawer shell follows DealDrawer (Deals.jsx:171-176): fixed overlay, right
// panel, sticky header + footer. ObjectDiscussion gives threads, @mentions,
// notification-bell integration and the Messages "Threads" entry for free, now that
// `task` is in OBJECT_TABLES.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, X } from 'lucide-react'
import ObjectDiscussion from '../ObjectDiscussion'
import Button from '../ui/Button'
import { TASK_STATUSES, PRIORITIES } from '../../constants'
import { formatDate } from '../../utils/dates'
import { categoriesIn, dueLabel } from './taskFields'

export default function TaskDrawer({ task, tasks, members, canEdit, canAssign, canUnassign = false, onClose, onPatch, onDelete }) {
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)

  // Notes commit on blur, but closing the drawer (or switching task) fires no blur,
  // and this component stays MOUNTED across a close — `task` just goes null — so an
  // unmount cleanup would never run. Instead: remember the live draft, and flush it
  // from the effect cleanup that fires when task.id changes.
  //
  // The guard on the assignment is load-bearing. On the render where `task` becomes
  // null we must NOT overwrite the ref, or the cleanup below would read id: null and
  // silently drop the draft it exists to save.
  const pending = useRef({ id: null, notes: '', dirty: false })
  if (task?.id != null) pending.current = { id: task.id, notes, dirty: notesDirty }

  useEffect(() => {
    setNotes(task?.notes || '')
    setNotesDirty(false)
    return () => {
      const p = pending.current
      if (p.dirty && p.id != null) onPatch(p.id, { notes: p.notes.trim() || null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      // Don't close out from under someone typing — useHotkeys guards this for
      // page-level keys, but this listener is raw, and Escape mid-notes would
      // otherwise throw away the draft.
      const el = e.target
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!task) return null

  const set = (field) => (e) => {
    const v = e.target.value
    onPatch(task.id, { [field]: v === '' ? null : v })
  }

  const saveNotes = () => {
    if (!notesDirty) return
    setNotesDirty(false)
    onPatch(task.id, { notes: notes.trim() || null })
  }

  const remove = () => {
    if (!window.confirm(`Delete “${task.description}”? This cannot be undone.`)) return
    onDelete(task.id)
    onClose()
  }

  const field = 'w-full text-sm bg-card border border-rule rounded-lg px-2 py-1.5 disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div
        className="w-full max-w-md bg-card h-full overflow-y-auto shadow-modal flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
      >
        <div className="sticky top-0 bg-card border-b border-divider px-4 py-3 flex items-start justify-between gap-2 z-10">
          <div className="min-w-0">
            <p className="text-xs text-gray-400">{task.assignee_name || 'Unassigned'} · {dueLabel(task)}</p>
            <h2 className="text-sm font-semibold text-ink break-words">{task.description}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-ink flex-shrink-0" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4 flex-1">
          <div>
            <label className="label">Task</label>
            <input className={field} defaultValue={task.description} disabled={!canEdit}
              onBlur={e => e.target.value.trim() && e.target.value !== task.description && onPatch(task.id, { description: e.target.value.trim() })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select className={field} value={task.status} onChange={set('status')} disabled={!canEdit}>
                {TASK_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className={field} value={task.priority} onChange={set('priority')} disabled={!canEdit}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Due date</label>
              <input type="date" className={field} value={String(task.due_date || '').slice(0, 10)} onChange={set('due_date')} disabled={!canEdit} />
            </div>
            <div>
              <label className="label">Category</label>
              <input className={field} list="task-categories" defaultValue={task.category || ''} disabled={!canEdit}
                onBlur={e => (e.target.value.trim() || null) !== task.category && onPatch(task.id, { category: e.target.value.trim() || null })} />
              <datalist id="task-categories">
                {categoriesIn(tasks).map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div>
            <label className="label">Assigned to</label>
            {/* Reassignment is lead-only server-side, so don't offer a control that
                would just 403. */}
            <select className={field} value={task.user_id ?? ''} onChange={set('user_id')} disabled={!canAssign}>
              {(canUnassign || task.user_id == null) && (
                <option value="" disabled={!canUnassign}>Unassigned</option>
              )}
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {!canAssign && <p className="text-[11px] text-gray-400 mt-1">Only team leads can reassign.</p>}
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className={`${field} resize-y`}
              rows={5}
              value={notes}
              disabled={!canEdit}
              onChange={e => { setNotes(e.target.value); setNotesDirty(true) }}
              onBlur={saveNotes}
              placeholder="Longer detail, links, context…"
            />
            {notesDirty && <p className="text-[11px] text-amber-600 mt-1">Unsaved — click outside to save.</p>}
          </div>

          <div className="text-[11px] text-gray-400 space-y-0.5">
            {task.release_name && (
              <p>Release: <Link to={`/releases/${task.release_id}`} className="text-brand-600 hover:underline">{task.release_name}</Link></p>
            )}
            {task.assigner_name && <p>Assigned by {task.assigner_name}</p>}
            {task.completed_at && <p>Completed {formatDate(task.completed_at)}</p>}
            <p>Created {formatDate(task.created_at)}</p>
          </div>

          <ObjectDiscussion
            entityType="task"
            entityId={task.id}
            title={`Task · ${String(task.description || '').slice(0, 100)}`}
          />
        </div>

        <div className="sticky bottom-0 bg-card border-t border-divider px-4 py-3 flex items-center justify-between">
          <Button variant="danger" size="sm" onClick={remove} disabled={!canEdit}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

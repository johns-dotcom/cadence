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
import ConfirmDialog from '../ui/ConfirmDialog'
import useEscapeStack from '../../hooks/useEscapeStack'
import useFocusTrap from '../../hooks/useFocusTrap'
import { TASK_STATUSES, TASK_PRIORITIES } from '../../constants'
import { formatDate } from '../../utils/dates'
import { categoriesIn, dueLabel } from './taskFields'

const NOTES_DEBOUNCE_MS = 600

export default function TaskDrawer({ task, tasks, members, releases = [], canEdit, canAssign, canUnassign = false, onClose, onPatch, onDelete }) {
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const notesTimer = useRef(null)

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
    // Any debounce still pending belongs to the PREVIOUS task; the flush below
    // covers it, so cancel the timer rather than letting it fire with the new id
    // in scope.
    clearTimeout(notesTimer.current)
    return () => {
      clearTimeout(notesTimer.current)
      const p = pending.current
      if (p.dirty && p.id != null) onPatch(p.id, { notes: p.notes.trim() || null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  // While open, the drawer OWNS Escape (hooks/useEscapeStack.js). It consumes the
  // key even when it declines to close, so the page-level handler can never clear a
  // multi-select out from under an open drawer. Previously both this and
  // TaskSurface's useHotkeys fired for one keypress.
  useEscapeStack(!!task, (e) => {
    // Don't close out from under someone typing — Escape mid-notes would throw away
    // the draft. Declining still consumes the key.
    const el = e.target
    if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return
    onClose()
  })

  // aria-modal="true" is a promise to assistive tech that focus stays inside; these
  // two make it true. Without them, Tab from an open drawer walked straight into the
  // sidebar behind it and the board scrolled under a stray wheel.
  const panelRef = useFocusTrap(!!task)
  useEffect(() => {
    if (!task) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [!!task]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null

  const set = (field) => (e) => {
    const v = e.target.value
    onPatch(task.id, { [field]: v === '' ? null : v })
  }

  const saveNotes = () => {
    clearTimeout(notesTimer.current)
    if (!notesDirty) return
    setNotesDirty(false)
    onPatch(task.id, { notes: notes.trim() || null })
  }

  // Autosave while typing. Blur-only meant closing the tab mid-paragraph lost the
  // draft — the drawer's own flush-on-close can't fire if the document goes away.
  // The id is CAPTURED at schedule time, so a save that lands after the drawer has
  // moved on still writes to the record it was typed into.
  const scheduleNotesSave = (value) => {
    const id = task.id
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => {
      setNotesDirty(false)
      onPatch(id, { notes: value.trim() || null })
    }, NOTES_DEBOUNCE_MS)
  }

  const remove = () => {
    setConfirmDelete(false)
    // Drop the pending notes draft first: the [task?.id] cleanup below would
    // otherwise PATCH notes onto the row we just deleted and toast "Save failed".
    clearTimeout(notesTimer.current)
    pending.current = { id: null, notes: '', dirty: false }
    setNotesDirty(false)
    onDelete(task.id)
    onClose()
  }

  // `.input` rather than a hand-rolled string: the previous local style was px-2
  // py-1.5 with no focus ring, so the drawer's fields were visibly tighter than the
  // quick-add form's on the same page and focused invisibly.
  const field = 'input disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-full max-w-md bg-card h-full overflow-y-auto shadow-modal flex flex-col outline-none"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
      >
        <div className="sticky top-0 bg-card border-b border-divider px-4 py-3 flex items-start justify-between gap-2 z-10">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">{task.assignee_name || 'Unassigned'} · {dueLabel(task)}</p>
            <h2 className="text-sm font-semibold text-ink break-words">{task.description}</h2>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink flex-shrink-0 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400" aria-label="Close"><X size={18} /></button>
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
                {TASK_PRIORITIES.map(p => <option key={p}>{p}</option>)}
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
            {!canAssign && <p className="text-[11px] text-ink-muted mt-1">Only team leads can reassign.</p>}
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className={`${field} resize-y`}
              rows={5}
              value={notes}
              disabled={!canEdit}
              onChange={e => { setNotes(e.target.value); setNotesDirty(true); scheduleNotesSave(e.target.value) }}
              onBlur={saveNotes}
              placeholder="Longer detail, links, context…"
            />
            {notesDirty && (
              <div className="flex items-center gap-2 mt-1">
                <Button size="sm" variant="secondary" onClick={saveNotes}>Save notes</Button>
                <span className="text-[11px] text-warning">Saving…</span>
              </div>
            )}
          </div>

          {/* The link was readonly here even though PATCH has always accepted
              release_id, so a task attached to the wrong release could never be
              moved and one attached to none could never be attached. */}
          <div>
            <label className="label">Release</label>
            <select
              className={field}
              value={task.release_id ?? ''}
              disabled={!canEdit}
              onChange={e => onPatch(task.id, { release_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No release</option>
              {/* The task's current release is guaranteed present even if it falls
                  outside the fetched window (limit, or a scope change) — otherwise
                  the select would silently show "No release" and the next save
                  would clear a real link. */}
              {task.release_id && !releases.some(r => r.id === task.release_id) && (
                <option value={task.release_id}>{task.release_name || `Release #${task.release_id}`}</option>
              )}
              {releases.map(r => (
                <option key={r.id} value={r.id}>{r.project_name}{r.artist_name ? ` · ${r.artist_name}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="text-[11px] text-ink-muted space-y-0.5">
            {task.release_name && (
              <p>Open: <Link to={`/releases/${task.release_id}`} className="text-brand-ink hover:underline">{task.release_name}</Link></p>
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
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={!canEdit}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>

        {/* Was a native confirm interpolating an unbounded description — a long task
            title produced an unreadable wall of text. */}
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          title="Delete task"
          message={`“${String(task.description).slice(0, 80)}${String(task.description).length > 80 ? '…' : ''}” will be permanently deleted. This can't be undone.`}
          confirmLabel="Delete task"
        />
      </div>
    </div>
  )
}

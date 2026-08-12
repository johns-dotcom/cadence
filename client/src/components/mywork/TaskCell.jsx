// One editable table cell. Click to edit, Enter/blur to commit, Escape to cancel.
//
// Defined at MODULE scope on purpose (see the post-mortem comment at
// Ledger.jsx:606): if the editor component is declared inside a render function it
// gets a new identity every keystroke, React remounts the <input>, and the caret
// jumps to the end mid-typing.

import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../utils/dates'

export default function TaskCell({ task, col, members = [], canEdit = true, canUnassign = false, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const ref = useRef(null)

  const field = col.field || col.key
  const current = field === 'user_id' ? (task.user_id ?? '') : (task[field] ?? '')

  useEffect(() => {
    if (!editing) return
    ref.current?.focus()
    if (ref.current?.select && col.kind === 'text') ref.current.select()
  }, [editing, col.kind])

  const display = col.render ? col.render(task) : (task[col.key] ?? '—')

  if (col.kind === 'readonly' || !canEdit) {
    return <span className="text-gray-600">{display || '—'}</span>
  }

  const begin = () => {
    // due_date needs the raw 'YYYY-MM-DD' for <input type="date">, not the
    // formatted display value.
    setValue(col.kind === 'date' ? String(current || '').slice(0, 10) : String(current ?? ''))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const next = value === '' ? null : value
    const before = current === '' ? null : current
    // Compare as strings: a <select>/<input> always yields a string, while user_id
    // arrives as a number, so a strict compare would report a change every time.
    if (String(next ?? '') === String(before ?? '')) return
    onCommit?.({ [field]: field === 'user_id' && next != null ? Number(next) : next })
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
    // Stop page-level single-key hotkeys (n / 1-4 / g / z) from firing while typing.
    e.stopPropagation()
  }

  if (!editing) {
    return (
      <button
        onClick={e => { e.stopPropagation(); begin() }}
        className="w-full text-left truncate hover:bg-brand-50/60 rounded px-1 -mx-1 py-0.5 transition"
        title="Click to edit"
      >
        {col.kind === 'date' ? formatDate(task[field]) : (display || <span className="text-gray-300">—</span>)}
      </button>
    )
  }

  const shared = {
    ref,
    value,
    onChange: e => setValue(e.target.value),
    onBlur: commit,
    onKeyDown,
    onClick: e => e.stopPropagation(),
    className: 'w-full text-sm bg-card border border-brand-400 rounded px-1.5 py-0.5 outline-none',
  }

  if (col.kind === 'select') {
    return <select {...shared}>{col.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
  }
  if (col.kind === 'user') {
    return (
      <select {...shared}>
        {/* Unassigning takes a task out of every department, so the server allows it
            for admins only — don't offer a choice that would just 403. Kept visible
            but disabled when the task IS unassigned, so the select has a valid value. */}
        {(canUnassign || current === '') && (
          <option value="" disabled={!canUnassign}>Unassigned</option>
        )}
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
    )
  }
  if (col.kind === 'date') {
    return <input type="date" {...shared} />
  }
  return <input type="text" {...shared} />
}

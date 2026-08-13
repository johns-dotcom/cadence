// One editable table cell. Click to edit, Enter/blur to commit, Escape to cancel.
// Dropdowns commit on change, since picking a value and seeing nothing happen reads
// as broken.
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
  const [flash, setFlash] = useState(null) // 'ok' | 'err' — brief post-save feedback
  const ref = useRef(null)
  // Chrome/Firefox fire `change` on every arrow keypress in a CLOSED <select> — the
  // same trap that made the bulk-action selects dangerous. So commit-on-change only
  // fires for a real (pointer) selection; arrow navigation defers to Enter/blur.
  const keyNav = useRef(false)

  const field = col.field || col.key
  const current = field === 'user_id' ? (task.user_id ?? '') : (task[field] ?? '')

  useEffect(() => {
    if (!editing) return
    ref.current?.focus()
    if (ref.current?.select && col.kind === 'text') ref.current.select()
  }, [editing, col.kind])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [flash])

  const display = col.render ? col.render(task) : (task[col.key] ?? '—')

  if (col.kind === 'readonly' || !canEdit) {
    return <span className="text-ink-muted">{display || '—'}</span>
  }

  const begin = () => {
    // due_date needs the raw 'YYYY-MM-DD' for <input type="date">, not the
    // formatted display value.
    setValue(col.kind === 'date' ? String(current || '').slice(0, 10) : String(current ?? ''))
    keyNav.current = false
    setEditing(true)
  }

  // Single edits are patched silently (no toast — one per cell would be noise), so
  // this brief tint is the only confirmation the user gets. It's why it exists.
  const commitValue = async (raw) => {
    setEditing(false)
    const next = raw === '' ? null : raw
    const before = current === '' ? null : current
    // Compare as strings: a <select>/<input> always yields a string, while user_id
    // arrives as a number, so a strict compare would report a change every time.
    if (String(next ?? '') === String(before ?? '')) return
    const ok = await onCommit?.({ [field]: field === 'user_id' && next != null ? Number(next) : next })
    setFlash(ok === false ? 'err' : 'ok')
  }

  const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']

  const onKeyDown = (e) => {
    if (NAV_KEYS.includes(e.key)) keyNav.current = true
    if (e.key === 'Enter') { e.preventDefault(); keyNav.current = false; commitValue(value) }
    else if (e.key === 'Escape') { e.preventDefault(); keyNav.current = false; setEditing(false) }
    // Stop page-level single-key hotkeys (n / 1-5 / g / z) from firing while typing.
    e.stopPropagation()
  }

  if (!editing) {
    return (
      <button
        onClick={e => { e.stopPropagation(); begin() }}
        className={`w-full text-left truncate rounded px-1 -mx-1 py-1 transition
          hover:bg-brand-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400
          ${flash === 'ok' ? 'bg-[rgba(16,185,129,0.16)]' : ''}
          ${flash === 'err' ? 'bg-[rgba(239,68,68,0.14)]' : ''}`}
      >
        {col.kind === 'date' ? formatDate(task[field]) : (display || <span className="text-ink-faint">—</span>)}
      </button>
    )
  }

  const shared = {
    ref,
    value,
    onBlur: () => { keyNav.current = false; commitValue(value) },
    onKeyDown,
    onClick: e => e.stopPropagation(),
    // ring, not just the border: border-brand-400 is also the RESTING border here, so
    // without a ring the cell you're typing in looked identical to an idle one.
    className: 'w-full text-sm bg-card border border-rule rounded px-1.5 py-0.5 outline-none ring-2 ring-brand-400',
  }

  // Dropdowns commit immediately — waiting for blur meant picking "Done" appeared to
  // do nothing at all.
  if (col.kind === 'select') {
    return (
      <select {...shared} onChange={e => { setValue(e.target.value); if (!keyNav.current) commitValue(e.target.value) }}>
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }
  if (col.kind === 'user') {
    return (
      <select {...shared} onChange={e => { setValue(e.target.value); if (!keyNav.current) commitValue(e.target.value) }}>
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
    return <input type="date" {...shared} onChange={e => setValue(e.target.value)} />
  }
  return <input type="text" {...shared} onChange={e => setValue(e.target.value)} />
}

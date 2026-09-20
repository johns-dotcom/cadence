// Document-style note editor for a task.
//
// Drop-in for the plain <textarea> it replaces: same (value, onChange, onBlur,
// disabled, placeholder) contract, so TaskDrawer's autosave/flush/pending logic
// and the console's draft handling are untouched. Storage stays a markdown
// STRING — nothing here knows about the database.
//
// Two surfaces, one gesture rule (the codebase's recurring "view-click and
// act-click must differ"): a rendered READ view where checkboxes toggle in
// place and clicking the prose opens the textarea, and an EDIT view with a
// formatting toolbar and smart keys. Read-only notes (disabled) never leave the
// read view and their checkboxes are inert.

import { useEffect, useRef, useState, useCallback } from 'react'
import { Bold, Italic, List, ListOrdered, CheckSquare, Heading2, Link2 } from 'lucide-react'
import { renderMarkdownNote } from '../../lib/markdownNote.jsx'
import {
  toggleWrap, toggleLinePrefix, continueList, indentLines, toggleCheckAt, insertLink,
} from '../../lib/noteEditing'

const TOOLS = [
  { key: 'bold', title: 'Bold  (⌘B)', Icon: Bold },
  { key: 'italic', title: 'Italic  (⌘I)', Icon: Italic },
  { key: 'h2', title: 'Heading', Icon: Heading2 },
  { key: 'bullet', title: 'Bulleted list', Icon: List },
  { key: 'ordered', title: 'Numbered list', Icon: ListOrdered },
  { key: 'check', title: 'Checklist', Icon: CheckSquare },
  { key: 'link', title: 'Link', Icon: Link2 },
]

export default function NoteEditor({
  value = '', onChange, onBlur, disabled = false,
  placeholder = 'Write a note…', variant = 'drawer', className = '',
}) {
  const compact = variant === 'pane'
  const ref = useRef(null)
  // A note that already has content opens READ; an empty one opens in EDIT so a
  // fresh note drops you straight onto the toolbar and cursor.
  const [editing, setEditing] = useState(() => !value.trim() && !disabled)
  // Selection to restore after a controlled-value change (toolbar / smart key).
  const pendingSel = useRef(null)

  useEffect(() => { if (disabled) setEditing(false) }, [disabled])

  // Apply a pending selection once the new value has rendered into the textarea.
  useEffect(() => {
    if (editing && pendingSel.current && ref.current) {
      const { s, e } = pendingSel.current
      pendingSel.current = null
      ref.current.focus()
      ref.current.setSelectionRange(s, e)
    }
  }, [value, editing])

  // Focus the textarea when entering edit mode from the read view.
  useEffect(() => {
    if (editing && !pendingSel.current && ref.current && document.activeElement !== ref.current) {
      const end = ref.current.value.length
      ref.current.focus()
      ref.current.setSelectionRange(end, end)
    }
  }, [editing])

  const apply = useCallback((res) => {
    if (!res) return
    pendingSel.current = { s: res.selStart, e: res.selEnd }
    onChange?.(res.value)
  }, [onChange])

  const runTool = useCallback((key) => {
    const ta = ref.current
    if (!ta) return
    const { selectionStart: s, selectionEnd: e, value: t } = ta
    if (key === 'bold') return apply(toggleWrap(t, s, e, '**'))
    if (key === 'italic') return apply(toggleWrap(t, s, e, '*'))
    if (key === 'link') {
      const url = window.prompt('Link URL')
      if (url && url.trim()) apply(insertLink(t, s, e, url.trim()))
      return
    }
    apply(toggleLinePrefix(t, s, e, key)) // h2 / bullet / ordered / check
  }, [apply])

  const onKeyDown = (e) => {
    const ta = e.currentTarget
    const s = ta.selectionStart, en = ta.selectionEnd
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); return apply(toggleWrap(ta.value, s, en, '**')) }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); return apply(toggleWrap(ta.value, s, en, '*')) }
    if (e.key === 'Tab') { e.preventDefault(); return apply(indentLines(ta.value, s, en, e.shiftKey)) }
    if (e.key === 'Enter' && !e.shiftKey) {
      const res = continueList(ta.value, s, en)
      if (res) { e.preventDefault(); apply(res) }
    }
  }

  // A checkbox click in READ mode toggles that source line and persists — no
  // detour through edit mode. This is the standout "document" capability, so it
  // has to work with one click on the box itself.
  const onToggleCheck = disabled ? undefined : (lineIndex) => onChange?.(toggleCheckAt(value, lineIndex))

  const box = compact
    ? 'text-sm text-ink'
    : 'rounded-lg border border-rule bg-card'

  // ── Read view ──────────────────────────────────────────────────────────
  if (!editing) {
    const empty = !value.trim()
    return (
      <div className={className}>
        <div
          className={`${box} ${compact ? '' : 'px-3 py-2'} ${disabled ? '' : 'cursor-text'} space-y-0.5 min-h-[3.5rem]`}
          onClick={disabled ? undefined : (e) => { if (!e.target.closest('a,button')) setEditing(true) }}
          role={disabled ? undefined : 'button'}
          tabIndex={disabled ? undefined : 0}
          onKeyDown={disabled ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(true) } }}
          aria-label={disabled ? 'Note' : 'Note — click to edit'}
        >
          {empty
            ? <span className="text-sm text-ink-faint italic">{disabled ? 'No note' : placeholder}</span>
            : renderMarkdownNote(value, { onToggleCheck })}
        </div>
      </div>
    )
  }

  // ── Edit view ──────────────────────────────────────────────────────────
  return (
    <div className={`${box} ${className} overflow-hidden`}>
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-divider bg-page/50 flex-wrap">
        {TOOLS.map(({ key, title, Icon }) => (
          <button
            key={key}
            type="button"
            title={title}
            aria-label={title}
            // preventDefault keeps focus + selection in the textarea, so the
            // tool acts on what's selected instead of blurring first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runTool(key)}
            className="p-1.5 rounded text-ink-muted hover:text-ink hover:bg-elev transition"
          >
            <Icon size={15} />
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { onBlur?.(); if (value.trim()) setEditing(false) }}
        rows={compact ? 6 : 8}
        className={`w-full bg-transparent border-0 px-3 py-2 text-sm text-ink leading-snug
                    placeholder:text-ink-faint resize-y outline-none focus:ring-0 font-mono min-h-[6rem]`}
      />
    </div>
  )
}

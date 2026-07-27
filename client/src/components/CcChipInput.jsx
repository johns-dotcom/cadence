import { useState } from 'react'
import { X } from 'lucide-react'

const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

// Chip-based CC field: type/paste emails (split on comma/semicolon/newline),
// Enter or blur commits, Backspace on empty removes the last. Invalid emails are
// kept but flagged red so the user can fix them. Suggestions = [{name,email}].
export default function CcChipInput({ value = [], onChange, suggestions = [], placeholder = 'Add CC…' }) {
  const [text, setText] = useState('')

  const commit = (raw) => {
    const parts = String(raw).split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    if (!parts.length) return
    onChange([...new Set([...value, ...parts])])
    setText('')
  }
  const remove = (e) => onChange(value.filter(v => v !== e))
  const onKeyDown = (ev) => {
    if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); commit(text) }
    else if (ev.key === 'Backspace' && !text && value.length) remove(value[value.length - 1])
  }

  return (
    <div className="w-full border border-rule rounded-lg px-2 py-1.5 bg-card flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-brand-400">
      {value.map(e => (
        <span key={e} className={`inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 ${isEmail(e) ? 'bg-gray-100 text-ink' : 'bg-red-50 text-red-600'}`}>
          {e}<button type="button" onClick={() => remove(e)} className="hover:opacity-70"><X size={11} /></button>
        </span>
      ))}
      <input
        list="cc-suggestions"
        className="flex-1 min-w-[120px] text-sm bg-transparent outline-none py-0.5 placeholder:text-gray-400 text-ink"
        value={text} placeholder={value.length ? '' : placeholder}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
        onPaste={e => { e.preventDefault(); commit(e.clipboardData.getData('text')) }}
      />
      <datalist id="cc-suggestions">
        {suggestions.filter(s => s.email && !value.includes(s.email)).map(s => <option key={s.email} value={s.email}>{s.name}</option>)}
      </datalist>
    </div>
  )
}

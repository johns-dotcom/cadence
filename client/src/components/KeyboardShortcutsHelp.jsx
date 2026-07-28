import { X } from 'lucide-react'

// Cheat-sheet overlay, opened with "?" (wired in Layout).
const SHORTCUTS = [
  { keys: ['⌘', 'K'], desc: 'Open search' },
  { keys: ['?'], desc: 'Show this help' },
  { keys: ['Esc'], desc: 'Close dialogs' },
  { keys: ['G', 'D'], desc: 'Go to Dashboard' },
  { keys: ['G', 'R'], desc: 'Go to Releases' },
  { keys: ['G', 'A'], desc: 'Go to Artists' },
  { keys: ['G', 'C'], desc: 'Go to Calendar' },
  { keys: ['G', 'W'], desc: 'Go to My Work' },
  { keys: ['N'], desc: 'New deal (Deal pipeline)' },
  { keys: ['1', '–', '7'], desc: 'Switch tabs (Release detail)' },
]

export default function KeyboardShortcutsHelp({ open, onClose }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 bg-overlay" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-2xl border border-rule shadow-modal p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm text-gray-600">{s.desc}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="text-[11px] font-semibold bg-gray-100 text-gray-600 border border-rule rounded px-1.5 py-0.5 min-w-[20px] text-center">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

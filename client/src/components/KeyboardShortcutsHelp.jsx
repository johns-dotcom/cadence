import { X } from 'lucide-react'
import { SHORTCUT_GROUPS } from '../constants/shortcuts'

// Cheat-sheet overlay, opened with "?" (wired in Layout). Reads from the shared
// shortcuts registry so it never drifts from the real hotkeys or the manual.
export default function KeyboardShortcutsHelp({ open, onClose }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 bg-overlay" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-2xl border border-rule shadow-modal p-5 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink">Keyboard shortcuts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map(g => (
            <div key={g.group}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{g.group}</p>
              <div className="space-y-2">
                {g.items.map((s, i) => (
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
          ))}
        </div>
      </div>
    </div>
  )
}

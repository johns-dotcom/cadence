// Card-at-a-time review shell — overlay, "{i} of {n}" header, progress bar,
// done panel. The card body, keyboard handlers and server calls stay with the
// OWNING surface (different decks' notion of "accept" is not the same
// operation), so children is a FUNCTION of (item, index, helpers).
//
// Children must be a function, not a node: when a deck finishes, index runs
// one past the end and the current item is undefined — an eagerly-evaluated
// node crashes on item.<anything>.

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useEscapeStack from '../hooks/useEscapeStack'

export default function ReviewDeck({ open, title, items, index, stats, onClose, children }) {
  useEscapeStack(open, onClose)
  if (!open) return null
  const done = index >= items.length
  const pct = items.length ? Math.min(100, Math.round((index / items.length) * 100)) : 100

  return createPortal(
    <div className="fixed inset-0 z-[75] bg-overlay flex items-center justify-center p-4">
      <div className="card w-full max-w-xl p-5 max-h-[92vh] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold text-ink">{title}</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 tabular-nums">{Math.min(index + 1, items.length)} of {items.length}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-ink"><X size={18} /></button>
          </div>
        </div>
        <div className="h-1 bg-gray-100 rounded-full overflow-hidden mb-4">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {done ? (
          <div className="text-center py-10">
            <p className="text-lg font-bold text-ink mb-1">Done 🎉</p>
            {stats && (
              <p className="text-sm text-gray-500">
                {Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ') || 'Nothing to do.'}
              </p>
            )}
            <button className="btn-primary mt-5" onClick={onClose}>Close</button>
          </div>
        ) : (
          children(items[index], index)
        )}
      </div>
    </div>,
    document.body
  )
}

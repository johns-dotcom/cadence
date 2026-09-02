import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useEscapeStack from '../../hooks/useEscapeStack'

// Slide-up mobile drawer (detail views, action menus, filter panels). Portals
// to document.body to escape overflow/stacking contexts; closes on backdrop tap
// or Escape; locks body scroll while open. Semantic tokens = dark-mode native.
export default function BottomSheet({ open, onClose, title, children, footer }) {
  const panelRef = useRef(null)
  // Escape goes through the shared overlay stack (hooks/useEscapeStack.js) rather
  // than a local listener, so a sheet opened over a page with its own Escape
  // handler consumes the key instead of both firing.
  useEscapeStack(open, onClose)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
      <div ref={panelRef}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-2xl shadow-modal max-h-[85dvh] flex flex-col animate-sheet-up"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex justify-center pt-2 pb-1 shrink-0" onClick={onClose}>
          <div className="w-9 h-1 rounded-full bg-gray-300" />
        </div>
        {(title || onClose) && (
          <div className="flex items-center justify-between px-4 pb-2 shrink-0 border-b border-divider">
            <div className="text-sm font-bold text-ink truncate">{title}</div>
            <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-gray-400 hover:text-gray-600" aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="overflow-y-auto px-4 py-3 flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>{children}</div>
        {footer && <div className="shrink-0 px-4 py-3 border-t border-divider bg-card">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

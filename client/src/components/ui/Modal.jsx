import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useEscapeStack from '../../hooks/useEscapeStack'
import useFocusTrap from '../../hooks/useFocusTrap'

// Centered modal dialog — the accessible counterpart to BottomSheet, and the
// replacement for the ~35 hand-rolled `fixed inset-0` overlays scattered through
// pages/. Markup deliberately matches those (bg-overlay backdrop, .card panel, the
// max-w-md|lg|2xl ladder) so it's a drop-in.
//
// What it adds over a hand-rolled overlay: a real focus trap, focus restoration,
// Escape that participates in the overlay stack instead of racing page hotkeys, and
// a body-scroll lock. Portals to document.body to escape overflow/stacking contexts.

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }

export default function Modal({
  open, onClose, title, children, footer, size = 'md', className = '',
}) {
  const panelRef = useFocusTrap(open)
  const titleId = useId()
  useEscapeStack(open, onClose)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-overlay flex items-center justify-center p-4" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onClick={e => e.stopPropagation()}
        className={`card w-full ${WIDTHS[size] || WIDTHS.md} max-h-[90vh] overflow-y-auto p-5 outline-none ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 id={titleId} className="font-bold text-ink">{title}</h2>
            <button onClick={onClose} className="text-ink-muted hover:text-ink flex-shrink-0" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="flex justify-end gap-2 mt-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

import BottomSheet from '../ui/BottomSheet'
import useEscapeStack from '../../hooks/useEscapeStack'

// Anchored popover that degrades to a BottomSheet on mobile — a menu pinned to the
// bottom of a 390px viewport is unreachable.
//
// Must be rendered inside a `relative` wrapper (it positions off `top-full`).
//
// Escape goes through the shared overlay stack rather than a local listener: this
// popover used to have no Escape handler at all, so pressing it reached the page's
// useHotkeys and cleared a 12-row selection while the popover stayed open.
// `placement="top"` opens upward — required for the bulk action bar, which is pinned
// near the bottom of the viewport where a downward menu would fall off-screen.
export default function Popover({
  open, onClose, title, isMobile, children, align = 'right', width = 'w-64', placement = 'bottom',
}) {
  // Above the early return so hook order stays stable. Mobile is a BottomSheet,
  // which registers its own stack entry.
  useEscapeStack(open && !isMobile, onClose)

  if (!open) return null

  if (isMobile) {
    return <BottomSheet open={open} onClose={onClose} title={title}>{children}</BottomSheet>
  }

  return (
    <>
      {/* Click-outside catcher. aria-hidden so it isn't announced as content. */}
      <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label={title}
        className={`absolute ${placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'} z-40 ${width} card p-3 shadow-modal max-h-[70vh] overflow-y-auto`}
      >
        {children}
      </div>
    </>
  )
}

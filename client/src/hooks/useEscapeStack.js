import { useEffect, useRef } from 'react'

/**
 * Escape-key ownership for stacked overlays.
 *
 * The problem this solves: every keydown listener in this app is on the BUBBLE end
 * of the path (useHotkeys and Layout on `window`, BottomSheet on `document`), so a
 * page-level Escape handler and an overlay's Escape handler both fire for one
 * keypress. Concretely: with 12 tasks selected, opening the Filters popover and
 * pressing Escape used to reach TaskSurface's useHotkeys and destroy the selection
 * while the popover stayed open.
 *
 * The fix is one listener in the CAPTURE phase draining a LIFO stack. The keydown
 * path is:
 *
 *   window(capture) → document(capture) → … → target → … → document(bubble) → window(bubble)
 *
 * so stopping propagation at document-capture reliably gives the key to the topmost
 * overlay and guarantees the page never sees it.
 *
 * A handler may return `false` to pass the key DOWN to the next overlay in the
 * stack. Note the key is still consumed at the document level either way — it never
 * reaches page-level hotkeys while any overlay is registered. That is the point: it
 * is what stops Escape-in-a-popover from clearing a multi-select.
 *
 * Corollary worth knowing: because this stops propagation at document-capture, it
 * also pre-empts React's synthetic onKeyDown. A React `onKeyDown` Escape handler on
 * a field INSIDE a registered overlay will not run — handle it from the overlay's
 * own onClose instead.
 *
 * IMPORTANT: only ever act on Escape. React 18 attaches its listeners to the root
 * container, which is inside `document`, so stopping propagation here would also
 * suppress React's synthetic onKeyDown (e.g. TaskCell's cancel-edit handler).
 */

const stack = []
let installed = false

function onKeyDown(e) {
  if (e.key !== 'Escape' || stack.length === 0) return
  for (let i = stack.length - 1; i >= 0; i--) {
    const handler = stack[i].current
    if (typeof handler !== 'function') continue
    if (handler(e) !== false) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
  }
}

/**
 * @param {boolean} active  Push onto the stack only while the overlay is open.
 * @param {(e: KeyboardEvent) => void|false} onEscape  Return false to decline.
 *
 * Call this ABOVE any `if (!open) return null` so hook order stays stable.
 */
export default function useEscapeStack(active, onEscape) {
  const ref = useRef(onEscape)
  ref.current = onEscape

  useEffect(() => {
    if (!active) return
    if (!installed) {
      document.addEventListener('keydown', onKeyDown, true)
      installed = true
    }
    stack.push(ref)
    return () => {
      const i = stack.indexOf(ref)
      if (i > -1) stack.splice(i, 1)
    }
  }, [active])
}

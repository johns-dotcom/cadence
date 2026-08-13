import { useEffect, useRef } from 'react'

// Everything the platform treats as tabbable. The `:not([hidden])` guard matters:
// ObjectDiscussion's file input is `<input type="file" hidden>` and must never be a
// tab stop.
const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'audio[controls]',
  'video[controls]', '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].map(s => `${s}:not([hidden]):not([aria-hidden="true"])`).join(',')

/**
 * Keep Tab inside a dialog while it's open, then hand focus back where it came from.
 *
 * Returns a ref to spread onto the panel. The panel must also carry `tabIndex={-1}`
 * so focus can rest on it rather than on its first control — focusing the first
 * field would steal the caret, and in the task drawer it would scroll straight past
 * the fields to the discussion textarea.
 *
 * Deliberately a keydown listener on the CONTAINER rather than a document `focusin`
 * sentinel: these dialogs open OS-level UI (window.confirm, the file picker) that
 * moves focus out of the document and back, and a sentinel would yank focus to the
 * first control every time one of those closed.
 *
 * `aria-modal="true"` on the panel is enough alongside this — it exists precisely to
 * replace `aria-hidden`-ing the background. `inert` would be stronger but has to go
 * on an element that does NOT contain the dialog, which requires portalling first.
 *
 * @param {boolean} active
 */
export default function useFocusTrap(active) {
  const ref = useRef(null)
  const prevFocus = useRef(null)

  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    prevFocus.current = document.activeElement
    el.focus({ preventScroll: true })

    const tabbable = () => [...el.querySelectorAll(FOCUSABLE)]
      // Hidden-by-layout nodes (a collapsed section, display:none) aren't tabbable.
      .filter(n => n.offsetWidth > 0 || n.offsetHeight > 0 || n.getClientRects().length > 0)

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const nodes = tabbable()
      if (nodes.length === 0) { e.preventDefault(); el.focus({ preventScroll: true }); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const at = document.activeElement
      // The panel itself (tabIndex -1) isn't in `nodes`, so a first Tab from the
      // panel has to be routed explicitly or it escapes to the browser chrome.
      if (!e.shiftKey && (at === last || at === el)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus() }
    }

    el.addEventListener('keydown', onKeyDown)
    return () => {
      el.removeEventListener('keydown', onKeyDown)
      // Don't chase a node that's gone — deleting a task unmounts the very card
      // whose click opened the drawer.
      const prev = prevFocus.current
      if (prev && document.contains(prev) && typeof prev.focus === 'function') {
        prev.focus({ preventScroll: true })
      }
    }
  }, [active])

  return ref
}

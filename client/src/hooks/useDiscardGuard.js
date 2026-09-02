import { useCallback } from 'react'

// Escape and backdrop-click for dialogs that hold UNSAVED work.
//
// Every dialog on `ui/Modal` gets Escape for free, which is the point of the
// migration — but a free Escape on a half-filled form is a data-loss bug wearing
// an accessibility badge. Escape is also a key people press reflexively to
// dismiss a native autocomplete or a datalist dropdown, i.e. exactly while they
// are mid-typing in one of these forms.
//
// So: clean dialogs close instantly, dirty ones ask, and a dialog with a save
// already in flight refuses to close at all rather than orphan the request and
// leave the caller unsure whether it landed.
//
// This has to be wired to the dialog's `onClose`, not to a field. useEscapeStack
// listens in the CAPTURE phase, so it pre-empts React's synthetic onKeyDown: a
// per-field Escape handler inside a registered overlay never runs.
//
// @param {boolean} dirty  true when there is unsaved input worth protecting
// @param {() => void} onClose  the real close
// @param {{ busy?: boolean, message?: string }} [opts]
// @returns {() => void} the guarded close — pass it as Modal's onClose
export default function useDiscardGuard(dirty, onClose, opts = {}) {
  const { busy = false, message = 'Discard your unsaved changes?' } = opts
  return useCallback(() => {
    if (busy) return
    if (dirty && !window.confirm(message)) return
    onClose()
  }, [dirty, busy, message, onClose])
}

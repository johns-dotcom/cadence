import { useEffect, useRef } from 'react'
import Modal from './Modal'
import Button from './Button'

// Confirmation for a destructive action. Replaces window.confirm where the message
// needs formatting or the dialog needs to participate in the app's Escape stack.
//
// Focus lands on CANCEL, not Confirm: the whole point of the dialog is that the
// destructive path should take a deliberate second action, and a trapped dialog whose
// initial Enter destroys something is worse than no dialog.

export default function ConfirmDialog({
  open, onClose, onConfirm, title = 'Are you sure?', message,
  confirmLabel = 'Delete', cancelLabel = 'Cancel', variant = 'danger', busy = false,
}) {
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // After useFocusTrap parks focus on the panel, move it to Cancel.
    const t = setTimeout(() => cancelRef.current?.focus({ preventScroll: true }), 0)
    return () => clearTimeout(t)
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={variant} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
        </>
      }
    >
      {typeof message === 'string'
        ? <p className="text-sm text-ink-muted break-words">{message}</p>
        : message}
    </Modal>
  )
}

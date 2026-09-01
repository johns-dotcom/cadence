import { useEffect, useRef } from 'react'

// Silent, throttled refetch when the tab comes back to the front.
//
// Finance pages are worked by several admins at once: one person claims a batch
// for a statement while another is looking at the same artist. Without this the
// second screen keeps showing pre-claim numbers until a manual reload, and the
// natural next action there is to claim them again.
//
// Silent by design — no spinner, no scroll jump, no selection reset. The
// throttle keeps a user who alt-tabs constantly from hammering the endpoint.
export default function useFocusRefetch(refetch, { throttleMs = 30000, enabled = true } = {}) {
  const lastRef = useRef(Date.now())
  const fnRef = useRef(refetch)
  fnRef.current = refetch

  useEffect(() => {
    if (!enabled) return
    const maybe = () => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastRef.current < throttleMs) return
      lastRef.current = now
      fnRef.current?.()
    }
    window.addEventListener('focus', maybe)
    document.addEventListener('visibilitychange', maybe)
    return () => {
      window.removeEventListener('focus', maybe)
      document.removeEventListener('visibilitychange', maybe)
    }
  }, [throttleMs, enabled])
}

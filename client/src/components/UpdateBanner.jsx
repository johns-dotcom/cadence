import { useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import api from '../api'

// "New version available" — the stale-tab detector.
//
// Cadence is an SPA with no service worker: client-side navigation never
// re-fetches index.html, so a tab left open across a deploy keeps executing the
// bundle it loaded on day one. It works right up until it asks the server for a
// chunk that deploy deleted, and then it dies somewhere unrelated to the cause
// — a user hit exactly that as a phantom /ledger crash.
//
// The identity we compare is whatever `GET /api/version` reports as the current
// main bundle filename. Vite content-hashes it, so it moves when the client
// moves and not otherwise. The FIRST value this tab sees is its baseline, held
// in memory: there is no build-time constant to keep in sync, and a server
// restart with no new build cannot false-positive.
//
// Nothing here is fatal. A failed poll, an unbuilt dev tree (bundle: null) or a
// dismissed banner all leave the app exactly as it was.

const POLL_MS = 5 * 60 * 1000
// Focus fires on every alt-tab. Floor the rate so a tab-flipping user doesn't
// spend the shared API rate-limit budget on version checks.
const MIN_GAP_MS = 60 * 1000

export default function UpdateBanner() {
  const baseline = useRef(null)   // first bundle this tab ever saw
  const lastAt = useRef(0)
  const [latest, setLatest] = useState(null)      // newest bundle the server reports
  const [dismissed, setDismissed] = useState(null) // the bundle the user dismissed

  useEffect(() => {
    let alive = true
    const check = async () => {
      if (Date.now() - lastAt.current < MIN_GAP_MS) return
      lastAt.current = Date.now()
      try {
        const { data } = await api.get('/version')
        const bundle = data?.data?.bundle
        if (!alive || !bundle) return
        if (baseline.current === null) { baseline.current = bundle; return }
        if (bundle !== baseline.current) setLatest(bundle)
      } catch {
        // Offline, rate-limited, or an old server with no /version route.
        // Silence is correct: this feature must never be the thing that breaks.
      }
    }
    check()
    const id = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', check) }
  }, [])

  // Dismissal is per-version, not forever: if a SECOND deploy lands after the
  // user waved this away, that is new information and worth saying again.
  if (!latest || latest === dismissed) return null

  return (
    <div className="fixed z-[80] right-4 left-4 sm:left-auto bottom-20 sm:bottom-4 max-w-md sm:w-96 card shadow-modal p-4 flex items-start gap-3"
      role="status" aria-live="polite">
      <RefreshCw size={16} className="text-brand-ink flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">A new version of Cadence is available</p>
        <p className="text-xs text-ink-muted mt-0.5">
          This tab is still running the build it opened with. Reload to pick up the current one.
        </p>
        <button onClick={() => window.location.reload()} className="btn-primary !py-1.5 text-xs mt-3">Reload</button>
      </div>
      <button onClick={() => setDismissed(latest)} aria-label="Dismiss" className="text-ink-muted hover:text-ink flex-shrink-0">
        <X size={16} />
      </button>
    </div>
  )
}

import { Link, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'

// A URL that matches nothing used to redirect silently to the dashboard, which
// looks identical to "the link worked and this is the page". A typo, a stale
// bookmark and a renamed route all produced the same silent shrug. This says
// what happened and offers the two ways out.
export default function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="card p-10 text-center max-w-lg mx-auto mt-10">
      <Compass size={30} className="text-ink-faint mx-auto mb-3" />
      <h1 className="text-lg font-bold text-ink">Page not found</h1>
      <p className="text-sm text-ink-muted mt-1">
        Nothing lives at <code className="text-xs bg-elev border border-divider rounded px-1.5 py-0.5">{pathname}</code>.
        It may have moved, or you may not have access to it.
      </p>
      <div className="flex items-center justify-center gap-2 mt-5">
        <Link to="/" className="btn-primary">Back to dashboard</Link>
        <button onClick={() => window.history.back()} className="btn-secondary">Go back</button>
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'

// Fixed by hand — see the note in Privacy.jsx.
const LAST_UPDATED = 'September 2, 2026'

export default function EULA() {
  return (
    <div className="min-h-screen bg-page py-12 px-4">
      <div className="max-w-2xl mx-auto card p-8">
        <Link to="/login" className="text-sm text-brand-ink hover:underline">← Back</Link>
        {/* Titled "End User Licence Agreement" to match the /eula route and the
            EULA framing the rest of the product uses — it was "Terms of
            Service", which agreed with neither. */}
        <h1 className="text-2xl font-bold text-ink mt-4 mb-2">End User Licence Agreement</h1>
        <p className="text-sm text-ink-faint mb-6">Last updated: {LAST_UPDATED}</p>
        <div className="text-sm leading-relaxed text-ink-muted space-y-4">
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning font-semibold">
            Placeholder — these are not enforceable terms. Replace this page with
            your organization's actual agreement before launch.
          </p>
          <p>By using Cadence, you agree to these terms.</p>
        </div>
      </div>
    </div>
  )
}

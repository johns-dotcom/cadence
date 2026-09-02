import { Link } from 'react-router-dom'

// The dateline is a FIXED constant, not `new Date()`. A live year silently
// re-dates the document every January and tells the reader this text was
// reviewed when it was not — the one thing a legal dateline must never do.
// Bump this by hand, in the same commit that changes the copy below.
const LAST_UPDATED = 'September 2, 2026'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-page py-12 px-4">
      <div className="max-w-2xl mx-auto card p-8">
        <Link to="/login" className="text-sm text-brand-ink hover:underline">← Back</Link>
        <h1 className="text-2xl font-bold text-ink mt-4 mb-2">Privacy Policy</h1>
        <p className="text-sm text-ink-faint mb-6">Last updated: {LAST_UPDATED}</p>
        <div className="text-sm leading-relaxed text-ink-muted space-y-4">
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning font-semibold">
            Placeholder — this is not a privacy policy. Replace this page with your
            organization's actual policy before launch.
          </p>
          <p>Cadence is a multi-tenant label operations platform. Each workspace's data is isolated and accessible only to members of that workspace.</p>
        </div>
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'

export default function EULA() {
  return (
    <div className="min-h-screen bg-page py-12 px-4">
      <div className="max-w-2xl mx-auto card p-8">
        <Link to="/login" className="text-sm text-brand-600 hover:text-brand-700">← Back</Link>
        <h1 className="text-2xl font-bold text-ink mt-4 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-6">Last updated: {new Date().getFullYear()}</p>
        <div className="prose prose-sm text-gray-600 space-y-4">
          <p>By using Cadence, you agree to these terms. This is placeholder copy — replace it with your organization's actual terms before launch.</p>
        </div>
      </div>
    </div>
  )
}

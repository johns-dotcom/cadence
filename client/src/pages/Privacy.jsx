import { Link } from 'react-router-dom'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-page py-12 px-4">
      <div className="max-w-2xl mx-auto card p-8">
        <Link to="/login" className="text-sm text-brand-600 hover:text-brand-700">← Back</Link>
        <h1 className="text-2xl font-bold text-ink mt-4 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-6">Last updated: {new Date().getFullYear()}</p>
        <div className="prose prose-sm text-gray-600 space-y-4">
          <p>Cadence is a multi-tenant label operations platform. Each workspace's data is isolated and accessible only to members of that workspace.</p>
          <p>This is placeholder copy. Replace it with your organization's actual privacy policy before launch.</p>
        </div>
      </div>
    </div>
  )
}

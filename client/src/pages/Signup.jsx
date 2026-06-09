import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Disc3 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

// Self-serve onboarding: provisions a brand-new label (tenant) and makes the
// signer-up its first Superadmin.
export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()

  const [labelName, setLabelName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!labelName.trim() || !name.trim() || !email.trim() || password.length < 8) {
      setError('Fill in every field. Password must be at least 8 characters.')
      return
    }
    setError(''); setSubmitting(true)
    const result = await signup({ labelName: labelName.trim(), name: name.trim(), email: email.trim(), password })
    setSubmitting(false)
    if (result.success) return navigate('/')
    setError(result.error)
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center">
              <Disc3 size={22} className="text-white" />
            </div>
            <span className="text-2xl font-bold text-ink tracking-tight">Cadence</span>
          </div>
          <p className="text-sm text-gray-500">Create your label's workspace</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Label name</label>
              <input type="text" placeholder="e.g. Midnight Records" value={labelName}
                onChange={e => setLabelName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Your name</label>
              <input type="text" placeholder="Full name" value={name}
                onChange={e => setName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Work email</label>
              <input type="email" placeholder="you@label.com" value={email}
                onChange={e => setEmail(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" placeholder="At least 8 characters" value={password}
                onChange={e => setPassword(e.target.value)} className="input" />
            </div>

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Creating workspace…' : 'Create workspace'}
            </button>
          </form>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 mt-3">
              <p className="text-red-600 text-xs text-center">{error}</p>
            </div>
          )}
          <p className="text-[11px] text-gray-400 text-center mt-4 leading-relaxed">
            You'll be set up as the workspace owner (Superadmin) and can invite your team afterward.
          </p>
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have a workspace?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

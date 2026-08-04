import { useState } from 'react'
import { Disc3, KeyRound } from 'lucide-react'
import api from '../api'

// PUBLIC page — reached from a password-reset email at /reset-password?token=…
// Sets a new password against the token, then logs the user straight in.
export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!token) { setError('Missing reset token.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      const { data } = await api.post('/auth/reset-password', { token, password })
      // Store the session and hard-navigate so the app boots fresh as this user.
      localStorage.setItem('token', data.data.token)
      localStorage.removeItem('admin_token')
      window.location.href = '/'
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset your password.')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center"><Disc3 size={22} className="text-white" /></div>
            <span className="text-2xl font-bold text-ink tracking-tight">Cadence</span>
          </div>
        </div>

        <div className="card p-6">
          {!token ? (
            <div className="text-center">
              <p className="text-sm text-red-600 mb-3">This reset link is missing its token. Please request a new one.</p>
              <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Go to sign in</a>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1 text-brand-600"><KeyRound size={16} /> <span className="text-xs font-semibold uppercase tracking-wide">Password reset</span></div>
              <h1 className="text-lg font-bold text-ink mb-1">Choose a new password</h1>
              <p className="text-sm text-gray-500 mb-4">Enter a new password for your account.</p>
              <form onSubmit={submit} className="space-y-3">
                <div><label className="label">New password</label><input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" autoFocus /></div>
                <div><label className="label">Confirm password</label><input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
                {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-red-600 text-xs">{error}</p></div>}
                <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? 'Saving…' : 'Reset password & sign in'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

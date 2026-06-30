import { useEffect, useState } from 'react'
import { Disc3, CheckCircle2 } from 'lucide-react'
import api from '../api'

// PUBLIC page — reached from an invite email at /accept-invite?token=…
// The new member sets their own password here, then is logged straight in.
export default function AcceptInvite() {
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [invite, setInvite] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | invalid
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setStatus('invalid'); setError('Missing invite token.'); return }
    api.get(`/auth/invite/${token}`)
      .then(r => { setInvite(r.data.data); setStatus('ready') })
      .catch(err => { setStatus('invalid'); setError(err.response?.data?.error || 'This invite is invalid or has expired.') })
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    try {
      const { data } = await api.post('/auth/accept-invite', { token, password })
      // Store the session and hard-navigate so the app boots fresh as this user.
      localStorage.setItem('token', data.data.token)
      localStorage.removeItem('admin_token')
      window.location.href = '/'
    } catch (err) {
      setError(err.response?.data?.error || 'Could not accept the invite.')
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
          {status === 'loading' && <p className="text-sm text-gray-400 text-center">Checking your invitation…</p>}

          {status === 'invalid' && (
            <div className="text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <a href="/login" className="text-sm font-semibold text-brand-600 hover:text-brand-700">Go to sign in</a>
            </div>
          )}

          {status === 'ready' && (
            <>
              <div className="flex items-center gap-2 mb-1 text-emerald-600"><CheckCircle2 size={16} /> <span className="text-xs font-semibold uppercase tracking-wide">Invitation</span></div>
              <h1 className="text-lg font-bold text-ink mb-1">Welcome, {invite.name?.split(' ')[0]}</h1>
              <p className="text-sm text-gray-500 mb-4">You've been invited to <span className="font-semibold text-ink">{invite.workspace}</span>. Set a password to activate your account.</p>
              <form onSubmit={submit} className="space-y-3">
                <div><label className="label">Email</label><input className="input bg-gray-50" value={invite.email} disabled /></div>
                <div><label className="label">Password</label><input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="8+ characters" autoFocus /></div>
                <div><label className="label">Confirm password</label><input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
                {error && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5"><p className="text-red-600 text-xs">{error}</p></div>}
                <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? 'Activating…' : 'Set password & sign in'}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

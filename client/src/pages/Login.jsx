import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { Disc3 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../api'

export default function Login() {
  const { login, googleLogin } = useAuth()
  const navigate = useNavigate()
  const expired = new URLSearchParams(window.location.search).get('expired') === '1'
  const googleEnabled = !!import.meta.env.VITE_GOOGLE_CLIENT_ID

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [workspaceOptions, setWorkspaceOptions] = useState(null) // populated on 409
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [mode, setMode] = useState('login') // 'login' | 'forgot'
  const [forgotMsg, setForgotMsg] = useState('')

  const handleEmailLogin = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) return
    setError(''); setSubmitting(true)
    const result = await login(email.trim(), password, workspace || undefined)
    setSubmitting(false)
    if (result.success) return navigate('/')
    if (result.workspaces) setWorkspaceOptions(result.workspaces)
    setError(result.error)
  }

  const handleGoogle = async (cred) => {
    setError('')
    const result = await googleLogin(cred.credential, workspace || undefined)
    if (result.success) return navigate('/')
    if (result.workspaces) setWorkspaceOptions(result.workspaces)
    setError(result.error)
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setError(''); setForgotMsg(''); setSubmitting(true)
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim(), workspace: workspace || undefined })
      setForgotMsg(data.message || 'If that email is registered, a reset link is on its way.')
    } catch (err) {
      const r = err.response?.data
      if (r?.workspaces) { setWorkspaceOptions(r.workspaces); setError(r.error) }
      else setError(r?.error || 'Something went wrong. Please try again.')
    } finally { setSubmitting(false) }
  }

  const switchMode = (m) => { setMode(m); setError(''); setForgotMsg(''); setWorkspaceOptions(null) }

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
          <p className="text-sm text-gray-500">{mode === 'forgot' ? 'Reset your password' : 'Sign in to your workspace'}</p>
        </div>

        <div className="card p-6 flex flex-col gap-4">
          {mode === 'login' ? (
            <>
              {googleEnabled && (
                <>
                  <div className="flex justify-center">
                    <GoogleLogin onSuccess={handleGoogle} onError={() => setError('Google sign-in failed.')} theme="outline" size="large" width="288" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-rule" />
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-rule" />
                  </div>
                </>
              )}

              <form onSubmit={handleEmailLogin} className="space-y-3">
                <input type="email" placeholder="Email address" value={email}
                  onChange={e => setEmail(e.target.value)} className="input" />
                <input type="password" placeholder="Password" value={password}
                  onChange={e => setPassword(e.target.value)} className="input" />

                {/* Shown only when the email maps to multiple workspaces. */}
                {workspaceOptions && (
                  <select value={workspace} onChange={e => setWorkspace(e.target.value)} className="input">
                    <option value="">Select your workspace…</option>
                    {workspaceOptions.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
                  </select>
                )}

                <button type="submit" disabled={submitting || !email.trim() || !password.trim()} className="btn-primary w-full">
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <button type="button" onClick={() => switchMode('forgot')}
                className="text-xs text-brand-600 hover:underline text-center">Forgot your password?</button>
            </>
          ) : (
            <form onSubmit={handleForgot} className="space-y-3">
              <p className="text-xs text-gray-500 leading-relaxed">Enter your email and we'll send you a link to set a new password.</p>
              <input type="email" placeholder="Email address" value={email} autoFocus
                onChange={e => setEmail(e.target.value)} className="input" />

              {workspaceOptions && (
                <select value={workspace} onChange={e => setWorkspace(e.target.value)} className="input">
                  <option value="">Select your workspace…</option>
                  {workspaceOptions.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
                </select>
              )}

              <button type="submit" disabled={submitting || !email.trim() || !!forgotMsg} className="btn-primary w-full">
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
              <button type="button" onClick={() => switchMode('login')}
                className="text-xs text-brand-600 hover:underline text-center w-full">Back to sign in</button>
            </form>
          )}

          {forgotMsg && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
              <p className="text-green-700 text-xs text-center">{forgotMsg}</p>
            </div>
          )}
          {expired && !error && mode === 'login' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <p className="text-amber-700 text-xs text-center font-medium">Your session expired. Please sign in again.</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              <p className="text-red-600 text-xs text-center">{error}</p>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Need a workspace? Contact your administrator.
        </p>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { LogOut, Monitor } from 'lucide-react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { formatDate } from '../../utils/dates'
import ConfirmDialog from './../ui/ConfirmDialog'

// A short, readable phone/browser from a user-agent — enough to recognise your
// own sessions without pretending to be a full UA parser.
function deviceOf(ua) {
  const s = String(ua || '')
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : ''
  const br = /Edg\//.test(s) ? 'Edge' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari' : ''
  return [br, os].filter(Boolean).join(' · ') || 'Unknown device'
}

function timeOf(ts) {
  try { const d = new Date(ts); return `${formatDate(ts)} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }
  catch { return formatDate(ts) }
}

// Account security: your recent sign-ins, and a way to end every session.
// Both wire up infrastructure that already existed and had no UI —
// user_login_logs (written on every login) and token_version (a bump kills all
// tokens). Shared by the tenant and console Settings shells.
export default function SecurityPanel() {
  const { updateToken } = useAuth()
  const { toast } = useToast()
  const [logins, setLogins] = useState(null) // null = loading
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/settings/me/logins')
      .then(r => setLogins(r.data.data || []))
      .catch(() => setLogins([]))
  }, [])

  const revoke = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/settings/me/sessions/revoke')
      // The server bumped token_version (every token, incl. this one, is now
      // stale) and returned a fresh one for this device — swap it in so we stay
      // signed in here while other devices drop on their next request.
      if (data?.data?.token) updateToken(data.data.token)
      toast('Signed out of all other devices')
    } catch (err) {
      toast(err.response?.data?.error || 'Could not sign out other sessions', 'error')
    } finally { setBusy(false); setConfirm(false) }
  }

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink mb-1">Security</h2>
      <p className="text-xs text-ink-muted mb-4">Your recent sign-ins, and one-click sign-out everywhere else.</p>

      <div className="mb-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-faint mb-2">Recent sign-ins</p>
        {logins === null ? (
          <p className="text-xs text-ink-faint">Loading…</p>
        ) : logins.length === 0 ? (
          <p className="text-xs text-ink-faint">No sign-ins recorded yet.</p>
        ) : (
          <ul className="divide-y divide-divider">
            {logins.map((l, i) => (
              <li key={i} className="flex items-center gap-2.5 py-2">
                <Monitor size={14} className="text-ink-faint flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{deviceOf(l.user_agent)}</span>
                  <span className="block text-[11px] text-ink-faint">{timeOf(l.logged_in_at)}{l.ip_address ? ` · ${l.ip_address}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button onClick={() => setConfirm(true)} className="btn-secondary inline-flex items-center gap-1.5">
        <LogOut size={14} /> Sign out everywhere else
      </button>

      <ConfirmDialog
        open={confirm}
        title="Sign out of all other devices?"
        message="Every other signed-in session — other browsers and phones — will be signed out on its next action. This device stays signed in."
        confirmLabel="Sign out everywhere else"
        variant="danger"
        busy={busy}
        onConfirm={revoke}
        onClose={() => setConfirm(false)}
      />
    </div>
  )
}
